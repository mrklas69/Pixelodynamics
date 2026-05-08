# DONE

## 2026-05-08 — Sezení 11: @AUDIT:CODE + redesign IntegrationMode + magnetic merge Stage 1

- **`@AUDIT:CODE` výstup** (10 sezení dosaženo) — 1 kritický (perfSpawn vs pbSpawn duplikát), 1 K2 (Largest champion vždy null), 4 doporučené, 5 kosmetických nálezů. Vynecháno: D2 (SKIP_RAPIER_IF_NO_JOINTS legit pro experiments), D4 (perf alokace bez důvodu), C3 (App.svelte refactor — Svelte single-file convention).
- **Audit fixes:** smazán `perfSpawn` (P-presety přes pbSpawn), `Largest` champion napojen přes `computeObjectStats(world): { count, largest: { repId, size } }` Union-Find s size tracking; `buildPixelIndex` extrahováno do diagnostics (sdíleno mezi diagnostics + edge mask v App.svelte); `createFixedJoint` má idempotent duplicate guard; PRESETS array seřazen číselně, `e8Variants()` smazána (E8r/α/β inline); H slider disabled (fáze 4+); `centroidScreen` ternary; `championLabel` smazán (Largest přes `{@render champ()}`).
- **Redesign IntegrationMode:** `'manual' | 'rapier' | 'hybrid-naive' | 'hybrid-α' | 'hybrid-β'` → **`'without-interaction' | 'not-align' | 'align'`**. Map: manual→without-interaction, hybrid-α→not-align, NEW: align. Smazány saveZeroVel/restoreVelDelta/SavedVel (β archived). SKIP_RAPIER_IF_NO_JOINTS smazán z params.ts.
- **Solver iters 32/8 default** (`World.init` + `applyPreset` reset). Rapier defaulty 4/1 nedostatečné pro joint chain v close-range gravity (3-pixel chain se zaboří 0.667 U). 32/8 z E3-tune ze sezení 8 + safety margin pro chains.
- **`align` mode (current limited form)** v `createFixedJoint`:
  - Snap r=0, rs=0 na obou pixelech.
  - Pos snap strategie podle existing connectivity: oba bez jointů → symmetric snap k midpoint ± 0.5 (centroid invariant); jeden bez jointů → snap jen ten (chrání chain); oba s jointy → no pos snap.
  - Edge anchor ±0.5 podle dominantní osy.
  - lockRotations(true).
  - **Žádný per-tick brute force** — to ničí Rapier joint warm-start cache (lekce z evolučních pokusů 1-3).
  - $effect na integration change → jednorázový lock/unlock pass. LMB spawn během align → lock na novém pixelu.
  - **Známé omezení:** align na rotujících chains porušuje joint anchory (anchor v lokálním frame, po setRotation(0) world pozice anchor změněna → solver overshoot → overlap). Pro rotující bodies use not-align. Dokumentováno v info tooltip.
- **Smazány všechny E*/P*/PB* presety + helpery** (e5Spawn/e6Spawn/e7Spawn/e8Spawn). Nahrazeno:
  - **G1024** — 32×32 axis-aligned grid, spacing 3 U, default `without-interaction`, no stop. Pure gravity collapse showcase.
  - **E1** — 2 pixely v ±2, klid, G=1, not-align, stop@10s. Pair attract, fixní obdélník v origin, ∑P=∑L=0.
  - **E2** — jako E1 s rs=±1. Test ∑L cancel. Pair distance > 1 U (rotated kontakt) — věrná fyzika.
  - **E3** — 4-pixelová tyčka rotující ω=+1 + 1 pixel ω=-1, not-align, stop@10s. Test ∑L=5.5 preservation přes auto-joint kontakt.
  - **E1align, E2align** — align varianty pro deterministický 1 U pair. Bit-identický výsledek.
- **UI cleanup:**
  - Patička: AppName 12 px, `#cfd6e0`, font-weight 600 (z 10 px, dim).
  - COMMANDS přesunut z right do left panelu pod FACTS. Home camera, Pause/Resume, Export JSON, Clear v COMMANDS.
  - "Reset scény" → "Clear" (z right SETTINGS panelu).
  - HUD `cur` → `cursor` (`.lbl` min-width 22→40 px).
  - Smazána tlačítka 🔗 Spojit poslední 2 / ✂ Rozpojit vše + funkce `connectLastTwo`/`disconnectAll`/`removeJoint` import (auto-joint default).
  - Bohatší multi-line title tooltipy + (?) ikony u G/H/cutoff/mód v SETTINGS panelu.
  - `jointCol` z `#d86f6f` (red) na `#6f8ec1` (h2 modrá panelových titulků) v `gl.ts` shaderu.
- **Spawn LMB** = r=0, rs=0 (jen linvel perturbace ±0.1 U/s). `SPAWN_ANGVEL_MAX` smazán.
- **Magnetic merge Stage 1** (`src/sim/composite.ts`, ~230 LOC):
  - `Composite` type: id, members, com, linvel, angvel, mass, inertia (s parallel axis theorem).
  - `buildComposites(world)` přes Union-Find s computeAggregate.
  - `freeEdges(composite, world)` enumeruje 4 strany každého pixelu, vyřazuje shared přes joint (anchor v dané dominant ose).
  - `segmentDistance` line-segment-to-line-segment v 2D (Christer Ericson §5.1.9).
  - `detectMergeCandidates(world, composites, threshold)` per-pair edge proximity, vrací nejbližší kandidáty pod threshold.
  - `MAGNET_THRESHOLD = 0.1` v params.ts (parameter programu).
  - App.svelte: `mergeCandidateCount` $state, per-display-tick build + detect, "Merge cand." řádek v STATS panelu.
  - **Stage 1 = pure detection, no merge.** Verifier: counter ukazuje rozumné hodnoty napříč scénáři (uživatel ověřil).
- **Test results:**
  - E1 not-align (G=20): pair distance 0.98 U, ∑P na f32 ulp, ∑L 4e-14, KE=9e-28. ✓
  - E2 not-align (G=20): pair distance 1.314 U (rotated kontakt — věrná fyzika), pair r ≈ ±2.45 rad, rs ≈ 0.0016, ∑L=0.0019. ✓ konzervace
  - E1align/E2align (G=1): bit-identické, distance přesně 1 U, ∑P=∑L=KE=0. ✓
  - E3 not-align (G=1): 5-pixel slepenec po t≈3 s contact, ∑L=5.495 (drift 0.09% za 10 s), ∑P f32 ulp. ✓ konzervace exquisitně
- **Lessons learned (z censure):**
  - Per-tick `lockRotations + setRotation(0) + setAngvel(0)` na všech pixelech **resetuje Rapier joint warm-start cache** (Lagrange multipliers cumulating across ticks). Solver iters startují z čistého stavu → konvergence per tick limited → drift pod constraint distance. **Solver warm-start je doctrine v PGS solverech.**
  - **Align scope creep**: 4-iterace fix→rollback→re-add za jediné sezení. Po 1. pokusu měl jsem doporučit fundamental redesign (rigid body merge), ne iterace na patches.
  - **G1024 bez tuneRapier** (Pixelodynamics-wide defaulty by měly být v init(), ne v presetu). Po smazání all E* presetů preset-driven tuning chyběl, fresh LMB workflow dostal Rapier defaulty 4/1 → pair stuck.
  - **E2align centroid drift** — first fresh-pair pos snap volil "snap newer", asymmetrický kontakt → centroid drift. Mental simulation collision symmetry by to odhalila.
  - **E3 align bug** (rotující chains) — snap rotace na pixelech v rotujícím chainu invaliduje joint anchory v lokálním frame. Anchor v lokálním frame změní world pozici, joint constraint violated → solver violence → overlap. Fundamentální omezení současné align implementace.

## 2026-05-08 — Sezení 10: Stage 3a — auto-jointing při kontaktu, object counter

- **`AUTO_JOINT_ON_CONTACT=true`** (`src/sim/params.ts`) — toggle pro auto-detekci dotyku po straně. Při Rapier collision Started event mezi dvěma pixely se automaticky vytvoří FixedJoint (s duplicate guard).
- **Collision groups + ActiveEvents** (`src/sim/physics.ts`) — `setCollisionGroups(0xFFFFFFFF)` (všechny páry), `setActiveEvents(COLLISION_EVENTS)`. `pixelByCollider: Map<number, Pixel>` pro O(1) lookup z handle. Sdílená `EventQueue` v `init()`. Nová `drainContactStarts(callback)` abstrahuje drain Started events.
- **Auto-joint helper v main loopu** (`src/ui/App.svelte`) — `drainAndAutoJoint()` po každé switch větvi, duplicate guard přes lineární scan v `world.joints`.
- **`setContactsEnabled(false)` na joint** (`src/sim/joints.ts`) — Rapier default řeší contact normal force paralelně s joint constraint, což škvaří energii (E3 drift -11.5 % vs. sezení 8 baseline 0.03 %). Vypnutím contact mezi joined bodies má joint solver autoritu nad rel pozicí — drift se vrátil na sezení 8/9 baseline.
- **γ flag zohledňuje AUTO_JOINT** — `skipRapier = SKIP_RAPIER_IF_NO_JOINTS && joints.length === 0 && !AUTO_JOINT_ON_CONTACT`. Bez tohoto fixu hybrid-α s prázdným `joints[]` skipoval `rapier.step()`, broadphase neaktualizovala, contact events nikdy nefíruly. Pro pure 'manual' mode auto-joint inertní (rapier.step() se nikdy nevolá) — žádná regrese.
- **Object counter** (`src/sim/diagnostics.ts`) — `computeObjectCount(world)` přes Union-Find s path compression a union by size. O((N+J)·α) per display tick. Wire-up v App.svelte (display tick + reset). `objectCount` v STATS panelu (do té doby hardcoded 0).
- **Preset E10 — Auto-joint head-on** — 2 pixely v (-2, 0) a (+2, 0), vx=±0.5, G=0. V t≈3 s contact, KE→0 (default restitution=0), auto-joint, slepenec stojí. Stop @ 8 s.
- **Preset E11 — Auto-joint trio (gravity)** — 3 pixely v řadě (-2, 0), (0, 0), (+2, 0), G=1. Gravitace přitáhne sousedy → 2 jointy v řetězci, KE=5.5e-17, finální distance 1 U mezi sousedy. Edge mask test (prostřední pixel red na obou stranách).
- **PB1000 perf test** — auto-joint ON + setContactsEnabled false: FPS 58 po 11 s (vs. sezení 7 baseline 20 FPS post-collapse v `manual` modu). Akceptovatelné, žádný catastrophic hit.
- **Test E3 / E8α regression** — bit-identický s baseline sezení 8/9. `setContactsEnabled(false)` izoloval joint solver od contact response.
- **Lessons learned (z censure):**
  - Bug 1 (E10 contacts nefíruly): γ flag skipoval `rapier.step()` bez jointů → broadphase neaktualizovala. Auto-joint vyžaduje broadphase běh, takže γ flag musel zohlednit `AUTO_JOINT_ON_CONTACT`. **Side-effect dependency** — orthogonal optimization (γ) přestala být orthogonal, jakmile se přidal feature, který vyžaduje rapier.step().
  - Bug 2 (E3 drift): zapnutí collision groups aktivovalo contact response **paralelně** s joint constraint, což si škvařivě interferovalo. **Default behavior konfliktů**: Rapier řeší contact i mezi connected bodies, dokud `setContactsEnabled(false)` nezvedl konflikt. API má fix, ale je to non-default — nutné aktivně volat.
  - ✂ Rozpojit + auto-joint: po removeJoint Rapier emituje Started event (pixely jsou z jeho pohledu znovu samostatné v kontaktu) → joint se vrátí. Empiricky potvrzeno (uživatel test). Logický důsledek volby "hned při kontaktu" — vlastnost, ne bug.

## 2026-05-08 — Sezení 9: Stage 2 hybrid orchestrace — α etablováno jako default

- **`IntegrationMode` rozšířen** z `'manual' | 'rapier' | 'hybrid'` na **`'manual' | 'rapier' | 'hybrid-naive' | 'hybrid-α' | 'hybrid-β'`** (`src/sim/presets.ts`). Stávající E5 přepsán na `'hybrid-naive'` (zachování experimentální historie).
- **`stepGravity` refaktor** (`src/sim/gravity.ts`) — split na `stepGravity` (full kick+drift) a **novou `stepGravityKickOnly`** (jen kick, write linvel; pos/rotation drift dělá Rapier). Sdílený `readState` + `accumulateAccel` interní helper.
- **Save-zero-restore helpers** (`src/sim/physics.ts`) — `saveZeroVel(world): SavedVel` (ulož linvel/angvel non-pinned, set 0/0) + `restoreVelDelta(world, saved)` (addback delta z constraint impulses). Pro β.
- **γ flag `SKIP_RAPIER_IF_NO_JOINTS=true`** (`src/sim/params.ts`) — orthogonal optimization. Bez jointů hybrid-α/β skip Rapier step → ekvivalent pure manual mode (∑P/∑L na f64 ulp). S jointy → full hybrid.
- **Main loop switch** (`src/ui/App.svelte`) — `switch(integration)` nad pěti módy. γ check (`skipRapier = SKIP_RAPIER_IF_NO_JOINTS && w.joints.length === 0`). Hybrid-α s skipRapier degeneruje na full manual (kick-only by jen akumuloval vel bez Rapier driftu).
- **UI dropdown `mód`** v SETTINGS panelu (po cutoff slideru) s 5 hodnotami. CSS `.select` styl analogie `.slider`. Default integration změněn z `'manual'` na **`'hybrid-α'`** — γ flag automaticky degeneruje na manual když nejsou joints, takže existující čistě gravitační scénáře přechod nepocítí.
- **E8 trojice presetů** se sdíleným `e8Spawn(api)`: pinned attractor (M=10) v (0,0), free pair (m=1+m=1) na (R±0.5, 0) s tečnou v_circ=√(GM/R)≈1.414, R=5, FixedJoint. tuneRapier solver=16/PGS=4/canSleep=false.
  - **E8r** — pure rapier (broken baseline pro orbit, free pair letí balisticky bez gravity protože rapier mód nevolá `stepGravity`)
  - **E8α** — hybrid-α (∑E drift 0.04 %/30 s, joint distance ~0.99, rs=0.32)
  - **E8β** — hybrid-β (∑E drift 13 %/30 s, rs≈0 — joint solver bez context o stress kvůli vel=0)
- **Verdikt:** α working, β rejected, γ jako orthogonal optimization. β kód zachován pro reprodukovatelnost a potenciální budoucí refinement (např. partial save).
- **Lessons learned:**
  - E8r baseline mismodelovaný — pure rapier mode nezavolá `stepGravity`, takže pure rapier není reference pro orbit. **Mental simulation každého presetu před spuštěním**, ne pouze po modelshotu.
  - β patologii bylo možné predikovat z první principů (vel=0 maskuje stress pro joint solver) — **algoritmický sanity check krok po kroku** před implementací, ne empirické defaulting.

## 2026-05-08 — Sezení 8: Fáze 3 entry — FixedJoint API, audio, edge mask, sleep-mode fix

- **FixedJoint API** (`src/sim/joints.ts`) — `createFixedJoint(world, a, b)` (anchor = midpoint v lokálním frame přes `R(-rot)·worldOffset`), `removeJoint`, `removeAllJointsSilent`. Frame parametr `JointData.fixed(anchorA, rB-rA, anchorB, 0)` preserve aktuální rotation gap (žádný snap při create i pro pixely s random rotacemi).
- **Audio modul** (`src/audio/sfx.ts`) — pool 5 `HTMLAudioElement` per zvuk (round-robin pro overlapping plays). `playClick()` (joint create+remove), `playSpawn()` (LMB). Asset import z `src/assets/click.mp3` + `spawn.mp3`. Autoplay-block tiše ignorován.
- **Manuální connect/disconnect tlačítka** v COMMANDS panelu — 🔗 Spojit poslední 2 (anchor midpoint mezi centry, edgeBit dominantní lokální osu), ✂ Rozpojit vše (slice copy, removeJoint per joint). Connection counter wire-up.
- **Edge mask vizualizace** (`src/render/gl.ts` + `App.svelte`) — 4-bit mask per pixel (bity +X, -X, +Y, -Y) jako per-instance WebGL attribute. FS check `dPosX <= minDist && (mask & 1)` → barva `#d86f6f` (joint red). Iterace: nejprve discard (vznikly černé zobáčky v rozích), pak 50% transparency, finále červená barva (vizuální signál místo geometrie destrukce). Per-frame compute O(N + J) přes `Map<Pixel, idx>`. Anchor v lokálním frame zachovává mask přes pixel rotaci přirozeně.
- **`World.defaultCanSleep = false`** jako Pixelodynamics-wide default (`src/sim/physics.ts`). Sleep mode označen jako anti-feature pro fyzikální sandbox — v default E3 baseline uspal rotující rigid pair během <2 s a dissipoval 100% momentu (linear i angular). Toggle přes `setDefaultCanSleep(b)` jen pro replikaci původního chování.
- **Rapier IntegrationParameters tuning** — `setSolverIterations(n)` (default 4), `setPgsIterations(n)` (default 1) na World. Per-preset přes `PresetAPI.tuneRapier({ solverIterations, pgsIterations, canSleep })`. Reset na default v `applyPreset` před `preset.setup`.
- **E3 preset finální podoba** — 2 pixely (0,0)/(1,0) edge-to-edge, vy=0.5 na pravém, FixedJoint, tuned (canSleep=false + iters=16/PGS=4). Smazány E3 (broken default) a E3s (mise splněna). Drift po 10s ~0.01-0.03% na ω/L/KE, ∑P k f32 epsilon.
- **`PresetAPI` rozšíření** — `spawn` vrací `Pixel` handle, `connect(a, b)` wrapper kolem `createFixedJoint`, `tuneRapier(opts)` per-preset Rapier konfigurace.
- **Spawn LMB sound hook** — `playSpawn()` v `onPointerDown` (po `world.spawnPixel`).
- **`@BEGIN`/`@END` makro update** (`CLAUDE.md`) — dev server jako detached proces (`Start-Process cmd /c npm run dev -WindowStyle Hidden`), PID file v `.claude/dev-server.pid`. Server přežije Claude Code restart i `/clear`. @BEGIN vypisuje URL `http://localhost:5173/` jako klikací odkaz, @END kill přes `taskkill /T /F`.
- **E3 modelshot dissipation analysis** — pure rapier mode default modelshot: vx=vy=0, KE=0 po 10 s. Fit exponential decay: `λ ≈ 0.5/s`, half-life ~1.4 s. Hypotéza sleep+Baumgarte ověřena E3-tune mini-experimentem (E3 broken / E3s no-sleep matches / E3t tuned best). Sleep mode = 100% viník katastrofického selhání; solver iterations = další řád přesnosti.
- **Lessons learned (z censure):**
  - Default Rapier configuration (sleep, damping) by se měla auditovat jako součást `@BEGIN` setupu pro Rapier-based feature.
  - Shader corner cases (rohy quadu kde 2 hrany jsou stejně blízko) je nutné mentálně procházet při psaní FS, ne jen středy hran.
  - API se signature+frame parametry (`JointData.fixed(anchorA, frame1, anchorB, frame2)`) musí číst doc strings — default 0/0 byl tichá chyba pro identical-rotation případ.

## 2026-05-07 — Sezení 7: Centroid křížek, cursor v HUD, cutoff factor benchmark

- **Vizualizace centroidu** — uzavírá stale Příště (5 sezení). CSS overlay `<div class="centroid">` se ::before/::after pseudoelementy (16×16 px screen-fixed křížek modrý #6f8ec1). `computeCentroid(world)` v `diagnostics.ts` (lehká O(N) per-frame verze, vrací null pro prázdný world). `worldToScreen(cam, viewport, wx, wy)` v `camera.ts` (algebraická inverze `screenToWorld`). Update centroidu per frame v render loopu.
- **Cursor world position v HUD** — split na 2 řádky přes `flex-direction: column`. 1. řádek `cur x y` (svět), 2. řádek `lock/x/y/zoom`. `$state cursor` updateován v `onPointerMove`, clear v `pointerleave`.
- **Cutoff factor jako runtime parametr** — `GravityParams.cutoffFactor` přidán; `accumulateForcesGrid` čte z `p.cutoffFactor` místo z importované konstanty. Slider `cutoff` v SETTINGS panelu (3–12·ε, step 0.5, default `GRAVITY_CUTOFF_FACTOR=5`). Reset v `applyPreset`.
- **Presety PB500 a PB1000** — deterministický grid spawn (cols × rows ≥ N, spacing 3 U), pixely v klidu. Helper `pbSpawn(api, n, spacing)` v `presets.ts`. stopAtTime 30 s pokrývá rovnoměrnou + kolabovanou fázi.
- **Cutoff benchmark — `M(PB1000, cutoff, t) = FPS`:**

  | t \\ c | 5 | 8 | 10 |
  |---|---|---|---|
  | 5  | 60 | 60 | 21 |
  | 10 | 58 | 24 | 21 |
  | 20 | 20 | 20 | 20 |
  | 30 | 20 | 20 | 20 |

  **Klíčový závěr:** strop je **density-bound, ne cutoff-bound**. V kolapsové fázi všechny cutoffy konvergují na 20 FPS (= vsync schod 60/3). Default c=5 zůstává.
- **Edukativní vyjasnění** — centroid (vážený těžiště poloh) ≠ Lagrange L1 (rovnováha sil). Pro E6: centroid ≈ -8.83, L1 ≈ +7.43.

## 2026-05-07 — Sezení 6: Pages verifikace, ∑E + Δ∑E indikátor, rotační KE

- **Pages deploy verifikován** — uzavření 5sezeňového stale dluhu ze sezení 1. Všech 5 GitHub Actions runs `success`, root + JS + CSS bundles HTTP 200, base path `/Pixelodynamics/` aplikovaný v `<script>`/`<link>`. Live na https://mrklas69.github.io/Pixelodynamics/. Žádné code změny nepotřeba.
- **∑E + Δ∑E v STATS panelu** (`src/ui/App.svelte`):
  - Nové `$state` proměnné `sumE`, `deltaE` + interní `e0: number | null`.
  - V display ticku (každých 0.5 s): `E = ke + lastPE`, `e0` se zachytí jakmile `simTime > 0` (PE platná z předchozí `stepGravity` call), `Δ∑E = E - e0`.
  - Reset v `resetScene` (a tedy i v `applyPreset`) → `e0 = null`, `sumE = 0`, `deltaE = 0`.
  - Pro rapier mode (E1/E2 s G=0): `lastPE = 0` → ∑E = KE only, fyzicky správně.
  - 2 nové řádky v STATS markup (∑E, Δ∑E) s jednotkou `kg·U²/t²`.
- **Rotační KE** v `computeDiagnostics` (`src/sim/diagnostics.ts`) — přidán člen `Σ ½·Iᵢ·ωᵢ²` (I=m/6 pro pixel-čtverec). Pro současné presety s `rs=0` a bez kontaktů žádný měřitelný rozdíl, ale po fázi 3 (kolize → torque) by ∑E bez něj falešně driftovalo. Korektnost ne čekat na bug.
- **MODEL.md** — diagnostika tabulka rozšířena o PE a ∑E rows, KE oprava na translační + rotační. Dopsán odstavec o symplektickém bounded driftu E a E₀ capture logice.
- **Empirická validace E7g s novým indikátorem**:
  - Modelshot: KE = 3.7339, PE = -6.4839, E(60) = -2.7499 — bit-shoda se sezením 5.
  - STATS @ t=60s: `∑E = -2.75`, `Δ∑E = -1.195e-3` ≈ `-2e-5/s` drift rate. Záporný drift = symplektický Euler typicky drifuje směrem k vázanějšímu stavu, bounded oscillation.
  - ∑P = 2.776e-17 (f64 floor, D2 symetrie), ∑L = 0 exact.

## 2026-05-07 — Sezení 5: Empirická validace spatial gridu, smoothstep tail, PE v modelshotu

- **Sub-fix E5m:** doplněno `api.setUseGrid(false)`. Po sezení 4 (default přepnut na grid) E5m tichou regresí běžel s gridem místo naive — diary popis byl falešný. Memory `feedback_sanity_check` se aplikuje i na refactory (rerun starých presetů po změně defaultů).
- **Presety E7n a E7g** — 4×3 spread spawn (12 pixelů, spacing 6 U, range 18×12 U). 49/66 párů přes cutoff 7.5 U → grid skutečně skipuje páry. E5 D4 setup byl nediskriminační (všechny páry pod cutoff → grid≡naive bit-identicky). Spawn helper `e7Spawn()` v `presets.ts`.
- **Smoothstep tail** v `accumulateForcesGrid` (`gravity.ts`). Window `W(r) = 1 - (3t² - 2t³)` pro `t = (r_raw - r_inner)/tailWidth`, kde `r_inner = cutoff - tailWidth`. Force = `Gmm·(W·invR3 + 6t(1-t)/(tailWidth·rSoft·rRaw))·dx` — rigorózně `F = -dU_mod/dr` pro `U_mod = U·W`. `GRAVITY_TAIL_WIDTH = 1.0` v `params.ts`, default zapnutý.
- **PE v `Modelshot.diagnostics`** — `lastPE` cache v `App.svelte` z poslední `stepGravity` substepu. Reset v `resetScene`. Pro rapier mód zůstává 0 (presety E1–E3 mají G=0 → fyzicky pe=0).
- **Fix komentáře `params.ts`** — `F(cutoff) ≈ 0.008·F_peak` byl nepravdivý (počítal kernel ratio bez faktoru `r`). Skutečně `F(7.5)/F_peak ≈ 0.10`. Komentář přepsán s přepočtem.
- **Projektový `CLAUDE.md`** — definice maker `@BEGIN` (start dev serveru, audit cadence, stale Příště) a `@END` (DOCS, check, commit, stop server).
- **Empirická validace energy conservation:**
  - **E7n (naive):** PE(0) = -6.708 (manuální výpočet, 66 párů × 1/√(r²+ε²)). E(60) = 3.7666 + (-10.4753) = -6.7087. ∑E drift **6e-4 / 60 s** = 1 v 10⁴.
  - **E7g (grid + smoothstep):** PE(0) = -2.749 (jen 17 nejbližších párů, r_raw=6 < r_inner=6.5). E(60) = 3.7339 + (-6.4839) = -2.7500. ∑E drift **1e-3 / 60 s** ≈ symplectic Euler truncation.
  - Oba běhy zachovaly ∑E na úroveň truncation. ∑P, ∑L exact 0 (D2 symetrie).
- **Klíčový závěr:** spatial grid s `cutoff_factor=5` je **culling decision** pro long-range gravitaci, ne approximation. Pro spread setup (E7) se chová kvalitativně jinak než naive (KE 1.73 vs. 3.77, radii 24-28 U vs. 4-10 U). Smoothstep tail neobnovuje cut-off long-range sílu — řeší jen energy conservation across cutoff přechod. Pro Pixelodynamics use case (slepené klastry) je culling OK; pro fázi 6+ rozprostřený plyn zvážit větší `CUTOFF_FACTOR`.

## 2026-05-07 — Sezení 1: FVP scaffold

- Vite + Svelte 5 + TypeScript (strict, `noUncheckedIndexedAccess`)
- Rapier 2D (`@dimforge/rapier2d-compat` 0.19.3) jako fyzikální solver
- WebGL2 renderer s instanced quads
- 2D ortografická kamera (pan/zoom)
- LMB spawn pixelu, WASD pan, Y/X + wheel zoom
- Svelte UI: levý/pravý panel, středový canvas
- README, TODO, IDEAS, DIARY, LICENSE (MIT)
- GitHub Actions deploy na Pages
- Public repo na github.com/mrklas69/Pixelodynamics

## 2026-05-07 — Sezení 2: Fáze 2 + UI restrukturalizace

- **Párová pixelová gravitace** s Plummer softeningem (`F = G·m·m/(r²+ε²)^(3/2)`)
- **Manuální symplektický Eulerův integrátor** pro FVP — Rapier step() obejit; zachovává ∑P a ∑L na úroveň float roundoff
- **Substepping** 4× per frame pro nižší truncation error
- **STATS panel** — Time, Pixels, Objects, Connections, ∑P, ∑L, FPS
- **FACTS panel** — championi (Fastest, Spinniest, Most momentum, Most ang. mom., Most massive); klik na #ID centruje kameru
- **Home camera** tlačítko (návrat na 0,0, zoom 32)
- **SETTINGS panel** — G a H slidery, Reset scény
- **Programové konstanty** v `src/sim/params.ts`: `SPAWN_LINVEL_MAX`, `SPAWN_ANGVEL_MAX`, `GRAVITY_EPSILON`, `GRAVITY_SUBSTEPS`
- Ověřena Keplerova dynamika emergentně — kuželosečné dráhy kolem těžiště

## 2026-05-07 — Sezení 4: UI polish, kamerový lock, spatial grid, dokumentace

- **Bug fix #4 (FACTS klik):** `centerOnPixel` jednorázový skok nahrazen plnohodnotným **camera lock** — klik na `#ID` ve FACTS uzamkne kameru, každý frame ji posouvá za pixelem. Mizející pixel zámek shodí + toast.
- **Camera lock unlock UX:** `Esc` nebo WASD pan ruší zámek (intuice „chci se podívat jinam"); `Reset scény` taky.
- **HUD overlay** v rohu canvasu — `lock #ID / free · x · y · zoom px/U`. Reaktivní přes `$state` na camera proxy.
- **`fmtSig4` formátování** (`src/ui/format.ts`) — interně f64, displej zaokrouhluje na 4 platné číslice. Aplikováno na ∑P, ∑L, FACTS hodnoty (v tooltipu hodnota championa), HUD pozici/zoom, hover tooltip.
- **Patička layoutu** — centrovaná dvouřádková (`Pixelodynamics — sandboxová simulace…` + licence/repo), grid řádek `auto`. Smazán `<h1>` z levého panelu.
- **Pixel jako rámeček** — vertex shader pásuje `v_local`, fragment shader vykreslí jen okrajový pruh přes `discard`. Šířka okraje hybrid `max(0.05 U, 1 screen px)` přes uniform `u_borderHalfWidth`. Připraveno na vynechání hrany pro vizualizaci spoje (fáze 3).
- **Hover infotips** nad pixely. AABB hit-test po inverzi rotace, `pickPixel(wx, wy)` v `App.svelte`. Tooltip plovoucí u kurzoru, `position: fixed`. Zobrazuje `id, x, y, vx, vy, |v|, r, rs, m`.
- **README rewrite** — stack tabulka, conservation status, perf čísla, ovládání rozšířené o lock + hover + Esc.
- **`docs/MODEL.md`** — formální popis fyzikálního modelu: jednotky, stav pixelu, force kernel + Plummer softening, symplektický Euler kick-drift, substepping, fixed timestep accumulator, mode-aware integration. Reference: Aarseth 2003, Hairer/Lubich/Wanner 2006, Fiedler.
- **Spatial grid** (`GRAVITY_USE_GRID = true` v `params.ts`). Uniform buckets, cell size = cutoff = `5·ε ≈ 7.5 U`. Force eval v 3×3 sousedství s dedup `i<j`. Module-level scratch + bucket pool proti GC tlaku. Hard cutoff bez smoothing tail — ∑P/∑L exact (Newton 3 + radial), KE má drobné skoky při krossování cutoffu (zdokumentováno). Naivní O(N²) zachován jako baseline, přepínač v `params.ts`. Validace empiricky odložena na sezení 5.
- **Bugfix projection matrix** — `src/render/camera.ts` skládal `M = T(-cam) × S` místo `M = S × T(-cam)`. Pro `cam=(0,0)` neviditelné (sezení 1–3 testovala vždy home camera), pro lockovanou kameru se viewport rozcházel s deklarovanou pozicí o faktor zoom. Fix: `mat3.fromScaling` + `mat3.translate(m, m, [-cam.x, -cam.y])`. Důsledek: lock funguje správně, hover hit-test taky.
- **Lockovaný pixel = amber barva** v shaderu (sladěno s 🔒 ikonou v HUD #d8b76f). Per-instance `a_id` + uniform `u_lockedId`, FS mixuje base s lock barvou. Žádný JS přepočet flagů.
- **Pinned pixely** — nový atribut `Pixel.pinned: boolean`, propagace přes `spawnPixelExact`/`PresetAPI.spawn`. V `stepGravity` pinned přeskočí kick+drift+writeback, ale **ostatní pixely cítí jejich gravitaci** (působí jako nehybné gravitační zdroje). Použití: experimenty s fixními hmotami v zadaném potenciálu.
- **Runtime přepínač spatial gridu** — `GravityParams.useGrid: boolean` místo compile-time konstanty. `PresetAPI.setUseGrid` umožňuje presetům vynutit naive O(N²) pro experimenty s interakcí > cutoff. HUD ukazuje `Mód: manual · grid|naive · presetId`.
- **Preset E6 — Lagrange L1**. 30 PINNED pixelů na (-10, 0) → cluster m=30, 1 PINNED pixel na (+10, 0), free test pixel na L1 (Plummer-corrected). Naive gravita. Tři iterace fixu odhalily skryté chyby v původním návrhu:
  1. Statický L1 vyžaduje pinned hmoty — bez pinningu se cluster + singlet stáhly k sobě, problém zanikl.
  2. Plummer L1 formule mi chybí faktor `r` v čitateli (`F = G·M·r/(r²+ε²)^1.5`, ne `G·M/(r²+ε²)^1.5`). Test pixel byl spawnován o 2 U mimo skutečnou rovnováhu.
  3. Plummer kernel má **tři** zero crossings rovnice rovnováhy — dva falešné L-body uvnitř ε oblastí. Bisekce na celém `(0, D)` konvergovala k falešnému kořeni `r ≈ 0.001`. Fix: zúžit interval na `[r_classical − 2ε, r_classical + 2ε]`.
  Po fixu test pixel po 30 s nepohnul ani o 1 ulp f32 (vx ≈ 1.9e-7, KE ≈ 1.8e-14). Saddle τ ≈ 4 s, drift z f32 ulp by po 30 s byl ~5e-4 U (sub-pixel), po 60 s už nelineární kollaps.
- **Patička jako overlay** — `position: absolute, bottom: 6px, left: 50%, translateX(-50%)` uvnitř `.canvas-wrap`, žádné pozadí. Stejný styl jako HUD, neblokuje pointer.
- **Memory: feedback_sanity_check** — opakovaná lekce ze sezení 4 (projekční matice + Plummer L1) zaznamenaná. Při psaní matic / formulí vždy ověřit numerickým testem na nenulovém vstupu, sanity check `console.warn` do kódu.

## 2026-05-07 — Sezení 3: Experimentální infrastruktura, validace integrace, perf

- **Preset / experiment infrastruktura** (`src/sim/presets.ts`) — typy `Preset`, `PresetAPI`, `IntegrationMode`, `Modelshot`. UI v COMMANDS panelu, klikem clear+setup+start.
- **`spawnPixelExact`** v `physics.ts` — deterministický spawn pro reprodukovatelné experimenty (random LMB spawn zachován).
- **Mode-aware loop** — `manual` / `rapier` / `hybrid` přepínání. Manual default zachovává fázi 2 chování.
- **Fixed-timestep accumulator** (Glenn Fiedler) — `simTime` deterministický vůči počtu kroků, decoupled od wall-clock. Řeší drift mezi sim časem a Rapier integration time.
- **Pause** (Space / tlačítko) + **Export JSON modelshot** (clipboard + fallback dialog s textareou pro auto-stop). Auto-stop pause + auto-export po `preset.stopAtTime`.
- **Experimenty E1, E2, E5, E5m** — viz diář.
- **Performance profiling** — N=100 @ 60 FPS, N=500 @ 60 FPS, N=1000 @ 45 FPS, N=2000 @ 12 FPS. O(N²) škála čistá, ~10 ns/op.
- **Architektonický nález:** naivní `manuální stepGravity + Rapier.step()` integruje pohyb dvakrát + bridguje stav přes f32 (10⁴× worse drift). Pro fázi 3 nelze použít; tři varianty (α/β/γ) zaznamenány v IDEAS.
