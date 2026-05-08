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
 * **`align=true`**: jednorázová destruktivní intervence při create:
 *   1) snap r=0, rs=0 obou pixelů
 *   2) pos snap newer (vyšší id) na axis-aligned 1 U distance od older
 *   3) edge anchor ±0.5 podle dominantní osy
 *   4) lockRotations(true) na obou — Rapier nebude integrovat rotaci → joint pos
 *      constraint je triviálně ortogonální vůči angular dynamics.
 * Žádný per-tick reset (ten by ničil joint warm-start solver cache).
 *
 * **Idempotent**: pokud už joint mezi týmiž pixely existuje (v libovolném pořadí a/b),
 * vrátí ho bez side-effects (žádný click, žádný snap, žádná Rapier insertion).
 *
 * Zvuk: playClick() jen při skutečném create.
 */
export function createFixedJoint(world: World, a: Pixel, b: Pixel, align: boolean = false): Joint {
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

  // Align: destruktivní intervence (rotation snap + pos snap + lockRotations).
  // Pos snap strategie závisí na existing connectivity:
  //   - Oba bez jointů (fresh pair): snap **oba** k midpoint ± 0.5 → centroid preserved.
  //   - Jeden bez jointů: snap jen ten (chrání chain druhého).
  //   - Oba s jointy (merge komponent): no pos snap (přijmi current pos).
  if (align) {
    a.body.setRotation(0, true);
    b.body.setRotation(0, true);
    a.body.setAngvel(0, true);
    b.body.setAngvel(0, true);

    const aHasJoint = world.joints.some((j) => j.a === a || j.b === a);
    const bHasJoint = world.joints.some((j) => j.a === b || j.b === b);

    const ta0 = a.body.translation();
    const tb0 = b.body.translation();
    const dxN = tb0.x - ta0.x;
    const dyN = tb0.y - ta0.y;
    const xAxis = Math.abs(dxN) >= Math.abs(dyN);
    const sign = xAxis ? (dxN >= 0 ? 1 : -1) : (dyN >= 0 ? 1 : -1);

    if (!aHasJoint && !bHasJoint) {
      // Symmetric snap kolem midpointu — centroid invariant, ∑P=0 zachováno.
      const mx = (ta0.x + tb0.x) / 2;
      const my = (ta0.y + tb0.y) / 2;
      if (xAxis) {
        a.body.setTranslation({ x: mx - 0.5 * sign, y: my }, true);
        b.body.setTranslation({ x: mx + 0.5 * sign, y: my }, true);
      } else {
        a.body.setTranslation({ x: mx, y: my - 0.5 * sign }, true);
        b.body.setTranslation({ x: mx, y: my + 0.5 * sign }, true);
      }
    } else if (!aHasJoint) {
      // a je fresh, b v existing komponentě → snap a k b
      if (xAxis) {
        a.body.setTranslation({ x: tb0.x - sign, y: tb0.y }, true);
      } else {
        a.body.setTranslation({ x: tb0.x, y: tb0.y - sign }, true);
      }
    } else if (!bHasJoint) {
      // b je fresh, a v existing komponentě → snap b k a
      if (xAxis) {
        b.body.setTranslation({ x: ta0.x + sign, y: ta0.y }, true);
      } else {
        b.body.setTranslation({ x: ta0.x, y: ta0.y + sign }, true);
      }
    }
    // else: oba v existing chainech — bez pos snapu (merge komponent, distance může > 1 U).

    a.body.lockRotations(true, true);
    b.body.lockRotations(true, true);
  }

  const ta = a.body.translation();
  const tb = b.body.translation();
  const ra = a.body.rotation();
  const rb = b.body.rotation();

  let anchorA: { x: number; y: number };
  let anchorB: { x: number; y: number };

  if (align) {
    // Edge anchor podle dominantní osy. Po pos snap je distance přesně 1 U a po
    // rotation snap je local==world frame, takže anchor je (±0.5, 0) nebo (0, ±0.5).
    const dx = tb.x - ta.x;
    const dy = tb.y - ta.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      const sx = dx >= 0 ? 1 : -1;
      anchorA = { x: 0.5 * sx, y: 0 };
      anchorB = { x: -0.5 * sx, y: 0 };
    } else {
      const sy = dy >= 0 ? 1 : -1;
      anchorA = { x: 0, y: 0.5 * sy };
      anchorB = { x: 0, y: -0.5 * sy };
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
  return joint;
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
