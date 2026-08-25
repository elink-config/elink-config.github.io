/*
 * ÂM LỊCH VIỆT NAM — bản DÙNG CHUNG.
 *
 * Chép nguyên từ js/family_hm.js (thuật toán Hồ Ngọc Đức, múi giờ UTC+7). Các
 * app họ EPD (4.2", 7.5", 2.13" v2.x…) KHÔNG nạp family_hm.js nên trước đây
 * gọi lunarToday() là ném ReferenceError; thư viện thẻ xem trước bắt lỗi rồi
 * âm thầm hiện ngày dương thay cho ngày âm — sai mà không có dấu hiệu gì.
 *
 * ⚠ Đây là BẢN SAO, không phải bản gốc. Sửa công thức thì phải sửa CẢ HAI chỗ,
 * hoặc bỏ hẳn bản trong family_hm.js đi — nhưng file đó đang chạy cho máy
 * 2.13" đời cũ và 2.9" ngoài thị trường nên lần này không đụng vào.
 *
 * Trả về { year, month, day }; bit 7 của month = tháng NHUẬN (month & 0x7f để
 * lấy số tháng thật).
 */
if (typeof window.lunarToday !== 'function') {
  window.lunarToday =
  function (now) {
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
      const deltat = (T < -11)
        ? 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3
        : -0.000278 + 0.000265 * T + 0.000262 * T2;
      return Jd1 + C1 - deltat;
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
      if (diff >= lo) { lunarMonth = diff + 10; if (diff === lo) leap = 128; }
    }
    if (lunarMonth > 12) lunarMonth -= 12;
    if (lunarMonth >= 11 && diff < 4) lunarYear -= 1;
    return { year: lunarYear, month: lunarMonth + leap, day: dayNumber - monthStart + 1 };
  };
}
