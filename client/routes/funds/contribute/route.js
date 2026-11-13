const form = document.querySelector('#contribution-form');
const amountInput = document.querySelector('#amount');
const submitButton = document.querySelector('#submit-button');
const message = document.querySelector('#page-message');
const confirmation = document.querySelector('#confirmation');
const details = document.querySelector('#confirmation-details');

// Xử lý các nút chọn nhanh số tiền
document.querySelectorAll('.preset-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const val = btn.getAttribute('data-value');
    if (val) {
      amountInput.value = val;
      amountInput.focus();
    }
  });
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.className = 'alert d-none';
  confirmation.classList.add('d-none');
  if (!form.reportValidity()) return;

  submitButton.disabled = true;
  submitButton.innerHTML =
    '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Đang ghi nhận đóng góp...';
  try {
    const contribution = await window.ClubApi.request(
      '/funds/contributions',
      {
        method: 'POST',
        body: JSON.stringify({ amount: amountInput.value.trim() }),
      },
    );
    const values = [
      ['Tổng số tiền đóng góp', contribution.amount, 'text-success fw-bold'],
      ['Phân bổ vào Quỹ chính', contribution.mainAllocated, 'text-dark'],
      ['Phân bổ vào Quỹ dự phòng', contribution.reserveAllocated, 'text-secondary'],
      ['Số dư Quỹ chính sau đóng góp', contribution.balances?.mainFund, 'text-dark fw-bold'],
      ['Số dư Quỹ dự phòng sau đóng góp', contribution.balances?.reserveFund, 'text-secondary fw-bold'],
    ];
    details.replaceChildren(
      ...values.flatMap(([label, amount, colorClass]) => {
        const term = document.createElement('dt');
        term.className = 'col-sm-7 text-secondary fw-normal border-bottom py-2';
        term.textContent = label;

        const value = document.createElement('dd');
        value.className = `col-sm-5 text-sm-end num-tabular border-bottom py-2 mb-0 ${colorClass || ''}`;
        value.textContent = window.ClubApi.formatMoney(amount || 0);

        return [term, value];
      }),
    );
    confirmation.classList.remove('d-none');
    amountInput.value = '';
    message.className = 'alert alert-success';
    message.textContent = 'Giao dịch đóng góp đã được hệ thống ghi nhận thành công.';
  } catch (error) {
    message.className = 'alert alert-danger';
    message.textContent = error.message;
  } finally {
    message.classList.remove('d-none');
    submitButton.disabled = false;
    submitButton.innerHTML = '<i class="bi bi-check-lg me-1"></i>Xác nhận đóng góp vào quỹ';
  }
});
