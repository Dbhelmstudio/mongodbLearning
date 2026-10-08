/* Extended lessons: window functions, wildcard and geo indexes, views and collation, encryption, and the Percona toolchain. */
MM.addLessons([
{
  id: 'window-functions', module: 'aggregation-advanced', title: 'Window functions with $setWindowFields', minutes: 25,
  summary: 'Running totals, moving averages, rankings and period-over-period deltas computed over ordered partitions, without collapsing documents the way $group does.',
  objectives: ['Explain how $setWindowFields differs from $group', 'Write partitionBy, sortBy and window bounds correctly', 'Compute running totals, moving averages, ranks and previous-row deltas', 'Know the memory and index implications'],
  sections: {
    concept: `<p><code>$setWindowFields</code> (5.0+) adds computed fields to every document based on a <b>window</b> of related documents. <code>$group</code> collapses many documents into one; window functions keep every document and decorate it.</p>
<ul><li><b>partitionBy</b>: the expression that splits documents into independent groups (per customer, per device). Omit it for one global partition.</li>
<li><b>sortBy</b>: the order inside each partition. Required for ranking, <code>$shift</code> and position-based windows.</li>
<li><b>output</b>: one field per window computation, each with an operator and an optional <code>window</code>.</li>
<li><b>window.documents</b>: position bounds such as <code>["unbounded", "current"]</code> (running total) or <code>[-2, 0]</code> (current row and two before). <b>window.range</b> bounds by the sortBy value instead, with <code>unit</code> for dates (for example the last 7 days).</li></ul>
<table><tr><th>Need</th><th>Operator</th></tr>
<tr><td>Running total / moving average</td><td><code>$sum</code>, <code>$avg</code> with a documents or range window</td></tr>
<tr><td>Ranking</td><td><code>$rank</code>, <code>$denseRank</code>, <code>$documentNumber</code></td></tr>
<tr><td>Previous or next row</td><td><code>$shift</code> with <code>by: -1</code> or <code>by: 1</code></td></tr>
<tr><td>Rates of change</td><td><code>$derivative</code>, <code>$integral</code> with a time unit</td></tr>
<tr><td>Gaps in series</td><td><code>$densify</code> (5.1) and <code>$fill</code> (5.3) stages, <code>$locf</code>, <code>$linearFill</code></td></tr></table>`,
    why: `<p>Reports such as "month-over-month revenue growth", "each customer's order sequence number" or "7-day moving average latency" used to need application code or self-joins. Window functions keep them in one pipeline, close to the data, and they are a frequent interview topic for analytics-heavy roles.</p>`,
    useCase: `<p>A finance dashboard shows monthly revenue, the 3-month moving average and the change versus the previous month. One pipeline groups orders by month, then <code>$setWindowFields</code> sorted by month adds <code>ma3</code> with a <code>[-2, 0]</code> window and <code>prev</code> with <code>$shift</code>; a final <code>$set</code> computes the delta.</p>`,
    internals: `<p>Each partition is sorted and processed in order; documents-based windows keep only the rows in the window, but unbounded windows and large partitions hold state in memory and spill to disk when needed. Put a <code>$match</code> first, and if the pipeline sorts by an indexed field within a filtered set, an index on <code>{ partitionField: 1, sortField: 1 }</code> lets the sort be served by the index.</p>`
  },
  examples: [
    { title: 'Running total per customer', code: `db.orders.aggregate([
  { $match: { customerId: { $in: [1, 2] } } },
  { $setWindowFields: {
      partitionBy: "$customerId",
      sortBy: { createdAt: 1 },
      output: {
        orderNo: { $documentNumber: {} },
        runningSpend: { $sum: "$total", window: { documents: ["unbounded", "current"] } }
      }
  } },
  { $project: { _id: 0, customerId: 1, createdAt: 1, total: 1, orderNo: 1, runningSpend: { $round: ["$runningSpend", 2] } } },
  { $limit: 6 }
])` },
    { title: 'Monthly revenue with a 3-month moving average and month-over-month change', code: `db.orders.aggregate([
  { $match: { status: { $in: ["paid", "shipped", "delivered"] } } },
  { $group: { _id: { $dateTrunc: { date: "$createdAt", unit: "month" } }, revenue: { $sum: "$total" } } },
  { $setWindowFields: {
      sortBy: { _id: 1 },
      output: {
        ma3: { $avg: "$revenue", window: { documents: [-2, 0] } },
        prev: { $shift: { output: "$revenue", by: -1, default: null } }
      }
  } },
  { $project: { month: { $dateToString: { date: "$_id", format: "%Y-%m" } }, _id: 0,
      revenue: { $round: ["$revenue", 0] }, ma3: { $round: ["$ma3", 0] },
      change: { $cond: [{ $eq: ["$prev", null] }, null, { $round: [{ $subtract: ["$revenue", "$prev"] }, 0] }] } } },
  { $sort: { month: -1 } },
  { $limit: 6 }
])` },
    { title: 'Rank customers by spend within each country', code: `db.orders.aggregate([
  { $match: { status: "delivered" } },
  { $group: { _id: { customerId: "$customerId", country: "$shipping.country" }, spend: { $sum: "$total" } } },
  { $setWindowFields: {
      partitionBy: "$_id.country",
      sortBy: { spend: -1 },
      output: { rank: { $rank: {} } }
  } },
  { $match: { rank: { $lte: 2 } } },
  { $project: { _id: 0, country: "$_id.country", customerId: "$_id.customerId", spend: { $round: ["$spend", 2] }, rank: 1 } },
  { $sort: { country: 1, rank: 1 } }
])`, note: '$rank leaves gaps after ties (1, 1, 3); $denseRank does not (1, 1, 2); $documentNumber never ties.' }
  ],
  mistakes: [
    'Forgetting sortBy, which makes ranks and position windows meaningless or an error.',
    'Using $group when every original document is still needed, then joining back.',
    'Unbounded windows over huge partitions without a $match first.',
    'Confusing documents windows (row positions) with range windows (value distance).'
  ],
  interview: [
    { q: 'How is $setWindowFields different from $group?', a: '<p><code>$group</code> collapses each group into one output document. <code>$setWindowFields</code> keeps every input document and adds fields computed over a window of its partition (running totals, moving averages, ranks, previous-row values). Use it when you need per-row context, not just per-group totals.</p>' }
  ],
  quiz: [
    { q: 'Which window gives a running total from the first row to the current row?', options: ['documents: [-1, 1]', 'documents: ["unbounded", "current"]', 'range: [0, 0]', 'documents: ["current", "unbounded"]'], answer: 1 },
    { q: 'Ties at the top: two customers share first place. What rank does the next customer get with $rank?', options: ['2', '3', '1', 'null'], answer: 1, explain: '$rank leaves a gap after ties; $denseRank would give 2.' }
  ]
},
{
  id: 'wildcard-indexes', module: 'index-types', title: 'Wildcard indexes for unpredictable fields', minutes: 18,
  summary: 'Index every field under a path (or the whole document) when the queried fields are not known in advance, and understand the trade-offs versus the attribute pattern.',
  objectives: ['Create single and compound wildcard indexes', 'Read wildcard index plans ($_path)', 'Know what wildcard indexes cannot do', 'Choose between wildcard indexes and the attribute pattern'],
  sections: {
    concept: `<p>A wildcard index (4.2+) indexes every field under a path: <code>{ "attrs.$**": 1 }</code> covers <code>attrs.color</code>, <code>attrs.size</code>, <code>attrs.voltage</code> and any field added later. <code>{ "$**": 1 }</code> with a <code>wildcardProjection</code> includes or excludes chosen paths across the whole document.</p>
<p>Each index entry stores the field path and the value, so a query on <code>attrs.color</code> scans only the keys for that path. Since 7.0, <b>compound wildcard indexes</b> such as <code>{ tenantId: 1, "attrs.$**": 1 }</code> combine a normal prefix with wildcard fields.</p>
<p><b>Limitations</b>: no unique or TTL wildcard indexes; they cannot be shard keys; they do not support <code>$exists: false</code> or exact matches on whole arrays or embedded documents; and a single wildcard index serves one wildcard field predicate per query plan.</p>`,
    why: `<p>Product catalogs, form builders and multi-tenant SaaS settings let users define fields. Creating an index per possible field is impossible, and unindexed queries become collection scans as the data grows.</p>`,
    useCase: `<p>A marketplace stores category-specific specs in <code>attrs</code>: electronics have <code>voltage</code>, apparel has <code>size</code> and <code>fabric</code>. Search filters on any one of them. A <code>{ "attrs.$**": 1 }</code> index serves all filters; the team still adds a dedicated compound index for the single hottest query, which also needs a sort.</p>`,
    internals: `<p>Keys are stored as <code>($_path, value)</code> pairs, which is why explain shows <code>keyPattern: { $_path: 1, "attrs.color": 1 }</code>. Indexing everything inflates index size and write cost, so restrict the path. The <b>attribute pattern</b> (<code>attrs: [{ k, v }]</code> with <code>{ "attrs.k": 1, "attrs.v": 1 }</code>) is the older alternative: one compound multikey index, works everywhere, and can be combined with other fields in a normal compound index.</p>`
  },
  examples: [
    { title: 'Catalog with user-defined attributes', code: `db.lab_items.drop()
db.lab_items.insertMany([
  { sku: "TV-1", category: "electronics", attrs: { screen: 55, voltage: 220, color: "black" } },
  { sku: "TV-2", category: "electronics", attrs: { screen: 65, voltage: 110, color: "silver" } },
  { sku: "TS-1", category: "apparel", attrs: { size: "M", fabric: "cotton", color: "black" } },
  { sku: "TS-2", category: "apparel", attrs: { size: "L", fabric: "linen", color: "white" } }
])
db.lab_items.createIndex({ "attrs.$**": 1 })
db.lab_items.find({ "attrs.color": "black" }, { _id: 0, sku: 1 })` },
    { title: 'The plan shows the $_path key', code: `db.lab_items.find({ "attrs.fabric": "cotton" }).explain("executionStats").queryPlanner.winningPlan` },
    { title: 'Whole-document wildcard with a projection', code: `db.lab_items.createIndex({ "$**": 1 }, { wildcardProjection: { attrs: 1, category: 1 }, name: "wc_attrs_category" })
db.lab_items.getIndexes().map(i => ({ name: i.name, key: i.key, proj: i.wildcardProjection }))` }
  ],
  mistakes: [
    'Indexing the whole document with { "$**": 1 } and paying for every field on every write.',
    'Expecting a wildcard index to enforce uniqueness or expire documents.',
    'Using a wildcard index where one compound index on known fields would serve the query and its sort better.'
  ],
  interview: [
    { q: 'When would you use a wildcard index instead of the attribute pattern?', a: '<p>When documents use natural field names that vary and you want to keep that shape, and queries usually filter on one dynamic field. The attribute pattern (<code>[{ k, v }]</code> with a compound index on <code>k, v</code>) works on every version, combines cleanly with other fields and supports multiple attribute predicates, but changes the document shape. Since 7.0 compound wildcard indexes close part of the gap by adding a fixed prefix such as tenantId.</p>' }
  ],
  quiz: [
    { q: 'Which of these can a wildcard index do?', options: ['Enforce uniqueness', 'Serve an equality query on attrs.color', 'Act as a shard key', 'Expire documents (TTL)'], answer: 1 },
    { q: 'What appears in the key pattern of a wildcard index plan?', options: ['$_path', '$$ROOT', '_id', '$natural'], answer: 0 }
  ]
},
{
  id: 'geospatial', module: 'index-types', title: 'Geospatial queries: 2dsphere, $near, $geoWithin and $geoNear', minutes: 22,
  summary: 'Store locations as GeoJSON, index them with 2dsphere, and answer nearest-store, within-radius and inside-polygon questions with correct units.',
  objectives: ['Store points as GeoJSON with [longitude, latitude] order', 'Write $near, $geoWithin and $geoNear queries', 'Convert kilometres to radians for $centerSphere', 'Know which operators need an index'],
  sections: {
    concept: `<p>Store locations as GeoJSON: <code>{ type: "Point", coordinates: [longitude, latitude] }</code>. Longitude comes first; swapping the order is the most common geo bug. Index with <code>{ loc: "2dsphere" }</code> for earth-like (spherical) geometry; <code>2d</code> indexes are for legacy flat coordinate pairs.</p>
<table><tr><th>Question</th><th>Operator</th><th>Index</th><th>Units</th></tr>
<tr><td>Nearest first, optionally within a distance</td><td><code>$near</code> / <code>$nearSphere</code> in find</td><td>Required</td><td>metres with GeoJSON</td></tr>
<tr><td>Everything within a radius or polygon (unsorted)</td><td><code>$geoWithin</code> with <code>$centerSphere</code> or <code>$geometry</code></td><td>Optional (faster with)</td><td>radians for $centerSphere</td></tr>
<tr><td>Nearest with the distance returned, plus more pipeline stages</td><td><code>$geoNear</code> aggregation stage (must be first)</td><td>Required</td><td>metres with GeoJSON</td></tr>
<tr><td>Shapes that touch</td><td><code>$geoIntersects</code></td><td>Optional</td><td>-</td></tr></table>
<p>Radians for <code>$centerSphere</code>: distance divided by the earth's radius, so 20 km is <code>20 / 6378.1</code>.</p>`,
    why: `<p>Store finders, delivery zones, ride hailing, asset tracking and geo-fenced alerts all reduce to these three or four operators. Getting units or coordinate order wrong silently returns the wrong stores, which is why interviewers like the topic.</p>`,
    useCase: `<p>A grocery app shows the five nearest stores within 10 km that are open and stock the item. <code>$geoNear</code> with <code>query: { open: true, skus: sku }</code>, <code>maxDistance: 10000</code> and <code>distanceField: "meters"</code>, then <code>$limit: 5</code> and a <code>$project</code> rounding the distance for display.</p>`,
    internals: `<p>A 2dsphere index maps each geometry to cells of a hierarchical sphere grid (S2 cells) stored as B-tree keys. <code>$near</code> searches outward ring by ring until it has enough results, which is why it needs the index and returns results sorted by distance. <code>$geoWithin</code> can use the index to visit only covering cells, but works as a plain filter without one. Compound geo indexes such as <code>{ loc: "2dsphere", category: 1 }</code> narrow results further.</p><p class="faint">In this simulator, distances use the haversine formula; real servers use S2 geometry, so values can differ slightly.</p>`
  },
  examples: [
    { title: 'Stores with a 2dsphere index', code: `db.lab_stores.drop()
db.lab_stores.insertMany([
  { name: "Indiranagar", city: "Bengaluru", open: true, loc: { type: "Point", coordinates: [77.6408, 12.9784] } },
  { name: "Koramangala", city: "Bengaluru", open: true, loc: { type: "Point", coordinates: [77.6271, 12.9352] } },
  { name: "Whitefield", city: "Bengaluru", open: false, loc: { type: "Point", coordinates: [77.7500, 12.9698] } },
  { name: "Jayanagar", city: "Bengaluru", open: true, loc: { type: "Point", coordinates: [77.5838, 12.9250] } },
  { name: "Bandra", city: "Mumbai", open: true, loc: { type: "Point", coordinates: [72.8406, 19.0596] } }
])
db.lab_stores.createIndex({ loc: "2dsphere" })` },
    { title: 'Nearest open stores within 8 km of MG Road', code: `db.lab_stores.find({
  open: true,
  loc: { $near: { $geometry: { type: "Point", coordinates: [77.6066, 12.9756] }, $maxDistance: 8000 } }
}, { _id: 0, name: 1 })` },
    { title: 'Distances with $geoNear', code: `db.lab_stores.aggregate([
  { $geoNear: {
      near: { type: "Point", coordinates: [77.6066, 12.9756] },
      distanceField: "meters",
      maxDistance: 20000,
      query: { open: true }
  } },
  { $project: { _id: 0, name: 1, km: { $round: [{ $divide: ["$meters", 1000] }, 1] } } }
])` },
    { title: 'Within a 10 km radius ($centerSphere uses radians)', code: `db.lab_stores.find(
  { loc: { $geoWithin: { $centerSphere: [[77.6066, 12.9756], 10 / 6378.1] } } },
  { _id: 0, name: 1 }
)` },
    { title: 'Inside a delivery polygon', code: `db.lab_stores.find({ loc: { $geoWithin: { $geometry: { type: "Polygon", coordinates: [[
  [77.58, 12.92], [77.66, 12.92], [77.66, 12.99], [77.58, 12.99], [77.58, 12.92]
]] } } } }, { _id: 0, name: 1 })`, note: 'Polygon rings must be closed: the last point repeats the first.' },
    { title: '$near without a geo index fails', expectError: true, code: `db.lab_stores_noidx.drop()
db.lab_stores_noidx.insertOne({ loc: { type: "Point", coordinates: [77.6, 12.97] } })
db.lab_stores_noidx.find({ loc: { $near: { $geometry: { type: "Point", coordinates: [77.6, 12.97] } } } }).toArray()` }
  ],
  mistakes: [
    'Storing [latitude, longitude] instead of [longitude, latitude].',
    'Passing kilometres to $centerSphere instead of radians.',
    'Putting $geoNear anywhere but the first pipeline stage.',
    'Expecting $geoWithin results to be sorted by distance.'
  ],
  interview: [
    { q: 'Find the 5 nearest open stores within 10 km and show the distance. How?', a: '<p>Store <code>loc</code> as a GeoJSON Point with <code>[lng, lat]</code>, create a <code>2dsphere</code> index, and run an aggregation whose first stage is <code>$geoNear</code> with <code>near</code>, <code>distanceField</code>, <code>maxDistance: 10000</code> (metres) and <code>query: { open: true }</code>, followed by <code>$limit: 5</code>. <code>$near</code> in find also sorts by distance but does not return the distance.</p>' }
  ],
  quiz: [
    { q: 'What is the coordinate order in GeoJSON?', options: ['[latitude, longitude]', '[longitude, latitude]', 'Either', '{ lat, lng } only'], answer: 1 },
    { q: 'Which operator works without a geo index?', options: ['$near', '$geoNear', '$geoWithin', '$nearSphere'], answer: 2 },
    { q: 'A 50 km radius in $centerSphere is written as', options: ['50', '50000', '50 / 6378.1', '50 * 6378.1'], answer: 2 }
  ]
},
{
  id: 'views-collation', module: 'time-series', title: 'Views, on-demand materialized views and collation', minutes: 20,
  summary: 'Expose filtered or reshaped data through read-only views, precompute heavy reports with $merge, and make string matching and sorting language-aware and case-insensitive with collation.',
  objectives: ['Create and query a standard view', 'Build an on-demand materialized view with $merge', 'Use collation for case-insensitive matching and correct sort order', 'Make sure an index with matching collation is used'],
  sections: {
    concept: `<p>A <b>view</b> is a named aggregation pipeline over a source collection. It stores no data: every read runs the pipeline. Views are read-only, cannot be indexed themselves, and benefit from source indexes when the pipeline starts with <code>$match</code>. Typical uses: hiding PII from analysts, exposing a stable shape to a reporting tool.</p>
<p>An <b>on-demand materialized view</b> is a regular collection refreshed by a pipeline that ends in <code>$merge</code> (4.2+). It can be indexed and read cheaply, at the cost of staleness between refreshes.</p>
<p><b>Collation</b> controls string comparison: <code>{ locale: "en", strength: 2 }</code> ignores case, <code>strength: 1</code> also ignores accents, the default <code>strength: 3</code> compares both. It applies to matching, sorting and index keys. An index is only used for string comparisons when the query's collation matches the index's collation.</p>`,
    why: `<p>Case-insensitive login lookups, alphabetical lists in local languages, and "give analysts a safe subset" are everyday requests. The usual wrong answers are unanchored case-insensitive regexes (which scan) or duplicating data by hand.</p>`,
    useCase: `<p>An identity service stores emails as entered. Logins must match regardless of case. The team creates <code>{ email: 1 }</code> with <code>collation: { locale: "en", strength: 2 }</code> and unique, so "Asha@Example.com" and "asha@example.com" cannot both exist, and the login query specifies the same collation so it uses the index.</p>`,
    internals: `<p>Collation-aware indexes store ICU sort keys instead of raw strings, so a case-insensitive equality is a normal index seek. A collection can have a default collation set at creation; queries without an explicit collation inherit it. Views inherit the source collection's default collation and cannot use a different one.</p>`
  },
  examples: [
    { title: 'A PII-free view for analysts', code: `db.v_customers_public.drop()
db.createView("v_customers_public", "customers", [
  { $match: { optIn: true } },
  { $project: { _id: 1, tier: 1, city: "$address.city", country: "$address.country" } }
])
db.v_customers_public.find().limit(3)` },
    { title: 'Views are read-only', expectError: true, code: `db.v_customers_public.insertOne({ tier: "gold" })` },
    { title: 'On-demand materialized view with $merge', code: `db.orders.aggregate([
  { $match: { status: { $in: ["paid", "shipped", "delivered"] } } },
  { $group: { _id: "$shipping.country", orders: { $sum: 1 }, revenue: { $sum: "$total" } } },
  { $set: { revenue: { $round: ["$revenue", 2] }, refreshedAt: "$$NOW" } },
  { $merge: { into: "mv_revenue_by_country", whenMatched: "replace", whenNotMatched: "insert" } }
])
db.mv_revenue_by_country.find().sort({ revenue: -1 }).limit(3)` },
    { title: 'Case-insensitive matching with collation', code: `db.lab_people.drop()
db.lab_people.insertMany([{ email: "Asha@Example.com" }, { email: "asha@example.com" }, { email: "ASHA@EXAMPLE.COM" }, { email: "ravi@example.com" }])
db.lab_people.find({ email: "asha@example.com" }).count()
db.lab_people.find({ email: "asha@example.com" }).collation({ locale: "en", strength: 2 }).count()` },
    { title: 'Sort order: binary versus locale-aware', code: `db.lab_names.drop()
db.lab_names.insertMany([{ n: "banana" }, { n: "Apple" }, { n: "apple" }, { n: "Zebra" }]);
({
  binary: db.lab_names.find().sort({ n: 1 }).toArray().map(d => d.n),
  english: db.lab_names.find().sort({ n: 1 }).collation({ locale: "en" }).toArray().map(d => d.n)
})`, note: 'Binary order puts every capital letter before every lowercase letter; locale-aware order is what people expect in a list.' },
    { title: 'A case-insensitive unique index', code: `db.lab_logins.drop()
db.lab_logins.createIndex({ email: 1 }, { unique: true, collation: { locale: "en", strength: 2 } })
db.lab_logins.insertOne({ email: "Meera@Example.com" })
db.lab_logins.getIndexes()[1]` }
  ],
  mistakes: [
    'Using /^asha@example.com$/i for logins, which cannot use a normal index efficiently.',
    'Creating a collation index but querying without the same collation, so the index is not used for the string comparison.',
    'Expecting a view to be faster than the underlying query; it is the same query.',
    'Forgetting to refresh materialized views, or refreshing them with $out (which replaces the collection) when incremental $merge was intended.'
  ],
  interview: [
    { q: 'How do you implement case-insensitive unique emails in MongoDB?', a: '<p>Create the unique index with a collation of strength 2, for example <code>createIndex({ email: 1 }, { unique: true, collation: { locale: "en", strength: 2 } })</code>, and query with the same collation so lookups use it. Alternatives are storing a normalized lowercase copy of the field with a normal unique index. Avoid case-insensitive regexes for this.</p>' }
  ],
  quiz: [
    { q: 'Which strength ignores case but not accents?', options: ['1', '2', '3', '4'], answer: 1 },
    { q: 'What does a standard view store?', options: ['A copy of the data', 'Only the pipeline definition', 'Index keys', 'A cached result for 60 seconds'], answer: 1 }
  ]
},
{
  id: 'field-encryption', module: 'security', title: 'Client-side field level encryption and Queryable Encryption', minutes: 22,
  summary: 'Encrypt sensitive fields in the driver so the server, backups and DBAs only ever see ciphertext, and know what you can still query.',
  objectives: ['Explain the key hierarchy: customer master key, data encryption keys, key vault', 'Compare CSFLE deterministic and random encryption with Queryable Encryption', 'Know edition and version requirements', 'Plan key rotation and operational impact'],
  sections: {
    concept: `<p>With in-use encryption the <b>driver</b> encrypts fields before sending them and decrypts results; the server stores <code>BinData</code> ciphertext. Plaintext never reaches the server, logs, the oplog or backups.</p>
<ul><li><b>Customer master key (CMK)</b>: lives in a KMS (AWS KMS, Azure Key Vault, Google Cloud KMS, a KMIP server, or a local key for development).</li>
<li><b>Data encryption keys (DEKs)</b>: generated per field or per tenant, stored encrypted by the CMK in a <b>key vault</b> collection (for example <code>encryption.__keyVault</code>).</li>
<li><b>CSFLE</b> (4.2+): deterministic encryption allows equality queries but reveals equal values; random encryption is stronger but not queryable.</li>
<li><b>Queryable Encryption</b> (GA in 7.0, range queries GA in 8.0): randomized encryption that still supports equality and range queries using encrypted metadata collections.</li></ul>
<p>Automatic encryption (the driver reads a schema or <code>encryptedFields</code> map and encrypts transparently) requires MongoDB Enterprise or Atlas plus the <code>crypt_shared</code> library or <code>mongocryptd</code>. Explicit encryption, where code calls <code>encrypt()</code> per field, also works with Community Edition.</p>`,
    why: `<p>Regulations and internal policy often require that DBAs, backup operators and anyone with a disk image cannot read card numbers, national IDs or health data. Encryption at rest protects the disk, TLS protects the wire, but only in-use encryption protects data from the database tier itself.</p>`,
    useCase: `<p>A lending platform encrypts <code>pan</code> and <code>ssn</code> with Queryable Encryption (equality) and <code>income</code> with range support. Support engineers can look up a customer by PAN through the application, while DBAs restoring a backup or reading the oplog see only ciphertext. Losing the CMK would make the data unrecoverable, so it lives in KMS with strict access and backups.</p>`,
    internals: `<p>Encrypted fields are stored as BinData subtype 6. Queryable Encryption creates internal <code>enxcol_</code> metadata collections (state and compaction) per encrypted collection, which add storage and write amplification; run <code>compactStructuredEncryptionData</code> periodically. Indexes on encrypted fields are managed by the system, sorting and most aggregation on encrypted fields is not possible, and the shard key cannot be encrypted.</p>`
  },
  examples: [
    { title: 'Explicit encryption with the Node.js driver (outline)', runnable: false, code: `const { MongoClient, ClientEncryption } = require("mongodb");
const kmsProviders = { aws: { accessKeyId: process.env.AWS_KEY, secretAccessKey: process.env.AWS_SECRET } };
const client = await MongoClient.connect(uri);
const enc = new ClientEncryption(client, { keyVaultNamespace: "encryption.__keyVault", kmsProviders });

const dekId = await enc.createDataKey("aws", { masterKey: { region: "ap-south-1", key: process.env.CMK_ARN }, keyAltNames: ["pan-key"] });
const pan = await enc.encrypt("ABCDE1234F", { keyId: dekId, algorithm: "AEAD_AES_256_CBC_HMAC_SHA_512-Deterministic" });
await client.db("lend").collection("customers").insertOne({ name: "Asha", pan });

// equality lookup works because the deterministic ciphertext is identical
const probe = await enc.encrypt("ABCDE1234F", { keyId: dekId, algorithm: "AEAD_AES_256_CBC_HMAC_SHA_512-Deterministic" });
await client.db("lend").collection("customers").findOne({ pan: probe });` },
    { title: 'Queryable Encryption collection definition (outline)', runnable: false, code: `const encryptedFields = {
  fields: [
    { path: "pan", bsonType: "string", queries: { queryType: "equality" } },
    { path: "income", bsonType: "int", queries: { queryType: "range", min: 0, max: 100000000 } }
  ]
};
// with automatic encryption enabled on the client:
await enc.createEncryptedCollection(db, "customers", { provider: "aws", createCollectionOptions: { encryptedFields }, masterKey });` },
    { title: 'Key vault hygiene you can check', code: `db.lab_keyvault.drop()
db.lab_keyvault.createIndex({ keyAltNames: 1 }, { unique: true, partialFilterExpression: { keyAltNames: { $exists: true } } })
db.lab_keyvault.getIndexes().map(i => ({ name: i.name, unique: !!i.unique, partial: i.partialFilterExpression }))`, note: 'The real key vault needs exactly this unique partial index on keyAltNames so two keys cannot share a name.' }
  ],
  mistakes: [
    'Losing or deleting the customer master key, which makes every encrypted field unreadable forever.',
    'Using deterministic encryption on low-cardinality fields (gender, status), which leaks the distribution.',
    'Assuming automatic encryption works on Community Edition.',
    'Forgetting that sorts, $regex and most aggregation expressions cannot operate on encrypted fields.'
  ],
  interview: [
    { q: 'CSFLE versus Queryable Encryption?', a: '<p>Both encrypt in the driver with keys from a KMS. CSFLE (4.2+) supports equality queries only with deterministic encryption, which reveals when two values are equal. Queryable Encryption (GA 7.0, range in 8.0) uses randomized encryption plus encrypted metadata collections so equality and range queries work without exposing equality patterns, at the cost of extra storage, write amplification and compaction. Automatic mode needs Enterprise or Atlas; explicit encryption works on Community.</p>' }
  ],
  quiz: [
    { q: 'Where are data encryption keys stored?', options: ['In the KMS only', 'In a key vault collection, encrypted by the master key', 'In mongod.conf', 'In the oplog'], answer: 1 },
    { q: 'Which statement about deterministic CSFLE is true?', options: ['It hides equal values', 'It supports equality queries', 'It supports range queries', 'It requires 8.0'], answer: 1 }
  ]
},
{
  id: 'percona-pbm', module: 'backup-restore', title: 'Percona Backup for MongoDB: logical, physical and PITR', minutes: 25,
  summary: 'Run consistent backups of replica sets and sharded clusters with PBM, enable point-in-time recovery from oplog slices, and rehearse restores.',
  objectives: ['Describe PBM architecture: agents, storage, control collections', 'Choose logical, physical or incremental backups', 'Enable PITR and restore to a timestamp', 'Run and validate a restore drill'],
  sections: {
    concept: `<p>Percona Backup for MongoDB (PBM) is an open-source backup tool for replica sets and sharded clusters. A <code>pbm-agent</code> runs next to every <code>mongod</code>; you drive it with the <code>pbm</code> CLI. Agents coordinate through control collections in the <code>admin</code> database and write to remote storage (S3-compatible, GCS, Azure Blob or a shared filesystem).</p>
<table><tr><th>Type</th><th>How</th><th>Best for</th></tr>
<tr><td>Logical</td><td>Exports documents and replays the oplog for consistency</td><td>Small and medium data, selective restore of namespaces, version changes</td></tr>
<tr><td>Physical</td><td>Copies WiredTiger files through a backup cursor (Percona Server for MongoDB)</td><td>Large data sets; restore time close to copy time</td></tr>
<tr><td>Incremental physical</td><td>Copies only changed blocks since the base</td><td>Very large data with frequent backups</td></tr>
<tr><td>PITR</td><td>Agents continuously upload oplog slices</td><td>Restoring to just before a bad operation</td></tr></table>
<p>For sharded clusters PBM produces a backup that is consistent across shards and the config server replica set.</p>`,
    why: `<p>mongodump alone is not consistent across shards, is slow on large data and has no point-in-time capability. A self-hosted MongoDB estate needs scheduled backups, PITR and tested restores; PBM provides that without a commercial licence, and it is what the Percona Operator uses on Kubernetes.</p>`,
    useCase: `<p>At 14:05 a script runs <code>deleteMany({})</code> on <code>orders</code>. The DBA lists backups, picks the nightly physical backup, and restores to <code>14:04:59</code> on a staging cluster with <code>pbm restore --time</code>. After validating counts, the <code>orders</code> collection is copied back to production. Total time: 40 minutes, data loss: zero.</p>`,
    internals: `<p>With PITR enabled, one agent per replica set uploads the oplog in chunks (10 minutes by default). A PITR restore applies the base backup, then replays slices up to the requested time; the timeline is only continuous if PITR has been running since the last base backup. During a physical restore PBM stops the <code>mongod</code> processes and replaces their data, so restores are disruptive and require agents on every node. Users and roles are part of the backup, which matters when restoring into a different cluster.</p>`
  },
  examples: [
    { title: 'Configure storage and PITR', runnable: false, code: `# /etc/pbm/pbm_config.yaml
storage:
  type: s3
  s3:
    region: ap-south-1
    bucket: acme-mongo-backups
    prefix: prod-rs0
pitr:
  enabled: true
  oplogSpanMin: 10

export PBM_MONGODB_URI="mongodb://pbmuser:****@localhost:27017/?authSource=admin&replSetName=rs0"
pbm config --file /etc/pbm/pbm_config.yaml
pbm status` },
    { title: 'Back up, list and restore', runnable: false, code: `pbm backup --type=physical          # or logical, incremental --base
pbm list                            # snapshots and the PITR timeline
pbm restore 2026-10-07T23:00:12Z    # full restore of one snapshot
pbm restore --time="2026-10-08T14:04:59"            # point in time
pbm restore 2026-10-07T23:00:12Z --ns=shop.orders   # selective (logical backups)
pbm logs --tail=50` },
    { title: 'The PBM user (run once on each replica set)', code: `use admin
try { db.dropUser("pbmuser") } catch (e) {}
try { db.dropRole("pbmAnyAction") } catch (e) {}
db.createRole({ role: "pbmAnyAction", privileges: [{ resource: { anyResource: true }, actions: ["anyAction"] }], roles: [] })
db.createUser({ user: "pbmuser", pwd: "change-me", roles: ["backup", "clusterMonitor", "restore", { role: "pbmAnyAction", db: "admin" }] })
db.getUser("pbmuser").roles.map(r => r.role)` },
    { title: 'Restore validation: counts and a content fingerprint', code: `const summary = db.getCollectionNames().filter(c => !c.startsWith("system.") && !c.startsWith("lab_"))
  .map(c => ({ coll: c, docs: db.getCollection(c).countDocuments(), indexes: db.getCollection(c).getIndexes().length }));
summary`, note: 'Run the same query on the source (or record it before the incident) and on the restored cluster, then compare.' }
  ],
  mistakes: [
    'Running pbm-agent on only some nodes; every mongod needs an agent.',
    'Never testing a restore, so the first attempt happens during an incident.',
    'Disabling PITR temporarily and not noticing the gap in the timeline.',
    'Restoring a physical backup straight over production instead of a side cluster when only one collection is damaged.'
  ],
  interview: [
    { q: 'How would you recover from an accidental deleteMany on a self-hosted replica set?', a: '<p>Find the exact time from the oplog (<code>op: "d"</code> burst on that namespace). With PBM and PITR enabled, restore the last base backup plus oplog up to one second before the delete onto a staging cluster (<code>pbm restore --time</code>), validate, and copy the collection back. Without PITR, restore the last snapshot and replay the oplog manually with <code>mongorestore --oplogReplay --oplogLimit</code>. Afterwards, restrict delete privileges and rehearse restores.</p>' }
  ],
  quiz: [
    { q: 'Which PBM backup type copies WiredTiger data files?', options: ['Logical', 'Physical', 'PITR slice', 'mongodump'], answer: 1 },
    { q: 'What does PITR need between the base backup and the target time?', options: ['A second full backup', 'Continuous oplog slices', 'A delayed secondary', 'Nothing'], answer: 1 }
  ]
},
{
  id: 'percona-pmm', module: 'monitoring', title: 'Monitoring with Percona Monitoring and Management (PMM)', minutes: 20,
  summary: 'Deploy PMM Server and agents, add MongoDB services with the right user, and use the dashboards and Query Analytics to find bottlenecks.',
  objectives: ['Describe PMM Server and PMM Client components', 'Create the monitoring user and enable a query source', 'Read the key dashboards', 'Use Query Analytics to rank query shapes'],
  sections: {
    concept: `<p>PMM is an open-source monitoring platform. <b>PMM Server</b> (usually a container) stores metrics and runs Grafana dashboards, alerting and <b>Query Analytics (QAN)</b>. <b>PMM Client</b> (<code>pmm-agent</code> plus exporters) runs on each database host and ships metrics and query samples.</p>
<p>For MongoDB, <code>pmm-admin add mongodb</code> registers a service; metrics come from the MongoDB exporter, and QAN reads the profiler (<code>--query-source=profiler</code>) or slow-query logs. Typical dashboards: instances overview and summary, replica set summary (lag, elections, oplog window), WiredTiger (cache, tickets, eviction), sharded cluster summary, and node-level CPU, disk and memory.</p>`,
    why: `<p>Self-hosted MongoDB needs the same visibility that a managed service offers: per-query-shape latency, replication health and storage engine internals in one place. PMM provides that without licence costs and integrates with the Percona Operator.</p>`,
    useCase: `<p>Latency rises every day at 09:00. QAN ranks query shapes by total time: one <code>find</code> on <code>orders</code> by <code>status</code> and <code>createdAt</code> dominates, with a high documents-examined-to-returned ratio. Its example query plus <code>explain</code> confirms a blocking sort; an ESR index fixes it, and the WiredTiger dashboard shows application-thread eviction dropping back to zero.</p>`,
    internals: `<p>The profiler query source adds load proportional to profiled operations, so keep <code>slowms</code> or the sample rate sensible on busy clusters. Dashboards are only as good as the scrape interval; for second-level incidents, combine PMM with FTDC data. The monitoring user needs <code>clusterMonitor</code>, read access to <code>local</code> for oplog metrics, and a small custom role for collection and index statistics.</p>`
  },
  examples: [
    { title: 'Monitoring user and role', code: `use admin
try { db.dropUser("pmm") } catch (e) {}
try { db.dropRole("explainRole") } catch (e) {}
db.createRole({
  role: "explainRole",
  privileges: [{ resource: { db: "", collection: "" }, actions: ["dbHash", "find", "listIndexes", "listCollections", "collStats", "dbStats", "indexStats"] },
               { resource: { db: "", collection: "system.version" }, actions: ["find"] }],
  roles: []
})
db.createUser({ user: "pmm", pwd: "change-me", roles: [{ role: "explainRole", db: "admin" }, { role: "clusterMonitor", db: "admin" }, { role: "read", db: "local" }] })
db.getUser("pmm").roles.map(r => r.role + "@" + r.db)` },
    { title: 'Register the service', runnable: false, code: `# on the database host, after installing pmm-client
pmm-admin config --server-insecure-tls --server-url=https://admin:****@pmm.internal:443
pmm-admin add mongodb --username=pmm --password=**** \\
  --host=127.0.0.1 --port=27017 --cluster=prod-rs0 \\
  --replication-set=rs0 --environment=prod \\
  --query-source=profiler --service-name=prod-rs0-node1
pmm-admin list` },
    { title: 'Enable a sampled profiler for QAN', code: `db.setProfilingLevel(1, { slowms: 50, sampleRate: 0.5 })
db.getProfilingStatus()` }
  ],
  mistakes: [
    'Profiling every operation (level 2) on a busy production cluster to feed QAN.',
    'Monitoring only the primary; lag and eviction problems often start on secondaries.',
    'Giving the monitoring user root or readWriteAnyDatabase instead of a minimal role.'
  ],
  interview: [
    { q: 'How would you set up monitoring for a self-hosted MongoDB fleet?', a: '<p>Deploy PMM Server (or Prometheus plus Grafana with the MongoDB exporter), install agents on every node, create a least-privilege monitoring user, enable a sampled profiler or log-based query source for Query Analytics, and alert on availability, replication lag versus oplog window, cache eviction, tickets, disk latency and free space, and backup freshness. Keep FTDC for second-by-second post-mortems.</p>' }
  ],
  quiz: [
    { q: 'What does PMM Query Analytics read for MongoDB?', options: ['The oplog', 'The profiler or slow-query logs', 'Only serverStatus', 'Application logs'], answer: 1 }
  ]
},
{
  id: 'percona-operator', module: 'kubernetes', title: 'Percona Operator for MongoDB in practice', minutes: 25,
  summary: 'Deploy replica sets and sharded clusters with the PerconaServerMongoDB custom resource, wire in PBM backups, and run day-2 operations safely.',
  objectives: ['Read and write a PerconaServerMongoDB custom resource', 'Configure storage, anti-affinity and disruption budgets', 'Schedule backups and restore with PITR on Kubernetes', 'Scale, upgrade and troubleshoot'],
  sections: {
    concept: `<div data-diagram="k8s-operator"></div>
<p>The operator watches <code>PerconaServerMongoDB</code> resources (<code>kubectl get psmdb</code>) and reconciles StatefulSets for each replica set, the config server replica set and mongos, plus Services, Secrets (system users, TLS) and PBM agent sidecars. Backups and restores are themselves resources: <code>PerconaServerMongoDBBackup</code> and <code>PerconaServerMongoDBRestore</code>.</p>
<p>Key spec areas: <code>replsets</code> (size, volumeSpec, resources, affinity), <code>sharding</code> (configsvrReplSet, mongos), <code>backup</code> (storages, tasks, pitr), <code>users</code> and <code>secrets</code>, and <code>updateStrategy: SmartUpdate</code>, which restarts secondaries first and steps down the primary last.</p>`,
    why: `<p>Running MongoDB on Kubernetes without an operator means scripting membership changes, rolling restarts and backups by hand. The operator encodes those runbooks; understanding its resources is now a common requirement for DBRE roles on self-hosted platforms.</p>`,
    useCase: `<p>A platform team offers MongoDB as a service on Kubernetes: each product team gets a <code>PerconaServerMongoDB</code> resource from a template with three members across zones, 200 Gi of SSD storage, nightly physical backups to S3 with PITR, and PMM monitoring. Upgrades are done by changing the image tag; SmartUpdate rolls members one at a time.</p>`,
    internals: `<p>Pods get stable names (<code>cluster-rs0-0</code>) and PersistentVolumeClaims, so a rescheduled pod reattaches its data and rejoins the replica set. <code>podDisruptionBudget.maxUnavailable: 1</code> keeps node drains from taking down a majority. Set container memory limits and let the operator size the WiredTiger cache from them, or configure it explicitly; never rely on host RAM detection in containers. Exposing members outside the cluster needs <code>expose</code> settings and split-horizon DNS so drivers see reachable hostnames.</p>`
  },
  examples: [
    { title: 'A three-member replica set with backups', runnable: false, code: `apiVersion: psmdb.percona.com/v1
kind: PerconaServerMongoDB
metadata:
  name: orders-db
spec:
  crVersion: "1.21.0"
  image: percona/percona-server-mongodb:8.0
  updateStrategy: SmartUpdate
  secrets:
    users: orders-db-users
  replsets:
    - name: rs0
      size: 3
      affinity:
        antiAffinityTopologyKey: topology.kubernetes.io/zone
      podDisruptionBudget:
        maxUnavailable: 1
      resources:
        limits: { cpu: "4", memory: 16Gi }
      volumeSpec:
        persistentVolumeClaim:
          storageClassName: fast-ssd
          resources:
            requests: { storage: 200Gi }
  backup:
    enabled: true
    image: percona/percona-backup-mongodb:2
    storages:
      s3-main:
        type: s3
        s3: { bucket: acme-mongo-backups, region: ap-south-1, credentialsSecret: s3-creds, prefix: orders-db }
    pitr:
      enabled: true
    tasks:
      - name: nightly-physical
        enabled: true
        schedule: "0 23 * * *"
        type: physical
        storageName: s3-main
        keep: 7`, note: 'Check crVersion and image tags against the operator release you install.' },
    { title: 'Day-2 commands', runnable: false, code: `kubectl get psmdb                               # status: ready / initializing / error
kubectl get pods -l app.kubernetes.io/instance=orders-db
kubectl patch psmdb orders-db --type=merge -p '{"spec":{"replsets":[{"name":"rs0","size":5}]}}'   # scale (merge replaces the list: include all fields in real use)
kubectl get psmdb-backup                        # backup objects and their state
kubectl logs orders-db-rs0-0 -c backup-agent --tail=50
kubectl logs deploy/percona-server-mongodb-operator --tail=100   # reconcile errors` },
    { title: 'Point-in-time restore resource', runnable: false, code: `apiVersion: psmdb.percona.com/v1
kind: PerconaServerMongoDBRestore
metadata:
  name: restore-before-incident
spec:
  clusterName: orders-db
  backupName: cron-orders-db-20261007230000
  pitr:
    type: date
    date: "2026-10-08 14:04:59"` },
    { title: 'What the operator configures inside MongoDB', code: `rs.conf().members.map(m => ({ host: m.host, priority: m.priority, votes: m.votes, hidden: m.hidden }))`, note: 'In a real operator-managed cluster the hosts are the stable pod DNS names, for example orders-db-rs0-0.orders-db-rs0.ns.svc.cluster.local.' }
  ],
  mistakes: [
    'Editing the StatefulSet directly; the operator will revert it on the next reconcile.',
    'No anti-affinity, so all three members land on one node or zone.',
    'Running without a PodDisruptionBudget, letting a node drain take two members at once.',
    'Restoring into the live cluster without reading the restore resource semantics (it replaces data).'
  ],
  interview: [
    { q: 'How do you upgrade MongoDB managed by the Percona Operator?', a: '<p>Check the operator and MongoDB version compatibility, take and verify a backup, then change the image (and later the featureCompatibilityVersion setting) in the custom resource. With <code>updateStrategy: SmartUpdate</code> the operator restarts secondaries one at a time, waits for them to be healthy, then steps down the primary and restarts it last. Watch the operator logs and replication lag throughout, and set FCV only after the soak period.</p>' }
  ],
  quiz: [
    { q: 'Which resource triggers a restore with the Percona Operator?', options: ['PerconaServerMongoDBBackup', 'PerconaServerMongoDBRestore', 'StatefulSet', 'CronJob'], answer: 1 },
    { q: 'What does SmartUpdate do?', options: ['Restarts all pods at once', 'Restarts secondaries first and the primary last after a stepdown', 'Skips the primary', 'Only updates mongos'], answer: 1 }
  ]
}
]);
