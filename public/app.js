(function () {
  let refreshTimer = null;
  let currentToken = '';
  let mustChangePassword = false;

  const fetchOpts = { credentials: 'same-origin' };

  function pwdToggleBtnHTML(targetId) {
    return `<button type="button" class="pwd-toggle" data-target="${targetId}" aria-label="显示密码">
              <svg class="eye-open" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              <svg class="eye-closed" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-6.5 0-10-7-10-7a18.94 18.94 0 0 1 4.22-5.22"/>
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19"/>
                <path d="M14.12 14.12A3 3 0 1 1 9.88 9.88"/>
                <line x1="2" y1="2" x2="22" y2="22"/>
              </svg>
            </button>`;
  }

  function bindPwdToggles(scope) {
    scope.querySelectorAll('.pwd-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = scope.querySelector('#' + btn.dataset.target);
        if (!input) return;
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.classList.toggle('is-visible', show);
        btn.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
      });
    });
  }

  init();

  async function init() {
    const hashToken = readTokenFromHash();
    if (hashToken) {
      const ok = await exchangeToken(hashToken);
      if (ok) {
        history.replaceState(null, '', location.pathname + location.search);
        showDashboard();
        return;
      }
    }

    const sessionOk = await checkSession();
    if (sessionOk) {
      showDashboard();
      return;
    }

    const savedToken = localStorage.getItem('sharev_token');
    if (savedToken) {
      const ok = await exchangeToken(savedToken);
      if (ok) {
        showDashboard();
        return;
      }
      localStorage.removeItem('sharev_token');
    }

    showLogin();
  }

  async function checkSession() {
    try {
      const res = await fetch('/api/auth/me', fetchOpts);
      if (!res.ok) return false;
      const data = await res.json();
      currentToken = '';
      mustChangePassword = !!data.mustChangePassword;
      if (data.user?.name) {
        document.getElementById('userName').textContent = data.user.name;
      }
      return true;
    } catch {
      return false;
    }
  }

  async function exchangeToken(token) {
    try {
      const res = await fetch('/api/auth/token', {
        ...fetchOpts,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      mustChangePassword = !!data.mustChangePassword;
      currentToken = token;
      localStorage.setItem('sharev_token', token);
      return true;
    } catch {
      return false;
    }
  }

  function readTokenFromHash() {
    if (!location.hash) return '';
    const raw = decodeURIComponent(location.hash.slice(1));
    if (raw.startsWith('t=')) {
      return new URLSearchParams(raw).get('t') || '';
    }
    return raw;
  }

  function showLogin(mode = 'password') {
    document.getElementById('userName').textContent = 'shareV';
    document.getElementById('updateTime').textContent = '流量监控系统';
    document.getElementById('content').innerHTML = `
      <div class="login-box">
        <div class="login-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2"/>
            <path d="M8 21h8"/>
            <path d="M12 17v4"/>
            <circle cx="12" cy="10" r="2"/>
          </svg>
        </div>
        <div class="login-title">${mode === 'password' ? '登录查看流量数据' : '输入访问码查看流量'}</div>
        <div class="login-tabs">
          <button type="button" class="login-tab ${mode === 'password' ? 'active' : ''}" onclick="switchLoginMode('password')">账号登录</button>
          <button type="button" class="login-tab ${mode === 'token' ? 'active' : ''}" onclick="switchLoginMode('token')">访问码</button>
        </div>
        ${mode === 'password' ? `
        <form class="login-form login-form-stacked" id="passwordLoginForm">
          <input type="text" id="emailInput" placeholder="QQ 邮箱（与 3X-UI 一致）" autocomplete="username" spellcheck="false" />
          <div class="pwd-field">
            <input type="password" id="passwordInput" placeholder="密码" autocomplete="current-password" />
            ${pwdToggleBtnHTML('passwordInput')}
          </div>
          <button id="loginBtn" type="submit">登录</button>
        </form>` : `
        <form class="login-form" id="tokenLoginForm">
          <input type="text" id="tokenInput" placeholder="访问码" autocomplete="off" spellcheck="false" />
          <button id="tokenLoginBtn" type="submit">登录</button>
        </form>`}
        <div class="login-hint">${mode === 'password' ? '使用 3X-UI 客户端邮箱登录，初始密码 123456' : '仍可使用管理员分享的访问链接或访问码'}</div>
      </div>`;

    if (mode === 'password') {
      const form = document.getElementById('passwordLoginForm');
      const emailInput = document.getElementById('emailInput');
      emailInput.focus();
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        handlePasswordLogin();
      });
      bindPwdToggles(form);
    } else {
      const form = document.getElementById('tokenLoginForm');
      document.getElementById('tokenInput').focus();
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        handleTokenLogin();
      });
    }
  }

  window.switchLoginMode = function (mode) {
    showLogin(mode);
  };

  async function handlePasswordLogin() {
    const email = document.getElementById('emailInput').value.trim();
    const password = document.getElementById('passwordInput').value;
    if (!email || !password) return;

    const btn = document.getElementById('loginBtn');
    btn.disabled = true;
    btn.textContent = '...';

    try {
      const res = await fetch('/api/auth/login', {
        ...fetchOpts,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: email, email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '登录失败');

      currentToken = '';
      localStorage.removeItem('sharev_token');
      mustChangePassword = !!data.mustChangePassword;
      showDashboard();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = '登录';
    }
  }

  async function handleTokenLogin() {
    const token = document.getElementById('tokenInput').value.trim();
    if (!token) return;
    const ok = await exchangeToken(token);
    if (ok) {
      showDashboard();
    } else {
      toast('访问码无效', 'error');
    }
  }

  window.handleLogin = handleTokenLogin;

  function showDashboard() {
    loadStats();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(loadStats, 120000);
    if (mustChangePassword) {
      showChangePasswordModal();
    }
  }

  function showChangePasswordModal() {
    let overlay = document.getElementById('pwdChangeModal');
    if (overlay) {
      overlay.style.display = 'flex';
      return;
    }

    overlay = document.createElement('div');
    overlay.id = 'pwdChangeModal';
    overlay.className = 'pwd-modal-overlay';
    overlay.innerHTML = `
      <div class="pwd-modal" role="dialog" aria-labelledby="pwdModalTitle">
        <div class="pwd-modal-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="11" width="18" height="11" rx="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <h2 class="pwd-modal-title" id="pwdModalTitle">请修改初始密码</h2>
        <p class="pwd-modal-desc">您仍在使用默认密码（123456），为保障账号安全请立即修改。</p>
        <form class="login-form login-form-stacked pwd-modal-form" id="changePasswordForm">
          <div class="pwd-field">
            <input type="password" id="pwdCurrent" placeholder="当前密码" autocomplete="current-password" required />
            ${pwdToggleBtnHTML('pwdCurrent')}
          </div>
          <div class="pwd-field">
            <input type="password" id="pwdNew" placeholder="新密码（至少 6 位）" autocomplete="new-password" required />
            ${pwdToggleBtnHTML('pwdNew')}
          </div>
          <div class="pwd-field">
            <input type="password" id="pwdConfirm" placeholder="确认新密码" autocomplete="new-password" required />
            ${pwdToggleBtnHTML('pwdConfirm')}
          </div>
          <button type="submit" id="pwdSubmitBtn">保存新密码</button>
        </form>
        <button type="button" class="pwd-modal-later" id="pwdLaterBtn">稍后再说</button>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#pwdLaterBtn').addEventListener('click', () => {
      overlay.style.display = 'none';
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.style.display = 'none';
    });

    const form = overlay.querySelector('#changePasswordForm');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      handleChangePassword();
    });

    bindPwdToggles(overlay);

    overlay.querySelector('#pwdCurrent').focus();
  }

  async function handleChangePassword() {
    const currentPassword = document.getElementById('pwdCurrent').value;
    const newPassword = document.getElementById('pwdNew').value;
    const confirm = document.getElementById('pwdConfirm').value;
    if (!currentPassword || !newPassword) return;
    if (newPassword !== confirm) {
      toast('两次输入的新密码不一致', 'error');
      return;
    }

    const btn = document.getElementById('pwdSubmitBtn');
    btn.disabled = true;
    btn.textContent = '保存中...';

    try {
      const res = await fetch('/api/auth/change-password', {
        ...fetchOpts,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '修改失败');

      mustChangePassword = false;
      const overlay = document.getElementById('pwdChangeModal');
      if (overlay) overlay.remove();
      toast('密码已更新', 'success');
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = '保存新密码';
    }
  }

  async function loadStats() {
    showLoadingBar(true);
    try {
      const url = currentToken
        ? `/api/stats?token=${encodeURIComponent(currentToken)}`
        : '/api/stats';
      const res = await fetch(url, fetchOpts);
      if (res.status === 401) {
        currentToken = '';
        localStorage.removeItem('sharev_token');
        showLogin();
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '请求失败');
      }
      const data = await res.json();
      render(data);
    } catch (err) {
      showError(err.message);
    } finally {
      showLoadingBar(false);
    }
  }

  function showLoadingBar(show) {
    let bar = document.getElementById('loadingBar');
    if (show) {
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'loadingBar';
        bar.className = 'top-loading-bar';
        document.body.prepend(bar);
      }
      bar.classList.add('active');
    } else if (bar) {
      bar.classList.remove('active');
    }
  }

  function toast(message, type = 'info', duration = 2200) {
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

  function formatBytes(bytes) {
    if (bytes === 0) return { value: '0', unit: 'B' };
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const value = (bytes / Math.pow(1024, i)).toFixed(i > 1 ? 2 : 0);
    return { value, unit: units[i] };
  }

  function formatSpeed(bytesPerSec) {
    if (!bytesPerSec || bytesPerSec < 0) bytesPerSec = 0;
    if (bytesPerSec < 1024) return bytesPerSec.toFixed(0) + ' B/s';
    if (bytesPerSec < 1024 * 1024) return (bytesPerSec / 1024).toFixed(1) + ' KB/s';
    return (bytesPerSec / 1024 / 1024).toFixed(2) + ' MB/s';
  }

  function formatSplit(totalBytes, up, down) {
    const total = formatBytes(totalBytes);
    const unitIdx = ['B', 'KB', 'MB', 'GB', 'TB'].indexOf(total.unit);
    const div = Math.pow(1024, unitIdx);
    const precision = unitIdx > 1 ? 2 : 0;
    const totalNum = parseFloat(total.value);
    const upDisp = (up / div).toFixed(precision);
    const downDisp = (down / div).toFixed(precision);
    return { total, upDisp, downDisp };
  }

  function sumTraffic(up, down) {
    return formatBytes(up + down);
  }

  function render(data) {
    document.getElementById('userName').textContent = data.name;
    const ts = new Date().toLocaleString('zh-CN');
    document.getElementById('updateTime').innerHTML =
      `上次同步 ${ts} <a href="#" class="back-link" onclick="handleLogout()">[切换]</a>`;

    const node = data.node || {};
    const online = data.online || false;
    const devices = data.devices || 0;
    const deviceList = data.deviceList || [];

    let html = '';

    // Expiry warning banner
    if (node.expiryTime > 0) {
      const daysLeft = Math.max(0, Math.ceil((node.expiryTime - Date.now()) / (1000 * 60 * 60 * 24)));
      if (daysLeft === 0) {
        html += '<div class="alert-banner expired">订阅已到期</div>';
      } else if (daysLeft <= 3) {
        html += `<div class="alert-banner urgent">订阅即将到期 · 剩余 ${daysLeft} 天</div>`;
      } else if (daysLeft <= 7) {
        html += `<div class="alert-banner warning">订阅将在 ${daysLeft} 天后到期</div>`;
      }
    }

    // Node info bar (two-row layout)
    html += '<div class="node-bar">';
    // Row 1: status + name + devices
    html += '<div class="node-bar-main">';
    html += `<span class="status-badge ${online ? 'online' : 'offline'}">${online ? '在线' : '离线'}</span>`;
    if (node.remark) {
      html += `<span class="node-name">${esc(node.remark)}</span>`;
    }
    const limitIp = node.limitIp || 0;
    if (online && devices > 0) {
      html += `<span class="device-count" onclick="toggleDevices()">`;
      const atLimit = limitIp > 0 && devices >= limitIp;
      html += `<span class="dot online"></span>`;
      html += `<span class="${atLimit ? 'device-at-limit' : ''}">${devices} 台设备</span>`;
      html += ` <span class="expand-arrow" id="deviceArrow">▶</span>`;
      if (limitIp > 0) {
        html += `<span class="device-limit-hint">上限 ${limitIp} 台</span>`;
      }
      html += `</span>`;
    } else if (limitIp > 0) {
      html += `<span class="device-limit-hint">上限 ${limitIp} 台</span>`;
    }
    html += '</div>';
    // Row 2: speed
    const avgSpeed = data.avgSpeed;
    const initUp = avgSpeed ? avgSpeed.up : 0;
    const initDown = avgSpeed ? avgSpeed.down : 0;
    html += '<div class="node-bar-speed" id="speedDisplay">';
    html += `<span class="speed-up${initUp ? '' : ' idle'}">↑ ${formatSpeed(initUp)}</span>`;
    html += `<span class="speed-down${initDown ? '' : ' idle'}">↓ ${formatSpeed(initDown)}</span>`;
    html += '</div>';
    html += '</div>';

    // Quota progress bar — monthly usage (3X-UI billing period), not all-time total
    if (node.totalGB && node.totalGB > 0) {
      const totalBytes = node.totalGB * (1024 ** 3);
      const monthUsage = data.month && (data.month.up + data.month.down > 0)
        ? data.month
        : (data.thisMonth || { up: 0, down: 0 });
      const usedBytes = monthUsage.up + monthUsage.down;
      const pct = Math.min(100, (usedBytes / totalBytes) * 100);
      const usedF = formatBytes(usedBytes);
      const cls = pct > 90 ? 'danger' : pct > 70 ? 'warn' : '';

      html += '<div class="quota-section">';
      html += '<div class="quota-bar">';
      html += `<div class="quota-fill ${cls}" style="width:${pct.toFixed(1)}%"></div>`;
      html += '</div>';
      html += '<div class="quota-info">';
      html += `<span>本月 ${usedF.value}${usedF.unit} / ${node.totalGB} GB</span>`;
      html += `<span class="quota-pct ${cls}">${pct.toFixed(1)}%</span>`;
      html += '</div>';

      if (node.expiryTime && node.expiryTime > 0) {
        const expDate = new Date(node.expiryTime);
        const daysLeft = Math.max(0, Math.ceil((expDate - Date.now()) / (1000 * 60 * 60 * 24)));
        const expStr = expDate.toLocaleDateString('zh-CN');
        html += `<div class="quota-expiry">${daysLeft > 0 ? '剩余 ' + daysLeft + ' 天' : '已到期'} · ${expStr}</div>`;
      }
      html += '</div>';
    }

    // Device detail list (hidden by default)
    if (deviceList.length > 0) {
      html += '<div class="device-list" id="deviceList" style="display:none">';
      for (const dev of deviceList) {
        const lastSeen = dev.lastSeen ? new Date(dev.lastSeen).toLocaleString('zh-CN') : '—';
        html += `<div class="device-item">`;
        html += `<span class="device-ip">${esc(dev.ip)}</span>`;
        html += `<span class="device-time">${lastSeen}</span>`;
        html += `</div>`;
      }
      html += '</div>';
    }

    // Traffic cards with period toggle
    const today = sumTraffic(data.today.up, data.today.down);
    const total = sumTraffic(data.total.up, data.total.down);

    // Compute 7-day and 30-day sums from daily data
    const daily = data.daily || [];
    const last7 = daily.slice(-7);
    const last30 = daily;
    const sum7 = sumTraffic(last7.reduce((s, d) => s + d.up, 0), last7.reduce((s, d) => s + d.down, 0));
    const sum30 = sumTraffic(last30.reduce((s, d) => s + d.up, 0), last30.reduce((s, d) => s + d.down, 0));
    const sum7raw = { up: last7.reduce((s, d) => s + d.up, 0), down: last7.reduce((s, d) => s + d.down, 0) };
    const sum30raw = { up: last30.reduce((s, d) => s + d.up, 0), down: last30.reduce((s, d) => s + d.down, 0) };

    html += '<div class="cards-toggle">';
    html += '<button class="toggle-btn active" onclick="switchPeriod(7)">7天</button>';
    html += '<button class="toggle-btn" onclick="switchPeriod(30)">30天</button>';
    html += '</div>';
    html += '<div class="cards" id="trafficCards">';
    html += card('账号今日', today, 'today', data.today.up, data.today.down);
    html += card('账号近7天', sum7, 'period', sum7raw.up, sum7raw.down);
    html += card('账号总量', total, 'total', data.total.up, data.total.down);
    html += '</div>';

    // Chart
    html += '<div class="chart-section">';
    html += '<div class="title" id="chartTitle">近7天趋势</div>';
    html += '<div class="chart-container"><canvas id="chart"></canvas></div>';
    html += '</div>';

    // Config link panel (bottom)
    if (data.configLink) {
      const hasClash = !!data.clashConfigUrl;
      html += '<div class="config-section">';
      html += '<div class="config-header" onclick="toggleConfig()">';
      html += '<div class="config-header-left">';
      html += '<span class="config-title">节点导入</span>';
      html += '<span class="config-subtitle">选择客户端，一键导入代理配置</span>';
      html += '</div>';
      html += '<span class="expand-arrow" id="configArrow">▼</span>';
      html += '</div>';
      html += '<div class="config-body" id="configBody">';

      // Tab bar
      if (hasClash) {
        html += '<div class="config-tabs">';
        html += '<button class="config-tab active" data-tab="clash" onclick="switchConfigTab(\'clash\')">Clash</button>';
        html += '<button class="config-tab" data-tab="vless" onclick="switchConfigTab(\'vless\')">VLESS</button>';
        html += '</div>';
      }

      // Clash panel (default active)
      if (hasClash) {
        html += '<div class="config-panel" id="clashPanel">';
        html += '<input type="text" class="config-link" id="clashConfigUrl" value="' + esc(data.clashConfigUrl) + '" readonly onclick="this.select()" />';
        html += '<div class="config-actions">';
        html += '<button class="config-clash-btn" onclick="copyClashConfig()">复制订阅</button>';
        html += '<button class="config-clash-import-btn" onclick="importToClashVerge()">导入 Clash Verge</button>';
        html += '<button class="config-help-btn" onclick="openClashGuide()">查看导入教程</button>';
        html += '</div>';
        html += '<div class="config-tip">请确保 Clash Verge 已打开，再点击"导入"。若应用未运行，首次点击仅会启动应用，需再次点击才能完成导入。</div>';
        html += '<div class="qr-container" id="qrContainerClash"></div>';
        html += '<div class="config-hint">也可扫描二维码导入 · <a href="https://github.com/clash-verge-rev/clash-verge-rev/releases" target="_blank" rel="noopener" class="config-dl">下载 Clash Verge</a></div>';
        html += '</div>';
      }

      // VLESS panel
      html += '<div class="config-panel" id="vlessPanel"' + (hasClash ? ' style="display:none"' : '') + '>';

      // Node picker — only when the user has multiple nodes (e.g. CF CDN + REALITY direct).
      // shareV surfaces both inbounds so users can choose which to import.
      const nodes = Array.isArray(data.nodes) ? data.nodes : (data.configLink ? [{ configLink: data.configLink, protocol: 'reality' }] : []);
      if (nodes.length > 1) {
        html += '<div class="config-tabs node-tabs">';
        nodes.forEach((node, idx) => {
          const active = idx === 0 ? ' active' : '';
          const label = node.protocol === 'ws' ? 'CF CDN' : '直连';
          html += `<button class="config-tab${active}" data-node-idx="${idx}" onclick="switchNode(${idx})">${label}</button>`;
        });
        html += '</div>';
      }

      html += `<input type="text" class="config-link" id="configInput" value="${esc(data.configLink)}" readonly onclick="this.select()" />`;
      html += '<div class="config-actions">';
      html += '<button class="config-copy-btn" onclick="copyConfig()">复制链接</button>';
      html += '<button class="config-import-btn" onclick="importToV2RayN()">复制并打开 v2rayN</button>';
      html += '<button class="config-help-btn" onclick="openGuide()">查看导入教程</button>';
      html += '</div>';
      html += '<div class="qr-container" id="qrContainer"></div>';
      html += '<div class="config-hint">不会导入？打开教程按步骤操作。也可以扫描二维码导入 · <a href="https://github.com/2dust/v2rayN/releases" target="_blank" rel="noopener" class="config-dl">下载 v2rayN</a></div>';
      html += '</div>';
      html += '</div>';
      html += '</div>';
    }

    document.getElementById('content').innerHTML = html;
    // Fade in
    const content = document.getElementById('content');
    content.classList.remove('fade-in');
    void content.offsetWidth; // trigger reflow
    content.classList.add('fade-in');

    if (daily.length > 0) {
      drawChart(last7);
    }

    // Render QR codes
    if (data.configLink) {
      try {
        const qrContainer = document.getElementById('qrContainer');
        if (qrContainer) qrContainer.innerHTML = generateQR(data.configLink);
        if (data.clashConfigUrl) {
          const qrClash = document.getElementById('qrContainerClash');
          if (qrClash) qrClash.innerHTML = generateQR(data.clashConfigUrl);
        }
      } catch (e) { /* QR generation failed, ignore */ }
    }
  }

  function card(label, formatted, cls, up, down) {
    const s = formatSplit(up + down, up, down);
    return `
      <div class="card ${cls}">
        <div class="label">${label}</div>
        <div class="value">${s.total.value}<span class="unit">${s.total.unit}</span></div>
        <div class="detail">↑${s.upDisp}${s.total.unit} ↓${s.downDisp}${s.total.unit}</div>
      </div>`;
  }

  // Store last data for period switching
  let lastData = null;
  let currentPeriodDays = 7;
  let resizeTimer = null;
  const origRender = render;
  render = function(data) {
    lastData = data;
    currentPeriodDays = 7;
    origRender(data);
    startSpeedPoll();
  };

  // Real-time speed polling
  let speedPollTimer = null;
  let prevCounters = null;

  function startSpeedPoll() {
    if (speedPollTimer) clearInterval(speedPollTimer);
    prevCounters = null;
    speedPollTimer = setInterval(pollSpeed, 5000);
    pollSpeed(); // immediate first call
  }

  function updateSpeedDisplay(upSpeed, downSpeed) {
    const el = document.getElementById('speedDisplay');
    if (!el) return;
    const upEl = el.querySelector('.speed-up');
    const downEl = el.querySelector('.speed-down');
    if (upEl) {
      upEl.textContent = `↑ ${formatSpeed(upSpeed)}`;
      upEl.classList.toggle('idle', !upSpeed);
    }
    if (downEl) {
      downEl.textContent = `↓ ${formatSpeed(downSpeed)}`;
      downEl.classList.toggle('idle', !downSpeed);
    }
  }

  async function pollSpeed() {
    try {
      const url = currentToken
        ? `/api/speed?token=${encodeURIComponent(currentToken)}`
        : '/api/speed';
      const res = await fetch(url, fetchOpts);
      if (!res.ok) return;
      const data = await res.json();
      const now = Date.now();
      if (prevCounters) {
        const dt = (now - prevCounters.ts) / 1000;
        if (dt > 0) {
          const upSpeed = Math.max(0, data.up - prevCounters.up) / dt;
          const downSpeed = Math.max(0, data.down - prevCounters.down) / dt;
          updateSpeedDisplay(upSpeed, downSpeed);
        }
      } else {
        // First poll: show 0 B/s baseline immediately
        updateSpeedDisplay(0, 0);
      }
      prevCounters = { up: data.up, down: data.down, ts: now };
    } catch { /* ignore */ }
  }

  function getCurrentDaily() {
    if (!lastData) return [];
    const daily = lastData.daily || [];
    return currentPeriodDays === 7 ? daily.slice(-7) : daily;
  }

  window.switchPeriod = function (days) {
    if (!lastData) return;
    currentPeriodDays = days;
    const daily = lastData.daily || [];
    const slice = days === 7 ? daily.slice(-7) : daily;
    const periodUp = slice.reduce((s, d) => s + d.up, 0);
    const periodDown = slice.reduce((s, d) => s + d.down, 0);
    const periodF = formatBytes(periodUp + periodDown);
    const cards = document.getElementById('trafficCards');
    if (!cards) return;
    const periodCard = cards.querySelector('.period .label');
    const periodValue = cards.querySelector('.period .value');
    const periodDetail = cards.querySelector('.period .detail');
    if (periodCard) periodCard.textContent = days === 7 ? '账号近7天' : '账号近30天';
    if (periodValue) periodValue.innerHTML = `${periodF.value}<span class="unit">${periodF.unit}</span>`;
    const ps = formatSplit(periodUp + periodDown, periodUp, periodDown);
    if (periodDetail) periodDetail.textContent = `↑${ps.upDisp}${ps.total.unit} ↓${ps.downDisp}${ps.total.unit}`;

    // Update chart title and redraw
    const title = document.getElementById('chartTitle');
    if (title) title.textContent = days === 7 ? '近7天趋势' : '近30天趋势';
    drawChart(slice);

    // Update toggle buttons
    document.querySelectorAll('.toggle-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`.toggle-btn[onclick="switchPeriod(${days})"]`)?.classList.add('active');
  };

  window.addEventListener('resize', () => {
    if (!lastData) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      drawChart(getCurrentDaily());
    }, 120);
  });

  // Chart bar positions for tooltip
  let chartBars = [];

  function drawChart(daily) {
    const canvas = document.getElementById('chart');
    if (!canvas || daily.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;
    const padLeft = 50;
    const padRight = 14;
    const padTop = 14;
    const padBottom = 28;
    const chartW = W - padLeft - padRight;
    const chartH = H - padTop - padBottom;

    const values = daily.map(d => d.up + d.down);
    const peak = Math.max(...values, 0);
    const maxVal = Math.max(peak, 1024 * 1024); // at least 1MB scale so small daily usage stays visible

    // Grid lines
    ctx.strokeStyle = 'rgba(108, 92, 231, 0.08)';
    ctx.lineWidth = 0.5;
    ctx.fillStyle = '#3a4255';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';

    for (let i = 0; i <= 3; i++) {
      const y = padTop + (chartH / 3) * i;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(W - padRight, y);
      ctx.stroke();
      const labelVal = maxVal - (maxVal / 3) * i;
      ctx.fillText(formatBytes(labelVal).value + formatBytes(labelVal).unit, padLeft - 6, y + 3);
    }

    // Bars
    const barCount = values.length;
    const barGap = barCount > 15 ? 2 : 8;
    const barW = Math.max(4, (chartW - barGap * (barCount - 1)) / barCount);
    const barColors = ['#6c5ce7', '#a29bfe', '#8c7ae6'];
    chartBars = [];

    values.forEach((v, i) => {
      const barH = Math.max(2, (v / maxVal) * chartH);
      const x = padLeft + i * (barW + barGap);
      const y = padTop + chartH - barH;
      const color = barColors[i % barColors.length];

      // Glow
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, barW, barH);
      ctx.shadowBlur = 0;

      // Date label
      const labelStep = Math.ceil(barCount / 7);
      if (i % labelStep === 0 || i === barCount - 1) {
    ctx.fillStyle = '#8c95a1';
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        const dateStr = daily[i].date ? daily[i].date.slice(5) : '';
        ctx.fillText(dateStr, x + barW / 2, padTop + chartH + 18);
      }

      chartBars.push({ x, y, w: barW, h: barH, date: daily[i].date, up: daily[i].up, down: daily[i].down });
    });

    // Tooltip
    setupChartTooltip(canvas);
  }

  function setupChartTooltip(canvas) {
    const container = canvas.parentElement;
    let tooltip = container.querySelector('#chartTooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'chartTooltip';
      tooltip.className = 'chart-tooltip';
      container.appendChild(tooltip);
    }
    tooltip.style.display = 'none';

    // Remove old listeners by replacing canvas
    const newCanvas = canvas;
    const handler = (e) => {
      const rect = newCanvas.getBoundingClientRect();
      const mx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      const hit = chartBars.find(b => mx >= b.x && mx <= b.x + b.w);
      if (hit) {
        const fb = formatBytes(hit.up + hit.down);
        const upF = formatBytes(hit.up);
        const downF = formatBytes(hit.down);
        tooltip.innerHTML = `<div class="tt-date">${hit.date || ''}</div><div class="tt-total">${fb.value}${fb.unit}</div><div class="tt-detail">↑${upF.value}${upF.unit} ↓${downF.value}${downF.unit}</div>`;
        tooltip.style.display = 'block';
        const tx = Math.min(hit.x + hit.w / 2, rect.width - 120);
        tooltip.style.left = tx + 'px';
        tooltip.style.top = Math.max(0, hit.y - 60) + 'px';
      } else {
        tooltip.style.display = 'none';
      }
    };
    newCanvas.onmousemove = handler;
    newCanvas.ontouchstart = handler;
    newCanvas.onmouseleave = () => { tooltip.style.display = 'none'; };
  }

  window.switchConfigTab = function (tab) {
    const vlessPanel = document.getElementById('vlessPanel');
    const clashPanel = document.getElementById('clashPanel');
    const tabs = document.querySelectorAll('.config-tabs:not(.node-tabs) .config-tab');
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    if (vlessPanel) vlessPanel.style.display = tab === 'vless' ? 'flex' : 'none';
    if (clashPanel) clashPanel.style.display = tab === 'clash' ? 'flex' : 'none';
  };

  // Switch between nodes (CF CDN vs direct REALITY) inside the VLESS panel.
  // Updates the input value, the QR code, and the tab highlight.
  window.switchNode = function (idx) {
    if (!lastData || !Array.isArray(lastData.nodes)) return;
    const node = lastData.nodes[idx];
    if (!node || !node.configLink) return;

    const tabBtns = document.querySelectorAll('.node-tabs .config-tab');
    tabBtns.forEach((btn, i) => btn.classList.toggle('active', i === idx));

    const input = document.getElementById('configInput');
    if (input) input.value = node.configLink;

    try {
      const qr = document.getElementById('qrContainer');
      if (qr) qr.innerHTML = generateQR(node.configLink);
    } catch { /* QR generation failed, ignore */ }
  };

  window.toggleConfig = function () {
    const body = document.getElementById('configBody');
    const arrow = document.getElementById('configArrow');
    if (!body) return;
    if (body.style.display === 'none') {
      body.style.display = 'flex';
      if (arrow) arrow.textContent = '▼';
    } else {
      body.style.display = 'none';
      if (arrow) arrow.textContent = '▶';
    }
  };

  window.copyConfig = function () {
    const input = document.getElementById('configInput');
    if (!input) return;
    navigator.clipboard.writeText(input.value).then(() => {
      const btn = document.querySelector('.config-copy-btn');
      if (btn) { btn.textContent = '已复制 ✓'; setTimeout(() => btn.textContent = '复制链接', 1500); }
      toast('链接已复制，可以直接去客户端粘贴导入', 'success');
    }).catch(() => {
      toast('复制失败，请手动选中链接后复制', 'error');
    });
  };

  window.copyClashConfig = function () {
    const input = document.getElementById('clashConfigUrl');
    if (!input) return;
    navigator.clipboard.writeText(input.value).then(() => {
      const btn = document.querySelector('.config-clash-btn');
      if (btn) { btn.textContent = '已复制 ✓'; setTimeout(() => btn.textContent = '复制订阅', 1500); }
    }).catch(() => {});
  };

  window.importToV2RayN = async function () {
    const input = document.getElementById('configInput');
    if (!input || !input.value) return;

    const link = input.value;
    const btn = document.querySelector('.config-import-btn');

    let copied = false;
    try {
      await navigator.clipboard.writeText(link);
      copied = true;
    } catch (_) {}

    if (btn) {
      btn.textContent = '正在打开...';
      btn.disabled = true;
    }

    try {
      // Best-effort deep link for desktop clients. If the protocol is not
      // registered, users can still paste from clipboard in v2rayN.
      const schemeUrl = `v2rayn://install-config?url=${encodeURIComponent(link)}`;
      const launcher = document.createElement('a');
      launcher.href = schemeUrl;
      launcher.style.display = 'none';
      document.body.appendChild(launcher);
      launcher.click();
      setTimeout(() => launcher.remove(), 1500);
    } catch (_) {}

    toast(
      copied
        ? '已复制链接并尝试打开 v2rayN；回客户端按 Ctrl+V 即可导入'
        : '已尝试打开 v2rayN；若没有弹起，请先注册协议',
      copied ? 'info' : 'error',
      3200
    );

    setTimeout(() => {
      if (btn) {
        btn.textContent = '复制并打开 v2rayN';
        btn.disabled = false;
      }
    }, 1800);
  };

  window.importToClashVerge = async function () {
    const input = document.getElementById('clashConfigUrl');
    if (!input || !input.value) return;

    const url = input.value;
    const btn = document.querySelector('.config-clash-import-btn');

    let copied = false;
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch (_) {}

    if (btn) {
      btn.textContent = '正在打开...';
      btn.disabled = true;
    }

    try {
      const schemeUrl = 'clash://install-config?url=' + encodeURIComponent(url);
      const launcher = document.createElement('a');
      launcher.href = schemeUrl;
      launcher.style.display = 'none';
      document.body.appendChild(launcher);
      launcher.click();
      setTimeout(() => launcher.remove(), 1500);
    } catch (_) {}

    toast(
      copied
        ? '已复制订阅并尝试打开 Clash Verge；若未弹出导入，请确保客户端已在运行后重试'
        : '已尝试打开 Clash Verge；若未弹出导入，请先打开客户端再点一次',
      copied ? 'info' : 'error',
      3500
    );

    setTimeout(() => {
      if (btn) {
        btn.textContent = '导入 Clash Verge';
        btn.disabled = false;
      }
    }, 1800);
  };

  window.openGuide = function () {
    const input = document.getElementById('configInput');
    const link = input ? input.value : '';
    if (link) localStorage.setItem('sharev_guide_link', link);
    if (lastData?.name) localStorage.setItem('sharev_guide_user', lastData.name);
    if (currentToken) localStorage.setItem('sharev_guide_token', currentToken);
    else localStorage.removeItem('sharev_guide_token');
    window.open('/guide.html', '_blank', 'noopener');
  };

  window.openClashGuide = function () {
    const input = document.getElementById('clashConfigUrl');
    const link = input ? input.value : '';
    if (link) localStorage.setItem('sharev_clash_link', link);
    if (lastData?.name) localStorage.setItem('sharev_guide_user', lastData.name);
    if (currentToken) localStorage.setItem('sharev_guide_token', currentToken);
    else localStorage.removeItem('sharev_guide_token');
    window.open('/guide-clash.html', '_blank', 'noopener');
  };

  window.toggleDevices = function () {
    const list = document.getElementById('deviceList');
    const arrow = document.getElementById('deviceArrow');
    if (!list) return;
    if (list.style.display === 'none') {
      list.style.display = 'block';
      if (arrow) arrow.textContent = '▼';
    } else {
      list.style.display = 'none';
      if (arrow) arrow.textContent = '▶';
    }
  };

  window.handleLogout = async function () {
    try {
      await fetch('/api/auth/logout', { ...fetchOpts, method: 'POST' });
    } catch { /* ignore */ }
    currentToken = '';
    mustChangePassword = false;
    localStorage.removeItem('sharev_token');
    const pwdModal = document.getElementById('pwdChangeModal');
    if (pwdModal) pwdModal.remove();
    location.hash = '';
    if (refreshTimer) clearInterval(refreshTimer);
    if (speedPollTimer) clearInterval(speedPollTimer);
    showLogin();
  };

  function showError(msg) {
    showLoadingBar(false);
    document.getElementById('content').innerHTML =
      `<div class="error-msg"><div>错误:: ${esc(msg)}</div><button class="retry-btn" onclick="loadStats()">重试</button></div>`;
  }

  function esc(s) {
    const el = document.createElement('span');
    el.textContent = s;
    return el.innerHTML;
  }

  // QR code generator using QRious library
  function generateQR(text) {
    const renderSize = 512; // render large for accuracy, CSS scales to 140px
    const canvas = document.createElement('canvas');
    canvas.width = renderSize;
    canvas.height = renderSize;
    new QRious({
      element: canvas,
      value: text,
      size: renderSize,
      level: 'M',
      foreground: '#2d3436',
      background: '#ffffff',
    });
    return `<img src="${canvas.toDataURL()}" alt="二维码" class="qr-img" />`;
  }
})();
