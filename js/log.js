/*
 * Nhật ký màn hình — DÙNG CHUNG cho hub và mọi app (4_2 / 4_2c / 7_5 /
 * 2_13 / 2_9 / dlg). Nạp TRƯỚC connector.js trong index.html.
 *
 * Trước đây addLog/clearLog bị chép nguyên văn ở 4 nơi (connector.js và
 * main.js của 3 dòng máy) — sửa kiểu hiển thị một chỗ là ba chỗ kia lệch.
 * Nay chỉ còn một bản duy nhất ở đây.
 *
 * connector.js vẫn BỌC window.addLog sau khi nạp app (để dò chuỗi trạng
 * thái kích hoạt "mac=…/act=…"), nên đừng đổi thành hàm khai báo cứng —
 * phải giữ dạng gán vào window.* thì lớp bọc mới hoạt động.
 */
(function () {
  'use strict';

  const MAX_LINES = 20;   // giữ log gọn, tránh phình DOM khi truyền ảnh

  // logTXT: nội dung; action: nhãn nhỏ in trước (vd '⇑' gửi, '⇓' nhận).
  // action đi qua innerHTML để dùng được ký tự/thẻ nhỏ — CHỈ truyền chuỗi
  // do webtool tự tạo, không bao giờ truyền dữ liệu thô từ thiết bị vào đây.
  window.addLog = function (logTXT, action = '') {
    const log = document.getElementById('log');
    if (!log) return;
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
    // nội dung dùng createTextNode: dữ liệu từ thiết bị không thể chèn thẻ
    logEntry.appendChild(document.createTextNode(logTXT));

    log.appendChild(logEntry);
    log.scrollTop = log.scrollHeight;

    while (log.childNodes.length > MAX_LINES) {
      log.removeChild(log.firstChild);
    }
  };

  window.clearLog = function () {
    const log = document.getElementById('log');
    if (log) log.innerHTML = '';
  };
})();
