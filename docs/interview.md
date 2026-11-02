# LocalLens: demo and engineering discussion

## A two-minute walkthrough

Start from an empty library, add the sample data, search for `database backups`, and follow a result to its original line range. Import a small personal sample twice to demonstrate deduplication, then remove it and show that its terms no longer match. Run `node --test` and `node scripts/evaluate.mjs` to distinguish behavior checks from the tiny retrieval smoke dataset. Optional generation is a separate demonstration only when Ollama is actually available.

## Questions you should be able to answer

**Why BM25 instead of embeddings?** It works without a model download and offers transparent word matching. Its weakness is recall for synonyms, paraphrases, and cross-language queries. The implementation does not claim semantic understanding.

**Why chunks instead of whole documents?** Smaller passages are easier to inspect and fit inside a model context. Overlap reduces the chance that a relevant sentence is separated from its heading. It can also create duplicate results, which this version does not rerank away.

**How do citations work?** Each segment remembers its original 1-based line number. Each chunk carries a line span and document ID. Search results receive temporary S1–S6 labels for that response. Generated labels are not proof that the model's statement follows from the text.

**How is index consistency maintained?** Insert/delete triggers update the FTS index inside the same transaction as chunk writes. Foreign-key cascade removes chunks when a document is deleted. A persistence test reopens a disk database and searches it.

**What prevents injection?** SQL values are bound. Search terms are extracted as Unicode words and quoted before entering FTS syntax. Browser content uses textContent. The model receives a warning about untrusted excerpts, but prompt injection is still a model-level limitation.

**What happens when Ollama is unavailable?** A request can fail or time out. The API returns the retrieved sources with the error and the interface keeps those sources visible. The health endpoint reports configuration, not actual model availability.

**What would break at larger scale?** SQLite operations are synchronous, the source text is stored twice across source and chunks, and all HTTP traffic shares one process. There is no authentication, job queue, schema migration system, or generated-answer cache. Current limits intentionally keep the app a local personal tool.

**What does the evaluation prove?** Eight known queries retrieve their expected document among three chunks on a tiny synthetic corpus. It is a regression check, not a meaningful estimate of real-world recall. A stronger evaluation would separate authored data from held-out queries and measure retrieval and answer faithfulness independently.

## Небольшое самостоятельное улучшение

Добавь ограничение максимум два фрагмента из одного документа в выдаче. Сначала создай тест, где один длинный файл занимает всю выдачу. Затем сравни результаты исходного BM25 и новой группировки. Объясни компромисс: разнообразие источников может улучшить обзор, но иногда убирает полезные фрагменты одного документа.
