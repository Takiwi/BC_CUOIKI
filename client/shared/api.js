(() => {
  const isSameOrigin =
    window.location.protocol.startsWith('http') &&
    window.location.port !== '8080';
  const baseUrl =
    window.API_BASE_URL || (isSameOrigin ? '' : 'http://localhost:3001');
  const accessTokenKey = 'club.accessToken';
  const refreshTokenKey = 'club.refreshToken';
  const userKey = 'club.user';

  function parseJwt(token) {
    if (!token || typeof token !== 'string') return null;
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (base64.length % 4) {
        base64 += '=';
      }
      const jsonPayload = decodeURIComponent(
        Array.prototype.map
          .call(atob(base64), function (c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
          })
          .join(''),
      );
      return JSON.parse(jsonPayload);
    } catch {
      return null;
    }
  }

  function isTokenExpired(token, bufferSeconds = 30) {
    const payload = parseJwt(token);
    if (!payload || typeof payload.exp !== 'number') return true;
    return Date.now() >= (payload.exp - bufferSeconds) * 1000;
  }

  function getAccessToken() {
    return localStorage.getItem(accessTokenKey) || null;
  }

  function getRefreshToken() {
    return (
      localStorage.getItem(refreshTokenKey) ||
      sessionStorage.getItem(refreshTokenKey) ||
      null
    );
  }

  function saveSession(session) {
    if (!session) return;
    if (session.accessToken) {
      localStorage.setItem(accessTokenKey, session.accessToken);
    }
    if (session.refreshToken) {
      localStorage.setItem(refreshTokenKey, session.refreshToken);
      sessionStorage.setItem(refreshTokenKey, session.refreshToken);
    }
    if (session.member) {
      localStorage.setItem(userKey, JSON.stringify(session.member));
    }
  }

  function clearSession() {
    localStorage.removeItem(accessTokenKey);
    localStorage.removeItem(refreshTokenKey);
    localStorage.removeItem(userKey);
    sessionStorage.removeItem(refreshTokenKey);
  }

  function validateStoredSession() {
    const token = getAccessToken();
    const refreshToken = getRefreshToken();
    const user = getUser();

    if (token) {
      const isAccessExpired = isTokenExpired(token);
      const isRefreshExpired = !refreshToken || isTokenExpired(refreshToken);

      if (isAccessExpired && isRefreshExpired) {
        clearSession();
      }
    } else if (user || refreshToken) {
      clearSession();
    }
  }

  function getUser() {
    try {
      const raw = localStorage.getItem(userKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function getValidUser() {
    const token = getAccessToken();
    const refreshToken = getRefreshToken();
    const user = getUser();

    if (!token || !user) {
      if (token || user) clearSession();
      return null;
    }

    const isAccessExpired = isTokenExpired(token);
    const isRefreshExpired = !refreshToken || isTokenExpired(refreshToken);

    if (isAccessExpired && isRefreshExpired) {
      clearSession();
      return null;
    }

    return user;
  }

  function isAuthenticated() {
    return getValidUser() !== null;
  }

  function requireAuth(allowedRoles) {
    const user = getValidUser();
    if (!user) {
      clearSession();
      window.location.href = '/routes/auth/login/index.html';
      return false;
    }
    if (allowedRoles && allowedRoles.length && user.role !== 'ADMIN') {
      if (!allowedRoles.includes(user.role)) {
        alert('Bạn không có quyền truy cập trang này.');
        window.location.href = '/routes/members/profile/index.html';
        return false;
      }
    }
    return true;
  }

  async function send(path, options, token) {
    const headers = new Headers(options.headers || {});
    if (options.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    return fetch(`${baseUrl}${path}`, { ...options, headers });
  }

  async function responseData(response) {
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error('Máy chủ trả về phản hồi không hợp lệ.');
    }
    if (!response.ok) {
      const message = Array.isArray(payload.message)
        ? payload.message.join(', ')
        : payload.message || 'Không thể hoàn tất yêu cầu.';
      throw new Error(message);
    }
    if (!payload || typeof payload !== 'object' || !('data' in payload)) {
      throw new Error('Máy chủ trả về thiếu dữ liệu.');
    }
    return payload.data;
  }

  async function refreshAccessToken() {
    const refreshToken = getRefreshToken();
    if (!refreshToken) {
      clearSession();
      return null;
    }
    try {
      const refreshedResponse = await send('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      });
      const refreshed = await responseData(refreshedResponse);
      saveSession(refreshed);
      return refreshed.accessToken;
    } catch {
      clearSession();
      return null;
    }
  }

  async function request(path, options = {}, retry = true) {
    let accessToken = getAccessToken();
    const isAuthEndpoint =
      path.startsWith('/auth/login') || path.startsWith('/auth/register');

    if (
      accessToken &&
      isTokenExpired(accessToken) &&
      path !== '/auth/refresh' &&
      !isAuthEndpoint
    ) {
      accessToken = await refreshAccessToken();
      if (!accessToken) {
        clearSession();
        if (window.location.pathname.indexOf('/routes/auth/') === -1) {
          window.location.href = '/routes/auth/login/index.html';
        }
        throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      }
    }

    let response = await send(path, options, accessToken);

    if (
      response.status === 401 &&
      retry &&
      path !== '/auth/refresh' &&
      !isAuthEndpoint
    ) {
      const newAccessToken = await refreshAccessToken();
      if (newAccessToken) {
        response = await send(path, options, newAccessToken);
      } else {
        clearSession();
        if (window.location.pathname.indexOf('/routes/auth/') === -1) {
          window.location.href = '/routes/auth/login/index.html';
        }
      }
    } else if (response.status === 401 && !isAuthEndpoint) {
      clearSession();
      if (window.location.pathname.indexOf('/routes/auth/') === -1) {
        window.location.href = '/routes/auth/login/index.html';
      }
    }

    return responseData(response);
  }

  async function logout() {
    const refreshToken = getRefreshToken();
    const accessToken = getAccessToken();
    try {
      if (refreshToken) {
        await send(
          '/auth/logout',
          {
            method: 'POST',
            body: JSON.stringify({ refreshToken }),
          },
          accessToken,
        );
      }
    } catch (e) {
      console.warn('Logout API notification failed:', e);
    } finally {
      clearSession();
      window.location.href = '/routes/auth/login/index.html';
    }
  }

  function formatMoney(value) {
    const [wholePart, fractionPart = ''] = String(value).split('.');
    const whole = BigInt(wholePart || '0').toLocaleString('vi-VN');
    const fraction = fractionPart.replace(/0+$/, '');
    return `${whole}${fraction ? `,${fraction}` : ''} ₫`;
  }

  // Self-cleanup on load
  validateStoredSession();

  window.ClubApi = {
    request,
    saveSession,
    clearSession,
    getUser,
    getValidUser,
    isAuthenticated,
    getAccessToken,
    getRefreshToken,
    isTokenExpired,
    parseJwt,
    requireAuth,
    logout,
    formatMoney,
  };
})();
