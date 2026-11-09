/* HỒ SƠ MÁY 7.5" 800×480 trên bo nRF52811 (DIY-7_5N).
 *
 * Nạp NGAY SAU js/7_5/profile.gen.js (hồ sơ của bản DA14585): máy N chạy
 * CÙNG bộ giao diện + tính năng, chỉ đè khổ màn và khai thêm một dòng máy.
 *
 * ĐÁNH SỐ RIÊNG (từ 1.0, 09/11/2026): mọi bản firmware của máy N đều có
 * ĐỦ các «cổng» của bản DA14585 mà nó port từ (khe ảnh, thời khoá biểu, bỏ
 * «Thành phố 8-bit»...), nên mọi cổng của dòng bwrN mở từ 0.1 — KHÔNG chép
 * mốc của dòng bwr (mốc «1.1» bên đó sẽ hiện nhầm thẻ «Thành phố 8-bit» ở máy
 * N đang chạy 1.0). Cổng nào sau này chỉ có từ một bản N cụ thể thì ghi đè
 * riêng ở đây.
 * Phải nạp TRƯỚC js/common/designer.js — designer đọc khổ màn ngay lúc nạp. */
(function () {
  const P = window.EPD_PROFILE;
  if (!P) return;
  P.rong = 800;
  P.cao = 480;
  P.dongMay.bwrN = { tenBle: 'DIY-7_5N-', soMau: 3 };
  for (const k of Object.keys(P.cong)) {
    if (P.cong[k].bwr) P.cong[k].bwrN = '0.1';
  }
  for (const k of Object.keys(P.anTheTrongKhoang || {})) {
    if (P.anTheTrongKhoang[k].bwr) P.anTheTrongKhoang[k].bwrN = P.anTheTrongKhoang[k].bwr;
  }
})();
