/* Level 6 — Sharding / Distributed */
MM.addLessons([
{
  id: 'sharded-cluster-architecture', module: 'sharding', title: 'Sharded cluster architecture and query routing', minutes: 28,
  summary: 'mongos routers, the config server replica set and shards; how queries are targeted or broadcast, and what changes for applications.',
  objectives: ['Describe each component of a sharded cluster', 'Distinguish targeted from scatter-gather queries', 'Know what sharding changes for unique indexes, transactions and aggregations', 'Decide when sharding is justified'],
  sections: {
    concept: `<div data-diagram="sharded-cluster"></div>
<ul><li><b>Shards</b>: each a replica set holding a subset of the data.</li>
<li><b>Config servers</b> (a replica set, CSRS): metadata, i.e. which ranges of shard key values (chunks) live on which shard, plus cluster settings. Since 8.0 a config shard can also hold application data.</li>
<li><b>mongos</b>: stateless routers. Applications connect to mongos, never directly to shards. Run several behind the driver's host list (or one per app host).</li>
<li>A collection is sharded by a <b>shard key</b>. Unsharded collections live on the database's primary shard (or, since 8.0, can be moved with <code>moveCollection</code>).</li></ul>
<p><b>Targeted</b> queries include the shard key (or its prefix) so mongos sends them only to the shards that own the matching ranges. <b>Scatter-gather</b> (broadcast) queries go to every shard and merge results: fine for rare analytics, costly at high volume because every shard does work for every query.</p>`,
    why: `<p>Sharding is MongoDB's way to scale writes, data size and working set beyond one replica set. It is powerful but adds components, operational work and constraints. Knowing exactly what it changes lets you decide if and when you need it.</p>`,
    useCase: `<p>A 12 TB order history with 30,000 writes per second does not fit a single replica set comfortably: restores take days and the working set exceeds RAM. Sharding on <code>{ customerId: "hashed" }</code> across 6 shards spreads writes evenly; order lookups by customer are targeted to one shard; global reports become scatter-gather and run on analytics nodes.</p>`,
    internals: `<p>mongos caches the routing table from the config servers and refreshes it when a shard reports a stale version (each chunk move bumps the collection's placement version). Aggregations split into a shard part (run on each shard) and a merge part (on mongos or a chosen shard). <code>$lookup</code> to a sharded collection works since 5.1. Unique indexes on a sharded collection must have the shard key as a prefix, because each shard can only enforce uniqueness on its own data. Transactions across shards use two-phase commit.</p>`
  },
  examples: [
    { title: 'Cluster status (sample output)', code: `sh.status()`, note: 'The playground returns a realistic 3-shard sample. Behaviour is explored in the shard key simulator in the next lesson.' },
    { title: 'Sharding commands on a real cluster', runnable: false, code: `sh.enableSharding("shop")                                    // optional since 6.0
db.orders.createIndex({ customerId: "hashed" })
sh.shardCollection("shop.orders", { customerId: "hashed" })
sh.shardCollection("shop.events", { customerId: 1, ts: 1 })
db.orders.getShardDistribution()
db.orders.find({ customerId: 42 }).explain()                   // SINGLE_SHARD
db.orders.find({ status: "paid" }).explain()                   // SHARD_MERGE: all shards` },
    { title: 'Simulated shard distribution', code: `db.orders.getShardDistribution()` }
  ],
  mistakes: [
    'Sharding too early, adding complexity for a workload one replica set could handle.',
    'Sharding too late, when the cluster is already overloaded and initial balancing competes with production traffic.',
    'Applications connecting directly to shards.',
    'Running a single mongos as a single point of failure.',
    'Assuming unique constraints on non-shard-key fields still work across shards.'
  ],
  interview: [
    { q: 'What are the components of a sharded cluster?', a: '<p>Shards (replica sets holding data subsets), a config server replica set storing metadata and the routing table, and mongos routers that applications connect to. The balancer (running on the config server primary) moves ranges between shards to even out data.</p>' },
    { q: 'What is a scatter-gather query and how do you avoid it?', a: '<p>A query without the shard key (or prefix) is sent to all shards and the results merged on mongos. Avoid it on hot paths by choosing a shard key that matches the most frequent query predicate, or by including the shard key in queries (e.g. tenantId). Accept it for rare analytics, preferably on secondaries or analytics nodes.</p>' }
  ],
  quiz: [
    { q: 'Where is the routing metadata stored?', options: ['On every shard primary', 'In the config server replica set', 'Only in mongos memory', 'In the oplog'], answer: 1 },
    { q: 'A query on a sharded collection without the shard key is...', options: ['Rejected', 'Targeted to one shard', 'Broadcast to all shards', 'Served by the config servers'], answer: 2 }
  ]
},
{
  id: 'choosing-shard-keys', module: 'shard-keys', title: 'Choosing a shard key: cardinality, frequency, monotonicity', minutes: 32,
  summary: 'The decision that is hardest to change. Evaluate candidate keys against write distribution, query targeting and growth, and compare hashed, ranged and compound keys in the simulator.',
  objectives: ['Evaluate cardinality, frequency and monotonicity', 'Choose between hashed, ranged and compound keys', 'Predict hot shards and jumbo chunks', 'Use refineCollectionShardKey and reshardCollection when needed'],
  sections: {
    concept: `<p>A good shard key has:</p>
<ul><li><b>High cardinality</b>: many distinct values, so data can be split into many ranges. <code>country</code> with 15 values can never use more than 15 chunks.</li>
<li><b>Low frequency</b>: no single value holds a big share of documents. One huge tenant on a <code>tenantId</code> key creates a jumbo chunk.</li>
<li><b>Non-monotonic writes</b>: values that do not always increase. <code>createdAt</code> or ObjectId as a ranged key sends every insert to the last chunk on one shard (a hot shard).</li>
<li><b>Query isolation</b>: the most frequent queries include the key, so they are targeted.</li></ul>
<table><tr><th>Key type</th><th>Good at</th><th>Bad at</th></tr>
<tr><td>Hashed <code>{ customerId: "hashed" }</code></td><td>Even write distribution, even with monotonic values</td><td>Range queries on the key become scatter-gather</td></tr>
<tr><td>Ranged <code>{ customerId: 1 }</code></td><td>Range queries, locality</td><td>Monotonic values create hot shards</td></tr>
<tr><td>Compound <code>{ customerId: 1, createdAt: 1 }</code></td><td>Targeted per-customer queries and per-customer time ranges, fine-grained splitting</td><td>Very large single customers still concentrate</td></tr></table>
<h3>Shard key simulator</h3>
<p>Choose a key, insert orders and watch where they land, how chunks split, which become jumbo, and which queries are targeted.</p>
<div data-widget="shard-sim"></div>`,
    why: `<p>The shard key decides whether the cluster scales linearly or has one overloaded shard while the others idle. Changing it used to require a dump and reload; since 5.0 <code>reshardCollection</code> does it online, but it still rewrites the whole collection, so getting it right first time matters.</p>`,
    useCase: `<p>For orders, <code>{ customerId: 1, createdAt: 1 }</code> gives high cardinality, spreads customers across shards, keeps each customer's orders together for "my orders" (targeted) and supports per-customer date ranges. <code>{ createdAt: 1 }</code> would send every new order to one shard. <code>{ status: 1 }</code> has 6 values and would never scale.</p>`,
    internals: `<p>Since 4.4 you can add suffix fields with <code>refineCollectionShardKey</code> to split jumbo chunks; since 5.0 <code>reshardCollection</code> copies data to a new key in the background, catches up with the oplog, and blocks writes for a short period (default up to 2 s) at cutover. It needs disk space and oplog headroom on every shard. 7.0 adds <code>analyzeShardKey</code> to measure cardinality, frequency, monotonicity and targeting from sampled queries before you decide.</p>`
  },
  examples: [
    { title: 'Analyse candidate keys on real data', code: `function analyze(field) {
  const total = db.orders.countDocuments()
  const r = db.orders.aggregate([
    { $group: { _id: "$" + field, n: { $sum: 1 } } },
    { $group: { _id: null, distinct: { $sum: 1 }, maxFreq: { $max: "$n" } } }
  ]).toArray()[0]
  return { field, distinctValues: r.distinct, topValueSharePct: +(100 * r.maxFreq / total).toFixed(2) }
}
["status", "shipping.country", "customerId", "orderNo"].map(analyze)` },
    { title: 'Monotonicity check', code: `const ids = db.orders.find({}, { _id: 1, createdAt: 1 }).sort({ $natural: 1 }).limit(2000).toArray()
let inc = 0
for (let i = 1; i < ids.length; i++) if (ids[i].createdAt >= ids[i - 1].createdAt) inc++
print("createdAt increases in", (100 * inc / (ids.length - 1)).toFixed(1), "% of consecutive inserts")`, note: 'Close to 100% means a ranged key on createdAt would send nearly all inserts to one chunk.' },
    { title: 'Changing a key later', runnable: false, code: `// add a suffix to split jumbo chunks (4.4+)
db.adminCommand({ refineCollectionShardKey: "shop.orders", key: { customerId: 1, createdAt: 1 } })
// rewrite to a completely new key online (5.0+)
db.adminCommand({ reshardCollection: "shop.orders", key: { customerId: "hashed" } })
// measure a candidate before deciding (7.0+)
db.adminCommand({ analyzeShardKey: "shop.orders", key: { customerId: 1 }, keyCharacteristics: true, readWriteDistribution: true })` }
  ],
  mistakes: [
    'Ranged shard key on a monotonically increasing field (timestamps, ObjectId, auto-increment).',
    'Low-cardinality keys (status, country, boolean).',
    'Choosing a key that none of the frequent queries include.',
    'Hashed key on a field you mostly query by range.',
    'Ignoring the single giant tenant that will become a jumbo chunk.'
  ],
  interview: [
    { q: 'What makes a good shard key?', a: '<p>High cardinality, low frequency of any single value, non-monotonic insert pattern (or hashed), and alignment with the most common query predicates so reads are targeted. Often a compound key such as <code>{ tenantId: 1, _id: 1 }</code> or a hashed key on a high-cardinality id. Validate with data analysis (or <code>analyzeShardKey</code>) and load testing.</p>' },
    { q: 'Hashed vs ranged sharding?', a: '<p>Hashed distributes writes evenly even for monotonic values, but range queries on the key are broadcast and there is no locality. Ranged keeps adjacent values together, supports targeted range queries and zones, but can create hot spots with monotonic or skewed values. Compound keys combine locality on the prefix with spreading on the suffix.</p>' },
    { q: 'What is a jumbo chunk?', a: '<p>A chunk that exceeds the maximum chunk size but cannot be split because all its documents share the same shard key value (or too few split points). The balancer cannot move it normally, causing imbalance. Fixes: refine the shard key with an additional field, reshard, or (carefully) clear the jumbo flag after manual splitting when possible.</p>' }
  ],
  quiz: [
    { q: 'Ranged shard key on createdAt causes...', options: ['Even distribution', 'All inserts going to the shard owning the max chunk', 'Jumbo chunks only', 'Broadcast reads only'], answer: 1 },
    { q: 'Which command (5.0+) changes a collection to a new shard key online?', options: ['refineCollectionShardKey', 'reshardCollection', 'moveChunk', 'shardCollection'], answer: 1 },
    { q: 'Which key is worst?', options: ['{ customerId: "hashed" }', '{ customerId: 1, createdAt: 1 }', '{ status: 1 }', '{ _id: "hashed" }'], answer: 2 }
  ]
},
{
  id: 'balancer-zones-resharding', module: 'balancer', title: 'Chunks, balancer, zones and orphans', minutes: 25,
  summary: 'How data moves between shards, how to control when it moves, how to pin data to locations with zones, and what orphaned documents are.',
  objectives: ['Explain chunks/ranges and the balancer', 'Schedule balancing windows and monitor migrations', 'Use zones for data locality and tiered storage', 'Understand orphaned documents and the range deleter'],
  sections: {
    concept: `<ul><li>A <b>chunk</b> (range) is a contiguous range of shard key values on one shard. Default maximum range size is 128 MB (6.0+).</li>
<li>The <b>balancer</b> runs on the config server primary and migrates ranges to even out <b>data size</b> per shard (6.0+; older versions counted chunks). It also enforces zone rules.</li>
<li>A <b>migration</b>: the recipient clones the range, catches up with changes, the donor enters a short critical section, metadata is committed on the config servers, and the donor deletes its copy asynchronously.</li>
<li><b>Zones</b> map shard key ranges to sets of shards: EU customers on EU shards, recent data on fast storage, a big tenant on dedicated shards.</li>
<li><b>Orphaned documents</b> are leftover copies on the donor after a migration (or after an aborted one) until the range deleter removes them. Queries through mongos filter them out.</li></ul>`,
    why: `<p>Migrations use disk IO, network and cache on both shards. Uncontrolled balancing during peak traffic adds latency. Zones are how you meet data residency requirements with one logical cluster.</p>`,
    useCase: `<p>A global SaaS shards on <code>{ region: 1, tenantId: 1 }</code> with zones <code>EU</code> and <code>IN</code> mapped to shards in Frankfurt and Mumbai, satisfying data residency. The balancer runs only between 01:00 and 05:00 local time; a new shard added before a sales event is filled gradually over several nights.</p>`,
    internals: `<p>Since 6.0 the balancer no longer depends on auto-splitting at insert time; ranges are split as needed when they are moved. Migration throttling (<code>_secondaryThrottle</code>, <code>waitForDelete</code>) and concurrency settings trade speed for impact. Direct connections to shard members see orphans unless they use the shard filtering that mongos requests, which is one reason to never read directly from shards.</p>`
  },
  examples: [
    { title: 'Balancer controls', runnable: false, code: `sh.getBalancerState()
sh.isBalancerRunning()
sh.stopBalancer()      // before maintenance, backups or upgrades
sh.startBalancer()
// balancing window
db.getSiblingDB("config").settings.updateOne(
  { _id: "balancer" },
  { $set: { activeWindow: { start: "01:00", stop: "05:00" } } },
  { upsert: true })
// recent migrations
db.getSiblingDB("config").changelog.find({ what: /moveChunk|moveRange/ }).sort({ time: -1 }).limit(5)` },
    { title: 'Zones for data residency', runnable: false, code: `sh.addShardToZone("shard-eu-1", "EU")
sh.addShardToZone("shard-in-1", "IN")
sh.updateZoneKeyRange("shop.customers", { region: "EU", tenantId: MinKey }, { region: "EU", tenantId: MaxKey }, "EU")
sh.updateZoneKeyRange("shop.customers", { region: "IN", tenantId: MinKey }, { region: "IN", tenantId: MaxKey }, "IN")` }
  ],
  mistakes: [
    'Leaving the balancer running during backups that are not balancer-aware, or during upgrades.',
    'Adding a shard at peak load and expecting instant relief; balancing is gradual.',
    'Reading directly from shard members and seeing orphaned documents.',
    'Zone ranges that do not cover the whole key space when you expected them to.'
  ],
  interview: [
    { q: 'What does the balancer do and how do you control its impact?', a: '<p>It moves ranges between shards to keep data evenly distributed and to honour zones. Control impact with a balancing window, stopping it during maintenance, secondary throttle settings, and capacity headroom so migrations do not starve production traffic. Monitor migrations in <code>config.changelog</code> and the logs.</p>' },
    { q: 'What are orphaned documents?', a: '<p>Copies of documents left on a shard that no longer owns their range, typically after a migration before the range deleter cleans up, or after failed migrations. mongos and shard filtering hide them from normal queries; they matter for direct shard access, storage accounting and some counts.</p>' }
  ],
  quiz: [
    { q: 'Since 6.0, the balancer evens out shards by...', options: ['Chunk count', 'Data size', 'Number of indexes', 'CPU usage'], answer: 1 },
    { q: 'Zones are used for...', options: ['Encryption', 'Pinning shard key ranges to specific shards', 'Read preference', 'Compression'], answer: 1 }
  ]
},
{
  id: 'cluster-migrations', module: 'migrations', title: 'Cluster migrations and cutover', minutes: 25,
  summary: 'Move data between clusters, versions, topologies or data centres with minimal downtime: dump/restore, replica set extension, mongosync and CDC-based approaches, with validation and rollback.',
  objectives: ['Choose a migration method based on size, downtime tolerance and versions', 'Plan initial copy, catch-up, validation and cutover', 'Validate data with counts, hashes and sampling', 'Prepare a rollback path'],
  sections: {
    concept: `<table><tr><th>Method</th><th>Downtime</th><th>Notes</th></tr>
<tr><td>mongodump / mongorestore</td><td>Long (copy time)</td><td>Simple, small datasets, version jumps</td></tr>
<tr><td>Add members to the replica set in the new location, then step down and remove old ones</td><td>Seconds (election)</td><td>Same replica set; good for hardware or data-centre moves</td></tr>
<tr><td>mongosync (cluster-to-cluster sync)</td><td>Short cutover</td><td>Continuous sync from source to destination cluster with commit and optional reverse sync; version and topology requirements apply</td></tr>
<tr><td>Change streams / CDC pipeline</td><td>Short cutover</td><td>Custom transformations, heterogeneous targets</td></tr>
<tr><td>Physical backup restore (PBM)</td><td>Copy plus catch-up</td><td>Large datasets, same major version</td></tr></table>
<p>Phases: <b>initial copy</b> → <b>continuous catch-up</b> (oplog or change streams) → <b>validation</b> → <b>cutover</b> (stop writes, wait for zero lag, switch connection strings) → <b>monitoring</b> with a rollback window.</p>`,
    why: `<p>Migrations happen more often than people expect: hardware refresh, cloud moves, version upgrades that skip several majors, consolidations, or moving off a managed service to self-hosted infrastructure. They fail on details: missing indexes, a collection nobody knew about, users and roles not copied, or no way back.</p>`,
    useCase: `<p>Moving 4 TB from an on-premises replica set to a self-managed Kubernetes cluster: mongosync performs the initial sync over three days and keeps up with changes; validation compares counts and per-collection hashes; on the cutover night writes are paused for 4 minutes, lag reaches zero, the commit completes, and applications switch connection strings. Reverse sync is kept running for a week as the rollback path.</p>`,
    internals: `<p>Catch-up depends on the source oplog window: if the initial copy takes longer than the window, the sync cannot resume and must start over. Index builds on the destination can dominate copy time, so tools build them at the right point. Validation methods: <code>countDocuments</code> per collection, <code>dbHash</code> on quiesced data, sampled document comparison, and application-level checks.</p>`
  },
  examples: [
    { title: 'mongosync outline', runnable: false, code: `mongosync --cluster0 "mongodb://src-0,src-1,src-2/?replicaSet=rs0" \\
          --cluster1 "mongodb://dst-0,dst-1,dst-2/?replicaSet=rs0" &
curl -X POST localhost:27182/api/v1/start -d '{ "source": "cluster0", "destination": "cluster1" }'
curl localhost:27182/api/v1/progress            # state, lagTimeSeconds, canCommit
# cutover: stop application writes, wait for lagTimeSeconds ~ 0
curl -X POST localhost:27182/api/v1/commit -d '{}'` },
    { title: 'Validation queries you can run on both sides', code: `db.getCollectionNames().filter(c => !c.startsWith("system.")).map(c => ({ coll: c, count: db.getCollection(c).countDocuments(), indexes: db.getCollection(c).getIndexes().length }))` },
    { title: 'Content fingerprint for a collection', code: `db.orders.aggregate([
  { $project: { k: { $concat: [{ $toString: "$_id" }, ":", { $toString: "$total" }, ":", "$status"] } } },
  { $sort: { k: 1 } },
  { $group: { _id: null, n: { $sum: 1 }, sample: { $first: "$k" }, last: { $last: "$k" } } }
])`, note: 'On real clusters prefer the dbHash command on quiesced data; this pattern works for spot checks of chosen fields.' }
  ],
  mistakes: [
    'Forgetting users, roles, indexes, validators, TTL settings and views in the destination.',
    'Initial copy longer than the oplog window.',
    'No rehearsal with production-sized data.',
    'No rollback plan after cutover (writes have already happened on the new cluster).',
    'Changing versions, topology and schema all in one migration.'
  ],
  interview: [
    { q: 'How do you migrate a large MongoDB deployment with minimal downtime?', a: '<p>Pick a method that supports continuous sync (adding replica set members in the new location, mongosync, or CDC); size the oplog window to cover the initial copy; copy users, roles, indexes and collection options; rehearse with production-sized data; validate counts and hashes; schedule cutover with a short write freeze until lag is zero; switch connection strings; monitor closely and keep a reverse sync or fallback plan for a defined window.</p>' }
  ],
  quiz: [
    { q: 'What happens if the initial copy takes longer than the source oplog window?', options: ['Nothing', 'The sync cannot catch up and must restart', 'The destination becomes primary', 'Indexes are skipped'], answer: 1 }
  ]
}
]);
