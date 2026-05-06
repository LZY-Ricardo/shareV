(function () {
  let refreshTimer = null;
  let currentToken = '';

  const savedToken = localStorage.getItem('sharev_token');
  currentToken = readTokenFromHash() || savedToken || '';

  if (currentToken) {
    showDashboard();
  } else {
    showLogin();
  }

  function readTokenFromHash() {
    if (!location.hash) return '';
    const raw = decodeURIComponent(location.hash.slice(1));
    if (raw.startsWith('t=')) {
      return new URLSearchParams(raw).get('t') || '';
    }
    return raw;
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
        <div class="login-title">输入访问码以查看流量数据</div>
        <div class="login-form">
          <input type="text" id="tokenInput" placeholder="访问码" autocomplete="off" spellcheck="false" />
          <button id="loginBtn" onclick="handleLogin()">GO</button>
        </div>
      </div>`;
    const input = document.getElementById('tokenInput');
    input.focus();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleLogin();
    });
  }

  window.handleLogin = function () {
    const token = document.getElementById('tokenInput').value.trim();
    if (!token) return;
    currentToken = token;
    localStorage.setItem('sharev_token', token);
    location.hash = `t=${encodeURIComponent(token)}`;
    showDashboard();
  };

  function showDashboard() {
    loadStats();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(loadStats, 120000);
  }

  async function loadStats() {
    showLoadingBar(true);
    try {
      const res = await fetch(`/api/stats?token=${encodeURIComponent(currentToken)}`);
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

    // Node info bar
    html += '<div class="node-bar">';
    if (node.remark) {
      html += `<span class="tag">${esc(node.protocol || 'vless')}</span>`;
      html += `<span class="node-name">${esc(node.remark)}</span>`;
    }
    html += `<span class="device-count" onclick="toggleDevices()">`;
    html += `<span class="dot ${online ? 'online' : 'offline'}"></span>`;
    const limitIp = node.limitIp || 0;
    if (online && devices > 0) {
      const atLimit = limitIp > 0 && devices >= limitIp;
      html += `<span class="${atLimit ? 'device-at-limit' : ''}">${devices} DEVICE${devices !== 1 ? 'S' : ''}</span>`;
      html += ` <span class="expand-arrow" id="deviceArrow">▶</span>`;
    } else {
      html += `${online ? 'ONLINE' : 'OFFLINE'}`;
    }
    if (limitIp > 0) {
      html += `<span class="device-limit-hint">上限 ${limitIp} 台</span>`;
    }
    html += `</span>`;
    html += '</div>';

    // Quota progress bar
    if (node.totalGB && node.totalGB > 0) {
      const totalBytes = node.totalGB * (1024 ** 3);
      const usedBytes = data.total.up + data.total.down;
      const pct = Math.min(100, (usedBytes / totalBytes) * 100);
      const usedF = formatBytes(usedBytes);
      const cls = pct > 90 ? 'danger' : pct > 70 ? 'warn' : '';

      html += '<div class="quota-section">';
      html += '<div class="quota-bar">';
      html += `<div class="quota-fill ${cls}" style="width:${pct.toFixed(1)}%"></div>`;
      html += '</div>';
      html += '<div class="quota-info">';
      html += `<span>${usedF.value}${usedF.unit} / ${node.totalGB} GB</span>`;
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
    html += '<div class="title" id="chartTitle">7 DAY TREND</div>';
    html += '<div class="chart-container"><canvas id="chart"></canvas></div>';
    html += '</div>';

    // Config link panel (bottom)
    if (data.configLink) {
      html += '<div class="config-section">';
      html += '<div class="config-header" onclick="toggleConfig()">';
      html += '<span class="config-title">连接配置</span>';
      html += '<span class="expand-arrow" id="configArrow">▶</span>';
      html += '</div>';
      html += '<div class="config-body" id="configBody" style="display:none">';
      html += `<input type="text" class="config-link" id="configInput" value="${esc(data.configLink)}" readonly onclick="this.select()" />`;
      html += '<button class="config-copy-btn" onclick="copyConfig()">复制链接</button>';
      html += '<div class="qr-container" id="qrContainer"></div>';
      html += '<div class="config-hint">复制链接后在代理客户端中导入，或扫描二维码</div>';
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

    // Render QR code if config link exists
    if (data.configLink) {
      try {
        const qrContainer = document.getElementById('qrContainer');
        if (qrContainer) qrContainer.innerHTML = generateQR(data.configLink);
      } catch (e) { /* QR generation failed, ignore */ }
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

  // Store last data for period switching
  let lastData = null;
  let currentPeriodDays = 7;
  let resizeTimer = null;
  const origRender = render;
  render = function(data) {
    lastData = data;
    currentPeriodDays = 7;
    origRender(data);
  };

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
    const upF = formatBytes(periodUp);
    const downF = formatBytes(periodDown);
    if (periodDetail) periodDetail.textContent = `↑${upF.value}${upF.unit} ↓${downF.value}${downF.unit}`;

    // Update chart title and redraw
    const title = document.getElementById('chartTitle');
    if (title) title.textContent = days === 7 ? '7 DAY TREND' : '30 DAY TREND';
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
      const labelVal = maxVal - (maxVal / 3) * i;
      ctx.fillText(formatBytes(labelVal).value + formatBytes(labelVal).unit, padLeft - 6, y + 3);
    }

    // Bars
    const barCount = values.length;
    const barGap = barCount > 15 ? 2 : 8;
    const barW = Math.max(4, (chartW - barGap * (barCount - 1)) / barCount);
    const barColors = ['#00f0ff', '#00c8ff', '#0096ff'];
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
        ctx.fillStyle = '#3a4255';
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
    }).catch(() => {});
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

  window.handleLogout = function () {
    currentToken = '';
    localStorage.removeItem('sharev_token');
    location.hash = '';
    if (refreshTimer) clearInterval(refreshTimer);
    showLogin();
  };

  function showError(msg) {
    showLoadingBar(false);
    document.getElementById('content').innerHTML =
      `<div class="error-msg"><div>ERR:: ${esc(msg)}</div><button class="retry-btn" onclick="loadStats()">重试</button></div>`;
  }

  function esc(s) {
    const el = document.createElement('span');
    el.textContent = s;
    return el.innerHTML;
  }

  // QR code generator using QRious library
  function generateQR(text) {
    const canvas = document.createElement('canvas');
    new QRious({
      element: canvas,
      value: text,
      size: 160,
      level: 'M',
      background: '#ffffff',
      foreground: '#000000',
      padding: 8,
    });
    return `<img src="${canvas.toDataURL()}" alt="QR Code" width="160" height="160" />`;
  }
})();
