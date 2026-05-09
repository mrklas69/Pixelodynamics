<script lang="ts">
  import { onMount } from 'svelte';
  import { World } from '../sim/physics';
  import { stepGravity, stepGravityKickOnly } from '../sim/gravity';
  import { computeDiagnostics, computeCentroid, buildPixelIndex } from '../sim/diagnostics';
  import { computeFacts, emptyFacts, type Facts, type Champion, type ChampionEntity } from '../sim/facts';
  import { GRAVITY_EPSILON, GRAVITY_SUBSTEPS, GRAVITY_USE_GRID, GRAVITY_CUTOFF_FACTOR, AUTO_JOINT_ON_CONTACT, MAGNET_THRESHOLD } from '../sim/params';
  import { PRESETS, buildModelshot, type IntegrationMode, type Preset } from '../sim/presets';
  import { createFixedJoint, autoJointAlign } from '../sim/joints';
  import {
    buildComposites,
    detectMergeCandidates,
    applyMerge,
    stepCompositesAlign,
    computeCompositeFor,
  } from '../sim/composite';
  import { playSpawn } from '../audio/sfx';
  import { Renderer } from '../render/gl';
  import { createCamera, projection, screenToWorld, worldToScreen } from '../render/camera';
  import type { Camera, Pixel, LockTarget } from '../types';
  import { Keyboard } from '../input/keyboard';
  import { fmtSig4 } from './format';

  let canvas: HTMLCanvasElement;

  // STATS
  let simTime = $state(0);
  let pixelCount = $state(0);
  let objectCount = $state(0);
  let connectionCount = $state(0);
  let mergeCandidateCount = $state(0);
  let sumP = $state(0);
  let sumL = $state(0);
  let sumE = $state(0);
  let deltaE = $state(0);
  let fps = $state(0);
  // E₀ baseline pro drift indikátor. null = ještě nezachycený (čeká na první display tick
  // po prvním stepGravity, aby lastPE byla platná). Reset v resetScene.
  let e0: number | null = null;

  // FACTS
  let facts = $state<Facts>(emptyFacts);

  // SETTINGS — uživatelsky laditelné parametry simulace.
  let G = $state(1.0); // koeficient dostředivé síly (gravitační konstanta)
  let H = $state(1.0); // síla vazby (zatím nepoužité, fáze 3+)
  // Spatial grid přepínač — některé experimenty (E6) potřebují naive O(N²)
  // kvůli interakcím přes hard cutoff.
  let useGrid = $state(GRAVITY_USE_GRID);
  // Cutoff factor pro grid mode (násobek ε). Live-tunable kvůli perf benchmarku
  // PB500/PB1000 — měříme FPS pro factor 5/8/10 bez nutnosti reset preset.
  let cutoffFactor = $state(GRAVITY_CUTOFF_FACTOR);

  // EXPERIMENT STATE
  let paused = $state(false);
  // Default `not-align`: gravita + Rapier joint solver + auto-jointing při kontaktu.
  // Bez switch na `without-interaction` pixely procházejí, bez switch na `align` jointy
  // zachovávají rotaci pixelů (anchor padne na midpoint).
  let integration = $state<IntegrationMode>('not-align');
  let currentPreset = $state<Preset | null>(null);
  let stopAtTime: number | null = null; // null = neomezeno
  let stoppedAtTime = false; // už auto-stop proběhl pro current preset?
  let toast = $state<string | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  // Modelshot dialog — fallback pro auto-stop, kdy stránka nemusí mít focus
  // a clipboard.writeText() Chromium tiše zablokuje.
  let shotJson = $state<string | null>(null);
  let shotAuto = $state(false);
  let shotTextarea: HTMLTextAreaElement | undefined = $state();

  // Cache PE z poslední gravity substepu — modelshot ho potřebuje k ověření ∑E.
  // Pro rapier mód (žádný stepGravity call) zůstane 0; tam je G=0 → pe=0 fyzicky.
  let lastPE = 0;

  let world: World | null = null;
  // Camera jako $state proxy — zobrazení v HUD i sliderům reaguje automaticky
  // a změny v render loopu (lock follow) jsou viditelné v UI bez ručního flushe.
  const camera: Camera = $state(createCamera());

  // Kurzor — world pozice myši pro HUD. null = pointer mimo canvas.
  let cursor = $state<{ x: number; y: number } | null>(null);

  // Centroid systému ve screen-space px pro overlay křížek. null = prázdná scéna.
  let centroidScreen = $state<{ x: number; y: number } | null>(null);


  // HOVER tooltip — info o nejbližším pixelu pod kurzorem.
  // null = mimo canvas / mimo pixel.
  let hover = $state<{
    sx: number; sy: number; // screen pos (clientX/Y) pro CSS umístění
    id: number;
    x: number; y: number;
    vx: number; vy: number;
    r: number; rs: number;
    m: number;
    speed: number;
    /** Composite info, pokud je pixel členem slepence (≥ 2 členů). null = singleton. */
    composite: {
      count: number;
      mass: number;
      comX: number; comY: number;
      vx: number; vy: number;
      speed: number;
      angvel: number;
    } | null;
  } | null>(null);

  function formatTime(s: number): string {
    const days = Math.floor(s / 86400);
    const hrs = Math.floor((s % 86400) / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = Math.floor(s % 60);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${days}:${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }

  /**
   * Zámek kamery na entitu (pixel nebo slepenec). Loop ji každý frame následuje:
   * pixel → `pixel.pos`, composite → CoM přes `computeCompositeFor` z rep pixelu.
   * Pokud rep ID neexistuje, jen toast.
   */
  function lockCameraOn(target: ChampionEntity): void {
    if (!world) return;
    const exists = world.pixels.some((p) => p.id === target.id);
    if (!exists) {
      showToast(`#${target.id} už neexistuje`);
      return;
    }
    camera.lockTarget = { kind: target.kind, id: target.id };
    const prefix = target.kind === 'composite' ? '◆' : '';
    showToast(`🔒 Lock ${prefix}#${target.id} (Esc / WASD odemkne)`, 1500);
  }

  function unlockCamera(): void {
    if (camera.lockTarget !== null) {
      camera.lockTarget = null;
    }
  }

  function homeCamera(): void {
    unlockCamera();
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
    sumE = 0;
    deltaE = 0;
    e0 = null;
    lastPE = 0;
    currentPreset = null;
    stopAtTime = null;
    stoppedAtTime = false;
    unlockCamera();
    hover = null;
    cursor = null;
    centroidScreen = null;
    connectionCount = 0;
    objectCount = 0;
    mergeCandidateCount = 0;
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
      { px: d.px, py: d.py, L: d.L, ke: d.ke, pe: lastPE },
    );
    const json = JSON.stringify(shot, null, 2);

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
      shotJson = json;
      shotAuto = true;
      showToast(`⏸ Auto-stop @ ${simTime.toFixed(2)}s — modelshot k vyzvednutí`);
    } else if (copied) {
      showToast('📋 Modelshot zkopírován do clipboardu');
    } else {
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
    G = 1;
    H = 1;
    useGrid = GRAVITY_USE_GRID; // reset na default; preset přepíše jen když si řekne
    cutoffFactor = GRAVITY_CUTOFF_FACTOR;
    currentPreset = preset;
    stopAtTime = preset.stopAtTime ?? null;
    stoppedAtTime = false;
    paused = false;
    const w = world;
    // Reset Rapier tunings na Pixelodynamics defaulty (32/8 — ne Rapier 4/1, ty jsou
    // pro herní contacts) před setup. Preset může explicitně override přes tuneRapier.
    w.setSolverIterations(32);
    w.setPgsIterations(8);
    w.setDefaultCanSleep(false);
    preset.setup({
      setG: (g) => (G = g),
      setH: (h) => (H = h),
      setIntegration: (m) => (integration = m),
      setUseGrid: (b) => (useGrid = b),
      spawn: (x, y, vx, vy, r, rs, m = 1, pinned = false) =>
        w.spawnPixelExact(x, y, vx, vy, r, rs, m, pinned),
      connect: (a, b) => {
        // Propaguj aktuální integration mode — chain joints v `align` musí mít
        // compositeOffsetX/Y nastavené (jinak stepCompositesAlign čte `?? 0` →
        // všichni members kolabují na CoM). Pro fresh-pair connect symmetric snap
        // kolem midpointu nemění geometrii (1U spawn = 1U výsledek).
        createFixedJoint(w, a, b, integration === 'align');
      },
      tuneRapier: (opts) => {
        if (opts.solverIterations !== undefined) w.setSolverIterations(opts.solverIterations);
        if (opts.pgsIterations !== undefined) w.setPgsIterations(opts.pgsIterations);
        if (opts.canSleep !== undefined) w.setDefaultCanSleep(opts.canSleep);
      },
    });
    pixelCount = world.pixels.length;
    connectionCount = world.joints.length;
    showToast(`▶ ${preset.name}`, 1800);
  }

  /**
   * Reaguje na změnu integration módu — JEDNORÁZOVÁ akce při switch:
   * Při switch na `align` snapne existující pixely do axis-aligned stavu (r=0, rs=0).
   * Stage 3.2: `lockRotations` se nepoužívá — composite rotation v `align` mode
   * je řízena explicitně přes `stepCompositesAlign` (theta drift + setRotation).
   *
   * VŮBEC NE per-tick — to by resetovalo Rapier joint warm-start solver cache → drift.
   */
  $effect(() => {
    const w = world;
    if (!w) return;
    if (integration === 'align') {
      for (const p of w.pixels) {
        if (p.pinned) continue;
        p.body.setRotation(0, true);
        p.body.setAngvel(0, true);
      }
    }
  });

  /**
   * Edge bit pro anchor v lokálním frame pixelu. Dominantní osa určuje, kterou
   * stranu pixelu maskovat. Mapování: bit 0 = +X, 1 = -X, 2 = +Y, 3 = -Y.
   * Pro 45° anchory (|x| == |y|) je výsledek arbitrární — nikdo to neřeší,
   * corner cases jsou v Pixelodynamics okrajové.
   */
  function edgeBit(a: { x: number; y: number }): number {
    if (Math.abs(a.x) >= Math.abs(a.y)) {
      return a.x >= 0 ? 1 : 2;
    }
    return a.y >= 0 ? 4 : 8;
  }

  /**
   * Hit-test: najdi pixel, jehož AABB (po inverzi rotace) obsahuje (wx, wy).
   * Pixel je čtverec o straně 1 U, takže lokální |x|<0.5 && |y|<0.5.
   * O(N), což je v pořádku pro hover (N≤2000).
   */
  function pickPixel(wx: number, wy: number): Pixel | null {
    if (!world) return null;
    for (const p of world.pixels) {
      const t = p.body.translation();
      const r = p.body.rotation();
      const dx = wx - t.x;
      const dy = wy - t.y;
      // Inverze rotace: R(-r) na (dx, dy).
      const c = Math.cos(-r);
      const s = Math.sin(-r);
      const lx = c * dx - s * dy;
      const ly = s * dx + c * dy;
      if (Math.abs(lx) <= 0.5 && Math.abs(ly) <= 0.5) return p;
    }
    return null;
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
        // Stage 3.2: žádný lockRotations. V align mode je fresh pixel singleton
        // (compositeTheta=null → stepCompositesAlign skip), Rapier integruje rotation
        // normálně. Po auto-joint do composite převezme řízení stepCompositesAlign.
        pixelCount = w.pixels.length;
        playSpawn();
      };
      canvas.addEventListener('pointerdown', onPointerDown);

      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * 0.001);
        camera.zoom = Math.max(2, Math.min(200, camera.zoom * factor));
      };
      canvas.addEventListener('wheel', onWheel, { passive: false });

      // Hover tracking. Per-pointermove update; hit-test je O(N), lehký pro 1000 pix.
      const onPointerMove = (e: PointerEvent) => {
        const rect = canvas.getBoundingClientRect();
        const wp = screenToWorld(camera, viewport, e.clientX - rect.left, e.clientY - rect.top);
        cursor = { x: wp.x, y: wp.y };
        const p = pickPixel(wp.x, wp.y);
        if (p) {
          const t = p.body.translation();
          const v = p.body.linvel();
          // Composite info — BFS po jointech od pixelu, null pro singleton.
          const c = computeCompositeFor(w, p);
          hover = {
            sx: e.clientX,
            sy: e.clientY,
            id: p.id,
            x: t.x,
            y: t.y,
            vx: v.x,
            vy: v.y,
            r: p.body.rotation(),
            rs: p.body.angvel(),
            m: p.m,
            speed: Math.hypot(v.x, v.y),
            composite: c
              ? {
                  count: c.members.length,
                  mass: c.mass,
                  comX: c.com.x,
                  comY: c.com.y,
                  vx: c.linvel.x,
                  vy: c.linvel.y,
                  speed: Math.hypot(c.linvel.x, c.linvel.y),
                  angvel: c.angvel,
                }
              : null,
          };
        } else {
          hover = null;
        }
      };
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerleave', () => {
        hover = null;
        cursor = null;
      });

      let last = performance.now();
      let frames = 0;
      let fpsAccum = 0;
      let displayAccum = 0;

      // Fixed timestep accumulator (Glenn Fiedler).
      const FIXED_DT = 1 / 60;
      const SUB_DT = FIXED_DT / GRAVITY_SUBSTEPS;
      const MAX_REAL_DT = 0.05;
      const MAX_STEPS_PER_FRAME = 5;
      let accumulator = 0;

      // Auto-jointing — po každém Rapier stepu drain contact Started events.
      // `not-align`: createFixedJoint má duplicate guard, midpoint anchor je bezpečný.
      // `align`: autoJointAlign filtruje same-component eventy + vybírá endpoint pár
      //   chainů (kontaktní událost typicky NEní mezi koncovými pixely; rigid-transform
      //   na non-endpoint pivotu by spadl na obsazenou pozici).
      // `without-interaction` mode nemá Rapier step → eventQueue prázdná → no-op.
      const drainAndAutoJoint = (): void => {
        if (!AUTO_JOINT_ON_CONTACT) return;
        const align = integration === 'align';
        w.drainContactStarts((a, b) => {
          if (align) {
            autoJointAlign(w, a, b);
          } else {
            createFixedJoint(w, a, b, false);
          }
        });
      };

      // Space = pause. Esc = unlock kamery.
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.code === 'Space' && !e.repeat) {
          e.preventDefault();
          paused = !paused;
        } else if (e.code === 'Escape' && !e.repeat) {
          if (camera.lockTarget !== null) {
            unlockCamera();
            showToast('🔓 Kamera odemčena', 1200);
          }
        }
      };
      window.addEventListener('keydown', onKeyDown);

      const loop = (now: number) => {
        if (stopped) return;
        const realDt = Math.min((now - last) / 1000, MAX_REAL_DT);
        last = now;

        // Kamera reaguje vždy, i v pauze. WASD pohyb shazuje lock follow —
        // intuice „chci se podívat jinam" implicitně ruší automatický follow.
        const panSpeed = 20 / camera.zoom;
        let panned = false;
        if (keyboard.isDown('KeyW')) { camera.y += panSpeed * realDt * camera.zoom; panned = true; }
        if (keyboard.isDown('KeyS')) { camera.y -= panSpeed * realDt * camera.zoom; panned = true; }
        if (keyboard.isDown('KeyA')) { camera.x -= panSpeed * realDt * camera.zoom; panned = true; }
        if (keyboard.isDown('KeyD')) { camera.x += panSpeed * realDt * camera.zoom; panned = true; }
        if (panned && camera.lockTarget !== null) unlockCamera();
        if (keyboard.isDown('KeyY')) camera.zoom = Math.min(200, camera.zoom * (1 + realDt));
        if (keyboard.isDown('KeyX')) camera.zoom = Math.max(2, camera.zoom / (1 + realDt));

        if (!paused) {
          accumulator += realDt;
          let steps = 0;
          while (accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
            const gp = { G, eps: GRAVITY_EPSILON, useGrid, cutoffFactor };

            switch (integration) {
              case 'without-interaction':
                // Pure manual symplektický Euler — full kick + drift. Rapier step se
                // nevolá, žádné kontakty, žádné jointy. Pixely procházejí. ∑P/∑L na úrovni
                // f64 ulp.
                for (let s = 0; s < GRAVITY_SUBSTEPS; s++) {
                  lastPE = stepGravity(w, gp, SUB_DT).pe;
                }
                break;

              case 'not-align':
                // Velocity-Verlet split: manual jen kick (v += a·dt), drift + joint solver
                // dělá Rapier `world.step()`. Substepy gravity se aplikují všechny před
                // jediným Rapier krokem — gravita je integrovaná SUBSTEPS× jemněji než pos
                // drift, což snižuje truncation error close-encounteru.
                for (let s = 0; s < GRAVITY_SUBSTEPS; s++) {
                  lastPE = stepGravityKickOnly(w, gp, SUB_DT).pe;
                }
                w.step(FIXED_DT);
                break;

              case 'align':
                // Stage 3 — composite-driven kinematics. Stejný kick + Rapier step jako
                // `not-align`, ale po Rapier kroku override pos/rot/linvel/angvel z
                // aggregate state pro multi-pixel composity. Joint solver Rapieru
                // konverguje approximativně, my pak enforce přesnou rigidní geometrii
                // podle uložených offsetů (set v createFixedJoint align=true).
                // Singleton composites (1 pixel, no joint) Rapier integruje normálně.
                for (let s = 0; s < GRAVITY_SUBSTEPS; s++) {
                  lastPE = stepGravityKickOnly(w, gp, SUB_DT).pe;
                }
                w.step(FIXED_DT);
                stepCompositesAlign(w, FIXED_DT);
                break;
            }
            // Auto-joint po Rapier kroku. `without-interaction` mode → eventQueue prázdná
            // (žádný Rapier step) → no-op.
            drainAndAutoJoint();
            simTime += FIXED_DT;
            accumulator -= FIXED_DT;
            steps++;

            if (stopAtTime != null && !stoppedAtTime && simTime >= stopAtTime) {
              stoppedAtTime = true;
              paused = true;
              void exportModelshot(true);
              accumulator = 0;
              break;
            }
          }
          if (accumulator > FIXED_DT * MAX_STEPS_PER_FRAME) {
            accumulator = FIXED_DT * MAX_STEPS_PER_FRAME;
          }
        } else {
          accumulator = 0;
        }

        // Lock follow — po simulačním kroku.
        // - `pixel` kind: kamera = pixel.pos.
        // - `composite` kind: re-find pixel s lockTarget.id, BFS přes computeCompositeFor,
        //   kamera = composite.com. Pokud rep zmizel nebo už není ve slepenci (singleton),
        //   shoď zámek (composite, který rep reprezentoval, už neexistuje).
        if (camera.lockTarget !== null) {
          const lock = camera.lockTarget;
          const repPixel = w.pixels.find((p) => p.id === lock.id);
          if (!repPixel) {
            unlockCamera();
            showToast(`#${lock.id} zmizel — kamera odemčena`, 1500);
          } else if (lock.kind === 'pixel') {
            const t = repPixel.body.translation();
            camera.x = t.x;
            camera.y = t.y;
          } else {
            const c = computeCompositeFor(w, repPixel);
            if (!c) {
              unlockCamera();
              showToast(`Slepenec ◆#${lock.id} se rozpadl — kamera odemčena`, 1500);
            } else {
              camera.x = c.com.x;
              camera.y = c.com.y;
            }
          }
        }

        // Centroid systému — overlay křížek. Per-frame O(N), zanedbatelné vs. simulace.
        const c = computeCentroid(w);
        centroidScreen = c ? worldToScreen(camera, viewport, c.cx, c.cy) : null;

        // Lock highlight set — pro pixel kind jen rep, pro composite kind všichni členové.
        // Per-frame O(N) lookup; pro N<10000 zanedbatelné.
        const lockedIds = new Set<number>();
        if (camera.lockTarget !== null) {
          if (camera.lockTarget.kind === 'pixel') {
            lockedIds.add(camera.lockTarget.id);
          } else {
            const repPixel = w.pixels.find((p) => p.id === camera.lockTarget!.id);
            if (repPixel) {
              const c = computeCompositeFor(w, repPixel);
              if (c) {
                for (const m of c.members) lockedIds.add(m.id);
              } else {
                lockedIds.add(repPixel.id);
              }
            }
          }
        }

        // Render.
        renderer.reserve(w.pixels.length);
        const data = renderer.instanceData;
        const lockedData = renderer.lockedData;
        const maskData = renderer.maskData;
        for (let i = 0; i < w.pixels.length; i++) {
          const p = w.pixels[i]!;
          const t = p.body.translation();
          data[i * 4 + 0] = t.x;
          data[i * 4 + 1] = t.y;
          data[i * 4 + 2] = p.body.rotation();
          data[i * 4 + 3] = 0.5;
          lockedData[i] = lockedIds.has(p.id) ? 1 : 0;
          maskData[i] = 0;
        }
        // Edge mask z jointů: pro každý joint určíme dominantní lokální osu anchoru
        // a maskneme příslušnou hranu. Component outline = boundary připojené komponenty
        // bez vnitřních čar mezi pixely. Lookup přes shared `buildPixelIndex`.
        if (w.joints.length > 0) {
          const idxOf = buildPixelIndex(w);
          for (const j of w.joints) {
            const ai = idxOf.get(j.a);
            if (ai !== undefined) maskData[ai] = maskData[ai]! | edgeBit(j.anchorA);
            const bi = idxOf.get(j.b);
            if (bi !== undefined) maskData[bi] = maskData[bi]! | edgeBit(j.anchorB);
          }
        }
        // Hybrid border: nejméně 1 screen px, nejvýše 5 % strany pixelu.
        const borderHalfWidth = Math.max(0.05, 1 / camera.zoom);
        renderer.render(w.pixels.length, projection(camera, viewport), borderHalfWidth);

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
          connectionCount = w.joints.length;
          // Magnetic merge: detection (Stage 1) + apply (Stage 2/3.1). Per display tick (5 Hz).
          // Volné hrany komponent v dosahu MAGNET_THRESHOLD jsou kandidáty na inelastic merge.
          // `without-interaction` skip — Rapier step se nevolá → FixedJoint by visel bez efektu.
          // `not-align` jede Stage 2 math (∑P + ∑L preserved). `align` jede Stage 3.1
          // chain-merge cestu přes createFixedJoint (∑P preserved, ω=0 explicit).
          const composites = buildComposites(w);
          objectCount = composites.length;
          const candidates = detectMergeCandidates(w, composites, MAGNET_THRESHOLD);
          mergeCandidateCount = candidates.length;
          if (integration === 'not-align' || integration === 'align') {
            const align = integration === 'align';
            // Consumed-set guard: v jednom display ticku každou komponentu mergni jen
            // jednou (kdyby compA byla v candidate (A,B) i (A,C), apply na (A,B)
            // změní A → kandidát (A,C) se přepočítá příští display tick z čerstvého
            // composite stavu).
            const consumed = new Set<number>();
            for (const c of candidates) {
              if (consumed.has(c.compA.id) || consumed.has(c.compB.id)) continue;
              if (applyMerge(w, c, align)) {
                consumed.add(c.compA.id);
                consumed.add(c.compB.id);
              }
            }
          }
          const d = computeDiagnostics(w);
          sumP = Math.hypot(d.px, d.py);
          sumL = d.L;
          // Totální mechanická energie. lastPE je z poslední stepGravity substepu;
          // pro rapier mode zůstane 0 (G=0 v E1/E2 → fyzicky správně).
          const e = d.ke + lastPE;
          // E₀ se zachytí až po prvním sim kroku, kdy lastPE má platnou hodnotu.
          // Při simTime=0 (po preset apply / reset) by KE už byla nastavená, ale PE ne.
          if (e0 === null && simTime > 0 && w.pixels.length > 0) {
            e0 = e;
          }
          sumE = e;
          deltaE = e0 === null ? 0 : e - e0;
          facts = computeFacts(composites, d.cx, d.cy);
        }

        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);

      return () => {
        window.removeEventListener('resize', onResize);
        window.removeEventListener('keydown', onKeyDown);
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('wheel', onWheel);
        canvas.removeEventListener('pointermove', onPointerMove);
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
    <h2>STATS</h2>
    <dl class="stats">
      <dt>Time</dt><dd>{formatTime(simTime)}</dd>
      <dt>Pixels</dt><dd>{pixelCount}</dd>
      <dt>Objects</dt><dd>{objectCount}</dd>
      <dt>Connections</dt><dd>{connectionCount}</dd>
      <dt>Merge cand.</dt><dd>{mergeCandidateCount}</dd>
      <dt>∑P</dt><dd>{fmtSig4(sumP)} <span class="unit">kg·U/t</span></dd>
      <dt>∑L</dt><dd>{fmtSig4(sumL)} <span class="unit">kg·U²/t</span></dd>
      <dt>∑E</dt><dd>{fmtSig4(sumE)} <span class="unit">kg·U²/t²</span></dd>
      <dt>Δ∑E</dt><dd>{fmtSig4(deltaE)} <span class="unit">kg·U²/t²</span></dd>
      <dt>FPS</dt><dd>{fps}</dd>
    </dl>

    <h2>FACTS</h2>
    <dl class="facts">
      <dt>Fastest</dt><dd>{@render champ(facts.fastest)}</dd>
      <dt>Spinniest</dt><dd>{@render champ(facts.mostSpin)}</dd>
      <dt>Most momentum</dt><dd>{@render champ(facts.mostMomentum)}</dd>
      <dt>Most ang. mom.</dt><dd>{@render champ(facts.mostAngularMomentum)}</dd>
      <dt>Largest</dt><dd>{@render champ(facts.largest)}</dd>
      <dt>Most massive</dt><dd>{@render champ(facts.mostMassive)}</dd>
    </dl>

    <h2>COMMANDS</h2>
    <ul>
      <li><kbd>LMB</kbd> spawn pixel</li>
      <li><kbd>WASD</kbd> pan kamery (odemkne lock)</li>
      <li><kbd>Y</kbd> / <kbd>X</kbd> zoom</li>
      <li><kbd>kolečko</kbd> zoom</li>
      <li><kbd>Space</kbd> pause / resume</li>
      <li><kbd>Esc</kbd> odemknout kameru</li>
    </ul>

    <button class="secondary" onclick={homeCamera}>Home camera (0,0)</button>
    <button class="secondary" onclick={() => (paused = !paused)}>
      {paused ? '▶ Resume' : '⏸ Pause'}
    </button>
    <button class="secondary" onclick={() => void exportModelshot(false)}>
      📋 Export JSON
    </button>
    <button class="secondary" onclick={resetScene}>Clear</button>
  </aside>

  <main class="canvas-wrap">
    <canvas bind:this={canvas}></canvas>

    <div class="hud" aria-live="polite">
      <div class="hud-row">
        <span class="lbl">cursor</span>
        {#if cursor}
          <span>x {fmtSig4(cursor.x)}</span>
          <span>y {fmtSig4(cursor.y)}</span>
        {:else}
          <span class="dim">—</span>
        {/if}
      </div>
      <div class="hud-row">
        {#if camera.lockTarget !== null}
          {#if camera.lockTarget.kind === 'composite'}
            <span class="lock">🔒 ◆#{camera.lockTarget.id}</span>
          {:else}
            <span class="lock">🔒 #{camera.lockTarget.id}</span>
          {/if}
        {:else}
          <span class="free">free</span>
        {/if}
        <span class="sep">·</span>
        <span>x {fmtSig4(camera.x)}</span>
        <span>y {fmtSig4(camera.y)}</span>
        <span class="sep">·</span>
        <span>zoom {fmtSig4(camera.zoom)} px/U</span>
      </div>
    </div>

    {#if centroidScreen}
      <div class="centroid" style="left: {centroidScreen.x}px; top: {centroidScreen.y}px"></div>
    {/if}

    {#if hover}
      <div
        class="tooltip"
        style="left: {hover.sx + 14}px; top: {hover.sy + 14}px"
      >
        <div class="tip-head">Pixel #{hover.id}</div>
        <dl>
          <dt>x, y</dt><dd>{fmtSig4(hover.x)}, {fmtSig4(hover.y)}</dd>
          <dt>vx, vy</dt><dd>{fmtSig4(hover.vx)}, {fmtSig4(hover.vy)}</dd>
          <dt>|v|</dt><dd>{fmtSig4(hover.speed)}</dd>
          <dt>r</dt><dd>{fmtSig4(hover.r)} rad</dd>
          <dt>rs</dt><dd>{fmtSig4(hover.rs)} rad/s</dd>
          <dt>m</dt><dd>{fmtSig4(hover.m)}</dd>
        </dl>
        {#if hover.composite}
          <div class="tip-head">Slepenec ({hover.composite.count}×)</div>
          <dl>
            <dt>M</dt><dd>{fmtSig4(hover.composite.mass)}</dd>
            <dt>CoM</dt><dd>{fmtSig4(hover.composite.comX)}, {fmtSig4(hover.composite.comY)}</dd>
            <dt>V</dt><dd>{fmtSig4(hover.composite.vx)}, {fmtSig4(hover.composite.vy)}</dd>
            <dt>|V|</dt><dd>{fmtSig4(hover.composite.speed)}</dd>
            <dt>ω</dt><dd>{fmtSig4(hover.composite.angvel)} rad/s</dd>
          </dl>
        {/if}
      </div>
    {/if}

    <div class="footer-overlay">
      <div>Pixelodynamics — sandboxová simulace pixelové dynamiky</div>
      <div>(c) 2026 mrklas69 · MIT · github.com/mrklas69/Pixelodynamics</div>
    </div>
  </main>

  <aside class="panel right">
    <h2>SETTINGS</h2>
    <label class="slider">
      <span>G</span>
      <span class="info" title="G — gravitační konstanta&#10;&#10;Násobí Plummer-softened sílu mezi každou dvojicí pixelů: F = G·m₁·m₂·r̂ / (r²+ε²)^{3/2}.&#10;&#10;Slider 0–20. G=0 → pixely letí balisticky. Vyšší G = silnější přitažlivost, ne větší dosah — cutoff je nezávislý.">?</span>
      <input type="range" min="0" max="20" step="0.1" bind:value={G} />
      <output>{G.toFixed(1)}</output>
    </label>
    <label class="slider">
      <span>H</span>
      <span class="info" title="H — konstanta vazby (pružnost)&#10;&#10;Plánováno pro fázi 4+ (distance/spring joint místo FixedJoint, damping). Zatím není napojen, slider disabled.">?</span>
      <input type="range" min="0" max="20" step="0.1" bind:value={H} disabled />
      <output>{H.toFixed(1)}</output>
    </label>
    <label class="slider">
      <span>cutoff</span>
      <span class="info" title="cutoff — dosah spatial gridu (násobek ε)&#10;&#10;Při hodnotě 5 a ε=1.5 je cutoff 7.5 U. Pixely vzdálenější než cutoff od souseda se vůbec NEúčastní gravitační interakce s tímto sousedem.&#10;&#10;POZOR: není to aproximace 1/r², je to culling decision. Isolated pixel za cutoff od všech sousedů → force = 0, pixel zamrzne bez ohledu na G.&#10;&#10;Smoothstep tail v posledním 1 U zóně dělá přechod hladký (konzervuje ∑E), ale dosah pořád konečný.">?</span>
      <input type="range" min="3" max="12" step="0.5" bind:value={cutoffFactor} />
      <output>{cutoffFactor.toFixed(1)}·ε</output>
    </label>
    <label class="select">
      <span>mód</span>
      <span class="info" title="Integrační mód&#10;&#10;• without interaction — jen párová gravita, žádný Rapier step. Pixely procházejí jeden druhým. ∑P/∑L na úrovni f64 ulp. Pro pure orbital dynamiku.&#10;&#10;• not align — gravita + Rapier joint solver + auto-jointing při kontaktu. Slepence pruží, kmitají, rotují; po spojení se sjednotí výsledný moment hybnosti. Konzervace ∑P/∑L drží do f32 šumu. Magnet merge Stage 2 (∑P + ∑L preserved).&#10;&#10;• align — composite-driven kinematics (Stage 3 + 3.2): při auto-jointu / magnet mergi rigid-transform menšího řetězce do host frame, anchory ±0.5 U na sdílené hraně, ∑P preserved, ω explicitně driveuje rotaci celé komponenty (θ_new = θ_old + ω·dt v stepCompositesAlign). Angular momentum loss explicit (ω=0 po merge). Vhodné pro chain/cluster scénáře s deterministickou geometrií.">?</span>
      <select bind:value={integration}>
        <option value="without-interaction">without interaction</option>
        <option value="not-align">not align</option>
        <option value="align">align</option>
      </select>
    </label>
    <h2>PRESETS</h2>
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
    <button
      class="id-link"
      onclick={() => lockCameraOn(c.entity)}
      title={`Hodnota: ${fmtSig4(c.value)} — klik = lock kamery`}
    >
      {c.entity.kind === 'composite' ? '◆' : ''}#{c.entity.id}
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
  h2 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #6f8ec1;
    margin: 14px 0 6px;
    border-bottom: 1px solid #1d2230;
    padding-bottom: 3px;
  }
  /* První h2 v panelu — bez horního marginu, sedí těsně k hornímu okraji. */
  .panel > h2:first-child { margin-top: 0; }
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
    grid-template-columns: auto auto 1fr;
    align-items: center;
    column-gap: 6px;
    row-gap: 2px;
    margin-bottom: 10px;
    font-size: 12px;
  }
  .slider > span:first-child { color: #7a8390; text-align: left; }
  .slider input[type="range"] {
    grid-column: 1 / -1;
    width: 100%;
    accent-color: #6f8ec1;
  }
  .slider output {
    grid-column: 3;
    font-variant-numeric: tabular-nums;
    color: #cfd6e0;
    text-align: right;
  }
  .slider input:disabled + output,
  .slider:has(input:disabled) > span:first-child { color: #4a5260; }
  .select {
    display: grid;
    grid-template-columns: auto auto 1fr;
    align-items: center;
    gap: 4px 6px;
    margin: 0 0 10px 0;
    font-size: 12px;
  }
  .select > span:first-child { color: #7a8390; text-align: left; }
  .select select {
    grid-column: 1 / -1;
    width: 100%;
    background: #14181f;
    color: #cfd6e0;
    border: 1px solid #2a3142;
    border-radius: 3px;
    padding: 3px 6px;
    font-size: 12px;
    font-family: inherit;
  }
  /* Info ikona vedle parametru — multi-line tooltip přes title atribut. */
  .info {
    display: inline-block;
    width: 14px;
    height: 14px;
    border: 1px solid #2a3142;
    border-radius: 50%;
    font-size: 9px;
    text-align: center;
    line-height: 12px;
    color: #6f8ec1;
    cursor: help;
    font-weight: bold;
    user-select: none;
    background: #14181f;
  }
  .info:hover { background: #1d2433; border-color: #6f8ec1; }
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
  button.secondary {
    background: #1d2230;
    margin-top: 8px;
  }
  button.secondary:hover { background: #242b3c; }
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

  /* HUD — status kamery v rohu canvasu. */
  .hud {
    position: absolute;
    left: 8px;
    bottom: 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 11px;
    color: #7a8390;
    background: rgba(10, 13, 21, 0.7);
    padding: 4px 8px;
    border-radius: 3px;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
    user-select: none;
  }
  .hud-row {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
  .hud .lock { color: #d8b76f; }
  .hud .free { color: #6f8ec1; }
  .hud .sep { color: #2a3142; }
  .hud .lbl { color: #5b6370; min-width: 40px; }
  .hud .dim { color: #2a3142; }

  /* Centroid systému — křížek překrývající canvas, barva centroidu = jemně modrá.
     Velikost ve screen px (fixed), nezávislá na zoomu. */
  .centroid {
    position: absolute;
    width: 0;
    height: 0;
    pointer-events: none;
    z-index: 5;
  }
  .centroid::before, .centroid::after {
    content: '';
    position: absolute;
    background: #6f8ec1;
    opacity: 0.85;
  }
  .centroid::before {
    /* vodorovná */
    left: -8px;
    top: -0.5px;
    width: 16px;
    height: 1px;
  }
  .centroid::after {
    /* svislá */
    top: -8px;
    left: -0.5px;
    width: 1px;
    height: 16px;
  }

  /* Tooltip nad pixely. Pevná pozice vůči kurzoru, neblokuje pointer. */
  .tooltip {
    position: fixed;
    background: #1d2433;
    border: 1px solid #2a3142;
    border-radius: 3px;
    padding: 6px 10px;
    font-size: 11px;
    line-height: 1.4;
    color: #cfd6e0;
    pointer-events: none;
    z-index: 50;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    min-width: 160px;
  }
  .tooltip .tip-head {
    color: #6f8ec1;
    font-weight: 600;
    margin-bottom: 4px;
    border-bottom: 1px solid #2a3142;
    padding-bottom: 3px;
  }
  .tooltip dl {
    grid-template-columns: auto 1fr;
    gap: 1px 8px;
    font-variant-numeric: tabular-nums;
  }
  .tooltip dt { color: #7a8390; }
  .tooltip dd { text-align: right; }

  /* Patička — plovoucí overlay nad canvasem, centrovaná, bez panelu.
     Stejný styl jako HUD: žádné pozadí, neblokuje pointer, drobné letter-spacing. */
  .footer-overlay {
    position: absolute;
    bottom: 6px;
    left: 50%;
    transform: translateX(-50%);
    text-align: center;
    font-size: 10px;
    line-height: 1.5;
    color: #5b6370;
    pointer-events: none;
    user-select: none;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }
  /* AppName výrazněji než copyright řádek — větší, světlejší, tučný. */
  .footer-overlay div:first-child {
    color: #cfd6e0;
    font-size: 12px;
    font-weight: 600;
  }

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
    bottom: 36px;
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
