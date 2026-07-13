# OTA firmware

Thư mục chứa các bản firmware `.bin` phát hành cho màn 4.2" (project
`epd_4_2inch` trong repo [EPD-DA14585](https://github.com/elink-config/EPD-DA14585)).

Cách thêm bản mới:

1. Build project `epd_4_2inch` bằng Keil (target DA14585), lấy file
   `Keil_5/out_DA14585/Objects/fw_1.bin`.
2. Đổi tên theo mẫu `fw_4_2inch_v<phiên bản>.bin` rồi chép vào thư mục này.
3. Thêm một dòng vào bảng «Danh sách firmware» trong `index.html`
   (có sẵn dòng mẫu trong comment).

Lưu ý: file .bin phải chứa magic phiên bản `79 13 A5 F9 86 EC 5A 06`
(`epd_version[]` trong `user_app.c`) — webtool từ chối file thiếu magic.
Firmware cũ (repo EPD-DA14585-4_2inch, SDK 6.0.18) KHÔNG có magic này và
cũng không hiểu lệnh OTA 0xA0 — máy đang chạy bản cũ phải nạp bản mới
qua SUOTA hoặc nạp dây một lần trước.
