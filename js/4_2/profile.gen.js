/* ===== FILE NAY DUOC SINH RA TU DONG — DUNG SUA BANG TAY =====
 * Nguon: tools/profile/4_2.json  |  Sinh lai: python tools/profile/gen.py 4_2
 */
window.EPD_PROFILE = {
  may: '4_2',
  rong: 400, cao: 300,
  dongMay: {
    bwr: { tenBle: 'DIY-4_2-', soMau: 3 },
    bwry: { tenBle: 'DIY-4_2C-', soMau: 4 },
  },
  cong: {
    'danh_lai_so_mode': { bwr: '2.4', bwry: '3.5' },  // so the gallery = so mode; may cu can bang quy doi
    '5_khe_anh': { bwr: '2.4', bwry: '3.5' },  // 5 khe anh + 2 khe nen rieng cua hai «Tu thiet ke»
    '6_o_chu': { bwr: '2.4', bwry: '3.5' },  // «Chu 3..6» + thanh phan Thu / Ngay duong; bo cuc 350B, gui chia manh
    'lich_duong_am': { bwr: '2.0', bwry: '2.9' },  // the 13 doi ten «Dem nguoc» -> «Lich duong + am»
    'dinh_dang_gio': { bwr: '2.1', bwry: '3.0' },
    'anh_nen_thiet_ke': { bwr: '2.3', bwry: '3.4' },
    'icon_hai_mat': { bwr: '2.3', bwry: null },  // icon den + DO — chi man BA MAU moi co mat mau
    'thoi_khoa_bieu': { bwr: '2.5', bwry: '3.6' },
    'co_tu_do': { bwr: '2.6', bwry: '3.7' },
    'khoi_phuc_goc': { bwr: '3.0', bwry: '4.0' },  // lenh 0x2F; ban 4 mau co tu v4.0 (len loi chung epd_common)
    'hien_khe_anh': { bwr: '3.0', bwry: '4.0' },  // lenh 0x27 05; ban 4 mau co tu v4.0 (len loi chung epd_common)
    'chu_ky_phut': { bwr: '3.0', bwry: '4.0' },  // 15/30/45 phut. Tu v4.0 ban 4 mau chay loi chung nen nhan DUNG cung bo gia tri voi ban 3 mau (truoc do no rieng mot nac 40)
    'nhip_lam_moi_3': { bwr: null, bwry: '3.3' },  // ban 4 mau: lenh 0x23 mang BA gia tri
  },
  anTheTrongKhoang: {
    '8bit_nui_tuyet_hoang_hon': { bwr: ['2.3', '2.4'], modes: [18, 19] },
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
