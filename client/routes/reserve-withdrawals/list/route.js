const list = document.querySelector('#request-list');
const form = document.querySelector('#reserve-form');
const message = document.querySelector('#page-message');
const user = window.ClubApi.getUser();
const isBoard = user?.role === 'BOARD';
const isTreasurer = user?.role === 'TREASURER';

if (window.ClubApi.requireAuth(['TREASURER', 'BOARD'])) {
  if (!isTreasurer) form.closest('section').classList.add('d-none');
  loadRequests();
} else {
  list.replaceChildren();
  form.closest('section').classList.add('d-none');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.querySelector('#create-button');
  button.disabled = true;
  try {
    await window.ClubApi.request('/funds/withdraw-reserve', {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        amount: document.querySelector('#amount').value.trim(),
        reason: document.querySelector('#reason').value.trim(),
      }),
    });
    showMessage('Đã gửi yêu cầu rút quỹ dự phòng; số dư quỹ chưa thay đổi cho đến khi được duyệt.', 'success');
    form.reset();
    await loadRequests();
  } catch (error) {
    showMessage(error.message, 'danger');
  } finally {
    button.disabled = false;
  }
});

async function loadRequests() {
  try {
    const requests = await window.ClubApi.request('/funds/reserve-withdrawals');
    if (!requests.length) {
      const emptyRow = document.createElement('tr');
      const emptyCell = document.createElement('td');
      emptyCell.colSpan = 6;
      emptyCell.className = 'text-center text-muted py-4';
      emptyCell.innerHTML = `
        <div class="small fw-semibold">Chưa có yêu cầu rút quỹ dự phòng nào</div>
        <div class="small text-muted">Các yêu cầu từ Thủ quỹ sẽ hiển thị tại đây để Ban chủ nhiệm xem xét.</div>
      `;
      emptyRow.append(emptyCell);
      list.replaceChildren(emptyRow);
      return;
    }
    list.replaceChildren(...requests.map(renderRequest));
  } catch (error) {
    showMessage(error.message, 'danger');
    list.replaceChildren();
  }
}

function renderRequest(item) {
  const row = document.createElement('tr');

  // Cột 1: Số tiền
  const amountCell = document.createElement('td');
  amountCell.className = 'text-end fw-bold num-tabular text-dark';
  amountCell.textContent = window.ClubApi.formatMoney(item.amount);
  row.append(amountCell);

  // Cột 2: Lý do
  const reasonCell = document.createElement('td');
  reasonCell.className = 'fw-medium text-dark';
  reasonCell.textContent = item.reason;
  row.append(reasonCell);

  // Cột 3: Người đề xuất
  const requesterCell = document.createElement('td');
  requesterCell.className = 'small text-secondary';
  requesterCell.innerHTML = `${escapeHtml(item.requesterName)}${
    item.requesterStatusLabel === 'INACTIVE' ? ' <span class="badge-ledger badge-neutral ms-1">Không hoạt động</span>' : ''
  }`;
  row.append(requesterCell);

  // Cột 4: Trạng thái (100% Tiếng Việt)
  const statusCell = document.createElement('td');
  statusCell.innerHTML = renderReserveStatusBadge(item.status);
  row.append(statusCell);

  // Cột 5: Quyết định của BCN
  const decisionCell = document.createElement('td');
  decisionCell.className = 'small text-muted';
  const decisionText = item.decisionReason
    ? `${escapeHtml(item.deciderName || 'Ban chủ nhiệm')}: ${escapeHtml(item.decisionReason)}`
    : item.deciderName
      ? `Ban chủ nhiệm: ${renderReserveStatusText(item.status)}`
      : '—';
  decisionCell.innerHTML = decisionText;
  row.append(decisionCell);

  // Cột 6: Thao tác
  const actionsCell = document.createElement('td');
  actionsCell.className = 'text-end';
  if (isBoard && item.status === 'PENDING') {
    addButton(actionsCell, 'Duyệt', 'btn-ledger-primary', () => decide(item, 'APPROVED'));
    addButton(actionsCell, 'Từ chối', 'btn-ledger-outline text-danger', () =>
      decide(item, 'REJECTED'),
    );
  }
  if (
    ['TREASURER', 'BOARD'].includes(user?.role) &&
    item.status === 'APPROVED'
  ) {
    addButton(actionsCell, 'Giải ngân', 'btn-ledger-primary', () => complete(item));
  }
  row.append(actionsCell);

  return row;
}

function renderReserveStatusBadge(status) {
  const map = {
    PENDING: '<span class="badge-ledger badge-warning"><i class="bi bi-clock-fill"></i> Chờ BCN duyệt</span>',
    APPROVED: '<span class="badge-ledger badge-success"><i class="bi bi-check-circle-fill"></i> Đã duyệt</span>',
    REJECTED: '<span class="badge-ledger badge-danger"><i class="bi bi-x-circle-fill"></i> Bị từ chối</span>',
    COMPLETED: '<span class="badge-ledger badge-neutral"><i class="bi bi-check2"></i> Đã giải ngân</span>',
  };
  return map[status] || `<span class="badge-ledger badge-neutral">${escapeHtml(status)}</span>`;
}

function renderReserveStatusText(status) {
  const map = {
    PENDING: 'Chờ duyệt',
    APPROVED: 'Đã duyệt',
    REJECTED: 'Từ chối',
    COMPLETED: 'Đã giải ngân',
  };
  return map[status] || status;
}

function addButton(container, label, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `btn-ledger ${className} btn-sm me-1 mb-1`;
  button.textContent = label;
  button.addEventListener('click', onClick);
  container.append(button);
}

async function decide(item, decision) {
  const promptText = decision === 'REJECTED'
    ? 'Nhập lý do từ chối sử dụng quỹ dự phòng:'
    : 'Ghi chú phê duyệt (không bắt buộc):';
  const reason = window.prompt(promptText) || '';
  if (decision === 'REJECTED' && !reason.trim()) return;

  await perform(
    `/funds/reserve-withdrawals/${encodeURIComponent(item.id)}/decision`,
    { decision, reason: reason.trim() },
    `Đã ${decision === 'APPROVED' ? 'phê duyệt' : 'từ chối'} yêu cầu rút quỹ dự phòng.`,
  );
}

async function complete(item) {
  if (!window.confirm(`Xác nhận thực hiện giải ngân số tiền ${window.ClubApi.formatMoney(item.amount)} từ quỹ dự phòng?`)) {
    return;
  }
  await perform(
    `/funds/reserve-withdrawals/${encodeURIComponent(item.id)}/complete`,
    {},
    'Đã thực hiện giải ngân từ quỹ dự phòng thành công.',
  );
}

async function perform(url, body, successMessage) {
  try {
    await window.ClubApi.request(url, {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify(body),
    });
    showMessage(successMessage, 'success');
    await loadRequests();
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
