// Renderer, sky, sun, environment reflections, fog.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { Ocean } from './ocean.js';

const col = (h) => new THREE.Color(h);
/** Palette for the day/night/storm moods. */
const C = {
  day: { fog: col(0xa9c8de), hemiSky: col(0xbfdcff), hemiGnd: col(0x4a6a6a), sun: col(0xfff0d8) },
  dusk: { fog: col(0xe0a882), hemiSky: col(0xffc4a0), hemiGnd: col(0x5a4840), sun: col(0xff9a50) },
  night: { top: col(0x03060f), fog: col(0x13233a), hemiSky: col(0x3a5684), hemiGnd: col(0x101820), sun: col(0xa8c0ff), deep: col(0x041826), shallow: col(0x0a3a48) },
  storm: { top: col(0x3c454e), fog: col(0x66737e), hemiSky: col(0x8c9aa6), deep: col(0x1a3440), shallow: col(0x3a6a70) },
  stormNight: { fog: col(0x141c24) },
};

export class Stage {
  constructor(canvas, { quality = 'high', preserve = false, autoRes = false } = {}) {
    this.quality = quality;
    const r = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance', preserveDrawingBuffer: preserve });
    this.maxPR = this.pr = Math.min(devicePixelRatio, quality === 'high' ? 2 : 1);
    this.autoRes = autoRes; this.good = 0;
    r.setPixelRatio(this.pr);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.75;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = quality !== 'low';
    r.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = r;
    const scene = new THREE.Scene();
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.5, 9000);
    this.camera.position.set(0, 20, -40);

    // sky
    const sky = new Sky();
    sky.scale.setScalar(8000);
    const u = sky.material.uniforms;
    u.turbidity.value = 4; u.rayleigh.value = 1.4; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
    this.sky = sky;
    scene.add(sky);
    this.sunDir = new THREE.Vector3();
    this.setSun(28, 140);

    // lights
    const hemi = new THREE.HemisphereLight(0xbfdcff, 0x4a6a6a, 1.0);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0d8, 3.2);
    sun.castShadow = quality !== 'low';
    sun.shadow.mapSize.set(quality === 'high' ? 4096 : 2048, quality === 'high' ? 4096 : 2048);
    const sc = sun.shadow.camera; sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90; sc.near = 1; sc.far = 600;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
    scene.add(sun); scene.add(sun.target);
    this.sun = sun; this.hemi = hemi;

    scene.fog = new THREE.Fog(0xa9c8de, 600, 4200);

    this.ocean = new Ocean(scene);
    this.ocean.uniforms.uSunDir.value.copy(this.sunDir);
    this.ocean0 = { deep: this.ocean.uniforms.uDeep.value.clone(), shallow: this.ocean.uniforms.uShallow.value.clone(), sky: this.ocean.uniforms.uSkyTint.value.clone(), sun: this.ocean.uniforms.uSunColor.value.clone() };
    this.buildNightSky();
    this.env = { phase: -1, storm: 0, bakedPhase: -1, bakedStorm: -1, night: 0 };
    this.bakeEnv();
    this.resize();
    addEventListener('resize', () => this.resize());
  }
  setSun(elevDeg, azDeg) {
    const phi = THREE.MathUtils.degToRad(90 - elevDeg), th = THREE.MathUtils.degToRad(azDeg);
    this.sunDir.setFromSphericalCoords(1, phi, th);
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
  }
  /** Render the sky into a cube map: water reflections + PBR environment for ships. Called again as the sun moves
   *  (every few seconds of the day/night cycle), so the targets and the PMREM generator are kept and reused. */
  bakeEnv() {
    const r = this.renderer;
    if (!this.envBake) {
      const tmp = new THREE.Scene(), sky2 = new Sky(); sky2.scale.setScalar(1000); tmp.add(sky2);
      if (this.dome) { const d2 = new THREE.Mesh(this.dome.geometry, this.dome.material); d2.scale.setScalar(0.12); d2.renderOrder = 1; tmp.add(d2); }
      const rt = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
      this.envBake = { tmp, sky2, rt, cc: new THREE.CubeCamera(1, 2000, rt), pm: new THREE.PMREMGenerator(r), pmrt: null };
    }
    const E = this.envBake;
    for (const k in this.sky.material.uniforms) E.sky2.material.uniforms[k].value = this.sky.material.uniforms[k].value;
    E.cc.update(r, E.tmp);
    this.ocean.setEnv(E.rt.texture);
    const old = E.pmrt;
    E.pmrt = E.pm.fromCubemap(E.rt.texture, old || undefined);
    this.scene.environment = E.pmrt.texture;
    this.scene.environmentIntensity = 0.8 * (this.env ? 1 - this.env.night * 0.75 : 1);
  }
  /** Stars and a moon, shown as the sun goes down. */
  buildNightSky() {
    const n = 2200, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, y = Math.abs(u) * 0.98 + 0.02, r = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(a) * r * 6500; pos[i * 3 + 1] = y * 6500; pos[i * 3 + 2] = Math.sin(a) * r * 6500;
      const b = 0.45 + rnd() * 0.55, warm = rnd();
      col[i * 3] = b * (warm > 0.8 ? 1 : 0.85); col[i * 3 + 1] = b * 0.9; col[i * 3 + 2] = b * (warm < 0.25 ? 1 : 0.85);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.stars.frustumCulled = false; this.stars.renderOrder = -2; this.stars.visible = false;
    this.scene.add(this.stars);
    const mc = document.createElement('canvas'); mc.width = mc.height = 128;
    const x = mc.getContext('2d'), gr = x.createRadialGradient(64, 64, 10, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,253,240,1)'); gr.addColorStop(0.42, 'rgba(244,240,222,1)'); gr.addColorStop(0.5, 'rgba(200,215,255,0.35)'); gr.addColorStop(1, 'rgba(160,190,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    x.fillStyle = 'rgba(170,165,150,0.35)'; for (const [cx, cy, r] of [[52, 50, 9], [74, 70, 7], [60, 78, 5], [80, 48, 4]]) { x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill(); }
    const tex = new THREE.CanvasTexture(mc); tex.colorSpace = THREE.SRGBColorSpace;
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, opacity: 0 }));
    this.moon.scale.setScalar(520); this.moon.renderOrder = -1; this.moon.visible = false;
    this.scene.add(this.moon);
    this.moonDir = new THREE.Vector3();
    // a gradient dome just inside the sky: deep blue at night, slate grey in a storm (the Sky shader alone
    // goes pitch black below the horizon and bleaches white under heavy cloud)
    const dm = new THREE.ShaderMaterial({
      uniforms: { uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uOpacity: { value: 0 } },
      vertexShader: 'varying vec3 vD; void main() { vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uTop; uniform vec3 uHorizon; uniform float uOpacity; varying vec3 vD; void main() { float h = clamp(vD.y, 0.0, 1.0); gl_FragColor = vec4(mix(uHorizon, uTop, pow(h, 0.55)), uOpacity); }',
      side: THREE.BackSide, transparent: true, depthWrite: false, fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(7400, 32, 16), dm);
    this.dome.frustumCulled = false; this.dome.renderOrder = -3; this.dome.visible = false;
    this.scene.add(this.dome);
  }
  /**
   * Time of day + weather. `phase` 0..1 runs sunrise → noon → sunset (0..0.7) then night (0.7..1); `storm` 0..1.
   * Cheap per-frame updates (lights, fog, sky uniforms); the environment cube is re-baked only when it drifts.
   */
  setEnvironment(phase, storm = 0, t = 0) {
    const E = this.env, DAYF = 0.7;
    E.phase = phase; E.storm = storm;
    let elev, az;
    if (phase < DAYF) { const a = (phase / DAYF) * Math.PI; elev = Math.sin(a) * 58 - 2; az = 80 + (a / Math.PI) * 200; }
    else { const a = ((phase - DAYF) / (1 - DAYF)) * Math.PI; elev = -2 - Math.sin(a) * 34; az = 280 + (a / Math.PI) * 160; }
    this.setSun(elev, az);
    const ss = (a, b, x) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
    const dayK = ss(-5, 9, elev), dusk = ss(-7, 1, elev) * (1 - ss(5, 24, elev)), night = 1 - dayK;
    E.night = night;
    // moon rides opposite the sun
    this.moonDir.set(-this.sunDir.x, Math.max(0.18, -this.sunDir.y * 0.9 + 0.25), -this.sunDir.z).normalize();
    const u = this.sky.material.uniforms;
    u.turbidity.value = 4 + dusk * 3 + storm * 8; u.rayleigh.value = 1.4 + dusk * 1.6 - storm * 0.9; u.mieCoefficient.value = 0.004 + dusk * 0.004 + storm * 0.01;
    if (u.cloudCoverage) { u.cloudCoverage.value = 0.4 + storm * 0.55; u.cloudDensity.value = 0.4 + storm * 0.5; u.time.value = t; }
    // the key light: the sun by day, the moon by night (crossfaded around the horizon)
    const lightDir = elev > -3 ? this.sunDir : this.moonDir;
    const sunCol = C.day.sun.clone().lerp(C.dusk.sun, dusk);
    const lc = sunCol.clone().lerp(C.night.sun, night);
    this.sun.color.copy(lc);
    this.sun.intensity = (3.2 * dayK + 0.55 * night) * (1 - storm * 0.7);
    this.lightDir = lightDir;
    this.hemi.color.copy(C.day.hemiSky).lerp(C.dusk.hemiSky, dusk).lerp(C.night.hemiSky, night).lerp(C.storm.hemiSky, storm * 0.7);
    this.hemi.groundColor.copy(C.day.hemiGnd).lerp(C.dusk.hemiGnd, dusk).lerp(C.night.hemiGnd, night);
    this.hemi.intensity = (1.0 * dayK + 0.55 * night) * (1 - storm * 0.35);
    const fl = this.flash || 0; // lightning
    if (fl > 0) this.hemi.intensity += fl * fl * 3.5;
    const fog = this.scene.fog;
    fog.color.copy(C.day.fog).lerp(C.dusk.fog, dusk * 0.85).lerp(C.night.fog, night).lerp(night > 0.5 ? C.stormNight.fog : C.storm.fog, storm * 0.85);
    fog.near = 600 - storm * 420 - night * 150; fog.far = 4200 - storm * 2500 - night * 900;
    this.renderer.toneMappingExposure = 0.75 + night * 0.25 + fl * fl * 0.5;
    // ocean: sun glint follows the key light, the water darkens at night and greys in a storm
    const O = this.ocean.uniforms, O0 = this.ocean0;
    O.uSunDir.value.copy(lightDir);
    O.uSunColor.value.copy(O0.sun).lerp(C.dusk.sun, dusk * 0.7).multiplyScalar(dayK + night * 0.35).lerp(C.night.sun, night * 0.6).multiplyScalar(1 - storm * 0.7);
    O.uDeep.value.copy(O0.deep).lerp(C.night.deep, night * 0.85).lerp(C.storm.deep, storm * 0.6);
    O.uShallow.value.copy(O0.shallow).lerp(C.night.shallow, night * 0.8).lerp(C.storm.shallow, storm * 0.5);
    O.uSkyTint.value.copy(O0.sky).lerp(C.dusk.fog, dusk * 0.5).lerp(C.night.fog, night).lerp(C.storm.fog, storm * 0.7);
    const dmu = this.dome.material.uniforms, dOp = Math.min(0.94, night * 0.9 + storm * 0.72);
    dmu.uHorizon.value.copy(fog.color); dmu.uTop.value.copy(C.night.top).lerp(C.storm.top, storm * (1 - night * 0.6));
    dmu.uOpacity.value = dOp; this.dome.visible = dOp > 0.01;
    O.uDim.value = 1 - night * 0.72 - storm * 0.35;
    // stars + moon
    const so = night * (1 - storm * 0.95);
    this.stars.material.opacity = so; this.stars.visible = so > 0.01;
    this.moon.material.opacity = Math.min(1, so * 1.4); this.moon.visible = so > 0.01;
    // re-bake reflections when the sky has drifted noticeably
    if (Math.abs(phase - E.bakedPhase) > 0.004 || Math.abs(storm - E.bakedStorm) > 0.08) { E.bakedPhase = phase; E.bakedStorm = storm; this.bakeEnv(); }
  }
  /** Dynamic resolution: drop the render scale when the frame rate sags, creep back up when it recovers. */
  adapt(fps) {
    if (!this.autoRes) return;
    const max = this.maxPR, min = Math.max(0.5, max * 0.5);
    let pr = this.pr;
    if (fps < 45 && pr > min) { pr = Math.max(min, pr - (fps < 30 ? 0.25 : 0.12)); this.good = 0; }
    else if (fps > 57) { if (++this.good >= 3 && pr < max) { pr = Math.min(max, pr + 0.1); this.good = 0; } }
    else this.good = 0;
    if (Math.abs(pr - this.pr) > 1e-3) { this.pr = pr; this.renderer.setPixelRatio(pr); this.resize(); }
  }
  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  /** Keep the shadow frustum around the focus point. */
  frame(t, focus) {
    this.ocean.update(t, focus);
    this.sun.position.copy(focus).addScaledVector(this.lightDir || this.sunDir, 300);
    this.dome.position.copy(this.camera.position);
    if (this.stars.visible) { this.stars.position.copy(this.camera.position); this.moon.position.copy(this.camera.position).addScaledVector(this.moonDir, 6000); }
    this.sun.target.position.copy(focus);
    this.sky.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }
}
