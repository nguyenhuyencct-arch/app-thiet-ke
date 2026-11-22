# Studio AI — Bộ công cụ thiết kế AI

Ứng dụng web xử lý ảnh bằng AI cho dân thiết kế, in ấn và bán hàng online. Chạy hoàn toàn trên trình duyệt, không cần cài đặt, không cần server.

## 16 công cụ

| Công cụ | Chức năng | Xử lý |
|---|---|---|
| Kích nét ảnh | Làm nét, tái tạo chi tiết, phóng to ảnh mờ | AI / offline |
| Xóa nền PNG | Tách nền trong suốt, thay nền màu, xử lý hàng loạt | Offline / AI |
| Bóc tách Layer | Tách tối đa 9 đối tượng thành PNG + 1 layer nền | AI |
| Phục hồi ấn phẩm | Ảnh chụp banner/biển cũ → file thiết kế phẳng, sắc nét | AI |
| Retoucher sản phẩm | Làm sạch, chỉnh sáng, thay phông studio TMĐT | AI |
| Render 2D sang 3D | Nhãn, bao bì, bản vẽ 2D → ảnh sản phẩm 3D | AI |
| Chuyển Vector | Trace ảnh thành SVG (màu / xám / đen trắng) | Offline |
| Thiết kế quảng cáo | Banner, poster có tiêu đề, CTA, logo, nhiều phương án | AI |
| Fake Model AI | Ghép dáng từ ảnh 1 cho người ở ảnh 2 | AI |
| Thay trang phục | Thử đồ theo ảnh hoặc mô tả, giữ khuôn mặt | AI |
| Studio POD | Phục hồi file in + mockup áo, cốc, túi, tranh… | AI |
| Phối cảnh biển hiệu | Gắn biển 2D vào mặt tiền thực tế | AI |
| Phục hồi ảnh cũ | Khử xước, ố, tô màu ảnh xưa | AI |
| Bế file in ấn | Tạo đường cắt CutContour, viền sticker, xuất SVG | Offline |
| Chỉnh sửa ảnh thẻ | Ảnh thẻ chuẩn 3x4, 4x6…, đổi nền/trang phục, xếp khổ in 10x15 | AI |
| Chỉnh sửa tự do | Sửa / tạo ảnh bằng câu lệnh | AI |

## Cách dùng

1. Mở `index.html` bằng Chrome/Edge (hoặc chạy `python3 -m http.server` trong thư mục rồi mở `http://localhost:8000`).
2. Bấm **Cài đặt** → dán **Gemini API key** (lấy tại https://aistudio.google.com/apikey) → **Kiểm tra kết nối** → **Lưu**.
3. Chọn công cụ, kéo thả / dán ảnh (Ctrl+V), chỉnh tùy chọn, bấm **Bắt đầu xử lý**.

Mỗi công cụ mở thành một tab riêng, có thể chạy song song. Kết quả có nút tải PNG/SVG, so sánh trước/sau và "Dùng tiếp" để đưa kết quả làm ảnh đầu vào.

### Chọn model & tiết kiệm chi phí

Mỗi công cụ tự chọn model vừa đủ cho việc của nó:

| Bậc | Model | Dùng cho |
|---|---|---|
| Lite | `gemini-3.1-flash-lite-image` | Tách nền bằng AI, làm sạch ảnh trước khi trace vector |
| Flash | `gemini-3.1-flash-image` | Kích nét, retouch, thay đồ, fake model, ảnh cũ, ảnh thẻ, bóc layer, mockup POD, chỉnh sửa tự do |
| Pro | `gemini-3-pro-image` | Thiết kế quảng cáo, phối cảnh biển hiệu, phục hồi ấn phẩm, render 3D bao bì, phục hồi file in POD (cần chữ/logo chuẩn) |

Trong **Cài đặt → Chế độ**: *Tiết kiệm* (không dùng Pro, ảnh 1K), *Tối ưu* (theo bảng trên), *Chất lượng cao* (nâng một bậc). Mỗi công cụ còn có ô **Model AI** để chọn riêng.

Các cơ chế tiết kiệm khác: xóa nền / vector / bế file chạy offline miễn phí; yêu cầu trùng lặp được dùng lại kết quả; nếu một model không còn (404) app tự chuyển sang model khác. Pro cần bật Billing cho API key.

Xóa nền offline dùng thư viện `@imgly/background-removal` tải từ CDN ở lần dùng đầu (~40MB). Nếu không tải được, app tự chuyển sang Gemini.

## Cấu trúc

```
index.html          giao diện chính
css/style.css       giao diện tối
js/app.js           tab, form, kết quả, cài đặt
js/tools.js         định nghĩa 16 công cụ (input, tùy chọn, prompt)
js/gemini.js        gọi Gemini API
js/imageutils.js    xử lý ảnh trên canvas (chroma key, vector, bế, ảnh thẻ…)
vendor/             imagetracerjs (public domain)
```

Muốn thêm công cụ mới: thêm một mục `T.push({...})` vào `js/tools.js`.
