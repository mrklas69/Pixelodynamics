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
  /**
   * Přepne mezi uniform spatial grid (true, default) a naivní O(N²) gravitou.
   * Naivní je nutná pro experimenty s párovou interakcí > cutoff (~7.5 U).
   */
  setUseGrid: (b: boolean) => void;
  /**
   * Spawn pixelu s plně explicitními atributy.
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
  ) => void;
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
    stopAtTime: 30,
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
      // Naive O(N²) — historický baseline ze sezení 3, kdy spatial grid neexistoval.
      // Bez explicitního setUseGrid by E5m visel na default GRAVITY_USE_GRID (po sezení 4 = true)
      // a tichá změna by zfalšovala srovnání s hybridem.
      api.setUseGrid(false);
      e5Spawn(api);
    },
    stopAtTime: 60,
  },
  {
    id: 'e7n',
    name: 'E7n — Grid validace: naive baseline',
    description:
      '12 pixelů ve 4×3 gridu (spacing 6 U, range 18×12 U), manual Euler, naive O(N²) gravita. Většina párů (49 ze 66) je za cutoff 7.5 U — referenční pole pro porovnání s gridem v E7g. Stejný spawn = bit-by-bit diff modelshotů.',
    setup: (api) => {
      api.setIntegration('manual');
      api.setG(1.0);
      api.setUseGrid(false);
      e7Spawn(api);
    },
    stopAtTime: 60,
  },
  {
    id: 'e7g',
    name: 'E7g — Grid validace: spatial grid',
    description:
      'Stejný setup jako E7n, ale s GRAVITY_USE_GRID=true. Hard cutoff 7.5 U vyřízne 49 ze 66 párů. Měříme: (a) ∑P/∑L drift na f64 floor jako E7n? (b) KE drift sekulární vs. oscilační? (c) divergence trajektorií od chaosu po f64 ulp na hraně cutoffu.',
    setup: (api) => {
      api.setIntegration('manual');
      api.setG(1.0);
      api.setUseGrid(true);
      e7Spawn(api);
    },
    stopAtTime: 60,
  },
  {
    id: 'e6',
    name: 'E6 — Lagrange L1',
    description:
      '30 pixelů (m=1) PINNED v (-10, 0) → cluster m=30, 1 pixel PINNED v (+10, 0), volný test pixel na L1 (Plummer-corrected, ≈+7.43). Cluster + singlet jsou pinned, jinak by se stáhli a problém zanikl. Naive gravita (grid cutoff 7.5 U). L1 je SADDLE (τ ≈ 4 s) — z f32 ulp drift po 30 s ~0.5 mU = pod 1 px, po 60 s už nelineární kollaps.',
    setup: (api) => {
      api.setIntegration('manual');
      api.setG(1.0);
      api.setUseGrid(false); // grid hard cutoff (5·ε = 7.5 U) by odřízl 12.6 U cluster-test gravitu
      e6Spawn(api);
    },
    stopAtTime: 30,
  },
  {
    id: 'pb500',
    name: 'PB500 — perf benchmark (N=500)',
    description:
      '500 pixelů v √N čtvercovém gridu, spacing 3 U (range ~66 U). G=1, manual + grid. Stůl v klidu. Cutoff factor naladí slider v SETTINGS (3–12·ε). Auto-stop @ 5 s, modelshot pro ∑E ověření; FPS sleduj v STATS panelu.',
    setup: (api) => {
      api.setIntegration('manual');
      api.setG(1.0);
      api.setUseGrid(true);
      pbSpawn(api, 500, 3);
    },
    stopAtTime: 30,
  },
  {
    id: 'pb1000',
    name: 'PB1000 — perf benchmark (N=1000)',
    description:
      '1000 pixelů v √N čtvercovém gridu, spacing 3 U (range ~93 U). G=1, manual + grid. Cutoff factor naladí slider. Auto-stop @ 5 s. Stejný protokol jako PB500.',
    setup: (api) => {
      api.setIntegration('manual');
      api.setG(1.0);
      api.setUseGrid(true);
      pbSpawn(api, 1000, 3);
    },
    stopAtTime: 30,
  },
];

/**
 * Benchmark spawn — N pixelů v deterministickém grid layoutu (cols × rows ≥ N),
 * centred kolem (0,0). Spacing volený tak, aby ~část párů padla pod cutoff
 * a ~část nad → grid má co kullovat. Pixely v klidu (vx=vy=0, rs=0).
 */
function pbSpawn(api: PresetAPI, n: number, spacing: number): void {
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const xOff = ((cols - 1) * spacing) / 2;
  const yOff = ((rows - 1) * spacing) / 2;
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    api.spawn(col * spacing - xOff, row * spacing - yOff, 0, 0, 0, 0, 1, false);
  }
}

/**
 * E6 spawn: cluster + singlet + test pixel přesně na L1 pro Plummer kernel.
 *
 * L1 podmínka (mezi M1 a M2 v ose, vzdálenost D, softening ε):
 *   M1 / (r² + ε²)^{3/2}  =  M2 / ((D-r)² + ε²)^{3/2}
 * kde r je vzdálenost od M1. Pro klasický 1/r² (ε=0) by bylo r = D / (1 + √(M2/M1));
 * s Plummer ε ≠ 0 řešíme bisekcí. Konvergence: 60 iter dá ulp-přesnou polohu.
 */
function e6Spawn(api: PresetAPI): void {
  const D = 20;
  const clusterX = -10;
  const singletX = 10;
  const eps = 1.5; // shoduje se s GRAVITY_EPSILON v params.ts
  const M1 = 30;
  const M2 = 1;

  // Cluster: 30 PINNED pixelů na jednom bodě. m_cluster total = 30.
  for (let i = 0; i < M1; i++) api.spawn(clusterX, 0, 0, 0, 0, 0, 1, true);
  // Singlet: PINNED, m=1. Zaručuje statický binární potenciál.
  api.spawn(singletX, 0, 0, 0, 0, 0, 1, true);

  // Plummer force per unit mass na vzdálenosti r od bodu hmoty M je G·M·r / (r² + ε²)^{3/2}.
  // L1 mezi M1 (vzdálenost r1) a M2 (vzdálenost r2 = D - r1):
  //   M1·r1 / (r1²+ε²)^{3/2}  =  M2·r2 / (r2²+ε²)^{3/2}
  //
  // Pro Plummer kernel má rovnice **tři** kořeny v (0, D):
  //   1) r ≈ ε² · M2 / (M1·D²)  — falešný L-bod uvnitř Plummer ε na cluster straně
  //   2) r ≈ klasický L1         — fyzický L1 (chtěný)
  //   3) blízko D                 — falešný L-bod na singlet straně
  // Klasický 1/r² má jen kořen 2). Bisekci proto musíme limitovat na okolí klasické
  // hodnoty, jinak konverguje k jednomu z falešných kořenů.
  const rClassical = D / (1 + Math.sqrt(M2 / M1));
  const eps2 = eps * eps;
  // Rozsah ±2ε kolem klasické hodnoty bezpečně odděluje pravý L1 od falešných.
  let lo = Math.max(1e-3, rClassical - 2 * eps);
  let hi = Math.min(D - 1e-3, rClassical + 2 * eps);
  // Predikát: f(lo) > 0 (cluster pull dominant), f(hi) < 0 (singlet pull dominant).
  // Pokud f(mid) > 0 → mid leží v "lo" oblasti → posun lo = mid.
  for (let i = 0; i < 80; i++) {
    const r = (lo + hi) / 2;
    const r2 = D - r;
    const f1 = (M1 * r) / Math.pow(r * r + eps2, 1.5);
    const f2 = (M2 * r2) / Math.pow(r2 * r2 + eps2, 1.5);
    if (f1 > f2) lo = r;
    else hi = r;
  }
  const r = (lo + hi) / 2;

  // Sanity check: net force na test pos by měla být <= ulp roundoff.
  const r2 = D - r;
  const f1 = (M1 * r) / Math.pow(r * r + eps2, 1.5);
  const f2 = (M2 * r2) / Math.pow(r2 * r2 + eps2, 1.5);
  // Pomáhá při nesouladu params (např. změna ε): occurs in dev, neházet hard error v produkci.
  if (Math.abs(f1 - f2) > 1e-12) {
    console.warn(`E6 L1 bisection residual ${(f1 - f2).toExponential(3)} (>1e-12)`);
  }

  // Test pixel: free (default pinned=false).
  api.spawn(clusterX + r, 0, 0, 0, 0, 0, 1);
}

/**
 * Sdílený spawn pro E7n/E7g — 4×3 grid, spacing 6 U, range 18×12 U.
 *
 * Distribuce párů vůči cutoff 5·ε = 7.5 U (`GRAVITY_CUTOFF_FACTOR=5`, ε=1.5):
 *   - 17 sousedních párů (dx=6 nebo dy=6, druhá osa 0) → uvnitř cutoff
 *   - 49 vzdálenějších párů (dx²+dy² ≥ 72 U²) → mimo cutoff
 *
 * E5/E5m D4 setup měl všechny páry pod cutoff → grid implementace tam dávala
 * bit-identický výsledek jako naive a nedalo se nic změřit. Tahle konfigurace
 * vynucuje, aby grid skutečně skipoval většinu párů.
 *
 * Počáteční rychlosti = 0 → systém se v gravitaci postupně rozkmitá. Chaos je
 * žádoucí: ulp roundoff na hranicích cutoff se exponenciálně amplifikuje a
 * trajektorie pixelů se rozejdou viditelně, pokud je kernel rozbitý.
 */
function e7Spawn(api: PresetAPI): void {
  const cols = 4;
  const rows = 3;
  const spacing = 6;
  const offsetX = ((cols - 1) * spacing) / 2;
  const offsetY = ((rows - 1) * spacing) / 2;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      api.spawn(col * spacing - offsetX, row * spacing - offsetY, 0, 0, 0, 0);
    }
  }
}

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
  /**
   * `pe` = potenciální energie (z gravity kernelu, včetně případného window faktoru).
   * Bez `pe` nelze ověřit zachování ∑E = KE + PE — KE samo o sobě osciluje s PE.
   * Pro mód `rapier` je `pe` typicky 0 (presety E1–E3 mají G=0).
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
