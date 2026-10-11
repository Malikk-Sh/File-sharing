import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import QRCode from 'qrcode';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.join(here, 'public');
const MAX_P2P = 500 * 1024 * 1024;
const MAX_RELAY = 200 * 1024 * 1024;
const MAX_BINARY = 16 * 1024;
const ROOM_RE = /^[A-HJ-NP-Z2-9]{10}$/;
const rooms = new Map();
const types = new Map([
  ['/','text/html; charset=utf-8'],
  ['/app.js','application/javascript; charset=utf-8'],
  ['/styles.css','text/css; charset=utf-8'],
  ['/finishing.js','application/javascript; charset=utf-8'],
  ['/finishing.css','text/css; charset=utf-8'],
  ['/favicon.svg','image/svg+xml'],
]);
const files = new Map([['/','index.html'],['/app.js','app.js'],['/styles.css','styles.css'],['/finishing.js','finishing.js'],['/finishing.css','finishing.css'],['/favicon.svg','favicon.svg']]);

function headers(res, mime) {
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self' wss: ws:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
}
function send(ws, data) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); }
function partner(ws) {
  if (!ws.room) return null;
  const r = rooms.get(ws.room);
  if (!r) return null;
  return [...r.peers].find(p => p !== ws && p.readyState === WebSocket.OPEN) || null;
}
function remove(ws) {
  const id = ws.room;
  if (!id) return;
  ws.room = null;
  const room = rooms.get(id);
  if (!room) return;
  room.peers.delete(ws);
  room.relay = null;
  for (const peer of room.peers) send(peer, { t: 'peer-left' });
  if (!room.peers.size) rooms.delete(id);
}
function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const u = new URL(origin);
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    return u.host === host && (u.protocol === 'https:' || (u.protocol === 'http:' && /^localhost(:\d+)?$|^127\.0\.0\.1(:\d+)?$/.test(u.host)));
  } catch { return false; }
}
function handleControl(ws, msg) {
  const peer = partner(ws);
  if (!peer) return;
  const room = rooms.get(ws.room);
  const d = msg.d;
  if (!d || typeof d !== 'object' || typeof d.t !== 'string') return;
  if (d.t === 'file-start') {
    const id = d.id;
    const name = d.name;
    if (room.relay || typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,60}$/.test(id) ||
        typeof name !== 'string' || !name || name.length > 200 ||
        !Number.isSafeInteger(d.size) || d.size < 0 || d.size > MAX_RELAY) {
      send(ws, { t:'relay-control', d: { t:'file-error', id, message:'Ретрансляция занята или файл больше 200 МБ.' } });
      return;
    }
    room.relay = { sender: ws, recipient: peer, id, size: d.size, bytes: 0, accepted: false };
    send(peer, { t:'relay-control', d: { t:'file-start', id, name, size:d.size, mime:typeof d.mime==='string' ? d.mime.slice(0,120) : '' } });
    return;
  }
  const x = room.relay;
  if (!x || d.id !== x.id) return;
  if (d.t === 'file-ready' && ws === x.recipient) {
    x.accepted = true;
    send(x.sender, { t:'relay-control', d: { t:'file-ready', id:x.id } });
  } else if (d.t === 'chunk-ack' && ws === x.recipient) {
    send(x.sender, { t:'relay-control', d: { t:'chunk-ack', id:x.id } });
  } else if (d.t === 'file-end' && ws === x.sender && x.accepted && x.bytes === x.size) {
    send(x.recipient, { t:'relay-control', d: { t:'file-end', id:x.id } });
  } else if (d.t === 'file-done' && ws === x.recipient) {
    send(x.sender, { t:'relay-control', d: { t:'file-done', id:x.id } });
    room.relay = null;
  } else if (d.t === 'file-error' && (ws === x.sender || ws === x.recipient)) {
    send(ws === x.sender ? x.recipient : x.sender, { t:'relay-control', d: { t:'file-error', id:x.id, message:'Передача прервана.' } });
    room.relay = null;
  }
}

export function createServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    if (url.pathname === '/api/health') {
      headers(res, 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: true, mode: 'p2p-with-relay', storedFiles: 0 }));
      return;
    }
    if (url.pathname === '/api/qr') {
      const room = url.searchParams.get('room');
      if (!ROOM_RE.test(room || '')) { res.writeHead(400); res.end('Invalid room'); return; }
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      if (typeof host !== 'string' || !/^[a-zA-Z0-9.-]+(?::\d{1,5})?$/.test(host)) { res.writeHead(400); res.end('Invalid host'); return; }
      const scheme = req.headers['x-forwarded-proto'] === 'https' || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? 'https' : 'http';
      try {
        const svg = await QRCode.toString(`${scheme}://${host}/#${room}`, { type:'svg', margin:2, width:320, errorCorrectionLevel:'M' });
        headers(res, 'image/svg+xml');
        res.end(svg);
      } catch { res.writeHead(500); res.end('QR error'); }
      return;
    }
    const imageAsset = /^\/assets\/[a-z0-9-]+\.webp$/.test(url.pathname);
    if (!files.has(url.pathname) && !imageAsset) { res.writeHead(404); res.end('Not found'); return; }
    try {
      const body = await fs.readFile(path.join(publicRoot, imageAsset ? url.pathname.slice(1) : files.get(url.pathname)));
      headers(res, imageAsset ? 'image/webp' : types.get(url.pathname));
      if (imageAsset) res.setHeader('Cache-Control', 'public, max-age=86400');
      res.end(body);
    } catch { res.writeHead(500); res.end('Server error'); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url || '/', 'http://localhost').pathname !== '/ws' || !checkOrigin(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  wss.on('connection', ws => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (raw, binary) => {
      if (binary) {
        if (raw.length > MAX_BINARY || !ws.room) return;
        const room = rooms.get(ws.room);
        const x = room?.relay;
        if (!x || x.sender !== ws || !x.accepted || x.bytes + raw.length > x.size) return;
        x.bytes += raw.length;
        if (x.recipient.readyState === WebSocket.OPEN) x.recipient.send(raw, { binary: true });
        return;
      }
      let msg;
      try { msg = JSON.parse(raw.toString('utf8')); } catch { return; }
      if (!msg || typeof msg.t !== 'string') return;
      if (msg.t === 'join') {
        if (ws.room) return;
        const code = msg.room;
        if (typeof code !== 'string' || !ROOM_RE.test(code)) { send(ws, { t:'error', message:'Неверный код комнаты' }); return; }
        let room = rooms.get(code);
        if (!room) {
          if (rooms.size >= 500) { send(ws, { t:'error', message:'Слишком много комнат' }); return; }
          room = { peers:new Set(), relay:null };
          rooms.set(code, room);
        }
        if (room.peers.size >= 2) { send(ws, { t:'error', message:'Комната уже занята двумя устройствами' }); return; }
        const first = [...room.peers][0];
        room.peers.add(ws);
        ws.room = code;
        send(ws, { t:'joined', connected: !!first });
        if (first) {
          send(first, { t:'peer-ready', initiator:true });
          send(ws, { t:'peer-ready', initiator:false });
        }
        return;
      }
      if (!ws.room) return;
      if (msg.t === 'signal') {
        const d = msg.d;
        if (!d || typeof d !== 'object' || !['offer','answer','candidate'].includes(d.type)) return;
        send(partner(ws), { t:'signal', d });
      } else if (msg.t === 'relay-control') {
        handleControl(ws, msg);
      }
    });
    ws.on('close', () => remove(ws));
    ws.on('error', () => remove(ws));
  });
  const ping = setInterval(() => {
    for (const client of wss.clients) {
      if (!client.isAlive) { client.terminate(); continue; }
      client.isAlive = false; client.ping();
    }
  }, 30000);
  ping.unref();
  server.on('close', () => { clearInterval(ping); for (const ws of wss.clients) ws.terminate(); });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 10000);
  createServer().listen(port, '0.0.0.0', () => console.log(`PhoneDrop P2P running on port ${port}`));
}
