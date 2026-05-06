const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createUserDirectory } = require('../user-directory');

describe('user directory', () => {
  it('looks up users by token instead of display name', () => {
    const directory = createUserDirectory({
      'uuid-1': { name: 'Hua', email: 'vps3-Hua', token: 'tok_hua' },
      'uuid-2': { name: 'Li', email: 'vps3-Li', token: 'tok_li' },
    });

    assert.equal(directory.findByToken('tok_hua').email, 'vps3-Hua');
    assert.equal(directory.findByToken('Hua'), null);
  });

  it('rejects duplicate tokens', () => {
    assert.throws(() => createUserDirectory({
      'uuid-1': { name: 'Hua', email: 'vps3-Hua', token: 'same' },
      'uuid-2': { name: 'Li', email: 'vps3-Li', token: 'same' },
    }), /Duplicate token/);
  });

  it('builds admin-safe user links without exposing x-ui credentials', () => {
    const directory = createUserDirectory({
      'uuid-1': { name: 'Hua', email: 'vps3-Hua', token: 'tok_hua' },
    });

    const users = directory.listUsers('https://v.sunandyu.top:2053');

    assert.deepEqual(users, [{
      uuid: 'uuid-1',
      name: 'Hua',
      email: 'vps3-Hua',
      token: 'tok_hua',
      url: 'https://v.sunandyu.top:2053/#t=tok_hua',
    }]);
  });
});
