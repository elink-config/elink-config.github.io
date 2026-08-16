// ---------------------------------------------------------------------------
// HÀM DÙNG CHUNG cho họ MÁY ĐỌC SÁCH — bản 4.2" (DA14585) và 7.5" (nRF52811). Chung toàn bộ
// đường xử lý sách: đọc EPUB/MOBI, nén EVN1/RLE, cắt trang, gửi theo khối.
//
// Chỉ chứa hàm GIỐNG HỆT NHAU ở mọi app trong họ. Hàm nào mỗi máy một khác
// vẫn nằm ở main.js của app đó.
// THỨ TỰ NẠP: app_common.js -> file này -> main.js của app, nên app cần bản
// riêng chỉ việc khai báo lại cùng tên trong main.js (khai báo sau đè lên).
// ---------------------------------------------------------------------------

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

// thanh tiến độ tổng của phiên gửi sách (null = ẩn, 'busy' = nhịp chờ
// vô định — dùng khi đọc/phân tích file chưa biết tổng khối lượng)
function setProgress(pct) {
  const el = document.getElementById('sendProgress');
  if (!el) return;
  if (pct === null) {
    el.style.display = 'none';
    el.value = 0;
    return;
  }
  el.style.display = '';
  if (pct === 'busy') el.removeAttribute('value');
  else el.value = Math.max(0, Math.min(100, pct));
}

// nhường một khung hình cho trình duyệt vẽ status/progress vừa đặt trước
// khi chạy đoạn xử lý đồng bộ nặng (parse mobi/epub, mã hóa EVN1).
// Tab nền/ẩn KHÔNG chạy requestAnimationFrame -> phải kèm timeout dự phòng,
// nếu không load file sẽ treo tới khi tab được hiện lại.
function uiYield() {
  return new Promise(r => {
    let done = false;
    const fin = () => { if (!done) { done = true; r(); } };
    requestAnimationFrame(() => setTimeout(fin, 0));
    setTimeout(fin, 50);
  });
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

function resetVariables() {
  gattServer = null;
  epdService = null;
  epdCharacteristic = null;
  msgIndex = 0;
  cfgPins = null;
  deviceFw = null;
  devFont = null;
  devRot = null;
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

async function readerCmd(sub) { await write(EpdCmd.BOOK, [sub]); }

async function readerGoto() {
  const p = Math.max(1, parseInt(document.getElementById('gotoPage').value) || 1) - 1;
  await write(EpdCmd.BOOK, [0x10, p & 0xFF, (p >> 8) & 0xFF]);
}

async function setClockMode() {
  // fw r2.2+: [0x28 0x31 0/1/2] — cơ hội / nhảy từng phút / tắt
  const v = Math.min(2, Math.max(0, parseInt(document.getElementById('clockMode').value) || 0));
  if (!(await syncClock())) return;  // gửi giờ trước; máy không ACK thì khỏi đặt chế độ
  if (await write(EpdCmd.BOOK, [0x31, v]))
    addLog('Giờ thiết bị: ' + ['cập nhật khi chuyển trang', 'tự động cập nhật', 'tắt hiển thị'][v] + '.');
}

async function setFullEvery() {
  let n = parseInt(document.getElementById('fullEvery').value);
  if (isNaN(n) || n < 0 || n > 60) n = 0;  // mặc định: tắt
  if (await write(EpdCmd.BOOK, [0x20, n]))
    addLog(n === 0 ? 'Đã tắt làm mới màn hình khi lật trang (chỉ làm sạch khi vào/ra Trang chủ).'
                   : `Đã đặt: làm mới màn hình sau mỗi ${n} trang lật (không chớp đen).`);
}

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
  const names = { btnNext: 'trang sau', btnPrev: 'trang trước', btnSel: 'trang chủ' };
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
  // r2.0 chỉ còn 3 nút; vẫn gửi byte thứ 4 = 0xFE (tắt) để firmware r1.x cũ
  // (yêu cầu đủ 4 byte) không từ chối gói
  const b = ['btnNext', 'btnPrev', 'btnSel'].map(id => parseInt(document.getElementById(id).value, 16));
  b.push(0xFE);
  if (await write(EpdCmd.BTN, b)) addLog('Đã gửi cấu hình chân nút (thiết bị trả btn=ok).');
}

function fmtKB(n) { return (n / 1024).toFixed(1) + 'KB'; }

async function bookFileChange() {
  const files = [...document.getElementById('bookFile').files];
  if (!files.length) return;
  book = null;
  comicPages.forEach(b => b.close && b.close());
  comicPages = [];
  previewTextPages = null;
  setStatus('Đang đọc file...');
  setProgress('busy');
  await uiYield();
  try {
    const imgs = files.filter(f => /\.(png|jpe?g|webp|bmp)$/i.test(f.name));
    const f0 = files[0];
    if (imgs.length === files.length && imgs.length > 0) {
      await loadComicImages(imgs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })), stripExt(f0.name));
    } else if (/\.txt$/i.test(f0.name)) {
      const buf = await f0.arrayBuffer();
      setStatus('Đang xử lý sách chữ...');
      await uiYield();
      loadTextBook(new TextDecoder('utf-8').decode(buf), stripExt(f0.name));
    } else if (/\.epub$/i.test(f0.name)) {
      const buf = await f0.arrayBuffer();
      setStatus('Đang phân tích EPUB...');
      await uiYield();
      const r = await parseEpub(buf);
      setStatus('Đang xử lý sách chữ...');
      await uiYield();
      loadTextBook(r.text, r.title || stripExt(f0.name));
    } else if (/\.(cbz|zip)$/i.test(f0.name)) {
      await loadComicZip(await f0.arrayBuffer(), stripExt(f0.name));
    } else if (/\.(mobi|azw3?|azw)$/i.test(f0.name)) {
      const buf = await f0.arrayBuffer();
      setStatus('Đang phân tích MOBI...');
      await uiYield();
      const r = parseMobi(buf);
      setStatus('Đang xử lý sách chữ...');
      await uiYield();
      loadTextBook(r.text, r.title || stripExt(f0.name));
    } else {
      throw new Error('Định dạng chưa hỗ trợ: ' + f0.name);
    }
    setStatus('');
    setProgress(null);
  } catch (e) {
    console.error(e);
    setStatus('');
    setProgress(null);
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
  // nắn ký tự bố cục/punctuation lạ về ASCII: gọn bảng mã EVN1 (1 byte) và
  // chắc chắn font trên máy có glyph
  t = t.replace(/ /g, ' ').replace(/[​‌‍﻿]/g, '')
    .replace(/[“”„«»]/g, '"').replace(/[‘’‚]/g, "'")
    .replace(/[‐-―−]/g, '-').replace(/…/g, '...');
  t = t.replace(/[ \t]+\n/g, '\n');
  // BỎ TOÀN BỘ dòng trống (r2.1 — tối đa chữ trên trang; đoạn văn vẫn
  // xuống dòng riêng)
  t = t.replace(/\n{2,}/g, '\n');
  return t.trim();
}

// Mã hóa EVN1: ASCII giữ nguyên, chữ Việt 1 byte, còn lại 0xFF + u16 LE.
// starts[i]=1 nếu byte i MỞ ĐẦU một ký tự (để cắt phần không đứt escape);
// charAt[i] = chỉ số ký tự tại byte i (để giữ text xem trước cho từng phần).
function evnEncode(text) {
  const cap = text.length * 3 + 3;
  const out = new Uint8Array(cap);
  const starts = new Uint8Array(cap);
  const charAt = new Uint32Array(cap);
  let o = 0, ci = 0;
  for (const ch of text) {
    const u = ch.codePointAt(0);
    starts[o] = 1;
    charAt[o] = ci;
    if (u < 0x80) {
      out[o++] = u;
    } else {
      const s = EVN_MAP.get(u);
      if (s !== undefined) {
        out[o++] = s;
      } else if (u <= 0xFFFF) {
        out[o] = 0xFF; out[o + 1] = u & 0xFF; out[o + 2] = u >> 8;
        charAt[o + 1] = ci; charAt[o + 2] = ci;
        o += 3;
      } else {
        out[o++] = 0x3F; // ngoài BMP (emoji...): thay '?'
      }
    }
    ci++;
  }
  return { bytes: out.slice(0, o), starts, charAt };
}

// chia phần lại sách đang nạp theo sức chứa hiện tại (gọi khi nhận flash=
// chip lớn hơn, hoặc đổi cỡ chữ/hướng màn — trần trang sách chữ đổi theo)
function bookResplit() {
  if (!book) return;
  const t = book.title;
  if (book.type === 'text' && book.raw) loadTextBook(book.raw, t);
  else if (book.type === 'image' && comicPages.length) finishComic(comicPages, t);
  else return;
  book.title = t;
  updateBookUI();
}

// ---- truyện tranh ----
async function loadComicImages(files, title) {
  const pages = [];
  for (const f of files) {
    setStatus(`Đang nạp trang ${pages.length + 1}/${files.length}...`);
    setProgress(pages.length * 100 / files.length);
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
    setProgress(pages.length * 100 / imgs.length);
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
  const perPart = Math.max(1, Math.min(MAX_PAGES_PART, Math.floor(storeDataCap() / estPerPage)));
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

function previewRot() { return document.getElementById('rotMode').value === '1'; }

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

function previewStep(d) {
  previewPage += d;
  renderPreview();
}

function comicRepreview() { renderPreview(); }

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
