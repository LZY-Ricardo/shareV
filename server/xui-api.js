const http = require('http');
const https = require('https');

let sessionCookie = null;
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
      rejectUnauthorized: false,
    };

    if (sessionCookie) {
      options.headers['Cookie'] = `3x-ui=${sessionCookie}`;
    }

    const req = transport.request(options, (res) => {
      // Capture session cookie from login response
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
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function login() {
  const result = await request('POST', 'login', {
    username: config.username,
    password: config.password,
  });
  if (!result.success) {
    throw new Error(`3X-UI login failed: ${JSON.stringify(result)}`);
  }
  return result;
}

async function ensureLogin() {
  if (!sessionCookie) {
    await login();
    return;
  }
  // Verify session is still valid
  const result = await request('GET', 'panel/api/inbounds/list');
  if (!result.success) {
    await login();
  }
}

async function getInbounds() {
  await ensureLogin();
  const result = await request('GET', 'panel/api/inbounds/list');
  if (!result.success) throw new Error('Failed to get inbounds');
  return result.obj || [];
}

async function getClientIps(email) {
  await ensureLogin();
  const result = await request('POST', `panel/api/inbounds/clientIps/${encodeURIComponent(email)}`);
  if (!result.success) return { ips: [] };
  return result.obj || { ips: [] };
}

async function getOnlineClients() {
  await ensureLogin();
  const result = await request('POST', 'panel/api/inbounds/onlines');
  if (!result.success) return [];
  return result.obj || [];
}

module.exports = {
  init,
  login,
  getInbounds,
  getClientIps,
  getOnlineClients,
};
