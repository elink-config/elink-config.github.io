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
  let bgImg = null;   // ảnh nền (chỉ để xem trước trên web; máy đọc từ khe ảnh)

  // Nap bo cuc da luu. KEP size ve khoang hop le cua tung loai: bo cuc cu
  // (hoac cua may khac neu ai do dung chung trinh duyet) co the mang size
  // vuot khoang -> ICON_DIMS[size] = undefined -> getImageData nem loi va
  // designer khong ve duoc gi.
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY));
    if (s && s.widgets) {
      st = s;
      st.widgets = st.widgets.filter(w => TYPES[w.type]).map(w => {
        const max = TYPES[w.type].sizes - 1;
        w.size = Math.max(0, Math.min(max, w.size | 0));
        return w;
      });
    }
  } catch (e) {}

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

  // mặt ĐỎ của icon (chỉ có khi ảnh nguồn có màu đỏ) — firmware BWR mới vẽ
  // được, máy cũ thì gộp vào mặt đen lúc gửi
  function iconRedBits() {
    if (!st.icon || !st.icon.r64) return null;
    const raw = atob(st.icon.r64), out = new Uint8Array(raw.length);
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
    const rbits = iconRedBits();
    for (let yy = 0; yy < h; yy++)
      for (let xx = 0; xx < w; xx++) {
        const bit = 0x80 >> (xx & 7), o = yy * stride + (xx >> 3), i = (yy * w + xx) * 4;
        if (rbits && (rbits[o] & bit)) {          // điểm ĐỎ
          id.data[i] = 192; id.data[i + 1] = 38; id.data[i + 2] = 31; id.data[i + 3] = 255;
        } else if (bits[o] & bit) {               // điểm đen
          id.data[i] = 21; id.data[i + 1] = 21; id.data[i + 2] = 21; id.data[i + 3] = 255;
        }
      }
    og.putImageData(id, 0, 0);
    iconImg = oc;
    return iconImg;
  }

  // Anh -> icon 1-bit (toi da 128px): chuyen bang NGUONG do sang, KHONG
  // dithering — giu dung hinh goc, khong ra hat lam tam tren e-ink.
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
      // thu nho CHAT LUONG CAO (noi suy muot) de anh giu net nhu ban goc
      og.imageSmoothingEnabled = true;
      og.imageSmoothingQuality = 'high';
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
    // ảnh nền toàn màn (nếu đã đặt) — vẽ trước, widget nằm đè lên
    if (st.bgPrev) {
      if (!bgImg) { bgImg = new Image(); bgImg.onload = () => redraw(); bgImg.src = st.bgPrev; }
      if (bgImg.complete && bgImg.naturalWidth) x.drawImage(bgImg, 0, 0, 400, 300);
    }
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

  // ---- kho thiết kế (js/diy_store.js) + ảnh từ mục «Truyền hình ảnh» ----

  window.dsGetState = function () {
    try { return JSON.parse(JSON.stringify(st)); } catch (e) { return null; }
  };

  window.dsSetState = function (s) {
    if (!s || !Array.isArray(s.widgets)) return false;
    st = s;
    st.frame = Number(st.frame) || 0;
    st.widgets = st.widgets.filter(w => TYPES[w.type]).map(w => {
      const max = TYPES[w.type].sizes - 1;
      w.size = Math.max(0, Math.min(max, w.size | 0));
      return w;
    });
    iconImg = null;
    if (typeof clampW === 'function') st.widgets.forEach(clampW);
    save(); redraw();
    return true;
  };

  // Ảnh trong mục «Truyền hình ảnh» (đã cắt/chỉnh/dither/vẽ tay) -> icon 1-bit
  // của thiết kế: mọi tùy chỉnh ảnh dùng chung một chỗ, không còn nút tải ảnh
  // riêng trong designer. Icon trên máy hiện VẼ MỘT MÀU ĐEN (firmware lưu ảnh
  // 1 bit/điểm) nên vùng đỏ sẽ thành đen — có cảnh báo khi ảnh có màu đỏ.
  // Có điểm đỏ trong ảnh nguồn không (quyết định icon 1 hay 2 mặt)
  function hasRed(src) {
    const c = src.getContext('2d');
    const d = c.getImageData(0, 0, src.width, src.height).data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 127 && d[i] > 110 && d[i] - d[i + 1] > 55 && d[i] - d[i + 2] > 55) return true;
    }
    return false;
  }

  // Thu nhỏ bằng TRUNG BÌNH VÙNG (mỗi điểm đích = trung bình khối điểm nguồn):
  // giữ đúng sắc độ của ảnh đã dither, khác hẳn drawImage nội suy rồi cắt ngưỡng.
  function boxAverage(src, w, h) {
    const sw = src.width, sh = src.height;
    const sd = src.getContext('2d').getImageData(0, 0, sw, sh).data;
    const out = new Float32Array(w * h * 3);
    const fx = sw / w, fy = sh / h;
    for (let y = 0; y < h; y++) {
      const y0 = Math.floor(y * fy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy));
      for (let x = 0; x < w; x++) {
        const x0 = Math.floor(x * fx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx));
        let r = 0, g = 0, b = 0, n = 0;
        for (let yy = y0; yy < y1 && yy < sh; yy++) {
          for (let xx = x0; xx < x1 && xx < sw; xx++) {
            const i = (yy * sw + xx) * 4, a = sd[i + 3] / 255;
            r += sd[i] * a + 255 * (1 - a);
            g += sd[i + 1] * a + 255 * (1 - a);
            b += sd[i + 2] * a + 255 * (1 - a);
            n++;
          }
        }
        const o = (y * w + x) * 3;
        out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
      }
    }
    return out;
  }

  // ---- ẢNH NỀN toàn màn (4.2" ba màu fw >= 2.3, bốn màu fw >= 3.4) ----
  // Ảnh nền KHÔNG đi cùng bố cục mà nằm ở KHE ẢNH 32KB của thiết bị — chính
  // đường truyền của mục «Truyền hình ảnh», nên nét và màu y hệt (400x300,
  // đen + đỏ). Ở đây chỉ gửi ảnh vào khe rồi báo thiết bị dùng khe đó làm nền.
  window.dsSetBackground = async function () {
    if (!window.__fwBg) {
      alert('Máy chưa hỗ trợ ảnh nền (cần firmware 4.2" ba màu từ v2.3, bốn màu từ v3.4).');
      return;
    }
    const src = document.getElementById('canvas');
    if (!src || !src.width) { alert('Chưa có ảnh trong mục «Truyền hình ảnh».'); return; }
    if (!confirm('Dùng ảnh đang có làm NỀN của thiết kế?\n\nẢnh sẽ được gửi vào khe 3 của thiết bị (ảnh cũ trong khe 3 bị thay).')) return;
    if (typeof sendimg !== 'function') { alert('Không tìm thấy chức năng gửi ảnh.'); return; }
    await sendimg(2);                       // khe 3
    if (!await write(EpdCmd.CUSTOM_BG, [3])) return;
    st.bg = 3;
    st.bgPrev = src.toDataURL('image/png'); // chỉ để xem trước trên web
    bgImg = null;
    save(); redraw();
    addLog('Đã đặt ảnh nền cho «Tự thiết kế» — bấm «Gửi lên thiết bị» để xếp pin/giờ lên trên.');
  };

  window.dsClearBackground = async function () {
    st.bg = 0; st.bgPrev = null; bgImg = null; save(); redraw();
    if (window.__fwBg) await write(EpdCmd.CUSTOM_BG, [0]);
    addLog('Đã bỏ ảnh nền của thiết kế.');
  };

  window.dsIconFromCanvas = function () {
    // Máy hỗ trợ ảnh nền (4.2" fw >= 2.3): dùng luôn đường NỀN TOÀN MÀN — ảnh
    // giữ nguyên 400x300 đen+đỏ như mục «Truyền hình ảnh». Đường icon cũ (tối đa
    // 176px, nhét trong 1 sector 4KB) chỉ còn dùng cho firmware/màn chưa hỗ trợ.
    if (window.__fwBg) return window.dsSetBackground();
    // KHÔNG hỗ trợ nền -> phải nói rõ, đừng lặng lẽ tạo icon bé rồi người dùng
    // tưởng nút hỏng (đây chính là chỗ đã gây hiểu nhầm).
    if (!confirm('Máy này KHÔNG dùng được ảnh nền toàn màn nên ảnh sẽ bị thu nhỏ '
        + 'thành icon (tối đa 176px, phóng to sẽ vỡ).\n\n'
        + 'Thiết bị: ' + (window.__devNm || '(chưa rõ)')
        + '\nFirmware máy báo: ' + (window.__fwStr || '(chưa nhận được)')
        + '\nCần: 4.2" ba màu từ v2.3 hoặc 4.2" bốn màu từ v3.4\n\nVẫn thêm dạng icon?')) return;

    const src = document.getElementById('canvas');
    if (!src || !src.width || !src.height) { alert('Chưa có ảnh trong mục «Truyền hình ảnh».'); return; }
    // Trần kích thước: firmware mới (icon 2 mặt) cho tới 176px; firmware cũ
    // chỉ nhận 128px. Ảnh CÓ ĐỎ cần 2 mặt nên phải nhỏ hơn để vừa một sector
    // flash 4096B: 8 + số_mặt * ceil(w/8) * h <= 4096.
    const maxDim = window.__fwIconRed ? 176 : 128;
    let scale = Math.min(1, maxDim / src.width, maxDim / src.height);
    let w = Math.max(1, Math.round(src.width * scale));
    let h = Math.max(1, Math.round(src.height * scale));
    const planes = hasRed(src) && window.__fwIconRed ? 2 : 1;
    while (w > 8 && h > 8 && 8 + planes * (((w + 7) >> 3) * h) > 4096) {
      scale *= 0.94;
      w = Math.max(1, Math.round(src.width * scale));
      h = Math.max(1, Math.round(src.height * scale));
    }
    // Ảnh nguồn ĐÃ được dither thành các chấm: nếu thu nhỏ bằng nội suy rồi
    // cắt ngưỡng thì chấm hòa thành xám và rơi hết về trắng (nét đứt, chữ mất).
    // Cách đúng: lấy TRUNG BÌNH VÙNG để khôi phục sắc độ, rồi dither lại bằng
    // khuếch tán sai số (Floyd–Steinberg) ở cỡ đích.
    const avg = boxAverage(src, w, h);
    const stride = (w + 7) >> 3;
    const bits = new Uint8Array(stride * h);      // mặt ĐEN
    const rbits = new Uint8Array(stride * h);     // mặt ĐỎ
    let redPx = 0;
    const PAL = planes === 2
      ? [[255, 255, 255], [0, 0, 0], [200, 32, 26]]   // trắng / đen / ĐỎ
      : [[255, 255, 255], [0, 0, 0]];                 // fw cũ: đỏ dồn về đen
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const o = (yy * w + xx) * 3;
        const r = avg[o], g = avg[o + 1], b = avg[o + 2];
        let best = 0, bestD = Infinity;
        for (let p = 0; p < PAL.length; p++) {
          const dr = r - PAL[p][0], dg = g - PAL[p][1], db = b - PAL[p][2];
          const dist = dr * dr + dg * dg + db * db;
          if (dist < bestD) { bestD = dist; best = p; }
        }
        if (best === 1) bits[yy * stride + (xx >> 3)] |= 0x80 >> (xx & 7);
        else if (best === 2) { rbits[yy * stride + (xx >> 3)] |= 0x80 >> (xx & 7); redPx++; }
        // khuếch tán sai số sang các điểm chưa xử lý
        const er = r - PAL[best][0], eg = g - PAL[best][1], eb = b - PAL[best][2];
        const push = (px, py, k) => {
          if (px < 0 || px >= w || py >= h) return;
          const q = (py * w + px) * 3;
          avg[q] += er * k; avg[q + 1] += eg * k; avg[q + 2] += eb * k;
        };
        push(xx + 1, yy, 7 / 16); push(xx - 1, yy + 1, 3 / 16);
        push(xx, yy + 1, 5 / 16); push(xx + 1, yy + 1, 1 / 16);
      }
    }
    st.icon = { w: w, h: h, b64: btoa(String.fromCharCode.apply(null, bits)) };
    if (redPx) st.icon.r64 = btoa(String.fromCharCode.apply(null, rbits));
    iconImg = null;
    if (!st.widgets.some(wd => wd.type === 10)) dsAdd(10);
    st.widgets.forEach(clampW);
    save(); redraw();
    addLog('Đã lấy ảnh vào thiết kế: ' + w + 'x' + h + ' (' + bits.length + ' byte/mặt' +
           (planes === 2 ? ', 2 mặt đen+ĐỎ' : '') + ').');
    if (redPx) addLog('Ảnh có ' + redPx + ' điểm ĐỎ — máy firmware mới vẽ được đỏ; máy cũ sẽ vẽ chúng thành đen.');
  };

  window.dsUpload = async function () {
    if (!st.widgets.length) { alert('Thiết kế còn trống — hãy thêm ít nhất một thành phần.'); return; }
    // the icon travels first (chunked into its own flash sector); the
    // layout upload afterwards switches the device to mode 20
    if (st.widgets.some(w => w.type === 10)) {
      if (!st.icon) { alert('Thiết kế có Icon nhưng chưa chọn ảnh cho nó.'); return; }
      const black = iconBits();
      const red = iconRedBits();
      // 2 mặt chỉ gửi khi firmware biết đọc (BWR 4.2 >= 2.3 / 7.5 >= 0.5):
      // máy cũ nhận mặt đen ĐÃ GỘP đỏ nên ảnh vẫn đủ nét, chỉ mất màu.
      const twoPlane = !!(red && window.__fwIconRed);
      let bits;
      if (twoPlane) {
        bits = new Uint8Array(black.length + red.length);
        bits.set(black, 0); bits.set(red, black.length);
      } else if (red) {
        bits = new Uint8Array(black.length);
        for (let i = 0; i < black.length; i++) bits[i] = black[i] | red[i];
      } else {
        bits = black;
      }
      const chunk = Math.max(16, (Number(document.getElementById('mtusize').value) || 20) - 5);
      addLog('Đang gửi icon ' + st.icon.w + 'x' + st.icon.h +
             (twoPlane ? ' (2 mặt đen+ĐỎ, ' : ' (') + bits.length + ' byte, khối ' + chunk + ')...');
      const hdr = twoPlane ? 4 : 3;                 // [0x02,w,h,planes] | [0x00,w,h]
      const n0 = Math.min(chunk, bits.length);
      const first = new Uint8Array(hdr + n0);
      first[0] = twoPlane ? 0x02 : 0x00;
      first[1] = st.icon.w; first[2] = st.icon.h;
      if (twoPlane) first[3] = 2;
      first.set(bits.slice(0, n0), hdr);
      if (!await write(EpdCmd.SET_ICON, first)) return;
      for (let off = n0; off < bits.length; off += chunk) {
        const part = bits.slice(off, off + chunk);
        const pkt = new Uint8Array(1 + part.length);
        pkt[0] = 0x01; pkt.set(part, 1);
        if (!await write(EpdCmd.SET_ICON, pkt)) return;
      }
      addLog("Icon đã gửi xong (thiết bị báo lại 'icon=done').");
    }
    // nhắc thiết bị dùng (hoặc bỏ) khe ảnh làm nền trước khi nhận bố cục
    if (window.__fwBg) await write(EpdCmd.CUSTOM_BG, [st.bg || 0]);
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
