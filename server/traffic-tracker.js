const cron = require('node-cron');
const xui = require('./xui-api');
const db = require('./db');

let config = null;
let snapshotRunning = false; // Mutex to prevent concurrent snapshots

function init(cfg) {
  config = cfg;
  cron.schedule('*/5 * * * *', snapshot);
  cron.schedule('0 3 * * *', db.cleanup);
  console.log('[tracker] Scheduled: snapshot every 5min, cleanup daily at 3am');
}

async function snapshot() {
  if (snapshotRunning) {
    console.log('[tracker] Snapshot skipped: already running');
    return;
  }
  snapshotRunning = true;

  try {
    const inbounds = await xui.getInbounds();
    const now = Math.floor(Date.now() / 1000);
    const rows = [];

    for (const inbound of inbounds) {
      if (!inbound.clientStats) continue;
      for (const client of inbound.clientStats) {
        if (!client.email) continue;

        // Calculate allUp/allDown from allTime
        const up = client.up || 0;
        const down = client.down || 0;
        const allTime = client.allTime || 0;
        const totalTraffic = up + down;

        let allUp, allDown;
        if (totalTraffic > 0 && allTime > 0) {
          allUp = Math.round(allTime * (up / totalTraffic));
          allDown = allTime - allUp;
        } else if (allTime > 0) {
          // No current period traffic but has allTime — store as-is
          allUp = 0;
          allDown = allTime;
        } else {
          allUp = up;
          allDown = down;
        }

        rows.push({ email: client.email, up, down, allUp, allDown, timestamp: now });
      }
    }

    if (rows.length > 0) {
      db.insertSnapshots(rows);
      console.log(`[tracker] Snapshot saved: ${rows.length} clients at ${new Date().toISOString()}`);
    }
  } catch (err) {
    console.error('[tracker] Snapshot failed:', err.message);
  } finally {
    snapshotRunning = false;
  }
}

async function getUserStats(email) {
  const now = Math.floor(Date.now() / 1000);

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
  } catch (err) {
    console.warn('[tracker] Failed to fetch live data:', err.message);
  }

  let totalUp = 0, totalDown = 0;
  let monthUp = 0, monthDown = 0;
  let nodeInfo = null;

  if (liveClient) {
    const allTime = liveClient.allTime || 0;
    const totalTraffic = liveClient.up + liveClient.down;
    if (totalTraffic > 0 && allTime > 0) {
      totalUp = Math.round(allTime * (liveClient.up / totalTraffic));
      totalDown = allTime - totalUp;
    } else if (allTime > 0) {
      totalUp = 0;
      totalDown = allTime;
    }
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

  const todayTraffic = db.getPeriodTraffic(email, db.getTodayStart());
  const daily = db.getDailyTraffic(email, 30);
  const thisMonthTraffic = db.getPeriodTraffic(email, db.getMonthStart());
  const lastMonthTraffic = db.getPeriodTraffic(email, db.getLastMonthStart());

  // Check online status + device details
  let online = false;
  let deviceList = [];
  try {
    const onlineClients = await xui.getOnlineClients();
    online = onlineClients.includes(email);
  } catch (err) {
    console.warn('[tracker] Failed to fetch online status:', err.message);
  }
  try {
    let ipData = await xui.getClientIps(email);
    // API may return a JSON string instead of parsed object
    if (typeof ipData === 'string') {
      try { ipData = JSON.parse(ipData); } catch { ipData = null; }
    }
    if (ipData && Array.isArray(ipData)) {
      for (const ip of ipData) {
        deviceList.push({ ip, lastSeen: null });
      }
    } else if (ipData && typeof ipData === 'object' && !Array.isArray(ipData)) {
      const now = Date.now();
      for (const [ip, ts] of Object.entries(ipData)) {
        const lastSeen = typeof ts === 'number' ? ts : null;
        if (lastSeen && (now - lastSeen) < 30 * 60 * 1000) {
          deviceList.push({ ip, lastSeen });
        }
      }
    }
  } catch (err) {
    // ignore
  }

  return {
    today: todayTraffic,
    month: { up: monthUp, down: monthDown },
    total: { up: totalUp, down: totalDown },
    thisMonth: thisMonthTraffic,
    lastMonth: lastMonthTraffic,
    online,
    devices: deviceList.length,
    deviceList,
    daily,
    node: nodeInfo,
  };
}

module.exports = { init, snapshot, getUserStats };
