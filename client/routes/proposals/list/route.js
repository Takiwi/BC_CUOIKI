const list = document.querySelector('#proposal-list');
const message = document.querySelector('#page-message');
const user = window.ClubApi.getUser();

if (window.ClubApi.requireAuth()) {
  const createButton = document.querySelector('#create-proposal');
  if (['MEMBER', 'PRESIDENT', 'TREASURER', 'ADMIN'].includes(user?.role)) {
    createButton.classList.remove('d-none');
  }
  loadProposals();
}

async function loadProposals() {
  try {
    const proposals = await window.ClubApi.request('/funds/proposals');
    if (!proposals.length) {
      list.innerHTML =
        '<tr><td colspan="6" class="p-5 text-center text-muted"><div class="small fw-semibold">Chưa có đề xuất chi tiêu nào.</div><div class="small text-muted">Các đề xuất mới tạo sẽ hiển thị tại đây.</div></td></tr>';
      return;
    }
    list.replaceChildren(
      ...proposals.map((proposal) => {
        const row = document.createElement('tr');

        // Cột 1: Mục đích chi tiêu
        const purposeCell = document.createElement('td');
        purposeCell.className = 'fw-medium text-dark';
        purposeCell.textContent = proposal.purpose || '—';
        row.append(purposeCell);

        // Cột 2: Kinh phí dự toán (căn phải, tabular-nums)
        const amountCell = document.createElement('td');
        amountCell.className = 'text-end fw-bold num-tabular text-dark';
        amountCell.textContent = window.ClubApi.formatMoney(proposal.amount);
        row.append(amountCell);

        // Cột 3: Người khởi tạo
        const creatorCell = document.createElement('td');
        creatorCell.className = 'small text-secondary';
        creatorCell.textContent = proposal.creatorName || '—';
        row.append(creatorCell);

        // Cột 4: Tiến độ biểu quyết
        const voteCell = document.createElement('td');
        voteCell.className = 'small num-tabular';
        const totalV = proposal.totalVotes || 0;
        const eligV = proposal.eligibleVoters || 0;
        voteCell.innerHTML = `
          <div><strong class="text-primary">${totalV}/${eligV}</strong> cử tri <span class="text-nowrap text-muted">(Quorum)</span></div>
          ${proposal.deadlineAt ? `<div class="text-muted" style="font-size: 11px;">Hạn: ${formatDate(proposal.deadlineAt)}</div>` : ''}
        `;
        row.append(voteCell);

        // Cột 5: Trạng thái (100% Tiếng Việt)
        const statusCell = document.createElement('td');
        statusCell.innerHTML = renderProposalStatusBadge(proposal.status);
        row.append(statusCell);

        // Cột 6: Thao tác
        const actionCell = document.createElement('td');
        actionCell.className = 'text-end';
        const detailLink = document.createElement('a');
        detailLink.className = 'btn-ledger btn-ledger-outline py-0 px-2';
        detailLink.style.fontSize = '12px';
        detailLink.href = `../detail/index.html?id=${encodeURIComponent(proposal.id)}`;
        detailLink.textContent = 'Xem chi tiết';
        actionCell.append(detailLink);
        row.append(actionCell);

        return row;
      }),
    );
  } catch (error) {
    message.className = 'alert alert-danger';
    message.textContent = error.message;
    message.classList.remove('d-none');
    list.replaceChildren();
  }
}

function formatDate(value) {
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function renderProposalStatusBadge(status) {
  const map = {
    VOTING: '<span class="badge-ledger badge-warning"><i class="bi bi-clock-fill"></i> Đang biểu quyết</span>',
    PENDING_APPROVAL: '<span class="badge-ledger badge-warning"><i class="bi bi-clock"></i> Chờ phê duyệt</span>',
    APPROVED: '<span class="badge-ledger badge-success"><i class="bi bi-check-circle-fill"></i> Đã duyệt</span>',
    REJECTED: '<span class="badge-ledger badge-danger"><i class="bi bi-x-circle-fill"></i> Bị từ chối</span>',
    CANCELLED: '<span class="badge-ledger badge-neutral"><i class="bi bi-slash-circle"></i> Đã hủy</span>',
    BOARD_DECISION_REQUIRED: '<span class="badge-ledger badge-info"><i class="bi bi-shield-lock-fill"></i> Chờ BCN quyết định</span>',
  };
  return map[status] || `<span class="badge-ledger badge-neutral">${escapeHtml(status)}</span>`;
}

function escapeHtml(str) {
  return str
    ? str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    : '';
}
