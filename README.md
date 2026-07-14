# Telegram Satellite Route Bot

Ứng dụng bản đồ và chỉ đường thông minh chạy trực tiếp trên nền tảng Telegram Web App (Mini App), mang đến trải nghiệm điều hướng thời gian thực mượt mà và trực quan.

## Tính năng nổi bật

- **Bản đồ xoay thông minh (Track-up Rotation)**: Tự động điều chỉnh góc nhìn (Camera Rotation) của bản đồ dựa trên đoạn đường sắp tới (Lookahead) bằng công nghệ **OpenLayers** kết hợp với **Turf.js**. Nhờ đó, trải nghiệm điều hướng luôn được giữ ở góc nhìn "hướng thẳng", khắc phục triệt để lỗi nhiễu la bàn trên điện thoại.
- **Tính toán & Vẽ đường đi**: Hỗ trợ chỉ đường, hiển thị khoảng cách và thời gian dự kiến (ETA) tới điểm đến nhanh chóng.
- **Re-routing tự động (Tính lại tuyến)**: Sử dụng thuật toán Map Matching để nhận diện khi người dùng đi lệch tuyến (> 50m). Hệ thống sẽ tự động tính toán lại lộ trình và cập nhật bản đồ một cách âm thầm, không ngắt quãng trải nghiệm.
- **Giao diện & UI/UX hiện đại**: Thiết kế với phong cách Glassmorphism, hỗ trợ Dark/Light Mode tự động theo Telegram, tích hợp bộ tìm kiếm địa danh qua Photon Komoot API.
- **Trình Giả Lập GPS (Simulator Mode)**: Chế độ đặc biệt hỗ trợ phím điều hướng ngay trên Web, giúp dễ dàng debug và kiểm thử các tính năng bản đồ mà không cần phải di chuyển thực tế ngoài đường.

## Đóng góp & Phát triển

Dự án này là kết quả của sự hợp tác đặc biệt:
- **Người lên ý tưởng, Yêu cầu & Kiểm thử (Product Owner / QA)**: **@AnhDucwcs** (Bạn)
- **Lập trình viên & Hoàn thiện Mã nguồn (Lead Developer)**: **Antigravity (AI Agent - Google DeepMind)**

Toàn bộ hệ thống từ kiến trúc Frontend, logic xử lý bản đồ OpenLayers, thuật toán xoay 3D, đo đạc toạ độ không gian, cho đến các giao diện tinh chỉnh trải nghiệm người dùng đều được **Antigravity AI** trực tiếp mã hoá và hoàn thiện dựa trên chuỗi yêu cầu khắt khe từ người dùng.

## Cài đặt (Development)

1. Cài đặt các thư viện Python cho Backend (Flask/FastAPI):
   ```bash
   pip install -r requirements.txt
   ```
2. Tạo và cấu hình file biến môi trường:
   ```bash
   cp .env.example .env
   ```
3. Khởi chạy ứng dụng:
   ```bash
   uvicorn app.main:app --reload
   ```
*(Lưu ý: Để Telegram Webhook hoạt động, cần mở port ra internet bằng ngrok hoặc Cloudflare Tunnel).*