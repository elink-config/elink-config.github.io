// Nhắc cập nhật firmware — DÙNG CHUNG cho cả 3 màn (2.13" / 2.9" / 4.2").
// Nguồn "bản mới nhất" = cột «Version» của bảng .fw-table đang có trong DOM
// (mỗi app chỉ nhúng bảng của chính nó) — thêm dòng firmware mới vào bảng
// «Danh sách firmware» là popup tự biết, KHÔNG phải sửa js.
//
// Cách dùng trong main.js của từng app:
//   FwCheck.reset('1.3.1');  // đầu connect(); tham số = phiên bản coi như
//                            // đang chạy khi thiết bị KHÔNG tự khai (đời cũ)
//   FwCheck.report('v1.4');  // khi thiết bị tự khai (notify 'fw=...')
//   FwCheck.schedule(3000);  // cuối connect(): hẹn kiểm tra cho đời cũ
window.FwCheck = (function () {
  let deviceVer = null;  // [1,4] khi thiết bị tự khai qua report()
  let floor = null;      // phiên bản mặc định khi thiết bị im lặng
  let shown = false;     // chỉ nhắc MỘT lần mỗi phiên kết nối
  let timer = null;

  // "v1.3.1" / "1.4" -> [1,3,1]; so sánh từng phần dạng số
  function parse(s) {
    return String(s).trim().replace(/^v/i, '').split('.').map(n => parseInt(n) || 0);
  }
  function cmp(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = (a[i] || 0) - (b[i] || 0);
      if (d) return d;
    }
    return 0;
  }
  // bản lớn nhất trong bảng «Danh sách firmware» (cột 2 = Version)
  function latest() {
    let best = null;
    document.querySelectorAll('.fw-table tbody tr').forEach(tr => {
      if (tr.cells && tr.cells.length > 1) {
        const v = parse(tr.cells[1].textContent);
        if (v.some(x => x > 0) && (!best || cmp(v, best.ver) > 0)) {
          best = { ver: v, text: tr.cells[1].textContent.trim() };
        }
      }
    });
    return best;
  }
  function check() {
    if (shown) return;
    const b = latest();
    if (!b) return;
    const cur = deviceVer || floor;
    if (!cur || cmp(cur, b.ver) >= 0) return;
    shown = true;
    const curTxt = deviceVer ? cur.join('.') : 'cũ (≤ ' + floor.join('.') + ')';
    if (typeof addLog === 'function') addLog('Firmware thiết bị: ' + curTxt + ' — đã có bản mới ' + b.text + '.');
    if (confirm('Đã có firmware mới ' + b.text + ' (thiết bị đang chạy bản ' + curTxt + ').\n' +
                'Tải file .bin ở mục «Danh sách firmware» (đọc kỹ ghi chú từng bản) rồi nạp ở mục «Cập nhật firmware (OTA)».\n\n' +
                'Cuộn tới khu vực cập nhật ngay?')) {
      const el = document.getElementById('otaFieldset');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
  return {
    // thiết bị ĐÃ TỰ KHAI phiên bản và >= s? (dùng gate tính năng theo fw,
    // vd ô «Ngày sinh nhật» chỉ hiện với fw >= 1.5)
    atLeast: function (s) { return !!deviceVer && cmp(deviceVer, parse(s)) >= 0; },
    reset: function (floorStr) {
      deviceVer = null;
      floor = floorStr ? parse(floorStr) : null;
      shown = false;
      if (timer) { clearTimeout(timer); timer = null; }
    },
    report: function (s) { deviceVer = parse(s); check(); },
    schedule: function (ms) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(check, ms || 3000);
    },
  };
})();
