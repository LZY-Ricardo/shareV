const cron = require('node-cron');
const xui = require('./xui-api');
const db = require('./db');

let config = null;
let snapshotRunning = false; // Mutex to prevent concurrent snapshots
const counterCache = new Map(); // email -> { data, ts }
const COUNTER_TTL = 3000; // 3 seconds

function splitAllTimeByCurrentTraffic(up, down, allTime) {
  const currentTotal = up + down;
  if (currentTotal > 0 && allTime > 0) {
    const totalUp = Math.round(allTime * (up / currentTotal));
    return { up: totalUp, down: allTime - totalUp };
  }
  if (allTime > 0) return { up: 0, down: allTime };
  return { up, down };
}

function snapshotTrafficTotal(row) {
  if (!row) return { up: 0, down: 0 };
  const allUp = row.allUp || 0;
  const allDown = row.allDown || 0;
  if (allUp + allDown > 0) return { up: allUp, down: allDown };
  return { up: row.up || 0, down: row.down || 0 };
}

function init(cfg) {
  config = cfg;
  cron.schedule('*/5 * * * *', snapshot);
  cron.schedule('0 0 * * *', snapshot);
  cron.schedule('0 3 * * *', db.cleanup);
  console.log('[tracker] Scheduled: snapshot every 5min, midnight baseline, cleanup daily at 3am');
  setTimeout(() => ensureTodayBaselineSnapshot(), 3000);
}

async function ensureTodayBaselineSnapshot() {
  const todayStart = db.getTodayStart();
  if (db.hasSnapshotsSince(todayStart)) {
    console.log('[tracker] Startup daily baseline skipped: today already has snapshots');
    return;
  }

  console.log('[tracker] Startup daily baseline missing: taking snapshot');
  await snapshot();
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

function resolveNodeDisplayName(displayName, email) {
  const name = String(displayName || '').trim();
  if (name) return name;
  return String(email || '').trim();
}

async function getUserStats(email, { displayName } = {}) {
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

  const latestSnapshot = db.getLatestSnapshot(email);
  let { up: totalUp, down: totalDown } = snapshotTrafficTotal(latestSnapshot);
  let nodeInfo = null;
  let configLink = null;
  let clashConfig = null;

  const daily = db.getDailyTraffic(email, 30);

  if (liveClient) {
    const allTime = liveClient.allTime || 0;
    const dailyUpTotal = daily.reduce((s, d) => s + d.up, 0);
    const dailyDownTotal = daily.reduce((s, d) => s + d.down, 0);
    const dailyTotal = dailyUpTotal + dailyDownTotal;
    if (allTime > 0 && dailyTotal > 0) {
      totalUp = Math.round(allTime * (dailyUpTotal / dailyTotal));
      totalDown = allTime - totalUp;
    } else {
      const totalTraffic = splitAllTimeByCurrentTraffic(
        liveClient.up || 0, liveClient.down || 0, allTime
      );
      totalUp = totalTraffic.up;
      totalDown = totalTraffic.down;
    }

    // Get limitIp from settings.clients (not available in clientStats)
    let limitIp = 0;
    try {
      const settings = JSON.parse(liveInbound.settings || '{}');
      const clientCfg = (settings.clients || []).find(c => c.email === email);
      if (clientCfg) limitIp = clientCfg.limitIp || 0;
    } catch {}

    nodeInfo = {
      protocol: liveInbound.protocol,
      port: liveInbound.port,
      remark: liveInbound.remark,
      enable: liveClient.enable,
      totalGB: liveClient.total ? (liveClient.total / (1024 ** 3)).toFixed(1) : 0,
      expiryTime: liveClient.expiryTime,
      limitIp,
    };

    // Generate VLESS config link and Clash YAML
    configLink = buildConfigLink(liveInbound, liveClient);
    clashConfig = buildClashConfig(liveInbound, liveClient, config, displayName);
  }

  const todayTraffic = db.getPeriodTraffic(email, db.getTodayStart());
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

  const avgSpeed = db.getRecentSpeed(email);

  return {
    today: todayTraffic,
    month: resolveMonthTraffic(liveClient, email),
    total: { up: totalUp, down: totalDown },
    thisMonth: thisMonthTraffic,
    lastMonth: lastMonthTraffic,
    online,
    devices: deviceList.length,
    deviceList,
    daily,
    node: nodeInfo,
    configLink,
    clashConfig,
    avgSpeed,
  };
}

// Parse inbound+client into fields shared by vless:// link and Clash YAML
function parseVlessReality(inbound, client, cfg = config) {
  if (!cfg || !cfg.server || inbound.protocol !== 'vless') return null;
  const settings = JSON.parse(inbound.settings || '{}');
  const clientCfg = (settings.clients || []).find(c => c.email === client.email);
  const uuid = clientCfg ? clientCfg.id : null;
  if (!uuid) return null;
  const flow = typeof clientCfg.flow === 'string' ? clientCfg.flow.trim() : '';

  const stream = JSON.parse(inbound.streamSettings || '{}');
  const reality = stream.realitySettings || {};
  const pbk = reality.settings?.publicKey;
  const sni = (reality.serverNames || [])[0];
  const sid = (reality.shortIds || [])[0] ?? '';
  const fp = reality.settings?.fingerprint || 'chrome';
  if (!pbk || !sni) return null;

  return { uuid, server: cfg.server, port: inbound.port, sni, fp, pbk, sid, flow, email: client.email };
}

function buildConfigLink(inbound, client) {
  try {
    const f = parseVlessReality(inbound, client);
    if (!f) return null;

    const params = [
      'encryption=none',
      'security=reality',
      `sni=${encodeURIComponent(f.sni)}`,
      `fp=${encodeURIComponent(f.fp)}`,
      `pbk=${encodeURIComponent(f.pbk)}`,
      `sid=${encodeURIComponent(f.sid)}`,
      ...(f.flow ? [`flow=${encodeURIComponent(f.flow)}`] : []),
      'type=tcp',
    ].join('&');

    return `vless://${f.uuid}@${f.server}:${f.port}?${params}#${encodeURIComponent(f.email)}`;
  } catch {
    return null;
  }
}

function yamlQuote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// Generate a mihomo (Clash Meta) profile for Clash Verge subscription import.
function buildClashConfig(inbound, client, cfg = config, displayName) {
  try {
    const f = parseVlessReality(inbound, client, cfg);
    if (!f) return null;

    const nodeName = resolveNodeDisplayName(displayName, client.email);
    const groupName = '自动选择';
    const lines = [
      'proxies:',
      `  - name: ${yamlQuote(nodeName)}`,
      '    type: vless',
      `    server: ${yamlQuote(f.server)}`,
      `    port: ${f.port}`,
      `    uuid: ${yamlQuote(f.uuid)}`,
      '    encryption: ""',
      '    network: tcp',
      '    udp: true',
      '    packet-encoding: xudp',
      '    tls: true',
      ...(f.flow ? [`    flow: ${f.flow}`] : []),
      `    servername: ${yamlQuote(f.sni)}`,
      `    client-fingerprint: ${yamlQuote(f.fp)}`,
      '    skip-cert-verify: true',
      '    reality-opts:',
      `      public-key: ${yamlQuote(f.pbk)}`,
      `      short-id: ${yamlQuote(f.sid)}`,
      '    smux:',
      '      enabled: false',
      'proxy-groups:',
      `  - name: ${yamlQuote(groupName)}`,
      '    type: select',
      '    proxies:',
      `      - ${yamlQuote(nodeName)}`,
      'rules:',
      `  - MATCH,${groupName}`,
    ];
    return lines.join('\n');
  } catch {
    return null;
  }
}

async function getLiveCounters(email) {
  const cached = counterCache.get(email);
  if (cached && Date.now() - cached.ts < COUNTER_TTL) return cached.data;
  try {
    const inbounds = await xui.getInbounds();
    for (const inbound of inbounds) {
      if (!inbound.clientStats) continue;
      const client = inbound.clientStats.find(c => c.email === email);
      if (client) {
        const data = { up: client.up || 0, down: client.down || 0 };
        counterCache.set(email, { data, ts: Date.now() });
        return data;
      }
    }
  } catch (err) {
    console.warn('[tracker] Failed to fetch live counters:', err.message);
  }
  return null;
}

const RANKING_PERIODS = new Set(['day', 'month', 'total']);

// Billing-period counters when live and non-zero; otherwise snapshot delta since month start
function resolveMonthTraffic(liveClient, email) {
  if (liveClient) {
    const up = liveClient.up || 0;
    const down = liveClient.down || 0;
    if (up + down > 0) return { up, down };
  }
  return db.getPeriodTraffic(email, db.getMonthStart());
}

function trafficForRankingPeriod(email, period, liveClient) {
  switch (period) {
    case 'day': {
      const t = db.getPeriodTraffic(email, db.getTodayStart());
      return { up: t.up, down: t.down, bytes: t.up + t.down };
    }
    case 'month': {
      const t = resolveMonthTraffic(liveClient, email);
      return { up: t.up, down: t.down, bytes: t.up + t.down };
    }
    case 'total':
    default: {
      if (liveClient) {
        const allTime = liveClient.allTime || 0;
        if (allTime > 0) {
          const split = splitAllTimeByCurrentTraffic(
            liveClient.up || 0,
            liveClient.down || 0,
            allTime
          );
          return { up: split.up, down: split.down, bytes: allTime };
        }
        const up = liveClient.up || 0;
        const down = liveClient.down || 0;
        return { up, down, bytes: up + down };
      }
      const latest = db.getLatestSnapshot(email);
      const { up, down } = snapshotTrafficTotal(latest);
      return { up, down, bytes: up + down };
    }
  }
}

async function getTrafficRanking(entries, period = 'day') {
  const rankingPeriod = RANKING_PERIODS.has(period) ? period : 'day';
  const liveByEmail = new Map();

  try {
    const inbounds = await xui.getInbounds();
    for (const inbound of inbounds) {
      for (const client of inbound.clientStats || []) {
        if (client.email) liveByEmail.set(client.email, client);
      }
    }
  } catch (err) {
    console.warn('[tracker] Ranking: failed to fetch live data:', err.message);
  }

  let onlineClients = [];
  try {
    onlineClients = await xui.getOnlineClients();
  } catch {
    // ignore
  }
  const onlineSet = new Set(onlineClients);

  const rows = entries.map((user) => {
    const email = String(user.email || '').trim();
    const liveClient = liveByEmail.get(email) || null;
    const { up, down, bytes } = trafficForRankingPeriod(email, rankingPeriod, liveClient);
    return {
      name: user.name,
      email,
      token: user.token,
      online: onlineSet.has(email),
      up,
      down,
      bytes,
    };
  });

  rows.sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name, 'zh-CN'));
  const totalBytes = rows.reduce((sum, row) => sum + row.bytes, 0);
  const maxBytes = rows[0]?.bytes || 0;

  return {
    period: rankingPeriod,
    updatedAt: new Date().toISOString(),
    totalBytes,
    users: rows.map((row, index) => ({
      rank: index + 1,
      name: row.name,
      email: row.email,
      token: row.token,
      online: row.online,
      up: row.up,
      down: row.down,
      bytes: row.bytes,
      share: totalBytes > 0 ? row.bytes / totalBytes : 0,
      barPct: maxBytes > 0 ? row.bytes / maxBytes : 0,
    })),
  };
}

module.exports = {
  init,
  snapshot,
  ensureTodayBaselineSnapshot,
  getUserStats,
  getTrafficRanking,
  resolveMonthTraffic,
  resolveNodeDisplayName,
  getLiveCounters,
  buildClashConfig,
};
