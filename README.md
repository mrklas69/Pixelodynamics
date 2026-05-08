# Pixelodynamics

Webová sandbox simulace dynamiky **pixelů** — čtvercových rigid bodies o jednotkové straně, které se postupně učí gravitovat, lepit se po hranách, deformovat se pružinou, lámat se a roztrhávat při překročení napěťového prahu. Cíl je experimentální: zjistit, kolik emergentního chování se vejde do co nejmenší sady pravidel. Není to produkt.

Live demo: <https://mrklas69.github.io/Pixelodynamics/>

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
| 3 | Slepování po hraně přes `FixedJoint` (Stage 3a auto-jointing + composite dataset Stage 1) | rozděláno |
| 4 | Hmotnost a pružnost (distance/spring joints, density) | — |
| 5 | Rozbití slepence při překročení impulse threshold | — |
| 6+ | Barvy = různé fyzikální parametry, druhy částic, magnetismus, teplota | — |

Hybrid orchestrace pro fázi 3 byla vyřešena Velocity-Verlet split modelem (`not-align` mode, dříve `hybrid-α`): manuální gravita dělá `kick`, Rapier dělá `drift` + joint solver. Detail v `IDEAS.md` (lessons learned) a `DONE.md` (sezení 8–11).

## Status conservation laws (`without-interaction` mód, fáze 2)

| Veličina | Drift po 60 s, N=12 | Floor |
|---|---|---|
| ∑P (lineární hybnost) | ~ 1e-15 | f64 epsilon |
| ∑L (úhlová hybnost) | ~ 1e-16 | f64 epsilon |
| KE (kinetická energie) | osciluje s PE, bez sekulárního trendu | symplektický integrátor |

`not-align` mode (Velocity-Verlet split: manual `kick`, Rapier `drift` + joint solver) drží ∑P/∑L na úrovni f32 ulp (~1e-7), ∑E drift 0.04 % / 30 s na E8 sweep. Naivní hybrid bez splitu (sezení 3, E5 vs. E5m) integroval pohyb dvakrát a byl odmítnut.

## Performance (`without-interaction` mód, O(N²) gravita, G=1)

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
| Clear scény | tlačítko `Clear` v COMMANDS |
| Preset experiment | tlačítko v PRESETS |
| Export modelshotu | tlačítko `📋 Export JSON` v COMMANDS |

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
  sim/         fyzika, gravitace, integrátor, jointy, presety, composite dataset, diagnostika
  render/      WebGL2 renderer, kamera
  input/       klávesnice
  audio/       SFX pool (click pro joint create/break, spawn pro LMB)
  ui/          Svelte panely, formátování, tooltip
docs/
  MODEL.md     formální popis fyzikálního modelu
  diary/       záznamy sezení (YYYY-MM-DD.md)
```

## Licence

[MIT](./LICENSE) — (c) 2026 mrklas69
