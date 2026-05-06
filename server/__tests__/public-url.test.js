const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolvePublicUrl } = require('../public-url');

describe('public url resolution', () => {
  it('prefers configured publicUrl when building user links', () => {
    const req = {
      protocol: 'https',
      get(name) {
        return name.toLowerCase() === 'host' ? 'v.sunandyu.top' : '';
      },
    };

    assert.equal(
      resolvePublicUrl({ publicUrl: 'https://v.sunandyu.top:2053/' }, req),
      'https://v.sunandyu.top:2053'
    );
  });
});
