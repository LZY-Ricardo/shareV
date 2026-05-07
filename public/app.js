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
      const hasClash = !!data.clashConfigUrl;
      html += '<div class="config-section">';
      html += '<div class="config-header" onclick="toggleConfig()">';
      html += '<span class="config-title">连接配置</span>';
      html += '<span class="expand-arrow" id="configArrow">▶</span>';
      html += '</div>';
      html += '<div class="config-body" id="configBody" style="display:none">';

      // Tab bar
      if (hasClash) {
        html += '<div class="config-tabs">';
        html += '<button class="config-tab active" data-tab="vless" onclick="switchConfigTab(\'vless\')">VLESS</button>';
        html += '<button class="config-tab" data-tab="clash" onclick="switchConfigTab(\'clash\')">Clash</button>';
        html += '</div>';
      }

      // VLESS panel
      html += '<div class="config-panel" id="vlessPanel">';
      html += `<input type="text" class="config-link" id="configInput" value="${esc(data.configLink)}" readonly onclick="this.select()" />`;
      html += '<div class="config-actions">';
      html += '<button class="config-copy-btn" onclick="copyConfig()">复制链接</button>';
      html += '<button class="config-import-btn" onclick="importToV2RayN()">导入 v2rayN</button>';
      html += '<button class="config-help-btn" onclick="toggleImportGuide()">注册协议教程</button>';
      html += '</div>';
      html += '<div class="config-guide" id="configGuide" style="display:none">';
      html += '<div class="guide-title">v2rayN 导入与协议注册</div>';
      html += '<div class="guide-step">1. 先点"导入 v2rayN"。如果客户端已注册 `v2rayn://` 协议，会自动弹起导入。</div>';
      html += '<div class="guide-step">2. 如果没有自动打开，说明本机还没注册协议。你仍然可以先点"复制链接"，回到 v2rayN 里粘贴导入。</div>';
      html += '<div class="guide-step">3. 想启用一键导入时，在 Windows PowerShell 里执行下面这段命令。先把第一行的 v2rayN 路径改成你自己的。</div>';
      html += '<textarea class="guide-code" readonly onclick="this.select()" id="guideCode">$exe = "C:\\Path\\To\\v2rayN\\v2rayN.exe"\n\nNew-Item -Path "HKCU:\\Software\\Classes\\v2rayn" -Force | Out-Null\nSet-ItemProperty -Path "HKCU:\\Software\\Classes\\v2rayn" -Name "(default)" -Value "URL:v2rayN Protocol"\nNew-ItemProperty -Path "HKCU:\\Software\\Classes\\v2rayn" -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null\n\nNew-Item -Path "HKCU:\\Software\\Classes\\v2rayn\\DefaultIcon" -Force | Out-Null\nSet-ItemProperty -Path "HKCU:\\Software\\Classes\\v2rayn\\DefaultIcon" -Name "(default)" -Value "\\`"$exe\\`",0"\n\nNew-Item -Path "HKCU:\\Software\\Classes\\v2rayn\\shell\\open\\command" -Force | Out-Null\nSet-ItemProperty -Path "HKCU:\\Software\\Classes\\v2rayn\\shell\\open\\command" -Name "(default)" -Value "\\`"$exe\\`" \\`"%1\\`""</textarea>';
      html += '<div class="guide-actions">';
      html += '<button class="guide-copy-btn" onclick="copyGuideCode()">复制教程命令</button>';
      html += '</div>';
      html += '<div class="guide-note">执行后重启 v2rayN，再回来点"导入 v2rayN"即可。</div>';
      html += '</div>';
      html += '<div class="qr-container" id="qrContainer"></div>';
      html += '<div class="config-hint">可扫描二维码导入 · <a href="https://github.com/2dust/v2rayN/releases" target="_blank" rel="noopener" class="config-dl">下载 v2rayN</a></div>';
      html += '</div>';

      // Clash panel
      if (hasClash) {
        html += '<div class="config-panel" id="clashPanel" style="display:none">';
        html += '<input type="text" class="config-link" id="clashConfigUrl" value="' + esc(data.clashConfigUrl) + '" readonly onclick="this.select()" />';
        html += '<div class="config-actions">';
        html += '<button class="config-clash-btn" onclick="copyClashConfig()">复制订阅</button>';
        html += '<button class="config-clash-import-btn" onclick="importToClashVerge()">导入 Clash Verge</button>';
        html += '</div>';
        html += '<div class="qr-container" id="qrContainerClash"></div>';
        html += '<div class="config-hint">也可扫描二维码导入 · <a href="https://github.com/clash-verge-rev/clash-verge-rev/releases" target="_blank" rel="noopener" class="config-dl">下载 Clash Verge</a></div>';
        html += '</div>';
      }

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
      const res = await fetch(`/api/speed?token=${encodeURIComponent(currentToken)}`);
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

  window.switchConfigTab = function (tab) {
    const vlessPanel = document.getElementById('vlessPanel');
    const clashPanel = document.getElementById('clashPanel');
    const tabs = document.querySelectorAll('.config-tab');
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    if (vlessPanel) vlessPanel.style.display = tab === 'vless' ? 'flex' : 'none';
    if (clashPanel) clashPanel.style.display = tab === 'clash' ? 'flex' : 'none';
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
    }).catch(() => {});
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

    try {
      await navigator.clipboard.writeText(link);
    } catch (_) {}

    if (btn) {
      btn.textContent = '正在打开...';
      btn.disabled = true;
    }

    try {
      // Best-effort deep link for desktop clients. If the protocol is not
      // registered, users can still paste from clipboard in v2rayN.
      const schemeUrl = `v2rayn://install-config?url=${encodeURIComponent(link)}`;
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = schemeUrl;
      document.body.appendChild(iframe);
      setTimeout(() => iframe.remove(), 1500);
    } catch (_) {}

    setTimeout(() => {
      if (btn) {
        btn.textContent = '导入 v2rayN';
        btn.disabled = false;
      }
    }, 1800);
  };

  window.importToClashVerge = async function () {
    const input = document.getElementById('clashConfigUrl');
    if (!input || !input.value) return;

    const url = input.value;
    const btn = document.querySelector('.config-clash-import-btn');

    try {
      await navigator.clipboard.writeText(url);
    } catch (_) {}

    if (btn) {
      btn.textContent = '正在打开...';
      btn.disabled = true;
    }

    try {
      const schemeUrl = 'clash://install-config?url=' + encodeURIComponent(url);
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = schemeUrl;
      document.body.appendChild(iframe);
      setTimeout(() => iframe.remove(), 1500);
    } catch (_) {}

    setTimeout(() => {
      if (btn) {
        btn.textContent = '导入 Clash Verge';
        btn.disabled = false;
      }
    }, 1800);
  }; = function () {
    const guide = document.getElementById('configGuide');
    const btn = document.querySelector('.config-help-btn');
    if (!guide) return;
    const opening = guide.style.display === 'none';
    guide.style.display = opening ? 'block' : 'none';
    if (btn) btn.textContent = opening ? '收起教程' : '注册协议教程';
  };

  window.copyGuideCode = async function () {
    const code = document.getElementById('guideCode');
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.value);
      const btn = document.querySelector('.guide-copy-btn');
      if (btn) {
        btn.textContent = '已复制 ✓';
        setTimeout(() => btn.textContent = '复制教程命令', 1500);
      }
    } catch (_) {}
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
    if (speedPollTimer) clearInterval(speedPollTimer);
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
    const renderSize = 512; // render large for accuracy, CSS scales to 140px
    const canvas = document.createElement('canvas');
    canvas.width = renderSize;
    canvas.height = renderSize;
    new QRious({
      element: canvas,
      value: text,
      size: renderSize,
      level: 'M',
      foreground: '#000000',
      background: '#ffffff',
    });
    return `<img src="${canvas.toDataURL()}" alt="QR Code" class="qr-img" />`;
  }
})();
