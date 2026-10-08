// Registers both shards with the cluster through mongos; safe to re-run.
const existing = db.adminCommand({ listShards: 1 }).shards.map(s => s._id);
[['sh1', 'sh1/mm-sh1:27017'], ['sh2', 'sh2/mm-sh2:27017']].forEach(([name, conn]) => {
  if (existing.includes(name)) print(name + ' already added');
  else printjson(sh.addShard(conn));
});
print('Sharded cluster ready: docker exec -it mm-mongos mongosh');
