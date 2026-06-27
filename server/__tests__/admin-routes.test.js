const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

describe('admin routes', () => {
  it('rate limits admin endpoints before auth checks', () => {
    for (const route of [
      '/api/admin/users',
      '/api/admin/stats',
      '/api/admin/traffic-ranking',
      '/api/admin/snapshot',
    ]) {
      const pattern = new RegExp(
        `app\\.(?:get|post)\\('${route.replace(/\//g, '\\/')}',\\s*rateLimiter,\\s*requireAdmin`
      );
      assert.match(indexSource, pattern);
    }
  });

  it('exposes admin traffic ranking endpoint and UI', () => {
    assert.match(indexSource, /tracker\.getTrafficRanking\(entries, period\)/);
    const adminSource = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'admin.js'), 'utf8');
    assert.match(adminSource, /\/api\/admin\/traffic-ranking/);
    assert.match(adminSource, /流量排行/);
  });

  it('exposes a Clash subscription URL for user stats responses', () => {
    assert.match(indexSource, /clashConfigUrl\s*:\s*stats\.clashConfig \? getClashConfigUrl\(req, user\.token\) : null/);
    assert.match(indexSource, /\/sub\/clash\?token=\$\{encodeURIComponent\(token\)\}/);
    assert.match(indexSource, /app\.get\('\/sub\/clash'/);
    assert.match(indexSource, /content-type',\s*'text\/yaml/);
  });

  it('serves v2rayN subscriptions as plain share links with a stable group name', () => {
    assert.match(indexSource, /\/sub\/v2rayn\?token=\$\{encodeURIComponent\(token\)\}&remarks=shareV%20ultra/);
    assert.match(indexSource, /res\.send\(\`\$\{links\.join\('\\n'\)\}\\n\`\)/);
    assert.doesNotMatch(indexSource, /Buffer\.from\(links\.join\('\\n'\)/);
  });

  it('exposes backup subscription URLs from configured backup public URLs', () => {
    assert.match(indexSource, /resolveBackupPublicUrls\(config\)/);
    assert.match(indexSource, /backupClashConfigUrls/);
    assert.match(indexSource, /backupV2raynConfigUrls/);
  });

  it('does not describe direct REALITY as a subscription fallback anymore', () => {
    const emailSource = fs.readFileSync(path.join(__dirname, '..', 'email.js'), 'utf8');

    assert.match(emailSource, /订阅移除直连节点/);
    assert.doesNotMatch(emailSource, /Clash 订阅已合并双节点/);
  });
});
