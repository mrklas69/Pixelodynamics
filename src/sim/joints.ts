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
 * Vytvoří FixedJoint mezi dvěma pixely. Anchor = midpoint mezi centry, transformovaný
 * do lokálního frame každého pixelu (inverze rotace). Pro statické pixely (rotace 0)
 * a centry 1 U od sebe je anchorA = (+0.5, 0), anchorB = (-0.5, 0) — sdílená hrana.
 *
 * Zvuk: playClick() při create.
 */
export function createFixedJoint(world: World, a: Pixel, b: Pixel): Joint {
  const ta = a.body.translation();
  const tb = b.body.translation();
  const ra = a.body.rotation();
  const rb = b.body.rotation();

  // Midpoint ve world coords.
  const mx = (ta.x + tb.x) / 2;
  const my = (ta.y + tb.y) / 2;

  // Inverze rotace — anchor v lokálním frame pixelu.
  const dxA = mx - ta.x;
  const dyA = my - ta.y;
  const cA = Math.cos(-ra);
  const sA = Math.sin(-ra);
  const anchorA = { x: cA * dxA - sA * dyA, y: sA * dxA + cA * dyA };

  const dxB = mx - tb.x;
  const dyB = my - tb.y;
  const cB = Math.cos(-rb);
  const sB = Math.sin(-rb);
  const anchorB = { x: cB * dxB - sB * dyB, y: sB * dxB + cB * dyB };

  // RAPIER.JointData.fixed(anchor1, frame1, anchor2, frame2): constraint je
  //   r_A + frame1 == r_B + frame2 (v world).
  // Když frame1=frame2=0, constraint demanduje r_A == r_B; pokud se aktuální rotace
  // neshodují (LMB spawn dává random `r`), Rapier solver okamžitě po create aplikuje
  // korekční impuls = pixely viditelně poskočí, aby vyrovnaly orientaci. Pro preserve
  // current relative orientation: frame1 = r_B − r_A, frame2 = 0.
  const data = RAPIER.JointData.fixed(anchorA, rb - ra, anchorB, 0);
  const rapier = world.rapier.createImpulseJoint(data, a.body, b.body, true);

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
