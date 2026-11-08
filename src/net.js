// Peer-to-peer networking over WebRTC (PeerJS public signalling) with a star topology: the host
// runs the world. Hosts are addressed by a simple 6-digit room code. ?net=local swaps WebRTC for a
// BroadcastChannel between tabs (offline testing / headless e2e).
import Peer from 'peerjs';

export const PREFIX = 'saltfire-v1-';
const codeId = (code) => `${PREFIX}${code}`;
export const newCode = () => String(Math.floor(100000 + Math.random() * 900000));
const timeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms))]);

class PeerEndpoint {
  static async create(id) {
    const e = new PeerEndpoint();
    e.peer = id ? new Peer(id, { debug: 0 }) : new Peer({ debug: 0 });
    e.pending = new Map();
    await timeout(new Promise((res, rej) => {
      e.peer.on('open', (pid) => { e.id = pid; res(); });
      e.peer.on('error', (err) => {
        if (!e.id) { rej(err.type === 'unavailable-id' ? Object.assign(new Error('taken'), { taken: true }) : err); return; }
        if (err.type === 'peer-unavailable') {
          for (const [pid, p] of e.pending) if (String(err.message).includes(pid)) { p.rej(new Error('unavailable')); e.pending.delete(pid); }
        }
      });
    }), 12000, 'Connecting to matchmaking');
    e.peer.on('disconnected', () => { try { e.peer.reconnect(); } catch { /* destroyed */ } });
    addEventListener('pagehide', () => e.destroy());
    return e;
  }
  listen(onConn) {
    this.peer.on('connection', (c) => c.on('open', () => onConn(wrapPeerConn(c))));
  }
  connect(id, ms = 6000) {
    return timeout(new Promise((res, rej) => {
      const c = this.peer.connect(id, { reliable: true, serialization: 'json' });
      this.pending.set(id, { rej });
      c.on('open', () => { this.pending.delete(id); res(wrapPeerConn(c)); });
      c.on('error', (err) => rej(err));
    }), ms, 'Connecting').finally(() => this.pending.delete(id));
  }
  destroy() { try { this.peer.destroy(); } catch { /* already */ } }
}
function wrapPeerConn(c) {
  const conn = { peer: c.peer, data: [], close: [], send: (m) => { if (c.open) c.send(m); }, end: () => c.close() };
  c.on('data', (d) => conn.data.forEach((f) => f(d)));
  c.on('close', () => conn.close.forEach((f) => f()));
  c.on('error', () => conn.close.forEach((f) => f()));
  return conn;
}

class LocalEndpoint {
  static lag = 0;
  static async create(id) {
    const e = new LocalEndpoint();
    e.ch = new BroadcastChannel('saltfire-local');
    e.conns = new Map();
    e.id = id || 'local-' + Math.random().toString(36).slice(2, 9);
    e.waiting = new Map();
    let taken = false;
    const nonce = Math.random();
    e.ch.onmessage = (ev) => {
      const m = ev.data;
      if (m.sys === 'taken' && m.nonce === nonce) taken = true;
      if (m.sys === 'claim' && m.id === e.id && m.nonce !== nonce && e.ready) e.ch.postMessage({ sys: 'taken', nonce: m.nonce });
      if (m.to !== e.id) return;
      if (m.sys === 'conn' && e.onConn) {
        const c = e.makeConn(m.cid, m.from);
        e.ch.postMessage({ sys: 'accept', cid: m.cid, from: e.id, to: m.from });
        e.onConn(c);
      } else if (m.sys === 'accept') { const w = e.waiting.get(m.cid); if (w) { e.waiting.delete(m.cid); w(e.makeConn(m.cid, m.from)); } }
      else if (m.sys === 'data') { const c = e.conns.get(m.cid); if (c) { if (LocalEndpoint.lag) setTimeout(() => c.data.forEach((f) => f(m.d)), LocalEndpoint.lag); else c.data.forEach((f) => f(m.d)); } }
      else if (m.sys === 'close') { const c = e.conns.get(m.cid); if (c) { e.conns.delete(m.cid); c.close.forEach((f) => f()); } }
    };
    if (id) {
      e.ch.postMessage({ sys: 'claim', id, nonce });
      await new Promise((r) => setTimeout(r, 150));
      if (taken) { e.ch.close(); throw Object.assign(new Error('taken'), { taken: true }); }
    }
    e.ready = true;
    const bye = () => { try { e.destroy(); } catch { /* closed */ } };
    addEventListener('pagehide', bye); addEventListener('beforeunload', bye);
    return e;
  }
  makeConn(cid, peer) {
    const conn = { peer, data: [], close: [], send: (d) => this.ch.postMessage({ sys: 'data', cid, from: this.id, to: peer, d }), end: () => { this.ch.postMessage({ sys: 'close', cid, from: this.id, to: peer }); this.conns.delete(cid); } };
    this.conns.set(cid, conn);
    return conn;
  }
  listen(onConn) { this.onConn = onConn; }
  connect(id, ms = 1500) {
    const cid = Math.random().toString(36).slice(2);
    return timeout(new Promise((res) => { this.waiting.set(cid, res); this.ch.postMessage({ sys: 'conn', cid, from: this.id, to: id }); }), ms, 'Connecting').catch((e) => { this.waiting.delete(cid); throw e; });
  }
  destroy() {
    for (const [cid, c] of this.conns) { this.ch.postMessage({ sys: 'close', cid, from: this.id, to: c.peer }); }
    this.ch.close();
  }
}

const Endpoint = () => (new URLSearchParams(location.search).get('net') === 'local' ? LocalEndpoint : PeerEndpoint);
export const isLocalNet = () => Endpoint() === LocalEndpoint;

export class Room {
  constructor(ep, isHost) {
    this.ep = ep; this.isHost = isHost;
    this.conns = new Map();
    this.onMessage = () => {}; this.onJoin = () => {}; this.onLeave = () => {};
    this.code = null;
  }
  attach(conn, member) {
    conn.data.push((m) => {
      if (m && m.k === 'hello' && this.isHost && !this.conns.has(conn.peer)) { this.conns.set(conn.peer, conn); this.onJoin(conn.peer, m); return; }
      this.onMessage(conn.peer, m);
    });
    conn.close.push(() => { if (this.conns.delete(conn.peer)) this.onLeave(conn.peer); });
    if (member) this.conns.set(conn.peer, conn);
  }
  /** Host on `code` (keeps the world's code when possible, otherwise picks a fresh one). */
  static async host(code) {
    const E = Endpoint();
    let ep = null, c = code || newCode();
    for (let i = 0; i < 6 && !ep; i++) {
      try { ep = await E.create(codeId(c)); }
      catch (e) { if (e.taken) { c = newCode(); continue; } throw e; }
    }
    if (!ep) throw new Error('Could not reserve a room code');
    const room = new Room(ep, true);
    room.code = c;
    ep.listen((conn) => room.attach(conn, false));
    return room;
  }
  static async join(code, hello) {
    const E = Endpoint();
    const ep = await E.create(null);
    let conn;
    try { conn = await ep.connect(codeId(String(code).trim()), 9000); }
    catch (e) { ep.destroy(); throw new Error('No world found with code ' + code); }
    const room = new Room(ep, false);
    room.code = code;
    room.host = conn.peer;
    room.attach(conn, true);
    conn.send({ k: 'hello', ...hello });
    return room;
  }
  send(peer, m) { this.conns.get(peer)?.send(m); }
  toHost(m) { this.conns.get(this.host)?.send(m); }
  broadcast(m, except = null) { for (const [id, c] of this.conns) if (id !== except) c.send(m); }
  kick(peer) { const c = this.conns.get(peer); if (c) { c.end(); this.conns.delete(peer); } }
  close() { for (const c of this.conns.values()) c.end(); this.ep.destroy(); }
}
