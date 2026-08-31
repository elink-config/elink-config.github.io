/* ===== FILE NAY DUOC SINH RA TU DONG — DUNG SUA BANG TAY =====
 * Nguon: tools/profile/4_37.json  |  Sinh lai: python tools/profile/gen.py 4_37
 *
 * Bang the cua gallery. CHI CO DU LIEU — 'draw' la KHOA tra sang ham ve
 * that nam trong mode_preview.js (cac ham do dung helper cuc bo cua IIFE
 * nen khong the dua ra ngoai).
 */
window.EPD_MODES = [
  { mode: 0, name: 'Hình ảnh', tick: 'Không tự đổi', id: 'picturemodebutton', draw: 'm0' },
  { mode: 1, name: 'Kiểm hướng màn', tick: 'Không tự đổi', id: 'probemodebutton', draw: 'm1' },
  { mode: 2, name: 'Đồng hồ + ngày', tick: 'Theo nhịp đã chọn', id: 'clockmodebutton', draw: 'm2' },
  { mode: 3, name: 'Lịch tháng', tick: 'Cập nhật lúc 0h', id: 'calendarmodebutton', draw: 'm3' },
  { mode: 4, name: 'Ghi chú', tick: 'Theo nhịp đã chọn', id: 'notemodebutton', draw: 'm4' },
  { mode: 5, name: 'Tự thiết kế', tick: 'Theo nhịp đã chọn', id: 'custommodebutton', draw: 'm5' },
];
