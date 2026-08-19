// Webtool MÁY ĐỌC SÁCH e-ink 4.2" (firmware epd_reader_4_2inch, dòng r1.x).
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

// kho sách trên máy: vùng riêng từ 0x40000 tới (dung lượng chip - 2 sector
// hệ thống); dữ liệu bắt đầu tại +0x5000. Kho bắt đầu ở 0x40000 (không phải
// 0x39000) vì firmware CHỪA khe hệ thống của bản lịch — OTA hai chiều lịch
// <-> đọc sách không mất kích hoạt. Dung lượng chip đọc từ thông báo flash=
// (JEDEC) lúc kết nối — chip 512KB: 224KB sách; chip 2MB (FM25Q16A): ~1.76MB.
// Mục lục trên máy tối đa 4000 trang nên sách CHỮ còn bị trần 3900 trang.
const BOOK_IDX_OFF = 0x1000;
const BOOK_DATA_OFF = 0x5000;   // mục lục 4 sector (fw r1.0+: 4000 trang)
const MAX_PAGES_PART = 900;     // truyện tranh: chip 2MB chứa ~350 trang/phần
let devFlashBytes = 512 * 1024;  // mặc định chip chuẩn; cập nhật khi nhận flash=
function storeDataCap() {
  const end = devFlashBytes - 4096;  // chỉ config ở sector cuối (act ở 0x3C000)
  return Math.max(0, end - 0x40000 - BOOK_DATA_OFF - 4096);  // chừa 1 sector lề
}
function textPartCap() {
  const [cpl, lpp] = previewMetric();  // trần mục lục 4000 trang (chừa lề 3900)
  return Math.min(storeDataCap(), 3900 * cpl * lpp);
}
const PLANE_SIZE = 15000; // 400x300 / 8


/* ================= BLE core (rút gọn từ webtool 4_2inch) ================= */


// ---- chờ notify ----
let mtuNotifyResolve = null;
let notifyWaiters = [];

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
      addLog('⚠ Hãy nạp firmware fw_reader_4_2inch_rX.Y.bin (mục OTA bên dưới) trước khi gửi sách.');
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
      addLog('⚠ Chip flash ' + kb + 'KB — KHÔNG đủ chỗ cho kho sách (cần 512KB, ví dụ board 6TP). ' +
        'Trên board này firmware đọc sách giữ được kích hoạt/cấu hình nhưng KHÔNG nhận sách được.');
    } else if (kb >= 512) {
      // sức chứa kho sách theo chip thật (fw r1.0+ tự nở kho theo JEDEC);
      // chip lớn hơn 512KB -> chia phần lại sách đang nạp theo kho mới
      const bytes = Math.min(kb * 1024, 16 * 1024 * 1024);
      if (bytes !== devFlashBytes) {
        devFlashBytes = bytes;
        addLog(`Kho sách trên máy: ~${Math.floor(storeDataCap() / 1024)}KB`);
        bookResplit();
      }
    }
  } else if (msg === 'locked') {
    addLog('⚠ Thiết bị chưa kích hoạt — liên hệ nhà cung cấp.');
  }
  feedNotifyWaiters(msg);
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
      // CHỈ máy đọc sách DIY-4_2R-xxxx (yêu cầu user) — không hiện máy lịch
      // DIY-4_2 chuẩn nữa; cần quét mọi thiết bị thì thêm ?debug=true
      filters: [{ namePrefix: 'DIY-4_2R' }],
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


function updateButtonStatus(busy = false) {
  const connected = gattServer != null && gattServer.connected;
  const dis = (busy || !connected) ? 'disabled' : null;
  // Hàm này chạy TRONG body.onload lúc hub nạp app: một id thiếu là ném lỗi
  // và cả giao diện không dựng được («Lỗi tải giao diện»). Vì trang hub và
  // trang standalone không có cùng bộ nút (nút kết nối nằm ở khung chung của
  // hub), luôn kiểm tra phần tử có tồn tại đã.
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.disabled = v; };
  set('reconnectbutton', (gattServer == null || connected) ? 'disabled' : null);
  set('sendbookbutton', (dis || !book) ? 'disabled' : null);
  ['rprevbutton', 'rnextbutton', 'rhomebutton', 'rgotobutton', 'fullEverybutton', 'clockModebutton', 'syncClockbutton', 'btnApply', 'otabutton', 'sendcmdbutton']
    .forEach(id => set(id, dis));
}

/* ================= Điều khiển đọc sách ================= */

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
    addLog('⚠ Máy KHÔNG xác nhận (clk=ok) — firmware trên máy là build cũ chưa có tính năng giờ. Hãy cập nhật firmware mới nhất (mục OTA) rồi thử lại.');
    return false;
  }
}


// (setFontSize/setRotation đã BỎ: cỡ chữ + hướng màn chỉ đổi preview tại chỗ,
// áp xuống máy kèm lệnh mở phiên [0x01 type font rot] khi bấm «Gửi sách».
// Firmware vẫn giữ BOOK 0x22/0x23 cho tương thích.)


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


/* ================= Đọc & phân tích file sách ================= */

// book = { type:'text'|'image', title, parts:[...] }
//   text part: { text, bytes (Uint8Array UTF-8) }
//   image part: { pages: [index vào comicPages] }
let book = null;
let comicPages = [];   // ImageBitmap của từng trang truyện (toàn bộ file)
let previewPage = 0;   // trang đang xem trước (trong phần đang chọn)
let previewTextPages = null; // cache phân trang ước lượng của phần chữ đang chọn
let idxEstPages = 0;   // ước lượng số trang khi máy phân trang (progress bki=)


// ---- bảng mã EVN1 (fw r2.1+): chữ Việt có dấu = 1 byte thay 2-3 byte UTF-8.
// Sinh bởi fontool/gen_evn_tab.py — PHẢI khớp k_evn_tab trong READER.c.
const EVN_CHARS = 'àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠĂẰẮÂẦẤẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸĐ';
const EVN_MAP = (() => {
  const m = new Map();
  [...EVN_CHARS].forEach((c, i) => m.set(c.codePointAt(0), 0x80 + i));
  return m;
})();


function loadTextBook(text, title) {
  text = normalizeText(text);
  if (!text) throw new Error('File không có nội dung chữ.');
  const chars = [...text];
  const enc = evnEncode(text);
  const all = enc.bytes;
  // chia phần <= sức chứa kho (theo chip + trần trang của font/hướng đang
  // chọn) tại ranh giới đoạn (\n), không cắt giữa escape EVN1
  const cap = textPartCap();
  const parts = [];
  let off = 0;
  while (off < all.length) {
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
  // giữ text gốc để CHIA PHẦN LẠI khi đổi cỡ chữ/hướng màn hoặc biết chip lớn
  book = { type: 'text', title: (title || 'Sách').slice(0, 60), parts, raw: text };
}


/* ================= Xem trước & thông tin sách ================= */

// khớp metric fw r2.2 theo cỡ chữ đã chọn (fontSize):
// [ký tự/dòng, dòng/trang, px, bước dòng, baseline đầu]
// [ký tự/dòng, dòng/trang, px, bước dòng, baseline đầu] khớp lưới fw:
// ngang 400x300 (384px chữ) và DỌC 300x400 (284px chữ — rd_rot=1)
const PREVIEW_METRICS = [[53, 19, 12, 14, 13], [48, 16, 14, 17, 15], [41, 14, 16, 19, 17]];
const PREVIEW_METRICS_P = [[39, 26, 12, 14, 13], [35, 21, 14, 17, 15], [30, 19, 16, 19, 17]];
function previewMetric() {
  const t = previewRot() ? PREVIEW_METRICS_P : PREVIEW_METRICS;
  return t[Math.min(2, Math.max(0, parseInt(document.getElementById('fontSize').value) || 0))];
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
  if (book.type === 'text') {
    const total = book.parts.reduce((n, p) => n + p.bytes.length, 0);
    // số trang TÍNH ĐÚNG theo font + hướng đang chọn (bằng bộ ngắt dòng của máy)
    const pages = book.parts.reduce((n, p) => n + countTextPages(p.text), 0);
    s.textContent = `Sách chữ: ${fmtKB(total)}, ${pages} trang màn hình` +
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


/* Phân trang GIỐNG HỆT MÁY: dùng bảng bước tiến từng ký tự của chính font
 * trên thiết bị (js/font_metrics.js — trích từ mảng u8g2 trong fonts.c) và
 * lặp lại thuật toán reader_wrap_line: ghép từ tới khi quá bề rộng thì chốt
 * dòng ở dấu cách gần nhất; từ dài hơn cả dòng thì bẻ cứng theo ký tự; dòng
 * trống KHÔNG chiếm hàng. Nhờ vậy số trang xem trước = số trang máy báo.
 * (Trước đây ước lượng "ký tự/dòng" cố định — sai nhiều vì font tỉ lệ:
 * chữ 'i' 3px còn 'M' 9px.) */
function fontIdx() {
  return Math.min(2, Math.max(0, parseInt(document.getElementById('fontSize').value) || 0));
}
function textAreaWidth() { return previewRot() ? 284 : 384; }

// ngắt một đoạn văn thành các dòng vừa bề rộng maxW
function wrapParagraph(chars, adv, fallback, maxW) {
  const out = [];
  let start = 0;
  while (start < chars.length) {
    let w = 0, lastSpace = -1, cut = -1;
    for (let i = start; i < chars.length; i++) {
      const c = chars[i];
      const cw = adv[c.codePointAt(0)] ?? fallback;
      if (w + cw > maxW) {           // ký tự này làm tràn dòng
        if (lastSpace > start) {     // chốt ở dấu cách gần nhất (bỏ dấu cách)
          out.push(chars.slice(start, lastSpace).join(''));
          cut = lastSpace + 1;
        } else {                     // từ dài hơn cả dòng: bẻ cứng
          const end = Math.max(start + 1, i);
          out.push(chars.slice(start, end).join(''));
          cut = end;
        }
        break;
      }
      if (c === ' ') lastSpace = i;
      w += cw;
    }
    if (cut < 0) { out.push(chars.slice(start).join('')); break; }  // hết đoạn
    start = cut;
  }
  return out;
}

// tổng số dòng của cả text (đếm nhanh, không dựng chuỗi) — dùng cho số trang
function countTextLines(text) {
  const adv = FONT_ADV[fontIdx()], fb = FONT_ADV_FALLBACK[fontIdx()];
  const maxW = textAreaWidth();
  let lines = 0;
  for (const para of text.split('\n')) {
    if (!para) continue;             // dòng trống không chiếm hàng (như máy)
    const chars = Array.from(para);
    let start = 0;
    while (start < chars.length) {
      let w = 0, lastSpace = -1, cut = -1;
      for (let i = start; i < chars.length; i++) {
        const c = chars[i];
        const cw = adv[c.codePointAt(0)] ?? fb;
        if (w + cw > maxW) {
          cut = lastSpace > start ? lastSpace + 1 : Math.max(start + 1, i);
          break;
        }
        if (c === ' ') lastSpace = i;
        w += cw;
      }
      lines++;
      if (cut < 0) break;
      start = cut;
    }
  }
  return lines;
}

function countTextPages(text) {
  return Math.max(1, Math.ceil(countTextLines(text) / previewMetric()[1]));
}

function buildPreviewTextPages(text) {
  const lpp = previewMetric()[1];
  const adv = FONT_ADV[fontIdx()], fb = FONT_ADV_FALLBACK[fontIdx()];
  const maxW = textAreaWidth();
  const pages = [];
  let lines = [];
  for (const para of text.split('\n')) {
    if (!para) continue;  // dòng trống không chiếm hàng (như máy)
    for (const line of wrapParagraph(Array.from(para), adv, fb, maxW)) {
      lines.push(line);
      if (lines.length === lpp) { pages.push(lines); lines = []; }
    }
  }
  if (lines.length) pages.push(lines);
  return pages;
}


async function renderPreview() {
  const canvas = document.getElementById('canvas');
  // canvas theo hướng: sách chữ + chế độ dọc = 300x400, còn lại 400x300
  // (truyện tranh và preview trống luôn ngang — máy không xoay truyện tranh)
  const portrait = book && book.type === 'text' && previewRot();
  const W = portrait ? 300 : 400, H = portrait ? 400 : 300;
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
    ctx.font = px + 'px Tahoma, "Segoe UI", sans-serif';  // đúng font máy dùng
    lines.forEach((l, i) => ctx.fillText(l, 8, y0 + i * lh, W - 16));
    ctx.fillRect(8, H - 20, W - 16, 1);
    ctx.font = '10px monospace';
    ctx.fillText(`${previewPage + 1}/${previewTextPages.length}`, 8, H - 6);
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


/* ================= Gửi sách ================= */


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
    const bkFont = Math.min(2, Math.max(0, parseInt(document.getElementById('fontSize').value) || 0));
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
      // số trang máy SẼ phân (tính bằng đúng bộ ngắt dòng của máy) — thanh
      // tiến độ 80..99% nhờ vậy chạy khớp thực tế
      idxEstPages = countTextPages(part.text);
    } else {
      // truyện tranh: nén 2..30%, mục lục 30..34%, dữ liệu 34..95%
      const blobs = [];
      const dataCap = storeDataCap();
      let total = 0;
      for (const pi of part.pages) {
        setStatus(`Đang nén trang ${blobs.length + 1}/${part.pages.length}... (${fmtKB(total)}/${fmtKB(dataCap)} kho)`);
        setProgress(2 + 28 * (blobs.length / part.pages.length));
        await sleep(1); // nhả UI
        const blob = rleEncode(comicRenderPlane(pi));
        if (total + blob.length > dataCap) {
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


// Nút «Cài ngay» ở bảng «Danh sách firmware»: tải .bin của hàng đó rồi chạy
// thẳng OTA — người dùng khỏi phải tải file về máy rồi chọn lại ở ô Upload.
async function fwInstallRow(btn) {
  const tr = btn.closest('tr');
  const link = tr && tr.querySelector('a[download]');
  if (!link) { addLog('Hàng này không có file firmware để cài.'); return; }
  if (!epdCharacteristic) { addLog('Chưa kết nối thiết bị — bấm «Kết nối» rồi thử lại.'); return; }
  const ver = (tr.cells && tr.cells[1]) ? tr.cells[1].textContent.trim() : '?';
  if (!confirm('Cài firmware phiên bản ' + ver + ' vào thiết bị đang kết nối?' + String.fromCharCode(10) +
               'Thiết bị sẽ khởi động lại sau khi cập nhật — KHÔNG tắt nguồn giữa chừng!')) return;
  const otaBox = document.getElementById('otaProgress');
  if (otaBox && otaBox.closest('fieldset'))
    otaBox.closest('fieldset').scrollIntoView({ behavior: 'smooth', block: 'start' });
  let buf;
  try {
    const r = await fetch(link.getAttribute('href'), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    buf = await r.arrayBuffer();
  } catch (e) {
    addLog('Không tải được file firmware: ' + e.message);
    return;
  }
  addLog('Đã tải ' + link.getAttribute('href').split('/').pop() + ' (' + buf.byteLength + ' byte) — bắt đầu OTA.');
  await otaUpdate(buf);
}

async function otaUpdate(preBuf) {
  // preBuf (ArrayBuffer): từ nút «Cài ngay» của bảng firmware
  const fileInput = document.getElementById('otaFile');
  if (!preBuf && (!fileInput || fileInput.files.length === 0)) { addLog('Chọn file firmware .bin trước.'); return; }
  if (!epdCharacteristic) { addLog('Chưa kết nối thiết bị.'); return; }
  const firmBuf = new Uint8Array(preBuf ? preBuf : await fileInput.files[0].arrayBuffer());
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
