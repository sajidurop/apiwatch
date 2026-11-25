'use strict';
// APIWatch — real server (Node.js, zero dependencies).
// Serves the UI and runs the real work server-side via /api/* endpoints.
//   npm start  ->  http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, 'data');
fs.mkdirSync(DATA, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/plain', '.txt': 'text/plain' };

function send(res, code, obj, type) {
  const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': type || 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 5 * 1024 * 1024) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { resolve({ _raw: s }); } });
    req.on('error', reject);
  });
}
async function fetchTimeout(url, opts, ms) {
  opts = opts || {}; ms = ms || 12000;
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: c.signal, redirect: 'follow', headers: { 'User-Agent': 'APIWatch/1.0.0 (https://alltoolfree.site)', ...(opts.headers || {}) } });
  } finally { clearTimeout(t); }
}
function store(name, rec) {
  const f = path.join(DATA, name + '.json');
  let arr = [];
  try { arr = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {}
  arr.push({ ...rec, at: new Date().toISOString() });
  if (arr.length > 500) arr = arr.slice(-500);
  fs.writeFileSync(f, JSON.stringify(arr, null, 2));
  return arr;
}
function loadAll(name) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, name + '.json'), 'utf8')); } catch (e) { return []; }
}
function saveAll(name, arr) {
  fs.writeFileSync(path.join(DATA, name + '.json'), JSON.stringify(arr, null, 2));
}


async function probe(ep) {
  const t0 = Date.now();
  try {
    const r = await fetchTimeout(ep.url, { method: ep.method || 'GET', headers: ep.headers || {}, body: (ep.method && ep.method !== 'GET' && ep.method !== 'HEAD' && ep.body) ? ep.body : undefined }, 15000);
    const latency = Date.now() - t0;
    let json = null;
    try { json = await r.clone().json(); } catch (e) {}
    const keysOk = (ep.expectKeys || []).every(k => json && Object.prototype.hasOwnProperty.call(json, k));
    return { url: ep.url, status: r.status, ok: r.status === (ep.expectStatus || 200) && keysOk, latencyMs: latency, at: new Date().toISOString() };
  } catch (e) { return { url: ep.url, status: 0, ok: false, latencyMs: Date.now() - t0, error: String(e.message || e), at: new Date().toISOString() }; }
}
async function handleCheck(body) {
  if (body.add) {
    const eps = loadAll('endpoints');
    eps.push({ url: body.url, method: body.method || 'GET', headers: body.headers || {}, expectStatus: body.expectStatus || 200, expectKeys: body.expectKeys || [] });
    saveAll('endpoints', eps);
    return { ok: true, endpoints: eps.length };
  }
  if (body.list) return { ok: true, endpoints: loadAll('endpoints'), results: loadAll('history').slice(-50) };
  const ep = { url: body.url, method: body.method || 'GET', headers: body.headers || {}, expectStatus: body.expectStatus || 200, expectKeys: body.expectKeys || [] };
  const res = await probe(ep);
  store('history', res);
  return { ok: true, ...res };
}


const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && u.pathname === '/api/health') return send(res, 200, { ok: true, product: 'apiwatch', version: '1.0.0', time: new Date().toISOString() });
    if (req.method === 'GET' && u.pathname === '/api/history') return send(res, 200, loadAll('history'));
    if (req.method === 'POST' && u.pathname === '/api/check') {
      const body = await readBody(req);
      const out = await handleCheck(body);
      return send(res, 200, out);
    }
    if (req.method === 'GET') {
      const p = u.pathname === '/' ? '/index.html' : u.pathname;
      const fp = path.join(__dirname, p);
      if (!fp.startsWith(__dirname)) return send(res, 403, { error: 'forbidden' });
      if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
        res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
        return fs.createReadStream(fp).pipe(res);
      }
      return send(res, 404, { error: 'not found' });
    }
    return send(res, 404, { error: 'unknown route' });
  } catch (e) {
    return send(res, 500, { error: String((e && e.message) || e) });
  }
});
server.listen(PORT, () => console.log('APIWatch listening on http://localhost:' + PORT));

// Poll every saved endpoint once a minute, server-side.
setInterval(async () => {
  const eps = loadAll('endpoints');
  for (const ep of eps) { try { store('history', await probe(ep)); } catch (e) {} }
}, 60000);

