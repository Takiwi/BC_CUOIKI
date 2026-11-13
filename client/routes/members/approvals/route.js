(() => {
  if (!window.ClubApi.requireAuth(['PRESIDENT'])) {
    return;
  }

  const alertBox = document.querySelector('#alert-box');
  const loadingSpinner = document.querySelector('#loading-spinner');
  const emptyState = document.querySelector('#empty-state');
  const emptyText = document.querySelector('#empty-text');
  const tableContainer = document.querySelector('#table-container');
  const tbody = document.querySelector('#applications-tbody');
  const statusFilter = document.querySelector('#status-filter');

  const approveModalEl = document.querySelector('#approveModal');
  const approveModal = approveModalEl ? new bootstrap.Modal(approveModalEl) : null;
  const approveModalText = document.querySelector('#approveModalText');
  const approveReasonInput = document.querySelector('#approveReason');
  const confirmApproveBtn = document.querySelector('#confirmApproveBtn');

  const rejectModalEl = document.querySelector('#rejectModal');
  const rejectModal = rejectModalEl ? new bootstrap.Modal(rejectModalEl) : null;
  const rejectModalText = document.querySelector('#rejectModalText');
  const rejectReasonInput = document.querySelector('#rejectReason');
  const confirmRejectBtn = document.querySelector('#confirmRejectBtn');

  let allApplications = [];
  let currentTarget = null;

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

  async function fetchApplications() {
    setLoading(true);
    hideAlert();
    try {
      allApplications = await window.ClubApi.request('/members/applications');
      renderTable();
    } catch (error) {
      showAlert(error.message, 'danger');
      setLoading(false);
    }
  }

  function renderTable() {
    setLoading(false);
    const filter = statusFilter.value;

    const filtered = allApplications.filter((app) => {
      if (filter === 'ALL') return true;
      return app.status === filter;
    });

    if (filtered.length === 0) {
      tableContainer.classList.add('d-none');
      emptyState.classList.remove('d-none');
      emptyText.textContent =
        filter === 'PENDING'
          ? 'Hiện tại không có đơn đăng ký nào đang chờ xét duyệt.'
          : 'Không có đơn đăng ký nào khớp với bộ lọc.';
      return;
    }

    tableContainer.classList.remove('d-none');
    emptyState.classList.add('d-none');

    tbody.innerHTML = filtered
      .map((app) => {
        let statusBadge = '';
        if (app.status === 'PENDING') {
          statusBadge = `<span class="badge-ledger badge-warning text-nowrap">Chờ duyệt</span>`;
        } else if (app.status === 'APPROVED') {
          statusBadge = `<span class="badge-ledger badge-success text-nowrap">Đã phê duyệt</span>`;
        } else {
          statusBadge = `<span class="badge-ledger badge-neutral text-nowrap">Đã từ chối</span>`;
        }

        const dateStr = app.createdAt
          ? new Date(app.createdAt).toLocaleDateString('vi-VN')
          : '-';

        let actionHtml = '';
        if (app.status === 'PENDING') {
          actionHtml = `
            <div class="d-flex justify-content-end gap-2 text-nowrap">
              <button class="btn-ledger btn-ledger-primary btn-sm" data-action="approve" data-id="${app.memberId}" data-name="${escapeHtml(app.fullName)}">
                <i class="bi bi-check-lg me-1"></i>Phê duyệt
              </button>
              <button class="btn-ledger btn-ledger-secondary text-danger btn-sm" data-action="reject" data-id="${app.memberId}" data-name="${escapeHtml(app.fullName)}">
                <i class="bi bi-x-lg me-1"></i>Từ chối
              </button>
            </div>
          `;
        } else {
          const detail = app.decisionReason
            ? `<div class="text-muted small fst-italic">"${escapeHtml(app.decisionReason)}"</div>`
            : '';
          const by = app.decidedByName
            ? `<div class="text-muted small">Người duyệt: ${escapeHtml(app.decidedByName)}</div>`
            : '';
          actionHtml = `<div class="text-end text-nowrap">${detail}${by}</div>`;
        }

        const genderVi = app.gender === 'MALE' ? 'Nam' : app.gender === 'FEMALE' ? 'Nữ' : app.gender ? 'Khác' : '';
        const dobText = app.dateOfBirth ? `<span class="text-nowrap font-monospace text-muted small">${app.dateOfBirth}</span>` : '';

        return `
          <tr>
            <td>
              <div class="fw-semibold text-ink">${escapeHtml(app.fullName)}</div>
              <small class="text-muted">${genderVi ? genderVi + ' ' : ''}${dobText}</small>
            </td>
            <td><span class="font-monospace small">${escapeHtml(app.email)}</span></td>
            <td><small class="text-muted font-monospace">${dateStr}</small></td>
            <td>${statusBadge}</td>
            <td class="text-end text-nowrap">${actionHtml}</td>
          </tr>
        `;
      })
      .join('');
  }

  tbody.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const memberId = btn.dataset.id;
    const memberName = btn.dataset.name;

    currentTarget = { memberId, memberName };

    if (action === 'approve') {
      approveModalText.innerHTML = `Bạn có chắc chắn muốn phê duyệt đơn gia nhập CLB của ứng viên <strong>${escapeHtml(memberName)}</strong>?`;
      approveReasonInput.value = 'Đủ điều kiện tham gia';
      approveModal.show();
    } else if (action === 'reject') {
      rejectModalText.innerHTML = `Nêu lý do từ chối đơn gia nhập của ứng viên <strong>${escapeHtml(memberName)}</strong>:`;
      rejectReasonInput.value = '';
      rejectModal.show();
    }
  });

  confirmApproveBtn.addEventListener('click', async () => {
    if (!currentTarget) return;
    confirmApproveBtn.disabled = true;
    try {
      await window.ClubApi.request(`/members/${currentTarget.memberId}/approval`, {
        method: 'PATCH',
        body: JSON.stringify({
          decision: 'APPROVED',
          reason: approveReasonInput.value.trim() || undefined,
        }),
      });
      approveModal.hide();
      showAlert(`Đã phê duyệt thành viên ${currentTarget.memberName} thành công!`, 'success');
      await fetchApplications();
    } catch (error) {
      approveModal.hide();
      showAlert(error.message, 'danger');
    } finally {
      confirmApproveBtn.disabled = false;
      currentTarget = null;
    }
  });

  confirmRejectBtn.addEventListener('click', async () => {
    if (!currentTarget) return;
    const reason = rejectReasonInput.value.trim();
    if (!reason) {
      alert('Vui lòng nhập lý do từ chối.');
      return;
    }

    confirmRejectBtn.disabled = true;
    try {
      await window.ClubApi.request(`/members/${currentTarget.memberId}/approval`, {
        method: 'PATCH',
        body: JSON.stringify({
          decision: 'REJECTED',
          reason,
        }),
      });
      rejectModal.hide();
      showAlert(`Đã từ chối đơn đăng ký của ${currentTarget.memberName}.`, 'info');
      await fetchApplications();
    } catch (error) {
      rejectModal.hide();
      showAlert(error.message, 'danger');
    } finally {
      confirmRejectBtn.disabled = false;
      currentTarget = null;
    }
  });

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

  fetchApplications();
})();
