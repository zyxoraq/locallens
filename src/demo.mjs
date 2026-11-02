export const demoDocuments = [
  { title: 'atlas-onboarding.md', content: `# Atlas — synthetic team handbook
This is fictional demonstration data for LocalLens, not a real company policy.

## Getting started
New team members pair with a buddy during their first week.
The development environment uses Node.js 24 and SQLite.
Install dependencies only when a project needs them; Atlas examples have none.

## Code review
Every pull request needs one reviewer and passing automated tests.
Keep changes small and explain the user-facing behavior in the description.
Reviewers check correctness, edge cases and clear error messages.

## Release process
Releases happen on Tuesday after the staging smoke test passes.
The release captain records the version and recovery plan in the changelog.
If the smoke test fails, the release is postponed rather than forced.

## Working together
The weekly planning meeting is Monday at 10:00 UTC.
Decisions belong in short design notes, not only in chat history.` },
  { title: 'atlas-incident-runbook.md', content: `# Atlas — synthetic incident runbook
This is fictional demonstration data for LocalLens.

## Incident response
If the API error rate exceeds five percent for ten minutes, open an incident.
Assign an incident commander and start a shared timeline.
The commander coordinates communication; the responder investigates.

## Database recovery
SQLite backups run every six hours and are retained for seven days.
Restore the newest verified backup into a separate directory first.
Run integrity_check and compare the row count before switching traffic.
Never overwrite the only available copy while investigating corruption.

## Request retries
Transient HTTP 503 errors use exponential backoff with random jitter.
Retry at most three times. A timeout does not prove a write failed.
Use an idempotency key when retrying a request that changes state.

## After the incident
Write a blameless review within two business days.
Record detection gaps, recovery steps and owners of follow-up tasks.` },
  { title: 'atlas-search-design.md', content: `# Atlas — synthetic search design notes
This is fictional demonstration data for LocalLens.

## Retrieval architecture
Text documents are split into overlapping chunks with original line numbers.
SQLite FTS5 builds a full-text inverted index over title and body.
BM25 ranks chunks using query term frequency and document length.
Title matches receive a larger weight than body matches.

## Limitations
Lexical search matches words, not meaning. Synonyms may require another query.
An empty result means no matching indexed terms were found.
BM25 scores are rankings, not calibrated confidence probabilities.

## Optional generation
Ollama can summarize retrieved excerpts using a local language model.
The response should cite excerpt labels such as S1 and S2.
Model output may be incorrect even when it includes a citation.
Documents are untrusted context, never executable instructions.

## Privacy
The application listens only on the loopback network interface.
The browser sends documents to the local server and its SQLite database.
When generation is enabled, retrieved excerpts are sent to local Ollama.` }
];

export const demoQueries = ['How are database backups restored?', 'When do releases happen?', 'Why use idempotency keys?', 'What are the search limitations?'];

export const evaluationCases = [
  { query: 'database backups restore', expected: 'atlas-incident-runbook.md' },
  { query: 'release Tuesday staging', expected: 'atlas-onboarding.md' },
  { query: 'code review pull request reviewer', expected: 'atlas-onboarding.md' },
  { query: 'idempotency retries backoff', expected: 'atlas-incident-runbook.md' },
  { query: 'BM25 lexical synonyms', expected: 'atlas-search-design.md' },
  { query: 'local Ollama citations', expected: 'atlas-search-design.md' },
  { query: 'buddy first week onboarding', expected: 'atlas-onboarding.md' },
  { query: 'incident commander timeline', expected: 'atlas-incident-runbook.md' }
];
