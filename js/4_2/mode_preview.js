/*
 * Mode gallery: canvas previews of every display mode with an apply button.
 * Previews are drawn at the panel's native 400x300 with live date/time and a
 * real month grid; lunar/Can Chi/festival strings are illustrative samples
 * (the device computes the real values itself).
 */
(function () {
  const RED = '#C0261F', BK = '#151515', WH = '#f6f4ec';
  const WD_SHORT = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const WD_FULL = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
  const WD_BAR = ['CN', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

  function ctx2d(canvas) {
    const x = canvas.getContext('2d');
    x.fillStyle = WH;
    x.fillRect(0, 0, 400, 300);
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
  function multi(x, parts, cx, y) {
    let tw = 0;
    for (const p of parts) tw += x.measureText(p[0]).width;
    let px = cx - tw / 2;
    x.textAlign = 'left';
    for (const p of parts) { x.fillStyle = p[1]; x.fillText(p[0], px, y); px += x.measureText(p[0]).width; }
  }
  const SEG = { '0': 0x3F, '1': 0x06, '2': 0x5B, '3': 0x4F, '4': 0x66, '5': 0x6D, '6': 0x7D, '7': 0x07, '8': 0x7F, '9': 0x6F };
  function seg7(x, px, py, u, ch, col) {
    x.fillStyle = col;
    if (ch === ':') { x.fillRect(px + u * 0.6, py + 2.6 * u, u, u); x.fillRect(px + u * 0.6, py + 5.4 * u, u, u); return 3 * u; }
    const m = SEG[ch] || 0, r = (a, b, c, d) => x.fillRect(px + a * u, py + b * u, c * u, d * u);
    if (m & 1) r(1, 0, 3, 1); if (m & 2) r(4, 1, 1, 3); if (m & 4) r(4, 5, 1, 3); if (m & 8) r(1, 8, 3, 1);
    if (m & 16) r(0, 5, 1, 3); if (m & 32) r(0, 1, 1, 3); if (m & 64) r(1, 4, 3, 1);
    return 6 * u;
  }
  function segStr(x, px, py, u, s, col, colonCol) {
    let w = 0;
    for (const ch of s) w += seg7(x, px + w, py, u, ch, ch === ':' && colonCol ? colonCol : col);
    return w;
  }
  function battery(x, bx, by, col, label) {
    // icon xoay 180° khớp firmware: núm bên TRÁI, mức đầy bám mép PHẢI
    col = col || BK;
    x.strokeStyle = col; x.lineWidth = 1.5; x.strokeRect(bx, by, 22, 11);
    x.fillStyle = col; x.fillRect(bx - 3, by + 3, 3, 5); x.fillRect(bx + 6, by + 2, 14, 7);
    if (label) { font(x, 12, 0); x.textAlign = 'right'; x.fillText(label, bx - 8, by + 10); x.textAlign = 'left'; }
  }
  function analogClock(x, cx, cy, r, now, numerals, tickCol, handCol) {
    tickCol = tickCol || BK; handCol = handCol || BK;
    if (numerals) {
      x.strokeStyle = tickCol; x.lineWidth = 4; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.stroke();
      for (let i = 0; i < 60; i++) {
        const a = i * Math.PI / 30, big = i % 5 === 0, r1 = r - (big ? 10 : 5);
        x.lineWidth = big ? 2.5 : 1; x.beginPath();
        x.moveTo(cx + r1 * Math.sin(a), cy - r1 * Math.cos(a));
        x.lineTo(cx + (r - 3) * Math.sin(a), cy - (r - 3) * Math.cos(a)); x.stroke();
      }
      x.fillStyle = tickCol; x.textAlign = 'center'; x.textBaseline = 'middle';
      font(x, r < 60 ? 8 : Math.max(12, r / 6), 1); // small faces: small numerals
      for (let n = 1; n <= 12; n++) {
        const a = n * Math.PI / 6, rn = r < 60 ? r - 16 : r - 24;
        x.fillText(n, cx + rn * Math.sin(a), cy - rn * Math.cos(a));
      }
      x.textBaseline = 'alphabetic'; x.textAlign = 'left';
    } else {
      for (let n = 0; n < 12; n++) {
        const a = n * Math.PI / 6;
        x.strokeStyle = tickCol; x.lineWidth = 3; x.beginPath();
        x.moveTo(cx + (r - 12) * Math.sin(a), cy - (r - 12) * Math.cos(a));
        x.lineTo(cx + (r - 2) * Math.sin(a), cy - (r - 2) * Math.cos(a)); x.stroke();
      }
    }
    const h = now.getHours(), m = now.getMinutes();
    const ha = (h % 12 + m / 60) * Math.PI / 6, ma = m * Math.PI / 30;
    x.strokeStyle = handCol; x.lineCap = 'round';
    x.lineWidth = 6; x.beginPath(); x.moveTo(cx, cy);
    x.lineTo(cx + r * 0.5 * Math.sin(ha), cy - r * 0.5 * Math.cos(ha)); x.stroke();
    x.lineWidth = 4; x.beginPath(); x.moveTo(cx, cy);
    x.lineTo(cx + r * 0.74 * Math.sin(ma), cy - r * 0.74 * Math.cos(ma)); x.stroke();
    x.fillStyle = RED; x.beginPath(); x.arc(cx, cy, 4, 0, 7); x.fill(); x.lineCap = 'butt';
  }
  // fake-but-plausible lunar day for grid subtext (thumbnails only)
  function lunarish(d) { const v = (d + 16) % 30; return v === 0 ? '1/6' : String(v); }
  function monthGrid(x, gx, gy, gw, gh, now, opt) {
    opt = opt || {};
    const year = now.getFullYear(), mon = now.getMonth(), today = now.getDate();
    const first = new Date(year, mon, 1).getDay();
    const maxD = new Date(year, mon + 1, 0).getDate();
    const rows = Math.ceil((first + maxD) / 7);
    const cw = gw / 7, rh = gh / rows;
    for (let d = 1; d <= maxD; d++) {
      const idx = first + d - 1, col = idx % 7, row = (idx - col) / 7;
      const cx = gx + col * cw + cw / 2, cy = gy + row * rh + rh / 2;
      const weekend = col === 0 || col === 6;
      if (d === today) {
        x.fillStyle = opt.todayCol || RED; x.beginPath();
        x.arc(cx, cy - (opt.lunar ? 2 : 0), Math.min(cw, rh) / 2 - 1, 0, 7); x.fill();
      }
      font(x, opt.dayPx || 13, 1);
      center(x, d, cx, cy + (opt.lunar ? 2 : 5), d === today ? '#fff' : (weekend && !opt.noWeekendRed ? RED : BK));
      if (opt.lunar) {
        font(x, 9, 0);
        center(x, lunarish(d), cx, cy + rh / 2 - 3, d === today ? '#fff' : '#555');
      }
    }
    return rows;
  }
  function weekBar(x, gx, gy, gw, h, labels, px) {
    const w = gw / 7;
    font(x, px || 13, 1);
    for (let i = 0; i < 7; i++) {
      x.fillStyle = (i === 0 || i === 6) ? RED : BK;
      x.fillRect(gx + i * w, gy, w - 1, h);
      center(x, labels[i], gx + i * w + w / 2, gy + h / 2 + 5, '#fff');
    }
  }
  function pad2(n) { return String(n).padStart(2, '0'); }

  /* ---- previews, one per display mode ---- */

  function m1(x, now) { // Lịch tháng
    font(x, 15, 0);
    multi(x, [['Tháng ', BK], [String(now.getMonth() + 1), RED], [' - ', BK], [String(now.getFullYear()), RED],
              ['   ÂL 21/5 Bính Ngọ ', BK], ['[Tuần 27]', RED]], 165, 24);
    battery(x, 366, 8, BK, '3.2V');
    weekBar(x, 10, 32, 380, 24, WD_SHORT, 13);
    monthGrid(x, 10, 64, 380, 226, now, { lunar: true, dayPx: 15 });
  }
  function m2(x, now) { // Đồng hồ
    font(x, 15, 0);
    multi(x, [['Ngày ', BK], [String(now.getDate()), RED], [' tháng ', BK], [String(now.getMonth() + 1), RED],
              [' năm ', BK], [String(now.getFullYear()), RED]], 150, 34);
    font(x, 14, 0); x.fillStyle = BK; x.fillText(WD_FULL[now.getDay()], 40, 56); x.fillText('Âm Lịch 21/5', 170, 56);
    battery(x, 340, 20, BK, '3.2V');
    line(x, 30, 68, 370, 68);
    segStr(x, 104, 100, 7, pad2(now.getHours()) + ':' + pad2(now.getMinutes()), BK, BK);
    line(x, 30, 232, 370, 232);
    font(x, 14, 0);
    multi(x, [['Năm Bính Ngọ ', BK], ['(Ngựa)', RED]], 120, 258);
    x.fillStyle = BK; x.fillText('Tuần 27', 40, 280);
  }
  function m3(x, now) { // Đồng hồ + Lịch (B/W)
    x.strokeStyle = BK; x.lineWidth = 2; x.strokeRect(3, 3, 394, 294); x.strokeRect(7, 7, 386, 286);
    font(x, 17, 1); x.fillStyle = BK;
    x.fillText(pad2(now.getDate()) + '/' + pad2(now.getMonth() + 1) + '/' + now.getFullYear(), 14, 36);
    font(x, 14, 0); x.fillText('Sáng', 178, 34); x.fillText(WD_FULL[now.getDay()], 244, 34);
    battery(x, 362, 16, BK);
    line(x, 7, 48, 393, 48, BK, 2);
    analogClock(x, 104, 140, 78, now, true);
    font(x, 11, 1);
    for (let i = 0; i < 7; i++) center(x, WD_SHORT[i], 206 + i * 26 + 13, 72, BK);
    monthGrid(x, 206, 80, 182, 144, now, { todayCol: BK, dayPx: 11, noWeekendRed: true });
    line(x, 7, 230, 393, 230, BK, 2);
    font(x, 13, 0); x.fillStyle = BK;
    x.fillText('Bính Ngọ (Ngựa)', 12, 252); x.fillText('Âm Lịch 21/5', 12, 274);
    x.fillText('Lễ Vu Lan', 148, 252); x.fillText('còn 52 ngày', 148, 274);
    segStr(x, 300, 240, 2.4, '32', BK, BK);
    font(x, 13, 0); x.fillText('°C', 344, 262);
    line(x, 140, 232, 140, 292); line(x, 292, 232, 292, 292);
  }
  function m4(x, now) { // Lịch để bàn (đỏ)
    x.fillStyle = BK; x.fillRect(0, 0, 400, 300);
    x.fillStyle = RED; x.beginPath(); x.roundRect(8, 8, 144, 182, 12); x.fill();
    // white dial (matches firmware: hands can only partial-erase on white)
    x.fillStyle = '#fff'; x.beginPath(); x.arc(80, 74, 52, 0, 7); x.fill();
    analogClock(x, 80, 74, 52, now, false, BK, BK);
    x.fillStyle = '#fff'; x.beginPath(); x.roundRect(20, 136, 120, 46, 8); x.fill();
    segStr(x, 32, 140, 2, pad2(now.getHours()) + ':' + pad2(now.getMinutes()), BK, BK);
    segStr(x, 12, 210, 3, pad2(now.getDate()), '#fff', '#fff');
    line(x, 88, 212, 88, 272, '#fff', 2);
    font(x, 14, 0); x.fillStyle = '#fff'; x.fillText('Năm Ngựa', 96, 234);
    battery(x, 96, 240, '#fff'); font(x, 11, 0); x.fillStyle = '#fff';
    x.fillText('3.2V', 124, 262); x.fillText('21/5 AL', 96, 276);
    x.fillStyle = '#fff'; x.beginPath(); x.roundRect(168, 10, 224, 280, 14); x.fill();
    x.fillStyle = BK; x.beginPath(); x.arc(196, 38, 13, 0, 7); x.fill();
    x.fillStyle = '#fff'; x.beginPath(); x.arc(203, 33, 11, 0, 7); x.fill();
    font(x, 17, 1); x.fillStyle = BK; x.textAlign = 'right';
    x.fillText(now.getFullYear() + '-' + pad2(now.getMonth() + 1), 384, 48); x.textAlign = 'left';
    x.fillRect(178, 58, 206, 5);
    font(x, 11, 1);
    for (let i = 0; i < 7; i++) center(x, WD_SHORT[i], 173 + i * 31 + 15, 88, RED);
    monthGrid(x, 173, 96, 217, 186, now, { dayPx: 12, noWeekendRed: true });
  }
  function m5(x, now) { // Lịch VN (Can Chi)
    font(x, 18, 1); x.fillStyle = RED;
    x.fillText(pad2(now.getDate()) + '-' + pad2(now.getMonth() + 1) + '-' + now.getFullYear(), 10, 26);
    font(x, 13, 0); x.fillStyle = BK; x.fillText('Ngày Canh Thìn', 10, 46);
    multi(x, [['Tháng ', RED], ['Giáp Ngọ | ', BK], ['Năm ', RED], ['Bính Ngọ', BK]], 108, 63);
    battery(x, 366, 8, BK, '3.2V');
    font(x, 12, 0); x.fillStyle = BK; x.textAlign = 'right'; x.fillText('DIY-1D18', 388, 44); x.textAlign = 'left';
    weekBar(x, 10, 68, 380, 24, WD_BAR, 12);
    const rows = monthGrid(x, 10, 96, 380, 184, now, { lunar: true, dayPx: 14 });
    font(x, 13, 0); x.fillStyle = BK; x.fillText('8. Tiểu Thử   24. Đại Thử', 10, 294);
  }
  function m6(x, now) { // Đồng hồ số
    font(x, 15, 0); x.fillStyle = BK;
    x.fillText(WD_FULL[now.getDay()] + ', ' + pad2(now.getDate()) + '/' + pad2(now.getMonth() + 1) + '/' + now.getFullYear(), 12, 30);
    battery(x, 362, 14, BK, '3.2V');
    line(x, 10, 46, 390, 46, BK, 2);
    segStr(x, 104, 92, 8, pad2(now.getHours()) + ':' + pad2(now.getMinutes()), BK, RED);
    font(x, 14, 0);
    multi(x, [['Âm Lịch 21/5', RED], [' - Ngày Canh Thìn - Năm Bính Ngọ', BK]], 200, 216);
    line(x, 10, 250, 390, 250);
    font(x, 13, 0); x.fillStyle = BK; x.fillText('32°C', 12, 282);
    multi(x, [['Lễ Vu Lan còn 52 ngày', RED]], 220, 282);
  }
  function m7(x, now) { // Đồng hồ kim
    font(x, 12, 0); x.fillStyle = BK; x.fillText('32°C', 12, 22);
    battery(x, 362, 10, BK, '3.2V');
    analogClock(x, 200, 136, 104, now, true);
    font(x, 15, 1);
    multi(x, [[WD_FULL[now.getDay()], RED],
              [' - ' + pad2(now.getDate()) + '/' + pad2(now.getMonth() + 1) + '/' + now.getFullYear() + ' - Âm Lịch 21/5', BK]], 200, 286);
  }
  function m8(x, now) { // Lịch bloc
    x.fillStyle = RED; x.fillRect(0, 0, 400, 46);
    font(x, 17, 1); center(x, 'Tháng ' + (now.getMonth() + 1) + ' - ' + now.getFullYear(), 200, 30, '#fff');
    battery(x, 358, 18, '#fff');
    font(x, 100, 1); center(x, now.getDate(), 200, 168, RED);
    font(x, 17, 1); center(x, WD_FULL[now.getDay()], 200, 214, BK);
    line(x, 70, 228, 330, 228);
    font(x, 14, 0);
    multi(x, [['Âm Lịch 21/5', RED], [' - Ngày Canh Thìn - Năm Bính Ngọ', BK]], 200, 254);
    multi(x, [['Lễ Vu Lan còn 52 ngày', RED]], 200, 280);
  }
  function m9(x, now) { // Lịch tuần
    font(x, 15, 0);
    multi(x, [['Tháng ' + (now.getMonth() + 1) + ' - ' + now.getFullYear(), BK], ['  Âm Lịch tháng 5', RED]], 128, 28);
    battery(x, 362, 12, BK, '3.2V');
    line(x, 10, 44, 390, 44);
    const start = new Date(now); start.setDate(now.getDate() - now.getDay());
    for (let i = 0; i < 7; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const bx = 12 + i * 54, today = d.getDate() === now.getDate() && d.getMonth() === now.getMonth();
      x.beginPath(); x.roundRect(bx, 58, 52, 150, 7);
      if (today) { x.fillStyle = RED; x.fill(); } else { x.strokeStyle = BK; x.lineWidth = 1.5; x.stroke(); }
      const wd = d.getDay(), weekend = wd === 0 || wd === 6;
      font(x, 13, 1); center(x, WD_SHORT[wd], bx + 26, 84, today ? '#fff' : (weekend ? RED : BK));
      font(x, 22, 1); center(x, d.getDate(), bx + 26, 146, today ? '#fff' : BK);
      font(x, 11, 0); center(x, lunarish(d.getDate()), bx + 26, 178, today ? '#fff' : '#555');
    }
    line(x, 10, 224, 390, 224);
    font(x, 14, 0); multi(x, [['Lễ Vu Lan còn 52 ngày', RED]], 200, 250);
    font(x, 13, 0); multi(x, [['32°C - Ngày Canh Thìn - Tuần 27', BK]], 200, 278);
  }
  function m10(x, now) { // Giờ + lịch tháng
    segStr(x, 16, 12, 6, pad2(now.getHours()) + ':' + pad2(now.getMinutes()), BK, RED);
    font(x, 14, 1); x.textAlign = 'right'; x.fillStyle = RED; x.fillText(WD_FULL[now.getDay()], 388, 28);
    font(x, 16, 1); x.fillStyle = BK;
    x.fillText(pad2(now.getDate()) + '/' + pad2(now.getMonth() + 1) + '/' + now.getFullYear(), 388, 54);
    font(x, 12, 0); x.fillText('Âm Lịch 21/5 - 32°C', 388, 76); x.textAlign = 'left';
    line(x, 10, 82, 390, 82, BK, 2);
    font(x, 12, 1);
    for (let i = 0; i < 7; i++) center(x, WD_SHORT[i], 11 + i * 54 + 27, 102, (i === 0 || i === 6) ? RED : BK);
    monthGrid(x, 11, 110, 378, 186, now, { lunar: true, dayPx: 13 });
  }
  function m11(x, now) { // Kim + thẻ ngày
    analogClock(x, 112, 150, 96, now, true);
    line(x, 228, 20, 228, 280, BK, 2);
    font(x, 16, 1); center(x, WD_FULL[now.getDay()], 314, 56, RED);
    font(x, 72, 1); center(x, now.getDate(), 314, 164, BK);
    font(x, 14, 0); center(x, 'Tháng ' + (now.getMonth() + 1) + ' - ' + now.getFullYear(), 314, 196, BK);
    multi(x, [['Âm Lịch 21/5', RED]], 314, 220);
    font(x, 13, 0); center(x, 'Ngày Canh Thìn', 314, 242, BK);
    line(x, 248, 256, 380, 256);
    font(x, 12, 0); x.fillStyle = BK; x.fillText('32°C', 252, 278);
    battery(x, 348, 268, BK);
  }
  function m12(x, now) { // Tối giản
    font(x, 24, 1); center(x, WD_FULL[now.getDay()], 200, 70, BK);
    font(x, 84, 1); center(x, pad2(now.getDate()) + '.' + pad2(now.getMonth() + 1), 200, 182, RED);
    font(x, 15, 0);
    multi(x, [[now.getFullYear() + ' - ', BK], ['Âm Lịch 21/5', RED], [' - Năm Bính Ngọ', BK]], 200, 228);
    battery(x, 190, 252, BK);
  }

  // next solar-date holiday (preview only; the device also knows lunar ones)
  function nextSolarFest(now) {
    const fests = [[1,1,'Tết Dương lịch'],[2,14,'Lễ Tình nhân'],[3,8,'Quốc tế Phụ nữ'],[4,30,'Giải phóng miền Nam'],
                   [5,1,'Quốc tế Lao động'],[6,1,'Quốc tế Thiếu nhi'],[9,2,'Quốc khánh'],[10,20,'Phụ nữ Việt Nam'],
                   [11,20,'Nhà giáo Việt Nam'],[12,25,'Giáng sinh']];
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let best = null;
    for (const [m, d, name] of fests) {
      for (const y of [now.getFullYear(), now.getFullYear() + 1]) {
        const dt = new Date(y, m - 1, d), days = Math.round((dt - today) / 86400000);
        if (days >= 0 && (!best || days < best.days)) best = { days, name, dt };
      }
    }
    return best;
  }
  function miniMonth(x, bx, by, w, rh, y0, mo, today, dayPx) {
    const first = new Date(y0, mo, 1).getDay(), maxD = new Date(y0, mo + 1, 0).getDate(), cw = w / 7;
    font(x, Math.max(8, dayPx - 3), 1);
    for (let i = 0; i < 7; i++) center(x, WD_SHORT[i], bx + i * cw + cw / 2, by, (i === 0 || i === 6) ? RED : BK);
    for (let d = 1; d <= maxD; d++) {
      const idx = first + d - 1, col = idx % 7, row = (idx - col) / 7;
      const cx = bx + col * cw + cw / 2, cy = by + 8 + row * rh + rh / 2;
      if (d === today) { x.fillStyle = RED; x.beginPath(); x.arc(cx, cy - 3, Math.min(cw, rh) / 2 - 1, 0, 7); x.fill(); }
      font(x, dayPx, 1);
      center(x, d, cx, cy + 1, d === today ? '#fff' : ((col === 0 || col === 6) ? RED : BK));
    }
  }
  function m13(x, now) { // Lịch vạn niên
    x.fillStyle = RED; x.fillRect(0, 0, 180, 46);
    font(x, 15, 1); center(x, 'Tháng ' + (now.getMonth() + 1) + ' - ' + now.getFullYear(), 90, 29, '#fff');
    font(x, 84, 1); center(x, now.getDate(), 90, 158, RED);
    font(x, 15, 1); center(x, WD_FULL[now.getDay()], 90, 192, BK);
    font(x, 13, 0); multi(x, [['Âm Lịch 21/5', RED]], 90, 218);
    font(x, 12, 0); center(x, 'Tiết Tiểu Thử', 90, 242, BK);
    x.fillStyle = BK; x.beginPath(); x.arc(90, 270, 13, 0, 7); x.fill();
    x.fillStyle = WH; x.beginPath(); x.arc(97, 265, 11, 0, 7); x.fill();
    line(x, 180, 8, 180, 292, BK, 2);
    font(x, 14, 1); x.fillStyle = BK; x.fillText('Ngày Canh Thìn', 196, 32); battery(x, 362, 20, BK);
    font(x, 13, 1); x.fillStyle = RED; x.fillText('Giờ hoàng đạo', 196, 62);
    const gio = [['Dần', '3-5h'], ['Thìn', '7-9h'], ['Tỵ', '9-11h'], ['Thân', '15-17h'], ['Dậu', '17-19h'], ['Hợi', '21-23h']];
    font(x, 12, 0);
    for (let i = 0; i < 6; i++) {
      const gx = 196 + (i % 2) * 96, gy = 88 + ((i - i % 2) / 2) * 28;
      x.fillStyle = RED; x.beginPath(); x.arc(gx + 4, gy - 4, 3, 0, 7); x.fill();
      x.fillStyle = BK; x.fillText(gio[i][0] + ' ' + gio[i][1], gx + 12, gy);
    }
    line(x, 196, 178, 384, 178);
    font(x, 13, 1); x.fillStyle = RED; x.fillText('Giờ hắc đạo', 196, 202);
    font(x, 12, 0); x.fillStyle = BK; x.fillText('Tý, Sửu, Mão,', 196, 224); x.fillText('Ngọ, Mùi, Tuất', 196, 242);
    const nf = nextSolarFest(now);
    font(x, 12, 0); x.fillStyle = RED; x.fillText(nf.name, 196, 270); x.fillText('còn ' + nf.days + ' ngày', 196, 290);
  }
  function m14(x, now) { // Đếm ngược
    font(x, 14, 0); x.fillStyle = BK;
    x.fillText(WD_FULL[now.getDay()] + ', ' + pad2(now.getDate()) + '/' + pad2(now.getMonth() + 1) + '/' + now.getFullYear(), 14, 30);
    battery(x, 362, 14, BK);
    line(x, 10, 44, 390, 44, BK, 2);
    const nf = nextSolarFest(now);
    font(x, 14, 0); center(x, 'Sự kiện sắp tới', 200, 72, BK);
    font(x, 100, 1); center(x, nf.days, 200, 176, RED);
    font(x, 14, 0); multi(x, [['ngày nữa đến ', BK], [nf.name, RED]], 200, 208);
    font(x, 13, 0); center(x, WD_FULL[nf.dt.getDay()] + ', ' + pad2(nf.dt.getDate()) + '/' + pad2(nf.dt.getMonth() + 1) + '/' + nf.dt.getFullYear(), 200, 232, BK);
    x.strokeStyle = BK; x.lineWidth = 1.5; x.strokeRect(60, 248, 280, 14);
    x.fillStyle = RED; x.fillRect(62, 250, 276 * Math.max(0.05, Math.min(0.95, 1 - nf.days / 60)), 10);
    font(x, 12, 0); multi(x, [['Sau đó: ', BK], ['... (thiết bị tính cả ngày lễ âm lịch)', RED]], 200, 288);
  }
  function m15(x, now) { // Hai tháng
    font(x, 13, 0);
    multi(x, [['Hôm nay: ', BK], [WD_FULL[now.getDay()] + ' ' + pad2(now.getDate()) + '/' + pad2(now.getMonth() + 1), RED], [' - Âm Lịch 21/5 Bính Ngọ', BK]], 172, 26);
    battery(x, 362, 10, BK);
    const y = now.getFullYear(), mo = now.getMonth();
    font(x, 14, 1); center(x, 'Tháng ' + (mo + 1), 105, 56, RED); center(x, 'Tháng ' + ((mo + 1) % 12 + 1), 295, 56, BK);
    miniMonth(x, 15, 80, 180, 29, y, mo, now.getDate(), 12);
    miniMonth(x, 205, 80, 180, 29, mo === 11 ? y + 1 : y, (mo + 1) % 12, 0, 12);
    line(x, 200, 44, 200, 280, BK, 1);
    font(x, 12, 0); multi(x, [['8. Tiểu Thử  24. Đại Thử', BK], ['  -  Lễ Vu Lan còn 52 ngày', RED]], 200, 294);
  }
  function m16(x, now) { // Lịch cả năm
    const y = now.getFullYear();
    font(x, 16, 1); multi(x, [['Năm ' + y + ' - ', BK], ['Bính Ngọ (Ngựa)', RED]], 150, 26);
    battery(x, 362, 10, BK);
    for (let m = 0; m < 12; m++) {
      const bx = 10 + (m % 4) * 97, by = 44 + ((m - m % 4) / 4) * 85, cur = m === now.getMonth();
      if (cur) { x.strokeStyle = RED; x.lineWidth = 2; x.beginPath(); x.roundRect(bx - 3, by - 10, 94, 82, 4); x.stroke(); }
      font(x, 10, 1); center(x, 'Tháng ' + (m + 1), bx + 44, by, cur ? RED : BK);
      const first = new Date(y, m, 1).getDay(), maxD = new Date(y, m + 1, 0).getDate();
      for (let d = 1; d <= maxD; d++) {
        const idx = first + d - 1, col = idx % 7, row = (idx - col) / 7;
        const dx = bx + col * 12.6 + 6, dy = by + 11 + row * 10;
        if (cur && d === now.getDate()) { x.fillStyle = RED; x.beginPath(); x.arc(dx, dy - 2, 5.5, 0, 7); x.fill(); }
        font(x, 7, 0);
        center(x, d, dx, dy, (cur && d === now.getDate()) ? '#fff' : ((col === 0 || col === 6) ? RED : BK));
      }
    }
  }
  function m17(x, now) { // Nhiệt kế
    font(x, 13, 0); x.fillStyle = BK;
    x.fillText(WD_FULL[now.getDay()] + ', ' + pad2(now.getDate()) + '/' + pad2(now.getMonth() + 1) + '/' + now.getFullYear() + ' - Âm Lịch 21/5', 14, 30);
    battery(x, 362, 14, BK);
    line(x, 10, 44, 390, 44, BK, 2);
    segStr(x, 56, 62, 5.2, '28', BK);
    x.strokeStyle = BK; x.lineWidth = 3; x.beginPath(); x.arc(228, 78, 9, 0, 7); x.stroke();
    x.fillStyle = BK; x.fillRect(248, 62, 13, 104); x.fillRect(248, 62, 56, 13); x.fillRect(248, 153, 56, 13);
    x.strokeStyle = BK; x.lineWidth = 2; x.strokeRect(330, 58, 24, 106);
    x.fillStyle = RED; x.fillRect(336, 86, 12, 74); x.beginPath(); x.arc(342, 178, 15, 0, 7); x.fill();
    line(x, 10, 210, 390, 210);
    font(x, 13, 0);
    multi(x, [['Cao nhất hôm nay: ', BK], ['31°C', RED], [' - Thấp nhất: ', BK], ['24°C', RED]], 200, 236);
    segStr(x, 150, 248, 2, pad2(now.getHours()) + ':' + pad2(now.getMinutes()), BK);
  }
  function m18(x, now) { // Trăng
    font(x, 14, 0); x.fillStyle = BK;
    x.fillText(WD_FULL[now.getDay()] + ', ' + pad2(now.getDate()) + '/' + pad2(now.getMonth() + 1) + '/' + now.getFullYear(), 14, 30);
    battery(x, 362, 14, BK);
    line(x, 10, 44, 390, 44, BK, 2);
    x.fillStyle = BK; x.beginPath(); x.arc(200, 138, 62, 0, 7); x.fill();
    x.fillStyle = '#f0ead6'; x.beginPath(); x.arc(200, 138, 60, Math.PI / 2, Math.PI * 1.5); x.fill();
    x.beginPath(); x.ellipse(200, 138, 24, 60, 0, Math.PI / 2, Math.PI * 1.5, true); x.fill();
    x.strokeStyle = BK; x.lineWidth = 2; x.beginPath(); x.arc(200, 138, 62, 0, 7); x.stroke();
    font(x, 15, 1); multi(x, [['Âm Lịch 21/5', RED], [' - Trăng khuyết cuối tháng', BK]], 200, 236);
    font(x, 13, 0); multi(x, [['Rằm tiếp theo: ', BK], ['Âm Lịch 15/6 (28/07)', RED]], 200, 262);
    font(x, 12, 0); center(x, 'Ngày Canh Thìn - Năm Bính Ngọ', 200, 288, BK);
  }
  function m19(x, now) { // Ghi chú
    font(x, 14, 0); x.fillStyle = BK;
    x.fillText(WD_FULL[now.getDay()] + ', ' + pad2(now.getDate()) + '/' + pad2(now.getMonth() + 1) + '/' + now.getFullYear() + ' - ' + pad2(now.getHours()) + ':' + pad2(now.getMinutes()), 14, 30);
    battery(x, 362, 14, BK);
    line(x, 10, 44, 390, 44, BK, 2);
    x.fillStyle = RED; x.fillRect(30, 64, 340, 30);
    x.strokeStyle = RED; x.lineWidth = 3; x.strokeRect(31, 65, 338, 168);
    font(x, 14, 1); center(x, 'GHI CHÚ', 200, 85, '#fff');
    font(x, 26, 1); center(x, 'Họp phụ huynh 15:00', 200, 152, BK); center(x, 'thứ Hai tuần sau!', 200, 190, BK);
    font(x, 12, 0); multi(x, [['Âm Lịch 21/5 - Ngày Canh Thìn  -  ', BK], ['Lễ Vu Lan còn 52 ngày', RED]], 200, 266);
  }

  function m20(x, now) { // Tự thiết kế (chế độ 20)
    if (window.renderCustomLayout) { window.renderCustomLayout(x, now); return; }
    font(x, 15, 0);
    center(x, 'Chưa có giao diện tự thiết kế', 200, 140, BK);
    center(x, 'Tạo trong mục «Thiết kế màn hình»', 200, 168, BK);
  }
  // ---- chế độ 21-24: chủ đề game 8-bit (mô phỏng theo firmware) ----
  function pxDigit(x, X, Y, d, s, col) {
    const M = [0x7B6F, 0x2C97, 0x73E7, 0x73CF, 0x5BC9, 0x79CF, 0x79EF, 0x7292, 0x7BEF, 0x7BCF];
    const b = M[d % 10];
    x.fillStyle = col;
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++)
      if (b & (1 << (14 - (r * 3 + c)))) x.fillRect(X + c * s, Y + r * s, s, s);
  }
  function pxTime(x, X, Y, now, s, col) {
    const h = now.getHours(), m = now.getMinutes();
    pxDigit(x, X, Y, (h / 10) | 0, s, col); pxDigit(x, X + 4 * s, Y, h % 10, s, col);
    x.fillStyle = col; x.fillRect(X + 8 * s, Y + s, s, s); x.fillRect(X + 8 * s, Y + 3 * s, s, s);
    pxDigit(x, X + 10 * s, Y, (m / 10) | 0, s, col); pxDigit(x, X + 14 * s, Y, m % 10, s, col);
  }
  function pxDate(x, X, Y, now, s) {  // DD.MM: số đen/đỏ tùy mode gọi qua col
    pxDigit(x, X, Y, (now.getDate() / 10) | 0, s, pxDate.col); pxDigit(x, X + 4 * s, Y, now.getDate() % 10, s, pxDate.col);
    x.fillStyle = pxDate.dot; x.fillRect(X + 8 * s - (s >> 1), Y + 4 * s, s, s);
    pxDigit(x, X + 10 * s, Y, ((now.getMonth() + 1) / 10) | 0, s, pxDate.col);
    pxDigit(x, X + 14 * s, Y, (now.getMonth() + 1) % 10, s, pxDate.col);
  }
  function pxMtn(x, cx, top, base, s, col) {
    x.fillStyle = col;
    for (let y = top, half = s; y < base; y += s, half += s) x.fillRect(cx - half, y, 2 * half, Math.min(s, base - y));
  }
  function pxTree(x, cx, base, s, col) {
    x.fillStyle = col;
    x.fillRect(cx - s, base - 7 * s, 2 * s, 2 * s);
    x.fillRect(cx - 2 * s, base - 5 * s, 4 * s, 2 * s);
    x.fillRect(cx - 3 * s, base - 3 * s, 6 * s, 2 * s);
    x.fillRect(cx - (s >> 1), base - s, s, s);
  }
  function pxDither(x, X, Y, w, h, s, col) {
    x.fillStyle = col;
    for (let yy = 0; yy < h; yy += s)
      for (let xx = ((yy / s) & 1) * s; xx < w; xx += 2 * s) x.fillRect(X + xx, Y + yy, s, s);
  }
  function pxHearts(x, X, Y, s, n, line) {
    const F = [0x36, 0x7F, 0x7F, 0x3E, 0x1C, 0x08], E = [0x36, 0x49, 0x41, 0x22, 0x14, 0x08];
    for (let i = 0; i < 3; i++) {
      const rows = i < n ? F : E;
      x.fillStyle = i < n ? RED : (line || BK);
      for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++)
        if (rows[r] & (0x40 >> c)) x.fillRect(X + i * 9 * s + c * s, Y + r * s, s, s);
    }
  }
  function m21(x, now) { // Núi tuyết 8-bit
    pxDither(x, 0, 8, 400, 8, 4, BK);
    pxMtn(x, 60, 168, 252, 6, BK); pxMtn(x, 344, 176, 252, 6, BK);
    pxMtn(x, 200, 128, 252, 8, BK); pxMtn(x, 200, 128, 176, 8, '#fff');
    [28, 76, 128, 236, 288, 336, 380].forEach(t => pxTree(x, t, 258, 4, BK));
    x.fillStyle = BK; x.fillRect(0, 258, 400, 1);
    x.fillStyle = RED; x.fillRect(0, 266, 400, 34);
    x.fillStyle = BK;
    for (let yy = 278; yy < 300; yy += 12) x.fillRect(0, yy, 400, 1);
    for (let xx = 0; xx < 400; xx += 40) { x.fillRect(xx + 8, 266, 1, 12); x.fillRect(xx + 28, 278, 1, 12); }
    x.fillStyle = '#fff'; for (let xx = 12; xx < 400; xx += 56) x.fillRect(xx, 260, 24, 8);
    x.fillStyle = '#fff'; x.fillRect(104, 22, 192, 100);
    x.strokeStyle = BK; x.lineWidth = 1; x.strokeRect(104.5, 22.5, 192, 100); x.strokeRect(108.5, 26.5, 184, 92);
    font(x, 13, 0); center(x, WD_FULL[now.getDay()], 200, 50, RED);
    pxDate.col = BK; pxDate.dot = RED; pxDate(x, 200 - 68, 56, now, 8);
    font(x, 12, 0); center(x, now.getFullYear() + ' - ÂL 15/6', 200, 114, BK);
    pxHearts(x, 8, 20, 3, 2);
    font(x, 12, 0); x.textAlign = 'right'; x.fillStyle = BK; x.fillText('32°C', 390, 34); x.textAlign = 'left';
  }
  function m22(x, now) { // Hoàng hôn 8-bit
    x.fillStyle = BK; x.fillRect(0, 0, 400, 156);
    x.fillStyle = '#fff'; x.fillRect(0, 118, 400, 4); x.fillRect(0, 140, 400, 3);
    x.fillRect(24, 24, 40, 8); x.fillRect(32, 16, 20, 8); x.fillRect(318, 36, 30, 6); x.fillRect(324, 30, 15, 6);
    x.fillStyle = '#fff'; x.fillRect(96, 20, 208, 92);
    x.strokeStyle = BK; x.strokeRect(96.5, 20.5, 208, 92); x.strokeRect(100.5, 24.5, 200, 84);
    pxTime(x, 200 - 76, 32, now, 9, BK);
    font(x, 11, 0); center(x, pad2(now.getDate()) + '/' + pad2(now.getMonth() + 1) + ' - ÂL 15/6 - 32°C', 200, 104, BK);
    pxMtn(x, 84, 172, 250, 7, RED); pxMtn(x, 322, 182, 250, 7, RED);
    pxMtn(x, 208, 148, 250, 8, RED); pxMtn(x, 208, 148, 180, 8, '#fff'); pxMtn(x, 84, 172, 194, 7, '#fff');
    [20, 64, 110, 154, 200, 246, 292, 338, 382].forEach(t => pxTree(x, t, 262, 4, BK));
    x.fillStyle = BK; x.fillRect(0, 262, 400, 38);
    x.fillStyle = '#fff';
    for (let xx = 0; xx < 400; xx += 24) { x.fillRect(xx, 262, 12, 8); x.fillRect(xx + 12, 266, 12, 8); }
    x.fillRect(0, 274, 400, 6);
    pxDither(x, 0, 284, 400, 8, 4, '#fff');
    pxHearts(x, 8, 8, 3, 2, '#fff');
  }
  function m23(x, now) { // Khủng long 8-bit (Chrome "No internet")
    const DINO = [0x00FE, 0x017F, 0x01FF, 0x01FF, 0x01F8, 0x81E0, 0xC3E0, 0xE7E0,
                  0xFFF0, 0x7FE4, 0x3FE0, 0x1FC0, 0x0FC0, 0x0660, 0x0420, 0x0630];
    const cactus = (cx, base, s, h) => {  // thân + 2 nhánh chữ U (bản đầu)
      x.fillStyle = BK;
      x.fillRect(cx - s, base - h, 2 * s, h);
      x.fillRect(cx - 3 * s, base - h + 2 * s, s, 3 * s); x.fillRect(cx - 3 * s, base - h + 4 * s, 2 * s, s);
      x.fillRect(cx + 2 * s, base - h + s, s, 3 * s); x.fillRect(cx + s, base - h + 3 * s, 2 * s, s);
    };
    const cloud = (cx, cy) => {  // viền mây Chrome: đáy phẳng + hai bướu bậc thang
      const seg = [[0, 12, 46, 0], [-1, 8, 5, 1], [0, 7, 7, 0], [7, 4, 3, 1], [8, 3, 8, 0], [16, 1, 3, 1],
                   [17, 0, 12, 0], [29, 1, 4, 1], [30, 5, 9, 0], [39, 6, 3, 1], [40, 9, 5, 0], [45, 10, 2, 1]];
      x.fillStyle = BK;
      seg.forEach(g => { if (g[3]) x.fillRect(cx + g[0], cy + g[1], 1, g[2]); else x.fillRect(cx + g[0], cy + g[1], g[2], 1); });
    };
    pxHearts(x, 8, 8, 3, 2);
    // "HI DD.MM.YYYY" chữ số pixel góc phải
    {
      const s = 3, dw = 12, X0 = 400 - 10 - (8 * dw + 12), Y0 = 10, yr = now.getFullYear();
      font(x, 10, 0); x.fillStyle = BK; x.fillText('HI', X0 - 18, Y0 + 12);
      pxDigit(x, X0, Y0, (now.getDate() / 10) | 0, s, BK); pxDigit(x, X0 + dw, Y0, now.getDate() % 10, s, BK);
      x.fillStyle = BK; x.fillRect(X0 + 2 * dw, Y0 + 12, 3, 3);
      pxDigit(x, X0 + 2 * dw + 6, Y0, ((now.getMonth() + 1) / 10) | 0, s, BK);
      pxDigit(x, X0 + 3 * dw + 6, Y0, (now.getMonth() + 1) % 10, s, BK);
      x.fillRect(X0 + 4 * dw + 6, Y0 + 12, 3, 3);
      pxDigit(x, X0 + 4 * dw + 12, Y0, ((yr / 1000) | 0) % 10, s, BK);
      pxDigit(x, X0 + 5 * dw + 12, Y0, ((yr / 100) | 0) % 10, s, BK);
      pxDigit(x, X0 + 6 * dw + 12, Y0, ((yr / 10) | 0) % 10, s, BK);
      pxDigit(x, X0 + 7 * dw + 12, Y0, yr % 10, s, BK);
    }
    // mặt trời đỏ + mây + chim
    x.fillStyle = RED; x.fillRect(330, 44, 24, 6); x.fillRect(324, 50, 36, 24); x.fillRect(330, 74, 24, 6);
    cloud(56, 54); cloud(172, 38);
    x.fillStyle = BK;
    const PT = [0x10, 0x18, 0xFE, 0x3C, 0x10];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 8; c++)
      if (PT[r] & (0x80 >> c)) x.fillRect(248 + c * 4, 180 + r * 4, 4, 4);
    // màn "game over": thứ giãn cách ký tự kiểu "G A M E  O V E R"
    font(x, 22, 1); center(x, WD_FULL[now.getDay()].split('').join(' '), 200, 116, BK);
    font(x, 12, 0); center(x, 'Tháng ' + (now.getMonth() + 1) + ' - ' + now.getFullYear() + ' · ÂL 15/6', 200, 140, BK);
    font(x, 10, 0); center(x, 'ERR_NO_INTERNET - 32*C', 230, 162, BK);
    // T-Rex
    x.fillStyle = BK;
    for (let r = 0; r < 16; r++) for (let c = 0; c < 16; c++)
      if (DINO[r] & (0x8000 >> c)) x.fillRect(36 + c * 6, 142 + r * 6, 6, 6);
    // xương rồng + đường đất
    cactus(210, 238, 5, 44); cactus(268, 238, 4, 30); cactus(336, 238, 5, 40); cactus(358, 238, 3, 24);
    x.fillStyle = BK; x.fillRect(0, 238, 400, 2);
    [24, 88, 140, 196, 240, 300, 344, 380].forEach((gx, i) => {
      x.fillRect(gx, 248 + (i % 3) * 6, 14, 1);
    });
  }
  function m24(x, now) { // Thành phố pixel
    pxTime(x, 200 - 102, 24, now, 12, BK);
    x.fillStyle = '#fff'; x.fillRect(116, 102, 168, 40);
    x.strokeStyle = BK; x.strokeRect(116.5, 102.5, 168, 40); x.strokeRect(119.5, 105.5, 162, 34);
    font(x, 13, 0); center(x, pad2(now.getDate()) + '-' + pad2(now.getMonth() + 1) + '-' + now.getFullYear(), 200, 128, BK);
    font(x, 12, 0); center(x, 'Âm lịch 15/6', 200, 162, BK);
    const bh = [36, 58, 44, 70, 30, 62, 50, 74, 40, 56, 66, 34, 48];
    for (let i = 0; i < 13; i++) {
      const bx = i * 31, top = 244 - bh[i];
      x.fillStyle = BK; x.fillRect(bx, top, 28, bh[i]);
      x.fillStyle = '#fff';
      for (let wy = top + 6; wy < 238; wy += 10) { x.fillRect(bx + 5, wy, 4, 4); x.fillRect(bx + 13, wy, 4, 4); x.fillRect(bx + 21, wy, 4, 4); }
    }
    x.fillStyle = RED; x.fillRect(0, 244, 400, 22);
    x.fillStyle = BK; x.fillRect(0, 250, 400, 1); x.fillRect(0, 258, 400, 1);
    x.fillRect(0, 266, 400, 34);
    x.fillStyle = '#fff'; x.fillRect(24, 276, 64, 2); x.fillRect(150, 284, 100, 2);
    const body = [0x3C, 0x3C, 0x18, 0x3C, 0x5A, 0x5A, 0x24, 0x66];
    [60, 316].forEach((px, i) => {
      const py = 242;
      x.fillStyle = '#fff';
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++)
        if (body[r] & (0x80 >> c)) x.fillRect(px + c * 3, py + r * 3, 3, 3);
      // bong bóng thoại: trái = nhiệt độ, phải = điện áp
      x.fillRect(px + 20, py - 26, 34, 22); x.strokeStyle = BK; x.strokeRect(px + 20.5, py - 25.5, 34, 22);
      font(x, 10, 0); x.fillStyle = BK; x.textAlign = 'center';
      x.fillText(i === 0 ? '32°C' : '3.2V', px + 37, py - 11);
      x.textAlign = 'left';
    });
    pxHearts(x, 400 - 8 - 81, 8, 3, 2);
  }

  // shared drawing helpers for the mode-20 designer (designer.js)
  window.__pv = { font, center, multi, seg7, segStr, battery, analogClock, monthGrid, pad2, lunarish,
                  RED, BK, WH, WD_SHORT, WD_FULL };

  const MODE_LIST = [
    { mode: 1, name: 'Lịch tháng', tick: 'Cập nhật lúc 0h', id: 'calendarmodebutton', draw: m1 },
    { mode: 2, name: 'Đồng hồ', tick: 'Làm mới mỗi phút', id: 'clockmodebutton', draw: m2 },
    { mode: 3, name: 'Đồng hồ + Lịch', tick: 'Làm mới mỗi phút', id: 'combomodebutton', draw: m3 },
    { mode: 4, name: 'Lịch để bàn (đỏ)', tick: 'Làm mới mỗi phút', id: 'redcombomodebutton', draw: m4 },
    { mode: 5, name: 'Lịch VN (Can Chi)', tick: 'Cập nhật lúc 0h', id: 'vncalendarmodebutton', draw: m5 },
    { mode: 6, name: 'Đồng hồ số', tick: 'Làm mới mỗi phút', id: 'digitalmodebutton', draw: m6 },
    { mode: 7, name: 'Đồng hồ kim', tick: 'Làm mới mỗi phút', id: 'analogmodebutton', draw: m7 },
    { mode: 8, name: 'Lịch bloc', tick: 'Cập nhật lúc 0h', id: 'dayblocmodebutton', draw: m8 },
    { mode: 9, name: 'Lịch tuần', tick: 'Làm mới mỗi phút', id: 'weekmodebutton', draw: m9 },
    { mode: 10, name: 'Giờ + lịch tháng', tick: 'Làm mới mỗi phút', id: 'digitalcalmodebutton', draw: m10 },
    { mode: 11, name: 'Kim + thẻ ngày', tick: 'Làm mới mỗi phút', id: 'analogdaymodebutton', draw: m11 },
    { mode: 12, name: 'Tối giản', tick: 'Cập nhật lúc 0h', id: 'minimalmodebutton', draw: m12 },
    { mode: 13, name: 'Lịch vạn niên', tick: 'Cập nhật lúc 0h', id: 'vanniemodebutton', draw: m13 },
    { mode: 14, name: 'Đếm ngược sự kiện', tick: 'Cập nhật lúc 0h', id: 'countdownmodebutton', draw: m14 },
    { mode: 15, name: 'Hai tháng', tick: 'Cập nhật lúc 0h', id: 'twomonthmodebutton', draw: m15 },
    { mode: 16, name: 'Lịch cả năm', tick: 'Cập nhật lúc 0h', id: 'yearmodebutton', draw: m16 },
    { mode: 17, name: 'Nhiệt kế', tick: 'Làm mới mỗi phút', id: 'thermomodebutton', draw: m17 },
    { mode: 18, name: 'Trăng', tick: 'Cập nhật lúc 0h', id: 'moonmodebutton', draw: m18 },
    { mode: 19, name: 'Ghi chú', tick: 'Làm mới mỗi phút', id: 'notemodebutton', draw: m19 },
    { mode: 20, name: 'Tự thiết kế', tick: 'Làm mới mỗi phút', id: 'custommodebutton', draw: m20 },
    { mode: 21, name: 'Núi tuyết 8-bit', tick: 'Cập nhật lúc 0h', id: 'retromtnmodebutton', draw: m21 },
    { mode: 22, name: 'Hoàng hôn 8-bit', tick: 'Làm mới mỗi phút', id: 'retrosunsetmodebutton', draw: m22 },
    { mode: 23, name: 'Khủng long 8-bit', tick: 'Cập nhật lúc 0h', id: 'retrowinmodebutton', draw: m23 },
    { mode: 24, name: 'Thành phố pixel', tick: 'Làm mới mỗi phút', id: 'retrocitymodebutton', draw: m24 },
  ];

  // highlight the mode the device reports (config byte 11) or was just set to
  window.highlightMode = function (mode) {
    document.querySelectorAll('.mode-card').forEach(card => {
      card.classList.toggle('active', Number(card.dataset.mode) === mode);
    });
  };

  function build() {
    const gallery = document.getElementById('modeGallery');
    if (!gallery) return;
    const now = new Date();
    for (const m of MODE_LIST) {
      const card = document.createElement('div');
      card.className = 'mode-card';
      card.dataset.mode = m.mode;
      card.innerHTML =
        '<canvas width="400" height="300"></canvas>' +
        '<div class="mode-name">' + m.name + '</div>' +
        '<div class="mode-tick">' + m.tick + '</div>' +
        '<button id="' + m.id + '" type="button" class="primary" onclick="syncTime(' + m.mode + ')">Áp dụng</button>';
      gallery.appendChild(card);
      try { m.draw(ctx2d(card.querySelector('canvas')), now); }
      catch (e) { console.error('preview mode ' + m.mode, e); }
    }
    // redraw thumbnails each minute so the clock previews stay current
    setInterval(() => {
      const t = new Date();
      document.querySelectorAll('.mode-card').forEach((card, i) => {
        if (MODE_LIST[i]) MODE_LIST[i].draw(ctx2d(card.querySelector('canvas')), t);
      });
    }, 60000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
