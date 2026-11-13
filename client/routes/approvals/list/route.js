const list = document.querySelector('#approval-list');
const message = document.querySelector('#page-message');
const user = window.ClubApi.getUser();

const ROLE_VI = {
  BOARD: 'Ban chủ nhiệm',
  TREASURER: 'Thủ quỹ',
  MEMBER: 'Thành viên',
};

if (window.ClubApi.requireAuth(['TREASURER', 'BOARD'])) {
  loadProposals();
} else {
  list.replaceChildren();
}

async function loadProposals() {
  try {
    const statusQuery =
      user?.role === 'BOARD'
        ? 'PENDING_APPROVAL,BOARD_DECISION_REQUIRED'
        : 'PENDING_APPROVAL';

    const proposals = await window.ClubApi.request(
      `/funds/proposals?status=${statusQuery}`,
    );
    if (!proposals || !proposals.length) {
      list.innerHTML =
        '<tr><td colspan="6" class="p-5 text-center text-muted"><i class="bi bi-inbox fs-3 d-block mb-2"></i>Hiện không có đề xuất nào đang chờ phê duyệt.</td></tr>';
      return;
    }
    list.replaceChildren(
      ...proposals.map((proposal) => {
        const row = document.createElement('tr');
        
        // Purpose
        const purposeCell = document.createElement('td');
        purposeCell.innerHTML = `<a href="../detail/index.html?id=${encodeURIComponent(proposal.id)}" class="fw-semibold text-decoration-none text-ink hover-underline">${proposal.purpose}</a>`;
        row.append(purposeCell);

        // Amount (right aligned, monospace)
        const amountCell = document.createElement('td');
        amountCell.className = 'text-end font-monospace fw-semibold';
        amountCell.textContent = window.ClubApi.formatMoney(proposal.amount);
        row.append(amountCell);

        // Creator with Vietnamese role
        const creatorCell = document.createElement('td');
        const roleVi = ROLE_VI[proposal.creatorRole] || proposal.creatorRole || 'Thành viên';
        creatorCell.innerHTML = `<span>${proposal.creatorName}</span> <span class="text-muted small text-nowrap">(${roleVi})</span>`;
        row.append(creatorCell);

        // Voting result
        const voteCell = document.createElement('td');
        voteCell.innerHTML = `<span class="font-monospace fw-semibold">${proposal.totalVotes}/${proposal.eligibleVoters}</span> <span class="text-muted small">phiếu</span>`;
        row.append(voteCell);

        // Status badge
        const statusCell = document.createElement('td');
        const badge = document.createElement('span');
        badge.className = `badge-ledger text-nowrap ${
          proposal.status === 'BOARD_DECISION_REQUIRED'
            ? 'badge-warning'
            : 'badge-primary'
        }`;
        badge.textContent =
          proposal.status === 'BOARD_DECISION_REQUIRED'
            ? 'BCN quyết định (sau 2 vòng hòa)'
            : 'Chờ duyệt sau biểu quyết';
        statusCell.append(badge);
        row.append(statusCell);

        // Actions
        const action = document.createElement('td');
        action.className = 'text-end text-nowrap';
        const needsBoardDecision =
          proposal.status === 'BOARD_DECISION_REQUIRED';
        const canReview = needsBoardDecision
          ? user?.role === 'BOARD'
          : user?.role === 'BOARD' ||
            (user?.role === 'TREASURER' &&
              proposal.creatorMemberId !== user?.id);

        if (canReview) {
          const approve = document.createElement('button');
          approve.className = 'btn-ledger btn-ledger-primary btn-sm';
          approve.innerHTML = `<i class="bi bi-check-lg me-1"></i>${needsBoardDecision ? 'BCN duyệt' : 'Duyệt'}`;
          approve.addEventListener('click', () =>
            decide(proposal, 'APPROVED', approve),
          );
          action.append(approve);

          const reject = document.createElement('button');
          reject.className = 'btn-ledger btn-ledger-secondary text-danger btn-sm ms-2';
          reject.innerHTML = `<i class="bi bi-x-lg me-1"></i>${needsBoardDecision ? 'BCN từ chối' : 'Từ chối'}`;
          reject.addEventListener('click', () =>
            decide(proposal, 'REJECTED', reject),
          );
          action.append(reject);
        } else {
          const notice = document.createElement('span');
          notice.className = 'text-muted small fst-italic text-nowrap';
          notice.textContent = 'Người tạo không được tự duyệt';
          action.append(notice);
        }

        row.append(action);
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

async function decide(proposal, decision, button) {
  const boardDecision = proposal.status === 'BOARD_DECISION_REQUIRED';
  const reason =
    decision === 'REJECTED' || boardDecision
      ? window.prompt(
          boardDecision
            ? 'Nhập lý do quyết định của Ban chủ nhiệm:'
            : 'Nhập lý do từ chối:',
        )
      : window.prompt('Ghi chú quyết định (không bắt buộc):') || '';
  if ((decision === 'REJECTED' || boardDecision) && !reason?.trim()) return;
  button.disabled = true;
  try {
    await window.ClubApi.request(
      `/funds/proposals/${encodeURIComponent(proposal.id)}/${
        boardDecision ? 'board-decision' : 'approve'
      }`,
      {
        method: 'PATCH',
        body: JSON.stringify({ decision, ...(reason ? { reason } : {}) }),
      },
    );
    message.className = 'alert alert-success';
    message.textContent = 'Đã lưu quyết định thành công.';
    message.classList.remove('d-none');
    await loadProposals();
  } catch (error) {
    message.className = 'alert alert-danger';
    message.textContent = error.message;
    message.classList.remove('d-none');
    button.disabled = false;
  }
}
