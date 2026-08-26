/* ===== FILE NAY DUOC SINH RA TU DONG — DUNG SUA BANG TAY =====
 * Nguon: tools/profile/7_5.json  |  Sinh lai: python tools/profile/gen.py 7_5
 */
window.EPD_PROFILE = {
  may: '7_5',
  rong: 640, cao: 384,
  dongMay: {
    bwr: { tenBle: 'DIY-7_5V-', soMau: 3 },
  },
  cong: {
    'danh_lai_so_mode': { bwr: '1.0' },  // may nay CHUA BAN nen khong co ban cu ngoai thi truong
    'khe_anh': { bwr: '1.0' },  // 3 khe anh THO + 1 khe nen NEN cua «Tu thiet ke»
    '6_o_chu': { bwr: '1.0' },
    'co_tu_do': { bwr: '1.0' },
    'anh_nen_thiet_ke': { bwr: '1.0' },
    'icon_hai_mat': { bwr: '1.0' },
    'dinh_dang_gio': { bwr: '1.0' },
    'khoi_phuc_goc': { bwr: '1.0' },  // lenh 0x2F
    'hien_khe_anh': { bwr: '1.0' },  // lenh 0x27 05
    'chu_ky_phut': { bwr: '1.0' },  // 15/30/45 phut
    'thoi_khoa_bieu': { bwr: '1.0' },  // lenh 0x2D
  },
  anTheTrongKhoang: {
  },
  soKhe: 3,
  soThietKe: 1,
  modeNew2Old: { 2: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 8, 8: 9, 9: 10, 10: 11, 11: 12, 12: 13, 13: 14, 14: 15, 15: 16, 16: 17, 17: 21, 18: 22, 19: 23, 20: 24, 21: 19, 22: 20 },
};

/* Tra cuu mot cong cho THIET BI DANG KET NOI.
 *   EpdProf.co('thoi_khoa_bieu')  -> true/false
 * Tu chon dong may theo TEN BLE, va tra false khi may chua khai phien ban
 * (FwCheck.atLeast doi deviceVer != null) — mac dinh AN TOAN la an tinh nang. */
window.EpdProf = {
  dongMay(name) {
    const P = window.EPD_PROFILE;
    for (const k of Object.keys(P.dongMay))
      if (name && name.indexOf(P.dongMay[k].tenBle) === 0) return k;
    return null;
  },
  co(ten, name) {
    const P = window.EPD_PROFILE;
    const dm = this.dongMay(name !== undefined ? name : (window.bleDeviceName || ''));
    if (!dm) return false;
    const g = P.cong[ten];
    if (!g) { console.error('EpdProf: khong co cong "' + ten + '"'); return false; }
    const nguong = g[dm];
    return nguong ? FwCheck.atLeast(nguong) : false;   // null = dong may nay khong co
  },
  trongKhoang(ten, name) {
    const P = window.EPD_PROFILE;
    const dm = this.dongMay(name !== undefined ? name : (window.bleDeviceName || ''));
    const r = dm && P.anTheTrongKhoang[ten] && P.anTheTrongKhoang[ten][dm];
    return !!r && FwCheck.atLeast(r[0]) && !FwCheck.atLeast(r[1]);
  },
};
