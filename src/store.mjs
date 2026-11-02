import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';

export const MAX_DOCUMENT_BYTES = 250_000;
export const MAX_DOCUMENTS = 100;
const STOP_WORDS = new Set('a an the is are was were what how does do to of in for and or with can i my about this that who when where why на в и по как что это где для из с о а'.split(' '));

export function queryExpression(query) {
  if (typeof query !== 'string' || query.length > 500) throw new Error('Enter a question up to 500 characters.');
  const tokens = [...new Set((query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).filter(t => !STOP_WORDS.has(t)))].slice(0, 24);
  return tokens.map(token => `"${token}"`).join(' OR ');
}

/** Bounded overlapping chunks preserving original, 1-based source line numbers. */
export function chunkText(text, maxCharacters = 1200) {
  if (!Number.isInteger(maxCharacters) || maxCharacters < 80) throw new Error('Chunk size must be at least 80.');
  const segments = [];
  text.replace(/\r\n?/g, '\n').split('\n').forEach((line, index) => {
    if (!line.length) segments.push({ text: '', line: index + 1 });
    for (let start = 0; start < line.length; start += maxCharacters) {
      segments.push({ text: line.slice(start, start + maxCharacters), line: index + 1 });
    }
  });
  const chunks = [];
  for (let start = 0; start < segments.length;) {
    let end = start, length = 0;
    while (end < segments.length && (end === start || length + segments[end].text.length + 1 <= maxCharacters)) {
      length += segments[end].text.length + 1;
      end++;
    }
    const body = segments.slice(start, end).map(s => s.text).join('\n');
    if (body.trim()) chunks.push({ body, startLine: segments[start].line, endLine: segments[end - 1].line });
    if (end === segments.length) break;
    start = end - start > 3 ? end - 2 : end;
  }
  return chunks;
}

export function createStore(filename = ':memory:') {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
      hash TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL, bytes INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      title TEXT NOT NULL, body TEXT NOT NULL, start_line INTEGER NOT NULL, end_line INTEGER NOT NULL);
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(title, body, content='chunks', content_rowid='id', tokenize='unicode61');
    CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(rowid,title,body) VALUES(new.id,new.title,new.body); END;
    CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts,rowid,title,body) VALUES('delete',old.id,old.title,old.body); END;`);
  return {
    close: () => db.close(),
    list: () => db.prepare(`SELECT d.id,d.title,d.created_at AS createdAt,d.bytes,count(c.id) AS chunks
      FROM documents d LEFT JOIN chunks c ON c.document_id=d.id GROUP BY d.id ORDER BY d.created_at DESC,d.title`).all(),
    get: id => db.prepare('SELECT id,title,content FROM documents WHERE id=?').get(id),
    add(title, content) {
      if (typeof title !== 'string' || !title.trim() || title.length > 150) throw new Error('Document name must contain 1–150 characters.');
      if (!/\.(md|txt)$/i.test(title)) throw new Error('Only .md and .txt documents are supported.');
      if (typeof content !== 'string' || !content.trim() || content.includes('\0')) throw new Error('Document must contain readable text.');
      const bytes = Buffer.byteLength(content);
      if (bytes > MAX_DOCUMENT_BYTES) throw new Error('Document exceeds the 250 KB limit.');
      const hash = createHash('sha256').update(content).digest('hex');
      const existing = db.prepare('SELECT id FROM documents WHERE hash=?').get(hash);
      if (existing) return { id: existing.id, duplicate: true };
      if (db.prepare('SELECT count(*) AS n FROM documents').get().n >= MAX_DOCUMENTS) throw new Error('Library limit is 100 documents.');
      const id = randomUUID();
      const chunks = chunkText(content);
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?)').run(id,title.trim(),content,hash,new Date().toISOString(),bytes);
        const insert = db.prepare('INSERT INTO chunks(document_id,title,body,start_line,end_line) VALUES(?,?,?,?,?)');
        for (const chunk of chunks) insert.run(id,title.trim(),chunk.body,chunk.startLine,chunk.endLine);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return { id, duplicate: false, chunks: chunks.length };
    },
    remove(id) { return db.prepare('DELETE FROM documents WHERE id=?').run(id).changes > 0; },
    search(query, limit = 6) {
      const expression = queryExpression(query);
      if (!expression) return [];
      return db.prepare(`SELECT c.id,c.document_id AS documentId,c.title,c.body,
        c.start_line AS startLine,c.end_line AS endLine,bm25(chunks_fts,3.0,1.0) AS rank
        FROM chunks_fts JOIN chunks c ON c.id=chunks_fts.rowid
        WHERE chunks_fts MATCH ? ORDER BY rank,c.id LIMIT ?`).all(expression, Math.max(1,Math.min(20,Math.trunc(limit) || 6)))
        .map((row,index) => ({ ...row, citation: `S${index + 1}` }));
    }
  };
}
