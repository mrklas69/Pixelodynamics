<script lang="ts">
  import { onMount } from 'svelte';
  import { World } from '../sim/physics';
  import { stepGravity } from '../sim/gravity';
  import { computeDiagnostics } from '../sim/diagnostics';
  import { computeFacts, emptyFacts, type Facts, type Champion } from '../sim/facts';
  import { GRAVITY_EPSILON, GRAVITY_SUBSTEPS } from '../sim/params';
  import { PRESETS, buildModelshot, type IntegrationMode, type Preset } from '../sim/presets';
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

  // EXPERIMENT STATE
  let paused = $state(false);
  let integration = $state<IntegrationMode>('manual'); // default: stávající chování fáze 2
  let currentPreset = $state<Preset | null>(null);
  let stopAtTime: number | null = null; // null = neomezeno
  let stoppedAtTime = false; // už auto-stop proběhl pro current preset?
  let toast = $state<string | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  // Modelshot dialog — fallback pro auto-stop, kdy stránka nemusí mít focus
  // a clipboard.writeText() Chromium tiše zablokuje. Z dialogu user vždy zkopíruje
  // ručně (Ctrl+A / Ctrl+C nebo tlačítko Copy v gestu).
  let shotJson = $state<string | null>(null);
  let shotAuto = $state(false);
  let shotTextarea: HTMLTextAreaElement | undefined = $state();

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
    currentPreset = null;
    stopAtTime = null;
    stoppedAtTime = false;
  }

  function showToast(msg: string, ms = 2500): void {
    toast = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast = null;
      toastTimer = null;
    }, ms);
  }

  async function exportModelshot(autoTriggered = false): Promise<void> {
    if (!world) return;
    const d = computeDiagnostics(world);
    const shot = buildModelshot(
      world,
      currentPreset?.id ?? null,
      integration,
      simTime,
      G,
      H,
      GRAVITY_EPSILON,
      GRAVITY_SUBSTEPS,
      { px: d.px, py: d.py, L: d.L, ke: d.ke },
    );
    const json = JSON.stringify(shot, null, 2);

    // Pokus o clipboard — funguje když má dokument focus a uživatelské gesto.
    // Auto-stop nemá gesto + může běžet, když je stránka v pozadí → typicky selže.
    let copied = false;
    try {
      if (document.hasFocus()) {
        await navigator.clipboard.writeText(json);
        copied = true;
      }
    } catch (e) {
      console.error('Clipboard write failed', e);
    }

    if (autoTriggered) {
      // Auto-stop vždy otevře dialog jako fallback. I při úspěšném copy chceme,
      // aby měl uživatel JSON viditelně po ruce, kdyby clipboard zatím přepsal něco jiného.
      shotJson = json;
      shotAuto = true;
      showToast(`⏸ Auto-stop @ ${simTime.toFixed(2)}s — modelshot k vyzvednutí`);
    } else if (copied) {
      showToast('📋 Modelshot zkopírován do clipboardu');
    } else {
      // Manuální export, ale focus chyběl → otevři dialog.
      shotJson = json;
      shotAuto = false;
      showToast('📋 Modelshot — clipboard nedostupný, viz dialog');
    }
  }

  async function copyShotFromDialog(): Promise<void> {
    if (!shotJson) return;
    try {
      await navigator.clipboard.writeText(shotJson);
      showToast('📋 Zkopírováno');
    } catch {
      // Fallback: select textareu, ať user udělá Ctrl+C sám.
      shotTextarea?.select();
      showToast('Stiskni Ctrl+C — clipboard API zamítnuto');
    }
  }

  function closeShotDialog(): void {
    shotJson = null;
  }

  function applyPreset(preset: Preset): void {
    if (!world) return;
    resetScene();
    // Defaultní reset SETTINGS — preset přepíše jen to, co explicitně volá. Bez tohoto
    // by hodnoty leakovaly z předchozího stavu sliderů → tichá nereprodukovatelnost.
    G = 1;
    H = 1;
    currentPreset = preset;
    stopAtTime = preset.stopAtTime ?? null;
    stoppedAtTime = false;
    paused = false;
    preset.setup({
      setG: (g) => (G = g),
      setH: (h) => (H = h),
      setIntegration: (m) => (integration = m),
      spawn: (x, y, vx, vy, r, rs, m = 1) => {
        if (world) world.spawnPixelExact(x, y, vx, vy, r, rs, m);
      },
    });
    pixelCount = world.pixels.length;
    showToast(`▶ ${preset.name}`, 1800);
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

      // Fixed timestep accumulator (Glenn Fiedler pattern):
      // simTime se posouvá výhradně po `FIXED_DT` pevných krocích, decoupled od wall-clocku.
      // Reprodukovatelné mezi PC s různými refresh rate, žádný drift mezi `simTime` a tím,
      // co Rapier skutečně integroval.
      const FIXED_DT = 1 / 60;
      const SUB_DT = FIXED_DT / GRAVITY_SUBSTEPS;
      const MAX_REAL_DT = 0.05;
      const MAX_STEPS_PER_FRAME = 5; // anti spiral-of-death — radši slow-motion než freeze
      let accumulator = 0;

      // Space = pause/resume. Keydown kvůli toggle, ne držení.
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.code === 'Space' && !e.repeat) {
          e.preventDefault();
          paused = !paused;
        }
      };
      window.addEventListener('keydown', onKeyDown);

      const loop = (now: number) => {
        if (stopped) return;
        const realDt = Math.min((now - last) / 1000, MAX_REAL_DT);
        last = now;

        // Kamera reaguje vždy, i v pauze.
        const panSpeed = 20 / camera.zoom;
        if (keyboard.isDown('KeyW')) camera.y += panSpeed * realDt * camera.zoom;
        if (keyboard.isDown('KeyS')) camera.y -= panSpeed * realDt * camera.zoom;
        if (keyboard.isDown('KeyA')) camera.x -= panSpeed * realDt * camera.zoom;
        if (keyboard.isDown('KeyD')) camera.x += panSpeed * realDt * camera.zoom;
        if (keyboard.isDown('KeyY')) camera.zoom = Math.min(200, camera.zoom * (1 + realDt));
        if (keyboard.isDown('KeyX')) camera.zoom = Math.max(2, camera.zoom / (1 + realDt));

        if (!paused) {
          accumulator += realDt;
          let steps = 0;
          while (accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
            // Mode-aware integration step.
            //   manual  — symplektický Euler, stávající fáze 2 chování.
            //   rapier  — jen Rapier step(), pro experimenty E1–E4.
            //   hybrid  — manuální gravita + Rapier step(), pro experiment E5.
            if (integration === 'manual' || integration === 'hybrid') {
              for (let s = 0; s < GRAVITY_SUBSTEPS; s++) {
                stepGravity(w, { G, eps: GRAVITY_EPSILON }, SUB_DT);
              }
            }
            if (integration === 'rapier' || integration === 'hybrid') {
              w.step(FIXED_DT);
            }
            simTime += FIXED_DT;
            accumulator -= FIXED_DT;
            steps++;

            // Auto-stop preset uvnitř while smyčky — chytíme prah co nejtěsněji.
            if (stopAtTime != null && !stoppedAtTime && simTime >= stopAtTime) {
              stoppedAtTime = true;
              paused = true;
              void exportModelshot(true);
              accumulator = 0;
              break;
            }
          }
          // Pokud jsme zasáhli step cap, spáleme přebytek, jinak by spirálovitě rostl.
          if (accumulator > FIXED_DT * MAX_STEPS_PER_FRAME) {
            accumulator = FIXED_DT * MAX_STEPS_PER_FRAME;
          }
        } else {
          // V pauze drop accumulator — po resume nesmí přijít burst kroků na dohnání.
          accumulator = 0;
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
        fpsAccum += realDt;
        displayAccum += realDt;
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
        window.removeEventListener('keydown', onKeyDown);
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
      <li><kbd>Space</kbd> pause / resume</li>
    </ul>

    <button class="secondary" onclick={() => (paused = !paused)}>
      {paused ? '▶ Resume' : '⏸ Pause'}
    </button>
    <button class="secondary" onclick={() => void exportModelshot(false)}>
      📋 Export JSON
    </button>

    <h2>PRESETS</h2>
    <p class="hint">Mód: <strong>{integration}</strong>{currentPreset ? ` · ${currentPreset.id}` : ''}</p>
    {#each PRESETS as preset (preset.id)}
      <button
        class="preset"
        class:active={currentPreset?.id === preset.id}
        title={preset.description}
        onclick={() => applyPreset(preset)}
      >
        {preset.name}
        {#if preset.stopAtTime != null}<span class="stop">⏱ {preset.stopAtTime}s</span>{/if}
      </button>
    {/each}
  </aside>

  {#if toast}
    <div class="toast">{toast}</div>
  {/if}

  {#if shotJson}
    <div class="shot-overlay" onclick={closeShotDialog} role="presentation">
      <div
        class="shot-dialog"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.key === 'Escape' && closeShotDialog()}
        role="dialog"
        aria-label="Modelshot"
        tabindex="-1"
      >
        <header>
          <h3>Modelshot {shotAuto ? '(auto-stop)' : ''}</h3>
          <button class="close" onclick={closeShotDialog} aria-label="Zavřít">✕</button>
        </header>
        <textarea
          bind:this={shotTextarea}
          readonly
          value={shotJson}
          onclick={(e) => (e.target as HTMLTextAreaElement).select()}
        ></textarea>
        <footer>
          <button onclick={copyShotFromDialog}>📋 Copy</button>
          <button class="secondary" onclick={closeShotDialog}>Zavřít</button>
        </footer>
      </div>
    </div>
  {/if}
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
  .hint { font-size: 11px; color: #7a8390; margin: 0 0 6px; }
  .hint strong { color: #cfd6e0; font-weight: normal; }
  button.preset {
    text-align: left;
    background: #161b27;
    margin-bottom: 4px;
    padding: 6px 8px;
    font-size: 11px;
    line-height: 1.3;
    display: flex;
    justify-content: space-between;
    gap: 6px;
  }
  button.preset:hover { background: #1d2433; }
  button.preset.active {
    border-color: #6f8ec1;
    background: #1d2433;
    color: #a0b8d8;
  }
  button.preset .stop {
    color: #6f8ec1;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .toast {
    position: fixed;
    left: 50%;
    bottom: 24px;
    transform: translateX(-50%);
    background: #1d2433;
    border: 1px solid #2a3142;
    color: #cfd6e0;
    padding: 8px 14px;
    border-radius: 4px;
    font-size: 13px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    z-index: 100;
    pointer-events: none;
  }
  .shot-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
  }
  .shot-dialog {
    background: #11141d;
    border: 1px solid #2a3142;
    border-radius: 4px;
    width: min(720px, 92vw);
    height: min(80vh, 600px);
    display: flex;
    flex-direction: column;
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.6);
  }
  .shot-dialog header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid #1d2230;
  }
  .shot-dialog h3 { margin: 0; font-size: 14px; }
  .shot-dialog .close {
    width: auto;
    background: transparent;
    border: none;
    color: #7a8390;
    font-size: 16px;
    padding: 0 6px;
  }
  .shot-dialog .close:hover { color: #cfd6e0; }
  .shot-dialog textarea {
    flex: 1;
    margin: 0;
    padding: 10px 14px;
    background: #0a0d15;
    border: none;
    border-bottom: 1px solid #1d2230;
    color: #cfd6e0;
    font-family: ui-monospace, monospace;
    font-size: 12px;
    line-height: 1.4;
    resize: none;
    outline: none;
    white-space: pre;
  }
  .shot-dialog footer {
    display: flex;
    gap: 8px;
    padding: 10px 14px;
  }
  .shot-dialog footer button { flex: 1; }
</style>
