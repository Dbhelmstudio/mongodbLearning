/* =====================================================================
   labs.js — guided drills for the Docker labs in labs/.
   Commands are static (they run on your machine, not in the browser).
   ===================================================================== */
MM.PAGES.labs = {
  title: 'Labs: real clusters on your laptop',
  intro: 'The browser engine teaches the model; these labs let you break real <code>mongod</code> processes. Two Docker Compose setups live in the <code>labs/</code> folder: a three-member replica set (with optional Percona Backup for MongoDB agents) and a minimal sharded cluster. Every drill lists what to run, what to watch for, and why it matters in production.',
  sections: [
    { id: 'setup', title: 'Before you start', html: `<ul>
<li>Docker Desktop (or Docker Engine with Compose v2) and about 4 GB of free memory.</li>
<li>Files: <a href="labs/replica-set/docker-compose.yml" target="_blank" rel="noopener">labs/replica-set/docker-compose.yml</a> and <a href="labs/sharded/docker-compose.yml" target="_blank" rel="noopener">labs/sharded/docker-compose.yml</a>, with their <code>scripts/</code> folders. Clone or download <a href="https://github.com/Dbhelmstudio/mongodbLearning" target="_blank" rel="noopener">the repository</a> so the scripts sit next to the compose files.</li>
<li>Images default to <code>mongo:8.0</code> and <code>percona/percona-backup-mongodb:2</code>. Set <code>MONGO_IMAGE</code> (for example <code>percona/percona-server-mongodb:8.0</code>) to try another build.</li>
<li>These labs run without authentication and bind ports to 127.0.0.1 only. Never copy that into a real deployment.</li>
</ul>
<pre class="static" data-title="Start and stop the replica set lab">cd labs/replica-set
docker compose up -d
docker logs mm-rs-init            # expect: rs0 ready, primary: mm-rs1:27017
docker exec -it mm-rs1 mongosh    # shell on the first member

docker compose down -v            # when finished: removes containers and data</pre>` },

    { id: 'failover', title: 'Drill 1: kill the primary and time the failover', html: `<p>Run a writer that inserts a tick every 200 ms through a replica-set connection string, then stop the primary and measure the gap.</p>
<pre class="static" data-title="Terminal 1: continuous writer">docker exec -it mm-rs2 mongosh "mongodb://mm-rs1:27017,mm-rs2:27017,mm-rs3:27017/?replicaSet=rs0" --quiet --eval '
let n = 0;
while (true) {
  try { db.getSiblingDB("lab").ticks.insertOne({ n: ++n, at: new Date() }); }
  catch (e) { print(new Date().toISOString(), "write failed:", e.codeName || e.message); }
  sleep(200);
}'</pre>
<pre class="static" data-title="Terminal 2: fail the primary, watch the election">docker stop mm-rs1
docker exec mm-rs2 mongosh --quiet --eval 'rs.status().members.map(m => [m.name, m.stateStr])'
docker start mm-rs1               # it rejoins as SECONDARY, catches up, then takes over (priority 2)</pre>
<pre class="static" data-title="Measure the write gap">docker exec mm-rs2 mongosh "mongodb://mm-rs1:27017,mm-rs2:27017,mm-rs3:27017/?replicaSet=rs0" --quiet --eval '
db.getSiblingDB("lab").ticks.aggregate([
  { $setWindowFields: { sortBy: { n: 1 }, output: { prev: { $shift: { output: "$at", by: -1 } } } } },
  { $project: { _id: 0, n: 1, gapMs: { $subtract: ["$at", "$prev"] } } },
  { $sort: { gapMs: -1 } },
  { $limit: 3 }
]).toArray()'</pre>
<div class="callout info"><b>What to notice</b>The largest gap is roughly the election timeout (10 s by default) plus detection. Retryable writes (on by default) usually hide the failure: the driver retries once against the new primary, so you may see few or no errors. Then look at the logs of <code>mm-rs1</code> after it restarts for the priority takeover.</div>` },

    { id: 'rollback', title: 'Drill 2: lose an acknowledged w:1 write to rollback', html: `<p>Isolate the primary from the network, write to it with <code>w: 1</code> before it notices it lost the majority, then heal the partition.</p>
<pre class="static" data-title="Partition the primary and write to it quickly">docker network disconnect mmlab mm-rs1
docker exec mm-rs1 mongosh --quiet --eval 'db.getSiblingDB("lab").orphans.insertOne({ note: "acknowledged with w:1" }, { writeConcern: { w: 1 } })'
docker exec mm-rs1 mongosh --quiet --eval 'db.getSiblingDB("lab").orphans.insertOne({ note: "majority" }, { writeConcern: { w: "majority", wtimeout: 3000 } })'</pre>
<p>The first write is acknowledged; the majority write times out. Wait about 15 seconds for mm-rs2 or mm-rs3 to win an election, write something on the new primary, then reconnect.</p>
<pre class="static" data-title="Heal and inspect the rollback">docker exec mm-rs2 mongosh --quiet --eval 'db.hello().primary'
docker network connect mmlab mm-rs1
sleep 20
docker exec mm-rs1 sh -c 'ls -R /data/db/rollback'
docker logs mm-rs1 2>&1 | grep -i rollback | tail -5
docker exec mm-rs2 mongosh --quiet --eval 'db.getSiblingDB("lab").orphans.countDocuments()'</pre>
<div class="callout warn"><b>Why it matters</b>The application was told the w:1 write succeeded, yet it is gone from the cluster; it survives only as a BSON file under <code>rollback/</code>. Use <code>w: "majority"</code> for anything you cannot afford to lose.</div>` },

    { id: 'majority', title: 'Drill 3: lose the majority, then lag a secondary', html: `<pre class="static" data-title="Two members down: the primary steps down">docker stop mm-rs2 mm-rs3
sleep 12
docker exec mm-rs1 mongosh --quiet --eval 'db.hello().isWritablePrimary'    # false: no writes anywhere
docker start mm-rs2 mm-rs3</pre>
<pre class="static" data-title="Freeze one secondary: w:3 blocks, majority does not">docker pause mm-rs3
docker exec mm-rs1 mongosh --quiet --eval 'db.getSiblingDB("lab").t.insertOne({ x: 1 }, { writeConcern: { w: 3, wtimeout: 3000 } })'
docker exec mm-rs1 mongosh --quiet --eval 'db.getSiblingDB("lab").t.insertOne({ x: 2 }, { writeConcern: { w: "majority", wtimeout: 3000 } })'
docker exec mm-rs1 mongosh --quiet --eval 'rs.printSecondaryReplicationInfo()'
docker unpause mm-rs3</pre>
<p>A primary needs a majority of voting members to stay primary. <code>w: 3</code> on a three-member set turns any single slow member into a write outage, which is why <code>majority</code> is the durable default.</p>` },

    { id: 'oplog', title: 'Drill 4: oplog window and resizing', html: `<pre class="static" data-title="Measure the window, generate churn, resize">docker exec -it mm-rs1 mongosh
rs.printReplicationInfo()
const pad = "x".repeat(1000);
for (let b = 0; b &lt; 100; b++) db.getSiblingDB("lab").churn.insertMany(Array.from({ length: 1000 }, () => ({ pad })));
rs.printReplicationInfo()
db.adminCommand({ replSetResizeOplog: 1, size: 2048, minRetentionHours: 24 })</pre>
<p><code>replSetResizeOplog</code> applies only to the member you run it on: repeat it on every member. The window you need is your slowest recovery path: the longest maintenance a secondary may be down for, plus initial sync and backup oplog slicing.</p>` },

    { id: 'pbm', title: 'Drill 5: point-in-time restore with Percona Backup for MongoDB', html: `<p>Start the replica set with the PBM agents (one per member, sharing a filesystem backup store), take a base backup, enable PITR, make legitimate changes, run a destructive delete, and restore to just before it.</p>
<pre class="static" data-title="Configure PBM and take a base backup">docker compose --profile pbm up -d
docker exec mm-pbm1 pbm config --file /scripts/pbm-config.yaml
docker exec mm-pbm1 pbm status
docker exec mm-rs1 mongosh --quiet --eval 'const c = db.getSiblingDB("shop").coupons; c.drop(); for (let i = 1; i &lt;= 40; i++) c.insertOne({ _id: i, pct: 5 + (i % 4) * 5, uses: 0 })'
docker exec mm-pbm1 pbm backup
docker exec mm-pbm1 pbm list               # repeat until the backup is listed as complete
docker exec mm-pbm1 pbm config --set pitr.enabled=true</pre>
<pre class="static" data-title="Legitimate change, note the time, then the incident">docker exec mm-rs1 mongosh --quiet --eval 'db.getSiblingDB("shop").coupons.updateMany({ pct: 20 }, { $inc: { uses: 3 } })'
sleep 5; date -u +%Y-%m-%dT%H:%M:%S        # restore target: after the update, before the delete
sleep 5
docker exec mm-rs1 mongosh --quiet --eval 'db.getSiblingDB("shop").coupons.deleteMany({})'</pre>
<pre class="static" data-title="Restore to the target time">sleep 90; docker exec mm-pbm1 pbm list     # the PITR range must cover the target time
docker exec mm-pbm1 pbm config --set pitr.enabled=false
docker exec mm-pbm1 pbm restore --time="2026-01-01T12:00:00"    # use your noted time
docker exec mm-pbm1 pbm list --restore
docker exec mm-rs1 mongosh --quiet --eval 'db.getSiblingDB("shop").coupons.countDocuments({ uses: 3 })'    # 10</pre>
<div class="callout tip"><b>Production notes</b>PITR must be disabled while a restore runs. After any restore take a fresh full backup, because the oplog chain starts again. Real deployments use object storage (S3, GCS, Azure, MinIO) rather than a shared filesystem, and an authenticated PBM user with the <code>pbmAnyAction</code> role (see the Percona Backup lesson). The in-browser scenario <a href="#/scenarios/pitr-deleted-coupons">Someone ran deleteMany on coupons</a> shows what PBM does under the hood.</div>` },

    { id: 'sharded', title: 'Drill 6: shard keys on a real cluster', html: `<pre class="static" data-title="Start the sharded cluster">cd labs/sharded
docker compose up -d
docker logs mm-add-shards         # expect: Sharded cluster ready
docker exec -it mm-mongos mongosh
sh.status()</pre>
<pre class="static" data-title="Monotonic range key versus hashed key">use lab
sh.shardCollection("lab.events_ranged", { createdAt: 1 })
sh.shardCollection("lab.events_hashed", { createdAt: "hashed" })
const batch = n => Array.from({ length: n }, (_, i) => ({ createdAt: new Date(Date.now() + i), tenant: "t" + (i % 20), payload: "x".repeat(200) }));
for (let b = 0; b &lt; 50; b++) { db.events_ranged.insertMany(batch(2000)); db.events_hashed.insertMany(batch(2000)); }
db.events_ranged.getShardDistribution()
db.events_hashed.getShardDistribution()</pre>
<p>Every insert into <code>events_ranged</code> lands in the chunk that owns the top of the key range, so one shard takes all writes. The hashed key spreads them from the first insert.</p>
<pre class="static" data-title="Targeted versus scatter-gather, analyse, reshard">db.events_hashed.find({ createdAt: { $gte: new Date(Date.now() - 60000) } }).explain().queryPlanner.winningPlan.stage
db.adminCommand({ analyzeShardKey: "lab.events_ranged", key: { createdAt: 1 } }).keyCharacteristics
db.adminCommand({ reshardCollection: "lab.events_ranged", key: { tenant: 1, createdAt: 1 } })
db.events_ranged.getShardDistribution()</pre>
<div class="callout info"><b>Version notes</b><code>analyzeShardKey</code> needs 7.0 or later; <code>reshardCollection</code> needs 5.0 or later; <code>moveCollection</code> (move an unsharded collection between shards) needs 8.0. A range query on a hashed key is a scatter-gather (<code>SHARD_MERGE</code> across every shard).</div>` }
  ]
};
