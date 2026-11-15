# CỔNG QUẢN LÝ CÂU LẠC BỘ VÀ QUỸ HOẠT ĐỘNG (QL_CLB)

> **Báo cáo Đồ án Thiết kế Hệ thống Thông tin / Công nghệ Phần mềm**  
> **Sinh viên thực hiện:** Hoàng Đình Tân  
> **Mã số sinh viên:** 1250080166  

---

## 📖 GIỚI THIỆU HỆ THỐNG

Hệ thống **Cổng Quản lý Câu lạc bộ và Quỹ Hoạt động (`ql_clb`)** là giải pháp số hóa toàn diện công tác quản trị nội bộ dành cho các tổ chức câu lạc bộ, đội nhóm thanh niên - sinh viên trong các cơ sở giáo dục đại học. Hệ thống giải quyết triệt để các bài toán thực tiễn: phân tán dữ liệu thành viên, quá tải sĩ số sự kiện, thiếu minh bạch trong đóng góp tài trợ, nợ tạm ứng tồn đọng và thiếu cơ chế dân chủ trong phê duyệt chi tiêu ngân sách.

### Kiến trúc công nghệ cốt lõi
* **Backend:** Ứng dụng **NestJS v11** trên nền tảng **Node.js / TypeScript**, tuân thủ mô hình kiến trúc MVC (Model - View - Controller) phân tầng rõ ràng.
* **Cơ sở dữ liệu:** **Microsoft SQL Server 2022**, chuẩn hóa dạng chuẩn 3 (3NF), thực thi thuần qua driver `mssql` kết hợp Transaction Scope bảo đảm tính toàn vẹn **ACID**, bảo vệ số dư và chống ghi đè tương tranh (*không sử dụng ORM nặng nề*).
* **Bảo mật & Phân quyền:** Phân quyền theo vai trò **RBAC 6 cấp** (`GUEST`, `MEMBER`, `TREASURER`, `PRESIDENT`, `BOARD`, `ADMIN`), mã hóa mật khẩu an toàn bằng **Bcrypt** (12 rounds) và cơ chế xác thực kép **JWT (Access Token 15 phút + Refresh Token 7 ngày)**.
* **Frontend:** Ứng dụng đơn trang **Single Page Application (SPA)** thuần JavaScript chuẩn Web Components (W3C), Bootstrap 5, giao diện tiếng Việt thân thiện, phản hồi tức thời.

---

## 🛠️ YÊU CẦU MÔI TRƯỜNG CÀI ĐẶT

Trước khi chạy dự án, hãy đảm bảo máy tính của bạn đã cài đặt các công cụ sau:

1. **Node.js:** Phiên bản **v20.x LTS** hoặc mới hơn (tải tại [nodejs.org](https://nodejs.org/)).
2. **Package Manager:** **pnpm** (khuyến nghị, cài qua lệnh `npm install -g pnpm`) hoặc `npm`.
3. **Docker Desktop:** Phiên bản mới nhất (để khởi chạy SQL Server 2022 và công cụ quản trị CSDL CloudBeaver qua Docker Container).
4. **Git:** Để clone và quản lý mã nguồn.

---

## 🚀 HƯỚNG DẪN CÀI ĐẶT VÀ CHẠY DỰ ÁN TỪNG BƯỚC

Mở cửa sổ dòng lệnh (**PowerShell** hoặc **Terminal**) tại thư mục gốc của dự án và thực hiện tuần tự các bước sau:

### Bước 1: Khởi tạo tệp cấu hình môi trường (`.env`)

Tạo tệp `.env` từ tệp mẫu `.env.example` (lệnh PowerShell không ghi đè nếu đã tồn tại):

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

> [!IMPORTANT]
> Mở tệp `.env` kiểm tra các thông số quan trọng:
> * `PORT=3001` (Cổng chạy hệ thống).
> * `JWT_SECRET=...` (Chuỗi khóa bí mật bắt buộc dài **ít nhất 32 ký tự**).
> * `MSSQL_HOST=127.0.0.1`, `MSSQL_PORT=1433`, `MSSQL_USER=sa`, `MSSQL_PASSWORD=SqlAdmin@123456`, `MSSQL_DATABASE=ql_clb`.
> * `FUND_RESERVE_THRESHOLD=5000000` (Ngưỡng an toàn bảo vệ Quỹ dự phòng: 5.000.000 VNĐ).

---

### Bước 2: Cài đặt các gói phụ thuộc (Dependencies)

Sử dụng `pnpm` để cài đặt đầy đủ các thư viện Backend và công cụ biên dịch:

```powershell
pnpm install
```

---

### Bước 3: Khởi động Microsoft SQL Server bằng Docker

Khởi chạy container CSDL SQL Server 2022 ở chế độ nền (Background Daemon):

```powershell
docker compose up -d mssql
```

*Kiểm tra trạng thái container:*
```powershell
docker ps
```
*(Đảm bảo container `ql_clb_mssql` đang ở trạng thái `Up` và cổng `1433` đã sẵn sàng).*

---

### Bước 4: Thực thi di chuyển lược đồ CSDL (Database Migration)

Hệ thống quản lý lược đồ CSDL qua 9 tệp SQL Migration tuần tự (`db/migrations/`). Chạy lệnh sau để tự động tạo cơ sở dữ liệu `ql_clb`, tạo 14 bảng quan hệ, các View và Stored Procedure:

```powershell
pnpm db:migrate
```

*Cơ chế an toàn:* Lệnh migration sử dụng bảng `schema_migrations` và cơ chế khóa ứng dụng độc quyền `sp_getapplock` của SQL Server. Mỗi tệp migration được thực thi trong một Transaction độc lập, nếu đã chạy rồi sẽ tự động bỏ qua.

---

### Bước 5: Khởi tạo dữ liệu mẫu (Seed Data)

Nạp dữ liệu mẫu ban đầu gồm tài khoản các cấp lãnh đạo, thành viên, các sự kiện phong trào, đề xuất chi, biểu quyết và giao dịch quỹ:

```powershell
pnpm seed
```

---

### Bước 6: Khởi động hệ thống (Start Application)

Khởi chạy máy chủ phát triển Backend tích hợp phục vụ Frontend:

```powershell
pnpm start:dev
```

Khi màn hình xuất hiện thông báo:
```text
[NestApplication] Nest application successfully started
Application is running on: http://localhost:3001
```
Dự án đã sẵn sàng hoạt động!

---

## 🌐 DANH SÁCH ĐƯỜNG DẪN TRUY CẬP (ENDPOINTS)

Sau khi khởi động thành công, bạn có thể truy cập các dịch vụ sau từ trình duyệt web:

| Phân hệ / Dịch vụ | Địa chỉ URL | Mô tả chức năng |
| :--- | :--- | :--- |
| **Giao diện Người dùng (SPA)** | [http://localhost:3001/](http://localhost:3001/) | Tự động chuyển hướng đến màn hình Đăng nhập hệ thống |
| **Tài liệu API tương tác (Swagger UI)** | [http://localhost:3001/docs](http://localhost:3001/docs) | Tra cứu, kiểm thử trực tiếp toàn bộ RESTful API |
| **Kiểm tra trạng thái (Health Check)** | [http://localhost:3001/health](http://localhost:3001/health) | Giám sát kết nối CSDL và tài nguyên máy chủ |
| **Quản trị CSDL (CloudBeaver Web GUI)** | [http://localhost:8978](http://localhost:8978) | Xem bảng, truy vấn SQL trực quan trên trình duyệt |

---

## 🔑 DANH SÁCH TÀI KHOẢN THỬ NGHIỆM (SEED ACCOUNTS)

Hệ thống đã chuẩn bị sẵn 5 nhóm tài khoản tương ứng với các vai trò trong mô hình phân quyền RBAC:

| Vai trò (Role) | Email đăng nhập | Mật khẩu | Họ và tên | Thẩm quyền chính |
| :--- | :--- | :--- | :--- | :--- |
| **PRESIDENT** | `president@example.com` | `President@123456` | Nguyễn Văn An | Chủ tịch CLB: Quản trị toàn diện, xét duyệt đơn gia nhập, tạo sự kiện, ký quyết định tài chính |
| **BOARD** | `board@example.com` | `Board@123456` | Trần Thị Mai Phương | Ban Chủ nhiệm: Giám sát, biểu quyết, duyệt chi vượt dự toán, duyệt tờ trình rút Quỹ dự phòng |
| **TREASURER** | `treasurer@example.com` | `Treasurer@123456` | Lê Hoàng Long | Thủ quỹ CLB: Quản lý Quỹ chính & Quỹ dự phòng, tiếp nhận tài trợ, giải ngân công nợ, lập tờ trình rút quỹ |
| **MEMBER** | `member@example.com` | `Member@123456` | Phạm Minh Tuấn | Hội viên chính thức: Đăng ký tham gia sự kiện, lập đề xuất chi tiêu, bỏ phiếu biểu quyết dân chủ |
| **MEMBER 2** | `member2@example.com` | `Member@123456` | Đỗ Thu Hà | Cử tri độc lập phục vụ kiểm thử tính năng bỏ phiếu đa vòng |
| **GUEST** | *(Đăng ký tự do)* | *(Tự chọn)* | Khách vãng lai | Đăng ký tài khoản trực tuyến (BM1), nộp tài trợ tự nguyện (BM4) |

---

## 📱 CÁC PHÂN HỆ VÀ ROUTE NGHIỆP VỤ TRÊN GIAO DIỆN

Hệ thống bao gồm 4 phân hệ nghiệp vụ chính với các giao diện chức năng:

### 1. Phân hệ Xác thực & Quản lý Hội viên
* **Đăng nhập:** `/routes/auth/login/`
* **Đăng ký gia nhập CLB (BM1):** `/routes/auth/register/`
* **Danh sách hội viên:** `/routes/members/list/`
* **Xét duyệt đơn gia nhập (Chủ tịch CLB):** `/routes/members/approvals/`

### 2. Phân hệ Hoạt động & Sự kiện
* **Danh sách sự kiện phong trào:** `/routes/events/list/`
* **Khởi tạo sự kiện mới (Chủ tịch / BCN):** `/routes/events/create/`
* **Chi tiết sự kiện & Đăng ký tham gia (BM2):** `/routes/events/detail/?id={eventId}`

### 3. Phân hệ Đề xuất Chi & Biểu quyết Dân chủ
* **Danh sách đề xuất chi tiêu:** `/routes/proposals/list/`
* **Lập dự toán đề xuất chi mới (BM3):** `/routes/proposals/create/`
* **Hòm phiếu biểu quyết kín điện tử:** `/routes/voting/detail/?id={proposalId}`
* **Thẩm định & Phê chuẩn đề xuất (BCN):** `/routes/approvals/list/`

### 4. Phân hệ Quản lý Tài chính, Công nợ & Quỹ Dự phòng
* **Bảng điều khiển số dư ngân quỹ:** `/routes/funds/dashboard/`
* **Biên nhận tiếp nhận tài trợ (BM4):** `/routes/funds/contribute/`
* **Sổ theo dõi & Chi trả công nợ (BM6):** `/routes/funds/payables/`
* **Tờ trình xin rút Quỹ dự phòng (BM5):** `/routes/funds/reserve-request/`
* **Báo cáo tổng kết thu chi tài chính:** `/routes/funds/reports/`
* **Bảng điều khiển giám sát Quản trị viên:** `/routes/admin/dashboard/`

---

## 📁 CẤU TRÚC THƯ MỤC DỰ ÁN

```text
ql_clb/
├── client/                     # Mã nguồn Giao diện Người dùng (Frontend SPA)
│   ├── routes/                 # 16 màn hình giao diện theo từng phân hệ
│   └── shared/                 # Thành phần dùng chung (api.js, auth-nav.js, styles)
├── db/                         # Cơ sở dữ liệu
│   └── migrations/             # 09 tệp SQL Migration (3NF, ACID, Stored Procs, Views)
├── docs/                       # Tài liệu thuyết minh đồ án
│   ├── Bao_cao_TKHT.docx       # Báo cáo Thiết kế Hệ thống Thông tin (120 trang)
│   ├── chuong_6/               # Ảnh chụp 16 màn hình giao diện
│   └── uml/                    # Các sơ đồ kiến trúc, Use Case, Activity, Sequence, Class
├── scripts/                    # Kịch bản dòng lệnh hỗ trợ
│   ├── migrate.ts              # Script điều phối SQL Migration
│   └── seed.ts                 # Script nạp dữ liệu mẫu ban đầu
├── src/                        # Mã nguồn Backend NestJS (MVC)
│   ├── auth/                   # Phân hệ Xác thực, JWT Token, Bcrypt
│   ├── members/                # Phân hệ Quản lý Thành viên, Duyệt đơn, RBAC
│   ├── events/                 # Phân hệ Quản lý Sự kiện phong trào
│   ├── proposals/              # Phân hệ Đề xuất chi & Bỏ phiếu biểu quyết
│   ├── funds/                  # Phân hệ Tài chính, Quỹ hoạt động & Quỹ dự phòng
│   ├── transactions/           # Phân hệ Giao dịch, Công nợ, Idempotency-Key
│   ├── notifications/          # Phân hệ Thông báo in-app thời gian thực
│   ├── database/               # Module kết nối SQL Server Connection Pool
│   └── main.ts                 # Điểm khởi động ứng dụng NestJS & cấu hình Swagger
├── docker-compose.yml          # Cấu hình container SQL Server 2022 & CloudBeaver
├── package.json                # Danh mục dependencies và scripts thực thi
└── README.md                   # Tài liệu hướng dẫn cài đặt và vận hành hệ thống
```

---

## ⚡ CÁC LỆNH DÒNG LỆNH HỮU ÍCH (CLI COMMANDS)

| Lệnh thực thi | Mô tả chức năng |
| :--- | :--- |
| `pnpm start:dev` | Chạy ứng dụng Backend + Frontend ở chế độ phát triển (Hot-reload) |
| `pnpm build` | Biên dịch mã nguồn TypeScript sang JavaScript (`dist/`) |
| `pnpm start:prod` | Chạy ứng dụng bản Production đã biên dịch |
| `pnpm db:migrate` | Chạy các tệp migration cập nhật lược đồ CSDL |
| `pnpm seed` | Nạp lại toàn bộ dữ liệu mẫu ban đầu |
| `pnpm seed:president` | Chỉ khởi tạo/cập nhật duy nhất tài khoản Chủ tịch CLB |
| `pnpm test` | Chạy bộ kiểm thử đơn vị (Unit Tests) với Jest |
| `pnpm test:e2e` | Chạy bộ kiểm thử tích hợp đầu cuối (End-to-End Tests) |
| `pnpm format` | Định dạng chuẩn hóa toàn bộ mã nguồn với Prettier |
| `pnpm lint` | Kiểm tra lỗi cú pháp và quy chuẩn mã nguồn với ESLint |
| `docker compose down` | Dừng và tắt các container Docker |

---

## ❓ XỬ LÝ SỰ CỐ THƯỜNG GẶP (TROUBLESHOOTING)

1. **Lỗi không kết nối được SQL Server (`ConnectionError: Failed to connect to 127.0.0.1:1433`):**
   * Kiểm tra container Docker đã chạy chưa: `docker compose ps`.
   * Chờ khoảng 15-20 giây sau khi gõ `docker compose up -d mssql` để SQL Server khởi động hoàn tất trước khi chạy lệnh `pnpm db:migrate`.
2. **Lỗi xung đột cổng `3001` hoặc `1433`:**
   * Nếu cổng `1433` bị chiếm dụng bởi SQL Server cài sẵn trên máy (Windows Service), bạn có thể dừng service đó trong `services.msc` hoặc đổi port ánh xạ trong `docker-compose.yml`.
   * Nếu cổng `3001` đang bị ứng dụng khác dùng, mở tệp `.env` sửa thành `PORT=3002`.
3. **Lỗi `JWT_SECRET must be at least 32 characters long`:**
   * Mở tệp `.env`, kiểm tra biến `JWT_SECRET` và đảm bảo chuỗi ký tự có độ dài tối thiểu từ 32 ký tự trở lên.

---

> [!TIP]
> Để đối soát toàn diện tài liệu thiết kế và kiểm thử với báo cáo đồ án, vui lòng tham khảo tệp văn bản thuyết minh hoàn chỉnh tại: **`docs/Bao_cao_TKHT.docx`**.
