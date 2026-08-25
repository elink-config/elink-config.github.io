/*
 * Mode gallery: canvas previews of every display mode with an apply button.
 * Previews are drawn at the panel's landscape size (212x104 / 250x122,
 * supersampled 2x) and mirror the firmware layouts in user_custs1_impl.c.
 * BẢN CHO FIRMWARE v2.x — đánh số LIỀN MẠCH theo quy ước của cả họ máy:
 *     0      = Ảnh đã lưu
 *     1..29  = các chế độ, liền mạch, đúng thứ tự thẻ ở đây
 * Bản cho firmware v1.10 nằm ở js/2_13 và giữ cách đánh số cũ (Ảnh = 28) —
 * ĐỪNG chép qua lại giữa hai bản.
 *
 * Số ở đây là MỘT GIAO ƯỚC với enum display_mode_t trong firmware
 * (epd_2_13inch_new/src/gui/GUI.h). Đổi một bên là phải đổi bên kia.
 */
(function () {
  // BK/WH/GY, WD_FULL, WD_HDR, pad2, dateLine, voltValue, panelTempVal,
  // lunarText, IMG_MODE... đều nằm ở js/2_13/common.js (nạp trước file này)

  // panel landscape size — theo phân giải đang chọn (212×104 hoặc 250×122)
  function panelSize() {
    if (typeof RESOLUTIONS !== 'undefined' && typeof resIdx !== 'undefined') {
      return { w: RESOLUTIONS[resIdx].w, h: RESOLUTIONS[resIdx].h };
    }
    return { w: 212, h: 104 };
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

  // Cỡ chữ số LỚN, đo từ chính font trong máy (asset_2_13.bin):
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

  // --- mode 0: Đồng hồ + lịch âm — ngày ĐẬM sát góc trái, pin + điện áp góc
  // phải, hàng dưới: Âm lịch ĐẬM + tiết khí + nhiệt độ góc phải ---
  function m0(x, now, W, H) {
    font(x, 10, 1); x.fillStyle = BK;
    x.fillText(dateLine(now), 4, 11);
    statusBatt(x, W);
    // giờ font Hobo Std (khớp firmware F_HOBO — máy không có font thì cursive)
    x.font = Math.round(H * 0.55) + 'px "Hobo Std","HoboStd",cursive';
    center(x, pad2(now.getHours()) + ':' + pad2(now.getMinutes()), W / 2, H * 0.68, BK);
    font(x, 9, 1); x.fillStyle = BK;
    x.fillText(lunarStr(now), 6, H - 3);          // hàng dưới hạ sát mép (khớp fw y=86)
    font(x, 9, 0);
    center(x, 'Đông chí', W / 2 + 14, H - 3, BK);
    right(x, panelTempVal() + '°C', W - 4, H - 3, BK);
  }

  // --- mode 3: Lịch tháng ---
  function m3(x, now, W, H) {
    // Vach chia va luoi SUY TU W (firmware: vline = W*78/212). Ghim cung
    // 78/82 chi dung o kho 212x104, lech han o 250x122.
    const vline = (W * 78 / 212) | 0, gx = vline + 4, gw = W - gx - 2;
    const cw = (gw / 7) | 0, lcx = (vline / 2) | 0;
    font(x, 14, 0); x.fillStyle = BK;                    // firmware: unifont 16px
    x.fillText('Tháng ' + (now.getMonth() + 1), 6, 16);
    serif(x, TIMES_BIG, 1);
    center(x, now.getDate(), lcx, H / 2 + 25, BK);       // fw: (H/2-40) + BL_TIMES
    font(x, 14, 0);
    center(x, WD_FULL[now.getDay()], lcx, H - 6, BK);
    line(x, vline, 4, vline, H - 4);

    const first = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
    const firstCol = (first + 6) % 7;                    // cột 0 = thứ Hai
    const maxD = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const rows = Math.ceil((firstCol + maxD) / 7);
    const rh = ((H - 18) / rows) | 0;
    font(x, 14, 0);
    for (let i = 0; i < 7; i++) center(x, WD_HDR[i], gx + i * cw + cw / 2, 16, BK);
    for (let d = 1; d <= maxD; d++) {
      const idx = firstCol + d - 1, col = idx % 7, row = (idx - col) / 7;
      const cx = gx + col * cw + cw / 2, cy = 16 + row * rh;
      if (d === now.getDate()) {
        x.fillStyle = BK; x.fillRect(cx - cw / 2 + 1, cy - 1, cw - 1, rh);
        center(x, d, cx, cy + 14, WH);
      } else {
        center(x, d, cx, cy + 14, BK);
      }
    }
  }

  // --- mode 4: Nhiệt độ + đồng hồ ---
  function m4(x, now, W, H) {
    statusBatt(x, W);
    const t = panelTempVal();
    const x0 = W - 86;
    // nhiệt độ Arial lớn CĂN GIỮA khung trái (khớp firmware fflip 37px)
    x.font = '50px Arial, sans-serif'; x.fillStyle = BK;
    const ts = String(Math.abs(t));
    const dw = x.measureText(ts).width;
    let tx = ((x0 - 8) - (dw + 4 + 18) - (t < 0 ? 18 : 0)) / 2;
    if (tx < 4) tx = 4;
    const ty = (H - 16 - 58) / 2;
    if (t < 0) { x.fillRect(tx, ty + 27, 12, 3); tx += 18; }
    x.fillText(ts, tx, ty + 47);
    font(x, 13, 1); x.fillText('°C', tx + dw + 4, ty + 22);
    font(x, 9, 0); x.fillText('Nhiệt độ phòng', 8, H - 4);
    line(x, x0 - 8, 6, x0 - 8, H - 6);
    // cột phải hạ xuống (khớp fw: giờ y=8, thứ 39, ngày 54)
    font(x, 22, 1); x.fillStyle = BK;
    x.fillText(pad2(now.getHours()) + ':' + pad2(now.getMinutes()), x0, 32);
    font(x, 9, 0);
    x.fillText(WD_FULL[now.getDay()], x0, 50);
    x.fillText(pad2(now.getDate()) + '/' + pad2(now.getMonth() + 1), x0, 65);
    x.fillText('Cao: ' + (t + 3) + '°C', x0, H - 25);
    x.fillText('Thấp: ' + (t - 4) + '°C', x0, H - 9);
  }

  // --- mode 5: Đếm ngược sự kiện ---
  function m5(x, now, W, H) {
    tempCorner(x);
    statusBatt(x, W);
    const name = (document.getElementById('eventName') || {}).value || 'Đếm ngược ngày';
    let target = null;
    const dv = (document.getElementById('eventDate') || {}).value;
    if (dv) target = new Date(dv + 'T00:00:00');
    if (!target || isNaN(target)) { target = new Date(now); target.setDate(target.getDate() + 45); }
    const days = Math.max(0, Math.round((target - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000));
    font(x, 12, 1);                       // fw: unifont DAM, khong phai serif
    center(x, name, W / 2, 15, BK);
    const ds = String(days);
    x.font = ARIAL_BIG;                   // fw: arial52 — may KHONG co font 7 doan
    const nw = x.measureText(ds).width;
    font(x, 12, 0);
    const tww = x.measureText('ngày').width;
    const nx = (W - nw - tww - 8) / 2;
    x.font = ARIAL_BIG; x.fillStyle = BK;
    x.fillText(ds, nx, 72);               // fw: y = 24 + BL_ARIAL
    font(x, 12, 0); x.fillStyle = BK;
    x.fillText('ngày', nx + nw + 8, 72);
    x.strokeStyle = BK; x.lineWidth = 1;
    x.strokeRect(24.5, H - 25.5, W - 48, 8);
    x.fillStyle = BK; x.fillRect(26, H - 24, (W - 52) * 0.4, 5);
    font(x, 9, 0);
    let bl = pad2(target.getDate()) + '/' + pad2(target.getMonth() + 1) + '/' + target.getFullYear();
    if (days >= 14) bl += ' - còn ' + Math.floor(days / 7) + ' tuần';
    center(x, bl, W / 2, H - 6, BK);
  }

  // --- mode 6: Bảng tên / ghi chú ---
  function m6(x, now, W, H) {
    x.strokeStyle = BK; x.lineWidth = 2; x.strokeRect(3, 3, W - 6, H - 6);
    x.lineWidth = 1; x.strokeRect(6.5, 6.5, W - 13, H - 13);
    const l0 = (document.getElementById('noteLine0') || {}).value || 'Shop Vật Liệu DIY';
    const l1 = (document.getElementById('noteLine1') || {}).value || 'Liên hệ theo số';
    const l2 = (document.getElementById('noteLine2') || {}).value || '0912 345 678';
    serif(x, 15, 1);
    center(x, l0, W / 2, 30, BK);
    line(x, W / 2 - 40, H / 2 - 6, W / 2 + 40, H / 2 - 6, BK, 1.5);
    font(x, 11, 0);
    center(x, l1, W / 2, H / 2 + 13, BK);
    font(x, 9, 0);
    center(x, l2, W / 2, H - 17, BK);
  }

  // --- mode 7 (thẻ 5): Đồng hồ BẢNG LẬT (Solari flip board) ---
  function m7(x, now, W, H) {
    font(x, 10, 1); x.fillStyle = BK;
    x.fillText(dateLine(now), 4, 11);
    statusBatt(x, W);
    const b0 = 18, b1 = H - 22, t0 = b0 + 4, t1 = b1 - 4, ts = (t0 + t1) / 2;
    const tw4 = 40, x0 = (W - (tw4 * 4 + 20 + 8)) / 2;
    const xs = [x0, x0 + 44, x0 + 104, x0 + 148];
    x.fillStyle = BK;
    if (x.roundRect) { x.beginPath(); x.roundRect(6, b0, W - 12, b1 - b0, 5); x.fill(); }
    else x.fillRect(6, b0, W - 12, b1 - b0);
    const s = pad2(now.getHours()) + pad2(now.getMinutes());
    x.textAlign = 'center';
    for (let i = 0; i < 4; i++) {
      const tx = xs[i];
      x.fillStyle = WH; x.fillRect(tx, t0, tw4, t1 - t0);
      x.fillStyle = BK;
      x.font = '44px Arial, sans-serif';
      x.fillText(s[i], tx + tw4 / 2, ts + 16);
      x.fillRect(tx, ts, tw4, 1);                          // khe gập
      x.fillRect(tx, ts - 3, 2, 7);                        // chốt trục
      x.fillRect(tx + tw4 - 2, ts - 3, 2, 7);
    }
    x.textAlign = 'left';
    const cxm = x0 + tw4 * 2 + 14;
    x.fillStyle = WH;
    x.fillRect(cxm - 2, ts - 12, 5, 5);                    // dấu ':' trắng
    x.fillRect(cxm - 2, ts + 8, 5, 5);
    font(x, 9, 1); x.fillStyle = BK;
    x.fillText(lunarStr(now), 4, H - 3);
    font(x, 9, 0);
    right(x, panelTempVal() + '°C', W - 4, H - 3, BK);
  }

  // --- mode 8: Lịch bloc ---
  function m8(x, now, W, H) {
    x.fillStyle = BK; x.fillRect(0, 0, W, 18);
    font(x, 11, 1);
    center(x, 'Tháng ' + (now.getMonth() + 1) + ' - ' + now.getFullYear(), W / 2, 13, WH);
    font(x, 9, 0); x.fillStyle = WH; x.fillText(panelTempVal() + '°C', 4, 13);
    battery(x, W - 16, 5, WH, voltLabel());   // pin canh giữa thanh đen (tâm y≈9)
    // số ngày nâng lên trên, chừa chỗ cho dòng thứ hiển thị rõ bên dưới
    serif(x, TIMES_BIG, 1);
    center(x, now.getDate(), W / 2, (20 + (((H - 102) / 2) | 0) - 16) + 65, BK);
    font(x, 13, 1);
    center(x, WD_FULL[now.getDay()], W / 2, H - 17, BK);
    font(x, 9, 0);
    center(x, lunarStr(now) + ' - Tiết Tiểu thử', W / 2, H - 1, BK);
  }

  // --- mode 9: Lịch tuần ---
  function m9(x, now, W, H) {
    font(x, 11, 1); x.fillStyle = BK;
    x.fillText('Tháng ' + (now.getMonth() + 1) + ' - Tuần ' + weekOfYear(now), 4, 13);
    statusBatt(x, W);
    const bw = (W - 20) / 7, by0 = 20, bh = H - 40;
    const off = (now.getDay() + 6) % 7;
    const monday = new Date(now); monday.setDate(now.getDate() - off);
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday); d.setDate(monday.getDate() + i);
      const bx = 4 + i * (bw + 2);
      const today = i === off;
      // ô bo góc (khớp firmware draw_rect_r/draw_box_r)
      if (today) {
        x.fillStyle = BK;
        if (x.roundRect) { x.beginPath(); x.roundRect(bx, by0, bw, bh, 3); x.fill(); }
        else x.fillRect(bx, by0, bw, bh);
      } else {
        x.strokeStyle = BK; x.lineWidth = 1;
        if (x.roundRect) { x.beginPath(); x.roundRect(bx + 0.5, by0 + 0.5, bw - 1, bh - 1, 3); x.stroke(); }
        else x.strokeRect(bx + 0.5, by0 + 0.5, bw - 1, bh - 1);
      }
      font(x, 8, 0);
      center(x, WD_HDR[i], bx + bw / 2, by0 + 12, today ? WH : BK);
      font(x, 13, 1);                                    // số dương đậm hơn
      center(x, d.getDate(), bx + bw / 2, by0 + bh / 2 + 4, today ? WH : BK);
      font(x, 8, 0);
      let ls = '';
      try { const l = lunarToday(d); ls = (l.day === 1) ? l.day + '/' + (l.month & 0x7f) : String(l.day); } catch (e) { ls = String(d.getDate()); }
      center(x, ls, bx + bw / 2, by0 + bh - 7, today ? WH : BK);   // âm nâng 2px
    }
    font(x, 9, 0);
    center(x, panelTempVal() + '°C - ' + lunarStr(now), W / 2, H - 6, BK);
  }

  // mặt đồng hồ kim dùng chung cho các thẻ mới
  function face(x, cx, cy, r, now) {
    x.strokeStyle = BK; x.lineWidth = 2;
    x.beginPath(); x.arc(cx, cy, r, 0, 7); x.stroke();
    x.lineWidth = 1;
    for (let k = 0; k < 60; k += 5) {
      const a = k * Math.PI / 30;
      line(x, cx + (r - 3) * Math.sin(a), cy - (r - 3) * Math.cos(a),
           cx + (r - 7) * Math.sin(a), cy - (r - 7) * Math.cos(a), BK, 1);
    }
    const h = now.getHours() % 12, m = now.getMinutes();
    const ha = (h + m / 60) * Math.PI / 6, ma = m * Math.PI / 30;
    x.strokeStyle = BK; x.lineCap = 'round';
    x.lineWidth = 3; x.beginPath(); x.moveTo(cx, cy);
    x.lineTo(cx + r * 0.5 * Math.sin(ha), cy - r * 0.5 * Math.cos(ha)); x.stroke();
    x.lineWidth = 2; x.beginPath(); x.moveTo(cx, cy);
    x.lineTo(cx + r * 0.75 * Math.sin(ma), cy - r * 0.75 * Math.cos(ma)); x.stroke();
    x.lineCap = 'butt';
    x.fillStyle = BK; x.beginPath(); x.arc(cx, cy, 2, 0, 7); x.fill();
  }
  const WD_MON = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];   // thứ Hai đầu tuần
  function header(x, gx, gy, gw, cw) {
    font(x, 8, 1);
    for (let i = 0; i < 7; i++) {
      const wknd = i >= 5;                     // T7/CN đảo màu (màn 2.13" không có đỏ)
      if (wknd) { x.fillStyle = BK; x.fillRect(gx + i * cw, gy, cw, 12); }
      center(x, WD_MON[i], gx + i * cw + cw / 2, gy + 10, wknd ? WH : BK);
    }
    line(x, gx, gy + 12, gx + gw - 1, gy + 12, BK, 1);
  }
  // lưới tháng T2-cột-đầu; lunarSub = thêm âm lịch nhỏ; hôm nay ô ngược màu
  function gridMon(x, now, gx, gy, cw, rh, lunarSub) {
    const first = (new Date(now.getFullYear(), now.getMonth(), 1).getDay() + 6) % 7;
    const maxD = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    for (let d = 1; d <= maxD; d++) {
      const col = (first + d - 1) % 7, row = (first + d - 1) / 7 | 0;
      const cx = gx + col * cw + cw / 2, cy = gy + row * rh;
      const today = d === now.getDate();
      if (today) { x.fillStyle = BK; x.fillRect(cx - cw / 2, cy - 1, cw - 1, lunarSub ? 15 : rh - 1); }
      font(x, 8, 1);
      center(x, d, cx, cy + 7, today ? WH : BK);
      if (lunarSub) {
        let ls = '';
        try { const l = lunarToday(new Date(now.getFullYear(), now.getMonth(), d)); ls = l.day === 1 ? '1/' + (l.month & 0x7f) : String(l.day); } catch (e) { ls = String(d); }
        // số âm nhỏ font Eboy pixel, cách số dương 1px (khớp firmware)
        x.font = '8px "Eboy REGAlpha","EboyREGAlpha",monospace';
        center(x, ls, cx, cy + 13, today ? WH : BK);
      }
    }
  }

  // --- mode 10: Lịch (kèm âm) + đồng hồ kim + giờ số ---
  function m10(x, now, W, H) {
    x.strokeStyle = BK; x.lineWidth = 1; x.strokeRect(0.5, 0.5, W - 1, H - 1);
    const dvx = (W * 5 / 8) | 0;
    line(x, dvx, 0, dvx, H, BK, 1);
    const cw = ((dvx - 6) / 7) | 0, rh = (((H - 22) / 6) | 0) + 1;  // +1px mỗi hàng
    header(x, 2, 2, dvx - 3, cw);
    gridMon(x, now, 3, 19, cw, rh, true);
    font(x, 8, 0); x.fillStyle = BK;                                // tháng-năm chữ nhỏ
    x.fillText(pad2(now.getMonth() + 1) + '-' + now.getFullYear(), dvx + 5, 12);
    battery(x, W - 18, 5, BK);
    const rx = (dvx + W) / 2;
    let r = Math.min((W - dvx) / 2 - 7, (H - 46) / 2);
    face(x, rx, 25 + (H - 62) / 2, r, now);                         // kim hạ 7px
    line(x, dvx, H - 24, W - 1, H - 24, BK, 1);
    font(x, 11, 1);
    center(x, pad2(now.getHours()) + ':' + pad2(now.getMinutes()), rx, H - 8, BK);
  }

  // --- mode 11: Lịch + giờ số lớn + ô nhiệt độ/pin ---
  function m11(x, now, W, H) {
    x.strokeStyle = BK; x.lineWidth = 1; x.strokeRect(0.5, 0.5, W - 1, H - 1);
    const dvx = W - 90;
    line(x, dvx, 0, dvx, H, BK, 1);
    const cw = ((dvx - 4) / 7) | 0, rh = ((H - 38) / 6) | 0;
    header(x, 2, 2, dvx - 3, cw);
    gridMon(x, now, 2, 19, cw, rh, false);
    font(x, 11, 1);
    let l = 'Âm --/--';
    try { const lu = lunarToday(now); l = 'Âm ' + lu.day + '/' + pad2(lu.month & 0x7f); } catch (e) {}
    center(x, l, dvx / 2, H - 6, BK);
    line(x, dvx, 18, W - 1, 18, BK, 1);
    line(x, dvx + 45, 0, dvx + 45, 18, BK, 1);
    font(x, 8, 0);
    center(x, panelTempVal() + '°C', dvx + 22, 12, BK);
    x.fillText(voltLabel(), dvx + 47, 12);
    battery(x, W - 16, 5, BK);
    font(x, 21, 1);
    center(x, pad2(now.getHours()) + ':' + pad2(now.getMinutes()), dvx + 45, H / 2 + 6, BK);
    line(x, dvx, H - 36, W - 1, H - 36, BK, 1);
    font(x, 9, 0);
    center(x, pad2(now.getDate()) + '-' + pad2(now.getMonth() + 1) + '-' + now.getFullYear(), dvx + 45, H - 24, BK);
    center(x, WD_FULL[now.getDay()], dvx + 45, H - 8, BK);
  }

  // --- mode 12: Lịch dương + kim + lịch ÂM ---
  function m12(x, now, W, H) {
    const cw = W >= 250 ? 12 : 10, gw = cw * 7;   // mực Eboy hẹp — ô 10px đủ
    const lx = 3, rxg = W - 3 - gw;
    const gy = W >= 250 ? 44 : 40, rh = ((H - gy - 14) / 6) | 0;
    font(x, 11, 1); x.fillStyle = BK;             // tiêu đề chữ ĐẬM
    x.fillText(WD_FULL[now.getDay()], lx + 1, 12);
    x.fillText(pad2(now.getMonth() + 1) + '/' + now.getFullYear(), lx + 1, 28);
    right(x, 'Âm lịch', rxg + gw, 12, BK);
    let lu = null; try { lu = lunarToday(now); } catch (e) {}
    if (lu) right(x, lu.day + '/' + pad2(lu.month & 0x7f), rxg + gw - 8, 28, BK);
    x.font = '8px "Eboy REGAlpha","EboyREGAlpha",monospace';  // pixel font khớp fw
    for (let i = 0; i < 7; i++) {
      const lb = WD_MON[i];
      center(x, lb, lx + i * cw + cw / 2, gy + 6, BK);
      center(x, lb, rxg + i * cw + cw / 2, gy + 6, BK);
    }
    line(x, lx, gy + 10, lx + gw - 1, gy + 10, BK, 1);
    line(x, rxg, gy + 10, rxg + gw - 1, gy + 10, BK, 1);
    const first = (new Date(now.getFullYear(), now.getMonth(), 1).getDay() + 6) % 7;
    const maxD = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    x.font = '8px "Eboy REGAlpha","EboyREGAlpha",monospace';   // chữ thấp hơn 1px
    for (let d = 1; d <= maxD; d++) {
      const col = (first + d - 1) % 7, row = (first + d - 1) / 7 | 0;
      const cx = lx + col * cw + cw / 2, cy = gy + 13 + row * rh;
      center(x, d, cx, cy + 7, BK);
      if (d === now.getDate()) { x.strokeStyle = BK; x.strokeRect(cx - cw / 2 + 0.5, cy - 1.5, cw - 1, rh + 1); }
    }
    if (lu) {
      const lfirst = ((now.getDay() - ((lu.day - 1) % 7) + 70) % 7 + 6) % 7;
      for (let d = 1; d <= 30; d++) {
        const col = (lfirst + d - 1) % 7, row = (lfirst + d - 1) / 7 | 0;
        const cx = rxg + col * cw + cw / 2, cy = gy + 13 + row * rh;
        const today = d === lu.day;
        if (today) { x.fillStyle = BK; x.fillRect(cx - cw / 2, cy - 2, cw, rh + 1); }
        center(x, d, cx, cy + 7, today ? WH : BK);
      }
    }
    let r = Math.min((rxg - lx - gw) / 2 - 2, H / 2 - 3);
    face(x, W / 2, H / 2, r, now);
    font(x, 9, 1);
    center(x, pad2(now.getHours()) + ':' + pad2(now.getMinutes()), W / 2, H - 3, BK);
    battery(x, W - 16, H - 11, BK, voltLabel());  // pin + điện áp sát góc phải
  }

  // --- mode 13: Giờ nổi 3D ---
  function m13(x, now, W, H) {
    font(x, 11, 0); x.fillStyle = BK;
    x.fillText(WD_FULL[now.getDay()] + ' ' + pad2(now.getDate()) + '-' + pad2(now.getMonth() + 1) + '-' + now.getFullYear(), 6, 12);
    statusBatt(x, W);
    const s = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    x.font = Math.round(H * 0.62) + 'px "Hobo Std","HoboStd",cursive';
    x.textAlign = 'center';
    x.fillStyle = BK; x.fillText(s, W / 2 + 3, H * 0.72 + 3);
    for (const [ox, oy] of [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]])
      x.fillText(s, W / 2 + ox, H * 0.72 + oy);
    x.fillStyle = WH; x.fillText(s, W / 2, H * 0.72);
    x.textAlign = 'left';
    font(x, 11, 1); x.fillStyle = BK;
    let l = ''; try { const lu = lunarToday(now); l = 'Âm lịch  ' + lu.day + '-' + pad2(lu.month & 0x7f); } catch (e) {}
    center(x, l, W / 2 - 10, H - 6, BK);
    font(x, 8, 0);
    right(x, panelTempVal() + '°C', W - 8, H - 6, BK);
  }

  // --- mode 14: Lịch + ngày to + giờ số ---
  function m14(x, now, W, H) {
    x.strokeStyle = BK; x.lineWidth = 1; x.strokeRect(0.5, 0.5, W - 1, H - 1);
    const dvx = W - 92;
    line(x, dvx, 0, dvx, H, BK, 1);
    const cw = ((dvx - 4) / 7) | 0, rh = (((H - 38) / 6) | 0) + 1;  // +1px mỗi hàng
    header(x, 2, 2, dvx - 3, cw);
    gridMon(x, now, 2, 19, cw, rh, false);
    font(x, 11, 1);
    let l = ''; try { const lu = lunarToday(now); l = 'Âm ' + lu.day + '/' + pad2(lu.month & 0x7f); } catch (e) {}
    center(x, l, dvx / 2, H - 6, BK);
    const rx = dvx + 46;
    font(x, 8, 0);                                                  // tháng-năm chữ nhỏ
    center(x, pad2(now.getMonth() + 1) + '-' + now.getFullYear(), rx, 12, BK);
    line(x, dvx, 17, W - 1, 17, BK, 1);
    font(x, 24, 1);
    x.fillStyle = BK; x.fillText(now.getDate(), dvx + 8, 41);       // số DD cân giữa 2 dòng thứ
    const wd = WD_FULL[now.getDay()], sp = wd.indexOf(' ');
    font(x, 10, 0);
    center(x, sp > 0 ? wd.slice(0, sp) : wd, dvx + 62, 30, BK);     // thứ nâng 2px
    if (sp > 0) center(x, wd.slice(sp + 1), dvx + 62, 43, BK);
    line(x, dvx, 48, W - 1, 48, BK, 1);
    font(x, 20, 1);
    center(x, pad2(now.getHours()) + ':' + pad2(now.getMinutes()), rx, H - 32, BK);
    line(x, dvx, H - 19, W - 1, H - 19, BK, 1);
    font(x, 8, 0); x.fillStyle = BK;
    x.fillText(panelTempVal() + '°C', dvx + 4, H - 6);
    right(x, voltLabel(), W - 21, H - 6, BK);       // điện áp sát icon pin
    battery(x, W - 18, H - 12, BK);
  }

  // --- mode 16: cột thứ dọc + ngày nổi 3D + kim không viền ---
  function m16(x, now, W, H) {
    const rh = H / 7, mx = (W - 74) / 2;
    const cx = W - 52, cy = H / 2;
    let r = Math.min(H / 2 - 8, 44);
    font(x, 11, 1);
    for (let i = 0; i < 7; i++) {
      const lb = WD_MON[i];
      const today = i === (now.getDay() + 6) % 7;
      if (today) { x.fillStyle = BK; x.fillRect(2, i * rh + 1, 30, rh - 2); }
      x.fillStyle = today ? WH : BK;
      x.fillText(lb, 6, i * rh + rh / 2 + 4);
    }
    font(x, 9, 1);
    center(x, pad2(now.getMonth() + 1) + '-' + now.getFullYear(), mx, 10, BK);
    const ds = String(now.getDate());
    x.font = Math.round(H * 0.52) + 'px "Hobo Std","HoboStd",cursive';
    x.textAlign = 'center';
    x.fillStyle = BK; x.fillText(ds, mx + 3, H * 0.62 + 3);
    for (const [ox, oy] of [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]])
      x.fillText(ds, mx + ox, H * 0.62 + oy);
    x.fillStyle = WH; x.fillText(ds, mx, H * 0.62);
    x.textAlign = 'left';
    font(x, 11, 1);
    center(x, 'Âm lịch', mx, H - 20, BK);
    font(x, 9, 0);
    let l = '24/05'; try { const lu = lunarToday(now); l = lu.day + '/' + pad2(lu.month & 0x7f); } catch (e) {}
    center(x, l, mx, H - 6, BK);
    font(x, 9, 0);
    center(x, '12', cx, cy - r + 6, BK);
    center(x, '3', cx + r, cy + 3, BK);
    center(x, '6', cx, cy + r - 3, BK);
    center(x, '9', cx - r, cy + 3, BK);
    for (let k = 5; k < 60; k += 5) {
      if (k % 15 === 0) continue;
      const a = k * Math.PI / 30;
      const x1 = cx + (r - 4) * Math.sin(a), y1 = cy - (r - 4) * Math.cos(a);
      line(x, x1 - 2, y1, x1 + 2, y1, BK, 1);
      line(x, x1, y1 - 2, x1, y1 + 2, BK, 1);
    }
    const h = now.getHours() % 12, m = now.getMinutes();
    const ha = (h + m / 60) * Math.PI / 6, ma = m * Math.PI / 30;
    x.strokeStyle = BK; x.lineCap = 'round';
    x.lineWidth = 3; x.beginPath(); x.moveTo(cx, cy);
    x.lineTo(cx + r * 0.55 * Math.sin(ha), cy - r * 0.55 * Math.cos(ha)); x.stroke();
    x.lineWidth = 2; x.beginPath(); x.moveTo(cx, cy);
    x.lineTo(cx + r * 0.8 * Math.sin(ma), cy - r * 0.8 * Math.cos(ma)); x.stroke();
    x.lineCap = 'butt';
    x.fillStyle = BK; x.beginPath(); x.arc(cx, cy, 2, 0, 7); x.fill();
  }

  // --- các giao diện DỌC (W ~104/122, H ~212/250) ---
  function m17(x, now, W, H) {
    tempCorner(x);
    battery(x, W - 16, 3, BK, voltLabel());
    x.font = '46px "Hobo Std","HoboStd",cursive'; x.fillStyle = BK; x.textAlign = 'center';
    x.fillText(pad2(now.getHours()), W / 2, 58);
    x.fillText(pad2(now.getMinutes()), W / 2, 114);
    x.textAlign = 'left';
    line(x, 6, H - 78, W - 6, H - 78, BK, 1);
    font(x, 12, 1);
    center(x, WD_FULL[now.getDay()], W / 2, H - 56, BK);
    font(x, 9, 0);
    center(x, pad2(now.getDate()) + '/' + pad2(now.getMonth() + 1) + '/' + now.getFullYear(), W / 2, H - 38, BK);
    let l = 'Âm 24/05'; try { const lu = lunarToday(now); l = 'Âm ' + lu.day + '/' + pad2(lu.month & 0x7f); } catch (e) {}
    center(x, l, W / 2, H - 20, BK);
  }
  function m18(x, now, W, H) {
    x.fillStyle = BK; x.fillRect(0, 0, W, 18);
    font(x, 8, 0); x.fillStyle = WH;                       // tháng-năm nhỏ bên trái
    x.fillText(pad2(now.getMonth() + 1) + '-' + now.getFullYear(), 6, 13);
    battery(x, W - 16, 5, WH, voltLabel());                // pin + điện áp căn giữa thanh
    serif(x, TIMES_BIG, 1);
    center(x, now.getDate(), W / 2, 83, BK);          // fw: 18 + BL_TIMES
    font(x, 12, 1);
    center(x, WD_FULL[now.getDay()], W / 2, 98, BK);
    font(x, 9, 0);
    let l = 'Âm 24/05'; try { const lu = lunarToday(now); l = 'Âm ' + lu.day + '/' + pad2(lu.month & 0x7f); } catch (e) {}
    center(x, l, W / 2, 116, BK);
    const cw = (W >= 120) ? 16 : 14, gx = ((W - cw * 7) / 2) | 0, gy = H - 78;
    font(x, 7, 1);
    for (let i = 0; i < 7; i++) center(x, WD_MON[i], gx + i * cw + cw / 2, gy - 6, BK);
    line(x, gx, gy - 3, gx + cw * 7 - 2, gy - 3, BK, 1);
    const first = (new Date(now.getFullYear(), now.getMonth(), 1).getDay() + 6) % 7;
    const maxD = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    font(x, 7, 1);
    for (let d = 1; d <= maxD; d++) {
      const col = (first + d - 1) % 7, row = (first + d - 1) / 7 | 0;
      const cx = gx + col * cw + cw / 2, cy = gy + row * 13;
      const today = d === now.getDate();
      if (today) { x.fillStyle = BK; x.fillRect(cx - cw / 2, cy - 1, cw - 1, 12); }
      center(x, d, cx, cy + 7, today ? WH : BK);
    }
  }
  function m19(x, now, W, H) {
    tempCorner(x);
    battery(x, W - 16, 3, BK, voltLabel());
    font(x, 12, 1);
    center(x, WD_FULL[now.getDay()], W / 2, 28, BK);
    serif(x, TIMES_BIG, 1);
    center(x, now.getDate(), W / 2, 101, BK);         // fw: 36 + BL_TIMES
    font(x, 11, 1);
    center(x, pad2(now.getMonth() + 1) + '-' + now.getFullYear(), W / 2, 120, BK);
    line(x, 8, 126, W - 8, 126, BK, 1);
    font(x, 18, 1);
    // HH:MM cân giữa dải giữa 2 vạch 126..H-46 (khớp firmware)
    center(x, pad2(now.getHours()) + ':' + pad2(now.getMinutes()), W / 2, (126 + H - 46) / 2 + 7, BK);
    line(x, 8, H - 46, W - 8, H - 46, BK, 1);
    font(x, 9, 0);
    let l = 'Âm 24/05'; try { const lu = lunarToday(now); l = 'Âm ' + lu.day + '/' + pad2(lu.month & 0x7f); } catch (e) {}
    center(x, l, W / 2, H - 24, BK);
    center(x, 'Tiểu thử', W / 2, H - 6, BK);
  }

  // --- 5 giao diện DỌC bổ sung (20-24) ---
  function m20(x, now, W, H) {
    tempCorner(x);
    battery(x, W - 16, 3, BK, voltLabel());
    const r = W / 2 - 8, cx = W / 2, cy = 18 + r;
    x.strokeStyle = BK; x.lineWidth = 2;
    x.beginPath(); x.arc(cx, cy, r, 0, 7); x.stroke();
    x.lineWidth = 1;
    for (let k = 5; k < 60; k += 5) {
      if (k % 15 === 0) continue;
      const a = k * Math.PI / 30;
      line(x, cx + (r - 3) * Math.sin(a), cy - (r - 3) * Math.cos(a),
           cx + (r - 7) * Math.sin(a), cy - (r - 7) * Math.cos(a), BK, 1);
    }
    font(x, 7, 0);
    center(x, '12', cx, cy - r + 11, BK);
    center(x, '3', cx + r - 8, cy + 3, BK);
    center(x, '6', cx, cy + r - 5, BK);
    center(x, '9', cx - r + 8, cy + 3, BK);
    const h = now.getHours() % 12, m = now.getMinutes();
    const ha = (h + m / 60) * Math.PI / 6, ma = m * Math.PI / 30;
    x.strokeStyle = BK; x.lineCap = 'round';
    x.lineWidth = 3; x.beginPath(); x.moveTo(cx, cy);
    x.lineTo(cx + r * 0.5 * Math.sin(ha), cy - r * 0.5 * Math.cos(ha)); x.stroke();
    x.lineWidth = 2; x.beginPath(); x.moveTo(cx, cy);
    x.lineTo(cx + r * 0.75 * Math.sin(ma), cy - r * 0.75 * Math.cos(ma)); x.stroke();
    x.lineCap = 'butt';
    font(x, 12, 1);
    center(x, WD_FULL[now.getDay()], W / 2, cy + r + 18, BK);
    font(x, 9, 0);
    center(x, pad2(now.getDate()) + '/' + pad2(now.getMonth() + 1) + '/' + now.getFullYear(), W / 2, cy + r + 34, BK);
    let l = 'Âm 24/05'; try { const lu = lunarToday(now); l = 'Âm ' + lu.day + '/' + pad2(lu.month & 0x7f); } catch (e) {}
    center(x, l, W / 2, cy + r + 50, BK);
    line(x, 8, H - 42, W - 8, H - 42, BK, 1);
    font(x, 18, 1);
    // HH:MM cân giữa vùng dưới vạch (khớp firmware y = H-39)
    center(x, pad2(now.getHours()) + ':' + pad2(now.getMinutes()), W / 2, H - 15, BK);
  }
  function m21(x, now, W, H) {
    font(x, 8, 0); x.fillStyle = BK;                       // tháng-năm nhỏ, hết đè điện áp
    x.fillText(pad2(now.getMonth() + 1) + '-' + now.getFullYear(), 4, 11);
    battery(x, W - 16, 3, BK, voltLabel());
    const y0 = 18, rh = ((H - 36) / 7) | 0;
    const off = (now.getDay() + 6) % 7;
    const monday = new Date(now); monday.setDate(now.getDate() - off);
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday); d.setDate(monday.getDate() + i);
      const ry = y0 + i * rh, today = i === off;
      if (today) {
        x.fillStyle = BK;                                  // ô hôm nay bo góc
        if (x.roundRect) { x.beginPath(); x.roundRect(2, ry, W - 4, rh - 2, 3); x.fill(); }
        else x.fillRect(2, ry, W - 4, rh - 2);
      }
      else line(x, 6, ry + rh - 1, W - 6, ry + rh - 1, BK, 0.5);
      font(x, 10, 1);
      x.fillStyle = today ? WH : BK;
      x.fillText(WD_MON[i], 6, ry + rh / 2 + 4);
      font(x, 12, 1);                                      // số dương đậm/to hơn
      center(x, d.getDate(), W / 2 + 4, ry + rh / 2 + 4, today ? WH : BK);
      font(x, 7, 0);
      let ls = String(d.getDate());
      try { const lu = lunarToday(d); ls = lu.day === 1 ? '1/' + (lu.month & 0x7f) : String(lu.day); } catch (e) {}
      right(x, ls, W - 8, ry + rh / 2 + 3, today ? WH : BK);
    }
    font(x, 9, 0);
    let l = 'Âm 24/5'; try { const lu = lunarToday(now); l = 'Âm ' + lu.day + '/' + (lu.month & 0x7f); } catch (e) {}
    center(x, panelTempVal() + '°C ' + l, W / 2, H - 6, BK);   // rút gọn — hết tràn 104px
  }
  function m22(x, now, W, H) {
    tempCorner(x);
    battery(x, W - 16, 3, BK, voltLabel());
    const name = (document.getElementById('eventName') || {}).value || 'Sự kiện';
    let target = null;
    const dv = (document.getElementById('eventDate') || {}).value;
    if (dv) target = new Date(dv + 'T00:00:00');
    if (!target || isNaN(target)) { target = new Date(now); target.setDate(target.getDate() + 45); }
    const days = Math.max(0, Math.round((target - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000));
    font(x, 11, 1);
    center(x, name, W / 2, 32, BK);
    serif(x, TIMES_BIG, 1);
    center(x, days, W / 2, 109, BK);                  // fw: 44 + BL_TIMES
    font(x, 12, 1);
    center(x, 'ngày', W / 2, 126, BK);
    // ba hang duoi NEO THEO DAY man, de kho 250x122 khong bi hong mot khoang
    x.strokeStyle = BK; x.lineWidth = 1;
    x.strokeRect(10.5, H - 74.5, W - 21, 9);
    x.fillStyle = BK; x.fillRect(12, H - 72, (W - 24) * 0.4, 5);
    font(x, 9, 0);
    center(x, pad2(target.getDate()) + '/' + pad2(target.getMonth() + 1) + '/' + target.getFullYear(), W / 2, H - 44, BK);
    if (days >= 14) center(x, 'còn ' + Math.floor(days / 7) + ' tuần', W / 2, H - 26, BK);
  }
  function m23(x, now, W, H) {
    battery(x, W - 16, 3, BK, voltLabel());
    const t = panelTempVal();
    const ds = String(Math.abs(t));
    x.font = ARIAL_BIG; x.fillStyle = BK;             // fw: arial52, khong phai 7 doan
    const tw = x.measureText(ds).width;
    const mx = (t < 0) ? 16 : 0;
    const tx = Math.max(1 + mx, (W - tw - 20 - mx) / 2 + mx);
    if (t < 0) x.fillRect(tx - 14, 40, 11, 4);        // dau tru ve tay, nhu fw
    x.fillText(ds, tx, 64);                           // fw: 16 + BL_ARIAL
    font(x, 12, 1); x.fillStyle = BK;
    x.fillText('°C', tx + tw + 4, 32);
    font(x, 9, 0);
    center(x, 'Nhiệt độ', W / 2, 80, BK);
    line(x, 8, 92, W - 8, 92, BK, 1);
    font(x, 18, 1);
    center(x, pad2(now.getHours()) + ':' + pad2(now.getMinutes()), W / 2, 122, BK);
    font(x, 11, 1);
    center(x, WD_FULL[now.getDay()], W / 2, 146, BK);
    font(x, 9, 0);
    center(x, pad2(now.getDate()) + '/' + pad2(now.getMonth() + 1) + '/' + now.getFullYear(), W / 2, 162, BK);
    center(x, 'Cao: ' + (t + 3) + '°C', W / 2, H - 32, BK);
    center(x, 'Thấp: ' + (t - 4) + '°C', W / 2, H - 16, BK);
  }
  function m24(x, now, W, H) {
    tempCorner(x);
    battery(x, W - 16, 3, BK, voltLabel());
    x.textAlign = 'center';
    x.font = '46px "Hobo Std","HoboStd",cursive';
    for (const [t, yy] of [[pad2(now.getHours()), 58], [pad2(now.getMinutes()), 116]]) {
      x.fillStyle = BK; x.fillText(t, W / 2 + 3, yy + 3);
      for (const [ox, oy] of [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]])
        x.fillText(t, W / 2 + ox, yy + oy);
      x.fillStyle = WH; x.fillText(t, W / 2, yy);
    }
    x.textAlign = 'left';
    line(x, 8, H - 72, W - 8, H - 72, BK, 1);
    font(x, 12, 1);
    center(x, WD_FULL[now.getDay()], W / 2, H - 52, BK);
    font(x, 9, 0);
    center(x, pad2(now.getDate()) + '/' + pad2(now.getMonth() + 1) + '/' + now.getFullYear(), W / 2, H - 34, BK);
    let l = 'Âm 24/05'; try { const lu = lunarToday(now); l = 'Âm ' + lu.day + '/' + pad2(lu.month & 0x7f); } catch (e) {}
    center(x, l, W / 2, H - 16, BK);
  }

  // --- 4 giao diện DỌC chỉ GIỜ:PHÚT (25-28) ---
  function hobo2(x, t, cx, y, col) {
    x.font = '46px "Hobo Std","HoboStd",cursive';
    x.textAlign = 'center'; x.fillStyle = col;
    x.fillText(t, cx, y);
    x.textAlign = 'left';
  }
  function m25(x, now, W, H) {
    hobo2(x, pad2(now.getHours()), W / 2, H / 2 - 20, BK);
    hobo2(x, pad2(now.getMinutes()), W / 2, H / 2 + 56, BK);
    x.fillStyle = BK;
    x.fillRect(8, H / 2 - 3, W - 16, 3);      // vạch ngang phân cách
  }
  function m26(x, now, W, H) {
    // giờ TƯƠNG PHẢN: nửa trên đen chữ GIỜ trắng, nửa dưới trắng chữ PHÚT
    // đen (serif) + khung lót 1px + hình thoi đối xứng hai bên đường chia
    function diamond(cx, cy, color) {
      x.fillStyle = color;
      for (let i = -4; i <= 4; i++) {
        const w = 4 - Math.abs(i);
        x.fillRect(cx - w, cy + i, 2 * w + 1, 1);
      }
    }
    x.fillStyle = BK;
    x.fillRect(0, 0, W, H / 2);
    x.strokeStyle = WH; x.lineWidth = 1;
    x.strokeRect(3.5, 3.5, W - 8, H / 2 - 8);
    x.strokeStyle = BK;
    x.strokeRect(3.5, H / 2 + 3.5, W - 8, H / 2 - 8);
    serif(x, 52, 1);
    x.textAlign = 'center';
    x.fillStyle = WH;
    x.fillText(pad2(now.getHours()), W / 2, H / 4 + 25);
    x.fillStyle = BK;
    x.fillText(pad2(now.getMinutes()), W / 2, (3 * H) / 4 + 25);
    x.textAlign = 'left';
    diamond(W / 2, H / 2 - 14, WH);
    diamond(W / 2, H / 2 + 14, BK);
  }
  function m27(x, now, W, H) {
    // đồng hồ lật: 2 thẻ đen LỚN bo góc (GIỜ trên, PHÚT dưới), bóng đổ
    // phải/dưới, khe gập 2px + chốt trục nhô ra hai bên
    const x1 = 10, x2 = W - 11, tw = x2 - x1 + 1;
    const tileH = Math.floor((H - 16 - 12) / 2);
    serif(x, 52, 1);
    x.textAlign = 'center';
    for (let i = 0; i < 2; i++) {
      const y1 = 8 + i * (tileH + 12);
      const ys = y1 + Math.floor(tileH / 2);
      x.fillStyle = BK;
      x.fillRect(x2 + 2, y1 + 3, 2, tileH + 1);         // bóng đổ phải
      x.fillRect(x1 + 3, y1 + tileH + 1, tw + 1, 2);    // bóng đổ dưới
      if (x.roundRect) { x.beginPath(); x.roundRect(x1, y1, tw, tileH, 5); x.fill(); }
      else x.fillRect(x1, y1, tw, tileH);
      x.fillStyle = WH;
      x.fillText(pad2(i ? now.getMinutes() : now.getHours()), W / 2, ys + 25);
      x.fillRect(x1 + 2, ys, tw - 4, 2);                // khe gập
      x.fillStyle = BK;
      x.fillRect(x1 - 4, ys - 4, 4, 10);                // chốt trục trái
      x.fillRect(x2 + 1, ys - 4, 4, 10);                // chốt trục phải
    }
    x.textAlign = 'left';
  }
  function m28(x, now, W, H) {
    x.fillStyle = BK; x.fillRect(0, 0, W, H);
    hobo2(x, pad2(now.getHours()), W / 2, H / 2 - 20, WH);
    hobo2(x, pad2(now.getMinutes()), W / 2, H / 2 + 56, WH);
    x.fillStyle = WH;
    x.fillRect(8, H / 2 - 3, W - 16, 3);      // vạch ngang phân cách (trắng)
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

  // --- Ảnh đã lưu (fw mode 1, đặt bằng 0x94 01) ---
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
    // Tự thiết kế (15), Ảnh đã lưu — giao dien moi them vao TRUOC nhom nay.
    { mode: 25, name: 'Đếm ngược sự kiện', tick: 'Làm mới mỗi phút — đặt ở ô bên dưới', draw: m5 },
    { mode: 26, name: 'Bảng tên / ghi chú', tick: 'Tĩnh — soạn ở ô bên dưới', draw: m6 },
    { mode: 27, name: 'Tự thiết kế', tick: 'Làm mới mỗi phút — soạn ở «Thiết kế màn hình»', draw: mCustom(0) },
    // v2.0: đánh số LIỀN MẠCH theo quy ước họ máy — ẢNH về 0, nên chỗ 28
    // trả ra cho «Tự thiết kế 2», và «Đồng hồ tối giản» (29) được đưa lại
    // vào gallery thay vì chỉ chọn được bằng lệnh.
    { mode: 28, name: 'Tự thiết kế 2', tick: 'Làm mới mỗi phút — soạn ở «Thiết kế màn hình»', draw: mCustom(1) },
    { mode: 0, name: 'Ảnh đã lưu', tick: 'Ảnh tĩnh từ flash', draw: mImg },
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
    // deviceMode do main.js khai báo; script này nạp trước main.js nên phải kiểm typeof
    // ẢNH = mode 28 (số 1 là «Đồng hồ + lịch âm»). Bản chép từ máy 2.9" ghi
    // nhầm là 1 nên mỗi lần dựng lại thư viện (đổi phân giải) khi máy đang ở
    // giao diện đồng hồ mặc định lại tô sáng nhầm thẻ «Ảnh đã lưu».
    if (typeof deviceMode !== 'undefined' && deviceMode != null)
      window.highlightMode(deviceMode === IMG_MODE ? 'img' : deviceMode);
    if (typeof updateButtonStatus === 'function') updateButtonStatus();
  }

  /* Cầu nối cho js/common/designer.js — nó đọc window.__pv để vẽ chữ, khung
   * và mấy hằng số màu. Thiếu cái này thì bộ dựng «Tự thiết kế» chết ngay lúc
   * nạp. Máy này còn khai thêm window.EPD_DS_DEVICE (js/2_13n/designer_2_13.js)
   * để tự vẽ widget theo hình học của chính nó. */
  window.__pv = {
    font, center, battery, pad2, BK, WH,
    RED: BK,                       // màn này ĐEN TRẮNG: «đỏ» quy về đen
    WD_FULL, WD_SHORT: WD_HDR,
  };

  // main.js gọi lại khi đổi phân giải để vẽ thẻ xem trước theo kích thước mới
  window.rebuildModeGallery = build;

  // redraw thumbnails each minute so the clock previews stay current
  setInterval(() => drawAll(new Date()), 60000);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
