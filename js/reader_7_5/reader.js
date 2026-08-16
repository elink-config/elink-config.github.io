// Webtool MÁY ĐỌC SÁCH e-ink 7.5" (firmware epd_reader_7_5inch trên nRF52811,
// dòng r0.x/r1.x — tên BLE DIY-7_5R). Bắt nguồn từ webtool reader_4_2inch.
// Gửi sách chữ (.txt/.epub/.mobi) và truyện tranh (.cbz/ảnh) xuống thiết bị
// qua BLE theo giao thức EPD_CMD_BOOK (0x28) — xem README firmware.

let bleDevice, gattServer, epdService, epdCharacteristic;
let msgIndex, textDecoderInst, startTime;
let cfgPins = null;      // 11 byte chân màn hình từ config blob (tính xung đột nút)
let deviceFw = null;
let devFont = null, devRot = null; // cỡ chữ/hướng màn MÁY đang lưu (config blob)

const EpdCmd = {
  INIT: 0x01,
  BOOK: 0x28,
  BTN: 0x29,
};

const EPD_SERVICE = '62750001-d828-918d-fb46-b6c11c675aec';
const EPD_CHAR = '62750002-d828-918d-fb46-b6c11c675aec';

// Kho sách trên máy 7.5" (nRF52811): chip flash NGOÀI dùng TRỌN cho sách —
// khác bản 4.2" (DA14585) vốn chạy firmware ngay trong chip flash đó nên chỉ
// chừa ra được 276KB. Dung lượng chip đọc từ thông báo flash= (JEDEC) lúc kết
// nối, firmware tự nở kho theo chip: 512KB (A14013) -> 496KB sách;
// 2MB (FM25Q16A, A14015) -> ~1,98MB sách.
// header 80 byte nằm chung sector với đầu mục lục (cùng một giao dịch
// commit-last), nên 0x100..0x4000 là mục lục: 4032 mốc = tối đa 4000 trang
const BOOK_IDX_OFF = 0x100;
const BOOK_DATA_OFF = 0x4000;   // fw layout v2
const BOOK_MAX_PAGES = 4000;
let devFlashBytes = 512 * 1024;  // mặc định chip chuẩn; cập nhật khi nhận flash=
// sức chứa dữ liệu sách = TRỌN chip trừ header+mục lục. Không chừa lề: máy
// dùng hết chip thật (reader_store_end), và reader_rx_chunk tự chặn mọi gói
// vượt biên nên hai bên khớp chính xác.
function storeDataCap() {
  return Math.max(0, devFlashBytes - BOOK_DATA_OFF);
}
// sách CHỮ còn bị trần MỤC LỤC: 4000 mốc trang (chừa lề 3900). Cỡ trang ước
// lượng theo lưới chữ đang chọn, nhân 0,55 là mật độ thật đo trên máy.
function textPartCap() {
  const [avgW, lpp] = previewMetric();
  const cpl = (previewRot() ? PREVIEW_TEXT_W_P : PREVIEW_TEXT_W) / avgW;
  return Math.min(storeDataCap(), Math.floor(3900 * cpl * lpp * 0.55));
}
const MAX_PAGES_PART = 500;
const PLANE_SIZE = 48000; // 800x480 / 8

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

// ---- chờ notify ----
let mtuNotifyResolve = null;
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
      const fe = data[220];
      const sel = document.getElementById('fullEvery');
      if ([0, 1, 3, 5, 10].includes(fe)) sel.value = String(fe);
      // rd_font offset 221, rd_clock offset 219 (fw r2.2+; cũ đọc 0xFF -> mặc định)
      if (data[221] <= 2) { devFont = data[221]; document.getElementById('fontSize').value = String(devFont); }
      if (data[219] <= 2) document.getElementById('clockMode').value = String(data[219]);
      // rd_rot offset 204 (byte cuối vùng note cũ — fw r1.0+): 0 ngang / 1 dọc
      if (data[204] <= 1) { devRot = data[204]; document.getElementById('rotMode').value = String(devRot); }
      previewTextPages = null;  // select đồng bộ theo máy: preview dựng lại
      renderPreview();
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
      addLog('⚠ Máy chưa cài firmware máy đọc sách — nạp READER-7_5inch bằng J-Link trước khi gửi sách.');
    }
  } else if (msg.startsWith('bki=')) {
    // máy đang phân trang sách chữ: ánh xạ số trang đã chốt vào 80..99% của
    // thanh tiến độ (idxEstPages ước lượng từ dung lượng chữ); máy tự phân
    // trang lại không rõ tổng (đứt kết nối giữa chừng) -> tiệm cận n/(n+30)
    const n = parseInt(msg.substring(4)) || 0;
    setStatus(`Máy đang phân trang sách chữ... ${n}${idxEstPages ? '/~' + idxEstPages : ''} trang`);
    if (idxEstPages) setProgress(80 + 19 * Math.min(1, n / idxEstPages));
    else setProgress(Math.min(99, Math.round(100 * n / (n + 30))));
  } else if (msg.startsWith('flash=')) {
    // JEDEC ID chip SPI flash: [hãng][loại][dung lượng 2^n byte]
    const id = msg.substring(6);
    const vendors = { EF: 'Winbond', C8: 'GigaDevice', '85': 'Puya', C2: 'Macronix', '0B': 'XTX', '68': 'Boya', A1: 'Fudan', '1C': 'EON', BF: 'SST', '20': 'XMC/Micron' };
    const v = vendors[id.substring(0, 2).toUpperCase()] || ('hãng 0x' + id.substring(0, 2));
    const cap = parseInt(id.substring(4, 6), 16);
    const kb = cap > 10 && cap < 32 ? (1 << cap) / 1024 : 0;
    addLog(`Chip flash: ${v}, ${kb >= 1024 ? (kb / 1024) + 'MB' : kb + 'KB'} (JEDEC ${id})`);
    if (kb > 0 && kb < 512) {
      addLog('⚠ Chip flash ' + kb + 'KB — KHÔNG đủ chỗ cho kho sách (cần ít nhất 512KB). ' +
        'Máy vẫn chạy nhưng sẽ từ chối nhận sách (book=err).');
    } else if (kb >= 512) {
      // firmware tự nở kho theo chip thật -> chia phần lại sách đang nạp
      const bytes = Math.min(kb * 1024, 16 * 1024 * 1024);
      if (bytes !== devFlashBytes) {
        devFlashBytes = bytes;
        addLog(`Kho sách: ${fmtKB(storeDataCap())} dùng được.`);
        bookResplit();
      }
    }
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

async function preConnect() {
  if (gattServer != null && gattServer.connected) {
    if (bleDevice != null && bleDevice.gatt.connected) bleDevice.gatt.disconnect();
    return;
  }
  resetVariables();
  try {
    const debugMode = new URLSearchParams(window.location.search).get('debug') === 'true';
    bleDevice = await navigator.bluetooth.requestDevice({ // ?debug=true vẫn LỌC THEO TÊN thiết bị (yêu cầu user) — hết acceptAllDevices
      // CHỈ máy đọc sách DIY-7_5R-xxxx — không hiện máy lịch DIY-7_5N cùng phần cứng
      // DIY-7_5N (bản lịch) nữa; cần quét mọi thiết bị thì thêm ?debug=true
      filters: [{ namePrefix: 'DIY-7_5R' }],
      optionalServices: [EPD_SERVICE],
    });
  } catch (e) {
    console.error(e);
    if (e.name === 'NotFoundError') addLog('Không tìm thấy máy đọc sách (tên DIY-7_5R-xxxx).');
    else if (e.message) addLog('requestDevice: ' + e.message);
    addLog('Dùng Chrome/Edge (máy tính, Android) hoặc Bluefy (iOS), bật Bluetooth rồi thử lại.');
    return;
  }
  bleDevice.addEventListener('gattserverdisconnected', disconnect);
  /* CHO 300ms roi moi ket noi — lay tu ban goc EPD-nRF5 (html/js/main.js dung
   * setTimeout(connect, 300)). Tren Windows, ngay sau khi hop chon thiet bi
   * dong lai thi ngan xep Bluetooth VAN dang don dep phien quet; goi
   * gatt.connect() ngay luc do hay tra ve «Connection attempt failed» ma thiet
   * bi khong he nhan duoc yeu cau nao. */
  await sleep(300);
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
  ['rprevbutton', 'rnextbutton', 'rhomebutton', 'rgotobutton', 'fullEverybutton', 'clockModebutton', 'syncClockbutton', 'btnApply', 'sendcmdbutton']
    .forEach(id => document.getElementById(id).disabled = dis);
}

/* ================= Điều khiển đọc sách ================= */

async function readerCmd(sub) { await write(EpdCmd.BOOK, [sub]); }
async function readerGoto() {
  const p = Math.max(1, parseInt(document.getElementById('gotoPage').value) || 1) - 1;
  await write(EpdCmd.BOOK, [0x10, p & 0xFF, (p >> 8) & 0xFF]);
}
// gửi giờ ĐỊA PHƯƠNG (epoch giây đã cộng múi giờ) — fw có tính năng giờ sẽ
// ACK bằng notify clk=ok; build cũ im lặng -> báo rõ để user biết cần OTA
async function syncClock() {
  const t = Math.floor(Date.now() / 1000) - new Date().getTimezoneOffset() * 60;
  const ack = waitNotify(m => (m === 'clk=ok') ? m : null, 3000);
  if (!(await write(EpdCmd.BOOK, [0x30, t & 0xFF, (t >>> 8) & 0xFF, (t >>> 16) & 0xFF, (t >>> 24) & 0xFF]))) {
    ack.catch(() => { });
    addLog('⚠ Không gửi được giờ (kết nối đang bận) — bấm lại «Đồng bộ giờ».');
    return false;
  }
  try {
    await ack;
    addLog('Máy đã nhận giờ (' + new Date().toTimeString().slice(0, 5) + ') — footer sẽ hiện giờ ở lần vẽ kế.');
    return true;
  } catch (e) {
    addLog('⚠ Máy KHÔNG xác nhận (clk=ok) — firmware trên máy là build cũ chưa có tính năng giờ. Hãy nạp firmware mới nhất bằng J-Link rồi thử lại.');
    return false;
  }
}

async function setClockMode() {
  // fw r2.2+: [0x28 0x31 0/1/2] — cơ hội / nhảy từng phút / tắt
  const v = Math.min(2, Math.max(0, parseInt(document.getElementById('clockMode').value) || 0));
  if (!(await syncClock())) return;  // gửi giờ trước; máy không ACK thì khỏi đặt chế độ
  if (await write(EpdCmd.BOOK, [0x31, v]))
    addLog('Giờ thiết bị: ' + ['cập nhật khi chuyển trang', 'tự động cập nhật', 'tắt hiển thị'][v] + '.');
}

// (setFontSize/setRotation đã BỎ: cỡ chữ + hướng màn chỉ đổi preview tại chỗ,
// áp xuống máy kèm lệnh mở phiên [0x01 type font rot] khi bấm «Gửi sách».
// Firmware vẫn giữ BOOK 0x22/0x23 cho tương thích.)

async function setFullEvery() {
  let n = parseInt(document.getElementById('fullEvery').value);
  if (isNaN(n) || n < 0 || n > 60) n = 0;  // mặc định: tắt
  if (await write(EpdCmd.BOOK, [0x20, n]))
    addLog(n === 0 ? 'Đã tắt làm mới màn hình khi lật trang (chỉ làm sạch khi vào/ra Trang chủ).'
                   : `Đã đặt: làm mới màn hình sau mỗi ${n} trang lật (không chớp đen).`);
}

/* ================= Nút bấm vật lý ================= */

const BTN_PIN_OPTIONS = [
  ['FF', 'Mặc định'], ['FE', 'Tắt nút'],
  ['04', 'P0_4 (TX)'], ['02', 'P0_2 (SCL)'], ['01', 'P0_1 (SDA)'], ['05', 'P0_5 (RX)'],
  ['14', 'P1_4 (SWCLK)'], ['15', 'P1_5 (SWDIO)'],
  ['10', 'P1_0'], ['11', 'P1_1'], ['12', 'P1_2'], ['13', 'P1_3'],
  ['22', 'P2_2'], ['24', 'P2_4'], ['28', 'P2_8'], ['29', 'P2_9'],
];
// 3 nút, mặc định theo pad board 6TP — NEXT/PREV đã đảo theo yêu cầu:
// NEXT=SWCLK, PREV=TX, SEL=SWDIO
const BTN_DEFAULTS = { btnNext: 0x14, btnPrev: 0x04, btnSel: 0x15 };

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

// ---- bảng mã EVN1 (fw r2.1+): chữ Việt có dấu = 1 byte thay 2-3 byte UTF-8.
// Sinh bởi fontool/gen_evn_tab.py — PHẢI khớp k_evn_tab trong READER.c.
const EVN_CHARS = 'àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠĂẰẮÂẦẤẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸĐ';
const EVN_MAP = (() => {
  const m = new Map();
  [...EVN_CHARS].forEach((c, i) => m.set(c.codePointAt(0), 0x80 + i));
  return m;
})();

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

function loadTextBook(text, title) {
  text = normalizeText(text);
  if (!text) throw new Error('File không có nội dung chữ.');
  const chars = [...text];
  const enc = evnEncode(text);
  const all = enc.bytes;
  // chia phần <= sức chứa tại ranh giới đoạn (\n), không cắt giữa escape EVN1
  const parts = [];
  let off = 0;
  while (off < all.length) {
    const cap = textPartCap();
    let end = Math.min(off + cap, all.length);
    if (end < all.length) {
      let nl = -1;
      for (let i = end; i > off + cap / 2; i--) {
        if (all[i] === 10) { nl = i; break; }
      }
      if (nl > 0) end = nl;
      else while (end > off && !enc.starts[end]) end--;
    }
    const c0 = enc.charAt[off];
    const c1 = end < all.length ? enc.charAt[end] : chars.length;
    parts.push({ bytes: all.slice(off, end), text: chars.slice(c0, c1).join('').replace(/^\n+/, '') });
    off = end;
    while (off < all.length && all[off] === 10) off++;
  }
  book = { type: 'text', title: (title || 'Sách').slice(0, 60), parts, raw: text };
}

// Chia phần lại sách đang nạp theo sức chứa hiện tại — gọi khi nhận flash=
// (biết chip thật, có thể lớn hơn 512KB) hoặc khi đổi cỡ chữ/hướng màn, vì
// trần MỤC LỤC của sách chữ đổi theo lưới chữ.
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

/* ================= Xem trước & thông tin sách ================= */

// khớp lưới chữ của fw 7.5" theo cỡ chữ đã chọn (fontSize):
// [rộng TB một ký tự (px), dòng/trang, cỡ px, bước dòng, baseline dòng đầu]
// cho hướng ngang 800x480 (784px chữ) và DỌC 480x800 (464px chữ — rd_rot=1).
// TÁM cỡ (rd_font 0..7): 12/14/16/18px vẽ bằng font riêng, còn 24/28/32/36px
// là bốn cỡ trên NHÂN ĐÔI ĐIỂM ẢNH (firmware hết chỗ flash cho font riêng —
// xem k_fonts trong READER.c). Nhân đôi thì bề rộng trung bình cũng nhân đôi.
// Số DÒNG lấy đúng bảng k_fonts/k_fonts_p trong READER.c.
//
// Bề rộng TB mỗi ký tự dùng để HIỆU CHUẨN phép đo chữ của trình duyệt về đúng
// font vnXX của máy (xem buildPreviewTextPages). Con số 12px ĐO TRÊN MÁY THẬT
// (2026-08-15): đọc mảng mốc dòng m_lc của firmware qua J-Link, các dòng đầy
// dài 126-137 byte nguồn -> 784px / ~127 ký tự = 6,2 px/ký tự. Hai cỡ còn lại
// suy theo đúng tỉ lệ của bảng cũ (×0,855).
// Bảng cũ lấy từ bản 4.2" (7,25 / 8,0 / 9,4) HẸP HƠN THỰC TẾ ~17%: xem trước
// chỉ ra 108 ký tự/dòng trong khi máy xếp được 127, nên số trang ước lượng
// vống lên chừng đó.
// Đây CHỈ để xem trước và ước lượng số trang — bản phân trang THẬT do firmware
// tự dựng bằng chính hàm wrap và font của nó, nên không bao giờ lệch.
const PREVIEW_METRICS = [
  [6.20, 32, 12, 14, 13], [6.99, 26, 14, 17, 15], [8.03, 23, 16, 19, 17], [9.08, 20, 18, 22, 19],
  [12.40, 16, 24, 28, 26], [13.97, 13, 28, 34, 30], [16.07, 11, 32, 38, 34], [18.16, 10, 36, 44, 38]];
const PREVIEW_METRICS_P = [
  [6.20, 55, 12, 14, 13], [6.99, 45, 14, 17, 15], [8.03, 40, 16, 19, 17], [9.08, 35, 18, 22, 19],
  [12.40, 27, 24, 28, 26], [13.97, 22, 28, 34, 30], [16.07, 20, 32, 38, 34], [18.16, 17, 36, 44, 38]];
// bề rộng chữ MỘT DÒNG trên máy — khớp READER_TEXT_W / READER_TEXT_W_P
const PREVIEW_TEXT_W = 784, PREVIEW_TEXT_W_P = 464;
function previewRot() { return document.getElementById('rotMode').value === '1'; }
function previewMetric() {
  const t = previewRot() ? PREVIEW_METRICS_P : PREVIEW_METRICS;
  return t[Math.min(t.length - 1, Math.max(0, parseInt(document.getElementById('fontSize').value) || 0))];
}

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
  previewPage = 0;
  previewTextPages = null;
  if (book.type === 'text') {
    const total = book.parts.reduce((n, p) => n + p.bytes.length, 0);
    // dựng luôn bản phân trang xem trước của phần đang chọn: vừa để ước lượng
    // số trang, vừa là cache cho renderPreview() ngay bên dưới
    const cur = currentPart();
    previewTextPages = buildPreviewTextPages(cur.text);
    const estPages = book.parts.reduce((n, p) => n + estimateDevicePages(p.text, p === cur ? previewTextPages : null), 0);
    s.textContent = `Sách chữ: ${fmtKB(total)}, ước lượng ~${estPages} trang màn hình` +
      (book.parts.length > 1 ? ` — chia ${book.parts.length} phần, mỗi lần gửi một phần.` : '.');
  } else {
    s.textContent = `Truyện tranh: ${comicPages.length} trang` +
      (book.parts.length > 1 ? ` — chia ${book.parts.length} phần (~${book.parts[0].pages.length} trang/phần tùy độ nén), mỗi lần gửi một phần.` : '.');
  }
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

// Phân trang XEM TRƯỚC — CÙNG LUẬT CẮT DÒNG với reader_wrap_line() của
// firmware: ghép thêm từ khi còn vừa BỀ RỘNG dòng, hết chỗ thì chốt dòng ở TỪ
// TRỌN VẸN cuối cùng, chỉ bẻ giữa từ khi một từ dài hơn cả dòng.
// (Bản cũ cắt cứng theo SỐ ký tự và chỉ lùi về dấu cách khi nó nằm ở nửa sau
// dòng — từ dài là bẻ đôi, lại không phân biệt chữ rộng/chữ hẹp.)
// Trình duyệt đo bằng font sans-serif của nó chứ không phải font vnXX của máy,
// nên nhân thêm hệ số hiệu chuẩn để bề rộng trung bình khớp máy thật.
function buildPreviewTextPages(text) {
  const [avgW, lpp, px] = previewMetric();
  const maxW = previewRot() ? PREVIEW_TEXT_W_P : PREVIEW_TEXT_W;
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = px + 'px sans-serif';
  const SAMPLE = 'Những người con gái đi qua cánh đồng lúa chín vàng rực rỡ ban trưa';
  const k = avgW * SAMPLE.length / Math.max(1, ctx.measureText(SAMPLE).width);
  const cache = new Map();
  const wOf = s => {
    let v = cache.get(s);
    if (v === undefined) { v = ctx.measureText(s).width * k; cache.set(s, v); }
    return v;
  };
  const spW = wOf(' ');
  const pages = [];
  let lines = [], full = false;
  const push = l => {
    lines.push(l);
    if (lines.length === lpp) {
      pages.push(lines);
      lines = [];
      if (pages.length > 400) full = true; // đủ để xem trước
    }
  };
  for (const para of text.split('\n')) {
    if (full) break;
    if (!para) continue;  // dòng trống KHÔNG chiếm hàng (máy cũng nuốt)
    let line = '', w = 0;
    for (let word of para.split(' ')) {
      if (full || word === '') continue;
      let ww = wOf(word);
      if (line && w + spW + ww <= maxW) { line += ' ' + word; w += spW + ww; continue; }
      if (line) { push(line); line = ''; w = 0; }
      while (ww > maxW && !full) {  // từ dài hơn cả dòng: bẻ cứng như firmware
        let lo = 1, hi = word.length;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (wOf(word.slice(0, mid)) <= maxW) lo = mid; else hi = mid - 1;
        }
        push(word.slice(0, lo));
        word = word.slice(lo);
        ww = wOf(word);
      }
      line = word;
      w = ww;
    }
    if (line && !full) push(line);
  }
  if (lines.length) pages.push(lines);
  return pages;
}

// Ước lượng số trang MÁY sẽ chốt: lấy mật độ chữ đo được từ bản phân trang xem
// trước (nay cùng luật wrap với firmware) rồi suy ra cho cả phần. Bản cũ dùng
// hằng số byte/trang của máy 4.2" nên lệch ~3 lần trên màn 7.5" — thanh tiến
// độ lúc máy phân trang nhảy vọt lên 99% rồi đứng im.
function estimateDevicePages(text, pv) {
  const pages = pv || buildPreviewTextPages(text);
  if (!pages.length || !text.length) return 1;
  const chars = pages.reduce((n, p) => n + p.reduce((m, l) => m + l.length + 1, 0), 0);
  return Math.max(1, Math.round(text.length / Math.max(1, chars / pages.length)));
}

function previewStep(d) {
  previewPage += d;
  renderPreview();
}

async function renderPreview() {
  const canvas = document.getElementById('canvas');
  // canvas theo hướng: sách chữ + chế độ dọc = 480x800, còn lại 800x480
  // (truyện tranh và preview trống luôn ngang — máy không xoay truyện tranh)
  const portrait = book && book.type === 'text' && previewRot();
  const W = portrait ? 480 : 800, H = portrait ? 800 : 480;
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, W, H);
  const label = document.getElementById('previewPageLabel');
  if (!book) { label.textContent = '—'; return; }

  if (book.type === 'text') {
    const part = currentPart();
    if (!previewTextPages) previewTextPages = buildPreviewTextPages(part.text);
    previewPage = Math.max(0, Math.min(previewPage, previewTextPages.length - 1));
    const lines = previewTextPages[previewPage] || [];
    const [, , px, lh, y0] = previewMetric();
    ctx.fillStyle = 'black';
    ctx.font = px + 'px sans-serif';
    lines.forEach((l, i) => ctx.fillText(l, 8, y0 + i * lh, W - 16));
    ctx.fillRect(8, H - 20, W - 16, 1);
    ctx.font = '10px monospace';
    ctx.fillText(`${previewPage + 1}/${previewTextPages.length} (xem trước ước lượng)`, 8, H - 6);
    label.textContent = `${previewPage + 1}/${previewTextPages.length}`;
  } else {
    const part = currentPart();
    previewPage = Math.max(0, Math.min(previewPage, part.pages.length - 1));
    const plane = comicRenderPlane(part.pages[previewPage]);
    const img = ctx.createImageData(800, 480);
    for (let i = 0; i < 800 * 480; i++) {
      const v = (plane[i >> 3] >> (7 - (i & 7))) & 1 ? 255 : 0;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    label.textContent = `${previewPage + 1}/${part.pages.length}`;
  }
}
function comicRepreview() { renderPreview(); }

// vẽ 1 trang truyện về mặt phẳng 1-bit 48000B (bit 1 = trắng, như firmware)
function comicRenderPlane(pageIdx) {
  const bmp = comicPages[pageIdx];
  const rot = document.getElementById('comicRotate').checked;
  const cv = document.createElement('canvas');
  cv.width = 800;
  cv.height = 480;
  const c = cv.getContext('2d');
  c.fillStyle = 'white';
  c.fillRect(0, 0, 800, 480);
  const w = rot ? bmp.height : bmp.width;
  const h = rot ? bmp.width : bmp.height;
  const scale = Math.min(800 / w, 480 / h);
  c.save();
  c.translate(200, 150);
  if (rot) c.rotate(Math.PI / 2);
  c.scale(scale, scale);
  c.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
  c.restore();

  const imageData = c.getImageData(0, 0, 800, 480);
  adjustContrast(imageData, parseFloat(document.getElementById('ditherContrast').value));
  const alg = document.getElementById('ditherAlg').value;
  const strength = parseFloat(document.getElementById('ditherStrength').value);
  const dithered = ditherImage(imageData, alg, strength, 'blackWhiteColor');
  return processImageData(dithered, 'blackWhiteColor'); // 48000B, bit 1 = trắng
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

    // sách chữ gửi bảng mã EVN1 (type 3) — mọi bản phát hành (r1.0+) đều hiểu;
    // gate < r2.1 dev cũ đã bỏ khi đánh số lại phiên bản công khai từ r1.0
    const type = book.type === 'text' ? 3 : 2;
    setStatus('Mở phiên nhận sách trên thiết bị...');
    // gửi kèm cỡ chữ + hướng màn đang chọn: máy đặt config rồi phân trang
    // sách mới theo lưới đó luôn (2 select không còn nút Áp dụng riêng —
    // đổi lựa chọn chỉ cập nhật preview, bấm gửi sách mới áp xuống máy)
    const bkFont = Math.min(PREVIEW_METRICS.length - 1, Math.max(0, parseInt(document.getElementById('fontSize').value) || 0));
    const bkRot = document.getElementById('rotMode').value === '1' ? 1 : 0;
    // TƯƠNG THÍCH build cũ chưa hiểu 0x01 mở rộng [font, rot]: máy đang lưu
    // giá trị khác thì gửi lệnh đổi trực tiếp trước — config được ghi ngay,
    // còn phiên phân-trang-lại 2 lệnh này khởi động sẽ bị 0x01 hủy tức thì
    // (rx_begin abort reindex) nên không tốn thời gian chờ
    if (devFont !== null && devFont !== bkFont) await write(EpdCmd.BOOK, [0x22, bkFont]);
    if (devRot !== null && devRot !== bkRot) await write(EpdCmd.BOOK, [0x23, bkRot]);
    const ack = waitNotify(m => (m === 'book=rx') ? m : (m === 'book=err' ? new Error('thiết bị từ chối (book=err)') : null), 8000);
    await write(EpdCmd.BOOK, [0x01, type, bkFont, bkRot]);
    await ack;
    devFont = bkFont;
    devRot = bkRot;
    setProgress(2);

    let pages = 0, dataLen = 0;
    if (type === 3) {
      // sách chữ: gửi nội dung chiếm 2..80%, máy phân trang 80..99%
      await sendChunks(part.bytes, BOOK_DATA_OFF, 'nội dung', 2, 78);
      dataLen = part.bytes.length;
      // ước lượng số trang theo lưới chữ ĐANG CHỌN (cùng luật wrap với máy)
      idxEstPages = estimateDevicePages(part.text);
    } else {
      // truyện tranh: nén 2..30%, mục lục 30..34%, dữ liệu 34..95%
      const blobs = [];
      let total = 0;
      for (const pi of part.pages) {
        setStatus(`Đang nén trang ${blobs.length + 1}/${part.pages.length}... (${fmtKB(total)}/${fmtKB(storeDataCap())} kho)`);
        setProgress(2 + 28 * (blobs.length / part.pages.length));
        await sleep(1); // nhả UI
        const blob = rleEncode(comicRenderPlane(pi));
        if (total + blob.length > storeDataCap()) {
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
    setStatus(type === 3 ? 'Chốt sách — máy đang phân trang (sách dài có thể ~30s)...' : 'Chốt sách...');
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
    // byte thứ 4 của len luôn 0 (sách <= 224KB, dưới 16MB) — chèn vào giữa
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
