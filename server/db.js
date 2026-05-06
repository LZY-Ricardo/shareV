const Database = require('better-sqlite3');
const path = require('path');

function createDB(dbPath) {
  const db = typeof dbPath === 'string' ? new Database(dbPath) : dbPath;

  if (dbPath !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS traffic_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      up INTEGER NOT NULL DEFAULT 0,
      down INTEGER NOT NULL DEFAULT 0,
      allUp INTEGER NOT NULL DEFAULT 0,
      allDown INTEGER NOT NULL DEFAULT 0,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ts_email ON traffic_snapshots(email, timestamp);
  `);

  // Insert a traffic snapshot
  function insertSnapshot(email, up, down, allUp, allDown, timestamp) {
    db.prepare('INSERT INTO traffic_snapshots (email, up, down, allUp, allDown, timestamp) VALUES (?, ?, ?, ?, ?, ?)')
      .run(email, up, down, allUp, allDown, timestamp);
  }

  // Batch insert snapshots
  function insertSnapshots(rows) {
    const stmt = db.prepare('INSERT INTO traffic_snapshots (email, up, down, allUp, allDown, timestamp) VALUES (?, ?, ?, ?, ?, ?)');
    const insertMany = db.transaction((items) => {
      for (const item of items) {
        stmt.run(item.email, item.up, item.down, item.allUp, item.allDown, item.timestamp);
      }
    });
    insertMany(rows);
  }

  // Get the nearest snapshot at or before a given timestamp for an email
  function getSnapshotAtOrBefore(email, timestamp) {
    return db.prepare(
      'SELECT up, down, allUp, allDown, timestamp FROM traffic_snapshots WHERE email = ? AND timestamp <= ? ORDER BY timestamp DESC LIMIT 1'
    ).get(email, timestamp);
  }

  // Get the latest snapshot for an email
  function getLatestSnapshot(email) {
    return db.prepare(
      'SELECT up, down, allUp, allDown, timestamp FROM traffic_snapshots WHERE email = ? ORDER BY timestamp DESC LIMIT 1'
    ).get(email);
  }

  // Get the earliest snapshot at or after a given timestamp for an email
  function getSnapshotAtOrAfter(email, timestamp) {
    return db.prepare(
      'SELECT up, down, allUp, allDown, timestamp FROM traffic_snapshots WHERE email = ? AND timestamp >= ? ORDER BY timestamp ASC LIMIT 1'
    ).get(email, timestamp);
  }

  // Format Date to YYYY-MM-DD using local timezone
  function localDateStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // Get daily traffic for the last N days (returns array of { date, up, down })
  function getDailyTraffic(email, days = 7) {
    const now = new Date();
    const results = [];

    for (let i = days - 1; i >= 0; i--) {
      const dayStart = new Date(now);
      dayStart.setDate(dayStart.getDate() - i);
      dayStart.setHours(0, 0, 0, 0);

      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const startTs = Math.floor(dayStart.getTime() / 1000);
      const endTs = Math.floor(dayEnd.getTime() / 1000);

      const beforeDay = getSnapshotAtOrBefore(email, startTs);
      const atDayEnd = getSnapshotAtOrBefore(email, endTs);

      const up = (atDayEnd?.allUp || 0) - (beforeDay?.allUp || 0);
      const down = (atDayEnd?.allDown || 0) - (beforeDay?.allDown || 0);

      results.push({
        date: localDateStr(dayStart),
        up: Math.max(0, up),
        down: Math.max(0, down),
      });
    }

    return results;
  }

  // Calculate traffic for a specific period
  function getPeriodTraffic(email, startTimestamp) {
    const before = getSnapshotAtOrBefore(email, startTimestamp);
    const latest = getLatestSnapshot(email);

    if (!latest) return { up: 0, down: 0 };
    if (!before) {
      // No baseline before period start — use earliest snapshot after start as fallback
      const earliest = getSnapshotAtOrAfter(email, startTimestamp);
      if (earliest && earliest.timestamp < latest.timestamp) {
        return {
          up: Math.max(0, (latest.allUp || latest.up) - (earliest.allUp || earliest.up)),
          down: Math.max(0, (latest.allDown || latest.down) - (earliest.allDown || earliest.down)),
        };
      }
      return { up: 0, down: 0 };
    }

    return {
      up: Math.max(0, (latest.allUp || latest.up) - (before.allUp || before.up)),
      down: Math.max(0, (latest.allDown || latest.down) - (before.allDown || before.down)),
    };
  }

  // Get today's start timestamp (local timezone midnight)
  function getTodayStart() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.floor(now.getTime() / 1000);
  }

  // Get this month's start timestamp (1st day of month, midnight)
  function getMonthStart() {
    const now = new Date();
    now.setDate(1);
    now.setHours(0, 0, 0, 0);
    return Math.floor(now.getTime() / 1000);
  }

  // Get last month's start timestamp (1st day of previous month, midnight)
  function getLastMonthStart() {
    const now = new Date();
    now.setMonth(now.getMonth() - 1);
    now.setDate(1);
    now.setHours(0, 0, 0, 0);
    return Math.floor(now.getTime() / 1000);
  }

  // Clean up old snapshots (keep last 90 days)
  function cleanup() {
    const cutoff = Math.floor(Date.now() / 1000) - 90 * 24 * 3600;
    db.prepare('DELETE FROM traffic_snapshots WHERE timestamp < ?').run(cutoff);
  }

  return {
    db,
    insertSnapshot,
    insertSnapshots,
    getSnapshotAtOrBefore,
    getLatestSnapshot,
    getDailyTraffic,
    getPeriodTraffic,
    getTodayStart,
    getMonthStart,
    getLastMonthStart,
    cleanup,
  };
}

// Default instance for production
const defaultDB = createDB(path.join(__dirname, '..', 'data', 'traffic.db'));

module.exports = { createDB, ...defaultDB };
