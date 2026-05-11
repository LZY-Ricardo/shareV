(function () {
  let adminToken = sessionStorage.getItem('sharev_admin_token') || '';
  let users = [];

  if (adminToken) {
    loadUsers();
  } else {
    showLogin();
  }

  // ── Toast System ──
  function toast(message, type = 'success', duration = 2200) {
    let el = document.querySelector('.toast');
    if (el) el.remove();
    el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    document.body.appendChild(el);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => el.classList.add('show'));
    });
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 350);
    }, duration);
  }

  // ── Content Transition Helper ──
  function setContent(html) {
    const el = document.getElementById('content');
    el.innerHTML = html;
    el.classList.remove('content-transition');
    void el.offsetWidth; // force reflow
    el.classList.add('content-transition');
  }

  function showLogin() {
    setContent(`
      <div class="login-box">
        <div class="login-title">管理令牌</div>
        <form class="login-form" id="adminLoginForm">
          <input type="password" id="adminTokenInput" placeholder="ADMIN_TOKEN" autocomplete="off" spellcheck="false" />
          <button id="adminLoginBtn" type="submit">GO</button>
        </form>
      </div>`);
    const input = document.getElementById('adminTokenInput');
    const form = document.getElementById('adminLoginForm');
    input.focus();
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      handleAdminLogin();
    });
  }

  window.handleAdminLogin = function () {
    const token = document.getElementById('adminTokenInput').value.trim();
    if (!token) return;
    const btn = document.getElementById('adminLoginBtn');
    btn.classList.add('loading');
    btn.textContent = '...';
    adminToken = token;
    loadUsers().then(() => {
      sessionStorage.setItem('sharev_admin_token', token);
    }).catch(() => {
      adminToken = '';
    });
  };

  async function adminFetch(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: `Bearer ${adminToken}`,
      },
    });
    if (res.status === 401) {
      sessionStorage.removeItem('sharev_admin_token');
      adminToken = '';
      showLogin();
      toast('认证失败', 'error');
      throw new Error('Unauthorized');
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || '请求失败');
    }
    return res.json();
  }

  async function loadUsers() {
    setContent('<div class="loading"><div class="loader-bar"></div></div>');
    try {
      const data = await adminFetch('/api/admin/users');
      users = data.users || [];
      renderUsers();
    } catch (err) {
      if (err.message !== 'Unauthorized') showError(err.message);
    }
  }

  window.loadUsers = loadUsers;

  function renderUsers(selectedToken = '') {
    const rows = users.map((user) => `
      <div class="admin-user ${user.token === selectedToken ? 'active' : ''}">
        <div>
          <div class="admin-user-name">
            <span class="dot ${user.online ? 'online' : 'offline'}"></span>
            ${esc(user.name)}
          </div>
          <div class="admin-user-email">${esc(user.email)}</div>
        </div>
        <div class="admin-actions">
          <button data-action="view" data-token="${escAttr(user.token)}">查看</button>
          <button data-action="copy" data-url="${escAttr(user.url)}">复制</button>
          <a href="${escAttr(user.url)}" target="_blank" rel="noopener">打开</a>
        </div>
      </div>`).join('');

    setContent(`
      <div class="admin-toolbar">
        <button id="snapshotBtn" data-action="snapshot">快照</button>
        <button data-action="logout">退出</button>
      </div>
      <div class="admin-list">${rows}</div>
      <div id="adminDetail"></div>`);

    // Delegate click events
    document.getElementById('content').addEventListener('click', handleClick);
  }

  function handleClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    switch (action) {
      case 'view': viewUser(btn.dataset.token, btn); break;
      case 'copy': copyUserLink(btn.dataset.url, btn); break;
      case 'snapshot': triggerSnapshot(btn); break;
      case 'logout': handleAdminLogout(); break;
    }
  }

  async function viewUser(token, btn) {
    renderUsers(token);
    const detail = document.getElementById('adminDetail');
    detail.innerHTML = '<div class="loading"><div class="loader-bar"></div></div>';
    try {
      const data = await adminFetch(`/api/admin/stats?token=${encodeURIComponent(token)}`);
      const today = formatBytes(data.today.up + data.today.down);
      const total = formatBytes(data.total.up + data.total.down);
      detail.innerHTML = `
        <div class="admin-detail">
          <div class="title">${esc(data.name)}</div>
          <div class="cards">
            ${card('账号今日', today)}
            ${card('账号总量', total)}
            ${card('DEVICE', { value: String(data.devices || 0), unit: '' })}
          </div>
          <input class="config-link" value="${escAttr(data.url)}" readonly onclick="this.select()" />
        </div>`;
    } catch (err) {
      detail.innerHTML = `<div class="error-msg">${esc(err.message)}</div>`;
    }
  }

  async function copyUserLink(url, btn) {
    try {
      await navigator.clipboard.writeText(url);
      // Flash button green
      btn.classList.add('success');
      btn.textContent = '已复制';
      toast('链接已复制到剪贴板');
      setTimeout(() => {
        btn.classList.remove('success');
        btn.textContent = '复制';
      }, 1500);
    } catch {
      toast('复制失败', 'error');
    }
  }

  async function triggerSnapshot(btn) {
    btn.classList.add('loading');
    try {
      await adminFetch('/api/admin/snapshot', { method: 'POST' });
      toast('快照完成');
      loadUsers();
    } catch (err) {
      toast(err.message, 'error');
      btn.classList.remove('loading');
    }
  }

  function handleAdminLogout() {
    sessionStorage.removeItem('sharev_admin_token');
    adminToken = '';
    showLogin();
    toast('已退出', 'info');
  }

  window.handleAdminLogout = handleAdminLogout;

  function card(label, formatted) {
    return `
      <div class="card total">
        <div class="label">${label}</div>
        <div class="value">${formatted.value}<span class="unit">${formatted.unit}</span></div>
      </div>`;
  }

  function showError(msg) {
    setContent(`<div class="error-msg"><div>ERR:: ${esc(msg)}</div><button class="retry-btn" onclick="loadUsers()">重试</button></div>`);
  }

  function formatBytes(bytes) {
    if (bytes === 0) return { value: '0', unit: 'B' };
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const value = (bytes / Math.pow(1024, i)).toFixed(i > 1 ? 2 : 0);
    return { value, unit: units[i] };
  }

  function esc(s) {
    const el = document.createElement('span');
    el.textContent = s;
    return el.innerHTML;
  }

  function escAttr(s) {
    return esc(s).replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/`/g, '&#96;');
  }
})();
