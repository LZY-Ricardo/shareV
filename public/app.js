(function () {
  let refreshTimer = null;
  let currentName = '';

  // Check URL hash for pre-filled name
  if (location.hash) {
    currentName = decodeURIComponent(location.hash.slice(1));
  }

  if (currentName) {
    showDashboard();
  } else {
    showLogin();
  }

  function showLogin() {
    document.getElementById('userName').textContent = '流量看板';
    document.getElementById('updateTime').textContent = '输入你的用户名查看流量信息';
    document.getElementById('content').innerHTML = `
      <div class="login-box">
        <div class="login-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
        </div>
        <div class="login-form">
          <input type="text" id="nameInput" placeholder="输入你的用户名" autocomplete="off" spellcheck="false" />
          <button id="loginBtn" onclick="handleLogin()">查 询</button>
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
    document.getElementById('userName').textContent = `${data.name} 的流量看板`;
    document.getElementById('updateTime').innerHTML =
      `更新于 ${new Date().toLocaleString('zh-CN')} <a href="#" class="back-link" onclick="handleLogout()">切换用户</a>`;

    const node = data.node || {};
    const devices = data.devices || 0;

    let html = '';

    // Node info bar
    html += '<div class="node-bar">';
    if (node.remark) {
      html += `<span class="tag">${esc(node.protocol || 'VLESS')} : ${node.port || ''}</span>`;
      html += `<span>${esc(node.remark)}</span>`;
    }
    html += `<span class="device-count">`;
    html += `<span class="dot ${devices > 0 ? '' : 'offline'}"></span>`;
    html += `${devices} 台设备`;
    html += `</span>`;
    html += '</div>';

    // Traffic cards
    const today = sumTraffic(data.today.up, data.today.down);
    const month = sumTraffic(data.month.up, data.month.down);
    const total = sumTraffic(data.total.up, data.total.down);

    html += '<div class="cards">';
    html += card('今日', today, 'today', data.today.up, data.today.down);
    html += card('本月', month, 'month', data.month.up, data.month.down);
    html += card('总计', total, 'total', data.total.up, data.total.down);
    html += '</div>';

    // Chart
    html += '<div class="chart-section">';
    html += '<div class="title">最近 7 天流量趋势</div>';
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
        <div class="detail">↑ ${upF.value}${upF.unit} / ↓ ${downF.value}${downF.unit}</div>
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
    const padLeft = 48;
    const padRight = 12;
    const padTop = 12;
    const padBottom = 28;
    const chartW = W - padLeft - padRight;
    const chartH = H - padTop - padBottom;

    const values = daily.map(d => d.up + d.down);
    const maxVal = Math.max(...values, 1024 * 1024 * 100);

    ctx.strokeStyle = '#2a2d3a';
    ctx.lineWidth = 0.5;
    ctx.fillStyle = '#8b8d98';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';

    for (let i = 0; i <= 3; i++) {
      const y = padTop + (chartH / 3) * i;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(W - padRight, y);
      ctx.stroke();
      const val = maxVal * (1 - i / 3);
      const fb = formatBytes(val);
      ctx.fillText(fb.value + fb.unit, padLeft - 6, y + 3);
    }

    const barCount = daily.length;
    const barGap = 8;
    const barWidth = (chartW - barGap * (barCount + 1)) / barCount;

    daily.forEach((d, i) => {
      const val = d.up + d.down;
      const barH = (val / maxVal) * chartH;
      const x = padLeft + barGap + i * (barWidth + barGap);
      const y = padTop + chartH - barH;

      const grad = ctx.createLinearGradient(x, y, x, padTop + chartH);
      grad.addColorStop(0, '#6366f1');
      grad.addColorStop(1, '#3b82f6');
      ctx.fillStyle = grad;

      const r = Math.min(4, barWidth / 2, barH / 2);
      if (barH > 0) {
        ctx.beginPath();
        ctx.moveTo(x, padTop + chartH);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.lineTo(x + barWidth - r, y);
        ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + r);
        ctx.lineTo(x + barWidth, padTop + chartH);
        ctx.closePath();
        ctx.fill();
      }

      ctx.fillStyle = '#8b8d98';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(d.date.slice(5), x + barWidth / 2, H - 6);
    });
  }

  window.handleLogout = function () {
    currentName = '';
    location.hash = '';
    if (refreshTimer) clearInterval(refreshTimer);
    showLogin();
  };

  function showError(msg) {
    document.getElementById('content').innerHTML =
      `<div class="error-msg">${esc(msg)}</div>`;
  }

  function esc(s) {
    const el = document.createElement('span');
    el.textContent = s;
    return el.innerHTML;
  }
})();
