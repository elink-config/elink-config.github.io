// ---------------------------------------------------------------------------
// HÀM DÙNG CHUNG cho mọi app của hub (4.2 / 7.5 / 7.3 / 7.5B / 10.2 / 2.13 /
// 2.9 / máy đọc sách). Trước đây mỗi app chép lại nguyên mấy hàm này trong
// main.js của mình — sửa một lỗi phải sửa 7-9 nơi.
//
// QUY TẮC:
//  * connector.js nạp file này TRƯỚC main.js của app, nên app nào cần bản
//    riêng chỉ việc khai báo lại cùng tên trong main.js của nó — bản sau đè
//    lên bản ở đây, không phải sửa gì ở file này.
//  * Chỉ để ở đây những hàm GIỐNG HỆT nhau ở >= 7 app. Hàm nào mỗi máy một
//    khác (sendimg, handleNotify, connect, preConnect...) vẫn nằm trong main.js
//    của từng app.
//  * Các hàm ở đây dùng biến toàn cục do main.js khai báo (canvas, ctx,
//    paintManager, cropManager, epdCharacteristic...). Chúng chỉ chạy sau khi
//    app đã nạp xong nên không sao, nhưng ĐỪNG gọi chúng ở cấp file.
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

function waitMtuNotify(timeoutMs) {
  return new Promise(resolve => {
    const t = setTimeout(() => { mtuNotifyResolve = null; resolve(false); }, timeoutMs);
    mtuNotifyResolve = () => { clearTimeout(t); resolve(true); };
  });
}

// live system-time display in the [Thời gian] section
function tickSystemTime() {
  const el = document.getElementById('systemTime');
  if (el) el.textContent = new Date().toLocaleString('vi-VN');
}

async function reConnect() {
  if (bleDevice != null && bleDevice.gatt.connected)
    bleDevice.gatt.disconnect();
  resetVariables();
  addLog("Đang kết nối lại");
  await connect();
}

function setStatus(statusText) {
  const el = document.getElementById("status");
  if (!el) return;
  el.innerHTML = statusText;
  // Thanh trạng thái RỖNG thì ẩn hẳn. Trước đây một lượt gửi dừng giữa chừng
  // để lại cái thanh xanh trống trơn nằm chắn giữa giao diện.
  const bar = el.parentElement;
  if (bar && bar.classList.contains('status-bar'))
    bar.style.display = statusText ? 'block' : 'none';
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

// CRC32 chuẩn (IEEE 802.3) — bootloader kiểm CRC này trước khi chạy bank mới
function crc32buf(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
  }
  return (crc ^ -1) | 0;
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

/* ---- Màn chờ CHẶN THAO TÁC khi đang đồng bộ dữ liệu xuống máy --------------
 * Bộ chữ tiếng Việt + bảng âm lịch nằm ở flash chứ không nằm trong firmware
 * (để trả RAM), nên máy vừa lên firmware qua OTA phải được nạp gần 500 gói —
 * mất hàng chục giây. Bấm nút khác trong lúc đó là lệnh chen vào giữa luồng,
 * máy nhận nhầm và giao diện đứng im như treo. Phủ kín màn hình để KHÔNG ai
 * bấm được gì cho tới khi xong.
 * Mọi bước trong luồng nạp đều có đồng hồ đếm ngược nên lớp phủ này luôn được
 * gỡ; đồng hồ 5 phút bên dưới chỉ là chốt chặn cuối, phòng lỗi ngoài dự tính. */
let syncOverlayGuard = null;
// Đếm LỒNG NHAU: gửi bố cục có gọi vào đường gửi ảnh, mà đường đó cũng bật/tắt
// lớp phủ — không đếm thì bước con xong là lớp phủ biến mất giữa chừng.
let syncOverlayDepth = 0;

// đổi chữ trên lớp phủ đang mở mà KHÔNG động tới bộ đếm lồng nhau
function syncOverlayStep(title, note) {
  const t = document.getElementById('syncOverlayTitle');
  if (!t) return;
  t.textContent = title;
  const n = document.getElementById('syncOverlayNote');
  if (n && note) n.textContent = note;
}

function syncOverlayShow(title, note) {
  syncOverlayDepth++;
  let ov = document.getElementById('syncOverlay');
  if (!ov) {
    const st = document.createElement('style');
    st.textContent = '@keyframes syncSpin{to{transform:rotate(360deg)}}';
    document.head.appendChild(st);

    ov = document.createElement('div');
    ov.id = 'syncOverlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;' +
      'align-items:center;justify-content:center;padding:20px;' +
      'background:rgba(15,23,42,.55);backdrop-filter:blur(2px)';
    ov.innerHTML =
      '<div style="max-width:380px;width:100%;text-align:center;padding:30px 26px;' +
        'border-radius:24px;background:var(--md-sys-color-surface-container,#fff);' +
        'color:var(--md-sys-color-on-surface,#1a1c1e);' +
        'box-shadow:0 4px 16px rgba(15,23,42,.18),0 8px 32px rgba(0,100,148,.14)">' +
        '<div style="width:44px;height:44px;margin:0 auto 18px;border-radius:50%;' +
          'border:4px solid var(--md-sys-color-primary-container,#c8e6ff);' +
          'border-top-color:var(--md-sys-color-primary,#006494);' +
          'animation:syncSpin 900ms linear infinite"></div>' +
        '<div id="syncOverlayTitle" style="font-size:1.05rem;font-weight:600;margin-bottom:8px"></div>' +
        '<div id="syncOverlayNote" style="font-size:.88rem;line-height:1.5;' +
          'color:var(--md-sys-color-on-surface-variant,#43474e)"></div>' +
        '<div style="height:6px;margin-top:18px;border-radius:3px;overflow:hidden;' +
          'background:var(--md-sys-color-surface-container-high,#eef2f7)">' +
          '<div id="syncOverlayBar" style="height:100%;width:0%;border-radius:3px;' +
            'background:var(--md-sys-color-primary,#006494);transition:width .2s"></div>' +
        '</div>' +
        '<div id="syncOverlayPct" style="margin-top:8px;font-size:.8rem;' +
          'color:var(--md-sys-color-on-surface-variant,#43474e)"></div>' +
      '</div>';
    document.body.appendChild(ov);
  }
  document.getElementById('syncOverlayTitle').textContent =
    title || 'Đang đồng bộ dữ liệu, vui lòng chờ…';
  document.getElementById('syncOverlayNote').textContent = note ||
    'Thiết bị đang nhận bộ chữ tiếng Việt và bảng âm lịch. Vui lòng không tắt máy, ' +
    'không đóng trang và chờ đến khi xong rồi hãy thao tác tiếp.';
  document.getElementById('syncOverlayPct').textContent = '';
  document.getElementById('syncOverlayBar').style.width = '0%';
  ov.style.display = 'flex';
  if (syncOverlayGuard) clearTimeout(syncOverlayGuard);
  syncOverlayGuard = setTimeout(function () { syncOverlayHide(true); }, 300000);
}

function syncOverlayProgress(done, total) {
  const bar = document.getElementById('syncOverlayBar');
  if (!bar || !total) return;
  const pct = Math.min(100, Math.round(done * 100 / total));
  bar.style.width = pct + '%';
  const pctEl = document.getElementById('syncOverlayPct');
  if (pctEl) pctEl.textContent = pct + '%';
}

function syncOverlayHide(force) {
  if (force) syncOverlayDepth = 0;
  else if (syncOverlayDepth > 0) syncOverlayDepth--;
  if (syncOverlayDepth > 0) return;      // còn bước ngoài đang chạy
  if (syncOverlayGuard) { clearTimeout(syncOverlayGuard); syncOverlayGuard = null; }
  const ov = document.getElementById('syncOverlay');
  if (ov) ov.style.display = 'none';
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
