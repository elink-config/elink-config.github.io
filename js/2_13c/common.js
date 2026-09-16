/*
 * Hằng số + helper DÙNG CHUNG cho app 2.13" (nạp TRƯỚC designer.js,
 * mode_preview.js và main.js — cả ba đều dùng chung phạm vi global).
 *
 * Mục đích: trước đây mỗi file tự khai báo lại BK/WH, WD_FULL, pad2,
 * lunarStr, voltValue... nên sửa một chỗ là lệch chỗ khác (chính vì vậy mà
 * số mode ẢNH bị ghi nhầm 3 chỗ khác nhau, và ô Pin/Nhiệt độ trong «Thiết kế
 * màn hình» không bao giờ hiện giá trị thật). Thêm hằng số mới thì đặt ở
 * ĐÂY, đừng khai báo lại trong từng file.
 */

/* ---- số hiệu chế độ của firmware ------------------------------------- */

// Chế độ ẢNH (thiết bị đặt bằng 0x94 01, KHÔNG phải 0x98). Thẻ tương ứng
// trong thư viện giao diện mang id chuỗi 'img'.
// v2.x đánh số LIỀN MẠCH theo quy ước họ máy: ẢNH về 0 (bản v1.10 để ở 28).
// Chính hằng số này là lý do hai app KHÔNG dùng chung được file common.js —
// nó nhìn như hằng số vẽ nhưng thật ra là một GIAO ƯỚC SỐ với firmware.
const IMG_MODE = 0;

// Chế độ TỰ THIẾT KẾ (webtool gửi bố cục bằng 0x9b, thiết bị tự chuyển sang)
const CUSTOM_MODE = 27;

/* ---- màu + nhãn ------------------------------------------------------- */

const BK = '#151515', WH = '#f6f4ec', GY = '#555';
const WD_FULL = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
const WD_SUN = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];  // lưới CN đứng đầu
const WD_HDR = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];  // lưới T2 đứng đầu

/* ---- ngày giờ --------------------------------------------------------- */

function pad2(n) { return String(n).padStart(2, '0'); }

function dateLine(now) {
  return WD_FULL[now.getDay()] + ' ' + pad2(now.getDate()) + '/' +
    pad2(now.getMonth() + 1) + '/' + now.getFullYear();
}

// Chuỗi âm lịch hôm nay. lunarToday() nằm trong main.js (nạp sau) nên chỉ
// gọi được lúc VẼ, không gọi được lúc nạp script.
//   prefix: 'Âm lịch ' (mặc định) hoặc 'Âm ' cho chỗ hẹp
//   pad:    true = 05 thay vì 5 (cho bố cục cần bề rộng cố định)
function lunarText(now, opt) {
  opt = opt || {};
  const pre = (opt.prefix !== undefined) ? opt.prefix : 'Âm lịch ';
  try {
    const l = lunarToday(now || new Date());
    const mm = l.month & 0x7f;
    return pre + (opt.pad ? pad2(l.day) : l.day) + '/' +
      (opt.pad ? pad2(mm) : mm) + ((l.month & 0x80) ? 'n' : '');
  } catch (e) {
    return pre + '--/--';
  }
}

/* ---- giá trị đang hiển thị trên trang (pin, nhiệt độ) ------------------
   Bản xem trước và «Thiết kế màn hình» vẽ theo số liệu thật của thiết bị khi
   đã kết nối, nếu chưa thì dùng giá trị mẫu. Trước đây hai hàm này nằm kín
   trong mode_preview.js nên designer.js dò `typeof voltValue === 'function'`
   luôn ra false và vẽ chết cứng 3.1v / 28°C.                              */

function voltValue() {
  const el = document.getElementById('battVolt');
  if (el && /\d/.test(el.textContent)) {
    const v = parseFloat(el.textContent);
    if (v > 0) return v;
  }
  return 3.1;
}

/* Chuỗi cạnh icon pin — theo ĐÚNG cài đặt «Hiển thị pin», y như batt_text()
 * bên firmware: 0 = không có chữ, 1 = phần trăm, 2 = điện áp.
 * Trước đây luôn trả điện áp nên xem trước vẽ một kiểu, máy hiện một kiểu. */
function battStyleVal() {
  const r = document.querySelector('input[name="battStyle"]:checked');
  return r ? (parseInt(r.value) || 0) : 2;
}
function voltLabel() {
  const st = battStyleVal();
  if (st === 0) return '';
  if (st === 1) return battPct(Math.round(voltValue() * 1000)) + '%';
  return voltValue().toFixed(1) + 'v';
}

function panelTempVal() {
  const el = document.getElementById('panelTemp');
  if (el && /-?\d/.test(el.textContent)) return parseInt(el.textContent);
  return 28;
}

/* ---- pin --------------------------------------------------------------
   % pin theo đường xả pin lithium CR2450/CR2477 — PHẢI khớp batt_pct()
   trong firmware (user_custs1_impl.c), nếu không webtool và màn hình sẽ
   báo hai con số khác nhau.                                              */

function battPct(mv) {
  const V = [2400, 2500, 2600, 2650, 2700, 2750, 2800, 2850, 2900, 2980, 3050];
  const P = [0, 5, 12, 20, 30, 45, 60, 75, 85, 95, 100];
  if (mv >= V[10]) return 100;
  if (mv <= V[0]) return 0;
  for (let i = 10; i > 0; i--)
    if (mv >= V[i - 1]) return Math.round(P[i - 1] + (mv - V[i - 1]) * (P[i] - P[i - 1]) / (V[i] - V[i - 1]));
  return 0;
}

/* ---- kiểm tra phiên bản firmware của thiết bị -------------------------
   Thiết bị tự khai phiên bản trong gói trạng thái (fw >= 1.5); main.js lưu
   vào window.deviceFwVer. Dùng hàm này thay vì tự tách chuỗi ở từng chỗ.  */

function fwAtLeast(major, minor) {
  if (typeof window.deviceFwVer !== 'string') return false;
  const p = window.deviceFwVer.split('.').map(Number);
  return p[0] > major || (p[0] === major && p[1] >= minor);
}

/* Lọc ký tự ngoài font firmware: fontSafe() nằm ở main.js (window.fontSafe)
   — KHÔNG khai báo lại ở đây, vì hai file cùng khai `const` ở phạm vi global
   sẽ làm cả trang lỗi "Identifier has already been declared". */

// designer.js chạy trong IIFE riêng nên gọi qua window.*
window.IMG_MODE = IMG_MODE;
window.CUSTOM_MODE = CUSTOM_MODE;
window.fwAtLeast = fwAtLeast;
window.lunarText = lunarText;
