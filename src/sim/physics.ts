// Wrapper kolem Rapier 2D světa. Pro každý pixel = jeden RigidBody + 1×1 collider
// s kolizemi a contact events (sezení 10) — auto-jointing při dotyku.
//
// Collision groups: všichni se všemi (0xFFFFFFFF). Filtrování později (ne-lepiv kategorie?).

import RAPIER from '@dimforge/rapier2d-compat';
import type { Pixel } from '../types';
import { SPAWN_LINVEL_MAX } from './params';
import type { Joint } from './joints';
import { removeAllJointsSilent } from './joints';

let nextId = 0;

export class World {
  rapier!: RAPIER.World;
  pixels: Pixel[] = [];
  /**
   * Aktivní jointy. Drženy paralelně k Rapier ImpulseJoint storage, abychom měli
   * stable handle pro UI / vizualizaci / connection counter bez nutnosti
   * iterovat přes Rapier WASM bridge per-frame.
   */
  joints: Joint[] = [];
  /**
   * Lookup collider handle → Pixel pro contact event handler. Rapier reportuje
   * kolize jako handles (number); bez map by každý event vyžadoval lineární scan.
   */
  pixelByCollider: Map<number, Pixel> = new Map();
  /**
   * Sdílená EventQueue pro `step()`. Inicializuje se v `init()` (potřebuje WASM).
   * `autoDrain=true` znamená, že queue se vyprázdní automaticky po každém drain
   * volání a nebobtná, pokud handler nevolá drainCollisionEvents.
   */
  eventQueue!: RAPIER.EventQueue;

  /**
   * Default `canSleep` flag pro nově spawnované body. **false** je default
   * Pixelodynamics-wide — sleep mode v Rapieru je herní optimalizace (idle scénář),
   * v fyzikální simulaci způsobuje katastrofickou dissipaci joint dynamics
   * (E3 baseline ze sezení 7: pair se zastavil za <2s, kompletně ztratil ∑P i ω).
   * Sleep zaarchivován jako anti-feature; toggle pomocí `setDefaultCanSleep(true)`
   * jen pokud explicitně chceme replikovat původní rapier chování.
   */
  defaultCanSleep = false;

  /**
   * Inicializace musí být await — Rapier WASM se načítá asynchronně.
   * `compat` build inlinuje WASM jako base64, takže nepotřebujeme žádný extra deploy step.
   *
   * Solver iters: default 32/8. Pro joint chain s gravitační kompresí jsou Rapier
   * defaulty 4/1 nedostatečné (chain se zaboří 0.667 U pod constraint distance).
   * 16/4 (E3-tune ze sezení 8) zlepší orbital pair na drift ~0.01%, ale pro 3+ pixel
   * chain v close-range gravity jsou sporadicky nedostatečné. 32/8 je bezpečný kompromis.
   */
  async init(): Promise<void> {
    await RAPIER.init();
    // Globální gravitace světa = 0 — naše párová gravitace je external force, ne uniform.
    this.rapier = new RAPIER.World({ x: 0, y: 0 });
    this.eventQueue = new RAPIER.EventQueue(true);
    this.setSolverIterations(32);
    this.setPgsIterations(8);
  }

  /**
   * Tuning IntegrationParameters pro experimenty. Default: `numSolverIterations=4`,
   * `numInternalPgsIterations=1`. Vyšší hodnoty = přesnější constraint resolution
   * (méně Baumgarte energy bleed) za cenu CPU.
   */
  setSolverIterations(n: number): void {
    this.rapier.integrationParameters.numSolverIterations = n;
  }

  setPgsIterations(n: number): void {
    this.rapier.integrationParameters.numInternalPgsIterations = n;
  }

  setDefaultCanSleep(b: boolean): void {
    this.defaultCanSleep = b;
  }

  /**
   * Vytvoří nový pixel na zadané pozici s drobnou random linvel perturbací (pro
   * netriviální testovací scénáře), ale **r=0 a rs=0** — rotace by jinak v `align`
   * módu byla okamžitě nuceně snapnutá a v `not-align` módu by random orientace
   * znamenala off-edge anchor při auto-jointu (nešťastný UX).
   * Pro deterministické scénáře (presety, experimenty) použij `spawnPixelExact`.
   */
  spawnPixel(x: number, y: number): Pixel {
    return this.spawnPixelExact(
      x,
      y,
      (Math.random() - 0.5) * 2 * SPAWN_LINVEL_MAX,
      (Math.random() - 0.5) * 2 * SPAWN_LINVEL_MAX,
      0,
      0,
      1,
      false,
    );
  }

  /**
   * Deterministický spawn — všechny atributy explicitní. Používá se v presetech, aby
   * experimenty byly reprodukovatelné. `m` je strukturně přítomné, ale Rapier mass
   * je odvozená z density × area; vlastní m používá náš manuální integrátor.
   * `pinned=true` udělá z pixelu nehybnou hmotu (působí gravitací, sama se nepohne).
   */
  spawnPixelExact(
    x: number,
    y: number,
    vx: number,
    vy: number,
    r: number,
    rs: number,
    m: number,
    pinned: boolean = false,
  ): Pixel {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y)
      .setLinvel(vx, vy)
      .setAngvel(rs)
      .setRotation(r)
      .setCanSleep(this.defaultCanSleep);
    const body = this.rapier.createRigidBody(desc);

    // Čtverec o straně 1 U → halfExtent = 0.5.
    // collisionGroups: všichni × všichni (membership 0xFFFF, filter 0xFFFF).
    // ActiveEvents.COLLISION_EVENTS — Rapier emituje Started/Stopped do EventQueue
    // (čteme v main loopu pro auto-jointing).
    const colliderDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.5)
      .setCollisionGroups(0xffffffff)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      .setDensity(1);
    const collider = this.rapier.createCollider(colliderDesc, body);

    const pixel: Pixel = {
      id: nextId++,
      body,
      m,
      pinned,
      compositeOffsetX: null,
      compositeOffsetY: null,
      compositeTheta: null,
    };
    this.pixels.push(pixel);
    this.pixelByCollider.set(collider.handle, pixel);
    return pixel;
  }

  /** Smaže všechny pixely a jejich rigid bodies. Reset scény. */
  clear(): void {
    // Joints first — odstranění body s aktivními jointy by Rapier auto-cleannul,
    // ale naše Joint[] paralelní storage by ostala stale. Explicitní clear je čistší.
    removeAllJointsSilent(this);
    for (const p of this.pixels) {
      this.rapier.removeRigidBody(p.body);
    }
    this.pixels.length = 0;
    this.pixelByCollider.clear();
  }

  /** Jeden krok simulace s daným timestepem. EventQueue se naplní contact eventy. */
  step(dt: number): void {
    this.rapier.timestep = dt;
    this.rapier.step(this.eventQueue);
  }

  /**
   * Drainuje contact Started události a callback je volán pro každý nový pár pixelů.
   * Stopped events se ignorují — pro auto-jointing zajímá jen vznik kontaktu.
   * Volat těsně po `step()`, jinak události zmizí v dalším drainu.
   */
  drainContactStarts(callback: (a: Pixel, b: Pixel) => void): void {
    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const a = this.pixelByCollider.get(h1);
      const b = this.pixelByCollider.get(h2);
      if (a && b) callback(a, b);
    });
  }
}

