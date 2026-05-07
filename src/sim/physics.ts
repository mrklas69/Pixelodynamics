// Wrapper kolem Rapier 2D světa. FVP fáze — žádná gravitace, žádné kolize mezi pixely
// (collision groups je vypnou), pixely jen letí ballisticky podle počátečních podmínek.
//
// Až přijde fáze 2 (gravitace), zapneme gravitaci světa nebo ji přidáme jako custom field.
// Až přijde fáze 3 (lepení), přidáme FixedJoint mezi sousedy.

import RAPIER from '@dimforge/rapier2d-compat';
import type { Pixel } from '../types';

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
    // Ve FVP nulová gravitace — pixely jen letí podle vx/vy/rs.
    this.rapier = new RAPIER.World({ x: 0, y: 0 });
  }

  /** Vytvoří nový pixel na zadané pozici s náhodnými počátečními rychlostmi a rotací. */
  spawnPixel(x: number, y: number): Pixel {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y)
      .setLinvel((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4)
      .setAngvel((Math.random() - 0.5) * 4)
      .setRotation(Math.random() * Math.PI * 2);
    const body = this.rapier.createRigidBody(desc);

    // Čtverec o straně 1 U → halfExtent = 0.5.
    // Ve FVP collision groups = 0 → pixely se ignorují navzájem (kolize až ve fázi 4).
    const colliderDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.5)
      .setCollisionGroups(0x00000000)
      .setDensity(1);
    this.rapier.createCollider(colliderDesc, body);

    const pixel: Pixel = { id: nextId++, body, m: 1 };
    this.pixels.push(pixel);
    return pixel;
  }

  /** Jeden krok simulace. Rapier má fixní timestep, který nastavujeme přes integrationParameters. */
  step(dt: number): void {
    this.rapier.timestep = dt;
    this.rapier.step();
  }
}
