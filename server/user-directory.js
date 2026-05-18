function createUserDirectory(users = {}) {
  const usersByToken = new Map();
  const allUsers = [];

  for (const [uuid, user] of Object.entries(users)) {
    const token = String(user.token || '').trim();
    if (!token) {
      throw new Error(`Missing token for user: ${user.name || uuid}`);
    }
    if (usersByToken.has(token)) {
      throw new Error(`Duplicate token for user: ${user.name || uuid}`);
    }

    const entry = { ...user, uuid, token };
    usersByToken.set(token, entry);
    allUsers.push(entry);
  }

  function findByToken(token) {
    return usersByToken.get(String(token || '').trim()) || null;
  }

  function listUsers(baseUrl) {
    const origin = String(baseUrl || '').replace(/\/+$/, '');
    return allUsers.map((user) => ({
      uuid: user.uuid,
      name: user.name,
      email: user.email,
      token: user.token,
      url: `${origin}/#t=${encodeURIComponent(user.token)}`,
    }));
  }

  function addUser(uuid, user) {
    if (usersByToken.has(user.token)) return false;
    const entry = { ...user, uuid, token: user.token };
    usersByToken.set(user.token, entry);
    allUsers.push(entry);
    return true;
  }

  return { findByToken, listUsers, addUser };
}

module.exports = { createUserDirectory };
