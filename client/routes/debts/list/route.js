const list = document.querySelector('#debt-list');
const message = document.querySelector('#page-message');
const user = window.ClubApi.getUser();
const canPay = ['TREASURER', 'BOARD'].includes(user?.role);

if (window.ClubApi.requireAuth()) {
  loadDebts();
} else {
  list.replaceChildren();
}

async function loadDebts() {
  try {
    const debts = await window.ClubApi.request('/funds/debts');
    if (!debts.length) {
      const empty = document.createElement('div');
      empty.className = 'ledger-state-box';
      empty.innerHTML = `
        <div class="ledger-state-icon"><i class="bi bi-inbox text-muted"></i></div>
        <div class="ledger-state-title">Không có khoản nợ nào</div>
        <p class="ledger-state-desc">Tất cả các khoản chi tiêu và công nợ trong phạm vi của bạn đều đã được thanh toán đầy đủ.</p>
      `;
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(...debts.map(renderDebt));
  } catch (error) {
    showMessage(error.message);
    list.replaceChildren();
  }
}

function renderDebt(debt) {
  const sheet = document.createElement('article');
  sheet.className = 'ledger-sheet mb-3';

  const header = document.createElement('div');
  header.className = 'ledger-header';

  const heading = document.createElement('div');
  const title = document.createElement('h2');
  title.className = 'ledger-title mb-1';
  title.textContent = debt.purpose;

  const subtitle = document.createElement('div');
  subtitle.className = 'small text-muted';
  subtitle.textContent = debt.eventName
    ? `Sự kiện: ${debt.eventName}`
    : 'Đề xuất chi chung';
  heading.append(title, subtitle);

  const badge = document.createElement('span');
  badge.className = `badge-ledger ${debt.status === 'PAID' ? 'badge-success' : 'badge-warning'}`;
  badge.innerHTML = debt.status === 'PAID'
    ? '<i class="bi bi-check-circle-fill"></i> Đã thanh toán'
    : '<i class="bi bi-clock-fill"></i> Còn nợ';

  header.append(heading, badge);
  sheet.append(header);

  const body = document.createElement('div');
  body.className = 'ledger-body';

  // Thống kê số tiền 4 cột
  const summary = document.createElement('div');
  summary.className = 'row g-3 mb-3 p-3 rounded-1 border';
  summary.style.backgroundColor = 'var(--color-surface-subtle)';
  summary.style.borderColor = 'var(--color-border-subtle)';

  for (const [label, amount, colorClass] of [
    ['Mức duyệt ban đầu', debt.approvedAmount, 'text-dark'],
    ['Tổng phải trả', debt.amountDue, 'text-dark'],
    ['Đã thanh toán', debt.amountPaid, 'text-success'],
    ['Số nợ còn lại', debt.balanceDue, debt.status === 'PAID' ? 'text-muted' : 'text-danger'],
  ]) {
    const col = document.createElement('div');
    col.className = 'col-6 col-md-3';
    const labelElement = document.createElement('div');
    labelElement.className = 'small text-muted mb-1';
    labelElement.textContent = label;
    const value = document.createElement('div');
    value.className = `fw-bold num-tabular fs-6 ${colorClass}`;
    value.textContent = window.ClubApi.formatMoney(amount);
    col.append(labelElement, value);
    summary.append(col);
  }
  body.append(summary);

  const creditor = document.createElement('p');
  creditor.className = 'small text-secondary mb-3';
  creditor.innerHTML = `<strong>Người nhận thanh toán:</strong> ${debt.creditorName}${
    debt.creditorStatusLabel === 'INACTIVE' ? ' <span class="badge-ledger badge-neutral ms-1">Không hoạt động</span>' : ''
  }`;
  body.append(creditor);

  // Form thanh toán nợ (Treasurer / Board)
  if (canPay && debt.status === 'OPEN') {
    const paymentForm = document.createElement('form');
    paymentForm.className = 'row g-2 mb-4 p-3 rounded-1 border';
    paymentForm.style.backgroundColor = 'var(--color-canvas)';
    paymentForm.style.borderColor = 'var(--color-border-subtle)';

    const amountCol = document.createElement('div');
    amountCol.className = 'col-12 col-md-4';
    const amount = document.createElement('input');
    amount.className = 'form-control form-control-sm num-tabular';
    amount.type = 'text';
    amount.inputMode = 'decimal';
    amount.placeholder = 'Số tiền trả (VNĐ)';
    amount.required = true;
    amountCol.append(amount);

    const noteCol = document.createElement('div');
    noteCol.className = 'col-12 col-md-5';
    const note = document.createElement('input');
    note.className = 'form-control form-control-sm';
    note.placeholder = 'Ghi chú chứng từ, người nhận...';
    note.maxLength = 1000;
    noteCol.append(note);

    const buttonCol = document.createElement('div');
    buttonCol.className = 'col-12 col-md-3';
    const submit = document.createElement('button');
    submit.className = 'btn-ledger btn-ledger-primary w-100 justify-content-center';
    submit.type = 'submit';
    submit.innerHTML = '<i class="bi bi-cash-stack"></i> <span>Thanh toán nợ</span>';
    buttonCol.append(submit);

    paymentForm.append(amountCol, noteCol, buttonCol);
    paymentForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      submit.disabled = true;
      try {
        await window.ClubApi.request(
          `/funds/debts/${encodeURIComponent(debt.id)}/payments`,
          {
            method: 'POST',
            body: JSON.stringify({
              amount: amount.value.trim(),
              note: note.value.trim(),
            }),
          },
        );
        showMessage('Đã ghi nhận thanh toán thành công.', 'success');
        await loadDebts();
      } catch (error) {
        showMessage(error.message, 'danger');
      } finally {
        submit.disabled = false;
      }
    });
    body.append(paymentForm);
  }

  // Lịch sử các đợt giải ngân
  const historyHeading = document.createElement('h3');
  historyHeading.className = 'small fw-bold text-uppercase text-muted mb-2';
  historyHeading.style.letterSpacing = '0.05em';
  historyHeading.textContent = 'Lịch sử các đợt giải ngân thực tế';
  body.append(historyHeading);

  const tableWrapper = document.createElement('div');
  tableWrapper.className = 'table-responsive';
  const table = document.createElement('table');
  table.className = 'table-ledger';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const label of ['Mã GD', 'Thời gian', 'Số tiền', 'Người thực hiện', 'Ghi chú']) {
    const th = document.createElement('th');
    th.textContent = label;
    if (label === 'Số tiền') th.className = 'text-end';
    headRow.append(th);
  }
  thead.append(headRow);
  table.append(thead);

  const tbody = document.createElement('tbody');
  const payments = debt.payments || [];
  if (payments.length === 0) {
    const emptyRow = document.createElement('tr');
    const emptyCell = document.createElement('td');
    emptyCell.colSpan = 5;
    emptyCell.className = 'text-muted text-center py-3';
    emptyCell.textContent = 'Chưa có đợt thanh toán nào được thực hiện.';
    emptyRow.append(emptyCell);
    tbody.append(emptyRow);
  } else {
    for (const payment of payments) {
      const row = document.createElement('tr');

      const idCell = document.createElement('td');
      idCell.innerHTML = `<span class="code-tag">${payment.id.slice(0, 8)}</span>`;

      const dateCell = document.createElement('td');
      dateCell.className = 'num-tabular text-muted small';
      dateCell.textContent = payment.paidAt
        ? new Date(payment.paidAt).toLocaleDateString('vi-VN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : '—';

      const amountCell = document.createElement('td');
      amountCell.className = 'text-end fw-bold num-tabular text-dark';
      amountCell.textContent = window.ClubApi.formatMoney(payment.amount);

      const actorCell = document.createElement('td');
      actorCell.className = 'small';
      actorCell.textContent = payment.paidByName || '—';

      const noteCell = document.createElement('td');
      noteCell.className = 'small text-muted';
      noteCell.textContent = payment.note || '—';

      row.append(idCell, dateCell, amountCell, actorCell, noteCell);
      tbody.append(row);
    }
  }
  table.append(tbody);
  tableWrapper.append(table);
  body.append(tableWrapper);

  sheet.append(body);
  return sheet;
}

function showMessage(text, type = 'danger') {
  message.className = `alert alert-${type}`;
  message.textContent = text;
  message.classList.remove('d-none');
}
