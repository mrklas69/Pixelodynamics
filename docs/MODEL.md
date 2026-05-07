# Pixelodynamics — fyzikální model

Formální popis simulačního modelu. Pro high-level přehled viz [README](../README.md).

## Jednotky

Jednotky jsou bezrozměrné, ale s konzistentní algebrou:

| Symbol | Význam | Jednotka |
|---|---|---|
| `U` | strana pixelu | délka |
| `t` | krok simulace | čas |
| `m` | hmotnost pixelu (zatím konstantně 1) | hmotnost |

Odvozeniny: rychlost `U/t`, hybnost `m·U/t`, úhlová rychlost `1/t` (rad/t), úhlová hybnost `m·U²/t`, energie `m·U²/t²`.

V kódu se píší jako `kg·U/t` apod., kde `kg` je placeholder pro hmotnostní jednotku — v praxi `m=1` ve všech testech.

## Stav pixelu

```
Pixel = (id, x, y, vx, vy, r, rs, m)
```

Souřadnice `x, y` — střed pixelu. Rotace `r ∈ ℝ`, ve světovém zápisu Rapier wrappuje do `(-π, π]` při čtení; pro „kolik plných otoček" je potřeba samostatný kumulativní counter, ten zatím není.

Moment setrvačnosti čtverce o straně `s = 1 U` vůči středu:

$$ I_\square = \frac{m \cdot s^2}{6} = \frac{m}{6} $$

Tato hodnota je hardcoded v `diagnostics.ts` a `facts.ts` — pokud někdy přijdou pixely jiných tvarů, musí se generalizovat.

## Síly — fáze 2: párová Newtonova gravitace

Mezi každou dvojicí pixelů `(i, j)`:

$$ \mathbf{F}_{ij} = G \frac{m_i m_j}{(r_{ij}^2 + \varepsilon^2)^{3/2}} \, \mathbf{r}_{ij} $$

kde `r_{ij} = x_j - x_i` a `r_{ij} = ||r_{ij}||`. Skalární faktor `G` je uživatelský slider (0–20), default 1.

### Plummer softening

Plummer kernel s parametrem `ε` (`GRAVITY_EPSILON = 1.5 U` v `params.ts`) regularizuje sílu při `r → 0`:

$$ F_\text{peak} = \frac{G m^2}{\varepsilon^3} $$

konečná, takže close encounter neletí slingshotem do nekonečna. Reference: Aarseth, *Gravitational N-Body Simulations* (2003), kap. 3.

Potenciální energie souhlasná s force kernelem:

$$ U_{ij}(r) = -\frac{G m_i m_j}{\sqrt{r^2 + \varepsilon^2}} $$

Implementace v `src/sim/gravity.ts` počítá oboje v jednom průchodu, aby diagnostický `KE + PE` byl validně srovnatelný (force a potenciál musí být ze stejné rodiny, jinak energie diverguje uměle).

`ε = 1.5 U` znamená, že force peak na vzdálenosti pixel-na-pixel (`r ~ U`) je tlumený zhruba 4×, ale na orbital scale (`r ≫ ε`) je tlumení pod 1 %.

`ε` je **numerický regularizátor**, ne fyzikální parametr — proto schovaný z UI. Až přijdou kontakty (fáze 3+), minimální vzdálenost mezi pixely bude geometricky vynucená na `r ≥ U`, takže kernel singularity přestane být problém i fyzicky.

## Integrátor — manuální symplektický Euler (kick-drift)

Pro fázi 2 (čistě gravitační simulace, žádné kontakty / jointy) Rapier `step()` neintegrujeme. Důvod: Rapier integrátor je laděný na contact + joint stabilizaci, což pro orbital dynamics aktivně škodí — `∑P` klesá (numerické tlumení), `∑L` diverguje řády při close encounter slingshotech.

Místo toho:

```
v_{n+1} = v_n + a_n · Δt        # kick
x_{n+1} = x_n + v_{n+1} · Δt    # drift (s NOVOU rychlostí)
```

Toto pořadí (kick *před* drift) z toho dělá symplektický integrátor prvního řádu. Vlastnosti:

- **`∑P` exact** (až na float roundoff) — Newton 3 vyrobí přesně opačné páry zrychlení; sumace pre/post kicku je identická.
- **`∑L` exact pro radiální síly** — gravitační síla je radiální, takže žádný torque vůči těžišti.
- **`KE`** osciluje s `PE`, ale bez sekulárního driftu (charakteristika symplektického integrátoru). Energie se nezachovává exact, ale neutíká.

Reference: Hairer, Lubich, Wanner, *Geometric Numerical Integration* (2006), kap. VI.

Kód: `src/sim/gravity.ts` cachuje stav do `Float64Array`, počítá síly v O(N²) loopu (využívá `i < j` symetrie), aplikuje kick-drift, zapisuje zpět do Rapier RigidBody. Volání přes WASM bridge je minimalizované — jen 2× per pixel (read na začátku, write na konci).

### Substepping

`stepGravity` se volá `GRAVITY_SUBSTEPS = 4` krát za jeden render frame s `Δt = FIXED_DT / 4`. Truncation error symplektického Eulera je O(Δt²) per krok, takže menší krok = lineárně menší fictitious heating ve close encounterech. Cena: 4× O(N²).

### Fixed timestep accumulator

Wall-clock je decoupled od simulace přes Glenn Fiedler accumulator:

```
acc += realDt
while (acc >= FIXED_DT && steps < MAX) {
  step(FIXED_DT)
  acc -= FIXED_DT
}
```

`simTime` se posouvá výhradně po pevných krocích, takže je reprodukovatelný napříč PC s různým refresh rate. `MAX_STEPS_PER_FRAME = 5` je anti spiral-of-death hard cap — když render výrazně zaostává, raději slow-motion než tisíc kroků v jednom frame.

## Diagnostika

Per render tick (twice per second pro UI):

| Veličina | Výpočet |
|---|---|
| `∑P` | `Σ mᵢ·vᵢ` (vektor → norm pro display) |
| `∑L` (vůči těžišti) | `Σ mᵢ ((rᵢ - c) × vᵢ) + Σ Iᵢ ωᵢ` |
| `KE` (translační + rotační) | `Σ ½ mᵢ \|vᵢ\|² + Σ ½ Iᵢ ωᵢ²` |
| `PE` (gravitační) | `-Σᵢ<ⱼ G mᵢ mⱼ · W(rᵢⱼ) / √(rᵢⱼ² + ε²)` |
| `∑E` | `KE + PE` (totální mechanická energie) |
| `c` (těžiště) | `(Σ mᵢ rᵢ) / (Σ mᵢ)` |

Spin člen `I·ω` se započítává v `∑L` i v `KE` — bez něj by manuální zachycení rotace pixelů (přiřazené při spawnu jako `rs`, později generované kontaktním torquem ve fázi 3+) chybělo v rozpočtech úhlové hybnosti i energie a indikátory by driftovaly falešně.

`∑E` je pro uzavřený konzervativní systém invariantní (`dE/dt = 0`). Symplektický Euler nezachovává `E` přesně, ale drift je *bounded oscillation* kolem true E s amplitudou O(Δt²) — neutíká k nekonečnu jako Euler/RK4. Δ∑E v STATS panelu = `E - E₀` (E₀ se zachytí při prvním display ticku po prvním sim kroku, kdy PE má platnou hodnotu z předchozí `stepGravity` call).

## Modes (fáze 3 prep)

`IntegrationMode` v `presets.ts`:

- `manual` — fáze 2 chování. Default. Rapier `step()` se nevolá.
- `rapier` — jen `world.step(dt)`. Pro experimenty E1–E4 (charakterizace Rapier baseline).
- `hybrid` — manual gravity + Rapier `step()`. Empiricky **broken** (E5 vs. E5m): pohyb je integrován dvakrát, plus stav prochází f32 bridge → drift `∑P/∑L` o 10⁴× horší. Tři architektonické cesty (α velocity-Verlet split, β save-zero-restore, γ conditional Rapier step) zaznamenané v `IDEAS.md`, rozhodnutí na reálném joint scénáři.

## Plánované rozšíření (fáze 3+)

### Composite object dataset

Cache pro slepený objekt:

```
CompositeObject = (id, pixelIds, x, y, vx, vy, r, rs, m, I)
```

Update jen při změně topologie (přibude/odejde pixel) nebo per-tick full recompute O(N) — symetrie volby závisí na poměru topologických událostí k tickům.

### Spatial grid

Uniform grid s `cell = cutoff`. Force eval jen mezi pixely v 3×3 sousedství. Cutoff: kde force pod ε% peak. Pro Plummer:

$$ F(r) = F_\text{peak} \cdot \left(\frac{\varepsilon^2}{r^2 + \varepsilon^2}\right)^{3/2} $$

`F < 0.01·F_peak` při `r ≈ ε · 100^{1/3} ≈ 4.6 ε`. S `ε = 1.5 U` → cutoff ~7 U.

Hard cutoff porušuje energii (skok force = nespojitý potenciál, fictitious work). Řešení: shifted potential nebo polynomial roll-off na poslední 1 U cutoffu.

## Reference

- Aarseth, *Gravitational N-Body Simulations*, Cambridge UP (2003).
- Hairer, Lubich, Wanner, *Geometric Numerical Integration: Structure-Preserving Algorithms for Ordinary Differential Equations*, Springer (2006).
- Fiedler, „Fix Your Timestep!" (2004), <https://gafferongames.com/post/fix_your_timestep/>.
- Catto, „Iterative Dynamics with Temporal Coherence" (Rapier 2D solver background, 2005).
