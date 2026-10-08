/* =====================================================================
   data.js — course structure: levels, modules, learning paths and the
   registration helpers that content files use.
   ===================================================================== */
window.MM = window.MM || {};

MM.LEVELS = [
  { id: 1, key: 'beginner',     name: 'Beginner',                 color: '#22c55e', blurb: 'Documents, BSON, mongosh and your first CRUD queries.' },
  { id: 2, key: 'intermediate', name: 'Intermediate',             color: '#38bdf8', blurb: 'Arrays, aggregation, indexes, explain() and schema design.' },
  { id: 3, key: 'advanced',     name: 'Advanced',                 color: '#a78bfa', blurb: 'Transactions, concerns, change streams, validation, time series.' },
  { id: 4, key: 'engineer',     name: 'Database Engineer',        color: '#f59e0b', blurb: 'WiredTiger, replica sets, oplog, backup, security, monitoring.' },
  { id: 5, key: 'architect',    name: 'Database Architect',       color: '#f97316', blurb: 'Sizing, drivers and pooling, production tuning, HA/DR, Kubernetes.' },
  { id: 6, key: 'distributed',  name: 'Sharding / Distributed',   color: '#ef4444', blurb: 'Sharded clusters, shard keys, balancer, resharding, migrations.' },
  { id: 7, key: 'ai',           name: 'Search + Vector',          color: '#ec4899', blurb: 'Text search, vector search and RAG patterns with MongoDB.' }
];

/* id, title, level, description */
MM.MODULES = [
  ['fundamentals',        'MongoDB Fundamentals',          1, 'Documents, collections, databases, BSON and how MongoDB differs from relational systems'],
  ['mongosh',             'mongosh & Tools',               1, 'The shell, Compass, database tools and connecting to a deployment'],
  ['bson-types',          'BSON Data Types',               1, 'ObjectId, dates, numbers, decimals, arrays, embedded documents and type ordering'],
  ['crud-insert',         'Inserting Documents',           1, 'insertOne, insertMany, _id generation and ordered vs unordered writes'],
  ['crud-query',          'Querying Documents',            1, 'find, comparison and logical operators, $exists, $type, $regex'],
  ['projection-sort',     'Projection, Sort & Pagination', 1, 'Shaping results, sort order, skip/limit and keyset pagination'],
  ['crud-update',         'Updating & Deleting',           1, 'Update operators, upserts, arrayFilters, replace and delete'],
  ['arrays-embedded',     'Arrays & Embedded Documents',   2, 'Dot notation, $elemMatch, $all, $size and array update operators'],
  ['aggregation',         'Aggregation Pipeline',          2, '$match, $group, $project, $sort, $limit and expression operators'],
  ['aggregation-joins',   '$lookup & Joins',               2, '$lookup, $unwind, $graphLookup and when joins are the wrong tool'],
  ['aggregation-advanced','Advanced Aggregation',          2, '$facet, $bucket, $setWindowFields, $merge and $out'],
  ['schema-design',       'Schema Design',                 2, 'Embedding vs referencing, cardinality, document growth and access patterns'],
  ['schema-patterns',     'Schema Design Patterns',        3, 'Bucket, computed, subset, extended reference, outlier, polymorphic'],
  ['indexes',             'Indexes & explain()',           2, 'B-tree indexes, COLLSCAN vs IXSCAN and reading execution stats'],
  ['compound-indexes',    'Compound Indexes & ESR',        2, 'Key order, the Equality-Sort-Range rule, covered queries and prefixes'],
  ['index-types',         'Index Types & Options',         3, 'Multikey, unique, partial, sparse, TTL, text, wildcard, hashed, geo'],
  ['query-optimization',  'Query Optimization',            3, 'Query planner, plan cache, hints, slow-query workflow'],
  ['transactions',        'Transactions',                  3, 'Multi-document ACID transactions, retries, limits and costs'],
  ['concerns',            'Read & Write Concerns',         3, 'Write concern, read concern, read preference and causal consistency'],
  ['change-streams',      'Change Streams',                3, 'Real-time change events, resume tokens and pre/post images'],
  ['schema-validation',   'Schema Validation',             3, '$jsonSchema, validation levels and actions'],
  ['time-series',         'Time Series & Special Collections', 3, 'Time series collections, capped collections, TTL, views, collation'],
  ['wiredtiger',          'WiredTiger Storage Engine',     4, 'Cache, eviction, checkpoints, journal, MVCC and compression'],
  ['replica-sets',        'Replica Sets & Elections',      4, 'Members, elections, priorities, arbiters and failover'],
  ['oplog',               'Oplog & Replication',           4, 'The oplog, initial sync, replication lag and rollback'],
  ['backup-restore',      'Backup & Restore',              4, 'mongodump, snapshots, PBM, point-in-time recovery and restore drills'],
  ['security',            'Security',                      4, 'Authentication, RBAC, TLS, encryption at rest, CSFLE and auditing'],
  ['monitoring',          'Monitoring & Diagnostics',      4, 'serverStatus, currentOp, profiler, logs, FTDC and key metrics'],
  ['upgrades',            'Upgrades & FCV',                4, 'Rolling upgrades, featureCompatibilityVersion and rollback plans'],
  ['capacity',            'Capacity Planning & Sizing',    5, 'Working set, RAM, disk, IOPS and growth modelling'],
  ['drivers-pooling',     'Drivers & Connection Pooling',  5, 'Connection strings, pools, retryable writes and timeouts'],
  ['production-tuning',   'Production Tuning',             5, 'OS settings, filesystem, THP, NUMA, ulimits and cache sizing'],
  ['ha-dr',               'HA, DR & Multi-Region',         5, 'Multi-datacenter topologies, DR runbooks and RPO/RTO'],
  ['kubernetes',          'MongoDB on Kubernetes',         5, 'Operators, StatefulSets, storage and day-2 operations'],
  ['sharding',            'Sharding Architecture',         6, 'mongos, config servers, shards and query routing'],
  ['shard-keys',          'Shard Keys',                    6, 'Cardinality, frequency, monotonicity, hashed vs ranged keys'],
  ['balancer',            'Chunks, Balancer & Resharding', 6, 'Chunk ranges, balancing, jumbo chunks, zones and resharding'],
  ['migrations',          'Cluster Migrations',            6, 'mongosync, live migration, cutover and validation'],
  ['text-search',         'Text Search',                   7, 'Text indexes, $text, scoring and full-text search engines'],
  ['vector-search',       'Vector Search & RAG',           7, 'Embeddings, vector indexes, $vectorSearch and RAG architecture'],
  ['interview-prep',      'Interview Preparation',         5, 'How to answer MongoDB developer, DBA and architect interviews']
].map(function (m, i) {
  return { id: m[0], title: m[1], level: m[2], desc: m[3], num: i + 1 };
});

MM.MODULE_BY_ID = {};
MM.MODULES.forEach(function (m) { MM.MODULE_BY_ID[m.id] = m; });

MM.PATHS = [
  { id: 'developer', name: 'Application Developer', desc: 'Write correct, fast queries and good schemas from application code.',
    modules: ['fundamentals', 'crud-query', 'crud-update', 'arrays-embedded', 'aggregation', 'schema-design', 'indexes', 'compound-indexes', 'transactions', 'drivers-pooling'] },
  { id: 'dba', name: 'MongoDB DBA', desc: 'Run self-hosted MongoDB reliably in production.',
    modules: ['indexes', 'wiredtiger', 'replica-sets', 'oplog', 'backup-restore', 'security', 'monitoring', 'upgrades', 'production-tuning'] },
  { id: 'architect', name: 'Data Architect', desc: 'Design systems that scale and survive failure.',
    modules: ['schema-design', 'schema-patterns', 'concerns', 'capacity', 'ha-dr', 'sharding', 'shard-keys', 'balancer', 'migrations'] },
  { id: 'performance', name: 'Performance Engineer', desc: 'Find and fix slow queries and resource bottlenecks.',
    modules: ['indexes', 'compound-indexes', 'index-types', 'query-optimization', 'aggregation', 'wiredtiger', 'monitoring', 'capacity'] },
  { id: 'ai', name: 'AI Engineer', desc: 'Build semantic search and RAG on MongoDB.',
    modules: ['fundamentals', 'aggregation', 'text-search', 'vector-search'] }
];

/* Local deep-dive pages already in this docs folder. */
MM.DEEP_DIVES = {
  'fundamentals':       [['Document model deep Q&A', '../mongo-internals-deep-qa/08-document-model.html']],
  'schema-design':      [['Document model deep Q&A', '../mongo-internals-deep-qa/08-document-model.html']],
  'schema-patterns':    [['Document model deep Q&A', '../mongo-internals-deep-qa/08-document-model.html']],
  'crud-query':         [['Query, CRUD & search deep Q&A', '../mongo-internals-deep-qa/34-query-crud-search.html']],
  'indexes':            [['Indexes deep Q&A', '../mongo-internals-deep-qa/04-indexes.html'], ['Explain & planner deep Q&A', '../mongo-internals-deep-qa/05-explain-planner.html']],
  'compound-indexes':   [['Indexes deep Q&A', '../mongo-internals-deep-qa/04-indexes.html']],
  'index-types':        [['Indexes deep Q&A', '../mongo-internals-deep-qa/04-indexes.html']],
  'query-optimization': [['Explain & planner deep Q&A', '../mongo-internals-deep-qa/05-explain-planner.html']],
  'aggregation':        [['Aggregation deep Q&A', '../mongo-internals-deep-qa/06-aggregation.html']],
  'aggregation-joins':  [['Aggregation deep Q&A', '../mongo-internals-deep-qa/06-aggregation.html']],
  'aggregation-advanced': [['Aggregation deep Q&A', '../mongo-internals-deep-qa/06-aggregation.html']],
  'transactions':       [['Transactions & locks deep Q&A', '../mongo-internals-deep-qa/07-transactions-locks.html']],
  'change-streams':     [['Change streams deep Q&A', '../mongo-internals-deep-qa/10-change-streams.html']],
  'schema-validation':  [['Schema validation & Stable API', '../mongo-internals-deep-qa/22-schema-validation-stable-api.html']],
  'time-series':        [['Time series & special collections', '../mongo-internals-deep-qa/23-timeseries-specialty.html'], ['Views & collation', '../mongo-internals-deep-qa/29-views-collation.html']],
  'wiredtiger':         [['WiredTiger deep Q&A', '../mongo-internals-deep-qa/01-wiredtiger-storage.html']],
  'replica-sets':       [['Replica sets deep Q&A', '../mongo-internals-deep-qa/02-replica-sets.html']],
  'oplog':              [['Oplog, sync & rollback deep Q&A', '../mongo-internals-deep-qa/03-oplog-sync-rollback.html']],
  'backup-restore':     [['Backup & restore deep Q&A', '../mongo-internals-deep-qa/11-backup-restore.html']],
  'security':           [['Security deep Q&A', '../mongo-internals-deep-qa/12-security.html'], ['Auth & encryption deep', '../mongo-internals-deep-qa/25-auth-encryption-deep.html']],
  'monitoring':         [['Monitoring & FTDC deep Q&A', '../mongo-internals-deep-qa/13-monitoring-ftdc.html'], ['Debug & RCA playbooks', '../mongo-internals-deep-qa/20-debug-rca-playbooks.html']],
  'upgrades':           [['Upgrades & FCV deep Q&A', '../mongo-internals-deep-qa/14-upgrades-fcv.html']],
  'capacity':           [['Capacity & sizing deep Q&A', '../mongo-internals-deep-qa/18-capacity-sizing.html']],
  'drivers-pooling':    [['Drivers, URI & pooling deep Q&A', '../mongo-internals-deep-qa/19-drivers-uri-pooling.html']],
  'production-tuning':  [['Production notes (host) deep Q&A', '../mongo-internals-deep-qa/33-production-notes-host.html'], ['Connections & storage ops', '../mongo-internals-deep-qa/15-connections-storage-ops.html']],
  'ha-dr':              [['Multi-DC & DR deep Q&A', '../mongo-internals-deep-qa/17-multi-dc-dr.html']],
  'kubernetes':         [['Kubernetes operators deep Q&A', '../mongo-internals-deep-qa/30-k8s-operators.html']],
  'sharding':           [['Sharding deep Q&A', '../mongo-internals-deep-qa/09-sharding.html'], ['Modern sharding ops', '../mongo-internals-deep-qa/21-modern-sharding-ops.html']],
  'shard-keys':         [['Sharding deep Q&A', '../mongo-internals-deep-qa/09-sharding.html']],
  'balancer':           [['Modern sharding ops', '../mongo-internals-deep-qa/21-modern-sharding-ops.html']],
  'migrations':         [['mongosync & cluster migration', '../mongo-internals-deep-qa/28-mongosync-cluster-migration.html']],
  'text-search':        [['Query, CRUD & search deep Q&A', '../mongo-internals-deep-qa/34-query-crud-search.html']],
  'interview-prep':     [['Night-before cheat sheet', '../mongo-internals-deep-qa/36-night-before-cheatsheet.html'], ['Incident triage catalog', '../mongo-internals-deep-qa/32-incidents-triage-catalog.html']]
};

MM.LESSONS = MM.LESSONS || [];
MM.addLessons = function (list) { Array.prototype.push.apply(MM.LESSONS, list); };
MM.INTERVIEW = MM.INTERVIEW || {};
MM.PROBLEMS = MM.PROBLEMS || [];
MM.PAGES = MM.PAGES || {};
