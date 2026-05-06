const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDB } = require('../db');

function localDate(sec) {
  const d = new Date(sec * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('db', () => {
  let db;

  beforeEach(() => {
    db = createDB(':memory:');
  });

  describe('getTodayStart', () => {
    it('returns midnight of today in local time', () => {
      const ts = db.getTodayStart();
      const d = new Date(ts * 1000);
      assert.equal(d.getHours(), 0);
      assert.equal(d.getMinutes(), 0);
      assert.equal(d.getSeconds(), 0);
      // Should be today
      const now = new Date();
      assert.equal(d.getDate(), now.getDate());
      assert.equal(d.getMonth(), now.getMonth());
    });
  });

  describe('getMonthStart', () => {
    it('returns 1st of current month at midnight', () => {
      const ts = db.getMonthStart();
      const d = new Date(ts * 1000);
      assert.equal(d.getDate(), 1);
      assert.equal(d.getHours(), 0);
      assert.equal(d.getMonth(), new Date().getMonth());
    });
  });

  describe('getLastMonthStart', () => {
    it('returns 1st of previous month at midnight', () => {
      const ts = db.getLastMonthStart();
      const d = new Date(ts * 1000);
      assert.equal(d.getDate(), 1);
      assert.equal(d.getHours(), 0);
      const now = new Date();
      const expectedMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
      assert.equal(d.getMonth(), expectedMonth);
    });
  });

  describe('insertSnapshot + getLatestSnapshot', () => {
    it('inserts and retrieves a snapshot', () => {
      db.insertSnapshot('user1', 100, 200, 50, 150, 1000);
      const snap = db.getLatestSnapshot('user1');
      assert.equal(snap.up, 100);
      assert.equal(snap.down, 200);
      assert.equal(snap.allUp, 50);
      assert.equal(snap.allDown, 150);
      assert.equal(snap.timestamp, 1000);
    });

    it('returns latest when multiple snapshots exist', () => {
      db.insertSnapshot('user1', 100, 200, 50, 150, 1000);
      db.insertSnapshot('user1', 200, 400, 100, 300, 2000);
      const snap = db.getLatestSnapshot('user1');
      assert.equal(snap.timestamp, 2000);
    });

    it('returns undefined for non-existent email', () => {
      assert.equal(db.getLatestSnapshot('nobody'), undefined);
    });
  });

  describe('getPeriodTraffic', () => {
    it('returns zero when no snapshots exist', () => {
      const result = db.getPeriodTraffic('user1', 1000);
      assert.deepEqual(result, { up: 0, down: 0 });
    });

    it('returns zero when only one snapshot exists (no baseline)', () => {
      db.insertSnapshot('user1', 100, 200, 1000, 2000, 1500);
      const result = db.getPeriodTraffic('user1', 1000);
      // Only one snapshot after period start, can't compute delta
      assert.deepEqual(result, { up: 0, down: 0 });
    });

    it('calculates delta between baseline and latest', () => {
      db.insertSnapshot('user1', 100, 200, 1000, 2000, 500);  // before period
      db.insertSnapshot('user1', 200, 400, 1500, 3500, 1500); // after period
      const result = db.getPeriodTraffic('user1', 1000);
      assert.equal(result.up, 500);   // 1500 - 1000
      assert.equal(result.down, 1500); // 3500 - 2000
    });

    it('uses earliest snapshot as fallback when no baseline before period', () => {
      // Both snapshots after period start, but we can compute delta between them
      db.insertSnapshot('user1', 100, 200, 1000, 2000, 1200);
      db.insertSnapshot('user1', 200, 400, 1500, 3500, 1500);
      const result = db.getPeriodTraffic('user1', 1000);
      assert.equal(result.up, 500);
      assert.equal(result.down, 1500);
    });

    it('does not overcount when estimated all-time directions drift', () => {
      db.insertSnapshot('user1', 3_900_000, 65_000_000, 7_290_000_000, 120_540_000_000, 1200);
      db.insertSnapshot('user1', 9_400_000, 937_000_000, 1_280_000_000, 127_430_000_000, 1500);

      const result = db.getPeriodTraffic('user1', 1000);

      assert.equal(result.up, 5_500_000);
      assert.equal(result.down, 872_000_000);
    });

    it('uses post-reset counters when 3x-ui counters roll over', () => {
      db.insertSnapshot('user1', 900, 1200, 900, 1200, 1200);
      db.insertSnapshot('user1', 40, 70, 40, 70, 1500);

      const result = db.getPeriodTraffic('user1', 1000);

      assert.deepEqual(result, { up: 40, down: 70 });
    });

    it('uses all-time delta with current direction ratio when current counters reset but all-time keeps increasing', () => {
      db.insertSnapshot('user1', 900, 1200, 900, 1200, 1200);
      db.insertSnapshot('user1', 40, 120, 1000, 1400, 1500);

      const result = db.getPeriodTraffic('user1', 1000);

      assert.deepEqual(result, { up: 75, down: 225 });
    });

    it('does not count recovered all-time totals as period traffic when current counters did not move', () => {
      db.insertSnapshot('user1', 0, 0, 0, 0, 1200);
      db.insertSnapshot('user1', 0, 0, 0, 1_000, 1500);

      const result = db.getPeriodTraffic('user1', 1000);

      assert.deepEqual(result, { up: 0, down: 0 });
    });
  });

  describe('insertSnapshots (batch)', () => {
    it('inserts multiple rows in a transaction', () => {
      db.insertSnapshots([
        { email: 'a', up: 1, down: 2, allUp: 10, allDown: 20, timestamp: 100 },
        { email: 'b', up: 3, down: 4, allUp: 30, allDown: 40, timestamp: 200 },
      ]);
      assert.equal(db.getLatestSnapshot('a').up, 1);
      assert.equal(db.getLatestSnapshot('b').down, 4);
    });
  });

  describe('getDailyTraffic', () => {
    it('returns correct number of days', () => {
      // Insert some snapshots
      const now = Math.floor(Date.now() / 1000);
      db.insertSnapshot('user1', 100, 200, 0, 0, now - 86400 * 3);
      db.insertSnapshot('user1', 200, 400, 100, 200, now);
      const daily = db.getDailyTraffic('user1', 7);
      assert.equal(daily.length, 7);
      assert.ok(daily[0].date.match(/^\d{4}-\d{2}-\d{2}$/));
    });

    it('uses the first in-day snapshot as baseline when there is no midnight snapshot', () => {
      const today = db.getTodayStart();
      db.insertSnapshot('user1', 3_900_000, 65_000_000, 7_290_000_000, 120_540_000_000, today + 60);
      db.insertSnapshot('user1', 9_400_000, 937_000_000, 1_280_000_000, 127_430_000_000, today + 120);

      const daily = db.getDailyTraffic('user1', 1);

      assert.deepEqual(daily[0], {
        date: localDate(today),
        up: 5_500_000,
        down: 872_000_000,
      });
    });
  });

  describe('cleanup', () => {
    it('deletes snapshots older than 90 days', () => {
      const now = Math.floor(Date.now() / 1000);
      db.insertSnapshot('user1', 1, 2, 10, 20, now - 91 * 86400); // old
      db.insertSnapshot('user1', 3, 4, 30, 40, now); // recent
      db.cleanup();
      const snap = db.getLatestSnapshot('user1');
      assert.equal(snap.up, 3);
    });
  });

  describe('backup', () => {
    it('returns a promise that resolves after the backup is written', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sharev-backup-'));
      const dest = path.join(dir, 'traffic.db.bak');

      db.insertSnapshot('user1', 1, 2, 10, 20, 1000);
      const backup = db.backup(dest);

      assert.equal(typeof backup.then, 'function');
      await backup;
      assert.equal(fs.existsSync(dest), true);
    });
  });
});
