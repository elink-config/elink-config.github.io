// ---------------------------------------------------------------------------
// HÀM DÙNG CHUNG cho họ HM — màn 2.13" và 2.9". Cùng dịch vụ BLE 0000ff00-… (khác hẳn
// họ 4.2": lệnh, khung ảnh và cách báo trạng thái đều riêng).
//
// Chỉ chứa hàm GIỐNG HỆT NHAU ở mọi app trong họ. Hàm nào mỗi máy một khác
// vẫn nằm ở main.js của app đó.
// THỨ TỰ NẠP: app_common.js -> file này -> main.js của app, nên app cần bản
// riêng chỉ việc khai báo lại cùng tên trong main.js (khai báo sau đè lên).
// ---------------------------------------------------------------------------

function logBleConnectHelp(error) {
  addLog(`connect: ${error.name} - ${error.message}`);
  addLog('Gợi ý xử lý khi kết nối thất bại:');
  addLog('1. Đảm bảo thiết bị đã nạp firmware, tên Bluetooth là DIY-…');
  addLog('2. Đặt thiết bị gần máy tính, màn hình chưa vào chế độ ngủ');
  addLog('3. Windows: xóa ghép nối cũ trong cài đặt Bluetooth rồi thử lại');
  addLog('4. Ngắt kết nối thiết bị khỏi điện thoại/máy tính khác');
  addLog('5. Dùng Chrome/Edge và mở trang qua https hoặc localhost');
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

// Đóng gói canvas (ngang) thành buffer màn hình (dọc): duyệt cột từ phải
// sang trái, mỗi cột đóng thành ceil(chiều cao / 8) byte, bit thừa = trắng.
//   212×104 → 104 bit/cột (13 byte)  → 2756 byte
//   250×122 → 122 bit/cột + 6 bit đệm (16 byte) → 4000 byte
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

// Gửi ảnh theo khối: 0x93 + offset(2, little-endian) + dữ liệu
async function writeImage(data) {
  const mtu = parseInt(document.getElementById('mtusize').value) || 244;
  const chunkSize = Math.max(16, mtu - 6);  // 3 byte header + dư an toàn ATT
  const count = Math.ceil(data.length / chunkSize);
  let chunkIdx = 0;

  for (let i = 0; i < data.length; i += chunkSize) {
    let currentTime = (new Date().getTime() - startTime) / 1000.0;
    setStatus(`Khối đen trắng: ${chunkIdx + 1}/${count}, thời gian: ${currentTime}s`);
    // lop phu cho (app_common.js) — chi chay khi app co nap app_common
    if (typeof syncOverlayStep === 'function') {
      syncOverlayStep('Đang truyền ảnh — lớp đen trắng',
        `Gói ${chunkIdx + 1}/${count}. Ảnh được chẻ nhỏ theo MTU rồi ghi vào bộ đệm thiết bị.`);
      syncOverlayProgress(i, data.length);
    }
    const payload = [0x93, i & 0xFF, (i >> 8) & 0xFF, ...data.slice(i, i + chunkSize)];
    if (!await write(payload, true)) return false;
    chunkIdx++;
  }
  return true;
}

// Đặt giờ (lệnh 0x91 của HMCLOCK/weble): năm(2 LE) + tháng(0-11) + ngày + giờ
// + phút + giây + thứ(0-6) + năm âm lịch(-2020) + tháng âm lịch(0-based, bit7
// = tháng nhuận) + ngày âm lịch. Âm lịch tính theo LỊCH VIỆT NAM (UTC+7,
// thuật toán Hồ Ngọc Đức) — bản cũ dùng lịch Trung Quốc (UTC+8) của trình
// duyệt nên lệch 12/32 năm trong dải 2020–2051 (vd Tết 2030: TQ 3/2, VN 2/2).
function lunarToday(now) {
  const TZ = 7, PI = Math.PI, INT = Math.floor;
  function jd(dd, mm, yy) {
    const a = INT((14 - mm) / 12), y = yy + 4800 - a, m = mm + 12 * a - 3;
    return dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - INT(y / 100) + INT(y / 400) - 32045;
  }
  function newMoon(k) {
    const T = k / 1236.85, T2 = T * T, T3 = T2 * T, dr = PI / 180;
    let Jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3;
    Jd1 += 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
    const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
    const Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
    const F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
    let C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M);
    C1 = C1 - 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr);
    C1 = C1 - 0.0004 * Math.sin(dr * 3 * Mpr);
    C1 = C1 + 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr));
    C1 = C1 - 0.0074 * Math.sin(dr * (M - Mpr)) + 0.0004 * Math.sin(dr * (2 * F + M));
    C1 = C1 - 0.0004 * Math.sin(dr * (2 * F - M)) - 0.0006 * Math.sin(dr * (2 * F + Mpr));
    C1 = C1 + 0.0010 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M));
    const deltat = (T < -11)
      ? 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3
      : -0.000278 + 0.000265 * T + 0.000262 * T2;
    return Jd1 + C1 - deltat;
  }
  function nmDay(k) { return INT(newMoon(k) + 0.5 + TZ / 24); }
  function sunLong(jdn) {
    const T = (jdn - 2451545.0) / 36525, T2 = T * T, dr = PI / 180;
    const M = 357.52910 + 35999.05030 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
    const L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
    let DL = (1.914600 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M);
    DL += (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.000290 * Math.sin(dr * 3 * M);
    const L = (L0 + DL) * dr;
    return L - PI * 2 * INT(L / (PI * 2));
  }
  function sunSector(d) { return INT(sunLong(d - 0.5 - TZ / 24) / PI * 6); }
  function month11(yy) {
    const k = INT((jd(31, 12, yy) - 2415021) / 29.530588853);
    let nm = nmDay(k);
    if (sunSector(nm) >= 9) nm = nmDay(k - 1);
    return nm;
  }
  function leapOffset(a11) {
    const k = INT((a11 - 2415021.076998695) / 29.530588853 + 0.5);
    let last, i = 1, arc = sunSector(nmDay(k + i));
    do { last = arc; i++; arc = sunSector(nmDay(k + i)); } while (arc !== last && i < 14);
    return i - 1;
  }
  const yy = now.getFullYear();
  const dayNumber = jd(now.getDate(), now.getMonth() + 1, yy);
  const k = INT((dayNumber - 2415021.076998695) / 29.530588853);
  let monthStart = nmDay(k + 1);
  if (monthStart > dayNumber) monthStart = nmDay(k);
  let a11 = month11(yy), b11 = a11, lunarYear;
  if (a11 >= monthStart) { lunarYear = yy; a11 = month11(yy - 1); }
  else { lunarYear = yy + 1; b11 = month11(yy + 1); }
  const diff = INT((monthStart - a11) / 29);
  let leap = 0, lunarMonth = diff + 11;
  if (b11 - a11 > 365) {
    const lo = leapOffset(a11);
    if (diff >= lo) { lunarMonth = diff + 10; if (diff === lo) leap = 128; }
  }
  if (lunarMonth > 12) lunarMonth -= 12;
  if (lunarMonth >= 11 && diff < 4) lunarYear -= 1;
  return { year: lunarYear, month: lunarMonth + leap, day: dayNumber - monthStart + 1 };
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

// Nút [Sync time]: gửi giờ hệ thống cho thiết bị (vẽ lại theo giao diện đang chọn).
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
//   0, 2-9 = 0x98 <mode>; chưa đồng bộ giờ thì tự Sync time trước
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

// Lịch làm mới TOÀN màn hình (0x9d): mỗi giờ hoặc chỉ lúc 00:00 —
// giống tùy chọn của bản 4.2". Thiết bị lưu vào flash, báo lại ở status[14].
// Hiển thị pin (0x9e, fw >= 1.7): 0 chỉ icon, 1 phần trăm, 2 điện áp —
// thiết bị lưu flash và vẽ lại ngay
// «Định dạng giờ» (0x90 + tham số, fw >= 1.8): 0 = 24h, 1 = 12h — thiết bị
// lưu flash và vẽ lại ngay
async function setTimeFmt() {
  const sel = document.querySelector('input[name="timeFmt"]:checked');
  const v = sel ? parseInt(sel.value) : 0;
  if (await write([0x90, v])) {
    addLog('Đã đặt định dạng giờ: ' + (v === 1 ? '12 giờ' : '24 giờ') + '.');
  }
}

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

// Nút «Cài ngay» trong bảng «Danh sách firmware»: tải file .bin cùng origin
// rồi chạy thẳng luồng OTA — khách không cần tải về máy rồi chọn file thủ công.
async function fwInstallRow(btn) {
  const tr = btn.closest('tr');
  const link = tr && tr.querySelector('a[download]');
  if (!link) { addLog('Hàng này không có file firmware để cài.'); return; }
  if (!longValueChar) { addLog('Chưa kết nối thiết bị — bấm «Kết nối» rồi thử lại.'); return; }
  const ver = (tr.cells && tr.cells[1]) ? tr.cells[1].textContent.trim() : '?';
  if (!confirm('Cài firmware phiên bản ' + ver + ' vào thiết bị đang kết nối?' + String.fromCharCode(10) +
               'Thiết bị sẽ khởi động lại sau khi cập nhật — KHÔNG tắt nguồn giữa chừng!')) return;
  // cuộn lên khu «Cập nhật firmware (OTA)» để người dùng thấy tiến trình
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

async function sendcmd() {
  const cmdTXT = document.getElementById('cmdTXT').value;
  if (cmdTXT == '') return;
  await write(cmdTXT);
}

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

function disconnect() {
  updateButtonStatus();
  resetVariables();
  addLog('Đã ngắt kết nối.');
  document.getElementById("connectbutton").innerHTML = 'Kết nối';
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
