// node tests/shot.mjs "<query>" out.png [w h] [waitMs] — screenshot a dev-server URL (DEV=http://...) or dist.
import { serve, launch, openPage } from './harness.mjs';
const [query = 'gallery=frigate', out = 'shot.png', w = 1280, h = 720, wait = 2500] = process.argv.slice(2);
const srv = process.env.DEV ? null : await serve();
const base = process.env.DEV || `http://127.0.0.1:${srv.address().port}/`;
const browser = await launch();
const { page, errors, logs } = await openPage(browser, `${base}?test&${query}`, { width: +w, height: +h });
if (process.env.PRE) { await new Promise((r) => setTimeout(r, 1500)); await page.evaluate(process.env.PRE); }
await new Promise((r) => setTimeout(r, +wait));
if (process.env.EVAL) console.log(await page.evaluate(process.env.EVAL));
await page.screenshot({ path: out });
if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
if (process.env.LOGS) console.log(logs.join('\n'));
await browser.close(); srv?.close();
