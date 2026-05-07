<script lang="ts">
  import { onMount } from 'svelte';
  import { World } from '../sim/physics';
  import { stepGravity } from '../sim/gravity';
  import { computeDiagnostics } from '../sim/diagnostics';
  import { computeFacts, emptyFacts, type Facts, type Champion } from '../sim/facts';
  import { GRAVITY_EPSILON, GRAVITY_SUBSTEPS } from '../sim/params';
  import { Renderer } from '../render/gl';
  import { createCamera, projection, screenToWorld } from '../render/camera';
  import type { Camera } from '../types';
  import { Keyboard } from '../input/keyboard';

  let canvas: HTMLCanvasElement;

  // STATS
  let simTime = $state(0);
  let pixelCount = $state(0);
  let objectCount = $state(0);
  let connectionCount = $state(0);
  let sumP = $state(0);
  let sumL = $state(0);
  let fps = $state(0);

  // FACTS
  let facts = $state<Facts>(emptyFacts);

  // SETTINGS — uživatelsky laditelné parametry simulace.
  let G = $state(1.0); // koeficient dostředivé síly (gravitační konstanta)
  let H = $state(1.0); // síla vazby (zatím nepoužité, fáze 3+)

  let world: World | null = null;
  const camera: Camera = createCamera();

  function formatTime(s: number): string {
    const days = Math.floor(s / 86400);
    const hrs = Math.floor((s % 86400) / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = Math.floor(s % 60);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${days}:${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }

  function centerOnPixel(id: number): void {
    if (!world) return;
    const p = world.pixels.find((x) => x.id === id);
    if (p) {
      const t = p.body.translation();
      camera.x = t.x;
      camera.y = t.y;
    }
  }

  function homeCamera(): void {
    camera.x = 0;
    camera.y = 0;
    camera.zoom = 32;
  }

  function resetScene(): void {
    if (!world) return;
    world.clear();
    pixelCount = 0;
    simTime = 0;
    facts = emptyFacts;
    sumP = 0;
    sumL = 0;
  }

  onMount(() => {
    let stopped = false;
    const w = new World();
    world = w;
    const keyboard = new Keyboard();
    const viewport = { w: 0, h: 0 };

    const init = async () => {
      await w.init();
      const renderer = new Renderer(canvas);

      const onResize = () => {
        const rect = canvas.getBoundingClientRect();
        viewport.w = rect.width;
        viewport.h = rect.height;
        renderer.resize(viewport.w, viewport.h);
      };
      onResize();
      window.addEventListener('resize', onResize);

      const onPointerDown = (e: PointerEvent) => {
        if (e.button !== 0) return;
        const rect = canvas.getBoundingClientRect();
        const wp = screenToWorld(camera, viewport, e.clientX - rect.left, e.clientY - rect.top);
        w.spawnPixel(wp.x, wp.y);
        pixelCount = w.pixels.length;
      };
      canvas.addEventListener('pointerdown', onPointerDown);

      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * 0.001);
        camera.zoom = Math.max(2, Math.min(200, camera.zoom * factor));
      };
      canvas.addEventListener('wheel', onWheel, { passive: false });

      let last = performance.now();
      let frames = 0;
      let fpsAccum = 0;
      let displayAccum = 0;

      const FRAME_DT = 1 / 60;
      const SUB_DT = FRAME_DT / GRAVITY_SUBSTEPS;

      const loop = (now: number) => {
        if (stopped) return;
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        simTime += dt;

        const panSpeed = 20 / camera.zoom;
        if (keyboard.isDown('KeyW')) camera.y += panSpeed * dt * camera.zoom;
        if (keyboard.isDown('KeyS')) camera.y -= panSpeed * dt * camera.zoom;
        if (keyboard.isDown('KeyA')) camera.x -= panSpeed * dt * camera.zoom;
        if (keyboard.isDown('KeyD')) camera.x += panSpeed * dt * camera.zoom;
        if (keyboard.isDown('KeyY')) camera.zoom = Math.min(200, camera.zoom * (1 + dt));
        if (keyboard.isDown('KeyX')) camera.zoom = Math.max(2, camera.zoom / (1 + dt));

        // Manuální symplektický Euler — Rapier step() obejdeme, aby jeho stabilizační
        // kroky neporušovaly zákony zachování v čistě gravitačním FVP scénáři.
        for (let s = 0; s < GRAVITY_SUBSTEPS; s++) {
          stepGravity(w, { G, eps: GRAVITY_EPSILON }, SUB_DT);
        }

        // Render.
        renderer.reserve(w.pixels.length);
        const data = renderer.instanceData;
        for (let i = 0; i < w.pixels.length; i++) {
          const p = w.pixels[i]!;
          const t = p.body.translation();
          data[i * 4 + 0] = t.x;
          data[i * 4 + 1] = t.y;
          data[i * 4 + 2] = p.body.rotation();
          data[i * 4 + 3] = 0.5;
        }
        renderer.render(w.pixels.length, projection(camera, viewport));

        frames++;
        fpsAccum += dt;
        displayAccum += dt;
        if (fpsAccum > 0.5) {
          fps = Math.round(frames / fpsAccum);
          frames = 0;
          fpsAccum = 0;
        }

        if (displayAccum > 0.5) {
          displayAccum = 0;
          const d = computeDiagnostics(w);
          sumP = Math.hypot(d.px, d.py);
          sumL = d.L;
          facts = computeFacts(w, d.cx, d.cy);
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

  function championLabel(c: Champion): string {
    return c ? `#${c.id}` : '—';
  }
</script>

<div class="app">
  <aside class="panel left">
    <h1>Pixelodynamics</h1>

    <h2>STATS</h2>
    <dl class="stats">
      <dt>Time</dt><dd>{formatTime(simTime)}</dd>
      <dt>Pixels</dt><dd>{pixelCount}</dd>
      <dt>Objects</dt><dd>{objectCount}</dd>
      <dt>Connections</dt><dd>{connectionCount}</dd>
      <dt>∑P</dt><dd>{sumP.toFixed(4)} <span class="unit">kg·U/t</span></dd>
      <dt>∑L</dt><dd>{sumL.toFixed(4)} <span class="unit">kg·U²/t</span></dd>
      <dt>FPS</dt><dd>{fps}</dd>
    </dl>

    <h2>FACTS</h2>
    <dl class="facts">
      <dt>Fastest</dt><dd>{@render champ(facts.fastest)}</dd>
      <dt>Spinniest</dt><dd>{@render champ(facts.mostSpin)}</dd>
      <dt>Most momentum</dt><dd>{@render champ(facts.mostMomentum)}</dd>
      <dt>Most ang. mom.</dt><dd>{@render champ(facts.mostAngularMomentum)}</dd>
      <dt>Largest</dt><dd>{championLabel(facts.largest)}</dd>
      <dt>Most massive</dt><dd>{@render champ(facts.mostMassive)}</dd>
    </dl>
    <button class="secondary" onclick={homeCamera}>Home camera (0,0)</button>
  </aside>

  <main class="canvas-wrap">
    <canvas bind:this={canvas}></canvas>
  </main>

  <aside class="panel right">
    <h2>SETTINGS</h2>
    <label class="slider" title="Koeficient dostředivé síly (gravitační konstanta).">
      <span>G</span>
      <input type="range" min="0" max="20" step="0.1" bind:value={G} />
      <output>{G.toFixed(1)}</output>
    </label>
    <label class="slider" title="Síla vazby (fáze 3+, zatím nepoužitá).">
      <span>H</span>
      <input type="range" min="0" max="20" step="0.1" bind:value={H} />
      <output>{H.toFixed(1)}</output>
    </label>
    <button class="reset" onclick={resetScene}>Reset scény</button>

    <h2>COMMANDS</h2>
    <ul>
      <li><kbd>LMB</kbd> spawn pixel</li>
      <li><kbd>WASD</kbd> pan kamery</li>
      <li><kbd>Y</kbd> / <kbd>X</kbd> zoom</li>
      <li><kbd>kolečko</kbd> zoom</li>
    </ul>
  </aside>
</div>

{#snippet champ(c: Champion)}
  {#if c}
    <button class="id-link" onclick={() => centerOnPixel(c.id)} title={`Hodnota: ${c.value.toFixed(3)}`}>
      #{c.id}
    </button>
  {:else}
    —
  {/if}
{/snippet}

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
    grid-template-columns: 240px 1fr 220px;
    height: 100vh;
  }
  .panel {
    padding: 14px 16px;
    background: #11141d;
    overflow-y: auto;
    font-size: 13px;
    line-height: 1.5;
  }
  .panel.left { border-right: 1px solid #1d2230; }
  .panel.right { border-left: 1px solid #1d2230; }
  h1 { font-size: 16px; margin: 0 0 12px; letter-spacing: 0.04em; }
  h2 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #6f8ec1;
    margin: 14px 0 6px;
    border-bottom: 1px solid #1d2230;
    padding-bottom: 3px;
  }
  ul { padding-left: 18px; margin: 0; }
  kbd {
    background: #1d2230; padding: 1px 6px; border-radius: 3px;
    font-family: ui-monospace, monospace; font-size: 11px;
  }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; margin: 0; }
  dt { color: #7a8390; font-size: 12px; }
  dd { margin: 0; font-variant-numeric: tabular-nums; text-align: right; }
  .unit { color: #5b6370; font-size: 11px; }
  .slider {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    column-gap: 8px;
    row-gap: 2px;
    margin-bottom: 10px;
    font-size: 12px;
  }
  .slider span { color: #7a8390; text-align: left; }
  .slider input[type="range"] {
    grid-column: 1 / -1;
    width: 100%;
    accent-color: #6f8ec1;
  }
  .slider output { font-variant-numeric: tabular-nums; color: #cfd6e0; text-align: right; }
  button {
    width: 100%;
    border: 1px solid #2a3142;
    color: #cfd6e0;
    padding: 5px 8px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    border-radius: 3px;
  }
  button.secondary, button.reset {
    background: #1d2230;
    margin-top: 8px;
  }
  button.secondary:hover, button.reset:hover { background: #242b3c; }
  .id-link {
    width: auto;
    background: transparent;
    border: none;
    padding: 0;
    color: #6f8ec1;
    font-variant-numeric: tabular-nums;
    text-decoration: underline dotted;
  }
  .id-link:hover { color: #a0b8d8; }
  .canvas-wrap { position: relative; }
  canvas { display: block; width: 100%; height: 100%; touch-action: none; }
</style>
