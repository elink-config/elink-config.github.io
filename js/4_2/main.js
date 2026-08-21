let bleDevice, gattServer;
let epdService, epdCharacteristic;
let startTime, msgIndex, appVersion;
let canvas, ctx, textDecoder;
let paintManager, cropManager;
let deviceMode = null;      // display mode reported by the device config
// Nhắc cập nhật firmware: logic DÙNG CHUNG nằm ở js/fw_check.js (FwCheck) —
// thiết bị gửi 'fw=v1.x.y' khi bật notify (từ bản sau 1.3.1), so với bảng
// «Danh sách firmware»; đời cũ không gửi thì coi như 1.3.1
// 3 khe ảnh (fw >= 1.5): mask bit0..2 = khe đã có ảnh trên thiết bị (đọc từ
// config blob byte 214); cần >= 2 khe mới bật được «Tự động đổi ảnh»
let imgSlotMask = 0;
// Số KHE ẢNH của máy: 3 với firmware cũ, 5 từ BWR v2.7 / 4 màu v3.7 (khe 5 và
// 6 là NỀN của hai «Tự thiết kế», không tính vào đây). fwSlots() gọi được sau
// khi thiết bị báo 'fw=' — trước đó cứ coi là 3 cho an toàn.
let IMG_SLOTS = 3;
const IMG_BG_SLOT = d => 5 + d;   // khe nền của thiết kế d (0/1)
// 6 o chu «Tu thiet ke» + thanh phan Thu / Ngay duong: BWR v2.8, 4 mau v3.8.
// Bo cuc luc do dai 350 byte nen PHAI gui chia manh (0xF0/0xF1).
function fwHasSixText() {
  const nm = (bleDevice && bleDevice.name) || '';
  if (nm.indexOf('DIY-4_2C') === 0) return FwCheck.atLeast('3.5');
  if (nm.indexOf('DIY-4_2-') === 0) return FwCheck.atLeast('2.4');
  return false;
}

function fwHasNewSlots() {
  const nm = (bleDevice && bleDevice.name) || '';
  return FwCheck.atLeast(nm.indexOf('DIY-4_2C') === 0 ? '3.5' : '2.4');
}
let timeSynced = false;     // device clock is valid (reported or just synced);
                            // gates the mode gallery in [Điều khiển thiết bị]

const EpdCmd = {
  SET_PINS: 0x00,
  INIT: 0x01,
  CLEAR: 0x02,
  SEND_CMD: 0x03,
  SEND_DATA: 0x04,
  REFRESH: 0x05,
  SLEEP: 0x06,

  SET_TIME: 0x20,
  SET_NOTE: 0x22, // UTF-8 note text for the "Ghi chú" screen (mode 19)
  SET_HOURLY_FULL: 0x23, // clock cleanup cadence: 1 = full refresh hourly, 0 = only at 00:00
  SET_LAYOUT: 0x24, // MODE_CUSTOM (mode 20) widget layout from the designer
  SET_ICON: 0x25, // MODE_CUSTOM 1-bit icon, chunked: [0x00,w,h,data...] then [0x01,data...]
  IMG_SLOT: 0x27, // 3 khe ảnh (fw >= 1.5): [01 slot] mở khe / [02] chốt / [03 auto interval]
  DARK_BOOST: 0x28, // [0/1] chữ đậm cho màn lô in nhạt (ép 0°C khi làm mới toàn màn)
  BATT_STYLE: 0x29, // [0/1/2] hiển thị pin: chỉ icon / phần trăm / điện áp (fw >= 1.9)
  CUSTOM_BG: 0x2B, // [0..3] ảnh nền «Tự thiết kế»: 0 tắt, 1-3 = khe ảnh (4.2 >= 2.3)
  ASSET: 0x2C, // nạp blob dữ liệu vào flash: [00 len_u16] mở / [01 data] / [02 crc32_u32] chốt
  TIME_FMT: 0x2A, // [0/1] định dạng giờ: 24h / 12h (BWR >= 2.1, 4 màu >= 3.0, 7.5" V1 >= 0.3)
  TIMETABLE: 0x2D, // thời khóa biểu (mode 24), chia mảnh: [00 flags am pm data] rồi [01 data]

  WRITE_IMG: 0x30, // v1.6

  SET_CONFIG: 0x90,
  SYS_RESET: 0x91,
  SYS_SLEEP: 0x92,
  CFG_ERASE: 0x99,
};

const EPD_SERVICE = '62750001-d828-918d-fb46-b6c11c675aec';
// Chỉ liệt kê đúng máy của app này: 4.2" (DIY-4_2-xxxx) và 7.5" (DIY-7_5-xxxx
// DIY-7_5-xxxx = màn 7.5" 640×384 DA14585, tên cũ DIY-7_5V-xxxx). Các
// board 2.13"/2.9" quảng bá DIY-2_13-/DIY-2_9- dùng giao thức khác (service
// 0xff00), hiện trong hộp chọn chỉ gây nhầm. Board 4.2" chạy firmware quá cũ
// (tên chưa gắn cỡ màn) vẫn kết nối được bằng chế độ dev (?debug=true).
const BLE_REQUEST_FILTERS = [
  { namePrefix: 'DIY-4_2' },
  { namePrefix: 'DIY-7_5' },
];


function logBleConnectHelp(error) {
  addLog(`connect: ${error.name} - ${error.message}`);
  addLog('Gợi ý xử lý khi kết nối thất bại:');
  addLog('1. Đảm bảo thiết bị đã nạp firmware mới nhất, tên Bluetooth là DIY-4_2-xxxx / DIY-7_5-xxxx');
  addLog('2. Đặt thiết bị gần máy tính, màn hình chưa vào chế độ ngủ');
  addLog('3. Windows: xóa ghép nối cũ trong cài đặt Bluetooth rồi thử lại');
  addLog('4. Ngắt kết nối thiết bị khỏi điện thoại/máy tính khác');
  addLog('5. Dùng Chrome/Edge và mở trang qua https hoặc localhost');
}


const canvasSizes = [
  { name: '1.54_152_152', width: 152, height: 152 },
  { name: '1.54_200_200', width: 200, height: 200 },
  { name: '2.13_104_212', width: 104, height: 212 },
  { name: '2.13_122_250', width: 122, height: 250 },
  { name: '2.66_152_296', width: 152, height: 296 },
  { name: '2.66_184_360', width: 184, height: 360 },
  { name: '2.9_128_296', width: 128, height: 296 },
  { name: '2.9_168_384', width: 168, height: 384 },
  { name: '3.5_184_384', width: 184, height: 384 },
  { name: '3.5_360_600', width: 360, height: 600 },
  { name: '3.7_240_416', width: 240, height: 416 },
  { name: '3.7_280_480', width: 280, height: 480 },
  { name: '3.97_800_480', width: 800, height: 480 },
  { name: '3.98_768_552', width: 768, height: 552 },
  { name: '4.2_400_300', width: 400, height: 300 },
  { name: '5.79_792_272', width: 792, height: 272 },
  { name: '5.83_600_448', width: 600, height: 448 },
  { name: '5.83_648_480', width: 648, height: 480 },
  { name: '7.5_640_384', width: 640, height: 384 },
  { name: '7.5_800_480', width: 800, height: 480 },
  { name: '7.5_880_528', width: 880, height: 528 },
  { name: '10.2_960_640', width: 960, height: 640 },
  { name: '10.85_1360_480', width: 1360, height: 480 },
  { name: '11.6_960_640', width: 960, height: 640 },
  { name: '4.0E6_600_400', width: 600, height: 400 },
  { name: '7.3E6_800_480', width: 800, height: 480 },
];



/* ---- Quy đổi SỐ MODE cho máy chạy firmware đời cũ ---------------------------
 * BWR v2.6 / 4 màu v3.6 đánh lại số mode cho liền mạch (số thẻ = số mode).
 * Máy chưa cập nhật vẫn hiểu bảng số CŨ, nên phải quy đổi lúc gửi và lúc đọc
 * config về. Bỏ bảng này khi không còn máy nào chạy firmware trước mốc đó. */
const MODE_NEW2OLD = { 1:1, 2:3, 3:4, 4:5, 5:6, 6:7, 7:8, 8:9, 9:10, 10:11, 11:12,
                       12:13, 13:14, 14:15, 15:16, 16:17, 17:19, 18:21, 19:22,
                       20:23, 21:24, 22:20 };
const MODE_OLD2NEW = Object.fromEntries(Object.entries(MODE_NEW2OLD).map(([n, o]) => [o, +n]));

function modeNumberingIsNew() {
  const nm = (bleDevice && bleDevice.name) || '';
  return FwCheck.atLeast(nm.indexOf('DIY-4_2C') === 0 ? '3.5' : '2.4');
}
// số gửi XUỐNG máy
function modeToWire(m) {
  if (modeNumberingIsNew()) return m;
  return MODE_NEW2OLD[m] !== undefined ? MODE_NEW2OLD[m] : m;
}
// số máy BÁO LÊN (config) -> số thẻ
function modeFromWire(m) {
  if (modeNumberingIsNew()) return m;
  return MODE_OLD2NEW[m] !== undefined ? MODE_OLD2NEW[m] : m;
}

async function write(cmd, data, withResponse = true) {
  if (!epdCharacteristic) {
    addLog("Dịch vụ không khả dụng, vui lòng kiểm tra kết nối Bluetooth");
    return false;
  }
  let payload = [cmd];
  if (data) {
    if (typeof data == 'string') data = hex2bytes(data);
    if (data instanceof Uint8Array) data = Array.from(data);
    payload.push(...data)
  }
  // goi anh 0x30 KHONG log hex tung goi (246B -> chuoi ~500 ky tu, ~250
  // goi/anh lam nghen dien thoai yeu; tien do da co o thanh trang thai)
  if (cmd !== EpdCmd.WRITE_IMG) addLog(bytes2hex(payload), '⇑');
  try {
    // Web Bluetooth KHÔNG có timeout: thiết bị treo/reset giữa chừng thì lời
    // hứa này KHÔNG BAO GIỜ kết thúc — cả lượt gửi đứng im, không một dòng
    // báo lỗi nào (triệu chứng «Đang chuẩn bị khe 1 (xóa flash)…» đứng mãi).
    // Bọc đồng hồ đếm ngược để còn trả false mà báo cho người dùng biết.
    const p = withResponse
      ? epdCharacteristic.writeValueWithResponse(Uint8Array.from(payload))
      : epdCharacteristic.writeValueWithoutResponse(Uint8Array.from(payload));
    let timer = null;
    const late = await Promise.race([
      p.then(() => false),
      new Promise(r => { timer = setTimeout(() => r(true), 8000); })
    ]);
    if (timer) clearTimeout(timer);
    if (late) {
      addLog(`write: thiết bị không trả lời lệnh 0x${(cmd || 0).toString(16)} sau 8s (treo hoặc mất kết nối)`);
      return false;
    }
  } catch (e) {
    console.error(e);
    if (e.message) addLog("write: " + e.message);
    return false;
  }
  return true;
}

// đợi thiết bị báo 'mtu=…' (notify sau lệnh INIT). Sửa race cũ: bắt đầu
// truyền khi ô MTU còn giá trị mặc định 20 -> gói chỉ 18 byte, ~1700 gói
// cho một tấm ảnh (nguyên nhân chính truyền rùa rồi rớt kết nối).
let mtuNotifyResolve = null;

// đợi thiết bị báo 'img=rdy' sau lệnh mở khe ảnh (fw >= 1.6). Thiết bị xóa
// 32KB flash (~0.5-1.5s) TRONG handler lệnh mở khe; bắn gói ảnh trong lúc đó
// là gói dồn đống làm cạn MSG heap BLE -> thiết bị reset (lỗi v1.5).
// Resolve true khi 'img=rdy', false khi 'img=err' hoặc hết giờ.
let imgRdyResolve = null;

/* ---- Vùng dữ liệu ở flash (lệnh 0x2C) --------------------------------------
 * Font hiển thị + bốn bảng âm lịch đã tách khỏi firmware để trả RAM (firmware
 * DA14585 nạp trọn vào 96KB SysRAM nên mảng const cũng ăn RAM). Máy nạp dây
 * đã có sẵn blob trong ảnh nạp; máy cập nhật qua OTA thì CHƯA có, vì OTA chỉ
 * ghi bank firmware — lúc đó máy báo 'asset=none' và hàm dưới tự gửi.
 * KHONG co du lieu nay thi may KHONG HIEN DUOC CHU (font nam trong do). */
let assetResolve = null;
let assetBusy = false;

function waitAsset(timeoutMs) {
  return new Promise(resolve => {
    const t = setTimeout(() => { assetResolve = null; resolve(''); }, timeoutMs);
    assetResolve = (m) => { clearTimeout(t); resolve(m); };
  });
}

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

async function sendAsset() {
  if (assetBusy) return;
  { const nm = (bleDevice && bleDevice.name) || '';  // 4.2" BA MÀU và BỐN MÀU dùng CHUNG blob này
    if (nm.indexOf('DIY-4_2-') !== 0 && nm.indexOf('DIY-4_2C-') !== 0) return; }
  assetBusy = true;
  // phủ kín màn hình: luồng này gần 500 gói, bấm nút khác trong lúc đó là lệnh
  // chen vào giữa và máy nhận nhầm (xem syncOverlayShow ở app_common.js)
  syncOverlayShow('Đang chuẩn bị dữ liệu hiển thị…',
    'Máy chưa có bộ chữ tiếng Việt và bảng âm lịch — webtool đang tải về để gửi xuống.');
  try {
    addLog('Máy chưa có dữ liệu hiển thị (font + âm lịch) — đang gửi xuống…');
    const r = await fetch('OTA%20firmware/4_2/asset.bin?v=' + Date.now());
    if (!r.ok) { addLog('Không tải được asset.bin'); return; }
    const raw = new Uint8Array(await r.arrayBuffer());
    if (raw.length < 16 || raw[0] !== 0x45 || raw[1] !== 0x50) { addLog('asset.bin hỏng'); return; }
    const body = raw.subarray(16);              // bỏ header, máy tự dựng lại
    const crc = crc32(body);

    const rdy = waitAsset(8000);                // máy xóa 3 sector rồi mới báo
    if (!await write(EpdCmd.ASSET, [0x00, body.length & 0xFF, body.length >> 8])) return;
    if (await rdy !== 'asset=rdy') { addLog('Máy không mở được vùng dữ liệu.'); return; }

    const mtu = parseInt(document.getElementById('mtusize').value) || 20;
    const step = Math.max(16, mtu - 4);
    for (let off = 0; off < body.length; off += step) {
      if (!await write(EpdCmd.ASSET, [0x01, ...body.subarray(off, off + step)])) {
        addLog('Gửi dữ liệu hiển thị thất bại.');
        return;
      }
      syncOverlayStep('Đang gửi dữ liệu hiển thị…',
        'Bộ chữ tiếng Việt + bảng âm lịch (' + body.length + ' byte). Không tắt máy, không đóng trang.');
      syncOverlayProgress(off + step, body.length);
    }

    const fin = waitAsset(5000);
    await write(EpdCmd.ASSET, [0x02, crc & 0xFF, (crc >>> 8) & 0xFF, (crc >>> 16) & 0xFF, (crc >>> 24) & 0xFF]);
    const m = await fin;
    addLog(m.startsWith('asset=') && m !== 'asset=none' && m !== 'asset=err'
      ? 'Đã gửi xong dữ liệu hiển thị (' + body.length + ' byte) — thiết bị đang vẽ lại toàn màn hình, khoảng 30 giây.'
      : 'Máy không nhận được dữ liệu — thử kết nối lại.');
  } catch (e) {
    addLog('Gửi dữ liệu hiển thị lỗi: ' + e.message);
  } finally {
    assetBusy = false;
    syncOverlayHide();
  }
}

async function writeImage(data, step = 'bw') {
  const chunkSize = document.getElementById('mtusize').value - 2;
  const interleavedCount = document.getElementById('interleavedcount').value;
  const count = Math.ceil(data.length / chunkSize);
  let chunkIdx = 0;
  let noReplyCount = 0;  // 8 gói ĐẦU ép có xác nhận: thiết bị có thể còn
                         // bận (erase/abort render) — vào nhịp rồi mới thả

  for (let i = 0; i < data.length; i += chunkSize) {
    const currentTime = (new Date().getTime() - startTime) / 1000.0;
    const pct = ((100 * i) / data.length) >> 0;
    const stepName = step == 'bw' ? 'đen trắng' : 'màu';
    setStatus(`Khối ${stepName}: ${chunkIdx + 1}/${count} (${pct}%), thời gian: ${currentTime}s`);
    syncOverlayStep(`Đang truyền ảnh — lớp ${stepName}`,
      `Gói ${chunkIdx + 1}/${count}. Ảnh được chẻ nhỏ theo MTU rồi ghi thẳng vào khe ảnh trên thiết bị.`);
    syncOverlayProgress(i, data.length);
    const payload = [
      (step == 'bw' ? 0x0F : 0x00) | (i == 0 ? 0x00 : 0xF0),
      ...data.slice(i, i + chunkSize),
    ];
    const useReply = chunkIdx < 8 || noReplyCount <= 0;
    // gói lỗi: thử lại MỘT lần bằng gói có xác nhận rồi mới bỏ cuộc — trước
    // đây một gói rơi là ảnh hỏng trong im lặng
    let ok = await write(EpdCmd.WRITE_IMG, payload, useReply);
    // gói lỗi: NGHỈ cho thiết bị thở rồi thử lại bằng gói có xác nhận,
    // tối đa 2 lần — độ bền ưu tiên hơn tốc độ (yêu cầu user)
    if (!ok) { await sleep(250); ok = await write(EpdCmd.WRITE_IMG, payload, true); }
    if (!ok) { await sleep(500); ok = await write(EpdCmd.WRITE_IMG, payload, true); }
    if (!ok) {
      addLog(`Truyền ảnh thất bại ở khối ${chunkIdx + 1}/${count} — hãy bấm gửi lại.`);
      return false;
    }
    noReplyCount = useReply ? interleavedCount : noReplyCount - 1;
    chunkIdx++;
  }
  return true;
}


// «Chữ đậm»: cho MÀN thuộc lô in mực đen nhạt — firmware ép nhiệt độ 0°C khi
// làm mới toàn màn (waveform khung dài hơn -> đen đậm hơn, làm mới chậm hơn
// chút). Lưu theo thiết bị; màn bình thường không cần bật.
async function setDarkBoost() {
  const chk = document.getElementById('darkBoostCHK');
  const enabled = chk.checked ? 1 : 0;
  if (await write(EpdCmd.DARK_BOOST, [enabled])) {
    addLog(enabled
      ? 'Đã bật «Chữ đậm» — thiết bị vẽ lại ngay; nét đen sẽ đậm hơn, làm mới chậm hơn một chút.'
      : 'Đã tắt «Chữ đậm».');
  } else {
    chk.checked = !chk.checked;
  }
}

// Hiển thị pin (fw >= 1.9): 0 chỉ icon, 1 phần trăm, 2 điện áp — lưu theo
// thiết bị, máy vẽ lại ngay khi đổi
// «Định dạng giờ» (0x2A): 0 = 24h, 1 = 12h — radio bị mờ khi firmware chưa
// hỗ trợ (gate __fwTimeOk đặt trong handler fw=)
async function setTimeFmt() {
  const sel = document.querySelector('input[name="timeFmt"]:checked');
  const v = sel ? parseInt(sel.value) : 0;
  if (!window.__fwTimeOk) {
    // như setBattStyle: không chặn cứng — chưa chắc do máy cũ, có thể chỉ là
    // chưa nhận 'fw='; firmware cũ sẽ bỏ qua lệnh 0x2A vô hại
    addLog('(Chưa rõ phiên bản thiết bị — vẫn gửi lệnh; firmware cũ hơn sẽ bỏ qua.)');
  }
  if (await write(EpdCmd.TIME_FMT, [v])) {
    addLog('Đã đặt định dạng giờ: ' + (v === 1 ? '12 giờ' : '24 giờ') + '.');
  }
}

async function setBattStyle() {
  const sel = document.querySelector('input[name="battStyle"]:checked');
  const style = sel ? parseInt(sel.value) : 2;
  // KHÔNG chặn cứng theo atLeast: vài giây đầu sau kết nối thiết bị chưa kịp
  // khai 'fw=' — chặn sẽ từ chối nhầm cả máy mới (đã gặp trên v2.1). Firmware
  // cũ nhận lệnh lạ sẽ bỏ qua vô hại; radio vẫn bị mờ khi biết rõ máy quá cũ.
  if (!FwCheck.atLeast('1.9')) {
    addLog('(Chưa rõ phiên bản thiết bị — vẫn gửi lệnh; firmware cũ hơn v1.9 sẽ bỏ qua.)');
  }
  if (await write(EpdCmd.BATT_STYLE, [style])) {
    addLog('Đã đặt hiển thị pin: ' + (style === 0 ? 'chỉ icon' : style === 1 ? 'phần trăm' : 'điện áp') + '.');
  }
}

// ---- Nhịp làm mới của màn 4 MÀU (cùng lệnh 0x23, ba giá trị) ----
// Mọi lượt làm mới của panel 4 màu đều chớp ~15s (kể cả lượt "nhảy phút"
// chỉ quét ô số phút), nên cho chọn: 1 = nhảy phút + full mỗi giờ (mặc
// định, không tích ô nào), 2 = chỉ full mỗi giờ, 3 = chỉ full lúc 00:00.
// KHÔNG dùng số 0 (nghĩa cũ của bản BWR): máy 4 màu đời trước v3.2 có thể
// đang lưu 0 trong flash, firmware >= 3.3 coi 0 là "mặc định" để những máy
// đó không tự dưng đứng phút. Hai ô loại trừ nhau; fw màn 4 màu cần >= 3.3.
let refreshModeLast = 1;

function applyRefreshModeUI(v) {
  if (v !== 2 && v !== 3) v = 1;  // 0 / 0xFF / lạ = mặc định (khớp firmware)
  refreshModeLast = v;
  const h = document.getElementById('onlyHourlyCHK');
  const d = document.getElementById('onlyMidnightCHK');
  if (h) h.checked = (v === 2);
  if (d) d.checked = (v === 3);
}

async function setRefreshMode(which) {
  const h = document.getElementById('onlyHourlyCHK');
  const d = document.getElementById('onlyMidnightCHK');
  if (which === 'hour' && h.checked) d.checked = false;   // loại trừ nhau
  if (which === 'day' && d.checked) h.checked = false;
  const v = d.checked ? 3 : (h.checked ? 2 : 1);
  if (await write(EpdCmd.SET_HOURLY_FULL, [v])) {
    refreshModeLast = v;
    addLog(v === 3
      ? 'Đã đặt: chỉ làm mới lúc 00:00 — màn đứng yên cả ngày (đồng hồ sẽ đứng ở 00:00).'
      : v === 2
        ? 'Đã đặt: chỉ làm mới mỗi giờ — không nhảy phút nữa (đồng hồ hiện HH:00).'
        : 'Đã đặt: nhảy phút + làm mới toàn màn mỗi giờ (mặc định).');
  } else {
    applyRefreshModeUI(refreshModeLast);  // gửi thất bại: trả UI về trạng thái cũ
  }
}

async function setHourlyFull() {
  const chk = document.getElementById('hourlyFullCHK');
  const enabled = chk.checked ? 1 : 0;
  if (await write(EpdCmd.SET_HOURLY_FULL, [enabled])) {
    // (màn 4 màu không dùng ô này — nó có hàng «Nhịp làm mới» riêng)
    addLog(enabled
      ? "Đã bật: làm mới toàn màn hình mỗi giờ (chế độ đồng hồ)."
      : "Đã tắt: chỉ làm mới toàn màn hình lúc 00:00 (bóng mờ có thể tích tụ trong ngày).");
  } else {
    chk.checked = !chk.checked; // gửi thất bại: trả checkbox về trạng thái cũ
  }
}


function convertUC8159(blackWhiteData, redWhiteData) {
  const halfLength = blackWhiteData.length;
  let payloadData = new Uint8Array(halfLength * 4);
  let payloadIdx = 0;
  let black_data, color_data, data;
  for (let i = 0; i < halfLength; i++) {
    black_data = blackWhiteData[i];
    color_data = redWhiteData[i];
    for (let j = 0; j < 8; j++) {
      if ((color_data & 0x80) == 0x00) data = 0x04;  // red
      else if ((black_data & 0x80) == 0x00) data = 0x00;  // black
      else data = 0x03;  // white
      data = (data << 4) & 0xFF;
      black_data = (black_data << 1) & 0xFF;
      color_data = (color_data << 1) & 0xFF;
      j++;
      if ((color_data & 0x80) == 0x00) data |= 0x04;  // red
      else if ((black_data & 0x80) == 0x00) data |= 0x00;  // black
      else data |= 0x03;  // white
      black_data = (black_data << 1) & 0xFF;
      color_data = (color_data << 1) & 0xFF;
      payloadData[payloadIdx++] = data;
    }
  }
  return payloadData;
}

// Option driver dang chon — NULL-SAFE (bay da gap o webtool 7.3" va 10.2"):
// select khong co muc nao duoc chon -> selectedIndex -1 -> undefined
// .getAttribute nem TypeError NGAY DAU sendimg/updateDitcherOptions nen nut
// «Gửi ảnh» chet im lang. Thieu lua chon thi lay muc dau.
function getDriverOption() {
  const sel = document.getElementById('epddriver');
  if (!sel) return null;
  return sel.options[sel.selectedIndex] || sel.options[0] || null;
}

async function sendimg(slot = 0) {
  if (cropManager.isCropMode()) {
    alert("Vui lòng hoàn tất cắt ảnh trước! Đã hủy gửi.");
    return false;
  }

  // 3 khe ảnh cần firmware >= 1.5; đời cũ chỉ hiển thị được (không lưu khe)
  const slotCapable = FwCheck.atLeast('1.5');
  // khe 4,5 (chỉ số 3,4) và hai khe NỀN (5,6) chỉ có từ BWR v2.7 / 4 màu v3.7
  if (slot > 2 && !fwHasNewSlots()) {
    alert('Máy chưa hỗ trợ khe này — cần firmware 4.2" ba màu từ v2.7, bốn màu từ v3.7.');
    return false;
  }
  if (!slotCapable && slot > 0) {
    if (!confirm('Firmware của thiết bị chưa hỗ trợ 3 khe ảnh (cần v1.5). Ảnh sẽ chỉ hiển thị, không lưu vào khe. Tiếp tục?')) return false;
  }

  const canvasSize = document.getElementById('canvasSize').value;
  const ditherMode = document.getElementById('ditherMode').value;
  const selectedOption = getDriverOption();
  const drvSize = selectedOption ? selectedOption.getAttribute('data-size') : canvasSize;
  const drvColor = selectedOption ? selectedOption.getAttribute('data-color') : ditherMode;
  // mã driver đang chọn ("02", "08"…). PHẢI lấy từ đây: biến epdDriverSelect
  // đã bị xoá khi thay bằng getDriverOption() nhưng vài chỗ dưới còn gọi tên
  // cũ -> ReferenceError giữa lượt gửi, lượt gửi chết IM LẶNG (không catch).
  const drvId = selectedOption ? selectedOption.value : '';

  if (drvSize !== canvasSize) {
    if (!confirm("Cảnh báo: kích thước canvas không khớp driver, tiếp tục?")) return false;
  }
  if (drvColor !== ditherMode) {
    if (!confirm("Cảnh báo: chế độ màu không khớp driver, tiếp tục?")) return false;
  }

  // Máy vừa cập nhật OTA tự được gửi blob font/âm lịch ngay lúc kết nối
  // (asset=none). Đó là hàng TRĂM gói trên cùng một characteristic: bấm «Gửi
  // ảnh» lúc ấy thì lệnh mở khe nằm xếp hàng SAU cả luồng đó, màn hình đứng ở
  // «Đang chuẩn bị khe…» rất lâu như bị treo. Chờ cho xong rồi mới gửi.
  if (assetBusy) {
    setStatus('Đang nạp dữ liệu hiển thị cho máy — chờ xong rồi gửi ảnh…');
    addLog('Hoãn gửi ảnh: đang nạp dữ liệu hiển thị (font + âm lịch) cho máy.');
    while (assetBusy) await new Promise(r => setTimeout(r, 300));
  }

  startTime = new Date().getTime();
  window.__imgSending = true;  // chặn retry fw= ghi lại CCCD giữa phiên gửi
  // Lớp phủ chặn thao tác suốt lượt gửi: một tấm ảnh là hàng trăm gói, bấm
  // nút khác giữa chừng là lệnh chen vào luồng và máy nhận nhầm.
  syncOverlayShow('Đang chuẩn bị gửi ảnh…',
    'Đang dựng dữ liệu ảnh cho khe ' + (slot + 1) + '. Vui lòng không tắt máy và không đóng trang.');
  try {
  const status = document.getElementById("status");
  status.parentElement.style.display = "block";

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const processedData = processImageData(imageData, ditherMode);

  updateButtonStatus(true);

  // chờ thiết bị báo 'mtu=…' sau INIT rồi mới chọn cỡ gói (hết cảnh gói 18B)
  const mtuReady = waitMtuNotify(1500);
  await write(EpdCmd.INIT);
  await mtuReady;

  // mở khe: thiết bị xóa 32KB flash của khe (~1s) rồi tee ảnh vào đó.
  // fw >= 1.6 báo 'img=rdy' khi xóa xong — PHẢI đợi rồi mới stream: bắn gói
  // trong lúc erase là gói dồn đống cạn MSG heap BLE -> thiết bị reset (v1.5)
  if (slotCapable) {
    setStatus(`Đang chuẩn bị khe ${slot + 1} (xóa flash)…`);
    syncOverlayStep(`Đang chuẩn bị khe ${slot + 1}…`,
      'Thiết bị đang xóa vùng nhớ 32 KB của khe này. Mất khoảng một giây, chưa truyền ảnh.');
    const rdyWait = FwCheck.atLeast('1.6') ? waitImgRdy(8000) : null;
    if (!await write(EpdCmd.IMG_SLOT, [0x01, slot])) {
      imgRdyResolve = null;
      setStatus('Không mở được khe ảnh — thử lại.');
      updateButtonStatus();
      return false;
    }
    addLog(`Đã gửi lệnh mở khe ${slot + 1}, đợi thiết bị báo xóa xong…`);
    if (rdyWait && !await rdyWait) {
      setStatus('Không mở được khe ảnh (thiết bị không báo sẵn sàng) — thử lại.');
      addLog('Thiết bị không báo «img=rdy» sau 8 giây.');
      updateButtonStatus();
      return false;
    }
  }

  let ok = true;
  if (ditherMode === 'threeColor') {
    const halfLength = Math.floor(processedData.length / 2);
    const blackWhiteData = processedData.slice(0, halfLength);
    const redWhiteData = processedData.slice(halfLength);
    if (drvId === '08' || drvId === '09') {
      ok = await writeImage(convertUC8159(blackWhiteData, redWhiteData), 'bw');
    } else {
      ok = await writeImage(blackWhiteData, 'bw');
      if (ok) ok = await writeImage(redWhiteData, 'red');
    }
  } else if (ditherMode === 'blackWhiteColor') {
    if (drvId === '08' || drvId === '09') {
      const emptyData = new Uint8Array(processedData.length).fill(0xFF);
      ok = await writeImage(convertUC8159(processedData, emptyData), 'bw');
    } else {
      ok = await writeImage(processedData, 'bw');
    }
  } else if (ditherMode === 'fourColor' || ditherMode === 'sixColor') {
    ok = await writeImage(processedData, 'bw');
  } else {
    addLog("Firmware không hỗ trợ chế độ màu này.");
    updateButtonStatus();
    return false;
  }

  if (!ok) {
    // KHÔNG refresh ảnh dở dang; thiết bị tự mở lại minute tick khi mất kết
    // nối hoặc khi lần gửi sau thành công
    setStatus('Truyền ảnh thất bại — chưa làm mới màn hình.');
    updateButtonStatus();
    return false;
  }

  // chốt khe (ghi trailer hợp lệ) TRƯỚC khi làm mới màn
  if (slotCapable) {
    if (await write(EpdCmd.IMG_SLOT, [0x02])) {
      imgSlotMask |= (1 << slot);
      updateImgAutoUI();
      addLog(`Đã lưu ảnh vào khe ${slot + 1} trên thiết bị.`);
    }
  }

  syncOverlayStep('Đang làm mới màn hình…',
    'Đã nhận đủ ảnh. Màn hình e-ink vẽ lại mất khoảng 30 giây — đừng tắt nguồn lúc này.');
  await write(EpdCmd.REFRESH);
  updateButtonStatus();

  const sendTime = (new Date().getTime() - startTime) / 1000.0;
  addLog(`Gửi xong! Thời gian: ${sendTime}s`);
  setStatus(`Gửi xong! Thời gian: ${sendTime}s`);
  addLog("Vui lòng không thao tác cho đến khi màn hình làm mới xong.");
  setTimeout(() => {
    status.parentElement.style.display = "none";
  }, 5000);
  return true;
  } catch (e) {
    // Trước đây khối này CHỈ có finally: một ReferenceError giữa lượt gửi
    // (ví dụ biến epdDriverSelect đã bị xoá) làm cả lượt chết IM LẶNG —
    // thanh trạng thái đứng nguyên ở bước dở dang, nút thì khoá luôn.
    console.error(e);
    const m = (e && e.message) ? e.message : String(e);
    addLog('Lỗi khi gửi ảnh: ' + m);
    setStatus('Gửi ảnh lỗi: ' + m + ' — hãy tải lại trang rồi thử lại.');
    updateButtonStatus();
    return false;
  } finally { window.__imgSending = false; syncOverlayHide(); }
}


function updateButtonStatus(forceDisabled = false) {
  const connected = gattServer != null && gattServer.connected;
  const status = forceDisabled ? 'disabled' : (connected ? null : 'disabled');
  // mode selection KHÔNG còn đòi [Sync time] trước: lệnh chọn giao diện
  // (0x02) tự mang timestamp nên thiết bị luôn nhận được giờ đúng. Gate cũ
  // từng khóa chết người dùng khi mode ĐANG LƯU trên máy bị lỗi render
  // (7.5" rst=P4): bấm Sync time là máy vẽ lại mode lỗi và reset ngay,
  // không có cách nào thoát sang mode khác.
  const modeStatus = status;
  // KHÔNG liệt kê id nút giao diện ở đây nữa. Gallery do mode_preview.js dựng
  // ĐỘNG từ MODE_LIST, mà MODE_LIST thì thay đổi theo firmware (mode 2 và 18
  // đã bỏ) — danh sách id cứng lệch một cái là getElementById trả null, ném
  // lỗi NGAY TRONG body.onload và giết cả lượt dựng giao diện («Lỗi tải giao
  // diện: Cannot set properties of null»). Quét thẳng nút trong #modeGallery
  // thì luôn khớp, thêm/bớt mode không phải sửa gì ở đây.
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.disabled = v; };
  set("reconnectbutton", (gattServer == null || gattServer.connected) ? 'disabled' : null);
  ["synctimebutton", "sendcmdbutton", "uploadlayoutbutton", "sendnotebutton", "clearscreenbutton",
   "sendimgbutton", "sendimgbutton2", "sendimgbutton3", "setDriverbutton", "otabutton"]
    .forEach(id => set(id, status));
  document.querySelectorAll('#modeGallery button').forEach(b => { b.disabled = modeStatus; });
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
    try {
      // debug mode (?debug=true): list all BLE devices, useful to check
      // whether the board advertises the EPD service UUID at all
      const debugMode = new URLSearchParams(window.location.search).get('debug') === 'true';
      bleDevice = await navigator.bluetooth.requestDevice({ // ?debug=true vẫn LỌC THEO TÊN thiết bị (yêu cầu user) — hết acceptAllDevices
        filters: BLE_REQUEST_FILTERS,
        optionalServices: [EPD_SERVICE],
      });
    } catch (e) {
      console.error(e);
      if (e.name === 'NotFoundError') {
        addLog("Không tìm thấy thiết bị E-Ink 4.2\" (tên DIY-4_2-xxxx)");
      } else if (e.message) {
        addLog("requestDevice: " + e.message);
      }
      addLog("Kiểm tra Bluetooth đã bật và trình duyệt hỗ trợ Web Bluetooth! Khuyên dùng:");
      addLog("• Máy tính: Chrome/Edge");
      addLog("• Android: Chrome/Edge");
      addLog("• iOS: trình duyệt Bluefy");
      return;
    }

    await bleDevice.addEventListener('gattserverdisconnected', disconnect);
    await connect();
  }
}


function handleNotify(value, idx) {
  const data = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (idx == 0) {
    addLog(`Nhận cấu hình: ${bytes2hex(data)}`);
    const epdpins = document.getElementById("epdpins");
    const epddriver = document.getElementById("epddriver");
    epdpins.value = bytes2hex(data.slice(0, 7));
    if (data.length > 10) epdpins.value += bytes2hex(data.slice(10, 11));
    // Driver may dang luu (byte 7): may tung nap firmware khac con giu model
    // cu, gia tri do KHONG co trong select nen gan thang se lam select mat
    // lua chon (selectedIndex -1) va moi thao tac doc option sau do nem loi.
    const drvHex = bytes2hex(data.slice(7, 8));
    if ([...epddriver.options].some(o => o.value === drvHex)) {
      epddriver.value = drvHex;
    } else {
      addLog(`⚠ Thiết bị báo driver "${drvHex}" không thuộc máy này — giữ lựa chọn hiện tại. ` +
        `Bấm «Áp dụng» ở mục Driver để ghi lại driver đúng cho máy.`);
    }
    updateDitcherOptions();
    // config byte 11 = current display mode: highlight it in the gallery
    if (data.length > 11) {
      // config trả SỐ CỦA MÁY; quy về số thẻ để tô đúng ô đang chọn
      deviceMode = modeFromWire(data[11]);
      if (typeof highlightMode === 'function') highlightMode(deviceMode);
    }
    // clock cleanup cadence (1 = full refresh hourly; 0xFF -> enabled):
    // byte 205 on current firmware (192-byte note field) or byte 109 on
    // older firmware (96-byte note field)
    const hf = data.length > 205 ? data[205] : (data.length > 109 ? data[109] : null);
    if (hf !== null) {
      const c = document.getElementById('hourlyFullCHK');
      if (c) c.checked = hf !== 0;
      // màn 4 màu: cùng byte này mang BA giá trị 1/2/3 (xem setRefreshMode)
      applyRefreshModeUI(hf);
    }
    // 3 khe ảnh (fw >= 1.5): auto/interval/mask tại offset 212/213/214 (sau
    // u32 activation ở 208 — struct căn 4 byte)
    if (data.length >= 216) {
      const auto = data[212], itv = data[213];
      // 7 khe (5 ảnh + 2 nền «Tự thiết kế») nên mask hợp lệ tới 0x7F. Ngưỡng
      // cũ là 7: máy đã dùng từ khe 4 trở lên báo mask > 7 và bị coi là RỖNG.
      imgSlotMask = (data[214] <= 0x7F) ? data[214] : 0;
      document.getElementById('imgAutoCHK').checked = auto === 1;
      const r = document.querySelector(`input[name="imgInterval"][value="${itv}"]`);
      if (r) r.checked = true;
      updateImgAutoUI();
    }
    // «Chữ đậm» (màn lô in nhạt) tại offset 216
    if (data.length > 216) {
      document.getElementById('darkBoostCHK').checked = data[216] === 1;
    }
    // «Hiển thị pin» (fw >= 1.9) tại offset 217: 0 icon / 1 % / 2 điện áp
    if (data.length > 217 && data[217] <= 2) {
      const rb = document.querySelector(`input[name="battStyle"][value="${data[217]}"]`);
      if (rb) rb.checked = true;
    }
  } else {
    if (textDecoder == null) textDecoder = new TextDecoder();
    const msg = textDecoder.decode(data);
    addLog(msg, '⇓');
    if (msg.startsWith('mtu=') && msg.length > 4) {
      const mtuSize = parseInt(msg.substring(4));
      document.getElementById('mtusize').value = mtuSize;
      addLog(`MTU cập nhật: ${mtuSize}`);
      if (mtuNotifyResolve) { mtuNotifyResolve(); mtuNotifyResolve = null; }
    } else if (msg.startsWith('t=') && msg.length > 2) {
      const deviceEpoch = parseInt(msg.substring(2));
      const t = deviceEpoch + new Date().getTimezoneOffset() * 60;
      addLog(`Giờ thiết bị: ${new Date(t * 1000).toLocaleString()}`);
      addLog(`Giờ máy tính: ${new Date().toLocaleString()}`);
      // Below this epoch (2025-01-31, same threshold as the firmware) the
      // device clock is the unsynced boot default and the screen shows the
      // "sync the time" banner. No automatic sync: the user presses the
      // [Sync time] button; the mode gallery stays disabled until the
      // device clock is valid.
      if (deviceEpoch >= 1738281600) {
        timeSynced = true;
      } else {
        addLog("Đồng hồ thiết bị chưa được đồng bộ — bấm «Sync time», hoặc chọn thẳng một giao diện (lệnh chọn giao diện tự gửi kèm ngày giờ).");
      }
      updateButtonStatus();
    } else if (msg.startsWith('asset=')) {
      // Vùng dữ liệu ở flash (bảng âm lịch tách khỏi firmware để trả RAM).
      // 'asset=none' = máy chưa có blob — hay gặp ở máy vừa cập nhật qua OTA
      // vì OTA chỉ ghi bank firmware. Tự gửi luôn, khách không phải làm gì.
      if (assetResolve) { const f = assetResolve; assetResolve = null; f(msg); }
      else if (msg === 'asset=none') sendAsset();
    } else if (msg.startsWith('tkb=')) {
      // thời khóa biểu: 'tkb=rdy' (xóa sector xong, được bắn mảnh) / 'tkb=err'
      // / 'tkb=done' — js/4_2/timetable.js đang đợi
      if (window.ttOnMsg) window.ttOnMsg(msg);
    } else if (msg.startsWith('img=') && imgRdyResolve) {
      // trả lời lệnh mở khe ảnh: 'img=rdy' (xóa flash xong) / 'img=err'
      const f = imgRdyResolve; imgRdyResolve = null; f(msg === 'img=rdy');
    } else if (msg.startsWith('fw=') && msg.length > 3) {
      FwCheck.report(msg.substring(3));
      window.__fwStr = msg.substring(3);   // để báo lỗi cho rõ ở nơi khác
      window.__devNm = (bleDevice && bleDevice.name) || '';
      // khu «Tự động đổi ảnh» chỉ hiện khi firmware hỗ trợ 3 khe (>= 1.5)
      if (FwCheck.atLeast('1.5')) {
        document.getElementById('imgAutoRow').style.display = '';
        updateImgAutoUI();
      }
      // giao diện v1.7 (chữ đậm/đỏ, số 12-3-6-9 đỏ, bỏ mode 2 & 18, hắc đạo):
      // preview mới CHỈ hiện khi firmware thiết bị khớp — máy cũ giữ preview cũ
      window.__fw17 = FwCheck.atLeast('1.7');
      // mode «Lịch dương + âm» (card 13, id 14) thay Đếm ngược: BWR cần fw
      // >= 2.0; bản BỐN MÀU (DIY-4_2C, đánh số 2.x riêng) cần >= 2.9
      const devNm = (bleDevice && bleDevice.name) || '';
      // Màn 7.5" 640x384: tên MỚI 'DIY-7_5-' và tên CŨ 'DIY-7_5V-' là CÙNG
      // một dòng máy (đổi tên ở firmware v1.0). Regex có 'V?' + gạch nối nên
      // KHÔNG chạm DIY-7_5B / DIY-7_5R. Nhánh CC2640 cũ đã bỏ hẳn.
      const is7_5 = /^DIY-7_5V?-/.test(devNm);
      window.__fwCal = is7_5 ? false   // 7.5" chua co mode nay
        : FwCheck.atLeast(devNm.indexOf('DIY-4_2C') === 0 ? '2.9' : '2.0');
      // «Định dạng giờ» 12h/24h: BWR >= 2.1, 4 màu >= 3.0, 7.5" >= 0.3
      window.__fwTimeOk = FwCheck.atLeast(devNm.indexOf('DIY-4_2C') === 0 ? '3.0'
        : is7_5 ? '0.3' : '2.1');
      // icon «Tự thiết kế» 2 mặt (đen + ĐỎ): chỉ màn BA MÀU — 4.2" BWR >= 2.3,
      // 7.5" >= 0.5. Bản 4 MÀU (DIY-4_2C) chưa có.
      // ẢNH NỀN toàn màn cho «Tự thiết kế» (dùng lại khe ảnh 32KB): 4.2" BA
      // MÀU từ v2.3, 4.2" BỐN MÀU từ v3.4. Hai dải 2.x chồng nhau nên phải
      // gate theo TÊN BLE. Bản 7.5" chưa có.
      const is4c = devNm.indexOf('DIY-4_2C') === 0;
      window.__fwBg = !is7_5 && FwCheck.atLeast(is4c ? '3.4' : '2.3');
      // «Thời khóa biểu» (mode 24): BWR >= 2.5, bốn màu >= 3.6. Bảng do người
      // dùng gõ nên KHÔNG hiện mục này với máy chưa hiểu lệnh 0x2D (gõ xong
      // mới biết không gửi được thì rất ức chế).
      window.__fwTKB = !is7_5 && FwCheck.atLeast(is4c ? '3.6' : '2.5');
      if (window.ttFwUpdate) window.ttFwUpdate();
      // 5 khe ảnh + 2 khe nền riêng cho «Tự thiết kế» (BWR 2.7 / 4 màu 3.7)
      IMG_SLOTS = fwHasNewSlots() ? 5 : 3;
      for (let i = 4; i <= 5; i++) {
        const b = document.getElementById('sendimgbutton' + i);
        if (b) b.style.display = IMG_SLOTS >= i ? '' : 'none';
      }
      const bgRow = document.getElementById('dsBgRow');
      if (bgRow) bgRow.style.display = fwHasNewSlots() ? '' : 'none';
      // «Thêm ảnh vào thiết kế» là nút của thời MỘT thiết kế: nó tự đoán xem
      // máy nhận được ảnh nền hay chỉ nhận icon. Có hai nút «Làm nền Thiết kế
      // 1/2» rồi thì nó chỉ làm nền cho thiết kế đang chọn — thừa và dễ nhầm.
      // Vẫn giữ cho firmware CŨ (một thiết kế, hoặc chỉ nhận icon).
      const bgOld = document.getElementById('dsBgOldRow');
      if (bgOld) bgOld.style.display = fwHasNewSlots() ? 'none' : '';
      // «Chữ 3..6», «Thứ», «Ngày dương» chỉ có từ BWR v2.8 / 4 màu v3.8 —
      // máy cũ chỉ hai ô chữ, hiện ra thì người dùng xếp xong mới biết không gửi được
      const six = fwHasSixText();
      document.querySelectorAll('.dsTextExtra').forEach(e => { e.style.display = six ? '' : 'none'; });
      const dRow = document.getElementById('dsDesignRow');
      if (dRow) dRow.style.display = fwHasNewSlots() ? '' : 'none';
      if (typeof updateImgAutoUI === 'function') updateImgAutoUI();
      // mode 21+22 (Núi tuyết, Hoàng hôn) chỉ BỊ GỠ ở nhánh BA MÀU v2.3 để
      // lấy RAM cho ảnh nền; bản BỐN MÀU v3.4 lấy RAM từ đệm trang nên VẪN
      // CÒN hai chế độ này -> không dùng chung cờ __fwBg như trước.
      // Bản 3 màu gỡ «Núi tuyết»/«Hoàng hôn» ở v2.3 rồi THÊM LẠI ở v2.6 (đủ RAM
      // sau khi đưa font xuống flash). Chỉ ẩn hai thẻ đó ở khoảng giữa.
      window.__fwNoRetro = !is7_5 && !is4c && FwCheck.atLeast('2.3') && !FwCheck.atLeast('2.4');
      if (window.refreshModeGallery) window.refreshModeGallery();
      window.__fwIconRed = is7_5 ? FwCheck.atLeast('0.5')
        : (devNm.indexOf('DIY-4_2C') === 0) ? false
        : FwCheck.atLeast('2.3');
      // «Nhịp làm mới»: BWR/7.5" vẫn dùng ô hourly_full cũ (có từ lâu); bản
      // BỐN MÀU (DIY-4_2C) chỉ nghe ba giá trị của lệnh 0x23 từ v3.3 —
      // firmware cũ hơn nhận byte nhưng bỏ qua, nên khóa 2 ô cho khỏi hiểu lầm
      {
        const ok4c = devNm.indexOf('DIY-4_2C') !== 0 || FwCheck.atLeast('3.3');
        ['onlyHourlyCHK', 'onlyMidnightCHK'].forEach(id => {
          const e = document.getElementById(id);
          if (e) e.disabled = !ok4c;
        });
        const rh = document.getElementById('refreshModeHint');
        if (rh && !ok4c) rh.textContent = 'Cần firmware màn 4 màu ≥ 3.3 — hãy cập nhật ở mục OTA bên dưới.';
      }
      {
        document.querySelectorAll('input[name="timeFmt"]').forEach(r => { r.disabled = !window.__fwTimeOk; });
        const th = document.getElementById('timeFmtHint');
        if (th && window.__fwTimeOk) th.textContent = 'Thiết bị vẽ lại ngay khi đổi.';
      }
      if (window.refreshModeGallery) window.refreshModeGallery();
      // «Hiển thị pin» cần fw >= 1.9 — máy cũ mờ radio + giữ hint nhắc cập nhật
      {
        const ok19 = FwCheck.atLeast('1.9');
        document.querySelectorAll('input[name="battStyle"]').forEach(r => { r.disabled = !ok19; });
        const h = document.getElementById('battStyleHint');
        if (h) h.textContent = ok19 ? 'Thiết bị vẽ lại ngay khi đổi.' : 'Cần firmware ≥ 1.9 — hãy cập nhật ở mục OTA bên dưới.';
      }
    }
  }
}


async function connect() {
  if (bleDevice == null || epdCharacteristic != null) return;
  // đời cũ không tự khai coi như 1.3.1; kèm tên thiết bị để popup nhắc
  // tối đa 1 lần/ngày cho mỗi máy. Màn 7.5" (DIY-7_5- và tên cũ
  // DIY-7_5V-) không so với bảng firmware 4.2" — khỏi nhắc
  // cập nhật nhầm (bảng «Danh sách firmware» hiện chỉ có file 4.2").
  const is75 = bleDevice && bleDevice.name && /^DIY-7_5V?-/.test(bleDevice.name);
  if (!is75) FwCheck.reset('1.3.1', bleDevice && bleDevice.name);

  try {
    addLog("Đang kết nối: " + bleDevice.name);
    gattServer = await connectGattWithRetry(bleDevice);
    addLog('  Đã tìm thấy GATT Server');
    epdService = await gattServer.getPrimaryService(EPD_SERVICE);
    addLog('  Đã tìm thấy EPD Service');
    epdCharacteristic = await epdService.getCharacteristic('62750002-d828-918d-fb46-b6c11c675aec');
    addLog('  Đã tìm thấy Characteristic');
  } catch (e) {
    console.error(e);
    logBleConnectHelp(e);
    disconnect();
    return;
  }

  try {
    const versionCharacteristic = await epdService.getCharacteristic('62750003-d828-918d-fb46-b6c11c675aec');
    const versionData = await versionCharacteristic.readValue();
    appVersion = versionData.getUint8(0);
    addLog(`Phiên bản firmware: 0x${appVersion.toString(16)}`);
  } catch (e) {
    console.error(e);
    appVersion = 0x15;
  }

  // is75: cả hai bản 7.5" đánh số APP_VERSION riêng từ 0x01 (không có đời
  // EPD-nRF5 cũ) — ngưỡng 0x16 của dòng 4.2" không áp dụng, khỏi báo nhầm
  if (appVersion < 0x16 && !is75) {
    const oldURL = "https://tsl0922.github.io/EPD-nRF5/v1.5";
    alert("!!! Chú ý !!!\nPhiên bản firmware quá cũ, một số chức năng có thể không hoạt động. Nên cập nhật firmware.");
    if (confirm('Mở phiên bản web tool cũ?')) location.href = oldURL;
    setTimeout(() => {
      addLog(`Nếu gặp vấn đề, dùng web tool cũ: ${oldURL}`);
    }, 500);
  }

  try {
    // Gắn listener TRƯỚC khi bật notify: thiết bị bắn loạt mở màn (config,
    // mac=, act=, fw=) ngay khi CCCD được ghi — gắn sau là thua cuộc đua,
    // mất cả loạt (fw= mất -> popup nhắc cập nhật dù máy đã chạy bản mới).
    epdCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
      handleNotify(event.target.value, msgIndex++);
    });
    // stop -> start: ép ghi lại CCCD để firmware GỬI LẠI loạt mở màn kể cả
    // khi notify đã được bật từ trước (hub/connector); standalone thì stop
    // đầu tiên chỉ là no-op vô hại
    try { await epdCharacteristic.stopNotifications(); } catch (e) {}
    msgIndex = 0;  // loạt gửi lại bắt đầu bằng config (idx 0)
    await epdCharacteristic.startNotifications();
  } catch (e) {
    console.error(e);
    if (e.message) addLog("startNotifications: " + e.message);
  }

  await write(EpdCmd.INIT);

  // 'fw=' nằm CUỐI loạt notify mở màn — một số máy/điện thoại làm rơi gói
  // cuối (radio 12/24h + gallery mới không mở dù máy chạy bản mới). Chưa
  // nhận sau 1.2s thì ép thiết bị GỬI LẠI loạt bằng cách ghi lại CCCD
  // (stop -> start), tối đa 3 lần; biết version rồi thì thôi ngay.
  (async () => {
    for (let i = 0; i < 3; i++) {
      await sleep(1200);
      if (FwCheck.atLeast('0.0')) return;  // đã nhận fw= (deviceVer != null)
      if (window.__imgSending) return;     // đang gửi ảnh: cấm ghi lại CCCD
      if (!epdCharacteristic || !gattServer || !gattServer.connected) return;
      addLog('(Chưa nhận phiên bản firmware — yêu cầu thiết bị gửi lại...)');
      try {
        await epdCharacteristic.stopNotifications();
        msgIndex = 0;  // loạt gửi lại bắt đầu bằng config (idx 0)
        await epdCharacteristic.startNotifications();
      } catch (e) {
        console.error(e);
        return;
      }
    }
  })();

  // firmware <= 1.3.1 không gửi 'fw=' — sau 3s vẫn nhắc nếu bảng có bản mới
  if (!is75) FwCheck.schedule(3000);

  document.getElementById("connectbutton").innerHTML = 'Ngắt kết nối';
  updateButtonStatus();
}


// addLog() / clearLog(): js/log.js (dung chung ca hub lan cac app).
// Ban standalone trong EPD-DA14585/webtools/ van giu ban rieng cua no.


// ------- image transform state (reload / stretch / fit / rotate / pan) -------
let originalImage = null;  // the loaded source image (null after a manual crop)
let imgRotation = 0;       // degrees, multiples of 90
let imgScaleX = 1.0, imgScaleY = 1.0;
let imgOffsetX = 0, imgOffsetY = 0;  // pan offset in canvas pixels (drag to move)


function updateDitcherOptions() {
  const selectedOption = getDriverOption();
  if (!selectedOption) return;
  const colorMode = selectedOption.getAttribute('data-color');
  const canvasSize = selectedOption.getAttribute('data-size');

  if (colorMode) document.getElementById('ditherMode').value = colorMode;
  if (canvasSize) document.getElementById('canvasSize').value = canvasSize;

  // Màn 4 màu IST7158/JD79668 (driver 05/06, firmware epd_4_2inch_4c):
  // «chữ đậm» của bản BWR không áp dụng (ẩn), còn «làm mới mỗi giờ» thì CÓ
  // (fw 4 màu >= v3.2) — hiện kèm ghi chú nhịp cập nhật riêng của màn 4 màu
  const is4c = selectedOption.value === '05' || selectedOption.value === '06';
  const hfRow = document.getElementById('hourlyFullRow');
  const dbRow = document.getElementById('darkBoostRow');
  const hint = document.getElementById('fourColorHint');
  // màn 4 màu dùng hàng «Nhịp làm mới» 3 lựa chọn thay cho ô hourly_full 2
  // trạng thái của bản BWR (mọi lượt của màn 4 màu đều là full refresh)
  const rmRow = document.getElementById('refreshModeRow');
  if (hfRow) hfRow.style.display = is4c ? 'none' : '';
  if (rmRow) rmRow.style.display = is4c ? '' : 'none';
  if (dbRow) dbRow.style.display = is4c ? 'none' : '';
  if (hint) hint.style.display = is4c ? '' : 'none';

  // gallery preview vẽ điểm nhấn VÀNG khi driver là màn 4 màu — vẽ lại
  if (window.refreshModeGallery) window.refreshModeGallery();

  updateCanvasSize(); // always update image
}

// ------- OTA firmware qua BLE (0xA0/A2/A3/A4 — như webtool 2_13inch) -------
// Khác bản 2.13": kích thước firmware trong lệnh 0xA0 là u32 LE tại offset 2
// (firmware 4.2" ~76KB vượt giới hạn u16); firmware epd_4_2inch đọc đúng dạng này.


// Nút «Cài ngay» trong bảng «Danh sách firmware»: tải file .bin cùng origin
// rồi chạy thẳng luồng OTA — khách không cần tải về máy rồi chọn file thủ công.
async function fwInstallRow(btn) {
  const tr = btn.closest('tr');
  const link = tr && tr.querySelector('a[download]');
  if (!link) { addLog('Hàng này không có file firmware để cài.'); return; }
  if (!epdCharacteristic) { addLog('Chưa kết nối thiết bị — bấm «Kết nối» rồi thử lại.'); return; }
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
  if (!epdCharacteristic) {
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

  // tìm magic phiên bản (epd_version[] trong user_app.c: 79 13 a5 f9 86 ec 5a 06 + version 4B)
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
  syncOverlayShow('Đang chuẩn bị nâng cấp firmware…',
    'TUYỆT ĐỐI không tắt nguồn thiết bị và không đóng trang trong suốt quá trình.');
  const btn = document.getElementById('otabutton');
  btn.disabled = 'disabled';
  try {
    // 0xA0: bắt đầu — firmware xoá bank không hoạt động (kích thước u32 LE)
    const buf = new Uint8Array(136);
    const dv = new DataView(buf.buffer);
    buf[0] = 0xa0; buf[1] = 0x00;
    dv.setUint32(2, firmSize, true);
    show('Đang xoá flash…');
    syncOverlayStep('Đang xóa vùng nhớ firmware…',
      'Thiết bị xóa bank firmware dự phòng trước khi nhận bản mới. Mất vài giây.');
    if (!await write(buf[0], buf.subarray(1, 6), true)) throw new Error('lệnh 0xA0 thất bại');

    // gửi từng trang 256 byte, chia đôi 128+128 (0xA2 nửa đầu, 0xA3 nửa sau)
    let p = 0;
    for (let i = 0; i < firmSize + 64; i += 256) {
      buf.fill(0xff);
      if (i === 0) {
        // trang đầu: header bank 64 byte (70 51 AA + size + CRC32 + version)
        // + 192 byte firmware; thiết bị tự điền image id mới vào byte flag
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
      syncOverlayStep('Đang gửi firmware…',
        'Đã gửi ' + (p >> 10) + '/' + ((firmSize + 64) >> 10) + ' KB. TUYỆT ĐỐI không tắt nguồn thiết bị.');
      syncOverlayProgress(p, firmSize + 64);
    }

    // 0xA4: kết thúc — thiết bị tự khởi động lại vào firmware mới
    buf.fill(0x00); buf[0] = 0xa4;
    await write(buf[0], buf.subarray(1, 4), true);
    syncOverlayStep('Đang chốt bản mới…',
      'Thiết bị ghi trang đầu rồi tự khởi động lại. Chờ máy hiện lại rồi hãy kết nối.');
    show('Hoàn tất — thiết bị đang khởi động lại.');
    addLog('Cập nhật xong! Thiết bị khởi động lại với firmware mới.');
  } catch (e) {
    console.error(e);
    show('Lỗi: ' + (e.message || e));
    addLog('OTA thất bại: ' + (e.message || e));
  } finally {
    btn.disabled = null;
    syncOverlayHide();
    updateButtonStatus();
  }
}


document.body.onload = () => {
  textDecoder = null;
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext("2d");

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