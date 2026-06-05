function normalizeLoginKey(value) {
  return String(value || '').trim().toLowerCase();
}

function registerLoginKey(map, key, entry, label) {
  const normalized = normalizeLoginKey(key);
  if (!normalized) return;

  const existing = map.get(normalized);
  if (existing && existing.uuid !== entry.uuid) {
    throw new Error(`Duplicate login account "${key}" for user: ${label}`);
  }
  map.set(normalized, entry);
}

function buildUserDirectory(users = {}) {
  const usersByToken = new Map();
  const usersByUuid = new Map();
  const usersByLoginKey = new Map();
  const allUsers = [];

  for (const [uuid, user] of Object.entries(users)) {
    const token = String(user.token || '').trim();
    if (!token) {
      throw new Error(`Missing token for user: ${user.name || uuid}`);
    }
    if (usersByToken.has(token)) {
      throw new Error(`Duplicate token for user: ${user.name || uuid}`);
    }

    const email = String(user.email || '').trim();
    if (!email) {
      throw new Error(
        `Missing email for user "${user.name || uuid}": must match 3X-UI client email`
      );
    }

    const entry = { ...user, uuid, token, email };
    const label = user.name || uuid;

    registerLoginKey(usersByLoginKey, email, entry, label);

    usersByToken.set(token, entry);
    usersByUuid.set(uuid, entry);
    allUsers.push(entry);
  }

  return { usersByToken, usersByUuid, usersByLoginKey, allUsers };
}

function createUserDirectory(users = {}) {
  const state = buildUserDirectory(users);

  function findByToken(token) {
    return state.usersByToken.get(String(token || '').trim()) || null;
  }

  function findByUuid(uuid) {
    return state.usersByUuid.get(String(uuid || '').trim()) || null;
  }

  function findByEmail(email) {
    return findByLoginAccount(email);
  }

  function findByLoginAccount(account) {
    return state.usersByLoginKey.get(normalizeLoginKey(account)) || null;
  }

  function listUsers(baseUrl) {
    const origin = String(baseUrl || '').replace(/\/+$/, '');
    return state.allUsers.map((user) => ({
      uuid: user.uuid,
      name: user.name,
      email: user.email,
      token: user.token,
      url: `${origin}/#t=${encodeURIComponent(user.token)}`,
    }));
  }

  function addUser(uuid, user) {
    if (state.usersByToken.has(user.token)) return false;

    const email = String(user.email || '').trim();
    if (!email) return false;

    const entry = { ...user, uuid, token: user.token, email };
    const label = user.name || uuid;
    const normalized = normalizeLoginKey(email);
    if (!normalized) return false;
    const existing = state.usersByLoginKey.get(normalized);
    if (existing && existing.uuid !== uuid) return false;

    registerLoginKey(state.usersByLoginKey, email, entry, label);
    state.usersByToken.set(user.token, entry);
    state.usersByUuid.set(uuid, entry);
    state.allUsers.push(entry);
    return true;
  }

  function replaceAllUsers(users) {
    const next = buildUserDirectory(users);
    state.usersByToken = next.usersByToken;
    state.usersByUuid = next.usersByUuid;
    state.usersByLoginKey = next.usersByLoginKey;
    state.allUsers = next.allUsers;
  }

  return { findByToken, findByUuid, findByEmail, findByLoginAccount, listUsers, addUser, replaceAllUsers };
}

module.exports = { createUserDirectory, normalizeLoginKey };
