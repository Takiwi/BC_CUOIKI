// Clean up any stale or invalid session when on register page
if (!window.ClubApi?.isAuthenticated?.()) {
  window.ClubApi?.clearSession?.();
}

const form = document.querySelector('#register-form');
const message = document.querySelector('#form-message');
const submitButton = document.querySelector('#submit-button');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.className = 'alert d-none';
  message.textContent = '';
  submitButton.disabled = true;
  submitButton.textContent = 'Đang gửi đơn...';

  const formData = new FormData(form);
  const body = {
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    password: formData.get('password'),
  };
  if (formData.get('gender')) {
    body.gender = formData.get('gender');
  }
  if (formData.get('dateOfBirth')) {
    body.dateOfBirth = formData.get('dateOfBirth');
  }

  try {
    const application = await window.ClubApi.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    message.className = 'alert alert-success';
    message.textContent = 'Đã gửi đơn đăng ký thành công (Chờ xét duyệt). Tài khoản sẽ đăng nhập được sau khi Ban chủ nhiệm phê duyệt.';
    message.classList.remove('d-none');
    form.reset();
  } catch (error) {
    message.className = 'alert alert-danger';
    message.textContent = error.message;
    message.classList.remove('d-none');
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Gửi đơn đăng ký';
  }
});
