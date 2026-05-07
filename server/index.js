const express = require('express');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const xui = require('./xui-api');
const tracker = require('./traffic-tracker');
const db = require('./db');
const { createUserDirectory } = require('./user-directory');
const { resolvePublicUrl } = require('./public-url');
const { getClashProfileFilename } = require('./clash-profile-name');

// Load config
const configPath = path.join(__dirname, '..', 'config.json');
if (!fs.existsSync(configPath)) {
  console.error('Error: config.json not found. Copy config.example.json and edit it.');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// Ensure data directory exists
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Init modules
xui.init(config.xui);
tracker.init(config);

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

// ── Simple rate limiter (in-memory, per-IP) ──
const rateLimits = new Map();
const RATE_WINDOW = 60_000; // 1 minute
const RATE_MAX = 60;        // max requests per window

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
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || null;
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
});

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
