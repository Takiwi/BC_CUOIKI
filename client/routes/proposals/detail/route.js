const proposalId = new URLSearchParams(window.location.search).get('id');
const content = document.querySelector('#proposal-content');
const message = document.querySelector('#page-message');
const user = window.ClubApi.getUser();

if (!window.ClubApi.requireAuth()) {
  content.replaceChildren();
} else if (!proposalId) {
  showError('Thiếu mã đề xuất chi.');
} else {
  loadProposal();
}

async function loadProposal() {
  try {
    const [proposal, funds, debts] = await Promise.all([
      window.ClubApi.request(`/funds/proposals/${encodeURIComponent(proposalId)}`),
      window.ClubApi.request('/funds').catch(() => null),
      window.ClubApi.request('/funds/debts').catch(() => []),
    ]);
    renderProposal(proposal, funds, debts);
  } catch (error) {
    showError(error.message);
    content.replaceChildren();
  }
}

function renderProposal(proposal, funds, debts) {
  const sheet = document.createElement('div');

  // 1. Header tờ Sổ cái Đề xuất
  const header = document.createElement('div');
  header.className = 'ledger-header';

  const titleWrap = document.createElement('div');
  const eyebrow = document.createElement('div');
  eyebrow.className = 'small text-muted text-uppercase fw-semibold mb-1';
  eyebrow.textContent = `Mã hồ sơ: ĐX-${proposal.id.slice(0, 8).toUpperCase()}`;

  const heading = document.createElement('h2');
  heading.className = 'ledger-title mb-0';
  heading.textContent = proposal.purpose;
  titleWrap.append(eyebrow, heading);

  const badge = document.createElement('div');
  badge.innerHTML = renderProposalStatusBadge(proposal.status);

  header.append(titleWrap, badge);
  sheet.append(header);

  // 2. Thân nội dung
  const body = document.createElement('div');
  body.className = 'ledger-body';

  // 2.1 Pipeline tiến trình trạng thái trực quan
  const pipeline = document.createElement('div');
  pipeline.className = 'p-3 rounded-1 mb-4 border';
  pipeline.style.backgroundColor = 'var(--color-surface-subtle)';
  pipeline.style.borderColor = 'var(--color-border-subtle)';

  pipeline.innerHTML = `
    <div class="small fw-bold text-uppercase text-muted mb-2" style="letter-spacing: 0.05em;">Tiến trình xử lý hồ sơ:</div>
    <div class="d-flex align-items-center justify-content-between flex-wrap gap-2 small">
      <span class="badge-ledger badge-success"><i class="bi bi-check-circle-fill"></i> 1. Đã lập dự toán</span>
      <i class="bi bi-arrow-right text-muted"></i>
      <span class="badge-ledger ${getStepBadgeClass(proposal.status, 'VOTING')}"><i class="bi bi-check2-square"></i> 2. Biểu quyết cử tri</span>
      <i class="bi bi-arrow-right text-muted"></i>
      <span class="badge-ledger ${getStepBadgeClass(proposal.status, 'PENDING_APPROVAL')}"><i class="bi bi-shield-check"></i> 3. Phê duyệt ngân quỹ</span>
      <i class="bi bi-arrow-right text-muted"></i>
      <span class="badge-ledger ${getStepBadgeClass(proposal.status, 'APPROVED')}"><i class="bi bi-cash-stack"></i> 4. Giải ngân chi trả</span>
    </div>
  `;
  body.append(pipeline);

  // 2.2 Bảng thông tin dự toán & Người lập đề xuất
  const grid = document.createElement('div');
  grid.className = 'row g-3 mb-4';

  const stats = [
    ['Số tiền đề xuất chi', window.ClubApi.formatMoney(proposal.amount), 'text-dark fw-bold fs-5'],
    ['Người khởi tạo', `${escapeHtml(proposal.creatorName)} <span class="text-nowrap">(${formatRole(proposal.creatorRole)})</span>`, 'text-secondary'],
    ['Sự kiện gắn kết', proposal.eventName ? escapeHtml(proposal.eventName) : 'Chi phí thường xuyên của CLB', 'text-secondary'],
    ['Vòng biểu quyết', proposal.currentRound ? `Vòng ${proposal.currentRound}` : 'Chưa mở', 'text-secondary num-tabular'],
    ['Tỷ lệ phiếu tham gia', `${proposal.totalVotes || 0} / ${proposal.eligibleVoters || 0} cử tri`, 'text-primary fw-semibold num-tabular'],
    ['Hạn chót biểu quyết', proposal.deadlineAt ? formatDate(proposal.deadlineAt) : 'Chưa thiết lập', 'text-muted small num-tabular'],
  ];

  for (const [label, value, valueClass] of stats) {
    const col = document.createElement('div');
    col.className = 'col-12 col-md-6 col-lg-4';
    col.innerHTML = `
      <div class="p-3 rounded-1 border h-100" style="background: var(--color-surface); border-color: var(--color-border-subtle) !important;">
        <div class="small text-muted mb-1">${label}</div>
        <div class="${valueClass}">${value}</div>
      </div>
    `;
    grid.append(col);
  }
  body.append(grid);

  // Ghi chú thuyết minh đề xuất
  if (proposal.note) {
    const noteBox = document.createElement('div');
    noteBox.className = 'p-3 rounded-1 mb-4 border';
    noteBox.style.backgroundColor = 'var(--color-canvas)';
    noteBox.style.borderColor = 'var(--color-border-subtle)';
    noteBox.innerHTML = `
      <div class="small fw-bold text-muted mb-1"><i class="bi bi-card-text me-1"></i>Thuyết minh mục đích sử dụng ngân quỹ:</div>
      <div class="text-secondary small">${escapeHtml(proposal.note)}</div>
    `;
    body.append(noteBox);
  }

  // 2.3 BẢNG KIỂM TRA TRƯỚC PHÊ DUYỆT (PRE-APPROVAL CHECK PANEL - BR-009 đến BR-012)
  if (['PENDING_APPROVAL', 'BOARD_DECISION_REQUIRED', 'APPROVED'].includes(proposal.status) && funds) {
    const checkSection = document.createElement('div');
    checkSection.className = 'mb-4';

    const reqAmount = parseFloat(proposal.amount || 0);
    const mainFund = parseFloat(funds.mainFund || 0);
    const reserveFund = parseFloat(funds.reserveFund || 0);
    const totalAvail = mainFund + reserveFund;

    // Tổng nợ đang mở (BR-010)
    const openDebts = (debts || [])
      .filter((d) => d.status === 'OPEN')
      .reduce((sum, d) => sum + parseFloat(d.balanceDue || 0), 0);

    const netRemaining = mainFund - reqAmount - openDebts;

    const isFundSufficient = mainFund >= reqAmount;
    const isDebtCommitmentSafe = netRemaining >= 0;
    const isNotSelf = user?.id !== proposal.creatorMemberId;

    checkSection.innerHTML = `
      <div class="ledger-sheet mb-0">
        <div class="ledger-header" style="background-color: var(--color-surface-subtle);">
          <h3 class="ledger-title"><i class="bi bi-clipboard-check me-2"></i>Bảng kiểm tra điều kiện ngân quỹ trước phê duyệt</h3>
          <span class="code-tag">BR-009 đến BR-012</span>
        </div>
        <div class="ledger-body">
          <div class="check-panel mb-3">
            <div class="check-row">
              <span class="text-muted">1. Số tiền xin duyệt chi:</span>
              <span class="fw-bold num-tabular">${window.ClubApi.formatMoney(reqAmount)}</span>
            </div>
            <div class="check-row">
              <span class="text-muted">2. Số dư Quỹ chính khả dụng hiện tại:</span>
              <span class="fw-bold num-tabular text-dark">${window.ClubApi.formatMoney(mainFund)}</span>
            </div>
            <div class="check-row">
              <span class="text-muted">3. Tổng công nợ cam kết đang mở (BR-010):</span>
              <span class="fw-bold num-tabular ${openDebts > 0 ? 'text-warning' : 'text-muted'}">${window.ClubApi.formatMoney(openDebts)}</span>
            </div>
            <div class="check-row" style="background: var(--color-surface-subtle);">
              <span class="fw-bold">4. Số dư khả dụng ròng còn lại sau khi trừ nợ & chi:</span>
              <span class="fw-bold num-tabular ${netRemaining >= 0 ? 'text-success' : 'text-danger'}">${window.ClubApi.formatMoney(netRemaining)}</span>
            </div>
          </div>

          <!-- Các điều kiện thẩm định -->
          <div class="small">
            <div class="d-flex align-items-center gap-2 mb-1 ${isFundSufficient ? 'text-success' : 'text-danger'}">
              <i class="bi ${isFundSufficient ? 'bi-check-circle-fill' : 'bi-x-circle-fill'}"></i>
              <span>Số dư Quỹ chính: ${isFundSufficient ? 'Đủ ngân sách chi trả' : 'Không đủ số dư trong Quỹ chính'}</span>
            </div>
            <div class="d-flex align-items-center gap-2 mb-1 ${isDebtCommitmentSafe ? 'text-success' : 'text-warning'}">
              <i class="bi ${isDebtCommitmentSafe ? 'bi-check-circle-fill' : 'bi-exclamation-triangle-fill'}"></i>
              <span>Bảo toàn cam kết công nợ: ${isDebtCommitmentSafe ? 'Đảm bảo an toàn chi trả' : 'Cảnh báo: Nếu chi khoản này sẽ thiếu hụt ngân sách trả các khoản nợ đang mở'}</span>
            </div>
            <div class="d-flex align-items-center gap-2 ${isNotSelf ? 'text-success' : 'text-danger'}">
              <i class="bi ${isNotSelf ? 'bi-check-circle-fill' : 'bi-x-circle-fill'}"></i>
              <span>Tính khách quan của người duyệt: ${isNotSelf ? 'Hợp lệ (Người duyệt không phải người tạo đề xuất)' : 'Vi phạm BR-011: Bạn không thể tự phê duyệt đề xuất chi do chính mình tạo ra'}</span>
            </div>
          </div>
        </div>
      </div>
    `;
    body.append(checkSection);
  }

  // Kết quả thẩm định trước đó nếu có
  if (proposal.reviewDecision) {
    const review = document.createElement('div');
    review.className = 'p-3 rounded-1 mb-4 border';
    review.style.backgroundColor = 'var(--color-surface-subtle)';
    review.style.borderColor = 'var(--color-border-subtle)';
    review.innerHTML = `
      <div class="small fw-bold text-muted mb-1"><i class="bi bi-clock-history me-1"></i>Kết quả thẩm định trước đó:</div>
      <div class="small text-secondary">
        Quyết định: <strong>${escapeHtml(proposal.reviewDecision)}</strong>
        ${proposal.reviewerName ? ` · Người xét duyệt: <strong>${escapeHtml(proposal.reviewerName)}</strong>` : ''}
        ${proposal.reviewReason ? ` · Lý do: <em>"${escapeHtml(proposal.reviewReason)}"</em>` : ''}
      </div>
    `;
    body.append(review);
  }

  // 2.4 Các nút Thao tác (Actions)
  const actions = document.createElement('div');
  actions.className = 'd-flex flex-wrap gap-2 pt-3 border-top';

  if (proposal.status === 'VOTING') {
    const voteLink = document.createElement('a');
    voteLink.className = 'btn-ledger btn-ledger-primary';
    voteLink.href = `../../voting/detail/index.html?id=${encodeURIComponent(proposal.id)}`;
    voteLink.innerHTML = '<i class="bi bi-check2-square"></i> <span>Mở hòm phiếu biểu quyết</span>';
    actions.append(voteLink);
  }

  // Nút duyệt hoặc quyết định Ban chủ nhiệm nếu có quyền
  const canApprove = ['PRESIDENT', 'BOARD', 'ADMIN'].includes(user?.role);
  if (['PENDING_APPROVAL', 'BOARD_DECISION_REQUIRED'].includes(proposal.status) && canApprove) {
    const approveBtn = document.createElement('button');
    approveBtn.className = 'btn-ledger btn-ledger-primary';
    approveBtn.innerHTML = '<i class="bi bi-check-lg"></i> <span>Phê duyệt đề xuất</span>';
    approveBtn.addEventListener('click', () => handleApprovalDecision(proposal.id, 'APPROVED'));

    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'btn-ledger btn-ledger-outline text-danger';
    rejectBtn.innerHTML = '<i class="bi bi-x-lg"></i> <span>Từ chối đề xuất</span>';
    rejectBtn.addEventListener('click', () => handleApprovalDecision(proposal.id, 'REJECTED'));

    actions.append(approveBtn, rejectBtn);
  }

  // Nút hủy đề xuất của người tạo
  if (
    proposal.creatorMemberId === user?.id &&
    ['VOTING', 'PENDING_APPROVAL'].includes(proposal.status)
  ) {
    const cancel = document.createElement('button');
    cancel.className = 'btn-ledger btn-ledger-outline text-muted ms-auto';
    cancel.innerHTML = '<i class="bi bi-trash"></i> <span>Hủy bỏ đề xuất</span>';
    cancel.addEventListener('click', async () => {
      if (!window.confirm('Bạn có chắc chắn muốn hủy đề xuất này? Lịch sử biểu quyết vẫn sẽ được lưu trữ.')) {
        return;
      }
      cancel.disabled = true;
      try {
        await window.ClubApi.request(`/funds/proposals/${proposal.id}`, {
          method: 'DELETE',
        });
        window.location.reload();
      } catch (error) {
        showError(error.message);
        cancel.disabled = false;
      }
    });
    actions.append(cancel);
  }

  body.append(actions);
  sheet.append(body);
  content.replaceChildren(sheet);
}

async function handleApprovalDecision(id, decision) {
  const promptText = decision === 'APPROVED' ? 'Ghi chú phê duyệt (không bắt buộc):' : 'Nhập lý do từ chối đề xuất:';
  const reason = window.prompt(promptText) || '';
  if (decision === 'REJECTED' && !reason.trim()) return;

  try {
    await window.ClubApi.request(`/funds/proposals/${encodeURIComponent(id)}/review`, {
      method: 'POST',
      body: JSON.stringify({ decision, reason: reason.trim() }),
    });
    window.location.reload();
  } catch (error) {
    showError(error.message);
  }
}

function getStepBadgeClass(status, currentStep) {
  if (status === currentStep) return 'badge-warning';
  if (
    (currentStep === 'VOTING' && ['PENDING_APPROVAL', 'APPROVED'].includes(status)) ||
    (currentStep === 'PENDING_APPROVAL' && status === 'APPROVED')
  ) {
    return 'badge-success';
  }
  return 'badge-neutral';
}

function showError(text) {
  message.className = 'alert alert-danger mt-3';
  message.textContent = text;
  message.classList.remove('d-none');
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'medium',
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
    BOARD_DECISION_REQUIRED: '<span class="badge-ledger badge-info"><i class="bi bi-shield-lock-fill"></i> Chờ Ban chủ nhiệm quyết định</span>',
  };
  return map[status] || `<span class="badge-ledger badge-neutral">${escapeHtml(status)}</span>`;
}

function formatRole(role) {
  const map = {
    ADMIN: 'Quản trị viên',
    PRESIDENT: 'Chủ nhiệm',
    TREASURER: 'Thủ quỹ',
    BOARD: 'Ban chủ nhiệm',
    MEMBER: 'Thành viên',
  };
  return map[role] || role;
}

function escapeHtml(str) {
  return str
    ? str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    : '';
}
