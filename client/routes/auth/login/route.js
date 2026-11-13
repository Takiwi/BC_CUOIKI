// If already logged in with a valid session, automatically redirect to role page
if (window.ClubApi?.isAuthenticated?.()) {
  const user = window.ClubApi.getUser();
  if (user) {
    if (user.role === 'ADMIN') {
      window.location.replace('/routes/admin/dashboard/index.html');
    } else if (user.role === 'PRESIDENT') {
      window.location.replace('/routes/members/approvals/index.html');
    } else if (['BOARD', 'TREASURER'].includes(user.role)) {
      window.location.replace('/routes/members/list/index.html');
    } else {
      window.location.replace('/routes/members/profile/index.html');
    }
  }
} else {
  // Purge any stale, expired, or invalid session data
  window.ClubApi?.clearSession?.();
}

const form = document.querySelector('#login-form');
const message = document.querySelector('#form-message');
const submitButton = document.querySelector('#submit-button');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.className = 'alert auth-alert d-none';
  message.textContent = '';
  submitButton.disabled = true;
  submitButton.textContent = 'Đang đăng nhập...';

  const formData = new FormData(form);
  try {
    // Ensure clean storage before storing new session
    window.ClubApi.clearSession();

    const session = await window.ClubApi.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: formData.get('email'),
        password: formData.get('password'),
      }),
    });
    window.ClubApi.saveSession(session);
    message.className = 'alert alert-success auth-alert';
    message.classList.remove('d-none');
    message.textContent = `Đăng nhập thành công. Đang chuyển hướng...`;

    setTimeout(() => {
      if (session.member.role === 'ADMIN') {
        window.location.href = '/routes/admin/dashboard/index.html';
      } else if (session.member.role === 'PRESIDENT') {
        window.location.href = '/routes/members/approvals/index.html';
      } else if (['BOARD', 'TREASURER'].includes(session.member.role)) {
        window.location.href = '/routes/members/list/index.html';
      } else {
        window.location.href = '/routes/members/profile/index.html';
      }
    }, 800);
  } catch (error) {
    message.className = 'alert alert-danger auth-alert';
    message.classList.remove('d-none');
    message.textContent = error.message;
    submitButton.disabled = false;
    submitButton.textContent = 'Đăng nhập';
  }
});
