/*
 * Mode gallery: canvas previews of every display mode with an apply button.
 * Previews are drawn at the panel's native 400x300 with live date/time and a
 * real month grid; lunar/Can Chi/festival strings are illustrative samples
 * (the device computes the real values itself).
 */
(function () {
  const RED = '#C0261F', BK = '#151515', WH = '#f6f4ec', YE = '#E8B90C';
  // màn 4 màu BWRY (driver 05 IST7158 / 06 JD79668): preview vẽ thêm các điểm
  // nhấn VÀNG đúng như firmware epd_4_2inch_4c; gallery vẽ lại khi đổi driver
  function is4c() {
    const s = document.getElementById('epddriver');
    return !!s && (s.value === '05' || s.value === '06');
  }
  // Giao diện v1.7 (chữ đậm/đỏ, số 12-3-6-9 đỏ, bỏ mode 2 & 18, hắc đạo...):
  // chỉ bật khi thiết bị ĐÃ khai 'fw=' >= 1.7 — main.js đặt cờ window.__fw17
  // rồi gọi refreshModeGallery(); máy firmware cũ giữ nguyên preview cũ.
  function v17() { return !!window.__fw17; }
  // Mode lịch dương+âm (card 13, mode id 14) thay «Đếm ngược sự kiện»:
  // chỉ hiện khi firmware có mode mới — main.js đặt cờ __fwCal
  // (BWR >= 2.0, bản 4 màu DIY-4_2C >= 2.9).
  function fwCal() { return !!window.__fwCal; }
  // bản 2 của mode lịch dương+âm (giờ:phút + đếm ngược): fw BWR >= 2.1 /
  // 4 màu >= 3.0 — dùng lại cờ __fwTimeOk của tính năng 12h/24h (cùng mốc)
  function fwTime() { return !!window.__fwTimeOk; }
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
    if (!numerals && is4c()) {  // BWRY: vành «mạ vàng» quanh mặt số tick-only
      x.strokeStyle = YE; x.lineWidth = 2.5; x.beginPath(); x.arc(cx, cy, r - 1, 0, 7); x.stroke();
    }
    if (numerals) {
      // BWRY: vành ngoài VÀNG (firmware vẽ vành vàng 2px thay viền đen)
      x.strokeStyle = is4c() ? YE : tickCol; x.lineWidth = 4; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.stroke();
      for (let i = 0; i < 60; i++) {
        const a = i * Math.PI / 30, big = i % 5 === 0, r1 = r - (big ? 10 : 5);
        // v1.7: vạch giờ 12-3-6-9 màu ĐỎ (khớp firmware)
        x.strokeStyle = (v17() && big && i % 15 === 0) ? RED : tickCol;
        x.lineWidth = big ? 2.5 : 1; x.beginPath();
        x.moveTo(cx + r1 * Math.sin(a), cy - r1 * Math.cos(a));
        x.lineTo(cx + (r - 3) * Math.sin(a), cy - (r - 3) * Math.cos(a)); x.stroke();
      }
      x.textAlign = 'center'; x.textBaseline = 'middle';
      font(x, r < 60 ? 8 : Math.max(12, r / 6), 1); // small faces: small numerals
      for (let n = 1; n <= 12; n++) {
        const a = n * Math.PI / 6, rn = r < 60 ? r - 16 : r - 24;
        // v1.7: số 12-3-6-9 màu ĐỎ
        x.fillStyle = (v17() && n % 3 === 0) ? RED : tickCol;
        x.fillText(n, cx + rn * Math.sin(a), cy - rn * Math.cos(a));
      }
      x.textBaseline = 'alphabetic'; x.textAlign = 'left';
    } else {
      for (let n = 0; n < 12; n++) {
        const a = n * Math.PI / 6;
        // v1.7: vạch 12-3-6-9 ĐỎ trên mặt số tick-only (mode 4)
        x.strokeStyle = (v17() && n % 3 === 0) ? RED : tickCol; x.lineWidth = 3; x.beginPath();
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
    const first0 = new Date(year, mon, 1).getDay();
    const first = (first0 + 7 - (v17() ? 1 : 0)) % 7;  // v1.7: tuần bắt đầu T2
    const maxD = new Date(year, mon + 1, 0).getDate();
    const rows = Math.ceil((first + maxD) / 7);
    const cw = gw / 7, rh = gh / rows;
    for (let d = 1; d <= maxD; d++) {
      const idx = first + d - 1, col = idx % 7, row = (idx - col) / 7;
      const cx = gx + col * cw + cw / 2, cy = gy + row * rh + rh / 2;
      const wd = (first0 + d - 1) % 7;  // thứ THẬT của ngày d (0=CN)
      const weekend = wd === 0 || wd === 6;
      // BWRY: đĩa đen «hôm nay» (mode Combo) thành đĩa VÀNG chữ đen; đĩa đỏ
      // thêm viền vàng — đúng firmware
      const comboYellow = is4c() && (opt.todayCol || RED) === BK;
      if (d === today) {
        // opt.rPlus: mode 10 v1.7 nới vòng «hôm nay» thêm 2px, giữ tâm
        const rr = Math.min(cw, rh) / 2 - 1 + (opt.rPlus || 0), ty = cy - (opt.lunar ? 2 : 0);
        x.fillStyle = comboYellow ? YE : (opt.todayCol || RED); x.beginPath();
        x.arc(cx, ty, rr, 0, 7); x.fill();
        if (is4c()) {
          x.strokeStyle = comboYellow ? BK : YE; x.lineWidth = 2;
          x.beginPath(); x.arc(cx, ty, rr, 0, 7); x.stroke();
        }
      }
      font(x, opt.dayPx || 13, 1);
      center(x, d, cx, cy + (opt.lunar ? 2 : 5),
             d === today ? (comboYellow ? BK : '#fff') : (weekend && !opt.noWeekendRed ? RED : BK));
      if (opt.lunar) {
        font(x, 9, 0);
        center(x, lunarish(d), cx, cy + rh / 2 - 3, d === today ? '#fff' : '#555');
      }
    }
    return rows;
  }
  function weekBar(x, gx, gy, gw, h, labels, px, sep) {
    const w = gw / 7, off = v17() ? 1 : 0;  // v1.7: tuần bắt đầu THỨ HAI
    font(x, px || 13, 1);
    for (let i = 0; i < 7; i++) {
      const day = (i + off) % 7;  // 0=CN..6=T7 (thứ tự nhãn theo week_start)
      // BWRY: T7 nền VÀNG chữ đen (CN vẫn đỏ) — đúng firmware
      const yellowSat = is4c() && day === 6;
      x.fillStyle = day === 0 ? RED : (yellowSat ? YE : (day === 6 ? RED : BK));
      x.fillRect(gx + i * w, gy, w - 1, h);
      center(x, labels[day], gx + i * w + w / 2, gy + h / 2 + 5, yellowSat ? BK : '#fff');
    }
    // v1.7 mode 1 + 5: vạch trắng | ngăn cách các ô thứ
    if (sep && v17()) {
      x.fillStyle = '#fff';
      for (let i = 1; i < 7; i++) x.fillRect(gx + i * w - 2, gy, 2, h);
    }
  }
  function pad2(n) { return String(n).padStart(2, '0'); }

  /* ---- previews, one per display mode ---- */

  function m1(x, now) { // Lịch tháng
    font(x, 15, v17() ? 1 : 0);  // v1.7: header đậm
    multi(x, [['Tháng ', BK], [String(now.getMonth() + 1), RED], [' - ', BK], [String(now.getFullYear()), RED],
              ['   ÂL 21/5 Bính Ngọ ', BK], ['[Tuần 27]', RED]], 165, 24);
    battery(x, 366, 8, BK, '3.2V');
    weekBar(x, 10, 32, 380, 24, WD_SHORT, 13, true);  // v1.7: vạch | như mode 5
    monthGrid(x, 10, 64, 380, 226, now, { lunar: true, dayPx: 15 });
  }
  function m2(x, now) { // Đồng hồ
    font(x, 15, 0);
    multi(x, [['Ngày ', BK], [String(now.getDate()), RED], [' tháng ', BK], [String(now.getMonth() + 1), RED],
              [' năm ', BK], [String(now.getFullYear()), RED]], 150, 34);
    font(x, 14, 0); x.fillStyle = BK; x.fillText(WD_FULL[now.getDay()], 40, 56); x.fillText('Âm Lịch 21/5', 170, 56);
    battery(x, 340, 20, BK, '3.2V');
    line(x, 30, 68, 370, 68);
    if (is4c()) line(x, 30, 70, 370, 70, YE, 2);  // BWRY: mép vàng
    segStr(x, 104, 100, 7, pad2(now.getHours()) + ':' + pad2(now.getMinutes()), BK, BK);
    line(x, 30, 232, 370, 232);
    if (is4c()) line(x, 30, 230, 370, 230, YE, 2);
    font(x, 14, 0);
    multi(x, [['Năm Bính Ngọ ', BK], ['(Ngựa)', RED]], 120, 258);
    x.fillStyle = BK; x.fillText('Tuần 27', 40, 280);
  }
  function m3(x, now) { // Đồng hồ + Lịch (B/W)
    x.strokeStyle = BK; x.lineWidth = 2; x.strokeRect(3, 3, 394, 294); x.strokeRect(7, 7, 386, 286);
    // v1.7: ngày + thứ header ĐỎ, «Sáng/Chiều» đậm
    font(x, 17, 1); x.fillStyle = v17() ? RED : BK;
    x.fillText(pad2(now.getDate()) + '/' + pad2(now.getMonth() + 1) + '/' + now.getFullYear(), 14, 36);
    font(x, 14, v17() ? 1 : 0); x.fillStyle = BK; x.fillText('Sáng', 178, 34);
    font(x, 14, 0); x.fillStyle = v17() ? RED : BK; x.fillText(WD_FULL[now.getDay()], 244, 34);
    battery(x, 362, 16, BK);
    line(x, 7, 48, 393, 48, BK, 2);
    if (is4c()) line(x, 7, 50, 393, 50, YE, 1.5);  // BWRY: mép vàng
    analogClock(x, 104, 140, 78, now, true);
    // v1.7: hàng thứ đậm sẵn, T7/CN đỏ, tuần bắt đầu T2
    font(x, 11, 1);
    for (let i = 0; i < 7; i++) {
      const day = (i + (v17() ? 1 : 0)) % 7;
      center(x, WD_SHORT[day], 206 + i * 26 + 13, 72, (v17() && (day === 0 || day === 6)) ? RED : BK);
    }
    // v1.7: vòng «hôm nay» ĐỎ (trước là đen)
    monthGrid(x, 206, 80, 182, 144, now, { todayCol: v17() ? RED : BK, dayPx: 11, noWeekendRed: true });
    line(x, 7, 230, 393, 230, BK, 2);
    if (is4c()) line(x, 7, 232, 393, 232, YE, 1.5);
    // v1.7: năm Can Chi + âm lịch + lễ + số ngày còn lại đều ĐỎ
    font(x, 13, 0); x.fillStyle = v17() ? RED : BK;
    x.fillText('Bính Ngọ (Ngựa)', 12, 252); x.fillText('Âm Lịch 21/5', 12, 274);
    x.fillText('Lễ Vu Lan', 148, 252); x.fillText('còn 52 ngày', 148, 274);
    segStr(x, 300, 240, 2.4, '32', BK, BK);
    font(x, 13, v17() ? 1 : 0); x.fillStyle = BK; x.fillText('°C', 344, 262);
    line(x, 140, 232, 140, 292); line(x, 292, 232, 292, 292);
  }
  function m4(x, now) { // Lịch để bàn (đỏ)
    x.fillStyle = BK; x.fillRect(0, 0, 400, 300);
    x.fillStyle = RED; x.beginPath(); x.roundRect(8, 8, 144, 182, 12); x.fill();
    if (is4c()) {  // BWRY: viền vàng panel đỏ trên nền tối
      x.strokeStyle = YE; x.lineWidth = 2.5; x.beginPath(); x.roundRect(9, 9, 142, 180, 11); x.stroke();
    }
    // white dial (matches firmware: hands can only partial-erase on white)
    x.fillStyle = '#fff'; x.beginPath(); x.arc(80, 74, 52, 0, 7); x.fill();
    analogClock(x, 80, 74, 52, now, false, BK, BK);
    x.fillStyle = '#fff'; x.beginPath(); x.roundRect(20, 136, 120, 46, 8); x.fill();
    segStr(x, 32, 140, 2, pad2(now.getHours()) + ':' + pad2(now.getMinutes()), BK, BK);
    // BWRY: số ngày 7-seg VÀNG trên nền đen
    segStr(x, 12, 210, 3, pad2(now.getDate()), is4c() ? YE : '#fff', is4c() ? YE : '#fff');
    line(x, 88, 212, 88, 272, '#fff', 2);
    font(x, 14, 0); x.fillStyle = '#fff'; x.fillText('Năm Ngựa', 96, 234);
    battery(x, 96, 240, '#fff'); font(x, 11, 0); x.fillStyle = '#fff';
    x.fillText('3.2V', 124, 262); x.fillText('21/5 AL', 96, 276);
    x.fillStyle = '#fff'; x.beginPath(); x.roundRect(168, 10, 224, 280, 14); x.fill();
    // BWRY: trăng lưỡi liềm VÀNG viền đen
    x.fillStyle = is4c() ? YE : BK; x.beginPath(); x.arc(196, 38, 13, 0, 7); x.fill();
    if (is4c()) { x.strokeStyle = BK; x.lineWidth = 1.5; x.beginPath(); x.arc(196, 38, 13, 0, 7); x.stroke(); }
    x.fillStyle = '#fff'; x.beginPath(); x.arc(203, 33, 11, 0, 7); x.fill();
    font(x, 17, 1); x.fillStyle = BK; x.textAlign = 'right';
    x.fillText(now.getFullYear() + '-' + pad2(now.getMonth() + 1), 384, 48); x.textAlign = 'left';
    x.fillRect(178, 58, 206, 5);
    // v1.7: hàng thứ T7/CN đỏ, còn lại ĐEN (trước toàn đỏ), tuần bắt đầu T2
    font(x, 11, 1);
    for (let i = 0; i < 7; i++) {
      const day = (i + (v17() ? 1 : 0)) % 7;
      center(x, WD_SHORT[day], 173 + i * 31 + 15, 88, v17() ? ((day === 0 || day === 6) ? RED : BK) : RED);
    }
    monthGrid(x, 173, 96, 217, 186, now, { dayPx: 12, noWeekendRed: true });
  }
  function m5(x, now) { // Lịch VN (Can Chi)
    font(x, 18, 1); x.fillStyle = RED;
    x.fillText(pad2(now.getDate()) + '-' + pad2(now.getMonth() + 1) + '-' + now.getFullYear(), 10, 26);
    font(x, 13, 0); x.fillStyle = BK; x.fillText('Ngày Canh Thìn', 10, 46);
    multi(x, [['Tháng ', RED], ['Giáp Ngọ | ', BK], ['Năm ', RED], ['Bính Ngọ', BK]], 108, 63);
    battery(x, 366, 8, BK, '3.2V');
    font(x, 12, 0); x.fillStyle = BK; x.textAlign = 'right'; x.fillText('DIY-1D18', 388, 44); x.textAlign = 'left';
    weekBar(x, 10, 68, 380, 24, WD_BAR, 12, true);  // v1.7: vạch | trắng ngăn ô
    const rows = monthGrid(x, 10, 96, 380, 184, now, { lunar: true, dayPx: 14 });
    font(x, 13, 0); x.fillStyle = BK; x.fillText('8. Tiểu Thử   24. Đại Thử', 10, 294);
  }
  function m6(x, now) { // Đồng hồ số — v1.7: all text bold
    font(x, 15, v17() ? 1 : 0); x.fillStyle = BK;
    x.fillText(WD_FULL[now.getDay()] + ', ' + pad2(now.getDate()) + '/' + pad2(now.getMonth() + 1) + '/' + now.getFullYear(), 12, 30);
    battery(x, 362, 14, BK, '3.2V');
    line(x, 10, 46, 390, 46, BK, 2);
    if (is4c()) line(x, 10, 48, 390, 48, YE, 1.5);  // BWRY: mép vàng
    segStr(x, 104, 92, 8, pad2(now.getHours()) + ':' + pad2(now.getMinutes()), BK, RED);
    font(x, 14, v17() ? 1 : 0);
    multi(x, [['Âm Lịch 21/5', RED], [' - Ngày Canh Thìn - Năm Bính Ngọ', BK]], 200, 216);
    line(x, 10, 250, 390, 250);
    font(x, 13, v17() ? 1 : 0); x.fillStyle = BK; x.fillText('32°C', 12, 282);
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
    if (is4c()) { x.fillStyle = YE; x.fillRect(0, 46, 400, 3); }  // BWRY: nẹp vàng
    font(x, 17, 1); center(x, 'Tháng ' + (now.getMonth() + 1) + ' - ' + now.getFullYear(), 200, 30, '#fff');
    battery(x, 358, 18, '#fff');
    font(x, 100, 1); center(x, now.getDate(), 200, 168, RED);
    font(x, 17, 1); center(x, WD_FULL[now.getDay()], 200, 214, BK);
    line(x, 70, 228, 330, 228);
    font(x, 14, v17() ? 1 : 0);  // v1.7: all text bold
    multi(x, [['Âm Lịch 21/5', RED], [' - Ngày Canh Thìn - Năm Bính Ngọ', BK]], 200, 254);
    multi(x, [['Lễ Vu Lan còn 52 ngày', RED]], 200, 280);
  }
  function m9(x, now) { // Lịch tuần — v1.7: all text bold
    font(x, 15, v17() ? 1 : 0);
    multi(x, [['Tháng ' + (now.getMonth() + 1) + ' - ' + now.getFullYear(), BK], ['  Âm Lịch tháng 5', RED]], 128, 28);
    battery(x, 362, 12, BK, '3.2V');
    line(x, 10, 44, 390, 44);
    // v1.7: tuần bắt đầu THỨ HAI
    const start = new Date(now);
    start.setDate(now.getDate() - (v17() ? (now.getDay() + 6) % 7 : now.getDay()));
    for (let i = 0; i < 7; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const bx = 12 + i * 54, today = d.getDate() === now.getDate() && d.getMonth() === now.getMonth();
      x.beginPath(); x.roundRect(bx, 58, 52, 150, 7);
      if (today) {
        x.fillStyle = RED; x.fill();
        if (is4c()) {  // BWRY: viền vàng quanh ô «hôm nay»
          x.strokeStyle = YE; x.lineWidth = 2; x.beginPath(); x.roundRect(bx - 1, 57, 54, 152, 8); x.stroke();
        }
      } else { x.strokeStyle = BK; x.lineWidth = 1.5; x.stroke(); }
      const wd = d.getDay(), weekend = wd === 0 || wd === 6;
      font(x, 13, 1); center(x, WD_SHORT[wd], bx + 26, 84, today ? '#fff' : (weekend ? RED : BK));
      font(x, 22, 1); center(x, d.getDate(), bx + 26, 146, today ? '#fff' : BK);
      font(x, 11, 0); center(x, lunarish(d.getDate()), bx + 26, 178, today ? '#fff' : '#555');
    }
    line(x, 10, 224, 390, 224);
    font(x, 14, v17() ? 1 : 0); multi(x, [['Lễ Vu Lan còn 52 ngày', RED]], 200, 250);
    font(x, 13, v17() ? 1 : 0); multi(x, [['32°C - Ngày Canh Thìn - Tuần 27', BK]], 200, 278);
  }
  function m10(x, now) { // Giờ + lịch tháng
    segStr(x, 16, 12, 6, pad2(now.getHours()) + ':' + pad2(now.getMinutes()), BK, RED);
    if (v17()) {
      // v1.7: pin CHIẾM góc phải trên, thứ dời xuống dưới + ĐẬM
      battery(x, 362, 4, BK, '3.2V');
      font(x, 14, 1); x.textAlign = 'right'; x.fillStyle = RED; x.fillText(WD_FULL[now.getDay()], 388, 32);
    } else {
      battery(x, 260, 14, BK, '3.2V'); // giữa đồng hồ và cột chữ phải (fw <= 1.6)
      font(x, 14, 1); x.textAlign = 'right'; x.fillStyle = RED; x.fillText(WD_FULL[now.getDay()], 388, 28);
    }
    font(x, 16, 1); x.fillStyle = BK;
    x.fillText(pad2(now.getDate()) + '/' + pad2(now.getMonth() + 1) + '/' + now.getFullYear(), 388, v17() ? 56 : 54);
    font(x, 12, 0); x.fillText('Âm Lịch 21/5 - 32°C', 388, 76); x.textAlign = 'left';
    line(x, 10, 82, 390, 82, BK, 2);
    if (is4c()) line(x, 10, 84, 390, 84, YE, 1.5);  // BWRY: mép vàng
    font(x, 12, 1);
    for (let i = 0; i < 7; i++) {
      const day = (i + (v17() ? 1 : 0)) % 7;  // v1.7: tuần bắt đầu T2
      center(x, WD_SHORT[day], 11 + i * 54 + 27, 102, (day === 0 || day === 6) ? RED : BK);
    }
    monthGrid(x, 11, 110, 378, 186, now, { lunar: true, dayPx: 13, rPlus: v17() ? 2 : 0 });
  }
  function m11(x, now) { // Kim + thẻ ngày
    analogClock(x, 112, 150, 96, now, true);
    line(x, 228, 20, 228, 280, BK, 2);
    if (is4c()) line(x, 230, 20, 230, 280, YE, 1.5);  // BWRY: mép vàng
    font(x, 16, 1); center(x, WD_FULL[now.getDay()], 314, 56, RED);
    font(x, 72, 1); center(x, now.getDate(), 314, 164, BK);
    // v1.7: all text bold
    font(x, 14, v17() ? 1 : 0); center(x, 'Tháng ' + (now.getMonth() + 1) + ' - ' + now.getFullYear(), 314, 196, BK);
    multi(x, [['Âm Lịch 21/5', RED]], 314, 220);
    font(x, 13, v17() ? 1 : 0); center(x, 'Ngày Canh Thìn', 314, 242, BK);
    line(x, 248, 256, 380, 256);
    font(x, 12, 0); x.fillStyle = BK; x.fillText('32°C', 252, 278);
    battery(x, 348, 268, BK);
  }
  function m12(x, now) { // Tối giản — v1.7: bold + thứ TO GẤP ĐÔI (scale 2)
    font(x, v17() ? 32 : 24, 1); center(x, WD_FULL[now.getDay()], 200, v17() ? 76 : 70, BK);
    font(x, 84, 1); center(x, pad2(now.getDate()) + '.' + pad2(now.getMonth() + 1), 200, 182, RED);
    if (is4c()) { x.fillStyle = YE; x.fillRect(140, 194, 120, 4); }  // BWRY: gạch chân vàng
    font(x, 15, v17() ? 1 : 0);
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
    const off = v17() ? 1 : 0;  // v1.7: tuần bắt đầu THỨ HAI
    const first0 = new Date(y0, mo, 1).getDay();
    const first = (first0 + 7 - off) % 7, maxD = new Date(y0, mo + 1, 0).getDate(), cw = w / 7;
    font(x, Math.max(8, dayPx - 3), 1);
    for (let i = 0; i < 7; i++) {
      const day = (i + off) % 7;
      center(x, WD_SHORT[day], bx + i * cw + cw / 2, by, (day === 0 || day === 6) ? RED : BK);
    }
    for (let d = 1; d <= maxD; d++) {
      const idx = first + d - 1, col = idx % 7, row = (idx - col) / 7;
      const cx = bx + col * cw + cw / 2, cy = by + 8 + row * rh + rh / 2;
      const wd = (first0 + d - 1) % 7;
      if (d === today) {
        const rr = Math.min(cw, rh) / 2 - 1;
        x.fillStyle = RED; x.beginPath(); x.arc(cx, cy - 3, rr, 0, 7); x.fill();
        if (is4c()) { x.strokeStyle = YE; x.lineWidth = 1.5; x.beginPath(); x.arc(cx, cy - 3, rr, 0, 7); x.stroke(); }
      }
      font(x, dayPx, 1);
      center(x, d, cx, cy + 1, d === today ? '#fff' : ((wd === 0 || wd === 6) ? RED : BK));
    }
  }
  function m13(x, now) { // Lịch vạn niên
    x.fillStyle = RED; x.fillRect(0, 0, 180, 46);
    if (is4c()) { x.fillStyle = YE; x.fillRect(0, 46, 180, 3); }  // BWRY: nẹp vàng
    font(x, 15, 1); center(x, 'Tháng ' + (now.getMonth() + 1) + ' - ' + now.getFullYear(), 90, 29, '#fff');
    font(x, 84, 1); center(x, now.getDate(), 90, 158, RED);
    font(x, 15, 1); center(x, WD_FULL[now.getDay()], 90, 192, BK);
    font(x, 13, v17() ? 1 : 0); multi(x, [['Âm Lịch 21/5', RED]], 90, 218);
    font(x, 12, v17() ? 1 : 0); center(x, 'Tiết Tiểu Thử', 90, 242, BK);
    // BWRY: trăng lưỡi liềm VÀNG viền đen
    x.fillStyle = is4c() ? YE : BK; x.beginPath(); x.arc(90, 270, 13, 0, 7); x.fill();
    if (is4c()) { x.strokeStyle = BK; x.lineWidth = 1.5; x.beginPath(); x.arc(90, 270, 13, 0, 7); x.stroke(); }
    x.fillStyle = WH; x.beginPath(); x.arc(97, 265, 11, 0, 7); x.fill();
    line(x, 180, 8, 180, 292, BK, 2);
    if (is4c()) line(x, 182, 8, 182, 292, YE, 1.5);  // BWRY: mép vàng
    font(x, 14, 1); x.fillStyle = BK; x.fillText('Ngày Canh Thìn', 196, 32); battery(x, 362, 20, BK, '3.2V');
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
    if (v17()) {
      // v1.7: hắc đạo CÙNG bố cục 2 cột + giờ như hoàng đạo (chấm ĐEN),
      // khối lễ hội bỏ để lấy chỗ
      const hac = [['Tý', '23-1h'], ['Sửu', '1-3h'], ['Mão', '5-7h'], ['Ngọ', '11-13h'], ['Mùi', '13-15h'], ['Tuất', '19-21h']];
      font(x, 12, 0);
      for (let i = 0; i < 6; i++) {
        const gx = 196 + (i % 2) * 96, gy = 228 + ((i - i % 2) / 2) * 26;
        x.fillStyle = BK; x.beginPath(); x.arc(gx + 4, gy - 4, 3, 0, 7); x.fill();
        x.fillText(hac[i][0] + ' ' + hac[i][1], gx + 12, gy);
      }
    } else {
      font(x, 12, 0); x.fillStyle = BK; x.fillText('Tý, Sửu, Mão,', 196, 224); x.fillText('Ngọ, Mùi, Tuất', 196, 242);
      const nf = nextSolarFest(now);
      font(x, 12, 0); x.fillStyle = RED; x.fillText(nf.name, 196, 270); x.fillText('còn ' + nf.days + ' ngày', 196, 290);
    }
  }
  // Âm lịch VIỆT NAM (UTC+7, thuật toán Hồ Ngọc Đức) — bản rút gọn cho preview
  // mode lịch dương+âm (các card khác vẫn dùng chuỗi minh họa như cũ).
  function lunarVN(now) {
    const TZ = 7, PI = Math.PI, INT = Math.floor;
    function jd(dd, mm, yy) {
      const a = INT((14 - mm) / 12), y = yy + 4800 - a, m = mm + 12 * a - 3;
      return dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - INT(y / 100) + INT(y / 400) - 32045;
    }
    function newMoon(k) {
      const T = k / 1236.85, T2 = T * T, T3 = T2 * T, dr = PI / 180;
      let Jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3;
      Jd1 += 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
      const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
      const Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
      const F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
      let C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M);
      C1 = C1 - 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr);
      C1 = C1 - 0.0004 * Math.sin(dr * 3 * Mpr);
      C1 = C1 + 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr));
      C1 = C1 - 0.0074 * Math.sin(dr * (M - Mpr)) + 0.0004 * Math.sin(dr * (2 * F + M));
      C1 = C1 - 0.0004 * Math.sin(dr * (2 * F - M)) - 0.0006 * Math.sin(dr * (2 * F + Mpr));
      C1 = C1 + 0.0010 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M));
      const dt = (T < -11)
        ? 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3
        : -0.000278 + 0.000265 * T + 0.000262 * T2;
      return Jd1 + C1 - dt;
    }
    function nmDay(k) { return INT(newMoon(k) + 0.5 + TZ / 24); }
    function sunLong(jdn) {
      const T = (jdn - 2451545.0) / 36525, T2 = T * T, dr = PI / 180;
      const M = 357.52910 + 35999.05030 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
      const L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
      let DL = (1.914600 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M);
      DL += (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.000290 * Math.sin(dr * 3 * M);
      const L = (L0 + DL) * dr;
      return L - PI * 2 * INT(L / (PI * 2));
    }
    function sunSector(d) { return INT(sunLong(d - 0.5 - TZ / 24) / PI * 6); }
    function month11(yy) {
      const k = INT((jd(31, 12, yy) - 2415021) / 29.530588853);
      let nm = nmDay(k);
      if (sunSector(nm) >= 9) nm = nmDay(k - 1);
      return nm;
    }
    function leapOffset(a11) {
      const k = INT((a11 - 2415021.076998695) / 29.530588853 + 0.5);
      let last, i = 1, arc = sunSector(nmDay(k + i));
      do { last = arc; i++; arc = sunSector(nmDay(k + i)); } while (arc !== last && i < 14);
      return i - 1;
    }
    const yy = now.getFullYear();
    const dayNumber = jd(now.getDate(), now.getMonth() + 1, yy);
    const k = INT((dayNumber - 2415021.076998695) / 29.530588853);
    let monthStart = nmDay(k + 1);
    if (monthStart > dayNumber) monthStart = nmDay(k);
    let a11 = month11(yy), b11 = a11, lunarYear;
    if (a11 >= monthStart) { lunarYear = yy; a11 = month11(yy - 1); }
    else { lunarYear = yy + 1; b11 = month11(yy + 1); }
    const diff = INT((monthStart - a11) / 29);
    let leap = 0, lunarMonth = diff + 11;
    if (b11 - a11 > 365) {
      const lo = leapOffset(a11);
      if (diff >= lo) { lunarMonth = diff + 10; if (diff === lo) leap = 1; }
    }
    if (lunarMonth > 12) lunarMonth -= 12;
    if (lunarMonth >= 11 && diff < 4) lunarYear -= 1;
    return { day: dayNumber - monthStart + 1, month: lunarMonth, leap: leap, year: lunarYear };
  }
  const CAN = ['Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ', 'Canh', 'Tân', 'Nhâm', 'Quý'];
  const CHI = ['Tý', 'Sửu', 'Dần', 'Mão', 'Thìn', 'Tỵ', 'Ngọ', 'Mùi', 'Thân', 'Dậu', 'Tuất', 'Hợi'];

  function m14(x, now) { // card 13: fw mới = Lịch dương + âm; fw cũ = Đếm ngược
    if (fwCal()) {
      let lu = { day: 27, month: 6, leap: 0, year: now.getFullYear() };
      try { lu = lunarVN(now); } catch (e) { console.error('lunarVN', e); }
      const yName = CAN[(lu.year + 6) % 10] + ' ' + CHI[(lu.year + 8) % 12];
      // băng đen trên cùng: thứ trong tuần (chung cho cả hai lịch) + pin
      x.fillStyle = BK; x.fillRect(0, 0, 400, 44);
      font(x, 24, 1); center(x, WD_FULL[now.getDay()], 200, 31, WH);
      if (fwTime()) {  // bản 2: giờ:phút góc trái (cùng font thứ)
        x.fillStyle = WH; x.textAlign = 'left';
        x.fillText(pad2(now.getHours()) + ':' + pad2(now.getMinutes()), 10, 31);
      }
      battery(x, 366, 17, WH);
      if (is4c()) { x.fillStyle = YE; x.fillRect(0, 44, 400, 3); }  // BWRY: chỉ vàng
      line(x, 200, 58, 200, 262, BK, 2);
      // cột TRÁI — DƯƠNG LỊCH (đen)
      font(x, 16, 1); center(x, 'DƯƠNG LỊCH', 100, 79, BK);
      font(x, 104, 1); center(x, String(now.getDate()), 100, 186, BK);
      font(x, 24, 1); center(x, 'Tháng ' + (now.getMonth() + 1), 100, 227, BK);
      font(x, 17, 1); center(x, 'Năm ' + now.getFullYear(), 100, 255, BK);
      // cột PHẢI — ÂM LỊCH (đỏ)
      font(x, 16, 1); center(x, 'ÂM LỊCH', 300, 79, RED);
      font(x, 104, 1); center(x, String(lu.day), 300, 186, RED);
      font(x, 24, 1); center(x, 'Tháng ' + lu.month + (lu.leap ? ' nhuận' : ''), 300, 227, RED);
      font(x, 17, 1); center(x, 'Năm ' + yName, 300, 255, BK);
      // chân trang — bản 2: đếm ngược sự kiện kế tiếp; bản đầu: ngày kép
      font(x, 13, 1);
      if (fwTime()) {
        const nf = nextSolarFest(now);
        if (nf.days === 0) {
          multi(x, [['Hôm nay: ', BK], [nf.name, RED]], 200, 288);
        } else {
          multi(x, [['Còn ' + nf.days + ' ngày nữa đến ', BK],
                    [nf.name + ' (' + pad2(nf.dt.getDate()) + '/' + pad2(nf.dt.getMonth() + 1) + ')', RED]], 200, 288);
        }
      } else {
        multi(x, [[pad2(now.getDate()) + '/' + pad2(now.getMonth() + 1) + '/' + now.getFullYear(), BK],
                  ['   •   ', BK],
                  ['Âm ' + lu.day + '/' + lu.month + (lu.leap ? ' nhuận' : '') + ' ' + yName, RED]], 200, 288);
      }
      return;
    }
    // firmware cũ: giữ preview «Đếm ngược sự kiện»
    font(x, 14, v17() ? 1 : 0); x.fillStyle = BK;
    x.fillText(WD_FULL[now.getDay()] + ', ' + pad2(now.getDate()) + '/' + pad2(now.getMonth() + 1) + '/' + now.getFullYear(), 14, 30);
    battery(x, 362, 14, BK);
    line(x, 10, 44, 390, 44, BK, 2);
    const nf = nextSolarFest(now);
    font(x, 14, v17() ? 1 : 0); center(x, 'Sự kiện sắp tới', 200, 72, BK);
    font(x, 100, 1); center(x, nf.days, 200, 176, RED);
    font(x, 14, v17() ? 1 : 0); multi(x, [['ngày nữa đến ', BK], [nf.name, RED]], 200, 208);
    font(x, 13, v17() ? 1 : 0); center(x, WD_FULL[nf.dt.getDay()] + ', ' + pad2(nf.dt.getDate()) + '/' + pad2(nf.dt.getMonth() + 1) + '/' + nf.dt.getFullYear(), 200, 232, BK);
    x.strokeStyle = BK; x.lineWidth = 1.5; x.strokeRect(60, 248, 280, 14);
    if (is4c()) { x.fillStyle = YE; x.fillRect(62, 250, 276, 10); }  // BWRY: phần còn lại vàng
    x.fillStyle = RED; x.fillRect(62, 250, 276 * Math.max(0.05, Math.min(0.95, 1 - nf.days / 60)), 10);
    font(x, 12, v17() ? 1 : 0); multi(x, [['Sau đó: ', BK], ['... (thiết bị tính cả ngày lễ âm lịch)', RED]], 200, 288);
  }
  function m15(x, now) { // Hai tháng — v1.7: header đậm (nhãn tháng + hàng thứ đã đậm sẵn)
    font(x, 13, v17() ? 1 : 0);
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
      if (cur) {
        // khung 1px đều bốn cạnh (bản 2px phải/đáy đã bị user yêu cầu hoàn lại)
        x.strokeStyle = RED; x.lineWidth = 2; x.beginPath(); x.roundRect(bx - 3, by - 10, 94, 82, 4); x.stroke();
        if (is4c()) { x.strokeStyle = YE; x.lineWidth = 1.5; x.beginPath(); x.roundRect(bx - 1, by - 8, 90, 78, 3); x.stroke(); }
      }
      font(x, 10, 1); center(x, 'Tháng ' + (m + 1), bx + 44, by, cur ? RED : BK);
      const first0 = new Date(y, m, 1).getDay(), maxD = new Date(y, m + 1, 0).getDate();
      const first = (first0 + 7 - (v17() ? 1 : 0)) % 7;  // v1.7: tuần bắt đầu T2
      for (let d = 1; d <= maxD; d++) {
        const idx = first + d - 1, col = idx % 7, row = (idx - col) / 7;
        const dx = bx + col * 12.6 + 6, dy = by + 11 + row * 10;
        const wd = (first0 + d - 1) % 7;
        if (cur && d === now.getDate()) { x.fillStyle = RED; x.beginPath(); x.arc(dx, dy - 2, 5.5, 0, 7); x.fill(); }
        font(x, 7, 0);
        center(x, d, dx, dy, (cur && d === now.getDate()) ? '#fff' : ((wd === 0 || wd === 6) ? RED : BK));
      }
    }
  }
  function m17(x, now) { // Nhiệt kế — v1.7: all text bold
    font(x, 13, v17() ? 1 : 0); x.fillStyle = BK;
    x.fillText(WD_FULL[now.getDay()] + ', ' + pad2(now.getDate()) + '/' + pad2(now.getMonth() + 1) + '/' + now.getFullYear() + ' - Âm Lịch 21/5', 14, 30);
    battery(x, 362, 14, BK);
    line(x, 10, 44, 390, 44, BK, 2);
    segStr(x, 56, 62, 5.2, '28', BK);
    x.strokeStyle = BK; x.lineWidth = 3; x.beginPath(); x.arc(228, 78, 9, 0, 7); x.stroke();
    x.fillStyle = BK; x.fillRect(248, 62, 13, 104); x.fillRect(248, 62, 56, 13); x.fillRect(248, 153, 56, 13);
    x.strokeStyle = BK; x.lineWidth = 2; x.strokeRect(330, 58, 24, 106);
    if (is4c()) { x.fillStyle = YE; x.fillRect(336, 62, 12, 98); }  // BWRY: lòng ống vàng
    x.fillStyle = RED; x.fillRect(336, 86, 12, 74); x.beginPath(); x.arc(342, 178, 15, 0, 7); x.fill();
    if (is4c()) { x.strokeStyle = YE; x.lineWidth = 2.5; x.beginPath(); x.arc(342, 178, 16.5, 0, 7); x.stroke(); }
    line(x, 10, 210, 390, 210);
    font(x, 13, v17() ? 1 : 0);
    multi(x, [['Cao nhất hôm nay: ', BK], ['31°C', RED], [' - Thấp nhất: ', BK], ['24°C', RED]], 200, 236);
    segStr(x, 150, 248, 2, pad2(now.getHours()) + ':' + pad2(now.getMinutes()), BK);
  }
  function m18(x, now) { // Trăng
    font(x, 14, 0); x.fillStyle = BK;
    x.fillText(WD_FULL[now.getDay()] + ', ' + pad2(now.getDate()) + '/' + pad2(now.getMonth() + 1) + '/' + now.getFullYear(), 14, 30);
    battery(x, 362, 14, BK);
    line(x, 10, 44, 390, 44, BK, 2);
    x.fillStyle = BK; x.beginPath(); x.arc(200, 138, 62, 0, 7); x.fill();
    // BWRY: phần trăng SÁNG tô VÀNG như firmware
    x.fillStyle = is4c() ? YE : '#f0ead6'; x.beginPath(); x.arc(200, 138, 60, Math.PI / 2, Math.PI * 1.5); x.fill();
    x.beginPath(); x.ellipse(200, 138, 24, 60, 0, Math.PI / 2, Math.PI * 1.5, true); x.fill();
    x.strokeStyle = BK; x.lineWidth = 2; x.beginPath(); x.arc(200, 138, 62, 0, 7); x.stroke();
    font(x, 15, 1); multi(x, [['Âm Lịch 21/5', RED], [' - Trăng khuyết cuối tháng', BK]], 200, 236);
    font(x, 13, 0); multi(x, [['Rằm tiếp theo: ', BK], ['Âm Lịch 15/6 (28/07)', RED]], 200, 262);
    font(x, 12, 0); center(x, 'Ngày Canh Thìn - Năm Bính Ngọ', 200, 288, BK);
  }
  function m19(x, now) { // Ghi chú — v1.7: all text bold
    font(x, 14, v17() ? 1 : 0); x.fillStyle = BK;
    x.fillText(WD_FULL[now.getDay()] + ', ' + pad2(now.getDate()) + '/' + pad2(now.getMonth() + 1) + '/' + now.getFullYear() + ' - ' + pad2(now.getHours()) + ':' + pad2(now.getMinutes()), 14, 30);
    battery(x, 362, 14, BK);
    line(x, 10, 44, 390, 44, BK, 2);
    x.fillStyle = RED; x.fillRect(30, 64, 340, 30);
    x.strokeStyle = RED; x.lineWidth = 3; x.strokeRect(31, 65, 338, 168);
    if (is4c()) { x.strokeStyle = YE; x.lineWidth = 1.5; x.strokeRect(34, 68, 332, 162); }  // BWRY: khung kép đỏ-vàng
    font(x, 14, 1); center(x, 'GHI CHÚ', 200, 85, '#fff');
    font(x, 26, 1); center(x, 'Họp phụ huynh 15:00', 200, 152, BK); center(x, 'thứ Hai tuần sau!', 200, 190, BK);
    font(x, 12, v17() ? 1 : 0); multi(x, [['Âm Lịch 21/5 - Ngày Canh Thìn  -  ', BK], ['Lễ Vu Lan còn 52 ngày', RED]], 200, 266);
  }

  function m20(x, now, design) { // Tự thiết kế 1 (thẻ 22) / 2 (thẻ 23)
    if (window.renderCustomLayout) { window.renderCustomLayout(x, now, design || 0); return; }
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
    if (is4c()) {  // BWRY: mặt trời VÀNG pixel viền đen bên trái
      x.fillStyle = YE;
      x.fillRect(30, 44, 24, 6); x.fillRect(24, 50, 36, 24); x.fillRect(30, 74, 24, 6);
      x.fillStyle = BK;
      x.fillRect(30, 43, 24, 1); x.fillRect(30, 80, 24, 1); x.fillRect(23, 50, 1, 24); x.fillRect(60, 50, 1, 24);
    }
    pxMtn(x, 60, 168, 252, 6, BK); pxMtn(x, 344, 176, 252, 6, BK);
    // v1.7: chóp núi giữa ĐỎ (trước là trắng)
    pxMtn(x, 200, 128, 252, 8, BK); pxMtn(x, 200, 128, 176, 8, v17() ? RED : '#fff');
    [28, 76, 128, 236, 288, 336, 380].forEach(t => pxTree(x, t, 258, 4, BK));
    x.fillStyle = BK; x.fillRect(0, 258, 400, 1);
    x.fillStyle = RED; x.fillRect(0, 266, 400, 34);
    x.fillStyle = BK;
    for (let yy = 278; yy < 300; yy += 12) x.fillRect(0, yy, 400, 1);
    for (let xx = 0; xx < 400; xx += 40) { x.fillRect(xx + 8, 266, 1, 12); x.fillRect(xx + 28, 278, 1, 12); }
    x.fillStyle = '#fff'; for (let xx = 12; xx < 400; xx += 56) x.fillRect(xx, 260, 24, 8);
    x.fillStyle = '#fff'; x.fillRect(104, 22, 192, 100);
    x.strokeStyle = BK; x.lineWidth = 1; x.strokeRect(104.5, 22.5, 192, 100); x.strokeRect(108.5, 26.5, 184, 92);
    font(x, 13, v17() ? 1 : 0); center(x, WD_FULL[now.getDay()], 200, 50, RED);
    pxDate.col = BK; pxDate.dot = RED; pxDate(x, 200 - 68, 56, now, 8);
    font(x, 12, v17() ? 1 : 0); center(x, now.getFullYear() + ' - ÂL 15/6', 200, 114, BK);
    pxHearts(x, 8, 20, 3, 2);
    font(x, 12, v17() ? 1 : 0); x.textAlign = 'right'; x.fillStyle = BK; x.fillText('32°C', 390, 34); x.textAlign = 'left';
  }
  function m22(x, now) { // Hoàng hôn 8-bit
    x.fillStyle = BK; x.fillRect(0, 0, 400, 156);
    x.fillStyle = '#fff'; x.fillRect(0, 118, 400, 4); x.fillRect(0, 140, 400, 3);
    // v1.7: mây trái hạ xuống né cụm pin 3 tim (16→40)
    const cy22 = v17() ? 24 : 0;
    x.fillRect(24, 24 + cy22, 40, 8); x.fillRect(32, 16 + cy22, 20, 8);
    x.fillRect(318, 36, 30, 6); x.fillRect(324, 30, 15, 6);
    if (is4c()) {  // BWRY: trăng VÀNG pixel trên trời đêm
      x.fillStyle = YE;
      x.fillRect(42, 58, 24, 6); x.fillRect(36, 64, 36, 24); x.fillRect(42, 88, 24, 6);
    }
    x.fillStyle = '#fff'; x.fillRect(96, 20, 208, 92);
    x.strokeStyle = BK; x.strokeRect(96.5, 20.5, 208, 92); x.strokeRect(100.5, 24.5, 200, 84);
    pxTime(x, 200 - 76, 32, now, 9, BK);
    font(x, 11, v17() ? 1 : 0); center(x, pad2(now.getDate()) + '/' + pad2(now.getMonth() + 1) + ' - ÂL 15/6 - 32°C', 200, 104, BK);
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
    // mặt trời pixel — BWRY: vành đỏ lõi VÀNG (hoàng hôn) + mây + chim
    x.fillStyle = RED; x.fillRect(330, 44, 24, 6); x.fillRect(324, 50, 36, 24); x.fillRect(330, 74, 24, 6);
    if (is4c()) { x.fillStyle = YE; x.fillRect(330, 54, 24, 16); }
    cloud(56, 54); cloud(172, 38);
    x.fillStyle = BK;
    const PT = [0x10, 0x18, 0xFE, 0x3C, 0x10];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 8; c++)
      if (PT[r] & (0x80 >> c)) x.fillRect(248 + c * 4, 180 + r * 4, 4, 4);
    // màn "game over": thứ giãn cách ký tự — v1.7 nhấc thứ + ngày lên 6px
    const dy23 = v17() ? -6 : 0;
    font(x, 22, 1); center(x, WD_FULL[now.getDay()].split('').join(' '), 200, 116 + dy23, BK);
    font(x, 12, 0); center(x, 'Tháng ' + (now.getMonth() + 1) + ' - ' + now.getFullYear() + ' · ÂL 15/6', 200, 140 + dy23, BK);
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
  function m24(x, now) { // Thành phố pixel — v1.7: bold + 2 đĩa bay đèn đỏ
    pxTime(x, 200 - 102, 24, now, 12, BK);
    x.fillStyle = '#fff'; x.fillRect(116, 102, 168, 40);
    x.strokeStyle = BK; x.strokeRect(116.5, 102.5, 168, 40); x.strokeRect(119.5, 105.5, 162, 34);
    font(x, 13, v17() ? 1 : 0); center(x, pad2(now.getDate()) + '-' + pad2(now.getMonth() + 1) + '-' + now.getFullYear(), 200, 128, BK);
    font(x, 12, v17() ? 1 : 0); center(x, 'Âm lịch 15/6', 200, 162, BK);
    if (v17()) {  // 2 đĩa bay đen + 3 đèn đỏ dưới bụng (khớp firmware retro_ufo)
      const ufo = (X, Y, s) => {
        x.fillStyle = BK;
        x.fillRect(X + 2 * s, Y, 4 * s, s); x.fillRect(X + s, Y + s, 6 * s, s);
        x.fillRect(X, Y + 2 * s, 8 * s, s); x.fillRect(X + s, Y + 3 * s, 6 * s, s);
        x.fillStyle = RED;
        for (let i = 0; i < 3; i++) x.fillRect(X + s + i * 2 * s, Y + 4 * s, s, s);
      };
      ufo(36, 48, 4); ufo(324, 56, 3);
    }
    const bh = [36, 58, 44, 70, 30, 62, 50, 74, 40, 56, 66, 34, 48];
    for (let i = 0; i < 13; i++) {
      const bx = i * 31, top = 244 - bh[i];
      x.fillStyle = BK; x.fillRect(bx, top, 28, bh[i]);
      for (let wy = top + 6; wy < 238; wy += 10) {
        for (let wx = 5; wx <= 21; wx += 8) {
          // BWRY: xen kẽ cửa sổ VÀNG «sáng đèn» — cùng công thức firmware
          x.fillStyle = (is4c() && (((wx >> 3) + ((wy / 10) | 0) + i) & 1)) ? YE : '#fff';
          x.fillRect(bx + wx, wy, 4, 4);
        }
      }
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


  /* ---- mode 25: «HUD» (buồng lái) ---------------------------------------
   * Vẽ lại ĐÚNG như DrawHud của firmware: bộ chữ khối 5x7 + dấu tiếng Việt vẽ
   * chồng, số 7 đoạn hai đầu VÁT 45°, hai panel viền dày vát góc, nhãn cắm
   * chìm vào viền. Không dùng font của trình duyệt chỗ nào cả — có thế hình
   * xem trước mới khớp máy thật. */
  const HF = {
    'A':[0x7E,0x11,0x11,0x11,0x7E],'B':[0x7F,0x49,0x49,0x49,0x36],'C':[0x3E,0x41,0x41,0x41,0x22],
    'D':[0x7F,0x41,0x41,0x22,0x1C],'E':[0x7F,0x49,0x49,0x49,0x41],'F':[0x7F,0x09,0x09,0x09,0x01],
    'G':[0x3E,0x41,0x49,0x49,0x7A],'H':[0x7F,0x08,0x08,0x08,0x7F],'I':[0x00,0x41,0x7F,0x41,0x00],
    'J':[0x20,0x40,0x41,0x3F,0x01],'K':[0x7F,0x08,0x14,0x22,0x41],'L':[0x7F,0x40,0x40,0x40,0x40],
    'M':[0x7F,0x02,0x0C,0x02,0x7F],'N':[0x7F,0x04,0x08,0x10,0x7F],'O':[0x3E,0x41,0x41,0x41,0x3E],
    'P':[0x7F,0x09,0x09,0x09,0x06],'Q':[0x3E,0x41,0x51,0x21,0x5E],'R':[0x7F,0x09,0x19,0x29,0x46],
    'S':[0x46,0x49,0x49,0x49,0x31],'T':[0x01,0x01,0x7F,0x01,0x01],'U':[0x3F,0x40,0x40,0x40,0x3F],
    'V':[0x1F,0x20,0x40,0x20,0x1F],'W':[0x3F,0x40,0x38,0x40,0x3F],'X':[0x63,0x14,0x08,0x14,0x63],
    'Y':[0x07,0x08,0x70,0x08,0x07],'Z':[0x61,0x51,0x49,0x45,0x43],
    '0':[0x3E,0x51,0x49,0x45,0x3E],'1':[0x00,0x42,0x7F,0x40,0x00],'2':[0x42,0x61,0x51,0x49,0x46],
    '3':[0x21,0x41,0x45,0x4B,0x31],'4':[0x18,0x14,0x12,0x7F,0x10],'5':[0x27,0x45,0x45,0x45,0x39],
    '6':[0x3C,0x4A,0x49,0x49,0x30],'7':[0x01,0x71,0x09,0x05,0x03],'8':[0x36,0x49,0x49,0x49,0x36],
    '9':[0x06,0x49,0x49,0x29,0x1E],'/':[0x20,0x10,0x08,0x04,0x02],'-':[0x08,0x08,0x08,0x08,0x08],
    '_':[0x40,0x40,0x40,0x40,0x40],':':[0x00,0x36,0x36,0x00,0x00],'~':[0x00,0x07,0x05,0x07,0x00],
    '.':[0x00,0x60,0x60,0x00,0x00],
    ' ':[0,0,0,0,0]
  };
  const H_AC = 1, H_HK = 4, H_DOT = 16, H_CIRC = 32, H_BREVE = 64, H_HORN = 128;
  const HWD = ['CHU NHAT','THU HAI','THU BA','THU TU','THU NAM','THU SAU','THU BAY'];
  const HWM = [
    [0,0,H_HK,0,0,0,H_CIRC|H_DOT,0], [0,0,H_HORN|H_AC,0,0,0,0,0], [0,0,H_HORN|H_AC,0,0,0,0,0],
    [0,0,H_HORN|H_AC,0,0,H_HORN,0,0], [0,0,H_HORN|H_AC,0,0,H_BREVE,0,0],
    [0,0,H_HORN|H_AC,0,0,H_AC,0,0], [0,0,H_HORN|H_AC,0,0,H_HK,0,0]
  ];
  function hGlyph(x, ch, mk, px, py, s, col) {
    const d = HF[(ch || ' ').toUpperCase()] || HF[' '];
    x.fillStyle = col;
    for (let c = 0; c < 5; c++) for (let r = 0; r < 7; r++)
      if (d[c] & (1 << r)) x.fillRect(px + c*s, py + r*s, s, s);
    if (!mk) return;
    const top = py - 2*s;
    if (mk & H_CIRC)  { x.fillRect(px+s,top,s,s); x.fillRect(px+3*s,top,s,s); x.fillRect(px+2*s,top-s,s,s); }
    if (mk & H_BREVE) { x.fillRect(px+s,top-s,s,s); x.fillRect(px+3*s,top-s,s,s); x.fillRect(px+2*s,top,s,s); }
    if (mk & H_HORN)  { x.fillRect(px+5*s,py-s,s,s); x.fillRect(px+5*s,py,s,s); }
    const my = (mk & (H_CIRC|H_BREVE)) ? top - 2*s : top;
    if (mk & H_AC)  { x.fillRect(px+3*s,my-s,s,s); x.fillRect(px+2*s,my,s,s); }
    if (mk & H_HK)  { x.fillRect(px+2*s,my-s,s,s); x.fillRect(px+3*s,my-s,s,s); x.fillRect(px+3*s,my,s,s); }
    if (mk & H_DOT) x.fillRect(px+2*s, py+8*s, s, s);
  }
  const hW = (n, s) => n*6*s - s;
  function hText(x, t, mk, px, py, s, col) {
    for (let i = 0; i < t.length; i++) hGlyph(x, t[i], mk ? mk[i] : 0, px + i*6*s, py, s, col);
  }
  function hTextC(x, t, mk, cx, py, s, col) { hText(x, t, mk, cx - hW(t.length, s)/2, py, s, col); }

  const HSEG = {'0':0x3F,'1':0x06,'2':0x5B,'3':0x4F,'4':0x66,'5':0x6D,'6':0x7D,'7':0x07,'8':0x7F,'9':0x6F};
  function hSegH(x, px, py, w, t, col) {
    x.fillStyle = col; x.beginPath();
    x.moveTo(px, py+t/2); x.lineTo(px+t/2, py); x.lineTo(px+w-t/2, py);
    x.lineTo(px+w, py+t/2); x.lineTo(px+w-t/2, py+t); x.lineTo(px+t/2, py+t);
    x.closePath(); x.fill();
  }
  function hSegV(x, px, py, h, t, col) {
    x.fillStyle = col; x.beginPath();
    x.moveTo(px+t/2, py); x.lineTo(px+t, py+t/2); x.lineTo(px+t, py+h-t/2);
    x.lineTo(px+t/2, py+h); x.lineTo(px, py+h-t/2); x.lineTo(px, py+t/2);
    x.closePath(); x.fill();
  }
  function hDigit(x, ch, px, py, w, h, t, col) {
    const m = HSEG[ch] || 0, q = Math.max(1, t*0.16);
    const mid = py + (h-t)/2, hv = (h-t)/2 + t - 2*q;
    if (m & 1)  hSegH(x, px+q, py, w-2*q, t, col);
    if (m & 64) hSegH(x, px+q, mid, w-2*q, t, col);
    if (m & 8)  hSegH(x, px+q, py+h-t, w-2*q, t, col);
    if (m & 32) hSegV(x, px, py+q, hv, t, col);
    if (m & 2)  hSegV(x, px+w-t, py+q, hv, t, col);
    if (m & 16) hSegV(x, px, mid+q, hv, t, col);
    if (m & 4)  hSegV(x, px+w-t, mid+q, hv, t, col);
  }
  function hNum2(x, v, px, py, w, h, t, gap, col) {
    const s = ('0' + v).slice(-2);
    hDigit(x, s[0], px, py, w, h, t, col);
    hDigit(x, s[1], px + w + gap, py, w, h, t, col);
  }
  function hOct(x, x0, y0, x1, y1, k, col) {
    x.fillStyle = col; x.beginPath();
    x.moveTo(x0+k, y0); x.lineTo(x1-k, y0); x.lineTo(x1, y0+k); x.lineTo(x1, y1-k);
    x.lineTo(x1-k, y1); x.lineTo(x0+k, y1); x.lineTo(x0, y1-k); x.lineTo(x0, y0+k);
    x.closePath(); x.fill();
  }
  function hPanel(x, x0, y0, x1, y1, k, t, inner) {
    hOct(x, x0, y0, x1, y1, k, BK);
    hOct(x, x0+t, y0+t, x1-t, y1-t, k-t, WH);
    if (inner) {
      const a = t + inner;
      hOct(x, x0+a, y0+a, x1-a, y1-a, k-a, BK);
      hOct(x, x0+a+1, y0+a+1, x1-a-1, y1-a-1, k-a-1, WH);
    }
  }
  function hSlot(x, px, py, w, h, t) {
    const k = h/2;
    x.fillStyle = BK; x.beginPath();
    x.moveTo(px+k, py); x.lineTo(px+w-k, py); x.lineTo(px+w, py+h); x.lineTo(px, py+h);
    x.closePath(); x.fill();
    x.fillStyle = RED; x.fillRect(px+k+2, py+(h-3)/2, 3, 3);
    hText(x, t, null, px+k+8, py+(h-7)/2, 1, WH);
  }
  function hCorner(x, cx, cy, len, sy) {
    x.fillStyle = BK;
    x.fillRect(cx-len, cy, len, 4);
    x.fillRect(cx-4, sy > 0 ? cy : cy-len, 4, len);
    x.fillStyle = RED;
    x.fillRect(cx-len+5, sy > 0 ? cy+7 : cy-10, len-12, 3);
    x.fillRect(cx-10, sy > 0 ? cy+7 : cy-len+5, 3, len-12);
  }
  function hArrow(x, cx, y, half, h, col) {
    x.fillStyle = col; x.beginPath();
    x.moveTo(cx-half, y); x.lineTo(cx+half, y); x.lineTo(cx, y+h);
    x.closePath(); x.fill();
  }

  function m25(x, now) {
    const W = 400, dy = 38, dh = 80, dw = 44, dt = 15, dgap = 11, cmid = 26;
    const grp = (2*dw + dgap)*2 + cmid, gx = (W - grp)/2, py = 226;
    const dev = ((typeof bleDevice !== 'undefined' && bleDevice && bleDevice.name) || 'DIY-4_2').toUpperCase();
    hPanel(x, 4, 4, W-4, 208, 18, 4, 4);
    { const tw = hW(dev.length, 1) + 26, tx = (W - tw)/2;
      x.fillStyle = WH; x.fillRect(tx, 2, tw, 12); hSlot(x, tx, 2, tw, 11, dev); }
    for (let i = 0; i < 5; i++) {
      x.fillStyle = (i === 1) ? RED : BK;
      x.fillRect(14, 52 + i*13, i === 1 ? 9 : 6, 3);
    }
    hCorner(x, W-14, 26, 30, 1);
    hCorner(x, W-14, 122, 30, -1);
    hNum2(x, now.getHours(), gx, dy, dw, dh, dt, dgap, RED);
    hNum2(x, now.getMinutes(), gx + 2*dw + dgap + cmid, dy, dw, dh, dt, dgap, BK);
    x.fillStyle = BK;
    for (let i = 40; i < W-40; i += 10) x.fillRect(i, 136, Math.min(5, W-40-i), 2);
    hTextC(x, HWD[now.getDay()], HWM[now.getDay()], W/2, 148, 3, BK);
    { const ds = now.getDate() + '/' + pad2(now.getMonth()+1) + '/' + now.getFullYear(), al = '27/6 AL';
      const w1 = hW(ds.length, 2), w2 = hW(al.length, 2), x0 = (W - (w1 + 12 + w2))/2;
      hText(x, ds, null, x0, 178, 2, BK);
      hText(x, al, null, x0 + w1 + 12, 178, 2, RED); }
    x.fillStyle = WH; x.fillRect(20, 200, 86, 8); x.fillRect(W-106, 200, 86, 8);
    hSlot(x, 20, 198, 86, 12, 'BATT 3.2V');
    hSlot(x, W-106, 198, 86, 12, 'TEMP 28~C');
    hPanel(x, 4, py, W-4, 296, 14, 4, 0);
    { const t = 'WEEK 21', tw = hW(t.length, 1) + 26;
      x.fillStyle = WH; x.fillRect(18, py-2, tw, 8); hSlot(x, 18, py-7, tw, 12, t); }
    const wd = (now.getDay() + 6) % 7;
    for (let i = 0; i < 7; i++) {
      const d = new Date(now); d.setDate(now.getDate() + (i - wd));
      const cx = 16 + i*53, cc = cx + 24, col = (i >= 5) ? RED : BK;
      hTextC(x, ['T2','T3','T4','T5','T6','T7','CN'][i], null, cc, 234, 1, col);
      hNum2(x, d.getDate(), cx + 4, 245, 17, 30, 4, 6, col);
      hNum2(x, ((d.getDate() + 27) % 30) + 1, cx + 13, 278, 9, 12, 2, 4, col);
      if (i) { x.fillStyle = BK; for (let j = 234; j < 292; j += 8) x.fillRect(cx-4, j, 1, Math.min(4, 292-j)); }
      if (i === wd) {
        hArrow(x, cc, py-1, 10, 11, WH);
        hArrow(x, cc, py, 7, 7, (i >= 5) ? BK : RED);
      }
    }
  }

  const MODE_LIST = [
    { mode: 1, name: 'Lịch tháng', tick: 'Cập nhật lúc 0h', id: 'calendarmodebutton', draw: m1 },
    { mode: 2, name: 'Đồng hồ + Lịch', tick: 'Làm mới mỗi phút', id: 'combomodebutton', draw: m3 },
    { mode: 3, name: 'Lịch để bàn (đỏ)', tick: 'Làm mới mỗi phút', id: 'redcombomodebutton', draw: m4 },
    { mode: 4, name: 'Lịch VN (Can Chi)', tick: 'Cập nhật lúc 0h', id: 'vncalendarmodebutton', draw: m5 },
    { mode: 5, name: 'Đồng hồ số', tick: 'Làm mới mỗi phút', id: 'digitalmodebutton', draw: m6 },
    { mode: 6, name: 'Đồng hồ kim', tick: 'Làm mới mỗi phút', id: 'analogmodebutton', draw: m7 },
    { mode: 7, name: 'Lịch bloc', tick: 'Cập nhật lúc 0h', id: 'dayblocmodebutton', draw: m8 },
    { mode: 8, name: 'Lịch tuần', tick: 'Làm mới mỗi phút', id: 'weekmodebutton', draw: m9 },
    { mode: 9, name: 'Giờ + lịch tháng', tick: 'Làm mới mỗi phút', id: 'digitalcalmodebutton', draw: m10 },
    { mode: 10, name: 'Kim + thẻ ngày', tick: 'Làm mới mỗi phút', id: 'analogdaymodebutton', draw: m11 },
    { mode: 11, name: 'Tối giản', tick: 'Cập nhật lúc 0h', id: 'minimalmodebutton', draw: m12 },
    { mode: 12, name: 'Lịch vạn niên', tick: 'Cập nhật lúc 0h', id: 'vanniemodebutton', draw: m13 },
    { mode: 13, name: 'Lịch dương + âm', nameNew: 'Lịch dương + âm', tick: 'Cập nhật lúc 0h', tickNew: 'Làm mới mỗi phút', id: 'countdownmodebutton', draw: m14 },
    { mode: 14, name: 'Hai tháng', tick: 'Cập nhật lúc 0h', id: 'twomonthmodebutton', draw: m15 },
    { mode: 15, name: 'Lịch cả năm', tick: 'Cập nhật lúc 0h', id: 'yearmodebutton', draw: m16 },
    { mode: 16, name: 'Nhiệt kế', tick: 'Làm mới mỗi phút', id: 'thermomodebutton', draw: m17 },
    { mode: 17, name: 'Ghi chú', tick: 'Làm mới mỗi phút', id: 'notemodebutton', draw: m19 },
    { mode: 18, name: 'Núi tuyết 8-bit', tick: 'Cập nhật lúc 0h', id: 'retromtnmodebutton', draw: m21 },
    { mode: 19, name: 'Hoàng hôn 8-bit', tick: 'Làm mới mỗi phút', id: 'retrosunsetmodebutton', draw: m22 },
    { mode: 20, name: 'Khủng long 8-bit', tick: 'Cập nhật lúc 0h', id: 'retrowinmodebutton', draw: m23 },
    { mode: 21, name: 'Thành phố 8-bit', tick: 'Làm mới mỗi phút', id: 'retrocitymodebutton', draw: m24 },
    { mode: 22, name: 'Tự thiết kế 1', tick: 'Làm mới mỗi phút', id: 'custommodebutton', draw: (x, n) => m20(x, n, 0) },
    { mode: 23, name: 'Tự thiết kế 2', tick: 'Làm mới mỗi phút', id: 'custommodebutton2', draw: (x, n) => m20(x, n, 1) },
    // thẻ 24 vẽ bằng CHÍNH hàm dựng bảng của js/4_2/timetable.js nên thẻ luôn
    // khớp bảng người dùng đang gõ (không có bảng thì nó vẽ màn hướng dẫn)
    { mode: 24, name: 'Thời khóa biểu', tick: 'Cập nhật lúc 0h', id: 'timetablemodebutton',
      draw: (x, n) => { if (window.ttRenderPreview) window.ttRenderPreview(x, n, is4c()); } },
    { mode: 25, name: 'HUD buồng lái', tick: 'Làm mới mỗi phút', id: 'hudmodebutton', draw: m25 },
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
        '<div class="mode-name">' + ((m.nameNew && fwCal()) ? m.nameNew : m.name) + '</div>' +
        '<div class="mode-tick">' + ((m.tickNew && fwTime()) ? m.tickNew : m.tick) + '</div>' +
        '<button id="' + m.id + '" type="button" class="primary" onclick="syncTime(' + m.mode + ')">Áp dụng</button>';
      gallery.appendChild(card);
      // mode 2 + 18 đã bỏ ở firmware v1.7: ẩn card khi thiết bị khai fw >= 1.7
      // mode 2+18 bỏ ở v1.7; 21+22 (Núi tuyết, Hoàng hôn) bỏ ở v2.4 lấy RAM
      // Máy chạy firmware TRƯỚC đợt đánh lại số (BWR < 2.6 / 4 màu < 3.6) thì
      // hai thẻ «Núi tuyết»/«Hoàng hôn» chỉ có ở bản 4 màu — bản 3 màu đời đó
      // đã gỡ. Firmware mới có đủ ở cả hai bản nên không ẩn nữa.
      if (cardHidden(m.mode)) card.style.display = 'none';
      try { m.draw(ctx2d(card.querySelector('canvas')), now); }
      catch (e) { console.error('preview mode ' + m.mode, e); }
    }
    // redraw thumbnails each minute so the clock previews stay current
    setInterval(window.refreshModeGallery, 60000);
  }

  // vẽ lại toàn bộ thumbnail — updateDitcherOptions (main.js) gọi khi đổi
  // driver để bật/tắt các điểm nhấn VÀNG của màn 4 màu (driver 05/06)
  /* Thẻ nào PHẢI ẨN với firmware đang kết nối — MỘT quy tắc duy nhất, dùng
   * cho cả lượt dựng thẻ lẫn lượt vẽ lại mỗi phút. Trước đây hai chỗ có hai
   * bộ luật riêng, mà bộ ở refreshModeGallery vẫn đánh theo SỐ MODE ĐỜI CŨ
   * (2 = Đồng hồ, 18 = Mặt trăng — hai mode đã bỏ ở v1.7). Sau khi đánh lại
   * số, 18 là «Núi tuyết 8-bit» nên cứ kết nối vào là thẻ đó BIẾN MẤT, còn
   * «Tự thiết kế 2» thì hiện ra cả trên máy chưa hỗ trợ. */
  function cardHidden(mode) {
    // Núi tuyết + Hoàng hôn: bản BA MÀU gỡ ở v2.3, thêm lại ở v2.6
    if (window.__fwNoRetro && (mode === 18 || mode === 19)) return true;
    // «Tự thiết kế 2» chỉ có từ BWR v2.7 / 4 màu v3.7
    if (mode === 23 && !(typeof fwHasNewSlots === 'function' && fwHasNewSlots())) return true;
    // «Thời khóa biểu» chỉ có từ BWR v2.5 / 4 màu v3.6
    if (mode === 24 && !window.__fwTKB) return true;
    // «HUD» mới có ở BWR v2.7 (bản bốn màu chưa port)
    if (mode === 25 && !window.__fwHud) return true;
    return false;
  }

  window.refreshModeGallery = function () {
    const t = new Date();
    document.querySelectorAll('.mode-card').forEach((card, i) => {
      if (MODE_LIST[i]) {
        card.style.display = cardHidden(MODE_LIST[i].mode) ? 'none' : '';
        // tên card đổi theo firmware (vd card 13: Đếm ngược -> Lịch dương + âm)
        const nEl = card.querySelector('.mode-name');
        const nTxt = (MODE_LIST[i].nameNew && fwCal()) ? MODE_LIST[i].nameNew : MODE_LIST[i].name;
        if (nEl && nEl.textContent !== nTxt) nEl.textContent = nTxt;
        const tEl = card.querySelector('.mode-tick');
        const tTxt = (MODE_LIST[i].tickNew && fwTime()) ? MODE_LIST[i].tickNew : MODE_LIST[i].tick;
        if (tEl && tEl.textContent !== tTxt) tEl.textContent = tTxt;
        try { MODE_LIST[i].draw(ctx2d(card.querySelector('canvas')), t); }
        catch (e) { console.error('preview mode ' + MODE_LIST[i].mode, e); }
      }
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
