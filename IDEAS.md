# IDEAS

Surové nápady. `→ TODO` značí, že je nápad zralý a přesunutý do `TODO.md`. `→ DONE` že už se realizoval.

## Architektura

### Auto-jointing edge case: pair-to-pair collision (sezení 10 → IDEAS)

Když dva slepence (každý m≥2) se srazí, contact event vzniká **mezi dvěma pixely**, jeden v slepenci A, druhý v B. Současný `drainAndAutoJoint` automaticky vytvoří joint mezi nimi → ze 2 slepenců 1 větší. Logika je správná (duplicate guard se týká pixel pair, ne object pair), ale **empirický test chybí** — preset E12 = 2 head-on slepence m=2 by potvrdil. Edge mask by měl reflektovat nový joint na styčných hranách obou slepenců.

### Composite object dataset (fáze 3+) — Stage 1 → DONE sezení 11

Cache pre-computed state pro každý slepený objekt. Stage 1 (sezení 11) implementuje detection-only verzi v `src/sim/composite.ts`:

```ts
type Composite = {
  id: number;
  members: Pixel[];
  com: { x, y };           // těžiště
  linvel: { x, y };        // rychlost těžiště
  angvel: number;          // L_total / I_total
  mass: number;            // Σ m
  inertia: number;         // Σ (m·|r_rel|² + m/6)  parallel axis (Steiner)
};
```

**Naming:** `rs` (ne VR/omega/w) — izomorfismus s `Pixel.rs`. Princip: podobné věci stejná jména. Composite zatím používá `angvel` (jednodušší v implementaci), bude vyrovnáno na `rs` v Stage 3.

**Otevřené otázky:**
- `r` (orientace složeného objektu) — fix-on-spawn nebo nepoužívat? Pro vykreslení centroidu (křížek) `r` není potřeba. Pro Stage 3 (composite-driven kinematics) je nutné.
- Update strategy: full recompute každý tick, nebo incremental update jen na změnách topologie? Při dynamické gravitaci se beztak musí pixel pozice číst → full recompute O(n) je akceptovatelný (potvrzeno v Stage 1: per-display-tick 5 Hz, žádná perf regrese).

### Magnetic merge algorithm (sezení 11 → TODO Stage 2/3)

Uživatelův návrh inelastic merge přes magnetic edge attraction (4 kroky):

1. **Test all object pairs** — jsou volné hrany v dosahu (`MAGNET_THRESHOLD`)? Volnou hranu si představuji jako silný magnet.
2. **Pokud ano, vypočítej možný spoj.** Pozor na kolize dalších součástí obou objektů.
3. **Sečti sumy hybnosti, momentu hybnosti, mechanické energie** — vše, co by se mělo zachovat.
4. **Vytvoř nový slepenec** s pos = vážený střed podle hmotností. Nastav atributy tak, aby zachovat invarianty.

**Stage 1 (sezení 11):** Composite + freeEdges + segmentDistance + detectMergeCandidates. Detection only, no merge. STATS counter "Merge cand." jako verifier.

**Stage 2 (next session):** inelastic merge math:
- M_total = M_A + M_B
- CoM_new = (M_A·CoM_A + M_B·CoM_B) / M_total
- V_new = (M_A·V_A + M_B·V_B) / M_total  →  ∑P preserved
- L_total_rel_new = L_A_rel_new + L_B_rel_new (orbital + spin přes Steiner)
- ω_new = L_total_rel_new / I_new  →  ∑L preserved
- KE_new = ½·M·V_new² + ½·I·ω_new² < KE_init  (inelastic merge ztrácí relativní KE → pro fáze 4+ s pružnými spring jointy se ztracená KE rozetře do vibrace)

**Stage 3 (next next session):** composite-driven kinematics nahrazuje FixedJoint v align režimu:
- Per-tick: aggregate gravity force per-pixel → translational acceleration na CoM. Aggregate gravity torque kolem CoM → angular acceleration.
- Update CoM kinematics: x += V·dt, V += a·dt; θ += ω·dt, ω += τ/I·dt.
- Pixel pos = CoM + R(θ) · offset_local (offset je vázaný v okamžik merge).
- Render: pixel.body.translation/rotation odvozeno z composite state per tick.
- Auto-merge: per-tick proximity check → pokud detected, apply Stage 2 merge math, update offset_local.

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

### Hybrid orchestrace pro fázi 3 — tři varianty (→ DONE sezení 9)

**Kontext (sezení 3):** E5 vs. E5m empiricky potvrdilo, že naivní `manuální stepGravity + Rapier.step()` integruje pohyb **dvakrát** (manual drift + Rapier drift), simulace běží zhruba 2× rychleji než pure manual. Plus Rapier WASM bridge ve f32 → ∑P/∑L drift 10⁴× horší (1e-12 vs. 1e-15 v pure manual). Naive hybrid je nepoužitelný.

**Update (sezení 8):** Po E3-tune víme, že rapier joint solver je po `canSleep=false` + `solverIterations=16` + `pgsIterations=4` použitelný — drift po 10s je 0.01% na ω. Joint-side dissipace v rapieru NENÍ problém; problém zůstává **gravity-side** integrace v rapieru (sezení 2).

**Verdikt (sezení 9, E8 sweep):**

- **(α) Velocity-Verlet split — winner.** ∑E drift 0.04 %/30 s, joint distance preserve, rs=0.32 (gravita-induced precesní moment). Etablováno jako default `hybrid-α` mode.
- **(β) Save-zero-restore — broken.** ∑E drift 13 %/30 s + rs ≈ 0 (pair se netočí). Nulování vel před Rapier stepem maskuje gravitační stress pro joint solver — nedá tidal torque. Plus position-based Baumgarte přes f32 round-trip dissipuje energii. Kód zachován pro reprodukovatelnost, ale empiricky vyloučen.
- **(γ) Conditional Rapier step — orthogonal flag.** Implementováno jako `SKIP_RAPIER_IF_NO_JOINTS=true` v params.ts. Když `world.joints.length === 0`, hybrid-α/β degeneruje na pure manual (∑P/∑L f64 ulp). Auto-aktivuje se s prvním jointem. Žádné per-mode UI — jen flag.

### Rapier "broken pro orbit" je broader princip než jen integrátor (sezení 9)

E8r modelshot odhalil, že pure rapier mode v naší architektuře **nezavolá `stepGravity` vůbec**. Naše párová gravita = external force, kterou Rapier nezná. Rapier global gravity = 0 (nastaveno v `init`). Free pair v E8r tedy letí balisticky, ne v orbitě.

To není "bug" — je to design rozhodnutí. Pure rapier mode = "co Rapier dělá sám" pro experimenty E1–E4 (G=0 setup). Pro E8r jsme ho vědomě zneužili a zjistili limit. **Pro orbit dynamics existuje jen manual + α (ne β, ne pure rapier).**

**Lekce (memory candidate):** Před spuštěním nového presetu **mental run-through "co každý mód v daném setupu udělá"**. Ne až modelshot. Sezení 4 censure (sanity check matic) generalizuje na **algoritmický + setup sanity check**.

### Rapier sleep mode jako anti-feature (sezení 8)

`canSleep=true` (default Rapier) uspí těleso, jehož `linvel` + `angvel` zůstanou pod threshold po určitý čas. Pro herní scénáře (mnoho neaktivních objektů na scéně) úspora CPU. Pro fyzikální sandbox **anti-feature** — uspí rotující rigid pair během <2 s a tichne dynamics (E3 default modelshot: KE=0 po 10s, fit `λ≈0.5/s` exponential decay).

**Lekce:** Default config knihoven optimalizován pro nejčastější use case (typicky herní). Pro physics simulation MUST audit defaults — sleep, damping, ERP, solver iterations, CCD — a explicitně přepsat ty, kde se naše use case liší.

Memory `feedback_default_config_audit` zvážit, pokud se Rapier default-bias projeví znovu.
