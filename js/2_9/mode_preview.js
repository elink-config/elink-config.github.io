/*
 * Mode gallery bản 2.9" (296×128): firmware MỘT chế độ nên chỉ có 2 thẻ —
 * «Đồng hồ + lịch âm» (mode 1) và «Ảnh đã lưu» (mode 28, đặt bằng 0x94 01).
 * Preview vẽ ở đúng kích thước panel, supersample 2x, phỏng theo bố cục
 * layouts[2] (296×128) của firmware. Các chế độ mới sẽ thêm TRƯỚC thẻ
 * «Ảnh đã lưu» — giữ đúng quy tắc của bản 2.13".
 */
(function () {
  const BK = '#151515', WH = '#f6f4ec', GY = '#555';
  const WD_FULL = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];

  // panel cố định 296×128 (PANEL_W/H của main.js nếu đã nạp)
  function panelSize() {
    if (typeof PANEL_W !== 'undefined') return { w: PANEL_W, h: PANEL_H };
    return { w: 296, h: 128 };
  }

  function ctx2d(canvas, w, h) {
    const x = canvas.getContext('2d');
    x.setTransform(2, 0, 0, 2, 0, 0); // 2x supersample
    x.fillStyle = WH;
    x.fillRect(0, 0, w, h);
    return x;
  }
  function font(x, s, b) { x.font = (b ? 'bold ' : '') + s + 'px "Segoe UI",Arial,sans-serif'; }
  function line(x, a, b, c, d, col, w) {
    x.strokeStyle = col || BK; x.lineWidth = w || 1;
    x.beginPath(); x.moveTo(a, b); x.lineTo(c, d); x.stroke();
  }
  function center(x, s, cx, y, col) {
    x.textAlign = 'center'; if (col) x.fillStyle = col; x.fillText(s, cx, y); x.textAlign = 'left';
  }
  function right(x, s, rx, y, col) {
    x.textAlign = 'right'; if (col) x.fillStyle = col; x.fillText(s, rx, y); x.textAlign = 'left';
  }

  // pin của firmware: khung 15×9, đầu (nub) bên TRÁI, điện áp "X.Xv" chữ nhỏ
  // bên trái icon. Mức pin theo điện áp tuyến tính: 3.5V = đầy, 2.5V = cạn.
  function battery(x, bx, by, col, label) {
    col = col || BK;
    x.strokeStyle = col; x.lineWidth = 1;
    x.strokeRect(bx + 0.5, by + 0.5, 14, 8);
    x.fillStyle = col;
    x.fillRect(bx - 2, by + 3, 2, 3);           // nub bên trái (icon "xoay 180°")
    const p = Math.max(0, Math.min(10, Math.round((voltValue() - 2.5) * 10)));
    if (p > 0) x.fillRect(bx + 12 - p, by + 2, p + 1, 5);   // đầy từ bên phải
    if (label) { font(x, 8, 0); right(x, label, bx - 4, by + 7.5, col); }
  }
  function voltValue() {
    const el = document.getElementById('battVolt');
    if (el && /\d/.test(el.textContent)) {
      const v = parseFloat(el.textContent);
      if (v > 0) return v;
    }
    return 3.1;
  }
  function voltLabel() { return voltValue().toFixed(1) + 'v'; }
  function panelTempVal() {
    const el = document.getElementById('panelTemp');
    if (el && /-?\d/.test(el.textContent)) return parseInt(el.textContent);
    return 28;
  }
  function statusBatt(x, W) { battery(x, W - 16, 3, BK, voltLabel()); }

  function pad2(n) { return String(n).padStart(2, '0'); }
  function dateLine(now) {
    return WD_FULL[now.getDay()] + ' ' + pad2(now.getDate()) + '/' + pad2(now.getMonth() + 1) + '/' + now.getFullYear();
  }
  // âm lịch hôm nay "Âm lịch d/m" — dùng lunarToday() của main.js nếu có
  function lunarStr(now) {
    try {
      const l = lunarToday(now);
      return 'Âm lịch ' + l.day + '/' + (l.month & 0x7f) + ((l.month & 0x80) ? 'n' : '');
    } catch (e) { return 'Âm lịch 27/5'; }
  }

  // --- mode 1: Đồng hồ + lịch âm — ngày ĐẬM sát góc trái, pin + điện áp góc
  // phải, hàng dưới: Âm lịch ĐẬM + tiết khí + nhiệt độ góc phải ---
  function m1(x, now, W, H) {
    font(x, 10, 1); x.fillStyle = BK;
    x.fillText(dateLine(now), 4, 11);
    statusBatt(x, W);
    // giờ font Hobo Std (khớp firmware F_HOBO — máy không có font thì cursive)
    x.font = Math.round(H * 0.5) + 'px "Hobo Std","HoboStd",cursive';
    center(x, pad2(now.getHours()) + ':' + pad2(now.getMinutes()), W / 2, H * 0.62, BK);
    font(x, 9, 1); x.fillStyle = BK;
    x.fillText(lunarStr(now), 10, H - 5);         // hàng dưới hạ sát mép (khớp fw y=107)
    font(x, 9, 0);
    center(x, 'Đông chí', W / 2 + 14, H - 5, BK);
    right(x, panelTempVal() + '°C', W - 4, H - 5, BK);
  }

  // --- Ảnh đã lưu (fw mode 28, đặt bằng 0x94 01) ---
  function mImg(x, now, W, H) {
    x.strokeStyle = BK; x.lineWidth = 1; x.strokeRect(4.5, 4.5, W - 9, H - 9);
    x.beginPath(); x.arc(W * 0.3, H * 0.32, H * 0.1, 0, 7); x.stroke();
    line(x, 8, H - 12, W * 0.4, H * 0.42, BK, 1.2);
    line(x, W * 0.4, H * 0.42, W * 0.62, H - 18, BK, 1.2);
    line(x, W * 0.55, H * 0.6, W * 0.72, H * 0.42, BK, 1.2);
    line(x, W * 0.72, H * 0.42, W - 8, H - 12, BK, 1.2);
    font(x, 9, 0); x.fillStyle = GY;
    center(x, 'Ảnh đã lưu trong flash', W / 2, H - 8, GY);
  }

  // «Ảnh đã lưu» LUÔN đứng cuối — chế độ mới thêm vào TRƯỚC nó.
  const MODE_LIST = [
    { mode: 1, name: 'Đồng hồ + lịch âm', tick: 'Làm mới mỗi phút', draw: m1 },
    { mode: 'img', name: 'Ảnh đã lưu', tick: 'Ảnh tĩnh từ flash', draw: mImg },
  ];

  // highlight the mode the device reports or was just set to
  window.highlightMode = function (mode) {
    document.querySelectorAll('.mode-card').forEach(card => {
      card.classList.toggle('active', String(card.dataset.mode) === String(mode));
    });
  };

  function drawAll(t) {
    const { w, h } = panelSize();
    document.querySelectorAll('.mode-card').forEach((card, i) => {
      const m = MODE_LIST[i];
      if (!m) return;
      m.draw(ctx2d(card.querySelector('canvas'), w, h), t, w, h);
    });
  }
  window.redrawModePreviews = () => drawAll(new Date());

  function build() {
    const gallery = document.getElementById('modeGallery');
    if (!gallery) return;
    gallery.innerHTML = '';
    const { w, h } = panelSize();
    const now = new Date();
    for (const m of MODE_LIST) {
      const card = document.createElement('div');
      card.className = 'mode-card';
      card.dataset.mode = m.mode;
      card.innerHTML =
        '<canvas width="' + (w * 2) + '" height="' + (h * 2) + '"></canvas>' +
        '<div class="mode-name">' + m.name + '</div>' +
        '<div class="mode-tick">' + m.tick + '</div>' +
        '<button id="applybtn-' + m.mode + '" type="button" class="primary" onclick="applyMode(\'' + m.mode + '\')">Áp dụng</button>';
      gallery.appendChild(card);
      try { m.draw(ctx2d(card.querySelector('canvas'), w, h), now, w, h); }
      catch (e) { console.error('preview mode ' + m.mode, e); }
    }
    if (deviceMode != null) window.highlightMode(deviceMode === 28 ? 'img' : deviceMode);
    if (typeof updateButtonStatus === 'function') updateButtonStatus();
  }

  window.rebuildModeGallery = build;

  // redraw thumbnails each minute so the clock preview stays current
  setInterval(() => drawAll(new Date()), 60000);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
