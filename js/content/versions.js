/* =====================================================================
   versions.js — release timeline and version-dependent interview answers.
   ===================================================================== */
(function () {
  'use strict';
  var MM = window.MM;

  MM.RELEASES = [
    { v: '3.6', year: 2017, items: ['Change streams', '<code>$jsonSchema</code> validation', 'Retryable writes and causally consistent sessions', 'Array filters and the <code>$[]</code> / <code>$[id]</code> positional operators', '<code>$lookup</code> with <code>let</code> + <code>pipeline</code>', '<code>$expr</code> in queries'] },
    { v: '4.0', year: 2018, items: ['Multi-document ACID transactions on replica sets', 'Type conversion operators (<code>$convert</code>, <code>$toDate</code>, <code>$toInt</code> and friends)', 'Non-blocking secondary reads during oplog application', 'MMAPv1 deprecated'] },
    { v: '4.2', year: 2019, items: ['Distributed transactions across shards', 'Wildcard indexes', 'Updates with an aggregation pipeline', '<code>$merge</code> for on-demand materialized views', 'Client-side field level encryption', 'Shard key values become updatable', 'Hybrid index builds replace foreground/background builds', 'MMAPv1 removed; retryable reads'] },
    { v: '4.4', year: 2020, items: ['<code>refineCollectionShardKey</code> and compound hashed shard keys', 'Simultaneous index builds on all members with <code>commitQuorum</code>', 'Hidden indexes', '<code>$unionWith</code>, <code>$function</code> and <code>$accumulator</code>', 'Hedged and mirrored reads', 'Streaming replication and resumable initial sync', '<code>compact</code> no longer blocks CRUD'] },
    { v: '5.0', year: 2021, items: ['Time-series collections', 'Live resharding with <code>reshardCollection</code>', '<code>$setWindowFields</code>', 'Stable (versioned) API', 'Default write concern becomes <code>majority</code> for most topologies', 'Legacy <code>mongo</code> shell deprecated in favour of <code>mongosh</code>'] },
    { v: '6.0', year: 2022, items: ['Change stream pre- and post-images', 'Cluster-to-cluster sync (<code>mongosync</code>)', 'Queryable Encryption preview', 'Secondary indexes on time-series measurements', '<code>$densify</code> / <code>$fill</code> generally available', 'Default chunk size 128 MB; from 6.0.3 the balancer balances by data size', 'Legacy <code>mongo</code> shell removed'] },
    { v: '7.0', year: 2023, items: ['Queryable Encryption GA (equality queries)', 'Compound wildcard indexes', '<code>analyzeShardKey</code> and <code>configureQueryAnalyzer</code>', 'Dynamic WiredTiger read/write ticket concurrency', '<code>$median</code> and <code>$percentile</code>', '<code>checkMetadataConsistency</code>'] },
    { v: '8.0', year: 2024, items: ['Broad read, write and replication throughput improvements', 'Queryable Encryption range queries', '<code>moveCollection</code> and <code>unshardCollection</code>', 'Config shards (config server can also hold data)', 'Persistent query settings via <code>setQuerySettings</code>', 'Multi-collection <code>bulkWrite</code> command', 'Background <code>autoCompact</code>', 'Faster resharding and <code>forceRedistribution</code>'] },
    { v: '8.2', year: 2025, items: ['Search and Vector Search for self-managed deployments (public preview)'] }
  ];

  MM.VERSION_TRAPS = [
    { q: 'Does MongoDB support transactions?', a: 'Replica sets since 4.0, sharded clusters since 4.2. Saying "no transactions" is a pre-2018 answer.' },
    { q: 'Can you change a shard key?', a: 'Before 4.2: no, dump and reload. 4.2: you can update a document\'s shard key value. 4.4: refine the key by adding suffix fields. 5.0: reshard the collection online.' },
    { q: 'What is the default write concern?', a: '<code>w: 1</code> before 5.0. From 5.0 it is <code>majority</code>, except some arbiter topologies where it falls back to <code>w: 1</code>.' },
    { q: 'Does an index build lock the collection?', a: 'Before 4.2 a foreground build held an exclusive lock and background builds were slow. 4.2 introduced hybrid builds that lock only at the start and end. 4.4 builds on all members simultaneously and waits for <code>commitQuorum</code>.' },
    { q: 'Does compact block the database?', a: 'Before 4.4 it blocked operations on the database. Since 4.4 CRUD continues. 8.0 adds background <code>autoCompact</code>.' },
    { q: 'How does the balancer decide what to move?', a: 'Historically by chunk count with a 64 MB chunk size. 6.0 raised the default chunk size to 128 MB and 6.0.3 switched balancing to data size per shard.' },
    { q: 'Can you $lookup into a sharded collection?', a: 'Only an unsharded "from" collection before 5.1. Since 5.1 the joined collection can be sharded.' },
    { q: 'How do you do time-series in MongoDB?', a: 'Bucket pattern by hand before 5.0. Time-series collections since 5.0, with secondary indexes on measurements since 6.0.' },
    { q: 'Which shell do you use?', a: '<code>mongosh</code>. The legacy <code>mongo</code> shell was deprecated in 5.0 and removed in 6.0.' },
    { q: 'Can you query encrypted fields?', a: 'CSFLE (4.2) supports equality only on deterministically encrypted fields. Queryable Encryption is GA for equality in 7.0 and adds range queries in 8.0.' },
    { q: 'How do you move an unsharded collection to another shard?', a: '<code>movePrimary</code> moved the whole database\'s unsharded collections with downtime. 8.0 adds <code>moveCollection</code> per collection, online.' },
    { q: 'How do you force a plan for a query shape?', a: 'Index filters (<code>planCacheSetFilter</code>) did not survive restarts. 8.0 adds persistent <code>setQuerySettings</code>.' }
  ];

  function releaseHtml() {
    return '<div class="timeline">' + MM.RELEASES.map(function (r) {
      return '<div class="tl-item" id="v-' + r.v.replace('.', '-') + '"><div class="tl-ver"><span class="ver-pill">' + r.v + '</span><small class="faint">' + r.year + '</small></div><ul>' + r.items.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul></div>';
    }).join('') + '</div>';
  }

  function trapsHtml() {
    return MM.VERSION_TRAPS.map(function (t) { return '<details class="qa"><summary>' + t.q + '</summary><div class="ans"><p>' + t.a + '</p></div></details>'; }).join('');
  }

  MM.PAGES.versions = {
    title: 'Versions and compatibility',
    intro: 'Most MongoDB interview answers depend on the server version. Lessons and interview answers carry a <span class="ver-pill">MongoDB X.Y+</span> badge when the feature needs a specific release. This page collects the timeline and the questions where the right answer changed.',
    sections: [
      { id: 'check', title: 'Check what you are running', html: `<p>Always confirm the binary version and the feature compatibility version (FCV) before relying on a feature. A 7.0 binary with FCV 6.0 still refuses 7.0-only features.</p>
<pre class="run" data-title="Binary version and FCV">db.version();
db.adminCommand({ buildInfo: 1 }).versionArray;
db.adminCommand({ getParameter: 1, featureCompatibilityVersion: 1 })</pre>
<div class="callout warn"><b>Upgrade one major version at a time</b>Upgrades move one release series at a time (for example 6.0 to 7.0 to 8.0), with FCV raised only after every member runs the new binary and you are confident you will not roll back.</div>` },
      { id: 'timeline', title: 'Release timeline', html: releaseHtml() },
      { id: 'traps', title: 'Interview answers that depend on the version', html: '<p>When asked any of these, state the version you are assuming. "It depends on the version, and on 7.0 or later the answer is..." signals real production experience.</p>' + trapsHtml() },
      { id: 'policy', title: 'Rapid releases and support', html: `<p>Major releases (x.0) are the ones self-managed deployments run in production. Minor rapid releases (for example 5.1 to 5.3) shipped features early on Atlas before they reached the next major release. Check the official lifecycle schedule before choosing a version; plan upgrades well before end of life, because each step needs testing of drivers, FCV and rollback plans.</p>
<ul><li>Drivers have their own compatibility matrix; an old driver may not speak the newest wire protocol features.</li><li>Percona Server for MongoDB tracks the same major versions and adds open-source hot backup, audit logging and LDAP integration.</li></ul>` }
    ]
  };
})();
