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
  it('loads stats by access token instead of display name', () => {
    const app = readPublic('app.js');

    assert.match(app, /\/api\/stats\?token=/);
    assert.doesNotMatch(app, /\/api\/stats\?name=/);
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
