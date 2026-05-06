const http = require('http');
const https = require('https');

let sessionCookie = null;
let loginPromise = null;
let config = null;

function init(cfg) {
  config = cfg;
}

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, config.baseUrl);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      // Self-signed cert on localhost — acceptable for internal API calls
      rejectUnauthorized: url.hostname !== '127.0.0.1' && url.hostname !== 'localhost',
      timeout: 10000, // 10s timeout
    };

    if (sessionCookie) {
      options.headers['Cookie'] = `3x-ui=${sessionCookie}`;
    }

    const req = transport.request(options, (res) => {
      const setCookie = res.headers['set-cookie'];
      if (setCookie) {
        for (const cookie of setCookie) {
          const match = cookie.match(/3x-ui=([^;]+)/);
          if (match) sessionCookie = match[1];
        }
      }

      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('API request timeout'));
    });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function login() {
  const result = await request('POST', 'login', {
    username: config.username,
    password: config.password,
  });
  if (!result || !result.success) {
    throw new Error('3X-UI login failed');
  }
  return result;
}

async function ensureLogin() {
  if (!sessionCookie) {
    if (!loginPromise) loginPromise = login().finally(() => { loginPromise = null; });
    await loginPromise;
    return;
  }
  const result = await request('GET', 'panel/api/inbounds/list');
  if (!result || !result.success) {
    sessionCookie = null;
    if (!loginPromise) loginPromise = login().finally(() => { loginPromise = null; });
    await loginPromise;
  }
}

async function getInbounds() {
  await ensureLogin();
  const result = await request('GET', 'panel/api/inbounds/list');
  if (!result || !result.success) throw new Error('Failed to get inbounds');
  return result.obj || [];
}

async function getClientIps(email) {
  await ensureLogin();
  const result = await request('POST', `panel/api/inbounds/clientIps/${encodeURIComponent(email)}`);
  if (!result || !result.success) return { ips: [] };
  return result.obj || { ips: [] };
}

async function getOnlineClients() {
  await ensureLogin();
  const result = await request('POST', 'panel/api/inbounds/onlines');
  if (!result || !result.success) return [];
  return result.obj || [];
}

module.exports = {
  init,
  login,
  getInbounds,
  getClientIps,
  getOnlineClients,
};
