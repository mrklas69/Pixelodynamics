// Centrální typy pro celý projekt. Cokoliv, co míchá sim, render i UI, žije tady.

import type { RigidBody } from '@dimforge/rapier2d-compat';

/**
 * Pixel — základní entita simulace.
 *
 * Souřadnice jsou ve **world units (U)**. Strana pixelového čtverce = 1 U.
 * `r` (rotace v rad) a `rs` (úhlová rychlost rad/s) drží Rapier RigidBody;
 * tahle struktura je jen handle k němu plus extra atributy.
 *
 * `m` zatím konstantní 1 — strukturně přítomné, aby pozdější rozdíly v hmotnosti
 * nevyvolaly refaktor celého solveru.
 */
export type Pixel = {
  id: number;
  body: RigidBody;
  m: number;
  /**
   * Pinned pixel působí gravitací na ostatní, ale sám se nehýbe (kick+drift se přeskočí).
   * Použití: experimentální fixní hmoty (např. cluster + singlet v E6 Lagrange testu),
   * kde nás zajímá dynamika **třetího** tělesa v zadaném potenciálu.
   */
  pinned: boolean;
};

/** Stav kamery — pan a zoom v jednoduché 2D ortografické projekci. */
export type Camera = {
  // Posun kamery ve world unitech (kde je střed obrazovky).
  x: number;
  y: number;
  // Zoom = kolik pixelů obrazovky odpovídá 1 U.
  zoom: number;
  // Pokud není null, kamera každý frame následuje pixel s tímto ID (lock follow).
  // Shazuje se: WASD pan, Esc, nebo když pixel zmizí ze světa.
  lockTargetId: number | null;
};
