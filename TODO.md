# TODO

Markery: `[ ]` čeká · `[~]` rozděláno · `[x]` hotovo · `[!]` priorita.

## Fáze 2 — pixelová gravitace

- [x] Párová Newtonova gravitace s Plummer softeningem
- [x] UI slider pro G; ε a substeps schované jako programové konstanty (`params.ts`)
- [x] Manuální symplektický Eulerův integrátor (Rapier step() obejít) — zachovává ∑P a ∑L
- [x] Substepping (4× per frame) pro nižší truncation error
- [x] Profilovat: jak vysoké N zvládne current naive O(n²) kód — P100=60, P500=60, P1000=45, P2000=12 (sezení 3, manual mód, G=1)
- [x] Spatial grid (uniform + cutoff) — sezení 4. Cutoff = 5·ε ≈ 7.5 U.
- [x] Validovat spatial grid empiricky — sezení 5. E7n/E7g preset pair s 4×3 spread spawn (49/66 párů přes cutoff). E5 D4 setup byl nediskriminační (všechny páry < cutoff → grid≡naive). Klíčový závěr: grid je **culling decision** pro long-range gravitaci, ne approximation — pro spread setup KE/pos dramaticky odlišné (KE 1.73 vs. 3.77, radii 24 U vs. 10 U).
- [x] Smoothstep tail (sezení 5) — `GRAVITY_TAIL_WIDTH = 1.0`, default zapnutý. 3-2 polynom W(r), force = -dU_mod/dr rigorózně (∑E drift 1e-3/60s, OK). Pozn.: smoothstep řeší **energy conservation across cutoff**, ne approximation quality.
- [x] Vizualizace centroidu jako křížek — sezení 7. CSS overlay (16×16 px screen-fixed) přes `<div class="centroid">`. `computeCentroid` v diagnostics, `worldToScreen` v camera.ts. Po fázi 3 přepracovat na per-object.

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
- [x] Total energy E = KE + PE — sezení 6: ∑E + Δ∑E v STATS panelu, E₀ se zachytí při prvním display ticku po prvním sim kroku (PE platná). KE rozšířena o rotační složku ½·I·ω² (I=m/6).
- [x] Vyhodnotit `GRAVITY_CUTOFF_FACTOR` — sezení 7. Benchmark M(PB1000, c={5,8,10}, t={5,10,20,30}) odhalil **density-bound strop**: po kolapsu shluku všechny cutoffy konvergují na 20 FPS bez ohledu na hodnotu. Default c=5 zůstává. Pro fázi 6+ rozprostřený plyn (rovnoměrná density) lze klidně zvýšit na 8-10. Slider `cutoff` v SETTINGS pro live tuning.

## Dokumentace

- [x] README — stack tabulka, conservation status, perf čísla, ovládání, struktura
- [x] `docs/MODEL.md` — formální popis modelu (Newton + Plummer, symplektický Euler, substepping, jednotky, reference)

## Infrastruktura

- [ ] ESLint + Prettier konfigurace
- [ ] Vitest setup (až bude první testovatelná pure funkce — pickPixel, fmtSig4)
- [ ] Touch / pinch zoom pro mobil
- [ ] Adaptivní limit počtu pixelů podle FPS
- [ ] Performance budget: target 60 FPS @ 1000 pixelů na desktopu — měřit po spatial grid validaci
- [x] Pages deploy verifikace — sezení 6: 5/5 deployů success, root + bundles HTTP 200, base path `/Pixelodynamics/` korektní. Live na https://mrklas69.github.io/Pixelodynamics/.

## Hotovo

(viz [DONE.md](./DONE.md))
