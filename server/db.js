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

  function snapshotTotal(row) {
    if (!row) return 0;
    const allTotal = (row.allUp || 0) + (row.allDown || 0);
    return allTotal > 0 ? allTotal : (row.up || 0) + (row.down || 0);
  }

  function trafficDelta(from, to) {
    if (!from || !to || from.timestamp >= to.timestamp) return { up: 0, down: 0 };

    const rawUp = (to.up || 0) - (from.up || 0);
    const rawDown = (to.down || 0) - (from.down || 0);
    const rawTotal = rawUp + rawDown;
    const rawReset = rawUp < 0 || rawDown < 0;
    const currentUp = to.up || 0;
    const currentDown = to.down || 0;
    const currentTotal = currentUp + currentDown;
    const fromTotal = snapshotTotal(from);
    const toTotal = snapshotTotal(to);
    const totalDelta = Math.max(0, toTotal - fromTotal);

    if (rawReset && toTotal < fromTotal) {
      return { up: currentUp, down: currentDown };
    }

    if (totalDelta === 0) return { up: 0, down: 0 };

    function splitByRatio(upBase, downBase) {
      const ratioTotal = upBase + downBase;
      if (ratioTotal <= 0) return { up: 0, down: totalDelta };
      const up = Math.round(totalDelta * (upBase / ratioTotal));
      return { up, down: totalDelta - up };
    }

    if (rawReset && currentTotal > 0) {
      return splitByRatio(currentUp, currentDown);
    }

    const tolerance = Math.max(1, totalDelta * 0.01);
    if (rawUp >= 0 && rawDown >= 0 && rawTotal > 0 && Math.abs(rawTotal - totalDelta) <= tolerance) {
      return { up: rawUp, down: rawDown };
    }

    const allUp = Math.max(0, (to.allUp || 0) - (from.allUp || 0));
    const allDown = Math.max(0, (to.allDown || 0) - (from.allDown || 0));
    const allTotal = allUp + allDown;
    if (allTotal === 0) return { up: 0, down: totalDelta };
    if (Math.abs(allTotal - totalDelta) <= tolerance) {
      return { up: allUp, down: allDown };
    }

    return splitByRatio(allUp, allDown);
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

      const beforeDay = getSnapshotAtOrBefore(email, startTs) || getSnapshotAtOrAfter(email, startTs);
      const atDayEnd = getSnapshotAtOrBefore(email, endTs);

      const { up, down } = trafficDelta(beforeDay, atDayEnd);

      results.push({
        date: localDateStr(dayStart),
        up,
        down,
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
        return trafficDelta(earliest, latest);
      }
      return { up: 0, down: 0 };
    }

    return trafficDelta(before, latest);
  }

  // Get today's start timestamp (local timezone midnight)
  function getTodayStart() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.floor(now.getTime() / 1000);
  }

  function hasSnapshotsSince(timestamp) {
    const row = db.prepare('SELECT 1 FROM traffic_snapshots WHERE timestamp >= ? LIMIT 1').get(timestamp);
    return Boolean(row);
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
    insertSnapshot,
    insertSnapshots,
    getSnapshotAtOrBefore,
    getLatestSnapshot,
    getDailyTraffic,
    getPeriodTraffic,
    getTodayStart,
    hasSnapshotsSince,
    getMonthStart,
    getLastMonthStart,
    cleanup,
    backup(destPath) {
      return db.backup(destPath);
    },
    close() {
      db.close();
    },
  };
}

// Default instance for production
const defaultDB = createDB(path.join(__dirname, '..', 'data', 'traffic.db'));

module.exports = { createDB, ...defaultDB };
