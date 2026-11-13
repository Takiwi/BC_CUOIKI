const list = document.querySelector('#events-list');
const message = document.querySelector('#page-message');
const currentUser = window.ClubApi.getUser();
const canManage = ['PRESIDENT', 'BOARD'].includes(currentUser?.role);

if (!window.ClubApi.requireAuth()) {
  list.replaceChildren();
} else {
  const createButton = document.querySelector('#create-event');
  if (canManage && createButton) {
    createButton.classList.remove('d-none');
  }
  loadEvents();
}

async function loadEvents() {
  try {
    const events = await window.ClubApi.request('/events');
    if (!events || !events.length) {
      list.innerHTML =
        '<tr><td class="text-muted p-5 text-center" colspan="6"><i class="bi bi-calendar-x fs-3 d-block mb-2"></i>Chưa có sự kiện nào trong hệ thống.</td></tr>';
      return;
    }

    list.replaceChildren(
      ...events.map((event) => {
        const row = document.createElement('tr');
        
        // Event Name
        const nameCell = document.createElement('td');
        nameCell.innerHTML = `<a href="../detail/index.html?id=${encodeURIComponent(event.id)}" class="fw-semibold text-decoration-none text-ink hover-underline">${event.name}</a>`;
        row.append(nameCell);

        // Date range
        const dateCell = document.createElement('td');
        dateCell.className = 'font-monospace small text-nowrap';
        dateCell.textContent = formatDateRange(event.startDate, event.endDate);
        row.append(dateCell);

        // Location
        const locCell = document.createElement('td');
        locCell.innerHTML = `<span class="text-truncate d-inline-block" style="max-width: 220px;" title="${event.location}">${event.location}</span>`;
        row.append(locCell);

        // Participants
        const partCell = document.createElement('td');
        partCell.className = 'text-center font-monospace';
        const limitText = event.maxParticipants ? event.maxParticipants : 'Không giới hạn';
        partCell.innerHTML = `<span class="fw-semibold">${event.participantCount}</span> <span class="text-muted small">/ ${limitText}</span>`;
        row.append(partCell);

        // Status badge
        const statusCell = document.createElement('td');
        const badge = document.createElement('span');
        badge.className = `badge-ledger text-nowrap ${statusClass(event.status)}`;
        badge.textContent = statusLabel(event.status);
        statusCell.append(badge);
        row.append(statusCell);

        // Actions
        const actionCell = document.createElement('td');
        actionCell.className = 'text-end text-nowrap';
        const detail = document.createElement('a');
        detail.className = 'btn-ledger btn-ledger-secondary btn-sm';
        detail.href = `../detail/index.html?id=${encodeURIComponent(event.id)}`;
        detail.textContent = 'Chi tiết';
        actionCell.append(detail);
        row.append(actionCell);

        return row;
      }),
    );
  } catch (error) {
    message.className = 'alert alert-danger';
    message.textContent = error.message;
    message.classList.remove('d-none');
    list.replaceChildren();
  }
}

function formatDateRange(start, end) {
  const date = (value) =>
    new Intl.DateTimeFormat('vi-VN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  return `${date(start)} – ${date(end)}`;
}

function statusLabel(status) {
  return {
    UPCOMING: 'Sắp diễn ra',
    ONGOING: 'Đang diễn ra',
    ENDED: 'Đã kết thúc',
  }[status] || status;
}

function statusClass(status) {
  return {
    UPCOMING: 'badge-primary',
    ONGOING: 'badge-success',
    ENDED: 'badge-neutral',
  }[status] || 'badge-neutral';
}
