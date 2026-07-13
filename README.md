# DA14585 E-Ink webtool (bản kết hợp)

Webtool hợp nhất cho các thiết bị E-Ink dùng chip DA14585, gộp bốn tool:

| Thiết bị (tên BLE) | Tool gốc | Giao diện |
|---|---|---|
| `DIY-4_2-xxxx` (màn 4.2", 400×300) | [EPD-DA14585/webtools/4_2inch](https://github.com/elink-config/EPD-DA14585) | Thời gian, điều khiển chế độ màn hình, thiết kế màn hình, truyền hình ảnh, OTA firmware |
| `DIY-2_13-xxxx` (màn 2.13", 212×104, 250×122) | [EPD-DA14585/webtools/2_13inch](https://github.com/elink-config/EPD-DA14585) | Thời gian, màn hình (đổi độ phân giải, nhiệt độ, pin), điều khiển, cấu hình giao diện, thiết kế màn hình, truyền hình ảnh, OTA firmware |
| `DIY-2_9-xxxx` (màn 2.9" BWR, 296×128) | [EPD-DA14585/webtools/2_9inch](https://github.com/elink-config/EPD-DA14585) | Thời gian, màn hình (nhiệt độ, pin), điều khiển (1 chế độ đồng hồ + ảnh), truyền hình ảnh, OTA firmware |
| `DLG-CLOCK-xxxx` (màn 2.13", 212×104 phiên bản cũ) | tool 1 file gốc của trang này | Đặt giờ, điều khiển thiết bị, đếm ngược, truyền hình ảnh, thiết kế mẫu |

Trang chạy tại: **https://elink-config.github.io/**

## Cách hoạt động

Trang chỉ hiển thị phần **Kết nối Bluetooth**. Sau khi bấm «Kết nối» và chọn
thiết bị, `js/connector.js` nhận dạng loại thiết bị theo tên quảng bá BLE,
nạp giao diện tương ứng từ `<template>` trong `index.html` và các script
trong `js/4_2/`, `js/2_13/`, `js/2_9/` hoặc `js/dlg/`, rồi bàn giao thiết bị đã chọn cho
hàm `connect()` của tool gốc. Các mục điều khiển chỉ hiện ra khi kết nối
thành công.

Mỗi lượt tải trang chỉ chạy được một loại thiết bị — kết nối thiết bị loại
khác sẽ được hỏi tải lại trang.

## Cấu trúc

- `index.html` — khung kết nối + 4 template giao diện
- `js/connector.js` — hub: quét BLE, nhận dạng, nạp app, bàn giao kết nối
- `js/dithering.js`, `js/paint.js`, `js/crop.js` — pipeline ảnh dùng chung cho các tool DIY
- `js/4_2/`, `js/2_13/` — script gốc (không chỉnh sửa) của hai tool DIY
- `js/2_9/` — tool 2.9" BWR 296×128 (firmware 1 chế độ; rút gọn từ tool 2.13")
- `js/dlg/` — tool DLG-CLOCK tách từ file đơn `index.html` gốc:
  - `image.js` — dithering + đóng gói dữ liệu ảnh
  - `main.js` — BLE, lệnh điều khiển, truyền ảnh, đếm ngược (đã Việt hóa, bỏ popup và tab)
  - `editor.js` — thiết kế mẫu (canvas 600×450, icon, mã QR, ảnh nền)
  - `qrcode.min.js` — thư viện QR (davidshimjs-qrcodejs, tải về dùng nội bộ)
- `OTA firmware/` — firmware 2.13"/4.2" cho mục cập nhật OTA
- `.github/workflows/deploy.yml` — tự động deploy GitHub Pages sau mỗi lần push lên `main`

## Dev

- `?debug=true` — bật chế độ dev (hiện các điều khiển ẩn, quét mọi thiết bị BLE)
- `?debug=true&app=4_2|2_13|2_9|dlg` — xem trước giao diện một app mà không cần thiết bị
