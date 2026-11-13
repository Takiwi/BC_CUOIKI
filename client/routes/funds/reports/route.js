const loading = document.querySelector('#report-loading');
const content = document.querySelector('#report-content');
const valuesList = document.querySelector('#report-values');
const eventExpenses = document.querySelector('#event-expenses');
const eventExpenseList = document.querySelector('#event-expense-list');
const message = document.querySelector('#page-message');
const chartSection = document.querySelector('#chart-section');
const cashflowChartBars = document.querySelector('#cashflow-chart-bars');
const cashflowNetGrowth = document.querySelector('#cashflow-net-growth');
const eventExpenseBars = document.querySelector('#event-expense-bars');

const allowedRoles = ['MEMBER', 'BOARD', 'TREASURER', 'PRESIDENT'];

if (window.ClubApi.requireAuth(allowedRoles)) {
  loadReport();
}

async function loadReport() {
  try {
    const [report, transactions] = await Promise.all([
      window.ClubApi.request('/funds/reports'),
      window.ClubApi.request('/funds/transactions').catch(() => []),
    ]);

    // 1. Render Bảng chỉ số đối soát tổng hợp
    const values = [
      ['Tổng thu thực tế', report.totalIncome, 'text-success'],
      ['Tổng chi thực tế', report.totalExpense, 'text-dark'],
      ['Số dư hiện tại', report.balance, 'text-primary'],
      ['Quỹ chính khả dụng', report.mainFund, 'text-dark'],
      ['Quỹ dự phòng khóa', report.reserveFund, 'text-secondary'],
      ['Ngưỡng an toàn dự phòng', report.reserveThreshold, 'text-muted'],
    ];

    valuesList.replaceChildren(
      ...values.flatMap(([label, amount, colorClass]) => {
        const term = document.createElement('dt');
        term.className = 'col-sm-7 text-secondary fw-normal border-bottom py-2';
        term.textContent = label;

        const value = document.createElement('dd');
        value.className = `col-sm-5 text-sm-end fw-bold num-tabular border-bottom py-2 mb-0 ${colorClass}`;
        value.textContent = window.ClubApi.formatMoney(amount);

        return [term, value];
      }),
    );

    // 2. Render Biểu đồ Cột Dòng Tiền 6 Tháng Gần Nhất
    renderCashflowChart(report, transactions);

    // 3. Render Biểu đồ & Bảng chi phí sự kiện
    const expenses = report.eventExpenses || [];
    renderEventExpenseCharts(expenses);

    if (expenses.length) {
      eventExpenseList.replaceChildren(
        ...expenses.map((expense) => {
          const row = document.createElement('tr');

          const nameCell = document.createElement('td');
          nameCell.className = 'fw-medium';
          nameCell.textContent = expense.eventName;

          const countCell = document.createElement('td');
          countCell.className = 'text-center num-tabular text-muted';
          countCell.textContent = String(expense.transactionCount);

          const amountCell = document.createElement('td');
          amountCell.className = 'text-end fw-bold num-tabular text-dark';
          amountCell.textContent = window.ClubApi.formatMoney(expense.totalExpense);

          row.append(nameCell, countCell, amountCell);
          return row;
        }),
      );
      eventExpenses.classList.remove('d-none');
    } else {
      eventExpenses.classList.add('d-none');
      eventExpenseList.replaceChildren();
    }

    if (chartSection) chartSection.classList.remove('d-none');
    content.classList.remove('d-none');
  } catch (error) {
    message.className = 'alert alert-danger';
    message.textContent = error.message;
    message.classList.remove('d-none');
  } finally {
    loading.classList.add('d-none');
  }
}

function renderCashflowChart(report, transactions) {
  if (!cashflowChartBars) return;

  // Tổng hợp theo 6 tháng gần nhất từ ngày hiện tại
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = `T${d.getMonth() + 1}/${d.getFullYear().toString().slice(2)}`;
    months.push({ key, label, income: 0, expense: 0 });
  }

  // Cộng dồn từ danh sách giao dịch hoàn tất
  if (Array.isArray(transactions) && transactions.length > 0) {
    for (const tx of transactions) {
      if (tx.status === 'COMPLETED' && tx.createdAt) {
        const d = new Date(tx.createdAt);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const found = months.find((m) => m.key === key);
        if (found) {
          const val = parseFloat(tx.amount || 0);
          found.expense += val;
        }
      }
    }
  }

  // Đảm bảo tháng hiện tại có phản ánh tổng thu/chi nếu chưa có đủ giao dịch chi tiết
  const totalIncomeNum = parseFloat(report.totalIncome || 0);
  const totalExpenseNum = parseFloat(report.totalExpense || 0);
  const currentMonth = months[months.length - 1];

  if (currentMonth.income === 0 && totalIncomeNum > 0) {
    currentMonth.income = totalIncomeNum;
  }
  if (currentMonth.expense === 0 && totalExpenseNum > 0) {
    currentMonth.expense = totalExpenseNum;
  }

  // Tìm giá trị max để scale độ cao cột (tối đa 120px)
  let maxVal = 1000000;
  for (const m of months) {
    if (m.income > maxVal) maxVal = m.income;
    if (m.expense > maxVal) maxVal = m.expense;
  }

  cashflowChartBars.innerHTML = months
    .map((m) => {
      const hIncome = Math.max(4, Math.round((m.income / maxVal) * 120));
      const hExpense = Math.max(4, Math.round((m.expense / maxVal) * 120));
      const titleIncome = `Thu ${m.label}: ${window.ClubApi.formatMoney(m.income)}`;
      const titleExpense = `Chi ${m.label}: ${window.ClubApi.formatMoney(m.expense)}`;

      return `
        <div class="chart-bar-group">
          <div class="chart-bars-wrap">
            <div class="chart-col-income" style="height: ${hIncome}px;" title="${titleIncome}"></div>
            <div class="chart-col-expense" style="height: ${hExpense}px;" title="${titleExpense}"></div>
          </div>
          <div class="chart-axis-label">${m.label}</div>
        </div>
      `;
    })
    .join('');

  if (cashflowNetGrowth) {
    const net = totalIncomeNum - totalExpenseNum;
    cashflowNetGrowth.textContent = `Thu ròng lũy kế: ${net >= 0 ? '+' : ''}${window.ClubApi.formatMoney(net)}`;
  }
}

function renderEventExpenseCharts(expenses) {
  if (!eventExpenseBars) return;

  if (!expenses || expenses.length === 0) {
    eventExpenseBars.innerHTML = `
      <div class="text-center py-4 text-muted small">
        <i class="bi bi-info-circle me-1"></i>Chưa có chi phí sự kiện nào được hạch toán hoàn tất.
      </div>
    `;
    return;
  }

  const totalEventExpense = expenses.reduce((sum, e) => sum + parseFloat(e.totalExpense || 0), 0);
  const colors = ['var(--chart-ink)', 'var(--chart-copper)', 'var(--chart-teal)', 'var(--chart-violet)', 'var(--chart-gray)'];

  eventExpenseBars.innerHTML = expenses
    .slice(0, 5)
    .map((e, index) => {
      const val = parseFloat(e.totalExpense || 0);
      const pct = totalEventExpense > 0 ? Math.round((val / totalEventExpense) * 100) : 0;
      const color = colors[index % colors.length];

      return `
        <div class="mb-3">
          <div class="d-flex justify-content-between small mb-1">
            <span class="fw-medium text-truncate" style="max-width: 220px;">
              <span class="chart-legend-dot" style="background: ${color};"></span>${escapeHtml(e.eventName)}
            </span>
            <span class="num-tabular fw-bold">${window.ClubApi.formatMoney(val)} <span class="text-nowrap text-muted">(${pct}%)</span></span>
          </div>
          <div class="horiz-bar-track">
            <div style="width: ${pct}%; background: ${color};"></div>
          </div>
        </div>
      `;
    })
    .join('');
}

function escapeHtml(str) {
  return str
    ? str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    : '';
}
