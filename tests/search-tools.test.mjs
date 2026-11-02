import test from 'node:test';
import assert from 'node:assert/strict';
import { queryTerms, highlightParts, formatSearchReport } from '../public/search-tools.mjs';

test('highlighting returns literal text segments with case-insensitive whole-word matches',() => {
  const text = '<img src=x onerror=alert(1)> Telescope telescopes ТЕЛЕСКОП! telescope.';
  const parts = highlightParts(text,'the telescope ТЕЛЕСКОП telescope');
  assert.equal(parts.map(part => part.text).join(''),text);
  assert.deepEqual(parts.filter(part => part.match).map(part => part.text),['Telescope','ТЕЛЕСКОП','telescope']);
  assert.ok(parts.some(part => !part.match && part.text.includes('<img')));
  assert.deepEqual(highlightParts(text,'the and or'),[{text,match:false}]);
  assert.deepEqual(highlightParts('', 'telescope'),[]);
  assert.equal(queryTerms('a a the copper COPPER (copper)')[0],'copper');
  assert.equal(queryTerms(Array.from({length:30},(_,i) => `term${i}`).join(' ')).length,24);
});

test('Markdown report preserves the displayed query, scope, citations and line ranges',() => {
  const report = formatSearchReport({
    query:'original query',scope:{documentId:'id',title:'[notes](https://bad.example).md'},
    capturedAt:'2026-11-03T12:00:00.000Z',mode:'search',
    sources:[{citation:'S1',title:'notes.md',startLine:4,endLine:8,body:'Literal excerpt\nwith two lines.'}]
  });
  assert.match(report,/Captured: 2026-11-03T12:00:00.000Z/);
  assert.ok(report.includes('Scope: \\[notes\\]\\(https://bad.example\\).md'));
  assert.ok(report.includes('```text\noriginal query\n```'));
  assert.match(report,/### S1 — notes.md\n\nLines 4–8/);
  assert.ok(report.includes('```text\nLiteral excerpt\nwith two lines.\n```'));
  assert.ok(!report.includes('## Generated answer'));
});

test('report fences untrusted model/document content and does not invent an answer',() => {
  const answer = 'Model says [S1].\n```\n<img src="https://bad.example/track">';
  const body = '````\n![remote](https://bad.example/image)\n</script>';
  const base = {query:'demo',scope:{title:'All documents'},capturedAt:'2026-11-03',sources:[{citation:'S1',title:'x.md',startLine:1,endLine:3,body}],model:'test',answer};
  const generated = formatSearchReport({...base,mode:'generated'});
  assert.ok(generated.includes('````text\n' + answer + '\n````'));
  assert.ok(generated.includes('`````text\n' + body + '\n`````'));
  assert.ok(generated.includes('Generated text may be incorrect'));
  const fallback = formatSearchReport({...base,mode:'search',message:'Generation failed.'});
  assert.ok(!fallback.includes('## Generated answer'));
  assert.ok(!fallback.includes('Model says'));
  assert.ok(fallback.includes('Generation failed.'));
  const empty = formatSearchReport({...base,mode:'no_sources',sources:[]});
  assert.ok(empty.includes('No matching source excerpts were found.'));
  assert.ok(!empty.includes('## Generated answer'));
});

test('report handles a bounded large model answer with many separate backtick runs',() => {
  const answer = '`x'.repeat(150_000);
  const report = formatSearchReport({query:'demo',scope:{title:'All documents'},capturedAt:'2026-11-03',sources:[],mode:'generated',model:'test',answer});
  assert.ok(report.includes('```text\n' + answer + '\n```'));
});
