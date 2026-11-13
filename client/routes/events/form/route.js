const form = document.querySelector('#event-form');
const message = document.querySelector('#form-message');
const button = document.querySelector('#submit-button');
const eventId = new URLSearchParams(window.location.search).get('id');
const user = window.ClubApi.getUser();

if (!window.ClubApi.requireAuth(['PRESIDENT', 'BOARD'])) {
  form.hidden = true;
} else if (eventId) {
  document.querySelector('#form-title').textContent = 'Sửa sự kiện';
  loadEvent();
}

async function loadEvent() {
  try {
    const event = await window.ClubApi.request(
      `/events/${encodeURIComponent(eventId)}`,
    );
    form.elements.name.value = event.name;
    form.elements.startDate.value = toLocalInputValue(event.startDate);
    form.elements.endDate.value = toLocalInputValue(event.endDate);
    form.elements.location.value = event.location;
    form.elements.maxParticipants.value = event.maxParticipants ?? '';
  } catch (error) {
    showError(error.message);
    form.hidden = true;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.className = 'alert event-alert';
  message.textContent = '';

  if (!form.reportValidity()) {
    return;
  }

  const start = new Date(form.elements.startDate.value);
  const end = new Date(form.elements.endDate.value);
  if (!(start < end)) {
    showError('Thời gian bắt đầu phải trước thời gian kết thúc.');
    return;
  }

  const maxValue = form.elements.maxParticipants.value.trim();
  const body = {
    name: form.elements.name.value.trim(),
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    location: form.elements.location.value.trim(),
    maxParticipants: maxValue ? Number(maxValue) : null,
  };

  button.disabled = true;
  button.textContent = 'Đang lưu...';
  try {
    const path = eventId
      ? `/events/${encodeURIComponent(eventId)}`
      : '/events';
    const saved = await window.ClubApi.request(path, {
      method: eventId ? 'PATCH' : 'POST',
      body: JSON.stringify(body),
    });
    window.location.href = `../detail/index.html?id=${encodeURIComponent(saved.id)}`;
  } catch (error) {
    showError(error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Lưu sự kiện';
  }
});

function toLocalInputValue(value) {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function showError(text) {
  message.className = 'alert alert-danger event-alert';
  message.textContent = text;
}
