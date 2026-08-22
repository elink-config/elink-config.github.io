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
  // Khổ màn của máy này (7.3" Spectra 6). Bố cục người dùng xếp được lưu theo
  // toạ độ THẬT trên màn nên mọi phép quy đổi chuột/chặn biên đều dùng hai số
  // này — đổi máy chỉ phải sửa ở đây.
  const DS_W = 800, DS_H = 480;

  const pv = window.__pv; // helpers exposed by mode_preview.js
  // Tu BWR v2.7 / 4 mau v3.7 co HAI «Tu thiet ke», moi cai bo cuc + anh nen +
  // icon rieng. Bo cuc luu rieng trong trinh duyet theo tung thiet ke; khoa cu
  // (mot thiet ke) van doc duoc cho thiet ke 1.
  let dsDesign = 0;                                   // 0 = Thiet ke 1, 1 = Thiet ke 2
  const LS_KEY_BASE = 'customLayout_v1';
  const lsKey = () => dsDesign === 0 ? LS_KEY_BASE : LS_KEY_BASE + '_d' + dsDesign;
  const LS_KEY = LS_KEY_BASE;
  const MAXW = 10;

  // widget metadata: display name and bounding box per size (mirrors the
  // firmware DrawCustom geometry; used for hit tests and bounds clamping)
  /* ---- CỠ THÀNH PHẦN (khớp khối CW_FREE trong GUI.c của firmware) --------
   * byte `size`: 0/1/2 = ba nấc cũ; >= 3 = CỠ THẬT theo đơn vị 1/16 lần so
   * với nấc 0 (16 = 1.0x). Firmware đời trước nhận số lớn thì tự kẹp về nấc 2
   * nên gửi xuống máy cũ không vỡ hình, chỉ là không đúng cỡ.
   *
   * Co giãn được tới đâu là do CÁCH VẼ của firmware:
   *   đồng hồ kim + lịch tháng  -> mượt từng pixel
   *   đồng hồ số 7 đoạn         -> nét dày nguyên pixel, nhảy từng nấc ~46px
   *   MỌI THÀNH PHẦN CHỮ + icon -> font/ảnh bitmap, chỉ nhân nguyên lần 1/2/3
   *   pin                       -> một cỡ duy nhất
   * Hàm snapSize() dưới đây ép con số về đúng cái máy vẽ được, nên kéo góc
   * bao giờ cũng ra hình y như trên màn hình. */
  const FREE = s => s >= 3;
  const pxOf = (s, base, lo, hi) => Math.max(lo, Math.min(hi, Math.round(base * s / 16)));
  const mulOf = (s, lo, hi) => Math.max(lo, Math.min(hi, Math.round(s / 16)));
  // tham số vẽ THẬT của một widget theo byte size
  function parOf(type, s) {
    switch (type) {
      case 1: return { cS: FREE(s) ? Math.max(1, Math.min(8, Math.round((s + 4) / 8))) : [2, 3, 4][s] };
      case 2: return { r: FREE(s) ? pxOf(s, 40, 12, 150) : [40, 60, 85][s] };
      case 7: return { gw: FREE(s) ? pxOf(s, 180, 112, 400) : [180, 240, 300][s],
                       rh: FREE(s) ? pxOf(s, 26, 12, 60) : [26, 32, 38][s] };
      case 10: return { k: FREE(s) ? mulOf(s, 1, 3) : s + 1 };
      default: return { k: FREE(s) ? mulOf(s, 1, 3) : (s ? 2 : 1) };   // chữ
    }
  }
  // size tương đương của ba nấc cũ, để lần đầu kéo góc không bị nhảy cỡ
  const LEGACY16 = { 1: [16, 24, 32], 2: [16, 24, 34], 7: [16, 21, 27], 10: [16, 32, 48] };
  function toFree(type, s) {
    if (FREE(s)) return s;
    const t = LEGACY16[type] || [16, 32, 32];
    return t[Math.min(s, t.length - 1)];
  }
  // Ba nấc cũ của một loại, quy ra đơn vị 1/16 lần — dùng cho máy chưa hỗ trợ
  // cỡ tự do: thanh kéo vẫn kéo được, chỉ là bám về đúng nấc máy dựng lại được.
  function legacyList(type) {
    if (LEGACY16[type]) return LEGACY16[type];
    return (TYPES[type] && TYPES[type].sizes === 3) ? [16, 32, 48] : [16, 32];
  }

  // ép size về đúng nấc mà firmware vẽ ra được, và về khoảng cho phép
  function snapSize(type, s) {
    s = Math.round(s);
    switch (type) {
      case 1: return Math.max(8, Math.min(64, Math.round(s / 8) * 8));   // cS nguyên 1..8
      case 2: return Math.max(5, Math.min(60, s));                        // r 12..150
      case 7: return Math.max(10, Math.min(36, s));                       // rộng 112..400
      case 3: return 16;                                                  // pin: một cỡ
      case 10: return Math.max(16, Math.min(48, Math.round(s / 16) * 16));  // 1x/2x/3x
      default: return Math.max(16, Math.min(48, Math.round(s / 16) * 16));  // chữ 1x/2x/3x
    }
  }

  /* Nắn byte size đọc từ bố cục đã lưu: 0..2 = nấc cũ giữ nguyên; >= 3 là cỡ
   * tự do, chỉ ép về nấc máy vẽ được. TUYỆT ĐỐI KHÔNG kẹp về TYPES[].sizes-1
   * như bản trước — làm vậy là xoá sạch cỡ tự do mỗi lần nạp lại bố cục. */
  function fixSize(type, v) {
    v = v | 0;
    if (v < 0) v = 0;
    if (v > 255) v = 255;
    return (v >= 3) ? snapSize(type, v) : v;
  }

  const TYPES = {
    1: { name: 'Đồng hồ số', sizes: 3, dim: s => { const c = parOf(1, s).cS; return [46 * c + 8, 20 * c + 4]; } },
    2: { name: 'Đồng hồ kim', sizes: 3, dim: s => { const r = parOf(2, s).r; return [2 * r, 2 * r]; } },
    3: { name: 'Pin', sizes: 1, dim: () => [88, 14] },
    4: { name: 'Nhiệt độ', sizes: 2, dim: s => { const k = parOf(4, s).k; return [50 * k, 16 * k]; } },
    5: { name: 'Ngày tháng', sizes: 2, dim: s => { const k = parOf(5, s).k; return [Math.min(396, 195 * k), 16 * k]; } },
    6: { name: 'Âm lịch', sizes: 2, dim: s => { const k = parOf(6, s).k; return [Math.min(396, 195 * k), 16 * k]; } },
    7: { name: 'Lịch tháng', sizes: 3, dim: s => { const p = parOf(7, s); return [p.gw, 6 * p.rh + 14]; } },
    8: { name: 'Chữ 1', sizes: 2, dim: null }, // measured from the text
    9: { name: 'Chữ 2', sizes: 2, dim: null },
    10: { name: 'Icon', sizes: 3, dim: s => { const k = parOf(10, s).k; return st.icon ? [st.icon.w * k, st.icon.h * k] : [48 * k, 48 * k]; } },
    // «Chữ 3..6» dùng số 11..14 vì 10 đã là Icon từ lâu, không đổi được
    11: { name: 'Chữ 3', sizes: 2, dim: null },
    12: { name: 'Chữ 4', sizes: 2, dim: null },
    13: { name: 'Chữ 5', sizes: 2, dim: null },
    14: { name: 'Chữ 6', sizes: 2, dim: null },
    15: { name: 'Thứ', sizes: 2, dim: s => { const k = parOf(15, s).k; return [100 * k, 16 * k]; } },
    16: { name: 'Ngày dương', sizes: 2, dim: s => { const k = parOf(16, s).k; return [110 * k, 16 * k]; } },
  };

  // 8, 9 rồi 11..14 -> ô chữ 0..5 (giấu chỗ hụt vì 10 là Icon)
  const TEXT_TYPES = [8, 9, 11, 12, 13, 14];
  const isTextType = t => TEXT_TYPES.indexOf(t) >= 0;
  const textIdx = t => TEXT_TYPES.indexOf(t);

  let st = { widgets: [], frame: 0, t1: '', t2: '' }; // st.icon = {w,h,b64} when an icon image was chosen
  let sel = -1, canvas, ctx, dragOff = null;
  let iconImg = null; // offscreen canvas cache built from st.icon
  let bgImg = null;   // ảnh nền (chỉ để xem trước trên web; máy đọc từ khe ảnh)

  // Nap bo cuc da luu. KEP size ve khoang hop le cua tung loai: bo cuc cu
  // (hoac cua may khac neu ai do dung chung trinh duyet) co the mang size
  // vuot khoang -> ICON_DIMS[size] = undefined -> getImageData nem loi va
  // designer khong ve duoc gi.
  try {
    const s = JSON.parse(localStorage.getItem(lsKey()));
    if (s && s.widgets) {
      st = s;
      st.widgets = st.widgets.filter(w => TYPES[w.type]).map(w => {
        w.size = fixSize(w.type, w.size);
        return w;
      });
    }
  } catch (e) {}

  function save() { try { localStorage.setItem(lsKey(), JSON.stringify(st)); } catch (e) {} }

  // Chữ của một thành phần. Hai ô đầu vẫn nằm ở st.t1/st.t2 để bố cục đã lưu
  // của người dùng cũ đọc lên nguyên vẹn; ô 3..6 nằm ở st.t[2..5].
  function textAt(i) {
    if (i === 0) return st.t1 || '';
    if (i === 1) return st.t2 || '';
    return (st.t && st.t[i]) || '';
  }
  function setTextAt(i, v) {
    if (i === 0) { st.t1 = v; return; }
    if (i === 1) { st.t2 = v; return; }
    if (!st.t) st.t = [];
    st.t[i] = v;
  }
  function textOf(w) {
    const i = textIdx(w.type);
    return textAt(i) || ('Chữ ' + (i + 1));
  }

  function dimOf(w) {
    const t = TYPES[w.type];
    if (t.dim) return t.dim(w.size);
    // text widgets: measure with the canvas font the preview uses
    const k = parOf(w.type, w.size).k;
    pv.font(ctx, 15 * k, 1);
    return [Math.min(396, ctx.measureText(textOf(w)).width + 4), 16 * k];
  }

  /* ---- rendering (approximates the device output; the geometry anchors
     match the firmware so positions transfer 1:1) ---- */

  function drawWidget(x, w, now) {
    const BK = pv.BK, RED = pv.RED;
    switch (w.type) {
      case 1: { // 7-seg HH:MM; unit chosen so the width matches the firmware box
        const u = parOf(1, w.size).cS * 1.77;
        pv.segStr(x, w.x + 2, w.y + 2, u, pv.pad2(now.getHours()) + ':' + pv.pad2(now.getMinutes()), BK, BK);
      } break;
      case 2: {
        const r = parOf(2, w.size).r;
        pv.analogClock(x, w.x + r, w.y + r, r, now, true); // numerals at every size (small font under r=60)
      } break;
      case 3:
        pv.battery(x, w.x + 63, w.y, BK, '3.2V');
        break;
      case 4:
        pv.font(x, 15 * parOf(w.type, w.size).k, 0); x.fillStyle = BK;
        x.fillText('28°C', w.x, w.y + 13 * parOf(w.type, w.size).k);
        break;
      case 5:
        pv.font(x, 15 * parOf(w.type, w.size).k, 0); x.fillStyle = BK;
        x.fillText(pv.WD_FULL[now.getDay()] + ', ' + pv.pad2(now.getDate()) + '/' + pv.pad2(now.getMonth() + 1) + '/' + now.getFullYear(),
                   w.x, w.y + 13 * parOf(w.type, w.size).k);
        break;
      case 6:
        pv.font(x, 15 * parOf(w.type, w.size).k, 0); x.fillStyle = BK;
        x.fillText('Âm Lịch 21/5 - Đinh Sửu', w.x, w.y + 13 * parOf(w.type, w.size).k);
        break;
      case 7: {
        const [gw, gh] = TYPES[7].dim(w.size);
        const kcal = parOf(7, w.size).rh;
        pv.font(x, 11, 1);
        // hàng THỨ phải xê dịch y như lưới bên dưới: firmware từ v1.7 luôn bắt
        // đầu tuần bằng THỨ HAI (monthGrid đã theo cờ __fw17, trước đây hàng
        // thứ vẫn cứng CN nên header lệch một cột so với lưới)
        for (let i = 0; i < 7; i++) {
          const wd = (i + (window.__fw17 ? 1 : 0)) % 7;
          x.fillStyle = (wd === 0 || wd === 6) ? RED : BK;
          x.textAlign = 'center';
          x.fillText(pv.WD_SHORT[wd], w.x + i * (gw / 7) + gw / 14, w.y + 12);
          x.textAlign = 'left';
        }
        pv.monthGrid(x, w.x, w.y + 18, gw, gh - 22, now, { dayPx: kcal >= 30 ? 13 : 11 });
      } break;
      case 8:
      case 9:
      case 11:
      case 12:
      case 13:
      case 14:
        pv.font(x, 15 * parOf(w.type, w.size).k, 1); x.fillStyle = BK;
        x.fillText(textOf(w), w.x, w.y + 13 * parOf(w.type, w.size).k);
        break;
      case 15:   // chỉ THỨ
        pv.font(x, 15 * parOf(w.type, w.size).k, 0); x.fillStyle = BK;
        x.fillText(pv.WD_FULL[now.getDay()], w.x, w.y + 13 * parOf(w.type, w.size).k);
        break;
      case 16:   // chỉ NGÀY DƯƠNG
        pv.font(x, 15 * parOf(w.type, w.size).k, 0); x.fillStyle = BK;
        x.fillText(pv.pad2(now.getDate()) + '/' + pv.pad2(now.getMonth() + 1) + '/' + now.getFullYear(),
                   w.x, w.y + 13 * parOf(w.type, w.size).k);
        break;
      case 10: {
        const k = parOf(10, w.size).k;  // 1x/2x/3x — ảnh bitmap nên chỉ nguyên lần
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
    x.fillStyle = '#f6f4ec'; x.fillRect(0, 0, DS_W, DS_H);
    // ảnh nền toàn màn (nếu đã đặt) — vẽ trước, widget nằm đè lên
    if (st.bgPrev) {
      // ảnh tải xong thì vẽ lại CẢ trình sửa lẫn thẻ xem trước — thẻ của
      // thiết kế không mở cũng đi qua đây (xem withDesign)
      if (!bgImg) {
        bgImg = new Image();
        bgImg.onload = () => { redraw(); if (window.refreshModeGallery) window.refreshModeGallery(); };
        bgImg.src = st.bgPrev;
      }
      if (bgImg.complete && bgImg.naturalWidth) x.drawImage(bgImg, 0, 0, DS_W, DS_H);
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

  /* Vẽ bố cục của MỘT thiết kế bất kỳ, kể cả thiết kế không mở trong trình
   * sửa. Mọi hàm vẽ (drawWidget, dimOf, textOf, iconImage) đều đọc thẳng st
   * nên cách gọn nhất là TRÁO TẠM st + hai bộ đệm ảnh rồi trả lại, khỏi luồn
   * tham số qua cả chục chỗ. Không có nó thì thẻ «Tự thiết kế 2» vẽ đúng cái
   * đang mở trong trình sửa — nhìn như bố cục và ảnh nền của thiết kế 1 bị
   * chép sang thiết kế 2 (dữ liệu thật thì không sao). */
  const otherCache = { raw: undefined, st: null, icon: null, bg: null };
  function withDesign(d, fn) {
    if (d === dsDesign) return fn();
    const key = (d === 0) ? LS_KEY_BASE : LS_KEY_BASE + '_d' + d;
    let raw = null;
    try { raw = localStorage.getItem(key); } catch (e) {}
    if (otherCache.raw !== raw) {           // chỉ dựng lại khi dữ liệu đã đổi
      otherCache.raw = raw;
      let s2 = null;
      try { s2 = JSON.parse(raw); } catch (e) {}
      otherCache.st = (s2 && s2.widgets) ? s2 : { widgets: [], frame: 0, t1: '', t2: '' };
      otherCache.st.widgets = (otherCache.st.widgets || []).filter(w => TYPES[w.type]).map(w => {
        w.size = fixSize(w.type, w.size);
        return w;
      });
      otherCache.icon = null; otherCache.bg = null;
    }
    const bSt = st, bIcon = iconImg, bBg = bgImg;
    st = otherCache.st; iconImg = otherCache.icon; bgImg = otherCache.bg;
    try { return fn(); }
    finally {
      otherCache.icon = iconImg; otherCache.bg = bgImg;   // giữ đệm vừa dựng
      st = bSt; iconImg = bIcon; bgImg = bBg;
    }
  }

  // the gallery cards render through this hook (design 0 = thẻ 22, 1 = thẻ 23)
  window.renderCustomLayout = function (x, now, d) {
    return withDesign((d === 1) ? 1 : 0, function () {
      if (!st.widgets.length) {
        pv.font(x, 15, 0);
        pv.center(x, 'Chưa có giao diện tự thiết kế', 200, 140, pv.BK);
        pv.center(x, 'Tạo trong mục «Thiết kế màn hình»', 200, 168, pv.BK);
        return;
      }
      renderLayout(x, now, false);
    });
  };

  function redraw() { if (ctx) renderLayout(ctx, new Date(), true); syncSizeUI(); }

  /* ---- interactions ---- */

  /* ---- đổi cỡ: THANH KÉO + lăn chuột -------------------------------------
   * Kéo-thả trên khung để DI CHUYỂN, thanh kéo dưới khung (hoặc lăn chuột khi
   * đang chọn) để ĐỔI CỠ. Nút «Đổi cỡ» ba nấc đã bỏ.
   *
   * Khoảng của thanh kéo phụ thuộc firmware:
   *   fw 4.2" ba màu >= 2.6 -> cỡ tự do, đơn vị 1/16 lần (byte size >= 3)
   *   máy cũ hơn / bản bốn màu -> chỉ ba nấc 0/1/2 mà firmware đó dựng được
   * Pin không có đường co giãn nào nên thanh kéo tắt. */
  function freeSizeOk() { return window.__fwFreeSize !== false; }
  function canResize(w) { return !!w && w.type !== 3; }
  function sizeRange(type) {
    if (!freeSizeOk()) return { min: 0, max: (TYPES[type].sizes - 1), step: 1, legacy: true };
    switch (type) {
      case 1: return { min: 8, max: 64, step: 8 };     // đồng hồ số: cS 1..8
      case 2: return { min: 5, max: 60, step: 1 };     // đồng hồ kim: bán kính 12..150
      case 7: return { min: 10, max: 36, step: 1 };    // lịch tháng: rộng 112..400
      default: return { min: 16, max: 48, step: 16 };  // chữ + icon: 1x/2x/3x
    }
  }
  // giá trị hiện tại quy về thang của thanh kéo
  function sizeValue(w) {
    const R = sizeRange(w.type);
    if (R.legacy) return FREE(w.size) ? 0 : w.size;
    return Math.max(R.min, Math.min(R.max, toFree(w.type, w.size)));
  }
  function sizeLabel(w) {
    if (!canResize(w)) return 'Pin chỉ có một cỡ';
    const R = sizeRange(w.type);
    if (R.legacy) return 'Nấc ' + (sizeValue(w) + 1) + '/' + (R.max + 1) + ' (máy chưa hỗ trợ cỡ tự do)';
    const [bw, bh] = dimOf(w);
    return Math.round(sizeValue(w) * 100 / 16) + '%  (' + Math.round(bw) + '×' + Math.round(bh) + ' px)';
  }
  // đặt cỡ từ thanh kéo / lăn chuột
  function applySize(v) {
    const w = st.widgets[sel];
    if (!canResize(w)) return;
    const R = sizeRange(w.type);
    v = Math.max(R.min, Math.min(R.max, Math.round(v)));
    w.size = R.legacy ? v : snapSize(w.type, v);
    clampW(w); save(); redraw();
  }
  // đồng bộ thanh kéo với thành phần đang chọn (gọi ở cuối mỗi lần vẽ lại)
  function syncSizeUI() {
    const sl = document.getElementById('dsSize');
    const lb = document.getElementById('dsSizeLbl');
    if (!sl) return;
    const w = (sel >= 0) ? st.widgets[sel] : null;
    if (!w || !canResize(w)) {
      sl.disabled = true;
      if (lb) lb.textContent = w ? 'Pin chỉ có một cỡ' : 'Chọn một thành phần để đổi cỡ';
      return;
    }
    const R = sizeRange(w.type);
    sl.disabled = false;
    sl.min = R.min; sl.max = R.max; sl.step = R.step;
    sl.value = sizeValue(w);
    if (lb) lb.textContent = sizeLabel(w);
  }
  window.dsSizeInput = function (v) { if (sel >= 0) applySize(Number(v)); };

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
    return [(t.clientX - r.left) * DS_W / r.width, (t.clientY - r.top) * DS_H / r.height];
  }

  function clampW(w) {
    const [bw, bh] = dimOf(w);
    w.x = Math.round(Math.max(0, Math.min(DS_W - bw, w.x)));
    w.y = Math.round(Math.max(0, Math.min(DS_H - bh, w.y)));
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

  window.dsDelete = function () {
    if (sel < 0) return;
    st.widgets.splice(sel, 1);
    sel = -1; save(); redraw();
  };

  window.dsClear = async function () {
    if (!confirm('Xóa toàn bộ thiết kế, KỂ CẢ ảnh nền đang dùng?')) return;
    st.widgets = []; sel = -1; save(); redraw();
    // «Xóa hết» mà chừa lại ảnh nền thì màn hình vẫn còn nguyên nền — bỏ luôn
    await window.dsClearBackground();
  };

  window.dsSetFrame = function (v) { st.frame = Number(v) || 0; save(); redraw(); };

  window.dsTexts = function () {
    for (let i = 0; i < 6; i++) {
      const el = document.getElementById('dsText' + (i + 1));
      if (el) setTextAt(i, el.value);
    }
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
      w.size = fixSize(w.type, w.size);
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
  // đường truyền của mục «Truyền hình ảnh», nên nét và màu y hệt (800x480,
  // đen + đỏ). Ở đây chỉ gửi ảnh vào khe rồi báo thiết bị dùng khe đó làm nền.
  // ĐƯỜNG CŨ — chỉ cho firmware TRƯỚC 2.7/3.7 (mượn KHE ẢNH SỐ 3 làm nền).
  window.dsSetBackground = async function () {
    if ((typeof fwHasNewSlots === 'function' && fwHasNewSlots())) return window.dsBgToDesign(dsDesign);
    if (!window.__fwBg) {
      alert('Máy chưa hỗ trợ ảnh nền (cần firmware 4.2" ba màu từ v2.3, bốn màu từ v3.4).');
      return;
    }
    const src = document.getElementById('canvas');
    if (!src || !src.width) { alert('Chưa có ảnh trong mục «Truyền hình ảnh».'); return; }
    // Cũng chỉ ghi ở trình duyệt: firmware cũ mượn KHE ẢNH 3 làm nền nên lúc
    // «Gửi lên thiết bị» mới đẩy ảnh vào khe đó (xem khối bgPend ở dsUpload).
    st.bgPrev = src.toDataURL('image/png');
    st.bgPend = 'set';
    bgImg = null;
    save(); redraw();
    addLog('Đã đặt ảnh nền cho «Tự thiết kế» (mới ở trình duyệt) — bấm «Gửi lên thiết bị» để áp lên máy.');
  };

  window.dsClearBackground = function () {
    // Cũng chỉ đổi ở trình duyệt: việc xoá trên máy để dành cho «Gửi lên thiết bị».
    st.bg = 0; st.bgPrev = null; st.bgPend = 'clear'; bgImg = null; save(); redraw();
    addLog('Đã bỏ ảnh nền (mới ở trình duyệt) — bấm «Gửi lên thiết bị» để xoá trên máy.');
  };

  window.dsIconFromCanvas = function () {
    // Máy hỗ trợ ảnh nền (4.2" fw >= 2.3): dùng luôn đường NỀN TOÀN MÀN — ảnh
    // giữ nguyên 800x480 như mục «Truyền hình ảnh». Đường icon cũ (tối đa
    // 176px, nhét trong 1 sector 4KB) chỉ còn dùng cho firmware/màn chưa hỗ trợ.
    // fw >= 2.7/3.7: mỗi thiết kế có KHE NỀN RIÊNG -> KHÔNG được rơi vào đường
    // cũ (nó ghi đè KHE ẢNH SỐ 3 rồi gửi lệnh 0x2B đã bỏ -> mất ảnh, không nền).
    if ((typeof fwHasNewSlots === 'function' && fwHasNewSlots())) return window.dsBgToDesign(dsDesign);
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
    syncOverlayShow('Đang chuẩn bị gửi thiết kế ' + (dsDesign + 1) + '…',
      'Ảnh nền, icon và bố cục được gửi lần lượt. Vui lòng không tắt máy và không đóng trang.');
    try {

    // ẢNH NỀN còn nợ máy: hai nút «Làm nền» / «Bỏ ảnh nền» chỉ đổi ở trình
    // duyệt, tới đây mới thật sự gửi. Gửi TRƯỚC bố cục vì nền là lớp dưới cùng.
    if (st.bgPend) {
      const newFwB = (typeof fwHasNewSlots === 'function' && fwHasNewSlots());
      const bgSlot = newFwB ? ((typeof IMG_BG_SLOT === 'function') ? IMG_BG_SLOT(dsDesign) : 5 + dsDesign) : 2;
      if (st.bgPend === 'clear') {
        if (newFwB) {
          syncOverlayStep('Đang bỏ ảnh nền trên thiết bị…',
            'Hạ khe nền của Thiết kế ' + (dsDesign + 1) + '; 5 khe ảnh của bạn không bị đụng tới.');
          if (!await write(EpdCmd.IMG_SLOT, [0x04, bgSlot])) { addLog('Không xoá được ảnh nền trên máy — dừng lại.'); return; }
          if (typeof imgSlotMask === 'number') imgSlotMask &= ~(1 << bgSlot);
        } else if (window.__fwBg) {
          if (!await write(EpdCmd.CUSTOM_BG, [0])) return;
        }
        st.bg = 0;
        addLog('Đã xoá ảnh nền trên thiết bị.');
      } else if (st.bgPend === 'set' && st.bgPrev) {
        if (!newFwB && !window.__fwBg) {
          alert('Máy chưa hỗ trợ ảnh nền toàn màn (cần 4.2" ba màu từ v2.3, bốn màu từ v3.4).');
          return;
        }
        addLog('Đang gửi ảnh nền của «Tự thiết kế ' + (dsDesign + 1) + '»…');
        syncOverlayStep('Đang gửi ảnh nền…',
          'Ảnh nền toàn màn đi vào khe nền riêng của Thiết kế ' + (dsDesign + 1) + ', không đụng 5 khe ảnh.');
        if (!await sendBgFromStore(bgSlot, st.bgPrev)) { addLog('Gửi ảnh nền thất bại — chưa gửi bố cục.'); return; }
        if (typeof imgSlotMask === 'number') imgSlotMask |= (1 << bgSlot);
        if (!newFwB) st.bg = 3;
      }
      st.bgPend = null; save();
    }
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
      syncOverlayStep('Đang gửi icon…',
        'Icon ' + st.icon.w + 'x' + st.icon.h + ' được chẻ nhỏ rồi ghi vào flash của Thiết kế ' + (dsDesign + 1) + '.');
      addLog('Đang gửi icon ' + st.icon.w + 'x' + st.icon.h +
             (twoPlane ? ' (2 mặt đen+ĐỎ, ' : ' (') + bits.length + ' byte, khối ' + chunk + ')...');
      // fw moi: [0x03, idx, w, h, planes] -> icon RIENG cua thiet ke dang sua
      const newFw = (typeof fwHasNewSlots === 'function' && fwHasNewSlots());
      const hdr = newFw ? 5 : (twoPlane ? 4 : 3);
      const n0 = Math.min(chunk, bits.length);
      const first = new Uint8Array(hdr + n0);
      if (newFw) {
        first[0] = 0x03; first[1] = dsDesign;
        first[2] = st.icon.w; first[3] = st.icon.h; first[4] = twoPlane ? 2 : 1;
      } else {
        first[0] = twoPlane ? 0x02 : 0x00;
        first[1] = st.icon.w; first[2] = st.icon.h;
        if (twoPlane) first[3] = 2;
      }
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
    // fw moi: moi thiet ke co khe nen rieng nen KHONG con lenh chon khe nua
    const newFw2 = (typeof fwHasNewSlots === 'function' && fwHasNewSlots());
    if (!newFw2 && window.__fwBg) await write(EpdCmd.CUSTOM_BG, [st.bg || 0]);
    const enc = new TextEncoder();
    // Máy đời trước v2.8/v3.8 chỉ hiểu 2 ô chữ (bố cục 158 byte, một gói).
    const six = (typeof fwHasSixText === 'function') && fwHasSixText();
    const slots = six ? 6 : 2;
    const texts = [];
    for (let i = 0; i < slots; i++) {
      const b = enc.encode(textAt(i));
      if (b.length > 47) {
        alert('Ô «Chữ ' + (i + 1) + '» quá dài (tối đa 47 byte; chữ có dấu chiếm 2-3 byte mỗi chữ).');
        return;
      }
      texts.push(b);
    }
    if (!six && st.widgets.some(w => w.type > 10)) {
      alert('Máy này chỉ dùng được «Chữ 1» và «Chữ 2» (cần firmware 4.2" ba màu từ v2.8, bốn màu từ v3.8).\n\n'
            + 'Hãy bỏ bớt các thành phần Chữ 3-6 / Thứ / Ngày dương rồi gửi lại.');
      return;
    }
    const buf = new Uint8Array(62 + slots * 48);
    buf[0] = st.widgets.length;
    buf[1] = st.frame;
    st.widgets.forEach((w, i) => {
      const o = 2 + i * 6;
      buf[o] = w.type; buf[o + 1] = w.size;
      buf[o + 2] = w.x & 0xFF; buf[o + 3] = (w.x >> 8) & 0xFF;
      buf[o + 4] = w.y & 0xFF; buf[o + 5] = (w.y >> 8) & 0xFF;
    });
    texts.forEach((t, i) => buf.set(t, 62 + i * 48));

    // Bố cục 6 ô chữ dài 350 byte — VƯỢT MTU (tối đa 247, tức 244 byte tải)
    // nên phải chẻ. Máy đời trước vẫn nhận trọn gói như cũ.
    let sent;
    if (six) {
      const room = Math.max(32, (Number(document.getElementById('mtusize').value) || 20) - 10);
      sent = true;
      syncOverlayStep('Đang gửi bố cục…',
        'Vị trí các thành phần và nội dung các dòng chữ. Gửi xong máy tự chuyển sang Thiết kế '
        + (dsDesign + 1) + ' và vẽ lại sau khoảng 30 giây.');
      for (let off = 0; off < buf.length && sent; off += room) {
        syncOverlayProgress(off, buf.length);
        const part = buf.subarray(off, Math.min(off + room, buf.length));
        sent = await write(EpdCmd.SET_LAYOUT,
          [0xF0, dsDesign, off & 0xFF, (off >> 8) & 0xFF, ...part]);
      }
      if (sent) sent = await write(EpdCmd.SET_LAYOUT,
        [0xF1, dsDesign, buf.length & 0xFF, (buf.length >> 8) & 0xFF]);
    } else {
      syncOverlayStep('Đang gửi bố cục…',
        'Vị trí các thành phần và nội dung các dòng chữ. Gửi xong máy tự chuyển sang thiết kế này và vẽ lại sau khoảng 30 giây.');
      let payload = buf;
      if (newFw2) { payload = new Uint8Array(1 + buf.length); payload[0] = dsDesign; payload.set(buf, 1); }
      sent = await write(EpdCmd.SET_LAYOUT, payload);
    }
    if (sent) {
      addLog('Đã gửi giao diện tự thiết kế! (thiết bị báo lại \'layout=<số thành phần>\')');
      // Số mode của «Tự thiết kế» đã đổi: 22 (thiết kế 1) / 23 (thiết kế 2).
      // Máy đời cũ vẫn là 20 — modeToWire/highlightMode tự quy đổi.
      const cardMode = (typeof fwHasNewSlots === 'function' && fwHasNewSlots()) ? (22 + dsDesign) : 20;
      addLog('Thiết bị tự chuyển sang «Tự thiết kế ' + (dsDesign + 1) + '» và hiển thị sau ~30 giây.');
      if (typeof highlightMode === 'function') highlightMode(cardMode);
    }
    } catch (e) {
      console.error(e);
      addLog('Lỗi khi gửi thiết kế: ' + ((e && e.message) ? e.message : e));
    } finally {
      syncOverlayHide();
    }
  };

  /* ---- init ---- */

  function init() {
    canvas = document.getElementById('designerCanvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    for (let i = 0; i < 6; i++) {
      const el = document.getElementById('dsText' + (i + 1));
      if (el) el.value = textAt(i);
    }
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
      if (sel < 0) return;
      const [px, py] = evPos(ev);
      const w = st.widgets[sel];
      if (!dragOff) return;
      w.x = px - dragOff[0]; w.y = py - dragOff[1];
      clampW(w);
      ev.preventDefault();
      redraw();
    };
    const up = () => { if (dragOff) { dragOff = null; save(); } };
    // lăn chuột trên thành phần đang chọn = đổi cỡ (cùng thang với thanh kéo)
    const wheel = ev => {
      if (sel < 0 || !canResize(st.widgets[sel])) return;
      const R = sizeRange(st.widgets[sel].type);
      applySize(sizeValue(st.widgets[sel]) + (ev.deltaY < 0 ? R.step : -R.step));
      ev.preventDefault();
    };

    canvas.addEventListener('mousedown', down);
    canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    canvas.addEventListener('touchstart', down, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', up);
    canvas.addEventListener('wheel', wheel, { passive: false });

    redraw();
    setInterval(redraw, 30000); // keep the clock widgets current
  }

  // Doi thiet ke dang sua: nap bo cuc cua thiet ke do tu trinh duyet.
  window.dsSelectDesign = function (d) {
    dsDesign = (+d === 1) ? 1 : 0;
    let s2 = null;
    try { s2 = JSON.parse(localStorage.getItem(lsKey())); } catch (e) {}
    st = (s2 && s2.widgets) ? s2 : { widgets: [], frame: 0, t1: '', t2: '' };
    st.widgets = (st.widgets || []).filter(w => TYPES[w.type]).map(w => {
      w.size = fixSize(w.type, w.size);
      return w;
    });
    bgImg = null;
    const f = document.getElementById('dsFrame'); if (f) f.value = st.frame || 0;
    for (let i = 0; i < 6; i++) {
      const el = document.getElementById('dsText' + (i + 1));
      if (el) el.value = textAt(i);
    }
    redraw();
    addLog('Dang sua «Tu thiet ke ' + (dsDesign + 1) + '».');
  };

  // Gui anh dang co o muc «Truyen hinh anh» lam NEN cua mot thiet ke (khe nen
  // RIENG cua thiet ke do, khong dung toi khe anh cua nguoi dung).
  // Sửa trạng thái của MỘT thiết kế, kể cả thiết kế không mở trên màn hình.
  function patchDesign(d, fn) {
    if (d === dsDesign) { fn(st); save(); return; }
    const key = (d === 0) ? LS_KEY_BASE : LS_KEY_BASE + '_d' + d;
    let s2 = null;
    try { s2 = JSON.parse(localStorage.getItem(key)); } catch (e) {}
    if (!s2 || !s2.widgets) s2 = { widgets: [], frame: 0, t1: '', t2: '' };
    fn(s2);
    try { localStorage.setItem(key, JSON.stringify(s2)); } catch (e) {}
  }

  /* ẢNH NỀN chỉ đổi Ở TRÌNH DUYỆT; máy chỉ nhận khi bấm «Gửi lên thiết bị».
   * st.bgPrev = ảnh nền (dataURL — vừa để xem trước, vừa là bản đem gửi)
   * st.bgPend = 'set' | 'clear' | rỗng — việc còn nợ máy ở lần gửi kế tiếp.
   * Nhờ vậy nút này không đụng gì tới thiết bị nên KHÔNG cần hỏi xác nhận. */
  window.dsBgToDesign = function (d) {
    const src = document.getElementById('canvas');
    if (!src || !src.width) { alert('Chưa có ảnh trong mục «Truyền hình ảnh».'); return; }
    const url = src.toDataURL('image/png');
    patchDesign(d, s => { s.bgPrev = url; s.bgPend = 'set'; });
    if (d === dsDesign) { bgImg = null; redraw(); }
    addLog('Đã đặt ảnh nền cho «Tự thiết kế ' + (d + 1) + '» (mới ở trình duyệt) — bấm «Gửi lên thiết bị» của thiết kế đó để áp lên máy.');
  };

  // Nạp ảnh nền đã lưu vào khe của thiết bị. Đường gửi ảnh đọc thẳng #canvas
  // nên phải mượn canvas một lát rồi TRẢ LẠI đúng ảnh người dùng đang có.
  async function sendBgFromStore(slot, dataUrl) {
    const cv = document.getElementById('canvas');
    if (!cv || !cv.width) { alert('Không tìm thấy khung ảnh.'); return false; }
    if (typeof sendimg !== 'function') { alert('Không tìm thấy chức năng gửi ảnh.'); return false; }
    const c2 = cv.getContext('2d');
    const snapshot = cv.toDataURL('image/png');
    const load = u => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = u; });
    const img = await load(dataUrl);
    if (!img) { alert('Ảnh nền đã lưu bị hỏng — hãy chọn lại.'); return false; }
    let ok = false;
    try {
      c2.clearRect(0, 0, cv.width, cv.height);
      c2.drawImage(img, 0, 0, cv.width, cv.height);
      ok = (await sendimg(slot)) !== false;
    } finally {
      const back = await load(snapshot);
      if (back) { c2.clearRect(0, 0, cv.width, cv.height); c2.drawImage(back, 0, 0); }
    }
    return ok;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
