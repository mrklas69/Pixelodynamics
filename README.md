# Pixelodynamics

Webová sandbox simulace dynamiky **pixelů** — čtvercových rigid bodies o jednotkové straně, které se postupně učí gravitovat, lepit se po hranách, deformovat pružinou, lámat se a roztrhávat při překročení napěťového prahu. Cíl je experimentální: zjistit, kolik emergentního chování se vejde do co nejmenší sady pravidel. Není to produkt.

## Stack

| Vrstva | Volba | Pozn. |
|---|---|---|
| Bundler / dev | **Vite** (Rolldown) + TypeScript strict | `noUncheckedIndexedAccess` |
| UI runtime | **Svelte 5** runes (`$state`, `$derived`) | jen panely, žádný router |
| Rigid body solver | **Rapier 2D** (`@dimforge/rapier2d-compat`) | WASM, f32 interně; ve fázi 3+ převezme joints + kontakty |
| Vlastní integrátor | symplektický Euler v `f64`, kick-drift | obchází Rapier `step()` po dobu, co nejsou kontakty |
| Render | **WebGL2** instanced quads | jeden draw call pro celý svět; rámeček-only fragment shader |
| Math | **gl-matrix** | jen 2D ortografická projekce |
| Deploy | **GitHub Pages** přes Actions | base path přepínaný env `GITHUB_PAGES` |

Detailní popis fyzikálního modelu (rovnice, softening, integrátor, units) je v [`docs/MODEL.md`](./docs/MODEL.md).

## Roadmap

| Fáze | Cíl | Stav |
|---|---|---|
| 1 — FVP | Ballistický pohyb + rotace, LMB spawn, kamera (WASD + zoom), bez interakcí | hotovo |
| 2 | Párová Newtonova gravitace (Plummer softening), manuální symplektický Euler, STATS+FACTS UI | hotovo |
| 3 | Slepování po hraně přes `FixedJoint` | — |
| 4 | Hmotnost a pružnost (distance/spring joints, density) | — |
| 5 | Rozbití slepence při překročení impulse threshold | — |
| 6+ | Barvy = různé fyzikální parametry, druhy částic, magnetismus, teplota | — |

Otevřená architektonická volba pro fázi 3 (orchestrace manual gravity + Rapier `step()`): tři varianty α/β/γ zaznamenané v `IDEAS.md`, rozhodnutí padne na reálném joint scénáři.

## Status conservation laws (manual mód, fáze 2)

| Veličina | Drift po 60 s, N=12 | Floor |
|---|---|---|
| ∑P (lineární hybnost) | ~ 1e-15 | f64 epsilon |
| ∑L (úhlová hybnost) | ~ 1e-16 | f64 epsilon |
| KE (kinetická energie) | osciluje s PE, bez sekulárního trendu | symplektický integrátor |

Hybrid mode (manual gravity + Rapier `step()`) má drift ∑P/∑L o 10⁴× horší kvůli f32 bridge přes WASM. Detail v `docs/diary/2026-05-07.md` (sezení 3, experiment E5 vs. E5m).

## Performance (manual mód, O(N²) gravita, G=1)

| N | Páry | FPS |
|---|---|---|
| 100 | 4 950 | 60 |
| 500 | 124 750 | 60 |
| 1000 | 499 500 | 45 |
| 2000 | 1 999 000 | 12 |

Strop O(N²) padá kolem N≈700. Spatial grid (uniform + cutoff) je další priorita, viz `TODO.md`.

## Vývoj

```sh
npm install
npm run dev      # Vite dev server
npm run build    # production build → dist/
npm run check    # svelte-check + tsc
```

## Ovládání

| Akce | Klávesa / vstup |
|---|---|
| Spawn pixelu | LMB na canvas |
| Pan kamery | <kbd>W</kbd> / <kbd>A</kbd> / <kbd>S</kbd> / <kbd>D</kbd> (ruší lock) |
| Zoom | <kbd>Y</kbd> / <kbd>X</kbd> nebo kolečko myši |
| Pause / resume | <kbd>Space</kbd> |
| Lock kamery na pixel | klik na `#ID` ve FACTS |
| Odemknout kameru | <kbd>Esc</kbd> nebo pan |
| Hover info | najetí kurzorem na pixel |
| Reset scény | tlačítko v SETTINGS |
| Preset experiment | tlačítko v PRESETS |
| Export modelshotu | tlačítko `📋 Export JSON` |

## Konvence

- Konverzace, komentáře, dokumentace: **česky**.
- Identifikátory (proměnné, funkce, soubory, typy): **anglicky**.
- `kebab-case.ts` filenames, `PascalCase` typy/komponenty, `camelCase` proměnné.
- Bez `T` prefixu u typů.
- TypeScript strict + `noUncheckedIndexedAccess`.
- `r` (rotace), `rs` (úhlová rychlost) — izomorfně mezi `Pixel` a budoucím `CompositeObject`.

## Struktura

```
src/
  sim/         fyzika, gravitace, integrátor, presety, diagnostika
  render/      WebGL2 renderer, kamera
  input/       klávesnice
  ui/          Svelte panely, formátování, tooltip
docs/
  MODEL.md     formální popis fyzikálního modelu
  diary/       záznamy sezení (YYYY-MM-DD.md)
```

## Licence

[MIT](./LICENSE) — (c) 2026 mrklas69
