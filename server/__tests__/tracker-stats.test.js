const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const trackerPath = require.resolve('../traffic-tracker');
const xuiPath = require.resolve('../xui-api');
const dbPath = require.resolve('../db');

function stubModule(path, exports) {
  require.cache[path] = {
    id: path,
    filename: path,
    loaded: true,
    exports,
  };
}

function loadTracker({ inbounds, latestSnapshot = null, getInboundsError = null, dbOverrides = {} }) {
  delete require.cache[trackerPath];

  stubModule(xuiPath, {
    getInbounds: async () => {
      if (getInboundsError) throw getInboundsError;
      return inbounds;
    },
    getOnlineClients: async () => ['a@example.com'],
    getClientIps: async () => [],
  });

  stubModule(dbPath, {
    getPeriodTraffic: (email, start) => {
      if (start === 100) return { up: 50, down: 50 };
      if (start === 200) return { up: 500, down: 500 };
      return { up: 0, down: 0 };
    },
    getPeriodTrafficBetween: (email, start, end) => {
      if (start === 0 && end === 200) return { up: 300, down: 700 };
      return { up: 0, down: 0 };
    },
    getDailyTraffic: () => [],
    getTodayStart: () => 100,
    getMonthStart: () => 200,
    getLastMonthStart: () => 0,
    getLatestSnapshot: () => latestSnapshot,
    getRecentSpeed: () => null,
    ...dbOverrides,
  });

  return require('../traffic-tracker');
}

afterEach(() => {
  delete require.cache[trackerPath];
  delete require.cache[xuiPath];
  delete require.cache[dbPath];
});

describe('traffic tracker stats', () => {
  it('uses live up/down as total when allTime is missing', async () => {
    const tracker = loadTracker({
      inbounds: [{
        protocol: 'tcp',
        port: 443,
        remark: 'node',
        settings: '{}',
        clientStats: [{ email: 'user1', up: 100, down: 200, allTime: 0, total: 0, enable: true }],
      }],
    });

    const stats = await tracker.getUserStats('user1');

    assert.deepEqual(stats.total, { up: 100, down: 200 });
  });

  it('uses the completed previous calendar month for monthly reports', async () => {
    const tracker = loadTracker({
      inbounds: [{
        protocol: 'tcp',
        port: 443,
        remark: 'node',
        settings: '{}',
        clientStats: [{ email: 'user1', up: 100, down: 200, allTime: 0, total: 0, enable: true }],
      }],
    });

    const stats = await tracker.getUserStats('user1');

    assert.deepEqual(stats.thisMonth, { up: 500, down: 500 });
    assert.deepEqual(stats.lastMonth, { up: 300, down: 700 });
    assert.deepEqual(stats.monthlyReport.traffic, { up: 300, down: 700 });
  });

  it('falls back to the latest snapshot total when live data is unavailable', async () => {
    const tracker = loadTracker({
      inbounds: [],
      getInboundsError: new Error('x-ui unavailable'),
      latestSnapshot: { up: 100, down: 300, allUp: 0, allDown: 0, timestamp: 1000 },
    });

    const stats = await tracker.getUserStats('user1');

    assert.deepEqual(stats.total, { up: 100, down: 300 });
  });

  it('builds a full Clash Verge importable profile for VLESS Reality', () => {
    const tracker = loadTracker({ inbounds: [] });
    const inbound = {
      protocol: 'vless',
      port: 443,
      settings: JSON.stringify({
        clients: [{
          email: '亮',
          id: 'eeaf6b42-51bc-4a0d-a776-2d21f80a2ee3',
          flow: 'xtls-rprx-vision',
        }],
      }),
      streamSettings: JSON.stringify({
        realitySettings: {
          serverNames: ['www.microsoft.com'],
          shortIds: ['abcd'],
          settings: {
            publicKey: 'pub-key',
            fingerprint: 'chrome',
          },
        },
      }),
    };
    const client = { email: '亮' };

    const profile = tracker.buildClashConfig(inbound, client, { server: 'v.sunandyu.top' });

    assert.match(profile, /^proxies:\n/);
    assert.match(profile, /type: vless/);
    assert.match(profile, /\n\s+flow: xtls-rprx-vision/);
    assert.match(profile, /\n\s+encryption: ""/);
    assert.match(profile, /\n\s+packet-encoding: xudp/);
    assert.match(profile, /\n\s+skip-cert-verify: true/);
    assert.match(profile, /\n\s+smux:\n\s+enabled: false/);
    assert.match(profile, /reality-opts:\n\s+public-key: "pub-key"\n\s+short-id: "abcd"/);
    assert.match(profile, /\nproxy-groups:\n/);
    assert.match(profile, /\n\s+- name: "自动选择"\n\s+type: select\n\s+proxies:\n\s+- "亮"/);
    assert.match(profile, /\nrules:\n\s+- MATCH,自动选择\n?$/);
    assert.doesNotMatch(profile, /undefined/);
  });

  it('does not force Vision flow when the 3X-UI client has no flow', () => {
    const tracker = loadTracker({ inbounds: [] });
    const inbound = {
      protocol: 'vless',
      port: 443,
      settings: JSON.stringify({
        clients: [{ email: 'hua.com', id: 'eeaf6b42-51bc-4a0d-a776-2d21f80a2ee3' }],
      }),
      streamSettings: JSON.stringify({
        realitySettings: {
          serverNames: ['www.microsoft.com'],
          shortIds: ['abcd'],
          settings: {
            publicKey: 'pub-key',
            fingerprint: 'chrome',
          },
        },
      }),
    };
    const client = { email: 'hua.com' };

    const profile = tracker.buildClashConfig(inbound, client, { server: 'v.sunandyu.top' });

    assert.doesNotMatch(profile, /\n\s+flow:/);
  });

  it('uses config display name for Clash node when provided', () => {
    const tracker = loadTracker({ inbounds: [] });
    const inbound = {
      protocol: 'vless',
      port: 443,
      settings: JSON.stringify({
        clients: [{ email: '3239468786@qq.com', id: 'eeaf6b42-51bc-4a0d-a776-2d21f80a2ee3' }],
      }),
      streamSettings: JSON.stringify({
        realitySettings: {
          serverNames: ['www.microsoft.com'],
          shortIds: ['abcd'],
          settings: { publicKey: 'pub-key', fingerprint: 'chrome' },
        },
      }),
    };
    const client = { email: '3239468786@qq.com' };

    const profile = tracker.buildClashConfig(
      inbound,
      client,
      { server: 'v.sunandyu.top' },
      'iyu'
    );

    assert.match(profile, /- name: "iyu"/);
    assert.match(profile, /proxies:\n\s+- "iyu"/);
    assert.doesNotMatch(profile, /3239468786@qq.com/);
  });

  it('filters direct REALITY nodes out of subscription exports', () => {
    const tracker = loadTracker({ inbounds: [] });
    const client = { email: 'hua.com' };
    const wsInbound = {
      id: 1,
      protocol: 'vless',
      port: 443,
      settings: JSON.stringify({
        clients: [{ email: 'hua.com', id: 'eeaf6b42-51bc-4a0d-a776-2d21f80a2ee3' }],
      }),
      streamSettings: JSON.stringify({
        network: 'ws',
        tlsSettings: { serverName: 'cdn.sunandyu.top' },
        wsSettings: { path: '/vless', host: 'cdn.sunandyu.top' },
      }),
    };
    const realityInbound = {
      id: 2,
      protocol: 'vless',
      port: 443,
      settings: JSON.stringify({
        clients: [{ email: 'hua.com', id: 'eeaf6b42-51bc-4a0d-a776-2d21f80a2ee3' }],
      }),
      streamSettings: JSON.stringify({
        realitySettings: {
          serverNames: ['www.microsoft.com'],
          shortIds: ['abcd'],
          settings: { publicKey: 'pub-key', fingerprint: 'chrome' },
        },
      }),
    };

    const filtered = tracker.filterSubscriptionPairs([
      { inbound: wsInbound, client },
      { inbound: realityInbound, client },
    ], { server: 'v.sunandyu.top' });

    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].inbound.id, 1);
  });

  it('expands one CF inbound across configured CDN node domains', () => {
    const tracker = loadTracker({ inbounds: [] });
    const client = { email: 'hua.com' };
    const inbound = {
      id: 1,
      protocol: 'vless',
      port: 2083,
      settings: JSON.stringify({
        clients: [{ email: 'hua.com', id: 'eeaf6b42-51bc-4a0d-a776-2d21f80a2ee3' }],
      }),
      streamSettings: JSON.stringify({
        network: 'ws',
        tlsSettings: { serverName: 'v.sunandyu.top' },
        wsSettings: { path: '/vlws', host: 'v.sunandyu.top' },
      }),
    };

    const profile = tracker.buildMultiClashConfig(
      [{ inbound, client }],
      {
        server: 'v.sunandyu.top',
        cdnNodeServers: [
          'sub2.sunandyu.top',
          'https://sub.ricardo777.dpdns.org:2053',
        ],
      },
      'Hua'
    );

    assert.match(profile, /- name: "Hua \(主\)"/);
    assert.match(profile, /server: "v\.sunandyu\.top"/);
    assert.match(profile, /servername: "v\.sunandyu\.top"/);
    assert.match(profile, /Host: "v\.sunandyu\.top"/);
    assert.match(profile, /- name: "Hua \(备用1\)"/);
    assert.match(profile, /server: "sub2\.sunandyu\.top"/);
    assert.match(profile, /servername: "sub2\.sunandyu\.top"/);
    assert.match(profile, /Host: "sub2\.sunandyu\.top"/);
    assert.match(profile, /- name: "Hua \(备用2\)"/);
    assert.match(profile, /server: "sub\.ricardo777\.dpdns\.org"/);
    assert.match(profile, /servername: "sub\.ricardo777\.dpdns\.org"/);
    assert.match(profile, /Host: "sub\.ricardo777\.dpdns\.org"/);
  });

  it('ignores disabled direct inbounds when choosing live traffic source', async () => {
    const tracker = loadTracker({
      inbounds: [
        {
          id: 1,
          enable: false,
          protocol: 'vless',
          port: 443,
          settings: JSON.stringify({
            clients: [{ email: 'hua.com', id: 'eeaf6b42-51bc-4a0d-a776-2d21f80a2ee3' }],
          }),
          streamSettings: JSON.stringify({
            realitySettings: {
              serverNames: ['www.microsoft.com'],
              shortIds: ['abcd'],
              settings: { publicKey: 'pub-key', fingerprint: 'chrome' },
            },
          }),
          clientStats: [{ email: 'hua.com', up: 100, down: 900, allTime: 1000, enable: true }],
        },
        {
          id: 3,
          enable: true,
          protocol: 'vless',
          port: 2083,
          settings: JSON.stringify({
            clients: [{ email: 'hua.com', id: 'eeaf6b42-51bc-4a0d-a776-2d21f80a2ee3' }],
          }),
          streamSettings: JSON.stringify({
            network: 'ws',
            tlsSettings: { serverName: 'v.sunandyu.top' },
            wsSettings: { path: '/vlws', host: '' },
          }),
          clientStats: [],
        },
      ],
    });

    const stats = await tracker.getUserStats('hua.com', { displayName: 'Hua' });

    assert.deepEqual(stats.total, { up: 0, down: 0 });
    assert.equal(stats.node.port, 2083);
  });

  it('ranks users by day, month, and total traffic', async () => {
    const tracker = loadTracker({
      inbounds: [{
        protocol: 'tcp',
        port: 443,
        remark: 'node',
        settings: '{}',
        clientStats: [
          { email: 'a@example.com', up: 1000, down: 2000, allTime: 9000, enable: true },
          { email: 'b@example.com', up: 500, down: 500, allTime: 5000, enable: true },
        ],
      }],
    });

    const entries = [
      { name: 'A', email: 'a@example.com', token: 't1' },
      { name: 'B', email: 'b@example.com', token: 't2' },
    ];

    const day = await tracker.getTrafficRanking(entries, 'day');
    assert.equal(day.period, 'day');
    assert.equal(day.users[0].email, 'a@example.com');
    assert.equal(day.users[0].bytes, 100);
    assert.equal(day.users[0].online, true);

    const month = await tracker.getTrafficRanking(entries, 'month');
    assert.equal(month.users[0].bytes, 3000);
    assert.equal(month.users[1].bytes, 1000);

    const total = await tracker.getTrafficRanking(entries, 'total');
    assert.equal(total.users[0].bytes, 9000);
    assert.equal(total.users[1].bytes, 5000);
    assert.equal(total.users[0].rank, 1);
    assert.equal(total.users[1].rank, 2);
  });

  it('uses snapshot month traffic when live billing counters are zero', async () => {
    const tracker = loadTracker({
      inbounds: [{
        protocol: 'tcp',
        port: 443,
        remark: 'node',
        settings: '{}',
        clientStats: [
          { email: 'a@example.com', up: 0, down: 0, allTime: 1000, enable: true },
        ],
      }],
      dbOverrides: {
        getPeriodTraffic: (email, start) => {
          if (start === 200) return { up: 80, down: 20 };
          return { up: 0, down: 0 };
        },
      },
    });

    const stats = await tracker.getUserStats('a@example.com');
    assert.deepEqual(stats.month, { up: 80, down: 20 });

    const month = await tracker.getTrafficRanking(
      [{ name: 'A', email: 'a@example.com', token: 't1' }],
      'month'
    );
    assert.equal(month.users[0].bytes, 100);
  });
});
