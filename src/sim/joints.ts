// Joint API — wrapper kolem Rapier ImpulseJoint.
//
// Fáze 3 entry: FixedJoint mezi dvěma pixely svaří jejich relativní polohu i orientaci,
// takže pár se chová jako jedno rigid těleso. Až přijdou kontakty + automatická detekce
// "dotyku po straně" (TODO), jointy se budou tvořit při kolizi; zatím je create/remove
// volaný explicitně (preset, manuální tlačítko).
//
// Anchor = midpoint mezi centry obou pixelů. Pro pixely s centry 1 U od sebe (edge-to-edge
// touching) anchor leží přesně na sdílené hraně; pro vzdálenější pixely anchor zůstává
// uprostřed segmentu mezi centry — geometricky weird (anchor mimo obě tělesa) ale fyzikálně
// OK, jen joint pole z obou tělas směřují k jednomu bodu v prostoru. Pro fázi 3 nás zajímají
// touching páry, takže midpoint je správná abstrakce.

import RAPIER from '@dimforge/rapier2d-compat';
import type { Pixel } from '../types';
import type { World } from './physics';
import { playClick } from '../audio/sfx';

let nextJointId = 0;

export type Joint = {
  id: number;
  a: Pixel;
  b: Pixel;
  /** Anchor v lokálním frame pixelu A (rotace pixelu se aplikuje sama). */
  anchorA: { x: number; y: number };
  /** Anchor v lokálním frame pixelu B. */
  anchorB: { x: number; y: number };
  rapier: RAPIER.ImpulseJoint;
  /**
   * `primary` = joint který vznikl z přímého triggeru (manual connect, contact event,
   * magnet merge). `secondary` = joint dodatečně vytvořený `detectSecondaryJoints` po
   * úspěšné merge na základě edge-touching geometrie v rámci nově unified komponenty
   * (sezení 16 — fix růstu jen po jedné ose). Kind je interní tracking, render je
   * stejný pro oba.
   */
  kind: 'primary' | 'secondary';
};

/**
 * Vytvoří FixedJoint mezi dvěma pixely.
 *
 * **Default (`align=false`)** = "not-align": anchor padne na midpoint mezi centry,
 * transformovaný do lokálního frame každého pixelu. Pro pixely 1 U od sebe a r=0 to je
 * sdílená hrana; pro natočené nebo distantní pixely je anchor v rotated frame.
 * Physics dynamics konzistentní (slepenec pruží/kmitá).
 *
 * **`align=true`**: rigid-transform menšího řetězce na host frame (Stage 3.1):
 *   - **fresh-fresh** (oba singletony): snap r=0, rs=0 na obou; symmetric pos snap
 *     kolem midpointu (centroid preserved); edge anchor ±0.5.
 *   - **fresh+chain**: fresh pixel rigid-transformován tak, že leží na 1 U od chain
 *     pixelu v dominantní ose **chain local frame** (chain rotation respected).
 *   - **chain+chain**: menší řetězec rigid-transformován **celý** (rotace o Δθ kolem
 *     guest_pixel.pos + translace) tak, aby host_pixel ↔ guest_pixel byly edge-touching
 *     v host frame. Internal joint anchory guest pixelů jsou v body local frames →
 *     po rigid transformu zůstávají platné. ∑P preserved (V_unified = ∑P/M_total),
 *     ω = 0 (angular momentum loss explicitní, consistent s align paradigmem).
 *   - **same component** (a, b spojené nepřímo): geometry preserve, edge anchor v
 *     a-local frame z current world delta. Žádný rigid-transform (re-procesoval
 *     by stejnou komponentu).
 *   - Po vložení jointu vždy `recomputeCompositeOffsets` pro celou nově unified
 *     komponentu (Stage 3 sets compositeOffsetX/Y, Stage 3.2 sets compositeTheta).
 *     `lockRotations` se NEPOUŽÍVÁ — composite rotation je řízena manuálně přes
 *     `stepCompositesAlign` (theta_new = theta_old + ω·dt → setRotation pro všechny).
 *
 * **Idempotent**: pokud už joint mezi týmiž pixely existuje (v libovolném pořadí a/b),
 * vrátí ho bez side-effects (žádný click, žádný snap, žádná Rapier insertion).
 *
 * **Same-component v align mode** (a, b spojené nepřímo přes řetězec dalších jointů):
 * vrací `null` a nic nevytváří. Důvod: ±0.5 anchory by skončily v world pozicích posunutých
 * o `(|dxL|−1) U` (a-local frame), pokud a a b nejsou edge-touching. Solver pak iteruje
 * proti existujícím chain anchorům → composite vystřelí. Auto-joint má duplicate filtr
 * v `autoJointAlign` (nikdy nezavolá createFixedJoint pro same-component pair). Manuální
 * volání `connect()` z presetu se týká fresh pairs (initial wire-up) — same-component
 * je tam edge case a no-op je správnější než broken joint.
 *
 * Zvuk: playClick() jen při skutečném create.
 */
export function createFixedJoint(world: World, a: Pixel, b: Pixel, align: boolean = false): Joint | null {
  // Duplicate guard — single source of truth, ať volá auto-joint i manual call.
  // O(J) lineární scan; pro typické J<100 je to zanedbatelné.
  for (const existing of world.joints) {
    if (
      (existing.a === a && existing.b === b) ||
      (existing.a === b && existing.b === a)
    ) {
      return existing;
    }
  }

  // Stage 3.1 — sjednocený align flow přes rigid-transform celého guest řetězce.
  // Místo destruktivního setRotation(0) na (a,b), které lámalo internal joint anchory
  // existujících chainů, rotujeme/translatujeme **celý menší řetězec** rigidně tak,
  // aby se zarovnal s host frame. Internal joint anchory v body local frames zůstávají
  // platné — world pozice anchorů se otočí společně s bodies.
  //
  // Konvence:
  //   - host = větší řetězec (více členů); pokud equal, vyhrává `a`-strana.
  //   - guest = menší řetězec; rotuje + translatuje, aby host_pixel ↔ guest_pixel byly
  //     edge-touching (1 U v dominantní ose host local frame).
  //   - hostθ: pokud host je singleton (fresh pixel), force 0 (preserve grid-aligned
  //     UX z fresh-fresh režimu). Pro multi-pixel host použij currentní rotation
  //     (chrání chain rotation z stepCompositesAlign).
  //   - Velocities: V_unified = (∑P_A + ∑P_B)/M (∑P preserved), ω = 0 (consistent
  //     s align destruktivním paradigm — angular momentum loss explicitní).
  //
  // Edge case "both pixels in same component" je odchycen duplicate guard nahoře.
  let alignXAxis = false;
  let alignSign = 1;
  if (align) {
    const chainA = collectComponent(world, a);
    const chainB = collectComponent(world, b);

    if (chainA.includes(b)) {
      // Same component (a, b spojené nepřímo přes řetězec dalších jointů) — pridání
      // dalšího ±0.5 jointu by vytvořilo broken constraint, pokud a a b nejsou
      // edge-touching v dominantní ose host frame (typicky |dxL|>1 → world anchor
      // mismatch ≈ |dxL|−1 U). Solver pak iteruje proti existujícím chain anchorům
      // → composite vystřelí (pozorováno v E14 modelshotu po S13).
      // Skip create úplně, vrať null — caller by měl ignore (auto-joint má vlastní
      // filtr v autoJointAlign, manual connect z presetu se týká fresh pairs).
      return null;
    } else if (chainA.length === 1 && chainB.length === 1) {
      // Fresh-fresh: symmetric snap kolem midpointu (centroid preserved, ∑P = 0
      // pro nehybný pár). Behavior beze změny od S11 implementace.
      a.body.setRotation(0, true);
      b.body.setRotation(0, true);
      a.body.setAngvel(0, true);
      b.body.setAngvel(0, true);

      const ta0 = a.body.translation();
      const tb0 = b.body.translation();
      const dxN = tb0.x - ta0.x;
      const dyN = tb0.y - ta0.y;
      const xAxis = Math.abs(dxN) >= Math.abs(dyN);
      const sign = xAxis ? (dxN >= 0 ? 1 : -1) : (dyN >= 0 ? 1 : -1);
      const mx = (ta0.x + tb0.x) / 2;
      const my = (ta0.y + tb0.y) / 2;
      if (xAxis) {
        a.body.setTranslation({ x: mx - 0.5 * sign, y: my }, true);
        b.body.setTranslation({ x: mx + 0.5 * sign, y: my }, true);
      } else {
        a.body.setTranslation({ x: mx, y: my - 0.5 * sign }, true);
        b.body.setTranslation({ x: mx, y: my + 0.5 * sign }, true);
      }
      alignXAxis = xAxis;
      alignSign = sign;
    } else {
      // Multi-chain (alespoň jeden chain m≥2). Manual `connect()` z presetu volí
      // dirs přes dominant-axis heuristiku (R(−hostθ)·(guestPos−hostPos)) s
      // occupied-edge filterem; auto-joint má vlastní pickování přes
      // `findBestJointPair` v `autoJointAlign` (full enumeration). Obě cesty
      // delegují na sdílené `joinAlignedExplicit`.
      const aIsHost = chainA.length >= chainB.length;
      const hostChain = aIsHost ? chainA : chainB;
      const hostPixel = aIsHost ? a : b;
      const guestPixel = aIsHost ? b : a;

      // Host theta pro projekci. Fresh singleton (fresh+chain) ještě není v
      // joinAlignedExplicit nasnapnut, ale dxL/dyL z aktuální rotace jsou OK
      // (singleton má θ ≈ 0 typicky; pokud ne, dominant-axis filter to vyřeší).
      const hostTheta = hostChain.length === 1 ? 0 : hostPixel.body.rotation();
      const hostPos = hostPixel.body.translation();
      const guestPos = guestPixel.body.translation();

      // Direction host→guest v host local frame.
      const cosT = Math.cos(hostTheta);
      const sinT = Math.sin(hostTheta);
      const dxW = guestPos.x - hostPos.x;
      const dyW = guestPos.y - hostPos.y;
      const dxL = cosT * dxW + sinT * dyW;
      const dyL = -sinT * dxW + cosT * dyW;

      const hostOccupied = occupiedDirs(world, hostPixel);
      const guestOccupied = occupiedDirs(world, guestPixel);
      const dirCandidates: { key: DirKey; score: number }[] = [
        { key: 'PX', score:  dxL },
        { key: 'NX', score: -dxL },
        { key: 'PY', score:  dyL },
        { key: 'NY', score: -dyL },
      ];
      dirCandidates.sort((x, y) => y.score - x.score);
      let chosen = dirCandidates.find(
        (c) => !hostOccupied.has(c.key) && !guestOccupied.has(DIR_OPPOSITE[c.key]),
      );
      if (!chosen) chosen = dirCandidates[0]!;
      const hostDir = chosen.key;
      const guestDir = DIR_OPPOSITE[hostDir];
      return joinAlignedExplicit(world, hostPixel, hostDir, guestPixel, guestDir);
    }
  }

  const ta = a.body.translation();
  const tb = b.body.translation();
  const ra = a.body.rotation();
  const rb = b.body.rotation();

  let anchorA: { x: number; y: number };
  let anchorB: { x: number; y: number };

  if (align) {
    // Edge anchor v local frame. Po rigid-transformu jsou oba pixely v hostθ;
    // alignSign + alignXAxis pochází z host local frame (s polaritou flip pokud b=host).
    if (alignXAxis) {
      anchorA = { x: 0.5 * alignSign, y: 0 };
      anchorB = { x: -0.5 * alignSign, y: 0 };
    } else {
      anchorA = { x: 0, y: 0.5 * alignSign };
      anchorB = { x: 0, y: -0.5 * alignSign };
    }
  } else {
    // Not-align: midpoint anchor v lokálním frame přes inverzi rotace.
    const mx = (ta.x + tb.x) / 2;
    const my = (ta.y + tb.y) / 2;
    const dxA = mx - ta.x;
    const dyA = my - ta.y;
    const cA = Math.cos(-ra);
    const sA = Math.sin(-ra);
    anchorA = { x: cA * dxA - sA * dyA, y: sA * dxA + cA * dyA };

    const dxB = mx - tb.x;
    const dyB = my - tb.y;
    const cB = Math.cos(-rb);
    const sB = Math.sin(-rb);
    anchorB = { x: cB * dxB - sB * dyB, y: sB * dxB + cB * dyB };
  }

  // RAPIER.JointData.fixed(anchor1, frame1, anchor2, frame2): constraint je
  //   r_A + frame1 == r_B + frame2 (v world).
  // Pro align je rb-ra=0 (oba snapped na 0). Pro not-align se preserve current relative
  // orientation: frame1 = r_B − r_A, frame2 = 0.
  const data = RAPIER.JointData.fixed(anchorA, rb - ra, anchorB, 0);
  const rapier = world.rapier.createImpulseJoint(data, a.body, b.body, true);
  // Vypni contacts mezi joined bodies. Default Rapieru contacts dual-řeší (joint
  // pos constraint + narrow-phase contact normal) a navzájem si škvaří energii —
  // sezení 10 E3 drift -11.5% vs sezení 8 baseline 0.03% při zapnutí collisionGroups.
  // Pro lepené pixely je joint **jediná** autorita nad relativní pozicí.
  // Cast — rapier 2D-compat má `setContactsEnabled` na ImpulseJoint, ale typ vrací
  // `unknown` v některých helper signaturách; přístup přes RAPIER.ImpulseJoint je v pořádku.
  rapier.setContactsEnabled(false);

  const joint: Joint = { id: nextJointId++, a, b, anchorA, anchorB, rapier, kind: 'primary' };
  world.joints.push(joint);
  playClick();

  // Stage 3 (composite-driven kinematics v align mode): po rigid-transformu a vložení
  // jointu recompute offsets pro celou nově joined komponentu. Offset = R(-θ)·(pos − CoM)
  // v composite frame; θ = a.body.rotation() (po Stage 3.1 rigid transformu jsou všichni
  // members nově unified komponenty na hostθ, takže θ je konzistentní napříč members).
  // V `not-align` mode offsety nepoužíváme — necháváme null (Stage 3 stepCompositesAlign
  // je no-op pro `not-align`).
  if (align) {
    recomputeCompositeOffsets(world, a);
  }

  return joint;
}

/**
 * Auto-joint v `align` modu pro contact event mezi dvěma pixely. Řeší:
 *
 * 1. **Same-component filter** — Rapier narrow-phase generuje contact eventy pro
 *    všechny AABB-overlapping páry. Po prvním cross-component merge jsou další
 *    eventy "same component"; `joinAlignedExplicit` by skončil na broken constraint.
 *
 * 2. **Free-edge picking** (sezení 16 — fix snake-growth) — místo pickování
 *    endpoint pixelů se enumerují **všechny volné hrany** všech pixelů obou chainů
 *    a vyhrává pár (host, guest) s nejnižším skóre `|hostMid−bPos| + |guestMid−aPos|`.
 *    Constraint guestDir = opposite(hostDir) (Δθ rotace zarovnává guest local s host).
 *
 *    Předchozí endpoint-only přístup (S14) způsoboval, že chainy rostly **pouze do
 *    délky** (snake) — pixel z boku chainu se přilepil na konec, ne na bok. Full
 *    enumeration umožňuje růst do šířky (T-jointy, plné 2D shape).
 *
 *    Fresh-fresh (oba singletony) je předáno na `createFixedJoint(a, b, true)`,
 *    který má symmetric snap kolem midpointu (jiná sémantika než asymmetric guest
 *    rigid-transform v `joinAlignedExplicit`).
 */
export function autoJointAlign(world: World, a: Pixel, b: Pixel): Joint | null {
  const chainA = collectComponent(world, a);
  const chainB = collectComponent(world, b);

  // Filter 1: same component
  if (chainA.includes(b)) return null;

  // Fresh-fresh: deleguj na createFixedJoint(true) (symmetric snap path).
  if (chainA.length === 1 && chainB.length === 1) {
    return createFixedJoint(world, a, b, true);
  }

  // Filter 2: full enumeration všech volných hran obou chainů.
  const aPos = a.body.translation();
  const bPos = b.body.translation();
  const pair = findBestJointPair(world, chainA, chainB, aPos, bPos);
  if (!pair) return null;
  return joinAlignedExplicit(world, pair.hostPx, pair.hostDir, pair.guestPx, pair.guestDir);
}

/**
 * BFS po jointech najde všechny pixely v komponentě obsahující `seed`. Použito po
 * createFixedJoint(align=true) pro recompute compositeOffsetX/Y po změně topologie.
 */
function collectComponent(world: World, seed: Pixel): Pixel[] {
  const visited = new Set<Pixel>();
  visited.add(seed);
  const queue: Pixel[] = [seed];
  while (queue.length > 0) {
    const p = queue.shift()!;
    for (const j of world.joints) {
      const other = j.a === p ? j.b : j.b === p ? j.a : null;
      if (other && !visited.has(other)) {
        visited.add(other);
        queue.push(other);
      }
    }
  }
  return [...visited];
}

/**
 * Recompute composite frame state pro všechny členy komponenty obsahující `seed`. Volat
 * po změně topologie (nový joint v align mode, magnet merge).
 *
 * Stage 3: `compositeOffsetX/Y` (local offset v composite frame).
 * Stage 3.2: `compositeTheta` (rotace, sdílená všemi members; `stepCompositesAlign`
 * ji per-tick driveuje přes ω·dt).
 *
 * Singleton (1 člen) → všechny tři pole null.
 *
 * Frame: θ_init = `seed.body.rotation()` v okamžik volání (po Stage 3.1 rigid-transform
 * jsou všichni members na hostθ). Offset = R(−θ_init)·(pos − CoM).
 */
function recomputeCompositeOffsets(world: World, seed: Pixel): void {
  const members = collectComponent(world, seed);
  if (members.length < 2) {
    seed.compositeOffsetX = null;
    seed.compositeOffsetY = null;
    seed.compositeTheta = null;
    return;
  }

  let M = 0;
  let cx = 0;
  let cy = 0;
  for (const p of members) {
    const t = p.body.translation();
    M += p.m;
    cx += p.m * t.x;
    cy += p.m * t.y;
  }
  if (M <= 0) return;
  cx /= M;
  cy /= M;

  const theta = seed.body.rotation();
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  for (const p of members) {
    const t = p.body.translation();
    const dx = t.x - cx;
    const dy = t.y - cy;
    p.compositeOffsetX = cosT * dx + sinT * dy;
    p.compositeOffsetY = -sinT * dx + cosT * dy;
    p.compositeTheta = theta;
  }
}

/**
 * Odstraní joint ze světa. Zvuk: playClick() při break.
 */
export function removeJoint(world: World, joint: Joint): void {
  world.rapier.removeImpulseJoint(joint.rapier, true);
  const idx = world.joints.indexOf(joint);
  if (idx >= 0) world.joints.splice(idx, 1);
  playClick();
}

/**
 * Direction encoding pro 4 strany pixelu v local frame:
 * 'PX'=+X (vpravo), 'NX'=−X, 'PY'=+Y (dolů ve screen-space, ale matematicky +Y), 'NY'=−Y.
 * Sezení 16 zavedeno pro free-edge enumeration v auto-join cestě (snake-growth fix).
 */
type DirKey = 'PX' | 'NX' | 'PY' | 'NY';
const DIR_LIST: readonly DirKey[] = ['PX', 'NX', 'PY', 'NY'];
const DIR_OPPOSITE: Record<DirKey, DirKey> = { PX: 'NX', NX: 'PX', PY: 'NY', NY: 'PY' };

/** Anchor offset (±0.5) v local frame pro daný směr. */
function dirAnchor(d: DirKey): { x: number; y: number } {
  if (d === 'PX') return { x: 0.5, y: 0 };
  if (d === 'NX') return { x: -0.5, y: 0 };
  if (d === 'PY') return { x: 0, y: 0.5 };
  return { x: 0, y: -0.5 };
}

/**
 * Spočítá occupied dirs `pixel`u v jeho local frame z anchorů existujících jointů.
 * Dominantní složka anchoru (|x| vs |y|, znaménko) určuje, kterou stranu pixelu joint
 * okupuje. Použito v `createFixedJoint(align=true)` pro filter free dirs.
 */
function occupiedDirs(world: World, pixel: Pixel): Set<DirKey> {
  const occupied = new Set<DirKey>();
  for (const j of world.joints) {
    let anchor: { x: number; y: number } | null = null;
    if (j.a === pixel) anchor = j.anchorA;
    else if (j.b === pixel) anchor = j.anchorB;
    if (!anchor) continue;
    const ax = anchor.x;
    const ay = anchor.y;
    if (ax > Math.abs(ay)) occupied.add('PX');
    else if (ax < -Math.abs(ay)) occupied.add('NX');
    else if (ay > Math.abs(ax)) occupied.add('PY');
    else if (ay < -Math.abs(ax)) occupied.add('NY');
  }
  return occupied;
}

/**
 * Volné směry pixelu = doplněk occupied dirs do {PX, NX, PY, NY}.
 */
function freeDirs(world: World, pixel: Pixel): DirKey[] {
  const occupied = occupiedDirs(world, pixel);
  return DIR_LIST.filter((d) => !occupied.has(d));
}

/**
 * Enumeruj všechny volné hrany všech pixelů v chainu, vrať jejich world midpointy
 * (pro merge candidate scoring v `findBestJointPair`). Midpoint = pixel center +
 * R(θ_pixel)·dirAnchor(dir).
 */
function enumerateChainFreeEdges(
  world: World,
  chain: Pixel[],
): { px: Pixel; dir: DirKey; midX: number; midY: number }[] {
  const edges: { px: Pixel; dir: DirKey; midX: number; midY: number }[] = [];
  for (const px of chain) {
    const t = px.body.translation();
    const r = px.body.rotation();
    const cosR = Math.cos(r);
    const sinR = Math.sin(r);
    for (const d of freeDirs(world, px)) {
      const a = dirAnchor(d);
      const midX = t.x + cosR * a.x - sinR * a.y;
      const midY = t.y + sinR * a.x + cosR * a.y;
      edges.push({ px, dir: d, midX, midY });
    }
  }
  return edges;
}

/**
 * Sezení 16 — full enumeration všech volných hran obou chainů, vyhrává pár (host, guest)
 * s nejnižším součtem vzdáleností edge midpointů ke kontaktnímu páru. Constraint:
 * `guestDir = opposite(hostDir)` — Δθ rotace v `joinAlignedExplicit` zarovnává guest
 * local frame s host's, takže edges si musí stát opačně v shared local frame.
 *
 * Důvod proč ne jen "closest endpoint" jako v S14: kontakt může nastat mezi vnitřními
 * pixely chainů; pak nejlepší free edge nemusí být na endpointu. Bez tohoto filteru
 * řetězce rostly **pouze do délky** (snake-growth), nikdy ne do šířky.
 *
 * Time complexity: O(|chainA|·|chainB|·16). Pro current N (typicky < 100) zanedbatelné.
 */
function findBestJointPair(
  world: World,
  chainA: Pixel[],
  chainB: Pixel[],
  aPos: { x: number; y: number },
  bPos: { x: number; y: number },
): { hostPx: Pixel; hostDir: DirKey; guestPx: Pixel; guestDir: DirKey } | null {
  const aEdges = enumerateChainFreeEdges(world, chainA);
  const bEdges = enumerateChainFreeEdges(world, chainB);
  if (aEdges.length === 0 || bEdges.length === 0) return null;

  let best: { hostPx: Pixel; hostDir: DirKey; guestPx: Pixel; guestDir: DirKey } | null = null;
  let bestScore = Infinity;
  for (const eA of aEdges) {
    const requiredB = DIR_OPPOSITE[eA.dir];
    for (const eB of bEdges) {
      if (eB.dir !== requiredB) continue;
      const dA = Math.hypot(eA.midX - bPos.x, eA.midY - bPos.y);
      const dB = Math.hypot(eB.midX - aPos.x, eB.midY - aPos.y);
      const score = dA + dB;
      if (score < bestScore) {
        bestScore = score;
        best = { hostPx: eA.px, hostDir: eA.dir, guestPx: eB.px, guestDir: eB.dir };
      }
    }
  }
  return best;
}

/**
 * Sdílený rigid-transform + joint creation pro `align` mode multi-chain merge.
 *
 * Předpoklady (caller je musí dodržet):
 *   - `hostPx` a `guestPx` nejsou ve stejné komponentě.
 *   - `guestDir = DIR_OPPOSITE[hostDir]` — edge anchory na opačných stranách v shared
 *     local frame po Δθ rotaci.
 *   - Pokud je host singleton (fresh pixel), funkce force `hostθ = 0` (preserve
 *     grid-aligned UX). Pro multi-pixel host se použije currentní rotation.
 *
 * Provede:
 *   1. Rigid transform celého guestChain = rotace o Δθ kolem `guestPx` + translate na
 *      `hostPos + R(hostθ)·(2·dirAnchor(hostDir))`. Internal joint anchory v body
 *      local frames zůstávají platné (rotují s těly).
 *   2. Velocity unification — V_unified = ∑P/M (∑P preserved), ω = 0 (angular momentum
 *      loss explicit, consistent s align destruktivním paradigm).
 *   3. Vytvoří FixedJoint s anchorA = `dirAnchor(hostDir)` a anchorB = `dirAnchor(guestDir)`
 *      (v body local frames).
 *   4. `recomputeCompositeOffsets` pro celou nově unified komponentu.
 */
function joinAlignedExplicit(
  world: World,
  hostPx: Pixel,
  hostDir: DirKey,
  guestPx: Pixel,
  guestDir: DirKey,
): Joint {
  const hostChain = collectComponent(world, hostPx);
  const guestChain = collectComponent(world, guestPx);

  let hostTheta = hostPx.body.rotation();
  if (hostChain.length === 1) {
    hostTheta = 0;
    hostPx.body.setRotation(0, true);
  }

  const hostPos = hostPx.body.translation();
  const guestPos = guestPx.body.translation();

  // Target guest pos: hostPos + R(hostθ)·(2·dirAnchor(hostDir)).
  // 2·dirAnchor(±X) = (±1, 0); 2·dirAnchor(±Y) = (0, ±1).
  const ha = dirAnchor(hostDir);
  const cosT = Math.cos(hostTheta);
  const sinT = Math.sin(hostTheta);
  const targetGuestX = hostPos.x + cosT * 2 * ha.x - sinT * 2 * ha.y;
  const targetGuestY = hostPos.y + sinT * 2 * ha.x + cosT * 2 * ha.y;

  // Rigid transform guest chain: rotace o Δθ kolem guestPos, pak translate.
  const guestTheta = guestPx.body.rotation();
  const dTheta = hostTheta - guestTheta;
  const cosDT = Math.cos(dTheta);
  const sinDT = Math.sin(dTheta);
  const Tx = targetGuestX - guestPos.x;
  const Ty = targetGuestY - guestPos.y;

  for (const p of guestChain) {
    const pt = p.body.translation();
    const rx = pt.x - guestPos.x;
    const ry = pt.y - guestPos.y;
    const newX = guestPos.x + cosDT * rx - sinDT * ry + Tx;
    const newY = guestPos.y + sinDT * rx + cosDT * ry + Ty;
    p.body.setTranslation({ x: newX, y: newY }, true);
    p.body.setRotation(p.body.rotation() + dTheta, true);
  }

  // Velocity unification — ∑P preserved, ω = 0.
  let M = 0;
  let pXsum = 0;
  let pYsum = 0;
  for (const p of hostChain) {
    const v = p.body.linvel();
    M += p.m;
    pXsum += p.m * v.x;
    pYsum += p.m * v.y;
  }
  for (const p of guestChain) {
    const v = p.body.linvel();
    M += p.m;
    pXsum += p.m * v.x;
    pYsum += p.m * v.y;
  }
  const Vx = M > 0 ? pXsum / M : 0;
  const Vy = M > 0 ? pYsum / M : 0;
  for (const p of hostChain) {
    p.body.setLinvel({ x: Vx, y: Vy }, true);
    p.body.setAngvel(0, true);
  }
  for (const p of guestChain) {
    p.body.setLinvel({ x: Vx, y: Vy }, true);
    p.body.setAngvel(0, true);
  }

  // Joint creation. anchory v body local frame; po rigid-transformu je guestPx
  // rotací sjednocen s hostPx, takže guestθ_new = hostθ → relativní orientace 0.
  const anchorA = dirAnchor(hostDir);
  const anchorB = dirAnchor(guestDir);
  const ra = hostPx.body.rotation();
  const rb = guestPx.body.rotation();
  const data = RAPIER.JointData.fixed(anchorA, rb - ra, anchorB, 0);
  const rapier = world.rapier.createImpulseJoint(data, hostPx.body, guestPx.body, true);
  rapier.setContactsEnabled(false);

  const joint: Joint = { id: nextJointId++, a: hostPx, b: guestPx, anchorA, anchorB, rapier, kind: 'primary' };
  world.joints.push(joint);
  playClick();

  recomputeCompositeOffsets(world, hostPx);

  // Sekundární joint detekce — po rigid-transformu mohou v merged komponentě vzniknout
  // další edge-touching páry, které dosud nebyly spojené (typicky když dva chainy
  // spojily přes jedno joint pair, ale jejich pixely končí ve 2D gridu — sousední
  // pixely v sousedních řadách musí dostat vlastní jointy, aby chain rostl do šířky).
  detectSecondaryJoints(world, hostPx);
  return joint;
}

/**
 * Sezení 16 — po vytvoření primary jointu projet všechny páry pixelů v merged komponentě
 * a vytvořit sekundární jointy pro ty, kdo jsou edge-touching v dominant local axis a
 * dosud nebyli spojeni. Bez toho 2D struktury (čtverce, T-jointy) by zůstaly jen jako
 * single-link "had" mezi řadami.
 *
 * Podmínky secondary jointu:
 *   - Pár (p1, p2) ještě nemá joint.
 *   - Δpos v p1 local frame má dominantní složku ≈ ±1 (tolerance EPS pro float).
 *   - p1 i p2 mají odpovídající dir volný (nepokrytý existujícím jointem).
 *
 * V align mode jsou všichni members na společné `compositeTheta`, takže p1 i p2 sdílí
 * orientaci → projekce do p1 local = projekce do p2 local s opačným znaménkem; check
 * z jedné strany stačí.
 *
 * Žádný `playClick()` (potenciálně N joints najednou by udělalo noise pulse), žádný
 * rigid-transform (geometrie už správná po primary mergi), jen vložení joint
 * constraint + setContactsEnabled(false). Composite offsets už jsou recomputeed
 * po primary jointu — secondary jointy nemění geometrii členů.
 */
function detectSecondaryJoints(world: World, seedPx: Pixel): void {
  const members = collectComponent(world, seedPx);
  if (members.length < 3) return; // potřebujeme alespoň 3 pixely pro existenci nepřímého souseda

  const EPS = 0.05; // tolerance pro Δpos =? ±1 v dominant axis (po f32 round-tripu)

  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const p1 = members[i]!;
      const p2 = members[j]!;

      // Skip pokud už joint mezi p1 a p2 existuje.
      let alreadyJoined = false;
      for (const jt of world.joints) {
        if ((jt.a === p1 && jt.b === p2) || (jt.a === p2 && jt.b === p1)) {
          alreadyJoined = true;
          break;
        }
      }
      if (alreadyJoined) continue;

      // Δpos v p1 local frame.
      const t1 = p1.body.translation();
      const t2 = p2.body.translation();
      const r = p1.body.rotation();
      const cosR = Math.cos(r);
      const sinR = Math.sin(r);
      const dx = t2.x - t1.x;
      const dy = t2.y - t1.y;
      const dxL = cosR * dx + sinR * dy;
      const dyL = -sinR * dx + cosR * dy;

      // Edge-touching = |Δ| ≈ (±1, 0) nebo (0, ±1) v local frame.
      let p1Dir: DirKey | null = null;
      let p2Dir: DirKey | null = null;
      if (Math.abs(dxL - 1) < EPS && Math.abs(dyL) < EPS) {
        p1Dir = 'PX'; p2Dir = 'NX';
      } else if (Math.abs(dxL + 1) < EPS && Math.abs(dyL) < EPS) {
        p1Dir = 'NX'; p2Dir = 'PX';
      } else if (Math.abs(dxL) < EPS && Math.abs(dyL - 1) < EPS) {
        p1Dir = 'PY'; p2Dir = 'NY';
      } else if (Math.abs(dxL) < EPS && Math.abs(dyL + 1) < EPS) {
        p1Dir = 'NY'; p2Dir = 'PY';
      }
      if (!p1Dir || !p2Dir) continue;

      // Both dirs free? (Defenzivní; pokud je topologie zdravá, free check je redundantní.)
      const occA = occupiedDirs(world, p1);
      const occB = occupiedDirs(world, p2);
      if (occA.has(p1Dir) || occB.has(p2Dir)) continue;

      const anchorA = dirAnchor(p1Dir);
      const anchorB = dirAnchor(p2Dir);
      const ra = p1.body.rotation();
      const rb = p2.body.rotation();
      const data = RAPIER.JointData.fixed(anchorA, rb - ra, anchorB, 0);
      const rapier = world.rapier.createImpulseJoint(data, p1.body, p2.body, true);
      rapier.setContactsEnabled(false);
      const joint: Joint = {
        id: nextJointId++,
        a: p1,
        b: p2,
        anchorA,
        anchorB,
        rapier,
        kind: 'secondary',
      };
      world.joints.push(joint);
    }
  }
}

/**
 * Odstraní všechny jointy bez přehrávání zvuku — pro reset scény (clear) a hromadné
 * operace, kde by N click samplů byl noise místo strukturálního signálu.
 */
export function removeAllJointsSilent(world: World): void {
  for (const j of world.joints) {
    world.rapier.removeImpulseJoint(j.rapier, true);
  }
  world.joints.length = 0;
}
