// Diagnostika simulace — kontrola zákonů zachování. O(n) cena.

import type { World } from './physics';
import type { Pixel } from '../types';

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

/**
 * Lehká O(N) verze pro per-frame použití (např. vizualizace centroidu).
 * Plný `computeDiagnostics` se volá jen v display ticku á 500 ms.
 */
export function computeCentroid(world: World): { cx: number; cy: number } | null {
  if (world.pixels.length === 0) return null;
  let cx = 0, cy = 0, mass = 0;
  for (const p of world.pixels) {
    const t = p.body.translation();
    cx += p.m * t.x;
    cy += p.m * t.y;
    mass += p.m;
  }
  if (mass === 0) return null;
  return { cx: cx / mass, cy: cy / mass };
}

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

/** Stats spočítaný z grafu pixely-jointy v jediném Union-Find průchodu. */
export type ObjectStats = {
  /** Počet komponent souvislosti (= počet objektů). */
  count: number;
  /** Reprezentant největší komponenty + počet pixelů. null pro prázdnou scénu. */
  largest: { repId: number; size: number } | null;
};

/** Lookup `pixel → index` — sdílený mezi diagnostics a render edge mask (App.svelte). */
export function buildPixelIndex(world: World): Map<Pixel, number> {
  const idxOf = new Map<Pixel, number>();
  for (let i = 0; i < world.pixels.length; i++) idxOf.set(world.pixels[i]!, i);
  return idxOf;
}

/**
 * Statistika objektů (pixely jako vrcholy, jointy jako hrany) v jednom Union-Find
 * průchodu s path compression a union by size — O((N+J)·α).
 *
 * Vrací: počet komponent + reprezentanta největší (pro `Largest` champion).
 *
 * Volá se á 500 ms v display ticku, takže perf je bez přetížení i pro N=1000, J=500.
 * Pro statickou topologii (žádné nové jointy) bychom mohli kachovat, ale auto-jointing
 * v hybrid-α znamená, že topologie se mění organicky → vždy přepočítat.
 */
export function computeObjectStats(world: World): ObjectStats {
  const n = world.pixels.length;
  if (n === 0) return { count: 0, largest: null };
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
    // Path compression
    while (parent[x]! !== r) {
      const next = parent[x]!;
      parent[x] = r;
      x = next;
    }
    return r;
  };

  let components = n;
  for (const j of world.joints) {
    const a = idxOf.get(j.a);
    const b = idxOf.get(j.b);
    if (a === undefined || b === undefined) continue;
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) continue;
    // Union by size — drobná konstanta, ale stačí pro O((N+J)·α).
    if (size[ra]! < size[rb]!) {
      parent[ra] = rb;
      size[rb] = size[rb]! + size[ra]!;
    } else {
      parent[rb] = ra;
      size[ra] = size[ra]! + size[rb]!;
    }
    components--;
  }

  // Najdi root s největší size. Procházíme jen roots (parent[i] === i).
  let bestRoot = 0;
  let bestSize = size[0]!;
  for (let i = 1; i < n; i++) {
    if (parent[i] !== i) continue;
    if (size[i]! > bestSize) {
      bestRoot = i;
      bestSize = size[i]!;
    }
  }
  return {
    count: components,
    largest: { repId: world.pixels[bestRoot]!.id, size: bestSize },
  };
}
