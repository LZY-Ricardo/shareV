const { Resend } = require('resend');

let resend = null;
let emailConfig = null;

function init(config) {
  emailConfig = config.email || {};
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY not set. Email service disabled.');
    return;
  }
  resend = new Resend(apiKey);
  console.log('[email] Service initialized');
}

function isEnabled() {
  return !!resend && emailConfig.enabled !== false;
}

function getFrom() {
  return emailConfig.from || 'shareV <onboarding@resend.dev>';
}

// ── Format helpers ──

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 1 ? 2 : 0) + ' ' + units[i];
}

function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function pctColor(pct) {
  if (pct > 90) return '#ff4757';
  if (pct > 70) return '#ffa502';
  return '#00f0ff';
}

function progressBar(pct) {
  const color = pctColor(pct);
  return `
    <div class="bar-track">
      <div style="height:100%;border-radius:4px;background:${color};width:${Math.min(100, pct).toFixed(1)}%"></div>
    </div>`;
}

// ── Shared email styles (neon terminal theme) ──

const baseStyles = `
  <style>
    body { margin: 0; padding: 0; background: #0a0e17; font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; color: #d4dae6; }
    .wrapper { max-width: 560px; margin: 0 auto; padding: 32px 24px; }
    .logo { font-size: 24px; font-weight: 700; color: #00f0ff; margin-bottom: 4px; letter-spacing: 1px; }
    .logo span { color: #4a5568; }
    .subtitle { font-size: 12px; color: #4a5568; margin-bottom: 28px; letter-spacing: 2px; text-transform: uppercase; }
    .greeting { font-size: 16px; color: #eef1f8; margin-bottom: 24px; }
    .section { background: rgba(12, 18, 30, 0.85); border: 1px solid rgba(0, 240, 255, 0.1); border-radius: 8px; padding: 20px; margin-bottom: 16px; }
    .section-title { font-size: 11px; color: #4a5568; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 12px; }
    .stat-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
    .stat-item { text-align: center; }
    .stat-value { font-size: 22px; font-weight: 700; color: #00f0ff; font-family: 'JetBrains Mono', monospace; }
    .stat-value.danger { color: #ff4757; }
    .stat-value.warn { color: #ffa502; }
    .stat-label { font-size: 11px; color: #4a5568; margin-top: 4px; }
    .bar-track { background: rgba(255,255,255,0.06); border-radius: 4px; height: 8px; overflow: hidden; margin: 8px 0; }
    .bar-fill { height: 100%; border-radius: 4px; }
    .bar-fill.ok { background: #00f0ff; }
    .bar-fill.warn { background: #ffa502; }
    .bar-fill.danger { background: #ff4757; }
    .detail-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 13px; }
    .detail-row:last-child { border-bottom: none; }
    .detail-label { color: #4a5568; }
    .detail-value { color: #eef1f8; font-family: 'JetBrains Mono', monospace; font-size: 12px; }
    .link-box { background: rgba(0, 240, 255, 0.06); border: 1px solid rgba(0, 240, 255, 0.15); border-radius: 6px; padding: 12px 16px; margin-top: 12px; word-break: break-all; font-size: 12px; color: #00f0ff; font-family: 'JetBrains Mono', monospace; }
    .link-hint { font-size: 11px; color: #4a5568; margin-top: 6px; }
    .alert-banner { background: rgba(255, 71, 87, 0.12); border: 1px solid rgba(255, 71, 87, 0.3); border-radius: 6px; padding: 12px 16px; margin-bottom: 16px; color: #ff4757; font-size: 14px; font-weight: 500; }
    .alert-banner.warn-banner { background: rgba(255, 165, 2, 0.12); border-color: rgba(255, 165, 2, 0.3); color: #ffa502; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.04); font-size: 11px; color: #2d3748; text-align: center; }
    .footer a { color: #4a5568; text-decoration: none; }
    .compare-up { color: #00f0ff; }
    .compare-down { color: #4a5568; }
  </style>`;

const baseWrapper = (body, title) => `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${baseStyles}</head>
<body>
<div class="wrapper">
  <div class="logo">shareV <span>// ${title}</span></div>
  <div class="subtitle">Traffic Monitoring System</div>
  ${body}
  <div class="footer">
    shareV · 流量监控看板<br>
    此邮件由系统自动发送，请勿回复
  </div>
</div>
</body>
</html>`;

// ── Monthly report email ──

function buildMonthlyHtml(user, stats, publicUrl) {
  const now = new Date();
  // Report is about last calendar month (sent on the 1st)
  const reportMonth = now.getMonth() === 0 ? 12 : now.getMonth(); // 1-indexed
  const reportYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const reportLabel = `${reportYear} 年 ${reportMonth} 月`;

  const node = stats.node || {};
  const hasQuota = node.totalGB && node.totalGB > 0;
  const quotaBytes = hasQuota ? node.totalGB * 1024 ** 3 : 0;
  const usedBytes = (stats.total.up || 0) + (stats.total.down || 0);
  const usedPct = hasQuota ? (usedBytes / quotaBytes) * 100 : 0;

  // Extract last calendar month traffic from DB data
  // DB: thisMonth = current month (just started), lastMonth = from prev month 1st to now
  // So: lastCalendarMonth = lastMonth - thisMonth (the complete previous month)
  const thisUp = stats.thisMonth ? stats.thisMonth.up : 0;
  const thisDown = stats.thisMonth ? stats.thisMonth.down : 0;
  const lastUp = stats.lastMonth ? stats.lastMonth.up : 0;
  const lastDown = stats.lastMonth ? stats.lastMonth.down : 0;
  const monthUp = Math.max(0, lastUp - thisUp);
  const monthDown = Math.max(0, lastDown - thisDown);
  const monthTotal = monthUp + monthDown;

  // No prior month for comparison (would need 3 months of data)

  // Today traffic
  const todayUp = stats.today.up || 0;
  const todayDown = stats.today.down || 0;
  const todayTotal = todayUp + todayDown;

  // Comparison: show thisMonth (current period, just started) for reference
  let compareHtml = '';
  const currentPeriodUp = stats.month ? stats.month.up : 0;
  const currentPeriodDown = stats.month ? stats.month.down : 0;
  const currentPeriodTotal = currentPeriodUp + currentPeriodDown;
  if (currentPeriodTotal > 0) {
    compareHtml = `
      <div class="section">
        <div class="section-title">当前计费周期（x-ui）</div>
        <div class="stat-grid">
          <div class="stat-item">
            <div class="stat-value">${formatBytes(currentPeriodUp)}</div>
            <div class="stat-label">↑ 上传</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">${formatBytes(currentPeriodDown)}</div>
            <div class="stat-label">↓ 下载</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">${formatBytes(currentPeriodTotal)}</div>
            <div class="stat-label">合计</div>
          </div>
        </div>
      </div>`;
  }

  // Quota section
  let quotaHtml = '';
  if (hasQuota) {
    quotaHtml = `
      <div class="section">
        <div class="section-title">配额使用</div>
        ${progressBar(usedPct)}
        <div style="display:flex; justify-content:space-between; font-size:12px;">
          <span>${formatBytes(usedBytes)} 已用</span>
          <span style="color:${pctColor(usedPct)}">${usedPct.toFixed(1)}%</span>
          <span>${formatBytes(quotaBytes)} 总量</span>
        </div>
      </div>`;
  }

  // Expiry section
  let expiryHtml = '';
  if (node.expiryTime && node.expiryTime > 0) {
    const daysLeft = Math.max(0, Math.ceil((node.expiryTime - Date.now()) / (1000 * 60 * 60 * 24)));
    const expDate = new Date(node.expiryTime).toLocaleDateString('zh-CN');
    expiryHtml = `
      <div class="detail-row">
        <span class="detail-label">到期时间</span>
        <span class="detail-value">${expDate}（${daysLeft > 0 ? '剩余 ' + daysLeft + ' 天' : '已到期'}）</span>
      </div>`;
  }

  // Subscription link section
  let subHtml = '';
  const clashUrl = stats.clashConfig && publicUrl
    ? `${publicUrl}/sub/clash?token=${encodeURIComponent(user.token)}`
    : null;
  if (clashUrl) {
    subHtml = `
      <div class="section">
        <div class="section-title">Clash 订阅链接</div>
        <div class="link-box">${clashUrl}</div>
        <div class="link-hint">在 Clash Verge 中添加订阅，或复制链接后打开 Clash Verge 导入</div>
      </div>`;
  }

  // Dashboard link
  let dashHtml = '';
  if (publicUrl && user.token) {
    dashHtml = `
      <div class="section" style="text-align:center;">
        <a href="${publicUrl}/#t=${encodeURIComponent(user.token)}" style="color:#00f0ff; text-decoration:none; font-size:14px;">
          → 查看实时流量看板
        </a>
      </div>`;
  }

  const body = `
    <div class="greeting">Hi ${escHtml(user.name)}，这是你的 ${reportLabel} 流量报告</div>

    ${quotaHtml}

    <div class="section">
      <div class="section-title">本月流量</div>
      <div class="stat-grid">
        <div class="stat-item">
          <div class="stat-value">${formatBytes(monthUp)}</div>
          <div class="stat-label">↑ 上传</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${formatBytes(monthDown)}</div>
          <div class="stat-label">↓ 下载</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${formatBytes(monthTotal)}</div>
          <div class="stat-label">合计</div>
        </div>
      </div>
    </div>

    ${compareHtml}

    <div class="section">
      <div class="section-title">今日流量</div>
      <div class="stat-grid">
        <div class="stat-item">
          <div class="stat-value">${formatBytes(todayUp)}</div>
          <div class="stat-label">↑ 上传</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${formatBytes(todayDown)}</div>
          <div class="stat-label">↓ 下载</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${formatBytes(todayTotal)}</div>
          <div class="stat-label">合计</div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">账号信息</div>
      ${node.remark ? `<div class="detail-row"><span class="detail-label">节点</span><span class="detail-value">${escHtml(node.remark)}</span></div>` : ''}
      <div class="detail-row">
        <span class="detail-label">累计用量</span>
        <span class="detail-value">${formatBytes(usedBytes)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">上传 / 下载</span>
        <span class="detail-value">${formatBytes(stats.total.up || 0)} / ${formatBytes(stats.total.down || 0)}</span>
      </div>
      ${expiryHtml}
    </div>

    ${subHtml}
    ${dashHtml}
  `;

  return baseWrapper(body, '月度报告');
}

// ── Quota / Expiry warning email ──

function buildWarningHtml(user, stats, type) {
  const node = stats.node || {};
  let alertHtml = '';
  let body = '';

  if (type === 'quota') {
    const quotaBytes = node.totalGB * 1024 ** 3;
    const usedBytes = (stats.total.up || 0) + (stats.total.down || 0);
    const usedPct = (usedBytes / quotaBytes) * 100;
    const remainBytes = Math.max(0, quotaBytes - usedBytes);

    alertHtml = `<div class="alert-banner">⚠ 流量预警：已使用 ${usedPct.toFixed(1)}% 配额</div>`;
    body = `
      ${alertHtml}
      <div class="greeting">Hi ${escHtml(user.name)}，你的代理账号流量即将用尽</div>
      <div class="section">
        <div class="section-title">配额状态</div>
        ${progressBar(usedPct)}
        <div style="display:flex; justify-content:space-between; font-size:12px;">
          <span>${formatBytes(usedBytes)} 已用</span>
          <span style="color:${pctColor(usedPct)}">${usedPct.toFixed(1)}%</span>
          <span>${formatBytes(remainBytes)} 剩余</span>
        </div>
      </div>
      <div class="section">
        <div class="section-title">建议</div>
        <div style="font-size:13px; color:#d4dae6; line-height:1.6;">
          流量配额即将用完，如需继续使用请联系管理员充值或升级套餐。
        </div>
      </div>`;
  } else if (type === 'expiry') {
    const daysLeft = Math.max(0, Math.ceil((node.expiryTime - Date.now()) / (1000 * 60 * 60 * 24)));
    const expDate = new Date(node.expiryTime).toLocaleDateString('zh-CN');

    alertHtml = `<div class="alert-banner warn-banner">⏰ 到期预警：剩余 ${daysLeft} 天</div>`;
    body = `
      ${alertHtml}
      <div class="greeting">Hi ${escHtml(user.name)}，你的代理账号即将到期</div>
      <div class="section">
        <div class="section-title">到期信息</div>
        <div class="detail-row">
          <span class="detail-label">到期日期</span>
          <span class="detail-value">${expDate}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">剩余天数</span>
          <span class="detail-value">${daysLeft} 天</span>
        </div>
      </div>
      <div class="section">
        <div class="section-title">建议</div>
        <div style="font-size:13px; color:#d4dae6; line-height:1.6;">
          账号即将到期，如需继续使用请联系管理员续费。
        </div>
      </div>`;
  }

  return baseWrapper(body, '预警通知');
}

// ── Test email ──

function buildTestHtml(user) {
  const body = `
    <div class="greeting">Hi ${escHtml(user.name)}，这是一封测试邮件</div>
    <div class="section">
      <div class="section-title">邮件服务状态</div>
      <div style="text-align:center; padding:20px 0;">
        <div style="font-size:28px; color:#00f0ff;">✓ 正常</div>
        <div style="font-size:12px; color:#4a5568; margin-top:8px;">
          shareV 邮件通知服务已成功配置
        </div>
      </div>
    </div>`;

  return baseWrapper(body, '测试邮件');
}

// ── Send functions ──

async function sendEmail(to, subject, html) {
  if (!resend) throw new Error('Email service not initialized');
  const { data, error } = await resend.emails.send({
    from: getFrom(),
    to: [to],
    subject,
    html,
  });
  if (error) throw error;
  return data;
}

async function sendMonthlyReport(user, stats, publicUrl) {
  if (!user.notifyEmail) return null;
  const now = new Date();
  const reportMonth = now.getMonth() === 0 ? 12 : now.getMonth();
  const reportYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const subject = `shareV · ${reportYear} 年 ${reportMonth} 月流量报告`;
  const html = buildMonthlyHtml(user, stats, publicUrl);
  return sendEmail(user.notifyEmail, subject, html);
}

async function sendQuotaWarning(user, stats, type) {
  if (!user.notifyEmail) return null;
  const subject = type === 'quota'
    ? 'shareV · 流量预警：配额即将用尽'
    : 'shareV · 到期预警：账号即将到期';
  const html = buildWarningHtml(user, stats, type);
  return sendEmail(user.notifyEmail, subject, html);
}

async function sendTestEmail(user) {
  if (!user.notifyEmail) throw new Error('用户未配置邮箱地址');
  const html = buildTestHtml(user);
  return sendEmail(user.notifyEmail, 'shareV · 测试邮件', html);
}

module.exports = {
  init,
  isEnabled,
  sendMonthlyReport,
  sendQuotaWarning,
  sendTestEmail,
};
