/*
 * Thiết kế màn hình (mode 27) — như mode 20 của EPD-DA14585-4_2inch:
 * kéo thả các thành phần trên canvas đúng kích thước panel, xem trước như
 * thiết bị vẽ, rồi gửi bố cục 158 byte bằng lệnh 0x9b (thiết bị tự chuyển
 * sang mode 27 và lưu vào flash).
 *
 * Payload (sau byte lệnh 0x9b):
 *   [0] count  [1] frame  [2..61] 10 x {type u8, size u8, x i16LE, y i16LE}
 *   [62..109] text1 (UTF-8, đệm NUL, 48B)  [110..157] text2 (48B)
 */
(function () {
  const LS_KEY = 'customLayout_2_13_v1';
  const MAXW = 10;
  const BK = '#151515', WH = '#f6f4ec';
  const WD_SUN = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const WD_FULL = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];

  function panelW() { return (typeof PANEL_W !== 'undefined') ? PANEL_W : 296; }
  function panelH() { return (typeof PANEL_H !== 'undefined') ? PANEL_H : 128; }

  // kích thước khung mỗi thành phần theo size — khớp hình firmware vẽ
  const TYPES = {
    1: { name: 'Giờ số', sizes: 3, dim: s => [[42, 16], [82, 30], [164, 56]][s] },
    2: { name: 'Đồng hồ kim', sizes: 3, dim: s => { const r = [22, 32, 46][s]; return [2 * r, 2 * r]; } },
    3: { name: 'Pin', sizes: 1, dim: () => [48, 11] },
    4: { name: 'Nhiệt độ', sizes: 2, dim: s => s ? [66, 28] : [34, 15] },
    5: { name: 'Ngày tháng', sizes: 2, dim: s => s ? [280, 28] : [140, 15] },
    6: { name: 'Âm lịch', sizes: 2, dim: s => s ? [196, 28] : [98, 15] },
    7: { name: 'Lịch tháng', sizes: 3, dim: s => [[70, 66], [91, 78], [112, 90]][s] },
    8: { name: 'Chữ 1', sizes: 2, dim: null },
    9: { name: 'Chữ 2', sizes: 2, dim: null },
    10: { name: 'Ảnh', sizes: 3, dim: s => iconDim(s) },
    11: { name: 'Thứ', sizes: 2, dim: s => s ? [130, 28] : [66, 15] },
    12: { name: 'Ngày', sizes: 2, dim: s => s ? [162, 28] : [82, 15] },
  };

  // kích thước tối đa của Ảnh theo size (đổi cỡ = mã hoá lại từ ảnh gốc)
  const ICON_DIMS = [40, 64, 96];

  let st = { widgets: [], frame: 0, t1: '', t2: '' };   // st.icon = dataURL ảnh gốc
  let sel = -1, canvas, ctx, dragOff = null;
  let iconEl = null, iconCache = {};                    // ảnh gốc + bitmap 1-bit theo size

  try { const s = JSON.parse(localStorage.getItem(LS_KEY)); if (s && s.widgets) st = s; } catch (e) {}

  function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(st)); } catch (e) {} }

  function fnt(px, b) { ctx.font = (b ? 'bold ' : '') + px + 'px "Segoe UI",Arial,sans-serif'; }

  /* ---- Ảnh (icon) 1-bit: giữ ảnh gốc, mã hoá lại theo size đã chọn ---- */

  function iconDim(s) {
    const m = ICON_DIMS[s];
    if (!iconEl || !iconEl.complete || !iconEl.naturalWidth) return [m, m];
    const k = Math.min(1, m / iconEl.naturalWidth, m / iconEl.naturalHeight);
    return [Math.max(1, Math.round(iconEl.naturalWidth * k)),
            Math.max(1, Math.round(iconEl.naturalHeight * k))];
  }

  // trả về {w, h, bits(Uint8Array), cv(canvas 1-bit xem trước)} theo size
  function iconBitsFor(s) {
    if (!iconEl || !iconEl.complete || !iconEl.naturalWidth) return null;
    if (iconCache[s]) return iconCache[s];
    const [w, h] = iconDim(s);
    const oc = document.createElement('canvas');
    oc.width = w; oc.height = h;
    const og = oc.getContext('2d');
    og.fillStyle = '#fff'; og.fillRect(0, 0, w, h);
    og.drawImage(iconEl, 0, 0, w, h);
    const d = og.getImageData(0, 0, w, h).data;
    const stride = (w + 7) >> 3;
    const bits = new Uint8Array(stride * h);
    const pv = document.createElement('canvas');
    pv.width = w; pv.height = h;
    const pg = pv.getContext('2d');
    const pid = pg.createImageData(w, h);
    for (let yy = 0; yy < h; yy++)
      for (let xx = 0; xx < w; xx++) {
        const i = (yy * w + xx) * 4;
        const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        if (lum < 140 && d[i + 3] > 127) {
          bits[yy * stride + (xx >> 3)] |= 0x80 >> (xx & 7);
          const j = (yy * w + xx) * 4;
          pid.data[j] = 21; pid.data[j + 1] = 21; pid.data[j + 2] = 21; pid.data[j + 3] = 255;
        }
      }
    pg.putImageData(pid, 0, 0);
    iconCache[s] = { w: w, h: h, bits: bits, cv: pv };
    return iconCache[s];
  }

  function loadIconEl() {
    if (!st.icon) { iconEl = null; iconCache = {}; return; }
    iconEl = new Image();
    iconEl.onload = () => { iconCache = {}; st.widgets.forEach(clampW); redraw(); };
    iconEl.src = st.icon;
  }

  window.dsIconFile = function (input) {
    const f = input.files && input.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      st.icon = rd.result;
      iconCache = {};
      loadIconEl();
      if (!st.widgets.some(w => w.type === 10)) dsAdd(10);
      save(); redraw();
      addLog('Ảnh đã sẵn sàng — «Đổi cỡ» để chọn 1 trong 3 cỡ, gửi cùng thiết kế.');
    };
    rd.readAsDataURL(f);
    input.value = '';
  };

  function textOf(w) { return w.type === 8 ? (st.t1 || 'Chữ 1') : (st.t2 || 'Chữ 2'); }

  function dimOf(w) {
    const t = TYPES[w.type];
    if (t.dim) return t.dim(w.size);
    // ô chữ: đo gần đúng theo unifont đơn cách 8px/ký tự (x2 khi size 1)
    const n = [...textOf(w)].length;
    return [Math.min(panelW() - 2, n * (w.size ? 16 : 8) + 2), w.size ? 28 : 15];
  }

  /* ---- vẽ (khớp toạ độ firmware để vị trí chuyển 1:1) ---- */

  function face(x, cx, cy, r, now) {
    x.strokeStyle = BK; x.lineWidth = 2;
    x.beginPath(); x.arc(cx, cy, r, 0, 7); x.stroke();
    x.lineWidth = 1;
    for (let k = 0; k < 60; k += 5) {
      const a = k * Math.PI / 30;
      x.beginPath();
      x.moveTo(cx + (r - 3) * Math.sin(a), cy - (r - 3) * Math.cos(a));
      x.lineTo(cx + (r - 7) * Math.sin(a), cy - (r - 7) * Math.cos(a));
      x.stroke();
    }
    const h = now.getHours() % 12, m = now.getMinutes();
    const ha = (h + m / 60) * Math.PI / 6, ma = m * Math.PI / 30;
    x.lineCap = 'round';
    x.lineWidth = 3; x.beginPath(); x.moveTo(cx, cy);
    x.lineTo(cx + r * 0.5 * Math.sin(ha), cy - r * 0.5 * Math.cos(ha)); x.stroke();
    x.lineWidth = 2; x.beginPath(); x.moveTo(cx, cy);
    x.lineTo(cx + r * 0.75 * Math.sin(ma), cy - r * 0.75 * Math.cos(ma)); x.stroke();
    x.lineCap = 'butt';
    x.fillStyle = BK; x.beginPath(); x.arc(cx, cy, 2, 0, 7); x.fill();
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function lunarTxt() {
    try { const l = lunarToday(new Date()); return 'Âm lịch ' + l.day + '/' + (l.month & 0x7f); }
    catch (e) { return 'Âm lịch 24/5'; }
  }

  function drawWidget(x, w, now) {
    const s = w.size;
    switch (w.type) {
      case 1: {
        const t = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
        if (s === 2) {
          x.font = '52px "Hobo Std","HoboStd",cursive'; x.fillStyle = BK;
          x.fillText(t, w.x, w.y + 46);
        } else {
          fnt(s ? 26 : 13, true); x.fillStyle = BK;
          x.fillText(t, w.x, w.y + (s ? 24 : 12));
        }
      } break;
      case 2: {
        const r = [22, 32, 46][s];
        const ccx = w.x + r, ccy = w.y + r;
        face(x, ccx, ccy, r, now);
        // số 12/3/6/9 nhỏ trong mặt (khớp firmware)
        fnt(7, false); x.fillStyle = BK; x.textAlign = 'center';
        x.fillText('12', ccx, ccy - r + 10);
        x.fillText('3', ccx + r - 8, ccy + 3);
        x.fillText('6', ccx, ccy + r - 5);
        x.fillText('9', ccx - r + 8, ccy + 3);
        x.textAlign = 'left';
      } break;
      case 3: {
        fnt(8, false); x.fillStyle = BK;
        const v = (typeof voltValue === 'function') ? voltValue().toFixed(1) : '3.1';
        x.fillText(v + 'v', w.x, w.y + 8);
        x.strokeStyle = BK; x.lineWidth = 1;
        x.strokeRect(w.x + 32.5, w.y + 0.5, 14, 9);
        x.fillRect(w.x + 30, w.y + 3, 2, 3);
        x.fillRect(w.x + 36, w.y + 2, 9, 6);
      } break;
      case 4: case 5: case 6: case 8: case 9: case 11: case 12: {
        let t;
        if (w.type === 4) t = ((typeof panelTempVal === 'function') ? panelTempVal() : 28) + '°C';
        else if (w.type === 5) t = WD_FULL[now.getDay()] + ' ' + pad2(now.getDate()) + '/' + pad2(now.getMonth() + 1) + '/' + now.getFullYear();
        else if (w.type === 11) t = WD_FULL[now.getDay()];
        else if (w.type === 12) t = pad2(now.getDate()) + '/' + pad2(now.getMonth() + 1) + '/' + now.getFullYear();
        else if (w.type === 6) t = lunarTxt();
        else t = textOf(w);
        fnt(s ? 26 : 13, w.type === 8 || w.type === 9); x.fillStyle = BK;
        x.fillText(t, w.x, w.y + (s ? 24 : 12));
      } break;
      case 10: {
        const ic = iconBitsFor(s);
        if (ic) x.drawImage(ic.cv, w.x, w.y);
        else {
          x.strokeStyle = BK; x.lineWidth = 1;
          x.strokeRect(w.x + 0.5, w.y + 0.5, 30, 30);
          x.beginPath(); x.moveTo(w.x, w.y); x.lineTo(w.x + 30, w.y + 30);
          x.moveTo(w.x + 30, w.y); x.lineTo(w.x, w.y + 30); x.stroke();
        }
      } break;
      case 7: {
        const cw = [10, 13, 16][s], rh = [9, 11, 13][s];
        fnt(7, true);
        x.textAlign = 'center';
        for (let i = 0; i < 7; i++) { x.fillStyle = BK; x.fillText(WD_SUN[i], w.x + i * cw + cw / 2, w.y + 7); }
        x.strokeStyle = BK; x.lineWidth = 1;
        x.beginPath(); x.moveTo(w.x, w.y + 8.5); x.lineTo(w.x + cw * 7 - 2, w.y + 8.5); x.stroke();
        const first = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
        const maxD = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        fnt(7, true);
        for (let d = 1; d <= maxD; d++) {
          const col = (first + d - 1) % 7, row = (first + d - 1) / 7 | 0;
          const cx = w.x + col * cw + cw / 2, cy = w.y + 11 + row * rh;
          const today = d === now.getDate();
          if (today) { x.fillStyle = BK; x.fillRect(cx - cw / 2, cy - 1, cw - 1, rh - 1); }
          x.fillStyle = today ? WH : BK;
          x.fillText(d, cx, cy + 6);
        }
        x.textAlign = 'left';
      } break;
    }
  }

  function renderLayout(x, now, withSelection) {
    const W = panelW(), H = panelH();
    x.fillStyle = WH; x.fillRect(0, 0, W, H);
    if (st.frame >= 1) { x.strokeStyle = BK; x.lineWidth = 1; x.strokeRect(1.5, 1.5, W - 3, H - 3); }
    if (st.frame >= 2) x.strokeRect(3.5, 3.5, W - 7, H - 7);
    st.widgets.forEach(w => drawWidget(x, w, now));
    if (withSelection && sel >= 0 && st.widgets[sel]) {
      const w = st.widgets[sel], [bw, bh] = dimOf(w);
      x.strokeStyle = '#1a73e8'; x.lineWidth = 1; x.setLineDash([4, 3]);
      x.strokeRect(w.x - 2.5, w.y - 2.5, bw + 5, bh + 5);
      x.setLineDash([]);
    }
  }

  // thẻ «Tự thiết kế» trong thư viện giao diện vẽ qua hook này
  window.renderCustomLayout = function (x, now, W, H) {
    if (!st.widgets.length) {
      x.font = '11px "Segoe UI",Arial,sans-serif'; x.fillStyle = BK; x.textAlign = 'center';
      x.fillText('Chưa có giao diện tự thiết kế', W / 2, H / 2 - 6);
      x.fillText('Tạo trong mục «Thiết kế màn hình»', W / 2, H / 2 + 12);
      x.textAlign = 'left';
      return;
    }
    renderLayout(x, now, false);
  };

  function redraw() { if (ctx) renderLayout(ctx, new Date(), true); }

  /* ---- tương tác ---- */

  function hit(px, py) {
    for (let i = st.widgets.length - 1; i >= 0; i--) {
      const w = st.widgets[i], [bw, bh] = dimOf(w);
      if (px >= w.x - 3 && px <= w.x + bw + 3 && py >= w.y - 3 && py <= w.y + bh + 3) return i;
    }
    return -1;
  }

  function evPos(ev) {
    const r = canvas.getBoundingClientRect();
    const t = ev.touches ? ev.touches[0] : ev;
    return [(t.clientX - r.left) * panelW() / r.width, (t.clientY - r.top) * panelH() / r.height];
  }

  function clampW(w) {
    const [bw, bh] = dimOf(w);
    w.x = Math.round(Math.max(0, Math.min(panelW() - bw, w.x)));
    w.y = Math.round(Math.max(0, Math.min(panelH() - bh, w.y)));
  }

  window.dsAdd = function (type) {
    if (st.widgets.length >= MAXW) { alert('Tối đa ' + MAXW + ' thành phần.'); return; }
    if ((type === 8 || type === 9) && st.widgets.some(w => w.type === type)) {
      alert('Mỗi ô chữ chỉ dùng được một lần.'); return;
    }
    const w = { type: type, size: 0, x: (panelW() / 2 - 20) | 0, y: (panelH() / 2 - 8) | 0 };
    clampW(w);
    st.widgets.push(w);
    sel = st.widgets.length - 1;
    save(); redraw();
  };

  window.dsCycleSize = function () {
    if (sel < 0 || !st.widgets[sel]) return;
    const w = st.widgets[sel];
    w.size = (w.size + 1) % TYPES[w.type].sizes;
    clampW(w); save(); redraw();
  };

  window.dsDelete = function () {
    if (sel < 0) return;
    st.widgets.splice(sel, 1);
    sel = -1; save(); redraw();
  };

  window.dsClear = function () {
    if (!confirm('Xóa toàn bộ thiết kế?')) return;
    st.widgets = []; sel = -1; save(); redraw();
  };

  window.dsSetFrame = function (v) { st.frame = Number(v) || 0; save(); redraw(); };

  window.dsTexts = function () {
    st.t1 = document.getElementById('dsText1').value;
    st.t2 = document.getElementById('dsText2').value;
    save(); redraw();
  };

  /* ---- gửi (0x9b) ---- */

  window.dsUpload = async function () {
    if (!st.widgets.length) { alert('Thiết kế còn trống — hãy thêm ít nhất một thành phần.'); return; }

    // Ảnh đi trước (0x9c, chia khối) — cỡ theo size của thành phần Ảnh
    const iconW = st.widgets.find(w => w.type === 10);
    if (iconW) {
      const ic = iconBitsFor(iconW.size);
      if (!ic) { alert('Thiết kế có «Ảnh» nhưng chưa chọn tệp ảnh cho nó.'); return; }
      const mtu = parseInt(document.getElementById('mtusize').value) || 244;
      const chunk = Math.max(16, mtu - 8);
      addLog('Đang gửi ảnh ' + ic.w + 'x' + ic.h + ' (' + ic.bits.length + ' byte)…');
      const n0 = Math.min(chunk, ic.bits.length);
      const first = new Uint8Array(4 + n0);
      first.set([0x9c, 0x00, ic.w, ic.h]);
      first.set(ic.bits.slice(0, n0), 4);
      if (!await write(first, true)) return;
      for (let off = n0; off < ic.bits.length; off += chunk) {
        const part = ic.bits.slice(off, off + chunk);
        const pkt = new Uint8Array(2 + part.length);
        pkt.set([0x9c, 0x01]);
        pkt.set(part, 2);
        if (!await write(pkt, true)) return;
      }
      if (!await write([0x9c, 0x02])) return;
      addLog('Ảnh đã gửi xong.');
    }

    const enc = new TextEncoder();
    const t1 = enc.encode(st.t1), t2 = enc.encode(st.t2);
    if (t1.length > 47 || t2.length > 47) {
      alert('Ô chữ quá dài (tối đa 47 byte; chữ có dấu chiếm 2-3 byte mỗi chữ).');
      return;
    }
    const buf = new Uint8Array(1 + 158);
    buf[0] = 0x9b;
    buf[1] = st.widgets.length;
    buf[2] = st.frame;
    st.widgets.forEach((w, i) => {
      const o = 3 + i * 6;
      buf[o] = w.type; buf[o + 1] = w.size;
      buf[o + 2] = w.x & 0xFF; buf[o + 3] = (w.x >> 8) & 0xFF;
      buf[o + 4] = w.y & 0xFF; buf[o + 5] = (w.y >> 8) & 0xFF;
    });
    buf.set(t1, 63);
    buf.set(t2, 111);
    if (await write(buf)) {
      addLog('Đã gửi giao diện tự thiết kế (' + st.widgets.length + ' thành phần).');
      addLog('Thiết bị tự chuyển sang «Tự thiết kế» và đang vẽ lại…');
      deviceMode = 27;
      if (typeof highlightMode === 'function') highlightMode(27);
      if (typeof window.rebuildModeGallery === 'function') window.rebuildModeGallery();
    }
  };

  /* ---- khởi tạo ---- */

  function sizeCanvas() {
    if (!canvas) return;
    canvas.width = panelW() * 2;
    canvas.height = panelH() * 2;
    ctx = canvas.getContext('2d');
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    st.widgets.forEach(clampW);
    redraw();
  }
  window.dsResize = sizeCanvas;   // main.js gọi khi đổi phân giải

  function init() {
    canvas = document.getElementById('designerCanvas');
    if (!canvas) return;
    document.getElementById('dsText1').value = st.t1 || '';
    document.getElementById('dsText2').value = st.t2 || '';
    document.getElementById('dsFrame').value = String(st.frame || 0);
    loadIconEl();
    sizeCanvas();

    const down = ev => {
      const [px, py] = evPos(ev);
      sel = hit(px, py);
      if (sel >= 0) {
        const w = st.widgets[sel];
        dragOff = [px - w.x, py - w.y];
        ev.preventDefault();
      }
      redraw();
    };
    const move = ev => {
      if (sel < 0 || !dragOff) return;
      const [px, py] = evPos(ev);
      const w = st.widgets[sel];
      w.x = px - dragOff[0]; w.y = py - dragOff[1];
      clampW(w);
      ev.preventDefault();
      redraw();
    };
    const up = () => { if (dragOff) { dragOff = null; save(); } };

    canvas.addEventListener('mousedown', down);
    canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    canvas.addEventListener('touchstart', down, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', up);

    redraw();
    setInterval(redraw, 30000); // giữ giờ trong thiết kế luôn đúng
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
