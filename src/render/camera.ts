// 2D ortografická kamera. Drží pan/zoom a počítá projekční matici pro shader.

import { mat3 } from 'gl-matrix';
import type { Camera } from '../types';

export function createCamera(): Camera {
  return { x: 0, y: 0, zoom: 32 }; // default: 1 U = 32 px
}

/**
 * Projekční matice 3x3 pro 2D rendering.
 * Mapuje world U → clip space [-1, 1].
 *
 * Postup transformace (čtený zprava doleva při násobení vektoru):
 *   posun pixel pozice → kamera (translation by -cam.xy)
 *   → měřítko (zoom v px/U → škála v clip space)
 *   → výsledek v NDC.
 */
export function projection(cam: Camera, viewportPx: { w: number; h: number }): mat3 {
  const sx = (2 * cam.zoom) / viewportPx.w;
  const sy = (2 * cam.zoom) / viewportPx.h;
  const m = mat3.create();
  // mat3 v gl-matrix je column-major. Skládáme: M = S * T.
  mat3.fromTranslation(m, [-cam.x, -cam.y]);
  mat3.scale(m, m, [sx, sy]);
  // Y v clip space jde nahoru — ponecháváme world Y nahoru taky, takže žádné flipování nepotřebujeme.
  return m;
}

/** Konverze pixelových souřadnic kurzoru na world souřadnice. */
export function screenToWorld(
  cam: Camera,
  viewportPx: { w: number; h: number },
  px: number,
  py: number,
): { x: number; y: number } {
  const x = (px - viewportPx.w / 2) / cam.zoom + cam.x;
  // Pozor: DOM Y roste dolů, world Y nahoru.
  const y = -((py - viewportPx.h / 2) / cam.zoom) + cam.y;
  return { x, y };
}
