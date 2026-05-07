# TODO

Markery: `[ ]` čeká · `[~]` rozděláno · `[x]` hotovo · `[!]` priorita.

## Fáze 2 — pixelová gravitace

- [x] Párová Newtonova gravitace s Plummer softeningem
- [x] UI slider pro G; ε a substeps schované jako programové konstanty (`params.ts`)
- [x] Manuální symplektický Eulerův integrátor (Rapier step() obejít) — zachovává ∑P a ∑L
- [x] Substepping (4× per frame) pro nižší truncation error
- [x] Profilovat: jak vysoké N zvládne current naive O(n²) kód — P100=60, P500=60, P1000=45, P2000=12 (sezení 3, manual mód, G=1)
- [x] Spatial grid (uniform + cutoff) — sezení 4. Cutoff = 5·ε ≈ 7.5 U. Hard cutoff bez smooth tail; ∑P/∑L exact, KE má drobné skoky při krossování cutoffu.
- [ ] Validovat spatial grid empiricky — preset srovnání naive vs. grid na E5 setupu (12 pix, 60 s). Naměřit ∑P/∑L drift a `simTime` per frame.
- [ ] Smoothstep tail na poslední 1 U cutoffu — opt-in pokud KE drift v rozprostřené scéně bude problém. Polynomial 3-2 spline na force i potenciálu.
- [ ] Vizualizace centroidu jako křížek

## Fáze 3 — slepování

- [ ] **Hybrid orchestrace** — naive `manuální stepGravity + Rapier.step()` empiricky vyloučen v sezení 3 (E5 vs. E5m: hybrid běží násobně rychleji, ∑P/∑L drift 10⁴× horší kvůli f32 bridge). Volba mezi (α/β/γ) viz IDEAS, rozhodnutí až s reálným joint scénářem.
- [ ] Detekce „dotyku po straně" — collisionGroups zapnout, contact event
- [ ] FixedJoint mezi sousedy (parametr `H` ze SETTINGS = stiffness)
- [ ] Vizualizace vazeb — pixel rámeček s **vynechanou hranou** ve směru spoje. Edge mask 4 bits (N/E/S/W) per pixel, dynamicky updatovat při joint změně.
- [ ] Edge case: jeden pixel slepený se 2+ sousedy → struktura, ne řetězec
- [ ] **Composite object dataset** (viz IDEAS.md) — `id, pixelIds, x, y, vx, vy, r, rs, m, I`. Update centroidu při změně topologie nebo per-tick.
- [ ] Wire up Largest a Connections counters do STATS
- [ ] Hover infotipy rozšířit na CompositeObject (až budou)

## Fáze 4 — hmotnost a pružnost

- [ ] Pixel `m` parametr (zatím konstantní 1)
- [ ] Distance/spring joint místo FixedJoint pro pružnost
- [ ] Damping

## Fáze 5 — rozbití

- [ ] Sledovat impulse na jointu
- [ ] Threshold → joint.remove()
- [ ] Test scénář: rotující slepenec se odstředivkou trhá

## UI / Diagnostika

- [x] STATS panel — Time, Pixels, Objects, Connections, ∑P, ∑L
- [x] FACTS panel — Fastest, Spinniest, Most momentum, Most ang. mom., Most massive (klik = lock kamery)
- [x] Home camera (návrat na 0,0)
- [x] Lock kamera na pixel (klik na #ID), Esc / WASD odemkne
- [x] HUD status — `lock #ID / free · x · y · zoom`
- [x] STATS: 4 platné číslice (interně f64, displej `fmtSig4`)
- [x] Patička (centrovaná, dvouřádková, název aplikace + licence + repo)
- [x] Pixely jako rámečky (hybrid border max(0.05U, 1px), připraveno pro vis. spojů)
- [x] Hover infotipy nad pixely (id, x, y, vx, vy, r, rs, m, |v|)
- [ ] Largest (Most-pixels-in-object) — až budou objekty
- [ ] Connections counter — až budou jointy
- [ ] Total energy E = KE + PE (validace integrátoru)

## Dokumentace

- [x] README — stack tabulka, conservation status, perf čísla, ovládání, struktura
- [x] `docs/MODEL.md` — formální popis modelu (Newton + Plummer, symplektický Euler, substepping, jednotky, reference)

## Infrastruktura

- [ ] ESLint + Prettier konfigurace
- [ ] Vitest setup (až bude první testovatelná pure funkce — pickPixel, fmtSig4)
- [ ] Touch / pinch zoom pro mobil
- [ ] Adaptivní limit počtu pixelů podle FPS
- [ ] Performance budget: target 60 FPS @ 1000 pixelů na desktopu — měřit po spatial grid validaci
- [ ] Pages deploy verifikace (otevřená dluh ze sezení 1)

## Hotovo

(viz [DONE.md](./DONE.md))
