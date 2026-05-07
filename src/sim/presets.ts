// Presety = reprodukovatelné experimentální scénáře.
//
// Každý preset přesně definuje počáteční stav: clear scény, set parametrů,
// explicitní spawn pixelů, výběr integračního módu, případný auto-stop.
// Žádný random — pro určení "co Rapier interně dělá" potřebujeme deterministické vstupy.
//
// Po dosažení `stopAtTime` (sim sekundy) se simulace pauzne a stav se
// auto-exportuje do clipboardu jako JSON modelshot.

import type { World } from './physics';

/**
 * Integrační mód určuje, jakým způsobem se aktualizují pos/vel pixelů:
 *   - `manual`  jen náš symplektický Euler (gravitace pozadí); Rapier step() se nevolá.
 *               Stav fáze 2.
 *   - `rapier`  jen `world.step(dt)` — Rapier interní integrátor + constraints/contacts.
 *               Pro experimenty E1–E4: měříme co Rapier dělá sám o sobě.
 *   - `hybrid`  manuální gravitace POSTERIORITY + `world.step(dt)`.
 *               Pro E5: zjišťujeme drift ∑P/∑L kombinovaného loopu.
 */
export type IntegrationMode = 'manual' | 'rapier' | 'hybrid';

export type PresetAPI = {
  /** Vrátí gravitační konstantu G (parametr SETTINGS). */
  setG: (g: number) => void;
  /** Vrátí konstantu vazby H (zatím nepoužitá, fáze 3+). */
  setH: (h: number) => void;
  /** Přepne integrační mód (viz `IntegrationMode`). */
  setIntegration: (mode: IntegrationMode) => void;
  /** Spawn pixelu s plně explicitními atributy. */
  spawn: (x: number, y: number, vx: number, vy: number, r: number, rs: number, m?: number) => void;
};

export type Preset = {
  id: string;
  name: string;
  description: string;
  setup: (api: PresetAPI) => void;
  /** Auto-pause + auto-export po dosažení tohoto sim času. */
  stopAtTime?: number;
};

export const PRESETS: Preset[] = [
  {
    id: 'e1',
    name: 'E1 — Rapier baseline',
    description:
      '2 pixely, gravity=0, no joints/contacts, manual linvel=0. Měříme: mění Rapier sám pos/vel? (default damping, CCD, …)',
    setup: (api) => {
      api.setIntegration('rapier');
      api.setG(0);
      api.spawn(-5, 0, 0, 0, 0, 0);
      api.spawn(+5, 0, 0, 0, 0, 0);
    },
    stopAtTime: 10,
  },
  {
    id: 'e2',
    name: 'E2 — Rapier velocity damping',
    description:
      '2 pixely, gravity=0, no joints/contacts, manual linvel=(1, 0). Měříme: tlumí Rapier rychlost? (linearDamping)',
    setup: (api) => {
      api.setIntegration('rapier');
      api.setG(0);
      api.spawn(-5, 0, 1, 0, 0, 0);
      api.spawn(+5, 0, 0, 0, 0, 0.5); // i s nenulovou angvel — kontrola angularDamping
    },
    stopAtTime: 10,
  },
  {
    id: 'e3',
    name: 'E3 — FixedJoint reakce',
    description:
      '2 pixely + FixedJoint mezi nimi, jeden kopnu. Druhý reaguje? ∑P drží? (TODO: joint tvorba — zatím setup bez jointu)',
    setup: (api) => {
      api.setIntegration('rapier');
      api.setG(0);
      api.spawn(-0.5, 0, 0, 0, 0, 0);
      api.spawn(+0.5, 0, 1, 0, 0, 0);
      // Joint API zatím neimplementováno (fáze 3 work). E3 zatím slouží jako geometrický baseline.
    },
    stopAtTime: 5,
  },
  {
    id: 'e5',
    name: 'E5 — Hybrid gravity + Rapier',
    description:
      '12 pixelů ve volné konfiguraci, manuální gravitace + Rapier step (no joints). Měříme: drift ∑P/∑L oproti čistě manuálnímu loopu (sezení 2).',
    setup: (api) => {
      api.setIntegration('hybrid');
      api.setG(1.0);
      e5Spawn(api);
    },
    stopAtTime: 60,
  },
  {
    id: 'e5m',
    name: 'E5m — Manual (baseline pro E5)',
    description:
      'Stejná konfigurace jako E5 a stejný simTime, ale jen manuální Euler (žádný Rapier step). Slouží jako baseline pro odhalení double-integration v hybridu.',
    setup: (api) => {
      api.setIntegration('manual');
      api.setG(1.0);
      e5Spawn(api);
    },
    stopAtTime: 60,
  },
];

/** Sdílený spawn 12 pixelů v D4 symetrii (E5 a E5m musí mít bit-identický setup). */
function e5Spawn(api: PresetAPI): void {
  const positions: [number, number][] = [
    [-3, -3], [0, -3], [3, -3],
    [-3, 0], [3, 0],
    [-3, 3], [0, 3], [3, 3],
    [-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5],
  ];
  for (const [x, y] of positions) api.spawn(x, y, 0, 0, 0, 0);
}

/** Perf-test: N pixelů ve čtvercovém gridu se spacingem 4 U, počátek v centru. */
function perfSpawn(api: PresetAPI, n: number): void {
  const cols = Math.ceil(Math.sqrt(n));
  const spacing = 4;
  const offset = ((cols - 1) * spacing) / 2;
  let placed = 0;
  for (let row = 0; row < cols && placed < n; row++) {
    for (let col = 0; col < cols && placed < n; col++) {
      api.spawn(col * spacing - offset, row * spacing - offset, 0, 0, 0, 0);
      placed++;
    }
  }
}

// Performance presety: měříme, kdy O(N²) párová gravita začne sytit 60 FPS.
// Žádný stopAtTime — user sleduje FPS v STATS panelu, hlásí steady-state.
PRESETS.push(
  ...[100, 500, 1000, 2000].map((n): Preset => ({
    id: `p${n}`,
    name: `P${n} — Perf ${n} pixelů`,
    description: `${n} pixelů ve čtvercovém gridu, manual + O(N²) gravita s G=1. Sleduj FPS.`,
    setup: (api) => {
      api.setIntegration('manual');
      api.setG(1.0);
      perfSpawn(api, n);
    },
  })),
);

/** Stav modelu serializovaný pro export do chatu. */
export type Modelshot = {
  version: 1;
  preset: string | null;
  integration: IntegrationMode;
  simTime: number;
  params: { G: number; H: number; epsilon: number; substeps: number };
  pixels: { id: number; x: number; y: number; vx: number; vy: number; r: number; rs: number; m: number }[];
  diagnostics: { px: number; py: number; L: number; ke: number };
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
  diag: { px: number; py: number; L: number; ke: number },
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
