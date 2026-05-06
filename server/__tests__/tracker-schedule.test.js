const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const trackerSource = fs.readFileSync(path.join(__dirname, '..', 'traffic-tracker.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

describe('traffic tracker scheduling', () => {
  it('takes a dedicated midnight snapshot for daily baselines', () => {
    assert.match(trackerSource, /cron\.schedule\('0 0 \* \* \*',\s*snapshot\)/);
  });

  it('checks for a startup daily baseline inside tracker init', () => {
    assert.match(trackerSource, /ensureTodayBaselineSnapshot/);
    assert.doesNotMatch(indexSource, /setTimeout\(\(\) => tracker\.snapshot\(\), 3000\)/);
  });
});
