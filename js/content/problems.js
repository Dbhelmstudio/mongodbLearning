/* Exercises: each runs setup + your code + verify on a fresh copy of the shop database,
   and the value of the last expression is compared with the reference solution. */
MM.PROBLEMS.push(
{
  id: 'count-delivered-india', title: 'Count delivered orders shipped to India', level: 1, difficulty: 'easy', topic: 'Querying',
  prompt: '<p>Return the number of orders with status <code>"delivered"</code> whose shipping country is <code>"India"</code>.</p>',
  starter: 'db.orders.countDocuments({ /* filter */ })',
  solution: 'db.orders.countDocuments({ status: "delivered", "shipping.country": "India" })',
  hints: ['Two conditions in one filter are an implicit AND.', 'Use dot notation for the embedded field: <code>"shipping.country"</code>.'],
  explain: 'Listing both conditions in one filter is an implicit AND; dot notation reaches into the embedded shipping document.'
},
{
  id: 'gold-customers-pune', title: 'Gold customers in Pune, alphabetically', level: 1, difficulty: 'easy', topic: 'Querying',
  prompt: '<p>Return an array of <code>{ name }</code> documents (no <code>_id</code>) for customers in tier <code>"gold"</code> whose address city is <code>"Pune"</code>, sorted by name ascending.</p>',
  starter: 'db.customers.find({}).toArray()',
  solution: 'db.customers.find({ tier: "gold", "address.city": "Pune" }, { _id: 0, name: 1 }).sort({ name: 1 }).toArray()',
  hints: ['Projection <code>{ _id: 0, name: 1 }</code>.', 'Chain <code>.sort({ name: 1 })</code>.'],
  explain: 'Filter, project and sort. Without the sort, the order would not be guaranteed.'
},
{
  id: 'electronics-price-band', title: 'Electronics between 100 and 300', level: 1, difficulty: 'easy', topic: 'Querying',
  prompt: '<p>Return <code>{ name, price }</code> (no <code>_id</code>) for products in category <code>"electronics"</code> priced from 100 to 300 inclusive, cheapest first.</p>',
  starter: 'db.products.find({ category: "electronics" }).toArray()',
  solution: 'db.products.find({ category: "electronics", price: { $gte: 100, $lte: 300 } }, { _id: 0, name: 1, price: 1 }).sort({ price: 1 }).toArray()',
  hints: ['Combine both bounds in one operator document: <code>{ $gte: 100, $lte: 300 }</code>.'],
  explain: 'Both range operators go inside the same field document; writing price twice would overwrite the first condition.'
},
{
  id: 'optin-without-phone', title: 'Marketing opt-ins without a phone', level: 1, difficulty: 'easy', topic: 'Querying',
  prompt: '<p>Count customers who have <code>marketingOptIn: true</code> and <b>no</b> <code>phone</code> field at all.</p>',
  starter: 'db.customers.countDocuments({ marketingOptIn: true })',
  solution: 'db.customers.countDocuments({ marketingOptIn: true, phone: { $exists: false } })',
  hints: ['<code>{ phone: null }</code> also matches explicit nulls. The task asks for a missing field.'],
  explain: '<code>$exists: false</code> matches only documents where the field is absent.'
},
{
  id: 'top-returned-orders', title: 'Five largest returned orders', level: 1, difficulty: 'easy', topic: 'Projection & sort',
  prompt: '<p>Return <code>{ orderNo, total }</code> (no <code>_id</code>) for the 5 returned orders with the highest total, largest first.</p>',
  starter: 'db.orders.find({ status: "returned" }).toArray()',
  solution: 'db.orders.find({ status: "returned" }, { _id: 0, orderNo: 1, total: 1 }).sort({ total: -1 }).limit(5).toArray()',
  hints: ['<code>.sort({ total: -1 }).limit(5)</code>'],
  explain: 'Sort descending then limit; the server does a top-k sort and keeps only five documents in memory.'
},
{
  id: 'upsert-visits', title: 'Idempotent visit counters with upsert', level: 1, difficulty: 'medium', topic: 'Updates',
  prompt: '<p>Collection <code>daily_visits</code> already has a document for <code>"2026-09-28"</code>. Record <b>3 visits</b> for both <code>"2026-09-28"</code> and <code>"2026-09-29"</code>, using one <code>updateOne</code> per day. New documents must get <code>firstSeen: ISODate("2026-09-29T00:00:00Z")</code>; the existing one must keep its original <code>firstSeen</code>.</p><p>The checker then returns all documents.</p>',
  setup: 'db.daily_visits.insertOne({ _id: "2026-09-28", count: 10, firstSeen: ISODate("2026-09-28T00:00:00Z") })',
  starter: 'for (const day of ["2026-09-28", "2026-09-29"]) {\n  db.daily_visits.updateOne({ _id: day }, { /* update */ })\n}',
  solution: 'for (const day of ["2026-09-28", "2026-09-29"]) {\n  db.daily_visits.updateOne(\n    { _id: day },\n    { $inc: { count: 3 }, $setOnInsert: { firstSeen: ISODate("2026-09-29T00:00:00Z") } },\n    { upsert: true }\n  )\n}',
  verify: 'db.daily_visits.find().sort({ _id: 1 }).toArray()',
  hints: ['<code>$inc</code> creates the field on insert.', '<code>$setOnInsert</code> only applies when the upsert inserts.', 'Do not forget <code>{ upsert: true }</code>.'],
  explain: '<code>$inc</code> plus <code>$setOnInsert</code> with <code>upsert: true</code> is the standard idempotent counter.'
},
{
  id: 'loyalty-upgrade', title: 'Upgrade loyal silver customers', level: 1, difficulty: 'medium', topic: 'Updates',
  prompt: '<p>All customers in tier <code>"silver"</code> who have the tag <code>"loyalty"</code> should become <code>"gold"</code> and get the tag <code>"upgraded"</code> added (without creating duplicates). The checker returns <code>{ upgraded, stillSilverLoyal }</code>.</p>',
  starter: 'db.customers.updateMany({ /* filter */ }, { /* update */ })',
  solution: 'db.customers.updateMany({ tier: "silver", tags: "loyalty" }, { $set: { tier: "gold" }, $addToSet: { tags: "upgraded" } })',
  verify: ';({ upgraded: db.customers.countDocuments({ tier: "gold", tags: "upgraded" }), stillSilverLoyal: db.customers.countDocuments({ tier: "silver", tags: "loyalty" }) })',
  hints: ['<code>{ tags: "loyalty" }</code> matches arrays containing that value.', 'Use <code>$addToSet</code> instead of <code>$push</code>.'],
  explain: 'One <code>updateMany</code> with <code>$set</code> and <code>$addToSet</code>; re-running it changes nothing more.'
},
{
  id: 'elemmatch-electronics', title: 'One electronics line with qty of 2 or more', level: 2, difficulty: 'medium', topic: 'Arrays',
  prompt: '<p>Count orders that contain <b>a single line item</b> that is in category <code>"electronics"</code> <b>and</b> has <code>qty</code> of at least 2.</p>',
  starter: 'db.orders.countDocuments({ "items.category": "electronics", "items.qty": { $gte: 2 } })',
  solution: 'db.orders.countDocuments({ items: { $elemMatch: { category: "electronics", qty: { $gte: 2 } } } })',
  hints: ['The starter lets different line items satisfy each condition.', 'Use <code>$elemMatch</code>.'],
  explain: '<code>$elemMatch</code> requires both conditions on the same element; the starter over-counts.'
},
{
  id: 'revenue-by-category', title: 'Revenue by item category', level: 2, difficulty: 'medium', topic: 'Aggregation',
  prompt: '<p>For <b>delivered</b> orders, compute revenue per item category as the sum of <code>qty * price</code> over line items. Return <code>{ category, revenue }</code> with revenue rounded to 2 decimals, highest revenue first.</p>',
  starter: 'db.orders.aggregate([\n  { $match: { status: "delivered" } }\n]).toArray()',
  solution: 'db.orders.aggregate([\n  { $match: { status: "delivered" } },\n  { $unwind: "$items" },\n  { $group: { _id: "$items.category", revenue: { $sum: { $multiply: ["$items.qty", "$items.price"] } } } },\n  { $project: { _id: 0, category: "$_id", revenue: { $round: ["$revenue", 2] } } },\n  { $sort: { revenue: -1 } }\n]).toArray()',
  hints: ['Unwind the items array first.', 'Accumulate <code>{ $multiply: ["$items.qty", "$items.price"] }</code>.', 'Round in a <code>$project</code> after grouping.'],
  explain: 'Unwind to one document per line, group by category, then round and sort.'
},
{
  id: 'orders-per-month-2026', title: 'Orders per month in 2026', level: 2, difficulty: 'medium', topic: 'Aggregation',
  prompt: '<p>Return the number of orders created per month in 2026 as <code>{ month: "2026-01", orders: N }</code>, sorted by month.</p>',
  starter: 'db.orders.aggregate([]).toArray()',
  solution: 'db.orders.aggregate([\n  { $match: { createdAt: { $gte: ISODate("2026-01-01"), $lt: ISODate("2027-01-01") } } },\n  { $group: { _id: { $dateToString: { date: "$createdAt", format: "%Y-%m" } }, orders: { $sum: 1 } } },\n  { $sort: { _id: 1 } },\n  { $project: { _id: 0, month: "$_id", orders: 1 } }\n]).toArray()',
  hints: ['Filter with a date range first so an index could be used.', '<code>$dateToString</code> with format <code>"%Y-%m"</code>.'],
  explain: 'Range-filter on the raw date, then bucket by formatted month.'
},
{
  id: 'best-rated-products', title: 'Best rated products with enough reviews', level: 2, difficulty: 'medium', topic: 'Aggregation',
  prompt: '<p>From <code>reviews</code>, return the top 3 products by average rating among products with <b>at least 20 reviews</b>: <code>{ productId, avgRating, reviews }</code>, with avgRating rounded to 2 decimals. Break ties by productId ascending.</p>',
  starter: 'db.reviews.aggregate([\n  { $group: { _id: "$productId" } }\n]).toArray()',
  solution: 'db.reviews.aggregate([\n  { $group: { _id: "$productId", avgRating: { $avg: "$rating" }, reviews: { $sum: 1 } } },\n  { $match: { reviews: { $gte: 20 } } },\n  { $sort: { avgRating: -1, _id: 1 } },\n  { $limit: 3 },\n  { $project: { _id: 0, productId: "$_id", avgRating: { $round: ["$avgRating", 2] }, reviews: 1 } }\n]).toArray()',
  hints: ['Group, then filter groups with a second <code>$match</code> (like SQL HAVING).', 'Sort before limiting; round at the end.'],
  explain: 'A <code>$match</code> after <code>$group</code> filters on computed values, the equivalent of HAVING.'
},
{
  id: 'top-spenders', title: 'Top 3 spenders with names', level: 2, difficulty: 'hard', topic: '$lookup',
  prompt: '<p>Return the 3 customers with the highest total spend on <b>delivered</b> orders: <code>{ name, spend }</code> with spend rounded to 2 decimals, highest first.</p>',
  starter: 'db.orders.aggregate([\n  { $match: { status: "delivered" } }\n]).toArray()',
  solution: 'db.orders.aggregate([\n  { $match: { status: "delivered" } },\n  { $group: { _id: "$customerId", spend: { $sum: "$total" } } },\n  { $sort: { spend: -1 } },\n  { $limit: 3 },\n  { $lookup: { from: "customers", localField: "_id", foreignField: "_id", as: "c" } },\n  { $project: { _id: 0, name: { $first: "$c.name" }, spend: { $round: ["$spend", 2] } } }\n]).toArray()',
  hints: ['Group and limit first, then join only 3 documents.', '<code>$lookup</code> returns an array; take <code>$first</code> or <code>$unwind</code>.'],
  explain: 'Joining after <code>$limit</code> means only 3 lookups instead of thousands.'
},
{
  id: 'customers-without-orders', title: 'Customers who never ordered', level: 2, difficulty: 'medium', topic: '$lookup',
  prompt: '<p>Return the number of customers that have no orders at all.</p>',
  starter: 'db.customers.countDocuments()',
  solution: 'db.customers.aggregate([\n  { $lookup: { from: "orders", localField: "_id", foreignField: "customerId", as: "o", pipeline: [{ $limit: 1 }] } },\n  { $match: { o: { $size: 0 } } },\n  { $count: "n" }\n]).toArray()[0].n',
  hints: ['An anti-join: lookup, then keep documents where the joined array is empty.', 'A sub-pipeline with <code>$limit: 1</code> avoids loading every order.'],
  explain: 'Left outer join plus an empty-array filter is the MongoDB anti-join.'
},
{
  id: 'reporting-tree', title: 'Everyone under employee 3', level: 2, difficulty: 'hard', topic: '$lookup',
  prompt: '<p>Return the number of employees who report to employee <code>_id: 3</code> directly or indirectly.</p>',
  starter: 'db.employees.countDocuments({ managerId: 3 })',
  solution: 'db.employees.aggregate([\n  { $match: { _id: 3 } },\n  { $graphLookup: { from: "employees", startWith: "$_id", connectFromField: "_id", connectToField: "managerId", as: "reports" } },\n  { $project: { n: { $size: "$reports" } } }\n]).toArray()[0].n',
  hints: ['<code>$graphLookup</code> walks recursively.', 'Start with the employee\'s own <code>_id</code> and match it against <code>managerId</code>.'],
  explain: '<code>$graphLookup</code> repeatedly follows <code>_id</code> to <code>managerId</code> until no new employees are found.'
},
{
  id: 'top-cities', title: 'Top 3 cities by delivered orders', level: 2, difficulty: 'easy', topic: 'Aggregation',
  prompt: '<p>Return the 3 shipping cities with the most delivered orders: <code>{ city, orders }</code>, most first (ties by city ascending).</p>',
  starter: 'db.orders.aggregate([]).toArray()',
  solution: 'db.orders.aggregate([\n  { $match: { status: "delivered" } },\n  { $group: { _id: "$shipping.city", orders: { $sum: 1 } } },\n  { $sort: { orders: -1, _id: 1 } },\n  { $limit: 3 },\n  { $project: { _id: 0, city: "$_id", orders: 1 } }\n]).toArray()',
  hints: ['<code>$sortByCount</code> also works, then reshape.'],
  explain: 'Group by city, sort by count with a tiebreaker, limit.'
},
{
  id: 'order-total-histogram', title: 'Order total histogram', level: 2, difficulty: 'medium', topic: 'Advanced aggregation',
  prompt: '<p>Return the number of orders in total ranges [0,100), [100,500), [500,1000), [1000,5000) and anything else in a bucket named <code>"5000+"</code>: <code>{ _id: lowerBound, count }</code>.</p>',
  starter: 'db.orders.aggregate([]).toArray()',
  solution: 'db.orders.aggregate([\n  { $bucket: { groupBy: "$total", boundaries: [0, 100, 500, 1000, 5000], default: "5000+", output: { count: { $sum: 1 } } } }\n]).toArray()',
  hints: ['<code>$bucket</code> with <code>boundaries</code> and <code>default</code>.'],
  explain: '<code>$bucket</code> assigns each document to a range by its lower bound; values outside go to <code>default</code>.'
},
{
  id: 'priciest-per-category', title: 'Most expensive product per category', level: 2, difficulty: 'medium', topic: 'Advanced aggregation',
  prompt: '<p>Return the most expensive product in each category: <code>{ category, name, price }</code>, sorted by category.</p>',
  starter: 'db.products.aggregate([]).toArray()',
  solution: 'db.products.aggregate([\n  { $sort: { price: -1 } },\n  { $group: { _id: "$category", name: { $first: "$name" }, price: { $first: "$price" } } },\n  { $sort: { _id: 1 } },\n  { $project: { _id: 0, category: "$_id", name: 1, price: 1 } }\n]).toArray()',
  hints: ['Sort by price descending, then <code>$group</code> with <code>$first</code>.', 'Alternatively <code>$top</code> (5.2+) or <code>$setWindowFields</code> with <code>$rank</code>.'],
  explain: 'Sorting before grouping makes <code>$first</code> pick the most expensive product of each group.'
},
{
  id: 'status-facets', title: 'Status counts and average in one query', level: 2, difficulty: 'medium', topic: 'Advanced aggregation',
  prompt: '<p>With a single aggregation on orders, return one document <code>{ statusCounts: [{ _id: status, n }...] sorted by _id, avgTotal }</code> where avgTotal is the average order total rounded to 2 decimals. Return just that document (not an array).</p>',
  starter: 'db.orders.aggregate([]).toArray()[0]',
  solution: 'db.orders.aggregate([\n  { $facet: {\n      statusCounts: [{ $group: { _id: "$status", n: { $sum: 1 } } }, { $sort: { _id: 1 } }],\n      avg: [{ $group: { _id: null, a: { $avg: "$total" } } }]\n  } },\n  { $project: { statusCounts: 1, avgTotal: { $round: [{ $first: "$avg.a" }, 2] } } }\n]).toArray()[0]',
  hints: ['<code>$facet</code> runs several sub-pipelines on the same input.', 'Each facet returns an array; extract the single average with <code>$first</code>.'],
  explain: '<code>$facet</code> produces one document whose fields are the outputs of each sub-pipeline.'
},
{
  id: 'esr-index', title: 'Create an index that removes the SORT', level: 2, difficulty: 'medium', topic: 'Indexes',
  prompt: '<p>The query <code>db.orders.find({ status: "shipped", total: { $gte: 500 } }).sort({ createdAt: -1 }).limit(10)</code> is used constantly. Create the index that lets it run <b>without a blocking SORT stage</b>. The checker returns <code>{ usesIndex, blockingSort }</code>.</p>',
  starter: '// db.orders.createIndex({ ... })',
  solution: 'db.orders.createIndex({ status: 1, createdAt: -1, total: 1 })',
  verify: ';const plan = db.orders.find({ status: "shipped", total: { $gte: 500 } }).sort({ createdAt: -1 }).limit(10).explain().queryPlanner.winningPlan\nconst stages = JSON.stringify(plan);\n({ usesIndex: stages.includes("IXSCAN"), blockingSort: stages.includes(\'"stage":"SORT"\') })',
  hints: ['Apply ESR: equality, then sort, then range.', 'Equality field: status. Sort field: createdAt. Range field: total.'],
  explain: 'With <code>{ status: 1, createdAt: -1, total: 1 }</code>, keys for "shipped" are already ordered by date, so no in-memory sort is needed and the range is filtered on keys.'
},
{
  id: 'covered-query', title: 'Make a query covered', level: 2, difficulty: 'hard', topic: 'Indexes',
  prompt: '<p>Make <code>db.customers.find({ tier: "platinum" }, { _id: 0, email: 1 })</code> a <b>covered query</b> (answered from the index without fetching documents). The checker returns <code>{ covered, returned }</code>.</p>',
  starter: '// db.customers.createIndex({ ... })',
  solution: 'db.customers.createIndex({ tier: 1, email: 1 })',
  verify: ';const s = db.customers.find({ tier: "platinum" }, { _id: 0, email: 1 }).explain("executionStats").executionStats;\n({ covered: s.totalDocsExamined === 0 && s.totalKeysExamined > 0, returned: s.nReturned })',
  hints: ['Every field in the filter and the projection must be in the index.', '<code>_id</code> is already excluded in the projection.'],
  explain: 'The index contains tier and email, and _id is excluded, so the server answers from index keys alone: PROJECTION_COVERED.'
},
{
  id: 'partial-unique-coupons', title: 'Unique codes among active coupons only', level: 3, difficulty: 'medium', topic: 'Index types',
  prompt: '<p>In <code>lab_coupons</code>, coupon <code>code</code> must be unique among coupons with <code>active: true</code>, while any number of inactive coupons may share a code. Create the index. The checker attempts four inserts and returns the outcome of each.</p>',
  starter: '// db.lab_coupons.createIndex(...)',
  solution: 'db.lab_coupons.createIndex({ code: 1 }, { unique: true, partialFilterExpression: { active: true } })',
  verify: 'const out = []\nfor (const d of [{ code: "A", active: true }, { code: "A", active: false }, { code: "A", active: false }, { code: "A", active: true }]) {\n  try { db.lab_coupons.insertOne(d); out.push("ok") } catch (e) { out.push(e.code) }\n}\nout',
  hints: ['A unique index can be partial.', '<code>partialFilterExpression: { active: true }</code>'],
  explain: 'Only active coupons are in the index, so uniqueness applies only to them.'
},
{
  id: 'review-validator', title: 'Validate reviews', level: 3, difficulty: 'medium', topic: 'Validation',
  prompt: '<p>Create collection <code>lab_reviews</code> with a <code>$jsonSchema</code> validator: <code>title</code> (string) and <code>rating</code> (number from 1 to 5) are required. The checker tries four inserts and returns <code>"ok"</code> or the error code for each.</p>',
  starter: 'db.createCollection("lab_reviews", { validator: { $jsonSchema: { } } })',
  solution: 'db.createCollection("lab_reviews", { validator: { $jsonSchema: {\n  bsonType: "object",\n  required: ["title", "rating"],\n  properties: {\n    title: { bsonType: "string" },\n    rating: { bsonType: ["int", "double"], minimum: 1, maximum: 5 }\n  }\n} } })',
  verify: 'const out = []\nfor (const d of [{ title: "Good", rating: 4 }, { title: "Bad", rating: 9 }, { rating: 3 }, { title: 5, rating: 2 }]) {\n  try { db.lab_reviews.insertOne(d); out.push("ok") } catch (e) { out.push(e.code) }\n}\nout',
  hints: ['<code>required</code> is an array at the top level.', 'Use <code>minimum</code> and <code>maximum</code> for the range.'],
  explain: 'Invalid documents fail with code 121 (DocumentValidationFailure).'
},
{
  id: 'transfer-transaction', title: 'Transfer money in a transaction', level: 3, difficulty: 'hard', topic: 'Transactions',
  prompt: '<p>Accounts <code>A</code> (100) and <code>B</code> (50) exist in <code>lab_accounts</code>. In one transaction, move <b>30</b> from A to B, but only if A has enough balance (otherwise abort). The checker returns both accounts.</p>',
  setup: 'db.lab_accounts.insertMany([{ _id: "A", balance: 100 }, { _id: "B", balance: 50 }])',
  starter: 'const session = db.getMongo().startSession()\nconst s = session.getDatabase("shop")\n// session.withTransaction(() => { ... })',
  solution: 'const session = db.getMongo().startSession()\nconst s = session.getDatabase("shop")\nsession.withTransaction(() => {\n  const r = s.lab_accounts.updateOne({ _id: "A", balance: { $gte: 30 } }, { $inc: { balance: -30 } })\n  if (r.modifiedCount !== 1) throw new Error("insufficient funds")\n  s.lab_accounts.updateOne({ _id: "B" }, { $inc: { balance: 30 } })\n})\nsession.endSession()',
  verify: 'db.lab_accounts.find().sort({ _id: 1 }).toArray()',
  hints: ['Put the balance check in the filter of the debit so it is atomic.', 'Throwing inside <code>withTransaction</code> aborts it.'],
  explain: 'The conditional debit and the credit commit together or not at all.'
},
{
  id: 'ttl-otps', title: 'Expire one-time passwords', level: 3, difficulty: 'easy', topic: 'Index types',
  prompt: '<p>Make documents in <code>lab_otps</code> expire 300 seconds after their <code>createdAt</code> date. The checker returns the TTL indexes as <code>{ key, expireAfterSeconds }</code>.</p>',
  starter: '// db.lab_otps.createIndex(...)',
  solution: 'db.lab_otps.createIndex({ createdAt: 1 }, { expireAfterSeconds: 300 })',
  verify: 'db.lab_otps.getIndexes().filter(i => i.expireAfterSeconds !== undefined).map(i => ({ key: i.key, expireAfterSeconds: i.expireAfterSeconds }))',
  hints: ['A TTL index is a single-field index on a date with <code>expireAfterSeconds</code>.'],
  explain: 'The TTL monitor deletes documents whose createdAt is older than now minus 300 seconds, checking every 60 seconds.'
},
{
  id: 'watch-deletes', title: 'Capture only delete events', level: 3, difficulty: 'medium', topic: 'Change streams',
  prompt: '<p>Open a change stream on <code>lab_tasks</code> that only reports <b>delete</b> events. Then update task 1 and delete task 2. End with an expression returning the <code>documentKey</code> of the first event from the stream.</p>',
  setup: 'db.lab_tasks.insertMany([{ _id: 1, t: "write" }, { _id: 2, t: "review" }])',
  starter: 'const cs = db.lab_tasks.watch()\ndb.lab_tasks.updateOne({ _id: 1 }, { $set: { done: true } })\ndb.lab_tasks.deleteOne({ _id: 2 })\ncs.tryNext().documentKey',
  solution: 'const cs = db.lab_tasks.watch([{ $match: { operationType: "delete" } }])\ndb.lab_tasks.updateOne({ _id: 1 }, { $set: { done: true } })\ndb.lab_tasks.deleteOne({ _id: 2 })\ncs.tryNext().documentKey',
  hints: ['Pass a pipeline to <code>watch()</code>.', 'Filter on <code>operationType</code>.'],
  explain: 'Filtering in the change stream pipeline means the update never reaches the consumer.'
},
{
  id: 'event-buckets', title: 'Daily device buckets', level: 3, difficulty: 'medium', topic: 'Schema patterns',
  prompt: '<p>Build bucket-pattern summaries from <code>events</code> for 15 September 2026 (UTC): one document per device with <code>{ device, count, maxLatency }</code>, sorted by device.</p>',
  starter: 'db.events.aggregate([]).toArray()',
  solution: 'db.events.aggregate([\n  { $match: { ts: { $gte: ISODate("2026-09-15"), $lt: ISODate("2026-09-16") } } },\n  { $group: { _id: "$device", count: { $sum: 1 }, maxLatency: { $max: "$latencyMs" } } },\n  { $sort: { _id: 1 } },\n  { $project: { _id: 0, device: "$_id", count: 1, maxLatency: 1 } }\n]).toArray()',
  hints: ['Filter the day with a half-open date range.'],
  explain: 'Pre-aggregating per entity per period is the bucket pattern; dashboards then read a handful of documents.'
},
{
  id: 'oplog-entry', title: 'Read the oplog entry of an $inc', level: 4, difficulty: 'medium', topic: 'Oplog',
  prompt: '<p>The setup increments the stock of product <code>P003</code> by 5. Return <code>{ op, o }</code> of the most recent oplog entry for namespace <code>shop.products</code>. Notice what was recorded instead of <code>$inc</code>.</p>',
  setup: 'db.products.updateOne({ _id: "P003" }, { $inc: { stock: 5 } })',
  starter: 'db.getSiblingDB("local").oplog.rs.find().limit(1).toArray()',
  solution: 'db.getSiblingDB("local").oplog.rs.find({ ns: "shop.products" }).sort({ $natural: -1 }).limit(1).toArray().map(e => ({ op: e.op, o: e.o }))',
  hints: ['Filter by <code>ns</code>.', 'Natural order descending gives the latest entries first.'],
  explain: 'The oplog stores the resulting value, not the increment, which makes replaying it idempotent.'
},
{
  id: 'profiler-worst', title: 'Find the worst query in the profiler', level: 4, difficulty: 'medium', topic: 'Monitoring',
  prompt: '<p>The setup enables the profiler and runs a few queries. Return <code>{ ns, planSummary, docsExamined }</code> of the profiled operation that examined the most documents.</p>',
  setup: 'db.setProfilingLevel(2)\ndb.orders.createIndex({ customerId: 1 })\ndb.orders.find({ customerId: 42 }).toArray()\ndb.orders.find({ "shipping.city": "Austin", total: { $gt: 2000 } }).toArray()\ndb.customers.find({ tier: "gold" }).limit(5).toArray()',
  starter: 'db.system.profile.find().toArray()',
  solution: 'db.system.profile.find({}, { _id: 0, ns: 1, planSummary: 1, docsExamined: 1 }).sort({ docsExamined: -1 }).limit(1).toArray()[0]',
  hints: ['Sort the profile by <code>docsExamined</code> descending.'],
  explain: 'The COLLSCAN on shipping.city examines every order; it is the first candidate for an index.'
},
{
  id: 'shard-key-cardinality', title: 'Compare shard key cardinality', level: 6, difficulty: 'medium', topic: 'Sharding',
  prompt: '<p>For the order fields <code>customerId</code>, <code>shipping.city</code> and <code>payment.method</code>, return <code>{ field, distinct }</code> (number of distinct values), highest cardinality first.</p>',
  starter: '["customerId", "shipping.city", "payment.method"].map(f => ({ field: f }))',
  solution: '["customerId", "shipping.city", "payment.method"]\n  .map(f => ({ field: f, distinct: db.orders.distinct(f).length }))\n  .sort((a, b) => b.distinct - a.distinct)',
  hints: ['<code>db.orders.distinct(field)</code> returns an array of values.'],
  explain: 'Low-cardinality fields can never be split across many chunks; customerId is the only viable prefix here.'
},
{
  id: 'text-battery', title: 'Battery complaints, minus packaging', level: 7, difficulty: 'easy', topic: 'Search',
  prompt: '<p>Create a text index on <code>reviews</code> fields <code>title</code> and <code>body</code>, then return the number of reviews that mention <code>battery</code> but not <code>packaging</code>.</p>',
  starter: 'db.reviews.countDocuments({ body: /battery/ })',
  solution: 'db.reviews.createIndex({ title: "text", body: "text" })\ndb.reviews.countDocuments({ $text: { $search: "battery -packaging" } })',
  hints: ['A leading minus negates a term in <code>$search</code>.'],
  explain: 'The text index stems and tokenizes; negated terms exclude documents that contain them.'
},
{
  id: 'vector-home', title: 'Nearest kitchen article', level: 7, difficulty: 'medium', topic: 'Vector search',
  prompt: '<p>The setup creates <code>lab_kb</code> with 4-dimensional embeddings and a vector index named <code>vec</code> (filter field: <code>category</code>). Return the titles of the 2 most similar documents to <code>[0.1, 0.1, 0.9, 0.2]</code> restricted to category <code>"home"</code>, as an array of strings.</p>',
  setup: 'db.lab_kb.insertMany([\n  { title: "Descaling an electric kettle", category: "home", embedding: [0.2, 0.0, 0.9, 0.1] },\n  { title: "Cleaning a coffee grinder", category: "home", embedding: [0.1, 0.0, 0.95, 0.1] },\n  { title: "Robot vacuum maintenance", category: "home", embedding: [0.6, 0.0, 0.5, 0.1] },\n  { title: "Smart watch sleep tracking", category: "electronics", embedding: [0.7, 0.6, 0.1, 0.1] },\n  { title: "Choosing a yoga mat", category: "sports", embedding: [0.0, 0.9, 0.1, 0.2] }\n])\ndb.lab_kb.createSearchIndex({ name: "vec", type: "vectorSearch", definition: { fields: [{ type: "vector", path: "embedding", numDimensions: 4, similarity: "cosine" }, { type: "filter", path: "category" }] } })',
  starter: 'db.lab_kb.aggregate([]).toArray().map(d => d.title)',
  solution: 'db.lab_kb.aggregate([\n  { $vectorSearch: { index: "vec", path: "embedding", queryVector: [0.1, 0.1, 0.9, 0.2], numCandidates: 20, limit: 2, filter: { category: "home" } } }\n]).toArray().map(d => d.title)',
  hints: ['<code>$vectorSearch</code> must be the first stage.', 'Use the <code>filter</code> option rather than a later <code>$match</code>.'],
  explain: 'The pre-filter restricts candidates to home articles before ranking by cosine similarity.'
}
);
