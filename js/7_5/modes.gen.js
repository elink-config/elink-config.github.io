/* ===== FILE NAY DUOC SINH RA TU DONG — DUNG SUA BANG TAY =====
 * Nguon: tools/profile/7_5.json  |  Sinh lai: python tools/profile/gen.py 7_5
 *
 * Bang the cua gallery. CHI CO DU LIEU — 'draw' la KHOA tra sang ham ve
 * that nam trong mode_preview.js (cac ham do dung helper cuc bo cua IIFE
 * nen khong the dua ra ngoai).
 */
window.EPD_MODES = [
  { mode: 1, name: 'Lịch tháng', tick: 'Cập nhật lúc 0h', id: 'calendarmodebutton', draw: 'm1' },
  { mode: 2, name: 'Đồng hồ + Lịch', tick: 'Làm mới mỗi giờ', id: 'combomodebutton', draw: 'm3' },
  { mode: 3, name: 'Lịch để bàn (đỏ)', tick: 'Làm mới mỗi giờ', id: 'redcombomodebutton', draw: 'm4' },
  { mode: 4, name: 'Lịch VN (Can Chi)', tick: 'Cập nhật lúc 0h', id: 'vncalendarmodebutton', draw: 'm5' },
  { mode: 5, name: 'Đồng hồ số', tick: 'Làm mới mỗi giờ', id: 'digitalmodebutton', draw: 'm6' },
  { mode: 6, name: 'Đồng hồ kim', tick: 'Làm mới mỗi giờ', id: 'analogmodebutton', draw: 'm7' },
  { mode: 7, name: 'Lịch bloc', tick: 'Cập nhật lúc 0h', id: 'dayblocmodebutton', draw: 'm8' },
  { mode: 8, name: 'Lịch tuần', tick: 'Làm mới mỗi giờ', id: 'weekmodebutton', draw: 'm9' },
  { mode: 9, name: 'Giờ + lịch tháng', tick: 'Làm mới mỗi giờ', id: 'digitalcalmodebutton', draw: 'm10' },
  { mode: 10, name: 'Kim + thẻ ngày', tick: 'Làm mới mỗi giờ', id: 'analogdaymodebutton', draw: 'm11' },
  { mode: 11, name: 'Tối giản', tick: 'Cập nhật lúc 0h', id: 'minimalmodebutton', draw: 'm12' },
  { mode: 12, name: 'Lịch vạn niên', tick: 'Cập nhật lúc 0h', id: 'vanniemodebutton', draw: 'm13' },
  { mode: 13, name: 'Lịch dương + âm', tick: 'Làm mới mỗi giờ', id: 'countdownmodebutton', draw: 'm14' },
  { mode: 14, name: 'Hai tháng', tick: 'Cập nhật lúc 0h', id: 'twomonthmodebutton', draw: 'm15' },
  { mode: 15, name: 'Lịch cả năm', tick: 'Cập nhật lúc 0h', id: 'yearmodebutton', draw: 'm16' },
  { mode: 16, name: 'Nhiệt kế', tick: 'Làm mới mỗi giờ', id: 'thermomodebutton', draw: 'm17' },
  { mode: 17, name: 'Núi tuyết 8-bit', tick: 'Cập nhật lúc 0h', id: 'retromtnmodebutton', draw: 'm21' },
  { mode: 18, name: 'Hoàng hôn 8-bit', tick: 'Làm mới mỗi giờ', id: 'retrosunsetmodebutton', draw: 'm22' },
  { mode: 19, name: 'Khủng long 8-bit', tick: 'Cập nhật lúc 0h', id: 'retrowinmodebutton', draw: 'm23' },
  { mode: 20, name: 'Thành phố 8-bit', tick: 'Làm mới mỗi giờ', id: 'retrocitymodebutton', draw: 'm24' },
  { mode: 21, name: 'Ghi chú', tick: 'Làm mới mỗi giờ', id: 'notemodebutton', draw: 'm19' },
  { mode: 22, name: 'Tự thiết kế', tick: 'Làm mới mỗi giờ', id: 'custommodebutton', draw: 'm20' },
];
