const $ = selector => document.querySelector(selector);
const state = { generationEnabled: false, busy: false, documents: [], request: 0 };

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function notice(message = '', type = 'info') {
  $('#status').hidden = !message;
  $('#status').textContent = message;
  $('#status').dataset.type = type;
}

async function api(route, { method = 'GET', body } = {}) {
  const response = await fetch(route, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status}).`);
    error.sources = payload.sources;
    throw error;
  }
  return payload;
}

function setBusy(busy, operation = 'search') {
  state.busy = busy;
  $('#search-button').disabled = busy;
  $('#generate-button').disabled = busy || !state.generationEnabled;
  $('#search-button').textContent = busy && operation === 'search' ? 'Searching…' : 'Search ↗';
  $('#generate-button').textContent = busy && operation === 'answer' ? '✧ Reading locally…' : '✧ Ask local model';
  $('#results').setAttribute('aria-busy',String(busy));
  $('#file-input').disabled = busy;
  $('#load-demo').disabled = busy;
  for (const button of document.querySelectorAll('.delete-button')) button.disabled = busy;
}

function invalidateResults() {
  state.request++;
  $('#answer-panel').hidden = true;
  $('#results-title').textContent = 'Library updated';
  $('#result-meta').textContent = 'Run a search to refresh your excerpts';
  const empty = element('div','empty-state');
  empty.append(element('div','empty-icon','▤'),element('h3','','Your sources are ready.'),element('p','',state.documents.length ? 'Search your updated library to find a passage.' : 'Add a document or load the sample library to begin.'));
  $('#results').replaceChildren(empty);
}

async function refreshDocuments() {
  const { documents } = await api('/api/documents');
  state.documents = documents;
  $('#document-count').textContent = documents.length;
  const list = $('#documents'); list.replaceChildren();
  if (!documents.length) list.append(element('p','muted','Your library is empty. Add a file or explore the demo.'));
  for (const document of documents) {
    const row = element('div','document-row');
    const open = element('button','document-open'); open.title = document.title;
    open.append(element('strong','',document.title),element('small','',`${document.chunks} excerpts · ${(document.bytes / 1000).toFixed(1)} KB`));
    open.addEventListener('click',() => viewDocument(document.id));
    const remove = element('button','delete-button','×'); remove.title = `Remove ${document.title}`; remove.setAttribute('aria-label',`Remove ${document.title}`);
    remove.disabled = state.busy;
    remove.addEventListener('click',async () => {
      if (state.busy) return;
      if (!confirm(`Remove "${document.title}" from this local library? Your original file will not be changed.`)) return;
      setBusy(true,'library');
      try {
        await api(`/api/documents/${document.id}`,{ method:'DELETE' });
        await refreshDocuments();
        invalidateResults();
        notice('Document removed from the local index.');
      } catch (error) { notice(error.message,'error'); }
      finally { setBusy(false); }
    });
    row.append(element('span','doc-icon','▤'),open,remove); list.append(row);
  }
}

async function viewDocument(id, startLine = 1) {
  try {
    const { document } = await api(`/api/documents/${id}`);
    $('#document-title').textContent = document.title;
    $('#document-content').textContent = document.content.replace(/\r\n?/g,'\n').split('\n').map((line,i) => `${String(i + 1).padStart(4)}  ${line}`).join('\n');
    $('#document-dialog').showModal();
    $('#document-content').scrollTop = Math.max(0,(startLine - 3) * 21);
  } catch (error) { notice(error.message,'error'); }
}

function renderSources(sources, elapsedMs) {
  $('#results-title').textContent = sources.length ? 'Found in your library' : 'No matching passages';
  $('#result-meta').textContent = `${sources.length} excerpt${sources.length === 1 ? '' : 's'}${elapsedMs === undefined ? '' : ` · ${elapsedMs} ms retrieval`}`;
  const list = $('#results'); list.replaceChildren();
  if (!sources.length) {
    const empty = element('div','empty-state');
    empty.append(element('div','empty-icon','⌕'),element('h3','','Try words from your documents.'),element('p','','Search matches words rather than meaning. Add a relevant document or use a more specific keyword.'));
    list.append(empty);
  }
  for (const source of sources) {
    const card = element('article','result');
    const top = element('div','result-top');
    const title = element('button','result-title',source.title);
    title.addEventListener('click',() => viewDocument(source.documentId,source.startLine));
    top.append(title,element('span','citation',`[${source.citation}]`));
    const footer = element('div','result-footer');
    const inspect = element('button','','Open original ↗');
    inspect.addEventListener('click',() => viewDocument(source.documentId,source.startLine));
    footer.append(element('span','',`Lines ${source.startLine}–${source.endLine}`),inspect);
    card.append(top,element('pre','',source.body),footer); list.append(card);
  }
}

async function search(generated = false) {
  const query = $('#query').value.trim();
  if (!query || state.busy) return;
  if (!state.documents.length) return notice('Add documents or load the sample library first.');
  notice(); setBusy(true,generated ? 'answer' : 'search'); $('#answer-panel').hidden = true;
  const request = ++state.request;
  try {
    const result = await api(generated ? '/api/answer' : '/api/search',{ method:'POST',body:{query} });
    if (request !== state.request) return;
    renderSources(result.sources,result.elapsedMs);
    if (result.message) notice(result.message);
    if (result.mode === 'generated' && result.answer) {
      $('#answer-panel').hidden = false;
      $('#answer-text').textContent = result.answer;
      $('#answer-model').textContent = result.model;
    }
  } catch (error) {
    if (error.sources) renderSources(error.sources);
    notice(error.message,'error');
  } finally { setBusy(false); }
}

async function importFiles(files) {
  if (!files.length) return;
  if (state.busy) return notice('Wait for the current operation to finish before importing documents.');
  setBusy(true,'library');
  let added = 0, duplicates = 0; const errors = [];
  try {
  for (const file of files) {
    if (!/\.(txt|md)$/i.test(file.name)) { errors.push(`${file.name}: only .txt and .md are supported`); continue; }
    if (file.size > 250_000) { errors.push(`${file.name}: exceeds 250 KB`); continue; }
    try {
      const text = new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());
      const result = await api('/api/documents',{ method:'POST',body:{title:file.name,content:text} });
      result.duplicate ? duplicates++ : added++;
    } catch (error) { errors.push(`${file.name}: ${error.message}`); }
  }
  await refreshDocuments();
  if (added) invalidateResults();
  notice(`${added} document(s) added${duplicates ? `; ${duplicates} duplicate(s) skipped` : ''}.${errors.length ? ` ${errors.join('. ')}` : ''}`,errors.length ? 'error' : 'info');
  $('#file-input').value = '';
  } finally { setBusy(false); }
}

$('#search-form').addEventListener('submit',event => { event.preventDefault(); search(); });
$('#generate-button').addEventListener('click',() => search(true));
$('#close-dialog').addEventListener('click',() => $('#document-dialog').close());
$('#file-input').addEventListener('change',event => importFiles([...event.target.files]).catch(error => notice(error.message,'error')));
const dropZone = $('#drop-zone');
for (const eventName of ['dragenter','dragover']) dropZone.addEventListener(eventName,event => { event.preventDefault(); dropZone.classList.add('drag-over'); });
for (const eventName of ['dragleave','drop']) dropZone.addEventListener(eventName,event => { event.preventDefault(); dropZone.classList.remove('drag-over'); });
dropZone.addEventListener('drop',event => importFiles([...event.dataTransfer.files]).catch(error => notice(error.message,'error')));
$('#load-demo').addEventListener('click',async () => {
  if (state.busy) return;
  setBusy(true,'library');
  try {
    const { added } = await api('/api/demo',{ method:'POST',body:{} });
    await refreshDocuments();
    if (added) invalidateResults();
    notice(added ? 'Sample library added. These documents describe a fictional team.' : 'The sample documents are already in your library.');
    $('#query').focus();
  } catch (error) { notice(error.message,'error'); }
  finally { setBusy(false); }
});

try {
  const health = await api('/api/health');
  state.generationEnabled = health.generationEnabled;
  $('#mode-badge').textContent = health.generationEnabled ? '● Local model configured' : '● Offline search';
  $('#generate-button').disabled = !health.generationEnabled;
  $('#generate-button').title = health.generationEnabled ? `Ask ${health.model} using retrieved excerpts` : 'Set OLLAMA_MODEL when starting the server';
  for (const query of health.demoQueries) {
    const button = element('button','',query);
    button.addEventListener('click',() => { $('#query').value = query; search(); });
    $('#suggestions').append(button);
  }
  await refreshDocuments();
} catch (error) { $('#mode-badge').textContent = '● Server unavailable'; notice(`Could not connect: ${error.message}`,'error'); }
