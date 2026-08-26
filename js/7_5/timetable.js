/*
 * THỜI KHÓA BIỂU (mode 24) — bảng nhập trên web + xem trước + gửi xuống máy.
 *
 * Bảng gồm 7 cột THỨ (bỏ cột chủ nhật nếu người dùng tích «chỉ T2..T7»), hai
 * buổi SÁNG / CHIỀU, mỗi buổi tối đa 5 tiết. Ô để trống = tiết trống; buổi nào
 * không dùng hết 5 tiết thì các dòng trống ở CUỐI bị bỏ và chiều cao thừa chia
 * đều cho các dòng còn lại (firmware làm y hệt — xem DrawTimetable trong GUI.c).
 *
 * SỐ KÝ TỰ MỖI Ô là ràng buộc chính: firmware chỉ có MỘT font tiếng Việt có
 * dấu (unifont, rộng đúng 8px/ký tự, không co giãn được) nên một cột chỉ chứa
 * 7 ký tự (bảng 7 thứ) hoặc 8 ký tự (bảng 6 thứ). Ô nhập chặn đúng số đó.
 *
 * Dây truyền: lệnh 0x2D chia mảnh —
 *   [0x2D, 0x00, flags, rows_am, rows_pm, dữ liệu...]  mở (máy xoá sector)
 *   [0x2D, 0x01, dữ liệu...]                            mảnh kế tiếp
 * Dữ liệu là 70 ô CỐ ĐỊNH 28 byte, thứ tự [buổi][tiết][thứ], mỗi ô là chuỗi
 * UTF-8 kết NUL. Đủ 1960 byte thì máy tự ghi header, báo 'tkb=done' rồi chuyển
 * sang mode 24.
 */
(function () {
  'use strict';

  const DAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
  const ROWS = 5;        // tiết mỗi buổi
  const DAYS_N = 7;      // luôn gửi đủ 7 cột, cờ six chỉ đổi cách VẼ
  const CELL = 28;       // byte một ô (khớp TT_CELL của firmware)
  const DATA_LEN = 2 * ROWS * DAYS_N * CELL;  // 1960
  const LS_KEY = 'tkbStore.v1';               // { "<tên máy>": state }
  /* Khổ màn của máy 7.5" V1. Bản gốc (4.2") là 400x300; ô xem trước và thẻ
   * gallery đều vẽ theo hai số này nên đổi ở ĐÂY là đủ. */
  const W = 640, H = 384;

  // màu mô phỏng mực e-ink (khớp mode_preview.js)
  const RED = '#C0261F', BK = '#151515', WH = '#f6f4ec', YE = '#E8B90C';
  const ADV = 8;  // unifont: mỗi ký tự rộng đúng 8 px

  function blank() {
    const grid = () => Array.from({ length: ROWS }, () => Array(DAYS_N).fill(''));
    return { six: false, header: true, am: grid(), pm: grid() };
  }
  let st = blank();
  let lastDev = null;   // tên máy đã nạp bảng (để tự nạp lại khi đổi máy)

  const nDays = () => (st.six ? 6 : DAYS_N);
  const colW = () => W / nDays();
  // 8px/ký tự, chữ canh giữa nên vừa đúng bề rộng cột là được
  const maxChars = () => Math.floor(colW() / ADV);

  function is4c() {
    const s = document.getElementById('epddriver');
    if (s && (s.value === '05' || s.value === '06')) return true;
    try {
      return ((bleDevice && bleDevice.name) || '').indexOf('DIY-4_2C') === 0;
    } catch (e) { return false; }
  }
  function devName() {
    try { return (typeof bleDevice !== 'undefined' && bleDevice && bleDevice.name) || ''; }
    catch (e) { return ''; }
  }

  /* ---- lưu / nạp theo TỪNG MÁY (giống kho «Tự thiết kế») ---- */
  function store() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; }
  }
  function save() {
    try {
      const all = store();
      all[devName() || '_'] = st;
      localStorage.setItem(LS_KEY, JSON.stringify(all));
    } catch (e) { /* localStorage đầy / bị chặn: bỏ qua, không chặn việc gửi */ }
  }
  function load() {
    const all = store();
    const s = all[devName() || '_'] || all['_'];
    if (!s || !Array.isArray(s.am) || !Array.isArray(s.pm)) return false;
    const fix = (g) => Array.from({ length: ROWS }, (_, r) =>
      Array.from({ length: DAYS_N }, (_, d) => String((g[r] && g[r][d]) || '')));
    st = { six: !!s.six, header: s.header !== false, am: fix(s.am), pm: fix(s.pm) };
    return true;
  }

  /* ---- số tiết THẬT của mỗi buổi (bỏ các dòng trống ở cuối) ---- */
  function rowsUsed(block) {
    const g = st[block];
    let k = 0;
    for (let r = 0; r < ROWS; r++)
      for (let d = 0; d < nDays(); d++)
        if ((g[r][d] || '').trim()) { k = r + 1; break; }
    return k;
  }

  /* ---- bảng nhập ---- */
  function buildGrid() {
    const mount = document.getElementById('tkbGridMount');
    if (!mount) return;
    const n = nDays(), mc = maxChars();
    const today = (new Date().getDay() + 6) % 7;
    let h = '<div class="tkb-wrap"><table class="tkb-table"><tr><th class="tkb-buoi">Buổi / Tiết</th>';
    for (let d = 0; d < n; d++)
      h += '<th class="' + (d === today ? 'today' : '') + '">' + DAYS[d] + '</th>';
    h += '</tr>';
    h += block('am', 'SÁNG', n, mc);
    h += '<tr class="tkb-sep"><td colspan="' + (n + 1) + '"></td></tr>';
    h += block('pm', 'CHIỀU', n, mc);
    h += '</table></div>';
    mount.innerHTML = h;
    mount.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('input', () => {
        st[inp.dataset.b][+inp.dataset.r][+inp.dataset.d] = inp.value;
        draw();
        save();
      });
    });
    const hint = document.getElementById('tkbHint');
    if (hint) hint.innerHTML = 'Mỗi ô tối đa <b>' + mc + ' ký tự</b> — đúng bề rộng một cột trên màn hình ' +
      '(font của máy rộng cố định 8px mỗi ký tự, kể cả chữ có dấu).';
  }
  function block(b, name, n, mc) {
    let out = '';
    for (let r = 0; r < ROWS; r++) {
      out += '<tr>';
      if (r === 0) out += '<td class="tkb-buoi" rowspan="' + ROWS + '">' + name + '</td>';
      for (let d = 0; d < n; d++) {
        const v = String(st[b][r][d] || '').replace(/"/g, '&quot;');
        out += '<td><input type="text" data-b="' + b + '" data-r="' + r + '" data-d="' + d +
               '" maxlength="' + mc + '" value="' + v + '" placeholder="—"></td>';
      }
      out += '</tr>';
    }
    return out;
  }

  /* ---- vẽ xem trước: MÔ PHỎNG ĐÚNG DrawTimetable của firmware ---- */
  function vtext(x, s, cx, cy, col) {
    x.fillStyle = col; x.textAlign = 'center'; x.textBaseline = 'middle';
    const sx = cx - s.length * ADV / 2;
    for (let i = 0; i < s.length; i++) x.fillText(s[i], sx + i * ADV + ADV / 2, cy);
  }
  function vleft(x, s, lx, cy, col) {
    x.fillStyle = col; x.textAlign = 'center'; x.textBaseline = 'middle';
    for (let i = 0; i < s.length; i++) x.fillText(s[i], lx + i * ADV + ADV / 2, cy);
  }
  function vfont(x, big) { x.font = (big ? '13.5px' : '12px') + ' "Segoe UI",Arial,sans-serif'; }

  // vẽ bảng vào một context W x H (dùng cho cả ô xem trước lẫn thẻ gallery)
  function render(x, now, fourColor) {
    now = now || new Date();
    /* TỰ CO GIÃN THEO CANVAS ĐÍCH. Hàm này vẽ theo toạ độ THẬT của màn
     * (640x384), nhưng thẻ trong gallery là canvas 400x300 dùng chung cho cả
     * họ máy. Bản 4.2" không cần vì màn nó ĐÚNG BẰNG thẻ; máy này lệch cả hai
     * chiều nên thiếu phép co là bảng bị cắt mất gần nửa. */
    const cv = x.canvas;
    const sx = (cv && cv.width ? cv.width : W) / W;
    const sy = (cv && cv.height ? cv.height : H) / H;
    x.save();
    x.setTransform(sx, 0, 0, sy, 0, 0);
    try { renderAt(x, now, fourColor); } finally { x.restore(); }
  }

  function renderAt(x, now, fourColor) {
    x.fillStyle = WH; x.fillRect(0, 0, W, H);
    const n = nDays();
    const nAM = rowsUsed('am'), nPM = rowsUsed('pm');
    if (nAM + nPM === 0) {
      vfont(x, true);
      // canh giữa theo chiều cao THẬT (bản 4.2" đặt cứng 130/162/186 cho 300px)
      vtext(x, 'Chưa có thời khóa biểu', W / 2, H / 2 - 22, BK);
      vfont(x, false);
      vtext(x, 'Nhập bảng ở mục «Thời khóa biểu»', W / 2, H / 2 + 10, BK);
      vtext(x, 'của webtool rồi bấm «Gửi lên thiết bị»', W / 2, H / 2 + 34, BK);
      return;
    }
    let today = (now.getDay() + 6) % 7;
    if (today >= n) today = -1;
    const cx = [];
    for (let i = 0; i <= n; i++) cx.push(Math.round(i * W / n));

    // thanh tiêu đề
    let top = 0;
    if (st.header) {
      top = 24;
      x.fillStyle = RED; x.fillRect(0, 0, W, top);
      if (fourColor) { x.fillStyle = YE; x.fillRect(0, top - 3, W, 3); }
      vfont(x, true); vleft(x, 'THỜI KHÓA BIỂU', 6, 12, '#fff');
      const ds = DAYS[(now.getDay() + 6) % 7] + ' ' +
        ('0' + now.getDate()).slice(-2) + '/' + ('0' + (now.getMonth() + 1)).slice(-2);
      vfont(x, false); vleft(x, ds, W - 36 - ds.length * ADV, 12, '#fff');
      // giờ căn giữa: NỀN TRẮNG CHỮ ĐEN vì mỗi phút máy chỉ làm mới riêng ô này
      // bằng partial update, mà partial chỉ đổi được điểm đen/trắng
      const ts = ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2);
      const tw = ts.length * ADV, tbx = Math.round((W - tw - 14) / 2);
      x.fillStyle = WH; x.fillRect(tbx, 2, tw + 14, 20);
      vfont(x, true); vleft(x, ts, tbx + 7, 12, BK);
      x.strokeStyle = '#fff'; x.lineWidth = 1.2; x.strokeRect(W - 28, 7, 20, 10);
      x.fillStyle = '#fff'; x.fillRect(W - 30, 11, 2, 2); x.fillRect(W - 26, 9, 16, 6);
    }

    const hdrH = 22, bandH = 16;   // = chiều cao font của máy
    const gTop = top + hdrH;
    const bands = (nAM ? 1 : 0) + (nPM ? 1 : 0);
    const rowH = Math.floor((H - 2 - gTop - bands * bandH) / (nAM + nPM));
    const yAM = gTop + (nAM ? bandH : 0);
    const yPM = yAM + nAM * rowH + (nPM ? bandH : 0);
    const gBot = yPM + nPM * rowH;

    // bản 4 màu: nền VÀNG cả cột hôm nay
    if (fourColor && today >= 0) {
      x.fillStyle = YE;
      x.fillRect(cx[today], gTop, cx[today + 1] - cx[today], gBot - gTop);
    }

    // hàng THỨ
    vfont(x, true);
    for (let d = 0; d < n; d++) {
      let col = BK;
      if (d === today) {
        x.fillStyle = RED; x.fillRect(cx[d], top, cx[d + 1] - cx[d], hdrH); col = '#fff';
      } else if (d >= 5) { col = RED; }
      vtext(x, DAYS[d], (cx[d] + cx[d + 1]) / 2, top + hdrH / 2, col);
    }

    // hai khối buổi
    const drawBlock = (b, name, y0, nr) => {
      if (!nr) return;
      x.fillStyle = BK; x.fillRect(0, y0 - bandH, W, bandH);
      if (fourColor) { x.fillStyle = YE; x.fillRect(0, y0 - 2, W, 2); }
      vfont(x, false); vtext(x, name, W / 2, y0 - bandH / 2, '#fff');
      vfont(x, true);
      for (let r = 0; r < nr; r++) {
        const cyr = y0 + r * rowH + rowH / 2;
        for (let d = 0; d < n; d++) {
          let s = (st[b][r][d] || '').trim();
          if (!s) continue;
          if (s.length > maxChars()) s = s.slice(0, maxChars());
          vtext(x, s, (cx[d] + cx[d + 1]) / 2, cyr, BK);
        }
      }
    };
    drawBlock('am', 'SÁNG', yAM, nAM);
    drawBlock('pm', 'CHIỀU', yPM, nPM);

    // lưới
    x.strokeStyle = BK; x.lineWidth = 1;
    const hline = (y) => { x.beginPath(); x.moveTo(0, y + .5); x.lineTo(W, y + .5); x.stroke(); };
    const vline = (xx, y0, y1) => { x.beginPath(); x.moveTo(xx + .5, y0); x.lineTo(xx + .5, y1); x.stroke(); };
    hline(top); hline(gTop);
    for (let r = 1; r < nAM; r++) hline(yAM + r * rowH);
    for (let r = 1; r < nPM; r++) hline(yPM + r * rowH);
    x.strokeRect(0.5, top + 0.5, W - 1, gBot - top - 1);
    for (let i = 1; i < n; i++) vline(cx[i], top, gBot);

    // cột hôm nay
    if (today >= 0) {
      x.strokeStyle = fourColor ? BK : RED; x.lineWidth = 2;
      x.strokeRect(cx[today] + 1, top + 1, cx[today + 1] - cx[today] - 2, gBot - top - 2);
    }
  }

  function draw() {
    const cv = document.getElementById('tkbPreview');
    if (cv) {
      const x = cv.getContext('2d');
      x.setTransform(1, 0, 0, 1, 0, 0);
      render(x, new Date(), is4c());
    }
    /* Chỉ vẽ lại ĐÚNG thẻ «Thời khoá biểu» trong gallery (gõ một phím mà vẽ
     * lại cả 23 thẻ thì máy yếu giật rõ rệt).
     *
     * ⚠ SỐ MODE LẤY TỪ BẢNG SINH RA, không viết cứng. Bản 4.2" để thẳng
     * data-mode="24"; máy này đánh số liền mạch nên chế độ ấy là 23 — chép
     * nguyên số cũ thì ô xem trước cập nhật mà THẺ thì đứng im, và không có
     * lỗi nào báo ra. */
    const ttMode = ((window.EPD_MODES || []).find(e => e.draw === 'timetable') || {}).mode;
    const card = ttMode == null ? null
      : document.querySelector('.mode-card[data-mode="' + ttMode + '"] canvas');
    if (card) {
      const cc = card.getContext('2d');
      cc.setTransform(1, 0, 0, 1, 0, 0);
      render(cc, new Date(), is4c());
    }
  }

  /* ---- đóng gói 1960 byte gửi xuống máy ---- */
  function serialize() {
    const enc = new TextEncoder();
    const buf = new Uint8Array(DATA_LEN);
    const blocks = ['am', 'pm'];
    for (let b = 0; b < 2; b++) {
      for (let r = 0; r < ROWS; r++) {
        for (let d = 0; d < DAYS_N; d++) {
          let s = (st[blocks[b]][r][d] || '').trim();
          if (d >= nDays()) s = '';            // cột chủ nhật bị ẩn: gửi rỗng
          if (s.length > maxChars()) s = s.slice(0, maxChars());
          let bytes = enc.encode(s);
          // an toàn: cắt theo KÝ TỰ cho tới khi lọt 27 byte + NUL
          while (bytes.length > CELL - 1) {
            s = s.slice(0, -1);
            bytes = enc.encode(s);
          }
          buf.set(bytes, ((b * ROWS + r) * DAYS_N + d) * CELL);
        }
      }
    }
    return buf;
  }

  /* ---- đợi máy trả lời (main.js chuyển mọi thông báo 'tkb=…' vào đây) ---- */
  let tkbWait = null;   // { want, resolve }
  function ttOnMsg(msg) {
    const v = msg.substring(4);   // 'rdy' | 'err' | 'done'
    if (tkbWait) {
      const w = tkbWait; tkbWait = null;
      w.resolve(v === w.want);
    }
  }
  function waitTkb(want, ms) {
    return new Promise(resolve => {
      let done = false;
      const fin = (ok) => { if (!done) { done = true; resolve(ok); } };
      tkbWait = { want, resolve: fin };
      setTimeout(() => { if (tkbWait && tkbWait.resolve === fin) tkbWait = null; fin(false); }, ms);
    });
  }

  /* ---- các nút ---- */
  async function ttSend() {
    if (!window.__fwTKB) {
      alert('Firmware của máy chưa có chế độ «Thời khóa biểu».\n\n'
            + 'Cần bản 4.2" ba màu từ v2.5, hoặc bốn màu từ v3.6 — hãy cập nhật ở mục OTA bên dưới.');
      return;
    }
    const nAM = rowsUsed('am'), nPM = rowsUsed('pm');
    if (nAM + nPM === 0) { alert('Bảng đang trống — hãy nhập ít nhất một môn học.'); return; }
    const buf = serialize();
    const flags = (st.six ? 1 : 0) | (st.header ? 2 : 0);
    const mtu = Number(document.getElementById('mtusize').value) || 20;
    const chunk = Math.max(16, mtu - 6);
    save();
    syncOverlayShow('Đang gửi thời khóa biểu…',
      'Máy xóa vùng flash của bảng trước, xong mới nhận dữ liệu.');
    try {
      // GÓI MỞ KHÔNG mang dữ liệu: máy phải xóa một sector flash (vài trăm ms)
      // rồi mới báo 'tkb=rdy'. Bắn dữ liệu trong lúc nó còn xóa thì gói dồn
      // đống làm cạn MSG heap của BLE và MÁY RESET (đã dính thật 2026-08-21;
      // đúng cái bẫy mà đường gửi ảnh đã sửa ở firmware v1.6).
      if (!await write(EpdCmd.TIMETABLE, [0x00, flags, nAM, nPM])) return;
      if (!await waitTkb('rdy', 6000)) {
        addLog('Máy không báo sẵn sàng nhận thời khóa biểu (tkb=rdy) — thử lại.');
        return;
      }
      syncOverlayStep('Đang gửi thời khóa biểu…',
        'Bảng ' + buf.length + ' byte được chẻ nhỏ rồi ghi vào vùng flash riêng của máy.');
      for (let off = 0; off < buf.length; off += chunk) {
        const part = buf.slice(off, off + chunk);
        const pkt = new Uint8Array(1 + part.length);
        pkt[0] = 0x01; pkt.set(part, 1);
        if (!await write(EpdCmd.TIMETABLE, pkt)) return;
        syncOverlayProgress(off + part.length, buf.length);
      }
      if (!await waitTkb('done', 8000)) {
        addLog("Gửi hết mảnh nhưng máy chưa báo 'tkb=done' — hãy kiểm tra lại màn hình rồi gửi lại nếu cần.");
        return;
      }
      addLog("Đã gửi xong thời khóa biểu (thiết bị báo lại 'tkb=done').");
      addLog('Máy tự chuyển sang màn hình «Thời khóa biểu» và vẽ lại sau ~25 giây.');
      if (typeof highlightMode === 'function') highlightMode(24);
    } finally {
      syncOverlayHide();
    }
  }

  const SAMPLE_AM = [
    ['Chào cờ', 'Toán', 'Văn', 'Anh', 'Toán', 'Văn', ''],
    ['Toán', 'Lý', 'Toán', 'Văn', 'Hóa', 'Anh', ''],
    ['Văn', 'Văn', 'Hóa', 'Toán', 'Sinh', 'Toán', ''],
    ['Anh', 'Sử', 'Địa', 'Lý', 'Văn', 'Tin', ''],
    ['Sinh', 'Tin', 'Anh', 'GDCD', 'Nhạc', 'SHL', '']
  ];
  const SAMPLE_PM = [
    ['Thể dục', 'Toán', 'Lý', 'Văn', 'Anh', '', ''],
    ['Hội họa', 'Anh', 'Hóa', 'Toán', 'Cnghệ', '', ''],
    ['', 'Tự học', '', 'Ôn tập', '', '', ''],
    ['', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '']
  ];

  function ttSample() {
    const mc = maxChars();
    st.am = SAMPLE_AM.map(r => r.map(v => v.slice(0, mc)));
    st.pm = SAMPLE_PM.map(r => r.map(v => v.slice(0, mc)));
    buildGrid(); draw(); save();
  }
  function ttClear() {
    const b = blank();
    st.am = b.am; st.pm = b.pm;
    buildGrid(); draw(); save();
  }
  function ttOptChanged() {
    const s6 = document.getElementById('tkbSixDay'), sh = document.getElementById('tkbHeader');
    st.six = !!(s6 && s6.checked);
    st.header = !(sh && !sh.checked);
    // đổi số cột là đổi luôn số ký tự cho phép -> cắt lại nội dung đang có
    const mc = maxChars();
    ['am', 'pm'].forEach(b => st[b].forEach(r => r.forEach((v, i) => { r[i] = String(v || '').slice(0, mc); })));
    buildGrid(); draw(); save();
  }

  // main.js gọi sau khi biết phiên bản firmware của máy vừa kết nối
  function ttFwUpdate() {
    const fs = document.getElementById('tkbFieldset');
    if (fs) fs.style.display = window.__fwTKB ? '' : 'none';
    const dev = devName();
    if (dev && dev !== lastDev) {   // đổi máy: nạp bảng đã lưu của máy đó
      lastDev = dev;
      load();
      syncOpts();
      buildGrid();
    }
    // thẻ mode 24 bị ẩn lúc dựng gallery (chưa biết firmware) — cho hiện lại
    if (window.refreshModeGallery) window.refreshModeGallery();
    draw();
  }
  function syncOpts() {
    const s6 = document.getElementById('tkbSixDay'), sh = document.getElementById('tkbHeader');
    if (s6) s6.checked = st.six;
    if (sh) sh.checked = st.header;
  }

  function init() {
    if (!document.getElementById('tkbGridMount')) return false;
    load();
    syncOpts();
    buildGrid();
    draw();
    /* Thẻ «Thời khoá biểu» trong gallery vẽ bằng chính hàm của file này, mà
     * file này khởi tạo SAU khi gallery đã dựng — thiếu lượt vẽ lại thì thẻ ấy
     * TRẮNG TRƠN cho tới lần làm mới định kỳ (60 giây) hoặc tới lúc kết nối. */
    if (window.refreshModeGallery) window.refreshModeGallery();
    return true;
  }

  // fragment của app được nạp động: thử ngay, không có thì đợi DOM
  if (!init()) document.addEventListener('DOMContentLoaded', init);
  setTimeout(init, 300);   // connector.js nạp fragment sau khi script chạy

  window.ttSend = ttSend;
  window.ttSample = ttSample;
  window.ttClear = ttClear;
  window.ttOptChanged = ttOptChanged;
  window.ttFwUpdate = ttFwUpdate;
  window.ttOnMsg = ttOnMsg;      // main.js chuyển thông báo 'tkb=…' vào đây
  // thẻ mode 24 trong gallery dùng lại đúng hàm vẽ này
  window.ttRenderPreview = render;
})();
