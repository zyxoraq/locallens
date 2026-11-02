import { createStore } from '../src/store.mjs';
import { demoDocuments, evaluationCases } from '../src/demo.mjs';
const store = createStore();
try {
  demoDocuments.forEach(d => store.add(d.title,d.content));
  let hits = 0;
  for (const item of evaluationCases) {
    const titles = store.search(item.query,3).map(s => s.title);
    const hit = titles.includes(item.expected); hits += Number(hit);
    console.log(`${hit ? 'PASS' : 'MISS'} ${item.query}`);
  }
  console.log(`\nDocument hit rate @3: ${hits}/${evaluationCases.length} (${(hits / evaluationCases.length * 100).toFixed(1)}%)`);
  console.log('Small synthetic lexical smoke set, not a benchmark of general search quality.');
  if (hits !== evaluationCases.length) process.exitCode = 1;
} finally { store.close(); }
