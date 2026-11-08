// Headless browser tests (Puppeteer): boots the built game, renders + inspects the canvas, plays
// with the real keyboard + mouse, docks/builds/trades, runs a 2-tab multiplayer session over
// ?net=local, checks IndexedDB persistence + returning players, and saves gameplay screenshots.
import { serve, launch, openPage, test, assert, summary, shot } from './harness.mjs';

const srv = await serve();
const base = `http://127.0.0.1:${srv.address().port}/?test&net=local&seed=7`;
const browser = await launch();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const only = process.env.ONLY;
const T = async (name, fn) => { if (only && !name.includes(only)) return; await test(name, fn); };

const canvasStats = (page) => page.evaluate(() => {
  const c = document.getElementById('view');
  const s = document.createElement('canvas'); s.width = 160; s.height = 90;
  const g = s.getContext('2d'); g.drawImage(c, 0, 0, 160, 90);
  const d = g.getImageData(0, 0, 160, 90).data;
  let sum = 0, sum2 = 0; const colors = new Set();
  for (let i = 0; i < d.length; i += 4) { const v = (d[i] + d[i + 1] + d[i + 2]) / 3; sum += v; sum2 += v * v; colors.add((d[i] >> 4) * 256 + (d[i + 1] >> 4) * 16 + (d[i + 2] >> 4)); }
  const n = d.length / 4, mean = sum / n;
  return { mean, std: Math.sqrt(sum2 / n - mean * mean), colors: colors.size };
});
const waitGame = (page) => page.waitForFunction(() => window.SALT && SALT.game && SALT.game.frames > 5 && SALT.game.me(), { polling: 100, timeout: 240000 });

await T('title screen boots with no errors', async () => {
  const { page, errors } = await openPage(browser, base);
  await page.waitForSelector('.title-screen');
  const logo = await page.$eval('.logo', (e) => e.textContent);
  assert(logo === 'SALTFIRE', 'logo ' + logo);
  assert(await page.$('#join-code'), '6-digit join input');
  assert(!errors.length, errors.join('\n'));
  await shot(page, 'e2e-title.png');
  await page.close();
});

await T('solo: world renders, sails + steering with the keyboard', async () => {
  const { page, errors } = await openPage(browser, base + '&auto=solo&name=Tester&pid=SOLO1');
  await waitGame(page);
  await sleep(1500);
  const st = await canvasStats(page);
  assert(st.std > 12 && st.colors > 60, 'scene rendered: ' + JSON.stringify(st));
  // islands, bases, ships, ocean exist
  const info = await page.evaluate(() => ({ isl: SALT.game.islandGroups.length, bases: SALT.game.baseViews.size, views: SALT.game.views.size, home: SALT.game.W.bases.some((b) => b.owner === SALT.game.pid) }));
  assert(info.isl > 20 && info.bases > 10 && info.views >= 1 && info.home, JSON.stringify(info));
  const p0 = await page.evaluate(() => ({ x: SALT.game.me().x, z: SALT.game.me().z, yaw: SALT.game.me().yaw }));
  await page.keyboard.press('KeyW'); await page.keyboard.press('KeyW'); await page.keyboard.press('KeyW');
  await page.waitForFunction(() => SALT.game.me().spd > 3, { polling: 100, timeout: 240000 });
  await page.keyboard.down('KeyA');
  await page.waitForFunction((y) => Math.abs(SALT.game.me().yaw - y) > 0.25, { polling: 100, timeout: 120000 }, p0.yaw);
  await page.keyboard.up('KeyA');
  const p1 = await page.evaluate(() => ({ x: SALT.game.me().x, z: SALT.game.me().z, sail: SALT.game.me().sail }));
  assert(Math.hypot(p1.x - p0.x, p1.z - p0.z) > 3 && p1.sail === 1, 'moved under full sail ' + JSON.stringify(p1));
  assert(await page.$eval('#sname', (e) => e.textContent.includes('Sloop')), 'HUD shows ship');
  await shot(page, 'e2e-sailing.png');
  assert(!errors.length, errors.join('\n'));
  await page.close();
});

await T('gunnery: mouse aims a colour-coded arc and clicking fires a broadside', async () => {
  const { page, errors } = await openPage(browser, base + '&auto=solo&name=Gunner&pid=GUN1');
  await waitGame(page);
  await page.evaluate(() => { dev.density(0); dev.clear(); dev.tp(1500, 0); const me = SALT.game.me(); me.yaw = 0; me.sail = 0; SALT.game.cam.yawOff = 0; SALT.game.cam.pitch = 0.6; });
  await sleep(800);
  // a pirate on the port (+X) beam
  await page.evaluate(() => { const g = SALT.game, me = g.me(); const f = g.sim.spawnAI(1, me, { role: 'pirate', tier: 'sloop', dist: 5 }); f.x = me.x + 90; f.z = me.z; f.ai = null; f.sail = 0; window.FOE = f.id; });
  await sleep(600);
  // the camera is still settling, so re-project the target until the aim locks on
  const aimAtFoe = async () => {
    for (let i = 0; i < 40; i++) {
      const scr = await page.evaluate(() => { const g = SALT.game; const f = g.sim.ships.get(window.FOE); const V = g.camera.position.constructor; const v = new V(f.x, 0, f.z).project(g.camera); return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight }; });
      scr.x = Math.max(4, Math.min(1276, scr.x)); scr.y = Math.max(60, Math.min(520, scr.y));
      await page.mouse.move(scr.x, scr.y);
      await sleep(300);
      if (await page.evaluate(() => SALT.game.aim.valid && SALT.game.aim.side === 'L')) return scr;
    }
    throw new Error('aim never became valid: ' + JSON.stringify(await page.evaluate(() => SALT.game.aim)));
  };
  let scr = await aimAtFoe();
  const col = await page.evaluate(() => SALT.game.arcMat.color.getHex());
  assert((col >> 16) < 0x80 && ((col >> 8) & 0xff) > 0xc0, 'arc is green: ' + col.toString(16));
  await shot(page, 'e2e-aim.png');
  // aim backwards out of arc -> red
  await page.mouse.move(640, 200);
  await page.waitForFunction(() => !SALT.game.aim.valid, { polling: 100, timeout: 10000 });
  const red = await page.evaluate(() => SALT.game.arcMat.color.getHex());
  assert(red === 0xff3b30, 'arc is red when invalid: ' + red.toString(16));
  const hull0 = await page.evaluate(() => SALT.game.sim.ships.get(window.FOE).hull);
  for (let i = 0; i < 10; i++) {
    scr = await aimAtFoe();
    await page.mouse.down(); await page.mouse.up(); // left click fires the broadside
    await sleep(400);
    if (await page.evaluate(() => SALT.game.me().reload.L > 0)) break;
  }
  assert(await page.evaluate(() => SALT.game.me().reload.L > 0), 'broadside fired');
  await page.waitForFunction(() => SALT.game.sim.balls.length > 0, { polling: 50, timeout: 10000 });
  await page.waitForFunction(() => SALT.game.sim.balls.length === 0, { polling: 100, timeout: 240000 });
  const hull1 = await page.evaluate(() => SALT.game.sim.ships.get(window.FOE)?.hull ?? 0);
  console.log(`      broadside landed; target hull ${hull0} -> ${hull1}`);
  await shot(page, 'e2e-broadside.png');
  assert(!errors.length, errors.join('\n'));
  await page.close();
});

await T('port: dock at home, build (island grows), craft, trade, upgrade, custom ship', async () => {
  const { page, errors } = await openPage(browser, base + '&auto=solo&name=Builder&pid=BLD1');
  await waitGame(page);
  const r = await page.evaluate(async () => {
    const g = SALT.game; dev.unlock(); dev.density(0); dev.clear();
    const b = g.sim.homeOf(g.pid);
    const me = g.me();
    const out = {};
    // sail into the harbour (spawn is at the harbour already)
    await g.interact();
    out.docked = !!me.docked; out.panel = !!document.querySelector('.port');
    for (const t of ['dock', 'shipyard', 'watchtower', 'lumber', 'warehouse']) { const x = await g.act({ type: 'build', base: b.id, btype: t }); if (x.err) out.err = x.err; }
    const c = await g.act({ type: 'build', base: b.id, btype: 'cannon', at: 1.0 }); if (c.err) out.err = c.err;
    out.buildings = b.buildings.length;
    out.slot = b.buildings.find((x) => x.type === 'cannon').slot;
    out.craft = (await g.act({ type: 'craft', kind: 'chain', times: 2 })).err || 'ok';
    out.buy = (await g.act({ type: 'instantBuy', item: 'iron', qty: 5 })).err || 'ok';
    out.order = (await g.act({ type: 'order', o: { side: 'sell', item: 'oak', qty: 10, price: 50 } })).err || 'ok';
    out.up = (await g.act({ type: 'upgrade', key: 'bow' })).err || 'ok';
    out.bow = g.me().stats.bow;
    const cs = await g.act({ type: 'customShip', spec: { tier: 'frigate', side: 5, size: 1.1, name: 'Test Ship', hullColor: '#223355' } });
    out.custom = cs.err || 'ok';
    out.flag = (await g.act({ type: 'flagship', uid: cs.data })).err || 'ok';
    out.tier = g.me().spec.tier; out.name = g.me().spec.name; out.side = g.me().stats.side;
    // the old sloop is now a fleet ship: send it to attack the nearest wild island
    const wild = g.W.bases.filter((x) => x.owner === 'ai:wild').sort((a, c) => Math.hypot(a.x - b.x, a.z - b.z) - Math.hypot(c.x - b.x, c.z - b.z))[0];
    const sloop = g.profile().fleet.find((x) => x.tier === 'sloop');
    out.deploy = (await g.act({ type: 'deploy', uid: sloop.uid, mode: 'attack', base: wild.id })).err || 'ok';
    out.fleetShip = !!g.sim.ships.get('f:' + sloop.uid) && g.sim.ships.get('f:' + sloop.uid).ai.mode === 'attack';
    out.up5 = (await g.act({ type: 'upgrade', key: 'speed', n: 5 })).err || 'ok';
    out.speedRank = g.profile().upg.speed;
    return out;
  });
  assert(r.docked && r.panel, 'docked + port open ' + JSON.stringify(r));
  assert(!r.err && r.buildings >= 7 && r.slot === 1.0, 'built ' + JSON.stringify(r));
  for (const k of ['craft', 'buy', 'order', 'up', 'custom', 'flag', 'deploy', 'up5']) assert(r[k] === 'ok', k + ': ' + r[k]);
  assert(r.fleetShip && r.speedRank === 5, 'fleet ship at sea + bulk upgrade ' + JSON.stringify(r));
  assert(r.bow === 1 && r.tier === 'frigate' && r.name === 'Test Ship' && r.side === 5, JSON.stringify(r));
  // every port tab renders
  for (const tab of ['harbor', 'ships', 'fleet', 'upgrades', 'craft', 'market', 'build', 'haven', 'diplomacy']) {
    await page.evaluate((t) => { SALT.game.ui.tab = t; SALT.game.ui.renderPanel(SALT.game); }, tab);
    const ok = await page.evaluate(() => document.querySelector('#pbody').children.length > 0);
    assert(ok, 'tab ' + tab);
  }
  await page.evaluate(() => { SALT.game.ui.tab = 'fleet'; SALT.game.ui.renderPanel(SALT.game); });
  assert(await page.evaluate(() => document.querySelectorAll('[data-dep]').length > 0 && !!document.querySelector('#fl-all-atk')), 'fleet command renders');
  await shot(page, 'e2e-fleet.png');
  await page.evaluate(() => { SALT.game.ui.tab = 'upgrades'; SALT.game.ui.renderPanel(SALT.game); });
  await shot(page, 'e2e-upgrades.png');
  await page.evaluate(() => { SALT.game.ui.tab = 'build'; SALT.game.ui.renderPanel(SALT.game); });
  await shot(page, 'e2e-port-build.png');
  await page.click('#pclose');
  await sleep(1200);
  await page.evaluate(() => { const g = SALT.game, b = g.sim.homeOf(g.pid), me = g.me(); dev.cam(b.x - me.x + 140, 90, b.z - me.z + 140, b.x - me.x, 0, b.z - me.z); });
  await sleep(1200);
  await shot(page, 'e2e-base.png');
  assert(!errors.length, errors.join('\n'));
  await page.close();
});

await T('world events: kraken + treasure flagship + map; dev.help()', async () => {
  const { page, errors } = await openPage(browser, base + '&auto=solo&name=Hunter&pid=HUNT1');
  await waitGame(page);
  const h = await page.evaluate(() => dev.help());
  assert(h.includes('dev.kraken') && h.includes('dev.give'), 'dev.help lists commands');
  await page.evaluate(() => { dev.density(0); dev.clear(); dev.tp(-1500, 300); dev.kraken(); dev.event('treasure'); SALT.game.cam.yawOff = 0; });
  await page.evaluate(() => { const k = SALT.game.sim.kraken, me = SALT.game.me(); k.x = me.x + 70; k.z = me.z + 60; dev.speed(5); });
  await page.waitForFunction(() => SALT.game.sim.kraken && SALT.game.sim.kraken.tentacles.some((t) => t.up > 0.5), { polling: 200, timeout: 180000 });
  await page.evaluate(() => dev.speed(1));
  assert(await page.evaluate(() => SALT.game.krakenView.group.visible), 'kraken visible');
  assert(await page.evaluate(() => [...SALT.game.sim.ships.values()].some((s) => s.tag === 'treasure')), 'treasure flagship');
  await page.evaluate(() => { const g = SALT.game, k = g.sim.kraken, me = g.me(); dev.cam(k.x - me.x - 90, 45, k.z - me.z - 70, k.x - me.x, 8, k.z - me.z); });
  await sleep(1500);
  await shot(page, 'e2e-kraken.png');
  await page.evaluate(() => dev.cam());
  await page.keyboard.press('KeyM');
  await page.waitForSelector('#mapc');
  await shot(page, 'e2e-map.png');
  assert(!errors.length, errors.join('\n'));
  await page.close();
});

await T('multiplayer: 6-digit room code, join, sync, act, fire, offline shield, return with saved empire', async () => {
  const H = await openPage(browser, base + '&q=low&auto=host&name=Hosty&pid=HOST1');
  await waitGame(H.page);
  const code = await H.page.evaluate(() => SALT.game.room.code);
  assert(/^\d{6}$/.test(code), 'code ' + code);
  await H.page.evaluate(() => { dev.density(0); dev.clear(); });
  const C = await openPage(browser, `${base}&q=low&auto=join&code=${code}&name=Guesty&pid=GUEST1`);
  await waitGame(C.page);
  // host sees the guest's profile + ship; guest sees host ship
  await H.page.waitForFunction(() => SALT.game.W.players.GUEST1?.online && SALT.game.sim.ships.has('p:GUEST1'), { polling: 200, timeout: 240000 });
  await C.page.bringToFront();
  await C.page.waitForFunction(() => SALT.game.sim.ships.has('p:HOST1') && SALT.game.views.has('p:HOST1'), { polling: 200, timeout: 240000 });
  const gb = await H.page.evaluate(() => SALT.game.W.bases.find((b) => b.owner === 'GUEST1')?.name);
  assert(gb, 'guest was granted an island');
  // guest moves; host sees it
  const hz0 = await H.page.evaluate(() => { const s = SALT.game.sim.ships.get('p:GUEST1'); return [s.x, s.z]; });
  await C.page.evaluate(() => { const me = SALT.game.me(); me.sail = 1; me.x += Math.sin(me.yaw) * 25; me.z += Math.cos(me.yaw) * 25; });
  await H.page.waitForFunction((p) => { const s = SALT.game.sim.ships.get('p:GUEST1'); return Math.hypot(s.x - p[0], s.z - p[1]) > 4; }, { polling: 200, timeout: 240000 }, hz0);
  // guest acts through the host (crafting) and gets XP
  const xp0 = await H.page.evaluate(() => SALT.game.W.players.GUEST1.xp + SALT.game.W.players.GUEST1.level * 1e5);
  const res = await C.page.evaluate(() => SALT.game.act({ type: 'craft', kind: 'chain', times: 1 }));
  assert(!res.err, 'guest craft: ' + res.err);
  await H.page.waitForFunction((x) => SALT.game.W.players.GUEST1.xp + SALT.game.W.players.GUEST1.level * 1e5 > x, { polling: 200, timeout: 10000 }, xp0);
  await C.page.waitForFunction(() => SALT.game.profile().inv.chain >= 20, { polling: 200, timeout: 10000 });
  // guest fires; the host simulates the balls
  await C.page.evaluate(() => { const g = SALT.game, me = g.me(); const ax = me.x + Math.cos(me.yaw) * 120, az = me.z - Math.sin(me.yaw) * 120; me.reload.L = 0; const plan = g.sim.planBroadside(me, 'L', ax, az); g.room.toHost({ k: 'fire', side: 'L', ax, az, ammo: 'ball', balls: plan.balls || [] }); window.PLAN = plan.err || 'ok'; });
  const plan = await C.page.evaluate(() => window.PLAN);
  if (plan === 'ok') await H.page.waitForFunction(() => SALT.game.sim.balls.some((b) => b.shooter === 'p:GUEST1') || SALT.game.sim.ships.get('p:GUEST1').reload.L > 0, { polling: 50, timeout: 10000 });
  await H.page.bringToFront(); await sleep(800);
  await shot(H.page, 'e2e-mp-host.png');
  await C.page.bringToFront(); await sleep(800);
  await shot(C.page, 'e2e-mp-guest.png');
  // guest leaves -> offline, base shielded
  await C.page.close();
  await H.page.bringToFront();
  await H.page.waitForFunction(() => !SALT.game.W.players.GUEST1.online && !SALT.game.sim.ships.has('p:GUEST1'), { polling: 200, timeout: 240000 });
  const sh = await H.page.evaluate(() => { const b = SALT.game.W.bases.find((x) => x.owner === 'GUEST1'); const keep = b.buildings[0]; const hp = keep.hp; SALT.game.sim.damageBuilding(b, keep, { owner: 'HOST1', ammo: 'ball', dmg: 30 }, 1); return keep.hp === hp; });
  assert(sh, 'offline guest base is shielded');
  // returning player keeps their empire
  const C2 = await openPage(browser, `${base}&q=low&auto=join&code=${code}&name=Guesty&pid=GUEST1`);
  await waitGame(C2.page);
  const back = await C2.page.evaluate(() => ({ chain: SALT.game.profile().inv.chain, base: SALT.game.W.bases.find((b) => b.owner === 'GUEST1')?.name }));
  assert(back.chain >= 20 && back.base === gb, 'returned with saved empire ' + JSON.stringify(back));
  assert(!H.errors.length, 'host errors: ' + H.errors.join('\n'));
  assert(!C.errors.length && !C2.errors.length, 'guest errors: ' + [...C.errors, ...C2.errors].join('\n'));
  await C2.page.close();
  await H.page.close();
});

await T('persistence: saved world shows on the title screen and continues', async () => {
  const { page, errors } = await openPage(browser, base + '&name=Persist&pid=PERS1&auto=solo');
  await waitGame(page);
  await page.evaluate(async () => { SALT.game.profile().inv.gold = 4242; await SALT.game.save(); });
  await page.goto(base + '&pid=PERS1', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-cont]');
  const n = await page.$$eval('[data-cont]', (els) => els.length);
  assert(n >= 1, 'world listed');
  // continue the newest world (PERS1 just saved)
  await page.click('[data-cont]');
  await waitGame(page);
  const gold = await page.evaluate(() => SALT.game.profile().inv.gold);
  assert(gold === 4242, 'gold restored: ' + gold);
  assert(!errors.length, errors.join('\n'));
  await page.close();
});

await browser.close();
srv.close();
process.exit(summary() ? 1 : 0);
