let bleDevice, gattServer;
let hmService;                 // service HMCLOCK 0xff00
let longValueChar;             // 0xff01 — ghi lệnh + đọc trạng thái
let adcChar;                   // 0xff02 — đọc điện áp pin
let startTime;
let statusRetry = false;    // chống đọc lại chồng nhau khi gặp chuỗi kích hoạt
let canvas, ctx;
let paintManager, cropManager;
let deviceMode = null;      // chế độ thiết bị báo về (SỐ = VỊ TRÍ THẺ; 28 = ảnh)
let timeSynced = false;     // đã đồng bộ giờ — mở khóa chọn giao diện màn hình

// Giao thức = giao thức GỐC của firmware HMCLOCK (webtool weble/ trong repo
// firmware) + các lệnh mở rộng cùng phong cách. Tất cả trên service 0xff00:
// - 0xff01 (Long Value): GHI lệnh + ĐỌC trạng thái 14 byte
//     0x91 yyyy(LE) MM dd hh mm ss ww lyear lmonth lday   đặt giờ (+ âm lịch)
//     0x90 đổi 12/24h · 0x92 <int16 LE> hiệu chỉnh nhanh/chậm
//     0x93 <offset u16 LE> <data…>  ghi khối ảnh
//     0x94 [01]   hiển thị ảnh (01 = nạp ảnh đã lưu từ flash)
//     0x95 lưu ảnh vào flash · 0x96 <idx> đổi phân giải · 0x97 đọc nhiệt độ
//     0x98 <mode> chọn giao diện (1-27 và 29 — ẢNH 28 phải đặt bằng 0x94;
//          29 = «Đồng hồ tối giản», firmware còn nhận nhưng đã bỏ thẻ)
//     0x9d <0|1> lịch làm mới toàn màn · 0x9e <0|1|2> kiểu hiển thị pin
//     0x9b <158B> bố cục Tự thiết kế · 0x9c ảnh cho Tự thiết kế (chia khối)
//     0x99 <năm 2 LE> <tháng 1-12> <ngày> <tên UTF-8>  đặt sự kiện đếm ngược
//     0x9a <idx 0-2, bit7 = dòng cuối> <text UTF-8>    đặt dòng ghi chú
//     0x9F khởi động lại · 0xA0/A2/A3/A4 OTA firmware
//   Trạng thái đọc về: [0-1] năm LE, [2] tháng 0-11, [3] ngày, [4-6] h/m/s,
//     [7-10] phút từ lần đặt giờ (int32 LE, -1 = chưa), [11] phân giải,
//     [12] nhiệt độ int8, [13] chế độ (SỐ MODE = VỊ TRÍ THẺ, 1-29)
// - 0xff02: điện áp pin (uint16 LE, mV)
// UUID viết dạng chuỗi 128-bit ĐẦY ĐỦ (0xff00 + base UUID Bluetooth) chứ
// KHÔNG dùng số tắt (0xff00): Bluefy/WebBLE trên iOS không hiểu số tắt trong
// optionalServices → hộp chọn thiết bị quét mãi không hiện gì. Chrome hiểu
// cả hai dạng. (Webtool 4_2inch dùng chuỗi từ đầu nên không dính lỗi này.)
const HM_SERVICE = '0000ff00-0000-1000-8000-00805f9b34fb';
const HM_LONG_VALUE = '0000ff01-0000-1000-8000-00805f9b34fb';
const HM_ADC = '0000ff02-0000-1000-8000-00805f9b34fb';
// CHỈ chấp nhận thiết bị 2.13" tên DIY-2_13-xxxx. Tên DLG-CLOCK-… chỉ dùng ở
// hub gộp (elink-config.github.io), KHÔNG nhận ở webtool riêng 2_13inch này.
const BLE_NAME_PREFIX = 'DIY-2_13-';
const BLE_REQUEST_FILTERS = [
  { namePrefix: BLE_NAME_PREFIX },
];

// Hai loại panel 2.13", đổi bằng 1 nút (lệnh 0x96, firmware lưu vào flash):
//   0: HINK-E0213A41/A55 — 212×104 (canvas ngang 212×104, buffer 2756 byte)
//   1: OPM021B1 / HINK-E0213A67 — 250×122 (canvas ngang 250×122, buffer 4000 byte)
const RESOLUTIONS = [
  { w: 212, h: 104, label: '212×104' },
  { w: 250, h: 122, label: '250×122' },
];
let resIdx = parseInt(localStorage.getItem('resIdx_2_13')) || 0;
if (resIdx < 0 || resIdx > 1) resIdx = 0;


function logBleConnectHelp(error) {
  addLog(`connect: ${error.name} - ${error.message}`);
  addLog('Gợi ý xử lý khi kết nối thất bại:');
  addLog('1. Đảm bảo thiết bị đã nạp firmware, tên Bluetooth là DIY-…');
  addLog('2. Đặt thiết bị gần máy tính, màn hình chưa vào chế độ ngủ');
  addLog('3. Windows: xóa ghép nối cũ trong cài đặt Bluetooth rồi thử lại');
  addLog('4. Ngắt kết nối thiết bị khỏi điện thoại/máy tính khác');
  addLog('5. Dùng Chrome/Edge và mở trang qua https hoặc localhost');
}


function resetVariables() {
  deviceMode = null;
  timeSynced = false;
  gattServer = null;
  hmService = null;
  longValueChar = null;
  adcChar = null;
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

// Đọc trạng thái 14 byte từ Long Value (0xff01): giờ thiết bị + phân giải +
// nhiệt độ màn hình + chế độ hiển thị. Trả về object hoặc null.
async function readStatus(quiet = false) {
  if (!longValueChar) return null;
  try {
    const v = await longValueChar.readValue();
    if (v.byteLength < 11) return null;
    // Sau bước kiểm tra kích hoạt (0x26), giá trị 0xff01 tạm là chuỗi ASCII
    // "mac=... act=..." cho tới lần clock_push kế tiếp của thiết bị — KHÔNG
    // phải gói trạng thái: bỏ qua để khỏi khóa nhầm radio «Hiển thị pin»
    // (byte[17] rơi vào chữ 'a' = 97 > 2) và khỏi đọc giờ rác.
    if (v.getUint8(0) === 0x6d && v.getUint8(1) === 0x61 && v.getUint8(2) === 0x63 && v.getUint8(3) === 0x3d) {
      // ĐỌC LẠI sau khi thiết bị đẩy gói trạng thái thật, nếu không thì lần
      // đọc này mất trắng: các cổng kiểm tra bên dưới (radio pin, 12/24h)
      // không bao giờ chạy và người dùng thấy chúng bị khóa vĩnh viễn.
      if (!statusRetry) {
        statusRetry = true;
        setTimeout(() => { statusRetry = false; readStatus(true); }, 1200);
      }
      return null;
    }
    const st = {
      year: v.getUint16(0, true),
      month: v.getUint8(2),          // 0-11
      mday: v.getUint8(3),
      hour: v.getUint8(4),
      minute: v.getUint8(5),
      second: v.getUint8(6),
      calMinute: v.getInt32(7, true),
      resIdx: v.byteLength >= 14 ? v.getUint8(11) : null,
      temp: v.byteLength >= 14 ? v.getInt8(12) : null,
      mode: v.byteLength >= 14 ? v.getUint8(13) : null,
      // [14] lịch làm mới toàn màn (0x9d): 1 = mỗi giờ, 0 = chỉ lúc 00:00
      hourlyFull: v.byteLength >= 15 ? v.getUint8(14) : null,
      // [15][16] phiên bản firmware major.minor (từ v1.5; bản cũ chỉ 15 byte)
      fwVer: v.byteLength >= 17 ? (v.getUint8(15) + '.' + v.getUint8(16)) : null,
      // [17] hiển thị pin (0x9e, fw >= 1.7): 0 chỉ icon / 1 % / 2 điện áp
      battStyle: v.byteLength >= 18 ? v.getUint8(17) : null,
      // [18] định dạng giờ (0x90 + tham số, fw >= 1.8): 0 = 24h, 1 = 12h
      timeFmt: v.byteLength >= 19 ? v.getUint8(18) : null,
    };
    if (!quiet) {
      addLog('Giờ thiết bị: ' + st.year + '-' + String(st.month + 1).padStart(2, '0') +
        '-' + String(st.mday).padStart(2, '0') + ' ' + String(st.hour).padStart(2, '0') +
        ':' + String(st.minute).padStart(2, '0') + ':' + String(st.second).padStart(2, '0'), '⇓');
      // Độ dài gói + phiên bản: in LUÔN (không chỉ chế độ dev) vì đây là thứ
      // quyết định các cổng kiểm tra tính năng — có nó thì mọi báo lỗi kiểu
      // «máy v1.7 mà không chỉnh được pin» đọc log là biết ngay nguyên nhân.
      addLog('Gói trạng thái: ' + v.byteLength + ' byte' +
        (st.fwVer !== null ? ', máy báo v' + st.fwVer : ', máy KHÔNG báo phiên bản'), '⇓');
    }
    // Phiên bản thiết bị tự khai (fw >= 1.5) — đặt TRƯỚC các cổng kiểm tra
    // bên dưới vì chúng gọi fwAtLeast() đọc biến này.
    window.deviceFwVer = st.fwVer;
    // giờ đã từng được đặt (firmware khởi động ở 2025-01) → mở khóa giao diện
    if (st.year >= 2026) timeSynced = true;
    if (st.resIdx === 0 || st.resIdx === 1) {
      if (!quiet && st.resIdx !== resIdx) addLog('Thiết bị dùng màn hình ' + RESOLUTIONS[st.resIdx].label + '.', '⇓');
      applyResolution(st.resIdx, true);
    }
    if (st.temp !== null) showPanelTemp(st.temp);
    if (st.hourlyFull !== null) {
      const chk = document.getElementById('hourlyFullCHK');
      if (chk) chk.checked = st.hourlyFull !== 0;
    }
    // Cổng kiểm tra tính năng theo phiên bản — FAIL-OPEN khi KHÔNG đọc được
    // phiên bản (gói ngắn / firmware chưa tự khai): chỉ KHOÁ khi biết CHẮC máy
    // cũ hơn mức yêu cầu. Trước đây fail-closed nên máy v1.7 thực địa nào trả
    // gói thiếu byte là bị khoá vĩnh viễn dù vẫn nhận lệnh tốt. Gửi lệnh lạ
    // cho firmware cũ là vô hại (handler bỏ qua opcode không biết).
    // Hint kèm luôn thứ đọc được để lần báo lỗi sau không phải đoán.
    {
      const ok = fwAtLeast(1, 7) || st.fwVer === null;
      document.querySelectorAll('input[name="battStyle"]').forEach(r => { r.disabled = !ok; });
      const h = document.getElementById('battStyleHint');
      if (h) h.textContent = fwAtLeast(1, 7) ? 'Thiết bị vẽ lại ngay khi đổi.'
        : st.fwVer === null
          ? 'Máy không báo phiên bản (gói ' + v.byteLength + ' byte) — vẫn cho chỉnh; cần firmware ≥ 1.7 mới có tác dụng.'
          : 'Cần firmware ≥ 1.7 — máy đang chạy v' + st.fwVer + ', hãy cập nhật ở mục OTA.';
      if (st.battStyle !== null && st.battStyle <= 2) {
        const rb = document.querySelector(`input[name="battStyle"][value="${st.battStyle}"]`);
        if (rb) rb.checked = true;
      }
    }
    // «Định dạng giờ» 12h/24h cần fw >= 1.8 (0x90 + tham số) — cùng quy tắc
    {
      const ok = fwAtLeast(1, 8) || st.fwVer === null;
      document.querySelectorAll('input[name="timeFmt"]').forEach(r => { r.disabled = !ok; });
      const h = document.getElementById('timeFmtHint');
      if (h) h.textContent = fwAtLeast(1, 8) ? 'Thiết bị vẽ lại ngay khi đổi.'
        : st.fwVer === null
          ? 'Máy không báo phiên bản (gói ' + v.byteLength + ' byte) — vẫn cho chỉnh; cần firmware ≥ 1.8 mới có tác dụng.'
          : 'Cần firmware ≥ 1.8 — máy đang chạy v' + st.fwVer + ', hãy cập nhật ở mục OTA.';
      if (st.timeFmt !== null && st.timeFmt <= 1) {
        const rb = document.querySelector(`input[name="timeFmt"][value="${st.timeFmt}"]`);
        if (rb) rb.checked = true;
      }
    }
    if (st.mode !== null) {
      deviceMode = st.mode;                 // SO MODE = VI TRI THE (28 = ảnh, thẻ 'img')
      if (typeof highlightMode === 'function') highlightMode(st.mode === IMG_MODE ? 'img' : st.mode);
    }
    // KHÔNG gọi FwCheck.report vì popup nhắc firmware đang TẮT (xem ghi chú
    // ở connect); biến window.deviceFwVer đã đặt ở đầu hàm.
    if (st.fwVer !== null) {
      if (!quiet) addLog('Firmware thiết bị: v' + st.fwVer, '⇓');
      // if (typeof FwCheck !== 'undefined') FwCheck.report(st.fwVer);
    }
    updateButtonStatus();
    return st;
  } catch (e) {
    console.error(e);
    if (!quiet && e.message) addLog("readStatus: " + e.message);
    return null;
  }
}

// battPct() ở common.js (dùng chung với bản xem trước + Thiết kế màn hình)

// Đọc điện áp pin (0xff02, uint16 LE mV); % theo đường xả (khớp firmware)
async function readVoltage() {
  if (!adcChar) return null;
  try {
    const v = await adcChar.readValue();
    const mv = v.getUint16(0, true);
    const el = document.getElementById('battVolt');
    const pct = battPct(mv);
    if (el) el.textContent = (mv / 1000).toFixed(2) + ' V (' + pct + '%)';
    return mv;
  } catch (e) {
    console.error(e);
    return null;
  }
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

// Lọc chuỗi theo bộ glyph unifont VN của firmware: thay ký tự typographic
// phổ biến bằng bản ASCII, BỎ ký tự ngoài font (emoji, chữ Hán…) — firmware
// cũ (≤ v1.8) gặp ký tự không có trong font khi vẽ sẽ TREO MÁY phải rút nguồn.
const FONT_MAP = {
  '–': '-', '—': '-', '−': '-', '‘': "'", '’': "'",
  '‚': "'", '“': '"', '”': '"', '„': '"', '…': '...',
  ' ': ' ', '•': '-', '·': ' - ', '₫': 'd',
};
const FONT_OK = /[\x20-\x7E°À-ÃÈ-ÊÌÍÒ-ÕÙÚÝà-ãè-êìíò-õùúýĂăĐđĨĩŨũƠơƯưẠ-ỹ]/;
window.fontSafe = function (s) {
  let out = '';
  for (const ch of String(s || '')) {
    if (FONT_MAP[ch] !== undefined) out += FONT_MAP[ch];
    else if (FONT_OK.test(ch)) out += ch;
    // ký tự khác: bỏ
  }
  return out;
};

// Cắt chuỗi theo giới hạn BYTE UTF-8 (không cắt giữa ký tự có dấu)
function utf8Trunc(s, maxBytes) {
  const enc = new TextEncoder();
  let b = enc.encode(fontSafe(s));
  while (b.length > maxBytes) {
    s = s.slice(0, -1);
    b = enc.encode(fontSafe(s));
  }
  return b;
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

async function setBattStyle() {
  const sel = document.querySelector('input[name="battStyle"]:checked');
  const style = sel ? parseInt(sel.value) : 2;
  if (await write([0x9e, style])) {
    addLog('Đã đặt hiển thị pin: ' + (style === 0 ? 'chỉ icon' : style === 1 ? 'phần trăm' : 'điện áp') + '.');
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

// ------- OTA firmware qua BLE (0xA0/A2/A3/A4 — như weble) -------


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
    // 0xA0: bắt đầu — firmware xoá bank không hoạt động
    const buf = new Uint8Array(136);
    const dv = new DataView(buf.buffer);
    buf[0] = 0xa0; buf[1] = 0x00;
    // size u32 (truoc u16): firmware > 64KB. Tuong thich nguoc: fw cu doc u16
    // (2 byte thap) van dung khi firmware dich < 64KB (vd ban "temp" cau noi).
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

async function sendimg() {
  if (cropManager.isCropMode()) {
    alert("Vui lòng hoàn tất cắt ảnh trước! Đã hủy gửi.");
    return;
  }

  startTime = new Date().getTime();
  const status = document.getElementById("status");
  status.parentElement.style.display = "block";

  updateButtonStatus(true);

  const data = canvas2bytesBW(canvas);
  addLog(`Bắt đầu gửi ảnh ${canvas.width}x${canvas.height} (${data.length} byte)`);
  let sent = false;
  if (await writeImage(data)) {
    await sleep(200);
    sent = await write([0x94]);   // hiển thị ảnh vừa gửi (firmware xếp hàng nếu đang bận)
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
  // lâu hơn nếu lệnh phải xếp hàng sau một lần làm mới đang chạy)
  let shown = false;
  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    const st = await readStatus(true);
    if (st && st.mode === 28) { shown = true; break; }
  }
  if (shown) {
    // chế độ ẢNH của firmware là 28; thẻ tương ứng trong thư viện là 'img'.
    // (Trước đây ghi 3 — số thẻ của bản đánh số CŨ — nên sau khi gửi ảnh
    // thư viện tô sáng nhầm thẻ «Đồng hồ lật».)
    deviceMode = IMG_MODE;
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

// Lưu ảnh đang có trong buffer thiết bị vào SPI flash (0x95): thiết bị sẽ nạp
// lại ảnh này khi khởi động hoặc khi chọn màn hình «Ảnh đã lưu».
async function saveImageFlash() {
  if (await write([0x95])) {
    addLog("Đã gửi lệnh lưu ảnh vào flash!");
  }
}

// ------- đổi phân giải màn hình (1 nút): 212×104 <-> 250×122 -------

// Cập nhật canvas + nhãn theo phân giải idx. Gọi khi người dùng đổi hoặc khi
// thiết bị báo phân giải hiện tại trong gói trạng thái, byte [11]).
function applyResolution(idx, quiet = false) {
  if (idx !== 0 && idx !== 1) return;
  const r = RESOLUTIONS[idx];
  const changed = (canvas && (canvas.width !== r.w || canvas.height !== r.h)) || idx !== resIdx;
  resIdx = idx;
  localStorage.setItem('resIdx_2_13', String(idx));

  if (canvas && changed) {
    canvas.width = r.w;
    canvas.height = r.h;
    fillCanvas('white');
    if (paintManager) {
      paintManager.clearHistory();
      paintManager.clearElements();
      paintManager.saveToHistory();
    }
    if (originalImage) {
      computeFitScale(false);
      imgOffsetX = imgOffsetY = 0;
      redrawImage();
    }
  }

  const label = document.getElementById('resLabel');
  if (label) label.textContent = r.label;
  const canvasLabel = document.getElementById('canvasSizeLabel');
  if (canvasLabel) canvasLabel.textContent = '2.13" (' + r.label + ')';
  const btn = document.getElementById('resswitchbutton');
  if (btn) btn.textContent = 'Chuyển sang ' + RESOLUTIONS[1 - idx].label;

  // vẽ lại thẻ xem trước trong thư viện giao diện theo kích thước mới
  if (typeof window.rebuildModeGallery === 'function') window.rebuildModeGallery();
  if (typeof window.dsResize === 'function') window.dsResize();

  if (!quiet) addLog('Canvas theo phân giải ' + r.label + '.');
}

// Nút [Chuyển sang ...]: đổi loại panel bằng 1 cú bấm.
// Đang kết nối: gửi 0x96 <idx> — firmware lưu vào flash và vẽ lại màn hình
// theo phân giải mới; webtool chờ rồi đọc lại trạng thái để xác nhận.
// Chưa kết nối: chỉ đổi canvas để soạn ảnh trước.
async function switchResolution() {
  const target = 1 - resIdx;
  const connected = gattServer != null && gattServer.connected;
  if (connected) {
    addLog('Đang chuyển màn hình sang ' + RESOLUTIONS[target].label + '…');
    if (await write([0x96, target])) {
      addLog('Vui lòng chờ màn hình vẽ lại theo phân giải mới.');
      // chờ màn hình làm mới xong rồi đọc lại (tối đa ~10 giây)
      for (let i = 0; i < 10; i++) {
        await sleep(1000);
        const st = await readStatus(true);
        if (st && st.resIdx === target) break;
      }
      if (resIdx === target) addLog('Đã chuyển sang ' + RESOLUTIONS[target].label + '.');
    }
  } else {
    applyResolution(target);
    addLog('(Chưa kết nối — thiết bị sẽ được đối chiếu khi kết nối.)');
  }
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
  // chọn giao diện màn hình yêu cầu đã đồng bộ giờ ([Sync time])
  const modeStatus = forceDisabled ? 'disabled' : ((connected && timeSynced) ? null : 'disabled');
  // null-safe: các nút giao diện được mode_preview.js tạo động, có thể chưa có
  const setDis = (id, val) => { const el = document.getElementById(id); if (el) el.disabled = val; };
  setDis("reconnectbutton", (gattServer == null || gattServer.connected) ? 'disabled' : null);
  setDis("synctimebutton", status);
  setDis("calibratebutton", status);
  setDis("otabutton", status);
  setDis("sendcmdbutton", status);
  // nút «Áp dụng» của thư viện giao diện (mode_preview.js tạo động):
  // các giao diện 0/2-9 tự Sync time nếu cần — chỉ yêu cầu kết nối;
  // «Ảnh đã lưu» cần đã đồng bộ giờ (giữ khóa như trước)
  document.querySelectorAll('.mode-card button').forEach(btn => {
    btn.disabled = (btn.id === 'applybtn-img') ? modeStatus : status;
  });
  setDis("sendeventbutton", status);
  setDis("dsuploadbutton", status);
  setDis("sendnotebutton", status);
  setDis("resetdevicebutton", status);
  setDis("sendimgbutton", status);
  setDis("saveflashbutton", status);
  // nút đọc nhiệt độ cần kết nối; nút đổi phân giải dùng được cả khi offline
  setDis("temprefreshbutton", status);
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
      // namePrefix hoạt động tốt cả trên Bluefy (4_2inch dùng y hệt) —
      // lỗi Bluefy trước đây là do UUID dạng số trong optionalServices
      bleDevice = await navigator.bluetooth.requestDevice({ // ?debug=true vẫn LỌC THEO TÊN thiết bị (yêu cầu user) — hết acceptAllDevices
        filters: BLE_REQUEST_FILTERS,
        optionalServices: [HM_SERVICE],
      });
    } catch (e) {
      console.error(e);
      if (e.name === 'NotFoundError') {
        addLog("Không tìm thấy thiết bị E-Ink (DIY-2_13-xxxx)");
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

    // chỉ chấp nhận thiết bị DIY-2_13-… (trừ chế độ dev)
    if (!debugMode && !(bleDevice.name || '').startsWith(BLE_NAME_PREFIX)) {
      addLog('Thiết bị «' + (bleDevice.name || 'không tên') + '» không phải màn hình DIY-2_13-…');
      addLog('Hãy chọn đúng thiết bị tên DIY-2_13-xxxx.');
      bleDevice = null;
      return;
    }

    await bleDevice.addEventListener('gattserverdisconnected', disconnect);
    await connect();
  }
}


async function connect() {
  if (bleDevice == null || longValueChar != null) return;
  // TAT nhac cap nhat firmware cho 2.13 (2026-07-29): ban <= v1.4 khong tu
  // khai phien ban nen popup nhac ca may DA chay ban moi nhat — phien phuc.
  // Muon bat lai: bo comment 2 dong FwCheck.reset / FwCheck.schedule.
  // FwCheck.reset('1.3', bleDevice && bleDevice.name);

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

  // đọc trạng thái: giờ thiết bị + phân giải + nhiệt độ + chế độ + điện áp pin
  await sleep(300);
  await readStatus();
  await readVoltage();
  if (!timeSynced) {
    addLog('Bấm «Sync time» để đồng bộ giờ trước khi chọn giao diện.');
  }
  // FwCheck.schedule(1500);  // TAT popup nhac firmware (xem ghi chu o connect)
}


// addLog() / clearLog(): js/log.js (dung chung ca hub lan cac app).
// Ban standalone trong EPD-DA14585/webtools/ van giu ban rieng cua no.


// ------- image transform state (reload / stretch / fit / rotate / pan) -------
let originalImage = null;  // the loaded source image (null after a manual crop)
let imgRotation = 0;       // degrees, multiples of 90
let imgScaleX = 1.0, imgScaleY = 1.0;
let imgOffsetX = 0, imgOffsetY = 0;  // pan offset in canvas pixels (drag to move)


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


document.body.onload = () => {
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext("2d");

  canvas.width = RESOLUTIONS[resIdx].w;
  canvas.height = RESOLUTIONS[resIdx].h;
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  paintManager = new PaintManager(canvas, ctx);
  cropManager = new CropManager(canvas, ctx, paintManager);

  paintManager.initPaintTools();
  cropManager.initCropTools();
  initEventHandlers();
  applyResolution(resIdx, true);   // đồng bộ nhãn + nút đổi phân giải
  updateButtonStatus();
  checkDebugMode();
}
