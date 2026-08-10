/*
 * Mode-20 designer: compose a custom screen from predefined widgets by
 * drag & drop, preview it exactly like the device renders it, and upload
 * the serialized layout via EPD_CMD_SET_LAYOUT (0x24).
 *
 * Serialized payload (158 bytes, mirrors custom_layout_t after its magic):
 *   [0] count  [1] frame  [2..61] 10 x {type u8, size u8, x i16LE, y i16LE}
 *   [62..109] text1 (UTF-8, NUL-padded, 48B)  [110..157] text2 (48B)
 */
(function () {
  const pv = window.__pv; // helpers exposed by mode_preview.js
  const LS_KEY = 'customLayout_v1';
  const MAXW = 10;

  // widget metadata: display name and bounding box per size (mirrors the
  // firmware DrawCustom geometry; used for hit tests and bounds clamping)
  const TYPES = {
    1: { name: 'Đồng hồ số', sizes: 3, dim: s => [[100, 44], [146, 64], [192, 84]][s] },
    2: { name: 'Đồng hồ kim', sizes: 3, dim: s => { const r = [40, 60, 85][s]; return [2 * r, 2 * r]; } },
    3: { name: 'Pin', sizes: 1, dim: () => [88, 14] },
    4: { name: 'Nhiệt độ', sizes: 2, dim: s => s ? [100, 30] : [50, 16] },
    5: { name: 'Ngày tháng', sizes: 2, dim: s => s ? [390, 30] : [195, 16] },
    6: { name: 'Âm lịch', sizes: 2, dim: s => s ? [390, 30] : [195, 16] },
    7: { name: 'Lịch tháng', sizes: 3, dim: s => [[180, 170], [240, 206], [300, 242]][s] },
    8: { name: 'Chữ 1', sizes: 2, dim: null }, // measured from the text
    9: { name: 'Chữ 2', sizes: 2, dim: null },
    10: { name: 'Icon', sizes: 3, dim: s => { const k = s + 1; return st.icon ? [st.icon.w * k, st.icon.h * k] : [48 * k, 48 * k]; } },
  };

  let st = { widgets: [], frame: 0, t1: '', t2: '' }; // st.icon = {w,h,b64} when an icon image was chosen
  let sel = -1, canvas, ctx, dragOff = null;
  let iconImg = null; // offscreen canvas cache built from st.icon

  try { const s = JSON.parse(localStorage.getItem(LS_KEY)); if (s && s.widgets) st = s; } catch (e) {}

  function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(st)); } catch (e) {} }

  function textOf(w) { return w.type === 8 ? (st.t1 || 'Chữ 1') : (st.t2 || 'Chữ 2'); }

  function dimOf(w) {
    const t = TYPES[w.type];
    if (t.dim) return t.dim(w.size);
    // text widgets: measure with the canvas font the preview uses
    pv.font(ctx, w.size ? 30 : 15, 1);
    return [Math.min(396, ctx.measureText(textOf(w)).width + 4), w.size ? 30 : 16];
  }

  /* ---- rendering (approximates the device output; the geometry anchors
     match the firmware so positions transfer 1:1) ---- */

  function drawWidget(x, w, now) {
    const BK = pv.BK, RED = pv.RED;
    switch (w.type) {
      case 1: { // 7-seg HH:MM; unit chosen so the width matches the firmware box
        const u = [3.6, 5.3, 7.0][w.size];
        pv.segStr(x, w.x + 2, w.y + 2, u, pv.pad2(now.getHours()) + ':' + pv.pad2(now.getMinutes()), BK, BK);
      } break;
      case 2: {
        const r = [40, 60, 85][w.size];
        pv.analogClock(x, w.x + r, w.y + r, r, now, true); // numerals at every size (small font under r=60)
      } break;
      case 3:
        pv.battery(x, w.x + 63, w.y, BK, '3.2V');
        break;
      case 4:
        pv.font(x, w.size ? 30 : 15, 0); x.fillStyle = BK;
        x.fillText('28°C', w.x, w.y + (w.size ? 26 : 13));
        break;
      case 5:
        pv.font(x, w.size ? 30 : 15, 0); x.fillStyle = BK;
        x.fillText(pv.WD_FULL[now.getDay()] + ', ' + pv.pad2(now.getDate()) + '/' + pv.pad2(now.getMonth() + 1) + '/' + now.getFullYear(),
                   w.x, w.y + (w.size ? 26 : 13));
        break;
      case 6:
        pv.font(x, w.size ? 30 : 15, 0); x.fillStyle = BK;
        x.fillText('Âm Lịch 21/5 - Đinh Sửu', w.x, w.y + (w.size ? 26 : 13));
        break;
      case 7: {
        const [gw, gh] = TYPES[7].dim(w.size);
        pv.font(x, 11, 1);
        for (let i = 0; i < 7; i++) {
          x.fillStyle = (i === 0 || i === 6) ? RED : BK;
          x.textAlign = 'center';
          x.fillText(pv.WD_SHORT[i], w.x + i * (gw / 7) + gw / 14, w.y + 12);
          x.textAlign = 'left';
        }
        pv.monthGrid(x, w.x, w.y + 18, gw, gh - 22, now, { dayPx: w.size ? 13 : 11 });
      } break;
      case 8:
      case 9:
        pv.font(x, w.size ? 30 : 15, 1); x.fillStyle = BK;
        x.fillText(textOf(w), w.x, w.y + (w.size ? 26 : 13));
        break;
      case 10: {
        const k = (w.size || 0) + 1; // size 0/1/2 -> vẽ 1x/2x/3x (khớp firmware)
        const ic = iconImage();
        if (ic) {
          const smooth = x.imageSmoothingEnabled;
          x.imageSmoothingEnabled = false; // phóng theo pixel như trên máy
          x.drawImage(ic, w.x, w.y, ic.width * k, ic.height * k);
          x.imageSmoothingEnabled = smooth;
        } else {
          const d = 48 * k;
          x.strokeStyle = BK; x.lineWidth = 1.5;
          x.strokeRect(w.x, w.y, d, d);
          x.beginPath(); x.moveTo(w.x, w.y); x.lineTo(w.x + d, w.y + d);
          x.moveTo(w.x + d, w.y); x.lineTo(w.x, w.y + d); x.stroke();
        }
      } break;
    }
  }

  function iconBits() {
    if (!st.icon) return null;
    const raw = atob(st.icon.b64), out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function iconImage() {
    if (iconImg) return iconImg;
    const bits = iconBits();
    if (!bits) return null;
    const w = st.icon.w, h = st.icon.h, stride = (w + 7) >> 3;
    const oc = document.createElement('canvas');
    oc.width = w; oc.height = h;
    const og = oc.getContext('2d');
    const id = og.createImageData(w, h);
    for (let yy = 0; yy < h; yy++)
      for (let xx = 0; xx < w; xx++) {
        if (bits[yy * stride + (xx >> 3)] & (0x80 >> (xx & 7))) {
          const i = (yy * w + xx) * 4;
          id.data[i] = 21; id.data[i + 1] = 21; id.data[i + 2] = 21; id.data[i + 3] = 255;
        }
      }
    og.putImageData(id, 0, 0);
    iconImg = oc;
    return iconImg;
  }

  // convert any image file to a 1-bit icon (max 128px, luminance threshold)
  window.dsIconFileChange = function (input) {
    const f = input.files && input.files[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 128 / img.width, 128 / img.height);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const oc = document.createElement('canvas');
      oc.width = w; oc.height = h;
      const og = oc.getContext('2d');
      og.fillStyle = '#fff'; og.fillRect(0, 0, w, h);
      og.drawImage(img, 0, 0, w, h);
      const d = og.getImageData(0, 0, w, h).data;
      const stride = (w + 7) >> 3;
      const bits = new Uint8Array(stride * h);
      for (let yy = 0; yy < h; yy++)
        for (let xx = 0; xx < w; xx++) {
          const i = (yy * w + xx) * 4;
          const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          if (lum < 140 && d[i + 3] > 127) bits[yy * stride + (xx >> 3)] |= 0x80 >> (xx & 7);
        }
      st.icon = { w: w, h: h, b64: btoa(String.fromCharCode.apply(null, bits)) };
      iconImg = null;
      if (!st.widgets.some(wd => wd.type === 10)) dsAdd(10);
      st.widgets.forEach(clampW);
      save(); redraw();
      addLog('Icon đã sẵn sàng: ' + w + 'x' + h + ' (' + bits.length + ' byte) — gửi cùng thiết kế.');
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(f);
  };

  function renderLayout(x, now, withSelection) {
    x.fillStyle = '#f6f4ec'; x.fillRect(0, 0, 400, 300);
    if (st.frame >= 1) { x.strokeStyle = pv.BK; x.lineWidth = 2; x.strokeRect(3, 3, 394, 294); }
    if (st.frame >= 2) x.strokeRect(7, 7, 386, 286);
    st.widgets.forEach(w => drawWidget(x, w, now));
    if (withSelection && sel >= 0 && st.widgets[sel]) {
      const w = st.widgets[sel], [bw, bh] = dimOf(w);
      x.strokeStyle = '#1a73e8'; x.lineWidth = 1.5; x.setLineDash([5, 4]);
      x.strokeRect(w.x - 3, w.y - 3, bw + 6, bh + 6);
      x.setLineDash([]);
    }
  }

  // the mode-20 gallery card renders through this hook
  window.renderCustomLayout = function (x, now) {
    if (!st.widgets.length) {
      pv.font(x, 15, 0);
      pv.center(x, 'Chưa có giao diện tự thiết kế', 200, 140, pv.BK);
      pv.center(x, 'Tạo trong mục «Thiết kế màn hình»', 200, 168, pv.BK);
      return;
    }
    renderLayout(x, now, false);
  };

  function redraw() { if (ctx) renderLayout(ctx, new Date(), true); }

  /* ---- interactions ---- */

  function hit(px, py) {
    for (let i = st.widgets.length - 1; i >= 0; i--) {
      const w = st.widgets[i], [bw, bh] = dimOf(w);
      if (px >= w.x - 4 && px <= w.x + bw + 4 && py >= w.y - 4 && py <= w.y + bh + 4) return i;
    }
    return -1;
  }

  function evPos(ev) {
    const r = canvas.getBoundingClientRect();
    const t = ev.touches ? ev.touches[0] : ev;
    return [(t.clientX - r.left) * 400 / r.width, (t.clientY - r.top) * 300 / r.height];
  }

  function clampW(w) {
    const [bw, bh] = dimOf(w);
    w.x = Math.round(Math.max(0, Math.min(400 - bw, w.x)));
    w.y = Math.round(Math.max(0, Math.min(300 - bh, w.y)));
  }

  window.dsAdd = function (type) {
    if (st.widgets.length >= MAXW) { alert('Tối đa ' + MAXW + ' thành phần.'); return; }
    if ((type === 8 || type === 9) && st.widgets.some(w => w.type === type)) {
      alert('Mỗi ô chữ chỉ dùng được một lần.'); return;
    }
    const w = { type: type, size: 0, x: 140, y: 120 };
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

  /* ---- upload ---- */

  window.dsUpload = async function () {
    if (!st.widgets.length) { alert('Thiết kế còn trống — hãy thêm ít nhất một thành phần.'); return; }
    // the icon travels first (chunked into its own flash sector); the
    // layout upload afterwards switches the device to mode 20
    if (st.widgets.some(w => w.type === 10)) {
      if (!st.icon) { alert('Thiết kế có Icon nhưng chưa chọn ảnh cho nó.'); return; }
      const bits = iconBits();
      const chunk = Math.max(16, (Number(document.getElementById('mtusize').value) || 20) - 4);
      addLog('Đang gửi icon ' + st.icon.w + 'x' + st.icon.h + ' (' + bits.length + ' byte, khối ' + chunk + ')...');
      const n0 = Math.min(chunk, bits.length);
      const first = new Uint8Array(3 + n0);
      first[0] = 0x00; first[1] = st.icon.w; first[2] = st.icon.h;
      first.set(bits.slice(0, n0), 3);
      if (!await write(EpdCmd.SET_ICON, first)) return;
      for (let off = n0; off < bits.length; off += chunk) {
        const part = bits.slice(off, off + chunk);
        const pkt = new Uint8Array(1 + part.length);
        pkt[0] = 0x01; pkt.set(part, 1);
        if (!await write(EpdCmd.SET_ICON, pkt)) return;
      }
      addLog("Icon đã gửi xong (thiết bị báo lại 'icon=done').");
    }
    const enc = new TextEncoder();
    const t1 = enc.encode(st.t1), t2 = enc.encode(st.t2);
    if (t1.length > 47 || t2.length > 47) {
      alert('Ô chữ quá dài (tối đa 47 byte; chữ có dấu chiếm 2-3 byte mỗi chữ).');
      return;
    }
    const buf = new Uint8Array(158);
    buf[0] = st.widgets.length;
    buf[1] = st.frame;
    st.widgets.forEach((w, i) => {
      const o = 2 + i * 6;
      buf[o] = w.type; buf[o + 1] = w.size;
      buf[o + 2] = w.x & 0xFF; buf[o + 3] = (w.x >> 8) & 0xFF;
      buf[o + 4] = w.y & 0xFF; buf[o + 5] = (w.y >> 8) & 0xFF;
    });
    buf.set(t1, 62);
    buf.set(t2, 110);
    if (await write(EpdCmd.SET_LAYOUT, buf)) {
      addLog('Đã gửi giao diện tự thiết kế! (thiết bị báo lại \'layout=<số thành phần>\')');
      addLog('Thiết bị tự chuyển sang chế độ 20 và hiển thị sau ~30 giây.');
      if (typeof highlightMode === 'function') highlightMode(20);
    }
  };

  /* ---- init ---- */

  function init() {
    canvas = document.getElementById('designerCanvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    document.getElementById('dsText1').value = st.t1 || '';
    document.getElementById('dsText2').value = st.t2 || '';
    document.getElementById('dsFrame').value = String(st.frame || 0);

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
    setInterval(redraw, 30000); // keep the clock widgets current
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
