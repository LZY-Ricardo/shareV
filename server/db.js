const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

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

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      user_uuid TEXT,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);
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

    if (!rawReset && rawTotal === 0) {
      return { up: 0, down: 0 };
    }

    if (!rawReset && rawTotal > 0 && fromTotal === 0 && toTotal > rawTotal) {
      return { up: rawUp, down: rawDown };
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

  // Calculate traffic for a bounded period [startTimestamp, endTimestamp]
  function getPeriodTrafficBetween(email, startTimestamp, endTimestamp) {
    if (!endTimestamp || endTimestamp <= startTimestamp) return { up: 0, down: 0 };

    const before = getSnapshotAtOrBefore(email, startTimestamp);
    const atEnd = getSnapshotAtOrBefore(email, endTimestamp);

    if (!atEnd) return { up: 0, down: 0 };
    if (!before) {
      const earliest = getSnapshotAtOrAfter(email, startTimestamp);
      if (earliest && earliest.timestamp < atEnd.timestamp) {
        return trafficDelta(earliest, atEnd);
      }
      return { up: 0, down: 0 };
    }

    return trafficDelta(before, atEnd);
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
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    lastMonthStart.setHours(0, 0, 0, 0);
    return Math.floor(lastMonthStart.getTime() / 1000);
  }

  // Clean up old snapshots (keep last 90 days)
  function cleanup() {
    const cutoff = Math.floor(Date.now() / 1000) - 90 * 24 * 3600;
    db.prepare('DELETE FROM traffic_snapshots WHERE timestamp < ?').run(cutoff);
  }

  // Get average speed from last two snapshots
  function getRecentSpeed(email) {
    const row = db.prepare(`
      SELECT a.up AS up1, a.down AS down1, a.allUp AS allUp1, a.allDown AS allDown1, a.timestamp AS t1,
             b.up AS up2, b.down AS down2, b.allUp AS allUp2, b.allDown AS allDown2, b.timestamp AS t2
      FROM traffic_snapshots a
      JOIN traffic_snapshots b ON b.email = a.email AND b.id = (
        SELECT MAX(c.id) FROM traffic_snapshots c WHERE c.email = a.email AND c.id < a.id
      )
      WHERE a.email = ?
      ORDER BY a.timestamp DESC
      LIMIT 1
    `).get(email);
    if (!row || !row.t2) return null;
    const dt = row.t1 - row.t2;
    if (dt <= 0) return null;
    const delta = trafficDelta(
      { up: row.up2, down: row.down2, allUp: row.allUp2, allDown: row.allDown2, timestamp: row.t2 },
      { up: row.up1, down: row.down1, allUp: row.allUp1, allDown: row.allDown1, timestamp: row.t1 }
    );
    return { up: delta.up / dt, down: delta.down / dt, intervalSec: dt };
  }

  function createSession({ id, role, userUuid, expiresAt, createdAt }) {
    db.prepare(
      'INSERT INTO auth_sessions (id, role, user_uuid, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, role, userUuid || null, expiresAt, createdAt);
  }

  function getSession(id) {
    return db.prepare(
      'SELECT id, role, user_uuid, expires_at, created_at FROM auth_sessions WHERE id = ?'
    ).get(id);
  }

  function deleteSession(id) {
    db.prepare('DELETE FROM auth_sessions WHERE id = ?').run(id);
  }

  function deleteExpiredSessions(now) {
    db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(now);
  }

  function hasSnapshots(email) {
    const row = db.prepare('SELECT 1 FROM traffic_snapshots WHERE email = ? LIMIT 1').get(email);
    return Boolean(row);
  }

  function migrateSnapshotEmail(fromEmail, toEmail) {
    const from = String(fromEmail || '').trim();
    const to = String(toEmail || '').trim();
    if (!from || !to || from.toLowerCase() === to.toLowerCase()) return 0;
    const result = db.prepare('UPDATE traffic_snapshots SET email = ? WHERE email = ?').run(to, from);
    return result.changes;
  }

  function listDistinctSnapshotEmails() {
    return db.prepare('SELECT DISTINCT email FROM traffic_snapshots ORDER BY email').all()
      .map((row) => row.email);
  }

  return {
    insertSnapshot,
    insertSnapshots,
    getSnapshotAtOrBefore,
    getSnapshotAtOrAfter,
    getLatestSnapshot,
    getDailyTraffic,
    getPeriodTraffic,
    getPeriodTrafficBetween,
    getTodayStart,
    hasSnapshotsSince,
    getMonthStart,
    getLastMonthStart,
    getRecentSpeed,
    cleanup,
    createSession,
    getSession,
    deleteSession,
    deleteExpiredSessions,
    hasSnapshots,
    migrateSnapshotEmail,
    listDistinctSnapshotEmails,
    backup(destPath) {
      return db.backup(destPath);
    },
    close() {
      db.close();
    },
  };
}

// Default instance for production
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const defaultDB = createDB(path.join(dataDir, 'traffic.db'));

module.exports = { createDB, ...defaultDB };
