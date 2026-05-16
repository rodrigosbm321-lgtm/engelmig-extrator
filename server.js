const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// Função para chamar Gemini
function chamarGemini(body) {
  return new Promise((resolve, reject) => {
    const modelos = [
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-2.0-flash-001',
    ];

    async function tentar(i) {
      if (i >= modelos.length) {
        reject(new Error('Nenhum modelo disponível'));
        return;
      }

      const modelo = modelos[i];
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${GEMINI_API_KEY}`;
      const bodyStr = JSON.stringify(body);

      const req = https.request(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr)
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) {
              const msg = json.error.message || '';
              if (msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
                reject(new Error('Limite temporário. Aguarde 1 minuto e tente novamente.'));
              } else {
                tentar(i + 1);
              }
            } else if (json.candidates && json.candidates[0]) {
              resolve({ text: json.candidates[0].content.parts[0].text, modelo });
            } else {
              tentar(i + 1);
            }
          } catch (e) {
            tentar(i + 1);
          }
        });
      });

      req.on('error', () => tentar(i + 1));
      req.write(bodyStr);
      req.end();
    }

    tentar(0);
  });
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // API endpoint
  if (parsedUrl.pathname === '/api' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const result = await chamarGemini(payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Servir arquivos estáticos
  let filePath = parsedUrl.pathname === '/' ? '/index.html' : parsedUrl.pathname;
  filePath = path.join(__dirname, 'public', filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' }[ext] || 'text/plain';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Engelmig Extrator rodando na porta ${PORT}`);
});
