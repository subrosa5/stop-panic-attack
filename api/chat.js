const https = require('https');
const { randomUUID } = require('crypto');

const agent = new https.Agent({ rejectUnauthorized: false });

function httpsPost(hostname, port, path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, port, path, method: 'POST', headers, agent },
      res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

let cachedToken = null;
let tokenExpiry = 0;

async function getGigaChatToken() {
  if (cachedToken && Date.now() < tokenExpiry - 60000) return cachedToken;

  const body = 'scope=GIGACHAT_API_PERS';
  const res = await httpsPost(
    'ngw.devices.sberbank.ru', 9443, '/api/v2/oauth',
    {
      'Authorization': `Basic ${process.env.GIGACHAT_AUTH}`,
      'RqUID': randomUUID(),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    },
    body
  );

  if (res.status !== 200) throw new Error(`Auth failed: ${res.status} — ${res.body}`);
  const data = JSON.parse(res.body);
  cachedToken = data.access_token;
  tokenExpiry = data.expires_at;
  return cachedToken;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'messages required' });
  }

  try {
    const token = await getGigaChatToken();

    const body = JSON.stringify({
      model: 'GigaChat',
      messages,
      temperature: 0.7,
      max_tokens: 512,
    });

    const response = await httpsPost(
      'gigachat.devices.sberbank.ru', 443, '/api/v1/chat/completions',
      {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      body
    );

    if (response.status !== 200) {
      throw new Error(`GigaChat: ${response.status} — ${response.body}`);
    }

    const data = JSON.parse(response.body);
    const content = data.choices?.[0]?.message?.content ?? '';
    res.json({ content });
  } catch (err) {
    console.error('GigaChat error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
