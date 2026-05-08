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

## Integrační módy

`IntegrationMode` v `presets.ts` — vztah mezi gravitační simulací a Rapier joint solverem:

- **`without-interaction`** — jen párová gravita (manual symplektický Euler). Rapier `step()` se nevolá → žádné kontakty, žádné jointy, pixely procházejí jeden druhým. ∑P/∑L drift na úrovni f64 ulp. Default pro pure orbital scénáře (G1024 pure gravity collapse).
- **`not-align`** *(default)* — Velocity-Verlet split: manual jen `kick` (`v += a·dt`), Rapier dělá `pos drift` + joint solver + auto-jointing při Started events. Slepence preserve rotaci pixelů, věrná collision dynamics. ∑E drift 0.04 % / 30 s na E8 sweep, ∑P/∑L na f32 ulp (~1e-7) kvůli WASM bridge.
- **`align`** — jako `not-align`, ale při auto-jointu **destruktivně** snapne pos na axis-aligned 1 U distance + snap `r=0`, `rs=0`, `lockRotations(true)`. Vždy axis-aligned mřížka. Cena: ztráta rotace, collision dynamics zničena. Použitelné jen pro fresh pair scenarios bez initial rotace (E1align/E2align). Snap rotace na pixelech v existing rotujícím chainu invaliduje joint anchory v lokálním frame → solver overshoot. Pro rotující bodies použít `not-align`.

### Hybrid orchestrace — historie

Naivní hybrid (manuální `stepGravity` + nepodmíněný `Rapier.step()`, sezení 3) integroval pohyb dvakrát a byl 10⁴× horší v ∑P/∑L driftu kvůli f32 WASM bridge. Sezení 9 vyhodnotilo tři varianty (α Velocity-Verlet split, β save-zero-restore, γ conditional Rapier step). α se etablovalo jako default (`not-align`), β bylo odmítnuto (joint solver bez context o stress → rs ≈ 0 + 13 % ∑E leak), γ orthogonal flag dosloužil v sezení 11. Detail v `IDEAS.md` lessons learned a `DONE.md` sezení 8–11.

## Spatial grid (fáze 2, sezení 4–5)

Uniform grid s `cell = cutoff`. Force eval jen mezi pixely v 3×3 sousedství buňky. Plummer force per dvojici:

$$ F(r) = G \cdot m_1 m_2 \cdot \frac{r}{(r^2 + \varepsilon^2)^{3/2}} $$

peakuje v `r_peak = ε/√2 ≈ 1.06` (NE v r=0 — `r` v čitateli stahuje kernel k 0). Pro `factor = 5` (`cutoff = 5·ε = 7.5 U`):

$$ \frac{F(\text{cutoff})}{F_\text{peak}} = \frac{7.5 / (7.5^2 + 1.5^2)^{1.5}}{1.06 / (1.06^2 + 1.5^2)^{1.5}} \approx 0.098 $$

— tj. **~10 %** peaku, ne 1 %. Hard cutoff je tedy CULLING DECISION, ne approximation: pixely za cutoffem sice cítí ~10 % síly, ale grid je pro ně přeskočí (zachová ∑P/∑L exact, KE má skoky). Empirická validace E7n vs. E7g (sezení 5) potvrdila, že pro spread konfigurace (12 px ve 4×3 gridu, 49/66 párů přes cutoff) je dynamika dramaticky odlišná: KE 1.73 vs. 3.77, vnější pixely odlétly do 17 U místo 10 U.

### Smoothstep tail

Energy-conserving roll-off na posledním 1 U cutoffu. Window function:

$$ W(r) = 1 - (3t^2 - 2t^3), \quad t = (r - r_\text{inner}) / w_\text{tail} $$

modifikovaný potenciál `U_mod = U·W`, force odvozená rigorózně z `−dU_mod/dr`. To zachovává `∑E` (KE + PE) přes přechod cutoff bez fictitious work. **Smoothstep řeší energy conservation across cutoff, NE approximation quality** — long-range gravita zůstává cut.

## Composite object dataset (fáze 3, sezení 11)

Stage 1 v `src/sim/composite.ts` (~230 LOC):

```
Composite = (id, members, com, linvel, angvel, mass, inertia)
```

`buildComposites(world)` přes Union-Find seskupí pixely do slepenců, `freeEdges(composite, world)` enumeruje 4 strany každého pixelu mínus shared přes joint (anchor v dané dominantní ose). `segmentDistance` (Christer Ericson §5.1.9) počítá vzdálenost mezi volnými hranami dvou objektů, `detectMergeCandidates` vrací nejbližší kandidáty pod `MAGNET_THRESHOLD` (0.1 U default).

Inerciální moment používá parallel axis theorem (Steiner): `I = Σ (m·|r_rel|² + m/6)`. Per-display-tick (5 Hz) call, „Merge cand." badge v STATS panelu.

**Stage 1 = pure detection.** Stage 2 (inelastic merge math) a Stage 3 (composite-driven kinematics nahrazující FixedJoint v align mode) jsou TODO.

## Reference

- Aarseth, *Gravitational N-Body Simulations*, Cambridge UP (2003).
- Hairer, Lubich, Wanner, *Geometric Numerical Integration: Structure-Preserving Algorithms for Ordinary Differential Equations*, Springer (2006).
- Fiedler, „Fix Your Timestep!" (2004), <https://gafferongames.com/post/fix_your_timestep/>.
- Catto, „Iterative Dynamics with Temporal Coherence" (Rapier 2D solver background, 2005).
