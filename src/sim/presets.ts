// Presety = reprodukovatelné experimentální scénáře.
//
// Každý preset přesně definuje počáteční stav: clear scény, set parametrů,
// explicitní spawn pixelů, výběr integračního módu, případný auto-stop.
// Žádný random — pro určení "co Rapier interně dělá" potřebujeme deterministické vstupy.
//
// Po dosažení `stopAtTime` (sim sekundy) se simulace pauzne a stav se
// auto-exportuje do clipboardu jako JSON modelshot.

import type { World } from './physics';
import type { Pixel } from '../types';

/**
 * Integrační mód = vztah mezi gravitační simulací a Rapier joint solverem.
 *
 *   - `without-interaction`  Jen párová gravita (manual symplektický Euler).
 *                            Rapier step() se nevolá → žádné kontakty, žádné jointy.
 *                            Pixely procházejí jeden druhým. Pro pure orbital dynamics
 *                            se zachovanými ∑P/∑L na úroveň f64 ulp.
 *   - `not-align`            Velocity-Verlet split: manual jen kick (v += a·dt), Rapier
 *                            dělá pos drift + joint solver + auto-jointing při kontaktu.
 *                            Slepence zachovají rotace pixelů a věrně pruží/kmitají;
 *                            anchor = midpoint mezi centry (může být off-edge pro
 *                            natočené pixely, ale physics dynamics konzistentní).
 *   - `align`                Jako `not-align`, ale při auto-jointu **destruktivně**
 *                            snapne pos newer pixelu (vyšší id) na axis-aligned 1 U
 *                            distance + snap r=0, rs=0, lockRotations(true). Vznikne
 *                            vždy axis-aligned mřížka. Jednorázová intervence při
 *                            create (žádný per-tick reset, který by ničil joint
 *                            warm-start). Cena: ztráta rotace; pair distance vždy
 *                            přesně 1 U, ale collision dynamics zničena.
 */
export type IntegrationMode = 'without-interaction' | 'not-align' | 'align';

export type PresetAPI = {
  /** Vrátí gravitační konstantu G (parametr SETTINGS). */
  setG: (g: number) => void;
  /** Vrátí konstantu vazby H (zatím nepoužitá, fáze 4+). */
  setH: (h: number) => void;
  /** Přepne integrační mód (viz `IntegrationMode`). */
  setIntegration: (mode: IntegrationMode) => void;
  /**
   * Přepne mezi uniform spatial grid (true, default) a naivní O(N²) gravitou.
   * Naivní je nutná pro experimenty s párovou interakcí > cutoff (~7.5 U).
   */
  setUseGrid: (b: boolean) => void;
  /**
   * Spawn pixelu s plně explicitními atributy. Vrací `Pixel` handle, aby preset mohl
   * pixel referencovat (například pro `connect`).
   * `pinned=true` udělá z pixelu nehybnou hmotu — působí gravitací, sama se nepohne.
   */
  spawn: (
    x: number,
    y: number,
    vx: number,
    vy: number,
    r: number,
    rs: number,
    m?: number,
    pinned?: boolean,
  ) => Pixel;
  /**
   * Vytvoří FixedJoint mezi dvěma pixely (anchor = midpoint mezi centry).
   */
  connect: (a: Pixel, b: Pixel) => void;
  /**
   * Tuning Rapier solveru. Default: `solverIterations=4`, `pgsIterations=1`, `canSleep=false`.
   * `applyPreset` před setup vrací tunings na default; preset si pak může nastavit vlastní.
   */
  tuneRapier: (opts: { solverIterations?: number; pgsIterations?: number; canSleep?: boolean }) => void;
};

export type Preset = {
  id: string;
  name: string;
  description: string;
  setup: (api: PresetAPI) => void;
  /** Auto-pause + auto-export po dosažení tohoto sim času. */
  stopAtTime?: number;
};

/**
 * G1024 — 32×32 grid axis-aligned pixelů, spacing 3 U.
 * Pure gravity collapse pro pozorování krásných průběhů ve `without-interaction` módu;
 * po přepnutí na `not-align` se cluster organicky lepí.
 */
function g1024Spawn(api: PresetAPI): void {
  const COLS = 32;
  const ROWS = 32;
  const SPACING = 3;
  const xOff = ((COLS - 1) * SPACING) / 2;
  const yOff = ((ROWS - 1) * SPACING) / 2;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      api.spawn(col * SPACING - xOff, row * SPACING - yOff, 0, 0, 0, 0, 1, false);
    }
  }
}

export const PRESETS: Preset[] = [
  {
    id: 'e1',
    name: 'E1 — Pair attract (no rotation)',
    description:
      '2 pixely v (-2, 0) a (+2, 0), klid (vx=vy=rs=0), G=1, mode `not-align`. ' +
      'Stop @ 10 s. Očekávání: gravita přitáhne, kontakt → auto-joint, finální fixní ' +
      'obdélník v origin, pair distance ≈ 1 U (oba r=0 při kontaktu). ∑P=0, ∑L=0.',
    setup: (api) => {
      api.setIntegration('not-align');
      api.setG(1);
      api.setUseGrid(false);
      api.spawn(-2, 0, 0, 0, 0, 0, 1, false);
      api.spawn(+2, 0, 0, 0, 0, 0, 1, false);
    },
    stopAtTime: 10,
  },
  {
    id: 'e2',
    name: 'E2 — Pair attract (opposite spin)',
    description:
      'Jako E1 ale rs=+1 vlevo, rs=-1 vpravo. ∑L_init=0 (cancel). Po slepení joint sync ' +
      'rotaci páru → pair angvel = 0 (conservation). Pair distance > 1 U typically — pixely ' +
      'jsou rotated v okamžik kontaktu, anchor padne na midpoint v rotated geometrii. ' +
      'VĚRNÁ FYZIKA, ne bug: collision moment je determined by initial rotation. ' +
      'Pro identický 1 U pair viz E2align.',
    setup: (api) => {
      api.setIntegration('not-align');
      api.setG(1);
      api.setUseGrid(false);
      api.spawn(-2, 0, 0, 0, 0, +1, 1, false);
      api.spawn(+2, 0, 0, 0, 0, -1, 1, false);
    },
    stopAtTime: 10,
  },
  {
    id: 'e1align',
    name: 'E1 align — Pair attract (no rotation, snap)',
    description:
      'Jako E1 ale mode `align`. Při auto-jointu pos snap newer pixelu na 1 U distance ' +
      '+ edge-to-edge anchor + lockRotations. Pair distance přesně 1 U deterministicky. ' +
      'Pro E1 (no rotation) by mělo být identické s not-align variantou.',
    setup: (api) => {
      api.setIntegration('align');
      api.setG(1);
      api.setUseGrid(false);
      api.spawn(-2, 0, 0, 0, 0, 0, 1, false);
      api.spawn(+2, 0, 0, 0, 0, 0, 1, false);
    },
    stopAtTime: 10,
  },
  {
    id: 'e2align',
    name: 'E2 align — Pair attract (opposite spin, snap)',
    description:
      'Jako E2 ale mode `align`. Pixely rotují (rs=±1) během letu, ale při auto-joint align ' +
      'destruktivně snapne pos + r=0 → fixní obdélník 1 U distance, pair r=0. Rozdíl proti ' +
      'E2 not-align (pair distance ~1.3 U, pair r ≈ 2.5 rad) ukazuje cenu align: ztráta ' +
      'rotation memory + collision physics, výměnou za axis-aligned grid.',
    setup: (api) => {
      api.setIntegration('align');
      api.setG(1);
      api.setUseGrid(false);
      api.spawn(-2, 0, 0, 0, 0, +1, 1, false);
      api.spawn(+2, 0, 0, 0, 0, -1, 1, false);
    },
    stopAtTime: 10,
  },
  {
    id: 'e3',
    name: 'E3 — Rotating bar + spinning pixel',
    description:
      '4pixelová tyčka v (-3..0, 0) jako rigid body s ω=+1 rad/s (per-pixel vy = ω·Δx_rel ' +
      'kolem CoM v -1.5). Vpravo 1 pixel v (5, 0) v klidu, ω=-1 rad/s. Mode `not-align`, ' +
      'G=1, stop @ 10 s.\n' +
      'Initial: ∑P=0 (sym), ∑L=5.5 (orbital 5 + spin 0.5). ' +
      'Očekávání: gravita přitáhne pravý pixel k tyčce, kontakt → auto-joint, ∑P a ∑L ' +
      'zachovány do f32 šumu (joint preserve relative orientation).',
    setup: (api) => {
      api.setIntegration('not-align');
      api.setG(1);
      api.setUseGrid(false);
      const omega = 1;
      // Tyčka: 4 pixely v (-3, 0)..(0, 0), CoM v (-1.5, 0).
      // Rigid rotation: linvel pixelu = ω × r_rel = (0, ω·Δx, 0). vx=0 (Δy=0).
      const cmx = -1.5;
      const p0 = api.spawn(-3, 0, 0, omega * (-3 - cmx), 0, omega, 1, false);
      const p1 = api.spawn(-2, 0, 0, omega * (-2 - cmx), 0, omega, 1, false);
      const p2 = api.spawn(-1, 0, 0, omega * (-1 - cmx), 0, omega, 1, false);
      const p3 = api.spawn(0, 0, 0, omega * (0 - cmx), 0, omega, 1, false);
      api.connect(p0, p1);
      api.connect(p1, p2);
      api.connect(p2, p3);
      // Pravý pixel — opposite spin.
      api.spawn(5, 0, 0, 0, 0, -omega, 1, false);
    },
    stopAtTime: 10,
  },
  {
    id: 'e12',
    name: 'E12 — Magnet merge head-on (m=2 vs m=2)',
    description:
      '2 slepence m=2 head-on, axis-aligned, edges already in MAGNET_THRESHOLD při spawnu ' +
      '(distance 0.098 U). Slow v=±0.05 → magnet trigger v prvním display ticku (~0.5 s) ' +
      'PŘEDtím, než edges dosáhnou kontaktu (~0.98 s pro auto-joint). G=0, not-align, stop @ 3 s.\n' +
      'Initial: ∑P=0, ∑L=0, KE=0.005. Po inelastic merge: V_new=0, ω_new=0 → KE_after=0 ' +
      '(100% loss, head-on perfectně inelastic). Konzervace ∑P=0 ✓, ∑L=0 ✓.',
    setup: (api) => {
      api.setIntegration('not-align');
      api.setG(0);
      api.setUseGrid(false);
      // Slepenec A: pixely (-1.549, 0) a (-0.549, 0). A.right edge střed v (-0.049, 0).
      const a0 = api.spawn(-1.549, 0, +0.05, 0, 0, 0, 1, false);
      const a1 = api.spawn(-0.549, 0, +0.05, 0, 0, 0, 1, false);
      api.connect(a0, a1);
      // Slepenec B: pixely (+0.549, 0) a (+1.549, 0). B.left edge střed v (+0.049, 0).
      // Edge-to-edge distance = 0.098 < MAGNET_THRESHOLD = 0.1.
      const b0 = api.spawn(+0.549, 0, -0.05, 0, 0, 0, 1, false);
      const b1 = api.spawn(+1.549, 0, -0.05, 0, 0, 0, 1, false);
      api.connect(b0, b1);
    },
    stopAtTime: 3,
  },
  {
    id: 'e13',
    name: 'E13 — Magnet merge tečně (offset → spin emerge)',
    description:
      '2 single pixely letí proti sobě tečně s drobným Y offset (±0.05). Edges already ' +
      'in MAGNET_THRESHOLD (segment distance 0.098 U). Slow v=±0.05 → magnet trigger ' +
      'před auto-jointem. G=0, not-align, stop @ 3 s.\n' +
      'Initial: ∑P=0, ∑L=−0.005 (offset orbital momentum), KE=0.0025. Po inelastic merge: ' +
      'V_new=0, ω_new=L/I≈−0.0053 → spin EMERGE z čistě translačního pohybu. ' +
      'Test ∑L preservation: |∑L_after| ≈ 0.005 ✓, ne nula. KE_after ≈ 1e-5 (99.5% loss, ' +
      'většina KE rozplýtvána, malý zbytek v rotaci).',
    setup: (api) => {
      api.setIntegration('not-align');
      api.setG(0);
      api.setUseGrid(false);
      api.spawn(-0.549, +0.05, +0.05, 0, 0, 0, 1, false);
      api.spawn(+0.549, -0.05, -0.05, 0, 0, 0, 1, false);
    },
    stopAtTime: 3,
  },
  {
    id: 'g1024',
    name: 'Grid 1024 — 32×32 čtverec',
    description:
      '1024 pixelů v 32×32 axis-aligned gridu, spacing 3 U (range ~93 U). Stůl v klidu. ' +
      'Ve `without-interaction` čistý gravitační kolaps; v `not-align` se cluster ' +
      'organicky lepí. Cutoff factor naladí slider v SETTINGS — pozor, hard cutoff je culling, ' +
      'ne approximation.',
    setup: (api) => {
      api.setIntegration('without-interaction');
      api.setG(1.0);
      api.setUseGrid(true);
      g1024Spawn(api);
    },
  },
];

/** Stav modelu serializovaný pro export do chatu. */
export type Modelshot = {
  version: 1;
  preset: string | null;
  integration: IntegrationMode;
  simTime: number;
  params: { G: number; H: number; epsilon: number; substeps: number };
  pixels: { id: number; x: number; y: number; vx: number; vy: number; r: number; rs: number; m: number }[];
  /**
   * `pe` = potenciální energie (z gravity kernelu, včetně případného window faktoru).
   * Bez `pe` nelze ověřit zachování ∑E = KE + PE — KE samo o sobě osciluje s PE.
   */
  diagnostics: { px: number; py: number; L: number; ke: number; pe: number };
};

export function buildModelshot(
  world: World,
  presetId: string | null,
  integration: IntegrationMode,
  simTime: number,
  G: number,
  H: number,
  epsilon: number,
  substeps: number,
  diag: { px: number; py: number; L: number; ke: number; pe: number },
): Modelshot {
  return {
    version: 1,
    preset: presetId,
    integration,
    simTime,
    params: { G, H, epsilon, substeps },
    pixels: world.pixels.map((p) => {
      const t = p.body.translation();
      const v = p.body.linvel();
      return {
        id: p.id,
        x: t.x,
        y: t.y,
        vx: v.x,
        vy: v.y,
        r: p.body.rotation(),
        rs: p.body.angvel(),
        m: p.m,
      };
    }),
    diagnostics: diag,
  };
}
