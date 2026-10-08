// Initiates the config server and both shard replica sets; safe to re-run.
function waitFor(check, what) {
  for (let i = 0; i < 90; i++) {
    try { if (check()) return; } catch (e) { /* node still starting */ }
    sleep(1000);
  }
  throw new Error('timed out waiting for ' + what);
}

function initReplSet(host, id, configsvr) {
  const admin = new Mongo(host).getDB('admin');
  if (admin.runCommand({ replSetGetStatus: 1 }).ok !== 1) {
    const cfg = { _id: id, members: [{ _id: 0, host: host }] };
    if (configsvr) cfg.configsvr = true;
    printjson(admin.runCommand({ replSetInitiate: cfg }));
  }
  waitFor(() => admin.runCommand({ hello: 1 }).isWritablePrimary, id + ' primary');
  print(id + ' ready on ' + host);
}

initReplSet('mm-cfg1:27017', 'cfg', true);
initReplSet('mm-sh1:27017', 'sh1', false);
initReplSet('mm-sh2:27017', 'sh2', false);
