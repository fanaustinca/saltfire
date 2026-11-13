// Renderer, sky, sun, environment reflections, fog.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { Ocean } from './ocean.js';

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
    this.bakeEnv();
    this.resize();
    addEventListener('resize', () => this.resize());
  }
  setSun(elevDeg, azDeg) {
    const phi = THREE.MathUtils.degToRad(90 - elevDeg), th = THREE.MathUtils.degToRad(azDeg);
    this.sunDir.setFromSphericalCoords(1, phi, th);
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
  }
  /** Render the sky into a cube map once: water reflections + PBR environment for ships. */
  bakeEnv() {
    const r = this.renderer;
    const tmp = new THREE.Scene();
    const sky2 = new Sky(); sky2.scale.setScalar(1000);
    for (const k in this.sky.material.uniforms) sky2.material.uniforms[k].value = this.sky.material.uniforms[k].value;
    tmp.add(sky2);
    const rt = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
    const cc = new THREE.CubeCamera(1, 2000, rt);
    cc.update(r, tmp);
    this.ocean.setEnv(rt.texture);
    const pm = new THREE.PMREMGenerator(r);
    this.scene.environment = pm.fromCubemap(rt.texture).texture;
    this.scene.environmentIntensity = 0.8;
    pm.dispose();
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
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 300);
    this.sun.target.position.copy(focus);
    this.sky.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }
}
