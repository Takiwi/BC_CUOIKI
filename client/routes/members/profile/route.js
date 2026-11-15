(() => {
  if (!window.ClubApi.requireAuth()) {
    return;
  }

  const currentUser = window.ClubApi.getUser();
  const alertBox = document.querySelector('#alert-box');
  const loadingSpinner = document.querySelector('#loading-spinner');
  const profileCard = document.querySelector('#profile-card');
  const form = document.querySelector('#profile-form');
  const saveBtn = document.querySelector('#save-btn');

  const emailInput = document.querySelector('#email');
  const fullNameInput = document.querySelector('#fullName');
  const genderSelect = document.querySelector('#gender');
  const dobInput = document.querySelector('#dateOfBirth');
  const roleBadge = document.querySelector('#role-badge');
  const statusBadge = document.querySelector('#status-badge');

  const leaveModalEl = document.querySelector('#leaveModal');
  const leaveModal = leaveModalEl ? new bootstrap.Modal(leaveModalEl) : null;
  const leaveBtn = document.querySelector('#leave-club-btn');
  const confirmLeaveBtn = document.querySelector('#confirm-leave-btn');

  const ROLE_MAP = {
    ADMIN: 'Quản trị viên',
    PRESIDENT: 'Chủ tịch',
    TREASURER: 'Thủ quỹ',
    BOARD: 'Ban chủ nhiệm',
    MEMBER: 'Thành viên',
  };

  let currentProfile = null;

  function showAlert(message, type = 'danger') {
    alertBox.className = `alert alert-${type}`;
    alertBox.textContent = message;
    alertBox.classList.remove('d-none');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function hideAlert() {
    alertBox.classList.add('d-none');
  }

  function setLoading(isLoading) {
    if (isLoading) {
      loadingSpinner.classList.remove('d-none');
      profileCard.classList.add('d-none');
    } else {
      loadingSpinner.classList.add('d-none');
      profileCard.classList.remove('d-none');
    }
  }

  async function loadProfile() {
    setLoading(true);
    hideAlert();
    try {
      const me = await window.ClubApi.request('/auth/me');
      currentProfile = await window.ClubApi.request(`/members/${me.id}`);

      emailInput.value = currentProfile.email || '';
      fullNameInput.value = currentProfile.fullName || '';
      genderSelect.value = currentProfile.gender || '';
      dobInput.value = currentProfile.dateOfBirth || '';

      const roleVi = ROLE_MAP[currentProfile.role] || currentProfile.role;
      roleBadge.textContent = roleVi;
      roleBadge.className =
        currentProfile.role === 'PRESIDENT'
          ? 'badge-ledger badge-warning text-nowrap'
          : currentProfile.role === 'TREASURER' || currentProfile.role === 'BOARD'
            ? 'badge-ledger badge-primary text-nowrap'
            : 'badge-ledger badge-neutral text-nowrap';

      statusBadge.textContent = currentProfile.statusLabel || (currentProfile.isActive ? 'Đang hoạt động' : 'Không hoạt động');
      statusBadge.className = currentProfile.isActive
        ? 'badge-ledger badge-success text-nowrap'
        : 'badge-ledger badge-neutral text-nowrap';
    } catch (error) {
      showAlert(error.message, 'danger');
    } finally {
      setLoading(false);
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert();

    const fullName = fullNameInput.value.trim();
    if (!fullName) {
      showAlert('Họ và tên không được để trống.', 'warning');
      return;
    }

    const payload = {
      fullName,
      gender: genderSelect.value || undefined,
      dateOfBirth: dobInput.value || undefined,
    };

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status"></span>Đang lưu...';

    try {
      const updated = await window.ClubApi.request('/members/me', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });

      // Update stored user in session
      const stored = window.ClubApi.getUser() || {};
      stored.fullName = updated.fullName;
      localStorage.setItem('club.user', JSON.stringify(stored));

      showAlert('Cập nhật thông tin cá nhân thành công!', 'success');
      // Re-render auth-nav to update name
      const navHost = document.querySelector('[data-auth-nav]');
      if (navHost) {
        navHost.replaceChildren();
        const navScript = document.createElement('script');
        navScript.src = '../../../shared/auth-nav.js';
        document.body.append(navScript);
      }
    } catch (error) {
      showAlert(error.message, 'danger');
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="bi bi-check2-circle me-1"></i>Lưu thay đổi hồ sơ';
    }
  });

  if (leaveBtn) {
    leaveBtn.addEventListener('click', () => {
      if (leaveModal) leaveModal.show();
    });
  }

  if (confirmLeaveBtn) {
    confirmLeaveBtn.addEventListener('click', async () => {
      if (!currentProfile) return;
      confirmLeaveBtn.disabled = true;
      try {
        await window.ClubApi.request(`/members/${currentProfile.id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ isActive: false }),
        });
        if (leaveModal) leaveModal.hide();
        alert('Tài khoản của bạn đã được chuyển sang trạng thái Không hoạt động. Cảm ơn bạn đã tham gia CLB!');
        window.ClubApi.clearSession();
        window.location.href = '/routes/auth/login/index.html';
      } catch (error) {
        if (leaveModal) leaveModal.hide();
        showAlert(error.message, 'danger');
        confirmLeaveBtn.disabled = false;
      }
    });
  }

  loadProfile();
})();
