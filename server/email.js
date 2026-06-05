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
  if (pct > 90) return '#ef4444';
  if (pct > 70) return '#f59e0b';
  return '#0891b2';
}

// ── Fresh inline-style building blocks (Gmail-safe) ──

const PRIMARY = '#0891b2';
const PRIMARY_LIGHT = '#e0f7fa';
const BG = '#f0f4f8';
const WHITE = '#ffffff';
const CARD = '#ffffff';
const TEXT_DARK = '#1e293b';
const TEXT = '#334155';
const TEXT_LIGHT = '#64748b';
const TEXT_MUTED = '#94a3b8';
const BORDER = '#e2e8f0';
const BORDER_LIGHT = '#f1f5f9';

function wrapperStart(title) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${BG};">
<table width="100%" cellpadding="0" cellspacing="0" style="background:${BG};"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

<!-- Header bar -->
<tr><td style="background:${PRIMARY};padding:24px 20px;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:0.5px;">shareV</td>
    <td style="text-align:right;font-family:-apple-system,sans-serif;font-size:11px;color:rgba(255,255,255,0.7);letter-spacing:1px;text-transform:uppercase;">${title}</td>
  </tr></table>
</td></tr>

<!-- Spacer -->
<tr><td style="height:24px;background:${BG};"></td></tr>

<!-- Content area -->
<tr><td style="padding:0 24px;">`;
}

const wrapperEnd = `
</td></tr>

<!-- Footer -->
<tr><td style="padding:32px 24px 24px 24px;text-align:center;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="border-top:1px solid ${BORDER};padding-top:16px;font-family:-apple-system,sans-serif;font-size:11px;color:${TEXT_MUTED};text-align:center;">
      shareV · 流量监控看板<br>此邮件由系统自动发送，请勿回复
    </td></tr>
  </table>
</td></tr>

</table>
</td></tr></table>
</body></html>`;

function greeting(text) {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;"><tr>
<td style="font-family:-apple-system,'Helvetica Neue',sans-serif;font-size:15px;color:${TEXT};line-height:1.6;">${text}</td>
</tr></table>`;
}

function sectionStart(title) {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;background:${CARD};border:1px solid ${BORDER};border-radius:8px;">
<tr><td style="padding:16px 16px;">
${title ? `<div style="font-family:-apple-system,sans-serif;font-size:11px;font-weight:600;color:${PRIMARY};text-transform:uppercase;letter-spacing:1.5px;padding-bottom:14px;">${title}</div>` : ''}`;
}

const sectionEnd = `</td></tr></table>`;

function statGrid(items) {
  const cols = items.length;
  let rows = `<table width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;"><tr>`;
  for (const item of items) {
    const color = item.color || TEXT_DARK;
    rows += `<td style="text-align:center;vertical-align:top;padding:4px 4px;">
      <div style="font-family:'Courier New',Courier,monospace;font-size:18px;font-weight:700;color:${color};line-height:1.2;">${item.value}</div>
      <div style="font-family:-apple-system,sans-serif;font-size:10px;color:${TEXT_LIGHT};padding-top:4px;">${item.label}</div>
    </td>`;
  }
  rows += '</tr></table>';
  return rows;
}

function progressBar(pct) {
  const color = pctColor(pct);
  const bgColor = '#e2e8f0';
  const fillWidth = Math.min(100, pct).toFixed(1);
  const emptyWidth = (100 - Math.min(100, pct)).toFixed(1);
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:10px 0;">
<tr>
  <td width="${fillWidth}%" style="background:${color};height:8px;border-radius:6px 0 0 6px;font-size:0;line-height:0;">&nbsp;</td>
  <td width="${emptyWidth}%" style="background:${bgColor};height:8px;border-radius:0 6px 6px 0;font-size:0;line-height:0;">&nbsp;</td>
</tr>
</table>`;
}

function detailRow(label, value, isLast) {
  const borderBottom = isLast ? 'none' : `1px solid ${BORDER_LIGHT}`;
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-bottom:${borderBottom};"><tr>
<td style="padding:8px 0;font-family:-apple-system,sans-serif;font-size:13px;color:${TEXT_LIGHT};">${label}</td>
<td style="padding:8px 0;text-align:right;font-family:'Courier New',Courier,monospace;font-size:13px;color:${TEXT_DARK};">${value}</td>
</tr></table>`;
}

function linkBox(url) {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;background:${PRIMARY_LIGHT};border:1px solid #b2ebf2;border-radius:6px;">
<tr><td style="padding:12px 16px;font-family:'Courier New',monospace;font-size:12px;color:#00695c;word-break:break-all;line-height:1.5;">${url}</td></tr>
</table>`;
}

function alertBanner(text, type) {
  const bg = type === 'expiry' ? '#fef3c7' : '#fee2e2';
  const border = type === 'expiry' ? '#fbbf24' : '#fca5a5';
  const color = type === 'expiry' ? '#92400e' : '#991b1b';
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;background:${bg};border:1px solid ${border};border-radius:8px;">
<tr><td style="padding:12px 16px;font-family:-apple-system,sans-serif;font-size:13px;font-weight:600;color:${color};">${text}</td></tr>
</table>`;
}

// ── Monthly report email ──

function buildMonthlyHtml(user, stats, publicUrl) {
  const now = new Date();
  // Calendar month billing cycle (1st of each month)
  const periodLabel = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月`;

  const node = stats.node || {};
  const hasQuota = node.totalGB && node.totalGB > 0;
  const quotaBytes = hasQuota ? node.totalGB * 1024 ** 3 : 0;

  // Use billing period traffic for quota display (matches 100GB/month limit)
  const monthUp = stats.thisMonth ? stats.thisMonth.up : 0;
  const monthDown = stats.thisMonth ? stats.thisMonth.down : 0;
  const monthTotal = monthUp + monthDown;
  const usedPct = hasQuota ? (monthTotal / quotaBytes) * 100 : 0;

  // All-time total for reference
  const totalUp = stats.total.up || 0;
  const totalDown = stats.total.down || 0;
  const totalBytes = totalUp + totalDown;

  const todayUp = stats.today.up || 0;
  const todayDown = stats.today.down || 0;
  const todayTotal = todayUp + todayDown;

  const curUp = stats.month ? stats.month.up : 0;
  const curDown = stats.month ? stats.month.down : 0;
  const curTotal = curUp + curDown;

  let p = [];
  p.push(wrapperStart('月度报告'));
  p.push(greeting(`Hi <strong style="color:${TEXT_DARK};">${escHtml(user.name)}</strong>，这是你的 <strong style="color:${TEXT_DARK};">${periodLabel}</strong> 流量报告`));

  // Quota
  if (hasQuota) {
    p.push(sectionStart('配额使用'));
    p.push(progressBar(usedPct));
    p.push(`<table width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font-family:-apple-system,sans-serif;font-size:12px;color:${TEXT_LIGHT};">${formatBytes(monthTotal)} 已用</td>
<td style="text-align:center;font-family:'Courier New',Courier,monospace;font-size:12px;font-weight:600;color:${pctColor(usedPct)};">${usedPct.toFixed(1)}%</td>
<td style="text-align:right;font-family:-apple-system,sans-serif;font-size:12px;color:${TEXT_LIGHT};">${formatBytes(quotaBytes)} 总量</td>
</tr></table>`);
    p.push(sectionEnd);
  }

  // Monthly traffic
  p.push(sectionStart('本月流量'));
  p.push(statGrid([
    { value: formatBytes(monthUp), label: '↑ 上传' },
    { value: formatBytes(monthDown), label: '↓ 下载' },
    { value: formatBytes(monthTotal), label: '合计' },
  ]));
  p.push(sectionEnd);

  // Current billing period
  if (curTotal > 0) {
    p.push(sectionStart('当前计费周期'));
    p.push(statGrid([
      { value: formatBytes(curUp), label: '↑ 上传' },
      { value: formatBytes(curDown), label: '↓ 下载' },
      { value: formatBytes(curTotal), label: '合计' },
    ]));
    p.push(sectionEnd);
  }

  // Today traffic
  p.push(sectionStart('今日流量'));
  p.push(statGrid([
    { value: formatBytes(todayUp), label: '↑ 上传' },
    { value: formatBytes(todayDown), label: '↓ 下载' },
    { value: formatBytes(todayTotal), label: '合计' },
  ]));
  p.push(sectionEnd);

  // Account info
  p.push(sectionStart('账号信息'));
  const rows = [];
  if (node.remark) rows.push(detailRow('节点', escHtml(node.remark), false));
  rows.push(detailRow('本月用量', formatBytes(monthTotal), false));
  rows.push(detailRow('累计总量', formatBytes(totalBytes), false));
  if (node.expiryTime && node.expiryTime > 0) {
    const daysLeft = Math.max(0, Math.ceil((node.expiryTime - Date.now()) / (1000 * 60 * 60 * 24)));
    const expDate = new Date(node.expiryTime).toLocaleDateString('zh-CN');
    rows.push(detailRow('到期时间', `${expDate}（${daysLeft > 0 ? '剩余 ' + daysLeft + ' 天' : '已到期'}）`, true));
  } else {
    rows.push(detailRow('上传 / 下载', `${formatBytes(stats.total.up || 0)} / ${formatBytes(stats.total.down || 0)}`, true));
  }
  p.push(rows.join(''));
  p.push(sectionEnd);

  // Clash subscription link
  const clashUrl = stats.clashConfig && publicUrl
    ? `${publicUrl}/sub/clash?token=${encodeURIComponent(user.token)}`
    : null;
  if (clashUrl) {
    p.push(sectionStart('Clash 订阅链接'));
    p.push(linkBox(clashUrl));
    p.push(`<div style="padding-top:8px;font-family:-apple-system,sans-serif;font-size:11px;color:${TEXT_MUTED};">在 Clash Verge 中添加订阅，或复制链接后导入</div>`);
    p.push(sectionEnd);
  }

  // Dashboard link
  if (publicUrl && user.token) {
    p.push(`<table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 0 0;background:${PRIMARY};border-radius:8px;">
<tr><td style="padding:12px;text-align:center;">
  <a href="${publicUrl}/#t=${encodeURIComponent(user.token)}" style="font-family:-apple-system,sans-serif;font-size:14px;color:#ffffff;text-decoration:none;font-weight:500;">查看实时流量看板 →</a>
</td></tr></table>`);
  }

  p.push(wrapperEnd);
  return p.join('');
}

// ── Quota / Expiry warning email ──

function buildWarningHtml(user, stats, type) {
  const node = stats.node || {};
  let p = [];
  p.push(wrapperStart('预警通知'));

  if (type === 'quota') {
    const quotaBytes = node.totalGB * 1024 ** 3;
    const monthUp = stats.thisMonth ? stats.thisMonth.up : 0;
    const monthDown = stats.thisMonth ? stats.thisMonth.down : 0;
    const usedBytes = monthUp + monthDown;
    const usedPct = (usedBytes / quotaBytes) * 100;
    const remainBytes = Math.max(0, quotaBytes - usedBytes);

    p.push(alertBanner(`⚠ 流量预警：已使用 ${usedPct.toFixed(1)}% 配额`, 'quota'));
    p.push(greeting(`Hi <strong>${escHtml(user.name)}</strong>，你的代理账号流量即将用尽`));
    p.push(sectionStart('配额状态'));
    p.push(progressBar(usedPct));
    p.push(`<table width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font-family:-apple-system,sans-serif;font-size:12px;color:${TEXT_LIGHT};">${formatBytes(usedBytes)} 已用</td>
<td style="text-align:center;font-family:'Courier New',Courier,monospace;font-size:12px;font-weight:600;color:${pctColor(usedPct)};">${usedPct.toFixed(1)}%</td>
<td style="text-align:right;font-family:-apple-system,sans-serif;font-size:12px;color:${TEXT_LIGHT};">${formatBytes(remainBytes)} 剩余</td>
</tr></table>`);
    p.push(sectionEnd);
    p.push(sectionStart('建议'));
    p.push(`<div style="font-family:-apple-system,sans-serif;font-size:13px;color:${TEXT};line-height:1.6;">流量配额即将用完，如需继续使用请联系管理员充值或升级套餐。</div>`);
    p.push(sectionEnd);
  } else if (type === 'expiry') {
    const daysLeft = Math.max(0, Math.ceil((node.expiryTime - Date.now()) / (1000 * 60 * 60 * 24)));
    const expDate = new Date(node.expiryTime).toLocaleDateString('zh-CN');

    p.push(alertBanner(`⏰ 到期预警：剩余 ${daysLeft} 天`, 'expiry'));
    p.push(greeting(`Hi <strong>${escHtml(user.name)}</strong>，你的代理账号即将到期`));
    p.push(sectionStart('到期信息'));
    p.push(detailRow('到期日期', expDate, false));
    p.push(detailRow('剩余天数', `${daysLeft} 天`, true));
    p.push(sectionEnd);
    p.push(sectionStart('建议'));
    p.push(`<div style="font-family:-apple-system,sans-serif;font-size:13px;color:${TEXT};line-height:1.6;">账号即将到期，如需继续使用请联系管理员续费。</div>`);
    p.push(sectionEnd);
  }

  p.push(wrapperEnd);
  return p.join('');
}

// ── Test email ──

function buildTestHtml(user) {
  let p = [];
  p.push(wrapperStart('测试邮件'));
  p.push(greeting(`Hi <strong>${escHtml(user.name)}</strong>，这是一封测试邮件`));
  p.push(sectionStart('邮件服务状态'));
  p.push(`<table width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="text-align:center;padding:20px 0;">
  <div style="font-size:36px;color:${PRIMARY};">✓</div>
  <div style="font-family:Georgia,serif;font-size:18px;font-weight:700;color:${TEXT_DARK};padding-top:8px;">服务正常</div>
  <div style="font-family:-apple-system,sans-serif;font-size:12px;color:${TEXT_LIGHT};padding-top:4px;">shareV 邮件通知服务已成功配置</div>
</td></tr></table>`);
  p.push(sectionEnd);
  p.push(wrapperEnd);
  return p.join('');
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
  const subject = `shareV · ${now.getFullYear()} 年 ${now.getMonth() + 1} 月流量报告`;
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
