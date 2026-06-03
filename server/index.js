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

// Parse JSON body for admin endpoints
app.use('/api/admin/email', express.json());

// ── Simple rate limiter (in-memory, per-IP) ──
const rateLimits = new Map();
const RATE_WINDOW = 60_000; // 1 minute
const RATE_MAX = 30;        // max requests per window

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

// Clean up rate limit entries every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW * 2;
  for (const [ip, entry] of rateLimits) {
    if (entry.start < cutoff) rateLimits.delete(ip);
  }
}, 300_000);

// ── Admin auth middleware (for protected endpoints) ──
const ADMIN_TOKEN = (process.env.ADMIN_TOKEN || '').trim() || null;
if (!ADMIN_TOKEN) {
  console.warn('[shareV] WARNING: ADMIN_TOKEN not set. /api/snapshot endpoint is disabled.');
}

function requireAdmin(req, res, next) {
  const auth = req.headers['authorization'];
  if (!ADMIN_TOKEN || auth !== `Bearer ${ADMIN_TOKEN}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

const userDirectory = createUserDirectory(config.users);

function getBaseUrl(req) {
  return resolvePublicUrl(config, req);
}

function getUserByToken(req, res) {
  const token = (req.query.token || '').trim();
  const user = userDirectory.findByToken(token);
  if (!user) {
    res.status(404).json({ error: '未找到数据' });
    return null;
  }
  return user;
}

function getClashConfigUrl(req, token) {
  return `${getBaseUrl(req)}/sub/clash?token=${encodeURIComponent(token)}`;
}

// ── API: Get stats by user access token ──
app.get('/api/stats', rateLimiter, async (req, res) => {
  const user = getUserByToken(req, res);
  if (!user) return;

  try {
    const stats = await tracker.getUserStats(user.email);
    res.json({
      name: user.name,
      clashConfigUrl: stats.clashConfig ? getClashConfigUrl(req, user.token) : null,
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
    const stats = await tracker.getUserStats(user.email);
    if (!stats.clashConfig) return res.status(404).json({ error: '未找到 Clash 配置' });

    res.setHeader('content-type', 'text/yaml; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    const filename = encodeURIComponent(getClashProfileFilename(user));
    res.setHeader(
      'content-disposition',
      `inline; filename="clash.yaml"; filename*=UTF-8''${filename}`
    );
    // subscription-userinfo header for Clash traffic display
    if (stats.node) {
      const upload = stats.total.up || 0;
      const download = stats.total.down || 0;
      const total = stats.node.totalGB ? Math.round(stats.node.totalGB * 1024 * 1024 * 1024) : 0;
      const expire = stats.node.expiryTime ? Math.floor(stats.node.expiryTime / 1000) : 0;
      res.setHeader("subscription-userinfo", `upload=${upload}; download=${download}; total=${total}; expire=${expire}`);
    }
    res.send(`${stats.clashConfig}\n`);
  } catch (err) {
    console.error('[shareV] Clash subscription error:', err.message);
    res.status(500).json({ error: '服务暂时不可用' });
  }
});

// Real-time speed: returns raw counters for frontend to compute speed
app.get('/api/speed', rateLimiter, async (req, res) => {
  const user = getUserByToken(req, res);
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
    const stats = await tracker.getUserStats(user.email);
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

// ── Sync new 3X-UI clients into config ──
async function syncClientsFromXui() {
  try {
    const inbounds = await xui.getInbounds();
    const synced = [];
    for (const inbound of inbounds) {
      const settings = JSON.parse(inbound.settings || '{}');
      const clients = settings.clients || [];
      for (const cl of clients) {
        if (!cl.id || !cl.email) continue;
        if (config.users[cl.id]) continue;
        const token = crypto.randomBytes(24).toString('base64url');
        const user = { name: cl.email, email: cl.email, token };
        config.users[cl.id] = user;
        userDirectory.addUser(cl.id, user);
        synced.push(cl.email);
      }
    }
    if (synced.length > 0) {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
      console.log(`[shareV] Synced ${synced.length} new client(s): ${synced.join(', ')}`);
    }
    return synced;
  } catch (err) {
    console.error('[shareV] Client sync error:', err.message);
    return [];
  }
}

app.post('/api/admin/sync', rateLimiter, requireAdmin, async (req, res) => {
  const synced = await syncClientsFromXui();
  res.json({ synced, count: synced.length });
});

// ── Admin: send test email ──
app.post('/api/admin/email/test', rateLimiter, requireAdmin, async (req, res) => {
  try {
    const token = (req.query.token || req.body?.token || '').trim();
    const user = token ? userDirectory.findByToken(token) : null;
    if (!user || !user.notifyEmail) {
      return res.status(400).json({ error: '用户未找到或未配置邮箱地址' });
    }
    await emailService.sendTestEmail(user);
    console.log(`[shareV] Test email sent to ${user.notifyEmail}`);
    res.json({ success: true, email: user.notifyEmail });
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
      : userDirectory.listUsers('').map(u => ({ ...u, ...config.users[u.uuid] })).filter(u => u.notifyEmail);

    const results = await Promise.allSettled(users.map(async (user) => {
      if (!user.notifyEmail) return null;
      const stats = await tracker.getUserStats(user.email);
      await emailService.sendMonthlyReport(user, stats, config.publicUrl);
      return { name: user.name, email: user.notifyEmail };
    }));
    const sent = results
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value);
    const failed = results
      .filter(r => r.status === 'rejected')
      .map(r => ({ name: '?', error: r.reason?.message || String(r.reason) }));

    console.log(`[shareV] Monthly report sent: ${sent.length}/${sent.length + failed.length}`);
    res.json({ sent, failed });
  } catch (err) {
    console.error('[shareV] Monthly report error:', err.message);
    res.status(500).json({ error: '发送失败: ' + err.message });
  }
});

// ── Email: monthly report on the 1st of each month at 9am ──
if (emailService.isEnabled()) {
  cron.schedule('0 9 1 * *', async () => {
    console.log('[shareV] Sending monthly reports...');
    const allUsers = userDirectory.listUsers('').map(u => ({ ...u, ...config.users[u.uuid] })).filter(u => u.notifyEmail);
    const results = await Promise.allSettled(allUsers.map(async (user) => {
      const stats = await tracker.getUserStats(user.email);
      await emailService.sendMonthlyReport(user, stats, config.publicUrl);
      return user;
    }));
    for (const r of results) {
      if (r.status === 'fulfilled') {
        console.log(`[shareV] Monthly report sent to ${r.value.name} <${r.value.notifyEmail}>`);
      } else {
        console.error(`[shareV] Monthly report failed: ${r.reason?.message || r.reason}`);
      }
    }
  });

  // ── Email: daily quota/expiry warning check at 9am ──
  const lastWarningDate = new Map(); // email -> date string

  cron.schedule('0 9 * * *', async () => {
    console.log('[shareV] Checking warning conditions...');
    const allUsers = userDirectory.listUsers('').map(u => ({ ...u, ...config.users[u.uuid] }));
    const today = new Date().toISOString().slice(0, 10);

    for (const user of allUsers) {
      if (!user.notifyEmail) continue;
      try {
        const stats = await tracker.getUserStats(user.email);
        const node = stats.node || {};

        // Check quota warning (> 80%)
        if (node.totalGB && node.totalGB > 0) {
          const quotaBytes = node.totalGB * 1024 ** 3;
          const usedBytes = (stats.total.up || 0) + (stats.total.down || 0);
          const usedPct = (usedBytes / quotaBytes) * 100;
          if (usedPct > 80 && lastWarningDate.get(user.email + ':quota') !== today) {
            await emailService.sendQuotaWarning(user, stats, 'quota');
            lastWarningDate.set(user.email + ':quota', today);
            console.log(`[shareV] Quota warning sent to ${user.name} (${usedPct.toFixed(1)}%)`);
          }
        }

        // Check expiry warning (< 7 days)
        if (node.expiryTime && node.expiryTime > 0) {
          const daysLeft = Math.ceil((node.expiryTime - Date.now()) / (1000 * 60 * 60 * 24));
          if (daysLeft <= 7 && daysLeft >= 0 && lastWarningDate.get(user.email + ':expiry') !== today) {
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
