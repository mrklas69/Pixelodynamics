// "Champions" — pixely / objekty s extrémními hodnotami sledovaných veličin.
// O(n) per tick.

import type { World } from './physics';

export type Champion = { id: number; value: number } | null;

export type Facts = {
  fastest: Champion; // max |v|
  mostSpin: Champion; // max |ω|
  mostMomentum: Champion; // max m·|v|
  mostAngularMomentum: Champion; // max |L_pixel| (orbital + spin)
  largest: Champion; // max počet pixelů v objektu — null dokud nejsou objekty
  mostMassive: Champion; // max m
};

export const emptyFacts: Facts = {
  fastest: null,
  mostSpin: null,
  mostMomentum: null,
  mostAngularMomentum: null,
  largest: null,
  mostMassive: null,
};

/**
 * @param cmx, cmy — souřadnice těžiště (z diagnostiky), kvůli orbitálnímu členu úhlové hybnosti.
 */
export function computeFacts(world: World, cmx: number, cmy: number): Facts {
  if (world.pixels.length === 0) return emptyFacts;

  let fastest: Champion = null;
  let mostSpin: Champion = null;
  let mostMomentum: Champion = null;
  let mostAngularMomentum: Champion = null;
  let mostMassive: Champion = null;

  for (const p of world.pixels) {
    const v = p.body.linvel();
    const t = p.body.translation();
    const w = p.body.angvel();
    const speed = Math.hypot(v.x, v.y);
    const spin = Math.abs(w);
    const mom = p.m * speed;
    // L_pixel = orbital + spin. Pro čtverec o straně 1: I = m·s²/6 = m/6.
    const orbital = p.m * ((t.x - cmx) * v.y - (t.y - cmy) * v.x);
    const Lpx = orbital + (p.m / 6) * w;
    const angMom = Math.abs(Lpx);

    if (!fastest || speed > fastest.value) fastest = { id: p.id, value: speed };
    if (!mostSpin || spin > mostSpin.value) mostSpin = { id: p.id, value: spin };
    if (!mostMomentum || mom > mostMomentum.value) mostMomentum = { id: p.id, value: mom };
    if (!mostAngularMomentum || angMom > mostAngularMomentum.value)
      mostAngularMomentum = { id: p.id, value: angMom };
    if (!mostMassive || p.m > mostMassive.value) mostMassive = { id: p.id, value: p.m };
  }

  return {
    fastest,
    mostSpin,
    mostMomentum,
    mostAngularMomentum,
    largest: null, // composite objects přijdou ve fázi 3
    mostMassive,
  };
}
