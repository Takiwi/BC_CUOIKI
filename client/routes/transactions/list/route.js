const list = document.querySelector('#transaction-list');
const form = document.querySelector('#transaction-form');
const select = document.querySelector('#proposal-id');
const createPanel = document.querySelector('#create-panel');
const message = document.querySelector('#page-message');
const user = window.ClubApi.getUser();
const canExecute = ['TREASURER', 'BOARD'].includes(user?.role);

if (window.ClubApi.requireAuth(['TREASURER', 'BOARD', 'PRESIDENT'])) {
  if (!canExecute) createPanel.classList.add('d-none');
  loadPage();
} else {
  list.replaceChildren();
  createPanel.classList.add('d-none');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.querySelector('#create-button');
  button.disabled = true;
  try {
    await window.ClubApi.request(
      `/funds/proposals/${encodeURIComponent(select.value)}/transactions`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          amount: document.querySelector('#amount').value.trim(),
          note: document.querySelector('#note').value.trim(),
        }),
      },
    );
    showMessage('Đã tạo giao dịch chờ xử lý; số dư ngân quỹ chưa thay đổi.', 'success');
    form.reset();
    await loadPage();
  } catch (error) {
    showMessage(error.message, 'danger');
  } finally {
    button.disabled = false;
  }
});

async function loadPage() {
  try {
    const requests = [window.ClubApi.request('/funds/transactions')];
    if (canExecute) {
      requests.push(window.ClubApi.request('/funds/proposals?status=APPROVED'));
    }
    const results = await Promise.all(requests);
    renderTransactions(results[0]);
    if (canExecute) renderProposals(results[1]);
  } catch (error) {
    showMessage(error.message, 'danger');
    list.replaceChildren();
  }
}

function renderProposals(proposals) {
  select.replaceChildren(new Option('Chọn đề xuất đã duyệt', ''));
  for (const proposal of proposals) {
    const option = new Option(
      `${proposal.purpose} · ${window.ClubApi.formatMoney(proposal.amount)}`,
      proposal.id,
    );
    select.append(option);
  }
  if (proposals.length === 0) {
    select.replaceChildren(new Option('Không có đề xuất nào đã duyệt', ''));
  }
}

function renderTransactions(transactions) {
  if (transactions.length === 0) {
    const emptyRow = document.createElement('tr');
    const emptyCell = document.createElement('td');
    emptyCell.colSpan = 7;
    emptyCell.className = 'text-center text-muted py-4';
    emptyCell.innerHTML = `
      <div class="small fw-semibold">Chưa có giao dịch nào được ghi nhận</div>
      <div class="small text-muted">Các giao dịch phát sinh từ đề xuất sẽ xuất hiện tại đây.</div>
    `;
    emptyRow.append(emptyCell);
    list.replaceChildren(emptyRow);
    return;
  }
  list.replaceChildren(...transactions.map(renderTransaction));
}

function renderTransaction(transaction) {
  const row = document.createElement('tr');

  // Cột 1: Đề xuất & Mục đích
  const purposeCell = document.createElement('td');
  purposeCell.innerHTML = `
    <div class="fw-medium text-dark">${escapeHtml(transaction.proposalPurpose || 'Rút quỹ dự phòng')}</div>
    <div class="small text-muted">${escapeHtml(transaction.note || 'Không có ghi chú')}</div>
  `;
  row.append(purposeCell);

  // Cột 2: Mức duyệt
  const reqCell = document.createElement('td');
  reqCell.className = 'text-end num-tabular text-secondary';
  reqCell.textContent = window.ClubApi.formatMoney(transaction.requestedAmount);
  row.append(reqCell);

  // Cột 3: Chi thực tế (màu mực chính, dấu trừ toán học −)
  const actCell = document.createElement('td');
  actCell.className = 'text-end num-tabular fw-bold text-dark';
  actCell.textContent = transaction.amount == null ? '—' : ('− ' + window.ClubApi.formatMoney(transaction.amount));
  row.append(actCell);

  // Cột 4: Trạng thái (100% Tiếng Việt)
  const statusCell = document.createElement('td');
  statusCell.innerHTML = renderStatusBadge(transaction.status);
  row.append(statusCell);

  // Cột 5: Chi vượt mức (100% Tiếng Việt)
  const overageCell = document.createElement('td');
  overageCell.innerHTML = renderOverageBadge(transaction.overageStatus);
  row.append(overageCell);

  // Cột 6: Ghi chú / Lý do
  const reasonCell = document.createElement('td');
  reasonCell.className = 'small text-muted';
  reasonCell.textContent = transaction.rejectionReason || transaction.overageDecisionReason || '—';
  row.append(reasonCell);

  // Cột 7: Thao tác
  const actionsCell = document.createElement('td');
  actionsCell.className = 'text-end';

  if (canExecute && transaction.status === 'PENDING') {
    if (transaction.overageStatus === 'PENDING' && user.role === 'BOARD') {
      addButton(actionsCell, 'Duyệt chi vượt', 'btn-ledger-primary', () =>
        decideOverage(transaction.id, 'APPROVED'),
      );
      addButton(actionsCell, 'Từ chối chi vượt', 'btn-ledger-outline text-danger', () =>
        decideOverage(transaction.id, 'REJECTED'),
      );
    } else if (transaction.overageStatus !== 'PENDING') {
      addButton(actionsCell, 'Hoàn tất giải ngân', 'btn-ledger-primary', () =>
        completeTransaction(transaction.id),
      );
      addButton(actionsCell, 'Từ chối', 'btn-ledger-outline text-danger', () =>
        rejectTransaction(transaction.id),
      );
    }
  }
  row.append(actionsCell);

  return row;
}

function renderStatusBadge(status) {
  const map = {
    PENDING: '<span class="badge-ledger badge-warning"><i class="bi bi-clock-fill"></i> Chờ xử lý</span>',
    COMPLETED: '<span class="badge-ledger badge-success"><i class="bi bi-check-circle-fill"></i> Hoàn thành</span>',
    REJECTED: '<span class="badge-ledger badge-danger"><i class="bi bi-x-circle-fill"></i> Bị từ chối</span>',
    CANCELLED: '<span class="badge-ledger badge-neutral"><i class="bi bi-slash-circle"></i> Đã hủy</span>',
  };
  return map[status] || `<span class="badge-ledger badge-neutral">${escapeHtml(status)}</span>`;
}

function renderOverageBadge(overageStatus) {
  const map = {
    NONE: '<span class="text-muted small">Không vượt mức</span>',
    PENDING: '<span class="badge-ledger badge-info"><i class="bi bi-shield-lock-fill"></i> Chờ BCN duyệt</span>',
    APPROVED: '<span class="badge-ledger badge-success"><i class="bi bi-check2"></i> Duyệt chi vượt</span>',
    REJECTED: '<span class="badge-ledger badge-danger"><i class="bi bi-receipt"></i> Từ chối <span class="text-nowrap">(Ghi nhận nợ)</span></span>',
  };
  return map[overageStatus] || '<span class="text-muted small">—</span>';
}

function addButton(container, label, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `btn-ledger ${className} btn-sm me-1 mb-1`;
  button.textContent = label;
  button.addEventListener('click', onClick);
  container.append(button);
}

async function completeTransaction(id) {
  if (!window.confirm('Xác nhận hoàn tất giải ngân cho giao dịch này? Số dư ngân quỹ sẽ được khấu trừ.')) return;
  try {
    await window.ClubApi.request(`/funds/transactions/${encodeURIComponent(id)}/complete`, {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
    showMessage('Đã hoàn tất giải ngân giao dịch thành công.', 'success');
    await loadPage();
  } catch (error) {
    showMessage(error.message, 'danger');
  }
}

async function rejectTransaction(id) {
  const reason = window.prompt('Nhập lý do từ chối giao dịch:');
  if (!reason?.trim()) return;
  try {
    await window.ClubApi.request(`/funds/transactions/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason: reason.trim() }),
    });
    showMessage('Đã từ chối giao dịch.', 'success');
    await loadPage();
  } catch (error) {
    showMessage(error.message, 'danger');
  }
}

async function decideOverage(id, decision) {
  const promptText = decision === 'APPROVED' ? 'Ghi chú phê duyệt chi vượt (tùy chọn):' : 'Lý do từ chối chi vượt:';
  const reason = window.prompt(promptText);
  if (decision === 'REJECTED' && !reason?.trim()) return;
  try {
    await window.ClubApi.request(`/funds/transactions/${encodeURIComponent(id)}/overage-decision`, {
      method: 'POST',
      body: JSON.stringify({ decision, reason: (reason || '').trim() }),
    });
    showMessage(`Đã xử lý chi vượt: ${decision === 'APPROVED' ? 'Đã duyệt' : 'Từ chối và ghi nợ'}.`, 'success');
    await loadPage();
  } catch (error) {
    showMessage(error.message, 'danger');
  }
}

function showMessage(text, type = 'danger') {
  message.className = `alert alert-${type}`;
  message.textContent = text;
  message.classList.remove('d-none');
}

function escapeHtml(str) {
  return str
    ? str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    : '';
}
