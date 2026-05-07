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
// Až přijde fáze 3 (joints, kolize), přejdeme zpět na Rapier step() — kontakty pak
// fyzicky brání nejhorším close-encounter slingshotům, takže softening problém zmizí.

import type { World } from './physics';

export type GravityParams = {
  G: number;
  eps: number;
};

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
  }

  // Akumulace gravitačních zrychlení (a, ne F — F dělíme hmotnostmi v místě).
  const ax = new Float64Array(n);
  const ay = new Float64Array(n);
  let peTotal = 0;

  if (p.G !== 0 && n >= 2) {
    const eps2 = p.eps * p.eps;
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
        // Newton 3: opačná zrychlení s opačným znaménkem.
        axi += fxij / mi;
        ayi += fyij / mi;
        ax[j] = ax[j]! - fxij / mj;
        ay[j] = ay[j]! - fyij / mj;
        // PE souhlasná s force kernelem: U = -G·m·m / sqrt(r² + ε²).
        peTotal -= (p.G * mi * mj) / r;
      }
      ax[i] = ax[i]! + axi;
      ay[i] = ay[i]! + ayi;
    }
  }

  // Symplektický Euler: nejprve kick (v += a·dt), pak drift (x += v·dt).
  // Pořadí kick-drift garantuje exact symetrii ∑P (Newton 3) a zachování ∑L pro radiální síly.
  for (let i = 0; i < n; i++) {
    vx[i] = vx[i]! + ax[i]! * dt;
    vy[i] = vy[i]! + ay[i]! * dt;
    px[i] = px[i]! + vx[i]! * dt;
    py[i] = py[i]! + vy[i]! * dt;
    // Úhlová rychlost se bez external torque nemění.
    angles[i] = angles[i]! + omegas[i]! * dt;
  }

  // Zápis zpět do Rapier RigidBody — wakeUp=true, abychom je drželi probuzené.
  for (let i = 0; i < n; i++) {
    const body = pixels[i]!.body;
    body.setLinvel({ x: vx[i]!, y: vy[i]! }, true);
    body.setTranslation({ x: px[i]!, y: py[i]! }, true);
    body.setRotation(angles[i]!, true);
  }

  return { pe: peTotal };
}
