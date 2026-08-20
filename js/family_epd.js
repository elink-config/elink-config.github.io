// ---------------------------------------------------------------------------
// HÀM DÙNG CHUNG cho họ EPD 4.2" — 4.2" (3 màu & 4 màu), 7.5", 7.5" chữ lớn, 7.3" sáu màu,
// 10.2". Cùng dịch vụ BLE 62750001-… và cùng bộ lệnh 0x00-0x99.
//
// Chỉ chứa hàm GIỐNG HỆT NHAU ở mọi app trong họ. Hàm nào mỗi máy một khác
// vẫn nằm ở main.js của app đó.
// THỨ TỰ NẠP: app_common.js -> file này -> main.js của app, nên app cần bản
// riêng chỉ việc khai báo lại cùng tên trong main.js (khai báo sau đè lên).
// ---------------------------------------------------------------------------

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

function waitImgRdy(timeoutMs) {
  return new Promise(resolve => {
    const t = setTimeout(() => { imgRdyResolve = null; resolve(false); }, timeoutMs);
    imgRdyResolve = (ok) => { clearTimeout(t); resolve(ok); };
  });
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
    // app 4.2 đánh lại số mode từ BWR v2.6 / 4 màu v3.6; máy đời cũ vẫn hiểu
    // bảng số cũ nên quy đổi ở đây. App khác không định nghĩa modeToWire.
    (typeof modeToWire === 'function') ? modeToWire(mode) : mode
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

function disconnect() {
  updateButtonStatus();
  resetVariables();
  addLog('Đã ngắt kết nối.');
  document.getElementById("connectbutton").innerHTML = 'Kết nối';
  // gate lại theo firmware của thiết bị kế tiếp
  document.getElementById('imgAutoRow').style.display = 'none';
  imgSlotMask = 0;
}

// ---- Tự động đổi ảnh giữa các khe (1 -> 2 -> 3 -> 1) ----
// checkbox + radio chỉ dùng được khi thiết bị đã có >= 2 khe ảnh; radio chỉ
// dùng được khi checkbox bật (yêu cầu tính năng v1.5)
function slotCount(mask) {
  let n = 0;
  // chỉ đếm KHE ẢNH; khe nền của «Tự thiết kế» nằm ở bit 5/6, không tính
  const total = (typeof IMG_SLOTS === "number") ? IMG_SLOTS : 3;
  for (let i = 0; i < total; i++) if (mask & (1 << i)) n++;
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
    ? `Đã có ảnh ở ${slotCount(imgSlotMask)} khe — thiết bị sẽ tự chuyển khe theo chu kỳ đã chọn (mốc tính theo 00:00). Đổi chu kỳ thì bộ đếm bắt đầu lại từ đầu.`
    : `Cần gửi ảnh vào ít nhất 2 khe để bật tự đổi ảnh (lần lượt khe 1 → ${(typeof IMG_SLOTS === 'number') ? IMG_SLOTS : 3} → quay lại 1).`;
}

async function setImgAuto() {
  const auto = document.getElementById('imgAutoCHK').checked ? 1 : 0;
  const sel = document.querySelector('input[name="imgInterval"]:checked');
  const hours = sel ? parseInt(sel.value) : 24;
  updateImgAutoUI();
  if (await write(EpdCmd.IMG_SLOT, [0x03, auto, hours])) {
    if (!auto) { addLog('Đã tắt tự động đổi ảnh.'); return; }
    // vòng đổi THẬT: chỉ gồm khe đang có ảnh (trước đây ghi cứng «1 → 2 → 3»
    // nên máy 5 khe đọc log ra sai)
    const total = (typeof IMG_SLOTS === 'number') ? IMG_SLOTS : 3;
    const order = [];
    for (let i = 0; i < total; i++) if (imgSlotMask & (1 << i)) order.push(i + 1);
    // Mốc đổi ảnh của máy là timestamp / (chu kỳ x 3600) — 1/12/24 giờ đều
    // chia hết 86400 nên mốc luôn rơi đúng đầu giờ, canh theo 00:00. Tính ra
    // giờ đồng hồ cho người dùng biết lần đổi kế tiếp rơi vào lúc nào.
    const now = new Date();
    const tzs = now.getTimezoneOffset() * 60;
    const devNow = Math.floor(now.getTime() / 1000) - tzs;   // đúng giá trị máy đang giữ
    const nextDev = (Math.floor(devNow / (hours * 3600)) + 1) * hours * 3600;
    const nextLocal = new Date((nextDev + tzs) * 1000);
    addLog(`Đã bật tự động đổi ảnh mỗi ${hours} giờ (lần lượt khe ${order.join(' → ')} → ${order[0]}). ` +
           `Bộ đếm bắt đầu lại từ bây giờ — lần đổi kế tiếp vào ${nextLocal.toLocaleString('vi-VN')}.`);
  }
}

function updateCanvasSize() {
  const selectedSizeName = document.getElementById('canvasSize').value;
  const selectedSize = canvasSizes.find(size => size.name === selectedSizeName);

  canvas.width = selectedSize.width;
  canvas.height = selectedSize.height;

  updateImage();
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
