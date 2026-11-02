import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { createApp } from '../server.mjs';
import { validateOllamaUrl, generateAnswer } from '../src/ollama.mjs';

async function fixture(options = {}) {
  const app = createApp(options);
  app.server.listen(0,'127.0.0.1'); await once(app.server,'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return { ...app, base, async close() { app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve)); app.store.close(); } };
}
const json = body => ({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const rawStatus = (url,headers) => new Promise((resolve,reject) => {
  const req = http.get(url,{headers},response => { response.resume(); response.on('end',() => resolve(response.statusCode)); });
  req.on('error',reject);
});

test('HTTP demo, search, source, delete lifecycle and disabled generation',async () => {
  const app = await fixture();
  try {
    assert.equal((await fetch(app.base)).status,200);
    assert.equal((await fetch(`${app.base}/api/health`).then(r => r.json())).generationEnabled,false);
    assert.equal((await fetch(`${app.base}/api/demo`,json({})).then(r => r.json())).added,3);
    const result = await fetch(`${app.base}/api/search`,json({query:'database backups'})).then(r => r.json());
    assert.ok(result.sources.length > 0); assert.equal(result.mode,'search');
    const source = result.sources[0];
    const document = await fetch(`${app.base}/api/documents/${source.documentId}`).then(r => r.json());
    assert.match(document.document.content,/backups/);
    assert.equal((await fetch(`${app.base}/api/answer`,json({query:'backups'}))).status,409);
    assert.equal((await fetch(`${app.base}/api/documents/${source.documentId}`,{method:'DELETE'})).status,200);
    assert.equal((await fetch(`${app.base}/api/documents/${source.documentId}`)).status,404);
  } finally { await app.close(); }
});

test('HTTP rejects foreign origins, invalid content types and oversized bodies',async () => {
  const app = await fixture();
  try {
    const badOrigin = json({}); badOrigin.headers.Origin='https://example.com';
    assert.equal((await fetch(`${app.base}/api/demo`,badOrigin)).status,403);
    assert.equal(await rawStatus(`${app.base}/api/health`,{Host:'evil.example'}),403);
    assert.equal((await fetch(`${app.base}/api/demo`,{method:'POST',body:'{}'})).status,415);
    assert.equal((await fetch(`${app.base}/api/demo`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{broken'})).status,400);
    assert.equal((await fetch(`${app.base}/api/documents`,json({title:'large.md',content:'a'.repeat(512001)}))).status,413);
    assert.equal((await fetch(`${app.base}/api/search`,json({query:''}))).status,400);
    assert.equal((await fetch(`${app.base}/package.json`)).status,404);
    assert.equal((await fetch(`${app.base}/%2e%2e/server.mjs`)).status,404);
  } finally { await app.close(); }
});

test('model adapter receives retrieved source context, errors keep sources visible',async () => {
  let observed;
  const app = await fixture({model:'test-model',generate:async args => { observed=args; return 'Backups run every six hours. [S1]'; }});
  try {
    await fetch(`${app.base}/api/demo`,json({}));
    const response = await fetch(`${app.base}/api/answer`,json({query:'backups'})).then(r => r.json());
    assert.match(response.answer,/\[S1\]/);
    assert.equal(observed.model,'test-model'); assert.ok(observed.sources.length > 0);
    assert.equal(observed.endpoint,'http://127.0.0.1:11434');
    observed = undefined;
    const empty = await fetch(`${app.base}/api/answer`,json({query:'xyznonexistent'})).then(r => r.json());
    assert.equal(empty.mode,'no_sources'); assert.equal(empty.answer,undefined); assert.equal(observed,undefined);
  } finally { await app.close(); }
  const failing = await fixture({model:'missing',generate:async () => { throw new Error('Model not found'); }});
  try {
    await fetch(`${failing.base}/api/demo`,json({}));
    const response = await fetch(`${failing.base}/api/answer`,json({query:'backups'}));
    assert.equal(response.status,502); assert.ok((await response.json()).sources.length);
  } finally { await failing.close(); }
});

test('Ollama permits only loopback origins and uses the documented request shape',async () => {
  assert.equal(validateOllamaUrl('http://localhost:11434'),'http://localhost:11434');
  for (const input of ['https://example.com','http://192.168.1.1','http://localhost.example.com','http://user@localhost:11434','http://localhost:11434/proxy']) assert.throws(() => validateOllamaUrl(input));
  let observed;
  const answer = await generateAnswer({question:'When?',model:'qwen-test',endpoint:'http://127.0.0.1:11434',sources:[{citation:'S1',title:'a.md',startLine:1,endLine:1,body:'On Tuesday.'}],fetchImpl:async (url,options) => {
    observed={url,options}; return new Response(JSON.stringify({response:'Tuesday [S1]'}),{status:200});
  }});
  assert.equal(answer,'Tuesday [S1]');
  assert.equal(observed.url,'http://127.0.0.1:11434/api/generate');
  const body = JSON.parse(observed.options.body);
  assert.equal(body.stream,false); assert.match(body.prompt,/On Tuesday/); assert.equal(observed.options.redirect,'error');
});
