// Model gallery for visual QA: ?gallery=<tier|all>&cam=side|front|back|top|deck&sails=0..1&dmg=0..1
import * as THREE from 'three';
import { Stage } from './render/scene.js';
import { buildShip } from './render/shipmodel.js';
import { shipStats, shipSpec } from './economy.js';
import { TIERS } from './config.js';
import { heightAt } from './waves.js';

export function gallery(q) {
  const stage = new Stage(document.getElementById('view'), { quality: q.get('q') || 'high', preserve: true });
  const which = q.get('gallery');
  const tiers = which === 'all' ? TIERS.map((t) => t.id) : [which || 'frigate'];
  const ships = [];
  let x = 0;
  for (const id of tiers) {
    const st = shipStats(shipSpec(id), { bow: +(q.get('bow') || 0), stern: +(q.get('stern') || 0) });
    const s = buildShip(st, { emblem: 0, hullColor: q.get('hull') || undefined });
    s.setSailLevel(+(q.get('sails') ?? 1)); s.setDamage(+(q.get('dmg') || 0)); s.setHullDamage(+(q.get('dmg') || 0));
    const nh = Math.round(+(q.get('dmg') || 0) * 30);
    for (let i = 0; i < nh; i++) s.addHole(i % 2 ? 1 : -1, (Math.sin(i * 7.1) * 0.5 + 0.5) * st.depth * 0.8, (Math.sin(i * 3.3) * 0.45) * st.len);
    s.root.position.x = x; x += st.beam * 3 + 12;
    stage.scene.add(s.root); ships.push({ s, st });
  }
  const cam = q.get('cam') || 'side';
  const main = ships[0].st;
  const L = main.len;
  const focus = new THREE.Vector3((x - main.beam * 3 - 12) / 2, L * 0.25, 0);
  const pos = { side: [L * 1.25, L * 0.32, L * 0.25], front: [L * 0.35, L * 0.25, L * 1.1], back: [-L * 0.3, L * 0.22, -L * 0.95], top: [0.1, L * 1.6, 0.1], deck: [main.beam * 0.6, L * 0.2, -L * 0.3], quarter: [L * 0.8, L * 0.3, L * 0.8] }[cam];
  if (which === 'all') { stage.camera.position.set(focus.x, 40, 140); }
  else stage.camera.position.set(focus.x + pos[0], pos[1], pos[2]);
  stage.camera.lookAt(focus);
  let t = +(q.get('t') || 3);
  window.SALT = { ready: true, gallery: true, frames: 0 };
  const loop = () => {
    t += 1 / 60;
    for (const { s } of ships) {
      s.root.position.y = heightAt(s.root.position.x, 0, t);
      s.update(t);
    }
    stage.frame(t, focus);
    window.SALT.frames++;
    requestAnimationFrame(loop);
  };
  loop();
}
