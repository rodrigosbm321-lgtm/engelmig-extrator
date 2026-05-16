const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

function limparJSON(txt) {
  // Remove markdown
  txt = txt.replace(/```json/gi, '').replace(/```/g, '').trim();
  
  // Encontra o bloco JSON
  const ini = txt.indexOf('{');
  const fim = txt.lastIndexOf('}');
  if (ini >= 0 && fim > ini) {
    txt = txt.substring(ini, fim + 1);
  }
  
  // Parse e reserializa — isso garante JSON 100% limpo
  try {
    const obj = JSON.parse(txt);
    return JSON.stringify(obj);
  } catch(e) {
    // Se falhou, tenta limpeza manual caractere por caractere
    let resultado = '';
    let dentroString = false;
    let escape = false;
    
    for (let i = 0; i < txt.length; i++) {
      const c = txt[i];
      const code = txt.charCodeAt(i);
      
      if (escape) {
        resultado += c;
        escape = false;
        continue;
      }
      
      if (c === '\\') {
        escape = true;
        resultado += c;
        continue;
      }
      
      if (c === '"') {
        dentroString = !dentroString;
        resultado += c;
        continue;
      }
      
      if (dentroString) {
        // Dentro de string: substitui caracteres de controle por espaço
        if (code < 32 && code !== 9) {
          resultado += ' ';
        } else {
          resultado += c;
        }
      } else {
        // Fora de string: mantém só caracteres JSON válidos
        resultado += c;
      }
    }
    
    // Remove vírgulas extras
    resultado = resultado.replace(/,(\s*[}\]])/g, '$1');
    
    try {
      const obj2 = JSON.parse(resultado);
      return JSON.stringify(obj2);
    } catch(e2) {
      return txt; // Devolve como está
    }
  }
}

function chamarGemini(body) {
  return new Promise((resolve, reject) => {
    const modelos = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash-001'];
    
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
                console.log('Modelo', modelo, 'falhou:', msg.substring(0, 80));
                tentar(i + 1);
              }
            } else if (json.candidates && json.candidates[0] && json.candidates[0].content) {
              const rawText = json.candidates[0].content.parts[0].text;
              const textoLimpo = limparJSON(rawText);
              resolve({ text: textoLimpo, modelo });
            } else {
              console.log('Resposta inesperada modelo', modelo);
              tentar(i + 1);
            }
          } catch(e) {
            console.log('Erro parse resposta:', e.message);
            tentar(i + 1);
          }
        });
      });
      
      req.on('error', (e) => { console.log('Erro req:', e.message); tentar(i + 1); });
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

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.ico': 'image/x-icon'
};

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
      console.log('Erro API:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Arquivos estáticos
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
