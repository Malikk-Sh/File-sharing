const $ = id => document.getElementById(id);
const MAX_P2P = 500 * 1024 * 1024;
const MAX_RELAY = 200 * 1024 * 1024;
const CHUNK = 16 * 1024;
const WINDOW = 8;
const VALID_ROOM = /^[A-HJ-NP-Z2-9]{10}$/;
const STUN = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
const historyItems = new Map();
let ws, pc, channel, room, paired = false, sending = false, retryTimer = null;
let queuedCandidates = [], tx = null, rx = null, remoteSession = 0;
let selectedFiles = [], fileFilter = 'all', activeScreen = 'room', toastTimer = null;

function randCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return [...bytes].map(x => alphabet[x % alphabet.length]).join('');
}
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  const units = ['КБ', 'МБ', 'ГБ'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unit]}`;
}
function showMessage(text, error = false) {
  $('message').textContent = text;
  $('message').style.color = error ? 'var(--red)' : 'var(--muted)';
  if ($('sendOverlay').hidden) {
    $('toast').textContent = text;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 5500 : 2700);
  }
}
function setProgress(done, total, label) {
  const value = Math.max(0, Math.min(100, total ? done / total * 100 : 0));
  $('progress').hidden = false;
  $('progressFill').style.width = `${value}%`;
  const percent = total ? Math.round(done / total * 100) : 0;
  $('transferMini').hidden = false;
  $('miniTitle').textContent = label === 'Приём' ? 'Получаем файл' : 'Отправляем файл';
  $('miniDetail').textContent = `${formatBytes(done)} из ${formatBytes(total)} · ${percent}%`;
  $('miniFill').style.width = `${percent}%`;
  $('message').textContent = `${label}: ${formatBytes(done)} / ${formatBytes(total)}`;
}
function setServer(live) {
  const node = $('serverState');
  node.classList.toggle('live', !!live);
  node.classList.toggle('offline', !live);
  node.querySelector('span').textContent = live ? 'Сервер доступен' : 'Сервер недоступен';
}
function setPeer(text, ok = false) {
  $('peerState').textContent = text;
  $('peerChip').classList.toggle('connected', !!ok);
}
function setMethod(text) { $('method').textContent = text; }
function initRoom() {
  let hash = location.hash.replace(/^#/, '').trim().toUpperCase();
  if (!VALID_ROOM.test(hash)) hash = randCode();
  room = hash;
  history.replaceState(null, '', `/#${room}`);
  $('roomCode').textContent = room;
  $('qrRoomCode').textContent = room;
  $('roomLink').textContent = location.href;
}
function escapeRoom(roomCode) { return encodeURIComponent(roomCode); }
async function copy(text) {
  try { await navigator.clipboard.writeText(text); showMessage('Скопировано'); }
  catch { showMessage('Не удалось скопировать. Можно выделить вручную.', true); }
}
function ensureEmptyState() {
  const empty = $('downloads').querySelector('.empty-files');
  if (historyItems.size) empty?.remove();
}
function applyFilter() {
  let visible = 0;
  for (const entry of historyItems.values()) {
    const shown = fileFilter === 'all' || entry.direction === fileFilter;
    entry.node.hidden = !shown;
    if (shown) visible++;
  }
  $('downloads').querySelector('.empty-filter')?.remove();
  if (historyItems.size && !visible) {
    const p = document.createElement('p'); p.className = 'empty-filter';
    p.textContent = fileFilter === 'incoming' ? 'Полученных файлов пока нет' : 'Отправленных файлов пока нет';
    $('downloads').append(p);
  }
}
function getKindLabel(kind) { return kind === 'p2p' ? 'P2P' : 'через Render'; }
function getDirectionLabel(direction) { return direction === 'incoming' ? 'Получен' : 'Отправлен'; }
function createActions(entry) {
  const wrap = document.createElement('div');
  wrap.className = 'file-actions';
  if (entry.url) {
    const download = document.createElement('a');
    download.href = entry.url;
    download.download = entry.name;
    download.textContent = 'Скачать';
    wrap.append(download);
  }
  if (entry.shareFile && typeof navigator.canShare === 'function' && typeof navigator.share === 'function' && navigator.canShare({ files: [entry.shareFile] })) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Поделиться / Сохранить';
    btn.addEventListener('click', async () => {
      try { await navigator.share({ files: [entry.shareFile], title: entry.name }); }
      catch (err) { if (err.name !== 'AbortError') showMessage('Не удалось открыть системное меню. Используй «Скачать».', true); }
    });
    wrap.append(btn);
  }
  return wrap;
}
function renderHistory(entry) {
  let card = historyItems.get(entry.id)?.node;
  if (!card) {
    ensureEmptyState();
    card = document.createElement('article');
    card.className = 'file-card';
    card.innerHTML = `<div class="file-type-icon"></div>
      <div class="file-main"><div class="file-name"></div><div class="file-meta"></div>
        <div class="file-state-line"><span class="file-badge"></span><span class="state-badge"></span></div>
        <div class="file-progress" hidden><span></span></div></div>
      <div class="file-actions"></div>`;
    $('downloads').prepend(card);
  }
  historyItems.set(entry.id, { ...entry, node: card });
  const current = historyItems.get(entry.id);
  card.dataset.direction = current.direction;
  const icon = card.querySelector('.file-type-icon');
  const ext = (current.name || '').split('.').pop().toLowerCase();
  const isImg = ['png','jpg','jpeg','heic','webp','gif','bmp','mov','mp4'].includes(ext);
  icon.textContent = isImg ? '▧' : ['zip','rar','7z','tar','gz'].includes(ext) ? '▣' : ['pdf','doc','docx','sql','txt'].includes(ext) ? '▤' : '◇';
  icon.dataset.ext = isImg ? 'img' : ['zip','rar','7z','tar','gz'].includes(ext) ? 'zip' : 'doc';
  card.querySelector('.file-name').textContent = current.name;
  const metaParts = [formatBytes(current.size)];
  if (current.kind) metaParts.push(getKindLabel(current.kind));
  card.querySelector('.file-meta').textContent = metaParts.join(' · ');
  const dir = card.querySelector('.file-badge');
  dir.textContent = current.direction === 'incoming' ? '↓ Получен' : '↑ Отправлен';
  dir.className = `file-badge ${current.direction}`;
  const state = card.querySelector('.state-badge');
  state.textContent = current.statusText;
  state.className = `state-badge ${current.status === 'error' ? 'error' : current.status === 'progress' ? 'progress' : ''}`;
  const progress = card.querySelector('.file-progress');
  if (typeof current.progress === 'number' && current.status === 'progress') {
    progress.hidden = false;
    progress.querySelector('span').style.width = `${Math.max(0, Math.min(100, current.progress))}%`;
  } else progress.hidden = true;
  card.querySelector('.file-actions').replaceWith(createActions(current));
  applyFilter();
}
function upsertHistory(entry) {
  const prev = historyItems.get(entry.id) || {};
  const merged = { ...prev, ...entry };
  renderHistory(merged);
  ensureEmptyState();
}
function markHistoryError(id, text) {
  if (!historyItems.has(id)) return;
  upsertHistory({ id, status: 'error', statusText: text || 'Ошибка', progress: null });
}
function sendWs(data) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); }
function control(kind, payload) {
  if (kind === 'p2p') {
    if (channel?.readyState !== 'open') throw new Error('P2P-канал закрыт');
    channel.send(JSON.stringify(payload));
  } else sendWs({ t: 'relay-control', d: payload });
}
async function dataFrame(kind, data) {
  if (kind === 'p2p') {
    if (channel?.readyState !== 'open') throw new Error('P2P-канал закрыт');
    channel.send(data);
  } else if (ws?.readyState === WebSocket.OPEN) ws.send(data);
  else throw new Error('Нет соединения с сервером');
}
function settleSignal(transfer, key) { transfer.waiters[key]?.resolve(); delete transfer.waiters[key]; }
function rejectWaiters(transfer, message) {
  for (const key of Object.keys(transfer.waiters || {})) transfer.waiters[key].reject(new Error(message));
  transfer.waiters = {};
}
function awaitSignal(transfer, key, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      delete transfer.waiters[key];
      reject(new Error('Второе устройство не ответило вовремя'));
    }, timeout);
    transfer.waiters[key] = {
      resolve: () => { clearTimeout(timer); resolve(); },
      reject: err => { clearTimeout(timer); reject(err instanceof Error ? err : new Error(String(err))); }
    };
  });
}
function closeRtc() {
  if (channel) { try { channel.close(); } catch {} }
  if (pc) { try { pc.close(); } catch {} }
  channel = null; pc = null; queuedCandidates = [];
}
function attachChannel(next) {
  channel = next;
  channel.binaryType = 'arraybuffer';
  channel.onopen = () => setMethod('P2P — напрямую между устройствами');
  channel.onclose = () => { if (paired) setMethod('P2P закрыт · можно использовать резерв через Render'); };
  channel.onmessage = event => onPayload(event.data, 'p2p');
}
function createRtc() {
  if (pc) return pc;
  pc = new RTCPeerConnection({ iceServers: STUN });
  pc.ondatachannel = event => attachChannel(event.channel);
  pc.onicecandidate = event => { if (event.candidate) sendWs({ t:'signal', d:{ type:'candidate', candidate:event.candidate.toJSON() } }); };
  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    if (state === 'failed') setMethod('P2P не удалось · доступен режим через Render');
    if (state === 'disconnected' && paired) setMethod('Соединение нестабильно · пробуем удержать канал');
  };
  return pc;
}
async function flushCandidates() {
  const list = queuedCandidates.splice(0);
  for (const item of list) { try { await pc.addIceCandidate(new RTCIceCandidate(item)); } catch {} }
}
async function handleSignal(d) {
  if (!paired || !d) return;
  try {
    const p = createRtc();
    if (d.type === 'offer') {
      await p.setRemoteDescription(new RTCSessionDescription({ type:'offer', sdp:d.sdp }));
      await flushCandidates();
      const answer = await p.createAnswer();
      await p.setLocalDescription(answer);
      sendWs({ t:'signal', d:{ type:'answer', sdp:p.localDescription.sdp } });
    } else if (d.type === 'answer') {
      await p.setRemoteDescription(new RTCSessionDescription({ type:'answer', sdp:d.sdp }));
      await flushCandidates();
    } else if (d.type === 'candidate' && d.candidate) {
      if (p.remoteDescription) await p.addIceCandidate(new RTCIceCandidate(d.candidate));
      else queuedCandidates.push(d.candidate);
    }
  } catch (err) {
    setMethod(`P2P: ${err.message}. Резерв: сервер Render`);
  }
}
async function startP2pOffer() {
  try {
    const p = createRtc();
    attachChannel(p.createDataChannel('phonedrop-file', { ordered: true }));
    const offer = await p.createOffer();
    await p.setLocalDescription(offer);
    sendWs({ t:'signal', d:{ type:'offer', sdp:p.localDescription.sdp } });
  } catch (err) { setMethod(`P2P: ${err.message}. Резерв: сервер Render`); }
}
function resetTransfers(message) {
  if (tx) { markHistoryError(tx.id, message); rejectWaiters(tx, message); tx = null; }
  if (rx) { markHistoryError(rx.id, message); rx = null; }
  $('progress').hidden = true;
  $('transferMini').hidden = true;
}
function onPayload(payload, kind) {
  if (typeof payload !== 'string') {
    if (payload instanceof ArrayBuffer) acceptChunk(payload, kind);
    else if (payload instanceof Blob) payload.arrayBuffer().then(buffer => acceptChunk(buffer, kind));
    return;
  }
  let msg;
  try { msg = JSON.parse(payload); } catch { return; }
  if (!msg || typeof msg.t !== 'string') return;
  if (msg.t === 'file-start') {
    if (rx || !/^[a-zA-Z0-9-]{1,60}$/.test(msg.id || '') || typeof msg.name !== 'string' || !msg.name || msg.name.length > 200 || !Number.isSafeInteger(msg.size) || msg.size < 0 || msg.size > (kind === 'relay' ? MAX_RELAY : MAX_P2P)) {
      control(kind, { t:'file-error', id:msg.id, message:'Приём занят или размер файла неверный' });
      return;
    }
    rx = { id:msg.id, name:msg.name, size:msg.size, mime:msg.mime || 'application/octet-stream', kind, chunks:[], bytes:0, count:0 };
    upsertHistory({ id: rx.id, name: rx.name, size: rx.size, kind: rx.kind, direction: 'incoming', status: 'progress', statusText: 'Получение…', progress: 0, note: 'входящий файл' });
    setProgress(0, rx.size, 'Приём');
    control(kind, { t:'file-ready', id:rx.id });
  } else if (msg.t === 'file-ready' && tx?.id === msg.id && tx.kind === kind) settleSignal(tx, 'ready');
  else if (msg.t === 'chunk-ack' && tx?.id === msg.id && tx.kind === kind) settleSignal(tx, 'ack');
  else if (msg.t === 'file-done' && tx?.id === msg.id && tx.kind === kind) settleSignal(tx, 'done');
  else if (msg.t === 'file-error') {
    if (tx && msg.id === tx.id) { markHistoryError(tx.id, msg.message || 'Передача прервана'); rejectWaiters(tx, msg.message || 'Второе устройство отклонило файл'); }
    if (rx && msg.id === rx.id) { markHistoryError(rx.id, msg.message || 'Передача прервана'); rx = null; }
    showMessage(msg.message || 'Ошибка передачи', true);
  } else if (msg.t === 'file-end' && rx?.id === msg.id && rx.kind === kind) finishReceive();
}
function acceptChunk(buffer, kind) {
  if (!rx || rx.kind !== kind) return;
  if (rx.bytes + buffer.byteLength > rx.size) {
    control(rx.kind, { t:'file-error', id:rx.id, message:'Превышен объявленный размер файла' });
    markHistoryError(rx.id, 'Ошибка размера');
    rx = null;
    return;
  }
  rx.chunks.push(buffer);
  rx.bytes += buffer.byteLength;
  rx.count++;
  if (rx.count % WINDOW === 0 || rx.bytes === rx.size) control(rx.kind, { t:'chunk-ack', id:rx.id });
  const progress = rx.size ? (rx.bytes / rx.size * 100) : 0;
  upsertHistory({ id: rx.id, progress, status: 'progress', statusText: `Получение ${Math.round(progress)}%` });
  setProgress(rx.bytes, rx.size, 'Приём');
}
function finishReceive() {
  const current = rx;
  rx = null;
  if (current.bytes !== current.size) {
    control(current.kind, { t:'file-error', id:current.id, message:'Файл получен не полностью' });
    markHistoryError(current.id, 'Файл получен не полностью');
    showMessage('Не удалось получить весь файл.', true);
    return;
  }
  const blob = new Blob(current.chunks, { type: current.mime });
  const url = URL.createObjectURL(blob);
  const file = new File([blob], current.name, { type: blob.type || 'application/octet-stream' });
  upsertHistory({
    id: current.id,
    direction: 'incoming',
    status: 'done',
    statusText: 'Готово',
    progress: null,
    url,
    shareFile: file,
    note: 'доступен для сохранения'
  });
  control(current.kind, { t:'file-done', id:current.id });
  $('progress').hidden = true;
  $('transferMini').hidden = true;
  showMessage(`Получен файл «${current.name}». Его можно скачать или сохранить через системное меню.`);
}
function onServerMessage(event) {
  let msg;
  try { msg = JSON.parse(event.data); } catch { return; }
  if (msg.t === 'joined') {
    paired = !!msg.connected;
    setServer(true);
    setPeer(msg.connected ? 'Второе устройство в комнате — соединяем…' : 'Ожидание второго устройства…', msg.connected);
  } else if (msg.t === 'peer-ready') {
    paired = true;
    remoteSession++;
    setPeer('Второе устройство подключено', true);
    setMethod('Устанавливаем P2P…');
    if (msg.initiator) startP2pOffer();
  } else if (msg.t === 'peer-left') {
    paired = false;
    remoteSession++;
    closeRtc();
    resetTransfers('Второе устройство отключилось');
    setPeer('Второе устройство отключилось. Ожидание…');
    showMessage('Второе устройство отключилось. Открой комнату повторно.', true);
  } else if (msg.t === 'signal') handleSignal(msg.d);
  else if (msg.t === 'relay-control') onPayload(JSON.stringify(msg.d), 'relay');
  else if (msg.t === 'error') showMessage(msg.message || 'Ошибка комнаты', true);
}
function connect() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
  ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => { setServer(true); sendWs({ t:'join', room }); };
  ws.onmessage = event => { if (typeof event.data === 'string') onServerMessage(event); else onPayload(event.data, 'relay'); };
  ws.onerror = () => setServer(false);
  ws.onclose = () => {
    setServer(false); paired = false; remoteSession++;
    closeRtc(); resetTransfers('Сервер временно недоступен');
    setPeer('Соединение с сервером потеряно');
    retryTimer = setTimeout(connect, 3500);
  };
}
async function chooseTransport(file) {
  if (!paired || ws?.readyState !== WebSocket.OPEN) throw new Error('Сначала открой комнату на втором устройстве');
  const requested = $('mode').value;
  if (requested === 'relay') {
    if (file.size > MAX_RELAY) throw new Error('Через сервер можно отправить максимум 200 МБ. Для большего файла выбери P2P.');
    return 'relay';
  }
  if (channel?.readyState === 'open') return 'p2p';
  const session = remoteSession;
  setMethod('Ожидаем прямое P2P-соединение…');
  for (let i = 0; i < 24; i++) {
    if (session !== remoteSession || !paired) throw new Error('Второе устройство отключилось');
    if (channel?.readyState === 'open') return 'p2p';
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if ($('mode').value === 'p2p') throw new Error('P2P не удалось установить. Попробуй режим «Авто».');
  if (file.size > MAX_RELAY) throw new Error('P2P недоступен, а резервная передача через Render ограничена 200 МБ.');
  return 'relay';
}
async function sendFile(file) {
  if (file.size > MAX_P2P) throw new Error('Максимальный размер файла — 500 МБ');
  const kind = await chooseTransport(file);
  setMethod(kind === 'p2p' ? 'P2P — напрямую между устройствами' : 'Передача через Render — резервный режим');
  const transfer = { id: crypto.randomUUID(), kind, waiters: {} };
  tx = transfer;
  upsertHistory({ id: transfer.id, name: file.name, size: file.size, kind, direction: 'outgoing', status: 'progress', statusText: 'Подготовка…', progress: 0, note: 'исходящий файл' });
  try {
    const ready = awaitSignal(transfer, 'ready', 30000);
    control(kind, { t:'file-start', id:transfer.id, name:file.name, size:file.size, mime:file.type || 'application/octet-stream' });
    await ready;
    upsertHistory({ id: transfer.id, statusText: 'Отправка…', progress: 0 });
    let offset = 0;
    while (offset < file.size) {
      const ack = awaitSignal(transfer, 'ack', 60000);
      for (let i = 0; i < WINDOW && offset < file.size; i++) {
        const end = Math.min(offset + CHUNK, file.size);
        const data = await file.slice(offset, end).arrayBuffer();
        await dataFrame(kind, data);
        offset = end;
      }
      await ack;
      const progress = file.size ? (offset / file.size * 100) : 0;
      upsertHistory({ id: transfer.id, status: 'progress', statusText: `Отправка ${Math.round(progress)}%`, progress });
      setProgress(offset, file.size, 'Отправка');
    }
    const done = awaitSignal(transfer, 'done', 30000);
    control(kind, { t:'file-end', id:transfer.id });
    await done;
    $('progress').hidden = true;
    $('transferMini').hidden = true;
    upsertHistory({ id: transfer.id, status: 'done', statusText: 'Отправлено', progress: null, note: 'отправлено в комнату' });
    showMessage(`Файл «${file.name}» передан на второе устройство.`);
  } catch (err) {
    markHistoryError(transfer.id, err.message || 'Передача прервана');
    rejectWaiters(transfer, err.message || 'Передача прервана');
    try { control(kind, { t:'file-error', id:transfer.id, message:'Передача прервана' }); } catch {}
    throw err;
  } finally {
    if (tx === transfer) tx = null;
  }
}
async function uploadFiles(files) {
  if (sending) { showMessage('Дождись завершения предыдущей передачи', true); return; }
  sending = true;
  try {
    for (const file of files) await sendFile(file);
  } catch (err) {
    $('progress').hidden = true;
    $('transferMini').hidden = true;
    showMessage(err.message || 'Неизвестная ошибка', true);
  } finally {
    sending = false;
    $('fileInput').value = '';
    $('cameraInput').value = '';
    $('mediaInput').value = '';
    $('folderInput').value = '';
  }
}

function navigate(screen) {
  activeScreen = screen;
  for (const panel of document.querySelectorAll('[data-screen]')) {
    const chosen = panel.dataset.screen === screen;
    panel.hidden = !chosen;
    panel.classList.toggle('is-active', chosen);
    if (chosen) panel.scrollTop = 0;
  }
  for (const tab of document.querySelectorAll('[data-go]')) {
    tab.classList.toggle('current', tab.dataset.go === screen);
    if (tab.dataset.go === screen) tab.setAttribute('aria-current','page');
    else tab.removeAttribute('aria-current');
  }
  if (screen === 'connect') showConnectTab(connectTab);
  if (screen === 'files') applyFilter();
}
let connectTab = 'code';
function showConnectTab(tab) {
  connectTab = tab;
  for (const button of document.querySelectorAll('[data-connect-tab]')) {
    const active = button.dataset.connectTab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  }
  for (const pane of document.querySelectorAll('[data-connect-pane]')) pane.hidden = pane.dataset.connectPane !== tab;
  if (tab === 'qr') $('qrImage').src = `/api/qr?room=${escapeRoom(room)}`;
}
function openOverlay(which) {
  const el = $(`${which}Overlay`);
  el.hidden = false;
  if (which === 'send') updateSelection();
}
function closeOverlay(which) { $(`${which}Overlay`).hidden = true; }
function addSelection(files) {
  if (sending) { showMessage('Дождись завершения текущей передачи',true); return; }
  selectedFiles.push(...files);
  updateSelection();
}
function updateSelection() {
  const hasFiles = selectedFiles.length > 0;
  $('selectedWrapper').hidden = !hasFiles;
  $('selectedCount').textContent = selectedFiles.length;
  $('selectedList').replaceChildren();
  let sum = 0;
  selectedFiles.forEach((file, i) => {
    sum += file.size;
    const chip = document.createElement('div'); chip.className = 'selected-chip';
    chip.textContent = file.name;
    const remove = document.createElement('button');remove.type='button';remove.textContent='×';remove.title='Убрать файл';
    remove.addEventListener('click', () => {selectedFiles.splice(i,1);updateSelection();});
    chip.append(remove);$('selectedList').append(chip);
  });
  $('sendSelected').disabled = !hasFiles || sending;
  $('sendSelectedLabel').textContent = !hasFiles ? 'Выбери файлы' : `Отправить ${selectedFiles.length} · ${formatBytes(sum)}`;
}
initRoom();
connect();
setInterval(() => { if (ws?.readyState === WebSocket.OPEN) sendWs({ t:'keepalive' }); }, 25000);
for (const tab of document.querySelectorAll('[data-go]')) tab.addEventListener('click', () => navigate(tab.dataset.go));
for (const tab of document.querySelectorAll('[data-connect-tab]')) tab.addEventListener('click', () => showConnectTab(tab.dataset.connectTab));
for (const switcher of document.querySelectorAll('[data-switch-connect]')) switcher.addEventListener('click', () => showConnectTab(switcher.dataset.switchConnect));
for (const tab of document.querySelectorAll('[data-filter]')) tab.addEventListener('click', () => {
  fileFilter = tab.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(x => {x.classList.toggle('active', x === tab);x.setAttribute('aria-selected', String(x === tab));});
  applyFilter();
});
$('roomSend').addEventListener('click', () => openOverlay('send'));
$('navSend').addEventListener('click', () => openOverlay('send'));
$('emptySend').addEventListener('click', () => openOverlay('send'));
$('miniOpen').addEventListener('click', () => openOverlay('send'));
$('openSettings').addEventListener('click', () => openOverlay('settings'));
$('closeSettings').addEventListener('click', () => closeOverlay('settings'));
$('closeSend').addEventListener('click', () => closeOverlay('send'));
for (const backdrop of document.querySelectorAll('[data-close-overlay]')) backdrop.addEventListener('click', () => closeOverlay(backdrop.dataset.closeOverlay));
$('copyCode').addEventListener('click', () => copy(room));
$('copyLink').addEventListener('click', () => copy(location.href));
$('qrCopyLink').addEventListener('click', () => copy(location.href));
$('newRoom').addEventListener('click', () => { location.href = `/#${randCode()}`; location.reload(); });
$('settingsNewRoom').addEventListener('click', () => { location.href = `/#${randCode()}`; location.reload(); });
$('shareRoom').addEventListener('click', async () => {
  if (typeof navigator.share === 'function') {
    try { await navigator.share({title:'PhoneDrop — комната',text:`Код комнаты: ${room}`,url:location.href}); }
    catch(err) { if(err.name !== 'AbortError') await copy(location.href); }
  } else await copy(location.href);
});
$('showQr').addEventListener('click', () => { navigate('connect'); showConnectTab('qr'); });
$('joinForm').addEventListener('submit', event => {
  event.preventDefault();
  const code = $('joinCode').value.trim().toUpperCase();
  if (!VALID_ROOM.test(code)) {showMessage('Нужен код из 10 символов, без O, 0, I, 1',true);return;}
  location.href = `/#${code}`; location.reload();
});
for (const id of ['fileInput','cameraInput','mediaInput','folderInput']) {
  $(id).addEventListener('change', event => {if(event.target.files.length) addSelection([...event.target.files]);event.target.value='';});
}
$('clearSelection').addEventListener('click', () => {selectedFiles=[];updateSelection();});
$('sendSelected').addEventListener('click', async () => {
  if (!selectedFiles.length || sending) return;
  const files = [...selectedFiles]; selectedFiles=[];
  updateSelection();
  closeOverlay('send');
  await uploadFiles(files);
  updateSelection();
});
$('dropZone').addEventListener('dragover', event => event.preventDefault());
$('dropZone').addEventListener('drop', event => {event.preventDefault();if(event.dataTransfer.files.length)addSelection([...event.dataTransfer.files]);});
$('dropZone').addEventListener('keydown', event => {if(event.target === $('dropZone') && ['Enter',' '].includes(event.key)){event.preventDefault();$('fileInput').click();}});
window.addEventListener('keydown', event => {if(event.key === 'Escape'){closeOverlay('send');closeOverlay('settings');}});
