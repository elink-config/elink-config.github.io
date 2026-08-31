# Quy ước kho webtool (elink-config.github.io)

## TRƯỚC KHI ĐẨY LÊN LIVE: chạy bộ soát giao diện

```
python tools/kiem_giao_dien.py
```

Phải ra **«Khong thay hang giao dien nao bi an vinh vien»**. Có dòng cảnh báo thì
đọc từng dòng rồi sửa, hoặc thêm vào `BO_QUA` **kèm lý do** nếu ẩn là có chủ ý.

### Vì sao có bộ soát này

Trong một phiên làm việc 27/08 – 01/09/2026 đã dính **năm lần** cùng một kiểu lỗi,
mỗi lần ở một máy khác nhau, và **lần nào cũng do khách hàng phát hiện chứ không
phải mình**:

| Máy | Hàng biến mất | Nguyên nhân |
|---|---|---|
| 7.5" | cụm chọn kiểu hiển thị pin | gác sau `FwCheck.atLeast('1.9')` |
| 7.5" | khu «Tự động đổi ảnh» | gác sau `FwCheck.atLeast('1.5')` |
| 10.2" | «Chữ 3-6 / Thứ / Ngày dương» | thiếu hẳn hàm `fwHasSixText()` |
| 7.5" | «Hiện lại ảnh», «Làm nền» | chỉ mở trong nhánh `fw=` |
| 7.3" | «Hiện lại ảnh» | không hề có nút nào |

Lỗi này **im lặng tuyệt đối**: trang vẫn chạy, không có ngoại lệ nào trong console,
chỉ là người dùng không bao giờ thấy nút.

### Hai chỗ KHÔNG được treo giao diện vào

**1. Nhánh `fw=`.** Gói khai phiên bản **có thể rớt** — máy đang vẽ thì rớt gói như
chơi, và gói cấu hình ~220 byte cũng từng rớt khi MTU còn 23. Treo giao diện vào đó
là thỉnh thoảng mất nút mà không ai hiểu tại sao.

→ Chỗ đúng là **nhánh gói CẤU HÌNH**: nó luôn tới khi đã kết nối, và nó cũng là nơi
đọc ra `imgSlotMask` / `img_current` nên thứ tự tự nhiên là đúng.

**2. `FwCheck.atLeast('X.Y')` lấy mốc của DÒNG MÁY KHÁC.** Mỗi máy đánh số riêng.
Chép mốc `1.5` của bản 4.2" sang máy 7.5" đang ở v1.0 thì phép so **luôn sai** và cả
hàng không bao giờ hiện. Muốn gác theo tính năng thì dùng bảng năng lực
(`EpdProf.co('ten_cong')` sinh từ `tools/profile/*.json` bên kho firmware), đừng gõ
số vào mã.

Và tốt hơn cả gác theo phiên bản: **để máy TỰ BÁO**. Máy 7.3" báo `slots=N` và
`bgslots=M`; số khe là chuyện dung lượng chip chứ không phải chuyện phiên bản.

## Cache-buster

`VER` trong `js/connector.js` phải khớp các `?v=` trong `index.html`. **Sửa js/css là
phải bump**, không thì trình duyệt của khách vẫn chạy bản cũ.
