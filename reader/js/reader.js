// Webtool MÁY ĐỌC SÁCH e-ink 4.2" (firmware epd_reader_4_2inch, dòng r1.x).
// Gửi sách chữ (.txt/.epub/.mobi) và truyện tranh (.cbz/ảnh) xuống thiết bị
// qua BLE theo giao thức EPD_CMD_BOOK (0x28) — xem README firmware.

let bleDevice, gattServer, epdService, epdCharacteristic;
let msgIndex, textDecoderInst, startTime;
let cfgPins = null;      // 11 byte chân màn hình từ config blob (tính xung đột nút)
let deviceFw = null;

const EpdCmd = {
  INIT: 0x01,
  BOOK: 0x28,
  BTN: 0x29,
};

const EPD_SERVICE = '62750001-d828-918d-fb46-b6c11c675aec';
const EPD_CHAR = '62750002-d828-918d-fb46-b6c11c675aec';

// kho sách trên máy: dữ liệu bắt đầu tại +0x3000 của bank, ~100KB dùng được
const BOOK_IDX_OFF = 0x1000;
const BOOK_DATA_OFF = 0x3000;
const MAX_DATA = 100 * 1024;
const MAX_PAGES_PART = 500;
const PLANE_SIZE = 15000; // 400x300 / 8

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ================= BLE core (rút gọn từ webtool 4_2inch) ================= */

function addLog(txt, action = '') {
  const log = document.getElementById('log');
  const now = new Date();
  const time = String(now.getHours()).padStart(2, '0') + ':' +
    String(now.getMinutes()).padStart(2, '0') + ':' +
    String(now.getSeconds()).padStart(2, '0') + ' ';
  const line = document.createElement('div');
  line.className = 'log-line';
  const t = document.createElement('span');
  t.className = 'time';
  t.textContent = time;
  line.appendChild(t);
  if (action) {
    const a = document.createElement('span');
    a.className = 'action';
    a.innerHTML = action;
    line.appendChild(a);
  }
  line.appendChild(document.createTextNode(txt));
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
  while (log.childNodes.length > 25) log.removeChild(log.firstChild);
}
function clearLog() { document.getElementById('log').innerHTML = ''; }
function setStatus(s) { document.getElementById('status').textContent = s; }

// thanh tiến độ tổng của phiên gửi sách (null = ẩn)
function setProgress(pct) {
  const el = document.getElementById('sendProgress');
  if (!el) return;
  if (pct === null) {
    el.style.display = 'none';
    el.value = 0;
    return;
  }
  el.style.display = '';
  el.value = Math.max(0, Math.min(100, pct));
}

function bytes2hex(data) {
  return new Uint8Array(data).reduce((m, i) => m + ('0' + i.toString(16)).slice(-2), '');
}
function hex2bytes(hex) {
  hex = (hex || '').replace(/[^0-9a-fA-F]/g, '');
  const out = [];
  for (let c = 0; c + 2 <= hex.length; c += 2) out.push(parseInt(hex.substr(c, 2), 16));
  return new Uint8Array(out);
}

async function write(cmd, data, withResponse = true) {
  if (!epdCharacteristic) {
    addLog('Chưa kết nối thiết bị.');
    return false;
  }
  let payload = [cmd];
  if (data) {
    if (typeof data === 'string') data = hex2bytes(data);
    if (data instanceof Uint8Array) data = Array.from(data);
    payload.push(...data);
  }
  try {
    if (withResponse) await epdCharacteristic.writeValueWithResponse(Uint8Array.from(payload));
    else await epdCharacteristic.writeValueWithoutResponse(Uint8Array.from(payload));
  } catch (e) {
    console.error(e);
    if (e.message) addLog('write: ' + e.message);
    return false;
  }
  return true;
}

async function sendcmd() {
  const s = document.getElementById('cmdTXT').value;
  if (!s) return;
  const b = hex2bytes(s);
  addLog(bytes2hex(b), '⇑');
  await write(b[0], b.length > 1 ? b.slice(1) : null);
}

// ---- chờ notify ----
let mtuNotifyResolve = null;
function waitMtuNotify(timeoutMs) {
  return new Promise(resolve => {
    const t = setTimeout(() => { mtuNotifyResolve = null; resolve(false); }, timeoutMs);
    mtuNotifyResolve = () => { clearTimeout(t); resolve(true); };
  });
}
let notifyWaiters = [];
// đợi một notify dạng chữ thỏa pred(msg) -> truthy; trả về giá trị pred trả ra
function waitNotify(pred, timeoutMs) {
  return new Promise((resolve, reject) => {
    const w = { pred, resolve, reject };
    w.timer = setTimeout(() => {
      notifyWaiters = notifyWaiters.filter(x => x !== w);
      reject(new Error('Hết thời gian chờ thiết bị trả lời'));
    }, timeoutMs);
    notifyWaiters.push(w);
  });
}
function feedNotifyWaiters(msg) {
  notifyWaiters = notifyWaiters.filter(w => {
    let v;
    try { v = w.pred(msg); } catch (e) { v = null; }
    if (v === undefined || v === null || v === false) return true;
    clearTimeout(w.timer);
    if (v instanceof Error) w.reject(v); else w.resolve(v);
    return false;
  });
}

function handleNotify(value, idx) {
  const data = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (idx === 0) {
    // config blob: chân màn hình 0..10, mode 11, chân nút 216..219,
    // rd_full_every 220, trang đang đọc (u16 LE) 222
    addLog('Nhận cấu hình thiết bị (' + data.length + ' byte)');
    cfgPins = Array.from(data.slice(0, 11));
    if (data.length >= 224) {
      setBtnSelect('btnNext', data[216]);
      setBtnSelect('btnPrev', data[217]);
      setBtnSelect('btnSel', data[218]);
      setBtnSelect('btnPwr', data[219]);
      const fe = data[220];
      const sel = document.getElementById('fullEvery');
      if ([5, 10, 20, 30].includes(fe)) sel.value = String(fe);
      const pg = data[222] | (data[223] << 8);
      if (pg !== 0xFFFF) document.getElementById('gotoPage').value = pg + 1;
    }
    updateBtnHint();
    return;
  }
  if (!textDecoderInst) textDecoderInst = new TextDecoder();
  const msg = textDecoderInst.decode(data);
  addLog(msg, '⇓');
  if (msg.startsWith('mtu=')) {
    const m = parseInt(msg.substring(4));
    if (m > 0) document.getElementById('mtusize').value = m;
    if (mtuNotifyResolve) { mtuNotifyResolve(); mtuNotifyResolve = null; }
  } else if (msg.startsWith('fw=')) {
    deviceFw = msg.substring(3);
    if (!deviceFw.startsWith('r')) {
      addLog('⚠ Thiết bị đang chạy firmware LỊCH chuẩn (' + deviceFw + '), không phải firmware máy đọc sách (rX.Y).');
      addLog('⚠ Hãy nạp firmware fw_reader_4_2inch_rX.Y.bin (mục OTA bên dưới) trước khi gửi sách.');
    }
  } else if (msg.startsWith('bki=')) {
    // máy đang phân trang sách chữ: ánh xạ số trang đã chốt vào 80..99% của
    // thanh tiến độ (idxEstPages ước lượng từ dung lượng chữ, ~1KB/trang)
    const n = parseInt(msg.substring(4)) || 0;
    setStatus(`Máy đang phân trang sách chữ... ${n}${idxEstPages ? '/~' + idxEstPages : ''} trang`);
    if (idxEstPages) setProgress(80 + 19 * Math.min(1, n / idxEstPages));
  } else if (msg.startsWith('flash=')) {
    // JEDEC ID chip SPI flash: [hãng][loại][dung lượng 2^n byte]
    const id = msg.substring(6);
    const vendors = { EF: 'Winbond', C8: 'GigaDevice', '85': 'Puya', C2: 'Macronix', '0B': 'XTX', '68': 'Boya', A1: 'Fudan', '1C': 'EON', BF: 'SST', '20': 'XMC/Micron' };
    const v = vendors[id.substring(0, 2).toUpperCase()] || ('hãng 0x' + id.substring(0, 2));
    const cap = parseInt(id.substring(4, 6), 16);
    const kb = cap > 10 && cap < 32 ? (1 << cap) / 1024 : 0;
    addLog(`Chip flash: ${v}, ${kb >= 1024 ? (kb / 1024) + 'MB' : kb + 'KB'} (JEDEC ${id})`);
  } else if (msg === 'locked') {
    addLog('⚠ Thiết bị chưa kích hoạt — liên hệ nhà cung cấp.');
  }
  feedNotifyWaiters(msg);
}

function resetVariables() {
  gattServer = null;
  epdService = null;
  epdCharacteristic = null;
  msgIndex = 0;
  cfgPins = null;
  deviceFw = null;
  notifyWaiters.forEach(w => { clearTimeout(w.timer); w.reject(new Error('Mất kết nối')); });
  notifyWaiters = [];
}

function disconnect() {
  updateButtonStatus();
  resetVariables();
  addLog('Đã ngắt kết nối.');
  document.getElementById('connectbutton').innerHTML = 'Kết nối';
}

async function connectGattWithRetry(device, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (device.gatt.connected) return device.gatt;
      if (attempt > 1) {
        addLog(`Thử kết nối lại ${attempt}/${maxAttempts}...`);
        try { device.gatt.disconnect(); } catch (e) { }
        await sleep(500 * attempt);
      }
      return await device.gatt.connect();
    } catch (e) { lastError = e; console.error(e); }
  }
  throw lastError;
}

async function preConnect() {
  if (gattServer != null && gattServer.connected) {
    if (bleDevice != null && bleDevice.gatt.connected) bleDevice.gatt.disconnect();
    return;
  }
  resetVariables();
  try {
    const debugMode = new URLSearchParams(window.location.search).get('debug') === 'true';
    bleDevice = await navigator.bluetooth.requestDevice(debugMode ? {
      acceptAllDevices: true,
      optionalServices: [EPD_SERVICE],
    } : {
      filters: [{ namePrefix: 'DIY-4_2R' }, { namePrefix: 'DIY-4_2' }],
      optionalServices: [EPD_SERVICE],
    });
  } catch (e) {
    console.error(e);
    if (e.name === 'NotFoundError') addLog('Không tìm thấy máy đọc sách (tên DIY-4_2R-xxxx).');
    else if (e.message) addLog('requestDevice: ' + e.message);
    addLog('Dùng Chrome/Edge (máy tính, Android) hoặc Bluefy (iOS), bật Bluetooth rồi thử lại.');
    return;
  }
  bleDevice.addEventListener('gattserverdisconnected', disconnect);
  await connect();
}

async function reConnect() {
  if (bleDevice != null && bleDevice.gatt.connected) bleDevice.gatt.disconnect();
  resetVariables();
  addLog('Đang kết nối lại');
  await connect();
}

async function connect() {
  if (bleDevice == null || epdCharacteristic != null) return;
  try {
    addLog('Đang kết nối: ' + bleDevice.name);
    gattServer = await connectGattWithRetry(bleDevice);
    epdService = await gattServer.getPrimaryService(EPD_SERVICE);
    epdCharacteristic = await epdService.getCharacteristic(EPD_CHAR);
    addLog('  Đã tìm thấy EPD Service');
  } catch (e) {
    console.error(e);
    addLog('connect: ' + (e.message || e.name));
    addLog('Gợi ý: xóa ghép nối Bluetooth cũ trong Windows, đưa thiết bị lại gần, thử lại.');
    disconnect();
    return;
  }
  try {
    epdCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
      handleNotify(event.target.value, msgIndex++);
    });
    try { await epdCharacteristic.stopNotifications(); } catch (e) { }
    msgIndex = 0;
    await epdCharacteristic.startNotifications();
  } catch (e) {
    console.error(e);
    if (e.message) addLog('startNotifications: ' + e.message);
  }
  await write(EpdCmd.INIT); // thiết bị báo mtu= + t= + fw=
  document.getElementById('connectbutton').innerHTML = 'Ngắt kết nối';
  updateButtonStatus();
}

function updateButtonStatus(busy = false) {
  const connected = gattServer != null && gattServer.connected;
  const dis = (busy || !connected) ? 'disabled' : null;
  document.getElementById('reconnectbutton').disabled = (gattServer == null || connected) ? 'disabled' : null;
  document.getElementById('sendbookbutton').disabled = (dis || !book) ? 'disabled' : null;
  ['rprevbutton', 'rnextbutton', 'rhomebutton', 'rgotobutton', 'fullEverybutton', 'btnApply', 'otabutton', 'sendcmdbutton']
    .forEach(id => document.getElementById(id).disabled = dis);
}

/* ================= Điều khiển đọc sách ================= */

async function readerCmd(sub) { await write(EpdCmd.BOOK, [sub]); }
async function readerGoto() {
  const p = Math.max(1, parseInt(document.getElementById('gotoPage').value) || 1) - 1;
  await write(EpdCmd.BOOK, [0x10, p & 0xFF, (p >> 8) & 0xFF]);
}
async function setFullEvery() {
  const n = parseInt(document.getElementById('fullEvery').value) || 10;
  if (await write(EpdCmd.BOOK, [0x20, n]))
    addLog(`Đã đặt: làm mới đầy đủ sau mỗi ${n} trang lật.`);
}

/* ================= Nút bấm vật lý ================= */

const BTN_PIN_OPTIONS = [
  ['FF', 'Mặc định'], ['FE', 'Tắt nút'],
  ['04', 'P0_4 (TX)'], ['02', 'P0_2 (SCL)'], ['01', 'P0_1 (SDA)'], ['05', 'P0_5 (RX)'],
  ['14', 'P1_4 (SWCLK)'], ['15', 'P1_5 (SWDIO)'],
  ['10', 'P1_0'], ['11', 'P1_1'], ['12', 'P1_2'], ['13', 'P1_3'],
  ['22', 'P2_2'], ['24', 'P2_4'], ['28', 'P2_8'], ['29', 'P2_9'],
];
const BTN_DEFAULTS = { btnNext: 0x04, btnPrev: 0x02, btnSel: 0x01, btnPwr: 0x05 };

function initBtnSelects() {
  document.querySelectorAll('select.btnsel').forEach(sel => {
    BTN_PIN_OPTIONS.forEach(([v, t]) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = t;
      sel.appendChild(o);
    });
    sel.addEventListener('change', updateBtnHint);
  });
}
function setBtnSelect(id, val) {
  const sel = document.getElementById(id);
  const hex = ('0' + val.toString(16)).slice(-2).toUpperCase();
  if ([...sel.options].some(o => o.value === hex)) sel.value = hex;
  else sel.value = 'FF';
}
function btnEffectivePin(id) {
  const v = parseInt(document.getElementById(id).value, 16);
  if (v === 0xFF) return BTN_DEFAULTS[id];
  return v;
}
function updateBtnHint() {
  const hint = document.getElementById('btnHint');
  if (!cfgPins) { hint.textContent = 'Kết nối thiết bị để kiểm tra chân trùng với chân màn hình.'; return; }
  const used = [cfgPins[0], cfgPins[1], cfgPins[2], cfgPins[3], cfgPins[4], cfgPins[5], cfgPins[6], cfgPins[10], 0x00, 0x03, 0x06];
  const names = { btnNext: 'trang sau', btnPrev: 'trang trước', btnSel: 'trang chủ', btnPwr: 'nguồn' };
  const bad = [];
  for (const id of Object.keys(names)) {
    const v = parseInt(document.getElementById(id).value, 16);
    if (v === 0xFE) continue;
    const pin = btnEffectivePin(id);
    if (used.includes(pin)) bad.push(`nút ${names[id]} (P${pin >> 4}_${pin & 15})`);
  }
  hint.textContent = bad.length
    ? '⚠ Trùng chân màn hình/flash — firmware sẽ TỰ TẮT: ' + bad.join(', ') + '. Chọn chân khác nếu muốn dùng các nút này.'
    : '✓ Không có chân nào xung đột với cấu hình màn hình hiện tại.';
}
async function applyButtons() {
  const b = ['btnNext', 'btnPrev', 'btnSel', 'btnPwr'].map(id => parseInt(document.getElementById(id).value, 16));
  if (await write(EpdCmd.BTN, b)) addLog('Đã gửi cấu hình chân nút (thiết bị trả btn=ok).');
}

/* ================= Đọc & phân tích file sách ================= */

// book = { type:'text'|'image', title, parts:[...] }
//   text part: { text, bytes (Uint8Array UTF-8) }
//   image part: { pages: [index vào comicPages] }
let book = null;
let comicPages = [];   // ImageBitmap của từng trang truyện (toàn bộ file)
let previewPage = 0;   // trang đang xem trước (trong phần đang chọn)
let previewTextPages = null; // cache phân trang ước lượng của phần chữ đang chọn
let idxEstPages = 0;   // ước lượng số trang khi máy phân trang (progress bki=)

function fmtKB(n) { return (n / 1024).toFixed(1) + 'KB'; }

async function bookFileChange() {
  const files = [...document.getElementById('bookFile').files];
  if (!files.length) return;
  book = null;
  comicPages.forEach(b => b.close && b.close());
  comicPages = [];
  previewTextPages = null;
  setStatus('Đang đọc file...');
  try {
    const imgs = files.filter(f => /\.(png|jpe?g|webp|bmp)$/i.test(f.name));
    const f0 = files[0];
    if (imgs.length === files.length && imgs.length > 0) {
      await loadComicImages(imgs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })), stripExt(f0.name));
    } else if (/\.txt$/i.test(f0.name)) {
      loadTextBook(new TextDecoder('utf-8').decode(await f0.arrayBuffer()), stripExt(f0.name));
    } else if (/\.epub$/i.test(f0.name)) {
      const r = await parseEpub(await f0.arrayBuffer());
      loadTextBook(r.text, r.title || stripExt(f0.name));
    } else if (/\.(cbz|zip)$/i.test(f0.name)) {
      await loadComicZip(await f0.arrayBuffer(), stripExt(f0.name));
    } else if (/\.(mobi|azw3?|azw)$/i.test(f0.name)) {
      const r = parseMobi(await f0.arrayBuffer());
      loadTextBook(r.text, r.title || stripExt(f0.name));
    } else {
      throw new Error('Định dạng chưa hỗ trợ: ' + f0.name);
    }
    setStatus('');
  } catch (e) {
    console.error(e);
    setStatus('');
    alert('Không đọc được sách: ' + (e.message || e) +
      '\n\nMẹo: dùng Calibre chuyển sách sang .epub hoặc .txt rồi thử lại.');
    return;
  }
  updateBookUI();
}

function stripExt(n) { return n.replace(/\.[^.]+$/, ''); }

// ---- sách chữ ----
function normalizeText(t) {
  t = t.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  t = t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

function loadTextBook(text, title) {
  text = normalizeText(text);
  if (!text) throw new Error('File không có nội dung chữ.');
  const enc = new TextEncoder();
  const all = enc.encode(text);
  // chia phần <= MAX_DATA tại ranh giới đoạn (\n), không cắt giữa ký tự UTF-8
  const parts = [];
  let off = 0;
  while (off < all.length) {
    let end = Math.min(off + MAX_DATA, all.length);
    if (end < all.length) {
      let nl = -1;
      for (let i = end; i > off + MAX_DATA / 2; i--) {
        if (all[i] === 10) { nl = i; break; }
      }
      if (nl > 0) end = nl;
      else while (end > off && (all[end] & 0xC0) === 0x80) end--;
    }
    parts.push({ bytes: all.slice(off, end) });
    off = end;
    while (off < all.length && all[off] === 10) off++;
  }
  book = { type: 'text', title: (title || 'Sách').slice(0, 60), parts };
}

// ---- truyện tranh ----
async function loadComicImages(files, title) {
  const pages = [];
  for (const f of files) {
    setStatus(`Đang nạp trang ${pages.length + 1}/${files.length}...`);
    pages.push(await createImageBitmap(await blobFromFile(f)));
  }
  finishComic(pages, title);
}
function blobFromFile(f) { return Promise.resolve(f); }

async function loadComicZip(buf, title) {
  const z = await unzip(buf);
  const imgs = z.entries.filter(e => /\.(png|jpe?g|webp|bmp|gif)$/i.test(e.name) && !/__MACOSX/.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (!imgs.length) throw new Error('File nén không chứa ảnh nào.');
  const pages = [];
  for (const e of imgs) {
    setStatus(`Đang giải nén trang ${pages.length + 1}/${imgs.length}...`);
    const data = await z.read(e);
    pages.push(await createImageBitmap(new Blob([data])));
  }
  finishComic(pages, title);
}

function finishComic(pages, title) {
  if (!pages.length) throw new Error('Không có trang nào.');
  comicPages = pages;
  // chia phần: ước lượng dung lượng nén sau khi gửi (nén thật lúc gửi);
  // tạm chia theo số trang, tinh chỉnh khi nén (sendBook sẽ dừng khi đầy)
  const estPerPage = 5 * 1024; // trang truyện đen trắng nén RLE trung bình ~3-6KB
  const perPart = Math.max(1, Math.min(MAX_PAGES_PART, Math.floor(MAX_DATA / estPerPage)));
  const parts = [];
  for (let i = 0; i < pages.length; i += perPart) {
    parts.push({ pages: Array.from({ length: Math.min(perPart, pages.length - i) }, (_, k) => i + k) });
  }
  book = { type: 'image', title: (title || 'Truyện').slice(0, 60), parts };
}

/* ---- unzip thuần JS (DecompressionStream, không cần thư viện) ---- */
async function unzip(buf) {
  const dv = new DataView(buf);
  let eocd = -1;
  const lo = Math.max(0, buf.byteLength - 22 - 65536);
  for (let i = buf.byteLength - 22; i >= lo; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('không phải file ZIP hợp lệ');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const td = new TextDecoder();
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const csize = dv.getUint32(off + 20, true);
    const nlen = dv.getUint16(off + 28, true);
    const elen = dv.getUint16(off + 30, true);
    const clen = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    entries.push({ name: td.decode(new Uint8Array(buf, off + 46, nlen)), method, csize, lho });
    off += 46 + nlen + elen + clen;
  }
  for (const e of entries) {
    const n2 = dv.getUint16(e.lho + 26, true);
    const x2 = dv.getUint16(e.lho + 28, true);
    e.dataOff = e.lho + 30 + n2 + x2;
  }
  return {
    entries,
    async read(e) {
      const raw = new Uint8Array(buf, e.dataOff, e.csize);
      if (e.method === 0) return raw.slice();
      if (e.method === 8) {
        const ds = new DecompressionStream('deflate-raw');
        const resp = new Response(new Blob([raw]).stream().pipeThrough(ds));
        return new Uint8Array(await resp.arrayBuffer());
      }
      throw new Error('kiểu nén ZIP không hỗ trợ (' + e.method + ')');
    },
  };
}

/* ---- EPUB ---- */
function htmlToText(html) {
  html = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  html = html.replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr|\/blockquote)[^>]*>/gi, '\n');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body ? doc.body.textContent : '') || '';
}

async function parseEpub(buf) {
  const z = await unzip(buf);
  const byName = {};
  z.entries.forEach(e => { byName[e.name] = e; });
  const td = new TextDecoder();
  let opfPath = null;
  if (byName['META-INF/container.xml']) {
    const cx = td.decode(await z.read(byName['META-INF/container.xml']));
    const m = cx.match(/full-path="([^"]+)"/);
    if (m) opfPath = m[1];
  }
  let title = '';
  let htmlFiles = [];
  if (opfPath && byName[opfPath]) {
    const opf = td.decode(await z.read(byName[opfPath]));
    const tm = opf.match(/<dc:title[^>]*>([^<]*)<\/dc:title>/i);
    if (tm) title = tm[1].trim();
    const base = opfPath.includes('/') ? opfPath.replace(/[^/]+$/, '') : '';
    const items = {};
    const itemRe = /<item\b[^>]*>/gi;
    let m;
    while ((m = itemRe.exec(opf))) {
      const tag = m[0];
      const id = (tag.match(/\bid="([^"]+)"/) || [])[1];
      const href = (tag.match(/\bhref="([^"]+)"/) || [])[1];
      if (id && href) items[id] = base + decodeURIComponent(href);
    }
    const spineRe = /<itemref\b[^>]*\bidref="([^"]+)"/gi;
    while ((m = spineRe.exec(opf))) {
      const p = items[m[1]];
      if (p && byName[p]) htmlFiles.push(byName[p]);
    }
  }
  if (!htmlFiles.length) {
    htmlFiles = z.entries.filter(e => /\.x?html?$/i.test(e.name)).sort((a, b) => a.name.localeCompare(b.name));
  }
  if (!htmlFiles.length) throw new Error('EPUB không có chương nào đọc được');
  let text = '';
  for (const e of htmlFiles) {
    text += htmlToText(td.decode(await z.read(e))) + '\n\n';
  }
  return { title, text };
}

/* ---- MOBI / AZW (PalmDOC, không DRM) ---- */
function palmdocDecompress(rec) {
  const out = [];
  let i = 0;
  while (i < rec.length) {
    const b = rec[i++];
    if (b === 0) out.push(0);
    else if (b <= 8) { for (let k = 0; k < b; k++) out.push(rec[i++]); }
    else if (b <= 0x7f) out.push(b);
    else if (b <= 0xbf) {
      const b2 = rec[i++];
      const pair = ((b & 0x3f) << 8) | b2;
      const dist = pair >> 3;
      const len = (pair & 7) + 3;
      for (let k = 0; k < len; k++) out.push(out[out.length - dist]);
    } else {
      out.push(32, b ^ 0x80);
    }
  }
  return new Uint8Array(out);
}

function parseMobi(buf) {
  const dv = new DataView(buf);
  const td = new TextDecoder('utf-8');
  const type = td.decode(new Uint8Array(buf, 60, 8));
  if (type !== 'BOOKMOBI' && type !== 'TEXtREAd') throw new Error('không phải file MOBI');
  const nRec = dv.getUint16(76, false);
  const recOff = i => dv.getUint32(78 + i * 8, false);
  const rec0 = recOff(0);
  const compression = dv.getUint16(rec0, false);
  const textLength = dv.getUint32(rec0 + 4, false);
  const recordCount = dv.getUint16(rec0 + 8, false);
  const encryption = dv.getUint16(rec0 + 12, false);
  if (encryption !== 0) throw new Error('sách có DRM — hãy dùng bản không DRM hoặc chuyển bằng Calibre');
  if (compression !== 1 && compression !== 2)
    throw new Error('MOBI nén HUFF/CDIC chưa hỗ trợ — chuyển sang epub/txt bằng Calibre');
  let encoding = 65001, title = '', extraFlags = 0;
  if (buf.byteLength > rec0 + 20 && dv.getUint32(rec0 + 16, false) === 0x4d4f4249) { // 'MOBI'
    const hlen = dv.getUint32(rec0 + 20, false);
    encoding = dv.getUint32(rec0 + 28, false);
    if (hlen >= 0xe4) extraFlags = dv.getUint16(rec0 + 16 + 0xe2, false);
    const tOff = dv.getUint32(rec0 + 84, false);
    const tLen = dv.getUint32(rec0 + 88, false);
    if (tOff && tLen && rec0 + tOff + tLen <= buf.byteLength)
      title = new TextDecoder(encoding === 1252 ? 'windows-1252' : 'utf-8').decode(new Uint8Array(buf, rec0 + tOff, tLen));
  }
  const trailing = (rec) => {
    let size = 0;
    for (let bit = 15; bit > 0; bit--) {
      if (extraFlags & (1 << bit)) {
        let v = 0;
        const end = rec.length - size;
        for (let i = Math.max(0, end - 4); i < end; i++) {
          const b = rec[i];
          if (b & 0x80) v = 0;
          v = (v << 7) | (b & 0x7f);
        }
        size += v;
      }
    }
    if (extraFlags & 1) size += (rec[rec.length - size - 1] & 0x3) + 1;
    return size;
  };
  const chunks = [];
  for (let i = 1; i <= recordCount && i < nRec; i++) {
    const s = recOff(i);
    const e = (i + 1 < nRec) ? recOff(i + 1) : buf.byteLength;
    let rec = new Uint8Array(buf, s, e - s);
    const tr = trailing(rec);
    if (tr > 0 && tr < rec.length) rec = rec.subarray(0, rec.length - tr);
    chunks.push(compression === 2 ? palmdocDecompress(rec) : rec.slice());
  }
  let total = chunks.reduce((n, c) => n + c.length, 0);
  const all = new Uint8Array(Math.min(total, textLength || total));
  let p = 0;
  for (const c of chunks) {
    const n = Math.min(c.length, all.length - p);
    if (n <= 0) break;
    all.set(c.subarray(0, n), p);
    p += n;
  }
  const html = new TextDecoder(encoding === 1252 ? 'windows-1252' : 'utf-8').decode(all);
  return { title, text: htmlToText(html) };
}

/* ================= Xem trước & thông tin sách ================= */

const PREVIEW_CHARS_PER_LINE = 46;
const PREVIEW_LINES = 14;

function updateBookUI() {
  const row = document.getElementById('bookInfoRow');
  if (!book) { row.style.display = 'none'; updateButtonStatus(); return; }
  row.style.display = '';
  document.getElementById('bookTitle').value = book.title;
  document.getElementById('comicOptsRow').style.display = book.type === 'image' ? '' : 'none';

  const partRow = document.getElementById('bookPartRow');
  const partSel = document.getElementById('bookPart');
  partSel.innerHTML = '';
  book.parts.forEach((p, i) => {
    const o = document.createElement('option');
    o.value = i;
    o.textContent = book.type === 'text'
      ? `Phần ${i + 1}/${book.parts.length} (${fmtKB(p.bytes.length)})`
      : `Phần ${i + 1}/${book.parts.length} (trang ${p.pages[0] + 1}–${p.pages[p.pages.length - 1] + 1})`;
    partSel.appendChild(o);
  });
  partRow.style.display = book.parts.length > 1 ? '' : 'none';

  const s = document.getElementById('bookSummary');
  if (book.type === 'text') {
    const total = book.parts.reduce((n, p) => n + p.bytes.length, 0);
    const estPages = Math.ceil(total / 1000);
    s.textContent = `Sách chữ: ${fmtKB(total)}, ước lượng ~${estPages} trang màn hình` +
      (book.parts.length > 1 ? ` — chia ${book.parts.length} phần, mỗi lần gửi một phần.` : '.');
  } else {
    s.textContent = `Truyện tranh: ${comicPages.length} trang` +
      (book.parts.length > 1 ? ` — chia ${book.parts.length} phần (~${book.parts[0].pages.length} trang/phần tùy độ nén), mỗi lần gửi một phần.` : '.');
  }
  previewPage = 0;
  previewTextPages = null;
  renderPreview();
  updateButtonStatus();
}

function bookPartChange() {
  previewPage = 0;
  previewTextPages = null;
  renderPreview();
}

function currentPart() {
  if (!book) return null;
  const i = parseInt(document.getElementById('bookPart').value) || 0;
  return book.parts[Math.min(i, book.parts.length - 1)];
}

// phân trang XEM TRƯỚC (ước lượng — máy tự phân trang thật bằng font unifont)
function buildPreviewTextPages(text) {
  const pages = [];
  let lines = [];
  for (const para of text.split('\n')) {
    let rest = para;
    do {
      let line = rest.slice(0, PREVIEW_CHARS_PER_LINE);
      if (rest.length > PREVIEW_CHARS_PER_LINE) {
        const sp = line.lastIndexOf(' ');
        if (sp > PREVIEW_CHARS_PER_LINE / 2) line = line.slice(0, sp);
      }
      lines.push(line);
      rest = rest.slice(line.length).replace(/^ /, '');
      if (lines.length === PREVIEW_LINES) { pages.push(lines); lines = []; }
      if (pages.length > 400) return pages; // đủ để xem trước
    } while (rest.length);
  }
  if (lines.length) pages.push(lines);
  return pages;
}

function previewStep(d) {
  previewPage += d;
  renderPreview();
}

async function renderPreview() {
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, 400, 300);
  const label = document.getElementById('previewPageLabel');
  if (!book) { label.textContent = '—'; return; }

  if (book.type === 'text') {
    const part = currentPart();
    if (!previewTextPages) previewTextPages = buildPreviewTextPages(new TextDecoder().decode(part.bytes));
    previewPage = Math.max(0, Math.min(previewPage, previewTextPages.length - 1));
    const lines = previewTextPages[previewPage] || [];
    ctx.fillStyle = 'black';
    ctx.font = '15px monospace';
    lines.forEach((l, i) => ctx.fillText(l, 8, 22 + i * 19, 384));
    ctx.fillRect(8, 280, 384, 1);
    ctx.font = '10px monospace';
    ctx.fillText(`${previewPage + 1}/${previewTextPages.length} (xem trước ước lượng)`, 8, 294);
    label.textContent = `${previewPage + 1}/${previewTextPages.length}`;
  } else {
    const part = currentPart();
    previewPage = Math.max(0, Math.min(previewPage, part.pages.length - 1));
    const plane = comicRenderPlane(part.pages[previewPage]);
    const img = ctx.createImageData(400, 300);
    for (let i = 0; i < 400 * 300; i++) {
      const v = (plane[i >> 3] >> (7 - (i & 7))) & 1 ? 255 : 0;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    label.textContent = `${previewPage + 1}/${part.pages.length}`;
  }
}
function comicRepreview() { renderPreview(); }

// vẽ 1 trang truyện về mặt phẳng 1-bit 15000B (bit 1 = trắng, như firmware)
function comicRenderPlane(pageIdx) {
  const bmp = comicPages[pageIdx];
  const rot = document.getElementById('comicRotate').checked;
  const cv = document.createElement('canvas');
  cv.width = 400;
  cv.height = 300;
  const c = cv.getContext('2d');
  c.fillStyle = 'white';
  c.fillRect(0, 0, 400, 300);
  const w = rot ? bmp.height : bmp.width;
  const h = rot ? bmp.width : bmp.height;
  const scale = Math.min(400 / w, 300 / h);
  c.save();
  c.translate(200, 150);
  if (rot) c.rotate(Math.PI / 2);
  c.scale(scale, scale);
  c.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
  c.restore();

  const imageData = c.getImageData(0, 0, 400, 300);
  adjustContrast(imageData, parseFloat(document.getElementById('ditherContrast').value));
  const alg = document.getElementById('ditherAlg').value;
  const strength = parseFloat(document.getElementById('ditherStrength').value);
  const dithered = ditherImage(imageData, alg, strength, 'blackWhiteColor');
  return processImageData(dithered, 'blackWhiteColor'); // 15000B, bit 1 = trắng
}

/* ---- nén RLE (PackBits) — bộ giải nén nằm trong READER.c ---- */
function rleEncode(data) {
  const out = [];
  let i = 0;
  while (i < data.length) {
    let j = i;
    while (j < data.length - 1 && data[j] === data[j + 1] && j - i < 127) j++;
    if (j > i) {           // chạy lặp 2..128 byte
      out.push(257 - (j - i + 1), data[i]);
      i = j + 1;
    } else {               // đoạn thô đến khi gặp chạy lặp >= 3
      let k = i;
      while (k < data.length && k - i < 128) {
        if (k + 2 < data.length && data[k] === data[k + 1] && data[k] === data[k + 2]) break;
        k++;
      }
      out.push(k - i - 1);
      for (let x = i; x < k; x++) out.push(data[x]);
      i = k;
    }
  }
  return new Uint8Array(out);
}

/* ================= Gửi sách ================= */

async function sendChunks(bytes, areaOff, label, pctBase = 0, pctSpan = 100) {
  // gói: [0x28, 0x02, off u32 LE, data...]; gói chạm sector 4KB mới dùng
  // write-có-xác-nhận để chờ thiết bị xóa sector xong (điều tiết luồng).
  // pctBase/pctSpan: dải của giai đoạn này trên thanh tiến độ tổng.
  const mtu = parseInt(document.getElementById('mtusize').value) || 20;
  const chunk = Math.max(32, mtu - 6);
  const interleaved = parseInt(document.getElementById('interleavedcount').value) || 16;
  let noReply = 0;
  let lastSector = -1;
  const t0 = Date.now();
  for (let i = 0; i < bytes.length; i += chunk) {
    const off = areaOff + i;
    const n = Math.min(chunk, bytes.length - i);
    const payload = new Uint8Array(5 + n);
    payload[0] = 0x02;
    payload[1] = off & 0xFF;
    payload[2] = (off >> 8) & 0xFF;
    payload[3] = (off >> 16) & 0xFF;
    payload[4] = (off >> 24) & 0xFF;
    payload.set(bytes.subarray(i, i + n), 5);
    const sector = (off + n) >> 12;
    const useReply = (sector !== lastSector) || (--noReply <= 0);
    if (useReply) noReply = interleaved;
    lastSector = sector;
    let ok = await write(EpdCmd.BOOK, payload, !useReply ? false : true);
    if (!ok) ok = await write(EpdCmd.BOOK, payload, true);
    if (!ok) throw new Error('gửi dữ liệu thất bại tại ' + label + ' +' + i);
    // tiến độ + tốc độ + thời gian còn lại của giai đoạn
    const done = i + n;
    const frac = done / bytes.length;
    const secs = Math.max(0.05, (Date.now() - t0) / 1000);
    const kbs = done / 1024 / secs;
    const eta = Math.ceil((bytes.length - done) / 1024 / Math.max(0.05, kbs));
    setProgress(pctBase + pctSpan * frac);
    setStatus(`Đang gửi ${label}: ${(frac * 100) >> 0}% (${fmtKB(done)}/${fmtKB(bytes.length)} - ` +
      `${kbs.toFixed(1)}KB/s${done < bytes.length ? `, còn ~${eta}s` : ''})`);
  }
}

async function sendBook() {
  if (!book) return;
  const part = currentPart();
  const title = document.getElementById('bookTitle').value.trim() || book.title || 'Sách';
  const partLabel = book.parts.length > 1 ? ` (P${(parseInt(document.getElementById('bookPart').value) || 0) + 1})` : '';
  const titleBytes = new TextEncoder().encode((title + partLabel).slice(0, 60)).slice(0, 63);
  startTime = Date.now();
  updateButtonStatus(true);
  setProgress(0);
  idxEstPages = 0;
  try {
    // MTU trước đã (tránh gửi gói 18 byte)
    const mtuReady = waitMtuNotify(1500);
    await write(EpdCmd.INIT);
    await mtuReady;

    const type = book.type === 'text' ? 1 : 2;
    setStatus('Mở phiên nhận sách trên thiết bị...');
    const ack = waitNotify(m => (m === 'book=rx') ? m : (m === 'book=err' ? new Error('thiết bị từ chối (book=err)') : null), 8000);
    await write(EpdCmd.BOOK, [0x01, type]);
    await ack;
    setProgress(2);

    let pages = 0, dataLen = 0;
    if (type === 1) {
      // sách chữ: gửi nội dung chiếm 2..80%, máy phân trang 80..99%
      await sendChunks(part.bytes, BOOK_DATA_OFF, 'nội dung', 2, 78);
      dataLen = part.bytes.length;
      idxEstPages = Math.max(1, Math.round(dataLen / 1000)); // ~1KB chữ/trang
    } else {
      // truyện tranh: nén 2..30%, mục lục 30..34%, dữ liệu 34..95%
      const blobs = [];
      let total = 0;
      for (const pi of part.pages) {
        setStatus(`Đang nén trang ${blobs.length + 1}/${part.pages.length}... (${fmtKB(total)}/${fmtKB(MAX_DATA)} kho)`);
        setProgress(2 + 28 * (blobs.length / part.pages.length));
        await sleep(1); // nhả UI
        const blob = rleEncode(comicRenderPlane(pi));
        if (total + blob.length > MAX_DATA) {
          addLog(`Kho đầy: gửi ${blobs.length}/${part.pages.length} trang của phần này (các trang sau nén kém).`);
          break;
        }
        blobs.push(blob);
        total += blob.length;
      }
      if (!blobs.length) throw new Error('trang đầu tiên đã lớn hơn kho sách');
      pages = blobs.length;
      dataLen = total;
      const idx = new Uint8Array(4 * (pages + 1));
      const dvI = new DataView(idx.buffer);
      let off = BOOK_DATA_OFF;
      blobs.forEach((b, i) => { dvI.setUint32(4 * i, off, true); off += b.length; });
      dvI.setUint32(4 * pages, off, true);
      await sendChunks(idx, BOOK_IDX_OFF, 'mục lục', 30, 4);
      const all = new Uint8Array(total);
      let p = 0;
      blobs.forEach(b => { all.set(b, p); p += b.length; });
      await sendChunks(all, BOOK_DATA_OFF, 'trang truyện', 34, 61);
    }

    setProgress(type === 1 ? 80 : 95);
    setStatus(type === 1 ? 'Chốt sách — máy đang phân trang (~5-10s)...' : 'Chốt sách...');
    const done = waitNotify(m => {
      if (m === 'book=err') return new Error('thiết bị báo lỗi khi chốt sách');
      const mm = m.match(/^book=(\d+)$/);
      return mm ? parseInt(mm[1]) : null;
    }, 120000);
    const fin = new Uint8Array(7 + titleBytes.length);
    fin[0] = 0x03;
    fin[1] = type;
    fin[2] = pages & 0xFF;
    fin[3] = (pages >> 8) & 0xFF;
    fin[4] = dataLen & 0xFF;
    fin[5] = (dataLen >> 8) & 0xFF;
    fin[6] = (dataLen >> 16) & 0xFF;
    // byte thứ 4 của len luôn 0 (sách <= 100KB) — chèn vào giữa
    const finalize = new Uint8Array(8 + titleBytes.length);
    finalize.set(fin.subarray(0, 7), 0);
    finalize[7] = (dataLen >> 24) & 0xFF;
    finalize.set(titleBytes, 8);
    await write(EpdCmd.BOOK, finalize);
    const totalPages = await done;

    setProgress(100);
    const secs = ((Date.now() - startTime) / 1000).toFixed(1);
    setStatus(`Xong! Sách ${totalPages} trang trên máy (${secs}s). Máy đang hiển thị trang 1.`);
    addLog(`Gửi sách thành công: ${totalPages} trang, ${secs}s.`);
    addLog('Dùng nút bấm trên máy hoặc khung «Điều khiển đọc sách» để lật trang.');
    setTimeout(() => setProgress(null), 4000);
  } catch (e) {
    console.error(e);
    setProgress(null);
    setStatus('Lỗi: ' + (e.message || e));
    addLog('Gửi sách thất bại: ' + (e.message || e));
  }
  idxEstPages = 0;
  updateButtonStatus();
}

/* ================= OTA firmware (u32 size — như webtool 4_2inch) ========= */

function crc32buf(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
  }
  return (crc ^ -1) | 0;
}

async function otaUpdate() {
  const fileInput = document.getElementById('otaFile');
  if (!fileInput || fileInput.files.length === 0) { addLog('Chọn file firmware .bin trước.'); return; }
  if (!epdCharacteristic) { addLog('Chưa kết nối thiết bị.'); return; }
  const firmBuf = new Uint8Array(await fileInput.files[0].arrayBuffer());
  const firmSize = firmBuf.length;
  const magic = [0x79, 0x13, 0xa5, 0xf9, 0x86, 0xec, 0x5a, 0x06];
  let pos = -1;
  for (let i = 0; i <= firmBuf.length - magic.length - 4; i++) {
    let j = 0;
    while (j < magic.length && firmBuf[i + j] === magic[j]) j++;
    if (j === magic.length) { pos = i; break; }
  }
  if (pos === -1) { addLog('File không hợp lệ: không thấy magic phiên bản firmware!'); return; }
  const firmVer = firmBuf[pos + 8] | (firmBuf[pos + 9] << 8) | (firmBuf[pos + 10] << 16) | (firmBuf[pos + 11] << 24);
  const firmCrc = crc32buf(firmBuf);
  addLog('Firmware: ' + firmSize + ' byte, phiên bản 0x' + (firmVer >>> 0).toString(16) + '.');
  if (!confirm('Cập nhật firmware qua BLE?\nSách trong máy sẽ bị xóa (gửi lại sau khi cập nhật).\nKhông tắt nguồn thiết bị trong quá trình cập nhật!')) return;

  const show = t => { const el = document.getElementById('otaProgress'); if (el) el.textContent = t; };
  const btn = document.getElementById('otabutton');
  btn.disabled = 'disabled';
  try {
    const buf = new Uint8Array(136);
    const dv = new DataView(buf.buffer);
    buf[0] = 0xa0; buf[1] = 0x00;
    dv.setUint32(2, firmSize, true);
    show('Đang xoá flash…');
    if (!await write(buf[0], buf.subarray(1, 6), true)) throw new Error('lệnh 0xA0 thất bại');
    let p = 0;
    for (let i = 0; i < firmSize + 64; i += 256) {
      buf.fill(0xff);
      if (i === 0) {
        dv.setUint32(8 + 0, 0x00aa5170, true);
        dv.setUint32(8 + 4, firmSize, true);
        dv.setUint32(8 + 8, firmCrc, true);
        dv.setUint32(8 + 28, firmVer, true);
        buf[8 + 32] = 0;
        buf[0] = 0xa2;
        buf.set(firmBuf.subarray(p, p + 64), 8 + 64);
        if (!await write(buf[0], buf.subarray(1), true)) throw new Error('gửi trang đầu thất bại');
        p += 64;
      } else {
        buf[0] = 0xa2;
        buf.fill(0xff, 1);
        buf.set(firmBuf.subarray(p, p + 128), 8);
        if (!await write(buf[0], buf.subarray(1), true)) throw new Error('gửi dữ liệu thất bại');
        p += 128;
      }
      buf[0] = 0xa3;
      buf.fill(0xff, 1);
      buf.set(firmBuf.subarray(p, p + 128), 8);
      if (!await write(buf[0], buf.subarray(1), true)) throw new Error('gửi dữ liệu thất bại');
      p += 128;
      show('Tiến độ: ' + ((100 * p / (firmSize + 64)) >> 0) + '%');
    }
    buf.fill(0x00); buf[0] = 0xa4;
    await write(buf[0], buf.subarray(1, 4), true);
    show('Hoàn tất — thiết bị đang khởi động lại.');
    addLog('Cập nhật xong! Gửi lại sách sau khi thiết bị khởi động.');
  } catch (e) {
    console.error(e);
    show('Lỗi: ' + (e.message || e));
    addLog('OTA thất bại: ' + (e.message || e));
  } finally {
    btn.disabled = null;
    updateButtonStatus();
  }
}

/* ================= khởi tạo ================= */

function checkDebugMode() {
  const link = document.getElementById('debug-toggle');
  const debugMode = new URLSearchParams(window.location.search).get('debug') === 'true';
  if (debugMode) {
    document.body.classList.add('dark-mode');
    link.innerHTML = 'Chế độ thường';
    link.setAttribute('href', window.location.pathname);
    addLog('Chế độ dev đã bật.');
  } else {
    link.innerHTML = 'Chế độ dev';
    link.setAttribute('href', window.location.pathname + '?debug=true');
  }
}

document.body.onload = () => {
  initBtnSelects();
  updateBtnHint();
  updateButtonStatus();
  checkDebugMode();
  const ctx = document.getElementById('canvas').getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, 400, 300);
  ctx.fillStyle = '#888';
  ctx.font = '16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Chọn file sách để xem trước', 200, 150);
  ctx.textAlign = 'left';
};
