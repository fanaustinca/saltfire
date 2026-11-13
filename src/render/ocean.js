// Dynamic ocean: camera-following Gerstner-displaced grid, analytic normals, procedural ripple
// detail, Fresnel sky reflection (cube map of the sky), subsurface tint, crest + shore foam, sun glint.
import * as THREE from 'three';
import { WAVES_N, G, SEA, CALM_MIN, CALM_W } from '../waves.js';

const MAXW = WAVES_N.length;

const vert = /* glsl */`
uniform float uTime;
uniform float uSea;
uniform vec4 uWaves[${MAXW}];
uniform vec3 uCalm[32];
uniform int uCalmCount;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vCrest;
varying float vDist;
#include <fog_pars_vertex>
void main() {
  vec4 wp0 = modelMatrix * vec4(position, 1.0);
  vec3 p = wp0.xyz;
  vec3 d = vec3(0.0);
  vec3 tx = vec3(1.0, 0.0, 0.0), bz = vec3(0.0, 0.0, 1.0);
  float crest = 0.0;
  // fade waves out with distance so the horizon doesn't alias
  float camD = length(p.xz - cameraPosition.xz);
  float fade = 1.0 - smoothstep(900.0, 2400.0, camD);
  // calm water in the lee of islands (matches waves.js calmAt)
  float cf0 = 1.0;
  for (int i = 0; i < 32; i++) {
    if (i >= uCalmCount) break;
    vec3 c = uCalm[i];
    float r0 = c.z * 0.9;
    cf0 = min(cf0, smoothstep(r0, r0 + ${CALM_W.toFixed(1)}, length(p.xz - c.xy)));
  }
  float calm = ${CALM_MIN.toFixed(3)} + ${(1 - CALM_MIN).toFixed(3)} * cf0;
  for (int i = 0; i < ${MAXW}; i++) {
    vec4 w = uWaves[i];
    float k = 6.2831853 / w.z;
    float c = sqrt(${G.toFixed(2)} / k);
    float st = w.w * uSea * calm * (w.z < 50.0 ? fade * 0.6 + 0.4 : fade);
    float a = st / k;
    float f = k * (dot(w.xy, p.xz) - c * uTime) + float(i) * 2.39996;
    float cf = cos(f), sf = sin(f);
    d.x += w.x * a * cf; d.z += w.y * a * cf; d.y += a * sf;
    tx += vec3(-w.x * w.x * st * sf, w.x * st * cf, -w.x * w.y * st * sf);
    bz += vec3(-w.x * w.y * st * sf, w.y * st * cf, -w.y * w.y * st * sf);
    crest += st * sf;
  }
  p += d;
  vNormalW = normalize(cross(bz, tx));
  vCrest = crest;
  vWorld = p;
  vDist = camD;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vec4 mvPosition = mv;
  #include <fog_vertex>
}`;

const frag = /* glsl */`
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSkyTint;
uniform samplerCube uEnv;
uniform float uHasEnv;
uniform float uDim;
uniform vec4 uIslands[32];
uniform int uIslandCount;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vCrest;
varying float vDist;
#include <fog_pars_fragment>

float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
// ripple normal: analytic sum of short directional sines on a domain-warped plane (so they never tile into a
// visible lattice), with jittered directions and a slowly drifting wind-gust mask ("cat's paws") on top
vec2 ripple(vec2 p, float t) {
  vec2 q = mod(p, 4096.0);
  vec2 warp = vec2(noise(q * 0.013 + 3.1), noise(q * 0.013 + 17.7)) - 0.5;
  p += warp * 34.0;
  vec2 g = vec2(0.0);
  float a = 1.0;
  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    float ang = 0.32 + sin(fi * 2.13 + 0.7) * 1.25 + fi * 0.21;  // spread around the wind, irregularly
    vec2 d = vec2(cos(ang), sin(ang));
    float k = 0.5 * pow(1.33, fi) * (1.0 + 0.11 * sin(fi * 5.7));
    float w = sqrt(9.81 * k);
    float ph = dot(d, p) * k - w * t + fi * 1.7;
    g += d * cos(ph) * a * k;
    a *= 0.66;
  }
  float gust = noise(q * 0.0045 + vec2(t * 0.021, -t * 0.013)) * 0.7 + noise(q * 0.017 - t * 0.04) * 0.3;
  return g * 0.18 * (0.45 + 1.1 * gust);
}
void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  float detail = 1.0 - smoothstep(60.0, 700.0, vDist);
  vec2 r = ripple(vWorld.xz, uTime) * (0.1 + 0.5 * detail);
  vec3 N = normalize(vNormalW + vec3(-r.x, 0.0, -r.y));
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 sky = uHasEnv > 0.5 ? textureCube(uEnv, R).rgb : mix(uSkyTint, vec3(0.75, 0.86, 1.0), R.y);
  // subsurface: thinner, greener water on wave faces lit from behind
  float sss = pow(max(dot(V, -uSunDir), 0.0), 3.0) * max(vCrest + 0.2, 0.0) * 0.9;
  float facing = max(dot(N, uSunDir), 0.0);
  vec3 water = mix(uDeep, uShallow, clamp(0.25 + vCrest * 0.9 + sss, 0.0, 1.0)) * (0.55 + 0.45 * facing);
  // shore shallows near islands
  float shore = 0.0;
  for (int i = 0; i < 32; i++) {
    if (i >= uIslandCount) break;
    vec4 is = uIslands[i];
    float dd = length(vWorld.xz - is.xy) - is.z;
    shore = max(shore, 1.0 - smoothstep(0.0, is.w, dd));
  }
  // broad, slow variation in tint (wind streaks, deeper troughs) so the open sea isn't one flat colour
  { vec2 q2 = mod(vWorld.xz, 4096.0); float v = noise(q2 * 0.0021 + uTime * 0.004) - 0.5; water *= 1.0 + v * 0.22; }
  water = mix(water, vec3(0.16, 0.72, 0.68) * uDim, shore * 0.75);
  vec3 col = mix(water, sky, fres * 0.9);
  // sun glint
  vec3 H = normalize(uSunDir + V);
  float spec = pow(max(dot(N, H), 0.0), 380.0) * 6.0 + pow(max(dot(N, H), 0.0), 40.0) * 0.12;
  col += uSunColor * spec;
  // foam: wave crests + shore surf, broken up by noise
  vec2 wp = mod(vWorld.xz, 2048.0);
  float fn = noise(wp * 0.21 + uTime * 0.15) * 0.65 + noise(wp * 0.83 - uTime * 0.1) * 0.35;
  float crestFoam = smoothstep(0.42, 0.75, vCrest * 0.8 + fn * 0.45) * smoothstep(0.35, 0.7, fn) * detail;
  float surf = smoothstep(0.55, 1.0, shore) * smoothstep(0.35, 0.65, fn + 0.25 * sin(uTime * 1.3 + shore * 9.0));
  float foam = clamp(crestFoam + surf, 0.0, 1.0);
  col = mix(col, vec3(0.93, 0.97, 1.0) * (0.75 + 0.25 * facing) * uDim, foam * 0.85);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export class Ocean {
  constructor(scene) {
    const waves = WAVES_N.map((w) => new THREE.Vector4(w[0], w[1], w[2], w[3]));
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uSea: { value: SEA },
      uWaves: { value: waves },
      uSunDir: { value: new THREE.Vector3(0.4, 0.6, 0.3).normalize() },
      uSunColor: { value: new THREE.Color(1.0, 0.92, 0.75) },
      uDeep: { value: new THREE.Color(0x0a4a6e) },
      uShallow: { value: new THREE.Color(0x1aa7a8) },
      uSkyTint: { value: new THREE.Color(0x6aa8d8) },
      uEnv: { value: null }, uHasEnv: { value: 0 }, uDim: { value: 1 },
      uIslands: { value: Array.from({ length: 32 }, () => new THREE.Vector4()) },
      uIslandCount: { value: 0 },
      uCalm: { value: Array.from({ length: 32 }, () => new THREE.Vector3()) },
      uCalmCount: { value: 0 },
    }]);
    this.uniforms.uWaves.value = waves;
    this.mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms, fog: true });
    // dense centre patch + coarser rings: a single plane with quadratic vertex spacing
    const geo = radialGrid(260, 2600, 2.4);
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    scene.add(this.mesh);
  }
  setEnv(cube) { this.uniforms.uEnv.value = cube; this.uniforms.uHasEnv.value = cube ? 1 : 0; }
  /** Shallows + calm water for the islands nearest the camera (call a few times a second). */
  setIslands(list, focus) {
    const near = focus ? list.map((l) => ({ l, d: Math.hypot(l.x - focus.x, l.z - focus.z) - l.r })).sort((a, b) => a.d - b.d).slice(0, 32).map((x) => x.l) : list.slice(0, 32);
    const arr = this.uniforms.uIslands.value, calm = this.uniforms.uCalm.value;
    for (let i = 0; i < near.length; i++) { arr[i].set(near[i].x, near[i].z, near[i].r, near[i].shallow || 40); calm[i].set(near[i].x, near[i].z, near[i].calmR ?? near[i].r); }
    this.uniforms.uIslandCount.value = near.length;
    this.uniforms.uCalmCount.value = near.filter((l) => l.calmR !== 0).length === near.length ? near.length : near.length;
  }
  update(t, focus) {
    this.uniforms.uTime.value = t;
    this.uniforms.uSea.value = SEA;
    // snap the grid to the camera (to a multiple of the largest wave cell to avoid swimming)
    const s = 8;
    this.mesh.position.set(Math.round(focus.x / s) * s, 0, Math.round(focus.z / s) * s);
  }
}

/** Polar-ish grid: square rings whose spacing grows outward. */
function radialGrid(rings, radius, power) {
  const seg = 256; // samples per ring
  const pos = [], idx = [];
  pos.push(0, 0, 0);
  for (let r = 1; r <= rings; r++) {
    const rr = Math.pow(r / rings, power) * radius;
    for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; pos.push(Math.cos(a) * rr, 0, Math.sin(a) * rr); }
  }
  for (let i = 0; i < seg; i++) idx.push(0, 1 + ((i + 1) % seg), 1 + i);
  for (let r = 1; r < rings; r++) {
    const a0 = 1 + (r - 1) * seg, b0 = 1 + r * seg;
    for (let i = 0; i < seg; i++) {
      const i1 = (i + 1) % seg;
      idx.push(a0 + i, a0 + i1, b0 + i, a0 + i1, b0 + i1, b0 + i);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}
