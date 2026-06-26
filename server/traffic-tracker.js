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

  // Collect every inbound where this email appears. A user typically exists in
  // both the legacy REALITY inbound and the new CF CDN (WS+TLS) inbound; we
  // surface all of them so the frontend can offer a node picker.
  const liveMatches = [];
  try {
    const inbounds = await xui.getInbounds();
    for (const inbound of inbounds) {
      // 1. Try live clientStats first — 3x-ui populates this for clients that
      //    have generated traffic on this inbound.
      let client = null;
      if (Array.isArray(inbound.clientStats)) {
        client = inbound.clientStats.find(c => c.email === email);
      }
      // 2. Fall back to settings.clients — a freshly created inbound (e.g. new
      //    CF CDN route) has empty clientStats until the user actually connects
      //    through it. Without this fallback the user can never see/import the
      //    new node, since shareV wouldn't surface it at all.
      if (!client) {
        try {
          const settings = JSON.parse(inbound.settings || '{}');
          const clientCfg = (settings.clients || []).find(c => c.email === email);
          if (clientCfg) {
            client = {
              email,
              enable: clientCfg.enable !== false,
              up: 0, down: 0, total: 0, expiryTime: 0, allTime: 0,
            };
          }
        } catch {}
      }
      if (client) liveMatches.push({ inbound, client });
    }
  } catch (err) {
    console.warn('[tracker] Failed to fetch live data:', err.message);
  }

  // Rank CF CDN (WS+TLS) ahead of REALITY so the recommended node is the one
  // that actually works behind the GFW IP block.
  liveMatches.sort((a, b) => {
    const rank = (m) => {
      try {
        const s = JSON.parse(m.inbound.streamSettings || '{}');
        return s.network === 'ws' ? 0 : 1;
      } catch { return 1; }
    };
    return rank(a) - rank(b);
  });

  const primary = liveMatches[0] || null;
  // Pick the pair with the most recorded traffic for accurate totals / quota.
  // A fresh CF CDN inbound has 0 clientStats, so primary (CF) would erase the
  // user's accumulated REALITY traffic. Use the busiest pair for billing data.
  const trafficPair = liveMatches.reduce(
    (best, m) => ((m.client.allTime || 0) > (best?.client.allTime || 0) ? m : best),
    null
  ) || primary;
  const liveClient = trafficPair ? trafficPair.client : null;
  const liveInbound = trafficPair ? trafficPair.inbound : null;

  const latestSnapshot = db.getLatestSnapshot(email);
  let { up: totalUp, down: totalDown } = snapshotTrafficTotal(latestSnapshot);
  let nodeInfo = null;
  let configLink = null;
  let clashConfig = null;
  let nodes = [];

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

    // Per-node metadata so the frontend can render a node picker.
    // Filter out inbounds we can't turn into a vless:// link (e.g. non-vless
    // protocols) — they'd show as empty entries in the picker.
    nodes = liveMatches
      .map(({ inbound, client }) => {
        const link = buildConfigLink(inbound, client);
        if (!link) return null;
        let limitIp = 0;
        try {
          const settings = JSON.parse(inbound.settings || '{}');
          const clientCfg = (settings.clients || []).find(c => c.email === email);
          if (clientCfg) limitIp = clientCfg.limitIp || 0;
        } catch {}
        let stream = {};
        try { stream = JSON.parse(inbound.streamSettings || '{}'); } catch {}
        const isWs = stream.network === 'ws';
        return {
          id: inbound.id,
          tag: inbound.tag || `inbound-${inbound.id}`,
          remark: inbound.remark,
          protocol: isWs ? 'ws' : 'reality',
          port: inbound.port,
          enable: client.enable,
          totalGB: client.total ? (client.total / (1024 ** 3)).toFixed(1) : 0,
          expiryTime: client.expiryTime,
          limitIp,
          configLink: link,
        };
      })
      .filter(Boolean);

    // Backwards-compatible single-node fields use the primary (recommended) node
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

    // Generate VLESS config link (primary = recommended CF CDN node) + merged
    // Clash YAML containing every node so users can switch in their client.
    configLink = primary ? buildConfigLink(primary.inbound, primary.client) : null;
    clashConfig = buildMultiClashConfig(liveMatches, config, displayName);
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
    nodes,
    configLink,
    clashConfig,
    avgSpeed,
  };
}

// Parse inbound+client into fields shared by vless:// link and Clash YAML.
// Supports both REALITY (tcp) and VLESS+WS+TLS (via CF CDN) — distinguished by `kind`.
function parseVlessInbound(inbound, client, cfg = config) {
  if (!cfg || !cfg.server || inbound.protocol !== 'vless') return null;
  const settings = JSON.parse(inbound.settings || '{}');
  const clientCfg = (settings.clients || []).find(c => c.email === client.email);
  const uuid = clientCfg ? clientCfg.id : null;
  if (!uuid) return null;
  const flow = typeof clientCfg.flow === 'string' ? clientCfg.flow.trim() : '';

  const stream = JSON.parse(inbound.streamSettings || '{}');
  const network = stream.network || 'tcp';
  const fp = 'chrome';

  // VLESS+WS+TLS path (CF CDN) — x-ui "network":"ws","security":"tls"
  if (network === 'ws') {
    const tls = stream.tlsSettings || {};
    const ws = stream.wsSettings || {};
    const sni = tls.serverName || cfg.server;
    const wsPath = ws.path || '/';
    const wsHost = ws.host || sni;
    return { kind: 'ws', uuid, server: cfg.server, port: inbound.port, sni, fp, flow, wsPath, wsHost, email: client.email };
  }

  // REALITY path — legacy direct connection (subject to GFW IP block).
  // Trust realitySettings presence — 3X-UI may omit the `security` field on older snapshots.
  if (stream.realitySettings) {
    const reality = stream.realitySettings || {};
    const pbk = reality.settings?.publicKey;
    const sni = (reality.serverNames || [])[0];
    const sid = (reality.shortIds || [])[0] ?? '';
    const realityFp = reality.settings?.fingerprint || fp;
    if (!pbk || !sni) return null;
    return { kind: 'reality', uuid, server: cfg.server, port: inbound.port, sni, fp: realityFp, pbk, sid, flow, email: client.email };
  }

  return null;
}

// Backwards-compatible alias
const parseVlessReality = parseVlessInbound;

function buildConfigLink(inbound, client, cfg = config) {
  try {
    const f = parseVlessInbound(inbound, client, cfg);
    if (!f) return null;

    let params;
    if (f.kind === 'ws') {
      // VLESS+WS+TLS via CF CDN — proxy through Cloudflare
      params = [
        'encryption=none',
        'security=tls',
        `sni=${encodeURIComponent(f.sni)}`,
        `fp=${encodeURIComponent(f.fp)}`,
        'type=ws',
        `host=${encodeURIComponent(f.wsHost)}`,
        `path=${encodeURIComponent(f.wsPath)}`,
      ].join('&');
    } else {
      // REALITY direct connection
      params = [
        'encryption=none',
        'security=reality',
        `sni=${encodeURIComponent(f.sni)}`,
        `fp=${encodeURIComponent(f.fp)}`,
        `pbk=${encodeURIComponent(f.pbk)}`,
        `sid=${encodeURIComponent(f.sid)}`,
        ...(f.flow ? [`flow=${encodeURIComponent(f.flow)}`] : []),
        'type=tcp',
      ].join('&');
    }

    return `vless://${f.uuid}@${f.server}:${f.port}?${params}#${encodeURIComponent(f.email)}`;
  } catch {
    return null;
  }
}

function yamlQuote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// Build a single proxy block (lines after "proxies:"). Returns { name, lines } or null.
// withSuffix adds " (CF)" / " (直连)" to distinguish same-user nodes across inbounds.
function buildSingleProxyBlock(f, displayName, { withSuffix = false } = {}) {
  if (!f) return null;
  const baseName = resolveNodeDisplayName(displayName, f.email);
  const nodeName = withSuffix
    ? baseName + (f.kind === 'ws' ? ' (CF)' : ' (直连)')
    : baseName;

  const lines = [
    `  - name: ${yamlQuote(nodeName)}`,
    '    type: vless',
    `    server: ${yamlQuote(f.server)}`,
    `    port: ${f.port}`,
    `    uuid: ${yamlQuote(f.uuid)}`,
    '    encryption: ""',
    '    udp: true',
  ];

  if (f.kind === 'ws') {
    // VLESS+WS+TLS via CF CDN
    lines.push('    network: ws');
    lines.push('    tls: true');
    lines.push(`    servername: ${yamlQuote(f.sni)}`);
    lines.push(`    client-fingerprint: ${yamlQuote(f.fp)}`);
    lines.push('    skip-cert-verify: true');
    lines.push('    ws-opts:');
    lines.push(`      path: ${yamlQuote(f.wsPath)}`);
    lines.push('      headers:');
    lines.push(`        Host: ${yamlQuote(f.wsHost)}`);
  } else {
    // REALITY direct connection
    lines.push('    network: tcp');
    lines.push('    packet-encoding: xudp');
    lines.push('    tls: true');
    if (f.flow) lines.push(`    flow: ${f.flow}`);
    lines.push(`    servername: ${yamlQuote(f.sni)}`);
    lines.push(`    client-fingerprint: ${yamlQuote(f.fp)}`);
    lines.push('    skip-cert-verify: true');
    lines.push('    reality-opts:');
    lines.push(`      public-key: ${yamlQuote(f.pbk)}`);
    lines.push(`      short-id: ${yamlQuote(f.sid)}`);
    lines.push('    smux:');
    lines.push('      enabled: false');
  }

  return { name: nodeName, lines };
}

function assembleClashProfile(blocks, groupName = '自动选择') {
  const lines = [
    'proxies:',
    ...blocks.flatMap(b => b.lines),
    'proxy-groups:',
    `  - name: ${yamlQuote(groupName)}`,
    '    type: select',
    '    proxies:',
    ...blocks.map(b => `      - ${yamlQuote(b.name)}`),
    'rules:',
    `  - MATCH,${groupName}`,
  ];
  return lines.join('\n');
}

// Generate a mihomo (Clash Meta) profile for a single inbound+client.
// Kept backwards-compatible: tests call this directly with (inbound, client, cfg, displayName).
function buildClashConfig(inbound, client, cfg = config, displayName) {
  try {
    const f = parseVlessInbound(inbound, client, cfg);
    if (!f) return null;
    const block = buildSingleProxyBlock(f, displayName);
    if (!block) return null;
    return assembleClashProfile([block]);
  } catch {
    return null;
  }
}

// Generate a merged Clash profile containing all of the user's nodes (CF CDN + REALITY).
// Output is a single YAML with multiple proxies; users switch between them in Clash.
function buildMultiClashConfig(pairs, cfg = config, displayName) {
  try {
    if (!Array.isArray(pairs) || pairs.length === 0) return null;
    // Suppress suffix when user has only one usable node (cleaner name)
    const multi = pairs.length > 1;
    const blocks = [];
    for (const { inbound, client } of pairs) {
      const f = parseVlessInbound(inbound, client, cfg);
      if (!f) continue;
      const block = buildSingleProxyBlock(f, displayName, { withSuffix: multi });
      if (block) blocks.push(block);
    }
    if (blocks.length === 0) return null;
    return assembleClashProfile(blocks);
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
  buildMultiClashConfig,
  parseVlessInbound,
};
