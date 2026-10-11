import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createServer } from '../server.js';

let server;
let base;
let wsBase;
const sockets = new Set();

before(async () => {
  server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}/ws`;
});
after(async () => {
  for (const socket of sockets) socket.terminate();
  await new Promise(resolve => server.close(resolve));
});

async function connect() {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsBase, { origin:base });
    socket.messages = [];
    socket.on('message', (buffer, isBinary) => {
      socket.messages.push(isBinary ? buffer : JSON.parse(buffer.toString()));
    });
    socket.once('open', () => { sockets.add(socket); resolve(socket); });
    socket.once('error', reject);
  });
}
async function waitMsg(socket, predicate, timeout = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const idx = socket.messages.findIndex(predicate);
    if (idx !== -1) return socket.messages.splice(idx, 1)[0];
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('Timed out waiting for WebSocket message');
}
function send(socket, msg) { socket.send(JSON.stringify(msg)); }

// These tests can be run with `npm test` after installing dependencies.
test('health and static assets', async () => {
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok:true, mode:'p2p-with-relay', storedFiles:0 });
  const html = await (await fetch(base)).text();
  assert.match(html, /PhoneDrop/);
  assert.match(html, /app\.js/);
  assert.match(html, /id=\"shareRoom\"/);
  assert.match(html, /id=\"cameraInput\"/);
  assert.match(html, /Файлы ближе/);
  assert.match(html, /data-screen="room"/);
  assert.match(html, /data-screen="files"/);
  // Regression: Motion features must actually be served by the HTTP server.
  for (const [asset,mime,marker] of [
    ['finishing.js','application/javascript','phonedrop:light-animations'],
    ['finishing.css','text/css','motion-preference']
  ]) {
    const resp=await fetch(`${base}/${asset}?v=3`);
    assert.equal(resp.status,200,`${asset} must not be 404`);
    assert.match(resp.headers.get('content-type')||'',new RegExp(mime));
    assert.match(await resp.text(),new RegExp(marker));
  }
  const art = await fetch(`${base}/assets/phones-orbit.webp`);
  assert.equal(art.status, 200);
  assert.match(art.headers.get('content-type'), /image\/webp/);
});

test('QR encodes the correct room URL', async () => {
  const qr = await fetch(`${base}/api/qr?room=ABCDEFGHJK`);
  assert.equal(qr.status, 200);
  assert.match(await qr.text(), /<svg/);
  const bad = await fetch(`${base}/api/qr?room=INVALID123`);
  assert.equal(bad.status, 400);
});

test('two browsers join, exchange signaling and relay a ZIP/SQL byte sequence', async () => {
  const a = await connect();
  const b = await connect();
  const c = await connect();
  const room = 'ABCDEFGHJK';
  send(a, { t:'join', room });
  assert.equal((await waitMsg(a, x => x.t === 'joined')).connected, false);
  send(b, { t:'join', room });
  assert.equal((await waitMsg(b, x => x.t === 'joined')).connected, true);
  assert.equal((await waitMsg(a, x => x.t === 'peer-ready')).initiator, true);
  assert.equal((await waitMsg(b, x => x.t === 'peer-ready')).initiator, false);

  send(c, { t:'join', room });
  assert.match((await waitMsg(c, x => x.t === 'error')).message, /занята/);

  send(a, { t:'signal', d:{ type:'offer', sdp:'test-sdp' } });
  assert.equal((await waitMsg(b, x => x.t === 'signal')).d.sdp, 'test-sdp');

  const buf = Buffer.from('CREATE TABLE test(id int);\nZIP\u0000DATA');
  const meta = { t:'file-start', id:'transfer1', name:'база.sql', size:buf.length, mime:'application/sql' };
  send(a, { t:'relay-control', d:meta });
  const receiveMeta = await waitMsg(b, x => x.t === 'relay-control' && x.d.t === 'file-start');
  assert.equal(receiveMeta.d.name, 'база.sql');
  send(b, { t:'relay-control', d:{ t:'file-ready', id:'transfer1' } });
  await waitMsg(a, x => x.t === 'relay-control' && x.d.t === 'file-ready');
  a.send(buf);
  const received = await waitMsg(b, x => Buffer.isBuffer(x));
  assert.deepEqual(received, buf);
  send(b, { t:'relay-control', d:{ t:'chunk-ack', id:'transfer1' } });
  await waitMsg(a, x => x.t === 'relay-control' && x.d.t === 'chunk-ack');
  send(a, { t:'relay-control', d:{ t:'file-end', id:'transfer1' } });
  await waitMsg(b, x => x.t === 'relay-control' && x.d.t === 'file-end');
  send(b, { t:'relay-control', d:{ t:'file-done', id:'transfer1' } });
  await waitMsg(a, x => x.t === 'relay-control' && x.d.t === 'file-done');

  send(a, { t:'relay-control', d:{ t:'file-start', id:'too-large', name:'huge.zip', size:201 * 1024 * 1024, mime:'application/zip' } });
  const error = await waitMsg(a, x => x.t === 'relay-control' && x.d.t === 'file-error');
  assert.match(error.d.message, /200 МБ/);
  a.close(); b.close(); c.close();
});

test('websocket rejects cross-site origin', async () => {
  const result = await new Promise(resolve => {
    const socket = new WebSocket(wsBase, { origin:'https://attacker.example' });
    socket.on('unexpected-response', (_req, res) => { resolve(res.statusCode); socket.terminate(); });
    socket.on('error', () => {});
  });
  assert.equal(result, 403);
});
