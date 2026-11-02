const STOP_WORDS = new Set('a an the is are was were what how does do to of in for and or with can i my about this that who when where why на в и по как что это где для из с о а'.split(' '));

/** The same bounded, literal query tokens drive retrieval and visual highlighting. */
export function queryTerms(query) {
  if (typeof query !== 'string' || query.length > 500) throw new Error('Enter a question up to 500 characters.');
  return [...new Set((query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).filter(term => !STOP_WORDS.has(term)))].slice(0, 24);
}

/** Return text segments only; callers create text/mark nodes, never interpret HTML. */
export function highlightParts(text, query) {
  const terms = new Set(queryTerms(query));
  const parts = []; let cursor = 0;
  for (const word of text.matchAll(/[\p{L}\p{N}_]+/gu)) {
    if (!terms.has(word[0].toLowerCase())) continue;
    if (word.index > cursor) parts.push({ text: text.slice(cursor, word.index), match: false });
    parts.push({ text: word[0], match: true });
    cursor = word.index + word[0].length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false });
  return parts;
}

function inline(value) {
  return String(value).replace(/[\r\n]+/g, ' ').replace(/[\\`*_{}\[\]<>()!#|]/g, '\\$&');
}

/** Preserve literal untrusted content, even when it contains Markdown fences or HTML. */
function fenced(value) {
  const text = String(value);
  let longest = 0;
  for (const run of text.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}text\n${text}\n${fence}`;
}

/** Export a completed displayed snapshot, not the current editable form values. */
export function formatSearchReport(snapshot) {
  const sections = [
    '# LocalLens search report',
    `Captured: ${inline(snapshot.capturedAt)}\n\nScope: ${inline(snapshot.scope.title)}`,
    '## Query\n\n' + fenced(snapshot.query)
  ];
  if (snapshot.message) sections.push('## Status\n\n' + fenced(snapshot.message));
  if (snapshot.mode === 'generated' && typeof snapshot.answer === 'string' && snapshot.answer.trim()) {
    sections.push(`## Generated answer\n\nModel: ${inline(snapshot.model)}\n\nGenerated text may be incorrect; citation labels do not verify its claims.\n\n${fenced(snapshot.answer)}`);
  }
  sections.push(`## Sources (${snapshot.sources.length})`);
  if (!snapshot.sources.length) sections.push('No matching source excerpts were found.');
  for (const source of snapshot.sources) {
    sections.push(`### ${inline(source.citation)} — ${inline(source.title)}\n\nLines ${source.startLine}–${source.endLine}\n\n${fenced(source.body)}`);
  }
  sections.push('---\nExported from the displayed LocalLens result. Excerpts are snapshots of the indexed document versions; source line numbers refer to those versions.');
  return sections.join('\n\n') + '\n';
}
