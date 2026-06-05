const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createDB } = require('../db');
const { createUserDirectory } = require('../user-directory');
const {
  createAuth,
  hashPassword,
  verifyPassword,
  auditUserPasswords,
  userUsesDefaultPassword,
  DEFAULT_USER_PASSWORD,
} = require('../auth');

describe('auth', () => {
  it('hashes and verifies passwords', () => {
    const hash = hashPassword('123456');
    assert.match(hash, /^scrypt:/);
    assert.equal(verifyPassword('123456', hash), true);
    assert.equal(verifyPassword('wrong', hash), false);
  });

  it('logs in users by 3X-UI id with default password', () => {
    const db = createDB(':memory:');
    const directory = createUserDirectory({
      'uuid-1': { name: 'Hua', email: 'vps3-Hua', token: 'tok_hua' },
    });
    const auth = createAuth({ db, userDirectory: directory });

    const ok = auth.loginUser('vps3-Hua', DEFAULT_USER_PASSWORD);
    const badEmail = auth.loginUser('missing', DEFAULT_USER_PASSWORD);
    const badPassword = auth.loginUser('vps3-Hua', '000000');

    assert.equal(ok.ok, true);
    assert.equal(ok.user.email, 'vps3-Hua');
    assert.equal(badEmail.ok, false);
    assert.equal(badPassword.ok, false);
  });

  it('logs in users by 3X-UI qq email', () => {
    const db = createDB(':memory:');
    const directory = createUserDirectory({
      'uuid-1': { name: '钟', email: '2099538662@qq.com', token: 'tok_zhong' },
    });
    const auth = createAuth({ db, userDirectory: directory });

    assert.equal(auth.loginUser('2099538662@qq.com', DEFAULT_USER_PASSWORD).ok, true);
    assert.equal(auth.loginUser('2099538662@QQ.COM', DEFAULT_USER_PASSWORD).ok, true);
    assert.equal(auth.loginUser('钟', DEFAULT_USER_PASSWORD).ok, false);
  });

  it('supports custom password hashes per user', () => {
    const db = createDB(':memory:');
    const directory = createUserDirectory({
      'uuid-1': {
        name: 'Hua',
        email: 'vps3-Hua',
        token: 'tok_hua',
        passwordHash: hashPassword('secret'),
      },
    });
    const auth = createAuth({ db, userDirectory: directory });

    assert.equal(auth.loginUser('vps3-Hua', 'secret').ok, true);
    assert.equal(auth.loginUser('vps3-Hua', DEFAULT_USER_PASSWORD).ok, false);
  });

  it('creates and reads user sessions from cookies', () => {
    const db = createDB(':memory:');
    const directory = createUserDirectory({
      'uuid-1': { name: 'Hua', email: 'vps3-Hua', token: 'tok_hua' },
    });
    const auth = createAuth({ db, userDirectory: directory });

    const req = { secure: false, headers: { 'x-forwarded-proto': 'http' } };
    const res = { headers: {} };
    res.setHeader = (name, value) => { res.headers[name] = value; };

    auth.createUserSession('uuid-1', req, res);
    assert.match(res.headers['Set-Cookie'], /sharev_session=/);

    const cookie = res.headers['Set-Cookie'].split(';')[0];
    const sessionReq = { headers: { cookie } };
    const user = auth.getUserFromSession(sessionReq);

    assert.equal(user.email, 'vps3-Hua');
  });

  it('detects default password users', () => {
    assert.equal(userUsesDefaultPassword({ email: 'a@x.com' }), true);
    assert.equal(
      userUsesDefaultPassword({ email: 'b@x.com', password: DEFAULT_USER_PASSWORD }),
      true
    );
    assert.equal(
      userUsesDefaultPassword({ email: 'c@x.com', password: 'other' }),
      false
    );
    assert.equal(
      userUsesDefaultPassword({ email: 'd@x.com', passwordHash: hashPassword('x') }),
      false
    );
  });

  it('changes password from default to a custom hash', () => {
    const db = createDB(':memory:');
    const directory = createUserDirectory({
      'uuid-1': { name: 'Hua', email: 'a@example.com', token: 'tok' },
    });
    const auth = createAuth({ db, userDirectory: directory });
    const user = directory.findByUuid('uuid-1');

    const bad = auth.changeUserPassword(user, '000000', 'newpass1');
    const weak = auth.changeUserPassword(user, DEFAULT_USER_PASSWORD, '123');
    const sameDefault = auth.changeUserPassword(user, DEFAULT_USER_PASSWORD, DEFAULT_USER_PASSWORD);
    const ok = auth.changeUserPassword(user, DEFAULT_USER_PASSWORD, 'newpass1');

    assert.equal(bad.ok, false);
    assert.equal(weak.ok, false);
    assert.equal(sameDefault.ok, false);
    assert.equal(ok.ok, true);
    assert.match(ok.passwordHash, /^scrypt:/);
    assert.equal(auth.userUsesDefaultPassword(user), true);

    user.passwordHash = ok.passwordHash;
    assert.equal(auth.userUsesDefaultPassword(user), false);
    assert.equal(auth.loginUser('a@example.com', 'newpass1').ok, true);
  });

  it('audits users on default or plaintext passwords', () => {
    const audit = auditUserPasswords({
      'uuid-1': { name: 'A', email: 'a@example.com', token: 't1' },
      'uuid-2': { name: 'B', email: 'b@example.com', token: 't2', password: 'plain' },
      'uuid-3': { name: 'C', email: 'c@example.com', token: 't3', passwordHash: hashPassword('x') },
    });

    assert.deepEqual(audit.defaultPasswordUsers, ['a@example.com']);
    assert.deepEqual(audit.plainTextUsers, ['b@example.com']);
  });
});
