/*
 * Thư viện ảnh xem trước cho bản BIG (màn 7.5" đã lão hóa) — CHỈ 6 chế độ,
 * tất cả đều khối lớn/chữ to. Vẽ lại đúng bố cục firmware epd_7_5inch_big
 * (GUI.c) thu nhỏ về khung 400x240 (tỉ lệ 640x384).
 */
(function () {
  const RED = '#d21f1f', BK = '#141414', BG = '#f4f4ef';
  const W = 400, H = 240;              // khung xem trước (640x384 thu 0.625)
  const K = W / 640;                   // hệ số thu nhỏ

  function ctx2d(c) {
    const x = c.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.fillStyle = BG;
    x.fillRect(0, 0, c.width, c.height);
    return x;
  }
  const S = (v) => v * K;              // đổi toạ độ firmware -> khung xem trước

  function font(x, px, bold) {
    x.font = (bold ? 'bold ' : '') + px + 'px ui-monospace,Menlo,Consolas,monospace';
    x.textBaseline = 'alphabetic';
  }
  function center(x, s, cx, y, col, px) {
    font(x, px, true);
    x.fillStyle = col;
    x.textAlign = 'center';
    x.fillText(s, cx, y);
    x.textAlign = 'left';
  }
  // băng đỏ + tiêu đề trắng (BAND_H = 76 trong firmware)
  function band(x, title) {
    x.fillStyle = RED;
    x.fillRect(0, 0, W, S(76));
    center(x, title, W / 2, S(54), '#fff', S(30));
  }
  // cụm số kiểu 7 thanh: vẽ bằng chữ đậm cỡ lớn cho gần giống
  function seg(x, s, cx, cy, h, col) {
    font(x, h, true);
    x.fillStyle = col;
    x.textAlign = 'center';
    x.fillText(s, cx, cy);
    x.textAlign = 'left';
  }
  function batt(x, bx, by, col) {
    x.strokeStyle = col; x.lineWidth = Math.max(2, S(4));
    x.strokeRect(bx, by, S(64), S(32));
    x.fillStyle = col;
    x.fillRect(bx + S(64), by + S(10), S(6), S(12));
    x.fillRect(bx + S(4), by + S(4), S(38), S(24));
  }
  const WD = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
  const p2 = (n) => String(n).padStart(2, '0');
  // ngày âm lịch gần đúng chỉ để xem trước (firmware tính chuẩn)
  function lunarApprox(d) {
    const t = Math.floor((d.getTime() / 86400000 - 6.5) % 29.53059);
    return { d: (t % 30) + 1, m: d.getMonth() + 1 };
  }

  function m1(x, now) {                                   // Giờ lớn
    band(x, WD[now.getDay()] + ', ' + p2(now.getDate()) + '/' + p2(now.getMonth() + 1) + '/' + now.getFullYear());
    seg(x, p2(now.getHours()) + ':' + p2(now.getMinutes()), W / 2, S(272), S(150), BK);
    x.fillStyle = BK; x.fillRect(S(40), S(296), S(560), S(8));
    const L = lunarApprox(now);
    center(x, 'ÂM LỊCH ' + L.d + '/' + L.m, W / 2 - S(40), S(356), RED, S(30));
    batt(x, S(544), S(328), BK);
  }

  function m2(x, now) {                                   // Số ngày lớn
    band(x, 'THÁNG ' + (now.getMonth() + 1) + ' - ' + now.getFullYear());
    seg(x, p2(now.getDate()), W / 2, S(272), S(190), BK);
    center(x, WD[now.getDay()], W / 2, S(330), RED, S(46));
    const L = lunarApprox(now);
    font(x, S(30), true); x.fillStyle = BK; x.fillText('ÂL ' + L.d + '/' + L.m, S(24), S(374));
    batt(x, S(544), S(344), BK);
  }

  function m3(x, now) {                                   // Âm lịch lớn
    const L = lunarApprox(now);
    band(x, 'ÂM LỊCH THÁNG ' + L.m);
    seg(x, p2(L.d), W / 2, S(272), S(190), RED);
    center(x, 'NGÀY CAN CHI', W / 2, S(322), BK, S(30));
    center(x, p2(now.getDate()) + '/' + p2(now.getMonth() + 1) + ' - TIẾT KHÍ', W / 2, S(370), BK, S(30));
  }

  function m4(x, now) {                                   // Nhiệt độ lớn
    band(x, WD[now.getDay()] + ', ' + p2(now.getDate()) + '/' + p2(now.getMonth() + 1) + '/' + now.getFullYear());
    seg(x, '28', S(208), S(300), S(200), BK);
    x.strokeStyle = BK; x.lineWidth = S(13);
    x.beginPath(); x.arc(S(372), S(136), S(20), 0, 7); x.stroke();
    x.fillStyle = BK;
    x.fillRect(S(412), S(176), S(24), S(136));
    x.fillRect(S(412), S(176), S(96), S(24));
    x.fillRect(S(412), S(288), S(96), S(24));
    x.fillRect(S(40), S(320), S(560), S(8));
    const L = lunarApprox(now);
    font(x, S(30), true); x.fillStyle = RED; x.fillText('ÂM LỊCH ' + L.d + '/' + L.m, S(40), S(372));
    batt(x, S(528), S(344), BK);
  }

  function m5(x, now) {                                   // Ghi chú chữ lớn
    band(x, 'GHI CHÚ - ' + p2(now.getHours()) + ':' + p2(now.getMinutes()));
    center(x, 'Nhớ uống thuốc', W / 2, S(220), BK, S(48));
    center(x, 'lúc 8 giờ tối', W / 2, S(280), BK, S(48));
  }

  function m6(x, now) {                                   // Giờ + ngày
    center(x, WD[now.getDay()], W / 2, S(44), RED, S(30));
    seg(x, p2(now.getHours()) + ':' + p2(now.getMinutes()), W / 2, S(180), S(118), BK);
    x.fillStyle = RED; x.fillRect(S(60), S(208), S(520), S(10));
    seg(x, p2(now.getDate()) + '-' + p2(now.getMonth() + 1), W / 2, S(330), S(104), BK);
    const L = lunarApprox(now);
    font(x, S(30), true); x.fillStyle = BK;
    x.fillText(now.getFullYear() + ' - ÂL ' + L.d + '/' + L.m, S(40), S(372));
    batt(x, S(544), S(342), BK);
  }

  const MODE_LIST = [
    { mode: 1, name: 'Giờ lớn', tick: 'Làm mới mỗi giờ', id: 'bigclockmodebutton', draw: m1 },
    { mode: 2, name: 'Ngày lớn (bloc)', tick: 'Cập nhật lúc 0h', id: 'bigdaymodebutton', draw: m2 },
    { mode: 3, name: 'Âm lịch lớn', tick: 'Cập nhật lúc 0h', id: 'biglunarmodebutton', draw: m3 },
    { mode: 4, name: 'Nhiệt độ lớn', tick: 'Làm mới mỗi giờ', id: 'bigtempmodebutton', draw: m4 },
    { mode: 5, name: 'Ghi chú chữ lớn', tick: 'Cập nhật lúc 0h', id: 'bignotemodebutton', draw: m5 },
    { mode: 6, name: 'Giờ + Ngày', tick: 'Làm mới mỗi giờ', id: 'bigdatemodebutton', draw: m6 },
  ];

  function build() {
    const gallery = document.getElementById('modeGallery');
    if (!gallery) return;
    const now = new Date();
    for (const m of MODE_LIST) {
      const card = document.createElement('div');
      card.className = 'mode-card';
      card.dataset.mode = m.mode;
      card.innerHTML =
        '<canvas width="' + W + '" height="' + H + '"></canvas>' +
        '<div class="mode-name">' + m.name + '</div>' +
        '<div class="mode-tick">' + m.tick + '</div>' +
        '<button id="' + m.id + '" type="button" class="primary" onclick="syncTime(' + m.mode + ')">Áp dụng</button>';
      gallery.appendChild(card);
      try { m.draw(ctx2d(card.querySelector('canvas')), now); }
      catch (e) { console.error('preview mode ' + m.mode, e); }
    }
    setInterval(window.refreshModeGallery, 60000);
  }

  window.refreshModeGallery = function () {
    const t = new Date();
    document.querySelectorAll('.mode-card').forEach((card, i) => {
      if (!MODE_LIST[i]) return;
      try { MODE_LIST[i].draw(ctx2d(card.querySelector('canvas')), t); }
      catch (e) { console.error('preview mode ' + MODE_LIST[i].mode, e); }
    });
  };

  // main.js gọi highlightMode(n) sau khi đổi chế độ
  window.highlightMode = function (n) {
    document.querySelectorAll('.mode-card').forEach((c) => {
      c.classList.toggle('active', Number(c.dataset.mode) === Number(n));
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
