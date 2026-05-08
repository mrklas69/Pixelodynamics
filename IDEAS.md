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

**Stage 3.1 (TODO)** — chain-merge re-align: pokud 2 multi-pixel chains se spojí, re-snapnout obě na 1U grid. Fixne user-reported cluster bug ze S11/S12.

**Stage 3.2 (TODO)** — composite rotation explicit handling: odstranit lockRotations + drive θ čistě architektonicky.

**Magnet re-aktivace v align mode (TODO)** — po Stage 3.1/3.2: applyMerge + recomputeOffsets v rámci composite-driven framework.

### Align rotation limitation (sezení 11 → IDEAS, motivace pro magnetic merge)

Současný `align` mode v `createFixedJoint` snapuje `r=0` jen na 2 pixelech (a, b) joint pair. Pokud jeden je v existing rotujícím chainu, snap rotace **invaliduje joint anchory** v lokálním frame (anchor world pozice se po setRotation(0) změní → solver violence → overlap).

**Workaround**: align je usable jen pro **fresh pair scenarios bez initial rotace** (E1align/E2align). Pro rotující bodies use not-align (E3 — věrná fyzika, conservation 0.09%).

**Proper fix vyžaduje magnetic merge Stage 3** — composite-driven model nahrazuje FixedJoint anchor calc, takže "snap rotace" se stane součástí merge step (re-orient celé komponenty kolem CoM_new), ne per-pixel destruktivní operace.

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
