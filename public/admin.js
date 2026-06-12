(function () {
  let adminToken = sessionStorage.getItem('sharev_admin_token') || '';
  let users = [];
  let viewMode = 'users'; // users | ranking
  let rankingPeriod = 'day'; // day | month | total

  const PERIOD_LABELS = { day: '今日', month: '本月', total: '总量' };

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
          <input type="password" id="adminTokenInput" placeholder="管理令牌" autocomplete="off" spellcheck="false" />
          <button id="adminLoginBtn" type="submit">进入</button>
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
    if (viewMode === 'ranking') {
      const panel = document.querySelector('.admin-ranking-panel');
      if (panel) {
        panel.innerHTML = '<div class="loading"><div class="loader-bar"></div></div>';
      }
    } else {
      setContent('<div class="loading"><div class="loader-bar"></div></div>');
    }
    try {
      const data = await adminFetch('/api/admin/users');
      users = data.users || [];
      if (viewMode === 'ranking') {
        await loadRanking(rankingPeriod, false);
      } else {
        renderUsers();
      }
    } catch (err) {
      if (err.message !== 'Unauthorized') showError(err.message);
    }
  }

  window.loadUsers = loadUsers;

  function renderPageHeader(subtitle) {
    const onlineCount = users.filter(u => u.online).length;
    const totalCount = users.length;
    return `
      <div class="admin-page-header">
        <div>
          <h1 class="admin-page-title">用户管理</h1>
          <div class="admin-page-subtitle">${subtitle || `${onlineCount} 在线 · ${totalCount} 用户`}</div>
        </div>
        <div class="admin-page-actions">
          <div class="admin-view-tabs">
            <button type="button" class="admin-view-tab ${viewMode === 'users' ? 'active' : ''}" data-action="view-users">用户列表</button>
            <button type="button" class="admin-view-tab ${viewMode === 'ranking' ? 'active' : ''}" data-action="view-ranking">流量排行</button>
          </div>
          <button data-action="sync">同步客户端</button>
          <button data-action="snapshot">快照</button>
          <button data-action="logout" class="btn-ghost">退出</button>
        </div>
      </div>`;
  }

  function renderUsers() {
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
      ${renderPageHeader()}
      <div class="admin-layout">
        <nav class="admin-sidebar">${userList}</nav>
        <div class="admin-main">
          <div class="admin-empty">选择左侧用户查看详情</div>
        </div>
      </div>
    `);

    bindContentEvents();
  }

  async function loadRanking(period = rankingPeriod, rerender = true) {
    viewMode = 'ranking';
    rankingPeriod = period;
    if (rerender) {
      setContent(`
        ${renderPageHeader('加载流量排行…')}
        <div class="admin-ranking-panel">
          <div class="loading"><div class="loader-bar"></div></div>
        </div>
      `);
      bindContentEvents();
    }

    try {
      const data = await adminFetch(`/api/admin/traffic-ranking?period=${encodeURIComponent(period)}`);
      renderRanking(data);
    } catch (err) {
      if (err.message !== 'Unauthorized') {
        setContent(`
          ${renderPageHeader()}
          <div class="error-msg"><div>错误:: ${esc(err.message)}</div><button class="retry-btn" data-action="view-ranking">重试</button></div>
        `);
        bindContentEvents();
      }
    }
  }

  function renderRanking(data) {
    const totalFmt = formatBytes(data.totalBytes || 0);
    const updatedAt = data.updatedAt
      ? new Date(data.updatedAt).toLocaleString('zh-CN')
      : '';

    const rows = (data.users || []).map((user) => {
      const fmt = formatBytes(user.bytes || 0);
      const sharePct = ((user.share || 0) * 100).toFixed(user.share > 0 && user.share < 0.01 ? 1 : 0);
      const barPct = Math.max(user.bytes > 0 ? 2 : 0, Math.round((user.barPct || 0) * 100));
      const rankClass = user.rank <= 3 ? ` top-${user.rank}` : '';
      return `
        <div class="admin-rank-row${rankClass}" data-action="view" data-token="${escAttr(user.token)}">
          <div class="admin-rank-num">${user.rank}</div>
          <div class="admin-rank-user">
            <div class="admin-rank-name-row">
              <span class="status-dot ${user.online ? 'online' : ''}"></span>
              <span class="admin-rank-name">${esc(user.name)}</span>
            </div>
            <div class="admin-rank-email">${esc(user.email)}</div>
          </div>
          <div class="admin-rank-bar-wrap">
            <div class="admin-rank-bar" style="width:${barPct}%"></div>
          </div>
          <div class="admin-rank-stats">
            <div class="admin-rank-value">${fmt.value}<span class="unit">${fmt.unit}</span></div>
            <div class="admin-rank-meta">占比 ${sharePct}% · ↑${formatCompact(user.up)} ↓${formatCompact(user.down)}</div>
          </div>
        </div>`;
    }).join('');

    setContent(`
      ${renderPageHeader(`${PERIOD_LABELS[data.period] || '流量'}排行 · 合计 ${totalFmt.value} ${totalFmt.unit}`)}
      <div class="admin-ranking-panel">
        <div class="admin-ranking-toolbar">
          <div class="admin-period-tabs">
            ${['day', 'month', 'total'].map((p) => `
              <button type="button" class="admin-period-tab ${data.period === p ? 'active' : ''}" data-action="rank-period" data-period="${p}">${PERIOD_LABELS[p]}</button>
            `).join('')}
          </div>
          <div class="admin-ranking-meta">更新于 ${esc(updatedAt)}</div>
        </div>
        <div class="admin-ranking-list">
          ${rows || '<div class="admin-empty">暂无用户数据</div>'}
        </div>
      </div>
    `);

    bindContentEvents();
  }

  function bindContentEvents() {
    const content = document.getElementById('content');
    if (!content) return;
    content.onclick = handleClick;
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
      case 'view-users':
        viewMode = 'users';
        renderUsers();
        break;
      case 'view-ranking':
        loadRanking(rankingPeriod);
        break;
      case 'rank-period':
        loadRanking(btn.dataset.period);
        break;
    }
  }

  async function viewUser(token) {
    viewMode = 'users';
    document.querySelectorAll('.admin-view-tab').forEach((el) => {
      el.classList.toggle('active', el.dataset.action === 'view-users');
    });

    document.querySelectorAll('.admin-user').forEach(el => {
      el.classList.toggle('active', el.dataset.token === token);
    });

    const main = document.querySelector('.admin-main');
    if (!main) {
      renderUsers();
      await new Promise((r) => requestAnimationFrame(r));
      return viewUser(token);
    }

    main.innerHTML = '<div class="loading"><div class="loader-bar"></div></div>';

    try {
      const data = await adminFetch(`/api/admin/stats?token=${encodeURIComponent(token)}`);
      const today = formatBytes(data.today.up + data.today.down);
      const monthTraffic = data.month || { up: 0, down: 0 };
      const month = formatBytes(monthTraffic.up + monthTraffic.down);
      const total = formatBytes(data.total.up + data.total.down);

      main.innerHTML = `
        <div class="admin-detail">
          <div class="admin-detail-header">
            <h2>${esc(data.name)}</h2>
            <span class="admin-detail-email">${esc(data.email || '')}</span>
          </div>
          <div class="admin-detail-cards">
            ${detailCard('今日流量', today, 'cyan')}
            ${detailCard('本月流量', month, 'green')}
            ${detailCard('累计总量', total, 'amber')}
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
      if (viewMode === 'ranking') {
        loadRanking(rankingPeriod);
      } else {
        loadUsers();
      }
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
        const parts = [];
        if (data.synced?.length) parts.push(`新增 ${data.synced.join(', ')}`);
        if (data.updated?.length) parts.push(`更新 ${data.updated.join(', ')}`);
        toast(parts.join('；') || `已同步 ${data.count} 项`);
      } else {
        toast('已是最新，无需同步');
      }
      if (viewMode === 'ranking') {
        loadRanking(rankingPeriod);
      } else {
        loadUsers();
      }
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
    setContent(`<div class="error-msg"><div>错误:: ${esc(msg)}</div><button class="retry-btn" onclick="loadUsers()">重试</button></div>`);
  }

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return { value: '0', unit: 'B' };
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const value = (bytes / Math.pow(1024, i)).toFixed(i > 1 ? 2 : 0);
    return { value, unit: units[i] };
  }

  function formatCompact(bytes) {
    const f = formatBytes(bytes || 0);
    return `${f.value}${f.unit}`;
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
