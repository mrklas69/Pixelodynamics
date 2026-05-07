# IDEAS

Surové nápady. `→ TODO` značí, že je nápad zralý a přesunutý do `TODO.md`. `→ DONE` že už se realizoval.

## Architektura

### Composite object dataset (fáze 3+)

Cache pre-computed state pro každý slepený objekt. Důvod: každý tick nepřepočítávat těžiště, momenty atd. — jen když se změní topologie (přibude/odejde pixel z objektu).

```ts
type CompositeObject = {
  id: number;
  pixelIds: number[];      // pixely v objektu
  x: number; y: number;    // těžiště (Σ mᵢ·rᵢ / Σ mᵢ)
  vx: number; vy: number;  // rychlost těžiště
  r: number;               // orientace — fix-on-spawn + integrace přes rs
  rs: number;              // úhlová rychlost objektu vůči těžišti
  m: number;               // Σ mᵢ
  I: number;               // moment setrvačnosti vůči těžišti
};
```

**Naming:** `rs` (ne VR/omega/w) — izomorfismus s `Pixel.rs`. Princip: podobné věci stejná jména.

**Otevřené otázky:**
- `r` (orientace složeného objektu) — fix-on-spawn nebo nepoužívat? Pro vykreslení centroidu (křížek) `r` není potřeba.
- Update strategy: full recompute každý tick, nebo incremental update jen na změnách topologie? Při dynamické gravitaci se beztak musí pixel pozice číst → full recompute O(n) je akceptovatelný.

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

### Hybrid orchestrace pro fázi 3 — tři varianty

**Kontext (sezení 3):** E5 vs. E5m empiricky potvrdilo, že naivní `manuální stepGravity + Rapier.step()` integruje pohyb **dvakrát** (manual drift + Rapier drift), simulace běží zhruba 2× rychleji než pure manual. Plus Rapier WASM bridge ve f32 → ∑P/∑L drift 10⁴× horší (1e-12 vs. 1e-15 v pure manual). Naive hybrid je nepoužitelný.

Tři architektonické cesty, žádná zatím empiricky netestovaná na realných jointech:

- **(α) Velocity-Verlet split:** `stepGravity` dělá jen `v += a·dt` (kick); pos drift udělá Rapier `step()` jednou per frame. Standardní pattern. Risk: f32 drift v Rapieru se přenese na pos všech pixelů, ne jen na ty s constraints.
- **(β) Save-zero-restore vel:** manual dělá kick+drift normálně. Před `Rapier.step()` linvel uložíme stranou, vynulujeme → Rapier neposune pos (jen vyřeší constraints) → po stepu čteme delta linvel z constraint impulses, přičteme k uloženým. Komplexní, ale Rapier neovlivní kinematiku. Risk: konfliktní logika v Rapier solveru (může spoléhat na nenulovou vel).
- **(γ) Rapier step jen když existují aktivní jointy/kontakty:** v čistě orbitálních fázích (před slepenci) bypass Rapier. Při fázi 3 detekce zapne `step()`. Nejjednodušší, ale "bimodální" chování — výkonový profil mění se stavem. Risk: přepnutí může mít edge cases (jeden frame jointy, druhý ne).

**Co rozhodne volbu:** reálný scénář se 2 pixely + FixedJoint, jeden v pohybu. Naměřit pos/vel po N krocích pro každou variantu, porovnat s analytickým řešením rigid těla.
