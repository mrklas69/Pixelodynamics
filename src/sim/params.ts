// Parametry simulace, které se NELADÍ z UI — konstanty programu.
// Lze upravit za běhu jen úpravou tohoto souboru.

/** Maximální |linvel| na osu při spawnu pixelu (random uniform v [-max, +max], U/s).
 *  Drobná perturbace pro netriviální kontakty; rotace (r, rs) jsou při spawn nulové. */
export const SPAWN_LINVEL_MAX = 0.1;

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
 * Cutoff radius pro grid mode jako násobek `ε`. Plummer force per dvojici je
 * `F(r) = G·m1·m2·r / (r² + ε²)^{3/2}` (peakuje v `r_peak = ε/√2`).
 * Pro factor=5 a ε=1.5 (cutoff=7.5 U): `F(cutoff) / F_peak ≈ 0.098` — tj. **10 %** peaku.
 *
 * Empirická validace E7n vs. E7g (sezení 5) potvrdila, že to NENÍ aproximace naive
 * — pro spread-out konfigurace (12 px ve 4×3 gridu, 49/66 párů přes cutoff) je
 * dynamika dramaticky odlišná: KE 1.73 vs. 3.77, vnější pixely odlétly do 17 U
 * místo 10 U. Hard cutoff je tedy CULLING DECISION, ne approximation.
 *
 * Smoothstep tail (`GRAVITY_TAIL_WIDTH`) přidává C¹-spojitý dopadávací profil
 * v posledním 1 U cutoffu, aby přechod nebyl skokový. Bez tail: ∑P/∑L exact
 * (Newton 3 symetrický), KE má skoky. S tail: KE drift se rozetře přes transition
 * zone a integrátor zachovává ∑E = KE + PE správně.
 */
export const GRAVITY_CUTOFF_FACTOR = 5.0;

/**
 * Auto-detekce dotyku po straně: při Rapier collision Started event mezi dvojicí pixelů
 * se automaticky vytvoří FixedJoint (pokud ještě neexistuje). Aktivní v `not-align`
 * a `align` módech, ve `without-interaction` no-op (Rapier step se nevolá).
 */
export const AUTO_JOINT_ON_CONTACT = true;

/**
 * Magnetic edge attraction threshold v U pro auto-spojování objektů (composites).
 * Každá volná hrana objektu = "magnet" — pokud distance mezi volnými hranami dvou
 * objektů klesne pod tento threshold, jsou kandidáty pro merge (Stage 2+).
 *
 * Default 0.1 U = magnet activates téměř při kontaktu (konzervativní, podobá se
 * collision-based triggeru). Vyšší hodnoty vytvoří dlouhodosahové přitahování — pro
 * G1024 s 1024 pixely by 1.0 U způsobilo okamžité splaceutí celé scény do koule.
 */
export const MAGNET_THRESHOLD = 0.1;

/**
 * Šířka smoothstep transition zone v U na vnitřním okraji cutoffu.
 * Window W(r) = 1 pro r ≤ cutoff − tailWidth, plynule klesá k 0 na r = cutoff
 * 3-2 polynomem `1 - (3t² - 2t³)`, t = (r − r_inner) / tailWidth.
 *
 * U_mod(r) = U(r)·W(r) je modifikovaný potenciál; síla je rigorózně −dU_mod/dr,
 * což zaručuje konzervaci celkové energie (nikoli jen KE skoky kompenzace).
 *
 * 0 = vypnuto (čistý hard cutoff). 1 U je default — zachovává plnou Plummer
 * sílu pro r ≤ 6.5 U, postupně utlumí na 7.5 U.
 */
export const GRAVITY_TAIL_WIDTH = 1.0;
