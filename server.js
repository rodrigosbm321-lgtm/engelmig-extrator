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
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          try {
            const raw = Buffer.concat(chunks).toString('utf8');
            const json = JSON.parse(raw);
            if (json.error) {
              const msg = json.error.message || '';
              if (msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
                reject(new Error('Limite temporário. Aguarde 1 minuto.'));
              } else {
                tentar(i + 1);
              }
              return;
            }
            if (!json.candidates || !json.candidates[0]) { tentar(i + 1); return; }
            
            let txt = json.candidates[0].content.parts[0].text;
            
            // Limpa markdown
            txt = txt.replace(/```json/gi,'').replace(/```/g,'').trim();
            
            // Extrai JSON
            const ini = txt.indexOf('{');
            const fim = txt.lastIndexOf('}');
            if (ini >= 0 && fim > ini) txt = txt.substring(ini, fim+1);
            
            // Parse direto
            try {
              const obj = JSON.parse(txt);
              resolve({ ok: true, dados: obj, modelo });
              return;
            } catch(e) {
              // JSON truncado — tenta reparar
              console.log('JSON truncado na posição', e.message);
              // Adiciona fechamentos faltantes
              let reparado = txt;
              reparado = reparado.replace(/,\s*$/, ''); // remove vírgula final
              // Conta brackets abertos
              let arrAbertos = 0, objAbertos = 0;
              for (const c of reparado) {
                if (c==='{') objAbertos++;
                else if (c==='}') objAbertos--;
                else if (c==='[') arrAbertos++;
                else if (c===']') arrAbertos--;
              }
              for (let k=0; k<arrAbertos; k++) reparado += ']';
              for (let k=0; k<objAbertos; k++) reparado += '}';
              try {
                const obj2 = JSON.parse(reparado);
                resolve({ ok: true, dados: obj2, modelo });
              } catch(e2) {
                // Devolve texto bruto para o cliente tentar
                resolve({ ok: false, texto: txt, erro: e.message });
              }
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
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
  });
}

const MIME = {'.html':'text/html','.js':'application/javascript','.css':'text/css'};

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
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify(result));
    } catch(err) {
      res.writeHead(500, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ok:false, erro:err.message}));
    }
    return;
  }

  let filePath = req.url==='/' ? '/index.html' : req.url.split('?')[0];
  filePath = path.join(__dirname, filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {'Content-Type': MIME[path.extname(filePath)]||'text/plain'});
    res.end(data);
  });
});

server.listen(PORT, () => console.log(`Engelmig Extrator porta ${PORT}`));
