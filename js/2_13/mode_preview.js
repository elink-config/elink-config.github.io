/*
 * Mode gallery: canvas previews of every display mode with an apply button.
 * Previews are drawn at the panel's landscape size (212x104 / 250x122,
 * supersampled 2x) and mirror the firmware layouts in user_custs1_impl.c.
 * SỐ MODE FIRMWARE = VỊ TRÍ THẺ (thẻ 1 = mode 1 ... Ảnh đã lưu = 28,
 * đặt bằng 0x94 01; 29 = Đồng hồ tối giản không có thẻ).
 * 4 thẻ CUỐI cố định: Đếm ngược (5), Bảng tên (6), Tự thiết kế (15), Ảnh đã lưu
 * — chế độ mới thêm TRƯỚC nhóm này. Thẻ «Đồng hồ tối giản» (2) đã bỏ theo yêu cầu.
 */
(function () {
  const BK = '#151515', WH = '#f6f4ec', GY = '#555';
  const WD_FULL = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
  const WD_HDR = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

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

  // chữ số 7 đoạn (giả lập font DSEG của firmware); u = 1/9 chiều cao
  const SEG = { '0': 0x3F, '1': 0x06, '2': 0x5B, '3': 0x4F, '4': 0x66, '5': 0x6D, '6': 0x7D, '7': 0x07, '8': 0x7F, '9': 0x6F };
  function seg7(x, px, py, u, ch, col) {
    x.fillStyle = col || BK;
    if (ch === ':') { x.fillRect(px + u * 0.6, py + 2.6 * u, u, u); x.fillRect(px + u * 0.6, py + 5.4 * u, u, u); return 2.5 * u; }
    const m = SEG[ch] || 0, r = (a, b, c, d) => x.fillRect(px + a * u, py + b * u, c * u, d * u);
    if (m & 1) r(1, 0, 3, 1); if (m & 2) r(4, 1, 1, 3); if (m & 4) r(4, 5, 1, 3); if (m & 8) r(1, 8, 3, 1);
    if (m & 16) r(0, 5, 1, 3); if (m & 32) r(0, 1, 1, 3); if (m & 64) r(1, 4, 3, 1);
    return 6 * u;
  }
  function segStr(x, px, py, u, s, col) {
    let w = 0;
    for (const ch of s) w += seg7(x, px + w, py, u, ch, col);
    return w;
  }
  function segWidth(u, s) {
    let w = 0;
    for (const ch of s) w += (ch === ':') ? 2.5 * u : 6 * u;
    return w;
  }

  // pin của firmware: khung 15×9, đầu (nub) bên TRÁI, điện áp "X.Xv" chữ NHỎ
  // (6x10) bên trái icon, CĂN GIỮA theo icon. Mức pin theo điện áp tuyến tính:
  // 3.5V = đầy, 2.5V = cạn. bx = mép trái khung (firmware: x = W-16, tâm y = 7).
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
  function tempCorner(x, col) {
    font(x, 9, 0); x.fillStyle = col || BK; x.fillText(panelTempVal() + '°C', 4, 11);
  }

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

  // --- mode 2: Đồng hồ tối giản ---
  function m2(x, now, W, H) {
    tempCorner(x);
    statusBatt(x, W);
    const th = (W >= 250) ? 66 : 50;
    const u = th / 9;
    const s = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    segStr(x, (W - segWidth(u, s)) / 2, 14 + (H - 32 - th) / 2, u, s, BK);
    font(x, 10, 0);
    center(x, dateLine(now) + ' - ' + lunarStr(now), W / 2, H - 10, BK);
  }

  // --- mode 3: Lịch tháng ---
  function m3(x, now, W, H) {
    font(x, 11, 1); x.fillStyle = BK;
    x.fillText('Tháng ' + (now.getMonth() + 1), 6, 14);
    serif(x, 44, 1);
    center(x, now.getDate(), 39, H / 2 + 16, BK);
    font(x, 11, 1);
    center(x, WD_FULL[now.getDay()], 39, H - 9, BK);
    line(x, 78, 4, 78, H - 4);

    const gx = 82, cw = (W - 84) / 7;
    const first = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
    const firstCol = (first + 6) % 7;                    // cột 0 = thứ Hai
    const maxD = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const rows = Math.ceil((firstCol + maxD) / 7);
    const rh = (H - 18) / rows;
    font(x, 8, 1);
    for (let i = 0; i < 7; i++) center(x, WD_HDR[i], gx + i * cw + cw / 2, 10, BK);
    font(x, 9, 0);
    for (let d = 1; d <= maxD; d++) {
      const idx = firstCol + d - 1, col = idx % 7, row = (idx - col) / 7;
      const cx = gx + col * cw + cw / 2, cy = 16 + row * rh;
      if (d === now.getDate()) {
        x.fillStyle = BK; x.fillRect(cx - cw / 2 + 1, cy - 1, cw - 2, rh - 1);
        center(x, d, cx, cy + rh / 2 + 2, WH);
      } else {
        center(x, d, cx, cy + rh / 2 + 2, BK);
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
    serif(x, 13, 0, 1);
    center(x, name, W / 2, 14, BK);
    const u = 50 / 9;
    const ds = String(days);
    const nw = segWidth(u, ds);
    font(x, 12, 1);
    const tww = x.measureText('ngày').width;
    segStr(x, (W - nw - tww - 8) / 2, 24, u, ds, BK);
    x.fillStyle = BK; x.fillText('ngày', (W - nw - tww - 8) / 2 + nw + 8, 72);
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
    serif(x, H * 0.5, 1);
    center(x, now.getDate(), W / 2, H * 0.615, BK);
    font(x, 13, 1);
    center(x, WD_FULL[now.getDay()], W / 2, H - 18, BK);   // thứ hạ 3px
    font(x, 9, 0);
    center(x, lunarStr(now) + ' - Tiết Tiểu thử', W / 2, H - 6, BK);
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
  const WD_SUN = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  function headerInv(x, gx, gy, gw, cw) {
    x.fillStyle = BK; x.fillRect(gx, gy, gw, 13);
    font(x, 8, 1);
    for (let i = 0; i < 7; i++) center(x, WD_SUN[i], gx + i * cw + cw / 2, gy + 10, WH);
  }
  // lưới tháng CN-cột-đầu; lunarSub = thêm âm lịch nhỏ; hôm nay ô ngược màu
  function gridSun(x, now, gx, gy, cw, rh, lunarSub) {
    const first = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
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
    headerInv(x, 2, 2, dvx - 3, cw);
    gridSun(x, now, 3, 19, cw, rh, true);
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
    headerInv(x, 2, 2, dvx - 3, cw);
    gridSun(x, now, 2, 19, cw, rh, false);
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
      const lb = WD_SUN[(i + 1) % 7];
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
    headerInv(x, 2, 2, dvx - 3, cw);
    gridSun(x, now, 2, 19, cw, rh, false);
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
      const lb = WD_SUN[(i + 1) % 7];
      const today = ((i + 1) % 7) === now.getDay();
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
    serif(x, 46, 1);
    center(x, now.getDate(), W / 2, 70, BK);
    font(x, 12, 1);
    center(x, WD_FULL[now.getDay()], W / 2, 96, BK);
    font(x, 9, 0);
    let l = 'Âm 24/05'; try { const lu = lunarToday(now); l = 'Âm ' + lu.day + '/' + pad2(lu.month & 0x7f); } catch (e) {}
    center(x, l, W / 2, 114, BK);
    const cw = (W >= 120) ? 16 : 14, gx = ((W - cw * 7) / 2) | 0, gy = H - 78;
    font(x, 7, 1);
    for (let i = 0; i < 7; i++) center(x, WD_SUN[i], gx + i * cw + cw / 2, gy - 6, BK);
    line(x, gx, gy - 3, gx + cw * 7 - 2, gy - 3, BK, 1);
    const first = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
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
    serif(x, 46, 1);
    center(x, now.getDate(), W / 2, 88, BK);
    font(x, 11, 1);
    center(x, pad2(now.getMonth() + 1) + '-' + now.getFullYear(), W / 2, 118, BK);
    line(x, 8, 126, W - 8, 126, BK, 1);
    font(x, 18, 1);
    // HH:MM cân giữa dải giữa 2 vạch 126..H-46 (khớp firmware)
    center(x, pad2(now.getHours()) + ':' + pad2(now.getMinutes()), W / 2, (126 + H - 46) / 2 + 7, BK);
    line(x, 8, H - 46, W - 8, H - 46, BK, 1);
    font(x, 9, 0);
    let l = 'Âm 24/05'; try { const lu = lunarToday(now); l = 'Âm ' + lu.day + '/' + pad2(lu.month & 0x7f); } catch (e) {}
    center(x, l, W / 2, H - 30, BK);
    center(x, 'Tiểu thử', W / 2, H - 12, BK);
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
      x.fillText(WD_SUN[(i + 1) % 7], 6, ry + rh / 2 + 4);
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
    center(x, name, W / 2, 30, BK);
    serif(x, 46, 1);
    center(x, days, W / 2, 92, BK);
    font(x, 12, 1);
    center(x, 'ngày', W / 2, 124, BK);
    x.strokeStyle = BK; x.lineWidth = 1;
    x.strokeRect(10.5, 138.5, W - 21, 8);
    x.fillStyle = BK; x.fillRect(12, 140, (W - 24) * 0.4, 5);
    font(x, 9, 0);
    center(x, pad2(target.getDate()) + '/' + pad2(target.getMonth() + 1) + '/' + target.getFullYear(), W / 2, 162, BK);
    if (days >= 14) center(x, 'còn ' + Math.floor(days / 7) + ' tuần', W / 2, 180, BK);
  }
  function m23(x, now, W, H) {
    battery(x, W - 16, 3, BK, voltLabel());
    const u = 50 / 9, t = panelTempVal();
    const ds = String(Math.abs(t));
    const tw = segWidth(u, ds);
    const tx = Math.max(1, (W - tw - 20) / 2);
    segStr(x, tx, 16, u, ds, BK);
    font(x, 12, 1); x.fillStyle = BK;
    x.fillText('°C', tx + tw + 4, 30);
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

  // --- mode 15: Tự thiết kế (designer.js vẽ qua hook renderCustomLayout) ---
  function m15(x, now, W, H) {
    if (typeof window.renderCustomLayout === 'function') {
      window.renderCustomLayout(x, now, W, H);
    } else {
      font(x, 10, 0);
      center(x, 'Chưa có giao diện tự thiết kế', W / 2, H / 2, BK);
    }
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
    { mode: 27, name: 'Tự thiết kế', tick: 'Làm mới mỗi phút — soạn ở «Thiết kế màn hình»', draw: m15 },
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
        '<button id="applybtn-' + m.mode + '" type="button" class="primary" onclick="applyMode(\'' + m.mode + '\')">Áp dụng</button>';
      gallery.appendChild(card);
      try { m.draw(ctx2d(card.querySelector('canvas'), vw, vh), now, vw, vh); }
      catch (e) { console.error('preview mode ' + m.mode, e); }
    }
    if (deviceMode != null) window.highlightMode(deviceMode === 1 ? 'img' : deviceMode);
    if (typeof updateButtonStatus === 'function') updateButtonStatus();
  }

  // main.js gọi lại khi đổi phân giải để vẽ thẻ xem trước theo kích thước mới
  window.rebuildModeGallery = build;

  // redraw thumbnails each minute so the clock previews stay current
  setInterval(() => drawAll(new Date()), 60000);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
