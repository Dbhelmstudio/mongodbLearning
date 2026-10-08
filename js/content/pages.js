/* Long-form guide pages, playground snippets and the cheat sheet. Runnable blocks use <pre class="run"> and execute against the seeded shop database. */
MM.PAGES.architecture = {
  title: 'MongoDB architecture',
  intro: 'How the pieces fit together, from one document to a multi-region sharded cluster. Each section has a diagram or an interactive simulator you can play with.',
  sections: [
  { id: 'big-picture', title: 'The big picture', html: `
<p>A MongoDB deployment is built from three kinds of processes:</p>
<ul><li><b>mongod</b>: the database server. It owns data files, the WiredTiger storage engine, indexes, the query engine and replication.</li>
<li><b>mongos</b>: a stateless router used only in sharded clusters. Applications connect to it; it routes each operation to the right shard(s) and merges results.</li>
<li><b>Config servers</b>: a replica set of mongod processes holding cluster metadata, such as which shard owns which range of each sharded collection.</li></ul>
<p>Every production building block is a <b>replica set</b> (usually three members). A sharded cluster is several replica sets (the shards) plus a config server replica set plus mongos routers.</p>
<table><tr><th>Topology</th><th>Use it when</th><th>Trade-off</th></tr>
<tr><td>Standalone</td><td>Local development only</td><td>No redundancy, no transactions, no change streams</td></tr>
<tr><td>Replica set</td><td>Almost every production workload</td><td>Write capacity limited to one primary</td></tr>
<tr><td>Sharded cluster</td><td>Data or write volume beyond one replica set, or data residency</td><td>Shard key choice and operational complexity</td></tr></table>` },
  { id: 'documents', title: 'Documents, collections and BSON', html: `
<div data-diagram="document-model"></div>
<p>A <b>document</b> is an ordered set of field-value pairs stored as BSON, up to 16 MB. A <b>collection</b> groups documents; a <b>database</b> groups collections. The schema is flexible, but in practice each collection has a shape, which you can enforce with <code>$jsonSchema</code> validation.</p>
<pre class="run" data-title="One order document, the unit of reads and writes">db.orders.findOne({}, { orderNo: 1, status: 1, items: { $slice: 2 }, shipping: 1, total: 1 })</pre>
<p>Each collection and each index is a separate WiredTiger table (file) on disk. That is why ten thousand tiny collections cost more than one large one.</p>` },
  { id: 'storage', title: 'Storage engine: WiredTiger', html: `
<div data-diagram="wiredtiger"></div>
<p>WiredTiger keeps hot data uncompressed in its cache, writes changes to a write-ahead journal, and every 60 seconds writes a consistent <b>checkpoint</b> to compressed data files. Readers use MVCC snapshots, so readers and writers rarely block each other; document-level concurrency means two writers conflict only on the same document.</p>
<p>Step through what happens to one write:</p>
<div data-widget="write-path"></div>` },
  { id: 'replication', title: 'Replica sets and elections', html: `
<div data-diagram="replica-set"></div>
<p>The primary receives all writes and records them in the oplog. Secondaries pull the oplog from a sync source and apply it in batches. If the primary becomes unreachable for <code>electionTimeoutMillis</code> (10 s by default), an eligible secondary runs for election; it needs votes from a majority of voting members and an oplog that is at least as fresh as each voter's.</p>
<p>Use the simulator: kill the primary, partition members, and watch which writes survive with <code>w: 1</code> versus <code>w: "majority"</code>.</p>
<div data-widget="rs-sim"></div>
<pre class="run" data-title="Replica set status in the simulated shell">rs.status().members.map(m => ({ name: m.name, state: m.stateStr, health: m.health }))</pre>` },
  { id: 'oplog', title: 'The oplog', html: `
<div data-diagram="oplog"></div>
<p>The oplog is a capped collection, <code>local.oplog.rs</code>, of idempotent operations. Its time window decides how long a secondary or a backup tool can fall behind and still catch up. Size it from your write rate:</p>
<div data-widget="oplog-calc"></div>
<pre class="run" data-title="Make a write, then read its oplog entry">db.products.updateOne({ _id: "P001" }, { $inc: { stock: 1 } })
db.getSiblingDB("local").oplog.rs.find({ ns: "shop.products" }).sort({ $natural: -1 }).limit(1)</pre>` },
  { id: 'sharding', title: 'Sharding', html: `
<div data-diagram="sharded-cluster"></div>
<p>A sharded collection is split into <b>ranges</b> (chunks) of shard-key values. The config servers record which shard owns each range; mongos caches this routing table. Queries with the shard key go to one shard (targeted); others go to all shards (scatter-gather). The balancer moves ranges to even out data size per shard.</p>
<p>Pick a shard key and insert data to see distribution, hot spots and targeting:</p>
<div data-widget="shard-sim"></div>` },
  { id: 'change-streams', title: 'Change streams and CDC', html: `
<div data-diagram="change-stream"></div>
<p>Change streams expose the oplog as a filtered, resumable cursor. Events are delivered only after they are majority-committed, so consumers never see a change that is later rolled back. Every event carries a resume token; store it after processing and resume from it after a restart, as long as the position is still inside the oplog window.</p>` },
  { id: 'kubernetes', title: 'MongoDB on Kubernetes', html: `
<div data-diagram="k8s-operator"></div>
<p>An operator turns a custom resource (desired topology, version, storage, backups) into StatefulSets, Services, Secrets and PersistentVolumeClaims, and handles the database-aware parts: adding members to the replica set, rolling restarts one member at a time with a stepdown, and backup scheduling. Spread members across nodes and zones with anti-affinity, protect them with a PodDisruptionBudget, and set the WiredTiger cache explicitly from the container memory limit.</p>` },
  { id: 'request-path', title: 'Request path, end to end', html: `
<ol><li>The driver picks a server using the read preference and its topology view (it monitors every member).</li>
<li>It checks out a pooled connection and sends the command with the session, cluster time and read / write concern.</li>
<li>In a sharded cluster, mongos uses its routing table to target shards and, if needed, merges and sorts results.</li>
<li>On mongod, the query planner chooses a plan (from the plan cache or by racing candidates), and the execution engine (classic or slot-based) reads WiredTiger through a snapshot.</li>
<li>Writes are applied in a storage transaction, logged to the journal and the oplog together, and acknowledged according to the write concern.</li></ol>` }
  ]
};

MM.PAGES.performance = {
  title: 'Performance tuning',
  intro: 'A repeatable workflow: measure, find the top query shapes, fix them with indexes or schema changes, and verify with explain(). Every runnable example works against the seeded data.',
  sections: [
  { id: 'method', title: 'The method', html: `
<ol><li><b>Measure</b>: latency percentiles, operations per second, slow-query log, cache and disk metrics.</li>
<li><b>Rank</b>: group slow operations by query shape and sort by total time (count times average), not by worst single execution.</li>
<li><b>Explain</b>: read <code>executionStats</code> for the top shapes.</li>
<li><b>Fix</b>: index, rewrite, or remodel; one change at a time.</li>
<li><b>Verify</b>: explain again, then compare production metrics.</li></ol>
<div class="callout tip"><b>Rule of thumb</b>Healthy queries examine roughly as many index keys and documents as they return. A ratio of 100:1 or a COLLSCAN on a large collection is the first thing to fix.</div>` },
  { id: 'explain', title: 'Reading explain()', html: `
<pre class="run" data-title="A collection scan">db.orders.find({ "shipping.city": "Pune", status: "delivered" }).explain("executionStats")</pre>
<p>Look at the winning plan (COLLSCAN or IXSCAN, any SORT stage, FETCH with a residual filter) and at <code>nReturned</code>, <code>totalKeysExamined</code>, <code>totalDocsExamined</code>. Now add an index and compare:</p>
<pre class="run" data-title="Fix and verify">db.orders.createIndex({ "shipping.city": 1, status: 1 })
db.orders.find({ "shipping.city": "Pune", status: "delivered" }).explain("executionStats").executionStats</pre>` },
  { id: 'esr', title: 'Compound indexes and the ESR rule', html: `
<div data-diagram="esr"></div>
<p>Order compound index fields as Equality, then Sort, then Range. Try both orders and watch keys examined and the SORT stage:</p>
<div data-widget="esr-lab"></div>` },
  { id: 'index-strategy', title: 'Index strategy', html: `
<ul><li>Index for your top query shapes, not for every field. Each index costs RAM, disk and write latency.</li>
<li>Prefer one well-ordered compound index over several single-field ones; a compound index also serves its prefixes, so <code>{ a: 1 }</code> is redundant next to <code>{ a: 1, b: 1 }</code>.</li>
<li>Use partial indexes for queries that always target a subset (active users, unpaid orders).</li>
<li>Find unused indexes with <code>$indexStats</code> over a full business cycle; hide them before dropping.</li>
<li>Cover hot read paths when practical: include the projected fields and exclude <code>_id</code>.</li></ul>
<pre class="run" data-title="Which indexes are used?">db.orders.aggregate([{ $indexStats: {} }, { $project: { name: 1, ops: "$accesses.ops" } }])</pre>` },
  { id: 'aggregation', title: 'Aggregation performance', html: `
<ul><li>Start with <code>$match</code> (and <code>$sort</code>) that can use an index; everything after a <code>$group</code> or <code>$project</code> runs in memory.</li>
<li>Project or <code>$unset</code> large fields early so fewer bytes flow through the pipeline.</li>
<li>Give <code>$lookup</code> an index on the foreign field; prefer the localField / foreignField form.</li>
<li><code>$sort</code> followed by <code>$limit</code> becomes a top-k sort that keeps only k documents in memory.</li>
<li>Blocking stages are limited to 100 MB each before spilling to disk; spilling works but is slow.</li></ul>
<pre class="run" data-title="Top 3 cities by delivered revenue">db.orders.aggregate([
  { $match: { status: "delivered" } },
  { $group: { _id: "$shipping.city", revenue: { $sum: "$total" } } },
  { $sort: { revenue: -1 } },
  { $limit: 3 },
  { $set: { revenue: { $round: ["$revenue", 2] } } }
])</pre>` },
  { id: 'schema', title: 'Schema for performance', html: `
<p>The fastest query is the one that reads one document. Embed data that is read together, use the extended-reference pattern for the few foreign fields you display, keep arrays bounded (subset or bucket patterns), and precompute expensive aggregates (computed pattern). Avoid documents that grow without limit; they get rewritten and cached as a whole.</p>` },
  { id: 'memory', title: 'Memory and capacity', html: `
<p>Performance falls off a cliff when the working set (hot indexes plus hot documents) no longer fits in the WiredTiger cache. Estimate it before you buy hardware:</p>
<div data-widget="sizing"></div>
<pre class="run" data-title="Sizes from the seeded data">const s = db.orders.stats();
({ count: s.count, avgObjSize: s.avgObjSize, dataSize: s.size, indexes: s.totalIndexSize })</pre>` },
  { id: 'slow-queries', title: 'Finding slow queries', html: `
<pre class="run" data-title="Profile one database, then read the worst operations">db.setProfilingLevel(1, { slowms: 0 })
db.orders.find({ total: { $gt: 4000 } }).toArray().length
db.system.profile.find({}, { op: 1, ns: 1, millis: 1, planSummary: 1, docsExamined: 1 }).sort({ millis: -1 }).limit(3)</pre>
<p>In production use a threshold or sample rate instead of <code>slowms: 0</code>, prefer the slow-query log for history, and use <code>$currentOp</code> for operations running right now.</p>` },
  { id: 'checklist', title: 'Production checklist', html: `
<table><tr><th>Area</th><th>Check</th></tr>
<tr><td>Queries</td><td>No COLLSCAN on large collections; examined-to-returned close to 1; no in-memory SORT on hot paths</td></tr>
<tr><td>Indexes</td><td>ESR-ordered compound indexes; no unused or redundant indexes; index size fits in cache</td></tr>
<tr><td>Cache</td><td>Dirty under 5% normally; application-thread eviction near zero</td></tr>
<tr><td>Disk</td><td>XFS, SSD/NVMe, latency under a few ms, at least 30% free</td></tr>
<tr><td>Connections</td><td>Pool size times app instances within budget; maxTimeMS / timeouts set</td></tr>
<tr><td>Replication</td><td>Lag well below the oplog window; majority writes</td></tr>
<tr><td>Host</td><td>Swappiness low, NUMA interleave or disabled, ulimits raised, THP per version guidance</td></tr></table>` }
  ]
};

MM.PAGES.internals = {
  title: 'Internals deep dive',
  intro: 'What happens below the API: BSON layout, B-trees, MVCC, checkpoints, the query planner, the oplog, elections, chunk migrations and distributed transactions.',
  sections: [
  { id: 'bson', title: 'BSON on the wire and on disk', html: `
<p>A BSON document starts with a 4-byte total length, then a sequence of elements (1-byte type, field name as a C string, value) and a terminating zero byte. Because every embedded document and string is length-prefixed, the server can skip fields without parsing them. Field names are stored in every document, so very long names cost real space at scale (compression recovers much of it on disk, not in cache).</p>
<pre class="run" data-title="Measure document size">db.orders.aggregate([{ $limit: 3 }, { $project: { orderNo: 1, bytes: { $bsonSize: "$$ROOT" } } }])</pre>` },
  { id: 'btree', title: 'B-tree indexes', html: `
<div data-diagram="btree"></div>
<p>Collections and indexes are WiredTiger B-trees. An index maps key values (with a record id) in sorted order, so equality and range predicates become a seek plus a sequential scan, and sort order comes for free. Keys use prefix compression in memory and on disk. Multikey indexes store one key per array element, which is why they grow quickly with large arrays.</p>` },
  { id: 'mvcc', title: 'MVCC, snapshots and checkpoints', html: `
<p>WiredTiger keeps multiple versions of each updated record in memory as update chains. Each operation reads at a snapshot timestamp, so readers see a consistent view without locks. Old versions can be discarded only when no snapshot needs them, which is why long-running transactions or cursors increase cache pressure.</p>
<p>Durability has two parts: the <b>journal</b> (write-ahead log, flushed every 100 ms or on <code>j: true</code>) and <b>checkpoints</b> (a consistent on-disk snapshot every 60 s). Recovery opens the last checkpoint and replays the journal. Since 4.0 the "majority committed" point (stable timestamp) bounds what checkpoints contain, which keeps rollback safe.</p>` },
  { id: 'cache', title: 'Cache and eviction', html: `
<table><tr><th>Threshold</th><th>Default</th><th>Effect</th></tr>
<tr><td>eviction_target</td><td>80% used</td><td>Background eviction threads start</td></tr>
<tr><td>eviction_trigger</td><td>95% used</td><td>Application threads help with eviction (latency)</td></tr>
<tr><td>eviction_dirty_target</td><td>5% dirty</td><td>Background writes of dirty pages</td></tr>
<tr><td>eviction_dirty_trigger</td><td>20% dirty</td><td>Application threads write dirty pages (latency)</td></tr></table>
<pre class="run" data-title="Cache statistics">const c = db.serverStatus().wiredTiger.cache;
({ maxBytes: c["maximum bytes configured"], inCache: c["bytes currently in the cache"], dirty: c["tracked dirty bytes in the cache"] })</pre>` },
  { id: 'planner', title: 'Query planner and plan cache', html: `
<p>For a new query shape, the planner enumerates candidate plans from the available indexes, runs them in a short trial (until one returns 101 results or completes, or a work limit is hit), scores them by productivity, and caches the winner for that shape. Later executions use the cached plan; if it performs much worse than recorded, the shape is replanned. Index builds, drops and restarts clear the cache.</p>
<pre class="run" data-title="See the race: winning and rejected plans">db.orders.createIndex({ customerId: 1 })
db.orders.createIndex({ status: 1 })
const ex = db.orders.find({ customerId: 42, status: "delivered" }).explain("allPlansExecution");
({ winner: ex.queryPlanner.winningPlan.inputStage ? ex.queryPlanner.winningPlan.inputStage.indexName : ex.queryPlanner.winningPlan.stage, rejected: ex.queryPlanner.rejectedPlans.length })</pre>` },
  { id: 'replication-internals', title: 'Replication protocol', html: `
<p>Replication protocol version 1 is Raft-like: each election increments a <b>term</b>; a node votes at most once per term and only for a candidate whose last oplog entry (term, timestamp) is at least as recent as its own. Secondaries pull oplog batches from a sync source (chosen by ping time and freshness) and apply them in parallel by document, writing to their own oplog first.</p>
<p>The primary tracks each member's applied and durable optime; the <b>majority commit point</b> advances when a majority has the write durably, which is what <code>w: "majority"</code> waits for and what majority reads read at. A former primary with writes beyond the commit point rolls them back when it rejoins.</p>` },
  { id: 'oplog-format', title: 'Oplog entry format', html: `
<pre class="run" data-title="Insert, update and delete entries">db.lab_oplog.drop()
db.lab_oplog.insertOne({ _id: 1, n: 1 })
db.lab_oplog.updateOne({ _id: 1 }, { $inc: { n: 5 } })
db.lab_oplog.deleteOne({ _id: 1 })
db.getSiblingDB("local").oplog.rs.find({ ns: "shop.lab_oplog" }, { op: 1, o: 1, o2: 1 }).sort({ $natural: -1 }).limit(3)</pre>
<p>Note that the update is recorded as the resulting value (<code>$v: 2</code> diff with <code>n: 6</code>), not as <code>$inc</code>. That makes every entry idempotent, so re-applying a batch after a crash is safe. A <code>updateMany</code> touching a million documents produces a million oplog entries.</p>` },
  { id: 'chunks', title: 'Chunk migrations', html: `
<ol><li>The balancer (on the config server primary) picks a range to move from the most to the least loaded shard.</li>
<li>The recipient clones the documents in the range, then catches up on changes made during the copy.</li>
<li>The donor enters a short critical section, blocking writes to the range, while the final changes are transferred and the config servers commit the new owner.</li>
<li>Routers refresh their routing table version; the donor deletes the moved documents asynchronously (range deleter).</li></ol>
<p>Orphan documents can exist briefly on the donor; queries through mongos filter them out using shard versioning.</p>` },
  { id: 'distributed-txn', title: 'Distributed transactions', html: `
<p>On one replica set, a transaction is a WiredTiger transaction at a snapshot; commit writes a single applyOps-style oplog entry (or several for large transactions). Across shards, mongos makes the first participant shard the <b>coordinator</b>, which runs two-phase commit: each participant <b>prepares</b> (durably records the transaction and holds its locks), then the coordinator writes the commit decision and tells participants to commit. Prepared transactions block conflicting writes, so keep cross-shard transactions small and short.</p>` },
  { id: 'pitr-internals', title: 'Point-in-time recovery mechanics', html: `
<div data-diagram="pitr"></div>
<p>PITR combines a consistent base snapshot with a continuous copy of the oplog. Restore loads the snapshot, then replays oplog entries up to the target timestamp (just before the bad operation). Because entries are idempotent, replay can start from a point slightly before the snapshot's consistency point without harm.</p>` }
  ]
};

MM.PAGES.snippets = [
  { title: 'Find with filter', code: 'db.customers.find({ "address.city": "Pune", tier: "gold" }, { name: 1, email: 1 })' },
  { title: 'Sort and limit', code: 'db.products.find({ category: "electronics" }).sort({ price: -1 }).limit(5)' },
  { title: 'Array match', code: 'db.orders.find({ items: { $elemMatch: { category: "books", qty: { $gte: 2 } } } }).count()' },
  { title: 'Update operators', code: 'db.products.updateOne({ _id: "P001" }, { $inc: { stock: -1 }, $set: { updatedAt: new Date() } })\ndb.products.findOne({ _id: "P001" }, { stock: 1, updatedAt: 1 })' },
  { title: 'Group by status', code: 'db.orders.aggregate([\n  { $group: { _id: "$status", orders: { $sum: 1 }, revenue: { $sum: "$total" } } },\n  { $set: { revenue: { $round: ["$revenue", 2] } } },\n  { $sort: { orders: -1 } }\n])' },
  { title: 'Unwind line items', code: 'db.orders.aggregate([\n  { $unwind: "$items" },\n  { $group: { _id: "$items.category", units: { $sum: "$items.qty" } } },\n  { $sort: { units: -1 } }\n])' },
  { title: '$lookup join', code: 'db.orders.aggregate([\n  { $match: { status: "returned" } },\n  { $limit: 3 },\n  { $lookup: { from: "customers", localField: "customerId", foreignField: "_id", as: "customer" } },\n  { $project: { orderNo: 1, total: 1, "customer.name": 1 } }\n])' },
  { title: 'Monthly revenue', code: 'db.orders.aggregate([\n  { $match: { status: { $in: ["paid", "shipped", "delivered"] } } },\n  { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } }, revenue: { $sum: "$total" } } },\n  { $sort: { _id: -1 } },\n  { $limit: 6 },\n  { $set: { revenue: { $round: ["$revenue", 2] } } }\n])' },
  { title: 'Explain a query', code: 'db.orders.find({ status: "shipped", total: { $gte: 500 } }).sort({ createdAt: -1 }).limit(10).explain("executionStats")' },
  { title: 'ESR index', code: 'db.orders.createIndex({ status: 1, createdAt: -1, total: 1 })\ndb.orders.find({ status: "shipped", total: { $gte: 500 } }).sort({ createdAt: -1 }).limit(10).explain("executionStats")' },
  { title: 'Faceted search', code: 'db.products.aggregate([\n  { $match: { price: { $lte: 500 } } },\n  { $facet: {\n    byCategory: [{ $sortByCount: "$category" }],\n    priceBands: [{ $bucket: { groupBy: "$price", boundaries: [0, 50, 100, 250, 501], default: "other" } }]\n  } }\n])' },
  { title: 'Transaction', code: 'db.lab_accounts.drop()\ndb.lab_accounts.insertMany([{ _id: "A", balance: 100 }, { _id: "B", balance: 50 }])\nconst session = db.getMongo().startSession()\nconst acc = session.getDatabase("shop").lab_accounts\nsession.startTransaction()\nacc.updateOne({ _id: "A" }, { $inc: { balance: -30 } })\nacc.updateOne({ _id: "B" }, { $inc: { balance: 30 } })\nsession.commitTransaction()\ndb.lab_accounts.find()' },
  { title: 'Replica set status', code: 'rs.status().members.map(m => ({ name: m.name, state: m.stateStr, optimeDate: m.optimeDate }))' },
  { title: 'Text search', code: 'db.products.createIndex({ name: "text", description: "text" })\ndb.products.find({ $text: { $search: "wireless headphones" } }, { name: 1, score: { $meta: "textScore" } }).sort({ score: { $meta: "textScore" } }).limit(5)' },
  { title: 'Collection stats', code: 'db.orders.stats()' },
  { title: 'Oplog tail', code: 'db.getSiblingDB("local").oplog.rs.find().sort({ $natural: -1 }).limit(3)' }
];

MM.PAGES.cheatsheet = {
  title: 'MongoDB cheat sheet',
  intro: 'The commands you reach for every day, grouped by task. Everything here uses mongosh syntax.',
  cards: [
  { title: 'Navigate', code: 'show dbs\nuse shop\nshow collections\ndb.getCollectionNames()\ndb.stats()\ndb.orders.stats()' },
  { title: 'Insert', code: 'db.c.insertOne({ name: "a" })\ndb.c.insertMany([{...}, {...}], { ordered: false })\ndb.c.bulkWrite([{ insertOne: { document: {...} } }])' },
  { title: 'Find', code: 'db.c.find({ age: { $gte: 18 } }, { name: 1, _id: 0 })\n  .sort({ age: -1 }).skip(20).limit(10)\ndb.c.findOne({ _id: id })\ndb.c.countDocuments({ status: "A" })\ndb.c.distinct("city")' },
  { title: 'Query operators', code: '$eq $ne $gt $gte $lt $lte $in $nin\n$and $or $nor $not\n$exists $type $regex $expr\n$all $elemMatch $size' },
  { title: 'Update', code: 'db.c.updateOne(f, { $set: { a: 1 }, $inc: { n: 1 } })\ndb.c.updateMany(f, { $unset: { tmp: "" } })\ndb.c.updateOne(f, u, { upsert: true })\ndb.c.replaceOne(f, doc)\ndb.c.findOneAndUpdate(f, u, { returnDocument: "after" })' },
  { title: 'Array updates', code: '$push  $addToSet  $pull  $pop\n{ $push: { tags: { $each: [..], $slice: -10 } } }\n{ $set: { "items.$.qty": 2 } }\n{ $set: { "items.$[i].ok": true } },\n  { arrayFilters: [{ "i.qty": { $gt: 1 } }] }' },
  { title: 'Delete', code: 'db.c.deleteOne({ _id: id })\ndb.c.deleteMany({ status: "old" })\ndb.c.findOneAndDelete(f)\ndb.c.drop()' },
  { title: 'Aggregation stages', code: '$match $project $addFields $set $unset\n$group $sort $limit $skip $count\n$unwind $lookup $graphLookup\n$facet $bucket $bucketAuto $sortByCount\n$merge $out $unionWith $sample' },
  { title: 'Group accumulators', code: '{ $group: {\n  _id: "$key",\n  n: { $sum: 1 }, total: { $sum: "$x" },\n  avg: { $avg: "$x" }, max: { $max: "$x" },\n  items: { $push: "$x" }, uniq: { $addToSet: "$x" },\n  first: { $first: "$x" }, top: { $top: { sortBy: { x: -1 }, output: "$y" } }\n} }' },
  { title: 'Indexes', code: 'db.c.createIndex({ a: 1, b: -1 })\ndb.c.createIndex({ email: 1 }, { unique: true })\ndb.c.createIndex({ x: 1 }, { partialFilterExpression: { x: { $exists: true } } })\ndb.c.createIndex({ at: 1 }, { expireAfterSeconds: 3600 })\ndb.c.getIndexes()\ndb.c.hideIndex("a_1_b_-1")\ndb.c.dropIndex("a_1_b_-1")' },
  { title: 'Explain', code: 'db.c.find(f).explain("executionStats")\n// winningPlan: COLLSCAN | IXSCAN | SORT\n// nReturned vs totalKeysExamined\n//           vs totalDocsExamined\ndb.c.aggregate(p, { explain: true })' },
  { title: 'Replica set', code: 'rs.status()\nrs.conf()\nrs.printReplicationInfo()\nrs.printSecondaryReplicationInfo()\nrs.stepDown(60)\nrs.add("host:27017")\nrs.reconfig(cfg)' },
  { title: 'Sharding', code: 'sh.status()\nsh.enableSharding("shop")\nsh.shardCollection("shop.orders", { customerId: "hashed" })\nsh.getBalancerState()\nsh.addShardToZone("s1", "EU")\ndb.adminCommand({ reshardCollection: "shop.orders", key: { region: 1, _id: 1 } })' },
  { title: 'Diagnostics', code: 'db.currentOp({ secs_running: { $gte: 5 } })\ndb.killOp(opid)\ndb.serverStatus()\ndb.setProfilingLevel(1, { slowms: 100 })\ndb.system.profile.find().sort({ millis: -1 })\ndb.c.aggregate([{ $indexStats: {} }])' },
  { title: 'Users and roles', code: 'db.createUser({ user: "app", pwd: passwordPrompt(),\n  roles: [{ role: "readWrite", db: "shop" }] })\ndb.createRole({ role: "r", privileges: [...], roles: [] })\ndb.grantRolesToUser("app", ["read"])\ndb.getUsers()' },
  { title: 'Transactions', code: 'const s = db.getMongo().startSession()\ns.startTransaction({ readConcern: { level: "snapshot" },\n  writeConcern: { w: "majority" } })\nconst c = s.getDatabase("shop").orders\n// ...writes via c\ns.commitTransaction()   // or s.abortTransaction()' },
  { title: 'Change streams', code: 'const cs = db.orders.watch([\n  { $match: { operationType: { $in: ["insert", "update"] } } }\n], { fullDocument: "updateLookup" })\nwhile (cs.hasNext()) { const e = cs.next(); /* save e._id */ }\ndb.orders.watch([], { resumeAfter: token })' },
  { title: 'Backup and restore', code: 'mongodump --uri=... --oplog --gzip --archive=dump.gz\nmongorestore --uri=... --oplogReplay --gzip --archive=dump.gz\nmongorestore --oplogReplay --oplogLimit=<ts>:<i>\nmongoexport -d shop -c orders --type=csv -f a,b' },
  { title: 'Upgrades (FCV)', code: 'db.adminCommand({ getParameter: 1,\n  featureCompatibilityVersion: 1 })\n// rolling: secondaries, stepDown, old primary\ndb.adminCommand({ setFeatureCompatibilityVersion: "8.0",\n  confirm: true })' },
  { title: 'Read and write concern', code: '{ w: "majority", j: true, wtimeout: 5000 }\nreadConcern: local | available | majority\n             | linearizable | snapshot\nreadPreference: primary | primaryPreferred\n  | secondary | secondaryPreferred | nearest' },
  { title: 'Schema validation', code: 'db.createCollection("c", { validator: { $jsonSchema: {\n  bsonType: "object", required: ["email"],\n  properties: { email: { bsonType: "string" } } } },\n  validationAction: "error" })\ndb.runCommand({ collMod: "c", validationLevel: "moderate" })' }
  ]
};
