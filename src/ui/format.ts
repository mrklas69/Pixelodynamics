// Display formátování — interně držíme f64, displej zaokrouhluje pro čitelnost.
// Centralizováno, aby všechny STATS / FACTS readouts měly stejnou přesnost.

/**
 * Zobrazí číslo na 4 platné číslice. `toPrecision(4)` může vrátit
 * exponenciální formu pro extrémy (~1e-5 a níže, ~1e21 a výše); pro běžné
 * sim hodnoty (∑P ~1e-15..1e3, KE ~1..100, FPS ~60) vychází přirozený formát.
 */
export function fmtSig4(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '0';
  // Number(...).toString() odstraní zbytečné trailing nuly z toPrecision výstupu
  // (např. 1.000 → 1) a zachová exponenciální zápis tam, kde toPrecision sám zvolil.
  return Number(n.toPrecision(4)).toString();
}
