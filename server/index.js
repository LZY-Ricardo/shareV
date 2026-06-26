const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cron = require('node-cron');
const xui = require('./xui-api');
const tracker = require('./traffic-tracker');
const db = require('./db');
const { createUserDirectory } = require('./user-directory');
const { resolvePublicUrl } = require('./public-url');
const { getClashProfileFilename } = require('./clash-profile-name');
const emailService = require('./email');
const { createAuth, auditUserPasswords } = require('./auth');

// Load config
const configPath = path.join(__dirname, '..', 'config.json');
if (!fs.existsSync(configPath)) {
  console.error('Error: config.json not found. Copy config.example.json and edit it.');
  process.exit(1);
}

let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
} catch (err) {
  console.error('Error: config.json 解析失败:', err.message);
  process.exit(1);
}

if (!config.xui || typeof config.xui !== 'object') {
  console.error('Error: config.json 缺少 xui 配置段');
  process.exit(1);
}
if (!config.users || typeof config.users !== 'object') {
  console.error('Error: config.json 缺少 users 配置段');
  process.exit(1);
}

// Ensure data directory exists
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Init modules
xui.init(config.xui);
tracker.init(config);
emailService.init(config);

const app = express();
const PORT = config.port || 3000;

// Trust first proxy (Nginx) for correct req.ip
app.set('trust proxy', 1);

// ── Security headers ──
app.use((_, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'");
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Parse JSON body for API endpoints
app.use('/api/auth', express.json({ limit: '16kb' }));
app.use('/api/admin/email', express.json());

// ── Simple rate limiter (in-memory, per-IP) ──
const rateLimits = new Map();
const RATE_WINDOW = 60_000; // 1 minute
const RATE_MAX = 30;        // max requests per window
const AUTH_RATE_MAX = 10;   // max auth attempts per window

function rateLimiter(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  let entry = rateLimits.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW) {
    entry = { start: now, count: 0 };
    rateLimits.set(ip, entry);
  }
  entry.count++;
  if (entry.count > RATE_MAX) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  next();
}

function authRateLimiter(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const key = `auth:${ip}`;
  const now = Date.now();
  let entry = rateLimits.get(key);
  if (!entry || now - entry.start > RATE_WINDOW) {
    entry = { start: now, count: 0 };
    rateLimits.set(key, entry);
  }
  entry.count++;
  if (entry.count > AUTH_RATE_MAX) {
    return res.status(429).json({ error: '登录尝试过于频繁，请稍后再试' });
  }
  next();
}

// Clean up rate limit entries every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW * 2;
  for (const [ip, entry] of rateLimits) {
    if (entry.start < cutoff) rateLimits.delete(ip);
  }
}, 300_000);

// ── Auth ──
const ADMIN_TOKEN = (process.env.ADMIN_TOKEN || '').trim() || null;
const userDirectory = createUserDirectory(config.users);
const authConfig = config.auth || {};
const auth = createAuth({
  db,
  userDirectory,
  defaultPassword: authConfig.defaultPassword || '123456',
  sessionMaxAgeSec: (authConfig.sessionMaxAgeDays || 7) * 24 * 3600,
});

if (!ADMIN_TOKEN) {
  console.warn('[shareV] WARNING: ADMIN_TOKEN not set. Admin endpoints are disabled.');
}

const passwordAudit = auditUserPasswords(config.users);
if (passwordAudit.plainTextUsers.length > 0) {
  console.warn(
    `[shareV] WARNING: ${passwordAudit.plainTextUsers.length} user(s) use plaintext password in config.json — run "node server/hash-password.js <password>" and set passwordHash instead.`
  );
}
if (passwordAudit.defaultPasswordUsers.length > 0) {
  console.warn(
    `[shareV] WARNING: ${passwordAudit.defaultPasswordUsers.length} user(s) still use the default password "${auth.defaultPassword}" — change auth.defaultPassword or set passwordHash before public exposure.`
  );
}

// One-time style migration: snapshots keyed by old 3X-UI short ids → unified QQ emails
function migrateLegacySnapshotEmails() {
  let total = 0;
  const snapshotEmails = db.listDistinctSnapshotEmails();

  for (const user of Object.values(config.users)) {
    const email = String(user.email || '').trim();
    const name = String(user.name || '').trim();
    if (!email) continue;

    let legacyKey = null;
    for (const snapEmail of snapshotEmails) {
      if (snapEmail.toLowerCase() === email.toLowerCase()) continue;
      if (name && snapEmail.toLowerCase() === name.toLowerCase()) {
        legacyKey = snapEmail;
        break;
      }
    }

    if (!legacyKey) continue;
    const moved = db.migrateSnapshotEmail(legacyKey, email);
    if (moved > 0) {
      console.log(`[shareV] Migrated ${moved} snapshot rows: ${legacyKey} → ${email}`);
      total += moved;
    }
  }

  if (total > 0) {
    console.log(`[shareV] Snapshot email migration complete (${total} rows)`);
  }
}
migrateLegacySnapshotEmails();

function requireAdmin(req, res, next) {
  const bearer = req.headers['authorization'];
  if (!ADMIN_TOKEN || bearer !== `Bearer ${ADMIN_TOKEN}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function publicUserPayload(user) {
  return {
    name: user.name,
    email: user.email,
  };
}

function authSessionPayload(user) {
  return {
    user: publicUserPayload(user),
    mustChangePassword: auth.userUsesDefaultPassword(user),
  };
}

function saveConfig() {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

function applyUserPasswordHash(uuid, passwordHash) {
  const cfgUser = config.users[uuid];
  if (!cfgUser) return false;
  cfgUser.passwordHash = passwordHash;
  delete cfgUser.password;
  const entry = userDirectory.findByUuid(uuid);
  if (entry) {
    entry.passwordHash = passwordHash;
    delete entry.password;
  }
  saveConfig();
  return true;
}

function getBaseUrl(req) {
  return resolvePublicUrl(config, req);
}

function getUserByToken(req, res) {
  const token = (req.query.token || req.body?.token || '').trim();
  const user = userDirectory.findByToken(token);
  if (!user) {
    res.status(404).json({ error: '未找到数据' });
    return null;
  }
  return user;
}

function resolveUser(req, res, { allowSession = true } = {}) {
  if (allowSession) {
    const sessionUser = auth.getUserFromSession(req);
    if (sessionUser) return sessionUser;
  }
  const token = (req.query.token || req.body?.token || '').trim();
  if (token) {
    const user = userDirectory.findByToken(token);
    if (user) return user;
  }
  if (res) res.status(401).json({ error: '未登录或访问码无效' });
  return null;
}

function getClashConfigUrl(req, token) {
  return `${getBaseUrl(req)}/sub/clash?token=${encodeURIComponent(token)}`;
}

function getV2raynConfigUrl(req, token) {
  return `${getBaseUrl(req)}/sub/v2rayn?token=${encodeURIComponent(token)}`;
}

// ── Auth routes ──
app.post('/api/auth/login', authRateLimiter, async (req, res) => {
  const account = (req.body?.email || req.body?.username || req.body?.account || '').trim();
  const password = req.body?.password || '';
  if (!account || !password) {
    return res.status(400).json({ error: '请输入账号和密码' });
  }

  const result = auth.loginUser(account, password);
  if (!result.ok) {
    return res.status(401).json({ error: result.error });
  }

  auth.createUserSession(result.user.uuid, req, res);
  res.json(authSessionPayload(result.user));
});

app.post('/api/auth/token', authRateLimiter, async (req, res) => {
  const token = (req.body?.token || req.query.token || '').trim();
  if (!token) {
    return res.status(400).json({ error: '缺少访问码' });
  }
  const user = userDirectory.findByToken(token);
  if (!user) {
    return res.status(401).json({ error: '访问码无效' });
  }
  auth.createUserSession(user.uuid, req, res);
  res.json(authSessionPayload(user));
});

app.post('/api/auth/change-password', authRateLimiter, (req, res) => {
  const user = auth.getUserFromSession(req);
  if (!user) {
    return res.status(401).json({ error: '未登录' });
  }

  const currentPassword = req.body?.currentPassword || '';
  const newPassword = req.body?.newPassword || '';
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: '请填写当前密码和新密码' });
  }

  const result = auth.changeUserPassword(user, currentPassword, newPassword);
  if (!result.ok) {
    const status = result.error === '当前密码错误' ? 401 : 400;
    return res.status(status).json({ error: result.error });
  }

  if (!applyUserPasswordHash(user.uuid, result.passwordHash)) {
    return res.status(500).json({ error: '保存密码失败' });
  }

  res.json({ success: true, mustChangePassword: false });
});

app.post('/api/auth/logout', rateLimiter, (req, res) => {
  auth.destroyUserSession(req, res);
  res.json({ success: true });
});

app.get('/api/auth/me', rateLimiter, (req, res) => {
  const user = auth.getUserFromSession(req);
  if (!user) {
    return res.status(401).json({ error: '未登录' });
  }
  res.json(authSessionPayload(user));
});

// ── API: Get stats by user session or access token ──
app.get('/api/stats', rateLimiter, async (req, res) => {
  const user = resolveUser(req, res);
  if (!user) return;

  try {
    const stats = await tracker.getUserStats(user.email, { displayName: user.name });
    res.json({
      name: user.name,
      clashConfigUrl: stats.clashConfig ? getClashConfigUrl(req, user.token) : null,
      v2raynConfigUrl: (Array.isArray(stats.nodes) && stats.nodes.length > 0) ? getV2raynConfigUrl(req, user.token) : null,
      ...stats,
    });
  } catch (err) {
    console.error('[shareV] Stats error:', err.message);
    res.status(500).json({ error: '服务暂时不可用' });
  }
});

app.get('/sub/clash', rateLimiter, async (req, res) => {
  const user = getUserByToken(req, res);
  if (!user) return;

  try {
    const stats = await tracker.getUserStats(user.email, { displayName: user.name });
    if (!stats.clashConfig) return res.status(404).json({ error: '未找到 Clash 配置' });

    res.setHeader('content-type', 'text/yaml; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('profile-update-interval', '1'); // auto-refresh every 1 hour
    const filename = encodeURIComponent(getClashProfileFilename(user));
    res.setHeader(
      'content-disposition',
      `inline; filename="clash.yaml"; filename*=UTF-8''${filename}`
    );
    // subscription-userinfo header for Clash traffic display
    if (stats.node) {
      // Use current calendar month traffic, not all-time total
      const upload = stats.thisMonth ? stats.thisMonth.up : 0;
      const download = stats.thisMonth ? stats.thisMonth.down : 0;
      const total = stats.node.totalGB ? Math.round(stats.node.totalGB * 1024 * 1024 * 1024) : 0;
      // Show next reset date (1st of next month) instead of account expiry
      const now = new Date();
      const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const expire = Math.floor(nextReset.getTime() / 1000);
      res.setHeader("subscription-userinfo", `upload=${upload}; download=${download}; total=${total}; expire=${expire}`);
    }
    res.send(`${stats.clashConfig}\n`);
  } catch (err) {
    console.error('[shareV] Clash subscription error:', err.message);
    res.status(500).json({ error: '服务暂时不可用' });
  }
});

// v2rayN-native subscription: base64-encoded vless:// URL list (one per line).
// v2rayN does not parse Clash YAML in its generic subscription flow; it expects
// a base64 payload of vmess/vless URLs. This endpoint makes the multi-node
// setup importable in v2rayN just like any normal subscription.
app.get('/sub/v2rayn', rateLimiter, async (req, res) => {
  const user = getUserByToken(req, res);
  if (!user) return;

  try {
    const stats = await tracker.getUserStats(user.email, { displayName: user.name });
    const nodes = Array.isArray(stats.nodes) ? stats.nodes : [];
    const links = nodes.map(n => n.configLink).filter(Boolean);
    if (links.length === 0 && !stats.configLink) {
      return res.status(404).json({ error: '未找到可用节点' });
    }
    if (links.length === 0) links.push(stats.configLink);

    const payload = Buffer.from(links.join('\n') + '\n', 'utf-8').toString('base64');

    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('profile-update-interval', '1');
    if (stats.node) {
      const upload = stats.thisMonth ? stats.thisMonth.up : 0;
      const download = stats.thisMonth ? stats.thisMonth.down : 0;
      const total = stats.node.totalGB ? Math.round(stats.node.totalGB * 1024 * 1024 * 1024) : 0;
      const now = new Date();
      const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const expire = Math.floor(nextReset.getTime() / 1000);
      res.setHeader("subscription-userinfo", `upload=${upload}; download=${download}; total=${total}; expire=${expire}`);
    }
    res.send(payload);
  } catch (err) {
    console.error('[shareV] v2rayN subscription error:', err.message);
    res.status(500).json({ error: '服务暂时不可用' });
  }
});

// Real-time speed: returns raw counters for frontend to compute speed
app.get('/api/speed', rateLimiter, async (req, res) => {
  const user = resolveUser(req, res);
  if (!user) return;

  try {
    const counters = await tracker.getLiveCounters(user.email);
    if (!counters) return res.status(404).json({ error: '未找到数据' });
    res.json(counters);
  } catch (err) {
    console.error('[shareV] Speed error:', err.message);
    res.status(500).json({ error: '服务暂时不可用' });
  }
});

app.get('/api/admin/users', rateLimiter, requireAdmin, async (req, res) => {
  try {
    const users = userDirectory.listUsers(getBaseUrl(req));
    // Fetch online status for each user
    const onlineClients = await xui.getOnlineClients().catch(() => []);
    for (const user of users) {
      user.online = onlineClients.includes(user.email);
    }
    res.json({ users });
  } catch (err) {
    res.json({ users: userDirectory.listUsers(getBaseUrl(req)) });
  }
});

app.get('/api/admin/stats', rateLimiter, requireAdmin, async (req, res) => {
  const user = getUserByToken(req, res);
  if (!user) return;

  try {
    const stats = await tracker.getUserStats(user.email, { displayName: user.name });
    res.json({
      name: user.name,
      token: user.token,
      url: `${getBaseUrl(req)}/#t=${encodeURIComponent(user.token)}`,
      clashConfigUrl: stats.clashConfig ? getClashConfigUrl(req, user.token) : null,
      ...stats,
    });
  } catch (err) {
    console.error('[shareV] Admin stats error:', err.message);
    res.status(500).json({ error: '服务暂时不可用' });
  }
});

app.get('/api/admin/traffic-ranking', rateLimiter, requireAdmin, async (req, res) => {
  const period = String(req.query.period || 'day').trim().toLowerCase();
  if (!['day', 'month', 'total'].includes(period)) {
    return res.status(400).json({ error: 'period 须为 day、month 或 total' });
  }

  try {
    const entries = userDirectory.listUsers(getBaseUrl(req));
    const ranking = await tracker.getTrafficRanking(entries, period);
    res.json(ranking);
  } catch (err) {
    console.error('[shareV] Admin traffic ranking error:', err.message);
    res.status(500).json({ error: '服务暂时不可用' });
  }
});

// ── Admin-only: manual snapshot trigger ──
app.post('/api/admin/snapshot', rateLimiter, requireAdmin, async (req, res) => {
  try {
    await tracker.snapshot();
    res.json({ success: true });
  } catch (err) {
    console.error('[shareV] Snapshot error:', err.message);
    res.status(500).json({ error: '快照失败' });
  }
});

function displayNameFromXuiClient(cl) {
  const comment = String(cl.comment || '').trim();
  return comment || String(cl.email || '').trim();
}

// ── Sync 3X-UI clients into config (email + comment → name) ──
async function syncClientsFromXui() {
  try {
    const inbounds = await xui.getInbounds();
    const synced = [];
    const updated = [];
    let changed = false;

    for (const inbound of inbounds) {
      const settings = JSON.parse(inbound.settings || '{}');
      for (const cl of settings.clients || []) {
        if (!cl.id || !cl.email) continue;

        const email = String(cl.email).trim();
        const name = displayNameFromXuiClient(cl);

        if (!config.users[cl.id]) {
          const token = crypto.randomBytes(24).toString('base64url');
          config.users[cl.id] = { name, email, token };
          synced.push(email);
          changed = true;
          continue;
        }

        const user = config.users[cl.id];
        let userChanged = false;
        if (user.email !== email) {
          user.email = email;
          userChanged = true;
        }
        if (name && user.name !== name) {
          user.name = name; // display name follows 3X-UI comment
          userChanged = true;
        }
        if (user.notifyEmail) {
          delete user.notifyEmail;
          userChanged = true;
        }
        if (userChanged) updated.push(email);
        changed = changed || userChanged;
      }
    }

    if (changed) {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
      userDirectory.replaceAllUsers(config.users);
      console.log(`[shareV] Synced ${synced.length} new, updated ${updated.length} from 3X-UI`);
    }
    return { synced, updated };
  } catch (err) {
    console.error('[shareV] Client sync error:', err.message);
    return { synced: [], updated: [] };
  }
}

app.post('/api/admin/sync', rateLimiter, requireAdmin, async (req, res) => {
  const result = await syncClientsFromXui();
  res.json({
    synced: result.synced,
    updated: result.updated,
    count: result.synced.length + result.updated.length,
  });
});

// ── Admin: send test email ──
app.post('/api/admin/email/test', rateLimiter, requireAdmin, async (req, res) => {
  try {
    const token = (req.query.token || req.body?.token || '').trim();
    const user = token ? userDirectory.findByToken(token) : null;
    if (!user || !user.email) {
      return res.status(400).json({ error: '用户未找到或未配置邮箱地址' });
    }
    await emailService.sendTestEmail(user);
    console.log(`[shareV] Test email sent to ${user.email}`);
    res.json({ success: true, email: user.email });
  } catch (err) {
    console.error('[shareV] Test email error:', err.message);
    res.status(500).json({ error: '发送失败: ' + err.message });
  }
});

// ── Admin: send monthly report to one or all users ──
app.post('/api/admin/email/monthly', rateLimiter, requireAdmin, async (req, res) => {
  try {
    const token = (req.query.token || '').trim();

    const users = token
      ? [userDirectory.findByToken(token)].filter(Boolean)
      : userDirectory.listUsers('').map(u => ({ ...u, ...config.users[u.uuid] })).filter(u => u.email);

    const sent = [];
    const failed = [];
    for (const user of users) {
      if (!user.email) continue;
      try {
        const stats = await tracker.getUserStats(user.email, { displayName: user.name });
        await emailService.sendMonthlyReport(user, stats, config.publicUrl);
        sent.push({ name: user.name, email: user.email });
      } catch (err) {
        failed.push({ name: user.name, error: err.message });
      }
      // Rate limit: pause between emails to avoid Resend throttling
      await new Promise(r => setTimeout(r, 300));
    }

    console.log(`[shareV] Monthly report sent: ${sent.length}/${sent.length + failed.length}`);
    res.json({ sent, failed });
  } catch (err) {
    console.error('[shareV] Monthly report error:', err.message);
    res.status(500).json({ error: '发送失败: ' + err.message });
  }
});

// ── Admin: send CF CDN upgrade announcement to one or all users ──
app.post('/api/admin/email/cf-cdn-notice', rateLimiter, requireAdmin, async (req, res) => {
  try {
    const token = (req.query.token || '').trim();

    const users = token
      ? [userDirectory.findByToken(token)].filter(Boolean)
      : userDirectory.listUsers('').map(u => ({ ...u, ...config.users[u.uuid] })).filter(u => u.email);

    const sent = [];
    const failed = [];
    for (const user of users) {
      if (!user.email) continue;
      try {
        await emailService.sendCfCdnAnnouncement(user, config.publicUrl);
        sent.push({ name: user.name, email: user.email });
      } catch (err) {
        failed.push({ name: user.name, error: err.message });
      }
      await new Promise(r => setTimeout(r, 300));
    }

    console.log(`[shareV] CF CDN announcement sent: ${sent.length}/${sent.length + failed.length}`);
    res.json({ sent, failed });
  } catch (err) {
    console.error('[shareV] CF CDN announcement error:', err.message);
    res.status(500).json({ error: '发送失败: ' + err.message });
  }
});

// ── Email: monthly report on the 1st of each month at 9am ──
if (emailService.isEnabled()) {
  cron.schedule('0 9 1 * *', async () => {
    console.log('[shareV] Sending monthly reports...');
    const allUsers = userDirectory.listUsers('').map(u => ({ ...u, ...config.users[u.uuid] })).filter(u => u.email);
    for (const user of allUsers) {
      try {
        const stats = await tracker.getUserStats(user.email, { displayName: user.name });
        await emailService.sendMonthlyReport(user, stats, config.publicUrl);
        console.log(`[shareV] Monthly report sent to ${user.name} <${user.email}>`);
      } catch (err) {
        console.error(`[shareV] Monthly report failed for ${user.name}: ${err.message}`);
      }
    }
  });

  // ── Email: daily quota/expiry warning check at 9am ──
  const lastWarningDate = new Map(); // email -> date string

  cron.schedule('0 9 * * *', async () => {
    console.log('[shareV] Checking warning conditions...');
    const allUsers = userDirectory.listUsers('').map(u => ({ ...u, ...config.users[u.uuid] }));
    // Local-timezone date string (YYYY-MM-DD) for per-day dedup
    const n = new Date();
    const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;

    for (const user of allUsers) {
      if (!user.email) continue;
      try {
        const stats = await tracker.getUserStats(user.email, { displayName: user.name });
        const node = stats.node || {};

        // Check quota warning (> 80% of billing period usage)
        if (node.totalGB && node.totalGB > 0) {
          const quotaBytes = node.totalGB * 1024 ** 3;
          const monthUp = stats.thisMonth ? stats.thisMonth.up : 0;
          const monthDown = stats.thisMonth ? stats.thisMonth.down : 0;
          const usedBytes = monthUp + monthDown;
          const usedPct = (usedBytes / quotaBytes) * 100;
          if (usedPct > 80 && lastWarningDate.get(user.email + ':quota') !== today) {
            await emailService.sendQuotaWarning(user, stats, 'quota');
            lastWarningDate.set(user.email + ':quota', today);
            console.log(`[shareV] Quota warning sent to ${user.name} (${usedPct.toFixed(1)}%)`);
          }
        }

        // Check expiry warning (<= 7 days, including already-expired)
        if (node.expiryTime && node.expiryTime > 0) {
          const daysLeft = Math.ceil((node.expiryTime - Date.now()) / (1000 * 60 * 60 * 24));
          if (daysLeft <= 7 && lastWarningDate.get(user.email + ':expiry') !== today) {
            await emailService.sendQuotaWarning(user, stats, 'expiry');
            lastWarningDate.set(user.email + ':expiry', today);
            console.log(`[shareV] Expiry warning sent to ${user.name} (${daysLeft} days left)`);
          }
        }
      } catch (err) {
        console.error(`[shareV] Warning check failed for ${user.name}: ${err.message}`);
      }
    }
  });
}

// ── Health check ──
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: Math.floor(process.uptime()) });
});

// ── Daily DB backup at 4am ──
const backupPath = path.join(dataDir, 'traffic.db.bak');
cron.schedule('0 4 * * *', async () => {
  try {
    await db.backup(backupPath);
    console.log('[shareV] DB backup completed');
  } catch (err) {
    console.error('[shareV] DB backup failed:', err.message);
  }
});

// Clean expired auth sessions hourly
cron.schedule('15 * * * *', () => {
  auth.cleanupExpiredSessions();
});

const server = app.listen(PORT, () => {
  console.log(`[shareV] Dashboard running on http://0.0.0.0:${PORT}`);
  // Auto-sync on startup
  syncClientsFromXui();
});

// Periodic client sync every hour
cron.schedule('0 * * * *', () => syncClientsFromXui());

// Graceful shutdown
function shutdown(signal) {
  console.log(`[shareV] Received ${signal}, shutting down gracefully...`);
  server.close(() => {
    console.log('[shareV] HTTP server closed');
    try { db.close(); } catch (_) {}
    console.log('[shareV] Goodbye');
    process.exit(0);
  });
  // Force exit after 10s if connections don't close
  setTimeout(() => {
    console.warn('[shareV] Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
