# DONE

## 2026-05-09 — Sezení 16: Pohlcení pixelu + snake-growth + secondary joints + FACTS pro slepence + amber plošný highlight

- **Pohlcení pixelu fix** v `src/sim/joints.ts`: dominant-axis větev `createFixedJoint(align=true)` doplněna o `occupiedDirs` filter — host i guest pixel hostí kandidáty (PX/NX/PY/NY) sortované podle skóre, vyhraj first kde host occupied dir není nastaven a guest opposite dir není nastaven. Endpoint má max 1 occupied dir → vždy ≥ 2 volné páry. Zafixovalo overlap, kdy guest přiletěl ke endpoint hosta z chain-extension strany a target padl na pozici existujícího chain souseda.
- **Snake-growth fix** přes `findBestJointPair(world, chainA, chainB, aPos, bPos)` v `joints.ts` — full O(|chainA|·|chainB|·16) enumerace všech volných hran všech pixelů obou chainů; vyhrává pár s nejnižším skóre `|hostMid − bPos| + |guestMid − aPos|`, s constraintem `guestDir = opposite(hostDir)`.
- **Refactor `joinAlignedExplicit(world, hostPx, hostDir, guestPx, guestDir)`** — extrakce sdíleného rigid-transform + velocity unification + joint create + `recomputeCompositeOffsets` + `detectSecondaryJoints`. `autoJointAlign` deleguje (po `findBestJointPair`); manual `connect()` z presetu zachová dominant-axis heuristiku s occupied filterem (S16 fix), pak deleguje. `pickClosestEndpoint` smazán.
- **Secondary joint detection** přes `detectSecondaryJoints(world, seedPx)` — po primary jointu projet všechny páry pixelů merged komponenty, najít edge-touching (Δpos v p1 local frame má dominant složku ≈ ±1 s tolerancí 0.05 U, oba dirs free), vytvořit jointy s `kind: 'secondary'`. Bez `playClick`, bez rigid-transform. `Joint.kind: 'primary' | 'secondary'` field v Joint type.
- **FACTS pro slepence** v `src/sim/facts.ts`:
  - `ChampionEntity = {kind: 'pixel'|'composite', id}` discriminated union. Singleton composite (1 member) → `kind: 'pixel'`, jinak `'composite'`. ID = min(member.id), stable across ticks.
  - `computeFacts(composites, cmx, cmy)` iteruje composites; metriky: speed, spin, mom, L sum over members kolem world centroidu, size, mass.
- **`computeObjectStats` mrtvý kód odstraněn** z `diagnostics.ts` — nahrazeno `composites.length` a iterací přes composites.
- **`LockTarget` discriminated union** v `types.ts`. `Camera.lockTargetId` → `lockTarget`. App.svelte follow logic: pixel kind → `pixel.pos`, composite kind → re-find pixel by id, BFS přes `computeCompositeFor`, follow `composite.com`. Pokud rep zmizel → unlock + toast.
- **HUD lock label** rozliší `🔒 #ID` (pixel) vs `🔒 ◆#ID` (composite). FACTS champ snippet: `#ID` vs `◆#ID` v button textu.
- **Plošný amber lock highlight** v `src/render/gl.ts`:
  - Per-instance `a_locked` attribute (Float32 0/1, location 2) místo `u_lockedId` uniform + `a_id`. CPU per frame vyplní `lockedData[i]` z `camera.lockTarget` (composite kind = 1 pro všechny members přes `computeCompositeFor`).
  - Shader interior: pokud `v_locked > 0.5`, fill `vec4(amber, 0.20)`; jinak discard. Border zachová bílou default / modrou joint, lock NEMĚNÍ border.
  - `Renderer.render(count, proj, borderHalfWidth)` API drop `lockedId` parametr. `idBuffer` + `idData` smazány.
- **Cleanup obsoleted Exx presetů** v `src/sim/presets.ts` — odstraněny E1, E2, E1align, E2align, E3 (předchází Stage 3.1, redundantní s E12-E15 nebo s outdated descriptions zmiňující odstraněné `lockRotations`/destruktivní snap). Zbývá E12, E13, E14, E15, G100, G1024.
- **IntegrationMode docstring** updated — `align` přepsáno z „lockRotations + destruktivní snap" na „composite-driven kinematics Stage 3+3.2 + full free-edge enumeration (snake-growth fix S16) + secondary joint detection".
- `npm run check`: 0 errors, 0 warnings.
- Uživatel ověřil E12, E13, E14, E15 OK po snake-growth refactoru.

## 2026-05-08 — Sezení 15: E12 carry-over PASS + E15 align rotation test (synthetic ω injection)

- **E12 modelshot PASS** (carry-over ze S10): 2 chainy m=2 head-on, magnet merge, simTime 3.02 s. 4 pixely v klidu na linii spacing 1.0 U, ∑P=0, ∑L=0, KE=0 (100 % inelastic head-on loss). TODO `[ ]` → `[x]`.
- **E15 — synthetic ω injection v align mode** v `src/sim/presets.ts` (+30 řádků):
  - Nový preset `e15` mezi `e14` a `g100`. Chain m=3 v (-1, 0), (0, 0), (+1, 0); spawn s nulovými velocities, dva `connect` v align modu, pak ruční rigid-body kinematics přes `pX.body.setLinvel/setAngvel` (vy=ω·x_rel, rs=ω; ω=+1 rad/s).
  - Důvod synthetic: 1. iterace presetu odhalila, že `createFixedJoint(align=true)` má ω=0 paradigm — fresh-fresh `setAngvel(0)`, fresh+chain velocity unification. V current architektuře **není** naturální cesta dostat composite s ω≠0 v align mode. Stage 3.2 explicit theta drift je defensive mechanika pro Fázi 4+ external impulse trigger.
  - Description označuje preset jako "synthetic", popisuje architectural limit + co testuje.
- **E15 modelshot PASS:**
  - Distance preserve: d(p0,p1) = d(p1,p2) = 1.000 U přesně, d(p0,p2) = 2.000 U.
  - compositeTheta sdílení: r všech 3 pixelů identicky -2.5733 rad ≡ θ = -2.566 + 7×10⁻³ integration error/10 s.
  - rs sdílení: všichni 0.99860 identicky.
  - ∑P drift: 2×10⁻⁵ (f32 ulp accumulation přes ~24000 substeps).
  - ∑L drift -0.14 %/10 s, KE drift -0.28 %/10 s — konzistentní s δKE/KE = 2·δω/ω. **Systematic ω drift** (ne ulp): zápis do IDEAS jako kandidát na refactor "Stage 3.2 ω explicit drive" (Pixel.compositeAngvel + event-driven update místo per-tick aggregate read).
- `npm run check`: 0 errors, 0 warnings.

## 2026-05-08 — Sezení 14: E14 validace odhalila 2 bugy + Stage 3.2 + magnet re-aktivace v align + hover slepenec + UI polish

- **Bug fix #1 — autoJointAlign endpoint picking** v `src/sim/joints.ts`:
  - Nový export `autoJointAlign(world, a, b)` jako wrapper kolem `createFixedJoint(align=true)`. Filtruje same-component eventy (chainA.includes(b) → return null) + vybírá endpoint pixely (degree ≤ 1 v rámci chain joint graphu) nejblíže ke kontaktnímu páru přes `pickClosestEndpoint`.
  - Důvod: Rapier narrow-phase generuje contact eventy pro všechny AABB-overlapping páry (E14 Y offset 0.07 → a2-b0 i a1-b0 i a2-b1 ve stejném ticku). Po prvním cross-component merge byly další eventy "same component" → `createFixedJoint(align=true)` v původní same-component branchi vytvářel jointy s mismatched anchory (1U world distance) → solver iteroval proti existing chain anchorům → komposit vystřelí.
  - Same-component branch v `createFixedJoint(align=true)` změněn na **early-return null** (return type rozšířen na `Joint | null`). Manual `connect()` z presetu se týká fresh pairs, takže null fallback je bezpečný.
- **Bug fix #2 — connect propaguje align flag** v `src/ui/App.svelte`:
  - `connect: (a, b) => createFixedJoint(w, a, b, integration === 'align')`. Bez toho chain joints v presetu se vytvářejí v not-align mode → `compositeOffsetX/Y` zůstává `null` → `stepCompositesAlign` v align mode čte `?? 0` → všichni 3 členové každého chainu kolabují na CoM během prvního ticku → komposit zhroutí, pak vystřelí přes broken anchory.
- **Stage 3.2 — composite rotation explicit handling:**
  - **`Pixel.compositeTheta: number | null`** field v `src/types.ts` — stable composite rotation, sdílena všemi members. Set v `recomputeCompositeOffsets`.
  - **`stepCompositesAlign(world, dt)`** v `src/sim/composite.ts` — explicit theta drift: `θ_new = (members[0].compositeTheta ?? 0) + c.angvel·dt`; `setRotation(θ_new)` + propagace na všechny členy + update `compositeTheta = θ_new`.
  - **`lockRotations(true)` zcela odstraněno** ze 4 míst (joints.ts fresh-fresh + chain+chain × 2, App.svelte $effect, App.svelte pointerDown spawn). Joint solver Rapieru volně iteruje individual pixel rotations, my každý tick override z aggregate state.
  - **Empirie:** E14 modelshot identický s S3.1 (ω=0 → drift = 0). Drobný ω drift 1.2×10⁻⁵ rad/s je f32 numerical floor po odstranění lockRotations. Geometrie zůstává **přesně rigidní** (Y end pixelu konzistentní s `sin(θ)·offset`).
- **Magnet merge re-aktivace v align mode:**
  - **`applyMerge(world, candidate, align: boolean = false)`** v `composite.ts` — v align cestě deleguje na `createFixedJoint(..., true)` (Stage 3.1 chain-merge logika), v not-align cestě beze změny (Stage 2 ∑P + ∑L preserved math).
  - **App.svelte gate** rozšířen na `not-align || align`. Auto-joint a magnet sdílí jednu cestu (Stage 3.1) v align mode → single source of truth pro merge geometry.
  - **Validace:** E14 (align) modelshot identický (chains se setkají téměř současně přes magnet i auto-joint). E12/E13 (not-align) regression-safe.
- **Hover infotipy nad slepencem:**
  - **`computeCompositeFor(world, seed)`** v `composite.ts` — BFS od pixelu po jointech, vrací `Composite | null`. Singleton = null. O(členů + joints).
  - **App.svelte hover state** rozšířen o `composite: { count, mass, comX/Y, vx/vy, speed, angvel } | null`. Tooltip přidá sekci "Slepenec (N×)" pokud composite ≠ null.
- **2 UI polish:**
  - PRESETS panel: odstraněn řádek "Mód: not-align · naive · e1" (redundance s mode select výše). Unused .hint CSS classes smazány.
  - G100/G1024 presety: odstraněn forced `setIntegration('without-interaction')` — teď respektují aktuální mode (cluster gravita lepí v not-align).
  - Info tooltip pro mode select: align popis přepsán na composite-driven kinematics (Stage 3+3.2), bez zmínky lockRotations.
- **DROP β archiv** ze stale Příště (4 sezení S9 → S13 v Příště, ale β kód byl smazán už v S11; carry-over je zombie). Stejná logika jako S13 dropla "Spawn sound balance".
- `npm run check`: 0 errors, 0 warnings.

## 2026-05-08 — Sezení 13: Stage 3.1 chain-merge rigid-transform + E14 + G100

- **Stage 3.1 — `createFixedJoint(align=true)` 4-cestný rozcestník** v `src/sim/joints.ts`:
  - **Same-component** (a, b spojeni nepřímo): geom preserve, anchor v a-local frame z current world delta. Žádný snap (rozbil by chain), žádný rigid-transform.
  - **Fresh-fresh** (oba singletony): symmetric snap kolem midpointu — beze změny od S11. Centroid invariant.
  - **Fresh+chain / chain+chain** (sjednocená cesta): host = větší řetězec; pro singleton host force hostθ=0, pro multi-pixel host respektuje chain rotation. Direction v host **local frame** → dominantní osa, sign. Target guest pos = `hostPos + R(hostθ)·(±1,0)/(0,±1)`. Rigid transform celého guest řetězce: rotace o Δθ kolem guestPos + translace na target. Internal joint anchory v body local frames zůstávají platné (anchor world rotuje s body). ∑P preserved (`V_unified = ∑P/M_total`), ω=0 (angular momentum loss explicit v align paradigmu).
  - **Anchor mapping** — `alignXAxis`/`alignSign` z host local frame s polaritou flip pokud b=host. AnchorA/B = ±0.5 podle xAxis flag.
- **Klíčové fixy proti staré chain-chain větvi:**
  1. Staré: `setRotation(0)` na a,b lámalo internal anchory chainů s θ≠0. Nové: rigid-transform celého chainu zachová internal geometry.
  2. Staré: distance ≠ 1U + edge anchor ±0.5 → joint constraint violation. Nové: pos snap na 1U přesně.
  3. Staré: `setRotation(0)` v `fresh+chain` lámal multi-pixel chain s θ≠0. Nové: fresh pixel rotován do chain frame, chain nedotčený.
- **Presety v `src/sim/presets.ts`:**
  - **E14 — Chain-chain merge align (Stage 3.1):** 2 chainy m=3 head-on s Y offset 0.07 U, vx=±0.5, G=0, align mode, stop @ 8 s. Initial ∑P=0, ∑L=0.105, KE=0.75. Expected after: 6-pixel chain (-3.5..+1.5) na Y=0, V=0, ω=0, KE=0 (100% inelastic loss). Modelshot validace odložena na S14.
  - **G100 — 10×10 čtverec:** 100 pixelů spacing 3 U, `without-interaction` default. Menší sourozenec G1024.
  - Helper `g1024Spawn` zobecněn na `gridSpawn(api, cols, rows, spacing)`, sdílí oba presety.
- **Docstring `createFixedJoint`** přepsán na 4-cestný popis (semantika align=true změněna).
- **DROP `Spawn sound balance`** ze stale Příště (5 sezení S8 → S12 bez akce).
- `npm run check`: 0 errors.

## 2026-05-08 — Sezení 12: @AUDIT:DOCS + magnetic merge Stage 2 + Stage 3 MVP

- **`@AUDIT:DOCS` výstup** (≥10 sezení dosaženo + 1× po S11) — 7 kritických (README + MODEL.md za S5–S7 stagnovaly: neaktuální `manual` IntegrationMode, uzavřená α/β/γ debata stále otevřená, „Reset scény" v SETTINGS místo „Clear" v COMMANDS, sekce „Plánované rozšíření" s composite/grid jako otevřené, chybná cutoff formule `F < 0.01·F_peak`), 7 doporučených, 5 kosmetických.
- **Audit fixes:** README — Roadmap fáze 3 → `rozděláno`, hybrid α verdikt místo „otevřené volby", `manual mód` → `without-interaction`, `Reset scény` → `Clear`, gramatika („deformovat se"), live demo odkaz, `audio/` + `composite.ts` ve struktuře. MODEL — sekce „Modes" přepsána na `without-interaction`/`not-align`/`align`, „Plánované rozšíření" rozdělená na hotové (Spatial grid v S4, Composite Stage 1 v S11) a otevřené (Stage 2/3), opravena cutoff formule (`F(7.5)/F_peak ≈ 0.098`). IDEAS — composite dataset + hybrid orchestrace zkráceno na verdikty/pointery. DONE — sezení přerovnána do strict reverse-chronological. TODO — Stage 2 [~] s poznámkou, Stage 3 disambig, [!] legenda smazána.
- **Magnetic merge Stage 2 — `applyMerge(world, candidate)` v `composite.ts`:**
  - Skip pokud kterákoli strana obsahuje pinned (∞ mass, snap by ho rozhýbal).
  - M_new = M_A + M_B; CoM_new = (M_A·CoM_A + M_B·CoM_B)/M_new; V_new = ∑P/M_new — ∑P preserved.
  - L_total = Σ_X { I_X·ω_X + M_X·(r_X × v_X_rel) } kolem CoM_new (parallel axis Steiner); I_new = Σ_X { I_X + M_X·|r_X|² }; ω_new = L_total/I_new — ∑L preserved.
  - Per pixel rigid-body snap: linvel = V_new + ω_new × r_offset, angvel = ω_new. Pos preserve.
  - Create FixedJoint mezi candidate edge pair (idempotent guard pokrývá race s auto-jointem).
- **App.svelte integrace** — per display tick (5 Hz) po `detectMergeCandidates`, consumed-set guard (každá komponenta zmergována max 1× per tick), gate `integration === 'not-align'` (po revizi z magnet+align bug).
- **E12 — Magnet merge head-on (m=2 vs m=2):** 2 slepence, edges already-in-MAGNET_THRESHOLD při spawnu (distance 0.098 U), slow v=±0.05 → magnet trigger v prvním display ticku PŘED auto-jointem. G=0, not-align, stop @ 3 s. Initial ∑P=0, ∑L=0, KE=0.005. Po inelastic merge: V_new=0, ω_new=0 → KE_after=0 (100% loss). Modelshot: pixely v ±0.537, ±1.537 (1 U distances ✓), all v=0/rs=0/r=0, `px=py=L=ke=0` ✓.
- **E13 — Magnet merge tečně (offset → spin emerge):** 2 single pixely, Y offset ±0.05, slow v=±0.05. Initial ∑P=0, ∑L=−0.005, KE=0.0025. Po merge: V_new=0, ω_new=L/I≈−0.0053 → **spin emerge** z čistě translačního momentum. Modelshot: rs=−0.005386 ✓, ∑L=−0.005000098 (drift v 7. decimále = f32 ulp), KE≈1.35e-5 (99.5% loss).
- **Magnet+align konflikt diagnostikován** — uživatelův modelshot ukázal cluster s pixely v non-1U distances (0.271 U mezi p0 a p13), všichni s drifting velocity. Diagnóza: `applyMerge` hardcoded `createFixedJoint(..., false)` → magnet v align modu vytvořil **not-align jointy** s anchor v current geometrii (ne 1 U grid). Plus hlubší konflikt: Stage 2 math je position-preserving, align je position-snapping → fundamentálně inkompatibilní. **Fix: magnet skip v align mode**. Auto-joint s align=true je jediná správná cesta v align modu, dokud Stage 3 nenahradí FixedJoint.
- **Stage 3 MVP — composite-driven kinematics (`align` mode):**
  - **`Pixel.compositeOffsetX/Y: number | null`** — stable local offset v composite frame. null pro singletony (1-pixel composites integrované Rapierem normálně).
  - **`createFixedJoint(align=true)` po pos/rot snap** volá `recomputeCompositeOffsets(world, a)`:
    - `collectComponent(world, seed)` BFS přes joints najde všechny členy nově joined komponenty.
    - Singleton (1 člen) → null.
    - Multi-pixel: aggregate CoM (mass-weighted), θ = `seed.body.rotation()` (po align snap = 0; v chains stejné dík lockRotations + manual setRotation), offset = R(−θ)·(pos − CoM) pro každého člena.
  - **`stepCompositesAlign(world)`** voláno PO Rapier step v sim loop align case:
    - Pro každý multi-pixel composite: aggregate state (CoM, V, ω) z current pixel velocities (∑P/∑L preserved Rapier joint solverem).
    - Override per člen: pos = CoM + R(θ)·offset, rot = θ (= members[0].rotation), linvel = V + ω × r_world, angvel = ω.
    - Singleton/pinned skip.
    - Bez `dt` parametru — drift už proběhl Rapierem, my snap na rigid-correct geometrii (odstraňuje solver imperfection drift).
  - Sim loop align case split: `not-align` zůstává kick + Rapier; `align` přidává `stepCompositesAlign(w)` po Rapier step.
  - **Empirie (6-pixel chain G=20 po 60 s):** distance mezi všemi sousedy = **1.000 U přesně** ✓, všichni r=−0.516 + rs=−0.012 (composite rotates synchronně). Joint solver Rapieru aplikuje angular impulses i při lockRotations(true), my je propagujeme přes setRotation(members[0].rotation()) → composite rotation **funguje out-of-the-box**. Stage 3.2 (explicit rotation handling) odložen jako not needed for MVP.
- **Lessons learned:**
  - **Magnet+align konflikt** byl predikovatelný z první principů (position-preserving vs position-snapping), ale moje Q3 odpověď neexplorovala konflikty před commitem. **Default to enumerate semantic conflicts** před design lock-in.
  - **Stage 3 lockRotations obavy** byly špatné — Rapier 2D-compat dovolí angular impulses i při locked rotations. **Test before assume** u 3rd-party physics engine s nedokumentovaným chováním.
  - **Stage 2 cadence (per display tick) vs auto-joint (per sim tick) race** je fragile — pro real-world magnet usefulness by detection musela běžet per sim tick s gating přes `compositeCount ≤ N`. E12/E13 design (already-in-threshold spawn) byl workaround místo proper solution.

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
