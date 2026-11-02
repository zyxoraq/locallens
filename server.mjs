import http from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createStore } from './src/store.mjs';
import { demoDocuments, demoQueries } from './src/demo.mjs';
import { generateAnswer, validateOllamaUrl } from './src/ollama.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const assets = new Map([
  ['/', ['index.html','text/html; charset=utf-8']],
  ['/app.js', ['app.js','text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css','text/css; charset=utf-8']]
]);
const MAX_BODY = 512_000;

function send(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) {
    const error = new Error('Use Content-Type: application/json.'); error.status = 415; throw error;
  }
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) { const error = new Error('Request exceeds 512 KB.'); error.status = 413; throw error; }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Request must contain valid JSON.'); }
}

export function createApp({ store = createStore(), model = '', ollamaUrl = 'http://127.0.0.1:11434', generate = generateAnswer } = {}) {
  const endpoint = validateOllamaUrl(ollamaUrl);
  let generating = false;
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const host = req.headers.host ?? '';
      if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host)) return send(res,403,{ error: 'Only loopback hosts are allowed.' });
      if (req.headers.origin && req.headers.origin !== `http://${host}`) return send(res,403,{ error: 'Cross-origin requests are not allowed.' });
      if (req.headers['sec-fetch-site'] === 'cross-site') return send(res,403,{ error: 'Cross-site requests are not allowed.' });
      const url = new URL(req.url, `http://${host}`);
      if (req.method === 'GET' && assets.has(url.pathname)) {
        const [file,type] = assets.get(url.pathname);
        const content = readFileSync(path.join(root,'public',file));
        res.writeHead(200, { 'Content-Type': type });
        return res.end(content);
      }
      if (req.method === 'GET' && url.pathname === '/api/health') return send(res,200,{ status: 'ok', generationEnabled: Boolean(model), model: model || null, demoQueries });
      if (req.method === 'GET' && url.pathname === '/api/documents') return send(res,200,{ documents: store.list() });
      if (req.method === 'GET' && url.pathname.startsWith('/api/documents/')) {
        const document = store.get(url.pathname.slice('/api/documents/'.length));
        return send(res,document ? 200 : 404,document ? { document } : { error: 'Document not found.' });
      }
      if (req.method === 'POST' && url.pathname === '/api/documents') {
        const body = await readJson(req);
        const result = store.add(body?.title,body?.content);
        return send(res,result.duplicate ? 200 : 201,result);
      }
      if (req.method === 'POST' && url.pathname === '/api/demo') {
        await readJson(req);
        const results = demoDocuments.map(d => store.add(d.title,d.content));
        return send(res,200,{ added: results.filter(r => !r.duplicate).length });
      }
      if (req.method === 'DELETE' && url.pathname.startsWith('/api/documents/')) {
        const removed = store.remove(url.pathname.slice('/api/documents/'.length));
        return send(res,removed ? 200 : 404,removed ? { removed: true } : { error: 'Document not found.' });
      }
      if (req.method === 'POST' && ['/api/search','/api/answer'].includes(url.pathname)) {
        const body = await readJson(req);
        if (typeof body?.query !== 'string' || !body.query.trim()) throw new Error('Enter a search question.');
        const started = performance.now();
        const sources = store.search(body.query);
        const elapsedMs = Number((performance.now() - started).toFixed(2));
        if (url.pathname === '/api/search') return send(res,200,{ sources, elapsedMs, mode: 'search' });
        if (!model) return send(res,409,{ error: 'Generation is disabled. Start the server with OLLAMA_MODEL to enable it.' });
        if (!sources.length) return send(res,200,{ sources, elapsedMs, mode: 'no_sources', message: 'No matching source excerpts were found, so the model was not called. Try words used in your documents.' });
        if (generating) return send(res,429,{ error: 'A local answer is already running. Wait for it to finish.' });
        generating = true;
        try {
          const answer = await generate({ question: body.query, sources, model, endpoint });
          return send(res,200,{ sources, elapsedMs, mode: 'generated', answer, model });
        } catch (error) {
          return send(res,502,{ error: error.name === 'TimeoutError' ? 'The model took longer than 60 seconds. Your search results are still available.' : error.message, sources });
        } finally { generating = false; }
      }
      send(res,404,{ error: 'Not found.' });
    } catch (error) {
      if (!res.headersSent) send(res,error.status || 400,{ error: error.message || 'Invalid request.' });
    }
  });
  server.requestTimeout = 65_000;
  server.headersTimeout = 10_000;
  return { server, store };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dataDirectory = path.resolve(process.env.DATA_DIR || path.join(root,'data'));
  mkdirSync(dataDirectory,{ recursive: true });
  const port = Number(process.env.PORT || 4311);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  const app = createApp({ store: createStore(path.join(dataDirectory,'locallens.sqlite')), model: process.env.OLLAMA_MODEL || '', ollamaUrl: process.env.OLLAMA_URL });
  app.server.listen(port,'127.0.0.1',() => console.log(`LocalLens: http://127.0.0.1:${port}\nData: ${dataDirectory}\nGeneration: ${process.env.OLLAMA_MODEL || 'disabled (search works offline)'}`));
  const stop = () => app.server.close(() => { app.store.close(); process.exit(0); });
  process.on('SIGINT',stop); process.on('SIGTERM',stop);
}
