const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getClashProfileFilename } = require('../clash-profile-name');

describe('clash profile filename', () => {
  it('uses custom clashName when configured', () => {
    const filename = getClashProfileFilename({
      clashName: '我的 Clash 订阅',
      name: 'iyu',
      email: 'vps3-iyu',
    });

    assert.equal(filename, '我的 Clash 订阅');
  });

  it('uses the product subscription name by default', () => {
    const filename = getClashProfileFilename({ name: 'iyu', email: 'vps3-iyu' });

    assert.equal(filename, 'shareV ultra');
  });

  it('normalizes unsafe filename characters', () => {
    const filename = getClashProfileFilename({ clashName: 'share/v\\clash:订阅.yaml' });

    assert.equal(filename, 'share_v_clash_订阅');
  });
});
