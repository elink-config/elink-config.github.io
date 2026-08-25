/*
 * Mode gallery: canvas previews of every display mode with an apply button.
 * Previews are drawn at the panel's landscape size (296x128,
 * supersampled 2x) and mirror the firmware layouts in user_custs1_impl.c.
 * BẢN CHO FIRMWARE v2.x — đánh số LIỀN MẠCH theo quy ước của cả họ máy:
 *     0      = Ảnh đã lưu — CÓ trong firmware nhưng KHÔNG có thẻ ở đây
 *     1..28  = các chế độ, liền mạch, đúng thứ tự thẻ ở đây
 *
 * Thẻ «Ảnh đã lưu» đã bỏ 25/08/2026: hàng nút «Hiện lại ảnh khe 1..5» (lệnh
 * 0x27 05) làm việc đó tốt hơn — chọn được ĐÚNG khe muốn hiện, còn thẻ cũ chỉ
 * đưa máy về chế độ ảnh rồi hiện khe đang chọn sẵn.
 * Bản cho firmware đời cũ nằm ở js/2_9 và giữ cách đánh số cũ —
 * ĐỪNG chép qua lại giữa hai bản.
 *
 * Số ở đây là MỘT GIAO ƯỚC với enum display_mode_t trong firmware
 * (epd_2_9inch_new/src/gui/GUI.h). Đổi một bên là phải đổi bên kia.
 */
(function () {
  // BK/WH/GY, WD_FULL, WD_HDR, pad2, dateLine, voltValue, panelTempVal,
  // lunarText, IMG_MODE... đều nằm ở js/2_9n/common.js (nạp trước file này)

  // panel landscape size — máy này một tấm 296×128 (đọc qua RESOLUTIONS cho
  // chung một đường với các máy nhiều tấm)
  function panelSize() {
    if (typeof RESOLUTIONS !== 'undefined' && typeof resIdx !== 'undefined') {
      return { w: RESOLUTIONS[resIdx].w, h: RESOLUTIONS[resIdx].h };
    }
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
  function serif(x, s, b, i) { x.font = (b ? 'bold ' : '') + (i ? 'italic ' : '') + s + 'px "Times New Roman",Georgia,serif'; }
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

  // Cac ham ve so 7 doan (SEG/seg7/segStr/segWidth) DA GO 25/08/2026.
  // Chung mo phong font DSEG7-50, ma DSEG7 da bi go khoi firmware tu v1.10 vi
  // het RAM (thay bang arial52 — xem epd_gui.c). Giu lai chi lam the gallery
  // hua mot kieu chu may khong ve duoc. Dung them lai neu khong nap font moi.

  // Cỡ chữ số LỚN, đo từ chính font trong máy (asset của máy này):
  //   ARIAL_BIG -> arial52_2_13_tn, chữ số cao 37px
  //   TIMES_BIG -> times72_2_13_tn, chữ số cao 50px (tên font nói 72 là lệch)
  // Times New Roman trên canvas cao ~0,662em nên phải 75px mới ra 50px.
  const ARIAL_BIG = '50px Arial, sans-serif';
  const TIMES_BIG = 75;

  // pin của firmware: khung 15×9, đầu (nub) bên TRÁI, điện áp "X.Xv" chữ NHỎ
  // (6x10) bên trái icon, CĂN GIỮA theo icon. Mức pin theo điện áp tuyến tính:
  // 3.1V = đầy (100%), 2.4V = cạn (0%). bx = mép trái khung (firmware: x = W-16, tâm y = 7).
  function battery(x, bx, by, col, label) {
    col = col || BK;
    x.strokeStyle = col; x.lineWidth = 1;
    x.strokeRect(bx + 0.5, by + 0.5, 14, 8);
    x.fillStyle = col;
    x.fillRect(bx - 2, by + 3, 2, 3);           // nub bên trái (icon "xoay 180°")
    const p = Math.max(0, Math.min(10, Math.round((voltValue() - 2.4) * 10 / 0.7)));
    if (p > 0) x.fillRect(bx + 12 - p, by + 2, p + 1, 5);   // đầy từ bên phải
    if (label) { font(x, 8, 0); right(x, label, bx - 4, by + 7.5, col); }
  }
  function statusBatt(x, W) { battery(x, W - 16, 3, BK, voltLabel()); }
  function tempCorner(x, col) {
    font(x, 9, 0); x.fillStyle = col || BK; x.fillText(panelTempVal() + '°C', 4, 11);
  }

  // pad2/dateLine ở common.js; lunarStr = lunarText với tiền tố mặc định
  function lunarStr(now) { return lunarText(now); }
  function weekOfYear(now) {
    const jan1 = new Date(now.getFullYear(), 0, 1);
    const yday = Math.floor((now - jan1) / 86400000);
    const off = (jan1.getDay() + 6) % 7;
    return Math.floor((yday + off) / 7) + 1;
  }

  /* ══════════════════════════════════════════════════════════════════════
   * BẢN VẼ 28 CHẾ ĐỘ — soi theo epd_2_9inch_new/src/gui/GUI.c
   *
   * Toạ độ ở đây là TOẠ ĐỘ THẬT trên tấm (296×128 nằm ngang, 128×296 dựng
   * dọc), chép thẳng từ các hàm Draw* bên firmware. Nhờ vậy sửa một bên là
   * biết phải sửa gì bên kia.
   *
   * Chỗ KHÔNG giống được: chữ. Máy dùng font ẢNH ĐIỂM (unifont 16, 6x10,
   * Times 50, Arial 37, Hobo 52/64), trình duyệt chỉ có font tỷ lệ. Nên:
   *   · đường cơ sở lấy đúng hằng số của máy (BL_*)
   *   · cỡ chữ trên canvas chọn sao cho CHIỀU CAO chữ ra gần bằng máy
   *   · riêng Hobo thì vẽ từng chữ số vào ô rộng cố định, vì bề rộng bước
   *     của nó đọc được từ blob font (36/18 ở cỡ 52, 44/22 ở cỡ 64)
   * ═══════════════════════════════════════════════════════════════════════ */

  /* MỰC ĐỎ. Tấm này là BA MÀU (đen / đỏ / trắng) — bản chép từ máy 2.13" quy
   * «đỏ» về đen vì tấm bên đó chỉ có hai màu. */
  const RED = '#c02a1e';

  /* Đường cơ sở của từng font, lấy nguyên hằng số BL_* trong GUI.c. */
  const BL_UNI = 14, BL_6X10 = 8, BL_TIMES = 65, BL_ARIAL = 48;
  const BL_HOBO = 53, BL_HOBO9 = 65, BL_EBOY = 8;

  /* Placeholder cho ngày lễ / tiết khí: webtool không mang bảng lễ theo, còn
   * máy thì tra thật. Thẻ xem trước chỉ cần cho thấy CHỖ của dòng đó. */
  const EXTRA = 'Đông chí';

  // ── chữ theo từng font của máy ────────────────────────────────────────
  function uni(x, s, px, y, bold, col) { font(x, 13, bold); x.fillStyle = col || BK; x.fillText(s, px, y); }
  function uniC(x, s, cx, y, bold, col) { font(x, 13, bold); center(x, s, cx, y, col || BK); }
  function uniR(x, s, rx, y, bold, col) { font(x, 13, bold); right(x, s, rx, y, col || BK); }
  function sml(x, s, px, y, bold, col) { font(x, 9, bold); x.fillStyle = col || BK; x.fillText(s, px, y); }
  function smlC(x, s, cx, y, bold, col) { font(x, 9, bold); center(x, s, cx, y, col || BK); }
  function smlR(x, s, rx, y, bold, col) { font(x, 9, bold); right(x, s, rx, y, col || BK); }
  function eboy(x, s, cx, y, col) { font(x, 7, 0); center(x, s, cx, y, col || BK); }
  /* Times 50 điểm và Arial 37 điểm — cỡ canvas chọn để chiều cao chữ số khớp:
   * Times New Roman cao ~0,662em, Arial ~0,716em. */
  function big(x, s, cx, y, col) { serif(x, TIMES_BIG, 0); center(x, s, cx, y, col || BK); }
  function bigL(x, s, px, y, col) { serif(x, TIMES_BIG, 0); x.fillStyle = col || BK; x.fillText(s, px, y); }
  function ari(x, s, px, y, col) { x.font = ARIAL_BIG; x.fillStyle = col || BK; x.fillText(s, px, y); }
  function ariW(x, s) { x.font = ARIAL_BIG; return x.measureText(s).width; }

  /* Chữ cỡ ĐÔI của máy (draw_x2) — unifont nhân 2, cao 32 điểm.
   * Bề rộng THẬT = 8·k mỗi ký tự, vì unifont là font điểm ảnh rộng đều. */
  const uniW = (s, k) => [...String(s)].length * 8 * (k || 1);
  function unik(x, s, px, yTop, k, col) {
    font(x, 13 * k, 1);
    x.fillStyle = col || BK;
    x.textAlign = 'center';
    const cell = 8 * k;
    let i = 0;
    for (const c of String(s)) { x.fillText(c, px + i * cell + cell / 2, yTop + BL_UNI * k); i++; }
    x.textAlign = 'left';
  }

  /* Hobo: chữ số rộng CỐ ĐỊNH (bề rộng bước đọc từ blob font). Vẽ từng chữ
   * vào ô của nó nên cụm rộng đúng bằng máy, dù máy khách có font Hobo hay
   * không. Cỡ canvas = chiều cao chữ / 0,72. */
  const HOBO52 = { w: 36, colon: 18, h: 52 };
  const HOBO64 = { w: 44, colon: 22, h: 64 };
  const hoboW = (s, f) => [...String(s)].reduce((n, c) => n + (c === ':' ? f.colon : f.w), 0);
  function hoboFont(x, f) {
    x.font = Math.round(f.h / 0.72) + 'px "Hobo Std","HoboStd",Arial,sans-serif';
  }
  function hoboPass(x, s, px, base, f, col) {
    x.fillStyle = col;
    x.textAlign = 'center';
    let p = px;
    for (const c of String(s)) { const cw = (c === ':') ? f.colon : f.w; x.fillText(c, p + cw / 2, base); p += cw; }
    x.textAlign = 'left';
  }
  function hobo(x, s, px, base, f, col) { hoboFont(x, f); hoboPass(x, s, px, base, f, col || BK); }
  /* Chữ NỔI 3D (draw_text_3d): bóng đổ (+3,+3), viền tám hướng đen, lòng trắng. */
  function hobo3d(x, s, px, base, f) {
    hoboFont(x, f);
    hoboPass(x, s, px + 3, base + 3, f, BK);
    for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]])
      hoboPass(x, s, px + dx, base + dy, f, BK);
    hoboPass(x, s, px, base, f, WH);
  }

  // ── pin, nhiệt độ góc ─────────────────────────────────────────────────
  /* draw_batt_c(x, y): khung 15×9 đặt tại (x, y-4) — y là TÂM icon. */
  function battAt(x, bx, cy, col) { battery(x, bx, cy - 4, col, null); }
  /* draw_status_batt: icon ở mép phải, chuỗi pin bên trái icon. */
  function statusBattAt(x, W, cy, col) {
    const nhan = voltLabel();
    battery(x, W - 16, cy - 4, col || BK, null);
    // cài đặt «Không» -> chuỗi rỗng, chỉ còn icon (batt_text cũng trả rỗng)
    if (nhan) smlR(x, nhan, W - 16 - 6, (cy - 4) + BL_6X10, 0, col || BK);
  }
  function tempCornerUni(x, col) { uni(x, panelTempVal() + '°C', 4, 1 + BL_UNI, 0, col); }

  // ── mặt đồng hồ kim (clock_face) ──────────────────────────────────────
  /* Vạch 12/3/6/9 tô ĐỎ và vẽ dày hơn một nét — mực đỏ nhạt hơn mực đen.
   * skipMain = bỏ bốn vạch chính vì chế độ đó ghi số ở chỗ ấy. */
  function face(x, cx, cy, r, now, skipMain) {
    x.strokeStyle = BK; x.lineWidth = 1;
    x.beginPath(); x.arc(cx, cy, r, 0, 7); x.stroke();
    x.beginPath(); x.arc(cx, cy, r - 1, 0, 7); x.stroke();
    for (let k = 0; k < 60; k += 5) {
      const chinh = (k % 15) === 0;
      if (skipMain && chinh) continue;
      const a = k * Math.PI / 30;
      x.strokeStyle = chinh ? RED : BK; x.lineWidth = chinh ? 2 : 1;
      x.beginPath();
      x.moveTo(cx + (r - 3) * Math.sin(a), cy - (r - 3) * Math.cos(a));
      x.lineTo(cx + (r - 8) * Math.sin(a), cy - (r - 8) * Math.cos(a));
      x.stroke();
    }
    const h = now.getHours() % 12, m = now.getMinutes();
    const ha = (h + m / 60) * Math.PI / 6, ma = m * Math.PI / 30;
    x.strokeStyle = BK; x.lineWidth = 3;
    x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + (r / 2) * Math.sin(ha), cy - (r / 2) * Math.cos(ha)); x.stroke();
    x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + (r * 3 / 4) * Math.sin(ma), cy - (r * 3 / 4) * Math.cos(ma)); x.stroke();
    x.lineWidth = 1;
    x.beginPath(); x.arc(cx, cy, 3, 0, 7); x.stroke();
    x.beginPath(); x.arc(cx, cy, 2, 0, 7); x.stroke();
  }

  // ── lưới lịch dùng chung (grid_header + month_grid_s) ─────────────────
  const WD_MON = WD_HDR;                 // T2 đứng đầu, như WD_GRID của firmware
  const firstColOf = now => (new Date(now.getFullYear(), now.getMonth(), 1).getDay() + 6) % 7;
  const mdaysOf = now => new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  function lunarDayOf(d) {
    try { const l = window.lunarToday(d); return { day: l.day, mon: l.month & 0x7f }; }
    catch (e) { return { day: 1, mon: 1 }; }
  }

  /* grid_header: ô T7/CN nền ĐỎ chữ trắng, vạch trắng ngăn giữa hai ô. */
  function gridHead(x, gx, gy, gw, cw, rh) {
    for (let i = 0; i < 7; i++) {
      const wknd = i >= 5;
      if (wknd) { x.fillStyle = RED; x.fillRect(gx + i * cw, gy, cw, rh - 2); }
      smlC(x, WD_MON[i], gx + i * cw + cw / 2, (gy + 2) + BL_6X10, 1, wknd ? WH : BK);
      if (i === 6) { x.fillStyle = WH; x.fillRect(gx + i * cw, gy, 1, rh - 2); }
    }
    x.fillStyle = BK; x.fillRect(gx, gy + rh - 2, gw, 1);
  }

  /* month_grid_s: hôm nay ô ĐỎ chữ trắng, ngày T7/CN chữ ĐỎ. */
  function gridMon(x, now, gx, gy, cw, rh, lunarSub) {
    const first = firstColOf(now), maxD = mdaysOf(now);
    for (let d = 1; d <= maxD; d++) {
      const idx = first + d - 1, col = idx % 7, row = (idx - col) / 7;
      const cx = gx + col * cw + cw / 2, cy = gy + row * rh;
      const today = d === now.getDate();
      if (today) { x.fillStyle = RED; x.fillRect(cx - cw / 2, cy - 1, cw, lunarSub ? 16 : rh - 1); }
      smlC(x, d, cx, cy + BL_6X10, 1, today ? WH : (col >= 5 ? RED : BK));
      if (lunarSub) {
        const l = lunarDayOf(new Date(now.getFullYear(), now.getMonth(), d));
        eboy(x, l.day === 1 ? '1/' + l.mon : l.day, cx, (cy + 6) + BL_EBOY, today ? WH : BK);
      }
    }
  }

  // ── ô BO GÓC (draw_rect_r / draw_box_r) ───────────────────────────────
  function boxR(x, x1, y1, x2, y2, col, fill) {
    x.beginPath();
    if (x.roundRect) x.roundRect(x1 + 0.5, y1 + 0.5, x2 - x1, y2 - y1, 3);
    else x.rect(x1 + 0.5, y1 + 0.5, x2 - x1, y2 - y1);
    if (fill) { x.fillStyle = col; x.fill(); }
    else { x.strokeStyle = col; x.lineWidth = 1; x.stroke(); }
  }

  // ══════════════════════ CHẾ ĐỘ 1 — ĐỒNG HỒ + LỊCH ÂM (DrawClock) ══════
  function m0(x, now, W, H) {
    statusBattAt(x, W, 8, BK);
    uni(x, dateLine(now), 4, 0 + BL_UNI, 1);

    const b = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    hobo(x, b, (W - hoboW(b, HOBO64)) / 2,
         (24 + ((108 - 4) - 24 - HOBO64.h) / 2) + BL_HOBO9, HOBO64, BK);

    // hàng cuối: âm lịch ĐỎ đậm | ngày lễ | nhiệt độ
    uni(x, lunarStr(now), 6, 108 + BL_UNI, 1, RED);
    const t = panelTempVal() + '°C';
    font(x, 13, 0);
    const tw = x.measureText(t).width;
    uni(x, t, W - 4 - tw, 108 + BL_UNI, 0);
    uniR(x, EXTRA, W - 4 - tw - 10, 108 + BL_UNI, 0);
  }

  // ══════════════════════ CHẾ ĐỘ 2 — GIỜ NỔI 3D (DrawClock3D) ══════════
  function m13(x, now, W, H) {
    uni(x, WD_FULL[now.getDay()] + ' ' + pad2(now.getDate()) + '-' + pad2(now.getMonth() + 1) +
           '-' + now.getFullYear(), 6, 0 + BL_UNI, 1);
    statusBattAt(x, W, 8, BK);

    const b = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    hobo3d(x, b, (W - hoboW(b, HOBO64) - 3) / 2,
           (24 + ((H - 20) - 24 - HOBO64.h) / 2) + BL_HOBO9, HOBO64);

    const lt = lunarText(now, { prefix: 'Âm lịch  ', pad: false });
    font(x, 13, 1);
    uni(x, lt, (W - x.measureText(lt).width) / 2 - 10, (H - 17) + BL_UNI, 1);
    smlR(x, panelTempVal() + '°C', W - 8, (H - 14) + BL_6X10, 0);
  }

  // ══════════════════════ CHẾ ĐỘ 3 — ĐỒNG HỒ BẢNG LẬT (DrawFlip) ═══════
  function m7(x, now, W, H) {
    const yB = 108;
    const b0 = 18, b1 = yB - 4;          // bảng đen
    const t0 = b0 + 4, t1 = b1 - 4;      // thẻ trắng
    const ts = (t0 + t1) / 2;            // khe gập
    const cgap = 22;
    const tw4 = ((W - 12 - 16 - 2 * 5 - cgap) / 4) | 0;
    const x0 = ((W - (tw4 * 4 + 2 * 5 + cgap)) / 2) | 0;

    uni(x, dateLine(now), 4, 0 + BL_UNI, 1);
    statusBattAt(x, W, 8, BK);

    // bảng đen bo góc
    x.fillStyle = BK;
    x.beginPath();
    if (x.roundRect) x.roundRect(6, b0, W - 12, b1 - b0 + 1, 4); else x.rect(6, b0, W - 12, b1 - b0 + 1);
    x.fill();

    const xs = [x0, x0 + tw4 + 5, x0 + tw4 * 2 + 5 + cgap, x0 + tw4 * 3 + 10 + cgap];
    const dg = pad2(now.getHours()) + pad2(now.getMinutes());
    for (let i = 0; i < 4; i++) {
      const tx = xs[i];
      x.fillStyle = WH;
      x.beginPath();
      if (x.roundRect) x.roundRect(tx, t0, tw4, t1 - t0 + 1, 3); else x.rect(tx, t0, tw4, t1 - t0 + 1);
      x.fill();
      // chữ số căn giữa thẻ theo chiều dọc: thẻ cao (t1-t0), chữ cao 50
      big(x, dg[i], tx + tw4 / 2, t0 + ((t1 - t0) - 50) / 2 + 50, BK);
      x.fillStyle = BK;
      x.fillRect(tx, ts, tw4, 1);                    // khe gập
      x.fillRect(tx - 2, ts - 4, 3, 9);              // chốt trục trái
      x.fillRect(tx + tw4 - 1, ts - 4, 3, 9);        // chốt trục phải
    }

    // dấu «:» hai chấm ĐỎ giữa hai cặp thẻ
    const cxm = x0 + tw4 * 2 + 5 + cgap / 2;
    x.fillStyle = RED;
    x.fillRect(cxm - 3, ts - 14, 6, 6);
    x.fillRect(cxm - 3, ts + 9, 6, 6);

    // hàng dưới: âm lịch đậm | tiết khí | nhiệt độ
    uni(x, lunarStr(now), 4, yB + BL_UNI, 1);
    const t = panelTempVal() + '°C';
    font(x, 13, 0);
    uni(x, t, W - 4 - x.measureText(t).width, yB + BL_UNI, 0);
    uniC(x, EXTRA, W / 2, yB + BL_UNI, 0);
  }

  // ══════════════════════ CHẾ ĐỘ 4 — NGÀY NỔI + KIM (DrawDayKim) ═══════
  function m16(x, now, W, H) {
    const rh = (H / 7) | 0;
    const mx = ((W - 74) / 2) | 0;
    const cx = W - 52, cy = H / 2;
    let r = H / 2 - 4;
    if (r > (W - cx) - 6) r = (W - cx) - 6;

    // cột thứ dọc: hôm nay ô ĐỎ chữ trắng, T7/CN chữ ĐỎ
    const wdIdx = (now.getDay() + 6) % 7;
    for (let i = 0; i < 7; i++) {
      const y = i * rh + (rh > 15 ? ((rh - 15) / 2) | 0 : 0);
      if (i === wdIdx) {
        x.fillStyle = RED; x.fillRect(2, i * rh + 1, 31, rh - 1);
        uni(x, WD_MON[i], 6, y + BL_UNI, 1, WH);
      } else {
        uni(x, WD_MON[i], 6, y + BL_UNI, 1, i >= 5 ? RED : BK);
      }
    }

    // tháng-năm trên cột giữa
    const my = pad2(now.getMonth() + 1) + '-' + now.getFullYear();
    font(x, 13, 1);
    uni(x, my, mx - x.measureText(my).width / 2, 1 + BL_UNI, 1);

    // số ngày Hobo RỖNG 3D, căn giữa khoảng trống
    const ds = String(now.getDate());
    let tx = mx - hoboW(ds, HOBO52) / 2 - 2;
    if (tx < 35) tx = 35;
    hobo3d(x, ds, tx, (18 + ((H - 30) - 18 - 52) / 2) + BL_HOBO, HOBO52);

    // âm lịch dưới số ngày
    font(x, 13, 1);
    uni(x, 'Âm lịch', mx - x.measureText('Âm lịch').width / 2, (H - 30) + BL_UNI, 1);
    const l = lunarDayOf(now);
    const lst = l.day + '/' + pad2(l.mon);
    font(x, 13, 0);
    uni(x, lst, mx - x.measureText(lst).width / 2, (H - 15) + BL_UNI, 0);

    // đồng hồ kim KHÔNG viền: số 12/3/6/9 ĐỎ, các giờ khác dấu chữ thập
    uniC(x, '12', cx, (cy - r - 2) + BL_UNI, 0, RED);
    uniC(x, '3', cx + r, (cy - 7) + BL_UNI, 0, RED);
    uniC(x, '6', cx, (cy + r - 13) + BL_UNI, 0, RED);
    uniC(x, '9', cx - r, (cy - 7) + BL_UNI, 0, RED);
    x.fillStyle = BK;
    for (let i = 5; i < 60; i += 5) {
      if (i % 15 === 0) continue;
      const a = i * Math.PI / 30;
      const x1 = cx + (r - 4) * Math.sin(a), y1 = cy - (r - 4) * Math.cos(a);
      x.fillRect(x1 - 2, y1, 5, 1);
      x.fillRect(x1, y1 - 2, 1, 5);
    }
    const h = now.getHours() % 12, m = now.getMinutes();
    const ha = (h + m / 60) * Math.PI / 6, ma = m * Math.PI / 30;
    x.strokeStyle = BK; x.lineWidth = 3;
    x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + (r * 5 / 9) * Math.sin(ha), cy - (r * 5 / 9) * Math.cos(ha)); x.stroke();
    x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + (r * 4 / 5) * Math.sin(ma), cy - (r * 4 / 5) * Math.cos(ma)); x.stroke();
    x.lineWidth = 1;
    x.beginPath(); x.arc(cx, cy, 2, 0, 7); x.stroke();
  }

  // ══════════ CHẾ ĐỘ 5 — LỊCH DƯƠNG + KIM + LỊCH ÂM (DrawTwoCal) ═══════
  function m12(x, now, W, H) {
    const cw = 14, gw = cw * 7;
    const lx = 3, rxg = W - 3 - gw;
    const gy = 46, rh = ((H - gy - 14) / 6) | 0;

    uni(x, WD_FULL[now.getDay()], lx + 1, 1 + BL_UNI, 1);
    uni(x, pad2(now.getMonth() + 1) + '/' + now.getFullYear(), lx + 1, 18 + BL_UNI, 1);

    font(x, 13, 1);
    uni(x, 'Âm lịch', rxg + gw - x.measureText('Âm lịch').width - 1, 1 + BL_UNI, 1);
    const l = lunarDayOf(now), ls = l.day + '/' + pad2(l.mon);
    uni(x, ls, rxg + gw - x.measureText(ls).width - 8, 18 + BL_UNI, 1);

    // tiêu đề thứ cho cả hai lưới — T7/CN màu ĐỎ
    for (let i = 0; i < 7; i++) {
      const col = i >= 5 ? RED : BK;
      eboy(x, WD_MON[i], lx + i * cw + cw / 2, (gy - 2) + BL_EBOY, col);
      eboy(x, WD_MON[i], rxg + i * cw + cw / 2, (gy - 2) + BL_EBOY, col);
    }
    x.fillStyle = BK;
    x.fillRect(lx, gy + 10, gw, 1);
    x.fillRect(rxg, gy + 10, gw, 1);

    // lưới DƯƠNG (trái): hôm nay chữ ĐỎ + khung ĐỎ (ô quá nhỏ, tô đặc nuốt số)
    const first = firstColOf(now), maxD = mdaysOf(now);
    for (let d = 1; d <= maxD; d++) {
      const idx = first + d - 1, col = idx % 7, row = (idx - col) / 7;
      const cx = lx + col * cw + cw / 2, cy = gy + 13 + row * rh;
      const today = d === now.getDate();
      eboy(x, d, cx, (cy - 3) + BL_EBOY, today ? RED : BK);
      if (today) {
        x.strokeStyle = RED; x.lineWidth = 1;
        x.strokeRect(cx - cw / 2 + 0.5, cy - (rh - 4) / 2 + 0.5, cw, 5 + (rh - 4));
      }
    }

    // lưới ÂM (phải): hôm nay nền ĐỎ chữ trắng
    const lm = lunarDayOf(now);
    const lfirst = (((now.getDay() - ((lm.day - 1) % 7) + 70) % 7) + 6) % 7;
    for (let d = 1; d <= 30; d++) {
      const idx = lfirst + d - 1, col = idx % 7, row = (idx - col) / 7;
      const cx = rxg + col * cw + cw / 2, cy = gy + 13 + row * rh;
      const today = d === lm.day;
      if (today) { x.fillStyle = RED; x.fillRect(cx - cw / 2, cy - (rh - 4) / 2, cw, 5 + (rh - 4)); }
      eboy(x, d, cx, (cy - 3) + BL_EBOY, today ? WH : BK);
    }

    // giữa: đồng hồ kim
    let r = ((rxg - (lx + gw)) / 2 - 2) | 0;
    if (r > H / 2 - 3) r = (H / 2 - 3) | 0;
    face(x, W / 2, H / 2, r, now, 0);

    // đáy: giờ số căn giữa + pin
    smlC(x, pad2(now.getHours()) + ':' + pad2(now.getMinutes()), W / 2, (H - 11) + BL_6X10, 1);
    battAt(x, W - 16, H - 7, BK);
    smlR(x, voltLabel(), W - 16 - 6, (H - 11) + BL_6X10, 0);
  }

  // ══════════════ CHẾ ĐỘ 6 — LỊCH ÂM DƯƠNG + KIM (DrawCalKim) ══════════
  function m10(x, now, W, H) {
    const dvx = ((W * 5) / 8) | 0;
    const cw = ((dvx - 6) / 7) | 0;
    const rh = (((H - 22) / 6) | 0) + 1;
    const rx = ((dvx + W) / 2) | 0;

    x.strokeStyle = BK; x.lineWidth = 1;
    x.strokeRect(0.5, 0.5, W - 1, H - 1);
    x.fillStyle = BK; x.fillRect(dvx, 0, 1, H);

    gridHead(x, 2, 2, dvx - 3, cw, 14);
    gridMon(x, now, 3, 19, cw, rh, 1);

    sml(x, pad2(now.getMonth() + 1) + '-' + now.getFullYear(), dvx + 5, 5 + BL_6X10, 0);
    statusBattAt(x, W, 9, BK);        // icon + chữ theo cài đặt «Hiển thị pin»

    let r = ((W - dvx) / 2 - 7) | 0;
    if (r > (H - 46) / 2) r = ((H - 46) / 2) | 0;
    face(x, rx, 25 + ((H - 44 - 18) / 2) | 0, r, now, 0);

    x.fillStyle = BK; x.fillRect(dvx, H - 24, W - dvx, 1);
    // giờ số cỡ THƯỜNG đậm — cỡ đôi cao hơn ô của nó nên bị cắt chân
    uniC(x, pad2(now.getHours()) + ':' + pad2(now.getMinutes()), rx, (H - 20) + BL_UNI, 1);
  }

  // ══════════════ CHẾ ĐỘ 7 — LỊCH DƯƠNG + LỊCH ÂM (DrawCalSo) ══════════
  function m11(x, now, W, H) {
    const half = (W / 2) | 0;
    const lcx = (half / 2) | 0, rcx = half + ((half / 2) | 0);

    /* ⚠ Chế độ này dùng UNIFONT cho MỌI chữ, kể cả mấy nhãn nhỏ.
     * Máy chỉ có unifont là mang chữ tiếng Việt; font 6x10 thuần ASCII, vẽ
     * chữ có dấu bằng nó thì máy nuốt mất ký tự mà không báo gì. */

    // dải trên cùng: giờ | thứ | pin
    uni(x, pad2(now.getHours()) + ':' + pad2(now.getMinutes()), 4, 0 + BL_UNI, 1);
    uniC(x, WD_FULL[now.getDay()], W / 2, 0 + BL_UNI, 1);
    statusBattAt(x, W, 8, BK);        // icon + chữ theo cài đặt «Hiển thị pin»
    x.fillStyle = BK;
    x.fillRect(4, 16, W - 8, 1);
    x.fillRect(half, 18, 1, H - 21);        // vạch dọc ngăn hai lịch

    // nửa TRÁI: dương lịch
    uniC(x, 'DƯƠNG LỊCH', lcx, 18 + BL_UNI, 1);
    big(x, now.getDate(), lcx, 86, BK);
    uniC(x, 'Tháng ' + (now.getMonth() + 1), lcx, 90 + BL_UNI, 1);
    uniC(x, 'Năm ' + now.getFullYear(), lcx, 108 + BL_UNI, 0);

    // nửa PHẢI: âm lịch, toàn bộ ĐỎ
    const l = lunarDayOf(now);
    uniC(x, 'ÂM LỊCH', rcx, 18 + BL_UNI, 1, RED);
    big(x, l.day, rcx, 86, RED);
    uniC(x, 'Tháng ' + l.mon, rcx, 90 + BL_UNI, 1, RED);
    uniC(x, canChi(now), rcx, 108 + BL_UNI, 0, RED);
  }
  // can chi năm âm — bảng gọn, đủ cho thẻ xem trước
  const CAN = ['Canh', 'Tân', 'Nhâm', 'Quý', 'Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ'];
  const CHI = ['Thân', 'Dậu', 'Tuất', 'Hợi', 'Tý', 'Sửu', 'Dần', 'Mão', 'Thìn', 'Tỵ', 'Ngọ', 'Mùi'];
  function canChi(now) {
    const y = now.getFullYear();
    return 'Năm ' + CAN[y % 10] + ' ' + CHI[y % 12];
  }

  // ══════════════ CHẾ ĐỘ 8 — LỊCH + NGÀY TO (DrawCalNgay) ══════════════
  function m14(x, now, W, H) {
    const dvx = W - 92;
    const cw = ((dvx - 4) / 7) | 0;
    const rh = (((H - 38) / 6) | 0) + 1;
    const rx = dvx + 46;

    x.strokeStyle = BK; x.lineWidth = 1;
    x.strokeRect(0.5, 0.5, W - 1, H - 1);
    x.fillStyle = BK; x.fillRect(dvx, 0, 1, H);

    gridHead(x, 2, 2, dvx - 3, cw, 14);
    gridMon(x, now, 2, 19, cw, rh, 0);

    const l = lunarDayOf(now);
    uniC(x, 'Âm ' + l.day + '/' + pad2(l.mon), dvx / 2, (H - 17) + BL_UNI, 1);

    smlC(x, pad2(now.getMonth() + 1) + '-' + now.getFullYear(), rx, 5 + BL_6X10, 0);
    x.fillStyle = BK; x.fillRect(dvx, 17, W - dvx, 1);

    unik(x, String(now.getDate()), dvx + 8, 15, 2, BK);
    // «Thứ tư» -> «Thứ» / «tư»
    const s = WD_FULL[now.getDay()], sp = s.indexOf(' ');
    uniC(x, sp > 0 ? s.slice(0, sp) : s, dvx + 62, 18 + BL_UNI, 0);
    if (sp > 0) uniC(x, s.slice(sp + 1), dvx + 62, 32 + BL_UNI, 0);
    x.fillStyle = BK; x.fillRect(dvx, 48, W - dvx, 1);

    // giờ CĂN GIỮA khung của nó
    const hb = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    const bw = uniW(hb, 2);
    unik(x, hb, dvx + (W - dvx - bw) / 2, 48 + ((H - 19) - 48 - 32) / 2, 2, BK);
    x.fillStyle = BK; x.fillRect(dvx, H - 19, W - dvx, 1);

    sml(x, panelTempVal() + '°C', dvx + 4, (H - 14) + BL_6X10, 0);
    smlR(x, voltLabel(), W - 18 - 3, (H - 14) + BL_6X10, 0);
    battAt(x, W - 18, H - 10, BK);
  }

  // ══════════════════════ CHẾ ĐỘ 9 — LỊCH THÁNG (DrawMonth) ════════════
  function m3(x, now, W, H) {
    const vline = ((W * 78) / 212) | 0;
    const gx = vline + 4, gw = W - gx - 2, cw = (gw / 7) | 0;
    const lcx = (vline / 2) | 0;
    const first = firstColOf(now), maxD = mdaysOf(now);
    const rows = Math.ceil((first + maxD) / 7);
    const gy = 2, rh = ((H - 4 - 14) / rows) | 0;

    uni(x, 'Tháng ' + (now.getMonth() + 1), 6, 2 + BL_UNI, 1);
    big(x, now.getDate(), lcx, (H / 2 - 40) + BL_TIMES, RED);   // ngày to: ĐỎ
    uniC(x, WD_FULL[now.getDay()], lcx, (H - 20) + BL_UNI, 1);
    x.fillStyle = BK; x.fillRect(vline, 4, 1, H - 8);

    // hàng THỨ đậm, T7/CN ĐỎ
    for (let i = 0; i < 7; i++)
      uniC(x, WD_MON[i], gx + i * cw + cw / 2, gy + BL_UNI, 1, i >= 5 ? RED : BK);

    for (let d = 1; d <= maxD; d++) {
      const idx = first + d - 1, col = idx % 7, row = (idx - col) / 7;
      const cx = gx + col * cw + cw / 2, cy = gy + 14 + row * rh;
      if (d === now.getDate()) {
        x.fillStyle = RED; x.fillRect(cx - cw / 2 + 1, cy - 1, cw - 1, rh);
        uniC(x, d, cx, cy + BL_UNI, 0, WH);
      } else {
        uniC(x, d, cx, cy + BL_UNI, 0, col >= 5 ? RED : BK);
      }
    }
  }

  // ══════════════ CHẾ ĐỘ 10 — NHIỆT ĐỘ + ĐỒNG HỒ (DrawTemp) ════════════
  function m4(x, now, W, H) {
    const x0 = W - 86;
    const t = panelTempVal();
    statusBattAt(x, W, 8, BK);

    // nhiệt độ Times 50, «°C» cỡ ĐÔI màu ĐỎ, cả cụm căn giữa khung trái
    const ts = String(Math.abs(t));
    serif(x, TIMES_BIG, 0);
    const tw = x.measureText(ts).width;
    let gw2 = tw + 6 + 32;
    if (t < 0) gw2 += 22;
    let tx = (x0 - 8 - gw2) / 2;
    if (tx < 4) tx = 4;
    const ty = ((H - 16) - 50) / 2 - (BL_TIMES - 50);
    if (t < 0) { x.fillStyle = BK; x.fillRect(tx, ty + 26, 16, 5); tx += 22; }
    bigL(x, ts, tx, ty + BL_TIMES, BK);
    unik(x, '°C', tx + tw + 6, ty + 6, 2, RED);
    uni(x, 'Nhiệt độ phòng', 4, (H - 16) + BL_UNI, 0);
    x.fillStyle = BK; x.fillRect(x0 - 8, 6, 1, H - 12);

    // cột phải
    unik(x, pad2(now.getHours()) + ':' + pad2(now.getMinutes()), x0, 8, 2, BK);
    uni(x, WD_FULL[now.getDay()], x0, 39 + BL_UNI, 0);
    uni(x, pad2(now.getDate()) + '/' + pad2(now.getMonth() + 1), x0, 54 + BL_UNI, 0);
    const l = lunarDayOf(now);
    uni(x, 'ÂL ' + l.day + '/' + pad2(l.mon), x0, 70 + BL_UNI, 0, RED);
    uni(x, 'Cao: ' + (t + 3) + '°C', x0, (H - 34) + BL_UNI, 0);
    uni(x, 'Thấp: ' + (t - 4) + '°C', x0, (H - 18) + BL_UNI, 0);
  }

  // ══════════════════════ CHẾ ĐỘ 11 — LỊCH TUẦN (DrawWeek) ═════════════
  function m9(x, now, W, H) {
    const off = (now.getDay() + 6) % 7;
    const bw2 = ((W - 8 - 12) / 7) | 0;
    const bx0 = ((W - (bw2 * 7 + 12)) / 2) | 0;
    const by0 = 20, bh2 = H - by0 - 20;
    const maxD = mdaysOf(now);
    const pdays = new Date(now.getFullYear(), now.getMonth(), 0).getDate();

    uni(x, 'Tháng ' + (now.getMonth() + 1) + ' - Tuần ' + weekOfYear(now), 4, 1 + BL_UNI, 1);
    statusBattAt(x, W, 8, BK);

    for (let i = 0; i < 7; i++) {
      const bx = bx0 + i * (bw2 + 2);
      let dnum = now.getDate() - off + i;
      if (dnum < 1) dnum += pdays; else if (dnum > maxD) dnum -= maxD;
      const today = i === off;

      // ô BO GÓC: hôm nay tô ĐỎ, còn lại chỉ viền
      boxR(x, bx, by0, bx + bw2 - 1, by0 + bh2 - 1, today ? RED : BK, today);

      const cText = today ? WH : (i >= 5 ? RED : BK);
      uniC(x, WD_MON[i], bx + bw2 / 2, (by0 + 3) + BL_UNI, 1, cText);
      uniC(x, dnum, bx + bw2 / 2, (by0 + bh2 / 2 - 10) + BL_UNI, 1, today ? WH : BK);
      const l = lunarDayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() + (i - off)));
      uniC(x, l.day === 1 ? l.day + '/' + l.mon : l.day, bx + bw2 / 2,
           (by0 + bh2 - 18) + BL_UNI, 0, today ? WH : BK);
    }

    uniC(x, panelTempVal() + '°C - ' + lunarStr(now) + ' - ' + EXTRA, W / 2, (H - 15) + BL_UNI, 1);
  }

  // ══════════════════════ CHẾ ĐỘ 12 — LỊCH BLOC (DrawBloc) ═════════════
  function m8(x, now, W, H) {
    x.fillStyle = BK; x.fillRect(0, 0, W, 18);
    uniC(x, 'Tháng ' + (now.getMonth() + 1) + ' - ' + now.getFullYear(), W / 2, 1 + BL_UNI, 1, WH);
    tempCornerUni(x, WH);
    statusBattAt(x, W, 9, WH);

    // số ngày HÔM NAY tô ĐỎ — điểm nhấn chính của lịch bloc
    big(x, now.getDate(), W / 2, (20 + ((H - 20 - 16 - 50 - 16) / 2) - 16) + BL_TIMES, RED);
    uniC(x, WD_FULL[now.getDay()], W / 2, (H - 31) + BL_UNI, 1);
    uniC(x, lunarStr(now) + ' - ' + EXTRA, W / 2, (H - 15) + BL_UNI, 0);
  }

  // ══════════════════════ CHẾ ĐỘ 13 — DỌC: ĐỒNG HỒ (DrawVClock) ════════
  /* Hàng trạng thái của mấy màn DỌC: nhiệt độ góc trái, pin góc phải. */
  function vStatus(x, W) {
    sml(x, panelTempVal() + '°C', 4, 3 + BL_6X10, 0);
    statusBattAt(x, W, 7, BK);
  }
  /* Chân trang DỌC: vạch chia ĐỎ hai nét, rồi thứ / ngày dương / ngày âm. */
  function vFooter(x, now, W, rule, inset, yWd, ySolar, yLunar) {
    x.fillStyle = RED; x.fillRect(inset, rule, W - 2 * inset, 2);
    uniC(x, WD_FULL[now.getDay()], W / 2, yWd + BL_UNI, 1);
    uniC(x, pad2(now.getDate()) + '/' + pad2(now.getMonth() + 1) + '/' + now.getFullYear(),
         W / 2, ySolar + BL_UNI, 1);
    const l = lunarDayOf(now);
    uniC(x, 'Âm ' + l.day + '/' + pad2(l.mon), W / 2, yLunar + BL_UNI, 1);
  }

  function m17(x, now, W, H) {
    vStatus(x, W);
    const top = 14, bot = H - 78;
    const cao = HOBO64.h * 2 + 8;
    const y0 = top + ((bot - top) - cao) / 2;
    const hh = pad2(now.getHours()), mm = pad2(now.getMinutes());
    hobo(x, hh, (W - hoboW(hh, HOBO64)) / 2, y0 + BL_HOBO9, HOBO64, BK);
    hobo(x, mm, (W - hoboW(mm, HOBO64)) / 2, (y0 + HOBO64.h + 8) + BL_HOBO9, HOBO64, BK);
    vFooter(x, now, W, H - 78, 6, H - 70, H - 50, H - 32);
  }

  // ══════════════════════ CHẾ ĐỘ 14 — DỌC: GIỜ NỔI 3D (DrawV3D) ════════
  function m24(x, now, W, H) {
    vStatus(x, W);
    const top = 14, bot = H - 72;
    const cao = HOBO64.h * 2 + 8;
    const y0 = top + ((bot - top) - cao) / 2;
    for (let part = 0; part < 2; part++) {
      const s = pad2(part ? now.getMinutes() : now.getHours());
      hobo3d(x, s, (W - hoboW(s, HOBO64) - 3) / 2,
             (y0 + (part ? HOBO64.h + 8 : 0)) + BL_HOBO9, HOBO64);
    }
    vFooter(x, now, W, H - 72, 8, H - 64, H - 44, H - 26);
  }

  // ══════════════════════ CHẾ ĐỘ 15 — DỌC: LỊCH BLOC (DrawVBloc) ═══════
  function m19(x, now, W, H) {
    vStatus(x, W);
    uniC(x, WD_FULL[now.getDay()], W / 2, 16 + BL_UNI, 1);
    big(x, now.getDate(), W / 2, 36 + BL_TIMES, BK);
    uniC(x, pad2(now.getMonth() + 1) + '-' + now.getFullYear(), W / 2, 106 + BL_UNI, 1);

    x.fillStyle = RED; x.fillRect(8, 126, W - 16, 2);

    // giờ Arial 37 + hàng nhiệt độ, cả cụm căn giữa dải
    const top = 128, bot = H - 46;
    const cao = 37 + 6 + 16;
    const y0 = top + ((bot - top) - cao) / 2;
    const hb = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    const tw = ariW(x, hb);
    ari(x, hb, (W - tw) / 2, y0 + BL_ARIAL, BK);
    uniC(x, panelTempVal() + '°C', W / 2, (y0 + 37 + 6) + BL_UNI, 1);

    x.fillStyle = RED; x.fillRect(8, H - 46, W - 16, 2);
    // cụm âm lịch căn giữa dải chân: hai dòng thì chia đều, một dòng thì giữa
    const l = lunarDayOf(now);
    uniC(x, 'Âm ' + l.day + '/' + pad2(l.mon), W / 2, (H - 40) + BL_UNI, 1);
    uniC(x, EXTRA, W / 2, (H - 22) + BL_UNI, 0);
  }

  // ══════════════════════ CHẾ ĐỘ 16 — DỌC: LỊCH THÁNG (DrawVCal) ═══════
  function m18(x, now, W, H) {
    const cw = (W >= 120) ? 16 : 14;
    const gx = ((W - cw * 7) / 2) | 0;
    const gy = H - 78;

    x.fillStyle = BK; x.fillRect(0, 0, W, 18);
    sml(x, pad2(now.getMonth() + 1) + '-' + now.getFullYear(), 6, 5 + BL_6X10, 0, WH);
    battAt(x, W - 16, 9, WH);
    smlR(x, voltLabel(), W - 16 - 4, 5 + BL_6X10, 0, WH);

    big(x, now.getDate(), W / 2, 18 + BL_TIMES, RED);        // số ngày to: ĐỎ
    uniC(x, WD_FULL[now.getDay()], W / 2, 84 + BL_UNI, 1);
    const l = lunarDayOf(now);
    uniC(x, 'Âm ' + l.day + '/' + pad2(l.mon), W / 2, 102 + BL_UNI, 0);

    // giờ lấp khoảng trống giữa dòng âm lịch và lưới
    const hb = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    const bw = uniW(hb, 2);
    const top = 118, bot = gy - 14;
    unik(x, hb, (W - bw) / 2, top + ((bot - top) - 32) / 2, 2, BK);

    // lưới tháng ở đáy — hàng THỨ đậm, T7/CN ĐỎ
    for (let i = 0; i < 7; i++)
      smlC(x, WD_MON[i], gx + i * cw + cw / 2, (gy - 12) + BL_6X10, 1, i >= 5 ? RED : BK);
    x.fillStyle = BK; x.fillRect(gx, gy - 3, cw * 7 - 1, 1);
    gridMon(x, now, gx, gy, cw, 13, 0);
  }

  // ══════════════════════ CHẾ ĐỘ 17 — DỌC: ĐỒNG HỒ KIM (DrawVKim) ══════
  function m20(x, now, W, H) {
    const r = W / 2 - 8, cx = W / 2;
    const top = 14, bot = H - 100;
    let cy = top + (bot - top) / 2;
    if (cy - r < top + 2) cy = top + 2 + r;

    vStatus(x, W);
    face(x, cx, cy, r, now, 1);          // bỏ bốn vạch chính: chỗ đó ghi số
    smlC(x, '12', cx, (cy - r + 4) + BL_6X10, 0, RED);
    sml(x, '3', cx + r - 10, (cy - 4) + BL_6X10, 0, RED);
    sml(x, '6', cx - 2, (cy + r - 11) + BL_6X10, 0, RED);
    sml(x, '9', cx - r + 5, (cy - 4) + BL_6X10, 0, RED);

    uniC(x, WD_FULL[now.getDay()], W / 2, (H - 96) + BL_UNI, 1);
    uniC(x, pad2(now.getDate()) + '/' + pad2(now.getMonth() + 1) + '/' + now.getFullYear(),
         W / 2, (H - 78) + BL_UNI, 1);
    const l = lunarDayOf(now);
    uniC(x, 'Âm ' + l.day + '/' + pad2(l.mon), W / 2, (H - 60) + BL_UNI, 1);

    x.fillStyle = RED; x.fillRect(8, H - 42, W - 16, 2);
    const hb = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    unik(x, hb, (W - uniW(hb, 2)) / 2, H - 39, 2, BK);
  }

  // ══════════════════════ CHẾ ĐỘ 18 — DỌC: NHIỆT ĐỘ (DrawVTemp) ════════
  function m23(x, now, W, H) {
    const t = panelTempVal();
    statusBattAt(x, W, 7, BK);

    const ts = String(Math.abs(t));
    const mx = (t < 0) ? 16 : 0;
    const tw = ariW(x, ts);
    let tx = (W - tw - 20 - mx) / 2 + mx;
    if (tx < 1 + mx) tx = 1 + mx;
    if (t < 0) { x.fillStyle = BK; x.fillRect(tx - 14, 40, 11, 4); }
    ari(x, ts, tx, 16 + BL_ARIAL, BK);
    uni(x, '°C', tx + tw + 4, 18 + BL_UNI, 0);

    uniC(x, 'Nhiệt độ', W / 2, 70 + BL_UNI, 1);
    x.fillStyle = RED; x.fillRect(8, 92, W - 16, 2);

    const hb = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    unik(x, hb, (W - uniW(hb, 2)) / 2, 100, 2, BK);

    uniC(x, WD_FULL[now.getDay()], W / 2, 134 + BL_UNI, 1);
    uniC(x, pad2(now.getDate()) + '/' + pad2(now.getMonth() + 1) + '/' + now.getFullYear(),
         W / 2, 152 + BL_UNI, 0);
    // khoảng trống giữa: âm lịch ĐỎ + ngày lễ / tiết khí
    uniC(x, lunarStr(now), W / 2, 172 + BL_UNI, 1, RED);
    uniC(x, EXTRA, W / 2, 190 + BL_UNI, 0);

    uniC(x, 'Cao: ' + (t + 3) + '°C', W / 2, (H - 40) + BL_UNI, 0);
    uniC(x, 'Thấp: ' + (t - 4) + '°C', W / 2, (H - 22) + BL_UNI, 0);
  }

  // ══════════════════════ CHẾ ĐỘ 19 — DỌC: LỊCH TUẦN (DrawVWeek) ═══════
  function m21(x, now, W, H) {
    const y0 = 18, rh = ((H - 36) / 7) | 0;
    const off = (now.getDay() + 6) % 7;
    const maxD = mdaysOf(now);
    const pdays = new Date(now.getFullYear(), now.getMonth(), 0).getDate();

    sml(x, pad2(now.getMonth() + 1) + '-' + now.getFullYear(), 4, 3 + BL_6X10, 0);
    statusBattAt(x, W, 7, BK);

    for (let i = 0; i < 7; i++) {
      const ry = y0 + i * rh;
      let dnum = now.getDate() - off + i;
      if (dnum < 1) dnum += pdays; else if (dnum > maxD) dnum -= maxD;
      const today = i === off;

      if (today) boxR(x, 2, ry, W - 3, ry + rh - 2, RED, 1);
      else { x.fillStyle = BK; x.fillRect(6, ry + rh - 1, W - 12, 1); }

      const col = today ? WH : (i >= 5 ? RED : BK);
      uni(x, WD_MON[i], 6, (ry + (rh - 16) / 2) + BL_UNI, 1, col);
      font(x, 13, 1);
      uni(x, dnum, (W - x.measureText(String(dnum)).width) / 2 + 4,
          (ry + (rh - 16) / 2) + BL_UNI, 1, col);
      const l = lunarDayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() + (i - off)));
      smlR(x, l.day === 1 ? '1/' + l.mon : l.day, W - 8, (ry + (rh - 8) / 2) + BL_6X10, 0, col);
    }

    const l = lunarDayOf(now);
    uniC(x, panelTempVal() + '°C Âm ' + l.day + '/' + l.mon, W / 2, (H - 16) + BL_UNI, 0);
  }

  // ══════════════════════ CHẾ ĐỘ 20 — DỌC: ĐẾM NGƯỢC (DrawVCount) ══════
  /* Sự kiện lấy từ hai ô nhập trên trang; chưa đặt thì máy hiện «Chưa đặt». */
  function eventOf(now) {
    const name = (document.getElementById('eventName') || {}).value || '';
    const dv = (document.getElementById('eventDate') || {}).value;
    if (!dv) return null;
    const target = new Date(dv + 'T00:00:00');
    if (isNaN(target)) return null;
    const days = Math.round((target - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
    return { name: name || 'Sự kiện', target, days };
  }

  function m22(x, now, W, H) {
    vStatus(x, W);
    const ev = eventOf(now);
    if (!ev) {
      uniC(x, 'Chưa đặt', W / 2, (H / 2 - 30) + BL_UNI, 0);
      uniC(x, 'sự kiện', W / 2, (H / 2 - 10) + BL_UNI, 0);
      return;
    }
    uniC(x, ev.name, W / 2, 18 + BL_UNI, 1);
    if (ev.days > 0 && ev.days < 100) big(x, ev.days, W / 2, 44 + BL_TIMES, BK);
    else if (ev.days > 0) unik(x, String(ev.days), (W - uniW(ev.days, 2)) / 2, 60, 2, BK);
    else uniC(x, ev.days === 0 ? 'Hôm nay!' : 'Đã qua', W / 2, 60 + BL_UNI, 0);
    uniC(x, 'ngày', W / 2, 112 + BL_UNI, 1);

    if (ev.days > 0) {
      x.strokeStyle = BK; x.lineWidth = 1;
      x.strokeRect(10.5, H - 73.5, W - 20, 9);
      x.fillStyle = BK; x.fillRect(12, H - 72, (W - 24) * 0.4, 5);
    }
    uniC(x, pad2(ev.target.getDate()) + '/' + pad2(ev.target.getMonth() + 1) + '/' + ev.target.getFullYear(),
         W / 2, (H - 58) + BL_UNI, 0);
    if (ev.days >= 14) uniC(x, 'còn ' + Math.floor(ev.days / 7) + ' tuần', W / 2, (H - 40) + BL_UNI, 0);
  }

  // ══════════════════════ CHẾ ĐỘ 21 — DỌC: GIỜ LỚN (DrawVTime1) ════════
  function m25(x, now, W, H) {
    const hh = pad2(now.getHours()), mm = pad2(now.getMinutes());
    hobo(x, hh, (W - hoboW(hh, HOBO64)) / 2, (H / 2 - HOBO64.h - 12) + BL_HOBO9, HOBO64, BK);
    hobo(x, mm, (W - hoboW(mm, HOBO64)) / 2, (H / 2 + 12) + BL_HOBO9, HOBO64, BK);
    x.fillStyle = BK; x.fillRect(8, H / 2 - 3, W - 16, 3);
  }

  // ══════════════════════ CHẾ ĐỘ 22 — DỌC: NỀN ĐEN (DrawVTime2) ════════
  function m28(x, now, W, H) {
    x.fillStyle = BK; x.fillRect(0, 0, W, H);
    const hh = pad2(now.getHours()), mm = pad2(now.getMinutes());
    hobo(x, hh, (W - hoboW(hh, HOBO64)) / 2, (H / 2 - HOBO64.h - 12) + BL_HOBO9, HOBO64, WH);
    hobo(x, mm, (W - hoboW(mm, HOBO64)) / 2, (H / 2 + 12) + BL_HOBO9, HOBO64, WH);
    x.fillStyle = WH; x.fillRect(8, H / 2 - 3, W - 16, 3);
  }

  // ══════════════════════ CHẾ ĐỘ 23 — DỌC: ĐỒNG HỒ LẬT (DrawVTime3) ════
  function m27(x, now, W, H) {
    const x1 = 10, x2 = W - 11, tw = x2 - x1 + 1;
    const tileH = ((H - 16 - 12) / 2) | 0;
    for (let i = 0; i < 2; i++) {
      const y1 = 8 + i * (tileH + 12);
      const y2 = y1 + tileH - 1;
      const ys = y1 + (tileH / 2) | 0;
      x.fillStyle = BK;
      x.fillRect(x2 + 2, y1 + 3, 2, y2 - y1 + 1);       // bóng đổ phải
      x.fillRect(x1 + 3, y2 + 2, x2 - x1 + 1, 2);       // bóng đổ dưới
      x.beginPath();
      if (x.roundRect) x.roundRect(x1, y1, tw, tileH, 4); else x.rect(x1, y1, tw, tileH);
      x.fill();
      big(x, pad2(i ? now.getMinutes() : now.getHours()), W / 2, (ys - 41) + BL_TIMES, WH);
      x.fillStyle = WH; x.fillRect(x1 + 2, ys, tw - 4, 2);   // khe gập
      // chốt trục ĐỎ — điểm nhấn duy nhất trên nền đen, cùng ý với dấu «:»
      // đỏ của chế độ 3 để hai bản đồng hồ lật nhìn cùng một họ
      x.fillStyle = RED;
      x.fillRect(x1 - 4, ys - 4, 4, 10);
      x.fillRect(x2 + 1, ys - 4, 4, 10);
    }
  }

  // ══════════════════════ CHẾ ĐỘ 24 — DỌC: GIỜ TƯƠNG PHẢN (DrawVTime4) ═
  function m26(x, now, W, H) {
    function diamond(cx, cy, col) {
      x.fillStyle = col;
      for (let i = -4; i <= 4; i++) {
        const w = 4 - Math.abs(i);
        x.fillRect(cx - w, cy + i, 2 * w + 1, 1);
      }
    }
    x.fillStyle = BK; x.fillRect(0, 0, W, H / 2);
    x.strokeStyle = WH; x.lineWidth = 1; x.strokeRect(3.5, 3.5, W - 7, H / 2 - 7);
    x.strokeStyle = BK; x.strokeRect(3.5, H / 2 + 3.5, W - 7, H / 2 - 7);
    big(x, pad2(now.getHours()), W / 2, (H / 4 - 41) + BL_TIMES, WH);
    big(x, pad2(now.getMinutes()), W / 2, ((3 * H) / 4 - 41) + BL_TIMES, BK);
    diamond(W / 2, H / 2 - 14, WH);
    diamond(W / 2, H / 2 + 14, BK);
  }

  // ══════════════ CHẾ ĐỘ 25 — ĐẾM NGƯỢC SỰ KIỆN (DrawCountdown) ════════
  function m5(x, now, W, H) {
    tempCornerUni(x, BK);
    statusBattAt(x, W, 8, BK);
    const ev = eventOf(now);
    if (!ev) {
      uniC(x, 'Chưa đặt sự kiện', W / 2, (H / 2 - 20) + BL_UNI, 0);
      uniC(x, 'Đặt trong webtool', W / 2, (H / 2 + 4) + BL_UNI, 0);
      return;
    }
    uniC(x, ev.name, W / 2, 1 + BL_UNI, 1);
    if (ev.days > 0) {
      const nw = ariW(x, String(ev.days));
      font(x, 13, 0);
      const tww = x.measureText('ngày').width;
      const nx = (W - nw - tww - 8) / 2;
      ari(x, ev.days, nx, 24 + BL_ARIAL, BK);
      uni(x, 'ngày', nx + nw + 8, 58 + BL_UNI, 0);
      x.strokeStyle = BK; x.lineWidth = 1;
      x.strokeRect(24.5, H - 25.5, W - 48, 9);
      x.fillStyle = BK; x.fillRect(26, H - 24, (W - 52) * 0.4, 5);
    } else {
      uniC(x, ev.days === 0 ? 'Hôm nay!' : 'Đã qua', W / 2, 40 + BL_UNI, 0);
    }
    let bl = pad2(ev.target.getDate()) + '/' + pad2(ev.target.getMonth() + 1) + '/' + ev.target.getFullYear();
    if (ev.days >= 14) bl += ' - còn ' + Math.floor(ev.days / 7) + ' tuần';
    uniC(x, bl, W / 2, (H - 15) + BL_UNI, 0);
  }

  // ══════════════════════ CHẾ ĐỘ 26 — BẢNG TÊN / GHI CHÚ (DrawNote) ════
  function m6(x, now, W, H) {
    x.strokeStyle = BK; x.lineWidth = 1;
    x.strokeRect(2.5, 2.5, W - 5, H - 5);
    x.strokeRect(3.5, 3.5, W - 7, H - 7);
    x.strokeRect(6.5, 6.5, W - 13, H - 13);

    /* Ba dòng nằm ở BA ô nhập riêng; thân máy nối lại bằng ký tự xuống dòng
     * rồi note_lines() bên firmware tách ra lại. */
    const ln = [0, 1, 2].map(i => (document.getElementById('noteLine' + i) || {}).value || '');
    if (!ln[0]) {
      uniC(x, 'Chưa có nội dung', W / 2, (H / 2 - 20) + BL_UNI, 0);
      uniC(x, 'Soạn trong webtool', W / 2, (H / 2 + 4) + BL_UNI, 0);
      return;
    }
    // dòng 1 (tên): cỡ đôi nếu vừa màn, không thì unifont đậm
    const tw = uniW(ln[0], 1);
    if (tw * 2 <= W - 16) unik(x, ln[0], W / 2 - tw, 8, 2, BK);
    else uniC(x, ln[0], W / 2, 14 + BL_UNI, 1);
    if (ln[1] || ln[2]) {
      x.fillStyle = BK; x.fillRect(W / 2 - 40, H / 2 - 6, 81, 2);
      uniC(x, ln[1] || '', W / 2, (H / 2 + 2) + BL_UNI, 0);
      uniC(x, ln[2] || '', W / 2, (H - 26) + BL_UNI, 0);
    }
  }

  /* --- Tự thiết kế 1 và 2 — designer.js vẽ qua hook renderCustomLayout.
   *
   * ⚠ Tham số thứ ba là SỐ THIẾT KẾ (0 hoặc 1), KHÔNG phải bề rộng. Bản chép
   * từ máy khác truyền (x, now, W, H) nên designer.js đọc W=212 rồi quy về 0 —
   * cả hai thẻ cùng hiện Thiết kế 1, và người dùng không có cách nào xem trước
   * Thiết kế 2. */
  function mCustom(d) {
    return function (x, now, W, H) {
      if (typeof window.renderCustomLayout === 'function') {
        window.renderCustomLayout(x, now, d);
      } else {
        font(x, 10, 0);
        center(x, 'Chưa có giao diện tự thiết kế', W / 2, H / 2, BK);
      }
    };
  }

  // Chế độ mới thêm vào CUỐI danh sách này (và cuối enum bên firmware) để
  // dãy số vẫn liền mạch.
  const MODE_LIST = [
    { mode: 1, name: 'Đồng hồ + lịch âm', tick: 'Làm mới mỗi phút', draw: m0 },
    { mode: 2, name: 'Giờ nổi 3D', tick: 'Làm mới mỗi phút', draw: m13 },
    { mode: 3, name: 'Đồng hồ lật', tick: 'Làm mới mỗi phút', draw: m7 },
    { mode: 4, name: 'Ngày nổi + kim', tick: 'Làm mới mỗi phút', draw: m16 },
    { mode: 5, name: 'Lịch dương + kim + lịch âm', tick: 'Làm mới mỗi phút', draw: m12 },
    { mode: 6, name: 'Lịch âm dương + kim', tick: 'Làm mới mỗi phút', draw: m10 },
    { mode: 7, name: 'Lịch + giờ số', tick: 'Làm mới mỗi phút', draw: m11 },
    { mode: 8, name: 'Lịch + ngày to', tick: 'Làm mới mỗi phút', draw: m14 },
    { mode: 9, name: 'Lịch tháng', tick: 'Cập nhật lúc 0h', draw: m3 },
    { mode: 10, name: 'Nhiệt độ + đồng hồ', tick: 'Làm mới mỗi phút', draw: m4 },
    { mode: 11, name: 'Lịch tuần', tick: 'Làm mới mỗi phút', draw: m9 },
    { mode: 12, name: 'Lịch bloc', tick: 'Làm mới mỗi phút', draw: m8 },
    // thu tu nhom DOC theo nguoi dung chon (13,20,15,14,16,19,17,18 theo vi tri cu)
    { mode: 13, name: 'Dọc: đồng hồ', tick: 'Dựng dọc — làm mới mỗi phút', draw: m17, vert: true },
    { mode: 14, name: 'Dọc: giờ nổi 3D', tick: 'Dựng dọc — làm mới mỗi phút', draw: m24, vert: true },
    { mode: 15, name: 'Dọc: lịch bloc', tick: 'Dựng dọc — làm mới mỗi phút', draw: m19, vert: true },
    { mode: 16, name: 'Dọc: lịch tháng', tick: 'Dựng dọc — cập nhật lúc 0h', draw: m18, vert: true },
    { mode: 17, name: 'Dọc: đồng hồ kim', tick: 'Dựng dọc — làm mới mỗi phút', draw: m20, vert: true },
    { mode: 18, name: 'Dọc: nhiệt độ', tick: 'Dựng dọc — làm mới mỗi phút', draw: m23, vert: true },
    { mode: 19, name: 'Dọc: lịch tuần', tick: 'Dựng dọc — làm mới mỗi phút', draw: m21, vert: true },
    { mode: 20, name: 'Dọc: đếm ngược', tick: 'Dựng dọc — làm mới mỗi phút — đặt ở ô bên dưới', draw: m22, vert: true },
    { mode: 21, name: 'Dọc: giờ lớn', tick: 'Dựng dọc — chỉ giờ:phút', draw: m25, vert: true },
    { mode: 22, name: 'Dọc: nền đen', tick: 'Dựng dọc — chỉ giờ:phút', draw: m28, vert: true },
    { mode: 23, name: 'Dọc: đồng hồ lật', tick: 'Dựng dọc — chỉ giờ:phút', draw: m27, vert: true },
    { mode: 24, name: 'Dọc: giờ tương phản', tick: 'Dựng dọc — chỉ giờ:phút', draw: m26, vert: true },
    // QUY TAC: 4 the CUOI theo dung thu tu: Đếm ngược (5), Bảng tên (6),
    // Tự thiết kế — giao diện mới thêm vào TRƯỚC nhóm này.
    { mode: 25, name: 'Đếm ngược sự kiện', tick: 'Làm mới mỗi phút — đặt ở ô bên dưới', draw: m5 },
    { mode: 26, name: 'Bảng tên / ghi chú', tick: 'Tĩnh — soạn ở ô bên dưới', draw: m6 },
    { mode: 27, name: 'Tự thiết kế', tick: 'Làm mới mỗi phút — soạn ở «Thiết kế màn hình»', draw: mCustom(0) },
    // v2.0: đánh số LIỀN MẠCH theo quy ước họ máy — ẢNH về 0, nên chỗ 28
    // trả ra cho «Tự thiết kế 2», và «Đồng hồ tối giản» (29) được đưa lại
    // vào gallery thay vì chỉ chọn được bằng lệnh.
    { mode: 28, name: 'Tự thiết kế 2', tick: 'Làm mới mỗi phút — soạn ở «Thiết kế màn hình»', draw: mCustom(1) },
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
      const vw = m.vert ? h : w, vh = m.vert ? w : h;
      m.draw(ctx2d(card.querySelector('canvas'), vw, vh), t, vw, vh);
    });
  }
  // main.js gọi lại khi người dùng sửa ô sự kiện / ghi chú
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
      // giao diện DỌC: canvas xoay đứng (đúng tỷ lệ thiết bị dựng dọc)
      const vw = m.vert ? h : w, vh = m.vert ? w : h;
      card.innerHTML =
        '<canvas width="' + (vw * 2) + '" height="' + (vh * 2) + '"' +
        (m.vert ? ' style="width:' + vw + 'px;max-width:100%;"' : '') + '></canvas>' +
        '<div class="mode-name">' + m.name + '</div>' +
        '<div class="mode-tick">' + m.tick + '</div>' +
        // ⚠ Họ giao thức EPD đặt chế độ bằng syncTime(mode) — MỘT lệnh vừa
        // đồng bộ giờ vừa đổi giao diện. Bản cho firmware v1.10 (js/2_13) gọi
        // applyMode(mode) của họ HM; đừng chép nhầm qua lại giữa hai bản.
        '<button id="applybtn-' + m.mode + '" type="button" class="primary" onclick="syncTime(' + m.mode + ')">Áp dụng</button>';
      gallery.appendChild(card);
      try { m.draw(ctx2d(card.querySelector('canvas'), vw, vh), now, vw, vh); }
      catch (e) { console.error('preview mode ' + m.mode, e); }
    }
    /* deviceMode do main.js khai báo; script này nạp trước main.js nên phải
     * kiểm typeof.
     *
     * Máy đang ở chế độ ẢNH (0) thì KHÔNG thẻ nào sáng — đúng như vậy, vì thẻ
     * đó đã bỏ. Lúc ấy khe đang hiện được đánh dấu ở hàng nút «Hiện lại ảnh»
     * (updateShowImgUI trong main.js). */
    if (typeof deviceMode !== 'undefined' && deviceMode != null)
      window.highlightMode(deviceMode);
    if (typeof updateButtonStatus === 'function') updateButtonStatus();
  }

  /* Cầu nối cho js/common/designer.js — nó đọc window.__pv để vẽ chữ, khung
   * và mấy hằng số màu. Thiếu cái này thì bộ dựng «Tự thiết kế» chết ngay lúc
   * nạp. Máy này còn khai thêm window.EPD_DS_DEVICE (js/2_13n/designer_2_13.js)
   * để tự vẽ widget theo hình học của chính nó. */
  window.__pv = {
    font, center, battery, pad2, BK, WH,
    RED,                           // tấm BA MÀU: «đỏ» là đỏ thật
    WD_FULL, WD_SHORT: WD_HDR,
  };

  // main.js gọi lại khi đổi phân giải để vẽ thẻ xem trước theo kích thước mới
  window.rebuildModeGallery = build;

  // redraw thumbnails each minute so the clock previews stay current
  setInterval(() => drawAll(new Date()), 60000);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
