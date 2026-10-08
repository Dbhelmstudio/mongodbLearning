/* Cross-cutting lesson metadata: minimum MongoDB version and certification-objective mapping.
   Kept separate from the lesson files so the mapping can be reviewed in one place. */

MM.EXAMS = [
  {
    id: 'dev', title: 'Associate Developer', short: 'Developer',
    desc: 'Application-side MongoDB: the document model, CRUD, aggregation, indexes, data modelling, transactions and drivers.',
    url: 'https://learn.mongodb.com/pages/certification-program',
    objectives: [
      { id: 'dev-model', title: 'MongoDB overview and the document model' },
      { id: 'dev-crud-insert', title: 'Inserting documents' },
      { id: 'dev-crud-find', title: 'Finding documents: operators, arrays, projection, sort, limit' },
      { id: 'dev-crud-update', title: 'Updating and replacing documents' },
      { id: 'dev-crud-delete', title: 'Deleting documents' },
      { id: 'dev-agg', title: 'Aggregation pipelines' },
      { id: 'dev-indexes', title: 'Indexes and query performance' },
      { id: 'dev-modeling', title: 'Data modelling and validation' },
      { id: 'dev-transactions', title: 'Transactions and consistency' },
      { id: 'dev-drivers', title: 'Drivers, connections and error handling' }
    ]
  },
  {
    id: 'dba', title: 'Associate Database Administrator', short: 'DBA',
    desc: 'Operating MongoDB: architecture, indexes and performance, replication, sharding, security, backup, monitoring and server administration.',
    url: 'https://learn.mongodb.com/pages/certification-program',
    objectives: [
      { id: 'dba-overview', title: 'Architecture and the document model' },
      { id: 'dba-crud', title: 'CRUD and aggregation for operators' },
      { id: 'dba-indexes', title: 'Indexes and query performance' },
      { id: 'dba-replication', title: 'Replication and durability' },
      { id: 'dba-sharding', title: 'Sharding' },
      { id: 'dba-security', title: 'Security' },
      { id: 'dba-backup', title: 'Backup and recovery' },
      { id: 'dba-monitoring', title: 'Monitoring and diagnostics' },
      { id: 'dba-admin', title: 'Server administration: storage, upgrades, tuning, deployment' }
    ]
  }
];
MM.EXAM_OBJECTIVE_BY_ID = {};
MM.EXAMS.forEach(function (ex) { ex.objectives.forEach(function (o) { o.exam = ex.id; MM.EXAM_OBJECTIVE_BY_ID[o.id] = o; }); });

/* since: the release that introduced the lesson's core feature. sinceNote qualifies it (preview, edition). */
MM.LESSON_META = {
  'what-is-mongodb': { exam: ['dev-model', 'dba-overview'] },
  'documents-collections': { exam: ['dev-model', 'dba-overview'] },
  'mongosh-basics': { exam: ['dev-model', 'dev-drivers', 'dba-overview'] },
  'bson-types': { exam: ['dev-model', 'dba-overview'] },
  'insert-documents': { exam: ['dev-crud-insert', 'dba-crud'] },
  'query-basics': { exam: ['dev-crud-find', 'dba-crud'] },
  'query-operators': { exam: ['dev-crud-find', 'dba-crud'] },
  'projection-sort-pagination': { exam: ['dev-crud-find', 'dba-crud'] },
  'update-operators': { exam: ['dev-crud-update', 'dba-crud'] },
  'delete-documents': { exam: ['dev-crud-delete', 'dba-crud'] },
  'array-queries': { exam: ['dev-crud-find'] },
  'array-updates': { exam: ['dev-crud-update'] },
  'aggregation-basics': { exam: ['dev-agg', 'dba-crud'] },
  'aggregation-dates-strings': { exam: ['dev-agg'] },
  'lookup-joins': { exam: ['dev-agg'] },
  'advanced-aggregation': { exam: ['dev-agg'] },
  'window-functions': { exam: ['dev-agg'], since: '5.0' },
  'schema-design-basics': { exam: ['dev-modeling'] },
  'index-fundamentals': { exam: ['dev-indexes', 'dba-indexes'] },
  'explain-deep': { exam: ['dev-indexes', 'dba-indexes'] },
  'compound-esr': { exam: ['dev-indexes', 'dba-indexes'] },
  'patterns-read': { exam: ['dev-modeling'] },
  'patterns-flex': { exam: ['dev-modeling'] },
  'index-types-options': { exam: ['dev-indexes', 'dba-indexes'] },
  'wildcard-indexes': { exam: ['dev-indexes', 'dba-indexes'], since: '4.2', sinceNote: 'compound wildcard indexes need 7.0' },
  'geospatial': { exam: ['dev-indexes', 'dev-crud-find'] },
  'slow-query-workflow': { exam: ['dev-indexes', 'dba-indexes', 'dba-monitoring'] },
  'transactions-acid': { exam: ['dev-transactions'], since: '4.0', sinceNote: 'sharded-cluster transactions need 4.2' },
  'read-write-concerns': { exam: ['dev-transactions', 'dev-drivers', 'dba-replication'] },
  'change-streams-cdc': { exam: ['dba-replication'], since: '3.6', sinceNote: 'pre- and post-images need 6.0' },
  'json-schema-validation': { exam: ['dev-modeling'], since: '3.6' },
  'time-series-special': { exam: ['dev-modeling', 'dba-admin'], since: '5.0' },
  'views-collation': { exam: ['dev-modeling', 'dev-crud-find'] },
  'wiredtiger-internals': { exam: ['dba-admin'] },
  'replica-set-elections': { exam: ['dba-replication'] },
  'oplog-replication': { exam: ['dba-replication'] },
  'backup-pitr': { exam: ['dba-backup'] },
  'percona-pbm': { exam: ['dba-backup'] },
  'security-hardening': { exam: ['dba-security'] },
  'field-encryption': { exam: ['dba-security', 'dev-drivers'], since: '4.2', sinceNote: 'Queryable Encryption GA in 7.0, range queries in 8.0' },
  'monitoring-diagnostics': { exam: ['dba-monitoring'] },
  'percona-pmm': { exam: ['dba-monitoring'] },
  'upgrades-fcv': { exam: ['dba-admin'] },
  'capacity-sizing': { exam: ['dba-admin'] },
  'drivers-connection-pooling': { exam: ['dev-drivers'] },
  'production-host-tuning': { exam: ['dba-admin'] },
  'ha-dr-multiregion': { exam: ['dba-replication'] },
  'mongodb-kubernetes': { exam: ['dba-admin'] },
  'percona-operator': { exam: ['dba-admin', 'dba-backup'] },
  'interview-strategy': {},
  'sharded-cluster-architecture': { exam: ['dba-sharding'] },
  'choosing-shard-keys': { exam: ['dba-sharding'] },
  'balancer-zones-resharding': { exam: ['dba-sharding'], since: '5.0', sinceNote: 'for live resharding; zones and the balancer are older' },
  'cluster-migrations': { exam: ['dba-sharding'], since: '6.0', sinceNote: 'for mongosync' },
  'text-search': { exam: ['dev-indexes'] },
  'vector-search-rag': { since: '8.2', sinceNote: 'self-managed search and vector search are in public preview' }
};

MM.LESSONS.forEach(function (l) {
  var m = MM.LESSON_META[l.id];
  if (!m) return;
  if (m.exam && !l.exam) l.exam = m.exam.slice();
  if (m.since && !l.since) { l.since = m.since; l.sinceNote = m.sinceNote; }
});

/* Version tags for interview answers, matched on the start of the question. */
MM.INTERVIEW_SINCE = [
  [/^When would you use a multi-document transaction/, '4.0'],
  [/^What is causal consistency/, '3.6'],
  [/^How do change streams work/, '3.6'],
  [/^How would you introduce schema validation/, '3.6'],
  [/^Classic \$text index versus/, '8.2'],
  [/^How does online resharding work/, '5.0'],
  [/^How do you design for IoT telemetry/, '5.0'],
  [/^How would you migrate a 2 TB replica set/, '6.0']
];
(MM.INTERVIEW.categories || []).forEach(function (c) {
  c.items.forEach(function (it) {
    if (it.since) return;
    MM.INTERVIEW_SINCE.forEach(function (pair) { if (pair[0].test(it.q)) it.since = pair[1]; });
  });
});
