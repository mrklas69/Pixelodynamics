// WebGL2 renderer pro instancované rotující čtverce.
//
// Strategy: jeden quad jako base geometry (4 vertices, triangle strip).
// Per-instance attribute: vec4 (x, y, rotation, halfSize).
// Vertex shader skládá lokální vrchol z base quadu, rotuje, posune a aplikuje view matici.

import type { mat3 } from 'gl-matrix';

// Vertex shader pásuje `v_local` (místní quad souřadnice -0.5..0.5) do fragu
// a per-instance ID porovná s aktuálně lockovaným ID (uniform) → flag pro highlight.
const VERT_SRC = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_local;          // base quad: -0.5..0.5
layout(location = 1) in vec4 a_instance;       // (x, y, rotation, halfSize)
layout(location = 2) in float a_id;            // pixel.id

uniform mat3 u_proj;
uniform float u_lockedId;                      // -1 = žádný lock

out vec2 v_local;
out float v_locked;                            // 1.0 = tento instance je lock target

void main() {
  float c = cos(a_instance.z);
  float s = sin(a_instance.z);
  vec2 scaled = a_local * (a_instance.w * 2.0);  // -halfSize..+halfSize
  vec2 rotated = vec2(c * scaled.x - s * scaled.y, s * scaled.x + c * scaled.y);
  vec2 world = rotated + a_instance.xy;
  vec3 clip = u_proj * vec3(world, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  v_local = a_local;
  // ID < 2^24 je v float32 reprezentováno přesně, takže porovnání je spolehlivé.
  v_locked = (abs(a_id - u_lockedId) < 0.5) ? 1.0 : 0.0;
}
`;

// Fragment vyplní jen pruh u kraje (vnitřek discard). Lockovaný pixel dostane
// amber barvu shodující se s ikonou 🔒 v HUD (#d8b76f). Default = chladná modrobílá.
const FRAG_SRC = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_local;
in float v_locked;
uniform float u_borderHalfWidth;
out vec4 outColor;

void main() {
  vec2 d = vec2(0.5) - abs(v_local);
  float minDist = min(d.x, d.y);
  if (minDist > u_borderHalfWidth) discard;

  vec3 base = vec3(0.85, 0.92, 1.0);
  vec3 lockCol = vec3(0.847, 0.718, 0.435);    // #d8b76f
  vec3 col = mix(base, lockCol, v_locked);
  outColor = vec4(col, 1.0);
}
`;

export class Renderer {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  instanceBuffer: WebGLBuffer;
  uProj: WebGLUniformLocation;
  uBorder: WebGLUniformLocation;
  uLockedId: WebGLUniformLocation;
  idBuffer: WebGLBuffer;
  capacity = 0;
  // CPU-side scratch buffery pro instance data — alokujeme jednou, pak jen přepisujeme.
  instanceData: Float32Array = new Float32Array(0); // per instance vec4 (x, y, rot, halfSize)
  idData: Float32Array = new Float32Array(0); // per instance float (pixel.id)

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('WebGL2 není dostupné');
    this.gl = gl;

    this.program = compileProgram(gl, VERT_SRC, FRAG_SRC);
    const uProj = gl.getUniformLocation(this.program, 'u_proj');
    if (!uProj) throw new Error('Nelze najít u_proj uniform');
    this.uProj = uProj;
    const uBorder = gl.getUniformLocation(this.program, 'u_borderHalfWidth');
    if (!uBorder) throw new Error('Nelze najít u_borderHalfWidth uniform');
    this.uBorder = uBorder;
    const uLockedId = gl.getUniformLocation(this.program, 'u_lockedId');
    if (!uLockedId) throw new Error('Nelze najít u_lockedId uniform');
    this.uLockedId = uLockedId;

    // Base quad: 4 vrcholy v rozsahu -0.5..0.5, triangle strip.
    const quad = new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]);
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Nelze vytvořit VAO');
    this.vao = vao;
    gl.bindVertexArray(vao);

    // Vertex buffer (base quad).
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Instance buffer (alokujeme prázdný, naplníme v upload()).
    const ibo = gl.createBuffer();
    if (!ibo) throw new Error('Nelze vytvořit instance buffer');
    this.instanceBuffer = ibo;
    gl.bindBuffer(gl.ARRAY_BUFFER, ibo);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);

    // ID buffer — samostatný kvůli per-instance-divisoru a stride 1 floatu.
    const idbo = gl.createBuffer();
    if (!idbo) throw new Error('Nelze vytvořit id buffer');
    this.idBuffer = idbo;
    gl.bindBuffer(gl.ARRAY_BUFFER, idbo);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(null);
    gl.clearColor(0.05, 0.06, 0.09, 1.0);
  }

  /** Zajistí, že instance buffer má kapacitu pro n instancí. */
  reserve(n: number): void {
    if (n <= this.capacity) return;
    // Růst po dvojnásobcích, aby se nealokovalo na každém spawnu.
    let cap = Math.max(this.capacity * 2, 64);
    while (cap < n) cap *= 2;
    this.capacity = cap;
    this.instanceData = new Float32Array(cap * 4);
    this.idData = new Float32Array(cap);
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.idBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.idData.byteLength, gl.DYNAMIC_DRAW);
  }

  resize(w: number, h: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.gl.canvas.width = Math.round(w * dpr);
    this.gl.canvas.height = Math.round(h * dpr);
    this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);
  }

  /**
   * `borderHalfWidth` je v lokálních quad-coordinates (-0.5..0.5). Pro 1U pixel
   * to znamená přímo šířku v U; volající typicky předává max(0.05, 1/cam.zoom)
   * pro hybrid „minimálně 1 px obrazovky, ale ne tlustší než 5 % strany".
   *
   * `lockedId` = id pixelu, který se má zvýraznit barvou (sladěno s ikonou 🔒 v HUD).
   * Předej `-1` pokud žádný lock.
   */
  render(count: number, proj: mat3, borderHalfWidth: number, lockedId: number): void {
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (count === 0) return;

    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uProj, false, proj);
    gl.uniform1f(this.uBorder, borderHalfWidth);
    gl.uniform1f(this.uLockedId, lockedId);

    // Upload instance data (jen ten prefix, který se reálně používá).
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, count * 4));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.idBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.idData.subarray(0, count));

    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.bindVertexArray(null);
  }
}

function compileProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vs);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fs);
  const prog = gl.createProgram();
  if (!prog) throw new Error('Nelze vytvořit program');
  gl.attachShader(prog, vert);
  gl.attachShader(prog, frag);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('Link selhal: ' + gl.getProgramInfoLog(prog));
  }
  return prog;
}

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('Nelze vytvořit shader');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('Kompilace selhala: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}
