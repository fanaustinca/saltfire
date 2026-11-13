// Hand-drawn SVG reward icons (64×64 viewBox), used by the Holiday Tides calendar and drawn onto the Wheel canvas.
const G = (id, a, b) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
const coin = (x, y) => `<ellipse cx="${x}" cy="${y + 3}" rx="15" ry="6" fill="#8a5a10"/><rect x="${x - 15}" y="${y}" width="30" height="3" fill="#a8701a"/><ellipse cx="${x}" cy="${y}" rx="15" ry="6" fill="url(#gC)" stroke="#7a4e0e" stroke-width="1"/><ellipse cx="${x}" cy="${y}" rx="9" ry="3.4" fill="none" stroke="#b07a1c" stroke-width="1.2"/>`;
const ball = (x, y, r = 8) => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#gB)"/><circle cx="${x - r * 0.35}" cy="${y - r * 0.35}" r="${r * 0.28}" fill="#9aa3ad" opacity=".7"/>`;
const ship = (fill, sail) => `<path d="M10 40 L54 40 L48 50 L16 50 Z" fill="${fill}" stroke="#1a0f06" stroke-width="1.5"/><rect x="31" y="12" width="2.4" height="29" fill="#3a2410"/><rect x="19" y="18" width="2" height="23" fill="#3a2410"/><rect x="43" y="18" width="2" height="23" fill="#3a2410"/><path d="M24 15 Q33 21 24 27 L42 27 Q49 21 42 15 Z" fill="${sail}"/><path d="M24 29 Q33 35 24 38 L42 38 Q49 35 42 29 Z" fill="${sail}"/><path d="M13 22 Q20 26 13 30 L26 30 Q28 26 26 22Z" fill="${sail}" opacity=".9"/><path d="M38 22 Q45 26 38 30 L51 30 Q53 26 51 22Z" fill="${sail}" opacity=".9"/><path d="M33 8 L41 10 L33 12Z" fill="#c22"/>`;
const card = (a, b, inner) => `<rect x="9" y="4" width="46" height="56" rx="6" fill="url(#${a})" stroke="${b}" stroke-width="2.5"/><rect x="13" y="8" width="38" height="48" rx="3.5" fill="none" stroke="${b}" stroke-width="1" opacity=".7"/>${inner}`;

const ICONS = {
  gold: `${coin(32, 46)}${coin(30, 38)}${coin(34, 30)}${coin(31, 22)}<path d="M46 10 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" fill="#fff6c8"/>`,
  chest: `<rect x="8" y="28" width="48" height="26" rx="3" fill="url(#gW)" stroke="#2a1608" stroke-width="2"/><path d="M8 30 Q8 12 32 12 Q56 12 56 30 Z" fill="url(#gW)" stroke="#2a1608" stroke-width="2"/><rect x="8" y="27" width="48" height="5" fill="url(#gC)"/><rect x="18" y="12" width="5" height="42" fill="url(#gC)"/><rect x="41" y="12" width="5" height="42" fill="url(#gC)"/><rect x="28" y="28" width="8" height="10" rx="2" fill="#f7d35c" stroke="#6b4310"/><circle cx="32" cy="33" r="1.6" fill="#2a1608"/><path d="M20 12 Q32 2 44 12" fill="none" stroke="#fff3a8" stroke-width="2" opacity=".75"/>`,
  explosive: `${ball(30, 38, 18)}<rect x="22" y="22" width="16" height="6" rx="2" fill="#555c66" transform="rotate(-28 30 25)"/><path d="M36 20 Q42 12 48 14" fill="none" stroke="#c9a46a" stroke-width="2.6"/><circle cx="49" cy="13" r="6" fill="#ffb02e" opacity=".55"/><path d="M49 5 l1.6 5 5 1.6 -5 1.6 -1.6 5 -1.6 -5 -5 -1.6 5 -1.6z" fill="#ffe27a"/><path d="M14 40 a16 16 0 0 0 32 0" fill="none" stroke="#d2491a" stroke-width="3" opacity=".9"/>`,
  iron: `<path d="M6 46 L14 34 L40 34 L46 46 Z" fill="url(#gI)" stroke="#2a2e33" stroke-width="1.5"/><path d="M18 34 L26 22 L52 22 L58 34 Z" fill="url(#gI)" stroke="#2a2e33" stroke-width="1.5"/><path d="M6 46 L46 46 L46 52 L6 52Z" fill="#4a5058"/><path d="M14 34 L40 34 L40 36 L14 36Z" fill="#e3e8ee" opacity=".5"/><path d="M26 22 L52 22 L52 24 L26 24Z" fill="#e3e8ee" opacity=".5"/>`,
  oak: `${[[18, 44], [46, 44], [32, 44], [25, 30], [39, 30], [32, 17]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="9" fill="#8a5a2c" stroke="#3a2210" stroke-width="2"/><circle cx="${x}" cy="${y}" r="5.5" fill="#d9a865"/><circle cx="${x}" cy="${y}" r="2.5" fill="none" stroke="#9a6a34" stroke-width="1"/>`).join('')}`,
  canvas: `<rect x="10" y="20" width="40" height="24" fill="url(#gS)" stroke="#8a7a58" stroke-width="1.5"/><ellipse cx="50" cy="32" rx="6" ry="12" fill="#f2ead2" stroke="#8a7a58" stroke-width="1.5"/><ellipse cx="50" cy="32" rx="2.4" ry="5" fill="#b8a77e"/><path d="M10 24 L4 50 L36 50 L30 44 L10 44Z" fill="#e8dfc2" stroke="#8a7a58" stroke-width="1.2"/><rect x="22" y="20" width="4" height="24" fill="#a33" opacity=".85"/>`,
  powder: `<path d="M16 12 Q12 32 16 52 L48 52 Q52 32 48 12 Z" fill="url(#gW)" stroke="#2a1608" stroke-width="2"/><rect x="13" y="18" width="38" height="4" fill="#3a3f45"/><rect x="13" y="42" width="38" height="4" fill="#3a3f45"/><ellipse cx="32" cy="12" rx="16" ry="4" fill="#6b4220" stroke="#2a1608" stroke-width="1.5"/><path d="M26 28 h12 l-6 10z" fill="#e8d6a0"/><text x="32" y="36" font-size="7" font-weight="900" text-anchor="middle" fill="#2a1608" font-family="sans-serif">XXX</text>`,
  shot: `${ball(20, 46, 9)}${ball(38, 46, 9)}${ball(29, 32, 9)}<path d="M44 26 q6 -2 8 -8 q2 -6 -2 -10" fill="none" stroke="#7b8590" stroke-width="3" stroke-dasharray="4 2"/>${ball(52, 22, 5)}${ball(48, 8, 5)}`,
  mats: `<rect x="8" y="22" width="34" height="32" fill="#a8743c" stroke="#3a2210" stroke-width="2"/><path d="M8 22 L42 54 M42 22 L8 54" stroke="#6b4420" stroke-width="3"/><rect x="8" y="22" width="34" height="32" fill="none" stroke="#6b4420" stroke-width="4"/><path d="M42 30 L56 22 L56 50 L42 54Z" fill="#8a5a2c" stroke="#3a2210" stroke-width="2"/><path d="M8 22 L22 14 L56 14 L56 22 L42 22Z" fill="#c58c4c" stroke="#3a2210" stroke-width="2"/>`,
  spin: `<circle cx="32" cy="34" r="22" fill="#2a1a0c" stroke="url(#gC)" stroke-width="4"/>${['#b3201c', '#e6cc72', '#22407e', '#6b8a3a', '#d9b84a', '#5a5a6a', '#c9a227', '#7a4a24'].map((c, i) => { const a0 = (i / 8) * Math.PI * 2, a1 = ((i + 1) / 8) * Math.PI * 2; return `<path d="M32 34 L${32 + Math.cos(a0) * 19} ${34 + Math.sin(a0) * 19} A19 19 0 0 1 ${32 + Math.cos(a1) * 19} ${34 + Math.sin(a1) * 19}Z" fill="${c}"/>`; }).join('')}<circle cx="32" cy="34" r="5" fill="url(#gC)" stroke="#5a3a10"/><path d="M26 4 L38 4 L32 14Z" fill="#f7d35c" stroke="#6b4310" stroke-width="1.5"/>`,
  ship: card('gN', '#e8bd4a', `<g transform="translate(0,4)">${ship('#5a3a22', '#f3efe2')}</g>`),
  titan: card('gR', '#ffd25a', `<g transform="translate(0,8)">${ship('#1a1414', '#5a1a1a')}</g><path d="M20 12 L24 20 L32 10 L40 20 L44 12 L44 22 L20 22Z" fill="url(#gC)" stroke="#6b4310" stroke-width="1.2"/>`),
  ghost: card('gG', '#6affd0', `<g transform="translate(0,6)" opacity=".92">${ship('#16302a', '#9ff5d8')}</g><circle cx="22" cy="16" r="2" fill="#6affd0"/><circle cx="44" cy="20" r="1.6" fill="#6affd0"/><path d="M14 54 Q20 48 26 54 T38 54 T50 54" fill="none" stroke="#6affd0" stroke-width="1.6" opacity=".8"/>`),
  size: card('gP', '#f1c45a', `<rect x="20" y="22" width="24" height="20" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="3 2"/><path d="M16 18 L24 18 M16 18 L16 26 M16 18 L25 27 M48 46 L40 46 M48 46 L48 38 M48 46 L39 37" stroke="#ffe27a" stroke-width="3" stroke-linecap="round"/><text x="32" y="56" font-size="8" font-weight="900" text-anchor="middle" fill="#ffe27a" font-family="sans-serif">120%</text>`),
};
const DEFS = `<defs>${G('gC', '#fff0a0', '#d49a1c')}${G('gB', '#5c636c', '#16191c')}${G('gW', '#a8703a', '#5a361a')}${G('gI', '#c9d0d8', '#6b737c')}${G('gS', '#fbf6e6', '#d8cca8')}${G('gN', '#2a4a8a', '#12203e')}${G('gR', '#8a1a14', '#2a0806')}${G('gP', '#8a1a5a', '#3a0828')}${G('gG', '#155a4a', '#04140f')}</defs>`;

/** Inline SVG markup for a reward icon. */
export function iconSVG(name, size = 32) {
  return `<svg class="ico" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">${DEFS}${ICONS[name] || ICONS.gold}</svg>`;
}
/** The icon that represents a prize / gift object. */
export function prizeIcon(pr) {
  if (pr.icon) return pr.icon;
  if (pr.kind === 'ship') return pr.tier === 'titan' ? 'titan' : pr.tier === 'ghost' ? 'ghost' : 'ship';
  if (pr.kind === 'titanSize') return 'size';
  if (pr.kind === 'spin') return 'spin';
  if (pr.kind === 'gold') return pr.n >= 50000 ? 'chest' : 'gold';
  const k = Object.keys(pr.items || {});
  if (k.includes('explosive') && k.length <= 2) return 'explosive';
  if (k.includes('chain') || k.includes('grape') || k.includes('explosive')) return 'shot';
  return k.length === 1 ? (k[0] === 'oak' ? 'oak' : k[0] === 'iron' ? 'iron' : k[0] === 'canvas' ? 'canvas' : k[0] === 'powder' ? 'powder' : 'mats') : 'mats';
}
/** Decoded <img> for canvas drawing (cached; `onload` callback fires once when it becomes drawable). */
const IMG = {};
export function iconImage(name, onload) {
  if (IMG[name]) return IMG[name].complete ? IMG[name] : null;
  const im = new Image();
  im.onload = () => onload && onload();
  im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="128" height="128">${DEFS}${ICONS[name] || ICONS.gold}</svg>`);
  IMG[name] = im;
  return null;
}
