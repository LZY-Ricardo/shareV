const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

describe('admin routes', () => {
  it('rate limits admin endpoints before auth checks', () => {
    for (const route of ['/api/admin/users', '/api/admin/stats', '/api/admin/snapshot']) {
      const pattern = new RegExp(
        `app\\.(?:get|post)\\('${route.replace(/\//g, '\\/')}',\\s*rateLimiter,\\s*requireAdmin`
      );
      assert.match(indexSource, pattern);
    }
  });

  it('exposes a Clash subscription URL for user stats responses', () => {
    assert.match(indexSource, /clashConfigUrl\s*:\s*stats\.clashConfig \? getClashConfigUrl\(req, user\.token\) : null/);
    assert.match(indexSource, /\/sub\/clash\?token=\$\{encodeURIComponent\(token\)\}/);
    assert.match(indexSource, /app\.get\('\/sub\/clash'/);
    assert.match(indexSource, /content-type',\s*'text\/yaml/);
  });
});
