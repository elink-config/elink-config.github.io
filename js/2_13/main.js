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


function resetVariables() {
  deviceMode = null;
  timeSynced = false;
  gattServer = null;
  hmService = null;
  longValueChar = null;
  adcChar = null;
  document.getElementById("log").innerHTML = '';
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


async function setBattStyle() {
  const sel = document.querySelector('input[name="battStyle"]:checked');
  const style = sel ? parseInt(sel.value) : 2;
  if (await write([0x9e, style])) {
    addLog('Đã đặt hiển thị pin: ' + (style === 0 ? 'chỉ icon' : style === 1 ? 'phần trăm' : 'điện áp') + '.');
  }
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
  // lop phu chan thao tac suot lượt OTA (app_common.js — nhu ban 4.2")
  syncOverlayShow('Đang chuẩn bị nâng cấp firmware…',
    'TUYỆT ĐỐI không tắt nguồn thiết bị và không đóng trang trong suốt quá trình.');

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
    syncOverlayStep('Đang xóa vùng nhớ firmware…',
      'Thiết bị xóa bank firmware dự phòng trước khi nhận bản mới. Mất vài giây.');
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
      syncOverlayStep('Đang gửi firmware…',
        'Đã gửi ' + (p >> 10) + '/' + ((firmSize + 64) >> 10) + ' KB. TUYỆT ĐỐI không tắt nguồn thiết bị.');
      syncOverlayProgress(p, firmSize + 64);
    }

    // 0xA4: kết thúc — thiết bị tự khởi động lại vào firmware mới
    buf.fill(0x00); buf[0] = 0xa4;
    await write(buf.subarray(0, 4), true);
    syncOverlayStep('Đang chốt bản mới…',
      'Thiết bị ghi trang đầu rồi tự khởi động lại. Chờ máy hiện lại rồi hãy kết nối.');
    show('Hoàn tất — thiết bị đang khởi động lại.');
    addLog('Cập nhật xong! Thiết bị khởi động lại với firmware mới.');
  } catch (e) {
    console.error(e);
    show('Lỗi: ' + (e.message || e));
    addLog('OTA thất bại: ' + (e.message || e));
  } finally {
    setDisId('otabutton', false);
    syncOverlayHide();
  }
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

  // lop phu chan thao tac: mot tam anh la hang tram goi BLE, bam nut khac
  // giua chung la lenh chen vao va thiet bi nhan nham (app_common.js)
  syncOverlayShow('Đang chuẩn bị gửi ảnh…',
    'Không tắt máy và không đóng trang cho đến khi màn hình hiện xong.');

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
    syncOverlayHide();
    setTimeout(() => { status.parentElement.style.display = "none"; }, 5000);
    return;
  }
  addLog(`Đã truyền xong dữ liệu (${sendTime}s) — màn hình đang làm mới…`);
  setStatus('Màn hình đang làm mới…');
  syncOverlayStep('Đang làm mới màn hình…',
    'Màn e-ink vẽ lại toàn bộ, mất khoảng 15-25 giây. Đừng tắt máy giữa chừng.');

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
  syncOverlayHide();
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
