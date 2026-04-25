const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Read API key from .env without needing dotenv package
const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
const API_KEY = envFile.match(/EXPO_PUBLIC_WIX_API_KEY=(.+)/)?.[1]?.trim();
const SITE_ID = '27882056-1976-4b4a-8ea3-a2f80565bb53';
const PORT = 3001;

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST' || req.url !== '/posts') { res.writeHead(404); res.end(); return; }

  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    const proxyReq = https.request(
      {
        hostname: 'www.wixapis.com',
        path: '/blog/v3/posts/query',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: API_KEY,
          'wix-site-id': SITE_ID,
        },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
        proxyRes.pipe(res);
      }
    );
    proxyReq.on('error', (e) => { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); });
    proxyReq.write(body);
    proxyReq.end();
  });
}).listen(PORT, () => console.log(`Wix proxy running on http://localhost:${PORT}`));
