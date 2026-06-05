const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'app.js'), 'utf8');

describe('auth routes', () => {
  it('rate limits auth endpoints before handlers run', () => {
    for (const route of ['/api/auth/login', '/api/auth/token']) {
      const pattern = new RegExp(
        `app\\.post\\('${route.replace(/\//g, '\\/')}',\\s*authRateLimiter`
      );
      assert.match(indexSource, pattern);
    }
  });

  it('protects stats and speed with session or token resolution', () => {
    assert.match(indexSource, /app\.get\('\/api\/stats',\s*rateLimiter[\s\S]*resolveUser\(req, res\)/);
    assert.match(indexSource, /app\.get\('\/api\/speed',\s*rateLimiter[\s\S]*resolveUser\(req, res\)/);
    assert.match(indexSource, /app\.get\('\/sub\/clash'[\s\S]*getUserByToken\(req, res\)/);
  });

  it('audits default and plaintext passwords at startup', () => {
    assert.match(indexSource, /auditUserPasswords\(config\.users\)/);
    assert.match(indexSource, /defaultPasswordUsers/);
    assert.match(indexSource, /plainTextUsers/);
  });

  it('uses text input for 3X-UI qq email on the login form', () => {
    assert.match(appSource, /type="text" id="emailInput"/);
    assert.match(appSource, /QQ 邮箱（与 3X-UI 一致）/);
    assert.doesNotMatch(appSource, /type="email" id="emailInput"/);
  });
});
