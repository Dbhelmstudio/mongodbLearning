/* Level 2 — Intermediate */
MM.addLessons([
{
  id: 'array-queries', module: 'arrays-embedded', title: 'Querying arrays and embedded documents', minutes: 20,
  summary: 'How a condition on an array field matches any element, why that surprises people, and how $elemMatch, $all and $size give you precise control.',
  objectives: ['Predict how filters match array fields', 'Use $elemMatch to apply several conditions to the same element', 'Use $all, $size and positional dot notation', 'Query arrays of embedded documents'],
  sections: {
    concept: `<p>A condition on an array field matches if <b>any element</b> satisfies it: <code>{ tags: "b2b" }</code> matches <code>tags: ["loyalty", "b2b"]</code>. That applies to arrays of embedded documents too: <code>{ "items.category": "books" }</code> matches an order with at least one book.</p>
<p>The trap: with several conditions on the same array, each condition can be satisfied by a <b>different</b> element. <code>{ "items.category": "books", "items.qty": { $gte: 3 } }</code> matches an order with one book and a separate line of 3 mugs. To require one element that satisfies both, use <code>$elemMatch</code>:</p>
<pre class="static">{ items: { $elemMatch: { category: "books", qty: { $gte: 3 } } } }</pre>
<ul><li><code>$all: ["a", "b"]</code>: the array contains every listed value, in any order.</li>
<li><code>$size: 2</code>: exactly 2 elements (no ranges; store a count field if you need <code>$gt</code>).</li>
<li><code>"items.0.price"</code>: a specific position.</li>
<li><code>{ tags: ["a", "b"] }</code>: the whole array equals exactly <code>["a", "b"]</code> in that order.</li></ul>`,
    why: `<p>Arrays are central to the document model (order items, tags, roles, addresses). Getting array semantics wrong produces queries that return extra documents, which is worse than an error because nobody notices.</p>`,
    useCase: `<p>"Find orders containing a single line of 3 or more electronics items" is an <code>$elemMatch</code> query. "Find customers tagged both <code>b2b</code> and <code>loyalty</code>" is <code>$all</code>. "Find customers with no tags" is <code>{ tags: { $size: 0 } }</code>.</p>`,
    internals: `<p>An index on an array field is <b>multikey</b>: it stores one index key per array element. That is why any-element matching is efficient. A compound index can include at most one array field per document, because indexing the cartesian product of two arrays could explode. For <code>$elemMatch</code> the planner can combine bounds on several fields of the same embedded element when they share an array path.</p>`
  },
  examples: [
    { title: 'Any element matches', code: `db.customers.countDocuments({ tags: "b2b" })
db.orders.countDocuments({ "items.category": "books" })` },
    { title: 'Separate conditions vs $elemMatch', code: `db.orders.countDocuments({ "items.category": "electronics", "items.qty": { $gte: 3 } })
db.orders.countDocuments({ items: { $elemMatch: { category: "electronics", qty: { $gte: 3 } } } })`, note: 'The first count is larger: the two conditions can be satisfied by different line items.' },
    { title: '$all, $size and positions', code: `db.customers.find({ tags: { $all: ["b2b", "loyalty"] } }, { name: 1, tags: 1 }).limit(3)
db.customers.countDocuments({ tags: { $size: 0 } })
db.orders.countDocuments({ "items.3": { $exists: true } })
db.orders.find({ "items.0.price": { $gt: 4000 } }, { orderNo: 1, "items.name": 1 }).limit(3)` },
    { title: 'Arrays of scalars with ranges', code: `db.lab_scores.drop()
db.lab_scores.insertMany([{ s: [2, 9] }, { s: [5] }, { s: [11, 1] }])
db.lab_scores.find({ s: { $gt: 4, $lt: 6 } }, { _id: 0 })
db.lab_scores.find({ s: { $elemMatch: { $gt: 4, $lt: 6 } } }, { _id: 0 })`, note: 'Without $elemMatch, [2, 9] matches: 9 is greater than 4 and 2 is less than 6.' }
  ],
  mistakes: [
    'Using two separate conditions on an array of sub-documents when they must hold for the same element.',
    'Trying <code>$size: { $gt: 3 }</code>; it accepts only an exact number. Use <code>"arr.3": { $exists: true }</code> or a stored count.',
    'Matching arrays by full value (<code>{ tags: ["a", "b"] }</code>) when order or extra elements differ.'
  ],
  interview: [
    { q: 'When do you need $elemMatch?', a: '<p>When two or more conditions must be satisfied by the <b>same</b> array element, either on fields of embedded documents or a range on scalar arrays. Without it, each condition can be satisfied by a different element.</p>' },
    { q: 'What is a multikey index and what are its limitations?', a: '<p>An index on a field that holds an array in at least one document: it stores a key per element. Limitations: at most one array field per document within a compound index, it cannot be a shard key, multikey indexes cannot cover queries on the array field, and bounds on two predicates of the same array field may not be intersected unless you use <code>$elemMatch</code>.</p>' }
  ],
  quiz: [
    { q: 'Does <code>{ tags: "x" }</code> match <code>{ tags: ["x", "y"] }</code>?', options: ['Yes', 'No', 'Only with $elemMatch', 'Only with a multikey index'], answer: 0 },
    { q: 'Which finds orders with a single line item that is a book with qty >= 2?', options: ['{ "items.category": "books", "items.qty": { $gte: 2 } }', '{ items: { $elemMatch: { category: "books", qty: { $gte: 2 } } } }', '{ items: { category: "books", qty: 2 } }', '{ $and: [{ "items.category": "books" }, { "items.qty": 2 }] }'], answer: 1 }
  ]
},
{
  id: 'array-updates', module: 'arrays-embedded', title: 'Updating arrays: $push, $pull, positional operators', minutes: 20,
  summary: 'Add, remove and modify array elements in place, including the positional $, $[] and filtered $[id] operators.',
  objectives: ['Use $push with $each, $slice, $sort', 'Use $addToSet, $pull, $pop', 'Update matched elements with $, all elements with $[], selected elements with $[id] and arrayFilters'],
  sections: {
    concept: `<table><tr><th>Operator</th><th>Effect</th></tr>
<tr><td><code>$push</code></td><td>append (with <code>$each</code>, <code>$position</code>, <code>$slice</code>, <code>$sort</code> modifiers)</td></tr>
<tr><td><code>$addToSet</code></td><td>append only if not already present</td></tr>
<tr><td><code>$pull</code></td><td>remove all elements matching a value or condition</td></tr>
<tr><td><code>$pullAll</code> / <code>$pop</code></td><td>remove listed values / first (-1) or last (1) element</td></tr>
<tr><td><code>items.$.qty</code></td><td>the <b>first</b> element matched by the query filter</td></tr>
<tr><td><code>items.$[].qty</code></td><td>every element</td></tr>
<tr><td><code>items.$[it].qty</code> + <code>arrayFilters: [{ "it.category": "books" }]</code></td><td>every element matching the filter</td></tr></table>
<p><code>$push</code> with <code>$each</code> + <code>$slice: -N</code> keeps only the last N elements: a capped array, the safe way to store "recent" items.</p>`,
    why: `<p>Changing one element in place is atomic and sends only the change over the wire. The alternative, reading the array, editing it in the application and writing it back, loses concurrent updates.</p>`,
    useCase: `<p>A "recently viewed products" list on the customer: <code>$push: { recentlyViewed: { $each: [productId], $slice: -10 } }</code>. Marking every book line in an order as shipped: <code>$set: { "items.$[b].shipped": true }</code> with <code>arrayFilters: [{ "b.category": "books" }]</code>.</p>`,
    internals: `<p>Arrays are BSON documents with numeric keys, so updates rewrite the document in the storage engine (WiredTiger writes a new version; there is no in-place byte patching). Large arrays make every update more expensive and every multikey index bigger. The oplog records array updates as diffs or as the full new array, so a big array updated often also inflates the oplog.</p>`
  },
  examples: [
    { title: '$push with $each and $slice, $addToSet', code: `db.customers.updateOne({ _id: 7 }, { $push: { recentlyViewed: { $each: ["P010", "P011", "P012"], $slice: -2 } } })
db.customers.updateOne({ _id: 7 }, { $addToSet: { tags: { $each: ["loyalty", "beta"] } } })
db.customers.findOne({ _id: 7 }, { recentlyViewed: 1, tags: 1 })` },
    { title: '$pull with a condition, $pop', code: `db.lab_cart.drop()
db.lab_cart.insertOne({ _id: 1, items: [{ sku: "A", qty: 0 }, { sku: "B", qty: 2 }, { sku: "C", qty: 0 }], history: [1, 2, 3] })
db.lab_cart.updateOne({ _id: 1 }, { $pull: { items: { qty: 0 } }, $pop: { history: -1 } })
db.lab_cart.findOne()` },
    { title: 'Positional $: the first matched element', code: `db.lab_cart.updateOne({ _id: 1, "items.sku": "B" }, { $inc: { "items.$.qty": 5 } })
db.lab_cart.findOne()` },
    { title: '$[] and $[identifier] with arrayFilters', code: `const o = db.orders.findOne({ "items.2": { $exists: true } })
db.orders.updateOne({ _id: o._id }, { $set: { "items.$[].checked": true } })
db.orders.updateOne({ _id: o._id }, { $mul: { "items.$[big].price": 0.9 } }, { arrayFilters: [{ "big.price": { $gte: 100 } }] })
db.orders.findOne({ _id: o._id }, { items: 1 })` }
  ],
  mistakes: [
    'Using <code>items.$</code> without a filter condition on <code>items</code>: the server cannot know which element you mean.',
    'Expecting <code>$</code> to update all matching elements; it updates only the first. Use <code>$[id]</code> with arrayFilters.',
    'Letting arrays grow forever with <code>$push</code>; add <code>$slice</code> or move the data to its own collection.'
  ],
  interview: [
    { q: 'How do you update all array elements that match a condition?', a: '<p>Use the filtered positional operator: <code>updateMany(filter, { $set: { "items.$[x].status": "shipped" } }, { arrayFilters: [{ "x.category": "books" }] })</code>. <code>$</code> only updates the first match and <code>$[]</code> updates every element.</p>' },
    { q: 'How would you store "last 50 activities" per user?', a: '<p><code>$push</code> with <code>$each</code> and <code>$slice: -50</code> keeps a bounded array in the user document. Full history goes to a separate collection (or a time series collection) with a TTL or archival policy.</p>' }
  ],
  quiz: [
    { q: 'Which operator adds a value only if it is not already in the array?', options: ['$push', '$addToSet', '$set', '$each'], answer: 1 },
    { q: 'What does <code>items.$.qty</code> refer to?', options: ['All items', 'The first item matched by the query', 'The last item', 'Items listed in arrayFilters'], answer: 1 }
  ]
},
{
  id: 'aggregation-basics', module: 'aggregation', title: 'The aggregation pipeline: $match, $group, $project, $sort', minutes: 25,
  summary: 'Pipelines transform documents stage by stage. Build reports with $match, $group, $project, $sort, $limit and accumulators, and learn why stage order matters.',
  objectives: ['Read and write multi-stage pipelines', 'Group with $sum, $avg, $min, $max, $push, $addToSet, $first', 'Reshape documents with $project, $set and $unset', 'Order stages so indexes and early filtering do the work'],
  sections: {
    concept: `<p>A pipeline is an array of stages. Each stage receives the stream of documents produced by the previous one.</p>
<pre class="static">db.orders.aggregate([
  { $match: { status: "delivered" } },                   // filter (uses indexes when first)
  { $group: { _id: "$shipping.country",                   // group key
              orders: { $sum: 1 }, revenue: { $sum: "$total" } } },
  { $sort: { revenue: -1 } },
  { $limit: 5 }
])</pre>
<table><tr><th>Stage</th><th>Purpose</th></tr>
<tr><td><code>$match</code></td><td>filter with query syntax</td></tr><tr><td><code>$project</code> / <code>$set</code> (<code>$addFields</code>) / <code>$unset</code></td><td>reshape, compute fields</td></tr>
<tr><td><code>$group</code></td><td>group by <code>_id</code> expression with accumulators</td></tr><tr><td><code>$sort</code>, <code>$limit</code>, <code>$skip</code></td><td>order and page</td></tr>
<tr><td><code>$unwind</code></td><td>one output document per array element</td></tr><tr><td><code>$count</code>, <code>$sortByCount</code></td><td>shortcuts</td></tr></table>
<p>Field paths are strings starting with <code>$</code> (<code>"$total"</code>); variables start with <code>$$</code> (<code>"$$NOW"</code>, <code>"$$ROOT"</code>). Expressions are operators such as <code>$add</code>, <code>$multiply</code>, <code>$cond</code>, <code>$dateToString</code>, <code>$size</code>, <code>$filter</code>, <code>$map</code>.</p>`,
    why: `<p>Aggregation is where reporting, analytics, data cleanup and many API responses happen. Running it in the database avoids shipping millions of documents to the application, but only if the pipeline is shaped so the expensive parts touch as little data as possible.</p>`,
    useCase: `<p>A daily dashboard: revenue by country for delivered orders, top 10 products by units sold, average order value by payment method. Each is a 3 to 5 stage pipeline that runs in milliseconds with the right index and a <code>$match</code> first.</p>`,
    internals: `<p>The optimizer rewrites pipelines: it moves <code>$match</code> before <code>$project</code>/<code>$set</code> when the fields allow it, merges <code>$sort</code> + <code>$limit</code> into a top-k sort, and pushes a leading <code>$match</code>/<code>$sort</code> into the query layer so it can use an index. Since 5.x the slot-based execution engine (SBE) runs <code>$group</code> and <code>$lookup</code> faster for eligible pipelines. Each blocking stage (<code>$group</code>, <code>$sort</code>) has a 100 MB memory limit per stage before spilling to disk (<code>allowDiskUse</code>, enabled by default since 6.0).</p>
<p>Use the <b>Step through</b> button on any pipeline example to see the documents after each stage.</p>`
  },
  examples: [
    { title: 'Revenue by country', code: `db.orders.aggregate([
  { $match: { status: "delivered" } },
  { $group: { _id: "$shipping.country", orders: { $sum: 1 }, revenue: { $sum: "$total" } } },
  { $project: { country: "$_id", _id: 0, orders: 1, revenue: { $round: ["$revenue", 2] } } },
  { $sort: { revenue: -1 } }
])` },
    { title: 'Top products by units sold', code: `db.orders.aggregate([
  { $match: { status: { $in: ["delivered", "shipped"] } } },
  { $unwind: "$items" },
  { $group: { _id: "$items.productId", name: { $first: "$items.name" }, units: { $sum: "$items.qty" } } },
  { $sort: { units: -1 } },
  { $limit: 5 }
])` },
    { title: 'Computed fields and conditional logic', code: `db.orders.aggregate([
  { $match: { createdAt: { $gte: ISODate("2026-09-01") } } },
  { $set: {
      lines: { $size: "$items" },
      band: { $switch: { branches: [
        { case: { $gte: ["$total", 2000] }, then: "large" },
        { case: { $gte: ["$total", 500] }, then: "medium" } ], default: "small" } },
      month: { $dateToString: { format: "%Y-%m", date: "$createdAt" } } } },
  { $group: { _id: "$band", orders: { $sum: 1 }, avgLines: { $avg: "$lines" } } },
  { $sort: { _id: 1 } }
])` },
    { title: '$sortByCount and $count', code: `db.orders.aggregate([{ $sortByCount: "$payment.method" }])
db.customers.aggregate([{ $match: { tier: "platinum" } }, { $count: "platinumCustomers" }])` },
    { title: 'Array expressions without $unwind', code: `db.orders.aggregate([
  { $limit: 3 },
  { $project: {
      orderNo: 1,
      expensive: { $filter: { input: "$items", as: "i", cond: { $gte: ["$$i.price", 500] } } },
      names: { $map: { input: "$items", as: "i", in: { $toUpper: "$$i.name" } } },
      units: { $sum: "$items.qty" } } }
])` }
  ],
  mistakes: [
    'Putting <code>$match</code> after <code>$group</code> or <code>$unwind</code> when it could filter first.',
    'Using <code>$unwind</code> + <code>$group</code> to compute something that <code>$sum</code>, <code>$filter</code> or <code>$map</code> can do on the array directly.',
    'Forgetting the <code>$</code> prefix: <code>{ $sum: "total" }</code> sums the string literal, giving 0.',
    'Expecting a 16 MB document limit not to apply: each output document (and <code>$push</code> arrays in <code>$group</code>) must still fit in 16 MB.'
  ],
  interview: [
    { q: 'How do you make an aggregation pipeline fast?', a: '<p>Start with <code>$match</code> (and <code>$sort</code>) on indexed fields so the pipeline begins from an index scan; project away unneeded fields early only if it reduces a later blocking stage; use <code>$sort</code> + <code>$limit</code> together for top-k; avoid <code>$unwind</code> where array expressions work; check <code>explain()</code> for COLLSCAN and the first stage; run heavy analytics on a secondary or an analytics node.</p>' },
    { q: 'What is the difference between $project and $set?', a: '<p><code>$set</code> (alias <code>$addFields</code>) adds or overwrites fields and keeps everything else. <code>$project</code> outputs only the fields you list (or excludes the ones you set to 0). Use <code>$set</code> to compute, <code>$project</code> to shape the final output.</p>' }
  ],
  quiz: [
    { q: 'Why should $match come as early as possible?', options: ['It is required to be first', 'It reduces documents for later stages and can use an index when first', 'Otherwise $group fails', 'It enables allowDiskUse'], answer: 1 },
    { q: 'In <code>{ $sum: "$total" }</code>, what is <code>"$total"</code>?', options: ['A variable', 'A field path', 'A string literal', 'An operator'], answer: 1 },
    { q: 'Which stage outputs one document per array element?', options: ['$group', '$unwind', '$project', '$facet'], answer: 1 }
  ]
},
{
  id: 'aggregation-dates-strings', module: 'aggregation', title: 'Expressions: dates, strings and conditionals', minutes: 18,
  summary: 'The expression operators you will use every day: time bucketing, string manipulation, type conversion and null handling.',
  objectives: ['Bucket by day, week and month with $dateTrunc and $dateToString', 'Clean strings with $toLower, $trim, $split, $concat', 'Convert types safely with $convert', 'Handle missing values with $ifNull and $cond'],
  sections: {
    concept: `<ul>
<li><b>Dates</b>: <code>$dateTrunc</code> (5.0+) truncates to a unit with an optional timezone; <code>$dateToString</code> formats; <code>$dateDiff</code>, <code>$dateAdd</code>; <code>$year</code>, <code>$month</code>, <code>$dayOfWeek</code>, <code>$hour</code>.</li>
<li><b>Strings</b>: <code>$concat</code>, <code>$toLower</code>/<code>$toUpper</code>, <code>$trim</code>, <code>$split</code>, <code>$substrCP</code>, <code>$regexMatch</code>, <code>$strLenCP</code>.</li>
<li><b>Types</b>: <code>$toInt</code>, <code>$toDouble</code>, <code>$toDate</code>, <code>$toString</code>, and <code>$convert</code> with <code>onError</code>/<code>onNull</code> for dirty data.</li>
<li><b>Conditionals</b>: <code>$cond</code>, <code>$switch</code>, <code>$ifNull</code>.</li>
</ul>`,
    why: `<p>Time-bucketed reports are the most common analytic query. Timezones matter: a day in India starts 5.5 hours before a UTC day, so "orders per day" differs depending on where you truncate.</p>`,
    useCase: `<p>A finance report needs revenue per calendar month in the <code>Asia/Kolkata</code> timezone. <code>$dateTrunc: { date: "$createdAt", unit: "month", timezone: "Asia/Kolkata" }</code> groups correctly; truncating in UTC would put the first hours of each month into the previous one.</p>`,
    internals: `<p>Expressions are evaluated per document in the pipeline; they cannot use indexes unless they appear in a leading <code>$match</code> as simple comparisons. That is why you filter on the raw <code>createdAt</code> range first and bucket afterwards, never <code>$match: { $expr: { $eq: [{ $month: "$createdAt" }, 9] } }</code> on a large collection.</p>`
  },
  examples: [
    { title: 'Orders per month', code: `db.orders.aggregate([
  { $match: { createdAt: { $gte: ISODate("2026-01-01") } } },
  { $group: { _id: { $dateTrunc: { date: "$createdAt", unit: "month" } }, orders: { $sum: 1 }, revenue: { $sum: "$total" } } },
  { $sort: { _id: 1 } },
  { $project: { _id: 0, month: { $dateToString: { date: "$_id", format: "%Y-%m" } }, orders: 1, revenue: { $round: ["$revenue", 0] } } }
])` },
    { title: 'Day of week and hour', code: `db.events.aggregate([
  { $match: { type: "checkout" } },
  { $group: { _id: { $dayOfWeek: "$ts" }, n: { $sum: 1 }, p95ish: { $max: "$latencyMs" } } },
  { $sort: { _id: 1 } }
])` },
    { title: 'Strings and null handling', code: `db.customers.aggregate([
  { $limit: 5 },
  { $project: {
      _id: 0,
      first: { $arrayElemAt: [{ $split: ["$name", " "] }, 0] },
      domain: { $arrayElemAt: [{ $split: ["$email", "@"] }, 1] },
      label: { $concat: [{ $toUpper: "$tier" }, " / ", "$address.city"] },
      phone: { $ifNull: ["$phone", "not provided"] } } }
])` },
    { title: 'Safe conversion', code: `db.lab_dirty.drop()
db.lab_dirty.insertMany([{ v: "42" }, { v: "4.5" }, { v: "n/a" }, { v: null }])
db.lab_dirty.aggregate([{ $project: { _id: 0, v: 1, n: { $convert: { input: "$v", to: "double", onError: -1, onNull: 0 } } } }])` }
  ],
  mistakes: [
    'Bucketing by day in UTC when the business reports in local time.',
    'Filtering with <code>$expr</code> on computed date parts instead of a raw date range, which forces a full scan.',
    'Using <code>$toInt</code> on dirty data without <code>$convert</code> + <code>onError</code>, which fails the whole pipeline on the first bad value.'
  ],
  interview: [
    { q: 'How do you produce a daily report in a non-UTC timezone?', a: '<p>Filter with a UTC date range that corresponds to the local period, then group by <code>$dateTrunc</code> (or <code>$dateToString</code>) with <code>timezone: "Asia/Kolkata"</code>. Dates are stored in UTC; the timezone is applied only when bucketing or formatting.</p>' }
  ],
  quiz: [
    { q: 'Which operator handles conversion errors without failing the pipeline?', options: ['$toInt', '$convert with onError', '$ifNull', '$cond'], answer: 1 },
    { q: 'How are Date values stored?', options: ['In the server timezone', 'As UTC milliseconds', 'As strings', 'In the client timezone'], answer: 1 }
  ]
},
{
  id: 'lookup-joins', module: 'aggregation-joins', title: '$lookup, $unwind and $graphLookup', minutes: 22,
  summary: 'Join collections inside a pipeline, correlate with sub-pipelines, walk hierarchies with $graphLookup, and know when a join means your schema is wrong.',
  objectives: ['Write equality and pipeline $lookup', 'Flatten joined arrays with $unwind and preserveNullAndEmptyArrays', 'Traverse trees and graphs with $graphLookup', 'Index the foreign field and keep joins off hot paths'],
  sections: {
    concept: `<pre class="static">{ $lookup: { from: "customers", localField: "customerId", foreignField: "_id", as: "customer" } }</pre>
<p>adds an array field <code>customer</code> with the matching documents. Follow with <code>$unwind: "$customer"</code> (or <code>$first</code>) for a one-to-one join. Since 5.0 you can combine <code>localField</code>/<code>foreignField</code> with a sub-<code>pipeline</code> to filter or project the joined documents; the <code>let</code> + <code>pipeline</code> form allows arbitrary correlated conditions.</p>
<p><code>$graphLookup</code> recursively follows a reference (<code>connectFromField</code> → <code>connectToField</code>) to walk org charts, category trees or social graphs, with <code>maxDepth</code> and <code>depthField</code>.</p>`,
    why: `<p>Joins are fine for reports, admin screens and occasional lookups. A join on every request of a high-traffic endpoint usually signals that the data should be embedded or that a few fields should be duplicated (the extended reference pattern).</p>`,
    useCase: `<p>An admin "order details" screen joins the order with its customer and the products' current stock. The storefront order history page does not join at all: each order already carries the item names and prices at the time of purchase.</p>`,
    internals: `<p>For every input document, <code>$lookup</code> runs a query against <code>from</code>. Without an index on <code>foreignField</code> each lookup is a collection scan: 5,000 orders joining a 500-document collection is 2.5 million document examinations. With an index it is 5,000 index seeks. Since 6.0 SBE can execute some lookups as hash joins. In sharded clusters, <code>from</code> may be sharded since 5.1.</p>`
  },
  examples: [
    { title: 'Join orders to customers', code: `db.orders.aggregate([
  { $match: { status: "returned" } },
  { $limit: 3 },
  { $lookup: { from: "customers", localField: "customerId", foreignField: "_id", as: "customer" } },
  { $unwind: "$customer" },
  { $project: { _id: 0, orderNo: 1, total: 1, "customer.name": 1, "customer.tier": 1 } }
])` },
    { title: 'Lookup with a sub-pipeline', code: `db.products.aggregate([
  { $match: { category: "electronics" } },
  { $limit: 3 },
  { $lookup: {
      from: "reviews", localField: "_id", foreignField: "productId", as: "topReviews",
      pipeline: [{ $match: { rating: { $gte: 4 } } }, { $sort: { helpfulVotes: -1 } }, { $limit: 2 }, { $project: { _id: 0, rating: 1, title: 1 } }] } },
  { $project: { name: 1, topReviews: 1 } }
])` },
    { title: 'Customers who never ordered', code: `db.customers.aggregate([
  { $lookup: { from: "orders", localField: "_id", foreignField: "customerId", as: "o", pipeline: [{ $limit: 1 }, { $project: { _id: 1 } }] } },
  { $match: { o: { $size: 0 } } },
  { $count: "customersWithoutOrders" }
])` },
    { title: '$graphLookup: reporting chain', code: `db.employees.aggregate([
  { $match: { _id: 30 } },
  { $graphLookup: { from: "employees", startWith: "$managerId", connectFromField: "managerId", connectToField: "_id", as: "chain", depthField: "depth" } },
  { $project: { name: 1, title: 1, chain: { $map: { input: { $sortArray: { input: "$chain", sortBy: { depth: 1 } } }, as: "m", in: { $concat: ["$$m.name", " (", "$$m.title", ")"] } } } } }
])` }
  ],
  mistakes: [
    'No index on <code>foreignField</code>.',
    'Using <code>$lookup</code> on the hot path of a high-traffic API instead of embedding or duplicating the few fields needed.',
    'Forgetting that <code>$unwind</code> drops documents with no match unless <code>preserveNullAndEmptyArrays: true</code>.',
    'Joining a huge array into each document and blowing the 16 MB limit; filter and limit inside the sub-pipeline.'
  ],
  interview: [
    { q: 'Does MongoDB support joins? When should you use them?', a: '<p>Yes, via <code>$lookup</code> (left outer join) and <code>$graphLookup</code> (recursive). Use them for reporting, admin tools and infrequent queries. For frequent reads, model data so it is embedded or duplicated where it is read, because each joined document is a separate query and there are no foreign keys to maintain consistency.</p>' },
    { q: 'How do you find documents in A with no match in B?', a: '<p><code>$lookup</code> from A to B with a sub-pipeline <code>[{ $limit: 1 }]</code>, then <code>$match: { joined: { $size: 0 } }</code>. Make sure B is indexed on the join field.</p>' }
  ],
  quiz: [
    { q: 'What does $lookup add to each input document?', options: ['A single joined document', 'An array of matching documents', 'A reference', 'Nothing; it filters'], answer: 1 },
    { q: 'Which index matters most for $lookup performance?', options: ['On localField in the input collection', 'On foreignField in the from collection', 'On _id of the input', 'None; joins never use indexes'], answer: 1 }
  ]
},
{
  id: 'advanced-aggregation', module: 'aggregation-advanced', title: '$facet, $bucket, window functions, $merge and $out', minutes: 25,
  summary: 'Multi-faceted search results, histograms, running totals and rankings, and materialized views that refresh incrementally.',
  objectives: ['Compute several aggregations in one pass with $facet', 'Build histograms with $bucket and $bucketAuto', 'Use $setWindowFields for running totals, moving averages and ranks', 'Materialize results with $merge (incremental) or $out (replace)'],
  sections: {
    concept: `<ul>
<li><code>$facet</code>: run several sub-pipelines on the same input and return one document with each result. Typical for search pages (results + counts per category + price ranges).</li>
<li><code>$bucket</code> (explicit boundaries) and <code>$bucketAuto</code> (N evenly filled buckets): histograms.</li>
<li><code>$setWindowFields</code> (5.0+): window functions over partitions sorted by a field: <code>$sum</code> with <code>window: { documents: ["unbounded", "current"] }</code> for running totals, <code>$avg</code> over a range for moving averages, <code>$rank</code>, <code>$denseRank</code>, <code>$shift</code>.</li>
<li><code>$merge</code>: write results into a collection, inserting, replacing or merging per document; can target the same or another database and run incrementally.</li>
<li><code>$out</code>: replace a collection atomically with the results.</li>
</ul>`,
    why: `<p>These stages replace application-side loops and separate batch jobs. <code>$merge</code> in particular lets you maintain pre-aggregated summary collections (an on-demand materialized view) so dashboards read 30 documents instead of aggregating millions on every page load.</p>`,
    useCase: `<p>A nightly job computes yesterday's revenue per product and <code>$merge</code>s it into <code>daily_product_sales</code> keyed by <code>{ day, productId }</code>. The dashboard reads that small collection. Re-running the job for the same day replaces the same keys, so it is idempotent.</p>`,
    internals: `<p><code>$facet</code> sub-pipelines cannot use indexes (only the stages before <code>$facet</code> can), and the single output document must fit in 16 MB. <code>$setWindowFields</code> requires sorting each partition; with a large unbounded window it may spill to disk. <code>$out</code> writes to a temporary collection and renames it at the end, so readers see either the old or the new data. <code>$merge</code> needs a unique index on its <code>on</code> fields.</p>`
  },
  examples: [
    { title: '$facet for a search results page', code: `db.products.aggregate([
  { $match: { rating: { $gte: 4 } } },
  { $facet: {
      results: [{ $sort: { rating: -1 } }, { $limit: 3 }, { $project: { name: 1, price: 1, rating: 1 } }],
      byCategory: [{ $sortByCount: "$category" }],
      priceStats: [{ $group: { _id: null, min: { $min: "$price" }, max: { $max: "$price" }, avg: { $avg: "$price" } } }]
  } }
])` },
    { title: 'Histogram with $bucket', code: `db.orders.aggregate([
  { $bucket: { groupBy: "$total", boundaries: [0, 100, 250, 500, 1000, 2500], default: "2500+", output: { orders: { $sum: 1 } } } }
])` },
    { title: 'Running total and rank with $setWindowFields', code: `db.orders.aggregate([
  { $match: { createdAt: { $gte: ISODate("2026-09-01") }, status: { $ne: "cancelled" } } },
  { $group: { _id: { $dateTrunc: { date: "$createdAt", unit: "day" } }, revenue: { $sum: "$total" } } },
  { $setWindowFields: { sortBy: { _id: 1 }, output: {
      runningTotal: { $sum: "$revenue", window: { documents: ["unbounded", "current"] } },
      movingAvg3d: { $avg: "$revenue", window: { documents: [-2, 0] } },
      rank: { $rank: {} } } } },
  { $limit: 7 }
])`, note: '<code>$rank</code> here ranks by date because the window is sorted by <code>_id</code>; sort by revenue to rank the best days.' },
    { title: 'Materialize with $merge', code: `db.orders.aggregate([
  { $match: { status: "delivered" } },
  { $group: { _id: "$customerId", orders: { $sum: 1 }, spend: { $sum: "$total" }, lastOrder: { $max: "$createdAt" } } },
  { $merge: { into: "customer_stats", on: "_id", whenMatched: "replace", whenNotMatched: "insert" } }
])
db.customer_stats.find().sort({ spend: -1 }).limit(3)` }
  ],
  mistakes: [
    'Using <code>$facet</code> as the first stage on a big collection, expecting each facet to use an index.',
    'Re-aggregating raw data on every dashboard request instead of maintaining a summary with <code>$merge</code>.',
    'Using <code>$out</code> when you meant to update incrementally; <code>$out</code> replaces the whole target collection.'
  ],
  interview: [
    { q: 'How do you build a materialized view in MongoDB?', a: '<p>An aggregation ending in <code>$merge</code> into a summary collection, run on a schedule or triggered by change streams. <code>on</code> defines the key (backed by a unique index), <code>whenMatched</code> chooses replace/merge/keepExisting/pipeline, and incremental runs only process new data (filter by a high-water mark). Standard views (<code>createView</code>) are not materialized; they run the pipeline on every read.</p>' },
    { q: 'What are window functions used for?', a: '<p><code>$setWindowFields</code> computes values over a sorted window of related documents without collapsing them like <code>$group</code>: running totals, moving averages, rank within a partition, gaps between consecutive events (<code>$shift</code>), time-weighted averages with <code>range</code> windows on dates.</p>' }
  ],
  quiz: [
    { q: 'Which stage replaces the entire target collection?', options: ['$merge', '$out', '$facet', '$set'], answer: 1 },
    { q: 'Can stages inside $facet use indexes?', options: ['Yes, always', 'No; only stages before $facet can', 'Only $match', 'Only on secondaries'], answer: 1 }
  ]
},
{
  id: 'schema-design-basics', module: 'schema-design', title: 'Embedding vs referencing', minutes: 25,
  summary: 'Design for how the application reads and writes. Learn the rules of thumb for embedding versus referencing based on relationship cardinality, growth and access patterns.',
  objectives: ['Model one-to-one, one-to-few, one-to-many and many-to-many relationships', 'Decide between embedding and referencing', 'Recognize unbounded growth and the 16 MB risk', 'Accept and manage controlled duplication'],
  sections: {
    concept: `<div data-diagram="document-model"></div>
<p><b>The guiding rule: data that is accessed together should be stored together.</b> Start from the queries, not the entities.</p>
<table><tr><th>Relationship</th><th>Typical design</th><th>Example</th></tr>
<tr><td>One-to-one</td><td>Embed</td><td>customer and its preferences</td></tr>
<tr><td>One-to-few (bounded)</td><td>Embed an array</td><td>customer addresses, order line items</td></tr>
<tr><td>One-to-many (hundreds+)</td><td>Reference from the "many" side</td><td><code>orders.customerId</code></td></tr>
<tr><td>One-to-squillions</td><td>Reference from the child, never an array in the parent</td><td>events per user</td></tr>
<tr><td>Many-to-many</td><td>Array of ids on one or both sides, or a link collection</td><td>students and courses</td></tr></table>
<p><b>Embed</b> when the child is read with the parent, is bounded in number, and is owned by the parent. <b>Reference</b> when the child is large, unbounded, shared by many parents, updated independently, or queried on its own.</p>`,
    why: `<p>Schema is the biggest lever on performance. A good schema makes the common query a single indexed read; a bad one needs joins, multiple round trips, or ever-growing documents that degrade every write. Fixing a schema later means a data migration on a live system.</p>`,
    useCase: `<p>The shop embeds line items in orders and copies <code>name</code>, <code>category</code> and <code>price</code> from the product at purchase time. That copy is intentional: the order must show what the customer paid even if the product price changes tomorrow. Reviews live in their own collection because a product can have thousands.</p>`,
    internals: `<p>Bigger documents mean fewer documents per page in the WiredTiger cache, so if most reads only need a few fields of a large document, you waste cache and IO. Every update rewrites the whole document in the storage engine. These are the physical reasons behind "bounded embedding" and the subset pattern.</p>`
  },
  examples: [
    { title: 'Embedded: one read for the order page', code: `db.orders.findOne({ orderNo: "ORD-100123" }, { _id: 0, orderNo: 1, status: 1, items: 1, shipping: 1, payment: 1 })` },
    { title: 'Referenced: reviews by product', code: `db.reviews.countDocuments({ productId: "P010" })
db.reviews.find({ productId: "P010" }, { _id: 0, rating: 1, title: 1, helpfulVotes: 1 }).sort({ helpfulVotes: -1 }).limit(3)` },
    { title: 'Why the copy of price matters', code: `const line = db.orders.findOne({ "items.productId": "P003" }, { items: { $elemMatch: { productId: "P003" } } }).items[0]
const product = db.products.findOne({ _id: "P003" }, { price: 1 })
print("paid at purchase:", line.price, " current catalog price:", product.price)` },
    { title: 'Measure document sizes', code: `db.orders.aggregate([
  { $project: { size: { $bsonSize: "$$ROOT" }, lines: { $size: "$items" } } },
  { $group: { _id: null, avgBytes: { $avg: "$size" }, maxBytes: { $max: "$size" }, maxLines: { $max: "$lines" } } }
])` }
  ],
  mistakes: [
    'Copying a relational schema one table per collection and joining everything with <code>$lookup</code>.',
    'Embedding unbounded children (all orders inside the customer).',
    'Refusing any duplication. Duplicating fields that rarely change (names, prices at a point in time) is normal; just decide how each copy is updated.',
    'Designing without listing the top queries and their frequency first.'
  ],
  interview: [
    { q: 'How do you decide between embedding and referencing?', a: '<p>Ask: Is the child read together with the parent? Is the number of children bounded and small? Is the child owned by one parent? Is it updated independently or at high frequency? Embed if the answers favour locality and boundedness; reference if the child is unbounded, shared, large, or accessed alone. Then validate with the top queries, their frequency, and the write patterns.</p>' },
    { q: 'How do you model many-to-many?', a: '<p>Usually an array of ids on the side that is read most (for example <code>course.studentIds</code> if bounded, or <code>student.courseIds</code>). If both sides are large or the relation has attributes (enrollment date, grade), use a link collection <code>enrollments { studentId, courseId, ... }</code> indexed on both fields.</p>' }
  ],
  quiz: [
    { q: 'Best design for blog posts with potentially millions of comments?', options: ['Embed all comments in the post', 'Comments in their own collection referencing postId', 'One collection per post', 'Store comments as a string'], answer: 1 },
    { q: 'Why does an order copy the product price into its line item?', options: ['Laziness', 'To preserve the price at purchase time and avoid a join', 'Because $lookup cannot read prices', 'To save space'], answer: 1 }
  ]
},
{
  id: 'index-fundamentals', module: 'indexes', title: 'Indexes: COLLSCAN vs IXSCAN', minutes: 25,
  summary: 'What an index is physically, how a query uses it, and how to read explain() output to see whether it did.',
  objectives: ['Explain B-tree indexes and why they speed up reads but cost writes', 'Create, list and drop indexes', 'Read explain("executionStats"): stages, keysExamined, docsExamined, nReturned', 'Spot a COLLSCAN and fix it'],
  sections: {
    concept: `<div data-diagram="btree"></div>
<p>An index is a sorted structure (a B-tree in WiredTiger) of key values, each pointing to a document. Instead of reading every document (<b>COLLSCAN</b>), the server seeks to the first matching key and walks forward (<b>IXSCAN</b>), then fetches the documents (<b>FETCH</b>).</p>
<p>Every collection has a unique index on <code>_id</code>. You add others with <code>createIndex({ field: 1 })</code>. Direction (1 or -1) matters only for compound indexes with mixed sort orders.</p>
<p>The key metrics in <code>explain("executionStats")</code>:</p>
<ul><li><b>nReturned</b>: documents returned.</li><li><b>totalKeysExamined</b>: index keys read.</li><li><b>totalDocsExamined</b>: documents fetched.</li><li><b>executionTimeMillis</b>.</li></ul>
<p>The ideal ratio is <b>keys examined = docs examined = returned</b>. A large gap tells you the index is not selective enough or the wrong one was used.</p>`,
    why: `<p>Missing indexes are the most common cause of slow MongoDB applications: a COLLSCAN reads the whole collection, evicting useful data from cache, so one bad query slows down everything else. Every index also costs RAM and slows every insert, update and delete, so you add the right ones, not all of them.</p>`,
    useCase: `<p>The customer service app searches orders by customer: <code>find({ customerId: 372 })</code>. Without an index it examines 5,000 documents to return 10; with <code>{ customerId: 1 }</code> it examines 10 keys and 10 documents.</p>`,
    internals: `<p>WiredTiger stores each index as its own B-tree table, with prefix compression on keys. Index entries contain the encoded key and the RecordId of the document. Since 4.2, index builds use an optimized process that holds an exclusive lock only briefly at the start and end; on replica sets builds run simultaneously on all data-bearing members (4.4+) and commit once a quorum is ready.</p>`
  },
  examples: [
    { title: 'Without an index: COLLSCAN', code: `db.orders.find({ customerId: 372 }).explain("executionStats")`, note: 'Look at the stage tree: COLLSCAN examining every document to return a handful. If you already ran the next example, run <code>db.orders.dropIndex("customerId_1")</code> first.' },
    { title: 'Create the index and compare', code: `db.orders.createIndex({ customerId: 1 })
db.orders.find({ customerId: 372 }).explain("executionStats")` },
    { title: 'Manage indexes', code: `db.orders.getIndexes()
db.orders.stats().indexSizes
db.orders.aggregate([{ $indexStats: {} }, { $project: { name: 1, "accesses.ops": 1 } }])` },
    { title: 'Selective vs unselective', code: `db.orders.createIndex({ status: 1 })
db.orders.find({ status: "delivered" }).explain("executionStats")`, note: 'The index works, but "delivered" matches about half the collection, so it saves little. Selectivity matters.' }
  ],
  mistakes: [
    'Indexing every field "just in case": more RAM, slower writes, and the planner has more plans to try.',
    'Indexing low-cardinality fields alone (status, boolean flags) and expecting big gains.',
    'Never checking <code>$indexStats</code>; unused indexes cost write performance for nothing.',
    'Building large indexes on a busy primary during peak hours without checking impact.'
  ],
  interview: [
    { q: 'How do you tell whether a query uses an index?', a: '<p>Run <code>.explain("executionStats")</code> and look at <code>winningPlan</code>: an IXSCAN stage (with <code>indexName</code>) versus COLLSCAN. Compare <code>totalKeysExamined</code>, <code>totalDocsExamined</code> and <code>nReturned</code>. In production, the slow query log lines and the profiler show <code>planSummary</code> (e.g. <code>IXSCAN { customerId: 1 }</code> or <code>COLLSCAN</code>).</p>' },
    { q: 'What is the cost of an index?', a: '<p>Storage and, more importantly, RAM: frequently used indexes should fit in the WiredTiger cache. Every write must update every index on the collection (and multikey indexes add a key per array element). Index builds consume IO and CPU.</p>' }
  ],
  quiz: [
    { q: 'In explain output, which signals a full collection scan?', options: ['IXSCAN', 'FETCH', 'COLLSCAN', 'PROJECTION_COVERED'], answer: 2 },
    { q: 'What is the ideal relationship between keys examined, docs examined and nReturned?', options: ['Keys much larger than returned', 'All three roughly equal', 'Docs examined zero', 'Returned larger than keys'], answer: 1 }
  ]
},
{
  id: 'explain-deep', module: 'indexes', title: 'Reading explain() plans like a DBA', minutes: 20,
  summary: 'Go beyond COLLSCAN vs IXSCAN: SORT stages, rejected plans, index bounds, and the verbosity modes.',
  objectives: ['Use queryPlanner, executionStats and allPlansExecution', 'Read index bounds and recognise a blocking SORT', 'Understand how the planner picks a winning plan', 'Use hint() to compare plans'],
  sections: {
    concept: `<ul>
<li><code>explain("queryPlanner")</code> (default): the chosen plan and rejected plans, without executing.</li>
<li><code>explain("executionStats")</code>: runs the winning plan and reports counts and timings per stage.</li>
<li><code>explain("allPlansExecution")</code>: also shows the partial trial-period statistics of every candidate.</li>
</ul>
<p>Stages to recognise: <b>IXSCAN</b> (with <code>indexBounds</code>), <b>FETCH</b> (load documents, optionally applying a filter), <b>SORT</b> (in-memory, blocking), <b>LIMIT</b>/<b>SKIP</b>, <b>PROJECTION_COVERED</b> (answered from the index alone), <b>OR</b>/<b>SUBPLAN</b> (separate plans per <code>$or</code> branch), <b>COLLSCAN</b>.</p>
<p>When several indexes could answer a query, the planner runs each candidate for a short <b>trial period</b> (until one returns 101 documents or does 10,000 "works") and picks the most productive. The winner is cached in the <b>plan cache</b> by query shape.</p>`,
    why: `<p>The difference between a 3 ms and a 3 s query is usually visible in explain: a filter applied in FETCH instead of index bounds, a SORT stage that should have been avoided, or the wrong index winning the trial. Reading plans is the core performance skill for developers and DBAs.</p>`,
    useCase: `<p>An API sorting orders by date became slow. explain shows IXSCAN on <code>{ status: 1 }</code> followed by a SORT on 1,000 documents. Adding <code>{ status: 1, createdAt: -1 }</code> removes the SORT stage and the query examines only 20 keys.</p>`,
    internals: `<p><code>indexBounds</code> show exactly which part of the index is scanned: <code>[ "paid", "paid" ]</code> is a point, <code>[ 100, inf ]</code> a range, <code>[ MinKey, MaxKey ]</code> the whole index. The plan cache entry for a shape is evicted when indexes change, when the collection changes significantly, or on restart; a cached plan that performs much worse than expected is replanned automatically. <code>queryHash</code>/<code>planCacheKey</code> identify the shape in logs and in <code>$planCacheStats</code>.</p>`
  },
  examples: [
    { title: 'A blocking SORT', code: `db.orders.createIndex({ status: 1 })
db.orders.find({ status: "paid" }).sort({ createdAt: -1 }).limit(10).hint({ status: 1 }).explain("executionStats")`, note: 'The single-field index finds paid orders, but they come out in index order, so a SORT stage must reorder them.' },
    { title: 'Remove the SORT with the right index', code: `db.orders.createIndex({ status: 1, createdAt: -1 })
db.orders.find({ status: "paid" }).sort({ createdAt: -1 }).limit(10).explain("executionStats")` },
    { title: 'Rejected plans and hint()', code: `db.orders.createIndex({ customerId: 1 })
db.orders.find({ status: "paid", customerId: 50 }).explain("allPlansExecution")
db.orders.find({ status: "paid", customerId: 50 }).hint({ status: 1 }).explain("executionStats")`, note: 'Compare the winning plan with the hinted one: hint forces an index even when it is worse.' }
  ],
  mistakes: [
    'Reading only <code>executionTimeMillis</code> on a warm cache; examined counts are the stable signal.',
    'Leaving <code>hint()</code> in application code after data distribution changes.',
    'Ignoring <code>rejectedPlans</code>: too many candidate indexes make planning slower and choices unstable.'
  ],
  interview: [
    { q: 'How does the MongoDB query planner choose an index?', a: '<p>It generates candidate plans from indexes that match the predicates and sort, races them in a trial period (until a plan returns 101 results or hits a works limit), scores them by productivity (results per work, with bonuses for no blocking sort and covered plans), and caches the winner per query shape. Cached plans are re-evaluated if they perform much worse than when cached.</p>' },
    { q: 'What does a SORT stage in explain tell you?', a: '<p>The sort is done in memory after reading the data, because no index provides that order for the filter used. It is blocking (must read all inputs before returning) and limited by memory. Fix by adding a compound index with equality fields first and the sort field next, following ESR.</p>' }
  ],
  quiz: [
    { q: 'Which verbosity shows statistics for rejected candidates?', options: ['queryPlanner', 'executionStats', 'allPlansExecution', 'verbose'], answer: 2 },
    { q: 'indexBounds of [MinKey, MaxKey] on the first field means...', options: ['A point lookup', 'The whole index is scanned for that field', 'The index is covered', 'Nothing matched'], answer: 1 }
  ]
},
{
  id: 'compound-esr', module: 'compound-indexes', title: 'Compound indexes and the ESR rule', minutes: 30,
  summary: 'Order the fields of a compound index as Equality, then Sort, then Range. Learn prefixes, covered queries and why one good compound index beats three single-field ones.',
  objectives: ['Apply Equality-Sort-Range ordering', 'Use index prefixes to serve several queries with one index', 'Write covered queries', 'Match sort direction to index direction'],
  sections: {
    concept: `<div data-diagram="esr"></div>
<p>A compound index sorts by the first field, then by the second within equal first values, and so on. For a query with equality, sort and range predicates, the best order is:</p>
<ol><li><b>E</b>quality fields first: they pin the scan to one contiguous slice.</li>
<li><b>S</b>ort fields next: within that slice, keys are already in sort order, so no SORT stage.</li>
<li><b>R</b>ange fields last: the range becomes a filter on keys while walking in sort order.</li></ol>
<p>Putting the range before the sort field forces a blocking sort, because keys are ordered by the range field first.</p>
<p><b>Prefixes</b>: <code>{ a: 1, b: 1, c: 1 }</code> also serves queries on <code>a</code> and on <code>a, b</code>, but not on <code>b</code> alone. <b>Covered queries</b> read only the index: all filter and projected fields are in the index and <code>_id</code> is excluded (or indexed).</p>
<p>For sorts on multiple fields the direction must match the index or be its exact reverse: <code>{ a: 1, b: -1 }</code> supports <code>sort({ a: 1, b: -1 })</code> and <code>sort({ a: -1, b: 1 })</code> but not <code>sort({ a: 1, b: 1 })</code>.</p>
<h3>ESR lab</h3><p>Pick an index order and run the same query against a private copy of the orders collection. The lab reports keys and documents examined and whether a SORT stage was needed.</p>
<div data-widget="esr-lab"></div>`,
    why: `<p>The ESR rule turns many slow queries into fast ones without adding more indexes. It is also a favourite interview topic because it tests whether you understand what an index physically is.</p>`,
    useCase: `<p>"Paid orders over 500, newest first, 20 per page": equality on <code>status</code>, sort on <code>createdAt</code>, range on <code>total</code>. The ESR index <code>{ status: 1, createdAt: -1, total: 1 }</code> returns page one after examining a few dozen keys with no SORT stage. The tempting <code>{ status: 1, total: 1, createdAt: -1 }</code> scans every paid order above 500 and sorts them in memory.</p>`,
    internals: `<p>For an equality on the first field and a range on the second, index bounds are one interval per field. With <code>$in</code> on an early field the planner can still avoid a sort by merging the sorted streams for each value (SORT_MERGE), or by exploding into point scans. ESR is a guideline: when the range is extremely selective (returns a handful of documents), E-R-S may examine fewer keys and the small in-memory sort is cheap. Always confirm with explain.</p>`
  },
  examples: [
    { title: 'E-R-S: range before sort (blocking SORT)', code: `db.orders.createIndex({ status: 1, total: 1, createdAt: -1 })
db.orders.find({ status: "paid", total: { $gte: 500 } }).sort({ createdAt: -1 }).limit(20).hint({ status: 1, total: 1, createdAt: -1 }).explain("executionStats")` },
    { title: 'E-S-R: no SORT stage', code: `db.orders.createIndex({ status: 1, createdAt: -1, total: 1 })
db.orders.find({ status: "paid", total: { $gte: 500 } }).sort({ createdAt: -1 }).limit(20).hint({ status: 1, createdAt: -1, total: 1 }).explain("executionStats")` },
    { title: 'Covered query', code: `db.customers.createIndex({ tier: 1, "address.country": 1, name: 1 })
db.customers.find({ tier: "gold", "address.country": "India" }, { _id: 0, name: 1 }).explain("executionStats")`, note: 'PROJECTION_COVERED and totalDocsExamined: 0. Remove <code>_id: 0</code> and it needs a FETCH again.' },
    { title: 'Prefixes', code: `db.customers.find({ tier: "gold" }).explain().queryPlanner.winningPlan
db.customers.find({ "address.country": "India" }).explain().queryPlanner.winningPlan` }
  ],
  mistakes: [
    'Ordering compound fields by "selectivity" alone instead of by how the query uses them (equality, sort, range).',
    'Creating <code>{ a: 1 }</code> next to <code>{ a: 1, b: 1 }</code>: the single-field index is redundant (unless it is unique or sparse with different semantics).',
    'Expecting <code>{ a: 1, b: 1 }</code> to help a query on <code>b</code> alone.',
    'Assuming a covered query when the projection includes <code>_id</code> or a field not in the index, or when the field is multikey.'
  ],
  interview: [
    { q: 'Explain the ESR rule.', a: '<p>For a compound index serving a query with equality, sort and range conditions, put Equality fields first, then the Sort fields, then Range fields. Equality narrows the scan to a contiguous slice; within it, keys are already ordered by the sort field, so no in-memory sort; the range is applied as a key filter during the ordered walk, and with a limit the scan stops early. Placing the range before the sort forces a blocking sort.</p>' },
    { q: 'What is a covered query?', a: '<p>A query answered entirely from index keys: every field in the filter and the projection is in the index and <code>_id</code> is excluded (or part of the index). explain shows PROJECTION_COVERED and <code>totalDocsExamined: 0</code>. Multikey fields and fields inside arrays of documents prevent coverage.</p>' },
    { q: 'Do you need both {a:1} and {a:1, b:1}?', a: '<p>Usually not: the compound index serves queries on <code>a</code> via its prefix. Keep the single-field one only if it has different options (unique, partial, TTL) or if it is much smaller and hot enough to matter.</p>' }
  ],
  quiz: [
    { q: 'Query: <code>{ status: "paid", total: { $gt: 100 } }</code> sorted by <code>createdAt</code>. Best index?', options: ['{ total: 1, status: 1, createdAt: 1 }', '{ status: 1, total: 1, createdAt: 1 }', '{ status: 1, createdAt: 1, total: 1 }', '{ createdAt: 1 }'], answer: 2 },
    { q: 'Which query can use the index <code>{ a: 1, b: 1, c: 1 }</code> efficiently?', options: ['{ b: 1 }', '{ c: 1 }', '{ a: 1, b: 2 }', '{ b: 1, c: 1 }'], answer: 2 },
    { q: 'Index <code>{ a: 1, b: -1 }</code> supports which sort without a SORT stage?', options: ['{ a: 1, b: 1 }', '{ a: -1, b: 1 }', '{ b: -1 }', '{ b: 1, a: 1 }'], answer: 1 }
  ]
}
]);
