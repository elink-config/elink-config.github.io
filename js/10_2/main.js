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
let imgCurrent = 0;         // khe máy đang hiện (config)

/* ---- SỐ KHE của máy này ----------------------------------------------------
 * Đọc từ hồ sơ sinh ra (js/10_2/profile.gen.js) chứ không ghim số ở đây: bản
 * board gắn chip flash 2MB sẽ có 5 khe + 2 «Tự thiết kế», và khi đó chỉ cần
 * sửa tools/profile/10_2.json + epd_flashmap.h rồi sinh lại — trang này tự
 * theo. Khe NỀN của «Tự thiết kế» xếp ngay sau các khe ảnh. */
const IMG_SLOTS = (window.EPD_PROFILE && window.EPD_PROFILE.soKhe) || 1;
const IMG_BG_SLOT = d => IMG_SLOTS + d;

/* js/common/designer.js hỏi tên hàm này để biết máy có KHE NỀN RIÊNG hay
 * không. Có thì ảnh nền đi vào khe nền của nó; không thì bản chung lùi về
 * đường cũ của màn 4.2" đời đầu (mượn tạm một khe ảnh). Máy này có khe nền
 * riêng ngay từ v2.0 nên gắn thẳng vào cổng «khe_anh». */
function fwHasNewSlots() { return EpdProf.co('khe_anh'); }

/* ---- Quy đổi SỐ MODE cho máy chạy firmware v1.0 ----------------------------
 * v2.0 đánh lại số mode cho liền mạch (số thẻ = số mode). Máy chưa cập nhật
 * vẫn hiểu bảng số CŨ, nên phải quy đổi lúc gửi và lúc đọc config về. Bảng
 * sinh ra từ hồ sơ (mode_new2old) — bỏ nó đi khi không còn máy nào chạy v1.0.
 * family_epd.js tự gọi modeToWire() nếu app có khai. */
const MODE_NEW2OLD = (window.EPD_PROFILE && window.EPD_PROFILE.modeNew2Old) || {};
const MODE_OLD2NEW = Object.fromEntries(
  Object.entries(MODE_NEW2OLD).map(([nw, od]) => [od, +nw]));

function modeNumberingIsNew() { return EpdProf.co('danh_lai_so_mode'); }
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

/* KHÔI PHỤC CÀI ĐẶT GỐC (lệnh 0x2F).
 *
 * Đây là đường CỨU HỘ duy nhất cho khách: máy bán ra không có nút bấm tay
 * (pad TX chỉ để trên bàn thợ), nên khi cấu hình hoặc bố cục «Tự thiết kế»
 * hỏng tới mức máy hiển thị sai, không có cách nào khác để đưa nó về như mới.
 * Chữ ký kích hoạt được firmware giữ lại — không nhắc tới ở đây vì khách
 * không cần biết máy có cơ chế đó. */
async function factoryReset() {
  if (!epdCharacteristic) { alert('Chưa kết nối thiết bị.'); return; }
  if (!confirm('Khôi phục cài đặt gốc?\n\n' +
               'Máy sẽ về như lúc mới và XOÁ HẾT:\n' +
               '  • cấu hình (chế độ, kiểu pin, 12/24h...)\n' +
               '  • giao diện «Tự thiết kế» + ảnh nền + icon\n' +
               '  • ảnh đã gửi vào khe\n\n' +
               'Không hoàn tác được.')) return;
  addLog('Gửi lệnh khôi phục cài đặt gốc...', '⇑');
  // 4 byte magic 'R','S','T',0x5A — firmware bỏ qua gói thiếu magic
  await write(EpdCmd.FACTORY_RESET, [0x52, 0x53, 0x54, 0x5A]);
  imgSlotMask = 0;
  updateShowImgUI();
  addLog('Máy sẽ khởi động lại và tự ngắt kết nối. Kết nối lại sau vài giây.');
}

/* HIỆN LẠI một khe ảnh đã lưu (lệnh 0x27 05).
 *
 * Vì sao cần: ảnh trong khe chỉ hiện ra qua VÒNG TỰ ĐỔI ẢNH, mà vòng đó lại
 * nằm sau cửa «máy đang ở chế độ ẢNH». Lỡ chọn một giao diện lịch là vừa mất
 * vòng tự đổi, vừa không còn đường nào quay lại ảnh — phải gửi lại cả tấm ảnh
 * dù nó đang nằm sẵn trong flash. Với máy này (chỉ MỘT khe) thì lệnh này còn
 * là đường DUY NHẤT để hiện lại ảnh: vòng tự đổi đòi từ hai khe trở lên. */
async function showImgSlot(slot) {
  if (!epdCharacteristic) { alert('Chưa kết nối thiết bị.'); return; }
  if (!(imgSlotMask & (1 << slot))) {
    alert('Khe ' + (slot + 1) + ' chưa có ảnh.');
    return;
  }
  addLog('Hiện lại ảnh ở khe ' + (slot + 1) + '...', '⇑');
  await write(EpdCmd.IMG_SLOT, [0x05, slot]);
  deviceMode = 0;  // máy tự chuyển về chế độ ẢNH
  if (typeof highlightMode === 'function') highlightMode(0);
}

/* Bật/tắt hàng nút «Hiện lại ảnh»: chỉ hiện với firmware hiểu lệnh, và từng
 * nút chỉ bật khi khe đó THẬT SỰ có ảnh (đọc từ mask trong config). */
function updateShowImgUI() {
  const row = document.getElementById('imgShowRow');
  if (!row) return;
  const ok = EpdProf.co('hien_khe_anh');
  row.style.display = ok ? '' : 'none';
  if (!ok) return;
  for (let i = 0; i < 5; i++) {
    const b = document.getElementById('showimgbutton' + (i + 1));
    if (!b) continue;
    b.style.display = (i < IMG_SLOTS) ? '' : 'none';
    b.disabled = !(imgSlotMask & (1 << i));
    b.classList.toggle('primary', i === imgCurrent && !b.disabled);
    b.classList.toggle('secondary', !(i === imgCurrent && !b.disabled));
  }
}

/* Ba nấc chu kỳ tính bằng PHÚT (15/30/45) chỉ có từ v2.0. Firmware v1.0 nhận
 * byte đó bình thường rồi âm thầm rơi về 24 GIỜ — đúng loại lỗi câm mà trang
 * này gate cẩn thận ở mọi tính năng khác. */
function updateIntervalUI() {
  const ok = EpdProf.co('chu_ky_phut');
  document.querySelectorAll('.imgIntervalMin').forEach(e => { e.style.display = ok ? '' : 'none'; });
  if (!ok && !document.querySelector('input[name="imgInterval"]:checked')) {
    const r = document.querySelector('input[name="imgInterval"][value="24"]');
    if (r) r.checked = true;
  }
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
  ASSET: 0x2C, // nạp blob dữ liệu vào flash: [00 len_u16] mở / [01 data] / [02 crc32_u32] chốt
  FACTORY_RESET: 0x2F, // [2F 'R' 'S' 'T' 5A] khôi phục cài đặt gốc (fw >= 2.0)
  IMG_SLOT: 0x27, // 3 khe ảnh (fw >= 1.5): [01 slot] mở khe / [02] chốt / [03 auto interval]
  DARK_BOOST: 0x28, // [0/1] chữ đậm cho màn lô in nhạt (ép 0°C khi làm mới toàn màn)
  BATT_STYLE: 0x29, // [0/1/2] hiển thị pin: chỉ icon / phần trăm / điện áp (fw >= 0.4)
  TIME_FMT: 0x2A, // [0/1] định dạng giờ: 24h / 12h

  WRITE_IMG: 0x30, // v1.6

  SET_CONFIG: 0x90,
  SYS_RESET: 0x91,
  SYS_SLEEP: 0x92,
  CFG_ERASE: 0x99,
};

const EPD_SERVICE = '62750001-d828-918d-fb46-b6c11c675aec';
// Chỉ liệt kê đúng máy 10.2" (DIY-10_2-xxxx, firmware epd_10_2inch): các
// board 2.13"/2.9" quảng bá DIY-2_13-/DIY-2_9- dùng giao thức khác (service
// 0xff00), các loại DIY-4_2/DIY-7_5V/DIY-7_3 dùng app riêng — hiện trong hộp
// chọn chỉ gây nhầm. Kết nối máy khác được bằng chế độ dev (?debug=true).
const BLE_REQUEST_FILTERS = [
  { namePrefix: 'DIY-10_2' },
];


function logBleConnectHelp(error) {
  addLog(`connect: ${error.name} - ${error.message}`);
  addLog('Gợi ý xử lý khi kết nối thất bại:');
  addLog('1. Đảm bảo thiết bị đã nạp firmware mới nhất, tên Bluetooth là DIY-10_2-xxxx');
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
  addLog(bytes2hex(payload), '⇑');
  try {
    if (withResponse)
      await epdCharacteristic.writeValueWithResponse(Uint8Array.from(payload));
    else
      await epdCharacteristic.writeValueWithoutResponse(Uint8Array.from(payload));
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

async function writeImage(data, step = 'bw') {
  const chunkSize = document.getElementById('mtusize').value - 2;
  const interleavedCount = document.getElementById('interleavedcount').value;
  const count = Math.ceil(data.length / chunkSize);
  let chunkIdx = 0;
  let noReplyCount = interleavedCount;

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
    /* TÁM GÓI ĐẦU ép có xác nhận: ngay sau lệnh mở khe, thiết bị có thể còn
     * bận (xoá flash / huỷ lượt render dở) nên gói không-xác-nhận rơi im lặng
     * và ảnh hỏng mà không ai biết. Vào nhịp rồi mới thả cho nhanh. */
    const useReply = chunkIdx < 8 || noReplyCount <= 0;
    // gói lỗi: thử lại MỘT lần bằng gói có xác nhận rồi mới bỏ cuộc — trước
    // đây một gói rơi là ảnh hỏng trong im lặng
    let ok = await write(EpdCmd.WRITE_IMG, payload, useReply);
    if (!ok) ok = await write(EpdCmd.WRITE_IMG, payload, true);
    if (!ok) {
      addLog(`Truyền ảnh thất bại ở khối ${chunkIdx + 1}/${count} — hãy bấm gửi lại.`);
      return false;
    }
    noReplyCount = useReply ? interleavedCount : noReplyCount - 1;
    chunkIdx++;
  }
  return true;
}


// («Chữ đậm» dark_boost 0x28 ĐÃ GỠ 2026-08-05 theo yêu cầu người dùng —
// firmware 7.5 cũng bỏ lệnh; opcode 0x28 giữ chỗ trong bảng EpdCmd)

async function setBattStyle() {
  const sel = document.querySelector('input[name="battStyle"]:checked');
  const style = sel ? parseInt(sel.value) : 2;
  // KHÔNG chặn cứng theo atLeast: vài giây đầu sau kết nối thiết bị chưa kịp
  // khai 'fw=' — chặn sẽ từ chối nhầm cả máy mới. Firmware cũ nhận lệnh lạ
  // sẽ bỏ qua vô hại; radio vẫn bị mờ khi biết rõ máy quá cũ.
  if (!FwCheck.atLeast('0.4')) {
    addLog('(Chưa rõ phiên bản thiết bị — vẫn gửi lệnh; firmware cũ hơn v0.4 sẽ bỏ qua.)');
  }
  if (await write(EpdCmd.BATT_STYLE, [style])) {
    addLog('Đã đặt hiển thị pin: ' + (style === 0 ? 'chỉ icon' : style === 1 ? 'phần trăm' : 'điện áp') + '.');
  }
}

async function setTimeFmt() {
  const sel = document.querySelector('input[name="timeFmt"]:checked');
  const v = sel ? parseInt(sel.value) : 0;
  if (await write(EpdCmd.TIME_FMT, [v])) {
    addLog('Đã đặt định dạng giờ: ' + (v === 1 ? '12 giờ' : '24 giờ') + '.');
  }
}

/* «Chữ đậm» — lệnh 0x28. Firmware làm MỘT LƯỢT REFRESH THỨ HAI với cùng dữ
 * liệu RAM: lượt hai drive lại toàn bộ pixel bằng waveform đúng nhiệt độ nên
 * mực đen đậm lên mà không loá. Đổi lại là lên hình lâu gấp đôi.
 *
 * Máy này TRƯỚC ĐÂY nhận byte đó rồi bỏ qua (bản dịch vụ riêng không dùng) nên
 * ô này bị ẩn; từ v2.0 nó chạy lõi chung nên tính năng có thật — xem khối
 * dark_boost trong epd_common/epd/EPD_engine.c. */
async function setDarkBoost() {
  const chk = document.getElementById('darkBoostCHK');
  if (await write(EpdCmd.DARK_BOOST, [chk.checked ? 1 : 0])) {
    addLog(chk.checked
      ? 'Đã bật chữ đậm: máy làm mới hai lượt nên chữ đen đậm hơn, đổi lại lên hình lâu gấp đôi.'
      : 'Đã tắt chữ đậm: máy làm mới một lượt như bình thường.');
  } else {
    chk.checked = !chk.checked;  // gửi thất bại: trả checkbox về trạng thái cũ
  }
}

async function setHourlyFull() {
  const chk = document.getElementById('hourlyFullCHK');
  const enabled = chk.checked ? 1 : 0;
  if (await write(EpdCmd.SET_HOURLY_FULL, [enabled])) {
    addLog(enabled
      ? "Đã bật: làm mới toàn màn hình mỗi giờ (chế độ đồng hồ)."
      : "Đã tắt: chỉ làm mới toàn màn hình lúc 00:00 (bóng mờ có thể tích tụ trong ngày).");
  } else {
    chk.checked = !chk.checked; // gửi thất bại: trả checkbox về trạng thái cũ
  }
}


// (convertUC8159 của màn 7.5" V1 ĐÃ BỎ: SSD1677 nhận hai mặt 1bpp trực tiếp)

// Option driver đang chọn — NULL-SAFE (cùng bẫy đã gặp ở webtool 7.3": khi
// select không có mục nào được chọn, selectedIndex = -1 -> undefined
// .getAttribute ném TypeError NGAY ĐẦU sendimg/updateDitcherOptions nên nút
// «Gửi ảnh» chết im lặng, không log gì). Thiếu lựa chọn thì lấy mục đầu.
function getDriverOption() {
  const sel = document.getElementById('epddriver');
  if (!sel) return null;
  return sel.options[sel.selectedIndex] || sel.options[0] || null;
}


/* ---- Vùng dữ liệu ở flash (lệnh 0x2C) --------------------------------------
 * Từ v2.0, font hiển thị + bốn bảng âm lịch đã tách khỏi firmware để trả RAM
 * (firmware DA14585 nạp trọn vào 96KB SysRAM nên mảng const cũng ăn RAM; lên
 * lõi chung tốn thêm ~4KB mã nên không tách là không đủ chỗ).
 *
 * Máy nạp dây đã có sẵn blob trong ảnh nạp; máy cập nhật qua OTA thì CHƯA có,
 * vì OTA chỉ ghi bank firmware — lúc đó máy báo 'asset=none' và hàm dưới tự
 * gửi. ⚠ THIẾU BLOC NÀY THÌ MÁY MẤT HẾT CHỮ (số và đường kẻ vẫn vẽ bình
 * thường, nên rất dễ tưởng là lỗi font chứ không phải thiếu dữ liệu). */
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
  { const nm = (bleDevice && bleDevice.name) || '';
    if (nm.indexOf('DIY-10_2-') !== 0) return; }
  assetBusy = true;
  // phủ kín màn hình: luồng này gần 500 gói, bấm nút khác trong lúc đó là lệnh
  // chen vào giữa và máy nhận nhầm (xem syncOverlayShow ở app_common.js)
  syncOverlayShow('Đang chuẩn bị dữ liệu hiển thị…',
    'Máy chưa có bộ chữ tiếng Việt và bảng âm lịch — webtool đang tải về để gửi xuống.');
  try {
    addLog('Máy chưa có dữ liệu hiển thị (font + âm lịch) — đang gửi xuống…');
    const r = await fetch('OTA%20firmware/10_2/asset.bin?v=' + Date.now());
    if (!r.ok) { addLog('Không tải được asset.bin'); return; }
    const raw = new Uint8Array(await r.arrayBuffer());
    if (raw.length < 16 || raw[0] !== 0x45 || raw[1] !== 0x50) { addLog('asset.bin hỏng'); return; }
    const body = raw.subarray(16);              // bỏ header, máy tự dựng lại
    const crc = crc32(body);

    const rdy = waitAsset(8000);                // máy xóa sector rồi mới báo
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
      ? 'Đã gửi xong dữ liệu hiển thị (' + body.length + ' byte) — thiết bị đang vẽ lại toàn màn hình.'
      : 'Máy không nhận được dữ liệu — thử kết nối lại.');
  } catch (e) {
    addLog('Gửi dữ liệu hiển thị lỗi: ' + e.message);
  } finally {
    assetBusy = false;
    syncOverlayHide();
  }
}

async function sendimg(slot = 0) {
  if (cropManager.isCropMode()) {
    alert("Vui lòng hoàn tất cắt ảnh trước! Đã hủy gửi.");
    return;
  }

  // Khe ảnh chỉ có từ v2.0 — v1.0 không có khe nào (ảnh 960x640 hai mặt là
  // 153.600B, bản đó chưa dùng vùng flash mở rộng). Máy đời cũ vẫn gửi ảnh
  // được, chỉ là hiện lên màn rồi thôi, tắt nguồn là mất.
  const slotCapable = EpdProf.co('khe_anh');
  if (!slotCapable) {
    addLog('Firmware v1.0 không có khe ảnh: ảnh sẽ hiện lên màn nhưng KHÔNG được lưu lại.');
  }

  const canvasSize = document.getElementById('canvasSize').value;
  const ditherMode = document.getElementById('ditherMode').value;
  const selectedOption = getDriverOption();
  const drvSize = selectedOption ? selectedOption.getAttribute('data-size') : canvasSize;
  const drvColor = selectedOption ? selectedOption.getAttribute('data-color') : ditherMode;

  if (drvSize !== canvasSize) {
    if (!confirm("Cảnh báo: kích thước canvas không khớp driver, tiếp tục?")) return;
  }
  if (drvColor !== ditherMode) {
    if (!confirm("Cảnh báo: chế độ màu không khớp driver, tiếp tục?")) return;
  }

  /* Đang nạp bộ chữ thì HOÃN: hai luồng cùng bắn hàng trăm gói trên một
   * characteristic là chèn nhau, và người dùng chỉ thấy «Đang chuẩn bị khe…»
   * rất lâu như bị treo. */
  if (assetBusy) {
    setStatus('Đang nạp bộ chữ cho máy — chờ xong rồi gửi ảnh…');
    addLog('Hoãn gửi ảnh: đang nạp bộ chữ (font + âm lịch) cho máy.');
    while (assetBusy) await new Promise(r => setTimeout(r, 300));
  }

  startTime = new Date().getTime();
  window.__imgSending = true;  // chặn retry fw= ghi lại CCCD giữa phiên gửi
  /* Lớp phủ chặn thao tác suốt lượt gửi: một tấm ảnh 960x640 hai mặt là
   * 153.600 byte = hàng trăm gói BLE, bấm nút khác giữa chừng là lệnh chen
   * vào luồng và máy nhận nhầm. */
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
      'Thiết bị đang xóa vùng nhớ của khe này. Mất một hai giây, chưa truyền ảnh.');
    // Máy này chỉ có khe từ v2.0, và bản đó luôn báo 'img=rdy' sau khi xoá
    // xong — không có đời nào vừa có khe vừa không báo.
    const rdyWait = waitImgRdy(8000);
    if (!await write(EpdCmd.IMG_SLOT, [0x01, slot])) {
      imgRdyResolve = null;
      setStatus('Không mở được khe ảnh — thử lại.');
      updateButtonStatus();
      return;
    }
    if (await rdyWait !== 'img=rdy') {
      setStatus('Không mở được khe ảnh (thiết bị không báo sẵn sàng) — thử lại.');
      updateButtonStatus();
      return;
    }
  }

  // Driver 11/12 (SSD1677) nhận ảnh HAI MẶT 1bpp như bản 4.2": mặt đen (cờ
  // 0x0F) rồi mặt đỏ (0x00/0xF0), mỗi mặt 960x640/8 = 76800 byte — KHÔNG
  // dùng luồng 4bpp convertUC8159 của màn 7.5" V1.
  let ok = true;
  if (ditherMode === 'threeColor') {
    const halfLength = Math.floor(processedData.length / 2);
    const blackWhiteData = processedData.slice(0, halfLength);
    const redWhiteData = processedData.slice(halfLength);
    ok = await writeImage(blackWhiteData, 'bw');
    if (ok) ok = await writeImage(redWhiteData, 'red');
  } else if (ditherMode === 'blackWhiteColor') {
    ok = await writeImage(processedData, 'bw');
  } else {
    addLog("Firmware không hỗ trợ chế độ màu này.");
    updateButtonStatus();
    return;
  }

  if (!ok) {
    // KHÔNG refresh ảnh dở dang; thiết bị tự mở lại minute tick khi mất kết
    // nối hoặc khi lần gửi sau thành công
    setStatus('Truyền ảnh thất bại — chưa làm mới màn hình.');
    updateButtonStatus();
    return;
  }

  // chốt khe (ghi dấu hợp lệ) TRƯỚC khi làm mới màn
  if (slotCapable) {
    /* Khe NỀN của «Tự thiết kế» lưu NÉN — ảnh quá nhiều chi tiết thì không đủ
     * chỗ, firmware huỷ khe và báo 'img=full'. Phải đợi câu trả lời đó rồi mới
     * dám nói đã lưu: báo bừa thành công là người dùng gửi xong mới phát hiện
     * nền không lên, mà không có một manh mối nào. */
    const kq = waitImgRdy(6000);
    if (await write(EpdCmd.IMG_SLOT, [0x02])) {
      const m = await kq;
      if (m === 'img=full') {
        imgSlotMask &= ~(1 << slot);
        updateImgAutoUI();
        updateShowImgUI();
        addLog(slot >= IMG_SLOTS
          ? 'Ảnh nền quá nhiều chi tiết nên KHÔNG đủ chỗ trong máy — chưa lưu được. Hãy chọn ảnh ít chi tiết hơn (nét lớn, mảng phẳng), hoặc giảm nhiễu ở phần chỉnh ảnh.'
          : 'Ảnh không đủ chỗ trong khe — chưa lưu được.');
        setStatus('Ảnh không đủ chỗ — chưa lưu vào máy.');
      } else {
        imgSlotMask |= (1 << slot);
        imgCurrent = (slot < IMG_SLOTS) ? slot : imgCurrent;
        updateImgAutoUI();
        updateShowImgUI();
        addLog(`Đã lưu ảnh vào khe ${slot + 1} trên thiết bị.`);
      }
    }
  }

  syncOverlayStep('Đang làm mới màn hình…',
    'Đã nhận đủ ảnh. Màn hình e-ink 10.2" vẽ lại mất khoảng 30 giây — đừng tắt nguồn lúc này.');
  await write(EpdCmd.REFRESH);
  updateButtonStatus();

  const sendTime = (new Date().getTime() - startTime) / 1000.0;
  addLog(`Gửi xong! Thời gian: ${sendTime}s`);
  setStatus(`Gửi xong! Thời gian: ${sendTime}s`);
  addLog("Vui lòng không thao tác cho đến khi màn hình làm mới xong.");
  setTimeout(() => {
    status.parentElement.style.display = "none";
  }, 5000);
  } catch (e) {
    /* Trước đây hàm này KHÔNG có khối bắt lỗi: một lỗi giữa lượt gửi làm cả
     * lượt chết IM LẶNG — thanh trạng thái đứng nguyên ở bước dở dang, nút thì
     * khoá luôn, không một dòng nhật ký nào. */
    console.error(e);
    const m = (e && e.message) ? e.message : String(e);
    addLog('Lỗi khi gửi ảnh: ' + m);
    setStatus('Gửi ảnh lỗi: ' + m + ' — hãy tải lại trang rồi thử lại.');
    updateButtonStatus();
  } finally { window.__imgSending = false; syncOverlayHide(); }
}


function updateButtonStatus(forceDisabled = false) {
  const connected = gattServer != null && gattServer.connected;
  const status = forceDisabled ? 'disabled' : (connected ? null : 'disabled');
  // mode selection KHÔNG còn đòi [Sync time] trước: lệnh chọn giao diện
  // (0x02) tự mang timestamp nên thiết bị luôn nhận được giờ đúng. Gate cũ
  // từng khóa chết người dùng khi mode ĐANG LƯU trên máy bị lỗi render
  // (rst=P4): bấm Sync time là máy vẽ lại mode lỗi và reset ngay, không có
  // cách nào thoát sang mode khác.
  const modeStatus = status;
  // KHÔNG liệt kê id nút giao diện ở đây nữa. Gallery do mode_preview.js dựng
  // ĐỘNG từ MODE_LIST, mà MODE_LIST thay đổi theo firmware — danh sách id cứng
  // lệch một cái là getElementById trả null, ném lỗi NGAY TRONG body.onload và
  // giết cả lượt dựng giao diện («Lỗi tải giao diện: Cannot set properties of
  // null»). Quét thẳng nút trong #modeGallery thì luôn khớp.
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.disabled = v; };
  set("reconnectbutton", (gattServer == null || gattServer.connected) ? 'disabled' : null);
  ["synctimebutton", "sendcmdbutton", "uploadlayoutbutton", "sendnotebutton", "clearscreenbutton", "sendimgbutton", "setDriverbutton", "otabutton"]
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
        addLog("Không tìm thấy thiết bị E-Ink 10.2\" (tên DIY-10_2-xxxx)");
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


// Gói notify của máy là CHỮ hay là CONFIG nhị phân?
//
// TRƯỚC ĐÂY nhận diện bằng THỨ TỰ (gói số 0 = config) — sai ngay khi máy không
// gửi được config: gói config dài ~220B, mà lúc webtool bật notify thì MTU
// thường vẫn là 23 nên máy không đẩy nổi gói đó. 'fw=' liền tụt lên làm gói số
// 0, bị đọc thành config và MẤT — webtool tưởng máy không khai phiên bản, mọi
// tính năng mở theo firmware đều nằm im (user báo «hầu như không bao giờ thiết
// bị báo fw»). Nay xét NỘI DUNG: mọi gói chữ của máy đều dạng "khoá=giá trị"
// ASCII ngắn, còn config mở đầu bằng byte chân cắm nên không bao giờ lọt.
function notifyIsText(d) {
  if (d.length < 3 || d.length > 64) return false;
  let eq = -1;
  for (let i = 0; i < d.length && i < 8; i++) {
    const c = d[i];
    if (c === 0x3D) { eq = i; break; }                       // '='
    if (!(c >= 0x61 && c <= 0x7A) && !(c >= 0x41 && c <= 0x5A)) return false;
  }
  if (eq < 1) return false;
  for (let i = eq + 1; i < d.length; i++) if (d[i] < 0x20 || d[i] > 0x7E) return false;
  return true;
}

function handleNotify(value, idx) {
  const data = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  // config nhị phân dài 200+ byte; mọi gói chữ đều là "khoá=giá trị"
  if (!notifyIsText(data) && data.length >= 12) {
    addLog(`Nhận cấu hình: ${bytes2hex(data)}`);
    const epdpins = document.getElementById("epdpins");
    const epddriver = document.getElementById("epddriver");
    epdpins.value = bytes2hex(data.slice(0, 7));
    if (data.length > 10) epdpins.value += bytes2hex(data.slice(10, 11));
    // Driver máy đang lưu (byte 7). Máy nạp firmware 10.2" lên board cũ còn
    // giữ model của firmware trước (vd "02" của màn 4.2") — giá trị đó KHÔNG
    // có trong select nên gán thẳng sẽ làm select mất lựa chọn (selectedIndex
    // -1) và mọi thao tác đọc option sau đó ném lỗi. Chỉ nhận giá trị có
    // trong danh sách, còn lại giữ nguyên lựa chọn và báo rõ trong log.
    const drvHex = bytes2hex(data.slice(7, 8));
    if ([...epddriver.options].some(o => o.value === drvHex)) {
      epddriver.value = drvHex;
    } else {
      addLog(`⚠ Thiết bị báo driver "${drvHex}" không thuộc màn 10.2" — giữ lựa chọn ` +
        `«${epddriver.options[epddriver.selectedIndex >= 0 ? epddriver.selectedIndex : 0].text}». ` +
        `Bấm «Áp dụng» ở mục Driver để ghi lại driver đúng cho máy.`);
    }
    updateDitcherOptions();
    // config byte 11 = current display mode: highlight it in the gallery
    if (data.length > 11) {
      deviceMode = modeFromWire(data[11]);
      if (typeof highlightMode === 'function') highlightMode(deviceMode);
    }
    // clock cleanup cadence (1 = full refresh hourly; 0xFF -> enabled):
    // byte 205 on current firmware (192-byte note field) or byte 109 on
    // older firmware (96-byte note field)
    const hf = data.length > 205 ? data[205] : (data.length > 109 ? data[109] : null);
    if (hf !== null) {
      document.getElementById('hourlyFullCHK').checked = hf !== 0;
    }
    // 3 khe ảnh (fw >= 1.5): auto/interval/mask tại offset 212/213/214 (sau
    // u32 activation ở 208 — struct căn 4 byte)
    if (data.length >= 216) {
      const auto = data[212], itv = data[213];
      // bit0..(IMG_SLOTS-1) = khe ẢNH, bit tiếp theo = khe NỀN «Tự thiết kế»
      {  // «Chữ đậm» — byte 216 của config, cùng offset với bản 4.2"
        const db = document.getElementById('darkBoostCHK');
        if (db && data.length > 216) db.checked = data[216] === 1;
      }
      imgSlotMask = (data[214] <= 0x7F) ? data[214] : 0;
      imgCurrent = (data[215] < IMG_SLOTS) ? data[215] : 0;
      updateShowImgUI();
      updateIntervalUI();
      document.getElementById('imgAutoCHK').checked = auto === 1;
      const r = document.querySelector(`input[name="imgInterval"][value="${itv}"]`);
      if (r) r.checked = true;
      updateImgAutoUI();
    }
    // (byte dark_boost tại offset 216 không còn dùng — «chữ đậm» đã gỡ)
    // «Hiển thị pin» (fw >= 0.4) tại offset 217, «Định dạng giờ» tại 218 —
    // CỐ Ý trùng offset bản 4.2" để hub dùng chung js/4_2/main.js đọc đúng
    if (data.length > 217 && data[217] <= 2) {
      const rb = document.querySelector(`input[name="battStyle"][value="${data[217]}"]`);
      if (rb) rb.checked = true;
    }
    if (data.length > 218 && data[218] <= 1) {
      const rt = document.querySelector(`input[name="timeFmt"][value="${data[218]}"]`);
      if (rt) rt.checked = true;
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
      // Vùng dữ liệu ở flash (font + bảng âm lịch, tách khỏi firmware để trả
      // RAM). 'asset=none' = máy chưa có blob — hay gặp ở máy vừa cập nhật qua
      // OTA vì OTA chỉ ghi bank firmware. Tự gửi luôn, khách không phải làm gì.
      if (assetResolve) { const f = assetResolve; assetResolve = null; f(msg); }
      else if (msg === 'asset=none') sendAsset();
    } else if (msg.startsWith('img=') && imgRdyResolve) {
      /* Trả NGUYÊN VĂN chứ không phải true/false như các app khác — máy này
       * có thêm câu 'img=full' (ảnh nén không đủ chỗ, khe đã bị huỷ) và phải
       * phân biệt được nó với 'img=err'. Mọi nơi đợi hàm này trong file này
       * đều so chuỗi. */
      const f = imgRdyResolve; imgRdyResolve = null; f(msg);
    } else if (msg.startsWith('fw=') && msg.length > 3) {
      FwCheck.report(msg.substring(3));
      // khu «Tự động đổi ảnh» chỉ hiện khi firmware CÓ khe ảnh (>= 2.0)
      if (EpdProf.co('khe_anh')) {
        document.getElementById('imgAutoRow').style.display = '';
        updateImgAutoUI();
      }
      updateShowImgUI();
      updateIntervalUI();

      /* ---- các cổng của «Tự thiết kế» ------------------------------------
       * Máy chưa hỗ trợ thì ẩn hẳn nút đi: để lại là người dùng xếp xong mới
       * biết không gửi được — đúng loại lỗi câm mà trang này tránh ở mọi chỗ
       * khác. */
      // cỡ TỰ DO: máy cũ bám về ba nấc (designer.js đọc cờ này lúc dựng thanh kéo)
      window.__fwFreeSize = EpdProf.co('co_tu_do');
      // «Chữ 3..6» + «Thứ» + «Ngày dương»
      {
        const six = EpdProf.co('6_o_chu');
        document.querySelectorAll('.dsTextExtra').forEach(e => { e.style.display = six ? '' : 'none'; });
      }
      // «Chữ đậm»: byte dark_boost chỉ có tác dụng thật từ v2.0 (lõi chung)
      {
        const dbRow = document.getElementById('darkBoostRow');
        if (dbRow) dbRow.style.display = EpdProf.co('khoi_phuc_goc') ? '' : 'none';
      }
      // «Khôi phục cài đặt gốc» (lệnh 0x2F): chỉ hiện với máy hiểu lệnh
      {
        const fr = document.getElementById('factoryResetRow');
        if (fr) fr.style.display = EpdProf.co('khoi_phuc_goc') ? '' : 'none';
      }
      // «Làm nền thiết kế» — khe nền riêng, ảnh được NÉN lúc ghi vào máy
      {
        const bgRow = document.getElementById('dsBgRow');
        if (bgRow) bgRow.style.display = EpdProf.co('anh_nen_thiet_ke') ? '' : 'none';
      }
      // ô «Đang sửa»: chỉ có nghĩa khi máy có từ HAI thiết kế trở lên
      {
        const dRow = document.getElementById('dsDesignRow');
        const nTk = (window.EPD_PROFILE && window.EPD_PROFILE.soThietKe) || 1;
        if (dRow) dRow.style.display = (nTk >= 2 && EpdProf.co('anh_nen_thiet_ke')) ? '' : 'none';
      }
      if (window.dsRedraw) window.dsRedraw();
      // mode 14 «Lịch dương + âm» thay Đếm ngược: cần fw 10.2" >= 0.2 —
      // preview card 14 đổi hình + tên theo cờ này (mode_preview.js)
      window.__fwCal = FwCheck.atLeast('0.2');
      if (window.refreshModeGallery) window.refreshModeGallery();
    }
  }
}


async function connect() {
  if (bleDevice == null || epdCharacteristic != null) return;
  // đời cũ không tự khai coi như 1.3.1; kèm tên thiết bị để popup nhắc
  // tối đa 1 lần/ngày cho mỗi máy
  FwCheck.reset('1.3.1', bleDevice && bleDevice.name);

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

  // (bỏ cảnh báo «firmware quá cũ» của bản 4.2": firmware epd_7_5inch bắt
  // đầu từ APP_VERSION 0x01 và không có đời EPD-nRF5 cũ nào cho màn này)
  if (false) {
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

  // firmware <= 1.3.1 không gửi 'fw=' — sau 3s vẫn nhắc nếu bảng có bản mới
  FwCheck.schedule(3000);

  document.getElementById("connectbutton").innerHTML = 'Ngắt kết nối';
  updateButtonStatus();
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

  // Màn 10.2" fw >= 0.3 CÓ partial từng phút như bản 4.2": hiện lại tùy
  // chọn «làm mới toàn màn mỗi giờ» (dọn tàn dư waveform partial) + ghi
  // chú nhịp cập nhật.
  const hfRow = document.getElementById('hourlyFullRow');
  const hint = document.getElementById('fourColorHint');
  if (hfRow) hfRow.style.display = '';
  if (hint) hint.style.display = '';

  // gallery preview vẽ điểm nhấn VÀNG khi driver là màn 4 màu — vẽ lại
  if (window.refreshModeGallery) window.refreshModeGallery();

  updateCanvasSize(); // always update image
}

// ------- OTA firmware qua BLE (0xA0/A2/A3/A4 — như webtool 2_13inch) -------
// Khác bản 2.13": kích thước firmware trong lệnh 0xA0 là u32 LE tại offset 2
// (firmware 4.2" ~76KB vượt giới hạn u16); firmware epd_4_2inch đọc đúng dạng này.


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
  // preBuf (ArrayBuffer): từ nút «Cài ngay» của bảng firmware (đã hỏi xác
  // nhận ở fwInstallRow) — không truyền thì đọc file chọn ở ô Upload như cũ
  const fileInput = document.getElementById('otaFile');
  if (!preBuf && (!fileInput || fileInput.files.length === 0)) {
    addLog('Vui lòng chọn file firmware .bin trước.');
    return;
  }
  if (!epdCharacteristic) {
    addLog('Chưa kết nối thiết bị.');
    return;
  }
  const firmBuf = new Uint8Array(preBuf ? preBuf : await fileInput.files[0].arrayBuffer());
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

  if (!confirm('Cập nhật firmware qua BLE?\nKhông tắt nguồn thiết bị trong quá trình cập nhật!')) return;

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
        'Bản mới được ghi vào bank dự phòng. Máy vẫn chạy firmware cũ cho tới bước cuối.');
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
  // đồng bộ canvas 960×640 + chế độ màu + các row tùy chọn theo driver 11
  // ngay khi mở trang (thẻ <canvas> trong HTML vẫn là 400×300 thừa kế 4.2")
  updateDitcherOptions();
  updateButtonStatus();
  checkDebugMode();
}