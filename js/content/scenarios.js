/* =====================================================================
   scenarios.js — production incidents to debug in a private database.
   Contract (enforced by tests/run.js): setup runs once on a fresh seeded
   engine; check's last expression is { ok, checks:[{label, ok, detail}] }
   and must be not ok before the reference fix and ok after it.
   ===================================================================== */
MM.SCENARIOS = [
  {
    id: 'slow-customer-orders',
    title: 'The order history page got slow',
    level: 'mid', minutes: 10, tags: ['indexes', 'explain', 'ESR'],
    alert: 'p99 latency for GET /customers/:id/orders rose from 8 ms to 900 ms after last month\'s traffic growth.',
    brief: `<p>The endpoint runs one query: the ten most recent delivered orders for a customer. Someone already added indexes on <code>status</code> and <code>customerId</code> "to make it fast", but latency did not improve.</p>
<pre class="static" data-title="The query">db.orders.find({ customerId: 42, status: "delivered" }).sort({ createdAt: -1 }).limit(10)</pre>
<p><b>Goal:</b> the query uses an index that matches the filter and the sort, with no in-memory SORT stage and no wasted index keys.</p>`,
    setup: `db.orders.createIndex({ status: 1 });
db.orders.createIndex({ customerId: 1 })`,
    investigate: [
      { title: 'Explain the slow query', code: `db.orders.find({ customerId: 42, status: "delivered" }).sort({ createdAt: -1 }).limit(10).explain("executionStats")` },
      { title: 'List the indexes', code: `db.orders.getIndexes().map(i => ({ name: i.name, key: i.key }))` }
    ],
    hints: [
      'Look for a SORT stage in the winning plan. A blocking sort means the index does not deliver documents in createdAt order.',
      'Equality fields first, then the sort field, then range fields: the ESR rule.',
      'One compound index on customerId, status and createdAt (descending) serves the filter and the sort.'
    ],
    check: `const ex = db.orders.find({ customerId: 42, status: "delivered" }).sort({ createdAt: -1 }).limit(10).explain("executionStats");
const plan = JSON.stringify(ex.queryPlanner.winningPlan);
const st = ex.executionStats;
const checks = [
  { label: "Uses an index (no COLLSCAN)", ok: !plan.includes("COLLSCAN") },
  { label: "No in-memory SORT stage", ok: !plan.includes('"SORT"') },
  { label: "Keys examined close to documents returned", ok: st.totalKeysExamined <= st.nReturned + 1, detail: st.totalKeysExamined + " keys for " + st.nReturned + " documents" }
];
({ ok: checks.every(c => c.ok), checks })`,
    fix: `db.orders.createIndex({ customerId: 1, status: 1, createdAt: -1 })`,
    debrief: `<p>The single-field <code>customerId</code> index found the customer's orders, but MongoDB then had to filter by status and sort every match in memory. With <code>{ customerId: 1, status: 1, createdAt: -1 }</code> the two equality predicates narrow the index to one contiguous range that is already in <code>createdAt</code> order, so the scan stops after ten keys.</p>
<ul><li>The old <code>customerId_1</code> index is now a prefix of the compound index and can be dropped once you confirm nothing else depends on it.</li><li>The <code>status_1</code> index has low cardinality and rarely helps on its own; check <code>$indexStats</code> before keeping it.</li><li>In production, build the index during low traffic and watch replication lag; on 4.4+ the build runs on all members together and commits when <code>commitQuorum</code> is met.</li></ul>`
  },
  {
    id: 'duplicate-emails-unique-index',
    title: 'Unique index migration fails with E11000',
    level: 'mid', minutes: 10, tags: ['unique index', 'aggregation', 'data quality'],
    alert: 'Deploy blocked: migration 0042 "unique index on customers.email" failed with E11000 duplicate key error.',
    brief: `<p>Login is moving to email addresses, so <code>customers.email</code> must be unique. A retry bug in the signup service created duplicate customer documents months ago, and the unique index build now fails.</p>
<p><b>Goal:</b> remove the duplicates while keeping the original (lowest <code>_id</code>) customer for each email, then create the unique index.</p>`,
    setup: `[12, 57, 101, 230, 377, 499].forEach((id, i) => {
  const c = db.customers.findOne({ _id: id });
  c._id = 1001 + i;
  c.signupDate = new Date(c.signupDate.getTime() + 1000);
  db.customers.insertOne(c);
});`,
    investigate: [
      { title: 'Retry the migration', code: `try { db.customers.createIndex({ email: 1 }, { unique: true }) } catch (e) { print(e.message) }` },
      { title: 'Find duplicate emails', code: `db.customers.aggregate([
  { $group: { _id: "$email", ids: { $push: "$_id" }, n: { $sum: 1 } } },
  { $match: { n: { $gt: 1 } } },
  { $sort: { n: -1 } }
]).toArray()` }
    ],
    hints: [
      'Group by email and keep the groups with more than one _id.',
      'For each group, keep the smallest _id and delete the rest with deleteMany({ _id: { $in: [...] } }).',
      'Create the unique index only after the duplicate count reaches zero.'
    ],
    check: `const hasIdx = db.customers.getIndexes().some(i => i.key.email === 1 && i.unique === true);
const dups = db.customers.aggregate([{ $group: { _id: "$email", n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]).toArray().length;
const originals = db.customers.countDocuments({ _id: { $in: [12, 57, 101, 230, 377, 499] } });
const total = db.customers.countDocuments();
const checks = [
  { label: "No duplicate emails", ok: dups === 0, detail: dups + " duplicated email(s)" },
  { label: "Original customers kept", ok: originals === 6, detail: originals + " of 6 originals present" },
  { label: "No other customers removed", ok: total === 500, detail: total + " customers" },
  { label: "Unique index on email exists", ok: hasIdx }
];
({ ok: checks.every(c => c.ok), checks })`,
    fix: `db.customers.aggregate([
  { $group: { _id: "$email", ids: { $push: "$_id" }, n: { $sum: 1 } } },
  { $match: { n: { $gt: 1 } } }
]).toArray().forEach(g => {
  const keep = Math.min(...g.ids);
  db.customers.deleteMany({ _id: { $in: g.ids.filter(id => id !== keep) } });
});
db.customers.createIndex({ email: 1 }, { unique: true })`,
    debrief: `<p>A unique index build scans every existing document, so a single duplicate aborts it. The safe sequence is: find duplicates, decide a survivor rule, merge or delete, then build the index, and only then turn on the code path that depends on it.</p>
<ul><li>In a real system, re-point child records (orders, sessions) from the deleted customer ids to the survivor before deleting, or you create orphans.</li><li>Export the removed documents to an archive collection first so the clean-up is reversible.</li><li>If emails differ only by case, a unique index with <code>collation: { locale: "en", strength: 2 }</code> treats them as equal; normalise the stored value as well.</li><li>Until the index exists the application must tolerate duplicates; ship the index first, then the feature.</li></ul>`
  },
  {
    id: 'ttl-not-expiring',
    title: 'Sessions never expire',
    level: 'mid', minutes: 8, tags: ['TTL', 'BSON types', 'data quality'],
    alert: 'The sessions collection grows without bound even though it has a TTL index. Storage alert at 85%.',
    brief: `<p>The <code>sessions</code> collection has a TTL index on <code>expiresAt</code> with <code>expireAfterSeconds: 0</code>. Expired sessions should disappear within a minute, yet nothing has ever been deleted.</p>
<p><b>Goal:</b> make the TTL monitor remove expired sessions without deleting live ones, and keep the TTL index.</p>`,
    setup: `const now = Date.now();
const docs = [];
for (let i = 0; i < 200; i++) {
  const offsetHours = i < 150 ? -(i + 1) : (i - 149);
  docs.push({ _id: i + 1, userId: 1 + (i % 50), expiresAt: new Date(now + offsetHours * 3600 * 1000).toISOString() });
}
db.sessions.insertMany(docs);
db.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })`,
    investigate: [
      { title: 'Look at a session', code: `db.sessions.findOne()` },
      { title: 'Check the TTL index', code: `db.sessions.getIndexes()` },
      { title: 'Which BSON types does expiresAt hold?', code: `db.sessions.aggregate([{ $group: { _id: { $type: "$expiresAt" }, n: { $sum: 1 } } }]).toArray()` }
    ],
    hints: [
      'The TTL monitor only expires documents whose indexed field is a BSON date (or an array of dates). Strings are ignored.',
      'An update with an aggregation pipeline can convert a field in place: [{ $set: { field: { $toDate: "$field" } } }].'
    ],
    check: `const ttl = db.sessions.getIndexes().some(i => i.key.expiresAt === 1 && typeof i.expireAfterSeconds === "number");
const strings = db.sessions.countDocuments({ expiresAt: { $type: "string" } });
const expired = db.sessions.countDocuments({ expiresAt: { $lt: new Date() } });
const live = db.sessions.countDocuments({ expiresAt: { $gte: new Date() } });
const checks = [
  { label: "expiresAt stored as a date", ok: strings === 0, detail: strings + " string value(s)" },
  { label: "Expired sessions removed", ok: strings === 0 && expired === 0, detail: expired + " expired session(s) left" },
  { label: "Live sessions kept", ok: live === 50, detail: live + " of 50 live sessions" },
  { label: "TTL index still in place", ok: ttl }
];
({ ok: checks.every(c => c.ok), checks })`,
    fix: `db.sessions.updateMany(
  { expiresAt: { $type: "string" } },
  [{ $set: { expiresAt: { $toDate: "$expiresAt" } } }]
)`,
    debrief: `<p>The application serialised dates with <code>toISOString()</code> before writing, so every <code>expiresAt</code> was a string. The TTL monitor (a background thread that runs every 60 seconds on the primary) silently skips non-date values; it never raises an error.</p>
<ul><li>Converting in place with a pipeline update fixes old data; fix the writer too or the problem returns.</li><li>Add a validator with <code>expiresAt: { bsonType: "date" }</code> so a regression is rejected at write time.</li><li>On a large collection the first TTL passes after the fix delete many documents at once; expect replication and I/O load, or delete in batches yourself first.</li><li>In this simulator the TTL pass runs at the start of every shell run, which is why the next health check sees the result immediately.</li></ul>`
  },
  {
    id: 'pitr-deleted-coupons',
    title: 'Someone ran deleteMany({}) on coupons',
    level: 'senior', minutes: 20, tags: ['backup', 'oplog', 'PITR'],
    alert: 'Checkout is rejecting every coupon code. The coupons collection is empty.',
    brief: `<p>A maintenance script ran <code>db.coupons.deleteMany({})</code> against production. You have a snapshot copy in <code>coupons_backup</code>, and <code>backup_meta</code> records the oplog timestamp the snapshot is consistent with. Writes happened between the snapshot and the incident and must not be lost.</p>
<p><b>Goal:</b> restore the snapshot, then replay the oplog for <code>shop.coupons</code> from the snapshot timestamp up to, but not including, the destructive delete.</p>`,
    setup: `const coupons = [];
for (let i = 1; i <= 40; i++) coupons.push({ _id: "C" + String(i).padStart(3, "0"), pct: 5 + (i % 4) * 5, uses: 0, active: true });
db.coupons.insertMany(coupons);
db.coupons.find().forEach(d => db.coupons_backup.insertOne(d));
const last = db.getSiblingDB("local").oplog.rs.find({ ns: "shop.coupons" }).sort({ $natural: -1 }).limit(1).toArray()[0];
db.backup_meta.insertOne({ _id: "coupons", takenAt: new Date(), lastTs: last.ts });
db.coupons.updateMany({ pct: 20 }, { $inc: { uses: 3 } });
db.coupons.insertOne({ _id: "C041", pct: 50, uses: 0, active: true });
db.coupons.insertOne({ _id: "C042", pct: 15, uses: 1, active: true });
db.coupons.updateOne({ _id: "C007" }, { $set: { active: false } });
db.coupons.deleteOne({ _id: "C003" });
db.coupons.updateOne({ _id: "C041" }, { $inc: { uses: 2 } });
db.coupons.deleteMany({})`,
    investigate: [
      { title: 'How bad is it?', code: `db.coupons.countDocuments();
db.coupons_backup.countDocuments();
db.backup_meta.findOne()` },
      { title: 'What happened after the snapshot?', code: `const meta = db.backup_meta.findOne({ _id: "coupons" });
const ops = db.getSiblingDB("local").oplog.rs.find({ ns: "shop.coupons", ts: { $gt: meta.lastTs } }).sort({ $natural: 1 }).toArray();
print(ops.length, "oplog entries after the snapshot");
ops.slice(0, 18).map(e => ({ op: e.op, _id: (e.o2 || e.o)._id, diff: e.o.diff || null }))` },
      { title: 'Find where the incident starts', code: `const meta = db.backup_meta.findOne({ _id: "coupons" });
const ops = db.getSiblingDB("local").oplog.rs.find({ ns: "shop.coupons", ts: { $gt: meta.lastTs } }).sort({ $natural: 1 }).toArray();
let end = ops.length;
while (end > 0 && ops[end - 1].op === "d") end--;
({ legitimateOps: end, incidentDeletes: ops.length - end, firstBadTs: ops[end] && ops[end].ts })` }
    ],
    hints: [
      'Oplog entries are idempotent: an update stores the resulting field values in o.diff.u (fields to set) and o.diff.d (fields to remove), with the target _id in o2.',
      'The incident is the trailing run of "d" entries. Everything before it is legitimate traffic you must keep, including the single delete of C003.',
      'Restore: insert every document from coupons_backup, then apply each legitimate entry in order: i = insertOne(o), u = updateOne(o2, { $set: diff.u, $unset: diff.d }), d = deleteOne({ _id: o._id }).'
    ],
    check: `const c = db.coupons;
const pct20 = c.find({ pct: 20 }).toArray();
const c7 = c.findOne({ _id: "C007" }) || {};
const c41 = c.findOne({ _id: "C041" }) || {};
const untouchedWrong = c.countDocuments({ pct: { $ne: 20 }, _id: { $nin: ["C041", "C042"] }, uses: { $ne: 0 } });
const total = c.countDocuments();
const checks = [
  { label: "41 coupons present", ok: total === 41, detail: total + " coupons" },
  { label: "C003 stays deleted (it was deleted on purpose)", ok: !c.findOne({ _id: "C003" }) },
  { label: "C007 deactivation kept", ok: c7.active === false },
  { label: "C041 and C042 restored with their usage", ok: c41.uses === 2 && !!c.findOne({ _id: "C042", uses: 1 }) },
  { label: "20% coupons carry the 3 recorded uses", ok: pct20.length === 9 && pct20.every(d => d.uses === 3) },
  { label: "No other coupon changed", ok: total > 0 && untouchedWrong === 0 }
];
({ ok: checks.every(c => c.ok), checks })`,
    fix: `const meta = db.backup_meta.findOne({ _id: "coupons" });
const ops = db.getSiblingDB("local").oplog.rs.find({ ns: "shop.coupons", ts: { $gt: meta.lastTs } }).sort({ $natural: 1 }).toArray();
let end = ops.length;
while (end > 0 && ops[end - 1].op === "d") end--;
db.coupons_backup.find().forEach(d => db.coupons.insertOne(d));
ops.slice(0, end).forEach(e => {
  if (e.op === "i") db.coupons.insertOne(e.o);
  else if (e.op === "d") db.coupons.deleteOne({ _id: e.o._id });
  else if (e.op === "u") {
    const upd = {};
    if (e.o.diff.u) upd.$set = e.o.diff.u;
    if (e.o.diff.d) upd.$unset = e.o.diff.d;
    db.coupons.updateOne(e.o2, upd);
  }
});
db.coupons.countDocuments()`,
    debrief: `<p>This is point-in-time recovery done by hand: snapshot plus oplog replay, stopping just before the bad operation. In production you would not write the replay loop yourself:</p>
<ul><li><code>mongorestore --oplogReplay --oplogLimit &lt;ts&gt;</code> replays a dumped oplog up to (not including) a timestamp.</li><li>Percona Backup for MongoDB: <code>pbm restore --time "YYYY-MM-DDTHH:MM:SS"</code> with PITR oplog slicing enabled. Atlas and Ops Manager offer the same as a button.</li><li>Restore into a separate collection or cluster first, verify, then swap. Never replay straight into a live collection that is taking writes.</li><li>The oplog window must cover the time from the last snapshot to the incident; size it for your slowest detection time, not your average.</li><li>Prevention: least-privilege roles for scripts (no <code>remove</code> on whole collections), and a delayed hidden secondary as a fast undo button.</li></ul>`
  },
  {
    id: 'unbounded-reviews-array',
    title: 'One product page is 400 KB',
    level: 'senior', minutes: 15, tags: ['schema design', 'arrays', 'subset pattern'],
    alert: 'Product page for P001 takes 1.4 s and app servers spike in memory on every request for it.',
    brief: `<p>Reviews were embedded in the product document from day one. P001 became a best seller and now carries thousands of reviews; every page view loads and ships all of them, and the document is heading for the 16 MB BSON limit.</p>
<p><b>Goal:</b> apply the subset pattern. Keep only the 10 newest reviews embedded for the product page, move every review to a <code>product_reviews</code> collection indexed for "reviews of product X, newest first", and lose nothing.</p>`,
    setup: `const reviews = [];
const base = new Date("2025-01-01T00:00:00Z").getTime();
for (let i = 1; i <= 2500; i++) {
  reviews.push({ rid: i, user: "u" + (i % 700), rating: 1 + (i % 5), text: "Review " + i + ": sound is great, battery could last longer, case feels solid.", createdAt: new Date(base + i * 3600 * 1000) });
}
db.products.updateOne({ _id: "P001" }, { $set: { reviews: reviews } })`,
    investigate: [
      { title: 'Largest product documents', code: `db.products.aggregate([
  { $project: { name: 1, bytes: { $bsonSize: "$$ROOT" }, reviews: { $size: { $ifNull: ["$reviews", []] } } } },
  { $sort: { bytes: -1 } },
  { $limit: 3 }
]).toArray()` },
      { title: 'What the page really needs', code: `db.products.aggregate([
  { $match: { _id: "P001" } },
  { $project: { name: 1, latest: { $slice: [{ $sortArray: { input: "$reviews", sortBy: { createdAt: -1 } } }, 3] } } }
]).toArray()` }
    ],
    hints: [
      'Copy every embedded review into product_reviews with productId: "P001" added.',
      'Index product_reviews with productId first and createdAt descending so "page 2 of reviews" is an index range scan.',
      'Rewrite the product with only the 10 newest reviews (and a reviewCount). New reviews later use $push with $each, $sort and $slice: 10.'
    ],
    check: `const p = db.products.findOne({ _id: "P001" }) || {};
const emb = p.reviews || [];
const rids = emb.map(r => r.rid).sort((a, b) => a - b);
const size = db.products.aggregate([{ $match: { _id: "P001" } }, { $project: { b: { $bsonSize: "$$ROOT" } } }]).toArray()[0].b;
const moved = db.product_reviews.countDocuments({ productId: "P001" });
const idx = db.product_reviews.getIndexes().some(i => Object.keys(i.key)[0] === "productId");
const checks = [
  { label: "At most 10 reviews embedded", ok: emb.length > 0 && emb.length <= 10, detail: emb.length + " embedded" },
  { label: "Embedded reviews are the newest", ok: rids.length > 0 && rids[0] >= 2491 },
  { label: "All 2500 reviews kept in product_reviews", ok: moved === 2500, detail: moved + " moved" },
  { label: "product_reviews indexed by productId", ok: idx },
  { label: "Product document under 16 KB", ok: size < 16384, detail: size + " bytes" }
];
({ ok: checks.every(c => c.ok), checks })`,
    fix: `const p = db.products.findOne({ _id: "P001" });
db.product_reviews.insertMany(p.reviews.map(r => Object.assign({ productId: "P001" }, r)));
db.product_reviews.createIndex({ productId: 1, createdAt: -1 });
const latest = p.reviews.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 10);
db.products.updateOne({ _id: "P001" }, { $set: { reviews: latest, reviewCount: p.reviews.length } })`,
    debrief: `<p>Unbounded arrays are the most common MongoDB schema failure: the document grows with every write, each update rewrites the whole document, the working set fills with data no one reads, and eventually the 16 MB limit stops writes.</p>
<ul><li>Subset pattern: embed what the main page needs (latest 10), reference the rest.</li><li>Keep the embedded subset bounded at write time: <code>{ $push: { reviews: { $each: [r], $sort: { createdAt: -1 }, $slice: 10 } } }</code>, plus an insert into <code>product_reviews</code>.</li><li>Paginate the full list with a range on <code>createdAt</code> (keyset pagination), not <code>skip()</code>.</li><li>Run a migration like this in batches with a dual-write period on a live system.</li></ul>`
  },
  {
    id: 'index-bloat',
    title: 'Writes slowed down after an indexing spree',
    level: 'senior', minutes: 12, tags: ['indexes', '$indexStats', 'write amplification'],
    alert: 'Insert latency on orders tripled. The collection now has nine indexes.',
    brief: `<p>Over a few sprints, different teams each added "an index to be safe". Every insert and most updates now maintain nine B-trees. The application only runs three query shapes on this collection:</p>
<pre class="static" data-title="The real workload">db.orders.find({ status: "paid" }).sort({ createdAt: -1 }).limit(20)
db.orders.find({ customerId: 42 }).sort({ createdAt: -1 })
db.orders.findOne({ orderNo: "ORD-102519" })</pre>
<p><b>Goal:</b> keep at most four indexes (including <code>_id</code>) while all three queries still use an index with no in-memory sort, and keep the uniqueness guarantee on <code>orderNo</code>.</p>`,
    setup: `db.orders.createIndex({ status: 1 });
db.orders.createIndex({ status: 1, createdAt: -1 });
db.orders.createIndex({ customerId: 1 });
db.orders.createIndex({ customerId: 1, createdAt: -1 });
db.orders.createIndex({ createdAt: -1 });
db.orders.createIndex({ "shipping.country": 1 });
db.orders.createIndex({ "payment.method": 1, total: 1 });
db.orders.createIndex({ orderNo: 1 }, { unique: true });
for (let i = 0; i < 5; i++) {
  db.orders.find({ status: "paid" }).sort({ createdAt: -1 }).limit(20).toArray();
  db.orders.find({ customerId: 42 + i }).sort({ createdAt: -1 }).toArray();
  db.orders.findOne({ orderNo: "ORD-102519" });
}`,
    investigate: [
      { title: 'Index usage since startup', code: `db.orders.aggregate([{ $indexStats: {} }]).toArray()
  .map(s => ({ name: s.name, ops: s.accesses.ops }))
  .sort((a, b) => b.ops - a.ops)` },
      { title: 'Spot prefix-redundant indexes', code: `const idx = db.orders.getIndexes().map(i => Object.keys(i.key).map(k => k + ":" + i.key[k]).join(","));
idx.filter(a => idx.some(b => b !== a && b.startsWith(a + ",")))` }
    ],
    hints: [
      'An index whose keys are a prefix of another index (status_1 inside status_1_createdAt_-1) is redundant for queries.',
      'Zero ops in $indexStats over a representative period means the workload never uses it. Unique indexes are the exception: they enforce a constraint even with zero reads.',
      'Drop status_1, customerId_1, createdAt_-1, shipping.country_1 and payment.method_1_total_1.'
    ],
    check: `const ix = db.orders.getIndexes();
const shape = q => JSON.stringify(q.explain("executionStats").queryPlanner.winningPlan);
const plans = [
  shape(db.orders.find({ status: "paid" }).sort({ createdAt: -1 }).limit(20)),
  shape(db.orders.find({ customerId: 42 }).sort({ createdAt: -1 })),
  shape(db.orders.find({ orderNo: "ORD-102519" }).limit(1))
];
const checks = [
  { label: "At most four indexes", ok: ix.length <= 4, detail: ix.length + " indexes" },
  { label: "orderNo is still unique", ok: ix.some(i => i.key.orderNo === 1 && i.unique === true) },
  { label: "All three queries use an index", ok: plans.every(p => p.includes("IXSCAN") && !p.includes("COLLSCAN")) },
  { label: "No in-memory sorts", ok: plans.every(p => !p.includes('"SORT"')) }
];
({ ok: checks.every(c => c.ok), checks })`,
    fix: `["status_1", "customerId_1", "createdAt_-1", "shipping.country_1", "payment.method_1_total_1"].forEach(n => db.orders.dropIndex(n));
db.orders.getIndexes().map(i => i.name)`,
    debrief: `<p>Every index costs a B-tree insert on every document insert, extra work on updates to indexed fields, cache space and disk. Unused and prefix-redundant indexes buy nothing for that cost.</p>
<ul><li><code>$indexStats</code> counters reset on restart and are per node; sample every member over a full business cycle (month-end jobs!) before deciding.</li><li>Hide first, drop later: <code>db.orders.hideIndex("status_1")</code> makes the planner ignore the index while it is still maintained, so you can unhide instantly if latency regresses.</li><li>Never drop a unique or TTL index just because it has zero reads; it enforces behaviour, not speed.</li><li>Review index additions in code review with the query they serve, like any schema change.</li></ul>`
  },
  {
    id: 'schema-validation-rollout',
    title: 'Rolling out a required field safely',
    level: 'mid', minutes: 12, tags: ['schema validation', '$jsonSchema', 'data quality'],
    alert: 'Marketing emails bounce for signups without an address. Product wants email to be required on signups.',
    brief: `<p>A teammate added a <code>$jsonSchema</code> validator to <code>signups</code> in <code>warn</code> mode a while ago and never switched it to <code>error</code>, so invalid documents still get in. Some existing documents have no email or a non-string email.</p>
<p><b>Goal:</b> move every invalid document to <code>signups_quarantine</code> (lose nothing), then enforce the rule with <code>validationAction: "error"</code> so new invalid inserts are rejected.</p>`,
    setup: `const docs = [];
for (let i = 1; i <= 300; i++) {
  const d = { _id: i, email: "user" + i + "@example.com", plan: ["free", "pro", "team"][i % 3], createdAt: new Date(Date.UTC(2025, 0, 1 + (i % 200))) };
  if (i % 50 === 0) delete d.email;
  if (i % 50 === 25) d.email = 1000 + i;
  docs.push(d);
}
db.signups.insertMany(docs);
db.runCommand({
  collMod: "signups",
  validator: { $jsonSchema: { bsonType: "object", required: ["email"], properties: { email: { bsonType: "string" } } } },
  validationAction: "warn"
})`,
    investigate: [
      { title: 'Current validator', code: `db.getCollectionInfos({ name: "signups" })[0].options` },
      { title: 'Documents that break the rule', code: `const rule = db.getCollectionInfos({ name: "signups" })[0].options.validator;
db.signups.find({ $nor: [rule] }).toArray()` },
      { title: 'Does warn mode block bad inserts?', code: `db.signups.insertOne({ _id: 9001, plan: "free" });
db.signups.deleteOne({ _id: 9001 })` }
    ],
    hints: [
      '{ $nor: [ { $jsonSchema: ... } ] } finds every document that fails a schema. Use the validator from getCollectionInfos so the query and the rule cannot drift apart.',
      'Copy those documents to signups_quarantine, then delete them from signups with the same filter.',
      'Finish with collMod setting validationAction: "error" (and validationLevel: "strict").'
    ],
    check: `const opts = (db.getCollectionInfos({ name: "signups" })[0] || {}).options || {};
const schema = opts.validator && opts.validator.$jsonSchema;
const bad = schema ? db.signups.countDocuments({ $nor: [opts.validator] }) : -1;
const kept = db.signups.countDocuments() + db.signups_quarantine.countDocuments();
let rejected = false;
try { db.signups.insertOne({ _id: 9999, plan: "free" }); db.signups.deleteOne({ _id: 9999 }); } catch (e) { rejected = true; }
const checks = [
  { label: "Validator requires email", ok: !!schema && (schema.required || []).includes("email") },
  { label: "No invalid documents left in signups", ok: bad === 0, detail: bad + " invalid" },
  { label: "Nothing lost (signups + quarantine = 300)", ok: kept === 300, detail: kept + " documents" },
  { label: "Inserts without email are rejected", ok: rejected && opts.validationAction !== "warn" }
];
({ ok: checks.every(c => c.ok), checks })`,
    fix: `const rule = db.getCollectionInfos({ name: "signups" })[0].options.validator;
db.signups.find({ $nor: [rule] }).forEach(d => db.signups_quarantine.insertOne(d));
db.signups.deleteMany({ $nor: [rule] });
db.runCommand({ collMod: "signups", validationLevel: "strict", validationAction: "error" })`,
    debrief: `<p>The safe rollout order for a new rule on an existing collection is: add the validator in <code>warn</code> mode, measure violations with <code>$nor: [rule]</code>, fix the writers, clean or quarantine old data, then switch to <code>error</code>.</p>
<ul><li><code>validationLevel: "moderate"</code> lets existing invalid documents be updated without fixing them, a useful middle step when you cannot clean history yet.</li><li>Warn mode writes violations to the server log, so you can find which service still writes bad data before enforcing.</li><li>Quarantine instead of delete: someone will ask for those signups later.</li><li>Validation runs on the primary for every insert and update; keep schemas focused on invariants, not every field.</li></ul>`
  }
];
