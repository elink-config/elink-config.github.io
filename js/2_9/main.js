let bleDevice, gattServer;
let hmService;                 // service HMCLOCK 0xff00
let longValueChar;             // 0xff01 — ghi lệnh + đọc trạng thái
let adcChar;                   // 0xff02 — đọc điện áp pin
let startTime, msgIndex;
let canvas, ctx, textDecoder;
let paintManager, cropManager;
let deviceMode = null;      // chế độ thiết bị báo về (1 = đồng hồ, 28 = ảnh)
let timeSynced = false;     // đã đồng bộ giờ — mở khóa chọn giao diện màn hình

// Bản 2.9" (DIY-2_9-xxxx): panel HINK-E029A10-A3 296×128 BWR, firmware đủ
// 29 chế độ như bản 2.13" (thêm màu ĐỎ cho phần tử tĩnh). Giao thức HMCLOCK,
// KHÔNG có lệnh đổi phân giải 0x96 (panel cố định); có 0x99 sự kiện, 0x9a
// ghi chú, 0x9b/0x9c tự thiết kế. Tất cả trên service 0xff00:
// - 0xff01 (Long Value): GHI lệnh + ĐỌC trạng thái 15 byte
//     0x91 yyyy(LE) MM dd hh mm ss ww lyear lmonth lday   đặt giờ (+ âm lịch)
//     0x90 đổi 12/24h · 0x92 <int16 LE> hiệu chỉnh nhanh/chậm
//     0x93 <offset u16 LE> <data…>  ghi khối ảnh
//     0x94 [01]   hiển thị ảnh (01 = nạp ảnh đã lưu từ flash)
//     0x95 lưu ảnh vào flash · 0x97 đọc nhiệt độ
//     0x98 <mode> chọn giao diện (1-27, 29 — ẢNH 28 đặt bằng 0x94)
//     0x9d <en>   làm mới toàn màn mỗi giờ (1) / chỉ 00:00 (0)
//     0x9F khởi động lại · 0xA0/A2/A3/A4 OTA firmware
//   Trạng thái đọc về: [0-1] năm LE, [2] tháng 0-11, [3] ngày, [4-6] h/m/s,
//     [7-10] phút từ lần đặt giờ (int32 LE, -1 = chưa), [11] không dùng,
//     [12] nhiệt độ int8, [13] chế độ (1 hoặc 28), [14] làm mới mỗi giờ
// - 0xff02: điện áp pin (uint16 LE, mV)
// UUID viết dạng chuỗi 128-bit ĐẦY ĐỦ — Bluefy/WebBLE trên iOS không hiểu
// số tắt (0xff00) trong optionalServices.
const HM_SERVICE = '0000ff00-0000-1000-8000-00805f9b34fb';
const HM_LONG_VALUE = '0000ff01-0000-1000-8000-00805f9b34fb';
const HM_ADC = '0000ff02-0000-1000-8000-00805f9b34fb';
// CHỈ chấp nhận thiết bị tên DIY-… (DIY-2_9-xxxx) — giống webtool 2_13/4_2.
const BLE_NAME_PREFIX = 'DIY-';
const BLE_REQUEST_FILTERS = [
  { namePrefix: BLE_NAME_PREFIX },
];

// Panel cố định 296×128 (canvas ngang, buffer 296 cột × 16 byte = 4736 byte)
const PANEL_W = 296;
const PANEL_H = 128;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function logBleConnectHelp(error) {
  addLog(`connect: ${error.name} - ${error.message}`);
  addLog('Gợi ý xử lý khi kết nối thất bại:');
  addLog('1. Đảm bảo thiết bị đã nạp firmware, tên Bluetooth là DIY-…');
  addLog('2. Đặt thiết bị gần máy tính, màn hình chưa vào chế độ ngủ');
  addLog('3. Windows: xóa ghép nối cũ trong cài đặt Bluetooth rồi thử lại');
  addLog('4. Ngắt kết nối thiết bị khỏi điện thoại/máy tính khác');
  addLog('5. Dùng Chrome/Edge và mở trang qua https hoặc localhost');
}

async function connectGattWithRetry(device, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (device.gatt.connected) return device.gatt;
      if (attempt > 1) {
        addLog(`Thử kết nối lại ${attempt}/${maxAttempts}...`);
        try { device.gatt.disconnect(); } catch (e) {}
        await sleep(500 * attempt);
      }
      return await device.gatt.connect();
    } catch (e) {
      lastError = e;
      console.error(e);
    }
  }
  throw lastError;
}

function hex2bytes(hex) {
  hex = (hex || '').replace(/[^0-9a-fA-F]/g, '');  // tolerate spaces/0x/punctuation
  for (var bytes = [], c = 0; c + 2 <= hex.length; c += 2)
    bytes.push(parseInt(hex.substr(c, 2), 16));
  return new Uint8Array(bytes);
}

function bytes2hex(data) {
  return new Uint8Array(data).reduce(
    function (memo, i) {
      return memo + ("0" + i.toString(16)).slice(-2);
    }, "");
}

function resetVariables() {
  deviceMode = null;
  timeSynced = false;
  gattServer = null;
  hmService = null;
  longValueChar = null;
  adcChar = null;
  msgIndex = 0;
  document.getElementById("log").innerHTML = '';
}

// ghi lệnh vào characteristic Long Value (0xff01)
async function write(data, silent = false) {
  if (!longValueChar) {
    addLog("Dịch vụ không khả dụng, vui lòng kiểm tra kết nối Bluetooth");
    return false;
  }
  if (typeof data == 'string') data = hex2bytes(data);
  if (!(data instanceof Uint8Array)) data = Uint8Array.from(data);
  if (!silent) addLog(bytes2hex(data.slice(0, 12)) + (data.length > 12 ? '…' : ''), '⇑');
  try {
    await longValueChar.writeValueWithResponse(data);
  } catch (e) {
    console.error(e);
    if (e.message) addLog("write: " + e.message);
    return false;
  }
  return true;
}

// Đọc trạng thái 15 byte từ Long Value (0xff01): giờ thiết bị + nhiệt độ màn
// hình + chế độ hiển thị. Trả về object hoặc null.
async function readStatus(quiet = false) {
  if (!longValueChar) return null;
  try {
    const v = await longValueChar.readValue();
    if (v.byteLength < 11) return null;
    const st = {
      year: v.getUint16(0, true),
      month: v.getUint8(2),          // 0-11
      mday: v.getUint8(3),
      hour: v.getUint8(4),
      minute: v.getUint8(5),
      second: v.getUint8(6),
      calMinute: v.getInt32(7, true),
      temp: v.byteLength >= 14 ? v.getInt8(12) : null,
      mode: v.byteLength >= 14 ? v.getUint8(13) : null,
      // [14] lịch làm mới toàn màn (0x9d): 1 = mỗi giờ, 0 = chỉ lúc 00:00
      hourlyFull: v.byteLength >= 15 ? v.getUint8(14) : null,
      // [15] màn hình đang làm mới (firmware >= 0x0D) — chờ trước khi gửi ảnh
      refreshing: v.byteLength >= 16 ? v.getUint8(15) : 0,
    };
    if (!quiet) {
      addLog('Giờ thiết bị: ' + st.year + '-' + String(st.month + 1).padStart(2, '0') +
        '-' + String(st.mday).padStart(2, '0') + ' ' + String(st.hour).padStart(2, '0') +
        ':' + String(st.minute).padStart(2, '0') + ':' + String(st.second).padStart(2, '0'), '⇓');
    }
    // giờ đã từng được đặt (firmware khởi động ở 2025-01) → mở khóa giao diện
    if (st.year >= 2026) timeSynced = true;
    if (st.temp !== null) showPanelTemp(st.temp);
    if (st.hourlyFull !== null) {
      const chk = document.getElementById('hourlyFullCHK');
      if (chk) chk.checked = st.hourlyFull !== 0;
    }
    if (st.mode !== null) {
      deviceMode = st.mode;                 // 1 = đồng hồ, 28 = ảnh (thẻ 'img')
      if (typeof highlightMode === 'function') highlightMode(st.mode === 28 ? 'img' : st.mode);
    }
    updateButtonStatus();
    return st;
  } catch (e) {
    console.error(e);
    if (!quiet && e.message) addLog("readStatus: " + e.message);
    return null;
  }
}

// Đọc điện áp pin (0xff02, uint16 LE mV)
async function readVoltage() {
  if (!adcChar) return null;
  try {
    const v = await adcChar.readValue();
    const mv = v.getUint16(0, true);
    const el = document.getElementById('battVolt');
    if (el) el.textContent = (mv / 1000).toFixed(2) + ' V';
    return mv;
  } catch (e) {
    console.error(e);
    return null;
  }
}

// Đóng gói canvas (ngang) thành buffer màn hình (dọc): duyệt cột từ phải
// sang trái, mỗi cột đóng thành ceil(chiều cao / 8) byte, bit thừa = trắng.
//   296×128 → 128 bit/cột (16 byte) → 4736 byte
// (đúng bằng bố cục framebuffer của firmware: mỗi dòng panel = line_bytes byte).
function canvas2bytesBW(cv) {
  const c2d = cv.getContext('2d');
  const imageData = c2d.getImageData(0, 0, cv.width, cv.height);
  const padH = Math.ceil(cv.height / 8) * 8;
  const arr = [];
  let buffer = [];
  for (let x = cv.width - 1; x >= 0; x--) {
    for (let y = 0; y < padH; y++) {
      if (y >= cv.height) {
        buffer.push(1); // bit đệm ngoài màn hình: trắng
      } else {
        const idx = (cv.width * 4 * y) + x * 4;
        buffer.push(imageData.data[idx] > 127 && imageData.data[idx + 1] > 127 && imageData.data[idx + 2] > 127 ? 1 : 0);
      }
      if (buffer.length === 8) {
        arr.push(parseInt(buffer.join(''), 2));
        buffer = [];
      }
    }
  }
  return new Uint8Array(arr);
}

// Đóng gói canvas 3 MÀU thành HAI mặt (cùng thứ tự cột như canvas2bytesBW):
//   bw : 1 = trắng (pixel đỏ để nền trắng ở mặt này), 0 = đen
//   red: 1 = đỏ, 0 = không — khớp RAM 0x26 của SSD1680 trên firmware
// Sau dithering threeColor, pixel canvas là thuần (0,0,0)/(255,255,255)/(255,0,0).
function canvas2planes(cv) {
  const c2d = cv.getContext('2d');
  const d = c2d.getImageData(0, 0, cv.width, cv.height).data;
  const padH = Math.ceil(cv.height / 8) * 8;
  const bw = [], red = [];
  let b1 = [], b2 = [];
  for (let x = cv.width - 1; x >= 0; x--) {
    for (let y = 0; y < padH; y++) {
      let vbw = 1, vred = 0;
      if (y < cv.height) {
        const i = (cv.width * 4 * y) + x * 4;
        const r = d[i], g = d[i + 1], bl = d[i + 2];
        if (r > 127 && g < 128) { vred = 1; vbw = 1; }        // đỏ
        else vbw = (r > 127 && g > 127 && bl > 127) ? 1 : 0;  // trắng / đen
      }
      b1.push(vbw); b2.push(vred);
      if (b1.length === 8) {
        bw.push(parseInt(b1.join(''), 2));
        red.push(parseInt(b2.join(''), 2));
        b1 = []; b2 = [];
      }
    }
  }
  return { bw: new Uint8Array(bw), red: new Uint8Array(red) };
}

// Gửi mặt ĐỎ theo khối: 0x9e <sub> + offset(2 LE) + dữ liệu
//   sub 0x00 = vào thẳng RAM panel (đường hiển thị)
//   sub 0x01 = vào flash (đường «Lưu ảnh vào flash»)
async function writeRedPlane(data, sub, label) {
  const mtu = parseInt(document.getElementById('mtusize').value) || 244;
  const chunkSize = Math.max(16, mtu - 7);  // 4 byte header + dư an toàn ATT
  const count = Math.ceil(data.length / chunkSize);
  let idx = 0;
  for (let i = 0; i < data.length; i += chunkSize) {
    const t = (new Date().getTime() - startTime) / 1000.0;
    setStatus(`${label}: ${idx + 1}/${count}, thời gian: ${t}s`);
    const payload = [0x9e, sub, i & 0xFF, (i >> 8) & 0xFF, ...data.slice(i, i + chunkSize)];
    if (!await write(payload, true)) return false;
    idx++;
  }
  return true;
}

// Gửi ảnh theo khối: 0x93 + offset(2, little-endian) + dữ liệu
async function writeImage(data) {
  const mtu = parseInt(document.getElementById('mtusize').value) || 244;
  const chunkSize = Math.max(16, mtu - 6);  // 3 byte header + dư an toàn ATT
  const count = Math.ceil(data.length / chunkSize);
  let chunkIdx = 0;

  for (let i = 0; i < data.length; i += chunkSize) {
    let currentTime = (new Date().getTime() - startTime) / 1000.0;
    setStatus(`Khối đen trắng: ${chunkIdx + 1}/${count}, thời gian: ${currentTime}s`);
    const payload = [0x93, i & 0xFF, (i >> 8) & 0xFF, ...data.slice(i, i + chunkSize)];
    if (!await write(payload, true)) return false;
    chunkIdx++;
  }
  return true;
}

// Đặt giờ (lệnh 0x91 của HMCLOCK/weble): năm(2 LE) + tháng(0-11) + ngày + giờ
// + phút + giây + thứ(0-6) + năm âm lịch(-2020) + tháng âm lịch(0-based, bit7
// = tháng nhuận) + ngày âm lịch. Âm lịch tính bằng lịch Trung Quốc của trình
// duyệt (giống weble) — đồng hồ HMCLOCK dùng nó để hiển thị ngày âm.
function lunarToday(now) {
  try {
    let s = now.toLocaleDateString('zh-CN-u-ca-chinese', { month: 'numeric', day: 'numeric' });
    let leap = 0;
    if (s.charAt(0) === '闰') { leap = 128; s = s.substring(1); }
    const parts = s.split('-');
    const ys = now.toLocaleDateString('zh-CN-u-ca-chinese', { year: 'numeric' });
    return {
      year: parseInt(ys.substring(0, 4)),
      month: leap + parseInt(parts[0]),
      day: parseInt(parts[1]),
    };
  } catch (e) {
    console.error('lunar', e);
    return { year: 2020, month: 1, day: 1 };  // dự phòng nếu trình duyệt không hỗ trợ
  }
}

async function sendTimeSync() {
  const now = new Date();
  const lunar = lunarToday(now);
  const data = [
    0x91,
    now.getFullYear() & 0xFF,
    (now.getFullYear() >> 8) & 0xFF,
    now.getMonth(),          // 0-11 (định dạng HMCLOCK)
    now.getDate(),
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
    now.getDay(),            // 0 = Chủ nhật (định dạng HMCLOCK)
    (lunar.year - 2020) & 0xFF,
    (lunar.month - 1) & 0xFF,
    lunar.day & 0xFF,
  ];
  if (await write(data)) {
    addLog("Đã đồng bộ thời gian! Thiết bị chuyển về màn hình đồng hồ.");
    addLog("Vui lòng không thao tác cho đến khi màn hình làm mới xong.");
    return true;
  }
  return false;
}

// Nút [Sync time]: gửi giờ hệ thống cho thiết bị (vẽ lại màn hình đồng hồ).
async function manualSyncTime() {
  if (await sendTimeSync()) {
    timeSynced = true;
    updateButtonStatus();
    await sleep(3000);
    readStatus(true);
  }
}

// Chọn giao diện màn hình trong [Điều khiển thiết bị] (nút «Áp dụng»):
//   'img' = Ảnh đã lưu (0x94 01: nạp ảnh từ flash + hiển thị)
//   1     = 0x98 01 (đồng hồ); chưa đồng bộ giờ thì tự Sync time trước
async function applyMode(mode) {
  if (mode === 'img') {
    if (await write([0x94, 0x01])) {
      addLog("Đã chuyển sang «Ảnh đã lưu»!");
      addLog("Vui lòng không thao tác cho đến khi màn hình làm mới xong.");
      if (typeof highlightMode === 'function') highlightMode('img');
      deviceMode = 28;
    }
    return;
  }

  const m = parseInt(mode);
  if (!timeSynced) {
    addLog('Chưa đồng bộ giờ — gửi giờ hệ thống trước…');
    if (!await sendTimeSync()) return;
    timeSynced = true;
    updateButtonStatus();
    await sleep(500);
  }
  if (!await write([0x98, m])) return;
  addLog('Đã chọn giao diện — màn hình đang vẽ lại…');
  if (typeof highlightMode === 'function') highlightMode(m);
  deviceMode = m;
  // chờ thiết bị xác nhận (đọc trạng thái byte 13, tối đa ~10 giây)
  for (let i = 0; i < 10; i++) {
    await sleep(1000);
    const st = await readStatus(true);
    if (st && st.mode === m) break;
  }
}

// Lịch làm mới TOÀN màn hình (0x9d): mỗi giờ hoặc chỉ lúc 00:00.
// Thiết bị lưu vào flash, báo lại ở status[14].
async function setHourlyFull() {
  const chk = document.getElementById('hourlyFullCHK');
  const enabled = chk.checked ? 1 : 0;
  if (await write([0x9d, enabled])) {
    addLog(enabled
      ? "Đã bật: làm mới toàn màn hình mỗi giờ."
      : "Đã tắt: chỉ làm mới toàn màn hình lúc 00:00 (bóng mờ có thể tích tụ trong ngày).");
  } else {
    chk.checked = !chk.checked; // gửi thất bại: trả checkbox về trạng thái cũ
  }
}

// [Cấu hình giao diện] Gửi sự kiện đếm ngược (0x99): năm LE + tháng + ngày + tên
async function sendEvent() {
  const name = (document.getElementById('eventName').value || '').trim();
  const dv = document.getElementById('eventDate').value;
  if (!name || !dv) {
    addLog('Điền tên sự kiện và chọn ngày trước đã.');
    return;
  }
  const d = new Date(dv + 'T00:00:00');
  if (isNaN(d)) { addLog('Ngày không hợp lệ.'); return; }
  const nb = utf8Trunc(name, 43);
  const y = d.getFullYear();
  const payload = new Uint8Array(5 + nb.length);
  payload.set([0x99, y & 0xFF, (y >> 8) & 0xFF, d.getMonth() + 1, d.getDate()]);
  payload.set(nb, 5);
  if (await write(payload)) {
    addLog('Đã gửi sự kiện «' + name + '» (' + dv + ').');
    if (deviceMode === 25) addLog('Màn hình đếm ngược sẽ vẽ lại.');
    else addLog('Bấm «Áp dụng» ở thẻ «Đếm ngược sự kiện» để hiển thị.');
  }
}

// [Cấu hình giao diện] Gửi 3 dòng ghi chú (0x9a idx text; dòng cuối idx|0x80)
async function sendNote() {
  for (let i = 0; i < 3; i++) {
    const t = (document.getElementById('noteLine' + i).value || '').trim();
    const tb = utf8Trunc(t, 43);
    const payload = new Uint8Array(2 + tb.length);
    payload.set([0x9a, i === 2 ? (i | 0x80) : i]);
    payload.set(tb, 2);
    if (!await write(payload, i < 2)) return;
    await sleep(100);
  }
  addLog('Đã gửi nội dung ghi chú / bảng tên.');
  if (deviceMode === 26) addLog('Màn hình sẽ vẽ lại.');
  else addLog('Bấm «Áp dụng» ở thẻ «Bảng tên / ghi chú» để hiển thị.');
}

// Cắt chuỗi theo giới hạn BYTE UTF-8 (không cắt giữa ký tự có dấu)
function utf8Trunc(s, maxBytes) {
  const enc = new TextEncoder();
  let b = enc.encode(s);
  while (b.length > maxBytes) {
    s = s.slice(0, -1);
    b = enc.encode(s);
  }
  return b;
}

async function resetDevice() {
  if (confirm('Khởi động lại thiết bị? Đồng hồ sẽ mất giờ và cần Sync time lại.')) {
    await write([0x9F]);
    addLog("Đã gửi lệnh khởi động lại thiết bị.");
  }
}

// ------- hiệu chỉnh đồng hồ nhanh/chậm (0x92 — như weble) -------
// Đo độ lệch giữa giờ thiết bị và giờ hệ thống tại thời điểm phút thiết bị
// nhảy số, rồi gửi cho firmware bù dần. Cần đặt giờ trước đó ít nhất 2 ngày.
async function calibrateClock() {
  const st0 = await readStatus(true);
  if (!st0) return;
  if (st0.calMinute === -1) {
    addLog('Chưa đặt giờ — hãy bấm [Sync time] trước, đợi vài ngày rồi hiệu chỉnh.');
    return;
  }
  if (st0.calMinute < 2880) {
    addLog('Khoảng cách từ lần đặt giờ quá ngắn (' + st0.calMinute + ' phút, cần ≥ 2 ngày).');
    return;
  }
  addLog('Đang chờ phút của thiết bị nhảy số (tối đa ~1 phút)…');
  setDisId('calibratebutton', true);
  try {
    let st = st0;
    const lastMinute = st0.minute;
    for (let i = 0; i < 130; i++) {   // ~65 giây
      await sleep(500);
      st = await readStatus(true);
      if (!st) return;
      if (st.minute !== lastMinute) break;
    }
    const now = new Date();
    let devMinute = st.minute;
    let sysMinute = now.getMinutes();
    const sysSecond = now.getSeconds();
    if (devMinute > sysMinute) { if (devMinute - sysMinute > 50) sysMinute += 60; }
    else { if (sysMinute - devMinute > 50) devMinute += 60; }
    const diff = (devMinute * 60 + st.second) - (sysMinute * 60 + sysSecond);
    addLog('Độ lệch: ' + diff + ' giây sau ' + st.calMinute + ' phút.');
    await write([0x92, diff & 0xFF, (diff >> 8) & 0xFF, 0x00]);
    addLog('Đã hiệu chỉnh! Hãy bấm [Sync time] ngay để đặt lại giờ chuẩn.');
  } finally {
    setDisId('calibratebutton', false);
  }
}

function setDisId(id, dis) {
  const el = document.getElementById(id);
  if (el) el.disabled = dis ? 'disabled' : null;
}

// ------- OTA firmware qua BLE (0xA0/A2/A3/A4 — như weble) -------

// CRC32 chuẩn (IEEE 802.3) — thay cho thư viện CDN của weble
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
  if (!fileInput || fileInput.files.length === 0) {
    addLog('Vui lòng chọn file firmware .bin trước.');
    return;
  }
  if (!longValueChar) {
    addLog('Chưa kết nối thiết bị.');
    return;
  }
  const firmBuf = new Uint8Array(await fileInput.files[0].arrayBuffer());
  const firmSize = firmBuf.length;

  // tìm magic phiên bản (epd_version[]: 79 13 a5 f9 86 ec 5a 06 + version 4B)
  const magic = [0x79, 0x13, 0xa5, 0xf9, 0x86, 0xec, 0x5a, 0x06];
  let pos = -1;
  for (let i = 0; i <= firmBuf.length - magic.length - 4; i++) {
    let j = 0;
    while (j < magic.length && firmBuf[i + j] === magic[j]) j++;
    if (j === magic.length) { pos = i; break; }
  }
  if (pos === -1) {
    addLog('File không hợp lệ: không tìm thấy magic phiên bản firmware!');
    return;
  }
  const firmVer = firmBuf[pos + 8] | (firmBuf[pos + 9] << 8) | (firmBuf[pos + 10] << 16) | (firmBuf[pos + 11] << 24);
  const firmCrc = crc32buf(firmBuf);
  addLog('Firmware: ' + firmSize + ' byte, phiên bản 0x' + (firmVer >>> 0).toString(16) + '.');

  if (!confirm('Cập nhật firmware qua BLE?\nKhông tắt nguồn thiết bị trong quá trình cập nhật!')) return;

  const otaStatus = document.getElementById('otaProgress');
  const show = (t) => { if (otaStatus) otaStatus.textContent = t; };

  setDisId('otabutton', true);
  try {
    // 0xA0: bắt đầu — firmware xoá bank không hoạt động. Size gửi u32
    // (firmware >64KB làm u16 tràn → xóa thiếu sector → hỏng bank);
    // firmware cũ đọc u16 vẫn đúng vì 2 byte cao = 0 khi size <64KB.
    const buf = new Uint8Array(136);
    const dv = new DataView(buf.buffer);
    buf[0] = 0xa0; buf[1] = 0x00;
    dv.setUint32(2, firmSize, true);
    show('Đang xoá flash…');
    await write(buf, true);

    // gửi từng trang 256 byte, chia đôi 128+128 (0xA2 nửa đầu, 0xA3 nửa sau)
    let p = 0;
    for (let i = 0; i < firmSize + 64; i += 256) {
      buf.fill(0xff);
      if (i === 0) {
        // trang đầu: header bank 64 byte + 192 byte firmware
        dv.setUint32(8 + 0, 0x00aa5170, true);
        dv.setUint32(8 + 4, firmSize, true);
        dv.setUint32(8 + 8, firmCrc, true);
        dv.setUint32(8 + 28, firmVer, true);
        buf[8 + 32] = 0;
        buf[0] = 0xa2;
        buf.set(firmBuf.subarray(p, p + 64), 8 + 64);
        await write(buf, true);
        p += 64;
      } else {
        buf[0] = 0xa2;
        buf.fill(0xff, 1);
        buf.set(firmBuf.subarray(p, p + 128), 8);
        await write(buf, true);
        p += 128;
      }
      buf[0] = 0xa3;
      buf.fill(0xff, 1);
      buf.set(firmBuf.subarray(p, p + 128), 8);
      await write(buf, true);
      p += 128;
      show('Tiến độ: ' + ((100 * p / (firmSize + 64)) >> 0) + '%');
    }

    // 0xA4: kết thúc — thiết bị tự khởi động lại vào firmware mới
    buf.fill(0x00); buf[0] = 0xa4;
    await write(buf.subarray(0, 4), true);
    show('Hoàn tất — thiết bị đang khởi động lại.');
    addLog('Cập nhật xong! Thiết bị khởi động lại với firmware mới.');
  } catch (e) {
    console.error(e);
    show('Lỗi: ' + (e.message || e));
    addLog('OTA thất bại: ' + (e.message || e));
  } finally {
    setDisId('otabutton', false);
  }
}

async function sendcmd() {
  const cmdTXT = document.getElementById('cmdTXT').value;
  if (cmdTXT == '') return;
  await write(cmdTXT);
}

// Màn BWR làm mới FULL mất 15-25s (vd vừa Sync time / đổi giao diện xong):
// nếu bắt đầu truyền đúng lúc đó, khối màu đỏ (0x9e) bị thiết bị TỪ CHỐI
// (RAM panel không nhận được khi đang làm mới) → ảnh chỉ còn đen trắng.
// Gửi 0x97 để thiết bị cập nhật trạng thái rồi chờ đến khi màn rảnh.
async function waitIdle(label) {
  for (let i = 0; i < 45; i++) {
    if (!await write([0x97], true)) return false;
    await sleep(150);
    const st = await readStatus(true);
    if (!st || !st.refreshing) return true;
    setStatus(`${label}: màn hình đang làm mới, chờ… ${i + 1}s`);
    await sleep(1000);
  }
  return true; // quá 45s: cứ gửi, phần hiển thị sẽ được thiết bị xếp hàng
}

async function sendimg() {
  if (cropManager.isCropMode()) {
    alert("Vui lòng hoàn tất cắt ảnh trước! Đã hủy gửi.");
    return;
  }

  startTime = new Date().getTime();
  const status = document.getElementById("status");
  status.parentElement.style.display = "block";

  updateButtonStatus(true);

  const threeColor = document.getElementById('ditherMode').value === 'threeColor';
  let sent = false;
  if (threeColor && !await waitIdle('Gửi ảnh')) {
    updateButtonStatus();
    return;
  }
  if (threeColor) {
    // mặt đen trắng vào buffer thiết bị (0x93), mặt ĐỎ vào FLASH
    // (0x9e 02 xóa → 0x9e 01 từng khối → 0x9e 03 chốt — từng gói tự trọn
    // vẹn như OTA, không giữ panel mở qua các gói BLE), rồi 0x94 02 hiển
    // thị cả hai mặt trong một chu kỳ liền mạch trên thiết bị
    const pl = canvas2planes(canvas);
    addLog(`Bắt đầu gửi ảnh 3 màu ${canvas.width}x${canvas.height} (2 × ${pl.bw.length} byte)`);
    if (await writeImage(pl.bw) && await write([0x9e, 0x02], true)) {
      await sleep(400);                     // chờ thiết bị xóa 3 sector
      if (await writeRedPlane(pl.red, 0x01, 'Khối màu đỏ') &&
          await write([0x9e, 0x03], true)) {
        await sleep(100);
        // lưu luôn header + mặt đen trắng (0x95 03): ảnh giữ được qua mất
        // nguồn, thẻ «Ảnh» (0x94 01) luôn hiện lại được ảnh vừa gửi
        if (await write([0x95, 0x03], true)) {
          await sleep(300);
          sent = await write([0x94, 0x02]);
        }
      }
    }
  } else {
    const data = canvas2bytesBW(canvas);
    addLog(`Bắt đầu gửi ảnh ${canvas.width}x${canvas.height} (${data.length} byte)`);
    if (await writeImage(data)) {
      await sleep(200);
      sent = await write([0x94]);   // hiển thị ảnh vừa gửi (firmware xếp hàng nếu đang bận)
    }
  }
  updateButtonStatus();

  const sendTime = (new Date().getTime() - startTime) / 1000.0;
  if (!sent) {
    addLog('Gửi ảnh thất bại — kiểm tra kết nối rồi thử lại.');
    setStatus('Gửi ảnh thất bại.');
    setTimeout(() => { status.parentElement.style.display = "none"; }, 5000);
    return;
  }
  addLog(`Đã truyền xong dữ liệu (${sendTime}s) — màn hình đang làm mới…`);
  setStatus('Màn hình đang làm mới…');

  // chờ thiết bị xác nhận đã chuyển sang chế độ ảnh (đọc trạng thái, ~2-8s;
  // lâu hơn nếu lệnh phải xếp hàng sau một lần làm mới đang chạy — màn BWR
  // làm mới toàn màn có thể mất 15-20 giây)
  let shown = false;
  for (let i = 0; i < 25; i++) {
    await sleep(1000);
    const st = await readStatus(true);
    if (st && st.mode === 28) { shown = true; break; }
  }
  if (shown) {
    deviceMode = 28;
    if (typeof highlightMode === 'function') highlightMode('img');
    addLog('Thiết bị xác nhận đã hiển thị ảnh. Bấm «Lưu ảnh vào flash» nếu muốn giữ sau khi mất nguồn.');
    setStatus('Đã hiển thị ảnh!');
  } else {
    addLog('Chưa thấy thiết bị xác nhận hiển thị ảnh — kiểm tra màn hình rồi thử «Gửi hình ảnh» lại.');
    setStatus('Chưa có xác nhận từ thiết bị.');
  }
  setTimeout(() => {
    status.parentElement.style.display = "none";
  }, 5000);
}

// Lưu ảnh vào SPI flash: thiết bị nạp lại khi khởi động / chọn «Ảnh đã lưu».
// 2 màu: chỉ cần 0x95 (mặt đen trắng đã nằm trong buffer thiết bị).
// 3 màu: mặt đỏ không còn trong RAM MCU — gửi lại vào flash:
//   0x9e 02 (xóa 3 sector) -> 0x9e 01 từng khối -> 0x9e 03 (chốt)
//   -> 0x95 03 (ghi header 3 màu + mặt đen trắng, không xóa nữa)
async function saveImageFlash() {
  const threeColor = document.getElementById('ditherMode').value === 'threeColor';
  if (!threeColor) {
    if (await write([0x95])) {
      addLog("Đã gửi lệnh lưu ảnh vào flash!");
    }
    return;
  }

  startTime = new Date().getTime();
  const status = document.getElementById("status");
  status.parentElement.style.display = "block";
  updateButtonStatus(true);

  if (!await waitIdle('Lưu ảnh')) {
    updateButtonStatus();
    return;
  }

  // gửi lại CẢ mặt đen trắng: sau khi hiển thị (0x94 02) buffer thiết bị
  // đã bị mượn để đọc mặt đỏ từ flash nên không còn giữ mặt đen trắng
  const pl = canvas2planes(canvas);
  let ok = false;
  if (await writeImage(pl.bw) && await write([0x9e, 0x02], true)) {
    await sleep(400);                       // chờ thiết bị xóa 3 sector
    if (await writeRedPlane(pl.red, 0x01, 'Lưu mặt đỏ') &&
        await write([0x9e, 0x03], true)) {
      await sleep(100);
      ok = await write([0x95, 0x03]);
    }
  }
  updateButtonStatus();
  setStatus(ok ? 'Đã lưu ảnh 3 màu vào flash!' : 'Lưu ảnh 3 màu thất bại.');
  addLog(ok ? 'Đã lưu ảnh 3 màu vào flash!' : 'Lưu ảnh 3 màu thất bại — thử lại.');
  setTimeout(() => { status.parentElement.style.display = "none"; }, 4000);
}

// ------- nhiệt độ đọc từ cảm biến trong màn hình -------

function showPanelTemp(t) {
  const el = document.getElementById('panelTemp');
  if (el) el.textContent = t + '°C';
}

// Nút [Đọc nhiệt độ]: 0x97 — firmware đánh thức panel, đọc cảm biến tích hợp
// rồi cập nhật giá trị trạng thái; webtool đọc lại sau 1 giây.
// Nhiệt độ cũng tự cập nhật sau mỗi lần làm mới màn hình.
async function readPanelTemp() {
  if (await write([0x97])) {
    await sleep(1000);
    const st = await readStatus(true);
    if (st && st.temp !== null) addLog('Nhiệt độ màn hình: ' + st.temp + '°C (cảm biến trong panel).', '⇓');
  }
}

function downloadDataArray() {
  if (cropManager.isCropMode()) {
    alert("Vui lòng hoàn tất cắt ảnh trước! Đã hủy tải.");
    return;
  }

  const processedData = canvas2bytesBW(canvas);

  const dataLines = [];
  for (let i = 0; i < processedData.length; i++) {
    const hexValue = (processedData[i] & 0xff).toString(16).padStart(2, '0');
    dataLines.push(`0x${hexValue}`);
  }

  const formattedData = [];
  for (let i = 0; i < dataLines.length; i += 16) {
    formattedData.push(dataLines.slice(i, i + 16).join(', '));
  }

  const arrayContent = [
    'const uint8_t imageData[] PROGMEM = {',
    formattedData.join(',\n'),
    '};',
    `const uint16_t imageWidth = ${canvas.width};`,
    `const uint16_t imageHeight = ${canvas.height};`,
    'const uint8_t colorMode = 2;'
  ].join('\n');

  const blob = new Blob([arrayContent], { type: 'text/plain' });
  const link = document.createElement('a');
  link.download = 'imagedata.h';
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
}

function updateButtonStatus(forceDisabled = false) {
  const connected = gattServer != null && gattServer.connected;
  const status = forceDisabled ? 'disabled' : (connected ? null : 'disabled');
  // chọn «Ảnh đã lưu» yêu cầu đã đồng bộ giờ ([Sync time])
  const modeStatus = forceDisabled ? 'disabled' : ((connected && timeSynced) ? null : 'disabled');
  // null-safe: các nút giao diện được mode_preview.js tạo động, có thể chưa có
  const setDis = (id, val) => { const el = document.getElementById(id); if (el) el.disabled = val; };
  setDis("reconnectbutton", (gattServer == null || gattServer.connected) ? 'disabled' : null);
  setDis("synctimebutton", status);
  setDis("calibratebutton", status);
  setDis("otabutton", status);
  setDis("sendcmdbutton", status);
  // nút «Áp dụng» của thư viện giao diện (mode_preview.js tạo động):
  // giao diện đồng hồ tự Sync time nếu cần — chỉ yêu cầu kết nối;
  // «Ảnh đã lưu» cần đã đồng bộ giờ (giữ khóa như bản 2.13")
  document.querySelectorAll('.mode-card button').forEach(btn => {
    btn.disabled = (btn.id === 'applybtn-img') ? modeStatus : status;
  });
  setDis("sendeventbutton", status);
  setDis("sendnotebutton", status);
  setDis("dsuploadbutton", status);
  setDis("resetdevicebutton", status);
  setDis("sendimgbutton", status);
  setDis("saveflashbutton", status);
  setDis("temprefreshbutton", status);
}

// live system-time display in the [Thời gian] section
function tickSystemTime() {
  const el = document.getElementById('systemTime');
  if (el) el.textContent = new Date().toLocaleString('vi-VN');
}
setInterval(tickSystemTime, 1000);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tickSystemTime);
else tickSystemTime();

function disconnect() {
  updateButtonStatus();
  resetVariables();
  addLog('Đã ngắt kết nối.');
  document.getElementById("connectbutton").innerHTML = 'Kết nối';
}

async function preConnect() {
  if (gattServer != null && gattServer.connected) {
    if (bleDevice != null && bleDevice.gatt.connected) {
      bleDevice.gatt.disconnect();
    }
  }
  else {
    resetVariables();
    // chế độ dev (?debug=true): liệt kê mọi thiết bị BLE, bỏ kiểm tra tên
    const debugMode = new URLSearchParams(window.location.search).get('debug') === 'true';
    try {
      bleDevice = await navigator.bluetooth.requestDevice(debugMode ? {
        acceptAllDevices: true,
        optionalServices: [HM_SERVICE],
      } : {
        filters: BLE_REQUEST_FILTERS,
        optionalServices: [HM_SERVICE],
      });
    } catch (e) {
      console.error(e);
      if (e.name === 'NotFoundError') {
        addLog("Không tìm thấy thiết bị E-Ink (DIY-…)");
        addLog("Nếu danh sách trống: thiết bị có thể đang kết nối với máy khác — hãy ngắt ở đó trước.");
      } else if (e.message) {
        addLog("requestDevice: " + e.message);
      }
      addLog("Kiểm tra Bluetooth đã bật và trình duyệt hỗ trợ Web Bluetooth! Khuyên dùng:");
      addLog("• Máy tính: Chrome/Edge");
      addLog("• Android: Chrome/Edge");
      addLog("• iOS: trình duyệt Bluefy");
      return;
    }

    // chỉ chấp nhận thiết bị DIY-… (trừ chế độ dev)
    if (!debugMode && !(bleDevice.name || '').startsWith(BLE_NAME_PREFIX)) {
      addLog('Thiết bị «' + (bleDevice.name || 'không tên') + '» không phải màn hình DIY-…');
      addLog('Hãy chọn đúng thiết bị tên DIY-2_9-xxxx.');
      bleDevice = null;
      return;
    }

    await bleDevice.addEventListener('gattserverdisconnected', disconnect);
    await connect();
  }
}

async function reConnect() {
  if (bleDevice != null && bleDevice.gatt.connected)
    bleDevice.gatt.disconnect();
  resetVariables();
  addLog("Đang kết nối lại");
  await connect();
}

async function connect() {
  if (bleDevice == null || longValueChar != null) return;

  try {
    addLog("Đang kết nối: " + bleDevice.name);
    gattServer = await connectGattWithRetry(bleDevice);
    addLog('  Đã tìm thấy GATT Server');
    hmService = await gattServer.getPrimaryService(HM_SERVICE);
    addLog('  Đã tìm thấy Service 0xff00');
    longValueChar = await hmService.getCharacteristic(HM_LONG_VALUE);
    addLog('  Đã tìm thấy Long Value (0xff01)');
  } catch (e) {
    console.error(e);
    logBleConnectHelp(e);
    disconnect();
    return;
  }

  try {
    adcChar = await hmService.getCharacteristic(HM_ADC);
  } catch (e) {
    console.error(e);
    adcChar = null;   // không bắt buộc
  }

  document.getElementById("connectbutton").innerHTML = 'Ngắt kết nối';
  updateButtonStatus();
  addLog('Kết nối thành công!');

  // đọc trạng thái: giờ thiết bị + nhiệt độ + chế độ + điện áp pin
  await sleep(300);
  await readStatus();
  await readVoltage();
  if (!timeSynced) {
    addLog('Bấm «Sync time» để đồng bộ giờ trước khi chọn giao diện.');
  }
}

function setStatus(statusText) {
  document.getElementById("status").innerHTML = statusText;
}

function addLog(logTXT, action = '') {
  const log = document.getElementById("log");
  const now = new Date();
  const time = String(now.getHours()).padStart(2, '0') + ":" +
    String(now.getMinutes()).padStart(2, '0') + ":" +
    String(now.getSeconds()).padStart(2, '0') + " ";

  const logEntry = document.createElement('div');
  const timeSpan = document.createElement('span');
  logEntry.className = 'log-line';
  timeSpan.className = 'time';
  timeSpan.textContent = time;
  logEntry.appendChild(timeSpan);

  if (action !== '') {
    const actionSpan = document.createElement('span');
    actionSpan.className = 'action';
    actionSpan.innerHTML = action;
    logEntry.appendChild(actionSpan);
  }
  logEntry.appendChild(document.createTextNode(logTXT));

  log.appendChild(logEntry);
  log.scrollTop = log.scrollHeight;

  while (log.childNodes.length > 20) {
    log.removeChild(log.firstChild);
  }
}

function clearLog() {
  document.getElementById("log").innerHTML = '';
}

function fillCanvas(style) {
  ctx.fillStyle = style;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function setCanvasTitle(title) {
  const canvasTitle = document.querySelector('.canvas-title');
  if (canvasTitle) {
    canvasTitle.innerText = title;
    canvasTitle.style.display = title && title !== '' ? 'block' : 'none';
  }
}

// ------- image transform state (reload / stretch / fit / rotate / pan) -------
let originalImage = null;  // the loaded source image (null after a manual crop)
let imgRotation = 0;       // degrees, multiples of 90
let imgScaleX = 1.0, imgScaleY = 1.0;
let imgOffsetX = 0, imgOffsetY = 0;  // pan offset in canvas pixels (drag to move)

function computeFitScale(stretch) {
  // when rotated by 90/270 the image width maps onto the canvas height
  const rotated = (imgRotation % 180) !== 0;
  const cw = rotated ? canvas.height : canvas.width;
  const ch = rotated ? canvas.width : canvas.height;
  if (stretch) {
    imgScaleX = cw / originalImage.width;
    imgScaleY = ch / originalImage.height;
  } else {
    imgScaleX = imgScaleY = Math.min(cw / originalImage.width, ch / originalImage.height);
  }
}

// draw the source image with the current pan/rotation/scale (no dithering)
function drawImagePreview() {
  fillCanvas('white');
  ctx.save();
  ctx.translate(canvas.width / 2 + imgOffsetX, canvas.height / 2 + imgOffsetY);
  ctx.rotate(imgRotation * Math.PI / 180);
  ctx.scale(imgScaleX, imgScaleY);
  ctx.drawImage(originalImage, -originalImage.width / 2, -originalImage.height / 2);
  ctx.restore();
}

// redraw the source image with the current transform, then re-apply
// adjustments + dithering (never compounds: always starts from the source)
function redrawImage() {
  if (!originalImage) return;
  if (cropManager.isCropMode()) cropManager.exitCropMode();
  drawImagePreview();
  convertDithering();
}

function reloadImage() {
  const imageFile = document.getElementById('imageFile');
  if (imageFile.files.length == 0) {
    addLog('Vui lòng chọn hình ảnh trước');
    return;
  }
  updateImage();
}

function stretchToScreen() {
  if (!originalImage) { addLog('Vui lòng chọn hình ảnh trước'); return; }
  computeFitScale(true);
  imgOffsetX = imgOffsetY = 0;
  redrawImage();
}

function fitToScreen() {
  if (!originalImage) { addLog('Vui lòng chọn hình ảnh trước'); return; }
  computeFitScale(false);
  imgOffsetX = imgOffsetY = 0;
  redrawImage();
}

function rotateImage(degrees) {
  if (!originalImage) { addLog('Vui lòng chọn hình ảnh trước'); return; }
  imgRotation = degrees ? (imgRotation + degrees + 360) % 360 : 0;
  redrawImage();
}

function cropImage() {
  const imageFile = document.getElementById('imageFile');
  if (imageFile.files.length == 0) {
    addLog('Vui lòng chọn hình ảnh trước');
    return;
  }
  paintManager.setActiveTool(null, '');
  cropManager.initializeCrop();
}

function updateImage() {
  const imageFile = document.getElementById('imageFile');
  if (imageFile.files.length == 0) {
    fillCanvas('white');
    return;
  }

  const image = new Image();
  image.onload = function () {
    URL.revokeObjectURL(this.src);
    if (cropManager.isCropMode()) cropManager.exitCropMode();
    originalImage = image;
    imgRotation = 0;
    imgOffsetX = imgOffsetY = 0;
    computeFitScale(false);  // fit to screen by default; stretch/crop buttons fill
    redrawImage();
    setCanvasTitle('Kéo ảnh để di chuyển, lăn chuột / chụm hai ngón tay để thu phóng');
  };
  image.src = URL.createObjectURL(imageFile.files[0]);
}

// ------- drag-to-pan and zoom on the image preview -------
// Active only when an image is loaded, no paint tool is selected and we are
// not in crop mode. While dragging, the raw image is shown for smooth
// feedback; the adjustment + dithering pipeline re-runs on release.
function imgPanActive() {
  return originalImage && !cropManager.isCropMode() && !paintManager.currentTool;
}

function canvasPos(pt) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (pt.clientX - rect.left) * (canvas.width / rect.width),
    y: (pt.clientY - rect.top) * (canvas.height / rect.height),
  };
}

function initImagePanZoom() {
  let dragging = false, didDrag = false;
  let startX = 0, startY = 0, origX = 0, origY = 0;
  let wheelTimer = null;
  let pinchDist = 0, pinchScaleX = 1, pinchScaleY = 1;

  const beginDrag = (pt) => {
    dragging = true; didDrag = false;
    const p = canvasPos(pt);
    startX = p.x; startY = p.y;
    origX = imgOffsetX; origY = imgOffsetY;
  };
  const moveDrag = (pt) => {
    const p = canvasPos(pt);
    imgOffsetX = origX + (p.x - startX);
    imgOffsetY = origY + (p.y - startY);
    didDrag = true;
    drawImagePreview();
  };
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    if (didDrag) redrawImage();
  };

  canvas.addEventListener('mousedown', (e) => {
    if (!imgPanActive()) return;
    beginDrag(e);
  });
  canvas.addEventListener('mousemove', (e) => {
    if (!dragging || !imgPanActive()) return;
    moveDrag(e);
  });
  canvas.addEventListener('mouseup', endDrag);
  canvas.addEventListener('mouseleave', endDrag);

  canvas.addEventListener('wheel', (e) => {
    if (!imgPanActive()) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    imgScaleX *= factor;
    imgScaleY *= factor;
    drawImagePreview();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => redrawImage(), 300);
  }, { passive: false });

  canvas.addEventListener('touchstart', (e) => {
    if (!imgPanActive()) return;
    if (e.touches.length === 1) {
      e.preventDefault();
      beginDrag(e.touches[0]);
    } else if (e.touches.length === 2) {
      e.preventDefault();
      dragging = false;
      pinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
                             e.touches[0].clientY - e.touches[1].clientY);
      pinchScaleX = imgScaleX; pinchScaleY = imgScaleY;
      didDrag = true;
    }
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    if (!imgPanActive()) return;
    if (e.touches.length === 1 && dragging) {
      e.preventDefault();
      moveDrag(e.touches[0]);
    } else if (e.touches.length === 2 && pinchDist > 0) {
      e.preventDefault();
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
                           e.touches[0].clientY - e.touches[1].clientY);
      imgScaleX = pinchScaleX * (d / pinchDist);
      imgScaleY = pinchScaleY * (d / pinchDist);
      drawImagePreview();
    }
  }, { passive: false });
  canvas.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) {
      const hadPinch = pinchDist > 0;
      pinchDist = 0;
      if (dragging || hadPinch) {
        dragging = false;
        if (didDrag) redrawImage();
      }
    }
  });
}

function rotateCanvas() {
  const currentWidth = canvas.width;
  const currentHeight = canvas.height;

  // Capture current canvas content
  const imageData = ctx.getImageData(0, 0, currentWidth, currentHeight);

  // Swap canvas dimensions
  canvas.width = currentHeight;
  canvas.height = currentWidth;

  // Create temporary canvas for rotation
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = currentWidth;
  tempCanvas.height = currentHeight;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.putImageData(imageData, 0, 0);

  // Draw rotated image on the resized canvas
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(90 * Math.PI / 180);
  ctx.drawImage(tempCanvas, -currentWidth / 2, -currentHeight / 2);
  ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform

  paintManager.clearHistory(); // Clear history as canvas size changed
  paintManager.clearElements(); // Clear stored text positions and line segments
  paintManager.saveToHistory(); // Save rotated canvas to history
}

function clearCanvas() {
  if (confirm('Xóa nội dung canvas?')) {
    fillCanvas('white');
    paintManager.clearElements(); // Clear stored text positions and line segments
    if (cropManager.isCropMode()) cropManager.exitCropMode();
    paintManager.saveToHistory(); // Save cleared canvas to history
    return true;
  }
  return false;
}

function convertDithering() {
  paintManager.redrawTextElements();
  paintManager.redrawLineSegments();

  const brightness = parseInt(document.getElementById('imgBrightness').value);
  const saturation = parseInt(document.getElementById('imgSaturation').value);
  const contrast = parseFloat(document.getElementById('ditherContrast').value);
  const currentImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const imageData = new ImageData(
    new Uint8ClampedArray(currentImageData.data),
    currentImageData.width,
    currentImageData.height
  );

  adjustBrightness(imageData, brightness);
  adjustSaturation(imageData, saturation);
  adjustContrast(imageData, contrast);

  const alg = document.getElementById('ditherAlg').value;
  const strength = parseFloat(document.getElementById('ditherStrength').value);
  const mode = document.getElementById('ditherMode').value;
  const processedData = processImageData(ditherImage(imageData, alg, strength, mode), mode);
  const finalImageData = decodeProcessedData(processedData, canvas.width, canvas.height, mode);
  ctx.putImageData(finalImageData, 0, 0);

  paintManager.saveToHistory(); // Save dithered image to history
}

function applyDither() {
  if (cropManager.isCropMode()) {
    // finishing a manual crop: the cropped result replaces the source image,
    // adjustments then compound on the canvas (legacy behavior)
    originalImage = null;
    cropManager.finishCrop(() => convertDithering());
  } else if (originalImage) {
    // re-render from the source so adjustments never compound
    redrawImage();
  } else {
    cropManager.finishCrop(() => convertDithering());
  }
}

function initEventHandlers() {
  document.getElementById("ditherStrength").addEventListener("input", (e) => {
    document.getElementById("ditherStrengthValue").innerText = parseFloat(e.target.value).toFixed(1);
    applyDither();
  });
  document.getElementById("ditherContrast").addEventListener("input", (e) => {
    document.getElementById("ditherContrastValue").innerText = parseFloat(e.target.value).toFixed(1);
    applyDither();
  });
  document.getElementById("imgBrightness").addEventListener("input", (e) => {
    document.getElementById("imgBrightnessValue").innerText = e.target.value;
    applyDither();
  });
  document.getElementById("imgSaturation").addEventListener("input", (e) => {
    document.getElementById("imgSaturationValue").innerText = e.target.value;
    applyDither();
  });

  // sửa ô sự kiện / ghi chú -> vẽ lại thẻ xem trước tương ứng
  ['eventName', 'eventDate', 'noteLine0', 'noteLine1', 'noteLine2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => {
      if (typeof window.redrawModePreviews === 'function') window.redrawModePreviews();
    });
  });

  initImagePanZoom();
}

function checkDebugMode() {
  const link = document.getElementById('debug-toggle');
  const urlParams = new URLSearchParams(window.location.search);
  const debugMode = urlParams.get('debug');

  if (debugMode === 'true') {
    document.body.classList.add('dark-mode');
    link.innerHTML = 'Chế độ thường';
    link.setAttribute('href', window.location.pathname);
    addLog("Chú ý: chế độ dev đã bật! Không hiểu thì đừng chỉnh sửa tùy tiện!");
  } else {
    document.body.classList.remove('dark-mode');
    link.innerHTML = 'Chế độ dev';
    link.setAttribute('href', window.location.pathname + '?debug=true');
  }
}

document.body.onload = () => {
  textDecoder = null;
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext("2d");

  canvas.width = PANEL_W;
  canvas.height = PANEL_H;
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  paintManager = new PaintManager(canvas, ctx);
  cropManager = new CropManager(canvas, ctx, paintManager);

  paintManager.initPaintTools();
  cropManager.initCropTools();
  initEventHandlers();
  updateButtonStatus();
  checkDebugMode();
}
