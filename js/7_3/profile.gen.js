/* ===== FILE NAY DUOC SINH RA TU DONG — DUNG SUA BANG TAY =====
 * Nguon: tools/profile/7_3.json  |  Sinh lai: python tools/profile/gen.py 7_3
 */
window.EPD_PROFILE = {
  may: '7_3',
  rong: 800, cao: 480,
  dongMay: {
    e6: { tenBle: 'DIY-7_3-', soMau: 6 },
  },
  cong: {
    'khoi_phuc_goc': { e6: '2.4' },  // lenh 0x2F, co tu v2.4 (ban gop) khi may chuyen sang epd_common
  },
  anTheTrongKhoang: {
  },
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
