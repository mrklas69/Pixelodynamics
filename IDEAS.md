# IDEAS

Surové nápady. `→ TODO` značí, že je nápad zralý a přesunutý do `TODO.md`. `→ DONE` že už se realizoval.

## Architektura

### Auto-jointing edge case: pair-to-pair collision (sezení 10 → IDEAS)

Když dva slepence (každý m≥2) se srazí, contact event vzniká **mezi dvěma pixely**, jeden v slepenci A, druhý v B. Současný `drainAndAutoJoint` automaticky vytvoří joint mezi nimi → ze 2 slepenců 1 větší. Logika je správná (duplicate guard se týká pixel pair, ne object pair), ale **empirický test chybí** — preset E12 = 2 head-on slepence m=2 by potvrdil. Edge mask by měl reflektovat nový joint na styčných hranách obou slepenců.

### Composite object dataset → DONE Stage 1 (sezení 11)

Implementováno v `src/sim/composite.ts`. Stage 2/3 viz „Magnetic merge algorithm" níže. **Otevřené pro Stage 3:**
- `Composite.angvel` zarovnat na `rs` (izomorfismus s `Pixel.rs`).
- `r` (orientace) — bude potřeba pro composite-driven kinematics, fix-on-merge.

### Magnetic merge algorithm — Stage 1 + 2 + 3 MVP → DONE (sezení 11–12)

**Stage 1 (S11) — DONE.** `composite.ts` Composite type, freeEdges, segmentDistance, detectMergeCandidates. Pure detection.

**Stage 2 (S12) — DONE.** `applyMerge(world, candidate)` inelastic merge math:
- M_new = M_A + M_B; CoM_new = vážený střed; V_new = ∑P/M_new (∑P preserved).
- L_total kolem CoM_new přes parallel axis (Steiner); ω_new = L_total/I_new (∑L preserved).
- Pixel rigid-body snap: linvel = V + ω×r, angvel = ω. Pos preserve.
- FixedJoint create mezi candidate edge pair.
- E12/E13 verified ∑P/∑L conservation do f32 ulp; spin emerge z translačního momentu v E13 ✓.
- **Gate `integration === 'not-align'`** — magnet+align konflikt (position-preserving vs position-snapping) skip pro tonight.

**Stage 3 MVP (S12) — DONE.** Composite-driven kinematics v `align` mode:
- `Pixel.compositeOffsetX/Y` stable local offset, set v `createFixedJoint(align=true)` přes BFS recompute.
- `stepCompositesAlign(world)` po Rapier step override pos/rot/linvel/angvel z aggregate state.
- 6-pixel chain v G=20 po 60 s: 1.000 U distances přesně, composite rotates synchronně (Rapier joint solver dodá angular impulses přes lockRotations, my propagujeme).

**Stage 3.1 (S13) — DONE.** `createFixedJoint(align=true)` 4-cestný rozcestník (same-component / fresh-fresh / fresh+chain / chain+chain). Menší řetězec rigid-transformován **celý** (rotace o Δθ kolem guestPos + translace) v host local frame. Internal joint anchory v body local frames preserved. ∑P preserved (V_unified = ∑P/M), ω=0 (explicit angular momentum loss). Bonus fix: fresh+chain s rotated chainem byl **také rozbitý** (`setRotation(0)` na chain pixelu lámal anchory), sjednocená cesta to vyřešila.

**Stage 3.1 bug fixes (S14) — DONE.** E14 modelshot odhalil 2 critical bugy: (1) `createFixedJoint(align=true)` chain+chain volil host/guest pixel z `(a,b)` argumentů contact eventu, ne z edge proximity → pokud kontakt s interním pixelem hostu, target leží na obsazené pozici → překryv. Fix: nový `autoJointAlign` v `joints.ts` filtruje same-component eventy + vybírá endpoint pixely (degree ≤ 1) nejblíže kontaktnímu páru. Same-component branch v `createFixedJoint` early-return null. (2) `connect()` v preset API volal `createFixedJoint` bez align flag → chain joints v not-align mode → compositeOffsetX/Y null → kolaps na CoM v align mode. Fix: `connect` propaguje `integration === 'align'` flag.

**Stage 3.2 (S14) — DONE.** Composite rotation explicit handling: `Pixel.compositeTheta` field (sdílen všemi members), `stepCompositesAlign(world, dt)` driveuje `θ_new = θ_old + ω·dt` + setRotation propagace, `lockRotations` zcela odstraněno z align mode. Joint solver volně iteruje individual rotations, my každý tick override z aggregate state. Bez user-visible benefitu pro ω=0 scénáře, ale architecturally clean a odblokoval magnet re-aktivaci.

**Magnet re-aktivace v align mode (S14) — DONE.** `applyMerge(world, candidate, align)` rozšířen o flag; v align cestě deleguje na `createFixedJoint(..., true)` (Stage 3.1 chain-merge), v not-align beze změny. Auto-joint a magnet sdílí jednu cestu v align mode (single source of truth pro merge geometry).

### Align rotation limitation (sezení 11 → IDEAS, motivace pro magnetic merge)

Současný `align` mode v `createFixedJoint` snapuje `r=0` jen na 2 pixelech (a, b) joint pair. Pokud jeden je v existing rotujícím chainu, snap rotace **invaliduje joint anchory** v lokálním frame (anchor world pozice se po setRotation(0) změní → solver violence → overlap).

**Workaround**: align je usable jen pro **fresh pair scenarios bez initial rotace** (E1align/E2align). Pro rotující bodies use not-align (E3 — věrná fyzika, conservation 0.09%).

**Proper fix vyžaduje magnetic merge Stage 3** — composite-driven model nahrazuje FixedJoint anchor calc, takže "snap rotace" se stane součástí merge step (re-orient celé komponenty kolem CoM_new), ne per-pixel destruktivní operace.

### Stage 3.2 ω drift v align mode (sezení 15 → IDEAS)

E15 odhalil systematic ω drift -0.14 %/10 s v align mode pro G=0 izolaci (žádné externí síly). Není to f32 ulp (ulp by měl random sign), je to dissipativní efekt: Rapier joint solver iteruje pos correction impulsy (constraint violation z linear extrapolace v drift kroku), které lehce mění L; `computeAggregate` v dalším ticku čte post-solver state → `c.angvel = L/I` lehce klesá. Stage 3.2 pak driveuje `θ_new = θ_old + c.angvel·dt`, takže drift se promítne do θ.

Pro current fáze (krátké experimenty < 30 s) zanedbatelné. Pro Fáze 6+ long-run scénáře (rotující prsten v gravitě, "tři kupy") by 1 %/min mohlo být patrné.

**Možný refactor:** ω driveuovat **explicitně** (jako θ) — uložit `Pixel.compositeAngvel: number | null` (sdílen jako compositeTheta), updateovat **pouze** přes external impulses (kontaktní eventy, magnet inelastic merge), ne přes per-tick aggregate read. Pak `c.angvel` v `stepCompositesAlign` čteme z compositeAngvel místo computeAggregate.

Cena: dvě authoritative state (θ + ω) místo jednoho. Compute order: θ_new = θ_old + ω_old·dt; ω se mění **jen** v event-driven cestách. Trade-off: čistší konzervace vs. komplexnější update path. Nech na později, až bude trigger (long-run scénář, kde drift bolí).

### Snake-growth fix → DONE (sezení 16)

S14 `pickClosestEndpoint` (degree ≤ 1 filter) způsoboval, že chainy rostly **jen po jedné ose**: pixel z boku interního pixelu chainu skončil přilepený na vzdálený endpoint, ne na bok kontaktního pixelu. S16 nahrazen `findBestJointPair` — full enumeration všech volných hran všech pixelů obou chainů, vyhraj pár s nejnižším skóre `|hostMid − bPos| + |guestMid − aPos|` s constraintem `guestDir = opposite(hostDir)`.

Doplněno: po primary jointu **secondary detection** — projet páry merged komponenty na edge-touching (Δpos ≈ ±1 v dominant local axis, oba dirs free), vytvořit `kind: 'secondary'` jointy. Bez tohoto by 2 paralelní chainy m=3 narazené bokem skončily s 1 jointem; teď vznikne plný 2×3 grid se 7 jointy.

**Constraint paralelní chainů**: rotace o Δθ = θ_host − θ_guest zarovnává guest local frame s host's. T-jointy s chainem rotated 90° vůči hostu jsou mimo scope (potřebovaly by extra Δθ ± π/2). Otevřeno pro Fázi 4+ pokud user trigger.

### Magnet timing v align mode → DROP (sezení 16)

S14/S15 Příště „magnet trigger v align suspect" — magnet check běží na display ticku (5 Hz), auto-joint na sim ticku (60 Hz), magnet block je v App.svelte loopu **po** všech sim tickech v rámci frame. Pro fast-closing scenarios (E14 closing 1 U/s, magnet okno 0.1 s, display perioda 0.5 s) magnet typicky nestihne před auto-jointem. Pro slow scenarios (E12 closing 0.1 U/s, okno 1 s) vždy stihne. **Není to bug v `freeEdges` pro rotated chain** (S14 hypotéza), je to frame-rate coupling. V S16 magnet `applyMerge(align=true)` deleguje na stejnou cestu jako auto-joint (`joinAlignedExplicit`), takže outcome je identický → testovatelné jen instrumentací. DROP.

### Hard cutoff isolation (sezení 11 → IDEAS)

Pixel mimo `cutoff = ε · cutoffFactor` od všech sousedů zamrzne (force=0 přesně, žádné "weak attraction"). Není to bug, ale model UX překvapení (uživatel intuitivně čeká `1/r²` všude, ale grid je culling decision).

**Možné UX zlepšení:**
- Vizuální signál pro isolated pixel — halo nebo barevný indicator.
- Hover tooltip "force = 0 (isolated)".
- Default `cutoffFactor` zvednout (např. 8) — cena: víc párů per tick.
- Smoothstep tail extend přes celý cutoff range (force klesá do 0 hladce, ale pořád konečný dosah).

## Fyzikální mechaniky

- **Barvy = různé druhy částic** — různá hmotnost, pružnost, hustota, „chemická" preference (vodík se lepí jen s vodíkem). Inspirace Powder Toy / Noita.
- **Teplota** — jako per-pixel skalár; difundovala by mezi slepenými sousedy. Vysoká teplota = tání = ztráta vazeb.
- **Rotační moment ze srážky** — když srazí pixel rotující slepenec, předá mu úhlovou hybnost. Rapier to dělá automaticky, jen vizuálně otestovat.
- **Magnetismus** — pixely s nábojem +/- se přitahují/odpuzují. Inverzní čtverec → potřeba spatial grid.

## Vizualizace

- **Trail** — krátká stopa za rychle letícím pixelem.
- **Heat map vazeb** — barva vazby podle aktuálního stresu (stress test pružnosti).
- **Centrum hmoty** — vykreslit jako křížek u slepence.

## UX

- **Pause/play** — mezerník.
- **Time scale** — zpomalený čas pro detailní pozorování srážek.
- **Recorder** — uložit a přehrát scénu.
- **Preset scénáře** — „raketa do zdi", „rotující prsten", „tři kupy".

## Performance

- **Smoothstep cutoff tail** (sezení 4 → DONE sezení 5) — implementováno jako default `GRAVITY_TAIL_WIDTH = 1.0`. 3-2 polynom W(r), `U_mod = U·W`, `F = -dU_mod/dr` rigorózně. ∑E drift 1e-3/60s ≈ symplectic Euler truncation. Klíčové zjištění: smoothstep řeší **energy conservation across cutoff** (KE skoky), NE **approximation quality** (cut long-range gravity zůstává). Pro spread setup se grid stále chová kvalitativně jinak než naive.
- **Multithreaded Rapier** — `@dimforge/rapier2d` (ne -compat) běží přes WebWorker. Cena: cross-origin isolation v deploy. Až bude potřeba.
- **GPU-side instance buffer** — místo CPU upload každý frame, sdílená paměť přes WebGPU compute. Velký krok, jen pokud narazíme na strop.

## Lessons learned

### Rapier integrátor pro orbitální problémy
**Problém:** Rapier 2D step() nezachovává ∑P a ∑L pro čistě gravitační simulaci s external forces přes addForce. Stabilizační kroky určené na contacts a joints aktivně škodí orbital dynamics — ∑P klesá (numerické tlumení), ∑L diverguje řády (close-encounter slingshots).

**Řešení pro FVP:** Vlastní symplektický Euler, Rapier step() obejít. Konzervační zákony drží na úroveň float roundoff.

**Otevřené pro fázi 3:** Až přijdou joints + kolize, manuální integrátor sám nestačí. Buď hybrid (gravitace ručně, joints/kolize Rapierem), nebo akceptovat drift až bude přítomna disipace z kolizí (která je beztak silnější).

### Hybrid orchestrace — verdikty (→ DONE sezení 9, refaktor S11)

Tři varianty zvážené v sezení 9 nad E8 sweep (pinned attractor + free pair s FixedJoint):

- **(α) Velocity-Verlet split — winner.** Manual `kick`, Rapier `drift` + joint solver. ∑E drift 0.04 %/30 s, joint distance preserve. Etablováno jako default `not-align` v S11 (dříve `hybrid-α`).
- **(β) Save-zero-restore — broken.** Nulování vel před Rapier stepem maskuje gravitační stress pro joint solver → rs ≈ 0 + 13 % ∑E leak. V S11 odstraněno z kódu.
- **(γ) Conditional Rapier step — orthogonal flag.** `SKIP_RAPIER_IF_NO_JOINTS` v `params.ts`, později smazáno v S11 (po zavedení auto-jointu γ přestal být orthogonal — auto-joint vyžaduje broadphase běh).

**Naivní hybrid (S3 baseline, E5 vs. E5m):** integroval pohyb dvakrát (manual drift + Rapier drift), ∑P/∑L drift 10⁴× horší kvůli f32 WASM bridge. Odmítnut.

### Rapier "broken pro orbit" je broader princip než jen integrátor (sezení 9)

E8r modelshot odhalil, že pure rapier mode v naší architektuře **nezavolá `stepGravity` vůbec**. Naše párová gravita = external force, kterou Rapier nezná. Rapier global gravity = 0 (nastaveno v `init`). Free pair v E8r tedy letí balisticky, ne v orbitě.

To není "bug" — je to design rozhodnutí. Pure rapier mode = "co Rapier dělá sám" pro experimenty E1–E4 (G=0 setup). Pro E8r jsme ho vědomě zneužili a zjistili limit. **Pro orbit dynamics existuje jen manual + α (ne β, ne pure rapier).**

**Lekce (memory candidate):** Před spuštěním nového presetu **mental run-through "co každý mód v daném setupu udělá"**. Ne až modelshot. Sezení 4 censure (sanity check matic) generalizuje na **algoritmický + setup sanity check**.

### Rapier sleep mode jako anti-feature (sezení 8)

`canSleep=true` (default Rapier) uspí těleso, jehož `linvel` + `angvel` zůstanou pod threshold po určitý čas. Pro herní scénáře (mnoho neaktivních objektů na scéně) úspora CPU. Pro fyzikální sandbox **anti-feature** — uspí rotující rigid pair během <2 s a tichne dynamics (E3 default modelshot: KE=0 po 10s, fit `λ≈0.5/s` exponential decay).

**Lekce:** Default config knihoven optimalizován pro nejčastější use case (typicky herní). Pro physics simulation MUST audit defaults — sleep, damping, ERP, solver iterations, CCD — a explicitně přepsat ty, kde se naše use case liší.

Memory `feedback_default_config_audit` zvážit, pokud se Rapier default-bias projeví znovu.
