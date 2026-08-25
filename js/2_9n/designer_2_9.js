/*
 * HỒ SƠ VẼ của «Tự thiết kế» cho màn 2.13" — soi đúng theo DrawCustom() trong
 * firmware (epd_2_9inch_new/src/gui/GUI.c).
 *
 * Vì sao phải có file này: js/common/designer.js dựng hình theo màn 4.2" —
 * đồng hồ số vẽ bằng nét 7 đoạn, lịch tháng rộng tới 400px, bán kính kim tới
 * 150px. Màn này chỉ rộng 212px, KHÔNG có font 7 đoạn, và firmware chỉ nhận
 * BA NẤC cỡ (`sz = size > 2 ? 2 : size`) chứ không có cỡ tự do. Dùng nguyên
 * bản kia thì khung xem trước vẽ một đằng, máy vẽ một nẻo.
 *
 * Phải nạp TRƯỚC js/common/designer.js (xem danh sách script trong connector.js).
 *
 * ⚠ Số đo ở đây là GIAO ƯỚC với firmware. Sửa DrawCustom bên kia thì sửa cả
 *   đây, nếu không người dùng xếp một kiểu, máy hiện một kiểu.
 */
(function () {
  // ── số đo lấy thẳng từ DrawCustom ────────────────────────────────────────
  const RR = [22, 32, 46];   // bán kính mặt kim theo nấc
  const CWS = [10, 13, 16];  // bề rộng ô lịch
  const RHS = [9, 11, 13];   // chiều cao hàng lịch
  const UNI = 8, UNI_H = 16; // unifont: MỌI ký tự rộng đúng 8px (font điểm ảnh)
  const HOBO_W = 34, HOBO_COLON = 15, HOBO_H = 52;  // hobo_2_13_tn, đo từ blob
  const BK = '#151515', WH = '#f6f4ec';
  const MONO = '"DejaVu Sans Mono",Consolas,monospace';

  const nac = s => (s > 2) ? 2 : Math.max(0, s | 0);
  /* Nhóm CHỮ chỉ có HAI mức: firmware viết `if (sz) draw_x2(...) else ...`,
   * tức nấc 1 và nấc 2 đều ra cỡ đôi — không bao giờ có 3x. */
  const kOf = s => nac(s) ? 2 : 1;

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

  function analog(x, cx, cy, r, now) {
    x.strokeStyle = BK; x.lineWidth = 1;
    x.beginPath(); x.arc(cx, cy, r, 0, 7); x.stroke();
    for (let k = 0; k < 60; k += 5) {
      const a = k * Math.PI / 30;
      x.beginPath();
      x.moveTo(cx + (r - 2) * Math.sin(a), cy - (r - 2) * Math.cos(a));
      x.lineTo(cx + (r - 5) * Math.sin(a), cy - (r - 5) * Math.cos(a));
      x.stroke();
    }
    const h = now.getHours() % 12, m = now.getMinutes();
    const ha = (h + m / 60) * Math.PI / 6, ma = m * Math.PI / 30;
    x.lineCap = 'round';
    x.lineWidth = 2.5; x.beginPath(); x.moveTo(cx, cy);
    x.lineTo(cx + r * 0.5 * Math.sin(ha), cy - r * 0.5 * Math.cos(ha)); x.stroke();
    x.lineWidth = 1.5; x.beginPath(); x.moveTo(cx, cy);
    x.lineTo(cx + r * 0.75 * Math.sin(ma), cy - r * 0.75 * Math.cos(ma)); x.stroke();
    x.lineCap = 'butt';
    // bốn con số 12/3/6/9 chữ nhỏ 6x10 — đúng bốn chỗ firmware đặt
    x.fillStyle = BK;
    x.font = '8px ' + MONO;
    x.textAlign = 'center';
    x.fillText('12', cx, cy - r + 12);
    x.fillText('3', cx + r - 7, cy + 4);
    x.fillText('6', cx, cy + r - 4);
    x.fillText('9', cx - r + 7, cy + 4);
    x.textAlign = 'left';
  }

  /* Lưới lịch tháng: hàng THỨ (6x10 đậm), vạch ngang, rồi các ngày — cột 0 là
   * THỨ HAI, hôm nay tô ô đen chữ trắng. Khớp grid_header + month_grid_s. */
  function calendar(x, gx, gy, cw, rh, now) {
    const HDR = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
    x.fillStyle = BK;
    x.font = 'bold 8px ' + MONO;
    x.textAlign = 'center';
    for (let i = 0; i < 7; i++) x.fillText(HDR[i], gx + i * cw + cw / 2, gy + 7);
    x.fillRect(gx, gy + 8, cw * 7 - 1, 1);

    const first = (new Date(now.getFullYear(), now.getMonth(), 1).getDay() + 6) % 7;
    const maxD = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    for (let d = 1; d <= maxD; d++) {
      const idx = first + d - 1, col = idx % 7, row = (idx / 7) | 0;
      const cx = gx + col * cw + cw / 2, cy = gy + 11 + row * rh;
      const today = d === now.getDate();
      if (today) { x.fillStyle = BK; x.fillRect(cx - cw / 2, cy - 1, cw, rh - 1); }
      x.fillStyle = today ? WH : BK;
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
    1: s => {
      const z = nac(s);
      if (z === 2) return [HOBO_W * 4 + HOBO_COLON, HOBO_H];
      const k = z ? 2 : 1;
      return [uniW('00:00', k), UNI_H * k];
    },
    3: () => [50, 14],
    4: s => [uniW('28°C', kOf(s)), UNI_H * kOf(s)],
    5: (s, t) => [uniW(dateStr(new Date()), kOf(s)), UNI_H * kOf(s)],
    6: s => [uniW('Âm 24/05', kOf(s)), UNI_H * kOf(s)],
    7: s => { const z = nac(s); return [CWS[z] * 7, 11 + 6 * RHS[z]]; },
    15: s => [uniW('Chủ nhật', kOf(s)), UNI_H * kOf(s)],
    16: s => [uniW('25/08/2026', kOf(s)), UNI_H * kOf(s)],
  };
  // Chữ 1..6 — đo theo nội dung đang gõ
  [8, 9, 11, 12, 13, 14].forEach(t => {
    dims[t] = (s, txt) => [uniW(txt || 'Chữ', kOf(s)), UNI_H * kOf(s)];
  });

  window.EPD_DS_DEVICE = {
    /* Tên máy — designer.js lấy nó làm khoá lưu bản nháp, để bố cục của máy
     * này không lẫn với máy khác dùng chung trình duyệt. */
    key: '2_9n',

    // Khổ màn ĐỌC ĐỘNG: máy 2.13" có hai tấm, đổi driver là đổi khổ.
    /* ⚠ ĐỌC BẰNG TÊN TRẦN, đừng qua window.
     *
     * main.js khai `const RESOLUTIONS` và `let resIdx` ở mức trên cùng của một
     * script thường — hai thứ đó nằm trong phạm vi script chung, KHÔNG trở
     * thành thuộc tính của window. Đọc window.RESOLUTIONS ra undefined, thế là
     * bộ dựng luôn tưởng màn 212x104 kể cả khi người dùng đã chọn tấm 250x122.
     *
     * try/catch vì file này nạp TRƯỚC main.js: nếu có ai gọi sớm thì `resIdx`
     * còn trong vùng chết của `let` và `typeof` cũng ném lỗi. */
    size: () => {
      try {
        if (RESOLUTIONS && RESOLUTIONS[resIdx]) {
          return { w: RESOLUTIONS[resIdx].w, h: RESOLUTIONS[resIdx].h };
        }
      } catch (e) { /* main.js chưa nạp xong */ }
      return { w: 212, h: 104 };
    },
    // firmware kẹp size > 2 về 2 -> không có cỡ tự do, chỉ ba nấc
    freeSize: false,
    sizes: { 1: 3, 2: 3, 3: 1, 4: 2, 5: 2, 6: 2, 7: 3, 10: 3, 15: 2, 16: 2 },
    dims: dims,

    parOf(type, s) {
      const z = nac(s);
      switch (type) {
        case 2: return { r: RR[z] };
        case 7: return { cw: CWS[z], rh: RHS[z] };
        case 10: return { k: z + 1 };
        default: return { k: kOf(s) };       // nhóm chữ: 1x hoặc 2x
      }
    },

    drawWidget(x, w, now, api) {
      const z = nac(w.size), k = kOf(w.size);
      x.fillStyle = BK;
      switch (w.type) {
        case 1: {                                   // đồng hồ số
          const s = clockStr(now);
          if (z === 2) {
            // nấc to nhất dùng font Hobo — chữ số rộng cố định 34px
            x.font = 'bold 46px "Hobo Std","HoboStd",Arial,sans-serif';
            x.textAlign = 'center';
            let px = w.x;
            for (const ch of s) {
              const cw = (ch === ':') ? HOBO_COLON : HOBO_W;
              x.fillText(ch, px + cw / 2, w.y + 44);
              px += cw;
            }
            x.textAlign = 'left';
          } else {
            uniText(x, s, w.x, w.y + 13 * k, k, true);
          }
        } break;
        case 2: { const r = RR[z]; analog(x, w.x + r, w.y + r, r, now); } break;
        case 3:
          x.font = '8px ' + MONO;
          x.fillText('3.1v', w.x, w.y + 9);
          battery(x, w.x + 32, w.y + 4);
          break;
        case 4: uniText(x, '28°C', w.x, w.y + 13 * k, k, false); break;
        case 5: uniText(x, dateStr(now), w.x, w.y + 13 * k, k, false); break;
        case 6: uniText(x, lunarStrOf(now), w.x, w.y + 13 * k, k, false); break;
        case 7: calendar(x, w.x, w.y, CWS[z], RHS[z], now); break;
        case 15: uniText(x, WD[now.getDay()], w.x, w.y + 13 * k, k, false); break;
        case 16: uniText(x, solarStr(now), w.x, w.y + 13 * k, k, false); break;
        case 10: {
          const ic = api.iconImage();
          const kk = z + 1;
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
