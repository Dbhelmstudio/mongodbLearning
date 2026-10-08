/* Level 1 — Beginner */
MM.addLessons([
{
  id: 'what-is-mongodb', module: 'fundamentals', title: 'What MongoDB is and when to use it', minutes: 15,
  summary: 'MongoDB stores data as documents: JSON-like records with nested objects and arrays. This lesson explains the model, how it differs from relational databases, and where it fits.',
  objectives: ['Describe documents, collections and databases', 'Explain how BSON relates to JSON', 'List the workloads where MongoDB is a strong or weak fit', 'Run your first commands in the shell'],
  sections: {
    concept: `<p>MongoDB is a general-purpose <b>document database</b>. A <b>document</b> is a set of field/value pairs, where values can be scalars, nested documents or arrays. Documents live in <b>collections</b>, and collections live in <b>databases</b>. A deployment is normally a <b>replica set</b> (three or more copies of the data) and can be <b>sharded</b> to scale horizontally.</p>
<div data-diagram="document-model"></div>
<table><tr><th>Relational</th><th>MongoDB</th></tr>
<tr><td>Database</td><td>Database</td></tr><tr><td>Table</td><td>Collection</td></tr><tr><td>Row</td><td>Document</td></tr><tr><td>Column</td><td>Field (can be nested or an array)</td></tr>
<tr><td>Primary key</td><td><code>_id</code> field (required, unique per collection)</td></tr><tr><td>JOIN</td><td>Embedding, or <code>$lookup</code> in aggregation</td></tr>
<tr><td>Foreign key constraint</td><td>None enforced by the server; modelled in the application</td></tr></table>
<p>Documents are stored as <b>BSON</b> (binary JSON). BSON adds types JSON lacks (dates, 32/64-bit integers, Decimal128, ObjectId, binary) and length prefixes that make documents fast to traverse.</p>`,
    why: `<p>The document model maps directly onto objects in application code, so a single read can return everything a screen needs. That removes most joins from the hot path and lets the schema evolve without migrations that lock tables. Replication and automatic failover are built in, and sharding spreads both data and write load across machines.</p>
<div class="callout tip"><b>Good fits</b>Catalogs and content, user profiles and sessions, orders and carts, IoT and event data (time series collections), real-time analytics, mobile backends, and anything where the shape of the data varies or evolves quickly.</div>
<div class="callout warn"><b>Weaker fits</b>Workloads dominated by ad-hoc joins across many entities, heavy multi-row transactional accounting with strict cross-entity constraints, or teams that rely on the database to enforce relational integrity everywhere. MongoDB supports multi-document transactions, but designing so you rarely need them is the point of the model.</div>`,
    useCase: `<p>An online shop stores each order with its line items, payment and shipping details embedded. The order page loads with one indexed read. The product catalog stores electronics, books and groceries in one <code>products</code> collection even though each category has different attributes. Analytics run as aggregation pipelines on a secondary so they do not slow down checkout.</p>`,
    internals: `<p>A <code>mongod</code> process hosts databases. Each collection and each index is a separate table in the <b>WiredTiger</b> storage engine, stored as a B-tree in its own file. Documents are kept in BSON, compressed on disk (snappy by default), and decompressed in the WiredTiger cache. Every write on the primary also records an entry in the <b>oplog</b>, which secondaries replay to stay in sync. You will dig into each of these in levels 4 to 6.</p>`
  },
  examples: [
    { title: 'Look around', code: `show dbs
use shop
show collections` },
    { title: 'Your first queries', code: `db.orders.countDocuments()
db.customers.findOne()
db.orders.findOne({}, { orderNo: 1, status: 1, items: 1 })`, note: 'An order embeds its line items as an array of sub-documents. No join needed to show the order page.' },
    { title: 'Flexible shape in one collection', code: `db.products.find({ category: "books" }, { name: 1, attributes: 1 }).limit(2)
db.products.find({ category: "electronics" }, { name: 1, attributes: 1 }).limit(2)`, note: 'Books and electronics share a collection but carry different attributes.' }
  ],
  mistakes: [
    'Assuming "schemaless" means "no schema design". You still design for access patterns; the schema simply lives in your application and, ideally, in a validator.',
    'Normalizing everything into many collections and joining with <code>$lookup</code> everywhere, which recreates a relational design without the relational optimizer.',
    'Running a single <code>mongod</code> in production. Use a replica set so you get failover and can take backups from a secondary.'
  ],
  interview: [
    { q: 'How is MongoDB different from a relational database?', a: '<p>It stores documents (nested objects and arrays) instead of rows in fixed tables. Data accessed together is usually embedded together, so joins are rarer. Schemas are flexible but can be enforced with <code>$jsonSchema</code> validators. Scaling out is native through sharding, and high availability through replica sets. It supports ACID transactions: single-document always, multi-document since 4.0 (replica sets) and 4.2 (sharded).</p>' },
    { q: 'What is BSON and why not store plain JSON?', a: '<p>BSON is a binary encoding of JSON-like documents. It adds types (Date, ObjectId, Int32, Int64, Decimal128, binary) and length prefixes so the server can skip over fields without parsing them. JSON has only one number type and no date type, which is not enough for a database.</p>' }
  ],
  quiz: [
    { q: 'In MongoDB terms, what is the equivalent of a table row?', options: ['A collection', 'A document', 'A field', 'A namespace'], answer: 1, explain: 'A row maps to a document; a table maps to a collection.' },
    { q: 'Which field must every document have?', options: ['id', 'createdAt', '_id', 'None'], answer: 2, explain: '<code>_id</code> is required and unique within a collection. If you omit it, the driver or server generates an ObjectId.' },
    { q: 'What is the recommended minimum production deployment?', options: ['A single mongod', 'A three-member replica set', 'A sharded cluster', 'Two mongod processes with an arbiter only'], answer: 1, explain: 'Three data-bearing members give automatic failover and a majority for elections.' }
  ]
},
{
  id: 'documents-collections', module: 'fundamentals', title: 'Documents, collections and namespaces', minutes: 15,
  summary: 'The rules every document follows: _id, field names, size limits, nesting, and how collections and databases are created.',
  objectives: ['Know the constraints on documents (16 MB, _id, field names)', 'Understand implicit creation of databases and collections', 'Use dot notation to reach nested fields', 'Explain what a namespace is'],
  sections: {
    concept: `<ul>
<li><b>_id</b>: required, unique per collection, immutable, can be any type except an array. Default is an ObjectId.</li>
<li><b>Size</b>: a document can be at most <b>16 MB</b> of BSON. Nesting depth is limited to 100 levels.</li>
<li><b>Field names</b>: case-sensitive strings. Avoid names that start with <code>$</code> or contain <code>.</code>; they are legal since 5.0 but awkward to query.</li>
<li><b>Field order</b> is preserved; <code>_id</code> is always first.</li>
<li><b>Namespace</b>: <code>database.collection</code>, for example <code>shop.orders</code>. Indexes, the oplog and the profiler all refer to namespaces.</li>
</ul>
<p>Databases and collections are created <b>lazily</b>: the first insert into <code>db.newThing</code> creates both. Use <code>db.createCollection()</code> when you need options such as a validator, capped size, time series or clustered index.</p>`,
    why: `<p>The 16 MB limit and the shape of your documents drive schema design. Arrays that grow without bound (every click a user ever made) eventually hit the limit and make every read and write of that document expensive. Knowing the rules early prevents designs you would have to migrate later.</p>`,
    useCase: `<p>A customer document embeds the current address (bounded, read with the customer), but the list of orders lives in its own collection referencing <code>customerId</code>, because a loyal customer could place thousands of orders.</p>`,
    internals: `<p>Each collection is a WiredTiger table keyed by an internal <b>RecordId</b>; the <code>_id</code> index maps your <code>_id</code> values to RecordIds. Since 5.3 you can create <b>clustered collections</b> where documents are stored in <code>_id</code> order and the separate <code>_id</code> index disappears, which helps time-ordered data.</p>`
  },
  examples: [
    { title: 'Dot notation into embedded documents', code: `db.customers.find({ "address.city": "Pune" }, { name: 1, address: 1 }).limit(3)
db.customers.countDocuments({ "address.country": "India" })` },
    { title: 'Lazy creation', code: `use lab
db.notes.insertOne({ text: "first note", tags: ["intro"] })
show collections
db.notes.find()
use shop` },
    { title: 'Explicit creation with options', code: `use lab
db.audit.drop()
db.createCollection("audit", { capped: true, size: 1048576, max: 3 })
for (let i = 1; i <= 5; i++) db.audit.insertOne({ seq: i })
db.audit.find({}, { _id: 0 })
use shop`, note: 'A capped collection keeps only the newest documents (here at most 3), in insertion order.' }
  ],
  mistakes: [
    'Storing unbounded arrays (comments, events, logs) inside one document.',
    'Using values such as user input as field names (<code>{ "user@example.com": ... }</code>). Field names should be static; put variable data in values.',
    'Typos in collection names silently create new collections. <code>db.order.insertOne()</code> writes to <code>order</code>, not <code>orders</code>.'
  ],
  interview: [
    { q: 'What happens if two documents in a collection have different fields?', a: '<p>Nothing breaks; collections do not enforce a structure unless you add a validator. Queries simply do not match documents missing a field (unless you query for missing values). In practice you keep shapes consistent per type and use a <code>$jsonSchema</code> validator for critical fields.</p>' },
    { q: 'How do you handle data that might exceed 16 MB?', a: '<p>Do not let a single document grow without bound: move the growing part into its own collection (one document per item or per bucket of items), use the bucket pattern, or store large binary content with GridFS or object storage and keep a reference.</p>' }
  ],
  quiz: [
    { q: 'What is the maximum size of a BSON document?', options: ['4 MB', '16 MB', '64 MB', 'No limit'], answer: 1, explain: '16 MB. GridFS exists for larger files.' },
    { q: 'Which statement about _id is true?', options: ['It can be changed with $set', 'It can be an array', 'It is unique and immutable', 'It is optional'], answer: 2 },
    { q: 'When is a collection created?', options: ['Only with db.createCollection()', 'On first insert or index creation, or explicitly', 'When the database is created', 'At server start'], answer: 1 }
  ]
},
{
  id: 'mongosh-basics', module: 'mongosh', title: 'mongosh, connection strings and tools', minutes: 18,
  summary: 'The shell is a full JavaScript environment. Learn how to connect, navigate, read cursors, script, and which companion tools exist.',
  objectives: ['Write standard and SRV connection strings', 'Use shell helpers: use, show, it, print', 'Understand cursors and batching in the shell', 'Know the database tools: mongodump, mongorestore, mongoexport, mongostat, mongotop'],
  sections: {
    concept: `<p><b>mongosh</b> is a Node.js-based shell. Everything you type is JavaScript, plus a few helpers (<code>use</code>, <code>show</code>, <code>it</code>). Connect with a URI:</p>
<pre class="static" data-title="connection strings">mongosh "mongodb://app:secret@db1:27017,db2:27017,db3:27017/shop?replicaSet=rs0&authSource=admin&tls=true"
mongosh "mongodb+srv://cluster0.example.net/shop"   # hosts and options come from DNS SRV/TXT records
mongosh --host localhost --port 27017 -u admin --authenticationDatabase admin</pre>
<p>Listing every replica-set member in the URI (or using SRV) lets the driver discover the topology and follow failovers. <code>directConnection=true</code> pins one host and disables discovery.</p>
<p><code>find()</code> returns a <b>cursor</b>. The shell prints the first 20 documents and <code>it</code> fetches the next batch. In scripts you consume cursors with <code>toArray()</code>, <code>forEach()</code> or <code>for...of</code>.</p>`,
    why: `<p>Most production troubleshooting happens in mongosh: checking <code>rs.status()</code>, reading <code>db.currentOp()</code>, running <code>explain()</code>, or fixing data with a careful update. Knowing the helpers and cursor behaviour makes you fast and safe.</p>
<table><tr><th>Tool</th><th>Use</th></tr>
<tr><td>mongodump / mongorestore</td><td>Logical backup and restore in BSON, optionally with the oplog for a consistent point</td></tr>
<tr><td>mongoexport / mongoimport</td><td>JSON or CSV export/import of one collection</td></tr>
<tr><td>mongostat</td><td>Per-second insert/query/update/delete counters, cache usage, queues</td></tr>
<tr><td>mongotop</td><td>Time spent reading and writing per collection</td></tr>
<tr><td>Compass</td><td>GUI: schema analysis, explain plans, index management</td></tr></table>`,
    useCase: `<p>On-call at 2 a.m.: <code>mongosh</code> into the primary, run <code>db.currentOp({ secs_running: { $gt: 5 } })</code> to find a runaway query, check its <code>planSummary</code>, kill it with <code>db.killOp()</code>, then add the missing index during the day.</p>`,
    internals: `<p>The shell wraps the official Node.js driver, so it follows the same server selection, retry and connection pool rules as your application. Each statement you run is a separate command; a cursor keeps a server-side cursor id open (10 minutes idle timeout by default) until it is exhausted or closed.</p>`
  },
  examples: [
    { title: 'Helpers and the current database', code: `db.getName()
db.version()
show collections` },
    { title: 'Cursors print in batches', code: `db.orders.find({}, { orderNo: 1, total: 1 }).limit(25)`, note: 'The shell shows 20 documents. Run <code>it</code> in the Playground to see the next batch.' },
    { title: 'It is JavaScript', code: `const statuses = db.orders.distinct("status")
statuses.forEach(s => print(s.padEnd(10), db.orders.countDocuments({ status: s })))
db.orders.find({ total: { $gt: 3000 } }).toArray().map(o => o.orderNo)` },
    { title: 'Server information', code: `db.hello()
db.serverStatus().opcounters` }
  ],
  mistakes: [
    'Connecting to one replica-set member with <code>directConnection=true</code> in an application, which breaks automatic failover.',
    'Calling <code>toArray()</code> on a huge result in a script and running out of memory. Iterate the cursor instead.',
    'Running write scripts against production without first running the same filter with <code>find()</code> and <code>countDocuments()</code>.'
  ],
  interview: [
    { q: 'What is the difference between mongodb:// and mongodb+srv:// URIs?', a: '<p><code>mongodb+srv://</code> looks up the host list from DNS SRV records and connection options (such as replicaSet, authSource) from a TXT record, and it enables TLS by default. <code>mongodb://</code> lists hosts explicitly. Both let the driver discover the full topology.</p>' },
    { q: 'How do you find and stop a long-running operation?', a: '<p><code>db.currentOp({ active: true, secs_running: { $gt: 10 } })</code> shows running operations with <code>opid</code>, namespace, <code>planSummary</code> and the command. <code>db.killOp(opid)</code> stops it. Prefer <code>maxTimeMS</code> on queries so they cannot run away in the first place.</p>' }
  ],
  quiz: [
    { q: 'What does typing <code>it</code> do in mongosh?', options: ['Shows indexes', 'Fetches the next batch of the last cursor', 'Inserts a test document', 'Shows the last error'], answer: 1 },
    { q: 'Which tool shows time spent reading and writing per collection?', options: ['mongostat', 'mongotop', 'mongodump', 'mongoexport'], answer: 1 },
    { q: 'Why list all replica-set members (or use SRV) in an application URI?', options: ['To load-balance writes', 'So the driver can discover the topology and follow failovers', 'It is required for authentication', 'To enable compression'], answer: 1 }
  ]
},
{
  id: 'bson-types', module: 'bson-types', title: 'BSON types, ObjectId and type ordering', minutes: 18,
  summary: 'Types decide how values compare, sort and index. Learn the important BSON types, how ObjectId works, and how MongoDB orders mixed types.',
  objectives: ['Choose the right numeric type (int, long, double, Decimal128)', 'Explain the structure of an ObjectId', 'Store dates as Date, not strings', 'Query by type with $type'],
  sections: {
    concept: `<table><tr><th>Type</th><th>Shell</th><th>Notes</th></tr>
<tr><td>Double</td><td><code>3.14</code></td><td>Default number type in the shell and in JSON input</td></tr>
<tr><td>32-bit int</td><td><code>NumberInt(5)</code></td><td>Counters, small integers</td></tr>
<tr><td>64-bit int</td><td><code>NumberLong("9007199254740993")</code></td><td>Large integers; pass as a string to avoid JS precision loss</td></tr>
<tr><td>Decimal128</td><td><code>NumberDecimal("19.99")</code></td><td>Exact decimal arithmetic: money, rates</td></tr>
<tr><td>String</td><td><code>"text"</code></td><td>UTF-8</td></tr>
<tr><td>Date</td><td><code>ISODate("2026-01-31T10:00:00Z")</code></td><td>64-bit milliseconds since epoch, always UTC</td></tr>
<tr><td>ObjectId</td><td><code>ObjectId()</code></td><td>12 bytes, default <code>_id</code></td></tr>
<tr><td>Boolean, Null, Array, Object</td><td></td><td></td></tr>
<tr><td>Binary / UUID</td><td><code>UUID()</code></td><td>Opaque bytes, UUIDs as subtype 4</td></tr></table>
<p><b>ObjectId</b> = 4-byte timestamp (seconds) + 5-byte random value per process + 3-byte incrementing counter. It is roughly time-ordered, globally unique without coordination, and you can recover the creation time with <code>getTimestamp()</code>.</p>
<p>When values of different types are compared or sorted, MongoDB uses a fixed order: MinKey, Null, Numbers, Strings, Object, Array, BinData, ObjectId, Boolean, Date, Timestamp, Regex, MaxKey. Range operators such as <code>$gt</code> only match values of the same type class ("type bracketing").</p>`,
    why: `<p>Storing a date as the string <code>"31/01/2026"</code> breaks range queries and sorting. Storing money as a double produces <code>0.1 + 0.2 = 0.30000000000000004</code>. Mixed types in one field (numbers in some documents, strings in others) make queries silently miss data, because <code>{ price: { $gt: 10 } }</code> does not match <code>"15"</code>.</p>`,
    useCase: `<p>A payments team stores <code>amount</code> as Decimal128 and <code>currency</code> as a string, timestamps as Date, and uses the ObjectId timestamp of <code>_id</code> to show "created 3 minutes ago" without an extra field.</p>`,
    internals: `<p>Every BSON element is a type byte, a field name and the value; documents and arrays are length-prefixed. Arrays are stored as documents with keys "0", "1", ... which is why <code>items.0.qty</code> works in dot notation. Index keys are encoded in a type-aware, order-preserving format (KeyString) so the B-tree can compare keys as raw bytes.</p>
<div class="callout info"><b>Playground note</b>In this in-browser engine ObjectIds are stored as 24-character hex strings and printed as <code>ObjectId('...')</code>. Everything else in this lesson behaves as on a real server.</div>`
  },
  examples: [
    { title: 'ObjectId carries a timestamp', code: `const id = ObjectId()
id
id.getTimestamp()
db.orders.findOne({}, { _id: 1, createdAt: 1 })` },
    { title: 'Dates are real dates', code: `db.orders.find({ createdAt: { $gte: ISODate("2026-09-01"), $lt: ISODate("2026-10-01") } }).count()
db.orders.findOne({}, { createdAt: 1 }).createdAt.getUTCFullYear()` },
    { title: 'Query by type', code: `db.lab_types.drop()
db.lab_types.insertMany([{ v: 1 }, { v: "1" }, { v: 1.5 }, { v: null }, { v: [1, 2] }, { v: new Date() }])
db.lab_types.find({ v: { $type: "string" } }, { _id: 0 })
db.lab_types.find({ v: { $type: "date" } }, { _id: 0 })
db.lab_types.find({ v: { $gt: 0 } }, { _id: 0 })`, note: '<code>$gt: 0</code> matches the numbers and the array (an element is 1 or 2) but not the string "1": type bracketing.' },
    { title: 'Floating point vs exact decimals', code: `0.1 + 0.2
db.orders.aggregate([{ $match: { status: "delivered" } }, { $group: { _id: null, revenue: { $sum: "$total" } } }, { $project: { _id: 0, revenue: 1, rounded: { $round: ["$revenue", 2] } } }])` }
  ],
  mistakes: [
    'Dates stored as strings, epoch seconds in some documents and Date in others.',
    'Money stored as double. Use Decimal128, or integers in minor units (cents).',
    'Passing a large NumberLong as a JS number, e.g. <code>NumberLong(9007199254740993)</code>, which loses precision before it reaches the server.',
    'Assuming ObjectIds are strictly increasing. They are only roughly ordered across processes (the counter is per process).'
  ],
  interview: [
    { q: 'What is inside an ObjectId?', a: '<p>12 bytes: a 4-byte Unix timestamp in seconds, a 5-byte random value unique to the machine and process, and a 3-byte counter starting from a random value. It is generated client-side by the driver, so no coordination is needed.</p>' },
    { q: 'Why might a range query miss documents that look like they should match?', a: '<p>Type bracketing: comparison operators only match the same BSON type class. If some documents store <code>price</code> as a string, <code>{ price: { $gt: 10 } }</code> skips them. Find them with <code>{ price: { $type: "string" } }</code> and fix the data, then add a validator.</p>' }
  ],
  quiz: [
    { q: 'Which type should store currency amounts?', options: ['Double', 'String', 'Decimal128 (or integer cents)', 'Int32'], answer: 2 },
    { q: 'In BSON sort order, which comes first?', options: ['Strings', 'Numbers', 'Null', 'Dates'], answer: 2, explain: 'MinKey, then Null, then Numbers, then Strings...' },
    { q: 'What does <code>ObjectId().getTimestamp()</code> return?', options: ['The insert time recorded by the server', 'The time encoded in the first 4 bytes of the id', 'The current time', 'A Timestamp type'], answer: 1 }
  ]
},
{
  id: 'insert-documents', module: 'crud-insert', title: 'insertOne, insertMany and bulk writes', minutes: 15,
  summary: 'Create documents safely: generated ids, ordered versus unordered batches, duplicate key errors and the write result.',
  objectives: ['Insert single and multiple documents', 'Read the acknowledgement result', 'Choose ordered or unordered inserts', 'Handle E11000 duplicate key errors'],
  sections: {
    concept: `<p><code>insertOne(doc)</code> returns <code>{ acknowledged, insertedId }</code>. <code>insertMany([...], { ordered })</code> sends a batch: with <code>ordered: true</code> (default) it stops at the first error; with <code>ordered: false</code> it attempts every document and reports all errors at the end, which is faster and the usual choice for bulk loads.</p>
<p><code>bulkWrite()</code> mixes inserts, updates, replaces and deletes in one round trip. Drivers split large batches automatically (up to 100,000 operations or 48 MB per message).</p>
<p>A duplicate value in a unique index (including <code>_id</code>) fails that document with error code <b>11000</b> (<code>E11000 duplicate key error</code>).</p>`,
    why: `<p>Batching matters: inserting 100,000 documents one by one costs 100,000 network round trips and journal commits; <code>insertMany</code> with unordered batches can be orders of magnitude faster. Treating 11000 as an expected outcome is how you build idempotent ingestion.</p>`,
    useCase: `<p>A nightly import reads 2 million product records from a supplier feed. It uses <code>insertMany(batch, { ordered: false })</code> with 1,000 documents per batch, collects any duplicate-key errors into a report, and moves on rather than aborting the whole job.</p>`,
    internals: `<p>The driver adds <code>_id</code> before sending if you did not. On the server each document is a separate storage-engine write plus an oplog entry; an <code>insertMany</code> is not a transaction, so a failure part-way leaves earlier documents inserted. Wrap it in a transaction only if you truly need all-or-nothing behaviour.</p>`
  },
  examples: [
    { title: 'Insert one, insert many', code: `db.lab_people.drop()
db.lab_people.insertOne({ name: "Asha", email: "asha@example.com", skills: ["mongodb"] })
db.lab_people.insertMany([
  { name: "Ben", email: "ben@example.com" },
  { _id: "u-carla", name: "Carla", email: "carla@example.com" }
])
db.lab_people.find()` },
    { title: 'Duplicate keys: ordered vs unordered', code: `db.lab_people.createIndex({ email: 1 }, { unique: true })
db.lab_people.insertMany([
  { name: "Dev", email: "dev@example.com" },
  { name: "Ben again", email: "ben@example.com" },
  { name: "Eva", email: "eva@example.com" }
], { ordered: false })`, expectError: true, note: 'Unordered: Dev and Eva are inserted even though Ben fails. Re-run with <code>ordered: true</code> on new emails to see it stop at the first error.' },
    { title: 'Bulk write', code: `db.lab_people.deleteMany({ email: "femi@example.com" })
db.lab_people.bulkWrite([
  { insertOne: { document: { name: "Femi", email: "femi@example.com" } } },
  { updateOne: { filter: { email: "asha@example.com" }, update: { $addToSet: { skills: "aggregation" } } } },
  { deleteOne: { filter: { email: "carla@example.com" } } }
])
db.lab_people.countDocuments()` }
  ],
  mistakes: [
    'Generating your own string ids without a unique index on the natural key, then importing duplicates.',
    'Assuming <code>insertMany</code> is atomic. It is not; use idempotent keys or a transaction.',
    'Retrying a failed batch from the beginning with ordered inserts and failing on the first duplicate every time. Use unordered or upserts.'
  ],
  interview: [
    { q: 'How do you make a bulk import idempotent?', a: '<p>Give each record a deterministic key (natural key or <code>_id</code> derived from the source), enforce it with a unique index, and either insert unordered and ignore 11000 errors, or use <code>bulkWrite</code> with <code>updateOne(..., { upsert: true })</code> / <code>replaceOne</code> so re-running converges to the same state.</p>' }
  ],
  quiz: [
    { q: 'With <code>insertMany(docs, { ordered: true })</code>, what happens on a duplicate key in the 3rd document?', options: ['All documents are rolled back', 'Docs 1-2 are inserted, the batch stops', 'Only doc 3 is skipped', 'The server retries'], answer: 1 },
    { q: 'What error code means duplicate key?', options: ['121', '11000', '50', '13'], answer: 1, explain: '121 is document validation failure; 50 is MaxTimeMSExpired; 13 is Unauthorized.' }
  ]
},
{
  id: 'query-basics', module: 'crud-query', title: 'Querying: equality, comparison and logic', minutes: 20,
  summary: 'find() with filters: equality, implicit AND, comparison operators, $in, $or, and querying nested fields with dot notation.',
  objectives: ['Write equality and range filters', 'Combine conditions with implicit AND, $and, $or, $nor, $not', 'Use $in and $nin', 'Query embedded fields with dot notation'],
  sections: {
    concept: `<p>A filter is a document. Each field condition must match; listing several fields is an implicit AND.</p>
<table><tr><th>Operator</th><th>Meaning</th><th>Example</th></tr>
<tr><td><code>$eq</code> / plain value</td><td>equals</td><td><code>{ status: "paid" }</code></td></tr>
<tr><td><code>$ne</code></td><td>not equal (also matches missing)</td><td><code>{ status: { $ne: "cancelled" } }</code></td></tr>
<tr><td><code>$gt $gte $lt $lte</code></td><td>ranges</td><td><code>{ total: { $gte: 100, $lt: 500 } }</code></td></tr>
<tr><td><code>$in / $nin</code></td><td>any of / none of</td><td><code>{ status: { $in: ["paid", "shipped"] } }</code></td></tr>
<tr><td><code>$or / $and / $nor</code></td><td>logical combinations</td><td><code>{ $or: [{ a: 1 }, { b: 2 }] }</code></td></tr>
<tr><td><code>$not</code></td><td>negates an operator expression</td><td><code>{ total: { $not: { $gt: 100 } } }</code></td></tr></table>
<p>Use <b>dot notation</b> for embedded fields: <code>{ "shipping.city": "Pune" }</code>. Matching a whole embedded document (<code>{ shipping: { city: "Pune", country: "India" } }</code>) requires an exact match including field order, so prefer dot notation.</p>
<p>You need explicit <code>$and</code> only when the same field or operator appears twice, for example two <code>$or</code> clauses.</p>`,
    why: `<p>Every read in your application is one of these filters. Writing them precisely affects correctness (<code>$ne</code> also matches documents where the field is missing) and performance (equality on indexed fields is the cheapest possible predicate).</p>`,
    useCase: `<p>Customer support searches for orders that are <i>paid or shipped</i>, over 1,000, shipped to Mumbai: <code>{ status: { $in: ["paid", "shipped"] }, total: { $gt: 1000 }, "shipping.city": "Mumbai" }</code>.</p>`,
    internals: `<p>The server parses the filter into a match expression tree and normalizes it (for example, <code>$in</code> with one value becomes equality, nested <code>$and</code> are flattened). The query planner then looks for indexes whose prefix matches equality and range predicates. <code>$or</code> can use a different index per branch (an OR stage). Predicates like <code>$ne</code>, <code>$nin</code> and <code>$not</code> are poorly selective and rarely benefit from an index.</p>`
  },
  examples: [
    { title: 'Equality and implicit AND', code: `db.orders.find({ status: "paid", "payment.method": "upi" }, { orderNo: 1, total: 1, _id: 0 }).limit(3)
db.orders.countDocuments({ status: "paid", "payment.method": "upi" })` },
    { title: 'Ranges and $in', code: `db.orders.countDocuments({ total: { $gte: 100, $lt: 200 } })
db.orders.countDocuments({ status: { $in: ["paid", "shipped"] } })
db.customers.find({ tier: { $in: ["gold", "platinum"] }, "address.country": "UK" }, { name: 1, tier: 1 }).limit(5)` },
    { title: '$or, $and and $nor', code: `db.orders.countDocuments({ $or: [{ status: "returned" }, { total: { $gt: 3000 } }] })
db.orders.countDocuments({
  $and: [
    { $or: [{ status: "delivered" }, { status: "shipped" }] },
    { $or: [{ "payment.method": "cod" }, { couponCode: { $exists: true } }] }
  ]
})
db.orders.countDocuments({ $nor: [{ status: "cancelled" }, { status: "returned" }] })` },
    { title: '$ne matches missing fields', code: `db.orders.countDocuments({ couponCode: { $ne: "WELCOME10" } })
db.orders.countDocuments({ couponCode: { $exists: true, $ne: "WELCOME10" } })`, note: 'Most orders have no couponCode at all, and <code>$ne</code> counts them too.' }
  ],
  mistakes: [
    'Writing <code>{ total: { $gt: 100 }, total: { $lt: 500 } }</code>. In JavaScript the second key overwrites the first; combine them: <code>{ total: { $gt: 100, $lt: 500 } }</code>.',
    'Matching embedded documents by full value when you meant dot notation.',
    'Using <code>$or</code> on the same field instead of <code>$in</code>; <code>$in</code> is simpler and plans better.',
    'Forgetting that <code>$ne</code> and <code>$nin</code> match documents where the field does not exist.'
  ],
  interview: [
    { q: 'When do you need an explicit $and?', a: '<p>When the same field or the same operator must appear more than once in one filter, for example two separate <code>$or</code> groups, or two <code>$expr</code> conditions. Otherwise listing conditions side by side is already an AND.</p>' },
    { q: 'What is the difference between {a: {b: 1}} and {"a.b": 1}?', a: '<p>The first matches only documents where <code>a</code> is exactly <code>{ b: 1 }</code> with no other fields and the same field order. The second matches any document whose <code>a.b</code> equals 1, regardless of other fields in <code>a</code>.</p>' }
  ],
  quiz: [
    { q: 'Which filter returns orders with total between 100 (inclusive) and 500 (exclusive)?', options: ['{ total: { $gt: 100, $lt: 500 } }', '{ total: { $gte: 100, $lt: 500 } }', '{ total: { $gte: 100 }, total: { $lt: 500 } }', '{ $or: [{ total: { $gte: 100 } }, { total: { $lt: 500 } }] }'], answer: 1 },
    { q: 'Does <code>{ couponCode: { $ne: "X" } }</code> match documents without a couponCode field?', options: ['Yes', 'No', 'Only if an index exists', 'Only in aggregation'], answer: 0 }
  ]
},
{
  id: 'query-operators', module: 'crud-query', title: 'Missing fields, null, $type, $regex and $expr', minutes: 18,
  summary: 'The subtle operators: how null matches missing fields, existence checks, pattern matching, and comparing two fields of the same document.',
  objectives: ['Distinguish null from missing', 'Use $exists and $type', 'Write efficient, anchored regular expressions', 'Compare fields within a document using $expr'],
  sections: {
    concept: `<ul>
<li><code>{ phone: null }</code> matches documents where <code>phone</code> is null <b>or missing</b>.</li>
<li><code>{ phone: { $exists: false } }</code> matches only missing; <code>{ phone: { $type: "null" } }</code> only explicit null.</li>
<li><code>$regex</code>: <code>{ name: /^Ar/ }</code>. A case-sensitive regex anchored with <code>^</code> can use an index as a range scan; unanchored or case-insensitive regexes scan every index key or document.</li>
<li><code>$expr</code> lets you use aggregation expressions in a filter, for example comparing two fields: <code>{ $expr: { $gt: ["$discount", { $multiply: ["$total", 0.15] }] } }</code>.</li>
<li><code>$where</code> runs JavaScript per document: slow, disabled in many deployments, avoid it.</li>
</ul>`,
    why: `<p>Null semantics are a classic source of bugs in reports ("customers without a phone" returns the wrong count). Regex and <code>$expr</code> are powerful but easy to make expensive, so you should know which forms can use indexes.</p>`,
    useCase: `<p>A data-quality job finds customers with no phone (<code>$exists: false</code>), orders whose discount exceeds 15% of the total (<code>$expr</code>), and emails that do not end with a valid domain (<code>$not: /@example\\.com$/</code>).</p>`,
    internals: `<p>An index stores missing fields as null, so <code>{ field: null }</code> can use an index, but the server must fetch documents to tell null from missing when it matters. <code>$expr</code> with simple equality on a field can use an index since 5.0; comparisons between two fields cannot, because the bound depends on each document.</p>`
  },
  examples: [
    { title: 'null versus missing', code: `db.customers.countDocuments({ phone: null })
db.customers.countDocuments({ phone: { $exists: false } })
db.products.countDocuments({ "attributes.powerWatts": null })
db.products.countDocuments({ "attributes.powerWatts": { $type: "null" } })` },
    { title: 'Regular expressions', code: `db.customers.find({ name: /^Ar/ }, { name: 1, _id: 0 }).limit(5)
db.customers.countDocuments({ email: { $regex: "reddy", $options: "i" } })
db.products.find({ name: /pro$/i }, { name: 1, _id: 0 }).limit(5)` },
    { title: 'Compare two fields with $expr', code: `db.orders.find(
  { $expr: { $gt: ["$discount", { $multiply: ["$total", 0.099] }] } },
  { orderNo: 1, total: 1, discount: 1, _id: 0 }
).limit(3)
db.products.countDocuments({ $expr: { $lt: ["$stock", 5] } })` }
  ],
  mistakes: [
    'Using <code>{ field: null }</code> when you meant "explicitly null" or "missing" only.',
    'Unanchored, case-insensitive regex on large collections: a full scan every time. Store a normalized lowercase copy and query it with an anchored regex, or use a text or search index.',
    'Using <code>$where</code> for logic that <code>$expr</code> can express.'
  ],
  interview: [
    { q: 'Can a regex query use an index?', a: '<p>Yes, efficiently only when it is a case-sensitive prefix expression (<code>/^abc/</code>): the planner turns the prefix into a tight index range. Other regexes can still scan the index keys instead of documents (cheaper than a COLLSCAN if the field is indexed) but examine every key. Case-insensitive search is better served by a collation index or a normalized field.</p>' }
  ],
  quiz: [
    { q: '<code>{ phone: null }</code> matches...', options: ['Only explicit null', 'Only missing', 'Null or missing', 'Empty strings'], answer: 2 },
    { q: 'Which regex can use an index as a tight range?', options: ['/abc/', '/^abc/', '/^abc/i', '/abc$/'], answer: 1 }
  ]
},
{
  id: 'projection-sort-pagination', module: 'projection-sort', title: 'Projection, sorting and pagination', minutes: 20,
  summary: 'Return only what you need, sort deterministically, and paginate without the skip trap.',
  objectives: ['Use inclusion and exclusion projections', 'Project array slices and matching elements', 'Sort on multiple fields deterministically', 'Implement keyset (range-based) pagination'],
  sections: {
    concept: `<p><b>Projection</b> is the second argument to <code>find</code>: <code>{ name: 1, email: 1 }</code> (inclusion) or <code>{ items: 0 }</code> (exclusion). You cannot mix them except for <code>_id: 0</code>. Array helpers: <code>{ items: { $slice: 2 } }</code>, <code>{ items: { $elemMatch: { qty: { $gte: 3 } } } }</code>.</p>
<p><b>Sort</b> with <code>.sort({ total: -1, _id: 1 })</code>. Without a sort, order is not guaranteed. Include a unique tiebreaker (usually <code>_id</code>) so pages are stable.</p>
<p><b>Pagination</b>: <code>skip(n)</code> still walks past n documents, so page 5,000 is slow. <b>Keyset pagination</b> remembers the last value seen and asks for the next range: <code>find({ createdAt: { $lt: lastSeen } }).sort({ createdAt: -1 }).limit(20)</code>, with an index on the sort field.</p>`,
    why: `<p>Projection reduces network traffic and memory, and enables covered queries. Unstable sorting causes duplicates or gaps between pages. Deep <code>skip</code> is one of the most common causes of slow APIs.</p>`,
    useCase: `<p>An admin order list shows 20 orders per page, newest first. Instead of <code>?page=812</code> with <code>skip(16220)</code>, the API returns <code>nextCursor = { createdAt, _id }</code> of the last row and the next request filters past it.</p>`,
    internals: `<p>A sort that an index cannot provide becomes a blocking <b>SORT</b> stage limited to 100 MB of memory (it spills to disk if <code>allowDiskUse</code> is enabled, the default since 6.0 for find). With <code>sort + limit</code>, the server keeps only the top N documents in memory (a top-k sort), which is much cheaper.</p>`
  },
  examples: [
    { title: 'Projection', code: `db.orders.findOne({}, { orderNo: 1, total: 1, "shipping.city": 1, _id: 0 })
db.orders.findOne({}, { items: 0, payment: 0 })
db.orders.findOne({ "items.2": { $exists: true } }, { orderNo: 1, items: { $slice: 1 } })` },
    { title: 'Deterministic sort', code: `db.products.find({}, { name: 1, rating: 1 }).sort({ rating: -1, _id: 1 }).limit(5)` },
    { title: 'skip/limit vs keyset pagination', code: `// page 3 with skip
db.orders.find({}, { orderNo: 1, createdAt: 1 }).sort({ createdAt: -1, _id: -1 }).skip(40).limit(3)

// keyset: remember the last row of the previous page
const page1 = db.orders.find({}, { orderNo: 1, createdAt: 1 }).sort({ createdAt: -1, _id: -1 }).limit(3).toArray()
const last = page1[page1.length - 1]
db.orders.find({ $or: [
  { createdAt: { $lt: last.createdAt } },
  { createdAt: last.createdAt, _id: { $lt: last._id } }
] }, { orderNo: 1, createdAt: 1 }).sort({ createdAt: -1, _id: -1 }).limit(3)` },
    { title: 'Counting', code: `db.orders.estimatedDocumentCount()
db.orders.countDocuments({ status: "delivered" })` }
  ],
  mistakes: [
    'Mixing inclusion and exclusion (<code>{ name: 1, items: 0 }</code>), which is an error.',
    'Paginating with <code>skip</code> on large offsets.',
    'Sorting on a non-unique field only, so ties come back in a different order on each page.',
    'Using <code>countDocuments()</code> on every page view of a huge collection; consider an estimate or a cached count.'
  ],
  interview: [
    { q: 'Why is skip-based pagination slow and what do you use instead?', a: '<p><code>skip(n)</code> must examine and discard n index keys or documents before returning results, so latency grows linearly with the page number. Keyset pagination filters on the last seen sort key (plus <code>_id</code> as tiebreaker) and uses an index on that key, so every page costs the same.</p>' },
    { q: 'countDocuments vs estimatedDocumentCount?', a: '<p><code>estimatedDocumentCount()</code> reads collection metadata: instant, no filter, can be slightly off after an unclean shutdown or with orphans in sharded clusters. <code>countDocuments(filter)</code> runs an aggregation and is exact, but costs a scan of matching index keys or documents.</p>' }
  ],
  quiz: [
    { q: 'Which projection is invalid?', options: ['{ name: 1, _id: 0 }', '{ items: 0 }', '{ name: 1, items: 0 }', '{ items: { $slice: 2 } }'], answer: 2 },
    { q: 'What makes keyset pagination fast?', options: ['It uses skip internally', 'It seeks into an index from the last seen key', 'It caches pages', 'It counts documents first'], answer: 1 }
  ]
},
{
  id: 'update-operators', module: 'crud-update', title: 'Update operators, upserts and replacements', minutes: 22,
  summary: 'Modify documents atomically with update operators, create-or-update with upserts, and read the result counters correctly.',
  objectives: ['Use $set, $unset, $inc, $mul, $min, $max, $rename, $currentDate', 'Distinguish updateOne, updateMany and replaceOne', 'Use upsert with $setOnInsert', 'Use findOneAndUpdate to update and read atomically'],
  sections: {
    concept: `<table><tr><th>Operator</th><th>Effect</th></tr>
<tr><td><code>$set</code> / <code>$unset</code></td><td>set or remove fields (dot notation creates nested fields)</td></tr>
<tr><td><code>$inc</code> / <code>$mul</code></td><td>add to / multiply a number (creates the field with $inc)</td></tr>
<tr><td><code>$min</code> / <code>$max</code></td><td>update only if the new value is lower / higher</td></tr>
<tr><td><code>$rename</code></td><td>rename a field</td></tr>
<tr><td><code>$currentDate</code></td><td>set to the server's current date</td></tr>
<tr><td><code>$setOnInsert</code></td><td>set only when an upsert inserts</td></tr></table>
<p><code>updateOne</code> changes the first match, <code>updateMany</code> all matches, <code>replaceOne</code> swaps the whole document (keeping <code>_id</code>). The result reports <code>matchedCount</code>, <code>modifiedCount</code> (0 if values were already equal) and <code>upsertedId</code>.</p>
<p><b>Upsert</b>: <code>{ upsert: true }</code> inserts a new document built from the equality fields of the filter plus the update if nothing matches. <code>findOneAndUpdate</code> returns the document before or after the change in the same atomic operation.</p>
<p>Since 4.2 an update can be an <b>aggregation pipeline</b> (an array), which allows computing fields from other fields: <code>[{ $set: { total: { $sum: "$items.price" } } }]</code>.</p>`,
    why: `<p>Update operators modify a document atomically on the server, so concurrent requests incrementing a counter never lose updates. Read-modify-write in application code (read, change in memory, replace) is a classic race condition.</p>`,
    useCase: `<p>A page-view counter: <code>updateOne({ _id: pageId }, { $inc: { views: 1 }, $setOnInsert: { createdAt: new Date() } }, { upsert: true })</code>. Thousands of concurrent requests produce the exact count, and the first one creates the document.</p>`,
    internals: `<p>Each single-document update is atomic: WiredTiger applies it in one storage transaction along with index updates and the oplog entry. The oplog records the <b>result</b> (for example <code>$set: { views: 42 }</code> in a diff format), not <code>$inc</code>, so replaying it is idempotent. Upserts on the same key from concurrent clients can race; a unique index on the filter field turns the loser into a duplicate-key error, which drivers and the server retry for you in many cases since 4.2.</p>`
  },
  examples: [
    { title: '$set, $inc, $unset', code: `db.customers.updateOne({ _id: 10 }, { $set: { tier: "gold", "address.zip": "500081" }, $inc: { points: 50 } })
db.customers.updateOne({ _id: 10 }, { $unset: { marketingOptIn: "" } })
db.customers.findOne({ _id: 10 }, { tier: 1, points: 1, address: 1, marketingOptIn: 1 })` },
    { title: '$min, $max, $mul, $currentDate', code: `db.products.updateOne({ _id: "P001" }, { $max: { rating: 4.9 }, $mul: { price: 1.1 }, $currentDate: { updatedAt: true } })
db.products.findOne({ _id: "P001" }, { price: 1, rating: 1, updatedAt: 1 })` },
    { title: 'Upsert with $setOnInsert', code: `db.lab_counters.updateOne(
  { _id: "page:/pricing" },
  { $inc: { views: 1 }, $setOnInsert: { firstSeen: new Date() } },
  { upsert: true }
)
db.lab_counters.updateOne({ _id: "page:/pricing" }, { $inc: { views: 1 }, $setOnInsert: { firstSeen: new Date() } }, { upsert: true })
db.lab_counters.find()` },
    { title: 'updateMany and matched vs modified', code: `db.orders.updateMany({ status: "pending", createdAt: { $lt: ISODate("2025-01-01") } }, { $set: { status: "expired" } })
db.orders.updateMany({ status: "expired" }, { $set: { status: "expired" } })`, note: 'The second update matches documents but modifies none, because the value is already set.' },
    { title: 'findOneAndUpdate', code: `db.products.findOneAndUpdate(
  { _id: "P002", stock: { $gte: 1 } },
  { $inc: { stock: -1 } },
  { returnDocument: "after", projection: { name: 1, stock: 1 } }
)` },
    { title: 'Pipeline update', code: `db.orders.updateOne(
  { orderNo: "ORD-100010" },
  [{ $set: { itemCount: { $sum: "$items.qty" }, recalculatedAt: "$$NOW" } }]
)
db.orders.findOne({ orderNo: "ORD-100010" }, { itemCount: 1, recalculatedAt: 1 })` }
  ],
  mistakes: [
    'Passing a plain document to <code>updateOne</code> (<code>{ status: "x" }</code>) instead of <code>{ $set: { status: "x" } }</code>; modern drivers reject it, old ones replaced the whole document.',
    'Read-modify-write races instead of <code>$inc</code> or <code>findOneAndUpdate</code>.',
    'Upserting on a filter with no unique index, which can create duplicates under concurrency.',
    'Using <code>$set</code> and <code>$unset</code> on the same path in one update (a conflict error).'
  ],
  interview: [
    { q: 'How do you implement an atomic counter or sequence?', a: '<p><code>findOneAndUpdate({ _id: "orders" }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" })</code>. The increment is atomic per document. Note it serializes all writers on one document, so for high throughput prefer ObjectIds or pre-allocated ranges.</p>' },
    { q: 'What is the difference between matchedCount and modifiedCount?', a: '<p><code>matchedCount</code> is how many documents the filter selected; <code>modifiedCount</code> is how many actually changed. If the update sets values that are already present, the document is matched but not modified, and no oplog entry is written for it.</p>' }
  ],
  quiz: [
    { q: 'Which operator sets a field only when an upsert creates a new document?', options: ['$set', '$setOnInsert', '$currentDate', '$init'], answer: 1 },
    { q: 'Why is $inc safer than reading, adding and replacing?', options: ['It is faster to type', 'It is applied atomically on the server', 'It bypasses validation', 'It does not write to the oplog'], answer: 1 },
    { q: 'What does <code>replaceOne</code> do with the existing _id?', options: ['Generates a new one', 'Keeps it', 'Removes it', 'Requires you to change it'], answer: 1 }
  ]
},
{
  id: 'delete-documents', module: 'crud-update', title: 'Deleting data safely', minutes: 12,
  summary: 'deleteOne, deleteMany, drop, TTL expiry and soft deletes, plus a checklist for destructive operations in production.',
  objectives: ['Delete with precise filters', 'Choose between deleteMany, drop and TTL indexes', 'Implement soft deletes', 'Follow a safe procedure for bulk deletes'],
  sections: {
    concept: `<ul>
<li><code>deleteOne(filter)</code>: removes the first match. <code>deleteMany(filter)</code>: removes all matches. <code>deleteMany({})</code> empties the collection but keeps indexes and options.</li>
<li><code>drop()</code>: removes the collection, its indexes and its metadata; much faster than deleting every document.</li>
<li><b>TTL indexes</b> delete documents automatically after a date field is older than <code>expireAfterSeconds</code> (a background task runs every 60 seconds).</li>
<li><b>Soft delete</b>: set <code>deletedAt</code> instead of deleting, and filter it out (often with a partial index).</li>
</ul>`,
    why: `<p>Deletes are irreversible without a backup. Large deletes also generate one oplog entry per document, increase replication lag, and leave free space inside data files rather than returning it to the OS.</p>`,
    useCase: `<p>Purging 30 million old events: instead of one giant <code>deleteMany</code>, a job deletes in batches of 10,000 by <code>_id</code> range during off-peak hours while watching replication lag, or better, the data was designed with a TTL index or one collection per month so old data is removed with a cheap <code>drop()</code>.</p>`,
    internals: `<p>Each deleted document removes index entries and adds an oplog entry. WiredTiger marks the space as reusable inside the file; <code>compact</code> (online since 4.4) or an initial sync is needed to give space back to the filesystem.</p>`
  },
  examples: [
    { title: 'Preview, then delete', code: `db.lab_people.find({ email: /example\\.com$/ }, { name: 1, email: 1 })
db.lab_people.countDocuments({ name: /^B/ })
db.lab_people.deleteMany({ name: /^B/ })
db.lab_people.countDocuments()` },
    { title: 'Soft delete', code: `db.customers.updateOne({ _id: 25 }, { $set: { deletedAt: new Date() } })
db.customers.countDocuments({ deletedAt: { $exists: false } })` },
    { title: 'TTL index', code: `db.lab_sessions.drop()
db.lab_sessions.createIndex({ lastSeen: 1 }, { expireAfterSeconds: 3600 })
db.lab_sessions.insertMany([
  { user: 1, lastSeen: new Date(Date.now() - 2 * 3600 * 1000) },
  { user: 2, lastSeen: new Date() }
])
db.lab_sessions.getIndexes()`, note: 'Run <code>db.lab_sessions.find()</code> again: the simulator runs the TTL monitor before each run, so the 2-hour-old session disappears, just as mongod removes it within about a minute.' }
  ],
  mistakes: [
    'Running <code>deleteMany</code> with a filter you never tested with <code>find</code>/<code>countDocuments</code>.',
    'Typing <code>deleteMany({})</code> in the wrong database or collection.',
    'Expecting TTL deletion to be immediate; it runs every 60 seconds and can fall behind under heavy load.',
    'Deleting tens of millions of documents in one call and causing replication lag.'
  ],
  interview: [
    { q: 'How would you remove 500 million old documents from a busy production collection?', a: '<p>Prefer designs that make it cheap: time-partitioned collections you can <code>drop()</code>, or a TTL index going forward. For a one-off purge, delete in bounded batches (by <code>_id</code> or date ranges using an index), throttle based on replication lag and cache dirty percentage, run off-peak, and take a backup first. Expect the files not to shrink until you run <code>compact</code> or resync members.</p>' }
  ],
  quiz: [
    { q: 'What is the fastest way to remove all data from a collection you no longer need?', options: ['deleteMany({})', 'drop()', 'A TTL index', 'remove()'], answer: 1 },
    { q: 'How often does the TTL monitor run by default?', options: ['Every second', 'Every 60 seconds', 'Hourly', 'Only at startup'], answer: 1 }
  ]
}
]);
