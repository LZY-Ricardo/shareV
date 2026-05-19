(function () {
  let adminToken = sessionStorage.getItem('sharev_admin_token') || '';
  let users = [];

  if (adminToken) {
    document.body.classList.add('admin-page');
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

  // ── Content Transition ──
  function setContent(html) {
    const el = document.getElementById('content');
    el.innerHTML = html;
    el.classList.remove('content-transition');
    void el.offsetWidth;
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
    document.getElementById('adminTokenInput').focus();
    document.getElementById('adminLoginForm').addEventListener('submit', (e) => {
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
    document.body.classList.add('admin-page');
    loadUsers().then(() => {
      sessionStorage.setItem('sharev_admin_token', token);
    }).catch(() => {
      adminToken = '';
      document.body.classList.remove('admin-page');
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
      document.body.classList.remove('admin-page');
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

  function renderUsers() {
    const onlineCount = users.filter(u => u.online).length;
    const totalCount = users.length;

    const userList = users.map((user, i) => `
      <div class="admin-user" style="--i:${i}" data-action="view" data-token="${escAttr(user.token)}">
        <span class="status-dot ${user.online ? 'online' : ''}"></span>
        <div class="admin-user-info">
          <div class="admin-user-name">${esc(user.name)}</div>
          <div class="admin-user-email">${esc(user.email)}</div>
        </div>
      </div>
    `).join('');

    setContent(`
      <div class="admin-page-header">
        <div>
          <h1 class="admin-page-title">用户管理</h1>
          <div class="admin-page-subtitle">${onlineCount} 在线 · ${totalCount} 用户</div>
        </div>
        <div class="admin-page-actions">
          <button data-action="sync">同步客户端</button>
          <button data-action="snapshot">快照</button>
          <button data-action="logout" class="btn-ghost">退出</button>
        </div>
      </div>
      <div class="admin-layout">
        <nav class="admin-sidebar">${userList}</nav>
        <div class="admin-main">
          <div class="admin-empty">选择左侧用户查看详情</div>
        </div>
      </div>
    `);

    document.getElementById('content').addEventListener('click', handleClick);
  }

  function handleClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    switch (action) {
      case 'view': viewUser(btn.dataset.token); break;
      case 'copy': copyUserLink(btn.dataset.url, btn); break;
      case 'snapshot': triggerSnapshot(btn); break;
      case 'sync': triggerSync(btn); break;
      case 'logout': handleAdminLogout(); break;
    }
  }

  async function viewUser(token) {
    document.querySelectorAll('.admin-user').forEach(el => {
      el.classList.toggle('active', el.dataset.token === token);
    });

    const main = document.querySelector('.admin-main');
    if (!main) return;

    main.innerHTML = '<div class="loading"><div class="loader-bar"></div></div>';

    try {
      const data = await adminFetch(`/api/admin/stats?token=${encodeURIComponent(token)}`);
      const today = formatBytes(data.today.up + data.today.down);
      const total = formatBytes(data.total.up + data.total.down);

      main.innerHTML = `
        <div class="admin-detail">
          <div class="admin-detail-header">
            <h2>${esc(data.name)}</h2>
            <span class="admin-detail-email">${esc(data.email || '')}</span>
          </div>
          <div class="admin-detail-cards">
            ${detailCard('今日流量', today, 'cyan')}
            ${detailCard('累计总量', total, 'green')}
            ${detailCard('在线设备', { value: String(data.devices || 0), unit: '台' }, 'amber')}
          </div>
          <div class="admin-detail-section">
            <div class="admin-detail-label">访问链接</div>
            <div class="admin-detail-link-row">
              <input class="admin-detail-link" value="${escAttr(data.url)}" readonly onclick="this.select()" />
              <button data-action="copy" data-url="${escAttr(data.url)}">复制</button>
              <a class="btn-open" href="${escAttr(data.url)}" target="_blank" rel="noopener">打开</a>
            </div>
          </div>
        </div>`;
    } catch (err) {
      main.innerHTML = `<div class="error-msg">${esc(err.message)}</div>`;
    }
  }

  async function copyUserLink(url, btn) {
    try {
      await navigator.clipboard.writeText(url);
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

  async function triggerSync(btn) {
    btn.classList.add('loading');
    try {
      const data = await adminFetch('/api/admin/sync', { method: 'POST' });
      if (data.count > 0) {
        toast(`已同步 ${data.count} 个新客户端: ${data.synced.join(', ')}`);
      } else {
        toast('已是最新，无需同步');
      }
      loadUsers();
    } catch (err) {
      toast(err.message, 'error');
      btn.classList.remove('loading');
    }
  }

  function handleAdminLogout() {
    sessionStorage.removeItem('sharev_admin_token');
    adminToken = '';
    document.body.classList.remove('admin-page');
    showLogin();
    toast('已退出', 'info');
  }

  window.handleAdminLogout = handleAdminLogout;

  function detailCard(label, formatted, color) {
    return `
      <div class="admin-detail-card ${color}">
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
