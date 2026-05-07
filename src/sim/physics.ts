// Wrapper kolem Rapier 2D světa. Pro každý pixel = jeden RigidBody + 1×1 collider
// (collision groups vypnuté, takže Rapier neřeší kolize — výrazně levnější).
//
// Až přijde fáze 3 (lepení), přidáme FixedJoint mezi sousedy a zapneme kolize.

import RAPIER from '@dimforge/rapier2d-compat';
import type { Pixel } from '../types';
import { SPAWN_LINVEL_MAX, SPAWN_ANGVEL_MAX } from './params';

let nextId = 0;

export class World {
  rapier!: RAPIER.World;
  pixels: Pixel[] = [];

  /**
   * Inicializace musí být await — Rapier WASM se načítá asynchronně.
   * `compat` build inlinuje WASM jako base64, takže nepotřebujeme žádný extra deploy step.
   */
  async init(): Promise<void> {
    await RAPIER.init();
    // Globální gravitace světa = 0 — naše párová gravitace je external force, ne uniform.
    this.rapier = new RAPIER.World({ x: 0, y: 0 });
  }

  /**
   * Vytvoří nový pixel na zadané pozici s náhodnými počátečními rychlostmi a rotací.
   * Rozsahy random hodnot jsou v `params.ts` jako konstanty programu.
   * Pro deterministické scénáře (presety, experimenty) použij `spawnPixelExact`.
   */
  spawnPixel(x: number, y: number): Pixel {
    return this.spawnPixelExact(
      x,
      y,
      (Math.random() - 0.5) * 2 * SPAWN_LINVEL_MAX,
      (Math.random() - 0.5) * 2 * SPAWN_LINVEL_MAX,
      Math.random() * Math.PI * 2,
      (Math.random() - 0.5) * 2 * SPAWN_ANGVEL_MAX,
      1,
    );
  }

  /**
   * Deterministický spawn — všechny atributy explicitní. Používá se v presetech, aby
   * experimenty byly reprodukovatelné. `m` je strukturně přítomné, ale Rapier mass
   * je odvozená z density × area; vlastní m používá náš manuální integrátor.
   */
  spawnPixelExact(
    x: number,
    y: number,
    vx: number,
    vy: number,
    r: number,
    rs: number,
    m: number,
  ): Pixel {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y)
      .setLinvel(vx, vy)
      .setAngvel(rs)
      .setRotation(r);
    const body = this.rapier.createRigidBody(desc);

    // Čtverec o straně 1 U → halfExtent = 0.5.
    // collisionGroups = 0 → pixely se ignorují navzájem (kolize zapneme ve fázi 3+).
    const colliderDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.5)
      .setCollisionGroups(0x00000000)
      .setDensity(1);
    this.rapier.createCollider(colliderDesc, body);

    const pixel: Pixel = { id: nextId++, body, m };
    this.pixels.push(pixel);
    return pixel;
  }

  /** Smaže všechny pixely a jejich rigid bodies. Reset scény. */
  clear(): void {
    for (const p of this.pixels) {
      this.rapier.removeRigidBody(p.body);
    }
    this.pixels.length = 0;
  }

  /** Jeden krok simulace s daným timestepem. */
  step(dt: number): void {
    this.rapier.timestep = dt;
    this.rapier.step();
  }
}
