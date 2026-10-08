/* Level 5 — Database Architect */
MM.addLessons([
{
  id: 'capacity-sizing', module: 'capacity', title: 'Capacity planning: working set, RAM, disk and IOPS', minutes: 28,
  summary: 'Estimate the hardware a workload needs, from document counts and access patterns to RAM for the working set, disk for growth and IOPS for writes.',
  objectives: ['Define and estimate the working set', 'Size RAM, disk and IOPS with explicit assumptions', 'Model growth and plan headroom', 'Know when to scale up versus shard'],
  sections: {
    concept: `<p>The <b>working set</b> is the data and indexes touched by the workload in a typical period: the hot indexes in full, plus the recently accessed documents. When it fits in the WiredTiger cache (plus the OS cache for compressed pages), reads are served from memory; when it does not, latency becomes disk latency.</p>
<ul><li><b>Data size</b> = documents x average BSON size (use <code>$bsonSize</code> or <code>stats().avgObjSize</code>), on disk divided by the compression ratio (often 2-4x with snappy/zstd, measure yours).</li>
<li><b>Index size</b> = number of entries x key size (multikey: per element). Hot indexes should fit in cache entirely.</li>
<li><b>IOPS</b>: writes x (1 + number of indexes) for random IO in the worst case, journal writes, checkpoint bursts, and cache misses on reads.</li>
<li><b>Headroom</b>: plan to run below 60-70% of CPU, disk throughput and cache at peak, and keep disk usage below ~70% so compaction, resync and growth have space.</li></ul>
<h3>Sizing calculator</h3>
<div data-widget="sizing"></div>`,
    why: `<p>Under-sizing shows up as cache pressure and latency; over-sizing wastes money for years. Explicit assumptions (growth per month, hot fraction, peak multiplier) make the estimate reviewable and easy to update when reality differs.</p>`,
    useCase: `<p>An order system expects 2 million orders a month at 1.5 KB each, retained for 3 years, with 6 indexes. The last 90 days are hot. Hot data: 6 M x 1.5 KB = about 8.4 GB plus hot index ranges; total indexes 72 M x 6 x ~40 B = about 16 GB, of which the recent, right-leaning portions are hot. A 64 GB node (about 31 GB cache) fits the hot set with headroom; total data after 3 years is about 100 GB uncompressed, about 40 GB on disk at 2.5x compression. Sharding is not needed for capacity; it might be needed later for write throughput.</p>`,
    internals: `<p>Cache misses are not uniform: a B-tree index lookup touches the root and internal pages (almost always cached) and one leaf page; a document fetch touches one data page. Right-leaning indexes (ObjectId, timestamps) keep the hot portion small; random keys (UUIDv4, hashed) spread the hot set across the entire index, which is why random-key indexes need to fit entirely in RAM to perform well.</p>`
  },
  examples: [
    { title: 'Measure your data', code: `["orders", "customers", "products", "reviews", "events"].map(c => {
  const s = db.getCollection(c).stats()
  return { coll: c, count: s.count, avgObjSize: s.avgObjSize, dataMB: +(s.size / 1048576).toFixed(2), indexMB: +(s.totalIndexSize / 1048576).toFixed(2), indexes: s.nindexes }
})` },
    { title: 'Growth model in the shell', code: `const ordersPerMonth = 2e6, avgBytes = 1500, months = 36, hotMonths = 3, compression = 2.5
const totalGB = ordersPerMonth * months * avgBytes / 1024 ** 3
const hotGB = ordersPerMonth * hotMonths * avgBytes / 1024 ** 3
printjson({ totalDataGB: +totalGB.toFixed(1), onDiskGB: +(totalGB / compression).toFixed(1), hotDataGB: +hotGB.toFixed(1) })` }
  ],
  mistakes: [
    'Sizing by total data instead of working set.',
    'Ignoring index size, especially multikey and random-key indexes.',
    'Benchmarking with a tiny dataset that fits in cache, then going live with 50x the data.',
    'Running disks at 90% full: no room for compaction, initial sync or emergency growth.'
  ],
  interview: [
    { q: 'How do you size RAM for a MongoDB deployment?', a: '<p>Estimate the working set: indexes used by the hot queries (ideally fully in cache), plus the hot fraction of documents (recent data, popular items). Add memory for connections (~1 MB each), aggregation and sort buffers, and the OS file cache. The WiredTiger cache is about half of RAM by default, so RAM should be roughly 2x the hot working set. Validate with a load test on production-sized data and watch cache read-into rates.</p>' },
    { q: 'When do you shard instead of scaling up?', a: '<p>When a single replica set cannot meet requirements even on the largest practical hardware: write throughput beyond one primary, working set beyond practical RAM, data size beyond practical disk or restore-time limits (a 20 TB replica set takes too long to back up and resync), or data locality requirements (zones). Sharding adds operational complexity, so scale up and optimize first.</p>' }
  ],
  quiz: [
    { q: 'What should ideally fit in RAM?', options: ['All data', 'The working set, especially hot indexes', 'Only the _id index', 'The oplog'], answer: 1 },
    { q: 'Why do UUIDv4 primary keys need more RAM than ObjectIds for the same insert rate?', options: ['They are longer strings', 'Inserts land randomly across the whole index, so the entire index is hot', 'They are not indexed', 'They disable compression'], answer: 1 }
  ]
},
{
  id: 'drivers-connection-pooling', module: 'drivers-pooling', title: 'Drivers, connection pools, timeouts and retries', minutes: 26,
  summary: 'Configure the application side correctly: one client per process, pool sizing, server selection and timeouts, retryable writes, and avoiding connection storms.',
  objectives: ['Size connection pools and compute total connections', 'Set timeouts that fail fast instead of hanging', 'Use retryable writes and reads', 'Avoid connection storms in serverless and autoscaling environments'],
  sections: {
    concept: `<ul>
<li>Create <b>one MongoClient per process</b> and reuse it. It holds a pool per server plus monitoring connections.</li>
<li><code>maxPoolSize</code> (default 100), <code>minPoolSize</code> (0), <code>maxIdleTimeMS</code>, <code>maxConnecting</code> (2, limits simultaneous connection establishment), <code>waitQueueTimeoutMS</code>.</li>
<li><code>serverSelectionTimeoutMS</code> (30 s default): how long to wait for a suitable server (e.g. during an election). <code>connectTimeoutMS</code> and <code>socketTimeoutMS</code>; newer drivers support a single client-side operation timeout (<code>timeoutMS</code>).</li>
<li><code>retryWrites=true</code> (default) retries a failed single write once on a new primary; <code>retryReads=true</code> does the same for reads.</li>
<li>Total server connections = app instances x pool size per instance (per mongos/member) + monitoring connections. With 200 pods x 100 = 20,000 potential connections per member.</li></ul>`,
    why: `<p>Connection storms are a classic outage: an autoscaler adds 300 pods, each opens up to 100 connections, the server spends its CPU on authentication handshakes (SCRAM is deliberately expensive) and memory on connection threads, and everything slows down, causing more scaling. Bad timeouts turn a 10 s failover into minutes of hung requests.</p>`,
    useCase: `<p>A service with 40 pods runs ~30 concurrent DB operations per pod at peak. Setting <code>maxPoolSize=40</code>, <code>minPoolSize=5</code>, <code>maxConnecting=2</code>, <code>maxIdleTimeMS=60000</code> caps the cluster at 1,600 connections per member. <code>serverSelectionTimeoutMS=5000</code> and an operation timeout of 2 s make requests fail fast during incidents, and retryable writes absorb failovers.</p>`,
    internals: `<p>Each server connection uses a thread on mongod (or a pooled ingress thread with newer async networking) and roughly 1 MB of memory. Drivers monitor each server with a dedicated connection (and an RTT connection in newer drivers), using <code>hello</code> every <code>heartbeatFrequencyMS</code> (10 s) or immediately after an error. Retryable writes use a transaction number in a logical session so the server can detect and ignore a duplicate retry.</p>`
  },
  examples: [
    { title: 'Node.js client done right', runnable: false, code: `// create once at startup, share everywhere
const client = new MongoClient(process.env.MONGO_URI, {
  maxPoolSize: 40,
  minPoolSize: 5,
  maxConnecting: 2,
  maxIdleTimeMS: 60_000,
  serverSelectionTimeoutMS: 5_000,
  timeoutMS: 2_000,                // client-side operation timeout (newer drivers)
  retryWrites: true,
  retryReads: true,
  appName: "orders-api",          // shows up in currentOp and logs
});
await client.connect();
export const db = client.db("shop");` },
    { title: 'Serverless (AWS Lambda) pattern', runnable: false, code: `let client;                       // module scope survives warm invocations
export async function handler(event) {
  client ??= await new MongoClient(process.env.MONGO_URI, { maxPoolSize: 5 }).connect();
  return client.db("shop").collection("orders").findOne({ orderNo: event.orderNo });
}` },
    { title: 'See connections from the server side', code: `db.serverStatus().connections
db.currentOp({ appName: "mongosh" }).inprog.length` }
  ],
  mistakes: [
    'Creating a new MongoClient per request.',
    'Huge default pools multiplied by hundreds of pods.',
    'No timeouts: requests hang for 30 s+ during elections or network issues.',
    'Catching and silently retrying all errors in application code, duplicating non-idempotent writes.',
    'Not setting <code>appName</code>, making it impossible to tell which service owns which connections.'
  ],
  interview: [
    { q: 'How do you size a connection pool?', a: '<p>From concurrency, not from defaults: peak concurrent operations per instance (Little\'s law: throughput x latency) plus some headroom. Multiply by instance count and check against server limits and memory. Use <code>maxConnecting</code> to avoid storms and <code>minPoolSize</code> to avoid cold-start latency. Monitor wait queue time in the driver and connection counts on the server.</p>' },
    { q: 'What are retryable writes?', a: '<p>Drivers automatically retry certain write operations once after a network error or a "not primary" error, after selecting a new primary. The server uses the session id and transaction number to ensure the write is applied only once. Multi-document writes like <code>updateMany</code> are not retryable as a whole; single-document writes and bulk writes of retryable operations are.</p>' }
  ],
  quiz: [
    { q: 'How many MongoClient instances should a web server process normally have per cluster?', options: ['One per request', 'One per thread', 'One per process, shared', 'One per collection'], answer: 2 },
    { q: 'What does maxConnecting limit?', options: ['Total connections', 'Concurrent connection establishment per pool', 'Number of mongos', 'Number of cursors'], answer: 1 }
  ]
},
{
  id: 'production-host-tuning', module: 'production-tuning', title: 'Production host tuning: OS, filesystem, memory and limits', minutes: 22,
  summary: 'The operating system settings from the production notes that prevent latency spikes and outages on self-managed hosts.',
  objectives: ['Choose filesystem and mount options', 'Configure THP, NUMA, swappiness and ulimits correctly for your version', 'Set readahead and TCP keepalive', 'Build a pre-production checklist'],
  sections: {
    concept: `<table><tr><th>Setting</th><th>Recommendation</th></tr>
<tr><td>Filesystem</td><td>XFS, mounted with <code>noatime</code>; separate volumes for data and logs; journal with data (or same snapshot group)</td></tr>
<tr><td>Transparent Huge Pages</td><td>Follow the production notes for your exact version: disabled for MongoDB 7.0 and earlier; MongoDB 8.0 with its upgraded TCMalloc recommends enabling THP</td></tr>
<tr><td>NUMA</td><td>Start mongod with <code>numactl --interleave=all</code> and set <code>vm.zone_reclaim_mode=0</code>, or disable NUMA in BIOS</td></tr>
<tr><td>Swap</td><td>Some swap configured, <code>vm.swappiness=1</code></td></tr>
<tr><td>ulimits</td><td><code>nofile</code> and <code>nproc</code> 64000 or higher</td></tr>
<tr><td>Readahead</td><td>Low (8-32 sectors) on data volumes; WiredTiger does random IO</td></tr>
<tr><td>Time</td><td>NTP/chrony on every member</td></tr>
<tr><td>TCP</td><td><code>net.ipv4.tcp_keepalive_time=120</code></td></tr>
<tr><td>Kernel</td><td>Raise <code>vm.max_map_count</code> for large deployments; recent kernel and glibc</td></tr></table>`,
    why: `<p>Many unexplained latency spikes come from the host: THP compaction stalls, NUMA imbalance, swapping, a 4 MB readahead pulling useless data into memory, or running out of file descriptors at 1,000 connections. These are cheap to get right before go-live and painful to discover in production.</p>`,
    useCase: `<p>A team sees p99 spikes of 2 s every few minutes. <code>perf</code> and kernel stats show THP compaction on a 7.0 deployment. Disabling THP through a systemd unit that runs before mongod removes the spikes. The fix is added to the base image and the pre-production checklist.</p>`,
    internals: `<p>mongod logs startup warnings for many of these (THP, NUMA, ulimits, access control); check them with <code>db.adminCommand({ getLog: "startupWarnings" })</code>. Cloud disks have IOPS and throughput caps per volume and per instance; size both, and remember that bursting volumes (e.g. gp2-style credits) run out under sustained load.</p>`
  },
  examples: [
    { title: 'Host configuration snippets', runnable: false, code: `# /etc/security/limits.d/mongod.conf
mongod soft nofile 64000
mongod hard nofile 64000
mongod soft nproc  64000
mongod hard nproc  64000

# /etc/sysctl.d/90-mongodb.conf
vm.swappiness = 1
vm.zone_reclaim_mode = 0
vm.max_map_count = 262144
net.ipv4.tcp_keepalive_time = 120

# fstab: XFS with noatime
/dev/nvme1n1  /var/lib/mongodb  xfs  defaults,noatime  0 0

# readahead for the data device
blockdev --setra 32 /dev/nvme1n1

# systemd: run with interleaved NUMA policy
ExecStart=/usr/bin/numactl --interleave=all /usr/bin/mongod --config /etc/mongod.conf` },
    { title: 'Check from the shell', code: `db.adminCommand({ getCmdLineOpts: 1 }).parsed
db.hostInfo()` }
  ],
  mistakes: [
    'Copying a THP rule from an old blog post without checking the production notes for your version.',
    'ext4 with default options, or network filesystems (NFS) for data files.',
    'Leaving ulimit nofile at 1024.',
    'Running other memory-hungry services on database hosts.'
  ],
  interview: [
    { q: 'Name host-level settings you check before putting MongoDB in production.', a: '<p>XFS with noatime, THP configured according to the version\'s production notes, NUMA interleave and zone_reclaim_mode=0, swappiness 1, ulimits (nofile/nproc 64000), low readahead, NTP, TCP keepalive 120 s, disk IOPS/throughput headroom, separate volumes, and resolving all startup warnings.</p>' }
  ],
  quiz: [
    { q: 'Recommended filesystem for WiredTiger on Linux?', options: ['ext3', 'XFS', 'NFS', 'tmpfs'], answer: 1 },
    { q: 'Recommended vm.swappiness?', options: ['0 with no swap', '1 with swap configured', '60', '100'], answer: 1 }
  ]
},
{
  id: 'ha-dr-multiregion', module: 'ha-dr', title: 'HA, DR and multi-region topologies', minutes: 30,
  summary: 'Design for data-centre and region failures: member placement, majority math, disaster recovery runbooks, forced reconfiguration and RPO/RTO trade-offs.',
  objectives: ['Place members across zones and regions so a majority survives', 'Distinguish HA (automatic) from DR (planned, possibly manual)', 'Write a region-loss runbook including forced reconfiguration', 'Combine replication, backups and cluster-to-cluster sync for DR'],
  sections: {
    concept: `<p><b>The majority rule drives everything.</b> A replica set can elect a primary only where a majority of voting members can talk to each other.</p>
<table><tr><th>Topology</th><th>Survives</th><th>Notes</th></tr>
<tr><td>3 members, 3 zones (1-1-1)</td><td>any one zone</td><td>Standard single-region HA</td></tr>
<tr><td>5 members, 3 regions (2-2-1)</td><td>any one region</td><td>Third region can be a small tie-breaker member</td></tr>
<tr><td>2 regions (2-1 or 3-2)</td><td>only loss of the minority side automatically</td><td>Losing the majority side needs manual forced reconfig (possible data loss)</td></tr>
<tr><td>Separate DR cluster (mongosync / backups)</td><td>full region or cluster loss, logical corruption depending on lag</td><td>Manual failover, RPO = sync lag</td></tr></table>
<p><b>HA</b> is automatic and handles member or zone failures with RPO 0 (majority writes) and RTO ~ seconds. <b>DR</b> handles region loss, corruption and human error with defined RPO/RTO and a runbook that people have practised.</p>`,
    why: `<p>Architectures that look redundant can still fail badly: two data centres with 2+2 members and an arbiter in one of them; a region outage leaving the minority side read-only for hours because nobody knew how to force a reconfig. Interviewers for senior roles love this topic because it reveals whether you understand quorum.</p>`,
    useCase: `<p>A payments platform runs 5 members: 2 in Mumbai, 2 in Hyderabad, 1 in Chennai (priority 0, small instance). Writes use <code>w: "majority"</code>, which needs 3 acknowledgements, so at least one is cross-region; latency budget accounts for it. Losing Mumbai entirely leaves 3 of 5 votes: Hyderabad elects a primary automatically. Nightly PBM backups and continuous PITR go to object storage in a fourth region.</p>`,
    internals: `<p>Forced reconfiguration (<code>rs.reconfig(cfg, { force: true })</code> on a surviving member) lets a minority become a replica set again. It can lose writes that only the unreachable majority had, and if the old majority comes back without being reconfigured you risk split brain, so the runbook must fence the old side first. Chained replication, network latency and write concern choices determine actual RPO for cross-region members.</p>
<div data-diagram="replica-set"></div>`
  },
  examples: [
    { title: 'Region-loss runbook (majority lost)', runnable: false, code: `# 0. Declare incident; confirm the majority region is really down (not a monitoring blip).
# 1. Fence the failed side: block network / stop instances so it cannot come back as primary.
# 2. On a surviving member:
cfg = rs.conf()
cfg.members = cfg.members.filter(m => ["hyd-1:27017", "hyd-2:27017", "chn-1:27017"].includes(m.host))
rs.reconfig(cfg, { force: true })
# 3. Verify a primary is elected; check rs.status() optimes to understand data loss window.
# 4. Point applications (DNS / service discovery / connection string) at the new set.
# 5. When the failed region returns: wipe and resync its members, then re-add with rs.add().
# 6. Post-incident: reconcile lost writes from rollback files / upstream sources.` },
    { title: 'Tag-aware reads and writes', runnable: false, code: `cfg = rs.conf()
cfg.members[0].tags = { region: "mumbai", zone: "a" }
cfg.members[1].tags = { region: "mumbai", zone: "b" }
cfg.members[2].tags = { region: "hyderabad", zone: "a" }
cfg.settings.getLastErrorModes = { multiRegion: { region: 2 } }   // custom write concern: 2 distinct regions
rs.reconfig(cfg)
db.payments.insertOne(doc, { writeConcern: { w: "multiRegion" } })
// local reads
db.orders.find(q).readPref("nearest", [{ region: "hyderabad" }])` }
  ],
  mistakes: [
    'Two-region designs that assume automatic failover in both directions.',
    'Arbiters as the tie-breaker in a separate region while using majority write concern (PSA problems).',
    'DR plans that were never executed; the first run during a real outage takes hours.',
    'Forgetting that application servers, DNS, secrets and monitoring must also fail over.',
    'Counting replication as DR against logical corruption; it replicates the corruption.'
  ],
  interview: [
    { q: 'Design a MongoDB deployment that survives the loss of a full region.', a: '<p>At least 3 regions with a 2-2-1 (5 members) or 1-1-1 (3 members) voting distribution so any single region loss leaves a majority. Majority write concern, retryable writes, drivers configured with all members. Cross-region latency adds to majority write latency, so place the two larger groups close together. Add tagged read preferences for local reads, PITR backups in another region, and a practised runbook for application and DNS failover.</p>' },
    { q: 'What happens with 3 members in DC1 and 2 in DC2 if DC1 fails?', a: '<p>DC2 holds 2 of 5 votes, not a majority, so no primary is elected; the set is read-only. Restoring writes needs a forced reconfiguration to the DC2 members, accepting that writes acknowledged only by DC1 members may be lost, and fencing DC1 so it cannot return as a second primary.</p>' }
  ],
  quiz: [
    { q: 'With 5 voting members spread 2-2-1 across three regions, how many regions can fail while keeping automatic failover?', options: ['0', '1', '2', '3'], answer: 1 },
    { q: 'What does rs.reconfig(cfg, { force: true }) risk?', options: ['Nothing', 'Losing writes only the unreachable members had, and split brain if not fenced', 'Dropping indexes', 'Disabling auth'], answer: 1 }
  ]
},
{
  id: 'mongodb-kubernetes', module: 'kubernetes', title: 'MongoDB on Kubernetes with operators', minutes: 28,
  summary: 'Run replica sets and sharded clusters on Kubernetes: operators, StatefulSets, storage, scheduling, networking, backups and day-2 operations.',
  objectives: ['Explain what an operator automates', 'Design storage and scheduling for stateful databases', 'Configure resources, cache size and disruption budgets', 'Handle backups, upgrades and external access'],
  sections: {
    concept: `<div data-diagram="k8s-operator"></div>
<p>An <b>operator</b> watches a custom resource (for example a <code>PerconaServerMongoDB</code> or <code>MongoDBCommunity</code> object) and reconciles StatefulSets, Services, Secrets and config to match it: creating replica sets, adding members, rotating certificates, performing rolling upgrades and scheduling backups.</p>
<ul><li><b>Storage</b>: one PVC per member from a StorageClass with <code>volumeBindingMode: WaitForFirstConsumer</code> (so the volume is created in the pod's zone) and <code>allowVolumeExpansion: true</code>. Use local NVMe only if you accept member rebuilds on node loss.</li>
<li><b>Scheduling</b>: pod anti-affinity or topology spread constraints across nodes and zones; PodDisruptionBudget allowing at most one member down.</li>
<li><b>Resources</b>: guaranteed QoS (requests = limits for memory); set <code>cacheSizeGB</code> explicitly to about half of the memory limit.</li>
<li><b>Networking</b>: clients inside the cluster use the headless service; external clients need per-member endpoints (split horizon / LoadBalancer per pod) because drivers connect to each member by name.</li>
<li><b>Backups</b>: operator-integrated PBM or Ops Manager to object storage, plus PITR.</li></ul>`,
    why: `<p>Many organisations standardise on Kubernetes for everything, including databases. Operators make that reasonable, but stateful workloads punish naive settings: a node drain that evicts two members at once, a volume in the wrong zone, or a memory limit that OOM-kills mongod because the cache was sized from host RAM.</p>`,
    useCase: `<p>A platform team runs 30 Percona Server for MongoDB replica sets via the Percona Operator. Each has 3 members spread across zones, PDB maxUnavailable 1, 16 Gi memory limits with <code>cacheSizeGB: 7</code>, gp3 volumes with expansion enabled, nightly physical backups plus PITR to S3, and upgrades done by changing the image in the custom resource during maintenance windows.</p>`,
    internals: `<p>StatefulSets give stable network identities (<code>rs0-0.rs0.ns.svc</code>) and stable volumes, which replica set configuration depends on. The operator usually runs a sidecar or init container for configuration and backups; the mongod container is the one to target for <code>kubectl exec</code>. When a node fails, the pod is rescheduled only where its volume can attach; zonal volumes pin members to zones.</p>`
  },
  examples: [
    { title: 'Percona Operator custom resource (excerpt)', runnable: false, code: `apiVersion: psmdb.percona.com/v1
kind: PerconaServerMongoDB
metadata:
  name: orders-db
spec:
  crVersion: 1.20.0
  image: percona/percona-server-mongodb:8.0.4-1
  replsets:
    - name: rs0
      size: 3
      affinity:
        antiAffinityTopologyKey: topology.kubernetes.io/zone
      podDisruptionBudget:
        maxUnavailable: 1
      resources:
        limits:   { cpu: "4", memory: 16Gi }
        requests: { cpu: "4", memory: 16Gi }
      configuration: |
        storage:
          wiredTiger:
            engineConfig:
              cacheSizeGB: 7
      volumeSpec:
        persistentVolumeClaim:
          storageClassName: gp3-wffc
          resources:
            requests: { storage: 500Gi }
  backup:
    enabled: true
    pitr: { enabled: true }
    storages:
      s3-backups:
        type: s3
        s3: { bucket: orders-db-backups, region: ap-south-1, credentialsSecret: backup-s3 }
    tasks:
      - name: nightly
        schedule: "0 2 * * *"
        storageName: s3-backups
        type: physical` },
    { title: 'Day-2 commands', runnable: false, code: `kubectl get psmdb -n db                      # cluster status from the operator
kubectl get pods -n db -o wide               # which node and zone each member is on
kubectl exec -n db orders-db-rs0-0 -c mongod -- mongosh --quiet --eval 'rs.status().members.map(m => [m.name, m.stateStr])'
kubectl patch psmdb orders-db -n db --type merge -p '{"spec":{"image":"percona/percona-server-mongodb:8.0.5-2"}}'
kubectl get psmdb-backup -n db` }
  ],
  mistakes: [
    'Memory limit lower than what the default cache size assumes (OOM kills).',
    'StorageClass with <code>Immediate</code> binding creating volumes in zones where the pod cannot run.',
    'No PodDisruptionBudget: node maintenance evicts two members and the set loses its primary.',
    'Exposing a replica set externally through a single load balancer; drivers need each member addressable.',
    '<code>kubectl exec</code> into the first container of the pod (often a sidecar) instead of the mongod container.'
  ],
  interview: [
    { q: 'What would you check before running MongoDB on Kubernetes in production?', a: '<p>A mature operator, storage class (performance, WaitForFirstConsumer, expansion, snapshot support), anti-affinity across zones, PDBs, guaranteed QoS with explicit cacheSizeGB, monitoring (exporter, FTDC access), backups with PITR tested end to end, upgrade procedure through the CR, external access design if needed, secrets and TLS management, and node maintenance procedures that respect quorum.</p>' }
  ],
  quiz: [
    { q: 'Which StorageClass binding mode avoids volumes in the wrong zone?', options: ['Immediate', 'WaitForFirstConsumer', 'Retain', 'Delete'], answer: 1 },
    { q: 'What should a PDB for a 3-member replica set allow?', options: ['maxUnavailable: 1', 'maxUnavailable: 2', 'minAvailable: 0', 'No PDB'], answer: 0 }
  ]
},
{
  id: 'interview-strategy', module: 'interview-prep', title: 'How to answer MongoDB interview questions', minutes: 20,
  summary: 'A structure for technical answers, what interviewers listen for at each level, and how to use the rest of this site to prepare.',
  objectives: ['Structure answers: definition, mechanism, trade-off, example', 'Know what is expected from developers, DBAs and architects', 'Handle design and incident scenarios out loud', 'Plan a two-week preparation schedule'],
  sections: {
    concept: `<p>A strong technical answer has four parts:</p>
<ol><li><b>Definition</b> in one sentence ("A covered query is answered from the index alone").</li>
<li><b>Mechanism</b>: how it works inside ("all filter and projected fields are in the index, so no FETCH; explain shows PROJECTION_COVERED and docsExamined 0").</li>
<li><b>Trade-off or limit</b> ("multikey indexes cannot cover array fields; _id must be excluded").</li>
<li><b>Experience</b>: a short real example with numbers ("this cut a dashboard query from 400 ms to 6 ms").</li></ol>
<table><tr><th>Role</th><th>Interviewers probe</th></tr>
<tr><td>Developer</td><td>CRUD semantics, arrays, aggregation, indexes and ESR, schema design, transactions, driver usage</td></tr>
<tr><td>DBA / DBRE</td><td>Replica sets, elections, oplog, backup/restore and PITR, WiredTiger cache, monitoring, upgrades, security, incident handling</td></tr>
<tr><td>Architect</td><td>Data modelling at scale, sharding and shard keys, multi-region HA/DR, consistency trade-offs, capacity, migrations, cost</td></tr></table>`,
    why: `<p>Many candidates know the facts but answer in fragments. Interviewers grade structure, depth (do you know why), and judgement (do you know when not to). Incident questions test calm, methodical thinking more than trivia.</p>`,
    useCase: `<p>"Our API is slow after a release." A structured answer: clarify scope and metrics; check cluster health (primary, lag, cache, tickets, disk); look at what changed; find top query shapes in the slow log; explain the worst one; identify a COLLSCAN on a new filter; propose an ESR index; build it safely (rolling or off-peak, check write impact); verify p99; add an alert and a query review step to the release process.</p>`,
    internals: `<p><b>Two-week plan</b>: days 1-3 levels 1-2 lessons and exercises; days 4-6 indexes, explain, aggregation exercises; days 7-9 replica sets, oplog, WiredTiger, backup with the simulators; days 10-11 sharding and shard key labs; day 12 schema design scenarios; day 13 the interview bank (mark what you know, revisit the rest); day 14 the cheat sheet and mock answers out loud.</p>
<p>Use: <a href="#/interview">Interview bank</a>, <a href="#/exercises">Exercises</a>, <a href="#/architecture">Architecture simulators</a>, <a href="#/performance">Performance lab</a>, <a href="#/cheatsheet">Cheat sheet</a>.</p>`
  },
  examples: [
    { title: 'Practise answering with evidence', code: `// "Is this query efficient?" Show, do not guess.
db.orders.find({ customerId: 42, status: "delivered" }).sort({ createdAt: -1 }).limit(5).explain("executionStats").executionStats` }
  ],
  mistakes: [
    'Answering "it depends" without saying on what.',
    'Reciting defaults without explaining the mechanism.',
    'Jumping to sharding for every scale question.',
    'In incident questions, proposing fixes before establishing what is wrong.'
  ],
  interview: [
    { q: 'Tell me about a production MongoDB incident you handled.', a: '<p>Use STAR with numbers: Situation (system, scale, impact), Task (your role), Action (diagnosis steps with evidence: metrics, logs, explain; mitigation; permanent fix), Result (latency/availability numbers, follow-ups such as alerts, runbooks, review process). Mention what you would do differently.</p>' }
  ],
  quiz: [
    { q: 'What should come first when answering an incident question?', options: ['Propose an index', 'Clarify symptoms and establish evidence', 'Suggest sharding', 'Restart the primary'], answer: 1 }
  ]
}
]);
