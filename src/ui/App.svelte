<script lang="ts">
  import { onMount } from 'svelte';
  import { World } from '../sim/physics';
  import { Renderer } from '../render/gl';
  import { createCamera, projection, screenToWorld } from '../render/camera';
  import { Keyboard } from '../input/keyboard';

  let canvas: HTMLCanvasElement;
  let pixelCount = $state(0);
  let fps = $state(0);

  onMount(() => {
    let stopped = false;

    const world = new World();
    const camera = createCamera();
    const keyboard = new Keyboard();
    const viewport = { w: 0, h: 0 };

    const init = async () => {
      await world.init();
      const renderer = new Renderer(canvas);

      const onResize = () => {
        const rect = canvas.getBoundingClientRect();
        viewport.w = rect.width;
        viewport.h = rect.height;
        renderer.resize(viewport.w, viewport.h);
      };
      onResize();
      window.addEventListener('resize', onResize);

      // LMB spawn — pravé tlačítko a střed jsou rezervovány pro pozdější interakce.
      const onPointerDown = (e: PointerEvent) => {
        if (e.button !== 0) return;
        const rect = canvas.getBoundingClientRect();
        const w = screenToWorld(camera, viewport, e.clientX - rect.left, e.clientY - rect.top);
        world.spawnPixel(w.x, w.y);
        pixelCount = world.pixels.length;
      };
      canvas.addEventListener('pointerdown', onPointerDown);

      // Zoom přes klávesy Y (in) a X (out) — z A2.
      // Mouse wheel je častější, přidáme jako bonus.
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * 0.001);
        camera.zoom = Math.max(2, Math.min(200, camera.zoom * factor));
      };
      canvas.addEventListener('wheel', onWheel, { passive: false });

      let last = performance.now();
      let frames = 0;
      let fpsAccum = 0;

      const loop = (now: number) => {
        if (stopped) return;
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;

        // Kamera: WASD = pan, Y/X = zoom.
        const panSpeed = 20 / camera.zoom; // konstantní rychlost v U/s při daném zoomu vypadá přirozeně
        if (keyboard.isDown('KeyW')) camera.y += panSpeed * dt * camera.zoom;
        if (keyboard.isDown('KeyS')) camera.y -= panSpeed * dt * camera.zoom;
        if (keyboard.isDown('KeyA')) camera.x -= panSpeed * dt * camera.zoom;
        if (keyboard.isDown('KeyD')) camera.x += panSpeed * dt * camera.zoom;
        if (keyboard.isDown('KeyY')) camera.zoom = Math.min(200, camera.zoom * (1 + dt));
        if (keyboard.isDown('KeyX')) camera.zoom = Math.max(2, camera.zoom / (1 + dt));

        // Simulace.
        world.step(1 / 60);

        // Render.
        renderer.reserve(world.pixels.length);
        const data = renderer.instanceData;
        for (let i = 0; i < world.pixels.length; i++) {
          const p = world.pixels[i]!;
          const t = p.body.translation();
          data[i * 4 + 0] = t.x;
          data[i * 4 + 1] = t.y;
          data[i * 4 + 2] = p.body.rotation();
          data[i * 4 + 3] = 0.5; // halfSize — strana = 1 U
        }
        renderer.render(world.pixels.length, projection(camera, viewport));

        // FPS counter — kumulujeme přes ~0.5s, abychom neflickerovali.
        frames++;
        fpsAccum += dt;
        if (fpsAccum > 0.5) {
          fps = Math.round(frames / fpsAccum);
          frames = 0;
          fpsAccum = 0;
        }

        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);

      return () => {
        window.removeEventListener('resize', onResize);
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('wheel', onWheel);
      };
    };

    const cleanup = init();
    return () => {
      stopped = true;
      void cleanup.then((fn) => fn?.());
    };
  });
</script>

<div class="app">
  <aside class="panel left">
    <h1>Pixelodynamics</h1>
    <p class="muted">FVP — fáze 1</p>
    <h2>Ovládání</h2>
    <ul>
      <li><kbd>LMB</kbd> spawn pixel</li>
      <li><kbd>WASD</kbd> pan kamery</li>
      <li><kbd>Y</kbd> / <kbd>X</kbd> zoom in / out</li>
      <li><kbd>kolečko</kbd> zoom</li>
    </ul>
  </aside>

  <main class="canvas-wrap">
    <canvas bind:this={canvas}></canvas>
  </main>

  <aside class="panel right">
    <h2>Stav</h2>
    <dl>
      <dt>Pixely</dt><dd>{pixelCount}</dd>
      <dt>FPS</dt><dd>{fps}</dd>
    </dl>
    <h2>Příští fáze</h2>
    <ol class="roadmap">
      <li class="done">Ballistický pohyb + rotace</li>
      <li>Pixelová gravitace</li>
      <li>Slepování po straně (FixedJoint)</li>
      <li>Hmotnost &amp; pružnost</li>
      <li>Rozbití slepence</li>
    </ol>
  </aside>
</div>

<style>
  :global(html, body) {
    margin: 0;
    height: 100%;
    background: #0a0d15;
    color: #cfd6e0;
    font-family: system-ui, sans-serif;
  }
  :global(#app) { height: 100%; }
  .app {
    display: grid;
    grid-template-columns: 220px 1fr 220px;
    height: 100vh;
  }
  .panel {
    padding: 16px;
    background: #11141d;
    overflow-y: auto;
    font-size: 13px;
    line-height: 1.5;
  }
  .panel.left { border-right: 1px solid #1d2230; }
  .panel.right { border-left: 1px solid #1d2230; }
  h1 { font-size: 16px; margin: 0 0 4px; letter-spacing: 0.04em; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #7a8390; margin: 16px 0 6px; }
  .muted { color: #5b6370; margin-top: 0; font-size: 12px; }
  ul, ol { padding-left: 18px; margin: 0; }
  kbd {
    background: #1d2230; padding: 1px 6px; border-radius: 3px;
    font-family: ui-monospace, monospace; font-size: 11px;
  }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; }
  dt { color: #7a8390; }
  dd { margin: 0; font-variant-numeric: tabular-nums; }
  .roadmap li.done { color: #5b6370; text-decoration: line-through; }
  .canvas-wrap { position: relative; }
  canvas { display: block; width: 100%; height: 100%; touch-action: none; }
</style>
