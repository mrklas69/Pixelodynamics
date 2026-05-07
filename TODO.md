# TODO

Markery: `[ ]` čeká · `[~]` rozděláno · `[x]` hotovo · `[!]` priorita.

## Fáze 2 — pixelová gravitace

- [ ] Rozhodnout: centrální gravitace (k nule), párová gravitace (O(n²) GMm/r²), nebo k těžišti
- [ ] Pokud párová → spatial grid pro O(n)
- [ ] UI slider pro intenzitu

## Fáze 3 — slepování

- [ ] Detekce „dotyku po straně" — collisionGroups zapnout, contact event
- [ ] FixedJoint mezi sousedy
- [ ] Vizualizace vazeb (čára/barva)
- [ ] Edge case: jeden pixel slepený se 2+ sousedy → struktura, ne řetězec

## Fáze 4 — hmotnost a pružnost

- [ ] Pixel `m` parametr (zatím konstantní 1)
- [ ] Distance/spring joint místo FixedJoint pro pružnost
- [ ] Damping

## Fáze 5 — rozbití

- [ ] Sledovat impulse na jointu
- [ ] Threshold → joint.remove()
- [ ] Test scénář: rotující slepenec se odstředivkou trhá

## Infrastruktura

- [ ] ESLint + Prettier konfigurace
- [ ] Vitest setup (až bude první testovatelná pure funkce)
- [ ] Touch / pinch zoom pro mobil
- [ ] Adaptivní limit počtu pixelů podle FPS
- [ ] Performance budget: target 60 FPS @ 1000 pixelů na desktopu

## Hotovo

(viz [DONE.md](./DONE.md))
