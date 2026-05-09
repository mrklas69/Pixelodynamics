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
 *                            Magnet merge (Stage 2) zachovává ∑P + ∑L explicit math.
 *   - `align`                Composite-driven kinematics (Stage 3 + 3.2). Při auto-jointu
 *                            nebo magnet mergi rigid-transformuje menší řetězec do host
 *                            local frame (∑P preserved, ω = 0 explicit). `compositeTheta`
 *                            sdílen members slepence; `stepCompositesAlign` per-tick
 *                            override pos/rot/linvel/angvel z aggregate state. Sezení 16:
 *                            full free-edge enumeration (snake-growth fix) + secondary
 *                            joint detection po každém primary jointu (2D shape rust).
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
 * Pravidelný axis-aligned čtvercový grid pixelů. Použito pro G100 (10×10) a G1024 (32×32).
 * Spacing 3 U je dostatečný odstup, aby gravita měla viditelný kolaps i v krátkém horizontu.
 */
function gridSpawn(api: PresetAPI, cols: number, rows: number, spacing: number): void {
  const xOff = ((cols - 1) * spacing) / 2;
  const yOff = ((rows - 1) * spacing) / 2;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      api.spawn(col * spacing - xOff, row * spacing - yOff, 0, 0, 0, 0, 1, false);
    }
  }
}

export const PRESETS: Preset[] = [
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
    id: 'e14',
    name: 'E14 — Chain-chain merge align (Stage 3.1)',
    description:
      '2 horizontální chainy m=3 v align mode, head-on s drobným Y offsetem 0.07 U. ' +
      'Chain A: (-3.5, 0)..(-1.5, 0), vx=+0.5. Chain B: (+1.5, 0.07)..(+3.5, 0.07), vx=-0.5. ' +
      'Po contactu auto-joint mezi rightmost A a leftmost B v align modu spustí Stage 3.1 ' +
      'rigid-transform: chain B (menší tiebreak: aIsHost true při equal length) přeloží o ' +
      '(Tx≈-2, Ty=-0.07) → 6-pixelový chain na (-3.5..+1.5), Y=0, 1U distance přesně.\n' +
      'G=0, stop @ 8 s. Initial: ∑P=0 (sym), ∑L=0.105 (Y-offset orbital v B), KE=0.75. ' +
      'After: ∑P=0 ✓, V=0, ω=0 (∑L loss explicitní v align paradigm), KE=0 (100% inelastic).',
    setup: (api) => {
      api.setIntegration('align');
      api.setG(0);
      api.setUseGrid(false);
      const a0 = api.spawn(-3.5, 0, +0.5, 0, 0, 0, 1, false);
      const a1 = api.spawn(-2.5, 0, +0.5, 0, 0, 0, 1, false);
      const a2 = api.spawn(-1.5, 0, +0.5, 0, 0, 0, 1, false);
      api.connect(a0, a1);
      api.connect(a1, a2);
      const b0 = api.spawn(+1.5, 0.07, -0.5, 0, 0, 0, 1, false);
      const b1 = api.spawn(+2.5, 0.07, -0.5, 0, 0, 0, 1, false);
      const b2 = api.spawn(+3.5, 0.07, -0.5, 0, 0, 0, 1, false);
      api.connect(b0, b1);
      api.connect(b1, b2);
    },
    stopAtTime: 8,
  },
  {
    id: 'e15',
    name: 'E15 — Align rotation test (chain m=3, ω=+1, synthetic)',
    description:
      'Synthetic test Stage 3.2 explicit theta drift na ω≠0 v align mode, G=0.\n' +
      'Chain m=3 sestavený v align modu: pixely (-1, 0), (0, 0), (+1, 0). createFixedJoint' +
      '(align=true) má ω=0 paradigm — fresh-fresh setAngvel(0), fresh+chain velocity ' +
      'unification → po `connect()` všechny linvel=0, angvel=0. Naturally tedy v current ' +
      'architektuře nelze v align mode vyrobit composite s ω≠0 (magnet, auto-joint, preset ' +
      'connect — všichni přes stejnou cestu).\n' +
      'Synthetic injection: po assembly přímo přes `Pixel.body` nastavíme rigid-body ' +
      'initial state (linvel = ω × r_rel, angvel = ω). Simuluje budoucí Fázi 4+ trigger ' +
      '(external impulse). Stage 3.2 první display tick: c.angvel = L/I = 2.5/2.5 = 1 → ' +
      'compositeTheta drift přes ω·dt.\n' +
      'Initial: ∑P=0, ∑L=2.5, KE=1.25. Stop @ 10 s. Po 10 s: θ ≈ 10 rad ≈ 1.59 otáček. ' +
      'distance(p0,p1) = distance(p1,p2) = 1.000 U přesně (compositeTheta sdílen). ' +
      'Individual `r` členů = θ_composite. ω drift ≈ f32 ulp. ∑P/∑L/KE preserved.',
    setup: (api) => {
      api.setIntegration('align');
      api.setG(0);
      api.setUseGrid(false);
      const omega = 1;
      // Spawn s nulovými velocities — connect v align modu je stejně zničí.
      const p0 = api.spawn(-1, 0, 0, 0, 0, 0, 1, false);
      const p1 = api.spawn(0, 0, 0, 0, 0, 0, 1, false);
      const p2 = api.spawn(+1, 0, 0, 0, 0, 0, 1, false);
      api.connect(p0, p1);
      api.connect(p1, p2);
      // Synthetic injection — rigid rotation kolem CoM=(0,0) s ω=+1 rad/s.
      // v = ω × r_rel: v 2D vx=-ω·y_rel, vy=+ω·x_rel. CoM=(0,0), r_rel=(x,0) → vx=0, vy=ω·x.
      p0.body.setLinvel({ x: 0, y: omega * -1 }, true);
      p1.body.setLinvel({ x: 0, y: 0 }, true);
      p2.body.setLinvel({ x: 0, y: omega * +1 }, true);
      p0.body.setAngvel(omega, true);
      p1.body.setAngvel(omega, true);
      p2.body.setAngvel(omega, true);
    },
    stopAtTime: 10,
  },
  {
    id: 'g100',
    name: 'Grid 100 — 10×10 čtverec',
    description:
      '100 pixelů v 10×10 axis-aligned gridu, spacing 3 U (range ~27 U). Menší sourozenec ' +
      'G1024 — rychlejší kolaps, viditelnější detail. Ve `without-interaction` čistá ' +
      'gravitační dynamika bez kontaktů; v `not-align` cluster organicky lepí.',
    setup: (api) => {
      api.setG(1.0);
      api.setUseGrid(true);
      gridSpawn(api, 10, 10, 3);
    },
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
      api.setG(1.0);
      api.setUseGrid(true);
      gridSpawn(api, 32, 32, 3);
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
