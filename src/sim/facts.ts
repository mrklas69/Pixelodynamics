// "Champions" — entity (pixel = singleton composite, slepenec = multi-pixel composite)
// s extrémními hodnotami sledovaných veličin. O(N) per display tick.
//
// Sezení 16 — refactor: ChampionEntity discriminated union { kind: 'pixel' | 'composite', id }.
// Composite ID = min(member.id), stable across ticks (dokud min member nezmizí). FACTS klik
// → camera.lockTarget příslušného kindu (pixel: follow .pos; composite: follow CoM).

import type { Composite } from './composite';

/**
 * Identifikace entity. Pro `pixel` je `id` přímo Pixel.id. Pro `composite` je `id`
 * minimum ID členů (stable representative), ze kterého se BFS-em znovu sestaví celý
 * slepenec při lookupu (`computeCompositeFor` v composite.ts).
 */
export type ChampionEntity =
  | { kind: 'pixel'; id: number }
  | { kind: 'composite'; id: number };

export type Champion = { entity: ChampionEntity; value: number } | null;

export type Facts = {
  fastest: Champion; // max |V| (CoM speed)
  mostSpin: Champion; // max |ω|
  mostMomentum: Champion; // max M·|V| = |∑P|
  mostAngularMomentum: Champion; // max |L| kolem world centroidu
  largest: Champion; // max počet členů
  mostMassive: Champion; // max ∑m
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
 * Iteruje přes všechny složky (singleton = pixel, multi = slepenec) a najde extrém
 * pro každou metriku.
 *
 * Singleton composite má `c.linvel = pixel.linvel`, `c.angvel = pixel.angvel`,
 * `c.mass = pixel.m`, `c.inertia = m/6` — fact metriky pro singleton tedy odpovídají
 * pixel-level metrikám z předchozí verze.
 *
 * @param cmx, cmy — souřadnice world těžiště (z `computeDiagnostics`/`computeCentroid`),
 *   nutné pro orbitální člen úhlové hybnosti L_pixel kolem world centroidu.
 */
export function computeFacts(composites: Composite[], cmx: number, cmy: number): Facts {
  if (composites.length === 0) return emptyFacts;

  let fastest: Champion = null;
  let mostSpin: Champion = null;
  let mostMomentum: Champion = null;
  let mostAngularMomentum: Champion = null;
  let largest: Champion = null;
  let mostMassive: Champion = null;

  for (const c of composites) {
    // L kolem world centroidu = ∑(orbital_member + spin_member). Pro singleton se redukuje
    // na pixel-level formuli; pro multi je to total angular momentum slepence kolem (cmx, cmy).
    let L = 0;
    let minId = Infinity;
    for (const p of c.members) {
      if (p.id < minId) minId = p.id;
      const t = p.body.translation();
      const v = p.body.linvel();
      const w = p.body.angvel();
      L += p.m * ((t.x - cmx) * v.y - (t.y - cmy) * v.x); // orbital kolem (cmx, cmy)
      L += (p.m / 6) * w; // spin (I_pixel = m/6 pro čtverec o straně 1)
    }

    const isComposite = c.members.length >= 2;
    const entity: ChampionEntity = {
      kind: isComposite ? 'composite' : 'pixel',
      id: minId,
    };

    const speed = Math.hypot(c.linvel.x, c.linvel.y);
    const spin = Math.abs(c.angvel);
    const mom = c.mass * speed; // |∑P| = M·|V_CoM|
    const angMom = Math.abs(L);
    const size = c.members.length;

    if (!fastest || speed > fastest.value) fastest = { entity, value: speed };
    if (!mostSpin || spin > mostSpin.value) mostSpin = { entity, value: spin };
    if (!mostMomentum || mom > mostMomentum.value) mostMomentum = { entity, value: mom };
    if (!mostAngularMomentum || angMom > mostAngularMomentum.value)
      mostAngularMomentum = { entity, value: angMom };
    if (!largest || size > largest.value) largest = { entity, value: size };
    if (!mostMassive || c.mass > mostMassive.value) mostMassive = { entity, value: c.mass };
  }

  return {
    fastest,
    mostSpin,
    mostMomentum,
    mostAngularMomentum,
    largest,
    mostMassive,
  };
}
