// Hub for the combined 4.2" / 2.13" / 2.9" / DLG-CLOCK webtool.
//
// The page starts with only the [Kết nối Bluetooth] fieldset. This script
// owns the connect button: it scans with the 'DIY-' and 'DLG-CLOCK-' name
// prefixes, detects the device type from the advertised name, then
// instantiates the matching app (HTML from its <template>, scripts from
// js/4_2, js/2_13, js/2_9 or js/dlg) and hands the already-selected device
// over to the app's own connect().
//
// Each app's scripts are the unmodified per-device tools, so they are only
// loaded once and only one type can be active per page load — connecting a
// device of another type afterwards requires a page reload (the hub asks).
(function () {
  'use strict';

  const VER = '20260719a'; // cache-buster, keep in sync with index.html

  const EPD42_SERVICE = '62750001-d828-918d-fb46-b6c11c675aec';
  const HM213_SERVICE = '0000ff00-0000-1000-8000-00805f9b34fb';
  const DLG_EPD_SERVICE = '13187b10-eba9-a3ba-044e-83d3217d9a38';
  const DLG_RXTX_SERVICE = '00001f10-0000-1000-8000-00805f9b34fb';
  const DLG_OTA_SERVICE = '0000221f-0000-1000-8000-00805f9b34fb';
  // union of all apps' services, so the permission granted by the chooser
  // covers whichever app ends up being loaded
  const ALL_SERVICES = [EPD42_SERVICE, HM213_SERVICE, DLG_EPD_SERVICE, DLG_RXTX_SERVICE, DLG_OTA_SERVICE];

  const APPS = {
    '4_2': {
      label: '4.2" (400×300)',
      sub: 'DA14585 — 4.2" (400×300): kết nối, cấu hình và truyền hình ảnh',
      template: 'tpl-4_2',
      scripts: ['js/dithering.js', 'js/paint.js', 'js/crop.js',
        'js/4_2/mode_preview.js', 'js/4_2/designer.js', 'js/4_2/main.js'],
    },
    '2_13': {
      label: '2.13" (212×104)',
      sub: 'DA14585 — 2.13" (212×104): kết nối, cấu hình và truyền hình ảnh',
      template: 'tpl-2_13',
      scripts: ['js/dithering.js', 'js/paint.js', 'js/crop.js',
        'js/2_13/designer.js', 'js/2_13/mode_preview.js', 'js/2_13/main.js'],
    },
    '2_9': {
      label: '2.9" (296×128)',
      sub: 'DA14585 — 2.9" (296×128 BWR): kết nối, cấu hình và truyền hình ảnh',
      template: 'tpl-2_9',
      scripts: ['js/dithering.js', 'js/paint.js', 'js/crop.js',
        'js/2_9/designer.js', 'js/2_9/mode_preview.js', 'js/2_9/main.js'],
    },
    'dlg': {
      label: 'Đồng hồ DLG-CLOCK',
      sub: 'Đồng hồ E-Ink DLG-CLOCK: đặt giờ, đếm ngược, truyền hình ảnh và thiết kế mẫu',
      template: 'tpl-dlg',
      scripts: ['js/dlg/image.js', 'js/dlg/qrcode.min.js', 'js/dlg/main.js', 'js/dlg/editor.js'],
    },
  };

  let hubApp = null;        // '4_2' | '2_13' | 'dlg' once an app is instantiated
  let appPreConnect = null; // the loaded app's own preConnect (disconnect branch)
  let loading = false;
  let hubAddLog = null;     // the hub's styled addLog, re-installed after app load

  function isDebugMode() {
    return new URLSearchParams(window.location.search).get('debug') === 'true';
  }

  // DIY-2_13-xxxx → 2.13", DIY-2_9-xxxx → 2.9", DIY-4_2-xxxx → 4.2",
  // DLG-CLOCK-xxxx → đồng hồ DLG.
  // Plain DIY-xxxx = 4.2" board on older firmware without the size tag.
  function detectType(name) {
    name = name || '';
    if (name.startsWith('DLG-CLOCK-')) return 'dlg';
    if (name.startsWith('DIY-2_13-')) return '2_13';
    if (name.startsWith('DIY-2_9-')) return '2_9';
    if (name.startsWith('DIY-4_2-')) return '4_2';
    if (name.startsWith('DIY-')) return '4_2';
    return null;
  }

  // app globals (gattServer, bleDevice, ...) are top-level let bindings of the
  // dynamically loaded main.js — they only exist after loadApp(), so every
  // access from hub code is guarded
  function isConnected() {
    try {
      return typeof gattServer !== 'undefined' && gattServer != null && gattServer.connected;
    } catch (e) {
      return false;
    }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src + '?v=' + VER;
      s.async = false;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Không tải được ' + src));
      document.body.appendChild(s);
    });
  }

  async function loadApp(type) {
    const cfg = APPS[type];
    addLog('Thiết bị loại ' + cfg.label + ' — đang tải giao diện điều khiển...');

    // instantiate the app's sections (templates keep the duplicate element
    // ids of the apps out of the document until one is chosen)
    const tpl = document.getElementById(cfg.template);
    document.getElementById('appMount').appendChild(tpl.content.cloneNode(true));
    document.body.classList.add('app-' + type);

    for (const src of cfg.scripts) {
      await loadScript(src);
    }

    // the app assigns its init to document.body.onload, which never fires for
    // dynamically loaded scripts — run it manually
    if (typeof document.body.onload === 'function') {
      document.body.onload();
      document.body.onload = null;
    }

    // the app's main.js overwrote window.preConnect with its own (it filters
    // by its own name prefix only) — take the connect button back so device
    // type keeps being checked on later connections
    appPreConnect = window.preConnect;
    window.preConnect = hubPreConnect;

    // wrap the app's disconnect so the per-device sections hide again on any
    // disconnect path (button press or connection drop) — function
    // declarations share the global binding, so the app's own
    // gattserverdisconnected listeners also reach this wrapper
    const appDisconnect = window.disconnect;
    window.disconnect = function () {
      hideSections();
      if (typeof appDisconnect === 'function') return appDisconnect.apply(this, arguments);
    };

    // and re-reveal them when the app's own "Kết nối lại" button succeeds
    // (same activation gate as the first connection)
    const appReConnect = window.reConnect;
    if (typeof appReConnect === 'function') {
      window.reConnect = async function () {
        actMac = ''; actState = null; actResult = null;
        const r = await appReConnect.apply(this, arguments);
        if (isConnected()) {
          if (await checkActivation(hubApp)) revealSections();
          else actShow();
        }
        return r;
      };
    }

    // the DIY apps redefine addLog identically; the DLG tool's version wrote
    // raw innerHTML — keep the hub's styled log for a consistent look
    if (type === 'dlg') window.addLog = hubAddLog;

    // watch the log stream for the activation status the 4.2" firmware pushes
    // as notifications right after connecting ("mac=…", "act=on/off/ok/err")
    const appAddLog = window.addLog;
    window.addLog = function (msg) {
      actWatch(String(msg));
      return appAddLog.apply(this, arguments);
    };

    const sub = document.getElementById('app-header-sub');
    if (sub) sub.textContent = cfg.sub;

    hubApp = type;
  }

  function revealSections() {
    document.getElementById('appMount').classList.remove('hidden');
  }

  function hideSections() {
    document.getElementById('appMount').classList.add('hidden');
  }

  /* ---- activation gate --------------------------------------------------
     DIY firmware (2.13" and 4.2") ships LOCKED: every command except 0x26 is
     refused until the device accepts a 128-byte RSA signature of its own MAC
     (issued by the seller from tools/activation/activate.py). The hub checks
     the state right after connect() and, when locked, shows a popup with the
     MAC to send to the seller plus a box to paste the activation key.
     - 4.2": the device pushes "mac=…" + "act=on/off" notifications as soon as
       notifications are enabled (captured via the addLog wrapper above);
       submitting is write(0x26, sig) → "act=ok"/"act=err" notification.
     - 2.13": write [0x26] then read the characteristic back as text
       "mac=… act=on/off"; submitting is write([0x26,…sig]) → read "act=ok".
     DLG-CLOCK has its own activation UI in its template — not gated here. */

  let actMac = '';       // 12 hex chars from the device
  let actState = null;   // 'on' | 'off' from mac=/act= notifications (4.2")
  let actResult = null;  // 'ok' | 'err' after submitting a key (4.2")
  let actBusy = false;

  function actWatch(msg) {
    const m = msg.match(/mac=([0-9A-Fa-f]{12})/);
    if (m) actMac = m[1].toUpperCase();
    if (/\bact=on\b/.test(msg)) actState = 'on';
    else if (/\bact=off\b/.test(msg)) actState = 'off';
    else if (/\bact=ok\b/.test(msg)) actResult = 'ok';
    else if (/\bact=err\b/.test(msg)) actResult = 'err';
  }

  function actSleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function actWaitFor(get, timeoutMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const v = get();
      if (v != null) return v;
      await actSleep(100);
    }
    return null;
  }

  // reads the 2.13" activation status: write the 0x26 query, then read the
  // characteristic back — a locked/queried device answers with ASCII text
  async function act213Query() {
    await window.write([0x26], true);
    await actSleep(250);
    const v = await longValueChar.readValue();
    const s = new TextDecoder().decode(v);
    actWatch(s);
    return s;
  }

  // returns true when the device may be used (activated, or old firmware
  // that does not implement the activation handshake at all)
  async function checkActivation(type) {
    try {
      if (type === '2_13' || type === '2_9') {   // cùng giao thức HM 0xff00
        const s = await act213Query();
        return !/act=off/.test(s);
      }
      if (type === '4_2') {
        // the status burst arrives with the connect notifications; give a
        // slow link a moment before deciding
        const st = await actWaitFor(() => actState, 2500);
        return st !== 'off';
      }
    } catch (e) {
      console.error(e);
    }
    return true; // đừng chặn firmware cũ không có kích hoạt
  }

  function actShow() {
    document.getElementById('act-mac').value = actMac || '(không đọc được MAC)';
    document.getElementById('act-key').value = '';
    document.getElementById('act-key-hint').hidden = true;
    document.getElementById('act-submit').disabled = true;
    document.getElementById('act-form-view').hidden = false;
    document.getElementById('act-result-view').hidden = true;
    document.getElementById('act-overlay').hidden = false;
    addLog('Thiết bị chưa kích hoạt — gửi mã ' + actMac + ' cho người bán để nhận mã kích hoạt.');
  }

  function actHide() {
    document.getElementById('act-overlay').hidden = true;
  }

  function actDisconnect() {
    try {
      if (typeof bleDevice !== 'undefined' && bleDevice != null && bleDevice.gatt.connected)
        bleDevice.gatt.disconnect();
    } catch (e) { console.error(e); }
  }

  function actShowResult(ok) {
    document.getElementById('act-form-view').hidden = true;
    const view = document.getElementById('act-result-view');
    const title = document.getElementById('act-result-title');
    const text = document.getElementById('act-result-text');
    const btn = document.getElementById('act-result-btn');
    if (ok) {
      title.textContent = 'Kích hoạt thành công!';
      text.textContent = 'Thiết bị đã được kích hoạt và ghi nhớ vĩnh viễn — bấm nút bên dưới để tiếp tục cấu hình.';
      btn.textContent = 'Tiếp tục cấu hình';
      btn.onclick = function () {
        actHide();
        revealSections();
      };
    } else {
      title.textContent = 'Kích hoạt thất bại';
      text.textContent = 'Thiết bị từ chối mã kích hoạt (mã không khớp MAC của thiết bị?). Kiểm tra lại mã với người bán rồi kết nối lại để thử lần nữa. Thiết bị sẽ được ngắt kết nối.';
      btn.textContent = 'Đóng';
      btn.onclick = function () {
        actHide();
        actDisconnect();
        addLog('Đã ngắt kết nối — thiết bị chưa kích hoạt.');
      };
    }
    view.hidden = false;
  }

  // parse the pasted key: accepts the raw 256-hex signature, the full
  // "26 XX…" command from activate.py, spaces/newlines/colons anywhere
  function actParseKey(raw) {
    let hex = (raw || '').replace(/[^0-9A-Fa-f]/g, '');
    if (hex.length === 258 && hex.slice(0, 2).toLowerCase() === '26') hex = hex.slice(2);
    if (hex.length !== 256) return null;
    const sig = new Uint8Array(128);
    for (let i = 0; i < 128; i++) sig[i] = parseInt(hex.substr(i * 2, 2), 16);
    return sig;
  }

  async function actSubmit() {
    if (actBusy) return;
    const sig = actParseKey(document.getElementById('act-key').value);
    if (!sig) {
      document.getElementById('act-key-hint').hidden = false;
      return;
    }
    document.getElementById('act-key-hint').hidden = true;
    actBusy = true;
    const btn = document.getElementById('act-submit');
    btn.disabled = true;
    btn.textContent = 'Đang kích hoạt...';
    let ok = false;
    try {
      if (hubApp === '2_13' || hubApp === '2_9') {
        const payload = new Uint8Array(129);
        payload[0] = 0x26;
        payload.set(sig, 1);
        await window.write(payload, true);
        await actSleep(500);
        const s = new TextDecoder().decode(await longValueChar.readValue());
        actWatch(s);
        ok = /act=ok/.test(s);
      } else {
        actResult = null;
        await window.write(0x26, sig);   // app 4.2": write(cmd, data)
        const r = await actWaitFor(() => actResult, 4000);
        ok = r === 'ok';
      }
    } catch (e) {
      console.error(e);
      addLog('Lỗi gửi mã kích hoạt: ' + e.message);
      ok = false;
    }
    actBusy = false;
    btn.textContent = 'Kích hoạt';
    actShowResult(ok);
  }

  function actInitUi() {
    const keyEl = document.getElementById('act-key');
    keyEl.addEventListener('input', function () {
      document.getElementById('act-submit').disabled = keyEl.value.trim() === '';
      document.getElementById('act-key-hint').hidden = true;
    });
    document.getElementById('act-submit').addEventListener('click', actSubmit);
    document.getElementById('act-close').addEventListener('click', function () {
      actHide();
      actDisconnect();
      addLog('Đã đóng cửa sổ kích hoạt — thiết bị chưa kích hoạt nên đã ngắt kết nối.');
    });
    document.getElementById('act-copy').addEventListener('click', async function () {
      const macEl = document.getElementById('act-mac');
      macEl.select();
      try {
        await navigator.clipboard.writeText(macEl.value);
      } catch (e) {
        document.execCommand('copy');
      }
      const b = document.getElementById('act-copy');
      const old = b.textContent;
      b.textContent = 'Đã chép!';
      setTimeout(() => { b.textContent = old; }, 1500);
    });
  }
  /* ---- end activation gate ---------------------------------------------- */

  async function hubPreConnect() {
    if (loading) return;

    // an app is active and connected: the button means "disconnect"
    if (hubApp && isConnected()) {
      appPreConnect();
      return;
    }

    let device;
    try {
      device = await navigator.bluetooth.requestDevice(isDebugMode() ? {
        acceptAllDevices: true,
        optionalServices: ALL_SERVICES,
      } : {
        filters: [{ namePrefix: 'DIY-' }, { namePrefix: 'DLG-CLOCK-' }],
        optionalServices: ALL_SERVICES,
      });
    } catch (e) {
      console.error(e);
      if (e.name === 'NotFoundError') {
        addLog('Không tìm thấy thiết bị E-Ink (DIY-4_2-xxxx / DIY-2_13-xxxx / DIY-2_9-xxxx / DLG-CLOCK-xxxx)');
      } else if (e.message) {
        addLog('requestDevice: ' + e.message);
      }
      addLog('Kiểm tra Bluetooth đã bật và trình duyệt hỗ trợ Web Bluetooth! Khuyên dùng:');
      addLog('• Máy tính: Chrome/Edge');
      addLog('• Android: Chrome/Edge');
      addLog('• iOS: trình duyệt Bluefy');
      return;
    }

    let type = detectType(device.name);
    if (!type && isDebugMode()) {
      // debug mode lists every BLE device; fall back to probing the GATT
      // services when the name gives no hint
      addLog('Tên "' + (device.name || '?') + '" không nhận dạng được — dò dịch vụ GATT...');
      try {
        const gatt = await device.gatt.connect();
        try {
          await gatt.getPrimaryService(HM213_SERVICE);
          type = '2_13';
        } catch (e1) {
          try {
            await gatt.getPrimaryService(DLG_RXTX_SERVICE);
            type = 'dlg';
          } catch (e2) {
            type = '4_2';
          }
        }
      } catch (e) {
        console.error(e);
        addLog('Không kết nối được để dò loại thiết bị: ' + e.message);
        return;
      }
    }
    if (!type) {
      addLog('Thiết bị "' + (device.name || '?') + '" không phải DIY-4_2-xxxx / DIY-2_13-xxxx / DIY-2_9-xxxx / DLG-CLOCK-xxxx.');
      return;
    }

    if (hubApp && type !== hubApp) {
      if (confirm('Thiết bị ' + device.name + ' thuộc loại ' + APPS[type].label +
        ', khác với loại đang mở (' + APPS[hubApp].label + ').\nTải lại trang để chuyển loại thiết bị?')) {
        location.reload();
      }
      return;
    }

    if (!hubApp) {
      loading = true;
      try {
        await loadApp(type);
      } catch (e) {
        console.error(e);
        addLog('Lỗi tải giao diện: ' + e.message);
        return;
      } finally {
        loading = false;
      }
    }

    // hand the chosen device over to the app exactly like its own preConnect
    // does: reset state, set the app's bleDevice, then run its connect()
    actMac = ''; actState = null; actResult = null;
    window.resetVariables();
    bleDevice = device;
    bleDevice.addEventListener('gattserverdisconnected', window.disconnect);
    await window.connect();

    if (isConnected()) {
      if (await checkActivation(hubApp)) revealSections();
      else actShow();
    }
  }

  /* ---- minimal globals for the connect fieldset before an app is loaded
     (the DIY apps redefine addLog/clearLog identically on load) ---- */

  window.addLog = function (logTXT, action = '') {
    const log = document.getElementById('log');
    const now = new Date();
    const time = String(now.getHours()).padStart(2, '0') + ':' +
      String(now.getMinutes()).padStart(2, '0') + ':' +
      String(now.getSeconds()).padStart(2, '0') + ' ';

    const logEntry = document.createElement('div');
    const timeSpan = document.createElement('span');
    logEntry.className = 'log-line';
    timeSpan.className = 'time';
    timeSpan.textContent = time;
    logEntry.appendChild(timeSpan);

    if (action !== '') {
      const actionSpan = document.createElement('span');
      actionSpan.className = 'action';
      actionSpan.innerHTML = action;
      logEntry.appendChild(actionSpan);
    }
    logEntry.appendChild(document.createTextNode(logTXT));

    log.appendChild(logEntry);
    log.scrollTop = log.scrollHeight;

    while (log.childNodes.length > 20) {
      log.removeChild(log.firstChild);
    }
  };
  hubAddLog = window.addLog;

  window.clearLog = function () {
    document.getElementById('log').innerHTML = '';
  };

  window.preConnect = hubPreConnect;
  window.reConnect = function () { addLog('Chưa kết nối thiết bị nào.'); };
  window.sendcmd = function () { addLog('Chưa kết nối thiết bị nào.'); };

  function hubInit() {
    document.getElementById('reconnectbutton').disabled = true;
    document.getElementById('sendcmdbutton').disabled = true;
    actInitUi();

    // dev helper: ?debug=true&act=<MAC> opens the activation popup with a fake
    // MAC so the dialog can be checked without a locked device
    if (isDebugMode()) {
      const actParam = new URLSearchParams(window.location.search).get('act');
      if (actParam) { actMac = actParam.toUpperCase(); actShow(); }
    }

    // same ?debug=true handling as the apps' checkDebugMode(); they re-run
    // it in their init and reach the same state
    const link = document.getElementById('debug-toggle');
    if (isDebugMode()) {
      document.body.classList.add('dark-mode');
      link.innerHTML = 'Chế độ thường';
      link.setAttribute('href', window.location.pathname);
      addLog('Chú ý: chế độ dev đã bật! Không hiểu thì đừng chỉnh sửa tùy tiện!');
    } else {
      link.setAttribute('href', window.location.pathname + '?debug=true');
    }

    // dev helper: ?debug=true&app=4_2|2_13|2_9|dlg preloads an app's UI
    // without a device, so the layout can be checked without hardware
    const appParam = new URLSearchParams(window.location.search).get('app');
    if (isDebugMode() && appParam && APPS[appParam] && !hubApp) {
      loading = true;
      loadApp(appParam).then(() => {
        revealSections();
        addLog('Xem trước giao diện ' + APPS[appParam].label + ' (chưa kết nối thiết bị).');
      }).catch((e) => {
        console.error(e);
        addLog('Lỗi tải giao diện: ' + e.message);
      }).finally(() => { loading = false; });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hubInit);
  else hubInit();
})();
