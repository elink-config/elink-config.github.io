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
  document.getElementById("status").innerHTML = statusText;
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

/* ---- Thang xám thử nghiệm ------------------------------------------------
 * Màn e-ink BWR/BWRY KHÔNG có hạt màu xám: bảng quang học của panel chỉ khai
 * «2 Grey Level» (đen + trắng), còn «Gray 0..3» trong datasheet IC là tên bốn
 * kênh LUT của lõi điều khiển — trên panel bốn màu chúng ánh xạ thành ĐEN /
 * TRẮNG / VÀNG / ĐỎ chứ không phải bốn mức xám.
 * => Mọi sắc xám chỉ có được bằng TRỘN ĐIỂM (halftone) đen/trắng. Ảnh thử này
 * in đủ các mức trộn để soi trên máy thật: mức nào còn mịn, mức nào bắt đầu rỗ,
 * và kiểu trộn 50% nào (ô cờ / sọc ngang / sọc dọc) hợp với panel của bạn.
 * Vẽ bằng ĐIỂM ĐEN-TRẮNG THUẦN nên khâu dither phía sau giữ nguyên từng điểm. */
function grayRampTest() {
  const W = canvas.width, H = canvas.height;
  // ma trận Bayer: 4x4 cho các ô mức cố định, 8x8 cho dải chuyển mượt
  const B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const B8 = [];
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++)
      B8.push(B4[(y & 3) * 4 + (x & 3)] * 4 + B4[((y >> 2) & 3) * 4 + ((x >> 2) & 3)] / 4 | 0);

  fillCanvas('white');
  paintManager.clearElements();
  const img = ctx.getImageData(0, 0, W, H);
  const D = img.data;
  const put = (x, y, black) => {
    const o = (y * W + x) * 4;
    const v = black ? 0 : 255;
    D[o] = D[o + 1] = D[o + 2] = v; D[o + 3] = 255;
  };

  const fs = Math.max(9, Math.round(H / 25));      // cỡ chữ nhãn
  const lab = [];                                   // nhãn vẽ sau cùng
  const band = (y0, y1, x0, x1, fn) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) put(x, y, fn(x, y));
  };

  // --- Dải 1: 9 mức trộn cố định (0% -> 100% điểm đen), ma trận 4x4 ---
  const levels = [0, 2, 4, 6, 8, 10, 12, 14, 16];
  const y0 = Math.round(H * 0.12), y1 = Math.round(H * 0.30);
  levels.forEach((lv, i) => {
    const xa = Math.round(W * i / levels.length), xb = Math.round(W * (i + 1) / levels.length);
    band(y0, y1, xa, xb, (x, y) => B4[(y & 3) * 4 + (x & 3)] < lv);
    lab.push([Math.round(lv * 100 / 16) + '%', (xa + xb) / 2, y0 - 3, 'center']);
  });

  // --- Dải 2: ba kiểu trộn 50% để so độ mịn ---
  const y2 = Math.round(H * 0.40), y3 = Math.round(H * 0.56);
  const pat = [
    ['Ô cờ', (x, y) => ((x + y) & 1) === 0],
    ['Sọc ngang', (x, y) => (y & 1) === 0],
    ['Sọc dọc', (x, y) => (x & 1) === 0],
  ];
  pat.forEach(([nm, fn], i) => {
    const xa = Math.round(W * i / 3) + 2, xb = Math.round(W * (i + 1) / 3) - 2;
    band(y2, y3, xa, xb, fn);
    lab.push([nm + ' 50%', (xa + xb) / 2, y2 - 3, 'center']);
  });

  // --- Dải 3: chuyển mượt trắng -> đen (8x8) xem chỗ nào bị vằn ---
  const y4 = Math.round(H * 0.66), y5 = Math.round(H * 0.82);
  band(y4, y5, 0, W, (x, y) => B8[(y & 7) * 8 + (x & 7)] < (x / W) * 64);
  lab.push(['Chuyển mượt trắng → đen', W / 2, y4 - 3, 'center']);

  ctx.putImageData(img, 0, 0);

  // --- Dải 4: màu tham chiếu (vàng/đỏ chỉ có ở màn bốn/sáu màu) ---
  const md = (document.getElementById('ditherMode') || {}).value;
  const solids = (md === 'fourColor' || md === 'sixColor')
    ? [['ĐEN', '#000'], ['TRẮNG', '#fff'], ['VÀNG', '#ff0'], ['ĐỎ', '#f00']]
    : [['ĐEN', '#000'], ['TRẮNG', '#fff'], ['ĐỎ', '#f00']];
  const y6 = Math.round(H * 0.88), y7 = Math.round(H * 0.99);
  solids.forEach(([nm, css], i) => {
    const xa = Math.round(W * i / solids.length) + 2, xb = Math.round(W * (i + 1) / solids.length) - 2;
    ctx.fillStyle = css; ctx.fillRect(xa, y6, xb - xa, y7 - y6);
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(xa + 0.5, y6 + 0.5, xb - xa - 1, y7 - y6 - 1);
    lab.push([nm, (xa + xb) / 2, y6 - 3, 'center']);
  });

  ctx.fillStyle = '#000';
  ctx.font = 'bold ' + fs + 'px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('THANG XÁM (trộn điểm đen/trắng)', W / 2, fs);
  ctx.font = fs + 'px sans-serif';
  lab.forEach(([t, x, y, al]) => { ctx.textAlign = al; ctx.fillText(t, x, y); });
  ctx.textAlign = 'left';

  paintManager.saveToHistory();
  addLog('Đã vẽ ảnh thử thang xám — bấm «Gửi ảnh khe 1» để xem trên máy thật.');
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
