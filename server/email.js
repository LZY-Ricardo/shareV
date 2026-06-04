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

// ── Inline-style building blocks (Gmail-safe, no <style>, no flex/grid) ──

const BG = '#0a0e17';
const CARD_BG = '#0e1422';
const BORDER = '#1a2332';
const CYAN = '#00f0ff';
const TEXT = '#c8d0dc';
const TEXT_DIM = '#5a6a7e';
const TEXT_BRIGHT = '#eef1f8';

function wrapperStart(title) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${BG};">
<table width="100%" cellpadding="0" cellspacing="0" style="background:${BG};"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;padding:32px 24px;">
<tr><td style="padding-bottom:4px;">
  <span style="font-family:-apple-system,'Segoe UI',Roboto,sans-serif;font-size:22px;font-weight:700;color:${CYAN};letter-spacing:1px;">shareV</span>
  <span style="font-family:-apple-system,'Segoe UI',Roboto,sans-serif;font-size:22px;font-weight:700;color:${TEXT_DIM};"> // ${title}</span>
</td></tr>
<tr><td style="padding-bottom:28px;font-family:monospace;font-size:11px;color:${TEXT_DIM};letter-spacing:2px;">TRAFFIC MONITORING SYSTEM</td></tr>`;
}

const wrapperEnd = `
<tr><td style="padding-top:28px;border-top:1px solid ${BORDER};text-align:center;font-family:-apple-system,sans-serif;font-size:11px;color:#3a3a3a;">
  shareV · 流量监控看板<br>此邮件由系统自动发送，请勿回复
</td></tr>
</table>
</td></tr></table>
</body></html>`;

function greeting(text) {
  return `<tr><td style="padding-bottom:20px;font-family:-apple-system,sans-serif;font-size:15px;color:${TEXT_BRIGHT};line-height:1.5;">${text}</td></tr>`;
}

function sectionStart(title) {
  return `<tr><td style="background:${CARD_BG};border:1px solid ${BORDER};border-radius:8px;padding:20px;margin-bottom:12px;">
${title ? `<div style="font-family:monospace;font-size:10px;color:${TEXT_DIM};text-transform:uppercase;letter-spacing:2px;padding-bottom:12px;">${title}</div>` : ''}`;
}

const sectionEnd = `</td></tr>`;

function statGrid(items) {
  // items: [{value, label, color?}]
  const cols = items.length;
  const cellWidth = Math.floor(100 / cols);
  let rows = '<table width="100%" cellpadding="0" cellspacing="0"><tr>';
  for (const item of items) {
    const color = item.color || CYAN;
    rows += `<td width="${cellWidth}%" style="text-align:center;padding:4px 0;">
      <div style="font-family:'Courier New',monospace;font-size:20px;font-weight:700;color:${color};">${item.value}</div>
      <div style="font-family:-apple-system,sans-serif;font-size:11px;color:${TEXT_DIM};padding-top:2px;">${item.label}</div>
    </td>`;
  }
  rows += '</tr></table>';
  return rows;
}

function progressBar(pct) {
  const color = pctColor(pct);
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0;">
<tr><td style="background:#1a1a2e;border-radius:4px;height:8px;">
  <table cellpadding="0" cellspacing="0" style="height:8px;"><tr>
    <td style="background:${color};border-radius:4px;width:${Math.min(100, pct).toFixed(1)}%;min-width:2px;"></td>
  </tr></table>
</td></tr></table>`;
}

function detailRow(label, value) {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid ${BORDER};"><tr>
<td style="padding:6px 0;font-family:-apple-system,sans-serif;font-size:13px;color:${TEXT_DIM};">${label}</td>
<td style="padding:6px 0;text-align:right;font-family:'Courier New',monospace;font-size:12px;color:${TEXT_BRIGHT};">${value}</td>
</tr></table>`;
}

function detailRowLast(label, value) {
  return `<table width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="padding:6px 0;font-family:-apple-system,sans-serif;font-size:13px;color:${TEXT_DIM};">${label}</td>
<td style="padding:6px 0;text-align:right;font-family:'Courier New',monospace;font-size:12px;color:${TEXT_BRIGHT};">${value}</td>
</tr></table>`;
}

function linkBox(url) {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;background:#0d1a24;border:1px solid #163040;border-radius:6px;">
<tr><td style="padding:12px 14px;font-family:'Courier New',monospace;font-size:12px;color:${CYAN};word-break:break-all;line-height:1.5;">${url}</td></tr>
</table>`;
}

function alertBanner(text, type) {
  const bg = type === 'expiry' ? '#1f1a0d' : '#1f0d0d';
  const border = type === 'expiry' ? '#3d2e10' : '#3d1010';
  const color = type === 'expiry' ? '#ffa502' : '#ff4757';
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;background:${bg};border:1px solid ${border};border-radius:6px;">
<tr><td style="padding:12px 16px;font-family:-apple-system,sans-serif;font-size:14px;font-weight:600;color:${color};">${text}</td></tr>
</table>`;
}

// ── Monthly report email ──

function buildMonthlyHtml(user, stats, publicUrl) {
  const now = new Date();
  const reportMonth = now.getMonth() === 0 ? 12 : now.getMonth();
  const reportYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const reportLabel = `${reportYear} 年 ${reportMonth} 月`;

  const node = stats.node || {};
  const hasQuota = node.totalGB && node.totalGB > 0;
  const quotaBytes = hasQuota ? node.totalGB * 1024 ** 3 : 0;
  const usedBytes = (stats.total.up || 0) + (stats.total.down || 0);
  const usedPct = hasQuota ? (usedBytes / quotaBytes) * 100 : 0;

  // Last calendar month: lastMonth - thisMonth
  const thisUp = stats.thisMonth ? stats.thisMonth.up : 0;
  const thisDown = stats.thisMonth ? stats.thisMonth.down : 0;
  const lastUp = stats.lastMonth ? stats.lastMonth.up : 0;
  const lastDown = stats.lastMonth ? stats.lastMonth.down : 0;
  const monthUp = Math.max(0, lastUp - thisUp);
  const monthDown = Math.max(0, lastDown - thisDown);
  const monthTotal = monthUp + monthDown;

  // Today
  const todayUp = stats.today.up || 0;
  const todayDown = stats.today.down || 0;
  const todayTotal = todayUp + todayDown;

  // Current x-ui billing period
  const curUp = stats.month ? stats.month.up : 0;
  const curDown = stats.month ? stats.month.down : 0;
  const curTotal = curUp + curDown;

  let parts = [];
  parts.push(wrapperStart('月度报告'));
  parts.push(greeting(`Hi ${escHtml(user.name)}，这是你的 ${reportLabel} 流量报告`));

  // Quota
  if (hasQuota) {
    parts.push(`<tr><td style="padding-bottom:12px;">`);
    parts.push(sectionStart('配额使用'));
    parts.push(progressBar(usedPct));
    parts.push(`<table width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font-family:-apple-system,sans-serif;font-size:12px;color:${TEXT};">${formatBytes(usedBytes)} 已用</td>
<td style="text-align:center;font-family:'Courier New',monospace;font-size:12px;color:${pctColor(usedPct)};">${usedPct.toFixed(1)}%</td>
<td style="text-align:right;font-family:-apple-system,sans-serif;font-size:12px;color:${TEXT};">${formatBytes(quotaBytes)} 总量</td>
</tr></table>`);
    parts.push(sectionEnd);
    parts.push(`</td></tr>`);
  }

  // Monthly traffic
  parts.push(`<tr><td style="padding-bottom:12px;">`);
  parts.push(sectionStart(`${reportMonth} 月流量`));
  parts.push(statGrid([
    { value: formatBytes(monthUp), label: '↑ 上传' },
    { value: formatBytes(monthDown), label: '↓ 下载' },
    { value: formatBytes(monthTotal), label: '合计' },
  ]));
  parts.push(sectionEnd);
  parts.push(`</td></tr>`);

  // Current billing period
  if (curTotal > 0) {
    parts.push(`<tr><td style="padding-bottom:12px;">`);
    parts.push(sectionStart('当前计费周期'));
    parts.push(statGrid([
      { value: formatBytes(curUp), label: '↑ 上传' },
      { value: formatBytes(curDown), label: '↓ 下载' },
      { value: formatBytes(curTotal), label: '合计' },
    ]));
    parts.push(sectionEnd);
    parts.push(`</td></tr>`);
  }

  // Today traffic
  parts.push(`<tr><td style="padding-bottom:12px;">`);
  parts.push(sectionStart('今日流量'));
  parts.push(statGrid([
    { value: formatBytes(todayUp), label: '↑ 上传' },
    { value: formatBytes(todayDown), label: '↓ 下载' },
    { value: formatBytes(todayTotal), label: '合计' },
  ]));
  parts.push(sectionEnd);
  parts.push(`</td></tr>`);

  // Account info
  parts.push(`<tr><td style="padding-bottom:12px;">`);
  parts.push(sectionStart('账号信息'));
  const rows = [];
  if (node.remark) rows.push(detailRow('节点', escHtml(node.remark)));
  rows.push(detailRow('累计用量', formatBytes(usedBytes)));
  rows.push(detailRow('上传 / 下载', `${formatBytes(stats.total.up || 0)} / ${formatBytes(stats.total.down || 0)}`));
  if (node.expiryTime && node.expiryTime > 0) {
    const daysLeft = Math.max(0, Math.ceil((node.expiryTime - Date.now()) / (1000 * 60 * 60 * 24)));
    const expDate = new Date(node.expiryTime).toLocaleDateString('zh-CN');
    rows.push(detailRowLast('到期时间', `${expDate}（${daysLeft > 0 ? '剩余 ' + daysLeft + ' 天' : '已到期'}）`));
  } else {
    // Fix: make last row without border
    rows.push(detailRowLast('上传 / 下载', `${formatBytes(stats.total.up || 0)} / ${formatBytes(stats.total.down || 0)}`));
  }
  parts.push(rows.join(''));
  parts.push(sectionEnd);
  parts.push(`</td></tr>`);

  // Clash subscription link
  const clashUrl = stats.clashConfig && publicUrl
    ? `${publicUrl}/sub/clash?token=${encodeURIComponent(user.token)}`
    : null;
  if (clashUrl) {
    parts.push(`<tr><td style="padding-bottom:12px;">`);
    parts.push(sectionStart('Clash 订阅链接'));
    parts.push(linkBox(clashUrl));
    parts.push(`<div style="padding-top:6px;font-family:-apple-system,sans-serif;font-size:11px;color:${TEXT_DIM};">在 Clash Verge 中添加订阅，或复制链接后导入</div>`);
    parts.push(sectionEnd);
    parts.push(`</td></tr>`);
  }

  // Dashboard link
  if (publicUrl && user.token) {
    parts.push(`<tr><td style="padding-bottom:12px;">`);
    parts.push(sectionStart(''));
    parts.push(`<div style="text-align:center;"><a href="${publicUrl}/#t=${encodeURIComponent(user.token)}" style="font-family:-apple-system,sans-serif;font-size:14px;color:${CYAN};text-decoration:none;">→ 查看实时流量看板</a></div>`);
    parts.push(sectionEnd);
    parts.push(`</td></tr>`);
  }

  parts.push(wrapperEnd);
  return parts.join('');
}

// ── Quota / Expiry warning email ──

function buildWarningHtml(user, stats, type) {
  const node = stats.node || {};
  let parts = [];
  parts.push(wrapperStart('预警通知'));

  if (type === 'quota') {
    const quotaBytes = node.totalGB * 1024 ** 3;
    const usedBytes = (stats.total.up || 0) + (stats.total.down || 0);
    const usedPct = (usedBytes / quotaBytes) * 100;
    const remainBytes = Math.max(0, quotaBytes - usedBytes);

    parts.push(`<tr><td style="padding-bottom:12px;">`);
    parts.push(alertBanner(`⚠ 流量预警：已使用 ${usedPct.toFixed(1)}% 配额`, 'quota'));
    parts.push(`</td></tr>`);
    parts.push(greeting(`Hi ${escHtml(user.name)}，你的代理账号流量即将用尽`));
    parts.push(`<tr><td style="padding-bottom:12px;">`);
    parts.push(sectionStart('配额状态'));
    parts.push(progressBar(usedPct));
    parts.push(`<table width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font-family:-apple-system,sans-serif;font-size:12px;color:${TEXT};">${formatBytes(usedBytes)} 已用</td>
<td style="text-align:center;font-family:'Courier New',monospace;font-size:12px;color:${pctColor(usedPct)};">${usedPct.toFixed(1)}%</td>
<td style="text-align:right;font-family:-apple-system,sans-serif;font-size:12px;color:${TEXT};">${formatBytes(remainBytes)} 剩余</td>
</tr></table>`);
    parts.push(sectionEnd);
    parts.push(`</td></tr>`);
    parts.push(`<tr><td style="padding-bottom:12px;">`);
    parts.push(sectionStart('建议'));
    parts.push(`<div style="font-family:-apple-system,sans-serif;font-size:13px;color:${TEXT};line-height:1.6;">流量配额即将用完，如需继续使用请联系管理员充值或升级套餐。</div>`);
    parts.push(sectionEnd);
    parts.push(`</td></tr>`);
  } else if (type === 'expiry') {
    const daysLeft = Math.max(0, Math.ceil((node.expiryTime - Date.now()) / (1000 * 60 * 60 * 24)));
    const expDate = new Date(node.expiryTime).toLocaleDateString('zh-CN');

    parts.push(`<tr><td style="padding-bottom:12px;">`);
    parts.push(alertBanner(`⏰ 到期预警：剩余 ${daysLeft} 天`, 'expiry'));
    parts.push(`</td></tr>`);
    parts.push(greeting(`Hi ${escHtml(user.name)}，你的代理账号即将到期`));
    parts.push(`<tr><td style="padding-bottom:12px;">`);
    parts.push(sectionStart('到期信息'));
    parts.push(detailRow('到期日期', expDate));
    parts.push(detailRowLast('剩余天数', `${daysLeft} 天`));
    parts.push(sectionEnd);
    parts.push(`</td></tr>`);
    parts.push(`<tr><td style="padding-bottom:12px;">`);
    parts.push(sectionStart('建议'));
    parts.push(`<div style="font-family:-apple-system,sans-serif;font-size:13px;color:${TEXT};line-height:1.6;">账号即将到期，如需继续使用请联系管理员续费。</div>`);
    parts.push(sectionEnd);
    parts.push(`</td></tr>`);
  }

  parts.push(wrapperEnd);
  return parts.join('');
}

// ── Test email ──

function buildTestHtml(user) {
  let parts = [];
  parts.push(wrapperStart('测试邮件'));
  parts.push(greeting(`Hi ${escHtml(user.name)}，这是一封测试邮件`));
  parts.push(`<tr><td style="padding-bottom:12px;">`);
  parts.push(sectionStart('邮件服务状态'));
  parts.push(`<div style="text-align:center;padding:16px 0;">
<div style="font-size:28px;color:${CYAN};">✓ 正常</div>
<div style="font-family:-apple-system,sans-serif;font-size:12px;color:${TEXT_DIM};padding-top:8px;">shareV 邮件通知服务已成功配置</div>
</div>`);
  parts.push(sectionEnd);
  parts.push(`</td></tr>`);
  parts.push(wrapperEnd);
  return parts.join('');
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
