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
