const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createUserDirectory } = require('../user-directory');

describe('user directory', () => {
  it('looks up users by token instead of display name', () => {
    const directory = createUserDirectory({
      'uuid-1': { name: 'Hua', email: '2647345339@qq.com', token: 'tok_hua' },
      'uuid-2': { name: 'Li', email: 'lisi@example.com', token: 'tok_li' },
    });

    assert.equal(directory.findByToken('tok_hua').email, '2647345339@qq.com');
    assert.equal(directory.findByToken('Hua'), null);
  });

  it('looks up users by email for login', () => {
    const directory = createUserDirectory({
      'uuid-1': { name: '钟', email: '2099538662@qq.com', token: 'tok_zhong' },
    });

    assert.equal(directory.findByLoginAccount('2099538662@qq.com').name, '钟');
    assert.equal(directory.findByLoginAccount('2099538662@QQ.COM').name, '钟');
    assert.equal(directory.findByLoginAccount('missing'), null);
  });

  it('rejects duplicate emails', () => {
    assert.throws(() => createUserDirectory({
      'uuid-1': { name: 'A', email: 'same@example.com', token: 'tok_a' },
      'uuid-2': { name: 'B', email: 'same@example.com', token: 'tok_b' },
    }), /Duplicate login account/);
  });

  it('rejects duplicate tokens', () => {
    assert.throws(() => createUserDirectory({
      'uuid-1': { name: 'Hua', email: 'a@example.com', token: 'same' },
      'uuid-2': { name: 'Li', email: 'b@example.com', token: 'same' },
    }), /Duplicate token/);
  });

  it('rebuilds lookup tables after replaceAllUsers', () => {
    const directory = createUserDirectory({
      'uuid-1': { name: '旧名', email: 'old@example.com', token: 'tok' },
    });

    directory.replaceAllUsers({
      'uuid-1': { name: '钟', email: '2099538662@qq.com', token: 'tok' },
    });

    assert.equal(directory.findByLoginAccount('2099538662@qq.com').name, '钟');
    assert.equal(directory.findByLoginAccount('old@example.com'), null);
  });

  it('builds admin-safe user links without exposing x-ui credentials', () => {
    const directory = createUserDirectory({
      'uuid-1': { name: 'Hua', email: '2647345339@qq.com', token: 'tok_hua' },
    });

    const users = directory.listUsers('https://v.sunandyu.top:2053');

    assert.deepEqual(users, [{
      uuid: 'uuid-1',
      name: 'Hua',
      email: '2647345339@qq.com',
      token: 'tok_hua',
      url: 'https://v.sunandyu.top:2053/#t=tok_hua',
    }]);
  });
});
