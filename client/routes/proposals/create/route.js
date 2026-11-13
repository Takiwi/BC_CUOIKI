const form = document.querySelector('#proposal-form');
const eventSelect = document.querySelector('#eventId');
const message = document.querySelector('#form-message');
const button = document.querySelector('#submit-button');

if (!window.ClubApi.requireAuth(['MEMBER', 'PRESIDENT', 'TREASURER', 'ADMIN'])) {
  form.hidden = true;
} else {
  loadEvents();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  button.disabled = true;
  button.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Đang khởi tạo...';
  message.className = 'alert d-none';
  try {
    const body = {
      purpose: document.querySelector('#purpose').value.trim(),
      amount: document.querySelector('#amount').value.trim(),
      note: document.querySelector('#note').value.trim() || undefined,
      ...(eventSelect.value ? { eventId: eventSelect.value } : {}),
    };
    const proposal = await window.ClubApi.request('/funds/proposals', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    window.location.href = `../detail/index.html?id=${encodeURIComponent(proposal.id)}`;
  } catch (error) {
    message.className = 'alert alert-danger';
    message.textContent = error.message;
    message.classList.remove('d-none');
  } finally {
    button.disabled = false;
    button.innerHTML = '<i class="bi bi-check2-circle me-1"></i> Tạo và mở hòm phiếu biểu quyết';
  }
});

async function loadEvents() {
  try {
    const events = await window.ClubApi.request('/events');
    for (const event of events) {
      const option = document.createElement('option');
      option.value = event.id;
      option.textContent = `${event.name} · ${formatEventStatus(event.status)}`;
      eventSelect.append(option);
    }
  } catch (error) {
    message.className = 'alert alert-warning';
    message.textContent = `Không tải được danh sách sự kiện: ${error.message}`;
    message.classList.remove('d-none');
  }
}

function formatEventStatus(status) {
  const map = {
    DRAFT: 'Dự thảo',
    UPCOMING: 'Sắp diễn ra',
    OPEN: 'Mở đăng ký',
    IN_PROGRESS: 'Đang diễn ra',
    COMPLETED: 'Đã kết thúc',
    CANCELLED: 'Đã hủy',
  };
  return map[status] || status;
}
