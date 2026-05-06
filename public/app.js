(function () {
  let refreshTimer = null;
  let currentName = '';

  const savedName = localStorage.getItem('sharev_name');
  if (location.hash) {
    currentName = decodeURIComponent(location.hash.slice(1));
  } else if (savedName) {
    currentName = savedName;
  }

  if (currentName) {
    showDashboard();
  } else {
    showLogin();
  }

  function showLogin() {
    document.getElementById('userName').textContent = 'shareV';
    document.getElementById('updateTime').textContent = 'TRAFFIC MONITORING SYSTEM';
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
        <div class="login-title">输入用户名以查看流量数据</div>
        <div class="login-form">
          <input type="text" id="nameInput" placeholder="用户名" autocomplete="off" spellcheck="false" />
          <button id="loginBtn" onclick="handleLogin()">GO</button>
        </div>
      </div>`;
    const input = document.getElementById('nameInput');
    input.focus();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleLogin();
    });
  }

  window.handleLogin = function () {
    const name = document.getElementById('nameInput').value.trim();
    if (!name) return;
    currentName = name;
    localStorage.setItem('sharev_name', name);
    location.hash = encodeURIComponent(name);
    showDashboard();
  };

  function showDashboard() {
    loadStats();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(loadStats, 120000);
  }

  async function loadStats() {
    try {
      const res = await fetch(`/api/stats?name=${encodeURIComponent(currentName)}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '请求失败');
      }
      const data = await res.json();
      render(data);
    } catch (err) {
      showError(err.message);
    }
  }

  function formatBytes(bytes) {
    if (bytes === 0) return { value: '0', unit: 'B' };
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const value = (bytes / Math.pow(1024, i)).toFixed(i > 1 ? 2 : 0);
    return { value, unit: units[i] };
  }

  function sumTraffic(up, down) {
    return formatBytes(up + down);
  }

  function render(data) {
    document.getElementById('userName').textContent = data.name;
    const ts = new Date().toLocaleString('zh-CN');
    document.getElementById('updateTime').innerHTML =
      `LAST_SYNC ${ts} <a href="#" class="back-link" onclick="handleLogout()">[切换]</a>`;

    const node = data.node || {};
    const online = data.online || false;
    const devices = data.devices || 0;
    const deviceList = data.deviceList || [];

    let html = '';

    // Node info bar
    html += '<div class="node-bar">';
    if (node.remark) {
      html += `<span class="tag">${esc(node.protocol || 'vless')}</span>`;
      html += `<span class="node-name">${esc(node.remark)}</span>`;
    }
    html += `<span class="device-count" onclick="toggleDevices()">`;
    html += `<span class="dot ${online ? 'online' : 'offline'}"></span>`;
    if (online && devices > 0) {
      html += `${devices} DEVICE${devices !== 1 ? 'S' : ''} <span class="expand-arrow" id="deviceArrow">▶</span>`;
    } else {
      html += `${online ? 'ONLINE' : 'OFFLINE'}`;
    }
    html += `</span>`;
    html += '</div>';

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

    // Traffic cards
    const today = sumTraffic(data.today.up, data.today.down);
    const month = sumTraffic(data.month.up, data.month.down);
    const total = sumTraffic(data.total.up, data.total.down);

    html += '<div class="cards">';
    html += card('TODAY', today, 'today', data.today.up, data.today.down);
    html += card('MONTH', month, 'month', data.month.up, data.month.down);
    html += card('TOTAL', total, 'total', data.total.up, data.total.down);
    html += '</div>';

    // Chart
    html += '<div class="chart-section">';
    html += '<div class="title">7 DAY TREND</div>';
    html += '<div class="chart-container"><canvas id="chart"></canvas></div>';
    html += '</div>';

    document.getElementById('content').innerHTML = html;

    if (data.daily && data.daily.length > 0) {
      drawChart(data.daily);
    }
  }

  function card(label, formatted, cls, up, down) {
    const upF = formatBytes(up);
    const downF = formatBytes(down);
    return `
      <div class="card ${cls}">
        <div class="label">${label}</div>
        <div class="value">${formatted.value}<span class="unit">${formatted.unit}</span></div>
        <div class="detail">↑${upF.value}${upF.unit} ↓${downF.value}${downF.unit}</div>
      </div>`;
  }

  function drawChart(daily) {
    const canvas = document.getElementById('chart');
    if (!canvas) return;

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
    const maxVal = Math.max(...values, 1024 * 1024 * 100);

    // Grid lines
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.06)';
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
      const val = maxVal * (1 - i / 3);
      const fb = formatBytes(val);
      ctx.fillText(fb.value + fb.unit, padLeft - 8, y + 4);
    }

    // Bars
    const barCount = daily.length;
    const barGap = 8;
    const barWidth = (chartW - barGap * (barCount + 1)) / barCount;

    daily.forEach((d, i) => {
      const val = d.up + d.down;
      const barH = (val / maxVal) * chartH;
      const x = padLeft + barGap + i * (barWidth + barGap);
      const y = padTop + chartH - barH;

      // Bar gradient
      const grad = ctx.createLinearGradient(x, y, x, padTop + chartH);
      grad.addColorStop(0, 'rgba(0, 240, 255, 0.9)');
      grad.addColorStop(0.5, 'rgba(14, 165, 160, 0.6)');
      grad.addColorStop(1, 'rgba(14, 165, 160, 0.15)');
      ctx.fillStyle = grad;

      const r = Math.min(4, barWidth / 2, Math.max(0, barH / 2));
      if (barH > 1) {
        ctx.beginPath();
        ctx.moveTo(x, padTop + chartH);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.lineTo(x + barWidth - r, y);
        ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + r);
        ctx.lineTo(x + barWidth, padTop + chartH);
        ctx.closePath();
        ctx.fill();

        // Top glow
        ctx.save();
        ctx.shadowColor = 'rgba(0, 240, 255, 0.3)';
        ctx.shadowBlur = 8;
        ctx.fillStyle = 'rgba(0, 240, 255, 0.5)';
        ctx.fillRect(x + 2, y, barWidth - 4, 1);
        ctx.restore();
      }

      // Date label
      ctx.fillStyle = '#3a4255';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(d.date.slice(5), x + barWidth / 2, H - 6);
    });
  }

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

  window.handleLogout = function () {
    currentName = '';
    localStorage.removeItem('sharev_name');
    location.hash = '';
    if (refreshTimer) clearInterval(refreshTimer);
    showLogin();
  };

  function showError(msg) {
    document.getElementById('content').innerHTML =
      `<div class="error-msg">ERR:: ${esc(msg)}</div>`;
  }

  function esc(s) {
    const el = document.createElement('span');
    el.textContent = s;
    return el.innerHTML;
  }
})();
