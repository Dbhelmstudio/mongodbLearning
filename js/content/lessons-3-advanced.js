/* Level 3 — Advanced */
MM.addLessons([
{
  id: 'patterns-read', module: 'schema-patterns', title: 'Patterns for read performance: computed, subset, extended reference, bucket, outlier', minutes: 30,
  summary: 'The schema design patterns that turn expensive reads into cheap ones by doing work at write time or by storing data in the shape it is read.',
  objectives: ['Pre-compute aggregates with the computed pattern', 'Keep hot data small with the subset pattern', 'Avoid joins with extended references', 'Group time-ordered data with the bucket pattern', 'Handle rare huge cases with the outlier pattern'],
  sections: {
    concept: `<table><tr><th>Pattern</th><th>Problem</th><th>Idea</th></tr>
<tr><td><b>Computed</b></td><td>Same aggregation on every read</td><td>Store the result (ratingAvg, reviewCount, totals) and update it on write or on a schedule</td></tr>
<tr><td><b>Subset</b></td><td>Large document, but screens need only part</td><td>Embed the most recent or most relevant N children; keep the rest in their own collection</td></tr>
<tr><td><b>Extended reference</b></td><td>Every read joins to fetch a few fields</td><td>Copy the few stable fields you need along with the reference (customer name and city into the order)</td></tr>
<tr><td><b>Bucket</b></td><td>Millions of tiny time-ordered documents</td><td>One document per entity per time window with an array of measurements and summary fields</td></tr>
<tr><td><b>Outlier</b></td><td>A few documents are far larger than the rest</td><td>Design for the common case; flag outliers (<code>hasOverflow: true</code>) and store their excess elsewhere</td></tr>
<tr><td><b>Approximation</b></td><td>High-frequency counters</td><td>Update the counter every N events or with sampling when exactness is not required</td></tr></table>`,
    why: `<p>Most production applications read far more than they write (often 10:1 or 100:1). Spending a little at write time to make reads a single indexed lookup is usually the right trade. These patterns are the vocabulary architects use in design reviews and interviews.</p>`,
    useCase: `<p>The product page shows the average rating, number of reviews and the three most helpful reviews. Instead of aggregating 2,000 reviews per view, a background job (or a change stream consumer) maintains <code>ratingAvg</code>, <code>reviewCount</code> and <code>topReviews</code> on the product document: computed plus subset.</p>`,
    internals: `<p>Fewer, smaller, denser documents mean more useful data per WiredTiger cache page and fewer index entries. The bucket pattern reduces index size dramatically: one index entry per bucket instead of per measurement. Time series collections (lesson below) apply bucketing automatically inside the server.</p>`
  },
  examples: [
    { title: 'Computed + subset: maintain product rating summary', code: `db.reviews.aggregate([
  { $sort: { helpfulVotes: -1 } },
  { $group: {
      _id: "$productId",
      ratingAvg: { $avg: "$rating" },
      reviewCount: { $sum: 1 },
      topReviews: { $push: { title: "$title", rating: "$rating", votes: "$helpfulVotes" } } } },
  { $project: { ratingAvg: { $round: ["$ratingAvg", 2] }, reviewCount: 1, topReviews: { $slice: ["$topReviews", 3] } } },
  { $merge: { into: "products", on: "_id", whenMatched: "merge", whenNotMatched: "discard" } }
])
db.products.findOne({ _id: "P010" }, { name: 1, ratingAvg: 1, reviewCount: 1, topReviews: 1 })` },
    { title: 'Extended reference already in orders', code: `db.orders.findOne({}, { orderNo: 1, "items.productId": 1, "items.name": 1, "items.price": 1, shipping: 1 })`, note: 'Each line item references the product by id and copies the name and price needed for display.' },
    { title: 'Bucket pattern: events per customer per day', code: `db.events.aggregate([
  { $match: { customerId: { $lte: 20 } } },
  { $group: {
      _id: { customerId: "$customerId", day: { $dateTrunc: { date: "$ts", unit: "day" } } },
      count: { $sum: 1 },
      maxLatency: { $max: "$latencyMs" },
      events: { $push: { ts: "$ts", type: "$type" } } } },
  { $merge: { into: "lab_event_buckets", on: "_id", whenMatched: "replace" } }
])
db.lab_event_buckets.countDocuments()
db.lab_event_buckets.findOne({}, { count: 1, maxLatency: 1, events: { $slice: 2 } })` },
    { title: 'Outlier flag', code: `db.lab_books.drop()
db.lab_books.insertMany([
  { _id: 1, title: "Niche title", buyers: [11, 12, 13] },
  { _id: 2, title: "Bestseller", buyers: [21, 22, 23], hasOverflow: true }
])
db.lab_books_overflow.insertOne({ bookId: 2, page: 1, buyers: [24, 25, 26, 27] })
db.lab_books.find({ hasOverflow: true }, { title: 1 })` }
  ],
  mistakes: [
    'Computing on every read what could be stored once.',
    'Embedding everything to "avoid joins" and creating huge documents; the subset pattern keeps only what is shown.',
    'Copying volatile fields in an extended reference (stock level, status) that then go stale.',
    'Forgetting to decide who updates the duplicated data and how often.'
  ],
  interview: [
    { q: 'Describe the subset pattern.', a: '<p>When a parent has many children but the screen shows only a few, embed a bounded subset (most recent, most helpful) in the parent for the fast path, and keep the full set in a separate collection for "see all" pages. It keeps the working set small and avoids a second query for the common view.</p>' },
    { q: 'How do you keep computed fields correct?', a: '<p>Update them in the same write path (e.g. <code>$inc</code> reviewCount when inserting a review, in a transaction if both must be consistent), or asynchronously from change streams or a scheduled <code>$merge</code> job when eventual consistency is acceptable. Document the staleness tolerance.</p>' },
    { q: 'What is the outlier pattern?', a: '<p>Design the schema for the typical document (e.g. a book with a few hundred buyers embedded) and handle the rare extreme case (a bestseller with millions) with a flag and overflow documents, instead of forcing every document into a design that only the outliers need.</p>' }
  ],
  quiz: [
    { q: 'Which pattern stores a few stable fields of a related document alongside its id?', options: ['Bucket', 'Extended reference', 'Outlier', 'Approximation'], answer: 1 },
    { q: 'Which pattern groups many small time-ordered measurements into one document?', options: ['Subset', 'Computed', 'Bucket', 'Polymorphic'], answer: 2 }
  ]
},
{
  id: 'patterns-flex', module: 'schema-patterns', title: 'Patterns for flexibility: polymorphic, attribute, versioning, trees, archive', minutes: 25,
  summary: 'Model varied shapes in one collection, index arbitrary attributes, evolve schemas without downtime, store hierarchies, and age out cold data.',
  objectives: ['Store polymorphic documents with a type discriminator', 'Use the attribute (key/value) pattern with one index', 'Version documents and migrate lazily', 'Choose a tree pattern: parent reference, child references, ancestors array, materialized path'],
  sections: {
    concept: `<ul>
<li><b>Polymorphic</b>: documents of related types share a collection with a discriminator (<code>category</code>, <code>type</code>) and common fields indexed; type-specific fields vary.</li>
<li><b>Attribute</b>: many optional, searchable attributes become an array of <code>{ k, v }</code> pairs with one compound index <code>{ "attrs.k": 1, "attrs.v": 1 }</code> instead of dozens of indexes. Alternatively, a wildcard index on a sub-document.</li>
<li><b>Schema versioning</b>: a <code>schemaVersion</code> field; the application reads all versions, writes the newest, and documents migrate lazily on update or in background batches.</li>
<li><b>Trees</b>: parent reference (<code>managerId</code>, walk with <code>$graphLookup</code>), array of ancestors (fast subtree queries), materialized path (<code>",electronics,audio,"</code> queried with an anchored regex).</li>
<li><b>Archive</b>: move cold data to another collection, cluster or object storage (online archive); TTL indexes for data with a fixed lifetime.</li>
</ul>`,
    why: `<p>Requirements change. These patterns let you add product types, attributes and fields without a stop-the-world migration, which is one of the main reasons teams choose a document database.</p>`,
    useCase: `<p>The catalog's electronics have <code>brand</code>, <code>warrantyMonths</code>; books have <code>author</code>, <code>pages</code>; groceries have <code>expiryDays</code>. A wildcard index on <code>attributes.$**</code> lets the filter UI query any attribute. When <code>price</code> moves to a <code>{ amount, currency }</code> object, documents get <code>schemaVersion: 2</code> as they are updated.</p>`,
    internals: `<p>A wildcard index stores an entry per (path, value) pair under the indexed sub-document, so it behaves like many single-field indexes in one structure. It cannot support sorts on multiple fields or compound predicates across paths as well as a dedicated compound index, so use it for long-tail attributes and keep dedicated indexes for the hot ones.</p>`
  },
  examples: [
    { title: 'Polymorphic catalog', code: `db.products.aggregate([
  { $group: { _id: "$category", attributeKeys: { $addToSet: { $map: { input: { $objectToArray: "$attributes" }, as: "a", in: "$$a.k" } } } } },
  { $project: { attributeKeys: { $reduce: { input: "$attributeKeys", initialValue: [], in: { $setUnion: ["$$value", "$$this"] } } } } },
  { $sort: { _id: 1 } }
])` },
    { title: 'Wildcard index for arbitrary attributes', code: `db.products.createIndex({ "attributes.$**": 1 })
db.products.find({ "attributes.author": "M. Kleppmann" }, { name: 1 }).explain("executionStats")` },
    { title: 'Attribute pattern', code: `db.lab_items.drop()
db.lab_items.insertMany([
  { sku: "TV-1", attrs: [{ k: "screen", v: 55 }, { k: "hdr", v: true }] },
  { sku: "TV-2", attrs: [{ k: "screen", v: 65 }, { k: "refresh", v: 120 }] }
])
db.lab_items.createIndex({ "attrs.k": 1, "attrs.v": 1 })
db.lab_items.find({ attrs: { $elemMatch: { k: "screen", v: { $gte: 60 } } } }, { _id: 0, sku: 1 })` },
    { title: 'Tree: subordinates with $graphLookup', code: `db.employees.aggregate([
  { $match: { _id: 2 } },
  { $graphLookup: { from: "employees", startWith: "$_id", connectFromField: "_id", connectToField: "managerId", as: "reports", depthField: "level" } },
  { $project: { name: 1, title: 1, totalReports: { $size: "$reports" }, direct: { $size: { $filter: { input: "$reports", as: "r", cond: { $eq: ["$$r.level", 0] } } } } } }
])` },
    { title: 'Lazy schema migration', code: `db.lab_users.drop()
db.lab_users.insertMany([{ _id: 1, name: "Old style", phone: "555-1" }, { _id: 2, schemaVersion: 2, name: "New style", contact: { phones: ["555-2"] } }])
db.lab_users.updateMany({ schemaVersion: { $exists: false } }, [
  { $set: { schemaVersion: 2, contact: { phones: ["$phone"] } } }, { $unset: "phone" }
])
db.lab_users.find()` }
  ],
  mistakes: [
    'One collection per product type, which makes cross-type queries painful.',
    'One index per optional attribute; use the attribute pattern or a wildcard index.',
    'Big-bang migrations of millions of documents during peak hours instead of lazy or batched migration.',
    'Choosing a tree representation without knowing whether reads walk up (ancestors) or down (subtrees).'
  ],
  interview: [
    { q: 'How do you evolve a schema in production without downtime?', a: '<p>Add a <code>schemaVersion</code> field. Deploy application code that can read both versions and writes the new one. Migrate in the background in throttled batches (or lazily on next write). Update the validator to accept both during the transition, then tighten it once all documents are migrated. Never require a big-bang rewrite.</p>' },
    { q: 'When would you use a wildcard index?', a: '<p>For user-defined or highly variable attributes where you cannot predict query fields: a wildcard index on <code>attributes.$**</code> serves equality and range queries on any sub-path. For known hot query shapes, a compound index is still better (sorts, multi-field predicates, coverage).</p>' }
  ],
  quiz: [
    { q: 'Which pattern converts many optional fields into an array of k/v pairs?', options: ['Polymorphic', 'Attribute', 'Subset', 'Bucket'], answer: 1 },
    { q: 'Which tree representation makes "all descendants of X" a single indexed query?', options: ['Parent reference only', 'Array of ancestors', 'Child references only', 'Nested documents'], answer: 1 }
  ]
},
{
  id: 'index-types-options', module: 'index-types', title: 'Unique, partial, sparse, TTL, text, wildcard, hashed and geo indexes', minutes: 28,
  summary: 'Every index type and option, what it is for, and the traps in each.',
  objectives: ['Enforce uniqueness, including on a subset with partial indexes', 'Shrink indexes with partialFilterExpression', 'Expire data with TTL', 'Know when to use text, wildcard, hashed, 2dsphere and hidden indexes'],
  sections: {
    concept: `<table><tr><th>Type / option</th><th>Use</th><th>Watch out for</th></tr>
<tr><td><code>unique: true</code></td><td>Natural keys (email, orderNo)</td><td>Missing fields count as null; two missing values collide unless partial</td></tr>
<tr><td><code>partialFilterExpression</code></td><td>Index only documents matching a filter (active users, unpaid orders)</td><td>Query must include the filter condition to use it</td></tr>
<tr><td><code>sparse: true</code></td><td>Skip documents missing the field</td><td>Superseded by partial indexes; can return incomplete results for sorts</td></tr>
<tr><td><code>expireAfterSeconds</code> (TTL)</td><td>Sessions, logs, OTPs</td><td>Single date field; deletion runs every 60s</td></tr>
<tr><td><code>"text"</code></td><td>Keyword search with stemming</td><td>One per collection; no fuzzy matching or relevance tuning like a search engine</td></tr>
<tr><td><code>"$**"</code> wildcard</td><td>Arbitrary or user-defined fields</td><td>No multi-field sort support; larger than targeted indexes</td></tr>
<tr><td><code>"hashed"</code></td><td>Hashed shard keys, even distribution</td><td>Equality only, no ranges</td></tr>
<tr><td><code>"2dsphere"</code></td><td>Geo queries: <code>$near</code>, <code>$geoWithin</code></td><td>GeoJSON format: <code>[lng, lat]</code> order</td></tr>
<tr><td><code>hidden: true</code></td><td>Test the impact of dropping an index</td><td>Still maintained on writes</td></tr>
<tr><td><code>collation</code></td><td>Case-insensitive matching and sorting</td><td>Query must specify the same collation</td></tr></table>`,
    why: `<p>The right index option often solves a problem more elegantly than application code: uniqueness only among active users (partial unique), automatic cleanup (TTL), or a much smaller index that fits in RAM (partial).</p>`,
    useCase: `<p>A "one open cart per customer" rule: <code>createIndex({ customerId: 1 }, { unique: true, partialFilterExpression: { status: "open" } })</code>. Closed carts are not indexed, so a customer can have many of them, but never two open ones.</p>`,
    internals: `<p>Unique indexes are checked on every insert and update; concurrent inserts of the same key are serialized on that key. Partial indexes contain only matching documents, so they are smaller and cheaper to maintain. TTL deletion is done by a background thread on the primary; the deletes replicate like any other delete. Hidden indexes are not considered by the planner but are still updated, so unhiding is instant.</p>
<div class="callout info"><b>Playground note</b>Geo indexes can be created here but geospatial operators are not simulated; text, wildcard, partial, sparse, unique, TTL, hashed and hidden indexes are.</div>`
  },
  examples: [
    { title: 'Unique and partial unique', code: `db.lab_carts.drop()
db.lab_carts.createIndex({ customerId: 1 }, { unique: true, partialFilterExpression: { status: "open" } })
db.lab_carts.insertMany([{ customerId: 1, status: "closed" }, { customerId: 1, status: "closed" }, { customerId: 1, status: "open" }])
db.lab_carts.countDocuments()` },
    { title: 'A second open cart is rejected', code: `db.lab_carts.insertOne({ customerId: 1, status: "open" })`, expectError: true },
    { title: 'Partial index must be implied by the query', code: `db.orders.createIndex({ createdAt: -1 }, { partialFilterExpression: { status: "pending" }, name: "pending_by_date" })
db.orders.find({ status: "pending" }).sort({ createdAt: -1 }).limit(5).explain().queryPlanner.winningPlan
db.orders.find({ status: "paid" }).sort({ createdAt: -1 }).limit(5).explain().queryPlanner.winningPlan`, note: 'Only the first query can use the partial index.' },
    { title: 'Text index', code: `db.reviews.createIndex({ title: "text", body: "text" }, { weights: { title: 3 } })
db.reviews.find({ $text: { $search: "battery -packaging" } }, { score: { $meta: "textScore" }, title: 1, _id: 0 }).sort({ score: { $meta: "textScore" } }).limit(3)` },
    { title: 'Hashed and hidden indexes', code: `db.events.createIndex({ sessionId: "hashed" })
db.events.find({ sessionId: db.events.findOne().sessionId }).explain().queryPlanner.winningPlan.inputStage.indexName
db.orders.createIndex({ status: 1 })
db.orders.hideIndex("status_1")
db.orders.getIndexes().filter(i => i.hidden)` }
  ],
  mistakes: [
    'A unique index on an optional field without a partial filter: the second document without the field fails with E11000 on null.',
    'Partial index created but queries do not include the partial condition, so it is never used.',
    'Expecting TTL deletion to be exact to the second.',
    'Using a text index as a full search engine (no typo tolerance, autocomplete, facets or analyzers per language field).',
    'Storing geo points as <code>[lat, lng]</code>; GeoJSON is <code>[longitude, latitude]</code>.'
  ],
  interview: [
    { q: 'Partial vs sparse index?', a: '<p>Sparse indexes skip documents that lack the indexed field. Partial indexes skip documents that do not match an arbitrary filter expression (existence, equality, ranges, <code>$type</code>), so they are a superset of sparse functionality and are preferred. Both may be ignored by the planner if using them would return incomplete results.</p>' },
    { q: 'How do you safely drop an index you think is unused?', a: '<p>Check <code>$indexStats</code> on every member (counters are per node and reset on restart), hide it with <code>hideIndex()</code>, watch latency and the slow query log for a full business cycle (including month-end jobs), then drop it. If something regresses, <code>unhideIndex()</code> is instant because the index was maintained while hidden.</p>' }
  ],
  quiz: [
    { q: 'What do you use to enforce one open cart per customer while allowing many closed carts?', options: ['A sparse unique index', 'A unique index with a partialFilterExpression', 'A TTL index', 'A hashed index'], answer: 1 },
    { q: 'What happens to a hidden index on writes?', options: ['It is not updated', 'It is still maintained', 'It is dropped', 'Writes fail'], answer: 1 },
    { q: 'How many text indexes can a collection have?', options: ['One', 'Two', 'One per field', 'Unlimited'], answer: 0 }
  ]
},
{
  id: 'slow-query-workflow', module: 'query-optimization', title: 'The slow query workflow: profiler, logs, explain, fix', minutes: 28,
  summary: 'A repeatable process for finding the queries that matter, diagnosing them, fixing them and proving the fix, as practised by DBAs on production systems.',
  objectives: ['Find slow operations with the profiler, logs and currentOp', 'Group by query shape and rank by total cost', 'Diagnose with explain and fix with indexes or query changes', 'Verify and protect against regressions (maxTimeMS, hidden indexes)'],
  sections: {
    concept: `<ol>
<li><b>Find</b>: slow query log lines (operations above <code>slowms</code>, default 100 ms), the database profiler (<code>system.profile</code>), <code>db.currentOp()</code> for what is running now, and monitoring tools (mongostat, FTDC charts).</li>
<li><b>Prioritise</b>: rank query shapes by <b>total time</b> (count x average), not by the single slowest execution. A 20 ms query run 50,000 times a minute matters more than a 5 s report run nightly.</li>
<li><b>Diagnose</b>: <code>planSummary</code> (COLLSCAN? which index?), <code>keysExamined</code> / <code>docsExamined</code> versus <code>nreturned</code>, <code>hasSortStage</code>, <code>planningTimeMicros</code>, lock and storage waits. Reproduce with <code>explain("executionStats")</code>.</li>
<li><b>Fix</b>: add or reorder an index (ESR), change the query (projection, avoid unanchored regex, avoid <code>$ne</code>), change the schema (computed/subset), or move the workload (secondary, analytics node).</li>
<li><b>Verify</b>: explain again, watch latency percentiles, check write impact of new indexes, add <code>maxTimeMS</code> to protect the system.</li>
</ol>`,
    why: `<p>Performance work without a process turns into guessing. This loop is what interviewers want to hear for "the application is slow, what do you do?", and it is what keeps production stable.</p>`,
    useCase: `<p>CPU on the primary jumps to 90% after a release. The slow log shows thousands of <code>find</code> on <code>orders</code> with <code>planSummary: COLLSCAN</code> and <code>docsExamined: 5000</code> for <code>nreturned: 3</code>, filtered on <code>payment.status</code> and sorted by <code>createdAt</code>. A new index <code>{ "payment.status": 1, createdAt: -1 }</code> built during low traffic brings CPU back to 15%.</p>`,
    internals: `<p>The profiler writes to a capped collection <code>system.profile</code> on each node (level 1: slow ops only, level 2: everything; level 2 is expensive). Slow operations are also logged as JSON lines with <code>attr.queryHash</code>/<code>planCacheKey</code>, so you can aggregate logs by shape. On Atlas (7.1+), <code>$queryStats</code> exposes aggregated query statistics per shape; it is not a self-managed feature, so on your own clusters you get the same view from the slow-query log grouped by <code>queryHash</code>, or from PMM Query Analytics.</p>`
  },
  examples: [
    { title: 'Turn on the profiler for slow operations', code: `db.setProfilingLevel(1, { slowms: 5 })
db.orders.find({ "payment.status": "awaiting" }).sort({ createdAt: -1 }).limit(10).toArray().length
db.orders.find({ "shipping.city": "Pune", total: { $gt: 1000 } }).toArray().length
db.system.profile.find({}, { op: 1, ns: 1, command: 1, planSummary: 1, keysExamined: 1, docsExamined: 1, nreturned: 1, millis: 1 }).sort({ ts: -1 }).limit(2)` },
    { title: 'Rank shapes by total time', code: `db.system.profile.aggregate([
  { $group: { _id: { ns: "$ns", plan: "$planSummary" }, count: { $sum: 1 }, totalMs: { $sum: "$millis" }, avgDocs: { $avg: "$docsExamined" } } },
  { $sort: { totalMs: -1 } }
])` },
    { title: 'Diagnose and fix', code: `db.orders.find({ "payment.status": "awaiting" }).sort({ createdAt: -1 }).limit(10).explain("executionStats")
db.orders.createIndex({ "payment.status": 1, createdAt: -1 })
db.orders.find({ "payment.status": "awaiting" }).sort({ createdAt: -1 }).limit(10).explain("executionStats")` },
    { title: 'Protect the server', code: `db.orders.find({ "shipping.city": "Pune" }).maxTimeMS(2000).limit(3).toArray().length
db.currentOp({ active: true, secs_running: { $gt: 5 } })
db.setProfilingLevel(0)` }
  ],
  mistakes: [
    'Leaving profiler level 2 on in production.',
    'Optimizing the slowest single query instead of the biggest total consumer.',
    'Adding an index for every slow query without checking existing indexes that could be extended (prefix reuse).',
    'Not testing index builds and their write overhead on a production-like dataset.',
    'Fixing a query on the primary while forgetting that secondaries serve reads with different plan caches and index usage counters.'
  ],
  interview: [
    { q: 'The application is slow. Walk me through how you investigate.', a: '<p>Confirm the symptom (latency percentiles, which endpoints). Check server health (CPU, disk latency, cache dirty/used %, tickets/queues, replication lag, connections). Find heavy operations: slow query log grouped by query shape, profiler, <code>currentOp</code>. Rank by total time. For the top shapes, read <code>planSummary</code> and examined/returned ratios, reproduce with explain, then fix with ESR indexes, query rewrites or schema changes. Verify after deploy and add <code>maxTimeMS</code> and alerts so it does not regress silently.</p>' },
    { q: 'What does a high docsExamined/nreturned ratio indicate?', a: '<p>The server reads many documents to return few: either no suitable index (COLLSCAN), an index on a weakly selective field followed by a FETCH filter, or a missing field in a compound index. Aim for a ratio close to 1.</p>' },
    { q: 'What is the plan cache and when can it hurt?', a: '<p>It caches the winning plan per query shape so planning is not repeated. It can hurt when data distribution differs by parameter value: a plan that was great for a rare value is reused for a common one. MongoDB replans when a cached plan performs much worse than expected; you can also clear it (<code>db.coll.getPlanCache().clear()</code>), use an index filter, or fix the index design so one plan is good for all values.</p>' }
  ],
  quiz: [
    { q: 'Default slowms threshold?', options: ['10 ms', '50 ms', '100 ms', '1 s'], answer: 2 },
    { q: 'Which query deserves attention first?', options: ['A 4 s nightly report', 'A 15 ms query executed 40,000 times per minute with COLLSCAN', 'A 1 ms query executed once', 'Any query on a secondary'], answer: 1 },
    { q: 'Which profiler level records every operation?', options: ['0', '1', '2', '3'], answer: 2 }
  ]
},
{
  id: 'transactions-acid', module: 'transactions', title: 'Multi-document transactions', minutes: 28,
  summary: 'ACID across documents and collections: sessions, the callback API, retries, write conflicts, limits and when not to use transactions.',
  objectives: ['Use sessions and withTransaction', 'Understand snapshot isolation and write conflicts', 'Handle TransientTransactionError and UnknownTransactionCommitResult', 'Know the limits: 60 s default lifetime, oplog size, performance cost'],
  sections: {
    concept: `<p>A single-document write is always atomic. Multi-document transactions (replica sets since 4.0, sharded clusters since 4.2) give all-or-nothing semantics with <b>snapshot isolation</b> across documents, collections and databases.</p>
<pre class="static">const session = db.getMongo().startSession()
session.withTransaction(() =&gt; {
  const s = session.getDatabase("shop")
  s.products.updateOne({ _id: "P001", stock: { $gte: 1 } }, { $inc: { stock: -1 } })
  s.orders.insertOne({ ... })
}, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } })</pre>
<p><code>withTransaction</code> (the callback API) retries the whole callback on <b>TransientTransactionError</b> (e.g. WriteConflict) and retries the commit on <b>UnknownTransactionCommitResult</b>. With the core API (<code>startTransaction</code>/<code>commitTransaction</code>) you must write those retry loops yourself.</p>
<p>Two transactions modifying the same document conflict: the second writer gets a <b>WriteConflict</b> immediately and must retry. A non-transactional write to a document locked by an open transaction waits for it to finish (up to <code>maxTransactionLockRequestTimeoutMillis</code>).</p>`,
    why: `<p>Transactions make some invariants simple (transfer money between two accounts, decrement stock and create an order). But they cost latency, hold resources and abort under contention, so a good schema uses them for the few flows that truly span documents.</p>`,
    useCase: `<p>Checkout: decrement stock for each product, insert the order, and record the payment intent. If any step fails (stock went to zero), the whole transaction aborts and nothing is half-written.</p>`,
    internals: `<p>A transaction runs on a WiredTiger snapshot; its writes are private until commit. On commit, all operations are written to the oplog as one <code>applyOps</code> entry (or a chain of entries for large transactions since 4.2). The default <code>transactionLifetimeLimitSeconds</code> is 60: longer transactions are aborted, because an open snapshot pins old versions in the cache and creates cache pressure. In sharded clusters, a transaction touching several shards uses two-phase commit coordinated by one shard.</p>
<div class="callout warn"><b>Rules of thumb</b>Keep transactions short (milliseconds, not seconds), touch few documents (under 1,000 as a guideline), never wait for user input inside one, and avoid creating collections or indexes inside them.</div>`
  },
  examples: [
    { title: 'Checkout in a transaction', code: `const session = db.getMongo().startSession()
const s = session.getDatabase("shop")
session.withTransaction(() => {
  const r = s.products.updateOne({ _id: "P005", stock: { $gte: 2 } }, { $inc: { stock: -2 } })
  if (r.modifiedCount !== 1) throw new Error("out of stock")
  s.orders.insertOne({ orderNo: "ORD-TXN-1", customerId: 1, status: "paid", createdAt: new Date(), items: [{ productId: "P005", qty: 2, price: 100 }], total: 200 })
})
db.orders.findOne({ orderNo: "ORD-TXN-1" }, { status: 1, total: 1 })
session.endSession()` },
    { title: 'Isolation: uncommitted writes are invisible', code: `const s1 = db.getMongo().startSession()
s1.startTransaction()
s1.getDatabase("shop").customers.updateOne({ _id: 3 }, { $set: { tier: "platinum" } })
print("inside txn :", s1.getDatabase("shop").customers.findOne({ _id: 3 }).tier)
print("outside txn:", db.customers.findOne({ _id: 3 }).tier)
s1.abortTransaction()
print("after abort:", db.customers.findOne({ _id: 3 }).tier)` },
    { title: 'Write conflict between two transactions', code: `const a = db.getMongo().startSession(), b = db.getMongo().startSession()
a.startTransaction(); b.startTransaction()
a.getDatabase("shop").products.updateOne({ _id: "P007" }, { $inc: { stock: -1 } })
try { b.getDatabase("shop").products.updateOne({ _id: "P007" }, { $inc: { stock: -1 } }) }
catch (e) { print(e.codeName, JSON.stringify(e.errorLabels)) }
a.commitTransaction()
try { b.abortTransaction() } catch (e) {}` }
  ],
  mistakes: [
    'Using transactions to compensate for a relational-style schema; embedding often removes the need.',
    'Long-running transactions (batch jobs updating 100,000 documents in one transaction).',
    'Not retrying on TransientTransactionError with the core API.',
    'Doing network calls or user interaction inside a transaction.',
    'Expecting transactions on a standalone mongod; they need a replica set (even a single-node one).'
  ],
  interview: [
    { q: 'When should you use multi-document transactions?', a: '<p>When an invariant spans multiple documents and cannot be modelled into one document: transfers between accounts, inventory plus order creation, maintaining a separate uniqueness or ledger collection. Prefer single-document atomic updates when the schema allows, because transactions add latency, contention and abort/retry handling.</p>' },
    { q: 'What happens when two transactions update the same document?', a: '<p>The first to write holds the document; the second receives a WriteConflict error labelled TransientTransactionError immediately and its transaction is aborted. The driver callback API retries the whole transaction. Conflicts are detected at write time, not at commit (first-writer-wins).</p>' },
    { q: 'What limits apply to transactions?', a: '<p>Default 60 s lifetime (<code>transactionLifetimeLimitSeconds</code>), the 16 MB limit per oplog entry is avoided since 4.2 by splitting into multiple entries, but large transactions still increase cache pressure and replication lag. Lock acquisition timeout defaults to 5 ms (<code>maxTransactionLockRequestTimeoutMillis</code>). Some operations are not allowed (e.g. writes to capped collections, operations on <code>config</code>/<code>admin</code>/<code>local</code>).</p>' }
  ],
  quiz: [
    { q: 'Which error label means the whole transaction can be safely retried?', options: ['UnknownTransactionCommitResult', 'TransientTransactionError', 'RetryableWriteError', 'NoSuchTransaction'], answer: 1 },
    { q: 'Default maximum transaction lifetime?', options: ['5 seconds', '60 seconds', '10 minutes', 'Unlimited'], answer: 1 },
    { q: 'Can a standalone mongod run multi-document transactions?', options: ['Yes', 'No, a replica set is required', 'Only with WiredTiger in-memory', 'Only on sharded clusters'], answer: 1 }
  ]
},
{
  id: 'read-write-concerns', module: 'concerns', title: 'Write concern, read concern and read preference', minutes: 28,
  summary: 'Tune durability, consistency and routing per operation: w and j, local/majority/snapshot/linearizable reads, primary/secondary routing and causal consistency.',
  objectives: ['Choose write concern: w: 1, w: "majority", j: true, wtimeout', 'Choose read concern: local, available, majority, snapshot, linearizable', 'Route reads with read preference and maxStalenessSeconds', 'Explain rollback risk and causal consistency'],
  sections: {
    concept: `<div data-diagram="replica-set"></div>
<p><b>Write concern</b> is how many members must acknowledge a write before the client is told it succeeded. <code>w: 1</code>: primary only. <code>w: "majority"</code> (default since 5.0): a majority of voting members, which means the write survives any failover. <code>j: true</code>: written to the on-disk journal. <code>wtimeout</code>: stop waiting (the write is not undone).</p>
<p><b>Read concern</b> is which data a read may return:</p>
<ul><li><code>local</code> (default): the latest data on that node, which might later be rolled back.</li>
<li><code>available</code>: like local; on sharded clusters may return orphans. Fastest.</li>
<li><code>majority</code>: only data acknowledged by a majority; never rolled back.</li>
<li><code>snapshot</code>: a consistent point-in-time view (transactions, and reads with <code>atClusterTime</code>).</li>
<li><code>linearizable</code>: reflects all majority writes completed before the read started; primary only, slow.</li></ul>
<p><b>Read preference</b> is where reads go: <code>primary</code> (default), <code>primaryPreferred</code>, <code>secondary</code>, <code>secondaryPreferred</code>, <code>nearest</code>, optionally with tag sets and <code>maxStalenessSeconds</code> (90 or more).</p>`,
    why: `<p>These settings are the dial between latency and safety. With <code>w: 1</code>, a write acknowledged by a primary that crashes before replicating it is rolled back after failover, and the client thinks it succeeded. With secondary reads, a user may not see the profile change they just saved. Knowing these trade-offs is essential for architects and a common interview topic.</p>`,
    useCase: `<p>Payments use <code>w: "majority"</code> and read their own writes from the primary. The analytics dashboard reads from a secondary tagged <code>{ workload: "analytics" }</code> with <code>secondaryPreferred</code>, accepting a few seconds of lag. A "user just updated settings" flow uses causally consistent sessions so a subsequent secondary read waits until it has caught up to that write.</p>`,
    internals: `<p>The primary tracks each secondary's replicated optime. A majority write waits until the <b>majority commit point</b> passes its optime. Majority reads serve data from the majority-committed snapshot, which WiredTiger keeps available; if secondaries lag, that snapshot stays old and pins history in the cache (cache pressure on the primary). Causal consistency works by carrying <code>operationTime</code>/<code>clusterTime</code> from one operation into the next (<code>afterClusterTime</code>), so a secondary waits until it has applied up to that point.</p>
<p>Try it in the <a href="#/architecture">Replica set simulator</a>: write with w:1, kill the primary before replication, and watch the write get rolled back.</p>`
  },
  examples: [
    { title: 'Write concern per operation', code: `db.orders.insertOne({ orderNo: "ORD-WC-1", status: "paid", createdAt: new Date(), total: 10 }, { writeConcern: { w: "majority", j: true, wtimeout: 5000 } })
db.orders.updateOne({ orderNo: "ORD-WC-1" }, { $set: { status: "shipped" } }, { writeConcern: { w: 1 } })` },
    { title: 'Read preference and read concern', code: `db.orders.find({ status: "shipped" }).readPref("secondaryPreferred").readConcern("majority").limit(2)
db.adminCommand({ getDefaultRWConcern: 1 })`, note: 'This simulator is a single node, so the routing options are accepted but every read comes from the same node. The Architecture page simulates the replica set.' },
    { title: 'Connection string options', code: `mongodb://db1,db2,db3/shop?replicaSet=rs0&w=majority&readPreference=secondaryPreferred&maxStalenessSeconds=120&readPreferenceTags=dc:east`, runnable: false }
  ],
  mistakes: [
    'Using <code>w: 0</code> or <code>w: 1</code> for business-critical data.',
    'Reading from secondaries to "scale reads" without accepting staleness; it also moves load rather than removing it.',
    'Treating <code>wtimeout</code> as a rollback; the write may still complete later.',
    'Arbiters in PSA topologies: with one data-bearing member down, majority writes cannot be acknowledged and the majority commit point stalls, increasing cache pressure.'
  ],
  interview: [
    { q: 'What happens to a w:1 write if the primary crashes right after acknowledging it?', a: '<p>If the write had not reached a secondary that becomes primary, the new primary does not have it. When the old primary rejoins it rolls back the write (saved to a rollback directory). The client got success, but the data is gone from the replica set. <code>w: "majority"</code> prevents this because a majority-acknowledged write is guaranteed to be on whichever member wins the election.</p>' },
    { q: 'Explain read concern majority vs linearizable.', a: '<p><code>majority</code> returns data acknowledged by a majority as of the node\'s majority-committed snapshot; it may not include the very latest majority writes (it can be slightly stale) but is never rolled back. <code>linearizable</code> additionally guarantees the read reflects all writes acknowledged before the read began, by confirming the node is still primary with a majority write; it works only on the primary for single-document reads and is slower.</p>' },
    { q: 'How do you get read-your-own-writes on secondaries?', a: '<p>Use a causally consistent session with <code>w: "majority"</code> writes and <code>readConcern: "majority"</code> reads. The driver passes the operation time of the write as <code>afterClusterTime</code> to the secondary read, which waits until the secondary has replicated that far.</p>' }
  ],
  quiz: [
    { q: 'Default write concern since MongoDB 5.0 (most topologies)?', options: ['w: 0', 'w: 1', 'w: "majority"', 'w: "all"'], answer: 2 },
    { q: 'Which read concern can return data that is later rolled back?', options: ['majority', 'linearizable', 'local', 'snapshot'], answer: 2 },
    { q: 'Minimum value of maxStalenessSeconds?', options: ['1', '10', '90', '600'], answer: 2 }
  ]
},
{
  id: 'change-streams-cdc', module: 'change-streams', title: 'Change streams and resume tokens', minutes: 22,
  summary: 'Subscribe to inserts, updates, replaces and deletes in real time, filter them with a pipeline, and resume reliably after failures.',
  objectives: ['Open change streams on a collection, database or deployment', 'Filter events with $match and choose fullDocument options', 'Resume with resume tokens and understand the oplog window', 'Use pre- and post-images (6.0+)'],
  sections: {
    concept: `<div data-diagram="change-stream"></div>
<p><code>db.orders.watch(pipeline, options)</code> returns a cursor of change events: <code>{ _id: &lt;resume token&gt;, operationType, ns, documentKey, fullDocument?, updateDescription?, clusterTime }</code>.</p>
<ul><li>Filter with a pipeline: <code>[{ $match: { operationType: "update", "updateDescription.updatedFields.status": { $exists: true } } }]</code>.</li>
<li><code>fullDocument: "updateLookup"</code> fetches the current document for updates (it may be newer than the change). <code>fullDocument: "whenAvailable"</code>/<code>"required"</code> use stored post-images (6.0+, when <code>changeStreamPreAndPostImages</code> is enabled on the collection), and <code>fullDocumentBeforeChange</code> gives the pre-image.</li>
<li><b>Resume</b>: store the <code>_id</code> of the last processed event and reopen with <code>resumeAfter</code> or <code>startAfter</code> (the latter also works after an invalidate). <code>startAtOperationTime</code> starts from a cluster time.</li></ul>`,
    why: `<p>Change streams replace polling and fragile oplog tailing for event-driven architectures: cache invalidation, search index sync, notifications, audit trails, CDC into Kafka or a warehouse. They work across failovers and in sharded clusters with a global order.</p>`,
    useCase: `<p>When an order becomes <code>shipped</code>, a notification service sends an email. It watches updates where <code>updatedFields.status</code> is "shipped", processes each event, and stores the resume token in its own collection after each success. After a deploy or crash it resumes exactly where it stopped, as long as the oplog still covers that point.</p>`,
    internals: `<p>Change streams are an aggregation over the oplog, run with majority read concern so events are never rolled back. On sharded clusters, mongos merges per-shard streams in cluster-time order. A resume token encodes the cluster time and document key; if the oplog has rolled past it (the consumer was down longer than the oplog window), resuming fails with <code>ChangeStreamHistoryLost</code> and you need a full resync. Size the oplog for your longest expected consumer outage.</p>`
  },
  examples: [
    { title: 'Watch updates to status', code: `db.orders.updateOne({ orderNo: "ORD-100002" }, { $set: { status: "paid" } })
const cs = db.orders.watch([{ $match: { operationType: "update", "updateDescription.updatedFields.status": { $exists: true } } }], { fullDocument: "updateLookup" })
db.orders.updateOne({ orderNo: "ORD-100002" }, { $set: { status: "shipped" } })
db.orders.updateOne({ orderNo: "ORD-100002" }, { $inc: { total: 0.5 } })
const ev = cs.tryNext()
ev.operationType
ev.updateDescription
ev.fullDocument.orderNo
cs.tryNext()`, note: 'The second update does not touch status, so it is filtered out and tryNext() returns null.' },
    { title: 'Resume after a restart', code: `const s1 = db.orders.watch()
db.orders.insertOne({ orderNo: "ORD-CS-1", status: "pending", createdAt: new Date(), total: 5 })
const first = s1.tryNext()
const token = first._id
s1.close()
db.orders.insertOne({ orderNo: "ORD-CS-2", status: "pending", createdAt: new Date(), total: 6 })
const s2 = db.orders.watch([], { resumeAfter: token })
s2.tryNext().fullDocument.orderNo` },
    { title: 'Database-wide stream', code: `const all = db.watch([{ $match: { operationType: { $in: ["insert", "delete"] } } }])
db.reviews.insertOne({ productId: "P001", customerId: 1, rating: 5, title: "Great", createdAt: new Date() })
const e = all.tryNext()
e.ns` }
  ],
  mistakes: [
    'Not persisting resume tokens, so a restart either misses or reprocesses events.',
    'Consumers down longer than the oplog window: <code>ChangeStreamHistoryLost</code>.',
    'Assuming <code>updateLookup</code> returns the document as it was right after that change; it returns the current version.',
    'Heavy processing inside the change stream loop instead of handing work to a queue.',
    'Opening one change stream per user or per entity; each is a server-side cursor scanning the oplog. Open few streams and fan out in the application.'
  ],
  interview: [
    { q: 'How do change streams guarantee you do not process rolled-back data?', a: '<p>They only return majority-committed changes, which cannot be rolled back. That is why they need a replica set (or sharded cluster) and why heavy replication lag delays events.</p>' },
    { q: 'How would you build reliable CDC from MongoDB to Kafka?', a: '<p>Use the MongoDB Kafka source connector or a custom consumer on change streams with a pipeline filter; persist the resume token transactionally with your progress (or in Kafka offsets); make consumers idempotent keyed by <code>documentKey</code> and cluster time; size the oplog for the maximum consumer outage; monitor lag between <code>clusterTime</code> and now; plan a re-snapshot procedure for <code>ChangeStreamHistoryLost</code>.</p>' }
  ],
  quiz: [
    { q: 'What do you store to continue a change stream after a restart?', options: ['The oplog timestamp of the server', 'The resume token (_id of the last event)', 'The last document _id', 'Nothing; streams persist'], answer: 1 },
    { q: 'What limits how long a consumer can be down and still resume?', options: ['The WiredTiger cache size', 'The oplog window', 'The number of indexes', 'maxTimeMS'], answer: 1 }
  ]
},
{
  id: 'json-schema-validation', module: 'schema-validation', title: 'Schema validation with $jsonSchema', minutes: 20,
  summary: 'Enforce required fields, types, ranges and enumerations on the server, and roll validation out safely with validationLevel and validationAction.',
  objectives: ['Write a $jsonSchema validator', 'Add validation to an existing collection with collMod', 'Choose validationLevel (strict, moderate) and validationAction (error, warn)', 'Read validation error details'],
  sections: {
    concept: `<pre class="static">db.createCollection("payments", { validator: { $jsonSchema: {
  bsonType: "object",
  required: ["orderId", "amount", "currency", "status"],
  properties: {
    amount:   { bsonType: ["double", "decimal", "int"], minimum: 0 },
    currency: { enum: ["INR", "USD", "EUR"] },
    status:   { enum: ["created", "captured", "refunded"] },
    card:     { bsonType: "object", properties: { last4: { bsonType: "string", pattern: "^[0-9]{4}$" } } }
  },
  additionalProperties: true
} }, validationLevel: "strict", validationAction: "error" })</pre>
<ul><li><code>validationLevel: "strict"</code> (default) validates all inserts and updates; <code>"moderate"</code> skips updates to documents that were already invalid, which helps when introducing rules on existing data.</li>
<li><code>validationAction: "error"</code> rejects with code 121 (<code>DocumentValidationFailure</code>) and explains which rule failed; <code>"warn"</code> accepts the write and logs a warning.</li>
<li>Validators can also use query operators: <code>{ $or: [{ phone: { $type: "string" } }, { email: { $regex: /@/ } }] }</code>.</li></ul>`,
    why: `<p>Flexible schemas still need guarantees: a payment without an amount is a bug, not flexibility. Server-side validation catches errors from every client, script and service, not just the one with good application-level checks.</p>`,
    useCase: `<p>A team adds validation to a 5-year-old collection. Step 1: <code>validationAction: "warn"</code> and watch logs for a week. Step 2: fix the producers and clean the data. Step 3: switch to <code>"error"</code> with <code>validationLevel: "moderate"</code>, and later <code>"strict"</code>.</p>`,
    internals: `<p>The validator is stored in collection options and evaluated on the primary during each write. It does not apply to existing documents until they are updated. <code>bypassDocumentValidation</code> lets privileged users skip validation for migrations. Validation is cheap compared with the write itself, but very large schemas with many patterns add CPU per write.</p>`
  },
  examples: [
    { title: 'Create a validated collection', code: `db.lab_payments.drop()
db.createCollection("lab_payments", { validator: { $jsonSchema: {
  bsonType: "object",
  required: ["orderNo", "amount", "currency", "status"],
  properties: {
    amount: { bsonType: ["double", "int", "decimal"], minimum: 0 },
    currency: { enum: ["INR", "USD", "EUR"] },
    status: { enum: ["created", "captured", "refunded"] }
  } } } })
db.lab_payments.insertOne({ orderNo: "ORD-1", amount: 99.5, currency: "INR", status: "created" })` },
    { title: 'A rejected write and its explanation', code: `db.lab_payments.insertOne({ orderNo: "ORD-2", amount: -5, currency: "GBP" })`, expectError: true },
    { title: 'Roll out on existing data with warn and moderate', code: `db.runCommand({ collMod: "customers", validator: { $jsonSchema: { required: ["email", "tier"], properties: { tier: { enum: ["bronze", "silver", "gold", "platinum"] } } } }, validationLevel: "moderate", validationAction: "warn" })
db.customers.deleteOne({ _id: 9001 })
db.customers.insertOne({ _id: 9001, name: "No email" })
db.getCollectionInfos({ name: "customers" })[0].options` }
  ],
  mistakes: [
    'Turning on strict/error validation on a collection with existing invalid documents and breaking every update to them.',
    'Over-specifying (<code>additionalProperties: false</code> everywhere) and blocking legitimate schema evolution.',
    'Forgetting that numbers from JavaScript are doubles: <code>bsonType: "int"</code> rejects <code>5</code> sent as a double by some drivers.',
    'Relying only on validation for business rules that span documents (it validates one document at a time).'
  ],
  interview: [
    { q: 'How do you introduce schema validation on a large existing collection?', a: '<p>Write the validator, run it as a query to count non-conforming documents (<code>find({ $nor: [validator] })</code>), set <code>validationAction: "warn"</code> to observe, fix producers and backfill data in batches, then switch to <code>error</code> with <code>validationLevel: "moderate"</code>, and finally <code>strict</code> once all documents conform.</p>' }
  ],
  quiz: [
    { q: 'What error code means a document failed validation?', options: ['11000', '121', '50', '251'], answer: 1 },
    { q: 'Which level skips validation for updates to already-invalid documents?', options: ['strict', 'moderate', 'off', 'warn'], answer: 1 }
  ]
},
{
  id: 'time-series-special', module: 'time-series', title: 'Time series, capped collections, TTL and views', minutes: 22,
  summary: 'Purpose-built collection types: time series for measurements, capped for fixed-size logs, TTL for expiry, views for reusable read-only pipelines.',
  objectives: ['Create time series collections with timeField, metaField and granularity', 'Know when to use capped collections and TTL', 'Create and query views', 'Understand the limits of each type'],
  sections: {
    concept: `<ul>
<li><b>Time series</b> (5.0+): <code>db.createCollection("metrics", { timeseries: { timeField: "ts", metaField: "meta", granularity: "minutes" }, expireAfterSeconds: 2592000 })</code>. The server buckets measurements by <code>meta</code> and time internally, compresses them by column, and creates a clustered index on time. You insert and query individual measurements as usual.</li>
<li><b>Capped</b>: fixed size in bytes (and optionally documents), insertion order preserved, oldest documents overwritten. Good for logs and tailable cursors, but cannot be sharded, and deletes are not allowed.</li>
<li><b>TTL</b>: an index option that deletes documents after a date field plus N seconds.</li>
<li><b>Views</b>: <code>db.createView("v", "source", pipeline)</code>; read-only, computed on each query, inherit source indexes for the leading <code>$match</code>. Use them to hide fields or present a reshaped model.</li>
</ul>`,
    why: `<p>Metrics, IoT and event data are the fastest growing data in most companies. Storing them as one document per measurement in a regular collection wastes space and index RAM; time series collections typically reduce storage by an order of magnitude and speed up range queries over time.</p>`,
    useCase: `<p>Application latency samples per service per minute go into a time series collection with <code>metaField: "service"</code> and a 30-day expiry. Dashboards query the last hour per service; a nightly <code>$merge</code> rolls up daily percentiles into a regular collection kept for a year.</p>`,
    internals: `<p>Internally a time series collection is a view over a <code>system.buckets.&lt;name&gt;</code> collection. Each bucket holds measurements for one meta value within a time span determined by granularity (or <code>bucketMaxSpanSeconds</code>), with min/max per field so queries can skip buckets. Choose the metaField to be the identifier you filter by (device id, service); high-cardinality metadata creates many small buckets and loses the benefit.</p>`
  },
  examples: [
    { title: 'Create and query a time series collection', code: `db.lab_metrics.drop()
db.createCollection("lab_metrics", { timeseries: { timeField: "ts", metaField: "meta", granularity: "minutes" }, expireAfterSeconds: 2592000 })
db.events.aggregate([
  { $match: { type: { $in: ["checkout", "search"] } } },
  { $project: { _id: 0, ts: 1, meta: { service: "$type", device: "$device" }, latencyMs: 1 } },
  { $merge: { into: "lab_metrics" } }
])
db.lab_metrics.aggregate([
  { $match: { "meta.service": "checkout" } },
  { $group: { _id: { device: "$meta.device", day: { $dateTrunc: { date: "$ts", unit: "day" } } }, avg: { $avg: "$latencyMs" }, max: { $max: "$latencyMs" }, n: { $sum: 1 } } },
  { $sort: { "_id.day": -1, "_id.device": 1 } },
  { $limit: 4 }
])
db.getCollectionInfos({ name: "lab_metrics" })[0].type` },
    { title: 'A view that hides personal data', code: `db.lab_customers_public.drop()
db.createView("lab_customers_public", "customers", [{ $project: { name: 1, tier: 1, "address.city": 1 } }])
db.lab_customers_public.find({ tier: "platinum" }).limit(3)` },
    { title: 'Views are read-only', code: `db.lab_customers_public.insertOne({ name: "x" })`, expectError: true }
  ],
  mistakes: [
    'Using a unique id per measurement (request id) as the metaField: every bucket holds one measurement.',
    'Updating individual measurements frequently; time series collections are optimized for append, with limited update and delete support.',
    'Using capped collections for data you might need to delete selectively or shard.',
    'Treating views as materialized; they rerun the pipeline every time.'
  ],
  interview: [
    { q: 'When would you choose a time series collection over the bucket pattern?', a: '<p>Time series collections (5.0+) apply bucketing, columnar compression and a clustered time index automatically while you keep a simple one-document-per-measurement API. Choose manual bucketing when you need features they lack (rich updates, custom bucket summaries, older server versions, unique constraints) or when the bucketing logic is domain-specific.</p>' }
  ],
  quiz: [
    { q: 'Which field should usually be the metaField?', options: ['A unique request id', 'The source identifier you filter by, such as device or service', 'The measured value', 'The timestamp'], answer: 1 },
    { q: 'Are views materialized?', options: ['Yes', 'No, the pipeline runs on each read', 'Only on secondaries', 'Only with an index'], answer: 1 }
  ]
}
]);
