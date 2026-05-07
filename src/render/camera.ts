// 2D ortografická kamera. Drží pan/zoom a počítá projekční matici pro shader.

import { mat3 } from 'gl-matrix';
import type { Camera } from '../types';

export function createCamera(): Camera {
  return { x: 0, y: 0, zoom: 32, lockTargetId: null }; // default: 1 U = 32 px, free
}

/**
 * Projekční matice 3x3 pro 2D rendering.
 * Mapuje world U → clip space [-1, 1].
 *
 * Chceme: NDC = S · (world - cam), tj. nejdřív posunout o -cam ve world prostoru,
 * pak škálovat. Maticově `M = S × T(-cam)`.
 *
 * V gl-matrix je `mat3.translate(out, a, v)` definováno jako `out = a × T(v)`,
 * takže start na `S` a aplikovat `translate(-cam)` zprava dá přesně `M = S × T(-cam)`.
 *
 * (Naivní `fromTranslation(-cam)` + `scale(S)` udělá `M = T × S`, což aplikuje
 * translation v post-scale (NDC) prostoru — pro nenulovou kameru kreslí off-by-faktor zoom.)
 */
export function projection(cam: Camera, viewportPx: { w: number; h: number }): mat3 {
  const sx = (2 * cam.zoom) / viewportPx.w;
  const sy = (2 * cam.zoom) / viewportPx.h;
  const m = mat3.create();
  mat3.fromScaling(m, [sx, sy]);
  mat3.translate(m, m, [-cam.x, -cam.y]);
  // Y v clip space jde nahoru — ponecháváme world Y nahoru taky, žádné flipování.
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
