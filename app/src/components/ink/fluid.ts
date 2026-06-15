// 墨流し — WebGL2 stable-fluids 流體模擬(自寫、零依賴)。
// 速度場 + 染料場:點擊滴墨(徑向推力暈開)、拖曳推墨(方向推力)、渦度補強產生漩渦。
// 染料存的是吸光度(Beer–Lambert),display 以 paper * exp(-A) 合成 →
// 墨像染進紙裡的減色混合,而非疊加發光。和紙纖維/顆粒/暗角在 display shader 程序生成。
//
// 需求:WebGL2 + EXT_color_buffer_float。不支援時 createFluid 回傳 null,由上層降級為靜態墨漬。

import type { InkVec3 } from "./ink-colors";

// ── 手感旋鈕(調墨請改這裡)──────────────────────────────
const SIM_RES = 160; //   速度場解析度(短邊)
const DYE_RES = 720; //   染料場解析度(短邊)
const PRESSURE_ITERATIONS = 22;
const CURL_STRENGTH = 14; // 渦度補強:漩渦細節
const VEL_DECAY = 0.5; //  速度衰減 /s(水的黏滯)
const DYE_DECAY = 0.012; // 墨自然淡化 /s(極慢,似氧化)
const WASH_DECAY = 1.9; //  洗い流す時的額外淡化 /s
const DROP_RADIUS = 0.0008; // 滴墨半徑²(uv,aspect 校正後)
const DROP_PUSH = 80; //    滴墨的徑向推力(短暫,讓墨慢慢暈開)
const DRAG_FORCE = 5200; // 拖曳推墨力(跟手程度)
const TRAIL_RADIUS = 0.00022; // 拖曳細墨線半徑²
const TRAIL_DYE = 0.16; //  拖曳帶墨濃度(相對滴墨)
const RULE_SPACING_PX = 46; // 帳簿空白行格線間距(css px,同 P-3 列高)
const RULE_MARGIN_PX = 76; //  左緣直線位置(css px,BodyVRule 語彙)

const VERT = `#version 300 es
precision highp float;
in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG_ADVECT = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform float uDt;
uniform float uDissipation;
void main() {
  vec2 coord = vUv - uDt * texture(uVelocity, vUv).xy * uTexel;
  o = texture(uSource, coord) * uDissipation;
}`;

// 加墨 / 加速度(uColor.xy 當 velocity delta 用)
const FRAG_SPLAT = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uTarget;
uniform float uAspect;
uniform vec2 uPoint;
uniform vec3 uColor;
uniform float uRadius;
void main() {
  vec2 p = vUv - uPoint; p.x *= uAspect;
  float a = exp(-dot(p, p) / uRadius);
  o = vec4(texture(uTarget, vUv).xyz + uColor * a, 1.0);
}`;

// 滴墨的徑向推力:以滴點為心向外
const FRAG_RADIAL = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uTarget;
uniform float uAspect;
uniform vec2 uPoint;
uniform float uRadius;
uniform float uStrength;
void main() {
  vec2 p = vUv - uPoint; p.x *= uAspect;
  float d = length(p) + 1e-5;
  vec2 base = texture(uTarget, vUv).xy;
  o = vec4(base + (p / d) * exp(-d * d / uRadius) * uStrength, 0.0, 1.0);
}`;

const FRAG_CURL = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
void main() {
  float L = texture(uVelocity, vUv - vec2(uTexel.x, 0.0)).y;
  float R = texture(uVelocity, vUv + vec2(uTexel.x, 0.0)).y;
  float B = texture(uVelocity, vUv - vec2(0.0, uTexel.y)).x;
  float T = texture(uVelocity, vUv + vec2(0.0, uTexel.y)).x;
  o = vec4(0.5 * ((R - L) - (T - B)), 0.0, 0.0, 1.0);
}`;

const FRAG_VORTICITY = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform vec2 uTexel;
uniform float uCurlStrength;
uniform float uDt;
void main() {
  float L = texture(uCurl, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture(uCurl, vUv + vec2(uTexel.x, 0.0)).x;
  float B = texture(uCurl, vUv - vec2(0.0, uTexel.y)).x;
  float T = texture(uCurl, vUv + vec2(0.0, uTexel.y)).x;
  float C = texture(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 1e-4;
  force *= uCurlStrength * C;
  force.y *= -1.0;
  o = vec4(texture(uVelocity, vUv).xy + force * uDt, 0.0, 1.0);
}`;

const FRAG_DIVERGENCE = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
void main() {
  float L = texture(uVelocity, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture(uVelocity, vUv + vec2(uTexel.x, 0.0)).x;
  float B = texture(uVelocity, vUv - vec2(0.0, uTexel.y)).y;
  float T = texture(uVelocity, vUv + vec2(0.0, uTexel.y)).y;
  o = vec4(0.5 * ((R - L) + (T - B)), 0.0, 0.0, 1.0);
}`;

// 沿用上一幀壓力(乘 0.8)當 jacobi 初值,收斂更快
const FRAG_COPY = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uTarget;
uniform float uScale;
void main() { o = texture(uTarget, vUv) * uScale; }`;

const FRAG_PRESSURE = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform vec2 uTexel;
void main() {
  float L = texture(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
  float B = texture(uPressure, vUv - vec2(0.0, uTexel.y)).x;
  float T = texture(uPressure, vUv + vec2(0.0, uTexel.y)).x;
  float div = texture(uDivergence, vUv).x;
  o = vec4((L + R + B + T - div) * 0.25, 0.0, 0.0, 1.0);
}`;

const FRAG_GRADIENT = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
void main() {
  float L = texture(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
  float B = texture(uPressure, vUv - vec2(0.0, uTexel.y)).x;
  float T = texture(uPressure, vUv + vec2(0.0, uTexel.y)).x;
  o = vec4(texture(uVelocity, vUv).xy - 0.5 * vec2(R - L, T - B), 0.0, 1.0);
}`;

// 和紙 + 墨:纖維(橫直兩向拉伸噪聲)、紙斑、顆粒、暗角、帳簿格線;
// 墨以吸光度合成並做染入纖維的不均
const FRAG_DISPLAY = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uDye;
uniform float uAspect;
uniform float uLineSpacing; // 空白行格線間距(裝置px)
uniform float uMarginX;     // 左緣直線(裝置px)
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  vec2 suv = vec2(vUv.x * uAspect, vUv.y); // 紙紋不隨視窗比例拉伸
  vec3 paper = vec3(0.984, 0.971, 0.941);  // 淡米色和紙(較 paper token 再偏米)
  float fib = noise(vec2(suv.x * 420.0, suv.y * 26.0)) * 0.6
            + noise(vec2(suv.x * 30.0, suv.y * 460.0)) * 0.4;
  paper *= 1.0 - (fib - 0.5) * 0.05;
  float fleck = smoothstep(0.93, 1.0, noise(suv * 180.0 + 7.0));
  paper *= 1.0 - fleck * 0.05;
  paper *= 1.0 - (hash(gl_FragCoord.xy) - 0.5) * 0.045;
  float vig = smoothstep(0.5, 1.0, distance(vUv, vec2(0.5)) * 1.18);
  paper *= 1.0 - vig * 0.085;
  // 帳簿格線:極淡空白行橫線 + 左緣直線(這張紙本身就是一頁帳)
  float row = fract(gl_FragCoord.y / uLineSpacing);
  float rowDist = min(row, 1.0 - row) * uLineSpacing;
  paper *= 1.0 - (1.0 - smoothstep(0.4, 1.2, rowDist)) * 0.05;
  paper *= 1.0 - (1.0 - smoothstep(0.4, 1.2, abs(gl_FragCoord.x - uMarginX))) * 0.06;
  vec3 A = texture(uDye, vUv).rgb;
  A *= 1.0 + (noise(suv * 240.0) - 0.5) * 0.35; // 墨染入纖維的濃淡不均
  o = vec4(paper * exp(-A), 1.0);
}`;

type Program = { prog: WebGLProgram; u: Record<string, WebGLUniformLocation> };
type FBO = { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number; texel: [number, number] };
type DoubleFBO = { read: FBO; write: FBO; swap(): void; texel: [number, number] };

export type FluidHandle = {
  /** 滴一滴墨(x,y ∈ [0,1],y 向上)。scale 縮放半徑與濃度 */
  drop(x: number, y: number, color: InkVec3, scale?: number): void;
  /** 拖曳推墨:dx,dy 為 uv 位移;color 給 null 則只推不帶墨 */
  move(x: number, y: number, dx: number, dy: number, color: InkVec3 | null): void;
  /** 環境水流(自動演出用):微弱方向推力,不帶墨 */
  flow(x: number, y: number, dx: number, dy: number, strength: number): void;
  /** 洗い流す:2–3 秒內墨漸淡 */
  wash(): void;
  /** 每幀呼叫(RAF timestamp) */
  step(now: number): void;
  /** 視窗尺寸變更(會重建貼圖,畫面上的墨會清掉) */
  resize(): void;
  destroy(): void;
};

export function createFluid(canvas: HTMLCanvasElement): FluidHandle | null {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    depth: false,
    stencil: false,
    antialias: false,
    preserveDrawingBuffer: false,
  });
  if (!gl) return null;
  // 失敗時主動釋放這個 context,別讓它佔著瀏覽器的 WebGL context 名額(soft-nav 連續建多個會撞上限)。
  const bail = () => {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return null;
  };
  // R16F/RG16F/RGBA16F 的 render-to-texture 需要這個擴展(WebGL2 裝置幾乎都有)。
  // 注意:context 暫時遺失(isContextLost)時這裡也會抓不到 → 交由呼叫端重試,不是真的不支援。
  if (!gl.getExtension("EXT_color_buffer_float")) return bail();

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  if (!vs) return bail();
  const progs = {
    advect: link(gl, vs, FRAG_ADVECT),
    splat: link(gl, vs, FRAG_SPLAT),
    radial: link(gl, vs, FRAG_RADIAL),
    curl: link(gl, vs, FRAG_CURL),
    vorticity: link(gl, vs, FRAG_VORTICITY),
    divergence: link(gl, vs, FRAG_DIVERGENCE),
    copy: link(gl, vs, FRAG_COPY),
    pressure: link(gl, vs, FRAG_PRESSURE),
    gradient: link(gl, vs, FRAG_GRADIENT),
    display: link(gl, vs, FRAG_DISPLAY),
  };
  if (Object.values(progs).some((p) => !p)) return bail();
  const P = progs as Record<keyof typeof progs, Program>;

  // 全螢幕 quad
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);

  let velocity: DoubleFBO, dye: DoubleFBO, pressure: DoubleFBO, divergence: FBO, curl: FBO;
  let aspect = 1;
  let lastTime = 0;
  let washStart = -1;
  let destroyed = false;

  function texDims(base: number): [number, number] {
    // 短邊 = base,長邊依比例、上限 2×(超寬螢幕成本控制)
    if (aspect >= 1) return [Math.min(Math.round(base * aspect), base * 2), base];
    return [base, Math.min(Math.round(base / aspect), base * 2)];
  }

  function createFBO(w: number, h: number, internal: number, format: number, filter: number): FBO {
    const tex = gl!.createTexture()!;
    gl!.bindTexture(gl!.TEXTURE_2D, tex);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, filter);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, filter);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, internal, w, h, 0, format, gl!.HALF_FLOAT, null);
    const fbo = gl!.createFramebuffer()!;
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbo);
    gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, tex, 0);
    gl!.clearColor(0, 0, 0, 1);
    gl!.clear(gl!.COLOR_BUFFER_BIT);
    return { tex, fbo, w, h, texel: [1 / w, 1 / h] };
  }

  function createDouble(w: number, h: number, internal: number, format: number, filter: number): DoubleFBO {
    let a = createFBO(w, h, internal, format, filter);
    let b = createFBO(w, h, internal, format, filter);
    return {
      get read() { return a; },
      get write() { return b; },
      swap() { const t = a; a = b; b = t; },
      texel: [1 / w, 1 / h],
    };
  }

  function destroyFBO(f: FBO) { gl!.deleteTexture(f.tex); gl!.deleteFramebuffer(f.fbo); }
  function destroyDouble(d: DoubleFBO) { destroyFBO(d.read); destroyFBO(d.write); }

  function allocate() {
    aspect = canvas.width / Math.max(canvas.height, 1);
    const [sw, sh] = texDims(SIM_RES);
    const [dw, dh] = texDims(DYE_RES);
    velocity = createDouble(sw, sh, gl!.RG16F, gl!.RG, gl!.LINEAR);
    pressure = createDouble(sw, sh, gl!.R16F, gl!.RED, gl!.NEAREST);
    divergence = createFBO(sw, sh, gl!.R16F, gl!.RED, gl!.NEAREST);
    curl = createFBO(sw, sh, gl!.R16F, gl!.RED, gl!.NEAREST);
    dye = createDouble(dw, dh, gl!.RGBA16F, gl!.RGBA, gl!.LINEAR);
  }
  allocate();

  function bindTex(unit: number, tex: WebGLTexture): number {
    gl!.activeTexture(gl!.TEXTURE0 + unit);
    gl!.bindTexture(gl!.TEXTURE_2D, tex);
    return unit;
  }

  function blit(target: FBO | null) {
    if (target) {
      gl!.viewport(0, 0, target.w, target.h);
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, target.fbo);
    } else {
      gl!.viewport(0, 0, canvas.width, canvas.height);
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    }
    gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
  }

  function splatDye(x: number, y: number, color: InkVec3, radius: number) {
    const p = P.splat;
    gl!.useProgram(p.prog);
    gl!.uniform1i(p.u.uTarget, bindTex(0, dye.read.tex));
    gl!.uniform1f(p.u.uAspect, aspect);
    gl!.uniform2f(p.u.uPoint, x, y);
    gl!.uniform3f(p.u.uColor, color[0], color[1], color[2]);
    gl!.uniform1f(p.u.uRadius, radius);
    blit(dye.write);
    dye.swap();
  }

  function splatVelocity(x: number, y: number, vx: number, vy: number, radius: number) {
    const p = P.splat;
    gl!.useProgram(p.prog);
    gl!.uniform1i(p.u.uTarget, bindTex(0, velocity.read.tex));
    gl!.uniform1f(p.u.uAspect, aspect);
    gl!.uniform2f(p.u.uPoint, x, y);
    gl!.uniform3f(p.u.uColor, vx, vy, 0);
    gl!.uniform1f(p.u.uRadius, radius);
    blit(velocity.write);
    velocity.swap();
  }

  function splatRadial(x: number, y: number, radius: number, strength: number) {
    const p = P.radial;
    gl!.useProgram(p.prog);
    gl!.uniform1i(p.u.uTarget, bindTex(0, velocity.read.tex));
    gl!.uniform1f(p.u.uAspect, aspect);
    gl!.uniform2f(p.u.uPoint, x, y);
    gl!.uniform1f(p.u.uRadius, radius);
    gl!.uniform1f(p.u.uStrength, strength);
    blit(velocity.write);
    velocity.swap();
  }

  return {
    drop(x, y, color, scale = 1) {
      if (destroyed) return;
      const r = DROP_RADIUS * scale * scale;
      splatDye(x, y, [color[0] * 0.9, color[1] * 0.9, color[2] * 0.9], r);
      splatRadial(x, y, r * 4.5, DROP_PUSH * scale);
    },
    move(x, y, dx, dy, color) {
      if (destroyed) return;
      splatVelocity(x, y, dx * DRAG_FORCE, dy * DRAG_FORCE, TRAIL_RADIUS * 2.2);
      if (color)
        splatDye(x, y, [color[0] * TRAIL_DYE, color[1] * TRAIL_DYE, color[2] * TRAIL_DYE], TRAIL_RADIUS);
    },
    flow(x, y, dx, dy, strength) {
      if (destroyed) return;
      splatVelocity(x, y, dx * strength, dy * strength, 0.004);
    },
    wash() {
      if (!destroyed) washStart = performance.now();
    },
    step(now) {
      if (destroyed) return;
      if (!lastTime) lastTime = now;
      const dt = Math.min((now - lastTime) / 1000, 1 / 30);
      lastTime = now;
      if (dt <= 0) return;

      // 洗い流す包絡:0.35s 漸入 → 持平 1.55s → 0.8s 漸出
      let washLevel = 0;
      if (washStart >= 0) {
        const t = (now - washStart) / 1000;
        if (t < 0.35) washLevel = t / 0.35;
        else if (t < 1.9) washLevel = 1;
        else if (t < 2.7) washLevel = 1 - (t - 1.9) / 0.8;
        else washStart = -1;
      }
      const dyeDiss = Math.exp(-dt * (DYE_DECAY + washLevel * WASH_DECAY));
      const velDiss = Math.exp(-dt * VEL_DECAY);
      const simTexel = velocity.texel;

      // 速度自平流
      gl.useProgram(P.advect.prog);
      gl.uniform1i(P.advect.u.uVelocity, bindTex(0, velocity.read.tex));
      gl.uniform1i(P.advect.u.uSource, 0);
      gl.uniform2f(P.advect.u.uTexel, simTexel[0], simTexel[1]);
      gl.uniform1f(P.advect.u.uDt, dt);
      gl.uniform1f(P.advect.u.uDissipation, velDiss);
      blit(velocity.write);
      velocity.swap();

      // 渦度補強
      gl.useProgram(P.curl.prog);
      gl.uniform1i(P.curl.u.uVelocity, bindTex(0, velocity.read.tex));
      gl.uniform2f(P.curl.u.uTexel, simTexel[0], simTexel[1]);
      blit(curl);
      gl.useProgram(P.vorticity.prog);
      gl.uniform1i(P.vorticity.u.uVelocity, bindTex(0, velocity.read.tex));
      gl.uniform1i(P.vorticity.u.uCurl, bindTex(1, curl.tex));
      gl.uniform2f(P.vorticity.u.uTexel, simTexel[0], simTexel[1]);
      gl.uniform1f(P.vorticity.u.uCurlStrength, CURL_STRENGTH);
      gl.uniform1f(P.vorticity.u.uDt, dt);
      blit(velocity.write);
      velocity.swap();

      // 投影(不可壓縮)
      gl.useProgram(P.divergence.prog);
      gl.uniform1i(P.divergence.u.uVelocity, bindTex(0, velocity.read.tex));
      gl.uniform2f(P.divergence.u.uTexel, simTexel[0], simTexel[1]);
      blit(divergence);

      gl.useProgram(P.copy.prog);
      gl.uniform1i(P.copy.u.uTarget, bindTex(0, pressure.read.tex));
      gl.uniform1f(P.copy.u.uScale, 0.8);
      blit(pressure.write);
      pressure.swap();

      gl.useProgram(P.pressure.prog);
      gl.uniform2f(P.pressure.u.uTexel, simTexel[0], simTexel[1]);
      gl.uniform1i(P.pressure.u.uDivergence, bindTex(1, divergence.tex));
      for (let i = 0; i < PRESSURE_ITERATIONS; i++) {
        gl.uniform1i(P.pressure.u.uPressure, bindTex(0, pressure.read.tex));
        blit(pressure.write);
        pressure.swap();
      }

      gl.useProgram(P.gradient.prog);
      gl.uniform1i(P.gradient.u.uPressure, bindTex(0, pressure.read.tex));
      gl.uniform1i(P.gradient.u.uVelocity, bindTex(1, velocity.read.tex));
      gl.uniform2f(P.gradient.u.uTexel, simTexel[0], simTexel[1]);
      blit(velocity.write);
      velocity.swap();

      // 墨平流
      gl.useProgram(P.advect.prog);
      gl.uniform1i(P.advect.u.uVelocity, bindTex(0, velocity.read.tex));
      gl.uniform1i(P.advect.u.uSource, bindTex(1, dye.read.tex));
      gl.uniform2f(P.advect.u.uTexel, simTexel[0], simTexel[1]);
      gl.uniform1f(P.advect.u.uDt, dt);
      gl.uniform1f(P.advect.u.uDissipation, dyeDiss);
      blit(dye.write);
      dye.swap();

      // 合成到畫面
      const pxScale = canvas.width / Math.max(canvas.clientWidth, 1); // css px → 裝置 px
      gl.useProgram(P.display.prog);
      gl.uniform1i(P.display.u.uDye, bindTex(0, dye.read.tex));
      gl.uniform1f(P.display.u.uAspect, aspect);
      gl.uniform1f(P.display.u.uLineSpacing, RULE_SPACING_PX * pxScale);
      gl.uniform1f(P.display.u.uMarginX, RULE_MARGIN_PX * pxScale);
      blit(null);
    },
    resize() {
      if (destroyed) return;
      destroyDouble(velocity);
      destroyDouble(pressure);
      destroyDouble(dye);
      destroyFBO(divergence);
      destroyFBO(curl);
      allocate();
    },
    destroy() {
      destroyed = true;
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error("[fluid] shader compile:", gl.getShaderInfoLog(sh));
    return null;
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, vs: WebGLShader, fragSrc: string): Program | null {
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
  if (!fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.bindAttribLocation(prog, 0, "aPos");
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error("[fluid] program link:", gl.getProgramInfoLog(prog));
    return null;
  }
  const u: Record<string, WebGLUniformLocation> = {};
  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(prog, i);
    if (info) u[info.name] = gl.getUniformLocation(prog, info.name)!;
  }
  return { prog, u };
}
