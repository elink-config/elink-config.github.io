/* HỒ SƠ MÁY 7.5" 800×480 trên bo nRF52811 (DIY-7_5N).
 *
 * Nạp NGAY SAU js/7_5/profile.gen.js (hồ sơ của bản DA14585): máy N chạy
 * CÙNG bộ giao diện + tính năng, nên chỉ đè khổ màn và khai thêm một dòng máy
 * với ĐÚNG các mốc phiên bản của dòng «bwr». Firmware N đánh số theo bản
 * DA14585 mà nó được port từ (v1.3 = cùng tính năng với DA14585 v1.3).
 * Phải nạp TRƯỚC js/common/designer.js — designer đọc khổ màn ngay lúc nạp. */
(function () {
  const P = window.EPD_PROFILE;
  if (!P) return;
  P.rong = 800;
  P.cao = 480;
  P.dongMay.bwrN = { tenBle: 'DIY-7_5N-', soMau: 3 };
  for (const k of Object.keys(P.cong)) {
    if (P.cong[k].bwr) P.cong[k].bwrN = P.cong[k].bwr;
  }
  for (const k of Object.keys(P.anTheTrongKhoang || {})) {
    if (P.anTheTrongKhoang[k].bwr) P.anTheTrongKhoang[k].bwrN = P.anTheTrongKhoang[k].bwr;
  }
})();
