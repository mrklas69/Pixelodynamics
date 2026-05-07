# DONE

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
