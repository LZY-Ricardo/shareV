const cron = require('node-cron');
const xui = require('./xui-api');
const db = require('./db');

let config = null;

function init(cfg) {
  config = cfg;
  // Run every 5 minutes
  cron.schedule('*/5 * * * *', snapshot);
  // Cleanup old data daily at 3am
  cron.schedule('0 3 * * *', db.cleanup);
  console.log('[tracker] Scheduled: snapshot every 5min, cleanup daily at 3am');
}

// Take a snapshot of all client traffic from 3X-UI
async function snapshot() {
  try {
    const inbounds = await xui.getInbounds();
    const now = Math.floor(Date.now() / 1000);
    const rows = [];

    for (const inbound of inbounds) {
      if (!inbound.clientStats) continue;
      for (const client of inbound.clientStats) {
        if (!client.email) continue;
        rows.push({
          email: client.email,
          up: client.up || 0,
          down: client.down || 0,
          allUp: client.allTime ? Math.round(client.allTime * (client.up / ((client.up + client.down) || 1))) : (client.up || 0),
          allDown: client.allTime ? Math.round(client.allTime * (client.down / ((client.up + client.down) || 1))) : (client.down || 0),
          timestamp: now,
        });
      }
    }

    if (rows.length > 0) {
      db.insertSnapshots(rows);
      console.log(`[tracker] Snapshot saved: ${rows.length} clients at ${new Date().toISOString()}`);
    }
  } catch (err) {
    console.error('[tracker] Snapshot failed:', err.message);
  }
}

// Get all stats for a specific user (by email)
async function getUserStats(email) {
  const now = Math.floor(Date.now() / 1000);

  // Fetch live data from 3X-UI
  let liveClient = null;
  let liveInbound = null;
  try {
    const inbounds = await xui.getInbounds();
    for (const inbound of inbounds) {
      if (!inbound.clientStats) continue;
      const client = inbound.clientStats.find(c => c.email === email);
      if (client) {
        liveClient = client;
        liveInbound = inbound;
        break;
      }
    }
  } catch {
    // fallback to snapshot data
  }

  // Total: directly from 3X-UI allTime
  let totalUp = 0, totalDown = 0;
  let monthUp = 0, monthDown = 0;
  let nodeInfo = null;

  if (liveClient) {
    const allTime = liveClient.allTime || 0;
    const totalTraffic = liveClient.up + liveClient.down;
    // Split allTime proportionally into up/down
    if (totalTraffic > 0) {
      totalUp = Math.round(allTime * (liveClient.up / totalTraffic));
      totalDown = allTime - totalUp;
    }
    // Month: current period up/down (3X-UI resets monthly)
    monthUp = liveClient.up || 0;
    monthDown = liveClient.down || 0;

    nodeInfo = {
      protocol: liveInbound.protocol,
      port: liveInbound.port,
      remark: liveInbound.remark,
      enable: liveClient.enable,
      totalGB: liveClient.total ? (liveClient.total / (1024 ** 3)).toFixed(1) : 0,
      expiryTime: liveClient.expiryTime,
      limitIp: liveClient.limitIp,
    };
  }

  // Today: delta from snapshots
  const todayTraffic = db.getPeriodTraffic(email, db.getTodayStart());

  // Daily traffic for chart (last 7 days)
  const daily = db.getDailyTraffic(email, 7);

  // Device count (unique IPs)
  let deviceCount = 0;
  try {
    const ipData = await xui.getClientIps(email);
    if (ipData && ipData.ips && typeof ipData.ips === 'object' && !Array.isArray(ipData.ips)) {
      const thirtyMinAgo = now - 30 * 60;
      deviceCount = Object.entries(ipData.ips)
        .filter(([, ts]) => ts >= thirtyMinAgo)
        .length;
    }
  } catch {
    deviceCount = 0;
  }

  return {
    today: todayTraffic,
    month: { up: monthUp, down: monthDown },
    total: { up: totalUp, down: totalDown },
    daily,
    devices: deviceCount,
    node: nodeInfo,
  };
}

module.exports = { init, snapshot, getUserStats };
