const proposalId = new URLSearchParams(window.location.search).get('id');
const content = document.querySelector('#ballot-content');
const message = document.querySelector('#page-message');
const user = window.ClubApi.getUser();
let ballot;

if (!window.ClubApi.requireAuth()) {
  content.replaceChildren();
} else if (!proposalId) {
  showError('Thiếu mã đề xuất cần biểu quyết.');
} else {
  loadBallot();
}

async function loadBallot() {
  try {
    ballot = await window.ClubApi.request(
      `/ballots/${encodeURIComponent(proposalId)}/results`,
    );
    renderBallot();
  } catch (error) {
    showError(error.message);
    content.replaceChildren();
  }
}

function renderBallot() {
  const sheet = document.createElement('div');

  // Header tờ Sổ cái Biểu quyết
  const header = document.createElement('div');
  header.className = 'ledger-header';

  const titleWrap = document.createElement('div');
  const title = document.createElement('h2');
  title.className = 'ledger-title mb-1';
  title.textContent = `Vòng ${ballot.round} · Kết quả biểu quyết đề xuất chi`;

  const deadline = document.createElement('div');
  deadline.className = 'small text-muted';
  const isExpired = new Date(ballot.deadlineAt) <= new Date();
  deadline.innerHTML = `<i class="bi bi-clock me-1"></i>Hạn bỏ phiếu: <strong class="num-tabular text-dark">${formatDate(ballot.deadlineAt)}</strong>${
    isExpired ? ' <span class="badge-ledger badge-danger ms-1">Đã hết hạn</span>' : ''
  }`;
  titleWrap.append(title, deadline);

  const statusBadge = document.createElement('div');
  statusBadge.innerHTML = renderProposalStatusBadge(ballot.proposalStatus);

  header.append(titleWrap, statusBadge);
  sheet.append(header);

  // Thân tờ biểu quyết
  const body = document.createElement('div');
  body.className = 'ledger-body';

  // 1. BIỂU ĐỒ THANH TIẾN ĐỘ BIỂU QUYẾT CÓ VẠCH NGƯỠNG 50% (Vote Bar with 50% Marker)
  const totalEligible = Math.max(1, ballot.eligibleVoters || 1);
  const yesPct = Math.round(((ballot.yes || 0) / totalEligible) * 100);
  const noPct = Math.round(((ballot.no || 0) / totalEligible) * 100);
  const blankPct = Math.round(((ballot.blank || 0) / totalEligible) * 100);
  const uncastCount = Math.max(0, totalEligible - (ballot.totalVotes || 0));
  const uncastPct = Math.max(0, 100 - yesPct - noPct - blankPct);

  const chartBox = document.createElement('div');
  chartBox.className = 'vote-tally-box mb-4';

  chartBox.innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-1 flex-wrap gap-2">
      <div>
        <strong>Tiến độ tham gia cử tri:</strong>
        <span class="num-tabular fw-bold text-primary fs-6">${ballot.totalVotes} / ${ballot.eligibleVoters} cử tri</span>
        <span class="text-nowrap text-muted small ms-1">(Quorum bắt buộc: 100%)</span>
      </div>
      <div class="small">
        <span class="text-muted">Đồng thuận hiện tại:</span>
        <strong class="num-tabular ${yesPct > 50 ? 'text-success' : 'text-dark'}">${ballot.approvedPercent}%</strong>
      </div>
    </div>

    <!-- Thanh tiến độ có vạch mốc 50% -->
    <div class="vote-progress-track">
      <div class="vote-marker-line"></div>
      <div class="vote-marker-label">▲ Ngưỡng 50%</div>

      <div class="vote-segment-yes" style="width: ${yesPct}%;" title="Đồng ý: ${ballot.yes} phiếu (${yesPct}%)"></div>
      <div class="vote-segment-no" style="width: ${noPct}%;" title="Không đồng ý: ${ballot.no} phiếu (${noPct}%)"></div>
      <div class="vote-segment-blank" style="width: ${blankPct}%;" title="Phiếu trắng: ${ballot.blank} phiếu (${blankPct}%)"></div>
    </div>

    <!-- Chú thích phân đoạn thanh biểu quyết -->
    <div class="d-flex justify-content-between small text-muted mt-3 flex-wrap gap-2">
      <span><i class="bi bi-circle-fill me-1" style="color: var(--vote-yes); font-size: 8px;"></i>Đồng ý: <strong class="num-tabular text-dark">${ballot.yes}</strong> <span class="text-nowrap">(${yesPct}%)</span></span>
      <span><i class="bi bi-circle-fill me-1" style="color: var(--vote-no); font-size: 8px;"></i>Không đồng ý: <strong class="num-tabular text-dark">${ballot.no}</strong> <span class="text-nowrap">(${noPct}%)</span></span>
      <span><i class="bi bi-square-fill me-1" style="color: var(--vote-blank); font-size: 8px;"></i>Phiếu trắng: <strong class="num-tabular text-dark">${ballot.blank}</strong> <span class="text-nowrap">(${blankPct}% sọc chéo)</span></span>
      <span><i class="bi bi-circle me-1" style="color: var(--color-border-strong); font-size: 8px;"></i>Chưa bỏ phiếu: <strong class="num-tabular text-dark">${uncastCount}</strong> <span class="text-nowrap">(${uncastPct}%)</span></span>
    </div>

    <div class="mt-3 p-2 rounded-1 small text-secondary border" style="background: var(--color-surface-subtle); border-color: var(--color-border-subtle) !important;">
      <i class="bi bi-info-circle-fill text-primary me-1"></i>
      <strong>Quy chế biểu quyết:</strong> Đề xuất chi chỉ được thông qua khi đạt đủ 100% cử tri hợp lệ tham gia bỏ phiếu và số phiếu Đồng ý đạt trên 50% tổng số cử tri. Trường hợp 100% phiếu trắng được tính là không thông qua (BR-003).
    </div>
  `;
  body.append(chartBox);

  // 2. Thao tác bỏ phiếu (Vote Actions)
  const ownVoter = ballot.eligibleVoterList?.find(
    (voter) => voter.memberId === user?.id,
  );
  const voteAlreadyCast = ownVoter?.choice != null;
  const isCreator = ballot.creatorId === user?.id;

  if (isCreator) {
    const creatorNotice = document.createElement('div');
    creatorNotice.className = 'alert alert-info border-0 rounded-1 small mb-4';
    creatorNotice.style.background = 'var(--color-info-bg)';
    creatorNotice.style.color = 'var(--color-info)';
    creatorNotice.innerHTML = `
      <i class="bi bi-info-circle-fill me-1"></i>
      <strong>Bạn là người tạo đề xuất chi này:</strong> Theo quy định BR-006, người tạo đề xuất không thuộc danh sách cử tri bỏ phiếu để đảm bảo tính minh bạch và khách quan.
    `;
    body.append(creatorNotice);
  } else if (
    ballot.proposalStatus === 'VOTING' &&
    ownVoter &&
    !voteAlreadyCast &&
    !isExpired
  ) {
    const actionBox = document.createElement('div');
    actionBox.className = 'p-3 rounded-1 mb-4 border';
    actionBox.style.backgroundColor = 'var(--color-canvas)';
    actionBox.style.borderColor = 'var(--color-border-subtle)';

    actionBox.innerHTML = `
      <div class="fw-bold small mb-2"><i class="bi bi-pencil-square me-1"></i>Thực hiện quyền biểu quyết của bạn:</div>
      <div class="d-flex flex-wrap gap-2" id="vote-btn-group"></div>
    `;

    const btnGroup = actionBox.querySelector('#vote-btn-group');

    const choices = [
      { choice: 'YES', label: 'Bỏ phiếu Đồng ý', icon: 'bi-check-lg', className: 'btn-ledger-primary', bg: 'background-color: var(--color-success); border-color: var(--color-success);' },
      { choice: 'NO', label: 'Không đồng ý', icon: 'bi-x-lg', className: 'btn-ledger-outline', bg: 'color: var(--color-danger); border-color: var(--color-danger-border);' },
      { choice: 'BLANK', label: 'Bỏ phiếu trắng', icon: 'bi-dash-lg', className: 'btn-ledger-outline', bg: 'color: var(--color-text-secondary);' },
    ];

    for (const c of choices) {
      const btn = document.createElement('button');
      btn.className = `btn-ledger ${c.className}`;
      btn.style.cssText = c.bg || '';
      btn.innerHTML = `<i class="bi ${c.icon}"></i> <span>${c.label}</span>`;
      btn.addEventListener('click', () => castVote(btn, c.choice));
      btnGroup.append(btn);
    }
    body.append(actionBox);
  } else if (voteAlreadyCast) {
    const votedNotice = document.createElement('div');
    votedNotice.className = 'p-2 px-3 rounded-1 small mb-4 border';
    votedNotice.style.background = 'var(--color-success-bg)';
    votedNotice.style.color = 'var(--color-success)';
    votedNotice.style.borderColor = 'var(--color-success-border)';
    votedNotice.innerHTML = `
      <i class="bi bi-check-circle-fill me-1"></i>
      <strong>Bạn đã bỏ phiếu:</strong> Lựa chọn của bạn đã được hệ thống mã hóa và ghi nhận thành công.
    `;
    body.append(votedNotice);
  }

  // 3. Thông báo hòa và chuyển vòng
  if (ballot.round === 2 && ballot.proposalStatus === 'VOTING') {
    const notice = document.createElement('div');
    notice.className = 'p-3 rounded-1 mb-4 border';
    notice.style.background = 'var(--color-warning-bg)';
    notice.style.color = 'var(--color-warning)';
    notice.style.borderColor = 'var(--color-warning-border)';
    notice.innerHTML = `
      <i class="bi bi-exclamation-triangle-fill me-1"></i>
      <strong>Vòng 1 đã hòa (BR-004):</strong> Vòng 2 tự động mở với danh sách snapshot cử tri mới để tái biểu quyết.
    `;
    body.append(notice);
  }

  if (ballot.proposalStatus === 'BOARD_DECISION_REQUIRED') {
    const warning = document.createElement('div');
    warning.className = 'p-3 rounded-1 mb-4 border';
    warning.style.background = 'var(--color-info-bg)';
    warning.style.color = 'var(--color-info)';
    warning.style.borderColor = 'var(--color-info-border)';
    warning.innerHTML = `
      <i class="bi bi-shield-lock-fill me-1"></i>
      <strong>Biểu quyết hòa 2 vòng (BR-004):</strong> Đề xuất chi đã chuyển sang Ban chủ nhiệm để quyết định phê duyệt hoặc từ chối tại trang Phê duyệt.
    `;
    body.append(warning);
  }

  // 4. Bảng Sổ Cái Danh Sách Cử Tri Đủ Điều Kiện
  const voterSection = document.createElement('div');
  voterSection.className = 'mt-4 pt-2';

  const voterTitle = document.createElement('h3');
  voterTitle.className = 'small fw-bold text-uppercase text-muted mb-2';
  voterTitle.style.letterSpacing = '0.05em';
  voterTitle.textContent = 'Danh sách cử tri hợp lệ tham gia biểu quyết';
  voterSection.append(voterTitle);

  const tableWrapper = document.createElement('div');
  tableWrapper.className = 'table-responsive mb-4';
  const table = document.createElement('table');
  table.className = 'table-ledger';

  table.innerHTML = `
    <thead>
      <tr>
        <th>Họ và tên cử tri</th>
        <th>Chức danh</th>
        <th class="text-end">Tình trạng bỏ phiếu</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector('tbody');
  const voterList = ballot.eligibleVoterList || [];

  if (voterList.length === 0) {
    const emptyRow = document.createElement('tr');
    emptyRow.innerHTML = '<td colspan="3" class="text-center text-muted py-3">Không có danh sách cử tri.</td>';
    tbody.append(emptyRow);
  } else {
    for (const voter of voterList) {
      const row = document.createElement('tr');

      const nameCell = document.createElement('td');
      nameCell.className = 'fw-medium text-dark';
      nameCell.innerHTML = `${escapeHtml(voter.fullName)}${
        voter.statusLabel === 'INACTIVE' ? ' <span class="badge-ledger badge-neutral ms-1">Không hoạt động</span>' : ''
      }`;

      const roleCell = document.createElement('td');
      roleCell.className = 'small text-muted';
      roleCell.textContent = formatRole(voter.role);

      const statusCell = document.createElement('td');
      statusCell.className = 'text-end';
      if (voter.choice) {
        statusCell.innerHTML = '<span class="badge-ledger badge-success"><i class="bi bi-check2"></i> Đã bỏ phiếu</span>';
      } else {
        statusCell.innerHTML = '<span class="badge-ledger badge-neutral">Chưa bỏ phiếu</span>';
      }

      row.append(nameCell, roleCell, statusCell);
      tbody.append(row);
    }
  }

  tableWrapper.append(table);
  voterSection.append(tableWrapper);
  body.append(voterSection);

  // 5. Danh sách chưa bỏ phiếu khi hết hạn (nếu có - BR-021)
  const nonVoters = ballot.nonVoters || [];
  if (nonVoters.length > 0) {
    const nonVoterSection = document.createElement('div');
    nonVoterSection.className = 'mt-3 p-3 rounded-1 border';
    nonVoterSection.style.background = 'var(--color-surface-subtle)';
    nonVoterSection.style.borderColor = 'var(--color-border-subtle)';

    nonVoterSection.innerHTML = `
      <div class="fw-bold small text-danger mb-2">
        <i class="bi bi-exclamation-circle-fill me-1"></i>Cử tri chưa hoàn thành bỏ phiếu khi đề xuất hết hạn (BR-021):
      </div>
      <ul class="mb-0 ps-3 small text-muted">
        ${nonVoters
          .map(
            (v) =>
              `<li>${escapeHtml(v.fullName)}${
                v.statusLabel === 'INACTIVE' ? ' <span class="badge-ledger badge-neutral ms-1">Không hoạt động</span>' : ''
              }</li>`,
          )
          .join('')}
      </ul>
    `;
    body.append(nonVoterSection);
  }

  sheet.append(body);
  content.replaceChildren(sheet);
}

async function castVote(button, choice) {
  button.disabled = true;
  const original = button.innerHTML;
  button.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Đang gửi...';

  try {
    ballot = await window.ClubApi.request(
      `/ballots/${encodeURIComponent(proposalId)}/votes`,
      { method: 'POST', body: JSON.stringify({ choice }) },
    );
    renderBallot();
  } catch (error) {
    showError(error.message);
    button.disabled = false;
    button.innerHTML = original;
  }
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
    CANCELLED: '<span class="badge-ledger badge-neutral"><i class="bi bi-slash-circle"></i> Đã hủy do chưa đủ phiếu</span>',
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
