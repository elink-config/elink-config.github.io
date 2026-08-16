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

  WRITE_IMG: 0x30, // v1.6

  SET_CONFIG: 0x90,
  SYS_RESET: 0x91,
  SYS_SLEEP: 0x92,
  CFG_ERASE: 0x99,
};

const EPD_SERVICE = '62750001-d828-918d-fb46-b6c11c675aec';
// Chỉ liệt kê đúng máy 7.5" V1 (DIY-7_5B-xxxx, firmware epd_7_5inch —
// KHÔNG khớp DIY-7_5-xxxx của bản lịch 640x384): các board 2.13"/2.9" quảng bá
// DIY-2_13-/DIY-2_9- dùng giao thức khác (service 0xff00), hiện trong hộp
// chọn chỉ gây nhầm. Board 4.2" chạy firmware quá cũ (tên chưa gắn cỡ màn)
// vẫn kết nối được bằng chế độ dev (?debug=true).
const BLE_REQUEST_FILTERS = [
  { namePrefix: 'DIY-7_5B' },
];


function logBleConnectHelp(error) {
  addLog(`connect: ${error.name} - ${error.message}`);
  addLog('Gợi ý xử lý khi kết nối thất bại:');
  addLog('1. Đảm bảo thiết bị đã nạp firmware mới nhất, tên Bluetooth là DIY-7_5B-xxxx');
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


// («Chữ đậm» dark_boost 0x28 ĐÃ GỠ 2026-08-05 theo yêu cầu người dùng —
// firmware 7.5 cũng bỏ lệnh; opcode 0x28 giữ chỗ trong bảng EpdCmd)

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


function updateButtonStatus(forceDisabled = false) {
  const connected = gattServer != null && gattServer.connected;
  const status = forceDisabled ? 'disabled' : (connected ? null : 'disabled');
  // mode selection KHÔNG còn đòi [Sync time] trước: lệnh chọn giao diện
  // (0x02) tự mang timestamp nên thiết bị luôn nhận được giờ đúng. Gate cũ
  // từng khóa chết người dùng khi mode ĐANG LƯU trên máy bị lỗi render
  // (rst=P4): bấm Sync time là máy vẽ lại mode lỗi và reset ngay, không có
  // cách nào thoát sang mode khác.
  const modeStatus = status;
  document.getElementById("reconnectbutton").disabled = (gattServer == null || gattServer.connected) ? 'disabled' : null;
  document.getElementById("synctimebutton").disabled = status;
  document.getElementById("sendcmdbutton").disabled = status;
  // bản BIG: nút chế độ do mode_preview.js sinh động -> duyệt theo card
  document.querySelectorAll(".mode-card button").forEach(function (btn) {
    btn.disabled = modeStatus;
  });
  document.getElementById("sendnotebutton").disabled = status;
  document.getElementById("clearscreenbutton").disabled = status;
  document.getElementById("sendimgbutton").disabled = status;
  document.getElementById("sendimgbutton2").disabled = status;
  document.getElementById("sendimgbutton3").disabled = status;
  document.getElementById("setDriverbutton").disabled = status;
  document.getElementById("otabutton").disabled = status;
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
        addLog("Không tìm thấy thiết bị E-Ink 7.5\" (tên DIY-7_5B-xxxx)");
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
    // (byte dark_boost tại offset 216 không còn dùng — «chữ đậm» đã gỡ)
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
      // mode 14 «Lịch dương + âm» thay Đếm ngược: cần fw 7.5" V1 >= 0.4 —
      // preview card 14 đổi hình + tên theo cờ này (mode_preview.js)
      window.__fwCal = FwCheck.atLeast('0.4');
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
  const epdDriverSelect = document.getElementById('epddriver');
  const selectedOption = epdDriverSelect.options[epdDriverSelect.selectedIndex];
  const colorMode = selectedOption.getAttribute('data-color');
  const canvasSize = selectedOption.getAttribute('data-size');

  if (colorMode) document.getElementById('ditherMode').value = colorMode;
  if (canvasSize) document.getElementById('canvasSize').value = canvasSize;

  // Màn 7.5" V1 (UC8159): «làm mới mỗi giờ» ẩn vĩnh viễn, hiện ghi chú
  // nhịp cập nhật. («Chữ đậm» đã gỡ hẳn 2026-08-05.)
  const hfRow = document.getElementById('hourlyFullRow');
  const hint = document.getElementById('fourColorHint');
  if (hfRow) hfRow.style.display = 'none';
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
  // đồng bộ canvas 640×384 + chế độ màu + các row tùy chọn theo driver 08
  // ngay khi mở trang (thẻ <canvas> trong HTML vẫn là 400×300 thừa kế 4.2")
  updateDitcherOptions();
  updateButtonStatus();
  checkDebugMode();
}