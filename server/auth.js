const crypto = require('crypto');

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;
const USER_COOKIE = 'sharev_session';
const DEFAULT_SESSION_MAX_AGE_SEC = 7 * 24 * 3600;
const DEFAULT_USER_PASSWORD = '123456';

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, KEYLEN, SCRYPT_PARAMS);
  return `scrypt:${salt.toString('base64')}:${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  if (!stored || password == null) return false;
  const value = String(stored);
  if (value.startsWith('scrypt:')) {
    const parts = value.split(':');
    if (parts.length !== 3) return false;
    const salt = Buffer.from(parts[1], 'base64');
    const expected = Buffer.from(parts[2], 'base64');
    const actual = crypto.scryptSync(String(password), salt, expected.length, SCRYPT_PARAMS);
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  }
  const a = Buffer.from(String(password));
  const b = Buffer.from(value);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq);
    const raw = trimmed.slice(eq + 1);
    cookies[key] = decodeURIComponent(raw);
  }
  return cookies;
}

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function userUsesDefaultPassword(user, defaultPassword = DEFAULT_USER_PASSWORD) {
  if (!user) return false;
  if (user.passwordHash) return false;
  const plain = user.password;
  if (plain != null && String(plain) !== '') {
    return timingSafeEqualString(plain, defaultPassword);
  }
  return true;
}

function auditUserPasswords(users = {}) {
  const defaultPasswordUsers = [];
  const plainTextUsers = [];

  for (const [uuid, user] of Object.entries(users)) {
    const label = user.email || user.name || uuid;
    if (user.passwordHash) continue;
    if (user.password) {
      plainTextUsers.push(label);
    } else {
      defaultPasswordUsers.push(label);
    }
  }

  return { defaultPasswordUsers, plainTextUsers };
}

function createSessionId() {
  return crypto.randomBytes(32).toString('base64url');
}

function createAuth({ db, userDirectory, defaultPassword = DEFAULT_USER_PASSWORD, sessionMaxAgeSec = DEFAULT_SESSION_MAX_AGE_SEC }) {
  const maxAgeSec = Math.max(3600, Number(sessionMaxAgeSec) || DEFAULT_SESSION_MAX_AGE_SEC);
  const fallbackPassword = String(defaultPassword || DEFAULT_USER_PASSWORD);

  function cookieOptions(req, maxAge = maxAgeSec) {
    const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const parts = [
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${maxAge}`,
    ];
    if (secure) parts.push('Secure');
    return parts.join('; ');
  }

  function setSessionCookie(res, sessionId, req) {
    res.setHeader('Set-Cookie', `${USER_COOKIE}=${encodeURIComponent(sessionId)}; ${cookieOptions(req)}`);
  }

  function clearSessionCookie(res, req) {
    res.setHeader('Set-Cookie', `${USER_COOKIE}=; ${cookieOptions(req, 0)}`);
  }

  function createUserSession(userUuid, req, res) {
    const sessionId = createSessionId();
    const now = Math.floor(Date.now() / 1000);
    db.createSession({
      id: sessionId,
      role: 'user',
      userUuid,
      expiresAt: now + maxAgeSec,
      createdAt: now,
    });
    setSessionCookie(res, sessionId, req);
    return sessionId;
  }

  function getSessionFromCookie(req) {
    const cookies = parseCookies(req);
    const sessionId = cookies[USER_COOKIE];
    if (!sessionId) return null;
    const session = db.getSession(sessionId);
    if (!session) return null;
    const now = Math.floor(Date.now() / 1000);
    if (session.expires_at <= now) {
      db.deleteSession(sessionId);
      return null;
    }
    return session;
  }

  function destroyUserSession(req, res) {
    const cookies = parseCookies(req);
    const sessionId = cookies[USER_COOKIE];
    if (sessionId) db.deleteSession(sessionId);
    clearSessionCookie(res, req);
  }

  function getUserFromSession(req) {
    const session = getSessionFromCookie(req);
    if (!session || session.role !== 'user' || !session.user_uuid) return null;
    return userDirectory.findByUuid(session.user_uuid);
  }

  function verifyUserPassword(password, user) {
    const stored = user.passwordHash || user.password;
    if (stored) return verifyPassword(password, stored);
    return timingSafeEqualString(password, fallbackPassword);
  }

  function loginUser(account, password) {
    const user = userDirectory.findByLoginAccount(account);
    if (!user) return { ok: false, error: '账号或密码错误' };
    if (!verifyUserPassword(password, user)) {
      return { ok: false, error: '账号或密码错误' };
    }
    return { ok: true, user };
  }

  function validateNewPassword(newPassword) {
    const value = String(newPassword || '');
    if (value.length < 6) {
      return { ok: false, error: '新密码至少 6 位' };
    }
    if (timingSafeEqualString(value, fallbackPassword)) {
      return { ok: false, error: '新密码不能与初始密码相同' };
    }
    return { ok: true };
  }

  function changeUserPassword(user, currentPassword, newPassword) {
    if (!user) return { ok: false, error: '未登录' };
    if (!verifyUserPassword(currentPassword, user)) {
      return { ok: false, error: '当前密码错误' };
    }
    const check = validateNewPassword(newPassword);
    if (!check.ok) return check;
    return { ok: true, passwordHash: hashPassword(newPassword) };
  }

  function isDefaultPasswordUser(user) {
    return userUsesDefaultPassword(user, fallbackPassword);
  }

  function cleanupExpiredSessions() {
    db.deleteExpiredSessions(Math.floor(Date.now() / 1000));
  }

  return {
    USER_COOKIE,
    hashPassword,
    verifyPassword,
    parseCookies,
    createUserSession,
    destroyUserSession,
    getUserFromSession,
    loginUser,
    verifyUserPassword,
    userUsesDefaultPassword: isDefaultPasswordUser,
    validateNewPassword,
    changeUserPassword,
    cleanupExpiredSessions,
    sessionMaxAgeSec: maxAgeSec,
    defaultPassword: fallbackPassword,
  };
}

module.exports = {
  USER_COOKIE,
  DEFAULT_SESSION_MAX_AGE_SEC,
  DEFAULT_USER_PASSWORD,
  hashPassword,
  verifyPassword,
  parseCookies,
  auditUserPasswords,
  userUsesDefaultPassword,
  createAuth,
};
