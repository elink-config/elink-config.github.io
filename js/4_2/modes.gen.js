/* ===== FILE NAY DUOC SINH RA TU DONG — DUNG SUA BANG TAY =====
 * Nguon: tools/profile/4_2.json  |  Sinh lai: python tools/profile/gen.py 4_2
 *
 * Bang the cua gallery. CHI CO DU LIEU — 'draw' la KHOA tra sang ham ve
 * that nam trong mode_preview.js (cac ham do dung helper cuc bo cua IIFE
 * nen khong the dua ra ngoai).
 */
window.EPD_MODES = [
  { mode: 1, name: 'Lịch tháng', tick: 'Cập nhật lúc 0h', id: 'calendarmodebutton', draw: 'm1' },
  { mode: 2, name: 'Đồng hồ + Lịch', tick: 'Làm mới mỗi phút', id: 'combomodebutton', draw: 'm3' },
  { mode: 3, name: 'Lịch để bàn (đỏ)', tick: 'Làm mới mỗi phút', id: 'redcombomodebutton', draw: 'm4' },
  { mode: 4, name: 'Lịch VN (Can Chi)', tick: 'Cập nhật lúc 0h', id: 'vncalendarmodebutton', draw: 'm5' },
  { mode: 5, name: 'Đồng hồ số', tick: 'Làm mới mỗi phút', id: 'digitalmodebutton', draw: 'm6' },
  { mode: 6, name: 'Đồng hồ kim', tick: 'Làm mới mỗi phút', id: 'analogmodebutton', draw: 'm7' },
  { mode: 7, name: 'Lịch bloc', tick: 'Cập nhật lúc 0h', id: 'dayblocmodebutton', draw: 'm8' },
  { mode: 8, name: 'Lịch tuần', tick: 'Làm mới mỗi phút', id: 'weekmodebutton', draw: 'm9' },
  { mode: 9, name: 'Giờ + lịch tháng', tick: 'Làm mới mỗi phút', id: 'digitalcalmodebutton', draw: 'm10' },
  { mode: 10, name: 'Kim + thẻ ngày', tick: 'Làm mới mỗi phút', id: 'analogdaymodebutton', draw: 'm11' },
  { mode: 11, name: 'Tối giản', tick: 'Cập nhật lúc 0h', id: 'minimalmodebutton', draw: 'm12' },
  { mode: 12, name: 'Lịch vạn niên', tick: 'Cập nhật lúc 0h', id: 'vanniemodebutton', draw: 'm13' },
  { mode: 13, name: 'Lịch dương + âm', nameNew: 'Lịch dương + âm', tick: 'Cập nhật lúc 0h', tickNew: 'Làm mới mỗi phút', id: 'countdownmodebutton', draw: 'm14' },
  { mode: 14, name: 'Hai tháng', tick: 'Cập nhật lúc 0h', id: 'twomonthmodebutton', draw: 'm15' },
  { mode: 15, name: 'Lịch cả năm', tick: 'Cập nhật lúc 0h', id: 'yearmodebutton', draw: 'm16' },
  { mode: 16, name: 'Nhiệt kế', tick: 'Làm mới mỗi phút', id: 'thermomodebutton', draw: 'm17' },
  { mode: 17, name: 'Ghi chú', tick: 'Làm mới mỗi phút', id: 'notemodebutton', draw: 'm19' },
  { mode: 18, name: 'Núi tuyết 8-bit', tick: 'Cập nhật lúc 0h', id: 'retromtnmodebutton', draw: 'm21' },
  { mode: 19, name: 'Hoàng hôn 8-bit', tick: 'Làm mới mỗi phút', id: 'retrosunsetmodebutton', draw: 'm22' },
  { mode: 20, name: 'Khủng long 8-bit', tick: 'Cập nhật lúc 0h', id: 'retrowinmodebutton', draw: 'm23' },
  { mode: 21, name: 'Thành phố 8-bit', tick: 'Làm mới mỗi phút', id: 'retrocitymodebutton', draw: 'm24' },
  { mode: 22, name: 'Tự thiết kế 1', tick: 'Làm mới mỗi phút', id: 'custommodebutton', draw: 'custom' },
  { mode: 23, name: 'Tự thiết kế 2', tick: 'Làm mới mỗi phút', id: 'custommodebutton2', draw: 'custom2' },
  { mode: 24, name: 'Thời khóa biểu', tick: 'Cập nhật lúc 0h', id: 'timetablemodebutton', draw: 'timetable' },
];
