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
const BLE_NAME_PREFIX = "DIY-2_9-";
const BLE_REQUEST_FILTERS = [
  { namePrefix: BLE_NAME_PREFIX },
];

// Panel cố định 296×128 (canvas ngang, buffer 296 cột × 16 byte = 4736 byte)
const PANEL_W = 296;
const PANEL_H = 128;


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


// Đọc trạng thái 15 byte từ Long Value (0xff01): giờ thiết bị + nhiệt độ màn
// hình + chế độ hiển thị. Trả về object hoặc null.
async function readStatus(quiet = false) {
  if (!longValueChar) return null;
  try {
    const v = await longValueChar.readValue();
    if (v.byteLength < 11) return null;
    // Sau bước kiểm tra kích hoạt (0x26), giá trị 0xff01 tạm là chuỗi ASCII
    // "mac=... act=..." cho tới lần clock_push kế tiếp của thiết bị — KHÔNG
    // phải gói trạng thái: bỏ qua để khỏi khóa nhầm radio «Hiển thị pin»
    // (byte[17] rơi vào chữ 'a' = 97 > 2) và khỏi đọc giờ rác.
    if (v.getUint8(0) === 0x6d && v.getUint8(1) === 0x61 && v.getUint8(2) === 0x63 && v.getUint8(3) === 0x3d) return null;
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
      // [16] hiển thị pin (0x96, fw >= 1.1): 0 chỉ icon / 1 % / 2 điện áp
      battStyle: v.byteLength >= 17 ? v.getUint8(16) : null,
      // [17] định dạng giờ (0x90 + tham số, fw >= 1.2): 0 = 24h, 1 = 12h
      timeFmt: v.byteLength >= 18 ? v.getUint8(17) : null,
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
    // «Hiển thị pin» cần fw >= 1.1: máy mới gói trạng thái 17 byte có [16];
    // máy cũ (gói ngắn hơn) -> mờ radio + hint nhắc cập nhật
    {
      const ok = st.battStyle !== null && st.battStyle <= 2;
      document.querySelectorAll('input[name="battStyle"]').forEach(r => { r.disabled = !ok; });
      const h = document.getElementById('battStyleHint');
      if (h) h.textContent = ok ? 'Thiết bị vẽ lại ngay khi đổi.' : 'Cần firmware ≥ 1.1 — hãy cập nhật ở mục OTA.';
      if (ok) {
        const rb = document.querySelector(`input[name="battStyle"][value="${st.battStyle}"]`);
        if (rb) rb.checked = true;
      }
    }
    // «Định dạng giờ» 12h/24h cần fw >= 1.2: gói trạng thái 18 byte có [17]
    {
      const ok = st.timeFmt !== null && st.timeFmt <= 1;
      document.querySelectorAll('input[name="timeFmt"]').forEach(r => { r.disabled = !ok; });
      const h = document.getElementById('timeFmtHint');
      if (h) h.textContent = ok ? 'Thiết bị vẽ lại ngay khi đổi.' : 'Cần firmware ≥ 1.2 — hãy cập nhật ở mục OTA.';
      if (ok) {
        const rb = document.querySelector(`input[name="timeFmt"][value="${st.timeFmt}"]`);
        if (rb) rb.checked = true;
      }
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

// % pin theo đường xả pin lithium CR2450/CR2477 (khớp firmware v1.1)
function battPct(mv) {
  const V = [2400, 2500, 2600, 2650, 2700, 2750, 2800, 2850, 2900, 2980, 3050];
  const P = [0, 5, 12, 20, 30, 45, 60, 75, 85, 95, 100];
  if (mv >= V[10]) return 100;
  if (mv <= V[0]) return 0;
  for (let i = 10; i > 0; i--)
    if (mv >= V[i - 1]) return Math.round(P[i - 1] + (mv - V[i - 1]) * (P[i] - P[i - 1]) / (V[i] - V[i - 1]));
  return 0;
}

// Đọc điện áp pin (0xff02, uint16 LE mV) — % theo đường xả (khớp firmware)
async function readVoltage() {
  if (!adcChar) return null;
  try {
    const v = await adcChar.readValue();
    const mv = v.getUint16(0, true);
    const el = document.getElementById('battVolt');
    const pct = battPct(mv);
    if (el) el.textContent = (mv / 1000).toFixed(2) + ' V · ' + pct + '%';
    return mv;
  } catch (e) {
    console.error(e);
    return null;
  }
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


async function setBattStyle() {
  const sel = document.querySelector('input[name="battStyle"]:checked');
  const style = sel ? parseInt(sel.value) : 2;
  if (await write([0x96, style])) {
    addLog('Đã đặt hiển thị pin: ' + (style === 0 ? 'chỉ icon' : style === 1 ? 'phần trăm' : 'điện áp') + '.');
  }
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


// ------- OTA firmware qua BLE (0xA0/A2/A3/A4 — như weble) -------


async function otaUpdate(preBuf) {
  // preBuf (ArrayBuffer): từ nút «Cài ngay» của bảng firmware (đã confirm
  // ở fwInstallRow) — không truyền thì đọc file chọn ở ô Upload như cũ
  if (!longValueChar) {
    addLog('Chưa kết nối thiết bị.');
    return;
  }
  let firmBuf;
  if (preBuf) {
    firmBuf = new Uint8Array(preBuf);
  } else {
    const fileInput = document.getElementById('otaFile');
    if (!fileInput || fileInput.files.length === 0) {
      addLog('Vui lòng chọn file firmware .bin trước.');
      return;
    }
    firmBuf = new Uint8Array(await fileInput.files[0].arrayBuffer());
  }
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

  if (!preBuf && !confirm('Cập nhật firmware qua BLE?\nKhông tắt nguồn thiết bị trong quá trình cập nhật!')) return;

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

setInterval(tickSystemTime, 1000);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tickSystemTime);
else tickSystemTime();


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
      bleDevice = await navigator.bluetooth.requestDevice({ // ?debug=true vẫn LỌC THEO TÊN thiết bị (yêu cầu user) — hết acceptAllDevices
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


async function connect() {
  if (bleDevice == null || longValueChar != null) return;
  // nhắc cập nhật firmware (logic chung js/fw_check.js): firmware 2.9 hiện
  // chưa tự khai phiên bản -> coi như 0.1; bảng «Danh sách firmware» có bản
  // mới hơn sẽ popup sau khi kết nối
  FwCheck.reset('0.1', bleDevice && bleDevice.name);

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
  FwCheck.schedule(1500);  // popup nếu bảng firmware có bản mới hơn
}


// addLog() / clearLog(): js/log.js (dung chung ca hub lan cac app).
// Ban standalone trong EPD-DA14585/webtools/ van giu ban rieng cua no.


// ------- image transform state (reload / stretch / fit / rotate / pan) -------
let originalImage = null;  // the loaded source image (null after a manual crop)
let imgRotation = 0;       // degrees, multiples of 90
let imgScaleX = 1.0, imgScaleY = 1.0;
let imgOffsetX = 0, imgOffsetY = 0;  // pan offset in canvas pixels (drag to move)


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
