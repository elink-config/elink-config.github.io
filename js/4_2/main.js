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
  TIME_FMT: 0x2A, // [0/1] định dạng giờ: 24h / 12h (BWR >= 2.1, 4 màu >= 3.0, 7.5" V1 >= 0.3)

  WRITE_IMG: 0x30, // v1.6

  SET_CONFIG: 0x90,
  SYS_RESET: 0x91,
  SYS_SLEEP: 0x92,
  CFG_ERASE: 0x99,
};

const EPD_SERVICE = '62750001-d828-918d-fb46-b6c11c675aec';
// Chỉ liệt kê đúng máy của app này: 4.2" (DIY-4_2-xxxx) và 7.5" (DIY-7_5-xxxx
// CC2640 / DIY-7_5V-xxxx DA14585 640×384 — prefix 'DIY-7_5' khớp cả hai). Các
// board 2.13"/2.9" quảng bá DIY-2_13-/DIY-2_9- dùng giao thức khác (service
// 0xff00), hiện trong hộp chọn chỉ gây nhầm. Board 4.2" chạy firmware quá cũ
// (tên chưa gắn cỡ màn) vẫn kết nối được bằng chế độ dev (?debug=true).
const BLE_REQUEST_FILTERS = [
  { namePrefix: 'DIY-4_2' },
  { namePrefix: 'DIY-7_5' },
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function logBleConnectHelp(error) {
  addLog(`connect: ${error.name} - ${error.message}`);
  addLog('Gợi ý xử lý khi kết nối thất bại:');
  addLog('1. Đảm bảo thiết bị đã nạp firmware mới nhất, tên Bluetooth là DIY-4_2-xxxx / DIY-7_5-xxxx / DIY-7_5V-xxxx');
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

function intToHex(intIn) {
  let stringOut = ("0000" + intIn.toString(16)).substr(-4)
  return stringOut.substring(2, 4) + stringOut.substring(0, 2);
}

function resetVariables() {
  deviceMode = null;
  timeSynced = false;
  gattServer = null;
  epdService = null;
  epdCharacteristic = null;
  msgIndex = 0;
  document.getElementById("log").value = '';
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
function waitMtuNotify(timeoutMs) {
  return new Promise(resolve => {
    const t = setTimeout(() => { mtuNotifyResolve = null; resolve(false); }, timeoutMs);
    mtuNotifyResolve = () => { clearTimeout(t); resolve(true); };
  });
}

// đợi thiết bị báo 'img=rdy' sau lệnh mở khe ảnh (fw >= 1.6). Thiết bị xóa
// 32KB flash (~0.5-1.5s) TRONG handler lệnh mở khe; bắn gói ảnh trong lúc đó
// là gói dồn đống làm cạn MSG heap BLE -> thiết bị reset (lỗi v1.5).
// Resolve true khi 'img=rdy', false khi 'img=err' hoặc hết giờ.
let imgRdyResolve = null;
function waitImgRdy(timeoutMs) {
  return new Promise(resolve => {
    const t = setTimeout(() => { imgRdyResolve = null; resolve(false); }, timeoutMs);
    imgRdyResolve = (ok) => { clearTimeout(t); resolve(ok); };
  });
}

async function writeImage(data, step = 'bw') {
  const chunkSize = document.getElementById('mtusize').value - 2;
  const interleavedCount = document.getElementById('interleavedcount').value;
  const count = Math.ceil(data.length / chunkSize);
  let chunkIdx = 0;
  let noReplyCount = interleavedCount;

  for (let i = 0; i < data.length; i += chunkSize) {
    const currentTime = (new Date().getTime() - startTime) / 1000.0;
    const pct = ((100 * i) / data.length) >> 0;
    setStatus(`Khối ${step == 'bw' ? 'đen trắng' : 'màu'}: ${chunkIdx + 1}/${count} (${pct}%), thời gian: ${currentTime}s`);
    const payload = [
      (step == 'bw' ? 0x0F : 0x00) | (i == 0 ? 0x00 : 0xF0),
      ...data.slice(i, i + chunkSize),
    ];
    const useReply = noReplyCount <= 0;
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

async function setDriver() {
  await write(EpdCmd.SET_PINS, document.getElementById("epdpins").value);
  await write(EpdCmd.INIT, document.getElementById("epddriver").value);
}

async function sendTimeSync(mode) {
  // +10s lead: the BLE transfer, wake-up and first render take ~10 seconds
  // before the device actually starts counting from the received value, so
  // send a timestamp slightly in the future to land on the correct time
  const timestamp = new Date().getTime() / 1000 + 10;
  const data = new Uint8Array([
    (timestamp >> 24) & 0xFF,
    (timestamp >> 16) & 0xFF,
    (timestamp >> 8) & 0xFF,
    timestamp & 0xFF,
    -(new Date().getTimezoneOffset() / 60),
    mode
  ]);
  if (await write(EpdCmd.SET_TIME, data)) {
    addLog("Đã đồng bộ thời gian!");
    addLog("Vui lòng không thao tác cho đến khi màn hình làm mới xong.");
    if (typeof highlightMode === 'function') highlightMode(mode);
    deviceMode = mode;
    return true;
  }
  return false;
}

// [Sync time] button: send the system time to the device, KEEPING its
// current mode. Selecting modes in [Điều khiển thiết bị] unlocks after this
// (or immediately when the device reports an already-valid clock).
async function manualSyncTime() {
  let mode = deviceMode;
  if (mode === 0) {
    // a time sync always redraws: in picture mode the uploaded image is lost
    if (!confirm('Thiết bị đang ở chế độ ảnh: đồng bộ thời gian sẽ vẽ lại màn hình và ảnh sẽ mất. Tiếp tục?')) return;
    mode = 1;
  }
  if (mode == null) mode = 1;
  if (await sendTimeSync(mode)) {
    timeSynced = true;
    updateButtonStatus();
    addLog("Đồng bộ thời gian hoàn tất — bây giờ có thể chọn giao diện màn hình.");
  }
}

// [Điều khiển thiết bị] mode selection (the protocol carries the current
// timestamp inside the same command, so the device time stays fresh)
async function syncTime(mode) {
  await sendTimeSync(mode);
}

async function sendNote() {
  const text = document.getElementById('noteTXT').value.trim();
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > 190) {
    alert(`Ghi chú quá dài: ${bytes.length}/190 byte (chữ có dấu chiếm 2-3 byte mỗi chữ). Hãy rút gọn rồi gửi lại.`);
    return;
  }
  if (await write(EpdCmd.SET_NOTE, bytes.length ? bytes : null)) {
    addLog(text ? "Đã gửi ghi chú! (thiết bị báo lại 'note=<số byte>')" : "Đã xóa ghi chú!");
    addLog("Thiết bị tự chuyển sang màn hình «Ghi chú» và hiển thị nội dung sau ~25 giây.");
    if (typeof highlightMode === 'function') highlightMode(19);
  }
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

async function clearScreen() {
  if (confirm('Xóa nội dung màn hình?')) {
    await write(EpdCmd.CLEAR);
    addLog("Đã gửi lệnh xóa màn hình!");
    addLog("Vui lòng không thao tác cho đến khi màn hình làm mới xong.");
  }
}

async function sendcmd() {
  const cmdTXT = document.getElementById('cmdTXT').value;
  if (cmdTXT == '') return;
  const bytes = hex2bytes(cmdTXT);
  await write(bytes[0], bytes.length > 1 ? bytes.slice(1) : null);
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

async function sendimg(slot = 0) {
  if (cropManager.isCropMode()) {
    alert("Vui lòng hoàn tất cắt ảnh trước! Đã hủy gửi.");
    return;
  }

  // 3 khe ảnh cần firmware >= 1.5; đời cũ chỉ hiển thị được (không lưu khe)
  const slotCapable = FwCheck.atLeast('1.5');
  if (!slotCapable && slot > 0) {
    if (!confirm('Firmware của thiết bị chưa hỗ trợ 3 khe ảnh (cần v1.5). Ảnh sẽ chỉ hiển thị, không lưu vào khe. Tiếp tục?')) return;
  }

  const canvasSize = document.getElementById('canvasSize').value;
  const ditherMode = document.getElementById('ditherMode').value;
  const epdDriverSelect = document.getElementById('epddriver');
  const selectedOption = epdDriverSelect.options[epdDriverSelect.selectedIndex];

  if (selectedOption.getAttribute('data-size') !== canvasSize) {
    if (!confirm("Cảnh báo: kích thước canvas không khớp driver, tiếp tục?")) return;
  }
  if (selectedOption.getAttribute('data-color') !== ditherMode) {
    if (!confirm("Cảnh báo: chế độ màu không khớp driver, tiếp tục?")) return;
  }

  startTime = new Date().getTime();
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
    const rdyWait = FwCheck.atLeast('1.6') ? waitImgRdy(8000) : null;
    if (!await write(EpdCmd.IMG_SLOT, [0x01, slot])) {
      imgRdyResolve = null;
      setStatus('Không mở được khe ảnh — thử lại.');
      updateButtonStatus();
      return;
    }
    if (rdyWait && !await rdyWait) {
      setStatus('Không mở được khe ảnh (thiết bị không báo sẵn sàng) — thử lại.');
      updateButtonStatus();
      return;
    }
  }

  let ok = true;
  if (ditherMode === 'threeColor') {
    const halfLength = Math.floor(processedData.length / 2);
    const blackWhiteData = processedData.slice(0, halfLength);
    const redWhiteData = processedData.slice(halfLength);
    if (epdDriverSelect.value === '08' || epdDriverSelect.value === '09') {
      ok = await writeImage(convertUC8159(blackWhiteData, redWhiteData), 'bw');
    } else {
      ok = await writeImage(blackWhiteData, 'bw');
      if (ok) ok = await writeImage(redWhiteData, 'red');
    }
  } else if (ditherMode === 'blackWhiteColor') {
    if (epdDriverSelect.value === '08' || epdDriverSelect.value === '09') {
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
    return;
  }

  if (!ok) {
    // KHÔNG refresh ảnh dở dang; thiết bị tự mở lại minute tick khi mất kết
    // nối hoặc khi lần gửi sau thành công
    setStatus('Truyền ảnh thất bại — chưa làm mới màn hình.');
    updateButtonStatus();
    return;
  }

  // chốt khe (ghi trailer hợp lệ) TRƯỚC khi làm mới màn
  if (slotCapable) {
    if (await write(EpdCmd.IMG_SLOT, [0x02])) {
      imgSlotMask |= (1 << slot);
      updateImgAutoUI();
      addLog(`Đã lưu ảnh vào khe ${slot + 1} trên thiết bị.`);
    }
  }

  await write(EpdCmd.REFRESH);
  updateButtonStatus();

  const sendTime = (new Date().getTime() - startTime) / 1000.0;
  addLog(`Gửi xong! Thời gian: ${sendTime}s`);
  setStatus(`Gửi xong! Thời gian: ${sendTime}s`);
  addLog("Vui lòng không thao tác cho đến khi màn hình làm mới xong.");
  setTimeout(() => {
    status.parentElement.style.display = "none";
  }, 5000);
}

function downloadDataArray() {
  if (cropManager.isCropMode()) {
    alert("Vui lòng hoàn tất cắt ảnh trước! Đã hủy tải.");
    return;
  }

  const mode = document.getElementById('ditherMode').value;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const processedData = processImageData(imageData, mode);

  if (mode === 'sixColor' && processedData.length !== canvas.width * canvas.height) {
    console.log(`Lỗi: cần ${canvas.width * canvas.height} byte, nhận được ${processedData.length} byte`);
    addLog('Kích thước mảng không khớp. Kiểm tra kích thước ảnh và chế độ.');
    return;
  }

  const dataLines = [];
  for (let i = 0; i < processedData.length; i++) {
    const hexValue = (processedData[i] & 0xff).toString(16).padStart(2, '0');
    dataLines.push(`0x${hexValue}`);
  }

  const formattedData = [];
  for (let i = 0; i < dataLines.length; i += 16) {
    formattedData.push(dataLines.slice(i, i + 16).join(', '));
  }

  const colorModeValue = mode === 'sixColor' ? 0 : mode === 'fourColor' ? 1 : mode === 'blackWhiteColor' ? 2 : 3;
  const arrayContent = [
    'const uint8_t imageData[] PROGMEM = {',
    formattedData.join(',\n'),
    '};',
    `const uint16_t imageWidth = ${canvas.width};`,
    `const uint16_t imageHeight = ${canvas.height};`,
    `const uint8_t colorMode = ${colorModeValue};`
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
  // mode selection KHÔNG còn đòi [Sync time] trước: lệnh chọn giao diện
  // (0x02) tự mang timestamp nên thiết bị luôn nhận được giờ đúng. Gate cũ
  // từng khóa chết người dùng khi mode ĐANG LƯU trên máy bị lỗi render
  // (7.5" rst=P4): bấm Sync time là máy vẽ lại mode lỗi và reset ngay,
  // không có cách nào thoát sang mode khác.
  const modeStatus = status;
  document.getElementById("reconnectbutton").disabled = (gattServer == null || gattServer.connected) ? 'disabled' : null;
  document.getElementById("synctimebutton").disabled = status;
  document.getElementById("sendcmdbutton").disabled = status;
  document.getElementById("calendarmodebutton").disabled = modeStatus;
  document.getElementById("clockmodebutton").disabled = modeStatus;
  document.getElementById("combomodebutton").disabled = modeStatus;
  document.getElementById("redcombomodebutton").disabled = modeStatus;
  document.getElementById("vncalendarmodebutton").disabled = modeStatus;
  document.getElementById("digitalmodebutton").disabled = modeStatus;
  document.getElementById("analogmodebutton").disabled = modeStatus;
  document.getElementById("dayblocmodebutton").disabled = modeStatus;
  document.getElementById("weekmodebutton").disabled = modeStatus;
  document.getElementById("digitalcalmodebutton").disabled = modeStatus;
  document.getElementById("analogdaymodebutton").disabled = modeStatus;
  document.getElementById("minimalmodebutton").disabled = modeStatus;
  document.getElementById("vanniemodebutton").disabled = modeStatus;
  document.getElementById("countdownmodebutton").disabled = modeStatus;
  document.getElementById("twomonthmodebutton").disabled = modeStatus;
  document.getElementById("yearmodebutton").disabled = modeStatus;
  document.getElementById("thermomodebutton").disabled = modeStatus;
  document.getElementById("moonmodebutton").disabled = modeStatus;
  document.getElementById("notemodebutton").disabled = modeStatus;
  document.getElementById("custommodebutton").disabled = modeStatus;
  document.getElementById("retromtnmodebutton").disabled = modeStatus;
  document.getElementById("retrosunsetmodebutton").disabled = modeStatus;
  document.getElementById("retrowinmodebutton").disabled = modeStatus;
  document.getElementById("retrocitymodebutton").disabled = modeStatus;
  document.getElementById("uploadlayoutbutton").disabled = status;
  document.getElementById("sendnotebutton").disabled = status;
  document.getElementById("clearscreenbutton").disabled = status;
  document.getElementById("sendimgbutton").disabled = status;
  document.getElementById("sendimgbutton2").disabled = status;
  document.getElementById("sendimgbutton3").disabled = status;
  document.getElementById("setDriverbutton").disabled = status;
  document.getElementById("otabutton").disabled = status;
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
  // gate lại theo firmware của thiết bị kế tiếp
  document.getElementById('imgAutoRow').style.display = 'none';
  imgSlotMask = 0;
}

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

async function reConnect() {
  if (bleDevice != null && bleDevice.gatt.connected)
    bleDevice.gatt.disconnect();
  resetVariables();
  addLog("Đang kết nối lại");
  await connect();
}

function handleNotify(value, idx) {
  const data = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (idx == 0) {
    addLog(`Nhận cấu hình: ${bytes2hex(data)}`);
    const epdpins = document.getElementById("epdpins");
    const epddriver = document.getElementById("epddriver");
    epdpins.value = bytes2hex(data.slice(0, 7));
    if (data.length > 10) epdpins.value += bytes2hex(data.slice(10, 11));
    epddriver.value = bytes2hex(data.slice(7, 8));
    updateDitcherOptions();
    // config byte 11 = current display mode: highlight it in the gallery
    if (data.length > 11) {
      deviceMode = data[11];
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
      imgSlotMask = (data[214] <= 7) ? data[214] : 0;
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
    } else if (msg.startsWith('img=') && imgRdyResolve) {
      // trả lời lệnh mở khe ảnh: 'img=rdy' (xóa flash xong) / 'img=err'
      const f = imgRdyResolve; imgRdyResolve = null; f(msg === 'img=rdy');
    } else if (msg.startsWith('fw=') && msg.length > 3) {
      FwCheck.report(msg.substring(3));
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
      window.__fwCal = /^DIY-7_5V?-/.test(devNm) ? false   // 7.5" chua co mode nay
        : FwCheck.atLeast(devNm.indexOf('DIY-4_2C') === 0 ? '2.9' : '2.0');
      // «Định dạng giờ» 12h/24h: BWR >= 2.1, 4 màu >= 3.0, 7.5" V1 >= 0.3;
      // CC2640 (DIY-7_5-) chưa hỗ trợ
      window.__fwTimeOk = /^DIY-7_5-/.test(devNm) ? false
        : FwCheck.atLeast(devNm.indexOf('DIY-4_2C') === 0 ? '3.0'
          : /^DIY-7_5V-/.test(devNm) ? '0.3' : '2.1');
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

// ---- Tự động đổi ảnh giữa các khe (1 -> 2 -> 3 -> 1) ----
// checkbox + radio chỉ dùng được khi thiết bị đã có >= 2 khe ảnh; radio chỉ
// dùng được khi checkbox bật (yêu cầu tính năng v1.5)
function slotCount(mask) {
  let n = 0;
  for (let i = 0; i < 3; i++) if (mask & (1 << i)) n++;
  return n;
}
function updateImgAutoUI() {
  const enough = slotCount(imgSlotMask) >= 2;
  const chk = document.getElementById('imgAutoCHK');
  chk.disabled = !enough;
  if (!enough) chk.checked = false;
  document.querySelectorAll('input[name="imgInterval"]').forEach(r => {
    r.disabled = !enough || !chk.checked;
  });
  document.getElementById('imgAutoHint').textContent = enough
    ? `Đã có ảnh ở ${slotCount(imgSlotMask)} khe — thiết bị sẽ tự chuyển khe theo chu kỳ đã chọn (mốc tính theo 00:00).`
    : 'Cần gửi ảnh vào ít nhất 2 khe để bật tự đổi ảnh (khe 1 → 2 → 3 → 1).';
}
async function setImgAuto() {
  const auto = document.getElementById('imgAutoCHK').checked ? 1 : 0;
  const sel = document.querySelector('input[name="imgInterval"]:checked');
  const hours = sel ? parseInt(sel.value) : 24;
  updateImgAutoUI();
  if (await write(EpdCmd.IMG_SLOT, [0x03, auto, hours])) {
    addLog(auto
      ? `Đã bật tự động đổi ảnh mỗi ${hours} giờ (khe 1 → 2 → 3 → 1).`
      : 'Đã tắt tự động đổi ảnh.');
  }
}

async function connect() {
  if (bleDevice == null || epdCharacteristic != null) return;
  // đời cũ không tự khai coi như 1.3.1; kèm tên thiết bị để popup nhắc
  // tối đa 1 lần/ngày cho mỗi máy. CẢ HAI bản 7.5" (DIY-7_5- CC2640 và
  // DIY-7_5V- DA14585 640×384) không so với bảng firmware 4.2" — khỏi nhắc
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

function updateCanvasSize() {
  const selectedSizeName = document.getElementById('canvasSize').value;
  const selectedSize = canvasSizes.find(size => size.name === selectedSizeName);

  canvas.width = selectedSize.width;
  canvas.height = selectedSize.height;

  updateImage();
}

function updateDitcherOptions() {
  const epdDriverSelect = document.getElementById('epddriver');
  const selectedOption = epdDriverSelect.options[epdDriverSelect.selectedIndex];
  const colorMode = selectedOption.getAttribute('data-color');
  const canvasSize = selectedOption.getAttribute('data-size');

  if (colorMode) document.getElementById('ditherMode').value = colorMode;
  if (canvasSize) document.getElementById('canvasSize').value = canvasSize;

  // Màn 4 màu IST7158/JD79668 (driver 05/06, firmware epd_4_2inch_4c):
  // «làm mới mỗi giờ» và «chữ đậm» của bản BWR không áp dụng — ẩn 2 tùy
  // chọn, hiện ghi chú nhịp cập nhật thay thế
  const is4c = epdDriverSelect.value === '05' || epdDriverSelect.value === '06';
  const hfRow = document.getElementById('hourlyFullRow');
  const dbRow = document.getElementById('darkBoostRow');
  const hint = document.getElementById('fourColorHint');
  if (hfRow) hfRow.style.display = is4c ? 'none' : '';
  if (dbRow) dbRow.style.display = is4c ? 'none' : '';
  if (hint) hint.style.display = is4c ? '' : 'none';

  // gallery preview vẽ điểm nhấn VÀNG khi driver là màn 4 màu — vẽ lại
  if (window.refreshModeGallery) window.refreshModeGallery();

  updateCanvasSize(); // always update image
}

// ------- OTA firmware qua BLE (0xA0/A2/A3/A4 — như webtool 2_13inch) -------
// Khác bản 2.13": kích thước firmware trong lệnh 0xA0 là u32 LE tại offset 2
// (firmware 4.2" ~76KB vượt giới hạn u16); firmware epd_4_2inch đọc đúng dạng này.

// CRC32 chuẩn (IEEE 802.3) — bootloader kiểm CRC này trước khi chạy bank mới
function crc32buf(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
  }
  return (crc ^ -1) | 0;
}

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
  const btn = document.getElementById('otabutton');
  btn.disabled = 'disabled';
  try {
    // 0xA0: bắt đầu — firmware xoá bank không hoạt động (kích thước u32 LE)
    const buf = new Uint8Array(136);
    const dv = new DataView(buf.buffer);
    buf[0] = 0xa0; buf[1] = 0x00;
    dv.setUint32(2, firmSize, true);
    show('Đang xoá flash…');
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
    }

    // 0xA4: kết thúc — thiết bị tự khởi động lại vào firmware mới
    buf.fill(0x00); buf[0] = 0xa4;
    await write(buf[0], buf.subarray(1, 4), true);
    show('Hoàn tất — thiết bị đang khởi động lại.');
    addLog('Cập nhật xong! Thiết bị khởi động lại với firmware mới.');
  } catch (e) {
    console.error(e);
    show('Lỗi: ' + (e.message || e));
    addLog('OTA thất bại: ' + (e.message || e));
  } finally {
    btn.disabled = null;
    updateButtonStatus();
  }
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