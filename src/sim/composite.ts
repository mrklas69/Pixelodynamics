// Composite (slepenec) = množina pixelů spojených jointy. Pro fázi 4+ (magnetic merge,
// rigid body kinematics) je composite primárním objektem simulace; pro fázi 3 je
// derivovaná struktura, která se počítá z pixel + joint stavu.
//
// Stage 1 (sezení 12): jen build + free-edge enumeration + merge candidate detection.
// Stage 2: inelastic merge s konzervací ∑P, ∑L, redistribuce do composite kinematics.
// Stage 3: composite-driven integrátor nahrazující Rapier joint solver v align režimu.

import type { World } from './physics';
import type { Pixel } from '../types';
import type { Joint } from './joints';
import { createFixedJoint } from './joints';
import { buildPixelIndex } from './diagnostics';

/**
 * Composite = aggregate atributy slepence vypočítané z členských pixelů.
 * `linvel` a `angvel` jsou vážené průměry / L_total / I_total pro rigid body assumption;
 * pokud členové nejsou v sync (např. během vibračního režimu po neelastickém spojení),
 * tyto hodnoty jsou aproximace.
 */
export type Composite = {
  id: number;
  members: Pixel[];
  /** Center of mass v world coords. */
  com: { x: number; y: number };
  /** Linvel CoM = ∑(m·v) / M. */
  linvel: { x: number; y: number };
  /** Angvel kolem CoM = L_total / I_total (rigid body approximation). */
  angvel: number;
  /** Total mass = ∑m. */
  mass: number;
  /** Total moment of inertia kolem CoM (parallel axis): ∑(m·|r_rel|² + m/6). */
  inertia: number;
};

/**
 * Volná hrana = strana pixelu, která NENÍ shared s jiným členem stejné komponenty
 * přes joint. Endpoints v world frame (length 1 U).
 */
export type FreeEdge = {
  pixel: Pixel;
  /** Local-frame směr edge: 0=+X, 1=-X, 2=+Y, 3=-Y. */
  dir: 0 | 1 | 2 | 3;
  /** World endpoint #1 (segment start). */
  p1: { x: number; y: number };
  /** World endpoint #2 (segment end). */
  p2: { x: number; y: number };
};

/**
 * Merge kandidát = pár komponent s nejbližšími volnými hranami uvnitř threshold.
 */
export type MergeCandidate = {
  compA: Composite;
  compB: Composite;
  edgeA: FreeEdge;
  edgeB: FreeEdge;
  /** Min distance mezi edges (line segment to line segment). */
  distance: number;
};

/**
 * Postaví Composite[] z aktuálního stavu pixelů + jointů přes Union-Find.
 * O((N+J)·α). Volat na display tick (5 Hz) — ne per sim tick.
 */
export function buildComposites(world: World): Composite[] {
  const n = world.pixels.length;
  if (n === 0) return [];
  const idxOf = buildPixelIndex(world);

  const parent = new Int32Array(n);
  const size = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    parent[i] = i;
    size[i] = 1;
  }
  const find = (x: number): number => {
    let r = x;
    while (parent[r]! !== r) r = parent[r]!;
    while (parent[x]! !== r) {
      const next = parent[x]!;
      parent[x] = r;
      x = next;
    }
    return r;
  };

  for (const j of world.joints) {
    const a = idxOf.get(j.a);
    const b = idxOf.get(j.b);
    if (a === undefined || b === undefined) continue;
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) continue;
    if (size[ra]! < size[rb]!) {
      parent[ra] = rb;
      size[rb] = size[rb]! + size[ra]!;
    } else {
      parent[rb] = ra;
      size[ra] = size[ra]! + size[rb]!;
    }
  }

  const groups = new Map<number, Pixel[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    let g = groups.get(root);
    if (!g) {
      g = [];
      groups.set(root, g);
    }
    g.push(world.pixels[i]!);
  }

  const composites: Composite[] = [];
  let nextId = 0;
  for (const members of groups.values()) {
    composites.push(computeAggregate(members, nextId++));
  }
  return composites;
}

function computeAggregate(members: Pixel[], id: number): Composite {
  let mass = 0;
  let comX = 0;
  let comY = 0;
  for (const p of members) {
    const t = p.body.translation();
    mass += p.m;
    comX += p.m * t.x;
    comY += p.m * t.y;
  }
  if (mass > 0) {
    comX /= mass;
    comY /= mass;
  }

  let pX = 0;
  let pY = 0;
  let L = 0;
  let I = 0;
  for (const p of members) {
    const t = p.body.translation();
    const v = p.body.linvel();
    const w = p.body.angvel();
    pX += p.m * v.x;
    pY += p.m * v.y;
    const rx = t.x - comX;
    const ry = t.y - comY;
    L += p.m * (rx * v.y - ry * v.x); // orbital
    L += (p.m / 6) * w; // spin
    I += p.m * (rx * rx + ry * ry) + p.m / 6; // parallel axis (Steiner)
  }

  return {
    id,
    members,
    com: { x: comX, y: comY },
    linvel: { x: mass > 0 ? pX / mass : 0, y: mass > 0 ? pY / mass : 0 },
    angvel: I > 0 ? L / I : 0,
    mass,
    inertia: I,
  };
}

/**
 * Pro každý pixel komponenty 4 strany; vyřaď ty, které jsou shared s jiným členem
 * (anchor jointu padl na tuto stranu — dominantní složka anchor v lokálním frame
 * určuje, kterou stranu maskuje). Vrací zbylé volné hrany v world coords.
 */
export function freeEdges(composite: Composite, world: World): FreeEdge[] {
  const memberSet = new Set(composite.members);
  const edges: FreeEdge[] = [];

  // Lokální anchor středy 4 stran pixelu.
  const directions: { dx: number; dy: number; dir: 0 | 1 | 2 | 3 }[] = [
    { dx: +0.5, dy: 0, dir: 0 },
    { dx: -0.5, dy: 0, dir: 1 },
    { dx: 0, dy: +0.5, dir: 2 },
    { dx: 0, dy: -0.5, dir: 3 },
  ];

  for (const p of composite.members) {
    const t = p.body.translation();
    const r = p.body.rotation();
    const cosR = Math.cos(r);
    const sinR = Math.sin(r);

    for (const { dx, dy, dir } of directions) {
      if (isSharedEdge(p, dx, dy, world.joints, memberSet)) continue;

      // Lokální střed edge → world.
      const exLocal = dx;
      const eyLocal = dy;
      const exWorld = exLocal * cosR - eyLocal * sinR + t.x;
      const eyWorld = exLocal * sinR + eyLocal * cosR + t.y;

      // Lokální tangenta (kolmice na anchor směr): pro +X edge je to (0, 1), atd.
      // Délka 0.5 U na každou stranu (edge je segment 1 U).
      const tangLocalX = -dy;
      const tangLocalY = dx;
      const tangWorldX = tangLocalX * cosR - tangLocalY * sinR;
      const tangWorldY = tangLocalX * sinR + tangLocalY * cosR;

      edges.push({
        pixel: p,
        dir,
        p1: { x: exWorld - tangWorldX, y: eyWorld - tangWorldY },
        p2: { x: exWorld + tangWorldX, y: eyWorld + tangWorldY },
      });
    }
  }
  return edges;
}

function isSharedEdge(
  p: Pixel,
  dx: number,
  dy: number,
  joints: Joint[],
  memberSet: Set<Pixel>,
): boolean {
  for (const j of joints) {
    const isA = j.a === p;
    const isB = j.b === p;
    if (!isA && !isB) continue;
    const other = isA ? j.b : j.a;
    if (!memberSet.has(other)) continue;
    const anchor = isA ? j.anchorA : j.anchorB;
    // Anchor má dominantní složku ve směru (dx, dy)?
    if (dx > 0 && anchor.x > Math.abs(anchor.y)) return true;
    if (dx < 0 && anchor.x < -Math.abs(anchor.y)) return true;
    if (dy > 0 && anchor.y > Math.abs(anchor.x)) return true;
    if (dy < 0 && anchor.y < -Math.abs(anchor.x)) return true;
  }
  return false;
}

/**
 * Min distance mezi dvěma line segments v 2D. Standardní algoritmus
 * (Christer Ericson, "Real-Time Collision Detection", §5.1.9).
 */
function segmentDistance(
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number },
): number {
  const dax = a2.x - a1.x;
  const day = a2.y - a1.y;
  const dbx = b2.x - b1.x;
  const dby = b2.y - b1.y;
  const dcx = a1.x - b1.x;
  const dcy = a1.y - b1.y;
  const a = dax * dax + day * day;
  const e = dbx * dbx + dby * dby;
  const f = dbx * dcx + dby * dcy;

  let s: number;
  let t: number;
  const EPS = 1e-9;

  if (a <= EPS && e <= EPS) {
    return Math.hypot(dcx, dcy);
  }
  if (a <= EPS) {
    s = 0;
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = dax * dcx + day * dcy;
    if (e <= EPS) {
      t = 0;
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = dax * dbx + day * dby;
      const denom = a * e - b * b;
      s = denom !== 0 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }

  const px = a1.x + dax * s;
  const py = a1.y + day * s;
  const qx = b1.x + dbx * t;
  const qy = b1.y + dby * t;
  return Math.hypot(px - qx, py - qy);
}

/**
 * Najdi merge kandidáty mezi všemi páry komponent. Pro každý pár vrátí nejbližší
 * dvojici volných hran (pokud je v threshold). O(C² · E²) kde C je počet
 * komponent a E max počet volných hran per komponenta — v současné fázi je
 * acceptable (display tick 5 Hz, malá N).
 */
export function detectMergeCandidates(
  world: World,
  composites: Composite[],
  threshold: number,
): MergeCandidate[] {
  const candidates: MergeCandidate[] = [];
  const edgesPerComp = composites.map((c) => freeEdges(c, world));

  for (let i = 0; i < composites.length; i++) {
    for (let j = i + 1; j < composites.length; j++) {
      const compA = composites[i]!;
      const compB = composites[j]!;
      const edgesA = edgesPerComp[i]!;
      const edgesB = edgesPerComp[j]!;

      let best: MergeCandidate | null = null;
      for (const edgeA of edgesA) {
        for (const edgeB of edgesB) {
          const d = segmentDistance(edgeA.p1, edgeA.p2, edgeB.p1, edgeB.p2);
          if (d < threshold && (best === null || d < best.distance)) {
            best = { compA, compB, edgeA, edgeB, distance: d };
          }
        }
      }
      if (best) candidates.push(best);
    }
  }
  return candidates;
}

/**
 * Stage 2 — inelastic merge math + FixedJoint create.
 *
 * Spočítá nový aggregate state pro union compA ∪ compB tak, aby se zachovaly
 * ∑P a ∑L (KE klesne o relativní část — to je inelastic ztráta, ve fázi 4+ s
 * pružnými spring jointy by se rozetřela do vibrace). Pak snap všech členů na
 * rigid-body kinematics kolem nového CoM (linvel = V + ω × r, angvel = ω) a
 * vytvoří FixedJoint mezi candidate edge pair, který bude budoucí pohyb držet.
 *
 *   M_new      = M_A + M_B
 *   CoM_new    = (M_A·CoM_A + M_B·CoM_B) / M_new
 *   V_new      = (M_A·V_A + M_B·V_B) / M_new                    (∑P preserved)
 *   L_total    = Σ_X { I_X·ω_X + M_X·(r_X × v_X_rel) }          kde r_X = CoM_X − CoM_new
 *   I_new      = Σ_X { I_X + M_X·|r_X|² }                       (parallel axis)
 *   ω_new      = L_total / I_new                                (∑L preserved)
 *
 * Skip pokud kterákoliv strana obsahuje pinned pixel — pinned je ∞ mass
 * conceptuálně a snap na rigid-body kinematics by ho rozhýbal. Vrací `true`,
 * pokud merge proběhl, `false` jinak.
 */
export function applyMerge(world: World, candidate: MergeCandidate): boolean {
  const compA = candidate.compA;
  const compB = candidate.compB;

  for (const p of compA.members) if (p.pinned) return false;
  for (const p of compB.members) if (p.pinned) return false;

  const M = compA.mass + compB.mass;
  if (M <= 0) return false;

  const cx = (compA.mass * compA.com.x + compB.mass * compB.com.x) / M;
  const cy = (compA.mass * compA.com.y + compB.mass * compB.com.y) / M;
  const Vx = (compA.mass * compA.linvel.x + compB.mass * compB.linvel.x) / M;
  const Vy = (compA.mass * compA.linvel.y + compB.mass * compB.linvel.y) / M;

  const rAx = compA.com.x - cx;
  const rAy = compA.com.y - cy;
  const vArelX = compA.linvel.x - Vx;
  const vArelY = compA.linvel.y - Vy;
  const LA = compA.angvel * compA.inertia + compA.mass * (rAx * vArelY - rAy * vArelX);

  const rBx = compB.com.x - cx;
  const rBy = compB.com.y - cy;
  const vBrelX = compB.linvel.x - Vx;
  const vBrelY = compB.linvel.y - Vy;
  const LB = compB.angvel * compB.inertia + compB.mass * (rBx * vBrelY - rBy * vBrelX);

  const L = LA + LB;
  const IA_new = compA.inertia + compA.mass * (rAx * rAx + rAy * rAy);
  const IB_new = compB.inertia + compB.mass * (rBx * rBx + rBy * rBy);
  const I = IA_new + IB_new;
  const omega = I > 0 ? L / I : 0;

  // Rigid-body snap: linvel = V + ω × r_pixel_z_CoM, angvel = ω.
  // V 2D je ω × r = ω · (-ry, rx).
  const apply = (p: Pixel): void => {
    const t = p.body.translation();
    const rx = t.x - cx;
    const ry = t.y - cy;
    p.body.setLinvel({ x: Vx - omega * ry, y: Vy + omega * rx }, true);
    p.body.setAngvel(omega, true);
  };
  for (const p of compA.members) apply(p);
  for (const p of compB.members) apply(p);

  // Binding constraint pro budoucí pohyb. Idempotent guard v createFixedJoint
  // pokrývá situaci, kdy auto-joint už mezitím joint vytvořil (kontakt v dosahu
  // threshold zároveň znamená kontakt brzy → Started event mohl projet dřív).
  createFixedJoint(world, candidate.edgeA.pixel, candidate.edgeB.pixel, false);

  return true;
}

/**
 * Stage 3 MVP — composite-driven kinematics pro `align` mode.
 *
 * **Voláno PO `Rapier.step()`** — Rapier už integroval pos = pos_old + linvel·dt
 * (drift) a joint solver konvergoval (přibližně rigidní geometrie). Aggregate state
 * (CoM, V, ω) je rigid body invariant: ∑P/∑L preserved joint solverem (internal
 * impulses jsou Newton-3 reciprocal). Tato funkce override pos/rot/linvel/angvel
 * tak, aby geometrie byla **přesně** rigidní podle uložených offsetů — odstraňuje
 * solver imperfection drift, který v dlouhých simulacích narušuje slepenec.
 *
 *   pos_i  = CoM_aggregate + R(θ)·offset_i_local
 *   rot_i  = θ                (= members[0].rotation, joint solver synchronizoval)
 *   vel_i  = V_aggregate + ω_aggregate × r_i_world
 *   rs_i   = ω_aggregate
 *
 * Offsets jsou stable (set v `createFixedJoint(align=true)` při změně topologie).
 * Geometrie zůstává invariant napříč ticky → žádný drift / overlap z imperfect
 * joint solveru.
 *
 * Singleton composites (1 pixel) jsou skipnuty — Rapier je integruje normálně.
 * Pinned composites jsou skipnuty (∞ mass, override by ho rozhýbal).
 *
 * **Pozn.:** s `lockRotations(true)` v align mode (S11 default) θ se nemění
 * Rapier integrací, c.angvel je effectively 0 → composite jen translates (S11
 * behavior). Stage 3 přidaná hodnota: rigidní translace je teď enforced (žádný
 * inter-pixel drift), ne závislá na joint solver konvergenci.
 */
export function stepCompositesAlign(world: World): void {
  const composites = buildComposites(world);
  for (const c of composites) {
    if (c.members.length < 2) continue;
    if (c.members.some((p) => p.pinned)) continue;

    const theta = c.members[0]!.body.rotation();
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);

    for (const p of c.members) {
      const ox = p.compositeOffsetX ?? 0;
      const oy = p.compositeOffsetY ?? 0;
      // World offset po rotaci o θ.
      const rxWorld = cosT * ox - sinT * oy;
      const ryWorld = sinT * ox + cosT * oy;
      const px = c.com.x + rxWorld;
      const py = c.com.y + ryWorld;
      p.body.setTranslation({ x: px, y: py }, true);
      p.body.setRotation(theta, true);
      // Linvel rigidního bodu na pozici r: V + ω × r (v 2D perp = (-ry, rx)·ω).
      p.body.setLinvel(
        { x: c.linvel.x - c.angvel * ryWorld, y: c.linvel.y + c.angvel * rxWorld },
        true,
      );
      p.body.setAngvel(c.angvel, true);
    }
  }
}
