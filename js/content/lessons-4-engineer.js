/* Level 4 — Database Engineer */
MM.addLessons([
{
  id: 'wiredtiger-internals', module: 'wiredtiger', title: 'WiredTiger: cache, eviction, checkpoints and the journal', minutes: 30,
  summary: 'How a write travels from a client to disk, why cache pressure is the root of many incidents, and which metrics tell you the storage engine is struggling.',
  objectives: ['Trace the write path: cache, journal, checkpoint', 'Explain cache sizing and eviction thresholds', 'Describe MVCC, update chains and the history store', 'Read the key WiredTiger metrics in serverStatus'],
  sections: {
    concept: `<div data-diagram="wiredtiger"></div>
<ul>
<li><b>Cache</b>: by default the larger of 50% of (RAM - 1 GB) or 256 MB. Holds uncompressed B-tree pages of collections and indexes. The OS filesystem cache holds the compressed files as a second layer, which is why you should not give WiredTiger all the RAM.</li>
<li><b>Journal</b> (write-ahead log): each write is appended to the journal; group commits flush to disk every 100 ms (<code>commitIntervalMs</code>) or immediately for <code>j: true</code> writes. After a crash, MongoDB recovers from the last checkpoint plus the journal.</li>
<li><b>Checkpoints</b>: every 60 seconds WiredTiger writes a consistent snapshot of all dirty data to the data files. Between checkpoints, data on disk is the previous checkpoint plus the journal.</li>
<li><b>MVCC</b>: updates create new versions in an update chain on the in-memory page; readers see the version that matches their snapshot. Old versions needed by long-running snapshots move to the <b>history store</b> (<code>WiredTigerHS.wt</code>, 4.4+).</li>
<li><b>Compression</b>: snappy for collections by default (zstd and zlib available), prefix compression for indexes.</li>
</ul>
<h3>Write path, step by step</h3>
<div data-widget="write-path"></div>`,
    why: `<p>Most "MongoDB is suddenly slow" incidents are cache incidents: the working set no longer fits, dirty data accumulates faster than eviction can write it, or a long-running operation pins old versions. When thresholds are crossed, <b>application threads are drafted into eviction</b>, and query latency spikes across the board.</p>
<table><tr><th>Threshold</th><th>Default</th><th>Meaning</th></tr>
<tr><td>eviction_target</td><td>80% used</td><td>background eviction starts</td></tr>
<tr><td>eviction_trigger</td><td>95% used</td><td>application threads help evict (latency)</td></tr>
<tr><td>eviction_dirty_target</td><td>5% dirty</td><td>background writes dirty pages</td></tr>
<tr><td>eviction_dirty_trigger</td><td>20% dirty</td><td>application threads help (stalls)</td></tr></table>`,
    useCase: `<p>A nightly batch updates 40 million documents. Dirty cache climbs to 20%, application threads start evicting, and p99 latency of the checkout API goes from 8 ms to 900 ms. The fix is throttling the batch (smaller batches, sleeps, <code>w: "majority"</code> to apply back-pressure), running it off-peak, and checking disk write throughput.</p>`,
    internals: `<p>Each collection and index is a separate <code>.wt</code> file with its own B-tree. Pages in cache are larger than on disk because they are uncompressed and carry update chains. Reads that miss the cache cause disk reads ("pages read into cache"). Concurrency is controlled by read and write tickets (128 each by default before 7.0; 7.0+ adjusts them dynamically); when tickets are exhausted, operations queue, which shows up as <code>globalLock.currentQueue</code> or low available tickets.</p>`
  },
  examples: [
    { title: 'Cache metrics', code: `const wt = db.serverStatus().wiredTiger
const c = wt.cache
print("cache max GB :", (c["maximum bytes configured"] / 1024 ** 3).toFixed(1))
print("used %       :", (100 * c["bytes currently in the cache"] / c["maximum bytes configured"]).toFixed(2))
print("dirty %      :", (100 * c["tracked dirty bytes in the cache"] / c["maximum bytes configured"]).toFixed(2))
wt.concurrentTransactions` },
    { title: 'Per-collection storage', code: `const s = db.orders.stats()
printjson({ count: s.count, avgObjSize: s.avgObjSize, size: s.size, storageSize: s.storageSize, totalIndexSize: s.totalIndexSize, indexes: s.nindexes })` },
    { title: 'mongod.conf storage settings', runnable: false, code: `storage:
  dbPath: /var/lib/mongodb
  journal:
    commitIntervalMs: 100
  wiredTiger:
    engineConfig:
      cacheSizeGB: 24          # leave room for the OS page cache, connections and aggregation memory
    collectionConfig:
      blockCompressor: zstd    # better ratio than snappy, slightly more CPU
    indexConfig:
      prefixCompression: true` }
  ],
  mistakes: [
    'Setting <code>cacheSizeGB</code> to almost all of RAM: no room for the filesystem cache, connections (about 1 MB each), and in-memory sorts.',
    'Running multiple mongod processes on one host without lowering each cache size.',
    'Long-running cursors or transactions that pin old snapshots, growing the history store and cache pressure.',
    'Ignoring dirty cache percentage during bulk loads.'
  ],
  interview: [
    { q: 'Walk through what happens on a write in WiredTiger.', a: '<p>The write updates the in-memory B-tree page in the cache (adding an update to the page\'s update chain) and all affected index pages, and appends a record to the journal buffer (along with the oplog entry, which is itself a collection write). The journal is flushed by group commit every 100 ms or immediately for <code>j: true</code>. Every 60 s a checkpoint writes all dirty pages to the data files, creating a new durable consistent state. Eviction threads write and remove pages from the cache when thresholds are exceeded.</p>' },
    { q: 'How does MongoDB recover after a crash?', a: '<p>WiredTiger opens the last successful checkpoint (a consistent state) and replays the journal from that point. With journaling, at most the last ~100 ms of writes that were not acknowledged with <code>j: true</code> can be lost on that node; with majority write concern those writes also exist on other members.</p>' },
    { q: 'What happens when the WiredTiger cache is full of dirty data?', a: '<p>Above the dirty trigger (20% by default) or the overall trigger (95%), application threads must help evict pages before they can proceed, so latency spikes. Causes: write bursts beyond disk throughput, very large transactions, lagging secondaries pinning the majority snapshot, or a too-small cache. Remedies: throttle writers, fix disk IO, size the cache and working set, keep transactions short.</p>' }
  ],
  quiz: [
    { q: 'Default WiredTiger cache on a 32 GB host?', options: ['16 GB', 'About 15.5 GB', '8 GB', '30 GB'], answer: 1, explain: '50% of (32 - 1) GB = 15.5 GB.' },
    { q: 'How often does WiredTiger take a checkpoint by default?', options: ['Every 100 ms', 'Every 60 seconds', 'Every 5 minutes', 'Only at shutdown'], answer: 1 },
    { q: 'At what dirty-cache percentage do application threads start helping eviction by default?', options: ['5%', '10%', '20%', '80%'], answer: 2 }
  ]
},
{
  id: 'replica-set-elections', module: 'replica-sets', title: 'Replica sets, elections and failover', minutes: 32,
  summary: 'How members replicate, how a new primary is elected, what priorities, votes, hidden and delayed members do, and how failover looks from the application.',
  objectives: ['Describe member types: primary, secondary, arbiter, hidden, delayed', 'Explain the election protocol, terms, priorities and timeouts', 'Design a fault-tolerant voting topology', 'Predict application behaviour during failover'],
  sections: {
    concept: `<div data-diagram="replica-set"></div>
<ul>
<li>A replica set has one <b>primary</b> that accepts writes and records them in the oplog, and <b>secondaries</b> that copy and apply the oplog.</li>
<li>Up to 50 members, at most <b>7 voting</b>. Elections need a <b>majority of voting members</b>: 3 members tolerate 1 failure, 5 tolerate 2.</li>
<li><b>priority</b> (0 to 1000) influences who becomes primary; priority 0 members never become primary. <b>hidden</b> members are invisible to clients (good for backups and analytics). <b>delayed</b> members (<code>secondaryDelaySecs</code>) keep an older copy, a protection against human error. <b>arbiters</b> vote but hold no data.</li>
<li>Members send heartbeats every 2 s. If a secondary has not heard from the primary for <code>electionTimeoutMillis</code> (10 s), it calls an election: increments the <b>term</b>, votes for itself, and asks others. A voter grants its vote only if the candidate's oplog is at least as recent as its own.</li>
</ul>
<h3>Replica set simulator</h3>
<p>Write with w:1 or w:"majority", kill members, partition the primary, add lag, and watch elections, commit points and rollbacks happen.</p>
<div data-widget="rs-sim"></div>`,
    why: `<p>Replica sets are how MongoDB provides high availability and safe backups. Most production outages that lose data involve a misunderstood topology: two data centres with an even split, arbiters in PSA sets, or w:1 writes during failover.</p>`,
    useCase: `<p>Three data-bearing members across three availability zones, priorities 2/1/1 so the preferred zone holds the primary, plus a hidden delayed member (1 hour) in a fourth location with priority 0 and votes 0 for recovering from accidental deletes. The application uses <code>w: "majority"</code> and retryable writes, so a zone outage causes a ~10 s write pause and no lost acknowledged data.</p>`,
    internals: `<p>The election protocol (pv1) is Raft-like: terms prevent split brain, a candidate needs a majority of votes, and a primary that cannot see a majority steps down by itself. After an election, the new primary may catch up from other secondaries (<code>catchUpTimeoutMillis</code>) before accepting writes. Typical failover: 10 s to detect plus around 1-2 s to elect; drivers detect the new primary through server monitoring and retry writes once (retryable writes) and reads (retryable reads).</p>`
  },
  examples: [
    { title: 'Inspect the replica set', code: `rs.status().members.map(m => ({ name: m.name, state: m.stateStr, health: m.health, lagSecs: m.optimeDate ? Math.round((rs.status().date - m.optimeDate) / 1000) : null }))
rs.conf().members.map(m => ({ host: m.host, priority: m.priority, votes: m.votes, hidden: m.hidden, delaySecs: m.secondaryDelaySecs }))
rs.conf().settings`, note: 'The playground returns a realistic 3-member sample; use the simulator above for behaviour.' },
    { title: 'Typical reconfiguration (run on a real primary)', runnable: false, code: `cfg = rs.conf()
cfg.members[0].priority = 2                       // prefer this member as primary
cfg.members[3].priority = 0
cfg.members[3].hidden = true
cfg.members[3].secondaryDelaySecs = 3600          // delayed member, also set votes: 0
cfg.members[3].votes = 0
rs.reconfig(cfg)

rs.stepDown(60)                                   // planned failover: primary steps down for 60 s
rs.freeze(120)                                    // keep a secondary from seeking election` },
    { title: 'Connection string for a replica set', runnable: false, code: `mongodb://app:***@mongo-0:27017,mongo-1:27017,mongo-2:27017/shop?replicaSet=rs0&retryWrites=true&w=majority&readPreference=primary` }
  ],
  mistakes: [
    'Even number of voting members across two data centres: losing the bigger side (or the link) leaves no majority anywhere.',
    'Primary-Secondary-Arbiter (PSA) in production: when one data member is down, majority writes block and the cache fills with history (the majority commit point cannot advance).',
    'Using hidden or delayed members with votes that matter for elections.',
    'Changing several voting members in a single reconfig instead of one at a time.',
    'Testing failover only on paper; run <code>rs.stepDown()</code> drills in staging and production maintenance windows.'
  ],
  interview: [
    { q: 'How does a MongoDB replica set elect a new primary?', a: '<p>When secondaries miss heartbeats from the primary for <code>electionTimeoutMillis</code> (10 s default), an eligible member (priority > 0, up to date enough) increments the term and requests votes. Each voter votes once per term and only for a candidate whose oplog is at least as recent as its own. A majority of votes wins. Higher-priority members can later trigger a takeover once caught up. A primary that loses contact with a majority steps down to avoid split brain.</p>' },
    { q: 'Why are arbiters discouraged?', a: '<p>They add a vote without data. In a PSA set with one data member down you still have a primary (2 of 3 votes), but <code>w: "majority"</code> writes cannot be acknowledged, majority reads go stale, and the primary keeps history for the majority commit point, causing cache pressure. A third data-bearing member is safer. If you must use an arbiter, consider setting the secondary to <code>votes: 0</code> during long outages, carefully.</p>' },
    { q: 'What is a delayed member used for?', a: '<p>It applies the oplog with a delay (e.g. 1 hour), so after a human error such as a dropped collection you can recover data from it before the mistake replicates. It must be priority 0 and should be hidden, with votes 0 in most designs. It is not a replacement for backups.</p>' },
    { q: 'What does the application see during a failover?', a: '<p>Writes fail or block for the election window (roughly 10-12 s with defaults). Drivers with retryable writes retry once after the new primary is discovered, so most single-statement writes succeed transparently. In-flight transactions abort with TransientTransactionError and are retried by the callback API. Reads with <code>primaryPreferred</code>/<code>secondaryPreferred</code> can continue on secondaries.</p>' }
  ],
  quiz: [
    { q: 'How many members can fail in a 5-member replica set while still electing a primary?', options: ['1', '2', '3', '4'], answer: 1 },
    { q: 'Maximum number of voting members?', options: ['3', '5', '7', '50'], answer: 2 },
    { q: 'Default electionTimeoutMillis?', options: ['2,000', '5,000', '10,000', '30,000'], answer: 2 },
    { q: 'Which member type should a delayed member be?', options: ['priority 1, visible', 'priority 0, hidden, usually votes 0', 'An arbiter', 'The primary'], answer: 1 }
  ]
},
{
  id: 'oplog-replication', module: 'oplog', title: 'The oplog, initial sync, lag and rollback', minutes: 28,
  summary: 'The capped collection at the heart of replication: what entries look like, how big it should be, what causes replication lag and how rollback works.',
  objectives: ['Read oplog entries and know why they are idempotent', 'Size the oplog by window, not by bytes', 'Diagnose replication lag', 'Explain initial sync and rollback'],
  sections: {
    concept: `<div data-diagram="oplog"></div>
<p>The oplog (<code>local.oplog.rs</code>) is a special capped collection. Every write on the primary appends entries describing the <b>result</b> of the change: an <code>$inc</code> becomes the new value, so applying an entry twice gives the same result (idempotent). Secondaries fetch entries in batches, apply them in parallel by document, and record their progress (<code>optime</code>).</p>
<ul><li>Default size: 5% of free disk, between 990 MB and 50 GB. Resize online with <code>replSetResizeOplog</code>. Since 4.4, <code>oplogMinRetentionHours</code> keeps entries for a minimum time.</li>
<li>The <b>oplog window</b> is the time between the first and last entry. A member that is offline longer than the window cannot catch up and needs a full <b>initial sync</b>.</li>
<li><b>Initial sync</b> clones every database and then applies the oplog accumulated during the copy. File copy based initial sync (Enterprise 5.2+) copies data files instead.</li>
<li><b>Rollback</b>: if a primary accepted writes that never replicated to the majority, then failed over, those writes are undone when it rejoins and saved to <code>rollback/</code> files.</li></ul>`,
    why: `<p>The oplog window is your safety margin for maintenance, network partitions, change stream consumers and backups based on oplog replay. Many teams discover it is only 2 hours during a heavy batch, exactly when a secondary is down for patching.</p>`,
    useCase: `<p>A secondary is taken down for an OS upgrade that runs long. The oplog window during normal traffic is 30 hours, but a bulk re-indexing job generates 10x the usual writes, shrinking the window to 3 hours. The secondary falls off the oplog and needs a 6-hour initial sync of 2 TB. Monitoring the window during batch jobs and sizing the oplog for the worst day avoids this.</p>`,
    internals: `<p>Replication lag causes: under-provisioned secondaries (slower disks), heavy single-document hot spots (cannot be applied in parallel), large multi-updates generating many entries, index builds on secondaries, network bandwidth between data centres, and read load on secondaries competing with oplog application. <b>Flow control</b> (4.2+) throttles writes on the primary when the majority commit point lags more than <code>flowControlTargetLagSeconds</code> (10 s by default), trading write latency for bounded lag.</p>
<h3>Oplog window calculator</h3>
<div data-widget="oplog-calc"></div>`
  },
  examples: [
    { title: 'See your own oplog entries', code: `db.orders.updateOne({ orderNo: "ORD-100050" }, { $inc: { total: 10 } })
db.customers.updateOne({ _id: 12 }, { $unset: { phone: "" }, $set: { tier: "gold" } })
db.getSiblingDB("local").oplog.rs.find({ ns: /^shop\\./ }).sort({ $natural: -1 }).limit(2)`, note: '<code>$inc: 10</code> is recorded as the resulting total. Re-applying the entry is harmless. (This oplog uses a simplified diff format.)' },
    { title: 'Oplog window and lag', code: `rs.printReplicationInfo()
rs.printSecondaryReplicationInfo()` },
    { title: 'Operations on a real deployment', runnable: false, code: `// resize oplog to 100 GB online (run on each member)
db.adminCommand({ replSetResizeOplog: 1, size: 102400 })
// keep at least 48 hours regardless of size
db.adminCommand({ replSetResizeOplog: 1, minRetentionHours: 48 })
// flow control status
db.serverStatus().flowControl
// replication metrics on a secondary
db.serverStatus().metrics.repl.apply` }
  ],
  mistakes: [
    'Sizing the oplog by bytes without measuring the window under peak write load.',
    'Running huge <code>updateMany</code> operations that produce millions of oplog entries in minutes.',
    'Serving heavy analytics from the same secondaries that must keep up with replication.',
    'Not alerting on the oplog window and on lag (seconds behind primary).'
  ],
  interview: [
    { q: 'Why must oplog entries be idempotent?', a: '<p>Secondaries may apply an entry more than once (after a crash during a batch, during initial sync while the copy overlaps the oplog). Recording results (set field to 42) rather than operations (increment by 1) makes repeated application safe.</p>' },
    { q: 'A secondary is lagging. How do you troubleshoot?', a: '<p>Check <code>rs.printSecondaryReplicationInfo()</code> and lag trend; compare hardware and disk latency of primary vs secondary; look at the write workload (bulk updates, hot documents); check whether secondary reads or index builds compete; check network between sites; inspect <code>metrics.repl.apply</code> and <code>buffer</code>; verify the oplog window is not about to be exceeded. Short term: reduce secondary read load, throttle batches; long term: match hardware, fix workload patterns, enable or tune flow control.</p>' },
    { q: 'Explain rollback in a replica set.', a: '<p>A primary accepts writes acknowledged with w:1, crashes or is partitioned before replicating them, and another member becomes primary and takes new writes. When the old primary returns, its oplog has diverged; it finds the common point, undoes its unreplicated writes (recover-to-timestamp in modern versions), saves them as BSON in the rollback directory, and resyncs. Majority write concern avoids losing acknowledged writes this way.</p>' }
  ],
  quiz: [
    { q: 'What happens if a secondary is offline longer than the oplog window?', options: ['It catches up slowly', 'It needs a full initial sync', 'It becomes an arbiter', 'The primary blocks writes'], answer: 1 },
    { q: 'Default oplog size bounds?', options: ['64 MB to 1 GB', '990 MB to 50 GB', '1 GB to 100 GB', 'Unlimited'], answer: 1 },
    { q: 'What does flow control do?', options: ['Limits connections', 'Throttles primary writes when majority lag grows', 'Compresses the oplog', 'Moves chunks'], answer: 1 }
  ]
},
{
  id: 'backup-pitr', module: 'backup-restore', title: 'Backup, restore and point-in-time recovery', minutes: 30,
  summary: 'Logical versus physical backups, consistent snapshots, oplog-based point-in-time recovery, and the restore drills that prove it all works.',
  objectives: ['Choose between mongodump, filesystem snapshots and backup agents (PBM, Ops Manager)', 'Take consistent backups of replica sets and sharded clusters', 'Perform point-in-time recovery with oplog replay', 'Define RPO and RTO and test them'],
  sections: {
    concept: `<table><tr><th>Method</th><th>Pros</th><th>Cons</th></tr>
<tr><td><code>mongodump</code> / <code>mongorestore</code></td><td>Simple, portable, per collection</td><td>Slow for large data, rebuilds indexes on restore, sharded consistency needs extra care</td></tr>
<tr><td>Filesystem snapshot (LVM, EBS, ZFS)</td><td>Fast, whole node, includes indexes</td><td>Journal must be on the same volume or use <code>fsyncLock</code>; per-shard coordination in clusters</td></tr>
<tr><td>Percona Backup for MongoDB (PBM)</td><td>Logical and physical, sharded-consistent, PITR from oplog slices, S3/GCS/Azure</td><td>Agent per mongod to operate</td></tr>
<tr><td>Ops Manager / Cloud Manager</td><td>Continuous backup, PITR, UI</td><td>Licensing (Enterprise)</td></tr></table>
<div data-diagram="pitr"></div>
<p><b>Point-in-time recovery</b> = restore the latest full backup taken before the target time, then replay the oplog up to just before the bad operation (<code>mongorestore --oplogReplay --oplogLimit &lt;ts&gt;</code>, or <code>pbm restore --time</code>).</p>`,
    why: `<p>Replication protects against hardware failure, not against <code>db.orders.drop()</code>, a bad migration or ransomware: those replicate instantly. Backups are the only protection, and an untested backup is a hope, not a plan.</p>`,
    useCase: `<p>At 14:05 an engineer runs a <code>deleteMany</code> with a wrong filter. The team finds the exact oplog timestamp of the first delete, restores last night's PBM snapshot to a new cluster, replays oplog slices up to 14:04:59, validates counts, and copies the affected collection back. RPO: zero data loss up to the bad operation; RTO: 45 minutes, matching the last drill.</p>`,
    internals: `<p><code>mongodump --oplog</code> captures oplog entries written during the dump so the restore (<code>--oplogReplay</code>) is consistent to a single point for a replica set. For sharded clusters, a consistent backup needs coordination across shards and config servers (PBM and Ops Manager do this; manual snapshots require stopping the balancer and taking snapshots close together, which is only approximately consistent). Restoring to a cluster with a different topology or name needs care with <code>config</code> metadata.</p>`
  },
  examples: [
    { title: 'Logical backup and restore', runnable: false, code: `# consistent dump of a replica set, compressed, with oplog
mongodump --uri "mongodb://backup:***@mongo-1:27017/?replicaSet=rs0&readPreference=secondary" \\
  --oplog --gzip --out /backups/2026-09-29

# restore one collection into a scratch database
mongorestore --uri "mongodb://restore:***@scratch:27017" --gzip \\
  --nsInclude "shop.orders" --nsFrom "shop.orders" --nsTo "restore_check.orders" /backups/2026-09-29

# point-in-time: replay oplog up to just before the bad operation
mongorestore --oplogReplay --oplogLimit 1790000000:1 /backups/2026-09-29` },
    { title: 'Percona Backup for MongoDB', runnable: false, code: `pbm config --file /etc/pbm/storage.yaml     # S3 bucket, prefix, credentials
pbm config --set pitr.enabled=true          # continuous oplog slices
pbm backup --type=physical                  # or logical / incremental
pbm list                                    # backups + PITR ranges
pbm restore --time="2026-09-29T14:04:59"    # point-in-time restore
pbm status` },
    { title: 'Find the bad operation in the oplog', code: `db.lab_victim.drop()
db.lab_victim.insertMany([{ n: 1 }, { n: 2 }, { n: 3 }])
db.lab_victim.deleteMany({})
db.getSiblingDB("local").oplog.rs.find({ ns: "shop.lab_victim", op: "d" }, { ts: 1, op: 1, o: 1 }).sort({ $natural: 1 }).limit(1)`, note: 'The ts of the first delete is the --oplogLimit for a point-in-time restore.' }
  ],
  mistakes: [
    'Treating replicas as backups.',
    'Never testing restores; discovering during an incident that backups are incomplete or take 3 days to restore.',
    'Backups stored in the same account/region with the same credentials as production (ransomware, region loss).',
    'Snapshotting data without the journal volume or without <code>fsyncLock</code>.',
    'Running <code>mongodump</code> against the primary of a busy cluster during peak hours.'
  ],
  interview: [
    { q: 'How do you take a consistent backup of a sharded cluster?', a: '<p>Use a tool that coordinates across shards and config servers: Percona Backup for MongoDB, Ops Manager or Cloud Manager. They capture each shard and the config server replica set and use oplog to bring them to a common cluster time. A manual approach stops the balancer, takes snapshots of each shard and the config servers as close in time as possible (or with <code>fsyncLock</code>), and accepts approximate consistency. <code>mongodump</code> through mongos is not point-in-time consistent across shards.</p>' },
    { q: 'What are RPO and RTO and how do you achieve them?', a: '<p>RPO is the maximum acceptable data loss (time), RTO the maximum acceptable time to restore service. Continuous oplog capture (PITR) gives an RPO of seconds; full backup frequency plus restore speed (physical vs logical, data size, network) determines RTO. Measure both in scheduled restore drills and record actual numbers.</p>' }
  ],
  quiz: [
    { q: 'Does a replica set protect against an accidental drop()?', options: ['Yes', 'No, the drop replicates', 'Only with w: majority', 'Only on hidden members'], answer: 1 },
    { q: 'Which option makes mongodump of a replica set consistent to one point in time?', options: ['--gzip', '--oplog', '--archive', '--forceTableScan'], answer: 1 }
  ]
},
{
  id: 'security-hardening', module: 'security', title: 'Security: authentication, RBAC, TLS and encryption', minutes: 28,
  summary: 'Harden a self-managed deployment: enable auth, least-privilege roles, TLS everywhere, internal authentication, encryption at rest, field-level encryption and auditing.',
  objectives: ['Enable authentication and create least-privilege users', 'Use built-in and custom roles', 'Configure TLS and internal member authentication', 'Choose between encryption at rest, CSFLE and Queryable Encryption'],
  sections: {
    concept: `<ul>
<li><b>Authentication</b>: SCRAM-SHA-256 by default; x.509 certificates; LDAP, Kerberos and OIDC in Enterprise editions (Percona Server for MongoDB also supports LDAP and Kerberos).</li>
<li><b>Authorization (RBAC)</b>: users get roles; roles grant privileges (actions on resources). Built-ins: <code>read</code>, <code>readWrite</code>, <code>dbAdmin</code>, <code>userAdmin</code>, <code>clusterMonitor</code>, <code>clusterAdmin</code>, <code>backup</code>, <code>restore</code>, <code>root</code>. Custom roles narrow privileges further.</li>
<li><b>Network</b>: <code>bindIp</code> to private interfaces, firewall/security groups, TLS with <code>net.tls.mode: requireTLS</code>.</li>
<li><b>Internal auth</b>: replica set and cluster members authenticate each other with a keyFile or x.509 (<code>security.clusterAuthMode</code>).</li>
<li><b>Encryption at rest</b>: storage-engine encryption (Enterprise, Percona Server for MongoDB with Vault/KMIP), or volume encryption (LUKS, EBS).</li>
<li><b>Client-side field level encryption (CSFLE)</b> and <b>Queryable Encryption</b> (7.0 GA): the driver encrypts sensitive fields before they leave the application; the server never sees plaintext.</li>
<li><b>Auditing</b>: Enterprise and Percona Server log authentication, DDL and optionally CRUD events.</li>
</ul>`,
    why: `<p>Unauthenticated MongoDB instances exposed to the internet were famously ransomed by the thousands. Today the risks are subtler: over-privileged application users, shared admin credentials, plaintext connections inside the VPC, and backups without encryption.</p>`,
    useCase: `<p>The shop application connects as <code>shop_app</code> with <code>readWrite</code> on <code>shop</code> only; reporting uses <code>shop_ro</code> with <code>read</code> pinned to analytics nodes; the backup agent uses the <code>backup</code> role; humans log in with LDAP accounts mapped to roles; card numbers are protected with Queryable Encryption so DBAs never see them.</p>`,
    internals: `<p>Users are stored in <code>admin.system.users</code> with salted SCRAM credentials; the authentication database is where the user is defined (<code>authSource</code>). The <b>localhost exception</b> lets you create the first user on a fresh instance with auth enabled, then closes. With CSFLE the driver fetches data keys from a key vault collection, encrypted by a customer master key in a KMS (AWS KMS, Azure, GCP, KMIP); deterministic encryption allows equality queries, random encryption does not, and Queryable Encryption supports equality and range on randomly encrypted data.</p>`
  },
  examples: [
    { title: 'Least-privilege users and a custom role', code: `use admin
// clean up from a previous run so the example can be repeated
for (const u of ["shop_app", "analyst"]) { try { db.dropUser(u) } catch (e) {} }
try { db.dropRole("ordersReadOnlyNoPII") } catch (e) {}
db.createRole({ role: "ordersReadOnlyNoPII", privileges: [{ resource: { db: "shop", collection: "orders" }, actions: ["find"] }], roles: [] })
db.createUser({ user: "shop_app", pwd: "use-a-secret-manager", roles: [{ role: "readWrite", db: "shop" }] })
db.createUser({ user: "analyst", pwd: "use-a-secret-manager", roles: ["ordersReadOnlyNoPII", { role: "clusterMonitor", db: "admin" }] })
db.getUsers().users.map(u => ({ user: u.user, roles: u.roles }))
use shop` },
    { title: 'mongod.conf security section', runnable: false, code: `net:
  port: 27017
  bindIp: 10.0.1.15,localhost
  tls:
    mode: requireTLS
    certificateKeyFile: /etc/mongo/tls/server.pem
    CAFile: /etc/mongo/tls/ca.pem
security:
  authorization: enabled
  clusterAuthMode: x509          # or keyFile: /etc/mongo/keyfile (chmod 400)
setParameter:
  authenticationMechanisms: SCRAM-SHA-256,MONGODB-X509` },
    { title: 'Audit: who can do what?', code: `db.adminCommand({ connectionStatus: 1 })
db.getSiblingDB("admin").getRoles({ showPrivileges: false, showBuiltinRoles: false })` }
  ],
  mistakes: [
    'Binding to 0.0.0.0 with auth disabled, even "temporarily".',
    'One <code>root</code> user shared by the application, scripts and humans.',
    'TLS only at the load balancer while member-to-member traffic is plaintext.',
    'Passwords in connection strings committed to git; use a secret manager and rotate.',
    'Keyfiles with permissive file permissions, or the same keyfile across environments.'
  ],
  interview: [
    { q: 'How would you secure a new self-managed MongoDB deployment?', a: '<p>Private network only (bindIp, security groups), TLS required for clients and members, internal auth via x.509 or keyFile, <code>authorization: enabled</code>, admin user created via the localhost exception, per-application least-privilege users and custom roles, human access via LDAP/OIDC with MFA where available, encryption at rest (engine or volume), CSFLE/Queryable Encryption for PII, auditing enabled, secrets in a vault with rotation, encrypted backups in a separate account, and regular patching.</p>' },
    { q: 'CSFLE vs encryption at rest?', a: '<p>Encryption at rest protects data files and backups from someone with disk access; the server and DBAs still see plaintext. CSFLE and Queryable Encryption encrypt specific fields in the driver, so the server, logs, backups and DBAs only see ciphertext; only applications with access to the keys can decrypt. They complement each other.</p>' }
  ],
  quiz: [
    { q: 'Which built-in role suits a monitoring agent?', options: ['root', 'clusterMonitor', 'readWriteAnyDatabase', 'dbOwner'], answer: 1 },
    { q: 'What does the localhost exception allow?', options: ['Unlimited access from localhost forever', 'Creating the first user when none exist', 'Skipping TLS', 'Reading the oplog'], answer: 1 }
  ]
},
{
  id: 'monitoring-diagnostics', module: 'monitoring', title: 'Monitoring and diagnostics', minutes: 30,
  summary: 'The metrics that matter, how to read serverStatus, currentOp, logs and FTDC, and a triage order for incidents.',
  objectives: ['Monitor the golden signals for MongoDB', 'Use serverStatus, currentOp, mongostat and mongotop', 'Read structured logs and slow query lines', 'Know what FTDC is and when support asks for it'],
  sections: {
    concept: `<table><tr><th>Area</th><th>Metric</th><th>Why</th></tr>
<tr><td>Throughput</td><td><code>opcounters</code>, <code>opcountersRepl</code></td><td>Load shape and sudden changes</td></tr>
<tr><td>Latency</td><td><code>opLatencies</code> (reads/writes/commands), slow query counts</td><td>User-visible symptoms</td></tr>
<tr><td>Saturation</td><td>Cache used/dirty %, tickets available, <code>globalLock.currentQueue</code>, CPU, disk util and latency</td><td>Leading indicators</td></tr>
<tr><td>Errors</td><td><code>asserts</code>, failed elections, write concern timeouts</td><td>Health</td></tr>
<tr><td>Replication</td><td>Lag, oplog window, member states</td><td>HA safety</td></tr>
<tr><td>Connections</td><td><code>connections.current</code>/<code>available</code>, churn (<code>totalCreated</code>)</td><td>Pool misconfiguration, storms</td></tr>
<tr><td>Query efficiency</td><td><code>metrics.queryExecutor.scanned</code>/<code>scannedObjects</code> vs returned, <code>COLLSCAN</code> count</td><td>Missing indexes</td></tr></table>
<p><b>FTDC</b> (full-time diagnostic data capture) records serverStatus, replSetGetStatus, system metrics and more every second into <code>diagnostic.data/</code> in a compact format. It is the first thing MongoDB and Percona support ask for after an incident.</p>`,
    why: `<p>Good monitoring turns "the database is slow" into "cache dirty hit 20% at 14:02 when the batch started, checkout p99 rose to 900 ms". Without history you are guessing.</p>`,
    useCase: `<p>Incident triage order: (1) is the replica set healthy and is there a primary; (2) resource saturation: CPU, disk latency, cache, tickets and queues; (3) what changed: deploy, batch, traffic; (4) top operations: currentOp and slow log by shape; (5) fix or mitigate: kill the runaway, throttle the batch, add the index, scale.</p>`,
    internals: `<p>Logs are structured JSON since 4.4 (<code>{"t":..., "s":"I", "c":"COMMAND", "id":51803, "msg":"Slow query", "attr":{...}}</code>), making them easy to parse with jq or ship to a log platform. Each slow query line includes <code>planSummary</code>, <code>keysExamined</code>, <code>docsExamined</code>, <code>durationMillis</code>, <code>queryHash</code> and storage wait times. Per-collection latency is available with <code>$collStats: { latencyStats: {} }</code>.</p>`
  },
  examples: [
    { title: 'Health snapshot', code: `const ss = db.serverStatus()
printjson({ uptime: ss.uptime, connections: ss.connections, opcounters: ss.opcounters, queue: ss.globalLock && ss.globalLock.currentQueue })` },
    { title: 'What is running right now?', code: `db.currentOp({ active: true })
db.currentOp({ active: true, secs_running: { $gt: 3 }, op: { $in: ["query", "update", "command"] } })` },
    { title: 'Command line tools', runnable: false, code: `mongostat --uri "$MONGO_URI" 1          # per-second ops, dirty %, used %, qrw/arw queues, conn
mongotop --uri "$MONGO_URI" 5           # read/write time per collection
# slow queries from the JSON log, grouped by query shape
jq -c 'select(.msg=="Slow query") | {ns: .attr.ns, hash: .attr.queryHash, ms: .attr.durationMillis, plan: .attr.planSummary}' /var/log/mongodb/mongod.log` },
    { title: 'Collection-level stats', code: `db.orders.aggregate([{ $collStats: { storageStats: {}, count: {} } }, { $project: { ns: 1, count: 1, "storageStats.size": 1, "storageStats.totalIndexSize": 1 } }])` }
  ],
  mistakes: [
    'Alerting only on CPU; cache dirty %, tickets, queues and replication lag are earlier signals.',
    'No baseline: you cannot tell what is abnormal without normal.',
    'Deleting <code>diagnostic.data</code> to save space; it is capped (about 200 MB) and invaluable.',
    'Killing operations without recording what they were (capture currentOp output first).'
  ],
  interview: [
    { q: 'Which MongoDB metrics would you alert on?', a: '<p>Replica set: no primary, member down, replication lag over N seconds, oplog window below N hours. Resources: cache dirty above ~10% sustained, cache used above 95%, available tickets near zero, queued operations, disk latency/utilisation, disk space. Workload: opLatencies p99 per op type, slow query rate, COLLSCAN rate, connection count near limits and connection churn. Errors: assertions, write concern timeouts, elections.</p>' },
    { q: 'What is FTDC?', a: '<p>Full-Time Diagnostic Data Capture: mongod and mongos record server statistics every second into compressed files in <code>diagnostic.data</code>, rotated by size. It contains no user data, just metrics, and lets engineers reconstruct exactly what happened before and during an incident.</p>' }
  ],
  quiz: [
    { q: 'Which tool shows read/write time per collection?', options: ['mongostat', 'mongotop', 'mongodump', 'mongosh'], answer: 1 },
    { q: 'Where is FTDC data stored?', options: ['In the oplog', 'In diagnostic.data under the dbPath', 'In system.profile', 'In the config database'], answer: 1 }
  ]
},
{
  id: 'upgrades-fcv', module: 'upgrades', title: 'Rolling upgrades and featureCompatibilityVersion', minutes: 22,
  summary: 'Upgrade replica sets and sharded clusters without downtime, use FCV as the safety latch, and plan the rollback path.',
  objectives: ['Perform a rolling upgrade of a replica set', 'Order a sharded cluster upgrade', 'Explain what FCV controls and when to raise it', 'Prepare a rollback plan and driver compatibility checks'],
  sections: {
    concept: `<ol><li>Read the release notes and compatibility changes; check driver versions; test in staging with production-like data and traffic.</li>
<li>Upgrade one major version at a time (6.0 → 7.0 → 8.0). FCV must equal the current version before the next upgrade.</li>
<li><b>Replica set</b>: upgrade secondaries one at a time (shutdown, replace binaries, start, wait until SECONDARY and caught up), then <code>rs.stepDown()</code> the primary and upgrade it.</li>
<li><b>Sharded cluster</b>: stop the balancer, upgrade config server replica set, then each shard (rolling), then mongos instances, then re-enable the balancer.</li>
<li>Run on the new binaries for a while with the old FCV. When confident, <code>setFeatureCompatibilityVersion</code> to the new version (7.0+ requires <code>confirm: true</code>).</li></ol>
<p>The <b>featureCompatibilityVersion</b> controls which features that change on-disk formats or protocols are enabled. While FCV is old, you can still downgrade binaries; after raising it, downgrading needs lowering FCV first (and some versions only support downgrade through support-assisted procedures).</p>`,
    why: `<p>Running unsupported versions accumulates risk (no security fixes); botched upgrades cause outages. FCV gives you a window to validate the new binaries in production with an easy way back.</p>`,
    useCase: `<p>Upgrading a 3-shard cluster from 7.0 to 8.0: binaries rolled out over two maintenance windows with the balancer stopped, two weeks of observation at FCV 7.0 (comparing latency dashboards and slow query rates), then FCV raised to 8.0 in a low-traffic window, with the rollback runbook rehearsed in staging.</p>`,
    internals: `<p>Raising FCV can trigger metadata conversions (for example, on-disk format or catalog changes) and is itself replicated. In sharded clusters it is coordinated by the config server. Mixed-version replica sets are supported only during the upgrade window. Operator-managed Kubernetes deployments perform the same sequence through the custom resource (image version, then FCV field).</p>`
  },
  examples: [
    { title: 'Check and set FCV', code: `db.adminCommand({ getParameter: 1, featureCompatibilityVersion: 1 })
db.adminCommand({ setFeatureCompatibilityVersion: "8.0", confirm: true })
db.version()` },
    { title: 'Rolling upgrade runbook (per secondary)', runnable: false, code: `# 1. confirm health and lag
mongosh --eval 'rs.status().members.map(m => [m.name, m.stateStr, m.optimeDate])'
# 2. clean shutdown
mongosh admin --eval 'db.shutdownServer()'
# 3. install new binaries / change container image
sudo apt-get install -y mongodb-org=8.0.4
# 4. start and wait for SECONDARY + caught up, then move to the next member
sudo systemctl start mongod
# 5. finally on the primary
mongosh --eval 'rs.stepDown(120)'   # then upgrade it like a secondary
# 6. after the soak period
mongosh admin --eval 'db.adminCommand({ setFeatureCompatibilityVersion: "8.0", confirm: true })'` }
  ],
  mistakes: [
    'Raising FCV immediately after upgrading binaries, removing the easy rollback path.',
    'Skipping a major version.',
    'Leaving the balancer running during a sharded cluster upgrade.',
    'Not checking driver compatibility (old drivers may not support new wire versions).',
    'Upgrading all members simultaneously.'
  ],
  interview: [
    { q: 'What is FCV and why does it exist?', a: '<p>featureCompatibilityVersion gates features that are not backward compatible (data formats, internal protocols). New binaries run with the old FCV, so the deployment behaves compatibly and binaries can be downgraded. Once validated, raising FCV enables the new features. To downgrade binaries later you must first lower FCV, if the version supports it.</p>' },
    { q: 'Describe the order of a sharded cluster upgrade.', a: '<p>Stop the balancer, upgrade the config server replica set (rolling: secondaries, step down, primary), upgrade each shard replica set the same way, upgrade mongos routers, restart the balancer, soak, then raise FCV via mongos.</p>' }
  ],
  quiz: [
    { q: 'Which members do you upgrade first in a replica set?', options: ['The primary', 'Secondaries, one at a time', 'All at once', 'Arbiters only'], answer: 1 },
    { q: 'When should FCV be raised?', options: ['Before upgrading binaries', 'Immediately after the first member is upgraded', 'After all members run the new binaries and the soak period passes', 'Never'], answer: 2 }
  ]
}
]);
