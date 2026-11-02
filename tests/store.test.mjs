import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore, chunkText, queryExpression } from '../src/store.mjs';
import { demoDocuments, evaluationCases } from '../src/demo.mjs';

test('ingestion deduplicates content and delete removes FTS entries',() => {
  const store = createStore();
  try {
    const first = store.add('notes.md','A marmalade telescope sees the moon.');
    assert.equal(store.add('copy.md','A marmalade telescope sees the moon.').id,first.id);
    assert.equal(store.list().length,1);
    assert.equal(store.search('telescope')[0].documentId,first.id);
    assert.equal(store.remove(first.id),true);
    assert.deepEqual(store.search('telescope'),[]);
    assert.equal(store.remove(first.id),false);
  } finally { store.close(); }
});

test('chunks preserve source lines, bound long lines and make progress',() => {
  const input = Array.from({length:100},(_,i) => `Line ${i + 1}: ${'x'.repeat(45)}`).join('\n');
  const chunks = chunkText(input,250);
  assert.ok(chunks.length > 1 && chunks.length < 100);
  assert.equal(chunks[0].startLine,1);
  assert.equal(chunks.at(-1).endLine,100);
  assert.ok(chunks.every(c => c.body.length <= 250));
  assert.ok(chunks[1].startLine <= chunks[0].endLine);
  const long = chunkText('z'.repeat(3000),250);
  assert.equal(long.length,12);
  assert.ok(long.every(c => c.startLine === 1 && c.endLine === 1));
  assert.deepEqual(chunkText('\n\n'),[]);
});

test('FTS operators and quote input are treated as plain search terms',() => {
  const store = createStore();
  try {
    store.add('unicode.txt','Привет, локальный поиск! telescope');
    assert.equal(store.search('локальный')[0].title,'unicode.txt');
    assert.doesNotThrow(() => store.search('" OR * NEAR( telescope ) - : {')); 
    assert.equal(queryExpression('the and or'), '');
    assert.deepEqual(store.search('💫 !!!'),[]);
    assert.throws(() => store.search('a'.repeat(501)),/500/);
  } finally { store.close(); }
});

test('document validation rejects unsupported files, NUL and oversized data',() => {
  const store = createStore();
  try {
    assert.throws(() => store.add('a.pdf','hello'),/Only/);
    assert.throws(() => store.add('a.md','  '),/readable/);
    assert.throws(() => store.add('a.txt','foo\0bar'),/readable/);
    assert.throws(() => store.add('a.txt','z'.repeat(250001)),/250 KB/);
    assert.equal(store.list().length,0);
  } finally { store.close(); }
});

test('database persists documents and search index across reopen',() => {
  const directory = mkdtempSync(path.join(os.tmpdir(),'locallens-test-'));
  try {
    let store = createStore(path.join(directory,'db.sqlite'));
    store.add('persist.md','Persistent observability records.'); store.close();
    store = createStore(path.join(directory,'db.sqlite'));
    try { assert.equal(store.search('observability')[0].title,'persist.md'); } finally { store.close(); }
  } finally { rmSync(directory,{recursive:true,force:true}); }
});

test('synthetic evaluation retrieves each expected document in top 3',() => {
  const store = createStore();
  try {
    demoDocuments.forEach(d => store.add(d.title,d.content));
    for (const item of evaluationCases) {
      assert.ok(store.search(item.query,3).some(result => result.title === item.expected),item.query);
    }
  } finally { store.close(); }
});
