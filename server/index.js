const express = require('express');
const path = require('path');
const fs = require('fs');
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

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Build name-to-user lookup
const usersByName = {};
for (const [uuid, user] of Object.entries(config.users)) {
  usersByName[user.name.toLowerCase()] = { ...user, uuid };
}

// API: Get stats by username
app.get('/api/stats', async (req, res) => {
  const name = (req.query.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: '请输入用户名' });
  }

  const user = usersByName[name.toLowerCase()];
  if (!user) {
    return res.status(404).json({ error: '用户不存在' });
  }

  try {
    const stats = await tracker.getUserStats(user.email);
    res.json({
      name: user.name,
      ...stats,
    });
  } catch (err) {
    console.error('Failed to get stats:', err.message);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Manual snapshot trigger (for initial setup)
app.post('/api/snapshot', async (req, res) => {
  try {
    await tracker.snapshot();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[shareV] Dashboard running on http://0.0.0.0:${PORT}`);
  // Take initial snapshot on startup
  setTimeout(() => tracker.snapshot(), 3000);
});
