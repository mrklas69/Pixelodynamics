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
