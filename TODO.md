# TODO

Markery: `[ ]` čeká · `[~]` rozděláno · `[x]` hotovo · `[!]` priorita.

## Fáze 2 — pixelová gravitace

- [x] Párová Newtonova gravitace s Plummer softeningem
- [x] UI slider pro G; ε a substeps schované jako programové konstanty (`params.ts`)
- [x] Manuální symplektický Eulerův integrátor (Rapier step() obejít) — zachovává ∑P a ∑L
- [x] Substepping (4× per frame) pro nižší truncation error
- [ ] Spatial grid (O(n) místo O(n²)) — spustit, až FPS klesne pod 50 při target N
- [ ] Profilovat: jak vysoké N zvládne current naive O(n²) kód na PC vs. mobilu
- [ ] Vizualizace centroidu jako křížek

## Fáze 3 — slepování

- [ ] **Návrat k Rapier step()** — manuální integrátor + Rapier step pro joints/kolize. Hybrid přechod naplánovat.
- [ ] Detekce „dotyku po straně" — collisionGroups zapnout, contact event
- [ ] FixedJoint mezi sousedy (parametr `H` ze SETTINGS = stiffness)
- [ ] Vizualizace vazeb (čára/barva)
- [ ] Edge case: jeden pixel slepený se 2+ sousedy → struktura, ne řetězec
- [ ] **Composite object dataset** (viz IDEAS.md) — `id, pixelIds, x, y, vx, vy, r, rs, m, I`. Update centroidu při změně topologie nebo per-tick.
- [ ] Wire up Largest a Connections counters do STATS

## Fáze 4 — hmotnost a pružnost

- [ ] Pixel `m` parametr (zatím konstantní 1)
- [ ] Distance/spring joint místo FixedJoint pro pružnost
- [ ] Damping

## Fáze 5 — rozbití

- [ ] Sledovat impulse na jointu
- [ ] Threshold → joint.remove()
- [ ] Test scénář: rotující slepenec se odstředivkou trhá

## UI / Diagnostika

- [x] STATS panel — Time, Pixels, Objects, Connections, ∑P, ∑L
- [x] FACTS panel — Fastest, Spinniest, Most momentum, Most ang. mom., Most massive (klik = kamera)
- [x] Home camera (návrat na 0,0)
- [ ] Largest (Most-pixels-in-object) — až budou objekty
- [ ] Connections counter — až budou jointy
- [ ] Total energy E = KE + PE (validace integrátoru)

## Infrastruktura

- [ ] ESLint + Prettier konfigurace
- [ ] Vitest setup (až bude první testovatelná pure funkce)
- [ ] Touch / pinch zoom pro mobil
- [ ] Adaptivní limit počtu pixelů podle FPS
- [ ] Performance budget: target 60 FPS @ 1000 pixelů na desktopu

## Hotovo

(viz [DONE.md](./DONE.md))
