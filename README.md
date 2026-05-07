# Pixelodynamics

Webová sandbox simulace dynamiky **pixelů** — malých čtvercových rigid bodies, které se postupně učí gravitovat, lepit, lámat a roztrhávat. Cílem je experiment a zábava, ne produkt.

## Stack

- **Vite + TypeScript** (strict)
- **Svelte 5** — UI panely, runes API
- **Rapier 2D** (`@dimforge/rapier2d-compat`) — rigid body container; ve fázi 3+ přebírá joints a kolize
- **WebGL2** — instanced quads pro tisíce rotujících pixelů
- **gl-matrix** — 2D ortografická projekce
- **GitHub Pages** — deploy z `main` přes GitHub Actions

## Roadmap

| Fáze | Cíl | Stav |
|---|---|---|
| 1 — FVP | Ballistický pohyb + rotace, LMB spawn, kamera (WASD + zoom), bez interakcí | hotovo |
| 2 | Párová Newtonova gravitace, manuální symplektický Euler, STATS+FACTS UI | hotovo |
| 3 | Slepování po straně přes `FixedJoint` | — |
| 4 | Hmotnost a pružnost (distance/spring joints, density) | — |
| 5 | Rozbití slepence při překročení impulse threshold | — |
| 6+ | Barvy = různé fyzikální parametry, druhy částic | — |

## Vývoj

```sh
npm install
npm run dev      # Vite dev server
npm run build    # production build → dist/
npm run check    # TypeScript + Svelte check
```

## Ovládání

- **LMB** — spawn pixelu na pozici kurzoru
- **WASD** — pan kamery
- **Y / X** — zoom in / out (klávesy)
- **kolečko myši** — zoom

## Konvence

- Identifikátory anglicky, komentáře česky.
- `kebab-case.ts` filenames, `PascalCase` typy/komponenty, `camelCase` proměnné.
- Bez `T` prefixu u typů (Delphi konvence se zde neaplikuje).
- Strict TS, `noUncheckedIndexedAccess`.

## Licence

[MIT](./LICENSE) — (c) 2026 mrklas69
