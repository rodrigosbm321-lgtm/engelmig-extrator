const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

function chamarGemini(body) {
  return new Promise((resolve, reject) => {
    const modelos = ['gemini-2.5-flash','gemini-2.5-pro','gemini-2.0-flash-001'];
    function tentar(i) {
      if (i >= modelos.length) { reject(new Error('Nenhum modelo disponível')); return; }
      const modelo = modelos[i];
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${GEMINI_API_KEY}`;
      const bodyStr = JSON.stringify(body);
      const req = https.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) {
              const msg = json.error.message || '';
              if (msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
                reject(new Error('Limite temporário. Aguarde 1 minuto.'));
              } else {
                console.log('Erro modelo', modelo, msg.substring(0,80));
                tentar(i + 1);
              }
            } else if (json.candidates && json.candidates[0] && json.candidates[0].content) {
              let txt = json.candidates[0].content.parts[0].text;
              
              // LIMPEZA DO JSON ANTES DE DEVOLVER
              // Remove markdown
              txt = txt.replace(/```json/gi, '').replace(/```/g, '').trim();
              
              // Extrai apenas o bloco JSON
              const ini = txt.indexOf('{');
              const fim = txt.lastIndexOf('}');
              if (ini >= 0 && fim > ini) {
                txt = txt.substring(ini, fim + 1);
              }
              
              // Remove caracteres de controle problemáticos
              // mas preserva o JSON válido
              txt = txt.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
              
              // Tenta parsear para validar e reserializar limpo
              try {
                const obj = JSON.parse(txt);
                // Reserializa limpo — garante JSON válido
                resolve({ text: JSON.stringify(obj), modelo });
              } catch(e) {
                // Se não conseguiu parsear, tenta corrigir e devolver assim mesmo
                txt = txt.replace(/,(\s*[}\]])/g, '$1');
                resolve({ text: txt, modelo });
              }
            } else {
              tentar(i + 1);
            }
          } catch(e) {
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

function lerBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
  });
}

const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.ico':'image/x-icon' };

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  if (req.url === '/api' && req.method === 'POST') {
    try {
      const bodyStr = await lerBody(req);
      const payload = JSON.parse(bodyStr);
      const result = await chamarGemini(payload);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  let filePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  filePath = path.join(__dirname, filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });
});

server.listen(PORT, () => console.log(`Engelmig Extrator rodando na porta ${PORT}`));
