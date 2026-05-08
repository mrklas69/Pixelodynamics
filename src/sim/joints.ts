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
      // Stage 3.1 — alespoň jeden řetězec multi-pixel. Rigid-transform menšího
      // řetězce tak, aby host_pixel ↔ guest_pixel byly edge-touching v host frame.
      // Internal joint anchory guest pixelů jsou v body local frames → po rigid
      // transformu zůstávají platné.
      const aIsHost = chainA.length >= chainB.length;
      const hostChain = aIsHost ? chainA : chainB;
      const guestChain = aIsHost ? chainB : chainA;
      const hostPixel = aIsHost ? a : b;
      const guestPixel = aIsHost ? b : a;

      // Host theta — fresh singleton (může nastat při fresh+chain) snapne na 0;
      // existující chain si drží svou rotation z stepCompositesAlign.
      let hostTheta = hostPixel.body.rotation();
      if (hostChain.length === 1) {
        hostTheta = 0;
        hostPixel.body.setRotation(0, true);
      }

      const hostPos = hostPixel.body.translation();
      const guestPos = guestPixel.body.translation();

      // Direction host→guest v host local frame: R(−hostθ)·(guestPos−hostPos).
      const cosT = Math.cos(hostTheta);
      const sinT = Math.sin(hostTheta);
      const dxW = guestPos.x - hostPos.x;
      const dyW = guestPos.y - hostPos.y;
      const dxL = cosT * dxW + sinT * dyW;
      const dyL = -sinT * dxW + cosT * dyW;
      const xAxis = Math.abs(dxL) >= Math.abs(dyL);
      const sign = xAxis ? (dxL >= 0 ? 1 : -1) : (dyL >= 0 ? 1 : -1);

      // Target guest pos v world: hostPos + R(hostθ)·(±1, 0) nebo (0, ±1).
      const ex = xAxis ? sign : 0;
      const ey = xAxis ? 0 : sign;
      const targetGuestX = hostPos.x + cosT * ex - sinT * ey;
      const targetGuestY = hostPos.y + sinT * ex + cosT * ey;

      // Rigid transform celého guest řetězce: rotace o Δθ kolem guestPos, pak
      // translate na targetGuest. Δθ zachová guest internal geometry; translace
      // sjednotí frame s host.
      const guestTheta = guestPixel.body.rotation();
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

      // Velocity unification — ∑P preserved, ω = 0 (consistent s align destruktivním
      // paradigmem; angular momentum loss explicitní rozhodnutí).
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

      // alignSign mapuje host-frame sign na anchorA-relative sign (anchorA = a-side).
      // Pokud b je host, anchorA patří guest → invert sign.
      alignXAxis = xAxis;
      alignSign = aIsHost ? sign : -sign;
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

  const joint: Joint = { id: nextJointId++, a, b, anchorA, anchorB, rapier };
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
 * Auto-joint v `align` modu — wrapper kolem `createFixedJoint(align=true)`, který
 * řeší dva problémy odhalené v E14 modelshotu po S13:
 *
 * 1. **Same-component filter** — Rapier narrow-phase generuje contact eventy pro
 *    všechny AABB-overlapping páry (Y offset 0.07 → a2-b0 i a1-b0 i a2-b1 ve stejném
 *    ticku). Po prvním cross-component merge jsou všechny další eventy "same component"
 *    a `createFixedJoint(align=true)` pro ně teď vrací null. Bez tohoto filteru by
 *    solver iteroval proti broken anchorům.
 *
 * 2. **Endpoint picking** — kontakt event přichází s libovolnou dvojicí pixelů
 *    (typicky NEjsou koncové pixely chainů). Pokud bychom přímo volali
 *    createFixedJoint(a, b, true), rigid-transform by spočítal targetGuestPos =
 *    hostPos + 1U. Když ale `a` je interní pixel host chainu, target leží uprostřed
 *    chainu → překryv 2 pixelů na jedné pozici. Místo toho najdeme **endpoint pixely**
 *    (degree ≤ 1 v rámci chain joint graphu) nejblíže ke kontaktnímu páru a joint
 *    vytvoříme mezi nimi.
 *
 * Vrací nově vytvořený joint, existing duplicate, nebo null pokud byly chains
 * already merged.
 */
export function autoJointAlign(world: World, a: Pixel, b: Pixel): Joint | null {
  const chainA = collectComponent(world, a);
  const chainB = collectComponent(world, b);

  // Filter 1 — already in same component (redundance po předchozím merge tento tick).
  if (chainA.includes(b)) return null;

  // Filter 2 — endpoint picking. Free-edge pair nejblíže ke kontaktnímu páru.
  const aPos = a.body.translation();
  const bPos = b.body.translation();
  const hostEndpoint = pickClosestEndpoint(chainA, bPos, world);
  const guestEndpoint = pickClosestEndpoint(chainB, aPos, world);

  return createFixedJoint(world, hostEndpoint, guestEndpoint, true);
}

/**
 * Vybere endpoint pixel chainu (pixel s degree ≤ 1 v rámci chain joint graphu)
 * nejblíže k `target` poloze. Pro singleton chain vrací jediný pixel.
 *
 * Pro lineární chain m=N jsou typicky 2 endpointy (oba konce); endpoint nejblíž
 * `target` se vybírá jako kontaktní bod pro merge. Pro větvenou topologii může
 * být endpointů víc, fallback na všechny degree-1 pixely. Pro cyklickou strukturu
 * (žádný degree ≤ 1) fallback na chain[0] — neměla by nastat v Pixelodynamics
 * (cyklický joint graph by znamenal redundant constraint).
 */
function pickClosestEndpoint(
  chain: Pixel[],
  target: { x: number; y: number },
  world: World,
): Pixel {
  if (chain.length === 1) return chain[0]!;

  const chainSet = new Set(chain);
  const endpoints: Pixel[] = [];
  for (const p of chain) {
    let degree = 0;
    for (const j of world.joints) {
      if ((j.a === p && chainSet.has(j.b)) || (j.b === p && chainSet.has(j.a))) {
        degree++;
        if (degree > 1) break; // nepotřebujeme přesný degree, jen ≤ 1 vs > 1
      }
    }
    if (degree <= 1) endpoints.push(p);
  }
  if (endpoints.length === 0) return chain[0]!;

  let best = endpoints[0]!;
  let bestDist = Infinity;
  for (const p of endpoints) {
    const t = p.body.translation();
    const dx = t.x - target.x;
    const dy = t.y - target.y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = p;
    }
  }
  return best;
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
 * Odstraní všechny jointy bez přehrávání zvuku — pro reset scény (clear) a hromadné
 * operace, kde by N click samplů byl noise místo strukturálního signálu.
 */
export function removeAllJointsSilent(world: World): void {
  for (const j of world.joints) {
    world.rapier.removeImpulseJoint(j.rapier, true);
  }
  world.joints.length = 0;
}
