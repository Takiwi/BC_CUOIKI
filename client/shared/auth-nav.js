(() => {
  const host = document.querySelector('[data-auth-nav]');
  if (!host) {
    return;
  }

  const normPath = (window.location.pathname || '')
    .replace(/\\/g, '/')
    .toLowerCase();

  const isAuthPage =
    normPath.includes('/routes/auth/login') ||
    normPath.includes('/routes/auth/register') ||
    normPath.includes('/auth/login') ||
    normPath.includes('/auth/register') ||
    Boolean(document.getElementById('login-form')) ||
    Boolean(document.getElementById('register-form')) ||
    Boolean(document.querySelector('.auth-card')) ||
    Boolean(document.querySelector('[data-auth-page]'));

  // Xác thực phiên làm việc qua ClubApi
  const isAuth =
    window.ClubApi?.isAuthenticated ? window.ClubApi.isAuthenticated() : false;
  const user = isAuth
    ? (window.ClubApi?.getValidUser ? window.ClubApi.getValidUser() : window.ClubApi?.getUser?.())
    : null;

  const showLoggedInNav = !isAuthPage && isAuth && Boolean(user);

  function escapeHtml(str) {
    return str
      ? str
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
      : '';
  }

  // Helper sinh các mục menu theo phân quyền
  function renderNavItems() {
    let html = '';

    // Khối 1: Tổng quan
    html += `
      <div class="ledger-nav-group-title">Tổng quan</div>
      <li class="ledger-nav-item">
        <a class="ledger-nav-link ${normPath.includes('/routes/admin/dashboard') ? 'active' : ''}" href="/routes/admin/dashboard/index.html">
          <i class="bi bi-grid-1x2"></i>
          <span>Bảng điều khiển</span>
        </a>
      </li>
    `;

    // Khối 2: Tài chính & Quỹ
    html += `
      <div class="ledger-nav-group-title mt-2">Tài chính & Quỹ</div>
      <li class="ledger-nav-item">
        <a class="ledger-nav-link ${normPath.includes('/routes/funds/dashboard') ? 'active' : ''}" href="/routes/funds/dashboard/index.html">
          <i class="bi bi-wallet2"></i>
          <span>Tổng quan ngân quỹ</span>
        </a>
      </li>
      <li class="ledger-nav-item">
        <a class="ledger-nav-link ${normPath.includes('/routes/funds/reports') ? 'active' : ''}" href="/routes/funds/reports/index.html">
          <i class="bi bi-bar-chart-line"></i>
          <span>Báo cáo dòng tiền</span>
        </a>
      </li>
      <li class="ledger-nav-item">
        <a class="ledger-nav-link ${normPath.includes('/routes/funds/contribute') ? 'active' : ''}" href="/routes/funds/contribute/index.html">
          <i class="bi bi-heart"></i>
          <span>Đóng góp quỹ</span>
        </a>
      </li>
      <li class="ledger-nav-item">
        <a class="ledger-nav-link ${normPath.includes('/routes/debts/list') ? 'active' : ''}" href="/routes/debts/list/index.html">
          <i class="bi bi-receipt"></i>
          <span>Khoản phải trả & Nợ</span>
        </a>
      </li>
    `;

    if (['TREASURER', 'BOARD', 'PRESIDENT', 'ADMIN'].includes(user.role)) {
      html += `
        <li class="ledger-nav-item">
          <a class="ledger-nav-link ${normPath.includes('/routes/transactions/list') ? 'active' : ''}" href="/routes/transactions/list/index.html">
            <i class="bi bi-journal-text"></i>
            <span>Sổ cái giao dịch</span>
          </a>
        </li>
      `;
    }

    if (['TREASURER', 'BOARD', 'ADMIN'].includes(user.role)) {
      html += `
        <li class="ledger-nav-item">
          <a class="ledger-nav-link ${normPath.includes('/routes/reserve-withdrawals/list') ? 'active' : ''}" href="/routes/reserve-withdrawals/list/index.html">
            <i class="bi bi-safe"></i>
            <span>Rút quỹ dự phòng</span>
          </a>
        </li>
      `;
    }

    // Khối 3: Quản trị & Biểu quyết
    html += `
      <div class="ledger-nav-group-title mt-2">Quản trị & Biểu quyết</div>
      <li class="ledger-nav-item">
        <a class="ledger-nav-link ${normPath.includes('/routes/proposals/list') ? 'active' : ''}" href="/routes/proposals/list/index.html">
          <i class="bi bi-file-earmark-text"></i>
          <span>Danh sách đề xuất chi</span>
        </a>
      </li>
    `;

    if (['MEMBER', 'PRESIDENT', 'TREASURER', 'ADMIN'].includes(user.role)) {
      html += `
        <li class="ledger-nav-item">
          <a class="ledger-nav-link ${normPath.includes('/routes/proposals/create') ? 'active' : ''}" href="/routes/proposals/create/index.html">
            <i class="bi bi-plus-circle"></i>
            <span>Tạo đề xuất chi</span>
          </a>
        </li>
      `;
    }

    if (['TREASURER', 'BOARD', 'ADMIN'].includes(user.role)) {
      html += `
        <li class="ledger-nav-item">
          <a class="ledger-nav-link ${normPath.includes('/routes/approvals/list') ? 'active' : ''}" href="/routes/approvals/list/index.html">
            <i class="bi bi-check2-circle"></i>
            <span>Duyệt đề xuất chi</span>
          </a>
        </li>
      `;
    }

    // Khối 4: Hoạt động & Hội viên
    html += `
      <div class="ledger-nav-group-title mt-2">Hoạt động & Hội viên</div>
      <li class="ledger-nav-item">
        <a class="ledger-nav-link ${normPath.includes('/routes/events/list') ? 'active' : ''}" href="/routes/events/list/index.html">
          <i class="bi bi-calendar-event"></i>
          <span>Danh sách sự kiện</span>
        </a>
      </li>
    `;

    if (['PRESIDENT', 'BOARD', 'ADMIN'].includes(user.role)) {
      html += `
        <li class="ledger-nav-item">
          <a class="ledger-nav-link ${normPath.includes('/routes/events/form') ? 'active' : ''}" href="/routes/events/form/index.html">
            <i class="bi bi-calendar-plus"></i>
            <span>Tạo sự kiện mới</span>
          </a>
        </li>
      `;
    }

    if (['PRESIDENT', 'BOARD', 'TREASURER', 'ADMIN'].includes(user.role)) {
      html += `
        <li class="ledger-nav-item">
          <a class="ledger-nav-link ${normPath.includes('/routes/members/list') ? 'active' : ''}" href="/routes/members/list/index.html">
            <i class="bi bi-people"></i>
            <span>Danh bạ hội viên</span>
          </a>
        </li>
      `;
    }

    if (['PRESIDENT', 'ADMIN'].includes(user.role)) {
      html += `
        <li class="ledger-nav-item">
          <a class="ledger-nav-link ${normPath.includes('/routes/members/approvals') ? 'active' : ''}" href="/routes/members/approvals/index.html">
            <i class="bi bi-person-check"></i>
            <span>Duyệt đơn gia nhập</span>
          </a>
        </li>
      `;
    }

    return html;
  }

  // Helper phân giải Breadcrumb tiếng Việt
  function getBreadcrumbData() {
    const map = [
      { prefix: '/routes/admin/dashboard', parent: 'Quản trị', current: 'Bảng điều khiển hệ thống' },
      { prefix: '/routes/funds/dashboard', parent: 'Tài chính & Quỹ', current: 'Tổng quan ngân quỹ' },
      { prefix: '/routes/funds/reports', parent: 'Tài chính & Quỹ', current: 'Báo cáo dòng tiền' },
      { prefix: '/routes/funds/contribute', parent: 'Tài chính & Quỹ', current: 'Đóng góp quỹ' },
      { prefix: '/routes/debts/list', parent: 'Tài chính & Quỹ', current: 'Khoản phải trả & Nợ' },
      { prefix: '/routes/transactions/list', parent: 'Tài chính & Quỹ', current: 'Sổ cái giao dịch' },
      { prefix: '/routes/reserve-withdrawals/list', parent: 'Tài chính & Quỹ', current: 'Rút quỹ dự phòng' },
      { prefix: '/routes/proposals/list', parent: 'Quản trị & Biểu quyết', current: 'Danh sách đề xuất chi' },
      { prefix: '/routes/proposals/create', parent: 'Quản trị & Biểu quyết', current: 'Tạo đề xuất chi' },
      { prefix: '/routes/proposals/detail', parent: 'Quản trị & Biểu quyết', current: 'Chi tiết đề xuất chi' },
      { prefix: '/routes/approvals/list', parent: 'Quản trị & Biểu quyết', current: 'Duyệt đề xuất chi' },
      { prefix: '/routes/voting/detail', parent: 'Quản trị & Biểu quyết', current: 'Phiếu biểu quyết' },
      { prefix: '/routes/events/list', parent: 'Hoạt động & Hội viên', current: 'Danh sách sự kiện' },
      { prefix: '/routes/events/form', parent: 'Hoạt động & Hội viên', current: 'Thông tin sự kiện' },
      { prefix: '/routes/events/detail', parent: 'Hoạt động & Hội viên', current: 'Chi tiết sự kiện' },
      { prefix: '/routes/members/list', parent: 'Hoạt động & Hội viên', current: 'Danh bạ hội viên' },
      { prefix: '/routes/members/approvals', parent: 'Hoạt động & Hội viên', current: 'Duyệt đơn gia nhập' },
      { prefix: '/routes/members/profile', parent: 'Cá nhân', current: 'Hồ sơ cá nhân' },
    ];

    for (const item of map) {
      if (normPath.includes(item.prefix)) {
        return item;
      }
    }
    return { parent: 'Cổng thông tin', current: 'Quản lý câu lạc bộ' };
  }

  if (showLoggedInNav && user) {
    document.body.classList.add('has-ledger-shell');
    const brandHref = user.role === 'ADMIN'
      ? '/routes/admin/dashboard/index.html'
      : '/routes/funds/dashboard/index.html';
    const displayName = user.fullName || user.email || 'Người dùng';
    const firstLetter = displayName.charAt(0).toUpperCase();
    const breadcrumb = getBreadcrumbData();

    const shellContainer = document.createElement('div');
    shellContainer.className = 'ledger-shell-wrapper';

    shellContainer.innerHTML = `
      <!-- Desktop Fixed Sidebar -->
      <aside class="ledger-sidebar d-none d-lg-flex" id="clubNavbar">
        <a href="${brandHref}" class="ledger-sidebar-brand">
          <div class="ledger-brand-icon">
            <i class="bi bi-journal-bookmark-fill"></i>
          </div>
          <div>
            <div class="ledger-brand-text">Quản Lý CLB</div>
            <div class="small text-muted" style="font-size: 11px;">Hệ Thống Sổ Cái Minh Bạch</div>
          </div>
        </a>
        <ul class="ledger-sidebar-nav list-unstyled m-0">
          ${renderNavItems()}
        </ul>
        <!-- Cập nhật hồ sơ: Chỉ hiển thị tên, không hiển thị role -->
        <div class="p-3 border-top border-secondary-subtle">
          <a href="/routes/members/profile/index.html" class="d-flex align-items-center gap-2 text-decoration-none text-dark p-2 rounded-1" style="background: var(--color-surface-subtle);" title="Cập nhật hồ sơ cá nhân">
            <div class="ledger-user-avatar">${firstLetter}</div>
            <div class="overflow-hidden">
              <div class="fw-semibold text-truncate small" style="max-width: 150px;">${escapeHtml(displayName)}</div>
              <div class="text-muted" style="font-size: 11px;">Cập nhật hồ sơ</div>
            </div>
          </a>
        </div>
      </aside>

      <!-- Mobile Offcanvas Drawer -->
      <div class="offcanvas offcanvas-start" tabindex="-1" id="ledgerOffcanvas" aria-labelledby="ledgerOffcanvasLabel">
        <div class="offcanvas-header border-bottom">
          <div class="d-flex align-items-center gap-2">
            <div class="ledger-brand-icon">
              <i class="bi bi-journal-bookmark-fill"></i>
            </div>
            <div>
              <div class="fw-bold" id="ledgerOffcanvasLabel">Quản Lý CLB</div>
              <div class="small text-muted" style="font-size: 11px;">Hệ Thống Sổ Cái Minh Bạch</div>
            </div>
          </div>
          <button type="button" class="btn-close text-reset" data-bs-dismiss="offcanvas" aria-label="Đóng"></button>
        </div>
        <div class="offcanvas-body p-0">
          <ul class="ledger-sidebar-nav list-unstyled m-0">
            ${renderNavItems()}
          </ul>
        </div>
        <div class="p-3 border-top">
          <!-- Cập nhật hồ sơ: Chỉ hiển thị tên, không hiển thị role -->
          <a href="/routes/members/profile/index.html" class="d-flex align-items-center gap-2 text-decoration-none text-dark p-2 mb-2 rounded-1" style="background: var(--color-surface-subtle);" title="Cập nhật hồ sơ cá nhân">
            <div class="ledger-user-avatar">${firstLetter}</div>
            <div class="overflow-hidden">
              <div class="fw-semibold small">${escapeHtml(displayName)}</div>
              <div class="text-muted" style="font-size: 11px;">Cập nhật hồ sơ</div>
            </div>
          </a>
          <button type="button" class="btn btn-outline-danger btn-sm w-100" id="btn-logout-mobile">
            <i class="bi bi-box-arrow-right me-1"></i>Đăng xuất
          </button>
        </div>
      </div>

      <!-- Sticky Top Header -->
      <header class="ledger-top-header">
        <div class="d-flex align-items-center gap-3">
          <!-- Mobile Drawer Toggle -->
          <button class="btn btn-sm btn-outline-secondary d-lg-none" type="button" data-bs-toggle="offcanvas" data-bs-target="#ledgerOffcanvas" aria-controls="ledgerOffcanvas" aria-label="Mở menu">
            <i class="bi bi-list fs-6"></i>
          </button>

          <!-- Breadcrumbs -->
          <nav aria-label="Đường dẫn trang">
            <ol class="ledger-breadcrumb">
              <li class="ledger-breadcrumb-item d-none d-sm-inline">${breadcrumb.parent}</li>
              <li class="ledger-breadcrumb-separator d-none d-sm-inline">/</li>
              <li class="ledger-breadcrumb-item active" aria-current="page">${breadcrumb.current}</li>
            </ol>
          </nav>
        </div>

        <div class="d-flex align-items-center gap-2">
          <!-- User Chip: Chỉ hiển thị tên, không hiển thị role -->
          <a href="/routes/members/profile/index.html" class="ledger-user-chip d-none d-sm-flex" title="Cập nhật hồ sơ cá nhân">
            <div class="ledger-user-avatar">${firstLetter}</div>
            <span class="fw-medium text-truncate" style="max-width: 180px;">${escapeHtml(displayName)}</span>
          </a>

          <!-- Logout Button -->
          <button type="button" class="btn-ledger btn-ledger-outline" id="btn-logout-desktop" title="Đăng xuất khỏi hệ thống">
            <i class="bi bi-box-arrow-right"></i>
            <span class="d-none d-md-inline ms-1">Đăng xuất</span>
          </button>
        </div>
      </header>
    `;

    host.replaceChildren(shellContainer);

    // Event listener cho nút đăng xuất
    async function handleLogout(btn) {
      if (!btn) return;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Đang đăng xuất...';
      try {
        await window.ClubApi.logout();
      } catch {
        window.ClubApi.clearSession();
        window.location.href = '/routes/auth/login/index.html';
      }
    }

    const logoutBtnDesktop = shellContainer.querySelector('#btn-logout-desktop');
    if (logoutBtnDesktop) {
      logoutBtnDesktop.addEventListener('click', () => handleLogout(logoutBtnDesktop));
    }

    const logoutBtnMobile = shellContainer.querySelector('#btn-logout-mobile');
    if (logoutBtnMobile) {
      logoutBtnMobile.addEventListener('click', () => handleLogout(logoutBtnMobile));
    }

  } else {
    // Khách hoặc trang Auth (Đăng nhập / Đăng ký)
    const guestNav = document.createElement('header');
    guestNav.className = 'py-3 border-bottom';
    guestNav.style.backgroundColor = 'var(--color-surface)';
    guestNav.innerHTML = `
      <div class="container d-flex justify-content-between align-items-center">
        <a href="/routes/auth/login/index.html" class="d-flex align-items-center gap-2 text-decoration-none text-dark">
          <div class="ledger-brand-icon">
            <i class="bi bi-journal-bookmark-fill"></i>
          </div>
          <div>
            <div class="fw-bold" style="font-size: 15px;">Quản Lý CLB</div>
            <div class="text-muted" style="font-size: 11px;">Hệ Thống Sổ Cái Minh Bạch</div>
          </div>
        </a>
        <div class="d-flex gap-2">
          <a href="/routes/funds/contribute/index.html" class="btn-ledger btn-ledger-outline">
            <i class="bi bi-heart me-1"></i>Đóng góp quỹ
          </a>
          <a href="/routes/auth/login/index.html" class="btn-ledger btn-ledger-primary">
            <i class="bi bi-box-arrow-in-right me-1"></i>Đăng nhập
          </a>
        </div>
      </div>
    `;
    host.replaceChildren(guestNav);
  }
})();
