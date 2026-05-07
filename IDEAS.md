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

- **Multithreaded Rapier** — `@dimforge/rapier2d` (ne -compat) běží přes WebWorker. Cena: cross-origin isolation v deploy. Až bude potřeba.
- **GPU-side instance buffer** — místo CPU upload každý frame, sdílená paměť přes WebGPU compute. Velký krok, jen pokud narazíme na strop.

## Lessons learned

### Rapier integrátor pro orbitální problémy
**Problém:** Rapier 2D step() nezachovává ∑P a ∑L pro čistě gravitační simulaci s external forces přes addForce. Stabilizační kroky určené na contacts a joints aktivně škodí orbital dynamics — ∑P klesá (numerické tlumení), ∑L diverguje řády (close-encounter slingshots).

**Řešení pro FVP:** Vlastní symplektický Euler, Rapier step() obejít. Konzervační zákony drží na úroveň float roundoff.

**Otevřené pro fázi 3:** Až přijdou joints + kolize, manuální integrátor sám nestačí. Buď hybrid (gravitace ručně, joints/kolize Rapierem), nebo akceptovat drift až bude přítomna disipace z kolizí (která je beztak silnější).
