/*
 * Kho thiết kế của chế độ «Tự thiết kế» — dùng chung cho MỌI webtool.
 *
 * Giải quyết: nhiều máy cùng cỡ màn dùng chung một trình duyệt thì trước đây
 * chuyển sang máy khác là mất thiết kế (localStorage chỉ có MỘT bản nháp).
 * Nay mỗi TÊN THIẾT BỊ giữ một bản riêng: kết nối máy nào tự nạp lại thiết kế
 * của máy đó, gửi xong tự lưu; thêm xuất/nhập file .diy để sao lưu hoặc gửi
 * cho người khác.
 *
 * Yêu cầu designer.js cung cấp:
 *   window.dsGetState()      -> object trạng thái (widgets/frame/text/icon)
 *   window.dsSetState(obj)   -> nạp trạng thái, vẽ lại; trả true nếu hợp lệ
 * Phải nạp SAU designer.js (bọc window.dsUpload để tự lưu sau khi gửi).
 */
(function () {
  'use strict';

  const LS_KEY = 'diyStore.v1';   // { "<tên thiết bị>": { savedAt, state } }
  const FILE_MAGIC = 'elink-diy';
  const FILE_VER = 1;

  let lastSeenDev = '';           // tên máy của lần dò trước (phát hiện kết nối mới)
  let autoLoaded = {};            // tên máy đã tự nạp trong phiên này

  /* MÃ MÁY của app đang mở — dùng để lọc danh sách. Lấy từ móc thiết bị của
     * bộ dựng, hoặc từ hồ sơ máy; không có thì trả rỗng (bản lưu cũ). */
    function mayKey() {
    try {
      if (window.EPD_DS_DEVICE && window.EPD_DS_DEVICE.key) return window.EPD_DS_DEVICE.key;
      if (window.EPD_PROFILE && window.EPD_PROFILE.may) return window.EPD_PROFILE.may;
    } catch (e) {}
    return '';
  }

  /* Khổ màn hiện tại — lưới an toàn thứ hai khi nạp. */
  function manSize() {
    try {
      if (window.EPD_DS_DEVICE && window.EPD_DS_DEVICE.size) return window.EPD_DS_DEVICE.size();
      if (window.EPD_PROFILE) return { w: window.EPD_PROFILE.rong, h: window.EPD_PROFILE.cao };
    } catch (e) {}
    return null;
  }

  /* «DIY-2_9N-AB12» -> «DIY-2_9N-». Dùng cho bản lưu ĐỜI CŨ chưa ghi mã máy:
   * cùng tiền tố thì cùng dòng máy. */
  function tienTo(name) {
    const i = String(name || '').lastIndexOf('-');
    return i > 0 ? name.slice(0, i + 1) : '';
  }

  /* Bản lưu này có thuộc máy đang mở không? */
  function hopMay(name, rec) {
    const may = mayKey();
    /* CẢ HAI bên đều biết mã máy -> so mã, chắc chắn nhất. */
    if (may && rec && rec.may) return rec.may === may;
    /* Thiếu một bên (bản lưu đời cũ, hoặc app chưa khai mã như 2.9" cũ /
     * 7.3" / 7.5") -> so TIỀN TỐ tên thiết bị: cùng tiền tố là cùng dòng máy. */
    const dev = devName();
    if (dev) return tienTo(name) === tienTo(dev);
    /* Chưa kết nối và cũng không có mã -> không đủ căn cứ, ẨN đi cho chắc.
     * Thà danh sách trống còn hơn bày ra một bản lưu của máy khác. */
    return false;
  }

  function devName() {
    try {
      return (typeof bleDevice !== 'undefined' && bleDevice && bleDevice.name) || '';
    } catch (e) { return ''; }
  }
  function connected() {
    try { return typeof gattServer !== 'undefined' && gattServer != null && gattServer.connected; } catch (e) { return false; }
  }
  function log(m) { if (typeof addLog === 'function') addLog(m); }

  function readAll() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { return {}; }
  }
  function writeAll(o) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(o)); return true; } catch (e) {
      log('Không lưu được thiết kế (bộ nhớ trình duyệt đầy?): ' + e.message);
      return false;
    }
  }

  function isEmpty(s) { return !s || !s.widgets || !s.widgets.length; }

  // nút «Gửi lên thiết bị» của designer — id khác nhau giữa các dòng máy
  // (họ 4.2: uploadlayoutbutton, họ 2.13/2.9: dsuploadbutton)
  function anchorBtn() {
    return document.getElementById('uploadlayoutbutton') || document.getElementById('dsuploadbutton');
  }

  // ---- lưu / nạp theo tên thiết bị ----

  function saveFor(name, quiet) {
    if (!name) { if (!quiet) alert('Chưa kết nối thiết bị — hãy kết nối để lưu theo tên máy, hoặc dùng «Xuất .diy».'); return false; }
    const st = window.dsGetState && window.dsGetState();
    if (isEmpty(st)) { if (!quiet) alert('Thiết kế còn trống — chưa có gì để lưu.'); return false; }
    const all = readAll();
    const sz = manSize();
    all[name] = {
      savedAt: Date.now(),
      may: mayKey(),                        // để lần sau lọc đúng máy
      w: sz ? sz.w : 0, h: sz ? sz.h : 0,   // để từ chối nạp nhầm khổ màn
      state: st,
    };
    if (!writeAll(all)) return false;
    if (!quiet) log('Đã lưu thiết kế cho «' + name + '».');
    refreshUi();
    return true;
  }

  function loadFor(name, quiet) {
    const rec = readAll()[name];
    if (!rec || !rec.state) { if (!quiet) alert('Chưa có thiết kế nào lưu cho «' + name + '».'); return false; }
    /* Lưới an toàn thứ hai: kể cả lọt qua bộ lọc danh sách (bản lưu đời cũ,
     * nhập từ file .diy...) thì khác khổ màn vẫn phải TỪ CHỐI — toạ độ của màn
     * khác rơi vào đây là bố cục vỡ, mà người dùng chỉ thấy sau khi đã gửi. */
    {
      const sz = manSize();
      if (sz && rec.w && rec.h && (rec.w !== sz.w || rec.h !== sz.h)) {
        if (!quiet)
          alert('Bản lưu này của màn ' + rec.w + '×' + rec.h + ', còn máy đang mở là ' +
                sz.w + '×' + sz.h + '.\n\nNạp vào sẽ vỡ bố cục nên đã dừng lại.');
        return false;
      }
    }
    if (!window.dsSetState || !window.dsSetState(rec.state)) {
      if (!quiet) alert('Bản lưu không dùng được với trang này (khác loại màn hình?).');
      return false;
    }
    log('Đã nạp thiết kế đã lưu của «' + name + '» (' + new Date(rec.savedAt).toLocaleString() + ').');
    refreshUi();
    return true;
  }

  function removeFor(name) {
    const all = readAll();
    if (!all[name]) return;
    if (!confirm('Xóa thiết kế đã lưu của «' + name + '»?')) return;
    delete all[name];
    writeAll(all);
    log('Đã xóa bản lưu của «' + name + '».');
    refreshUi();
  }

  // ---- xuất / nhập file .diy ----

  function exportFile() {
    const st = window.dsGetState && window.dsGetState();
    if (isEmpty(st)) { alert('Thiết kế còn trống — chưa có gì để xuất.'); return; }
    const name = devName();
    const doc = {
      app: FILE_MAGIC,
      v: FILE_VER,
      device: name,
      tool: (location.pathname.replace(/\/$/, '').split('/').pop() || 'hub'),
      savedAt: new Date().toISOString(),
      state: st,
    };
    const blob = new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.download = (name || 'thiet-ke') + '.diy';
    a.href = URL.createObjectURL(blob);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    log('Đã xuất file ' + a.download + '.');
  }

  function importFile(input) {
    const f = input.files && input.files[0];
    input.value = '';
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      let doc;
      try { doc = JSON.parse(rd.result); } catch (e) { alert('File .diy hỏng (không đọc được nội dung).'); return; }
      const st = doc && (doc.state || (doc.widgets ? doc : null));
      if (!doc || (doc.app && doc.app !== FILE_MAGIC) || !st) { alert('Đây không phải file thiết kế .diy hợp lệ.'); return; }
      if (!window.dsSetState || !window.dsSetState(st)) {
        alert('Thiết kế trong file không dùng được với trang này (khác loại màn hình?).');
        return;
      }
      log('Đã nhập thiết kế từ ' + f.name + (doc.device ? ' (máy gốc: ' + doc.device + ')' : '') + '.');
      refreshUi();
    };
    rd.readAsText(f);
  }

  // ---- giao diện: tự chèn một hàng nút vào khung «Thiết kế màn hình» ----

  let ui = null;

  function buildUi() {
    if (ui) return ui;
    const anchor = anchorBtn();
    if (!anchor) return null;
    const host = anchor.closest('.flex-group') || anchor.parentElement;
    if (!host || !host.parentElement) return null;

    const row = document.createElement('div');
    row.className = 'flex-group';
    row.style.flex = '1 1 100%';
    row.id = 'diyStoreRow';
    row.innerHTML =
      '<span>Kho thiết kế:</span>' +
      '<select id="diyPick" style="max-width:220px"></select>' +
      '<button type="button" class="secondary" id="diyLoad">Nạp</button>' +
      '<button type="button" class="secondary" id="diySave">Lưu cho máy này</button>' +
      '<button type="button" class="secondary" id="diyDel">Xóa bản lưu</button>' +
      '<button type="button" class="secondary" id="diyExport">Xuất .diy</button>' +
      '<button type="button" class="secondary" id="diyImportBtn">Nhập .diy</button>' +
      '<input type="file" id="diyImport" accept=".diy,.json,application/json" style="display:none">' +
      '<span class="mode-gallery-hint" style="margin:0" id="diyHint"></span>';
    host.parentElement.insertBefore(row, host);

    row.querySelector('#diyLoad').onclick = () => {
      const n = row.querySelector('#diyPick').value;
      if (n) loadFor(n);
    };
    row.querySelector('#diySave').onclick = () => saveFor(devName());
    row.querySelector('#diyDel').onclick = () => {
      const n = row.querySelector('#diyPick').value;
      if (n) removeFor(n);
    };
    row.querySelector('#diyExport').onclick = exportFile;
    row.querySelector('#diyImportBtn').onclick = () => row.querySelector('#diyImport').click();
    row.querySelector('#diyImport').onchange = function () { importFile(this); };

    ui = row;
    return ui;
  }

  function refreshUi() {
    const row = buildUi();
    if (!row) return;
    const all = readAll();
    /* CHỈ bày bản lưu của máy đang mở. Trước đây bày tất cả, nên đang cắm màn
     * 2.9" vẫn thấy bản lưu của màn 4.2" — nạp vào là vỡ bố cục vì toạ độ của
     * màn 400x300 rơi vào màn 296x128. */
    const names = Object.keys(all).filter(k => hopMay(k, all[k])).sort();
    const pick = row.querySelector('#diyPick');
    const cur = pick.value;
    const dev = devName();
    pick.innerHTML = names.length
      ? names.map(n => '<option value="' + n.replace(/"/g, '&quot;') + '">' + n +
          ' — ' + new Date(all[n].savedAt).toLocaleDateString() + '</option>').join('')
      : '<option value="">(chưa có bản lưu nào)</option>';
    // ưu tiên chọn đúng máy đang kết nối
    if (dev && all[dev]) pick.value = dev;
    else if (cur && all[cur]) pick.value = cur;
    row.querySelector('#diySave').disabled = !dev;
    row.querySelector('#diyDel').disabled = !names.length;
    row.querySelector('#diyLoad').disabled = !names.length;
    row.querySelector('#diyHint').textContent = dev
      ? (all[dev] ? 'Máy «' + dev + '» đã có bản lưu — gửi thiết kế xong sẽ tự cập nhật.'
                  : 'Máy «' + dev + '» chưa có bản lưu; gửi thiết kế xong sẽ tự lưu.')
      : 'Kết nối thiết bị để lưu/nạp theo tên máy; chưa kết nối vẫn xuất/nhập file được.';
  }

  // ---- tự lưu sau khi gửi + tự nạp khi kết nối máy đã có bản lưu ----

  function hookUpload() {
    if (typeof window.dsUpload !== 'function' || window.dsUpload.__diyHooked) return;
    const orig = window.dsUpload;
    const wrapped = async function () {
      const r = await orig.apply(this, arguments);
      const n = devName();
      if (n) saveFor(n, true);   // im lặng: coi như bản đang dùng của máy này
      refreshUi();
      return r;
    };
    wrapped.__diyHooked = true;
    window.dsUpload = wrapped;
  }

  function poll() {
    hookUpload();
    const dev = connected() ? devName() : '';
    if (dev !== lastSeenDev) {
      lastSeenDev = dev;
      refreshUi();
      if (dev && !autoLoaded[dev]) {
        const rec = readAll()[dev];
        if (rec) {
          autoLoaded[dev] = true;
          // chỉ tự nạp khi bản đang vẽ còn TRỐNG — không đè lên thiết kế dở dang
          if (isEmpty(window.dsGetState && window.dsGetState())) loadFor(dev, true);
          else log('Máy «' + dev + '» có thiết kế đã lưu — bấm «Nạp» ở Kho thiết kế nếu muốn dùng lại.');
        }
      }
    }
  }

  function init() {
    if (!anchorBtn()) return;  // trang không có designer
    refreshUi();
    hookUpload();
    setInterval(poll, 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
