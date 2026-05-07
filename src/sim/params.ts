// Parametry simulace, které se NELADÍ z UI — konstanty programu.
// Lze upravit za běhu jen úpravou tohoto souboru.

/** Maximální |linvel| na osu při spawnu pixelu (random uniform v [-max, +max], U/s). */
export const SPAWN_LINVEL_MAX = 0.1;

/** Maximální |angvel| při spawnu (random uniform v [-max, +max], rad/s). */
export const SPAWN_ANGVEL_MAX = 1.0;

/**
 * Plummer softening ε pro párovou gravitaci. Brání singularitě F → ∞ při r → 0.
 * Větší = stabilnější, ale slabší vazba ve close-encounter regimu.
 * Hodnota ~ velikost pixelu (1 U) je standardní volba.
 */
export const GRAVITY_EPSILON = 1.5;

/**
 * Počet substepů gravitace na jeden render frame.
 * Vyšší = nižší truncation error symplektického integrátoru → méně fiktivní energie
 * v close encounterech, ale O(N) × cost. 4 je dobrý kompromis pro 1000 pixelů.
 */
export const GRAVITY_SUBSTEPS = 4;

/**
 * Spatial grid — uniform buckety pro O(N) místo O(N²) gravity. true = produkční,
 * false = naivní O(N²) (kontrolní baseline pro porovnávání driftu / fictitious heating).
 */
export const GRAVITY_USE_GRID = true;

/**
 * Cutoff radius pro grid mode jako násobek `ε`. Plummer force klesá jako
 * `(ε² / (r² + ε²))^{3/2}`, takže pro factor=5 je `F(cutoff) ≈ 0.008 · F_peak`.
 *
 * Vyšší = méně truncation chyby, větší buňky, méně sousedů ale víc per-bucket práce.
 * Důsledek: hard cutoff bez smoothing tail = malý nespojitý skok force při překročení
 * — `∑P` a `∑L` zůstávají exact (Newton 3 v páru je symetrický), ale `KE` má malé
 * skoky při krossování cutoffu. Pro orbital scénář je to neviditelné, pro „rozprostřený plyn"
 * by stálo za to doplnit smoothstep tail.
 */
export const GRAVITY_CUTOFF_FACTOR = 5.0;
