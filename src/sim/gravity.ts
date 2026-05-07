// Manuální symplektický Eulerův integrátor pro párovou gravitaci.
//
// Pozadí: Rapier 2D má integrátor optimalizovaný pro contacts a joints, ne pro orbital
// mechanics. Pro čistě ballistickou + gravitační simulaci jeho stabilizační kroky
// numericky porušují zákony zachování (∑P klesá, ∑L diverguje). Pro FVP (kde nemáme
// ani kontakty ani jointy) tedy:
//   - Rapier RigidBody slouží jen jako handle / kontejner stavu.
//   - Integraci děláme sami: v += a·dt; x += v·dt (kick-drift).
//   - Symplektický Euler zachovává hybnost na úrovni float roundoff a pro radiální
//     síly zachovává úhlovou hybnost také.
//
// Force eval má dvě varianty:
//   - naivní O(N²) — referenční baseline, používá se pro N malé nebo když
//     `GRAVITY_USE_GRID = false` (kontrolní srovnání).
//   - uniform spatial grid — buňky o velikosti cutoff, party jen v 3×3 sousedství,
//     očekávané ~O(N) pro homogenní rozložení.

import type { World } from './physics';
import { GRAVITY_CUTOFF_FACTOR, GRAVITY_TAIL_WIDTH } from './params';

export type GravityParams = {
  G: number;
  eps: number;
  /**
   * true = uniform spatial grid s hard cutoff 5·ε ≈ 7.5 U (produkční default).
   * false = naivní O(N²) všech dvojic — nutné pro experimenty s párovou interakcí
   * na vzdálenostech > cutoff (např. L1 v E6).
   */
  useGrid: boolean;
};

// Module-level scratch — recyklujeme buckety mezi voláními, aby GC nezdroj.
// `gridBuckets`: cell key → array indexů pixelů. Klíč = `cy * STRIDE + cx`
// po offset (kódujeme znaménko). STRIDE musí být >> max počet buněk v ose.
const STRIDE = 65536;
const OFFSET = 32768;
const gridBuckets = new Map<number, number[]>();
const bucketPool: number[][] = [];

function clearGrid(): void {
  for (const arr of gridBuckets.values()) {
    arr.length = 0;
    bucketPool.push(arr);
  }
  gridBuckets.clear();
}

function takeBucket(): number[] {
  return bucketPool.pop() ?? [];
}

export function stepGravity(world: World, p: GravityParams, dt: number): { pe: number } {
  const pixels = world.pixels;
  const n = pixels.length;
  if (n === 0) return { pe: 0 };

  // Cache stavu — minimalizuje volání přes WASM bridge.
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  const m = new Float64Array(n);
  const angles = new Float64Array(n);
  const omegas = new Float64Array(n);
  const pinned = new Uint8Array(n); // 1 = nehybný (skip kick+drift+write-back)
  for (let i = 0; i < n; i++) {
    const pixel = pixels[i]!;
    const t = pixel.body.translation();
    const v = pixel.body.linvel();
    px[i] = t.x;
    py[i] = t.y;
    vx[i] = v.x;
    vy[i] = v.y;
    m[i] = pixel.m;
    angles[i] = pixel.body.rotation();
    omegas[i] = pixel.body.angvel();
    pinned[i] = pixel.pinned ? 1 : 0;
  }

  // Akumulace gravitačních zrychlení (a, ne F — F dělíme hmotnostmi v místě).
  const ax = new Float64Array(n);
  const ay = new Float64Array(n);
  const peRef = { pe: 0 };

  if (p.G !== 0 && n >= 2) {
    if (p.useGrid) {
      accumulateForcesGrid(p, n, px, py, m, ax, ay, peRef);
    } else {
      accumulateForcesNaive(p, n, px, py, m, ax, ay, peRef);
    }
  }

  // Symplektický Euler: nejprve kick (v += a·dt), pak drift (x += v·dt).
  // Pořadí kick-drift garantuje exact symetrii ∑P (Newton 3) a zachování ∑L pro radiální síly.
  // Pinned pixely přeskakujeme — působí gravitací na ostatní (force kernel je započítal),
  // ale jejich vlastní pos/vel je fixní.
  for (let i = 0; i < n; i++) {
    if (pinned[i]) continue;
    vx[i] = vx[i]! + ax[i]! * dt;
    vy[i] = vy[i]! + ay[i]! * dt;
    px[i] = px[i]! + vx[i]! * dt;
    py[i] = py[i]! + vy[i]! * dt;
    // Úhlová rychlost se bez external torque nemění.
    angles[i] = angles[i]! + omegas[i]! * dt;
  }

  // Zápis zpět do Rapier RigidBody — pro pinned vynecháme úplně, abychom nedělali
  // round-trip f64 → f32 → f64, který by byl jediný zdroj numerického posunu.
  for (let i = 0; i < n; i++) {
    if (pinned[i]) continue;
    const body = pixels[i]!.body;
    body.setLinvel({ x: vx[i]!, y: vy[i]! }, true);
    body.setTranslation({ x: px[i]!, y: py[i]! }, true);
    body.setRotation(angles[i]!, true);
  }

  return { pe: peRef.pe };
}

/** Naivní O(N²) — všechny dvojice. Reference baseline. */
function accumulateForcesNaive(
  p: GravityParams,
  n: number,
  px: Float64Array,
  py: Float64Array,
  m: Float64Array,
  ax: Float64Array,
  ay: Float64Array,
  peRef: { pe: number },
): void {
  const eps2 = p.eps * p.eps;
  let pe = 0;
  for (let i = 0; i < n - 1; i++) {
    const xi = px[i]!;
    const yi = py[i]!;
    const mi = m[i]!;
    let axi = 0;
    let ayi = 0;
    for (let j = i + 1; j < n; j++) {
      const dx = px[j]! - xi;
      const dy = py[j]! - yi;
      const r2 = dx * dx + dy * dy + eps2;
      const r = Math.sqrt(r2);
      const invR3 = 1 / (r2 * r);
      const mj = m[j]!;
      const f = p.G * mi * mj * invR3;
      const fxij = f * dx;
      const fyij = f * dy;
      axi += fxij / mi;
      ayi += fyij / mi;
      ax[j] = ax[j]! - fxij / mj;
      ay[j] = ay[j]! - fyij / mj;
      pe -= (p.G * mi * mj) / r;
    }
    ax[i] = ax[i]! + axi;
    ay[i] = ay[i]! + ayi;
  }
  peRef.pe = pe;
}

/**
 * Uniform spatial grid. Cell size = cutoff = `eps × CUTOFF_FACTOR`. Pro každou buňku
 * iteruj 3×3 sousedství; uvnitř páruj pixely s `j > i` (dedup) a počítej jen pokud
 * `r ≤ cutoff`.
 *
 * Smoothstep tail: pokud `GRAVITY_TAIL_WIDTH > 0`, v transition zóně `[r_inner, cutoff]`
 * (kde `r_inner = cutoff − tailWidth`) se aplikuje 3-2 polynom `W(r) = 1 − (3t² − 2t³)`
 * na potenciál `U_mod = U·W`, a síla je rigorózně `F = −dU_mod/dr` (zachovává `∑E`).
 * Mimo transition zónu je W=1 (uvnitř) nebo skip (vně).
 *
 * Konzervace:
 *  - ∑P exact (každý pár přidá Newton 3 symetricky, bez ohledu na W).
 *  - ∑L exact pro radiální páry — síla zůstává radiální (W závisí jen na |r|, ne směru).
 *  - ∑E = KE + PE konzervováno do truncation symplektického Eulera (W·U je hladký).
 */
function accumulateForcesGrid(
  p: GravityParams,
  n: number,
  px: Float64Array,
  py: Float64Array,
  m: Float64Array,
  ax: Float64Array,
  ay: Float64Array,
  peRef: { pe: number },
): void {
  const cutoff = p.eps * GRAVITY_CUTOFF_FACTOR;
  const cellSize = cutoff;
  const invCell = 1 / cellSize;
  const cutoff2 = cutoff * cutoff;
  const eps2 = p.eps * p.eps;
  // Smoothstep transition zone: pro r_raw ∈ [innerCutoff, cutoff] aplikuj window.
  // tailWidth=0 → hard cutoff (innerCutoff = cutoff, transition vypnutá v if-čeku).
  const tailWidth = GRAVITY_TAIL_WIDTH;
  const innerCutoff = cutoff - tailWidth;
  const innerCutoff2 = innerCutoff * innerCutoff;
  let pe = 0;

  clearGrid();
  for (let i = 0; i < n; i++) {
    const cx = Math.floor(px[i]! * invCell) + OFFSET;
    const cy = Math.floor(py[i]! * invCell) + OFFSET;
    // Pixel zcela mimo grid range (prakticky nenastane, ale safety) → padne do edge buňky.
    const cxc = cx < 0 ? 0 : cx >= STRIDE ? STRIDE - 1 : cx;
    const cyc = cy < 0 ? 0 : cy >= STRIDE ? STRIDE - 1 : cy;
    const k = cyc * STRIDE + cxc;
    let arr = gridBuckets.get(k);
    if (!arr) {
      arr = takeBucket();
      gridBuckets.set(k, arr);
    }
    arr.push(i);
  }

  // Iterace přes každou neprázdnou buňku. Pro každou projdi 3×3 sousedství.
  // Dedup: pár (i, j) započítáme jen když `i < j`. To zajistí, že pár je započítán
  // přesně jednou, ať jsou v jakémkoliv ze 9 vztahů cell-to-neighbor.
  for (const [key, cellPixels] of gridBuckets) {
    const cy = Math.floor(key / STRIDE);
    const cx = key - cy * STRIDE;

    for (let dy = -1; dy <= 1; dy++) {
      const ny = cy + dy;
      if (ny < 0 || ny >= STRIDE) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx;
        if (nx < 0 || nx >= STRIDE) continue;
        const nKey = ny * STRIDE + nx;
        const neighbors = gridBuckets.get(nKey);
        if (!neighbors) continue;

        // Same-cell: uvnitř `cellPixels` páruj jen i<j; cell-to-neighbor stejné pravidlo
        // bude buď redundantní (když je neighbor stejná buňka) nebo asymetrické.
        // Jednotná pravidlo `i < j` přes všechny páry je konzistentní.
        for (let a = 0; a < cellPixels.length; a++) {
          const i = cellPixels[a]!;
          const xi = px[i]!;
          const yi = py[i]!;
          const mi = m[i]!;
          for (let b = 0; b < neighbors.length; b++) {
            const j = neighbors[b]!;
            if (j <= i) continue;
            const ddx = px[j]! - xi;
            const ddy = py[j]! - yi;
            const r2raw = ddx * ddx + ddy * ddy;
            if (r2raw > cutoff2) continue;
            const r2 = r2raw + eps2;
            const rSoft = Math.sqrt(r2);
            const invR3 = 1 / (r2 * rSoft);
            const mj = m[j]!;
            const Gmm = p.G * mi * mj;

            // Window faktor W(r) a jeho gradient term.
            // Pro r_raw ≤ innerCutoff: W=1, žádný extra force člen → standardní Plummer.
            // Pro r_raw > innerCutoff: W = 1 − (3t² − 2t³), přidává se −U·W'/r_raw·dx
            //   k force, což odpovídá F = −dU_mod/dr_raw přesně.
            let W = 1;
            let extraTerm = 0;
            if (tailWidth > 0 && r2raw > innerCutoff2) {
              const rRaw = Math.sqrt(r2raw);
              const t = (rRaw - innerCutoff) / tailWidth;
              W = 1 - t * t * (3 - 2 * t);
              // ds/dt = 6t(1−t); W' = −ds/dt / tailWidth.
              // Force korekce: −U(r_raw)·W'·dx/r_raw = G·m·m / rSoft · 6t(1−t)/(tailWidth·rRaw) · dx
              extraTerm = (6 * t * (1 - t)) / (tailWidth * rSoft * rRaw);
            }

            const fCoeff = Gmm * (W * invR3 + extraTerm);
            const fxij = fCoeff * ddx;
            const fyij = fCoeff * ddy;
            ax[i] = ax[i]! + fxij / mi;
            ay[i] = ay[i]! + fyij / mi;
            ax[j] = ax[j]! - fxij / mj;
            ay[j] = ay[j]! - fyij / mj;
            pe -= (Gmm * W) / rSoft;
          }
        }
      }
    }
  }

  peRef.pe = pe;
}
