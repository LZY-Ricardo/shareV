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

function loadTracker({ inbounds, latestSnapshot = null, getInboundsError = null }) {
  delete require.cache[trackerPath];

  stubModule(xuiPath, {
    getInbounds: async () => {
      if (getInboundsError) throw getInboundsError;
      return inbounds;
    },
    getOnlineClients: async () => [],
    getClientIps: async () => [],
  });

  stubModule(dbPath, {
    getPeriodTraffic: () => ({ up: 0, down: 0 }),
    getDailyTraffic: () => [],
    getTodayStart: () => 0,
    getMonthStart: () => 0,
    getLastMonthStart: () => 0,
    getLatestSnapshot: () => latestSnapshot,
    getRecentSpeed: () => null,
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
        clients: [{ email: 'Hua', id: 'eeaf6b42-51bc-4a0d-a776-2d21f80a2ee3' }],
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
    const client = { email: 'Hua' };

    const profile = tracker.buildClashConfig(inbound, client, { server: 'v.sunandyu.top' });

    assert.doesNotMatch(profile, /\n\s+flow:/);
  });
});
