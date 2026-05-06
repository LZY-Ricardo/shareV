const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const xui = require('./xui-api');
const tracker = require('./traffic-tracker');

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

// Build name-to-user lookup
const usersByName = {};
for (const [uuid, user] of Object.entries(config.users)) {
  usersByName[user.name.toLowerCase()] = { ...user, uuid };
}

// ── API: Get stats by username ──
app.get('/api/stats', rateLimiter, async (req, res) => {
  const name = (req.query.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: '请输入用户名' });
  }

  const user = usersByName[name.toLowerCase()];
  if (!user) {
    // Generic error to prevent user enumeration
    return res.status(404).json({ error: '未找到数据' });
  }

  try {
    const stats = await tracker.getUserStats(user.email);
    res.json({
      name: user.name,
      ...stats,
    });
  } catch (err) {
    console.error('[shareV] Stats error:', err.message);
    res.status(500).json({ error: '服务暂时不可用' });
  }
});

// ── Admin-only: manual snapshot trigger ──
app.post('/api/snapshot', requireAdmin, async (req, res) => {
  try {
    await tracker.snapshot();
    res.json({ success: true });
  } catch (err) {
    console.error('[shareV] Snapshot error:', err.message);
    res.status(500).json({ error: '快照失败' });
  }
});

app.listen(PORT, () => {
  console.log(`[shareV] Dashboard running on http://0.0.0.0:${PORT}`);
  // Take initial snapshot on startup
  setTimeout(() => tracker.snapshot(), 3000);
});
