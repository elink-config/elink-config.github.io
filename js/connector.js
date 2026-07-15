// Hub for the combined 4.2" / 2.13" / 2.9" / DLG-CLOCK webtool.
//
// The page starts with only the [KÃ¡ÂºÂ¿t nÃ¡Â»â€˜i Bluetooth] fieldset. This script
// owns the connect button: it scans with the 'DIY-' and 'DLG-CLOCK-' name
// prefixes, detects the device type from the advertised name, then
// instantiates the matching app (HTML from its <template>, scripts from
// js/4_2, js/2_13, js/2_9 or js/dlg) and hands the already-selected device
// over to the app's own connect().
//
// Each app's scripts are the unmodified per-device tools, so they are only
// loaded once and only one type can be active per page load Ã¢â‚¬â€ connecting a
// device of another type afterwards requires a page reload (the hub asks).
(function () {
  'use strict';

  const VER = '20260715c'; // cache-buster, keep in sync with index.html

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
      label: '4.2" (400Ãƒâ€”300)',
      sub: 'DA14585 Ã¢â‚¬â€ 4.2" (400Ãƒâ€”300): kÃ¡ÂºÂ¿t nÃ¡Â»â€˜i, cÃ¡ÂºÂ¥u hÃƒÂ¬nh vÃƒÂ  truyÃ¡Â»Ân hÃƒÂ¬nh Ã¡ÂºÂ£nh',
      template: 'tpl-4_2',
      scripts: ['js/dithering.js', 'js/paint.js', 'js/crop.js',
        'js/4_2/mode_preview.js', 'js/4_2/designer.js', 'js/4_2/main.js'],
    },
    '2_13': {
      label: '2.13" (212Ãƒâ€”104)',
      sub: 'DA14585 Ã¢â‚¬â€ 2.13" (212Ãƒâ€”104): kÃ¡ÂºÂ¿t nÃ¡Â»â€˜i, cÃ¡ÂºÂ¥u hÃƒÂ¬nh vÃƒÂ  truyÃ¡Â»Ân hÃƒÂ¬nh Ã¡ÂºÂ£nh',
      template: 'tpl-2_13',
      scripts: ['js/dithering.js', 'js/paint.js', 'js/crop.js',
        'js/2_13/designer.js', 'js/2_13/mode_preview.js', 'js/2_13/main.js'],
    },
    '2_9': {
      label: '2.9" (296Ãƒâ€”128)',
      sub: 'DA14585 Ã¢â‚¬â€ 2.9" (296Ãƒâ€”128 BWR): kÃ¡ÂºÂ¿t nÃ¡Â»â€˜i, cÃ¡ÂºÂ¥u hÃƒÂ¬nh vÃƒÂ  truyÃ¡Â»Ân hÃƒÂ¬nh Ã¡ÂºÂ£nh',
      template: 'tpl-2_9',
      scripts: ['js/dithering.js', 'js/paint.js', 'js/crop.js',
        'js/2_9/designer.js', 'js/2_9/mode_preview.js', 'js/2_9/main.js'],
    },
    'dlg': {
      label: 'Ã„ÂÃ¡Â»â€œng hÃ¡Â»â€œ DLG-CLOCK',
      sub: 'Ã„ÂÃ¡Â»â€œng hÃ¡Â»â€œ E-Ink DLG-CLOCK: Ã„â€˜Ã¡ÂºÂ·t giÃ¡Â»Â, Ã„â€˜Ã¡ÂºÂ¿m ngÃ†Â°Ã¡Â»Â£c, truyÃ¡Â»Ân hÃƒÂ¬nh Ã¡ÂºÂ£nh vÃƒÂ  thiÃ¡ÂºÂ¿t kÃ¡ÂºÂ¿ mÃ¡ÂºÂ«u',
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

  // DIY-2_13-xxxx Ã¢â€ â€™ 2.13", DIY-2_9-xxxx Ã¢â€ â€™ 2.9", DIY-4_2-xxxx Ã¢â€ â€™ 4.2",
  // DLG-CLOCK-xxxx Ã¢â€ â€™ Ã„â€˜Ã¡Â»â€œng hÃ¡Â»â€œ DLG.
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
  // dynamically loaded main.js Ã¢â‚¬â€ they only exist after loadApp(), so every
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
      s.onerror = () => reject(new Error('KhÃƒÂ´ng tÃ¡ÂºÂ£i Ã„â€˜Ã†Â°Ã¡Â»Â£c ' + src));
      document.body.appendChild(s);
    });
  }

  async function loadApp(type) {
    const cfg = APPS[type];
    addLog('ThiÃ¡ÂºÂ¿t bÃ¡Â»â€¹ loÃ¡ÂºÂ¡i ' + cfg.label + ' Ã¢â‚¬â€ Ã„â€˜ang tÃ¡ÂºÂ£i giao diÃ¡Â»â€¡n Ã„â€˜iÃ¡Â»Âu khiÃ¡Â»Æ’n...');

    // instantiate the app's sections (templates keep the duplicate element
    // ids of the apps out of the document until one is chosen)
    const tpl = document.getElementById(cfg.template);
    document.getElementById('appMount').appendChild(tpl.content.cloneNode(true));
    document.body.classList.add('app-' + type);

    for (const src of cfg.scripts) {
      await loadScript(src);
    }

    // the app assigns its init to document.body.onload, which never fires for
    // dynamically loaded scripts Ã¢â‚¬â€ run it manually
    if (typeof document.body.onload === 'function') {
      document.body.onload();
      document.body.onload = null;
    }

    // the app's main.js overwrote window.preConnect with its own (it filters
    // by its own name prefix only) Ã¢â‚¬â€ take the connect button back so device
    // type keeps being checked on later connections
    appPreConnect = window.preConnect;
    window.preConnect = hubPreConnect;

    // wrap the app's disconnect so the per-device sections hide again on any
    // disconnect path (button press or connection drop) Ã¢â‚¬â€ function
    // declarations share the global binding, so the app's own
    // gattserverdisconnected listeners also reach this wrapper
    const appDisconnect = window.disconnect;
    window.disconnect = function () {
      hideSections();
      if (typeof appDisconnect === 'function') return appDisconnect.apply(this, arguments);
    };

    // and re-reveal them when the app's own "KÃ¡ÂºÂ¿t nÃ¡Â»â€˜i lÃ¡ÂºÂ¡i" button succeeds
    const appReConnect = window.reConnect;
    if (typeof appReConnect === 'function') {
      window.reConnect = async function () {
        const r = await appReConnect.apply(this, arguments);
        if (isConnected()) revealSections();
        return r;
      };
    }

    // the DIY apps redefine addLog identically; the DLG tool's version wrote
    // raw innerHTML Ã¢â‚¬â€ keep the hub's styled log for a consistent look
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
        addLog('KhÃƒÂ´ng tÃƒÂ¬m thÃ¡ÂºÂ¥y thiÃ¡ÂºÂ¿t bÃ¡Â»â€¹ E-Ink (DIY-4_2-xxxx / DIY-2_13-xxxx / DIY-2_9-xxxx / DLG-CLOCK-xxxx)');
      } else if (e.message) {
        addLog('requestDevice: ' + e.message);
      }
      addLog('KiÃ¡Â»Æ’m tra Bluetooth Ã„â€˜ÃƒÂ£ bÃ¡ÂºÂ­t vÃƒÂ  trÃƒÂ¬nh duyÃ¡Â»â€¡t hÃ¡Â»â€” trÃ¡Â»Â£ Web Bluetooth! KhuyÃƒÂªn dÃƒÂ¹ng:');
      addLog('Ã¢â‚¬Â¢ MÃƒÂ¡y tÃƒÂ­nh: Chrome/Edge');
      addLog('Ã¢â‚¬Â¢ Android: Chrome/Edge');
      addLog('Ã¢â‚¬Â¢ iOS: trÃƒÂ¬nh duyÃ¡Â»â€¡t Bluefy');
      return;
    }

    let type = detectType(device.name);
    if (!type && isDebugMode()) {
      // debug mode lists every BLE device; fall back to probing the GATT
      // services when the name gives no hint
      addLog('TÃƒÂªn "' + (device.name || '?') + '" khÃƒÂ´ng nhÃ¡ÂºÂ­n dÃ¡ÂºÂ¡ng Ã„â€˜Ã†Â°Ã¡Â»Â£c Ã¢â‚¬â€ dÃƒÂ² dÃ¡Â»â€¹ch vÃ¡Â»Â¥ GATT...');
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
        addLog('KhÃƒÂ´ng kÃ¡ÂºÂ¿t nÃ¡Â»â€˜i Ã„â€˜Ã†Â°Ã¡Â»Â£c Ã„â€˜Ã¡Â»Æ’ dÃƒÂ² loÃ¡ÂºÂ¡i thiÃ¡ÂºÂ¿t bÃ¡Â»â€¹: ' + e.message);
        return;
      }
    }
    if (!type) {
      addLog('ThiÃ¡ÂºÂ¿t bÃ¡Â»â€¹ "' + (device.name || '?') + '" khÃƒÂ´ng phÃ¡ÂºÂ£i DIY-4_2-xxxx / DIY-2_13-xxxx / DIY-2_9-xxxx / DLG-CLOCK-xxxx.');
      return;
    }

    if (hubApp && type !== hubApp) {
      if (confirm('ThiÃ¡ÂºÂ¿t bÃ¡Â»â€¹ ' + device.name + ' thuÃ¡Â»â„¢c loÃ¡ÂºÂ¡i ' + APPS[type].label +
        ', khÃƒÂ¡c vÃ¡Â»â€ºi loÃ¡ÂºÂ¡i Ã„â€˜ang mÃ¡Â»Å¸ (' + APPS[hubApp].label + ').\nTÃ¡ÂºÂ£i lÃ¡ÂºÂ¡i trang Ã„â€˜Ã¡Â»Æ’ chuyÃ¡Â»Æ’n loÃ¡ÂºÂ¡i thiÃ¡ÂºÂ¿t bÃ¡Â»â€¹?')) {
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
        addLog('LÃ¡Â»â€”i tÃ¡ÂºÂ£i giao diÃ¡Â»â€¡n: ' + e.message);
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
  window.reConnect = function () { addLog('ChÃ†Â°a kÃ¡ÂºÂ¿t nÃ¡Â»â€˜i thiÃ¡ÂºÂ¿t bÃ¡Â»â€¹ nÃƒÂ o.'); };
  window.sendcmd = function () { addLog('ChÃ†Â°a kÃ¡ÂºÂ¿t nÃ¡Â»â€˜i thiÃ¡ÂºÂ¿t bÃ¡Â»â€¹ nÃƒÂ o.'); };

  function hubInit() {
    document.getElementById('reconnectbutton').disabled = true;
    document.getElementById('sendcmdbutton').disabled = true;

    // same ?debug=true handling as the apps' checkDebugMode(); they re-run
    // it in their init and reach the same state
    const link = document.getElementById('debug-toggle');
    if (isDebugMode()) {
      document.body.classList.add('dark-mode');
      link.innerHTML = 'ChÃ¡ÂºÂ¿ Ã„â€˜Ã¡Â»â„¢ thÃ†Â°Ã¡Â»Âng';
      link.setAttribute('href', window.location.pathname);
      addLog('ChÃƒÂº ÃƒÂ½: chÃ¡ÂºÂ¿ Ã„â€˜Ã¡Â»â„¢ dev Ã„â€˜ÃƒÂ£ bÃ¡ÂºÂ­t! KhÃƒÂ´ng hiÃ¡Â»Æ’u thÃƒÂ¬ Ã„â€˜Ã¡Â»Â«ng chÃ¡Â»â€°nh sÃ¡Â»Â­a tÃƒÂ¹y tiÃ¡Â»â€¡n!');
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
        addLog('Xem trÃ†Â°Ã¡Â»â€ºc giao diÃ¡Â»â€¡n ' + APPS[appParam].label + ' (chÃ†Â°a kÃ¡ÂºÂ¿t nÃ¡Â»â€˜i thiÃ¡ÂºÂ¿t bÃ¡Â»â€¹).');
      }).catch((e) => {
        console.error(e);
        addLog('LÃ¡Â»â€”i tÃ¡ÂºÂ£i giao diÃ¡Â»â€¡n: ' + e.message);
      }).finally(() => { loading = false; });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hubInit);
  else hubInit();
})();
