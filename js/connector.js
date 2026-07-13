// Hub for the combined 4.2" / 2.13" / DLG-CLOCK webtool.
//
// The page starts with only the [Kết nối Bluetooth] fieldset. This script
// owns the connect button: it scans with the 'DIY-' and 'DLG-CLOCK-' name
// prefixes, detects the device type from the advertised name, then
// instantiates the matching app (HTML from its <template>, scripts from
// js/4_2, js/2_13 or js/dlg) and hands the already-selected device over to
// the app's own connect().
//
// Each app's scripts are the unmodified per-device tools, so they are only
// loaded once and only one type can be active per page load — connecting a
// device of another type afterwards requires a page reload (the hub asks).
(function () {
  'use strict';

  const VER = '20260713b'; // cache-buster, keep in sync with index.html

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

  // DIY-2_13-xxxx → 2.13", DIY-4_2-xxxx → 4.2", DLG-CLOCK-xxxx → đồng hồ DLG.
  // Plain DIY-xxxx = 4.2" board on older firmware without the size tag.
  function detectType(name) {
    name = name || '';
    if (name.startsWith('DLG-CLOCK-')) return 'dlg';
    if (name.startsWith('DIY-2_13-')) return '2_13';
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
    const appReConnect = window.reConnect;
    if (typeof appReConnect === 'function') {
      window.reConnect = async function () {
        const r = await appReConnect.apply(this, arguments);
        if (isConnected()) revealSections();
        return r;
      };
    }

    // the DIY apps redefine addLog identically; the DLG tool's version wrote
    // raw innerHTML — keep the hub's styled log for a consistent look
    if (type === 'dlg') window.addLog = hubAddLog;

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
        addLog('Không tìm thấy thiết bị E-Ink (DIY-4_2-xxxx / DIY-2_13-xxxx / DLG-CLOCK-xxxx)');
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
      addLog('Thiết bị "' + (device.name || '?') + '" không phải DIY-4_2-xxxx / DIY-2_13-xxxx / DLG-CLOCK-xxxx.');
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
    window.resetVariables();
    bleDevice = device;
    bleDevice.addEventListener('gattserverdisconnected', window.disconnect);
    await window.connect();

    if (isConnected()) revealSections();
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

    // dev helper: ?debug=true&app=4_2|2_13|dlg preloads an app's UI without a
    // device, so the layout can be checked without hardware
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
