// Diagnostika simulace — kontrola zákonů zachování. O(n) cena.

import type { World } from './physics';

export type Diagnostics = {
  /** Lineární hybnost systému — ideálně ~ 0 a konstantní (Newton 3 zachovává hybnost). */
  px: number;
  py: number;
  /** Kinetická energie (translační + rotační). S gravitací se mění (přechází do PE).
   *  Rotační složka = Σ ½·I·ω², I=m/6 pro pixel-čtverec o straně 1 U. */
  ke: number;
  /** Úhlová hybnost vůči těžišti — také zachovávaná, dokud není externí torque. */
  L: number;
  /** Těžiště systému. */
  cx: number;
  cy: number;
  /** Celková hmotnost (užitečné pro normalizaci). */
  mass: number;
};

export function computeDiagnostics(world: World): Diagnostics {
  let px = 0;
  let py = 0;
  let ke = 0;
  let L = 0;
  let cx = 0;
  let cy = 0;
  let mass = 0;

  // První průchod: hybnost, KE (translační + rotační), hmotnost, těžiště.
  // I = m/6 pro pixel-čtverec o straně 1 U (∫∫ (x²+y²) dm přes [-0.5,0.5]² = m/6).
  for (const p of world.pixels) {
    const v = p.body.linvel();
    const w = p.body.angvel();
    const t = p.body.translation();
    px += p.m * v.x;
    py += p.m * v.y;
    ke += 0.5 * p.m * (v.x * v.x + v.y * v.y);
    ke += 0.5 * (p.m / 6) * w * w;
    cx += p.m * t.x;
    cy += p.m * t.y;
    mass += p.m;
  }

  if (mass > 0) {
    cx /= mass;
    cy /= mass;
  }

  // Druhý průchod: úhlová hybnost vůči těžišti.
  // L_total = Σ (m·(r-c) × v) + Σ (I·ω). Pro čtverec o straně 1: I = m·s²/6 = m/6.
  // Spin pixelu kolem vlastního středu se v L_total promítá přes I·ω.
  for (const p of world.pixels) {
    const v = p.body.linvel();
    const t = p.body.translation();
    const w = p.body.angvel();
    const rx = t.x - cx;
    const ry = t.y - cy;
    L += p.m * (rx * v.y - ry * v.x); // orbital
    L += (p.m / 6) * w; // spin (moment setrvačnosti pro čtverec)
  }

  return { px, py, ke, L, cx, cy, mass };
}
