(() => {
  // Enforce ADMIN role
  if (!window.ClubApi.requireAuth(['ADMIN'])) {
    return;
  }

  // State
  let currentEntity = 'members';
  let entityConfigs = [];
  let currentData = null;
  let currentPage = 1;
  let currentLimit = 20;
  let currentSort = '';
  let currentOrder = 'DESC';
  let currentSearch = '';
  let activeRecord = null;

  // DOM Elements
  const statsContainer = document.getElementById('stats-container');
  const entityTabs = document.getElementById('entity-tabs');
  const entityTableHead = document.getElementById('entity-table-head');
  const entityTableBody = document.getElementById('entity-table-body');
  const entityDesc = document.getElementById('current-entity-desc');
  const tableRecordCount = document.getElementById('table-record-count');
  const searchInput = document.getElementById('entity-search-input');
  const clearSearchBtn = document.getElementById('clear-search-btn');
  const sortSelect = document.getElementById('entity-sort-select');
  const orderSelect = document.getElementById('entity-order-select');
  const pageSizeSelect = document.getElementById('page-size-select');
  const paginationControls = document.getElementById('pagination-controls');
  const exportJsonBtn = document.getElementById('export-json-btn');
  const refreshAllBtn = document.getElementById('refresh-all-btn');
  const alertBox = document.getElementById('admin-alert');
  const alertMsg = document.getElementById('admin-alert-msg');

  // Modals
  const detailModalEl = document.getElementById('detail-modal');
  const detailModal = detailModalEl ? new bootstrap.Modal(detailModalEl) : null;
  const editModalEl = document.getElementById('edit-modal');
  const editModal = editModalEl ? new bootstrap.Modal(editModalEl) : null;
  const deleteModalEl = document.getElementById('delete-modal');
  const deleteModal = deleteModalEl ? new bootstrap.Modal(deleteModalEl) : null;

  const detailEntityName = document.getElementById('detail-entity-name');
  const detailRecordId = document.getElementById('detail-record-id');
  const detailTableBody = document.getElementById('detail-table-body');

  const editFieldsContainer = document.getElementById('edit-fields-container');
  const saveEditBtn = document.getElementById('save-edit-btn');

  const deleteEntityName = document.getElementById('delete-entity-name');
  const deleteRecordId = document.getElementById('delete-record-id');
  const confirmDeleteBtn = document.getElementById('confirm-delete-btn');

  function showAlert(message, type = 'success') {
    alertBox.className = `alert alert-${type} alert-dismissible fade show`;
    alertMsg.textContent = message;
    alertBox.classList.remove('d-none');
    setTimeout(() => {
      alertBox.classList.add('d-none');
    }, 5000);
  }

  // 1. Fetch & Render Overview Stats
  async function loadOverviewStats() {
    try {
      const stats = await window.ClubApi.request('/admin/stats');
      renderStats(stats);
    } catch (err) {
      statsContainer.innerHTML = `
        <div class="col-12">
          <div class="alert alert-danger mb-0 small">
            <i class="bi bi-exclamation-triangle-fill me-1"></i> Không thể tải thống kê: ${err.message}
          </div>
        </div>
      `;
    }
  }

  function renderStats(stats) {
    const cards = [
      {
        icon: 'bi-people-fill text-primary',
        title: 'Thành viên & Tài khoản',
        badge: `${stats.members.total} Tài khoản`,
        badgeClass: 'badge-primary',
        items: [
          `Đang hoạt động: <strong class="text-success">${stats.members.active}</strong>`,
          `Chờ xét duyệt: <strong class="text-warning">${stats.members.pending}</strong>`,
          `Bị từ chối: <strong class="text-danger">${stats.members.rejected}</strong>`,
        ],
        targetEntity: 'members',
      },
      {
        icon: 'bi-wallet2 text-success',
        title: 'Ngân quỹ & Đóng góp',
        badge: window.ClubApi.formatMoney(stats.funds.total),
        badgeClass: 'badge-success',
        items: [
          `Quỹ chính: <strong>${window.ClubApi.formatMoney(stats.funds.main)}</strong>`,
          `Quỹ dự phòng: <strong>${window.ClubApi.formatMoney(stats.funds.reserve)}</strong>`,
          `Tổng đóng góp: <strong>${window.ClubApi.formatMoney(stats.contributions.totalAmount)}</strong> <span class="text-nowrap">(${stats.contributions.total} lượt)</span>`,
        ],
        targetEntity: 'funds',
      },
      {
        icon: 'bi-calendar-event-fill text-info',
        title: 'Sự kiện & Đăng ký',
        badge: `${stats.events.total} Sự kiện`,
        badgeClass: 'badge-primary',
        items: [
          `Sự kiện đang mở: <strong class="text-success">${stats.events.active}</strong>`,
          `Tổng lượt đăng ký: <strong>${stats.eventRegistrations.total}</strong>`,
          `Lượt hợp lệ: <strong class="text-primary">${stats.eventRegistrations.active}</strong>`,
        ],
        targetEntity: 'events',
      },
      {
        icon: 'bi-file-earmark-text-fill text-warning',
        title: 'Đề xuất chi & Bầu cử',
        badge: `${stats.proposals.total} Đề xuất`,
        badgeClass: 'badge-warning',
        items: [
          `Chờ duyệt: <strong>${stats.proposals.pending}</strong> | Bầu cử: <strong>${stats.proposals.voting}</strong>`,
          `Đã duyệt: <strong>${stats.proposals.approved}</strong> | Đã chi: <strong>${stats.proposals.executed}</strong>`,
          `Tổng vòng vote: <strong>${stats.voteRounds.total}</strong> | Số phiếu: <strong>${stats.votes.total}</strong>`,
        ],
        targetEntity: 'spending_proposals',
      },
      {
        icon: 'bi-credit-card-fill text-danger',
        title: 'Khoản phải trả & Giao dịch',
        badge: `${stats.payables.total} Phải trả`,
        badgeClass: 'badge-warning',
        items: [
          `Còn nợ: <strong>${window.ClubApi.formatMoney(stats.payables.totalDue - stats.payables.totalPaid)}</strong> <span class="text-nowrap">(${stats.payables.open} khoản)</span>`,
          `Giao dịch quỹ: <strong>${stats.transactions.total}</strong> <span class="text-nowrap">(Hoàn tất: ${stats.transactions.completed})</span>`,
          `Tổng giải ngân: <strong>${window.ClubApi.formatMoney(stats.transactions.totalVolume)}</strong>`,
        ],
        targetEntity: 'payables',
      },
      {
        icon: 'bi-bell-fill text-secondary',
        title: 'Rút dự phòng & Thông báo',
        badge: `${stats.reserveWithdrawals.total} Yêu cầu rút`,
        badgeClass: 'badge-neutral',
        items: [
          `Chờ duyệt rút: <strong class="text-warning">${stats.reserveWithdrawals.pending}</strong> | Duyệt: <strong class="text-success">${stats.reserveWithdrawals.approved}</strong>`,
          `Đã giải ngân rút dự phòng: <strong>${stats.reserveWithdrawals.completed}</strong>`,
          `Thông báo hệ thống: <strong>${stats.notifications.total}</strong> <span class="text-nowrap">(Chưa đọc: ${stats.notifications.unread})</span>`,
        ],
        targetEntity: 'reserve_withdrawal_requests',
      },
    ];

    statsContainer.innerHTML = cards
      .map(
        (card) => `
        <div class="col-12 col-md-6 col-xl-4">
          <div class="stat-card p-3 h-100" role="button" data-switch-entity="${card.targetEntity}">
            <div class="d-flex align-items-center justify-content-between mb-2">
              <div class="d-flex align-items-center gap-2">
                <i class="bi ${card.icon} fs-4"></i>
                <h3 class="h6 fw-bold mb-0 text-ink">${card.title}</h3>
              </div>
              <span class="badge-ledger ${card.badgeClass} text-nowrap">${card.badge}</span>
            </div>
            <ul class="list-unstyled small text-muted mb-0 mt-2 d-flex flex-column gap-1">
              ${card.items.map((it) => `<li><i class="bi bi-chevron-right text-muted me-1"></i>${it}</li>`).join('')}
            </ul>
          </div>
        </div>
      `,
      )
      .join('');

    // Attach click to card to quickly switch entity tab
    statsContainer.querySelectorAll('[data-switch-entity]').forEach((el) => {
      el.addEventListener('click', () => {
        const entity = el.getAttribute('data-switch-entity');
        switchEntity(entity);
      });
    });
  }

  // 2. Fetch Entity Configurations & Setup Tabs
  async function loadEntityConfigs() {
    try {
      entityConfigs = await window.ClubApi.request('/admin/entities');
      renderEntityTabs();
      // Load initial entity
      await switchEntity(currentEntity);
    } catch (err) {
      showAlert(`Lỗi tải cấu hình entities: ${err.message}`, 'danger');
    }
  }

  function renderEntityTabs() {
    const iconMap = {
      members: 'bi-people',
      events: 'bi-calendar-event',
      event_registrations: 'bi-person-check',
      funds: 'bi-cash-coin',
      contributions: 'bi-gift',
      spending_proposals: 'bi-file-earmark-spreadsheet',
      proposal_vote_rounds: 'bi-pie-chart',
      proposal_votes: 'bi-check2-square',
      payables: 'bi-receipt',
      reserve_withdrawal_requests: 'bi-shield-exclamation',
      fund_transactions: 'bi-arrow-left-right',
      notifications: 'bi-bell',
    };

    entityTabs.innerHTML = entityConfigs
      .map((cfg) => {
        const icon = iconMap[cfg.key] || 'bi-table';
        const isActive = cfg.key === currentEntity ? 'active' : 'btn-outline-secondary';
        return `
          <button
            class="btn btn-sm entity-tab-btn ${isActive}"
            id="tab-${cfg.key}"
            data-entity="${cfg.key}"
            type="button"
          >
            <i class="bi ${icon} me-1"></i>${cfg.label}
          </button>
        `;
      })
      .join('');

    entityTabs.querySelectorAll('[data-entity]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-entity');
        switchEntity(target);
      });
    });
  }

  async function switchEntity(entityKey) {
    currentEntity = entityKey;
    currentPage = 1;
    currentSearch = '';
    searchInput.value = '';

    // Update active tab styling
    entityTabs.querySelectorAll('.entity-tab-btn').forEach((btn) => {
      if (btn.getAttribute('data-entity') === entityKey) {
        btn.className = 'btn btn-sm entity-tab-btn active';
      } else {
        btn.className = 'btn btn-sm entity-tab-btn btn-outline-secondary';
      }
    });

    const cfg = entityConfigs.find((c) => c.key === entityKey);
    if (cfg) {
      entityDesc.textContent = `${cfg.description} (Bảng [${cfg.tableName}])`;
      // Populate sort dropdown
      sortSelect.innerHTML = cfg.allowedSortColumns
        .map((col) => `<option value="${col}">${col}</option>`)
        .join('');
      currentSort = cfg.allowedSortColumns[0] || 'created_at';
      sortSelect.value = currentSort;
    }

    await loadEntityData();
  }

  // 3. Fetch & Render Table Data
  async function loadEntityData() {
    entityTableBody.innerHTML = `
      <tr>
        <td colspan="15" class="text-center py-5">
          <div class="spinner-border spinner-border-sm text-primary me-2" role="status"></div>
          <span class="text-secondary small">Đang tải dữ liệu...</span>
        </td>
      </tr>
    `;

    try {
      const query = new URLSearchParams({
        page: String(currentPage),
        limit: String(currentLimit),
        sort: currentSort,
        order: currentOrder,
      });
      if (currentSearch.trim()) {
        query.set('search', currentSearch.trim());
      }

      currentData = await window.ClubApi.request(`/admin/entities/${currentEntity}?${query.toString()}`);
      renderTable(currentData);
      renderPagination(currentData);
    } catch (err) {
      entityTableBody.innerHTML = `
        <tr>
          <td colspan="15" class="text-center py-4 text-danger small">
            <i class="bi bi-exclamation-triangle-fill me-1"></i> Không thể tải dữ liệu: ${err.message}
          </td>
        </tr>
      `;
    }
  }

  function renderTable(data) {
    const { total, page, limit, data: rows, editableColumns } = data;
    const startIdx = total === 0 ? 0 : (page - 1) * limit + 1;
    const endIdx = Math.min(total, page * limit);
    tableRecordCount.textContent = `Hiển thị ${startIdx} - ${endIdx} / Tổng số ${total} bản ghi`;

    if (!rows || rows.length === 0) {
      entityTableHead.innerHTML = `<tr><th>Dữ liệu</th></tr>`;
      entityTableBody.innerHTML = `
        <tr>
          <td class="text-center py-5 text-secondary">
            <i class="bi bi-inbox fs-2 d-block mb-1 text-muted"></i>
            Chưa có bản ghi nào trong bảng này.
          </td>
        </tr>
      `;
      return;
    }

    // Determine columns
    const columns = Object.keys(rows[0]);

    // Render Table Head
    entityTableHead.innerHTML = `
      <tr>
        <th style="width: 50px;">#</th>
        ${columns.map((col) => `<th>${col}</th>`).join('')}
        <th class="text-center" style="width: 120px;">Thao tác</th>
      </tr>
    `;

    // Render Table Body
    entityTableBody.innerHTML = rows
      .map((row, idx) => {
        const rowNum = startIdx + idx;
        const rowId = row.id || row[data.primaryKey];
        const rowCells = columns
          .map((col) => {
            const val = row[col];
            return `<td>${formatCellValue(col, val)}</td>`;
          })
          .join('');

        const canEdit = editableColumns && editableColumns.length > 0;
        const canDelete = currentEntity !== 'funds';

        return `
          <tr>
            <td class="text-muted small">${rowNum}</td>
            ${rowCells}
            <td class="text-center text-nowrap">
              <div class="d-inline-flex gap-1" role="group">
                <button class="btn-ledger btn-ledger-secondary btn-sm view-btn" title="Xem chi tiết" data-id="${rowId}">
                  <i class="bi bi-eye"></i>
                </button>
                ${
                  canEdit
                    ? `<button class="btn-ledger btn-ledger-secondary btn-sm edit-btn" title="Chỉnh sửa" data-id="${rowId}">
                        <i class="bi bi-pencil"></i>
                      </button>`
                    : ''
                }
                ${
                  canDelete
                    ? `<button class="btn-ledger btn-ledger-secondary text-danger btn-sm del-btn" title="Xóa" data-id="${rowId}">
                        <i class="bi bi-trash"></i>
                      </button>`
                    : ''
                }
              </div>
            </td>
          </tr>
        `;
      })
      .join('');

    // Attach row button events
    entityTableBody.querySelectorAll('.view-btn').forEach((btn) => {
      btn.addEventListener('click', () => openDetailModal(btn.getAttribute('data-id')));
    });
    entityTableBody.querySelectorAll('.edit-btn').forEach((btn) => {
      btn.addEventListener('click', () => openEditModal(btn.getAttribute('data-id')));
    });
    entityTableBody.querySelectorAll('.del-btn').forEach((btn) => {
      btn.addEventListener('click', () => openDeleteModal(btn.getAttribute('data-id')));
    });
  }

  function formatCellValue(col, val) {
    if (val === null || val === undefined) {
      return `<span class="text-muted fst-italic">NULL</span>`;
    }
    if (typeof val === 'boolean' || col === 'is_active' || col === 'is_read') {
      const boolVal = Boolean(val);
      return boolVal
        ? `<span class="badge-ledger badge-success text-nowrap">Có (1)</span>`
        : `<span class="badge-ledger badge-neutral text-nowrap">Không (0)</span>`;
    }

    const strVal = String(val);

    // Status / Role Badges
    const ROLE_MAP = {
      ADMIN: 'Quản trị viên',
      PRESIDENT: 'Chủ tịch',
      TREASURER: 'Thủ quỹ',
      BOARD: 'Ban chủ nhiệm',
      MEMBER: 'Thành viên',
      GUEST: 'Khách',
    };

    if (col === 'role') {
      const roleText = ROLE_MAP[strVal] || strVal;
      const badgeClass =
        strVal === 'ADMIN'
          ? 'badge-warning'
          : strVal === 'PRESIDENT'
            ? 'badge-warning'
            : strVal === 'TREASURER' || strVal === 'BOARD'
              ? 'badge-primary'
              : 'badge-neutral';
      return `<span class="badge-ledger ${badgeClass} text-nowrap">${roleText}</span>`;
    }

    const STATUS_MAP = {
      APPROVED: 'Đã duyệt',
      COMPLETED: 'Hoàn thành',
      ACTIVE: 'Hoạt động',
      PAID: 'Đã thanh toán',
      YES: 'Đồng ý',
      NO: 'Không đồng ý',
      BLANK: 'Phiếu trắng',
      PENDING: 'Chờ duyệt',
      PENDING_APPROVAL: 'Chờ phê duyệt',
      BOARD_DECISION_REQUIRED: 'BCN quyết định',
      VOTING: 'Đang biểu quyết',
      OPEN: 'Đang mở',
      REJECTED: 'Từ chối',
      CANCELLED: 'Đã hủy',
    };

    if (col === 'status' || col === 'review_decision' || col === 'result' || col === 'choice') {
      const statusText = STATUS_MAP[strVal] || strVal;
      const badgeClass =
        ['APPROVED', 'COMPLETED', 'ACTIVE', 'PAID', 'YES'].includes(strVal)
          ? 'badge-success'
          : ['PENDING', 'PENDING_APPROVAL', 'VOTING', 'OPEN', 'BOARD_DECISION_REQUIRED'].includes(strVal)
            ? 'badge-warning'
            : ['REJECTED', 'CANCELLED', 'NO'].includes(strVal)
              ? 'badge-neutral text-danger'
              : 'badge-neutral';
      return `<span class="badge-ledger ${badgeClass} text-nowrap">${statusText}</span>`;
    }

    // Money formatting
    if (
      col.toLowerCase().includes('amount') ||
      col.toLowerCase().includes('balance') ||
      col.toLowerCase().includes('allocated') ||
      col.toLowerCase().includes('due') ||
      col.toLowerCase().includes('paid')
    ) {
      if (!isNaN(Number(val)) && !col.toLowerCase().includes('count')) {
        return `<span class="fw-semibold text-primary">${window.ClubApi.formatMoney(val)}</span>`;
      }
    }

    // Date formatting
    if (col.endsWith('_at') || col === 'date_of_birth') {
      const date = new Date(val);
      if (!isNaN(date.getTime())) {
        return `<span class="small text-muted" title="${strVal}">${date.toLocaleString('vi-VN')}</span>`;
      }
    }

    // UUIDs
    if (col.endsWith('_id') || col === 'id') {
      return `<code class="text-secondary small text-break-word" title="${strVal}">${strVal.slice(0, 8)}...</code>`;
    }

    // Long strings
    if (strVal.length > 40) {
      return `<span title="${escapeHtml(strVal)}">${escapeHtml(strVal.slice(0, 38))}...</span>`;
    }

    return escapeHtml(strVal);
  }

  function renderPagination(data) {
    const { page, totalPages } = data;
    if (totalPages <= 1) {
      paginationControls.innerHTML = '';
      return;
    }

    let items = [];

    // Prev button
    items.push(`
      <li class="page-item ${page === 1 ? 'disabled' : ''}">
        <a class="page-link" href="#" data-page="${page - 1}">Trước</a>
      </li>
    `);

    // Numbered pages (window of 5)
    const startPage = Math.max(1, page - 2);
    const endPage = Math.min(totalPages, page + 2);

    if (startPage > 1) {
      items.push(`<li class="page-item"><a class="page-link" href="#" data-page="1">1</a></li>`);
      if (startPage > 2) {
        items.push(`<li class="page-item disabled"><span class="page-link">...</span></li>`);
      }
    }

    for (let p = startPage; p <= endPage; p++) {
      items.push(`
        <li class="page-item ${p === page ? 'active' : ''}">
          <a class="page-link" href="#" data-page="${p}">${p}</a>
        </li>
      `);
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) {
        items.push(`<li class="page-item disabled"><span class="page-link">...</span></li>`);
      }
      items.push(`<li class="page-item"><a class="page-link" href="#" data-page="${totalPages}">${totalPages}</a></li>`);
    }

    // Next button
    items.push(`
      <li class="page-item ${page === totalPages ? 'disabled' : ''}">
        <a class="page-link" href="#" data-page="${page + 1}">Sau</a>
      </li>
    `);

    paginationControls.innerHTML = items.join('');

    paginationControls.querySelectorAll('[data-page]').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const p = parseInt(link.getAttribute('data-page'), 10);
        if (p && p !== currentPage && p >= 1 && p <= totalPages) {
          currentPage = p;
          loadEntityData();
        }
      });
    });
  }

  // 4. Modal Handlers
  async function openDetailModal(id) {
    if (!detailModal) return;
    detailEntityName.textContent = currentEntity.toUpperCase();
    detailRecordId.textContent = id;
    detailTableBody.innerHTML = `<tr><td class="text-center py-4">Đang tải chi tiết...</td></tr>`;
    detailModal.show();

    try {
      const res = await window.ClubApi.request(`/admin/entities/${currentEntity}/${id}`);
      const row = res.data;
      activeRecord = row;

      detailTableBody.innerHTML = Object.entries(row)
        .map(([key, val]) => {
          let formattedVal = val === null ? '<span class="text-muted fst-italic">NULL</span>' : escapeHtml(String(val));
          if (typeof val === 'object' && val !== null) {
            formattedVal = `<pre class="bg-light p-2 rounded mb-0 small">${JSON.stringify(val, null, 2)}</pre>`;
          }
          return `
            <tr>
              <th class="bg-light text-secondary small" style="width: 30%;">${key}</th>
              <td>${formattedVal}</td>
            </tr>
          `;
        })
        .join('');
    } catch (err) {
      detailTableBody.innerHTML = `<tr><td class="text-danger py-4">${err.message}</td></tr>`;
    }
  }

  async function openEditModal(id) {
    if (!editModal) return;
    try {
      const res = await window.ClubApi.request(`/admin/entities/${currentEntity}/${id}`);
      const row = res.data;
      activeRecord = row;

      const cfg = entityConfigs.find((c) => c.key === currentEntity);
      const editableCols = cfg?.editableColumns || [];

      if (editableCols.length === 0) {
        showAlert('Bảng này không hỗ trợ chỉnh sửa trực tiếp.', 'warning');
        return;
      }

      editFieldsContainer.innerHTML = editableCols
        .map((col) => {
          const val = row[col];
          // Boolean field
          if (typeof val === 'boolean' || col === 'is_active' || col === 'is_read') {
            const isChecked = Boolean(val);
            return `
              <div>
                <label class="form-label fw-semibold small">${col}</label>
                <select class="form-select form-select-sm" name="${col}">
                  <option value="true" ${isChecked ? 'selected' : ''}>true (Hoạt động / Đã đọc)</option>
                  <option value="false" ${!isChecked ? 'selected' : ''}>false (Vô hiệu hóa / Chưa đọc)</option>
                </select>
              </div>
            `;
          }

          // Role Enum
          if (col === 'role') {
            const roles = ['GUEST', 'MEMBER', 'TREASURER', 'PRESIDENT', 'BOARD', 'ADMIN'];
            return `
              <div>
                <label class="form-label fw-semibold small">${col}</label>
                <select class="form-select form-select-sm" name="${col}">
                  ${roles.map((r) => `<option value="${r}" ${r === val ? 'selected' : ''}>${r}</option>`).join('')}
                </select>
              </div>
            `;
          }

          // Status Enum
          if (col === 'status') {
            const statuses = currentEntity === 'members'
              ? ['PENDING', 'APPROVED', 'REJECTED']
              : currentEntity === 'events'
                ? ['ACTIVE', 'CANCELLED']
                : currentEntity === 'spending_proposals'
                  ? ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'VOTING', 'EXECUTED']
                  : currentEntity === 'payables'
                    ? ['OPEN', 'PAID']
                    : currentEntity === 'reserve_withdrawal_requests'
                      ? ['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED']
                      : ['PENDING', 'COMPLETED', 'REJECTED'];

            return `
              <div>
                <label class="form-label fw-semibold small">${col}</label>
                <select class="form-select form-select-sm" name="${col}">
                  ${statuses.map((s) => `<option value="${s}" ${s === val ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
              </div>
            `;
          }

          // Textarea for reasons / description / purpose
          if (col.includes('reason') || col.includes('notes') || col.includes('description') || col.includes('purpose')) {
            return `
              <div>
                <label class="form-label fw-semibold small">${col}</label>
                <textarea class="form-control form-control-sm" name="${col}" rows="3">${val ? escapeHtml(String(val)) : ''}</textarea>
              </div>
            `;
          }

          // Default input
          return `
            <div>
              <label class="form-label fw-semibold small">${col}</label>
              <input class="form-control form-control-sm" type="text" name="${col}" value="${val !== null && val !== undefined ? escapeHtml(String(val)) : ''}" />
            </div>
          `;
        })
        .join('');

      editModal.show();
    } catch (err) {
      showAlert(`Không thể mở modal chỉnh sửa: ${err.message}`, 'danger');
    }
  }

  saveEditBtn.addEventListener('click', async () => {
    if (!activeRecord) return;
    const form = document.getElementById('edit-form');
    const formData = new FormData(form);
    const updates = {};

    formData.forEach((value, key) => {
      if (value === 'true') updates[key] = true;
      else if (value === 'false') updates[key] = false;
      else if (value === '') updates[key] = null;
      else updates[key] = value;
    });

    saveEditBtn.disabled = true;
    saveEditBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Đang lưu...`;

    try {
      const rowId = activeRecord.id || activeRecord[currentData?.primaryKey || 'id'];
      await window.ClubApi.request(`/admin/entities/${currentEntity}/${rowId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });

      editModal.hide();
      showAlert('Cập nhật bản ghi thành công!');
      await loadEntityData();
      await loadOverviewStats();
    } catch (err) {
      showAlert(`Lỗi cập nhật: ${err.message}`, 'danger');
    } finally {
      saveEditBtn.disabled = false;
      saveEditBtn.innerHTML = `<i class="bi bi-check-lg"></i> <span>Lưu thay đổi</span>`;
    }
  });

  function openDeleteModal(id) {
    if (!deleteModal) return;
    activeRecord = { id };
    deleteEntityName.textContent = currentEntity;
    deleteRecordId.textContent = id;
    deleteModal.show();
  }

  confirmDeleteBtn.addEventListener('click', async () => {
    if (!activeRecord || !activeRecord.id) return;
    confirmDeleteBtn.disabled = true;
    confirmDeleteBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Đang xóa...`;

    try {
      await window.ClubApi.request(`/admin/entities/${currentEntity}/${activeRecord.id}`, {
        method: 'DELETE',
      });
      deleteModal.hide();
      showAlert('Đã xóa bản ghi thành công!');
      await loadEntityData();
      await loadOverviewStats();
    } catch (err) {
      deleteModal.hide();
      showAlert(`Không thể xóa bản ghi: ${err.message}`, 'danger');
    } finally {
      confirmDeleteBtn.disabled = false;
      confirmDeleteBtn.innerHTML = `<i class="bi bi-trash-fill me-1"></i> Xác nhận xóa`;
    }
  });

  // 5. Search, Filter, Sort, Pagination Controls
  let searchTimer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      currentSearch = searchInput.value;
      currentPage = 1;
      loadEntityData();
    }, 400);
  });

  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    currentSearch = '';
    currentPage = 1;
    loadEntityData();
  });

  sortSelect.addEventListener('change', () => {
    currentSort = sortSelect.value;
    currentPage = 1;
    loadEntityData();
  });

  orderSelect.addEventListener('change', () => {
    currentOrder = orderSelect.value;
    currentPage = 1;
    loadEntityData();
  });

  pageSizeSelect.addEventListener('change', () => {
    currentLimit = parseInt(pageSizeSelect.value, 10);
    currentPage = 1;
    loadEntityData();
  });

  refreshAllBtn.addEventListener('click', async () => {
    refreshAllBtn.disabled = true;
    await Promise.all([loadOverviewStats(), loadEntityData()]);
    refreshAllBtn.disabled = false;
    showAlert('Đã làm mới dữ liệu!');
  });

  exportJsonBtn.addEventListener('click', () => {
    if (!currentData || !currentData.data) return;
    const blob = new Blob([JSON.stringify(currentData.data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentEntity}_export_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Initial load
  loadOverviewStats();
  loadEntityConfigs();
})();

