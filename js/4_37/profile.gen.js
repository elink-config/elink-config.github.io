/* ===== FILE NAY DUOC SINH RA TU DONG — DUNG SUA BANG TAY =====
 * Nguon: tools/profile/4_37.json  |  Sinh lai: python tools/profile/gen.py 4_37
 */
window.EPD_PROFILE = {
  may: '4_37',
  rong: 480, cao: 176,
  dongMay: {
    bwr: { tenBle: 'DIY-4_37-', soMau: 3 },
  },
  cong: {
    'danh_lai_so_mode': { bwr: '1.0' },  // may moi hoan toan, khong co ban cu
    'khe_anh': { bwr: '1.0' },  // 3 khe anh THO + 1 khe nen NEN
    '6_o_chu': { bwr: '1.0' },
    'anh_nen_thiet_ke': { bwr: '1.0' },
    'hien_khe_anh': { bwr: '1.0' },
  },
  anTheTrongKhoang: {
  },
  soKhe: 3,
  soThietKe: 1,
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
