const loading = document.querySelector('#funds-loading');
const cards = document.querySelector('#fund-cards');
const message = document.querySelector('#page-message');

if (
  window.ClubApi.requireAuth([
    'MEMBER',
    'BOARD',
    'TREASURER',
    'PRESIDENT',
  ])
) {
  loadFunds();
}

async function loadFunds() {
  try {
    const funds = await window.ClubApi.request('/funds');
    const items = [
      {
        label: 'Quỹ chính khả dụng',
        amount: funds.mainFund,
        icon: 'bi-wallet2',
        badge: '<span class="badge-ledger badge-success"><i class="bi bi-check-circle-fill"></i> Sẵn sàng chi</span>',
        desc: 'Số dư khả dụng phục vụ trực tiếp các hoạt động và sự kiện thường xuyên của câu lạc bộ.',
        isHero: true,
      },
      {
        label: 'Quỹ dự phòng khóa',
        amount: funds.reserveFund,
        icon: 'bi-shield-lock',
        badge: '<span class="badge-ledger badge-info"><i class="bi bi-lock-fill"></i> Cần BCN duyệt</span>',
        desc: 'Nguồn vốn dự trữ ứng phó tình huống khẩn cấp, cần phê duyệt của Ban chủ nhiệm.',
        isHero: false,
      },
      {
        label: 'Tổng ngân quỹ hiện có',
        amount: funds.totalFund,
        icon: 'bi-cash-stack',
        badge: '<span class="badge-ledger badge-neutral"><i class="bi bi-layers"></i> Tổng tài sản</span>',
        desc: 'Toàn bộ tổng tài sản lưu động của câu lạc bộ được hạch toán minh bạch.',
        isHero: false,
      },
      {
        label: 'Ngưỡng an toàn quỹ dự phòng',
        amount: funds.reserveThreshold,
        icon: 'bi-speedometer2',
        badge: '<span class="badge-ledger badge-warning"><i class="bi bi-shield-check"></i> Mức tối thiểu</span>',
        desc: 'Mức trích lập mục tiêu tối thiểu quy định theo quy chế quản lý tài chính.',
        isHero: false,
      },
    ];

    cards.replaceChildren(
      ...items.map((item) => {
        const column = document.createElement('div');
        column.className = 'col-12 col-md-6';
        const card = document.createElement('article');
        card.className = 'ledger-sheet h-100 mb-0';

        card.innerHTML = `
          <div class="ledger-header">
            <h2 class="ledger-title d-flex align-items-center gap-2">
              <i class="bi ${item.icon}"></i>
              <span>${item.label}</span>
            </h2>
            ${item.badge}
          </div>
          <div class="ledger-body">
            <div class="${item.isHero ? 'display-6' : 'h3'} fw-bold text-dark mb-2 num-tabular">
              ${window.ClubApi.formatMoney(item.amount)}
            </div>
            <p class="small text-muted mb-0">${item.desc}</p>
          </div>
        `;

        column.append(card);
        return column;
      }),
    );
    cards.classList.remove('d-none');
  } catch (error) {
    message.className = 'alert alert-danger';
    message.textContent = error.message;
    message.classList.remove('d-none');
  } finally {
    loading.classList.add('d-none');
  }
}
