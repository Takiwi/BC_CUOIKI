# Cổng quản lý câu lạc bộ và quỹ hoạt động

Backend NestJS dùng Microsoft SQL Server (MSSQL) qua `mssql` và raw SQL; frontend là HTML/CSS/JavaScript thuần với Bootstrap 5. Không sử dụng ORM.

## Chạy local trên Windows

1. Cài Node.js, pnpm và Docker Desktop.
2. Tạo `.env` từ mẫu nếu máy chưa có file này. Không ghi đè `.env` hiện có:

   ```powershell
   if (-not (Test-Path .env)) { Copy-Item .env.example .env }
   ```

3. Đặt `PORT=3001` (hoặc cổng bạn muốn) và thông tin cấu hình SQL Server trong `.env`.
   - `JWT_SECRET` phải dài ít nhất 32 ký tự.
   - `MSSQL_HOST=127.0.0.1`, `MSSQL_PORT=1433`, `MSSQL_USER=sa`, `MSSQL_PASSWORD=SqlAdmin@123456`, `MSSQL_DATABASE=ql_clb`.
4. Cài dependencies, khởi động SQL Server container, áp dụng migration và khởi tạo dữ liệu mẫu (Seed):

   ```powershell
   pnpm install
   docker compose up -d mssql
   pnpm db:migrate
   pnpm seed
   ```

   *Danh sách tài khoản mẫu sau khi seed:*
   | Vai trò | Email | Mật khẩu (trước khi hash) | Họ và tên |
   | :--- | :--- | :--- | :--- |
   | **PRESIDENT** | `president@example.com` | `President@123456` | Chủ tịch CLB |
   | **BOARD** | `board@example.com` | `Board@123456` | Ban Chủ nhiệm (Board) |
   | **TREASURER** | `treasurer@example.com` | `Treasurer@123456` | Thủ quỹ CLB (Treasurer) |
   | **MEMBER** | `member@example.com` | `Member@123456` | Thành viên CLB (Member) |

5. Khởi động hệ thống:

   ```powershell
   pnpm start:dev
   ```

   Hệ thống khởi động thành công sẽ phục vụ:
   - **Giao diện người dùng (Frontend)**: `http://localhost:3001/` (tự động chuyển hướng đến `/routes/auth/login/`)
   - **API Backend**: `http://localhost:3001` (Health check: `/health`)
   - **Tài liệu API Swagger**: `http://localhost:3001/docs`

6. _(Tùy chọn)_ Nếu bạn muốn chạy giao diện tách biệt trên server riêng (cổng 8080):

   ```powershell
   pnpm client:serve
   ```

   Truy cập: `http://localhost:8080/routes/auth/login/`.

## Migration SQL

Migration đặt trong `db/migrations/` và chạy theo thứ tự tên `NNN_ten.sql`: `001_auth.sql`, `002_events.sql`, `003_funds.sql`, `004_proposals_voting.sql`, `005_proposal_board_decisions.sql`, `006_transactions_payables.sql`, `007_transaction_completion_actor.sql`, `008_notifications.sql`, `009_views.sql`. Lệnh `pnpm db:migrate` dùng `schema_migrations` và SQL Server application lock (`sp_getapplock`); mỗi migration chạy trong transaction, đã áp dụng thì được bỏ qua. Không xóa volume database để chạy lại migration.

## Sự kiện

- Danh sách và chi tiết: `http://localhost:3001/routes/events/list/`.
- President và Board tạo/sửa/xóa; Member xem trạng thái đăng ký và đăng ký/hủy sự kiện.
- Trạng thái sự kiện được tính theo thời gian. Đăng ký có unique key theo sự kiện/thành viên; giới hạn người tham gia được bảo vệ bằng transaction và khóa sự kiện.

## Quỹ và đóng góp

- Tổng quan quỹ (Member / Board / Treasurer / President): `/routes/funds/dashboard/`.
- Ghi nhận đóng góp (Guest và tài khoản đăng nhập): `/routes/funds/contribute/`.
- Báo cáo tổng hợp: `/routes/funds/reports/`.
- Migration `003_funds.sql` khởi tạo đúng quỹ chính và quỹ dự phòng; ngưỡng mặc định `5.000.000` lưu trong `fund_settings`.
- Khoản tiền dùng `DECIMAL(18,2)`; API trả tiền dạng chuỗi thập phân để tránh làm tròn. `POST /funds/contributions` chấp nhận `amount` dạng chuỗi (khuyến nghị) hoặc number thông thường, tự lấy thành viên từ token nếu đã đăng nhập và không cho client chọn quỹ.
- Báo cáo `totalExpense` chỉ tính giao dịch `COMPLETED`; chi phí sự kiện được tổng hợp theo quan hệ sự kiện → proposal → payable → transactions, không bao gồm thông tin định danh người đóng góp.

## Đề xuất chi và biểu quyết

- Danh sách/tạo/chi tiết đề xuất: `/routes/proposals/list/`, `/routes/proposals/create/`, `/routes/proposals/detail/`.
- Biểu quyết và kết quả snapshot: `/routes/voting/detail/`. Duyệt cuối cho Treasurer/Board: `/routes/approvals/list/`.
- Tạo proposal bắt đầu vòng 1 và lưu snapshot. Vòng có deadline 3 ngày; chỉ chốt sớm khi toàn bộ snapshot đã bỏ phiếu. Hết hạn thiếu phiếu sẽ hủy và lưu non-voters.
- Amount trong request proposal là chuỗi thập phân để tránh làm tròn JSON number; amount proposal được lưu bằng SQL Server `DECIMAL(18,2)`.
- Duyệt proposal đã qua biểu quyết khóa quỹ khi kiểm tra tổng commitment đã duyệt để ngăn vượt số dư trong yêu cầu đồng thời.
- Theo xác nhận người dùng, hòa vòng 1 tự mở vòng 2 với snapshot mới; hòa vòng 2 chuyển `BOARD_DECISION_REQUIRED`, chỉ Board chốt kèm lý do. Nếu vòng 2 không hòa, áp dụng ngưỡng YES >50%.
- Proposal không chọn fundId và không tạo quỹ riêng theo sự kiện.

## Giao dịch, khoản phải trả và quỹ dự phòng

- Migration `006_transactions_payables.sql` tạo `payables`, giao dịch có trạng thái `PENDING/COMPLETED/REJECTED`, và yêu cầu rút quỹ dự phòng; `007_transaction_completion_actor.sql` lưu người thực hiện.
- Chỉ proposal `APPROVED` mới tạo được giao dịch thanh toán. `Idempotency-Key` bắt buộc để retry không ghi nhận trùng. Chỉ hoàn tất giao dịch mới cập nhật quỹ và payable trong một transaction.
- Nếu chi phí thực tế vượt đề xuất, Board duyệt phần vượt trước khi trích thêm. Nếu từ chối, hoàn tất chỉ ở mức duyệt; phần chênh thành khoản nợ gắn với proposal/member.
- Theo xác nhận người dùng, Treasurer gửi yêu cầu rút quỹ dự phòng; Board quyết định; Treasurer hoặc Board thực hiện sau khi được duyệt. Treasurer không thể tự phê duyệt.
- Member xem nợ của mình; President/Treasurer/Board xem toàn bộ. Payable `PAID` vẫn giữ cùng lịch sử giao dịch. Báo cáo có chi phí theo sự kiện qua proposal → payable → transaction.

## Thông báo (In-App Notifications)

- Bảng `notifications` (migration `008_notifications.sql`) lưu thông báo trong ứng dụng cho các sự kiện BR-024:
  - `NEW_MEMBER_APPLICATION`: Đơn đăng ký thành viên mới -> Chủ tịch.
  - `NEW_EVENT`: Chủ tịch tạo sự kiện -> Tất cả thành viên.
  - `PROPOSAL_CREATED`: Đề xuất chi mới -> Người đủ điều kiện biểu quyết.
  - `PROPOSAL_DECIDED`: Quyết định duyệt/từ chối đề xuất chi -> Người tạo.
  - `TIE_BOARD_REQUIRED`: Hòa biểu quyết sau vòng 2 -> Ban chủ nhiệm.
