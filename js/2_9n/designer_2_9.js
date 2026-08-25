/*
 * HỒ SƠ VẼ của «Tự thiết kế» cho màn 2.9" (296×128) — soi đúng theo
 * DrawCustom() trong firmware (epd_2_9inch_new/src/gui/GUI.c).
 *
 * Vì sao phải có file này: js/common/designer.js dựng hình theo màn 4.2" —
 * đồng hồ số vẽ bằng nét 7 đoạn, lịch tháng rộng tới 400px, bán kính kim tới
 * 150px. Màn này chỉ rộng 296px và KHÔNG có font 7 đoạn. Dùng nguyên bản kia
 * thì khung xem trước vẽ một đằng, máy vẽ một nẻo.
 *
 * CỠ TỰ DO (từ 25/08/2026): byte `size` mang đúng nghĩa như máy 4.2" —
 *   0 / 1 / 2  = ba nấc cũ (bố cục lưu từ trước vẫn mở đúng)
 *   >= 3       = cỡ thật, đơn vị 1/16 lần so với nấc 0
 * Nhưng KHOẢNG thì khác hẳn 4.2" nên khai riêng qua ba móc sizeRange /
 * snapSize / legacy16.
 *
 * Phải nạp TRƯỚC js/common/designer.js (xem danh sách script trong connector.js).
 *
 * ⚠ Số đo ở đây là GIAO ƯỚC với firmware. Sửa DrawCustom bên kia thì sửa cả
 *   đây, nếu không người dùng xếp một kiểu, máy hiện một kiểu.
 */
(function () {
  // ── số đo lấy thẳng từ DrawCustom ────────────────────────────────────────
  const RR = [22, 32, 46];   // bán kính mặt kim theo nấc cũ
  const CWS = [10, 13, 16];  // bề rộng ô lịch
  const RHS = [9, 11, 13];   // chiều cao hàng lịch
  const UNI = 8, UNI_H = 16; // unifont: MỌI ký tự rộng đúng 8px (font điểm ảnh)
  /* Hai cỡ Hobo, số đo là BỀ RỘNG BƯỚC (advance) đọc thẳng từ blob font —
   * không phải bề rộng vệt mực. Lấy nhầm vệt mực thì khung bao hụt vài điểm
   * mỗi chữ số, kéo sát mép là tràn. */
  const HOBO_W = 36, HOBO_COLON = 18, HOBO_H = 52;    // hobo_2_13_tn
  const HOBO9_W = 44, HOBO9_COLON = 22, HOBO9_H = 64; // hobo_2_9_tn
  const BK = '#151515', RD = '#c02a1e', WH = '#f6f4ec';
  const MONO = '"DejaVu Sans Mono",Consolas,monospace';

  const nac = s => (s > 2) ? 2 : Math.max(0, s | 0);
  const FREE = s => s >= 3;
  const pxOf = (s, base, lo, hi) => Math.max(lo, Math.min(hi, Math.round(base * s / 16)));
  const mulOf = (s, lo, hi) => Math.max(lo, Math.min(hi, Math.round(s / 16)));

  /* Nhóm CHỮ nhân NGUYÊN lần 1/2/3 — font là ảnh điểm, không co giãn mượt
   * được. Ba nấc cũ chỉ có 1× và 2× (firmware viết `if (sz) draw_x2`). */
  const kOf = s => FREE(s) ? mulOf(s, 1, 3) : (nac(s) ? 2 : 1);

  /* Đồng hồ số có BỐN kiểu chữ rời rạc, cao 16 / 32 / 52 / 64 điểm. Cỡ tự do
   * chọn kiểu gần nhất với chiều cao kéo được — cùng ngưỡng với firmware. */
  function kieuGio(s) {
    if (!FREE(s)) return nac(s);
    if (s < 24) return 0;
    if (s < 42) return 1;
    if (s < 58) return 2;
    return 3;
  }
  const GIO_DIM = [
    [UNI * 5, UNI_H],                              // 0: unifont thường
    [UNI * 5 * 2, UNI_H * 2],                      // 1: unifont ×2
    [HOBO_W * 4 + HOBO_COLON, HOBO_H],             // 2: Hobo 52
    [HOBO9_W * 4 + HOBO9_COLON, HOBO9_H],          // 3: Hobo 64
  ];

  const pad = v => String(v).padStart(2, '0');
  const WD = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
  const clockStr = now => pad(now.getHours()) + ':' + pad(now.getMinutes());
  const solarStr = now => pad(now.getDate()) + '/' + pad(now.getMonth() + 1) + '/' + now.getFullYear();
  const dateStr = now => WD[now.getDay()] + ' ' + solarStr(now);
  function lunarStrOf(now) {
    try {
      const l = window.lunarToday(now);
      return 'Âm ' + l.day + '/' + pad(l.month & 0x7f);
    } catch (e) { return 'Âm --/--'; }
  }

  const uniW = (s, k) => [...String(s)].length * UNI * k;

  /* Vẽ chữ kiểu FONT ĐIỂM ẢNH: mỗi ký tự chiếm đúng 8·k pixel, không co giãn
   * theo hình dáng chữ. Vẽ từng ký tự vào ô của nó — nhờ vậy bề rộng trên
   * khung xem trước bằng ĐÚNG bề rộng trên máy, kéo sát mép không bị hụt. */
  function uniText(x, s, px, py, k, bold) {
    const cell = UNI * k;
    x.font = (bold ? 'bold ' : '') + Math.round(13 * k) + 'px ' + MONO;
    x.textAlign = 'center';
    let i = 0;
    for (const ch of String(s)) {
      x.fillText(ch, px + i * cell + cell / 2, py);
      i++;
    }
    x.textAlign = 'left';
  }

  /* Pin: khung 15×9, đầu nhô bên TRÁI, mức đầy dần từ bên PHẢI — y như
   * draw_batt_c của firmware. Điện áp chữ nhỏ 6x10 nằm trước icon. */
  function battery(x, bx, by) {
    x.strokeStyle = BK; x.lineWidth = 1;
    x.strokeRect(bx + 0.5, by + 0.5, 14, 8);
    x.fillStyle = BK;
    x.fillRect(bx - 2, by + 3, 2, 3);
    x.fillRect(bx + 5, by + 2, 8, 5);
  }

  /* Mặt kim. Vạch và chữ số của 12/3/6/9 màu ĐỎ — đúng như mọi mặt kim khác
   * của máy này sau đợt chỉnh 24/08. */
  function analog(x, cx, cy, r, now) {
    x.strokeStyle = BK; x.lineWidth = 1;
    x.beginPath(); x.arc(cx, cy, r, 0, 7); x.stroke();
    for (let k = 0; k < 60; k += 5) {
      const a = k * Math.PI / 30;
      const gio = (k % 15) === 0;                 // 12h, 3h, 6h, 9h
      x.strokeStyle = gio ? RD : BK;
      x.lineWidth = gio ? 2 : 1;
      x.beginPath();
      x.moveTo(cx + (r - 2) * Math.sin(a), cy - (r - 2) * Math.cos(a));
      x.lineTo(cx + (r - 5) * Math.sin(a), cy - (r - 5) * Math.cos(a));
      x.stroke();
    }
    x.strokeStyle = BK; x.lineWidth = 1;
    const h = now.getHours() % 12, m = now.getMinutes();
    const ha = (h + m / 60) * Math.PI / 6, ma = m * Math.PI / 30;
    x.lineCap = 'round';
    x.lineWidth = 2.5; x.beginPath(); x.moveTo(cx, cy);
    x.lineTo(cx + r * 0.5 * Math.sin(ha), cy - r * 0.5 * Math.cos(ha)); x.stroke();
    x.lineWidth = 1.5; x.beginPath(); x.moveTo(cx, cy);
    x.lineTo(cx + r * 0.75 * Math.sin(ma), cy - r * 0.75 * Math.cos(ma)); x.stroke();
    x.lineCap = 'butt';
    /* Bốn con số 12/3/6/9 chữ nhỏ 6x10, màu ĐỎ. Vẽ ở MỌI cỡ — firmware
     * không có ngưỡng nào cả, bỏ qua ở mặt nhỏ là xem trước một đằng máy
     * hiện một nẻo. */
    x.fillStyle = RD;
    x.font = '8px ' + MONO;
    x.textAlign = 'center';
    x.fillText('12', cx, cy - r + 12);
    x.fillText('3', cx + r - 7, cy + 4);
    x.fillText('6', cx, cy + r - 4);
    x.fillText('9', cx - r + 7, cy + 4);
    x.textAlign = 'left';
    x.fillStyle = BK;
  }

  /* Lưới lịch tháng: hàng THỨ (6x10 đậm), vạch ngang, rồi các ngày — cột 0 là
   * THỨ HAI, hôm nay tô ô đỏ chữ trắng, T7/CN chữ đỏ. Khớp grid_header +
   * month_grid_s sau đợt chỉnh 24/08. */
  function calendar(x, gx, gy, cw, rh, now) {
    const HDR = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
    const HDR_H = 10;                 // hàng header, khớp grid_header(..., 10)
    x.font = 'bold 8px ' + MONO;
    x.textAlign = 'center';
    for (let i = 0; i < 7; i++) {
      const wknd = i >= 5;            // T7 và CN: ô nền ĐỎ, chữ trắng
      if (wknd) { x.fillStyle = RD; x.fillRect(gx + i * cw, gy, cw, HDR_H - 2); }
      x.fillStyle = wknd ? WH : BK;
      x.fillText(HDR[i], gx + i * cw + cw / 2, gy + 7);
      // vạch TRẮNG ngăn T7 với CN — hai ô cùng đỏ, không có nó thì dính liền
      if (i === 6) { x.fillStyle = WH; x.fillRect(gx + i * cw, gy, 1, HDR_H - 2); }
    }
    x.fillStyle = BK;
    x.fillRect(gx, gy + HDR_H - 2, cw * 7 - 1, 1);

    const first = (new Date(now.getFullYear(), now.getMonth(), 1).getDay() + 6) % 7;
    const maxD = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    for (let d = 1; d <= maxD; d++) {
      const idx = first + d - 1, col = idx % 7, row = (idx / 7) | 0;
      const cx = gx + col * cw + cw / 2, cy = gy + 11 + row * rh;
      const today = d === now.getDate();
      if (today) { x.fillStyle = RD; x.fillRect(cx - cw / 2, cy - 1, cw, rh - 1); }
      x.fillStyle = today ? WH : ((col >= 5) ? RD : BK);
      x.fillText(String(d), cx, cy + 7);
    }
    x.fillStyle = BK;
    x.textAlign = 'left';
  }

  /* Khung bao từng loại — dùng để bắt chuột và chặn không cho kéo lọt mép.
   * Tham số thứ hai là NỘI DUNG chữ (designer.js truyền vào cho nhóm chữ);
   * nhờ nó ô chữ đo theo số ký tự thật chứ không theo font tỷ lệ của trình
   * duyệt, nên khung bao khớp đúng bề rộng máy vẽ ra.
   *
   * KHÔNG đè loại 2 (kim) và 10 (icon): công thức dùng chung đã tính qua
   * parOf() nên tự đúng — riêng icon còn cần biết cỡ ảnh mà chỉ designer.js
   * mới giữ. */
  const dims = {
    1: s => GIO_DIM[kieuGio(s)].slice(),
    3: () => [50, 14],
    4: s => [uniW('28°C', kOf(s)), UNI_H * kOf(s)],
    5: (s, t) => [uniW(dateStr(new Date()), kOf(s)), UNI_H * kOf(s)],
    6: s => [uniW('Âm 24/05', kOf(s)), UNI_H * kOf(s)],
    7: s => {
      const p = parOfLocal(7, s);
      return [p.cw * 7, 11 + 6 * p.rh];
    },
    15: s => [uniW('Chủ nhật', kOf(s)), UNI_H * kOf(s)],
    16: s => [uniW('25/08/2026', kOf(s)), UNI_H * kOf(s)],
  };
  // Chữ 1..6 — đo theo nội dung đang gõ
  [8, 9, 11, 12, 13, 14].forEach(t => {
    dims[t] = (s, txt) => [uniW(txt || 'Chữ', kOf(s)), UNI_H * kOf(s)];
  });

  /* Tham số vẽ THẬT — cùng công thức với cw_px()/cw_mul() bên firmware. */
  function parOfLocal(type, s) {
    switch (type) {
      case 1: return { kieu: kieuGio(s) };
      case 2: return { r: FREE(s) ? pxOf(s, RR[0], 10, 60) : RR[nac(s)] };
      case 7: return {
        cw: FREE(s) ? pxOf(s, CWS[0], 6, 40) : CWS[nac(s)],
        rh: FREE(s) ? pxOf(s, RHS[0], 6, 30) : RHS[nac(s)],
      };
      case 10: return { k: FREE(s) ? mulOf(s, 1, 3) : nac(s) + 1 };
      default: return { k: kOf(s) };
    }
  }

  window.EPD_DS_DEVICE = {
    /* Tên máy — designer.js lấy nó làm khoá lưu bản nháp, để bố cục của máy
     * này không lẫn với máy khác dùng chung trình duyệt. */
    key: '2_9n',

    // Khổ màn ĐỌC ĐỘNG — máy này chỉ một tấm, nhưng giữ đường đọc động cho
    // giống các app khác (và phòng khi thêm tấm thứ hai).
    /* ⚠ ĐỌC BẰNG TÊN TRẦN, đừng qua window.
     *
     * main.js khai `const RESOLUTIONS` và `let resIdx` ở mức trên cùng của một
     * script thường — hai thứ đó nằm trong phạm vi script chung, KHÔNG trở
     * thành thuộc tính của window. Đọc window.RESOLUTIONS ra undefined, thế là
     * bộ dựng luôn tưởng màn nhỏ kể cả khi người dùng đã chọn tấm khác.
     *
     * try/catch vì file này nạp TRƯỚC main.js: nếu có ai gọi sớm thì `resIdx`
     * còn trong vùng chết của `let` và `typeof` cũng ném lỗi. */
    size: () => {
      try {
        if (RESOLUTIONS && RESOLUTIONS[resIdx]) {
          return { w: RESOLUTIONS[resIdx].w, h: RESOLUTIONS[resIdx].h };
        }
      } catch (e) { /* main.js chưa nạp xong */ }
      return { w: 296, h: 128 };
    },

    // firmware có cw_px()/cw_mul() -> CÓ cỡ tự do
    sizes: { 1: 3, 2: 3, 3: 1, 4: 2, 5: 2, 6: 2, 7: 3, 10: 3, 15: 2, 16: 2 },
    dims: dims,
    parOf: parOfLocal,

    /* Ba nấc cũ quy ra đơn vị 1/16 — để bố cục lưu từ hồi ba nấc, khi kéo lần
     * đầu, không nhảy cỡ. Số lấy ngược từ chính RR/CWS/GIO_DIM. */
    legacy16: {
      1: [16, 32, 52],                    // 16 / 32 / 52 điểm cao
      2: [16, 23, 33],                    // r 22 / 32 / 46 (base 22)
      7: [16, 21, 26],                    // ô 10 / 13 / 16 (base 10)
      10: [16, 32, 48],
    },

    /* Khoảng thanh kéo — TÍNH THEO KHỔ MÀN 296×128, không mượn của 4.2".
     * Vượt khoảng này là thành phần to hơn màn, kéo đi đâu cũng tràn. */
    sizeRange(type) {
      switch (type) {
        case 1: return { min: 16, max: 64, step: 1 };  // bốn kiểu chữ, snap sau
        case 2: return { min: 8, max: 46, step: 1 };   // r 11..63, vừa chiều cao 128
        /* Sàn 16 = ô 10 điểm, đúng nấc nhỏ nhất máy vẫn dùng xưa nay. Nhỏ
         * hơn nữa thì hàng «T2..CN» (font 6x10) rộng hơn ô, chữ chồng lên
         * nhau — đo bằng điểm ảnh thấy tràn 2 điểm ở ô 6. */
        case 7: return { min: 16, max: 34, step: 1 };  // cao 11+6·rh <= 125
        default: return { min: 16, max: 48, step: 16 };
      }
    },

    /* Ép con số về đúng cái máy vẽ được. Đồng hồ số bám vào bốn cỡ chữ có
     * thật; kim và lịch mượt từng điểm; chữ và icon nhân nguyên lần. */
    snapSize(type, s) {
      switch (type) {
        case 1: {
          const nac4 = [16, 32, 52, 64];
          let best = nac4[0];
          for (const v of nac4) if (Math.abs(v - s) < Math.abs(best - s)) best = v;
          return best;
        }
        case 2: return Math.max(8, Math.min(46, s));
        case 7: return Math.max(16, Math.min(34, s));
        case 3: return 16;                                    // pin: một cỡ
        default: return Math.max(16, Math.min(48, Math.round(s / 16) * 16));
      }
    },

    drawWidget(x, w, now, api) {
      const k = kOf(w.size);
      x.fillStyle = BK;
      switch (w.type) {
        case 1: {                                   // đồng hồ số
          const s = clockStr(now);
          const kieu = kieuGio(w.size);
          if (kieu >= 2) {
            const cw = kieu === 3 ? HOBO9_W : HOBO_W;
            const cc = kieu === 3 ? HOBO9_COLON : HOBO_COLON;
            const hh = kieu === 3 ? HOBO9_H : HOBO_H;
            x.font = 'bold ' + Math.round(hh * 0.88) + 'px "Hobo Std","HoboStd",Arial,sans-serif';
            x.textAlign = 'center';
            let px = w.x;
            for (const ch of s) {
              const cell = (ch === ':') ? cc : cw;
              x.fillText(ch, px + cell / 2, w.y + hh - 8);
              px += cell;
            }
            x.textAlign = 'left';
          } else {
            const kk = kieu + 1;
            uniText(x, s, w.x, w.y + 13 * kk, kk, true);
          }
        } break;
        case 2: { const r = parOfLocal(2, w.size).r; analog(x, w.x + r, w.y + r, r, now); } break;
        case 3:
          x.font = '8px ' + MONO;
          x.fillText('3.1v', w.x, w.y + 9);
          battery(x, w.x + 32, w.y + 4);
          break;
        case 4: uniText(x, '28°C', w.x, w.y + 13 * k, k, false); break;
        case 5: uniText(x, dateStr(now), w.x, w.y + 13 * k, k, false); break;
        case 6: uniText(x, lunarStrOf(now), w.x, w.y + 13 * k, k, false); break;
        case 7: { const p = parOfLocal(7, w.size); calendar(x, w.x, w.y, p.cw, p.rh, now); } break;
        case 15: uniText(x, WD[now.getDay()], w.x, w.y + 13 * k, k, false); break;
        case 16: uniText(x, solarStr(now), w.x, w.y + 13 * k, k, false); break;
        case 10: {
          const ic = api.iconImage();
          const kk = parOfLocal(10, w.size).k;
          if (ic) {
            const sm = x.imageSmoothingEnabled;
            x.imageSmoothingEnabled = false;
            x.drawImage(ic, w.x, w.y, ic.width * kk, ic.height * kk);
            x.imageSmoothingEnabled = sm;
          } else {
            const d = 32 * kk;
            x.strokeStyle = BK; x.lineWidth = 1;
            x.strokeRect(w.x + 0.5, w.y + 0.5, d, d);
            x.beginPath(); x.moveTo(w.x, w.y); x.lineTo(w.x + d, w.y + d);
            x.moveTo(w.x + d, w.y); x.lineTo(w.x, w.y + d); x.stroke();
          }
        } break;
        default:                                    // Chữ 1..6
          uniText(x, api.textOf(w), w.x, w.y + 13 * k, k, true);
          break;
      }
    },
  };
})();
