// Hub v2: moi dong may mot fragment HTML rieng trong apps/ (4_2 / 4_2c /
// 7_5 / 2_13 / 2_9 / dlg). Nut [Ket noi] quet ten BLE, nhan dang dong may,
// fetch fragment cua app do vao #appMount roi nap js/<app>/ va trao thiet bi
// cho connect() cua app. Ho 4_2 (4_2 / 4_2c / 7_5) dung chung js/4_2/ —
// khac nhau o fragment (select driver, bang firmware rieng tung may).
(function () {
  'use strict';

  const VER = '20260826a'; // cache-buster, keep in sync with index.html

  const EPD42_SERVICE = '62750001-d828-918d-fb46-b6c11c675aec';
  const HM213_SERVICE = '0000ff00-0000-1000-8000-00805f9b34fb';
  const DLG_EPD_SERVICE = '13187b10-eba9-a3ba-044e-83d3217d9a38';
  const DLG_RXTX_SERVICE = '00001f10-0000-1000-8000-00805f9b34fb';
  const DLG_OTA_SERVICE = '0000221f-0000-1000-8000-00805f9b34fb';
  // union of all apps' services, so the permission granted by the chooser
  // covers whichever app ends up being loaded
  const ALL_SERVICES = [EPD42_SERVICE, HM213_SERVICE, DLG_EPD_SERVICE, DLG_RXTX_SERVICE, DLG_OTA_SERVICE];

  // THỨ TỰ Ở ĐÂY = thứ tự nút «Hoặc kết nối tới một thiết bị cụ thể»
  // (buildDevPicker duyệt bảng này). Mỗi dòng máy lọc bằng ĐÚNG tiền tố của
  // nó — tuyệt đối không gộp biến thể: 'DIY-7_5-' có gạch nối nên KHÔNG
  // khớp DIY-7_5B / DIY-7_5R, 'DIY-4_2-' không khớp DIY-4_2C / DIY-4_2R.
  const APPS = {
    'dlg': {
      label: 'Đồng hồ DLG-CLOCK',
      sub: 'Đồng hồ E-Ink DLG-CLOCK: đặt giờ, đếm ngược, truyền hình ảnh và thiết kế mẫu',
      fragment: 'apps/dlg.html',
      // DLG dùng bộ điều khiển riêng hoàn toàn (giao thức, xử lý ảnh đều khác)
      // nên KHÔNG nạp app_common.js / file họ — nó không dùng hàm nào ở đó.
      prefixes: ['DLG-CLOCK-'],
      scripts: ['js/dlg/image.js', 'js/dlg/qrcode.min.js', 'js/dlg/main.js', 'js/dlg/editor.js'],
    },
    '2_13': {
      label: '2.13"',
      sub: 'Màn 2.13" đen trắng (212×104 hoặc 250×122, DA14585): kết nối, cấu hình và truyền hình ảnh',
      fragment: 'apps/2_13.html',
      prefixes: ['DIY-2_13-'],
      scripts: ['js/app_common.js', 'js/family_hm.js', 'js/dithering.js', 'js/paint.js', 'js/crop.js',
        'js/2_13/common.js',
        'js/2_13/designer.js', 'js/diy_store.js', 'js/2_13/mode_preview.js', 'js/2_13/main.js'],
    },
    // ĐỜI MỚI của chính máy 2.13" — firmware v2.x dựng lại trên nền dùng chung.
    //
    // Vì sao PHẢI giữ HAI mục cho cùng một khổ màn: hai đời nói HAI dịch vụ BLE
    // khác hẳn — v1.10 dùng UUID 16 bit 0xFF00 (họ family_hm), v2.x dùng UUID
    // 128 bit của dòng EPD (họ family_epd). KHÔNG được đổi mục cũ sang họ mới:
    // máy khách còn chạy v1.10 sẽ mất kết nối ngay, mà đường lên đời lại đi qua
    // chính app cũ (OTA bằng app cũ rồi mới chuyển sang app này).
    //
    // Từ 25/08/2026 đời mới quảng bá «DIY-2_13N-xxxx» (thêm chữ N) nên hub TỰ
    // nhận dạng được, không còn bắt người dùng bấm đúng thẻ máy nữa.
    // Không bấm gì thì detectType vẫn trả về mục CŨ như trước — máy ngoài thị
    // trường không bị ảnh hưởng.
    '2_13n': {
      label: '2.13" (firmware v2.x)',
      sub: 'Màn 2.13" đen trắng, firmware v2.0 trở lên (DIY-2_13N, DA14585): kết nối, cấu hình và truyền hình ảnh',
      fragment: 'apps/2_13n.html',
      prefixes: ['DIY-2_13N-'],
      // ⚠ common.js phải có BẢN RIÊNG, không dùng chung với app đời cũ: nó
      // chứa IMG_MODE — số hiệu chế độ ẢNH — mà hai đời đánh số khác nhau
      // (v1.10 để 28, v2.x để 0). Nhìn như hằng số vẽ nhưng thật ra là một
      // giao ước SỐ với firmware.
      scripts: ['js/app_common.js', 'js/family_epd.js', 'js/dithering.js', 'js/paint.js', 'js/crop.js',
        'js/common/lunar_vn.js', 'js/2_13n/common.js', 'js/2_13n/mode_preview.js',
        // designer_2_13.js phải nạp TRƯỚC designer.js: nó khai window.EPD_DS_DEVICE
        // mà designer.js đọc ngay lúc nạp (hình học widget của màn 2.13" khác hẳn
        // màn 4.2" — không có font 7 đoạn, chỉ ba nấc cỡ).
        'js/2_13n/designer_2_13.js', 'js/common/designer.js', 'js/diy_store.js',
        'js/2_13n/main.js'],
    },
    // ĐỜI MỚI của máy 2.9" — dựng trên nền chung, cùng cách với 2.13".
    // Quảng bá «DIY-2_9N-xxxx» (thêm chữ N) nên hub tự nhận dạng; bản cũ
    // «DIY-2_9-xxxx» vẫn vào mục riêng bên dưới, hai đời không lẫn nhau.
    '2_9n': {
      label: '2.9" (firmware v1.x)',
      sub: 'Màn 2.9" ba màu 296×128 (DIY-2_9N, DA14585): kết nối, cấu hình và truyền hình ảnh',
      fragment: 'apps/2_9n.html',
      prefixes: ['DIY-2_9N-'],
      scripts: ['js/app_common.js', 'js/family_epd.js', 'js/dithering.js', 'js/paint.js', 'js/crop.js',
        'js/common/lunar_vn.js', 'js/2_9n/common.js', 'js/2_9n/mode_preview.js',
        // designer_2_9.js phải nạp TRƯỚC designer.js (khai window.EPD_DS_DEVICE)
        'js/2_9n/designer_2_9.js', 'js/common/designer.js', 'js/diy_store.js',
        'js/2_9n/main.js'],
    },
    '2_9': {
      label: '2.9"',
      sub: 'DA14585 — 2.9" (296×128 BWR): kết nối, cấu hình và truyền hình ảnh',
      fragment: 'apps/2_9.html',
      prefixes: ['DIY-2_9-'],
      scripts: ['js/app_common.js', 'js/family_hm.js', 'js/dithering.js', 'js/paint.js', 'js/crop.js',
        'js/2_9/designer.js', 'js/diy_store.js', 'js/2_9/mode_preview.js', 'js/2_9/main.js'],
    },
    '4_2': {
      label: '4.2" (3 màu)',
      sub: 'Màn 4.2" 400×300 ba màu (DA14585): kết nối, cấu hình và truyền hình ảnh',
      fragment: 'apps/4_2.html',
      prefixes: ['DIY-4_2-'],
      family: '4_2',
      scripts: ['js/app_common.js', 'js/family_epd.js', 'js/dithering.js', 'js/paint.js', 'js/crop.js',
        'js/4_2/profile.gen.js', 'js/4_2/modes.gen.js', 'js/4_2/mode_preview.js', 'js/common/designer.js', 'js/diy_store.js', 'js/4_2/timetable.js', 'js/4_2/main.js'],
    },
    '4_2c': {
      label: '4.2" BỐN MÀU',
      sub: 'Màn 4.2" 400×300 BỐN MÀU (DIY-4_2C, DA14585): kết nối, cấu hình và truyền hình ảnh',
      fragment: 'apps/4_2c.html',
      prefixes: ['DIY-4_2C-'],
      family: '4_2',
      scripts: ['js/app_common.js', 'js/family_epd.js', 'js/dithering.js', 'js/paint.js', 'js/crop.js',
        'js/4_2/profile.gen.js', 'js/4_2/modes.gen.js', 'js/4_2/mode_preview.js', 'js/common/designer.js', 'js/diy_store.js', 'js/4_2/timetable.js', 'js/4_2/main.js'],
    },
    'reader_4_2': {
      label: 'Máy đọc sách 4.2"',
      sub: 'Máy đọc sách 4.2" (DIY-4_2R, DA14585): gửi sách, điều khiển đọc và cài đặt hiển thị',
      fragment: 'apps/reader_4_2.html',
      prefixes: ['DIY-4_2R-'],
      scripts: ['js/app_common.js', 'js/family_reader.js', 'js/dithering.js', 'js/reader_4_2/font_metrics.js', 'js/reader_4_2/reader.js'],
    },
    '7_3': {
      label: '7.3" SÁU MÀU',
      sub: 'Màn 7.3" 800×480 SÁU MÀU Spectra 6 (DIY-7_3, DA14585): kết nối, cấu hình và truyền hình ảnh',
      fragment: 'apps/7_3.html',
      prefixes: ['DIY-7_3-'],
      scripts: ['js/app_common.js', 'js/family_epd.js', 'js/dithering.js', 'js/paint.js', 'js/crop.js',
        'js/7_3/mode_preview.js', 'js/7_3/designer.js', 'js/diy_store.js', 'js/7_3/timetable.js',
        'js/7_3/main.js'],
    },
    '7_5': {
      label: '7.5"',
      sub: 'Màn 7.5" 640×384 (DIY-7_5, DA14585): kết nối, cấu hình và truyền hình ảnh',
      fragment: 'apps/7_5.html',
      // 'DIY-7_5V-' = TÊN CŨ của chính dòng máy này (firmware trước v1.0).
      // Chưa bán máy 7.5" nào nên tên này chỉ còn trên máy test nội bộ —
      // giữ lại cho tiện, không hiện ra trong các câu nhật ký cho khách.
      prefixes: ['DIY-7_5-', 'DIY-7_5V-'],
      scripts: ['js/app_common.js', 'js/family_epd.js', 'js/dithering.js', 'js/paint.js', 'js/crop.js',
        'js/7_5/mode_preview.js', 'js/7_5/designer.js', 'js/diy_store.js', 'js/7_5/main.js'],
    },
    '7_5b': {
      label: '7.5" CHỮ LỚN',
      sub: 'Màn 7.5" 640×384 bản CHỮ LỚN (DIY-7_5B, DA14585): kết nối, cấu hình và truyền hình ảnh',
      fragment: 'apps/7_5b.html',
      prefixes: ['DIY-7_5B-'],
      scripts: ['js/app_common.js', 'js/family_epd.js', 'js/dithering.js', 'js/paint.js', 'js/crop.js',
        'js/7_5b/mode_preview.js', 'js/7_5b/main.js'],
    },
    'reader_7_5': {
      label: 'Máy đọc sách 7.5"',
      sub: 'Máy đọc sách 7.5" (DIY-7_5R, nRF52811): gửi sách, điều khiển đọc và cài đặt hiển thị',
      fragment: 'apps/reader_7_5.html',
      prefixes: ['DIY-7_5R-'],
      scripts: ['js/app_common.js', 'js/family_reader.js', 'js/dithering.js', 'js/reader_7_5/reader.js'],
    },
    '10_2': {
      label: '10.2"',
      sub: 'Màn 10.2" 960×640 (DIY-10_2, DA14585): kết nối, cấu hình và truyền hình ảnh',
      fragment: 'apps/10_2.html',
      prefixes: ['DIY-10_2-'],
      scripts: ['js/app_common.js', 'js/family_epd.js', 'js/dithering.js', 'js/paint.js', 'js/crop.js',
        'js/10_2/mode_preview.js', 'js/10_2/designer.js', 'js/diy_store.js', 'js/10_2/main.js'],
    },
  };

  let hubApp = null;        // '4_2' | '2_13' | 'dlg' once an app is instantiated
  let appPreConnect = null; // the loaded app's own preConnect (disconnect branch)
  let loading = false;
  let hubAddLog = null;     // the hub's styled addLog, re-installed after app load

  function isDebugMode() {
    return new URLSearchParams(window.location.search).get('debug') === 'true';
  }

  // Route theo TÊN BLE. QUY TẮC: tên biến thể dài phải kiểm TRƯỚC tiền tố
  // ngắn hơn, nếu không DIY-7_5B/-7_5R sẽ bị nhánh DIY-7_5- nuốt mất.
  //   DLG-CLOCK-xxxx → đồng hồ DLG          DIY-2_13-xxxx  → 2.13"
  //   DIY-2_9-xxxx   → 2.9"                 DIY-4_2-xxxx   → 4.2" (3 màu)
  //   DIY-4_2C-xxxx  → 4.2" BỐN MÀU         DIY-4_2R-xxxx  → máy đọc sách 4.2"
  //   DIY-7_3-xxxx   → 7.3" SÁU MÀU         DIY-7_5-xxxx   → 7.5" (640×384)
  //   DIY-7_5B-xxxx  → 7.5" CHỮ LỚN         DIY-7_5R-xxxx  → máy đọc sách 7.5"
  //   DIY-10_2-xxxx  → 10.2"
  // DIY-7_5V-xxxx = TÊN CŨ của 7.5" (firmware trước v1.0) — vẫn nhận.
  // DIY-xxxx trơ = board 4.2" đời cũ chưa có phần tên kích thước.
  // Loại người dùng vừa bấm ở hàng «kết nối tới một thiết bị cụ thể» — bấm nút
  // nào thì lọc đúng dòng máy đó cho nhanh, khỏi phải lội danh sách.
  //
  // Trước đây đây còn là đường DUY NHẤT để tách hai đời máy 2.13" (chúng quảng
  // bá cùng một tên mà nói hai dịch vụ BLE khác nhau). Từ 25/08/2026 đời mới
  // mang tên riêng «DIY-2_13N-» nên chuyện đó hết; giữ lại vì vẫn tiện.
  let explicitPick = null;

  function detectType(name) {
    name = name || '';
    // Bấm đúng nút thì theo nút, miễn là tên máy vẫn khớp tiền tố của loại đó
    // (bấm nhầm loại khác hẳn thì vẫn rơi về nhận diện theo tên bên dưới).
    if (explicitPick && APPS[explicitPick] &&
        APPS[explicitPick].prefixes.some(p => name.startsWith(p))) {
      return explicitPick;
    }
    if (name.startsWith('DLG-CLOCK-')) return 'dlg';
    // Chữ N tách đời mới khỏi đời cũ. Phải xét TRƯỚC 'DIY-2_13-' cho dễ đọc,
    // dù thật ra không chồng nhau: 'DIY-2_13N-…' không khớp 'DIY-2_13-'.
    if (name.startsWith('DIY-2_13N-')) return '2_13n';
    if (name.startsWith('DIY-2_13-')) return '2_13';
    if (name.startsWith('DIY-2_9N-')) return '2_9n';
    if (name.startsWith('DIY-2_9-')) return '2_9';
    if (name.startsWith('DIY-4_2C-')) return '4_2c';
    if (name.startsWith('DIY-4_2R-')) return 'reader_4_2';
    if (name.startsWith('DIY-4_2-')) return '4_2';
    if (name.startsWith('DIY-7_3-')) return '7_3';
    if (name.startsWith('DIY-7_5B-')) return '7_5b';
    if (name.startsWith('DIY-7_5R-')) return 'reader_7_5';
    if (name.startsWith('DIY-7_5V-')) return '7_5';  // tên cũ của 7.5"
    if (name.startsWith('DIY-7_5-')) return '7_5';
    if (name.startsWith('DIY-10_2-')) return '10_2';
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

  /* Mang di dong hay chop nhoang, va ngay sau khi day ban moi len thi CDN cua
   * GitHub Pages con dang dung lai -> fetch nem "Failed to fetch" va nguoi dung
   * KET CUNG o buoc tai giao dien, phai ket noi lai tu dau. Thu lai vai lan,
   * cach nhau mot chut, roi moi bao hong. */
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function retry(what, fn, tries = 3) {
    let last;
    for (let i = 1; i <= tries; i++) {
      try { return await fn(); } catch (e) {
        last = e;
        if (i < tries) {
          addLog('Tải ' + what + ' chưa được (' + e.message + ') — thử lại lần ' + (i + 1) + '/' + tries + '…');
          await sleep(400 * i);
        }
      }
    }
    throw last;
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
    const resp = await retry(cfg.fragment, async () => {
      const r = await fetch(cfg.fragment + '?v=' + VER);
      if (!r.ok) throw new Error('máy chủ trả ' + r.status);
      return r;
    });
    document.getElementById('appMount').insertAdjacentHTML('beforeend', await resp.text());
    document.body.classList.add('app-' + type);
    // họ 4_2 (4_2c / 7_5) dùng chung CSS gating .only-4_2 của app 4_2
    if (cfg.family && cfg.family !== type) document.body.classList.add('app-' + cfg.family);

    for (const src of cfg.scripts) {
      await retry(src, () => loadScript(src));
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
    hideDevPicker();
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
    // chế độ dev (?debug=true): bỏ qua kiểm tra kích hoạt, không hiện popup
    // (helper ?act=<MAC> vẫn mở popup chủ động để soi giao diện)
    if (isDebugMode()) return true;
    try {
      if (type === '2_13' || type === '2_9') {   // cùng giao thức HM 0xff00
        const s = await act213Query();
        return !/act=off/.test(s);
      }
      // MỌI máy còn lại đều là firmware họ EPD (4.2 / 4.2 bốn màu / 7.3 /
      // 7.5 / 7.5 chữ lớn / 10.2 và HAI máy đọc sách): ngay khi bật thông
      // báo, máy đẩy "mac=…" + "act=on/off". Trước đây chỉ liệt kê 3 máy nên
      // các máy thêm sau (đặc biệt máy đọc sách) chỉ ghi dòng «chưa kích
      // hoạt» vào log mà KHÔNG hiện cửa sổ kích hoạt. Máy DLG-CLOCK có giao
      // diện kích hoạt riêng trong template nên vẫn không chặn ở đây.
      if (type !== 'dlg') {
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

  // Dựng hàng nút «Hoặc kết nối tới một thiết bị cụ thể» từ chính bảng APPS,
  // nên thêm/bớt dòng máy ở APPS là hàng nút tự khớp theo.
  // Danh sách tên máy đang hỗ trợ, dựng từ chính bảng APPS -> thêm/bớt dòng
  // máy khỏi phải sửa các câu nhật ký ở dưới. Bỏ tên cũ DIY-7_5V- cho gọn
  // (chỉ còn trên máy test nội bộ, vẫn kết nối được bình thường).
  function knownNames() {
    const seen = [];
    for (const cfg of Object.values(APPS)) {
      for (const p of cfg.prefixes) {
        if (p === 'DIY-7_5V-') continue;
        if (!seen.includes(p)) seen.push(p);
      }
    }
    return seen.map(p => p + 'xxxx').join(' / ');
  }

  // Điền cột «Firmware mới nhất» của bảng «Thiết bị được hỗ trợ» ở trang chủ.
  // NGUỒN DUY NHẤT là bảng «Danh sách firmware» trong fragment của chính máy
  // đó — phát hành bản mới chỉ cần thêm hàng vào bảng ấy, ô này tự theo, khỏi
  // sửa hai nơi rồi quên một nơi. Chạy nền sau khi trang hiện, hỏng thì để
  // dấu «—» chứ không chặn gì.
  function fwVerNum(txt) {
    const m = String(txt).match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    if (!m) return null;
    return [+m[1], +(m[2] || 0), +(m[3] || 0)];
  }

  async function fillLatestFw() {
    const cells = document.querySelectorAll('td.fw-latest[data-app]');
    for (const td of cells) {
      const type = td.getAttribute('data-app');
      const cfg = APPS[type];
      if (!cfg || !cfg.fragment) { td.textContent = '—'; continue; }
      try {
        const r = await fetch(cfg.fragment + '?v=' + VER);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
        let best = null, bestTxt = null;
        doc.querySelectorAll('.fw-table tbody tr').forEach(tr => {
          if (!tr.cells || tr.cells.length < 2) return;
          // hàng ĐỔI DÒNG MÁY (vd nạp firmware lịch cho máy đọc sách) không
          // phải firmware của dòng máy này — bỏ qua, kẻo bảng trang chủ báo
          // nhầm phiên bản mới nhất
          if (tr.classList.contains('fw-alt')) return;
          const txt = tr.cells[1].textContent.trim();
          const v = fwVerNum(txt);
          if (!v) return;
          if (!best || v[0] > best[0] || (v[0] === best[0] &&
              (v[1] > best[1] || (v[1] === best[1] && v[2] > best[2])))) {
            best = v; bestTxt = txt;
          }
        });
        td.textContent = bestTxt || '—';
        if (!bestTxt) td.title = 'Dòng máy này chưa phát hành firmware qua trang';
      } catch (e) {
        td.textContent = '—';
      }
    }
  }

  function buildDevPicker() {
    const box = document.getElementById('devPickList');
    if (!box) return;
    box.innerHTML = '';
    for (const [type, cfg] of Object.entries(APPS)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'secondary';
      const name = document.createTextNode(cfg.label);
      const hint = document.createElement('small');
      hint.textContent = cfg.prefixes.join(' / ') + 'xxxx';
      b.appendChild(name);
      b.appendChild(hint);
      b.onclick = () => { explicitPick = type; hubPreConnect(type); };
      box.appendChild(b);
    }
  }

  // Đã mở một app thì: bộ lọc bị ghim theo app đó (hàng nút hết tác dụng) và
  // bảng «Thiết bị được hỗ trợ» cũng thừa — nhất là trên điện thoại, bảng
  // dạng thẻ cao hơn 2000px mà lại nằm TRÊN phần điều khiển, không ẩn thì
  // kết nối xong phải cuộn qua cả bảng mới tới nút bấm.
  function hideDevPicker() {
    const row = document.getElementById('devPickRow');
    if (row) row.classList.add('hidden');
    const info = document.getElementById('devInfoBox');
    if (info) info.style.display = 'none';
  }

  async function hubPreConnect(pickType) {
    if (loading) return;

    // an app is active and connected: the button means "disconnect"
    if (hubApp && isConnected()) {
      appPreConnect();
      return;
    }

    let device;
    try {
      // Hộp chọn BLE luôn LỌC THEO TÊN (kể cả ?debug=true). Ưu tiên dòng máy
      // người dùng vừa bấm ở hàng «kết nối tới một thiết bị cụ thể»; nếu
      // không thì theo app đang mở (chọn máy trước đó, hoặc ?debug=true&app=…)
      // — khỏi lỡ tay chọn nhầm máy khác loại; cuối cùng mới lọc rộng.
      const pick = (pickType && APPS[pickType]) ? APPS[pickType]
        : (hubApp && APPS[hubApp]) ? APPS[hubApp] : null;
      if (pickType && APPS[pickType]) {
        addLog('Chỉ tìm máy ' + APPS[pickType].label + ' (' +
          APPS[pickType].prefixes.join(' / ') + 'xxxx).');
      }
      const filters = (pick && pick.prefixes)
        ? pick.prefixes.map(p => ({ namePrefix: p }))
        : [{ namePrefix: 'DIY-' }, { namePrefix: 'DLG-CLOCK-' }];
      device = await navigator.bluetooth.requestDevice({
        filters: filters,
        optionalServices: ALL_SERVICES,
      });
    } catch (e) {
      console.error(e);
      if (e.name === 'NotFoundError') {
        addLog('Không tìm thấy thiết bị E-Ink (' + knownNames() + ')');
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
      addLog('Thiết bị "' + (device.name || '?') + '" không thuộc dòng máy nào đang hỗ trợ (' + knownNames() + ').');
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
        addLog('Mạng chập chờn hoặc trang vừa được cập nhật. Bấm «Kết nối» thử lại; '
             + 'nếu vẫn lỗi hãy tải lại trang (Ctrl+F5 / kéo xuống làm mới).');
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

  /* ---- minimal globals for the connect fieldset before an app is loaded ----
     addLog/clearLog nay o js/log.js (nap truoc file nay) — dung chung cho
     hub lan moi app, khong con ban chep rieng o tung main.js. */

  hubAddLog = window.addLog;

  window.preConnect = hubPreConnect;
  window.reConnect = function () { addLog('Chưa kết nối thiết bị nào.'); };
  window.sendcmd = function () { addLog('Chưa kết nối thiết bị nào.'); };

  function hubInit() {
    document.getElementById('reconnectbutton').disabled = true;
    document.getElementById('sendcmdbutton').disabled = true;
    actInitUi();
    buildDevPicker();
    fillLatestFw();

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
        addLog('Mạng chập chờn hoặc trang vừa được cập nhật. Bấm «Kết nối» thử lại; '
             + 'nếu vẫn lỗi hãy tải lại trang (Ctrl+F5 / kéo xuống làm mới).');
      }).finally(() => { loading = false; });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hubInit);
  else hubInit();
})();
