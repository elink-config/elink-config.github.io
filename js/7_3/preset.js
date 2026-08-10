// App 7.3" sáu màu: chọn sẵn driver 0A trong select dùng chung của hub
// (chạy TRƯỚC main.js — xem thứ tự scripts trong connector.js APPS['7_3'])
(function () {
  const sel = document.getElementById('epddriver');
  if (sel) {
    let opt = Array.from(sel.options).find(o => o.value === '0A');
    if (opt) sel.value = '0A';
  }
})();
