const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const PORT = 3000;
const GIGACHAT_AUTH = process.env.GIGACHAT_AUTH;
if (!GIGACHAT_AUTH) { console.error('GIGACHAT_AUTH не задан'); process.exit(1); }

const agent = new https.Agent({ rejectUnauthorized: false });

let cachedToken = null;
let tokenExpiry = 0;

function httpsPost(hostname, port, path_, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, port, path: path_, method: 'POST', headers, agent },
      res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry - 60000) return cachedToken;
  const body = 'scope=GIGACHAT_API_PERS';
  const res = await httpsPost('ngw.devices.sberbank.ru', 9443, '/api/v2/oauth', {
    'Authorization': `Basic ${GIGACHAT_AUTH}`,
    'RqUID': randomUUID(),
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(body),
  }, body);
  if (res.status !== 200) throw new Error(`Auth: ${res.status} ${res.body}`);
  const data = JSON.parse(res.body);
  cachedToken = data.access_token;
  tokenExpiry = data.expires_at;
  return cachedToken;
}

async function handleChat(req, res) {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    try {
      const { messages } = JSON.parse(body);
      const token = await getToken();
      const payload = JSON.stringify({ model: 'GigaChat', messages, temperature: 0.7, max_tokens: 512 });
      const response = await httpsPost('gigachat.devices.sberbank.ru', 443, '/api/v1/chat/completions', {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      }, payload);
      if (response.status !== 200) throw new Error(`GigaChat: ${response.status} ${response.body}`);
      const content = JSON.parse(response.body).choices?.[0]?.message?.content ?? '';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ content }));
    } catch (e) {
      console.error(e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/chat') {
    return handleChat(req, res);
  }
  const file = req.url === '/' ? 'index.html' : req.url.slice(1);
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    const ext = path.extname(filePath);
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' }[ext] || 'text/plain';
    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404); res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`✓ Сервер запущен: http://localhost:${PORT}`);
  console.log(`  Открой на телефоне: http://[IP-КОМПЬЮТЕРА]:${PORT}`);
});
