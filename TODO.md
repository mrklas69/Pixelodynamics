# TODO

Markery: `[ ]` čeká · `[~]` rozděláno · `[x]` hotovo.

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

- [x] **FixedJoint API** — `createFixedJoint(world, a, b)` + `removeJoint` v `src/sim/joints.ts` (sezení 8). Anchor = midpoint mezi centry, frame parametr preserve aktuální rotation gap (žádný snap při create).
- [x] **Audio při create/break** — `playClick()` z `src/audio/sfx.ts`, pool 5 instancí. Sezení 8.
- [x] **Vizualizace vazeb** — edge mask 4-bit per pixel (sezení 8), maskovaná hrana se kreslí červeně `#d86f6f`. Per-instance attribute v rendereru, FS check minDist vs mask. Po fázi 3 detekci kontaktů se mask aplikuje automaticky.
- [x] **Connections counter** — wire-up `world.joints.length` v display ticku + tlačítkách (sezení 8).
- [x] **Manuální connect/disconnect tlačítka** — 🔗 Spojit poslední 2, ✂ Rozpojit vše (sezení 8). Pro testovací scénáře bez kontaktové detekce.
- [x] **Default `canSleep=false`** — sezení 8. Sleep mode v Rapieru způsobil 100% dissipaci joint dynamics v default E3 baseline. Není potřeba pro fyzikální sandbox.
- [x] **Hybrid orchestrace** — Stage 2 hotová (sezení 9). E8r/E8α/E8β sweep: **α (Velocity-Verlet split) winner** — ∑E drift 0.04 %/30 s, joint distance preserve, rs=0.32 (gravita-induced precesní moment). β (save-zero-restore) broken — ∑E drift 13 %, rs ≈ 0 (joint solver nevidí stress). γ (SKIP_RAPIER_IF_NO_JOINTS) jako orthogonal flag, default true. UI default integration mode změněn na `hybrid-α`.
- [x] Detekce „dotyku po straně" — sezení 10. `AUTO_JOINT_ON_CONTACT=true` v `params.ts`, collision groups + ActiveEvents na všech pixelech, drainAndAutoJoint v main loopu, `setContactsEnabled(false)` na joint (řeší E3 drift z dual constraint). γ flag zohledňuje auto-joint (rapier.step() musí běžet pro broadphase). E10 head-on + E11 trio empiricky validovány.
- [x] Edge case: jeden pixel slepený se 2+ sousedy → struktura, ne řetězec. E11 ověřilo: prostřední pixel má 2 jointy (-X +X bity = 3 v edge mask), edge mask renderer to už podporoval ze sezení 8.
- [x] **Composite object dataset (Stage 1)** — sezení 11. `src/sim/composite.ts`: Composite type (id, members, com, linvel, angvel, mass, inertia s parallel axis theorem), buildComposites přes Union-Find, freeEdges (4 strany pixelu mínus shared via joint anchor dominantní osa), segmentDistance (Christer Ericson §5.1.9), detectMergeCandidates per-pair edge proximity. Per-display-tick (5 Hz) call, "Merge cand." badge v STATS. **Detection only, no merge yet.**
- [x] **Magnetic merge Stage 2** — sezení 12. `applyMerge(world, candidate)` v `composite.ts`: M_new, CoM_new, V_new, ω_new přes parallel axis theorem. Snap pixel linvel/angvel na rigid-body kinematics, create FixedJoint mezi candidate edge pair. Skip pinned, gate `integration === 'not-align'` (magnet+align konflikt position-preserving vs position-snapping). E12 (head-on m=2 vs m=2, ∑P=0/∑L=0/KE=0) + E13 (tečně offset, spin emerge ω≈-0.0053, ∑L=-0.005 preserved do f32 ulp) verified.
- [x] **Magnetic merge Stage 3 MVP** — sezení 12. `Pixel.compositeOffsetX/Y` (stable local offset v composite frame), `recomputeCompositeOffsets` v `createFixedJoint(align=true)` BFS přes joints po pos/rot snap, `stepCompositesAlign(world)` po Rapier step override pos/rot/linvel/angvel z aggregate state. 6-pixel chain v G=20 po 60 s: 1.000 U distances přesně, composite rotates synchronně (joint solver dodá angular impulsy přes lockRotations).
- [ ] **Magnetic merge Stage 3.1** — chain-merge re-align: pokud 2 multi-pixel chains se spojí auto-jointem (case "oba s jointy → no pos snap"), re-snapnout obě chains na 1U grid. Fixne uživatelův původní cluster bug z S11/S12.
- [ ] **Magnetic merge Stage 3.2** — composite rotation explicit handling: odstranit `lockRotations(true)` v align mode, explicitně drive θ přes `setAngvel` + manuální drift v `stepCompositesAlign`. Aktuálně rotace funguje empiricky přes joint solver impulses, ne čistě architektonicky.
- [ ] **Magnet merge re-aktivace v align mode** — po Stage 3.1/3.2: applyMerge spočítá novou composite state + recomputeOffsets postará o geometrii.
- [x] Wire up Largest counter do STATS — sezení 11. `computeObjectStats` rozšířen o `largest: { repId, size }`, facts.computeFacts dostává jako param.
- [ ] Hover infotipy rozšířit na CompositeObject (až bude magnetic merge Stage 3 — composite-driven kinematics)
- [ ] **E12** — pair-to-pair collision empirický test (carry-over ze sezení 10)

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
- [x] Largest (Most-pixels-in-object) — sezení 11. `computeObjectStats` v diagnostics rozšířen o size tracking; FACTS panel řádek "Largest" napojen.
- [x] Connections counter — sezení 8 (manuální), sezení 10 (auto-joint reaguje)
- [x] Objects counter — sezení 10. `computeObjectCount(world)` přes Union-Find s path compression a union by size. O((N+J)·α). Wire-up v display ticku + reset.
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
