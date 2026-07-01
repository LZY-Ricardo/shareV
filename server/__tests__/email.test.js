const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const email = require('../email');

describe('monthly report email', () => {
  it('renders the completed report month instead of the send month', () => {
    const html = email._test.buildMonthlyHtml(
      { name: '测试用户', email: 'user@example.com', token: 'tok' },
      {
        monthlyReport: {
          year: 2026,
          month: 6,
          traffic: { up: 1024 ** 3, down: 2 * 1024 ** 3 },
        },
        today: { up: 1, down: 2 },
        month: { up: 3, down: 4 },
        total: { up: 10, down: 20 },
        node: { totalGB: 100, remark: 'node' },
      },
      'https://example.com'
    );

    assert.match(html, /2026 年 6 月/);
    assert.match(html, /报告期流量/);
    assert.match(html, /3\.00 GB/);
    assert.doesNotMatch(html, /2026 年 7 月/);
  });
});
