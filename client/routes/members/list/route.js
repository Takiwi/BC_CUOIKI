(() => {
  if (!window.ClubApi.requireAuth(['PRESIDENT', 'BOARD', 'TREASURER'])) {
    return;
  }

  const currentUser = window.ClubApi.getUser();
  const alertBox = document.querySelector('#alert-box');
  const loadingSpinner = document.querySelector('#loading-spinner');
  const emptyState = document.querySelector('#empty-state');
  const tableContainer = document.querySelector('#table-container');
  const tbody = document.querySelector('#members-tbody');
  const searchInput = document.querySelector('#search-input');
  const statusFilter = document.querySelector('#status-filter');

  const statusModalEl = document.querySelector('#statusModal');
  const statusModal = statusModalEl ? new bootstrap.Modal(statusModalEl) : null;
  const statusModalTitle = document.querySelector('#statusModalTitle');
  const statusModalBody = document.querySelector('#statusModalBody');
  const confirmStatusBtn = document.querySelector('#confirmStatusBtn');

  const ROLE_MAP = {
    PRESIDENT: 'Chủ tịch',
    TREASURER: 'Thủ quỹ',
    BOARD: 'Ban chủ nhiệm',
    MEMBER: 'Thành viên',
  };

  let allMembers = [];
  let pendingAction = null;

  function showAlert(message, type = 'danger') {
    alertBox.className = `alert alert-${type}`;
    alertBox.textContent = message;
    alertBox.classList.remove('d-none');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function hideAlert() {
    alertBox.classList.add('d-none');
  }

  function setLoading(isLoading) {
    if (isLoading) {
      loadingSpinner.classList.remove('d-none');
      tableContainer.classList.add('d-none');
      emptyState.classList.add('d-none');
    } else {
      loadingSpinner.classList.add('d-none');
    }
  }

  async function fetchMembers() {
    setLoading(true);
    hideAlert();
    try {
      allMembers = await window.ClubApi.request('/members');
      renderTable();
    } catch (error) {
      showAlert(error.message, 'danger');
      setLoading(false);
    }
  }

  function renderTable() {
    setLoading(false);
    const search = searchInput.value.trim().toLowerCase();
    const filter = statusFilter.value;

    const filtered = allMembers.filter((m) => {
      const matchSearch =
        m.fullName.toLowerCase().includes(search) ||
        m.email.toLowerCase().includes(search);
      const matchStatus =
        filter === 'ALL' ||
        (filter === 'ACTIVE' && m.isActive) ||
        (filter === 'INACTIVE' && !m.isActive);
      return matchSearch && matchStatus;
    });

    if (filtered.length === 0) {
      tableContainer.classList.add('d-none');
      emptyState.classList.remove('d-none');
      return;
    }

    tableContainer.classList.remove('d-none');
    emptyState.classList.add('d-none');

    tbody.innerHTML = filtered
      .map((m) => {
        const isMe = currentUser && currentUser.id === m.id;
        const statusBadge = m.isActive
          ? `<span class="badge-ledger badge-success text-nowrap">Đang hoạt động</span>`
          : `<span class="badge-ledger badge-neutral text-nowrap">Không hoạt động</span>`;

        const roleVi = ROLE_MAP[m.role] || m.role;
        const roleBadgeClass =
          m.role === 'PRESIDENT'
            ? 'badge-ledger badge-warning text-nowrap'
            : m.role === 'TREASURER' || m.role === 'BOARD'
              ? 'badge-ledger badge-primary text-nowrap'
              : 'badge-ledger badge-neutral text-nowrap';

        const joinDate = m.createdAt
          ? new Date(m.createdAt).toLocaleDateString('vi-VN')
          : '-';

        let actionHtml = '';
        if (currentUser && currentUser.role === 'PRESIDENT') {
          if (m.isActive) {
            actionHtml = `
              <button class="btn-ledger btn-ledger-secondary text-danger btn-sm" data-action="deactivate" data-id="${m.id}" data-name="${escapeHtml(m.fullName)}">
                Vô hiệu hóa
              </button>
            `;
          } else {
            actionHtml = `
              <button class="btn-ledger btn-ledger-primary btn-sm" data-action="activate" data-id="${m.id}" data-name="${escapeHtml(m.fullName)}">
                Kích hoạt lại
              </button>
            `;
          }
        }

        const genderVi = m.gender === 'MALE' ? 'Nam' : m.gender === 'FEMALE' ? 'Nữ' : m.gender ? 'Khác' : 'Chưa cập nhật';

        return `
          <tr>
            <td>
              <div class="fw-semibold text-ink">${escapeHtml(m.fullName)} ${isMe ? '<span class="badge-ledger badge-primary ms-1 text-nowrap">Bạn</span>' : ''}</div>
              <small class="text-muted">${genderVi}</small>
            </td>
            <td>
              <div class="font-monospace small">${escapeHtml(m.email)}</div>
              <small class="text-muted font-monospace">${m.dateOfBirth || ''}</small>
            </td>
            <td><span class="${roleBadgeClass}">${roleVi}</span></td>
            <td>${statusBadge}</td>
            <td><small class="text-muted font-monospace">${joinDate}</small></td>
            <td class="text-end text-nowrap">${actionHtml}</td>
          </tr>
        `;
      })
      .join('');
  }

  // Handle action click
  tbody.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const memberId = btn.dataset.id;
    const memberName = btn.dataset.name;

    if (action === 'deactivate') {
      statusModalTitle.textContent = 'Vô hiệu hóa thành viên';
      statusModalBody.innerHTML = `Bạn có chắc muốn vô hiệu hóa tài khoản của <strong>${escapeHtml(memberName)}</strong>? Người này sẽ bị thu hồi toàn bộ quyền và không thể đăng nhập.`;
      confirmStatusBtn.className = 'btn-ledger btn-ledger-secondary text-danger btn-sm';
      confirmStatusBtn.textContent = 'Vô hiệu hóa';
      pendingAction = { id: memberId, isActive: false };
      statusModal.show();
    } else if (action === 'activate') {
      statusModalTitle.textContent = 'Kích hoạt lại thành viên';
      statusModalBody.innerHTML = `Bạn có muốn kích hoạt lại tài khoản cho <strong>${escapeHtml(memberName)}</strong>?`;
      confirmStatusBtn.className = 'btn-ledger btn-ledger-primary btn-sm';
      confirmStatusBtn.textContent = 'Kích hoạt lại';
      pendingAction = { id: memberId, isActive: true };
      statusModal.show();
    }
  });

  confirmStatusBtn.addEventListener('click', async () => {
    if (!pendingAction) return;
    confirmStatusBtn.disabled = true;
    try {
      await window.ClubApi.request(`/members/${pendingAction.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: pendingAction.isActive }),
      });
      statusModal.hide();
      showAlert(
        `Đã ${pendingAction.isActive ? 'kích hoạt lại' : 'vô hiệu hóa'} thành viên thành công!`,
        'success',
      );
      await fetchMembers();
    } catch (error) {
      statusModal.hide();
      showAlert(error.message, 'danger');
    } finally {
      confirmStatusBtn.disabled = false;
      pendingAction = null;
    }
  });

  searchInput.addEventListener('input', renderTable);
  statusFilter.addEventListener('change', renderTable);

  function escapeHtml(str) {
    return str
      ? str
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
      : '';
  }

  fetchMembers();
})();
