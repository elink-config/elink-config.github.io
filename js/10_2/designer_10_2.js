/*
 * HỒ SƠ VẼ của «Tự thiết kế» cho màn 10.2" (960×640) — soi đúng theo
 * DrawCustom() trong firmware (epd_10_2inch/src/gui/GUI.c, v2.0).
 *
 * Vì sao chỉ có mấy chục dòng, trong khi màn 2.9" phải viết cả file 339 dòng:
 * DrawCustom của máy này gọi ĐÚNG những hàm vẽ mà bản 4.2" gọi (DrawTime 7
 * đoạn, DrawComboAnalogClock, DrawMonthMini, unifont nhân nguyên lần). Nên
 * hình dáng giống hệt, chỉ khác KHOẢNG co giãn: khổ 960×640 gấp hơn năm lần
 * diện tích 400×300 nên trần của mọi thành phần phải nới ra, không thì kéo
 * hết thanh mà chữ vẫn bé tí giữa màn.
 *
 * Vì vậy file này chỉ đè bốn thứ — parOf (tham số vẽ thật), sizeRange (khoảng
 * thanh kéo), snapSize (ép về cỡ máy vẽ được) và hai khung bao 5/6 vốn bị kẹp
 * cứng theo bề ngang 400px của bản 4.2". Mọi thứ còn lại dùng nguyên bản
 * chung js/common/designer.js.
 *
 * Phải nạp TRƯỚC js/common/designer.js (xem danh sách script trong connector.js).
 *
 * ⚠ BỐN TRẦN DƯỚI ĐÂY LÀ GIAO ƯỚC VỚI FIRMWARE — chúng là đúng các con số
 *   trong cw_px()/cw_mul() của GUI.c. Nới một bên mà quên bên kia thì người
 *   dùng kéo to hơn cái máy vẽ được, và bố cục trên khung khác trên màn.
 */
(function () {
  const FREE = s => s >= 3;
  const pxOf = (s, base, lo, hi) => Math.max(lo, Math.min(hi, Math.round(base * s / 16)));
  const mulOf = (s, lo, hi) => Math.max(lo, Math.min(hi, Math.round(s / 16)));

  /* Tham số vẽ THẬT — cùng công thức với cw_px()/cw_mul() bên firmware.
   * So với bản 4.2": kim 150 -> 300, chữ/icon 3 -> 6 lần, lịch 400 -> 900 và
   * hàng 60 -> 120, nét 7 đoạn 8 -> 16. */
  function parOf102(type, s) {
    switch (type) {
      // nét dày cS pixel NGUYÊN: cS = round(2·s/16) = (s+4)/8, kẹp 1..16
      case 1: return { cS: FREE(s) ? Math.max(1, Math.min(16, Math.round((s + 4) / 8))) : [2, 3, 4][s] };
      case 2: return { r: FREE(s) ? pxOf(s, 40, 12, 300) : [40, 60, 85][s] };
      case 7: return {
        gw: FREE(s) ? pxOf(s, 180, 112, 900) : [180, 240, 300][s],
        rh: FREE(s) ? pxOf(s, 26, 12, 120) : [26, 32, 38][s],
      };
      case 10: return { k: FREE(s) ? mulOf(s, 1, 6) : s + 1 };
      // CHỮ: bộ font của máy này đã 28px sẵn nên chỉ nhân 1..3 (28..84px);
      // bộ cũ là 16px nên mới nhân tới 6. ICON (case 10) vẫn 1..6 vì nó là
      // ảnh người dùng gửi lên, không liên quan tới font.
      default: return { k: FREE(s) ? mulOf(s, 1, 3) : (s ? 2 : 1) };  // chữ
    }
  }

  window.EPD_DS_DEVICE = {
    /* Khoá lưu bản nháp trong trình duyệt — để bố cục máy này không lẫn với
     * máy khác dùng chung một trình duyệt. */
    key: '10_2',

    // Máy này chỉ một tấm 960×640 (bản BA MÀU và bản ĐEN TRẮNG cùng khổ).
    size: () => ({ w: 960, h: 640 }),

    parOf: parOf102,

    /* Hai khung bao phải đè: bản chung kẹp bề ngang ở 396px (mép màn 4.2").
     * Giữ nguyên số đó ở đây thì dòng «Thứ Năm, 26/08/2026» phóng 4 lần vẫn
     * chỉ đo ra 396px trong khi máy vẽ ra 608px — kéo sát mép phải là tràn. */
    dims: {
      // Chiều cao một dòng của bộ font mới là 26px (ascent 21 + descent 5),
      // không phải 16px của ô chữ unifont cũ.
      5: s => { const k = parOf102(5, s).k; return [Math.min(952, 330 * k), 26 * k]; },
      6: s => { const k = parOf102(6, s).k; return [Math.min(952, 330 * k), 26 * k]; },
    },

    /* Khoảng thanh kéo — TÍNH THEO KHỔ 960×640.
     *   1  cS 1..16   -> rộng 54..744 px
     *   2  r 12..300  -> mặt kim tới 600px, vừa chiều cao 640
     *   7  lịch: trần thật là CHIỀU CAO hàng (rh chạm 120 ở s≈74) chứ không
     *      phải bề ngang (gw mới tới 832 ở s=74) — nên chặn theo rh.
     *   chữ: 1x..3x — bộ font 28px, nhân quá 3 là 112px, quá khổ mọi ô
     *   icon: 1x..6x (ảnh người dùng, không dính font) */
    sizeRange(type) {
      switch (type) {
        case 1: return { min: 8, max: 128, step: 8 };
        case 2: return { min: 5, max: 120, step: 1 };
        case 7: return { min: 10, max: 74, step: 1 };
        case 10: return { min: 16, max: 96, step: 16 };   // icon
        default: return { min: 16, max: 48, step: 16 };   // chữ: k = 1..3
      }
    },

    snapSize(type, s) {
      switch (type) {
        case 1: return Math.max(8, Math.min(128, Math.round(s / 8) * 8));
        case 2: return Math.max(5, Math.min(120, s));
        case 7: return Math.max(10, Math.min(74, s));
        case 3: return 16;   // pin: một cỡ duy nhất
        default: return Math.max(16, Math.min(96, Math.round(s / 16) * 16));
      }
    },
  };
})();
