const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');

function readPublic(file) {
  return fs.readFileSync(path.join(root, 'public', file), 'utf8');
}

describe('frontend assets', () => {
  it('declares an SVG favicon that exists in public assets', () => {
    const html = readPublic('index.html');
    const faviconPath = path.join(root, 'public', 'favicon.svg');

    assert.match(html, /rel="icon"[^>]+href="\/favicon\.svg"/);
    assert.equal(fs.existsSync(faviconPath), true);
  });

  it('ships a dedicated admin page and script', () => {
    const html = readPublic('admin.html');

    assert.match(html, /<script src="\/admin\.js"><\/script>/);
    assert.equal(fs.existsSync(path.join(root, 'public', 'admin.js')), true);
  });
});

describe('access model', () => {
  it('supports session login and token fallback for stats', () => {
    const app = readPublic('app.js');

    assert.match(app, /\/api\/auth\/login/);
    assert.match(app, /\/api\/auth\/token/);
    assert.match(app, /\/api\/stats/);
    assert.match(app, /credentials:\s*'same-origin'/);
    assert.match(app, /type="text" id="emailInput"/);
    assert.match(app, /placeholder="QQ 邮箱"/);
    assert.doesNotMatch(app, /type="email" id="emailInput"/);
  });

  it('copies the Clash subscription URL for Clash Verge import', () => {
    const app = readPublic('app.js');

    assert.match(app, /data\.clashConfigUrl/);
    assert.match(app, /id="clashConfigUrl"/);
    assert.doesNotMatch(app, /id="clashConfigArea"/);
  });

  it('uses a real v2rayN subscription URL instead of an unsupported deep link', () => {
    const app = readPublic('app.js');

    assert.match(app, /data\.v2raynConfigUrl/);
    assert.match(app, /id="v2raynConfigUrl"/);
    assert.doesNotMatch(app, /v2rayn:\/\/install-config/);
    assert.doesNotMatch(app, /v2rayn:[^'"]*install-config\?url/);
  });

  it('offers immediate and subscription based v2rayN import actions with on-demand help', () => {
    const app = readPublic('app.js');
    const css = readPublic('style.css');

    assert.match(app, /复制全部节点/);
    assert.match(app, /copyAllV2raynNodes/);
    assert.match(app, /复制订阅链接/);
    assert.match(app, /data-tooltip=/);
    assert.match(css, /\.config-help-tip/);
    assert.doesNotMatch(app, /更新后两个节点都会出现/);
  });

  it('uses a compact selector instead of nested VLESS node tabs', () => {
    const app = readPublic('app.js');
    const css = readPublic('style.css');

    assert.match(app, /id="nodeSelect"/);
    assert.match(css, /\.config-node-select/);
    assert.doesNotMatch(app, /node-tabs/);
  });

  it('renders backup subscription URLs without crowding the primary action', () => {
    const app = readPublic('app.js');

    assert.match(app, /backupV2raynConfigUrls/);
    assert.match(app, /备用订阅链接/);
    assert.match(app, /copyBackupConfig/);
  });
});

describe('traffic chart responsiveness', () => {
  it('redraws the chart when viewport size changes', () => {
    const app = readPublic('app.js');

    assert.match(app, /addEventListener\('resize'/);
    assert.match(app, /drawChart\(getCurrentDaily\(\)\)/);
  });

  it('clips chart drawing to the chart container on narrow screens', () => {
    const css = readPublic('style.css');
    const chartContainerRule = css.match(/\.chart-container\s*\{[^}]+\}/)?.[0] || '';

    assert.match(chartContainerRule, /overflow:\s*hidden;/);
  });
});
