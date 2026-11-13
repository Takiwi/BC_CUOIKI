const eventId = new URLSearchParams(window.location.search).get('id');
const content = document.querySelector('#event-content');
const message = document.querySelector('#page-message');
const user = window.ClubApi.getUser();
const canManage = ['PRESIDENT', 'BOARD'].includes(user?.role);

if (!window.ClubApi.requireAuth()) {
  content.replaceChildren();
} else if (!eventId) {
  showError('Thiếu mã định danh sự kiện.');
} else {
  loadEvent();
}

async function loadEvent() {
  try {
    const event = await window.ClubApi.request(
      `/events/${encodeURIComponent(eventId)}`,
    );
    let registered = false;
    if (user?.role === 'MEMBER') {
      const ownRegistration = await window.ClubApi.request(
        `/events/${encodeURIComponent(eventId)}/registrations/me`,
      );
      registered = ownRegistration?.status === 'ACTIVE';
    }
    renderEvent(event, registered);
  } catch (error) {
    showError(error.message);
    content.replaceChildren();
  }
}

function renderEvent(event, registered) {
  const wrapper = document.createElement('div');
  wrapper.className = 'p-4 p-md-5';

  const header = document.createElement('div');
  header.className =
    'd-flex flex-column flex-md-row justify-content-between align-items-start gap-3 mb-4 pb-3 border-bottom';
  const titleBlock = document.createElement('div');
  const eyebrow = document.createElement('span');
  eyebrow.className = 'code-tag mb-1';
  eyebrow.textContent = 'CHI TIẾT HOẠT ĐỘNG';
  const title = document.createElement('h1');
  title.className = 'h3 fw-bold mb-0 text-ink';
  title.textContent = event.name;
  titleBlock.append(eyebrow, title);

  const status = document.createElement('span');
  status.className = `badge-ledger text-nowrap ${statusClass(event.status)}`;
  status.textContent = statusLabel(event.status);
  header.append(titleBlock, status);
  wrapper.append(header);

  const grid = document.createElement('div');
  grid.className = 'row g-3 mb-4';
  const start = document.createElement('div');
  start.className = 'col-md-6';
  start.append(statBlock('Thời gian bắt đầu', formatDate(event.startDate), 'bi-calendar-event'));
  const end = document.createElement('div');
  end.className = 'col-md-6';
  end.append(statBlock('Thời gian kết thúc', formatDate(event.endDate), 'bi-calendar-check'));
  const location = document.createElement('div');
  location.className = 'col-md-6';
  location.append(statBlock('Địa điểm tổ chức', event.location, 'bi-geo-alt'));
  const participants = document.createElement('div');
  participants.className = 'col-md-6';
  const partText = event.maxParticipants
    ? `${event.participantCount}/${event.maxParticipants}`
    : `${event.participantCount} <span class="text-nowrap text-muted small">(Không giới hạn)</span>`;
  participants.append(
    statBlock(
      'Số lượng tham gia',
      partText,
      'bi-people',
      true,
    ),
  );
  grid.append(start, end, location, participants);
  wrapper.append(grid);

  const actions = document.createElement('div');
  actions.className = 'd-flex flex-wrap gap-2 pt-3 border-top';
  if (user?.role === 'MEMBER') {
    const registrationButton = document.createElement('button');
    registrationButton.className = registered
      ? 'btn-ledger btn-ledger-secondary'
      : 'btn-ledger btn-ledger-primary';
    registrationButton.innerHTML = registered 
      ? '<i class="bi bi-x-circle me-1"></i>Hủy đăng ký' 
      : '<i class="bi bi-check2-circle me-1"></i>Đăng ký tham gia';
    registrationButton.addEventListener('click', () =>
      updateRegistration(registrationButton, registered),
    );
    actions.append(registrationButton);
  }

  if (canManage) {
    const edit = document.createElement('a');
    edit.className = 'btn-ledger btn-ledger-secondary';
    edit.href = `../form/index.html?id=${encodeURIComponent(event.id)}`;
    edit.innerHTML = '<i class="bi bi-pencil me-1"></i>Sửa sự kiện';
    actions.append(edit);

    if (event.status === 'UPCOMING') {
      const remove = document.createElement('button');
      remove.className = 'btn-ledger btn-ledger-secondary text-danger';
      remove.innerHTML = '<i class="bi bi-trash me-1"></i>Xóa sự kiện';
      remove.addEventListener('click', async () => {
        if (!window.confirm('Bạn có chắc chắn muốn xóa sự kiện này không?')) {
          return;
        }
        remove.disabled = true;
        try {
          await window.ClubApi.request(`/events/${event.id}`, {
            method: 'DELETE',
          });
          window.location.href = '../list/index.html';
        } catch (error) {
          showError(error.message);
          remove.disabled = false;
        }
      });
      actions.append(remove);
    }
  }

  if (actions.childElementCount) {
    wrapper.append(actions);
  }
  content.replaceChildren(wrapper);
}

function statBlock(label, value, icon, isHtml = false) {
  const block = document.createElement('div');
  block.className = 'event-stat';
  const heading = document.createElement('div');
  heading.className = 'small text-muted mb-1';
  heading.innerHTML = `<i class="bi ${icon} me-1"></i>${label}`;
  const detail = document.createElement('div');
  detail.className = 'fw-semibold text-ink';
  if (isHtml) {
    detail.innerHTML = value;
  } else {
    detail.textContent = value;
  }
  block.append(heading, detail);
  return block;
}

async function updateRegistration(button, registered) {
  button.disabled = true;
  const path = registered
    ? `/events/${encodeURIComponent(eventId)}/registrations/me`
    : `/events/${encodeURIComponent(eventId)}/registrations`;
  try {
    await window.ClubApi.request(path, { method: registered ? 'DELETE' : 'POST' });
    window.location.reload();
  } catch (error) {
    showError(error.message);
    button.disabled = false;
  }
}

function showError(text) {
  message.className = 'alert alert-danger mb-3';
  message.textContent = text;
  message.classList.remove('d-none');
}

function formatDate(value) {
  return new Intl.DateTimeFormat('vi-VN', {
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function statusLabel(value) {
  return {
    UPCOMING: 'Sắp diễn ra',
    ONGOING: 'Đang diễn ra',
    ENDED: 'Đã kết thúc',
  }[value] || value;
}

function statusClass(value) {
  return {
    UPCOMING: 'badge-primary',
    ONGOING: 'badge-success',
    ENDED: 'badge-neutral',
  }[value] || 'badge-neutral';
}
