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
});
