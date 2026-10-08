/* Level 7 — Search + Vector */
MM.addLessons([
{
  id: 'text-search', module: 'text-search', title: 'Text indexes, $text and full-text search engines', minutes: 22,
  summary: 'Keyword search with the built-in text index (stemming, stop words, phrases, negation, weights) and when you need a Lucene-based search engine instead.',
  objectives: ['Create weighted text indexes', 'Query with $text, phrases and negation, and sort by textScore', 'Know the limits of text indexes', 'Compare with $search (Lucene) and external engines'],
  sections: {
    concept: `<p>A <b>text index</b> tokenizes string fields, removes stop words and stems words ("running" → "run"), storing one entry per term. Query with <code>{ $text: { $search: "..." } }</code>:</p>
<ul><li>Words are OR-ed: <code>"wireless headphones"</code> matches either word.</li>
<li><code>"\\"noise cancelling\\""</code> requires the phrase; <code>-refurbished</code> excludes a term.</li>
<li>Relevance: <code>{ score: { $meta: "textScore" } }</code> in projection and sort; <code>weights</code> boost fields such as titles.</li>
<li>One text index per collection (it can cover several fields, or all string fields with <code>"$**": "text"</code>).</li></ul>
<p><b>Full-text search engines</b> (Lucene-based <code>$search</code> via mongot, Elasticsearch, OpenSearch) add fuzzy matching (typos), autocomplete, synonyms, facets, highlighting, per-field analyzers and much better relevance tuning.</p>`,
    why: `<p>Search boxes are everywhere. A text index is enough for simple keyword search over modest data with no extra infrastructure. Knowing its limits tells you when to bring in a search engine before users complain that "headphnes" returns nothing.</p>`,
    useCase: `<p>An internal admin tool searches product names and tags with a text index. The public storefront, which needs typo tolerance, autocomplete and facet counts, uses a Lucene-based search index synced from MongoDB.</p>`,
    internals: `<p>Text indexes are multikey-like: one key per (term, document) with a weight. They can be large and slow to build, and every write to an indexed field updates many keys. A <code>$text</code> query must use the text index (you cannot <code>hint</code> another index) and, in a compound text index, equality conditions on prefix fields are required. Lucene-based search runs as a separate process (mongot) that reads change streams to keep its indexes eventually consistent with the collection.</p>
<div class="callout info"><b>Self-managed availability</b><code>$search</code> and <code>$vectorSearch</code> began on Atlas. Since MongoDB 8.2 they are available for self-managed Community and Enterprise deployments through mongot (initially as a public preview). Check the current status for your version before relying on them.</div>`
  },
  examples: [
    { title: 'Weighted text index on products', code: `db.products.createIndex({ name: "text", tags: "text", category: "text" }, { weights: { name: 5, tags: 2 }, name: "products_text" })
db.products.find({ $text: { $search: "wireless speaker" } }, { name: 1, score: { $meta: "textScore" } }).sort({ score: { $meta: "textScore" } }).limit(5)` },
    { title: 'Phrases and negation', code: `db.products.find({ $text: { $search: "\\"desk lamp\\"" } }, { name: 1 }).limit(5)
db.products.find({ $text: { $search: "coffee -beans" } }, { name: 1 }).limit(5)` },
    { title: 'Stemming', code: `db.products.find({ $text: { $search: "running" } }, { name: 1 }).limit(3)
db.products.find({ $text: { $search: "runs" } }, { name: 1 }).limit(3)`, note: 'Both find "Running Shoes": the query terms and the index terms are stemmed to "run".' },
    { title: 'Text search inside aggregation', code: `db.products.aggregate([
  { $match: { $text: { $search: "pro" } } },
  { $group: { _id: "$category", matches: { $sum: 1 }, avgPrice: { $avg: "$price" } } },
  { $sort: { matches: -1 } }
])` }
  ],
  mistakes: [
    'Expecting typo tolerance or prefix (autocomplete) matching from a text index.',
    'Creating a second text index on the same collection (error); put all fields in one.',
    'Using <code>$regex</code> with leading wildcards for search over large collections.',
    'Forgetting language settings (default English stemming applied to other languages).'
  ],
  interview: [
    { q: 'When is a MongoDB text index enough and when do you need a search engine?', a: '<p>A text index is fine for simple keyword search with stemming and basic relevance on moderate data. Use Lucene-based search (mongot <code>$search</code>, Elasticsearch, OpenSearch) when you need fuzzy matching, autocomplete, synonyms, facets, highlighting, custom analyzers, or advanced relevance tuning, and accept the extra infrastructure and eventual consistency.</p>' }
  ],
  quiz: [
    { q: 'How many text indexes can a collection have?', options: ['One', 'One per field', 'Two', 'Unlimited'], answer: 0 },
    { q: 'Which query requires an exact phrase?', options: ['{ $text: { $search: "desk lamp" } }', '{ $text: { $search: "\\"desk lamp\\"" } }', '{ $text: { $search: "desk -lamp" } }', '{ name: /desk lamp/ }'], answer: 1 }
  ]
},
{
  id: 'vector-search-rag', module: 'vector-search', title: 'Vector search and RAG with MongoDB', minutes: 30,
  summary: 'Store embeddings next to your documents, index them for approximate nearest neighbour search, combine semantic similarity with filters, and build retrieval-augmented generation.',
  objectives: ['Explain embeddings, similarity functions and ANN indexes', 'Create a vector search index with filter fields', 'Query with $vectorSearch: numCandidates, limit, filter, score', 'Design a RAG pipeline: chunking, embedding, retrieval, prompting'],
  sections: {
    concept: `<p>An <b>embedding</b> is a vector of numbers (for example 768 or 1536 dimensions) produced by a model so that semantically similar texts or images have nearby vectors. <b>Similarity</b> is measured with cosine, dot product (for normalized vectors) or euclidean distance.</p>
<pre class="static">db.docs.createSearchIndex({ name: "vec", type: "vectorSearch", definition: { fields: [
  { type: "vector", path: "embedding", numDimensions: 1536, similarity: "cosine" },
  { type: "filter", path: "category" } ] } })

db.docs.aggregate([
  { $vectorSearch: { index: "vec", path: "embedding", queryVector: [...], numCandidates: 200, limit: 5, filter: { category: "sports" } } },
  { $project: { title: 1, score: { $meta: "vectorSearchScore" } } }
])</pre>
<ul><li>Vector indexes use <b>HNSW</b> graphs for approximate nearest neighbour (ANN) search; <code>numCandidates</code> controls how many neighbours are explored (recall vs latency; a common start is 10-20x <code>limit</code>). <code>exact: true</code> performs exhaustive search.</li>
<li>Pre-filtering requires the field to be declared as <code>type: "filter"</code> in the index.</li>
<li>Quantization (scalar or binary) reduces memory for large vector sets at some cost in recall.</li></ul>
<div data-diagram="rag"></div>`,
    why: `<p>Keeping vectors with the operational data avoids a separate vector database and the sync problems that come with it: filters on business fields, access control and freshness work on the same documents. RAG grounds LLM answers in your own data, which is the most common enterprise generative-AI pattern.</p>`,
    useCase: `<p>A support assistant: product manuals are split into ~500-token chunks, each stored with its embedding, product id and version. A question is embedded, <code>$vectorSearch</code> retrieves the 5 most similar chunks filtered by the customer's product and version, and the LLM answers using only those chunks, citing them.</p>`,
    internals: `<p>The vector index is maintained by mongot alongside the database and updated asynchronously from change streams, so newly written vectors become searchable shortly after the write. Memory is the main cost: 1 million 1536-dimension float32 vectors are about 6 GB before quantization, plus graph overhead. Hybrid search combines vector results with keyword (<code>$search</code>) results, for example with reciprocal rank fusion, to handle exact terms such as product codes that embeddings handle poorly.</p>
<div class="callout info"><b>Playground note</b>This simulator computes exact similarity on small hand-made vectors so you can see the mechanics; a real deployment uses model-generated embeddings and an HNSW index in mongot.</div>`
  },
  examples: [
    { title: 'Documents with tiny embeddings', code: `db.lab_kb.drop()
// dimensions: [electronics, fitness, kitchen, reading]
db.lab_kb.insertMany([
  { title: "Pairing wireless earbuds with a phone", category: "electronics", embedding: [0.9, 0.2, 0.0, 0.1] },
  { title: "Choosing running shoes for long distances", category: "sports", embedding: [0.1, 0.95, 0.0, 0.1] },
  { title: "Heart-rate zones with a smart watch", category: "electronics", embedding: [0.7, 0.7, 0.0, 0.1] },
  { title: "Cleaning a coffee grinder", category: "home", embedding: [0.1, 0.0, 0.95, 0.1] },
  { title: "Yoga mat thickness guide", category: "sports", embedding: [0.0, 0.9, 0.1, 0.2] },
  { title: "Best books on databases", category: "books", embedding: [0.2, 0.0, 0.0, 0.95] }
])
db.lab_kb.createSearchIndex({ name: "vec", type: "vectorSearch", definition: { fields: [
  { type: "vector", path: "embedding", numDimensions: 4, similarity: "cosine" },
  { type: "filter", path: "category" } ] } })` },
    { title: 'Semantic query: "training for a marathon"', code: `db.lab_kb.aggregate([
  { $vectorSearch: { index: "vec", path: "embedding", queryVector: [0.2, 0.9, 0.0, 0.1], numCandidates: 20, limit: 3 } },
  { $project: { _id: 0, title: 1, score: { $meta: "vectorSearchScore" } } }
])`, note: 'No keyword overlap with "marathon" is needed: the vectors carry the meaning.' },
    { title: 'Semantic query with a pre-filter', code: `db.lab_kb.aggregate([
  { $vectorSearch: { index: "vec", path: "embedding", queryVector: [0.2, 0.9, 0.0, 0.1], numCandidates: 20, limit: 3, filter: { category: "electronics" } } },
  { $project: { _id: 0, title: 1, category: 1, score: { $meta: "vectorSearchScore" } } }
])` },
    { title: 'RAG retrieval step in application code', runnable: false, code: `async function answer(question, productId) {
  const queryVector = await embed(question);                       // same model used for the chunks
  const chunks = await db.collection("manual_chunks").aggregate([
    { $vectorSearch: { index: "vec", path: "embedding", queryVector, numCandidates: 150, limit: 5, filter: { productId } } },
    { $project: { text: 1, source: 1, score: { $meta: "vectorSearchScore" } } }
  ]).toArray();
  const context = chunks.map((c, i) => "[" + (i + 1) + "] " + c.text).join("\\n\\n");
  return llm.complete({
    system: "Answer only from the numbered context. Cite sources like [2]. Say you do not know if the context is insufficient.",
    user: "Context:\\n" + context + "\\n\\nQuestion: " + question
  });
}` }
  ],
  mistakes: [
    'Embedding queries and documents with different models or versions.',
    'Chunks that are too large (diluted meaning) or too small (no context); no overlap between chunks.',
    'Filtering after <code>$vectorSearch</code> with <code>$match</code> instead of a pre-filter, returning fewer than <code>limit</code> results.',
    '<code>numCandidates</code> equal to <code>limit</code>, giving poor recall.',
    'Ignoring re-embedding cost and versioning when the model changes.'
  ],
  interview: [
    { q: 'How does vector search work in MongoDB?', a: '<p>Embeddings are stored as arrays in documents. A vector search index (HNSW graph, maintained by mongot) is defined on the vector path with dimensions and similarity, plus optional filter fields. <code>$vectorSearch</code> takes a query vector, explores <code>numCandidates</code> nearest neighbours approximately, applies pre-filters, and returns the top <code>limit</code> documents with a similarity score available via <code>$meta: "vectorSearchScore"</code>. Results can flow into further pipeline stages.</p>' },
    { q: 'Describe a RAG architecture on MongoDB.', a: '<p>Ingest: split documents into chunks, embed each, store text, embedding and metadata (source, version, ACL) in a collection with a vector index. Query: embed the question, run <code>$vectorSearch</code> with metadata filters (tenant, permissions), optionally combine with keyword search, re-rank, assemble a prompt with the top chunks and instructions to cite and abstain, call the LLM. Operate: keep embeddings in sync on content changes (change streams), evaluate retrieval quality, monitor latency and cost.</p>' }
  ],
  quiz: [
    { q: 'What does numCandidates control?', options: ['How many results are returned', 'How many neighbours the ANN search explores', 'The vector dimensions', 'The number of shards'], answer: 1 },
    { q: 'To pre-filter $vectorSearch by category, the category field must be...', options: ['Indexed with a text index', 'Declared as type "filter" in the vector index', 'The shard key', 'A string array'], answer: 1 }
  ]
}
]);
