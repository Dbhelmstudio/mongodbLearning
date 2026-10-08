// Initiates rs0 once; safe to re-run. mm-rs1 has priority 2 so it takes the primary role back after a failover drill.
const status = db.adminCommand({ replSetGetStatus: 1 });
if (status.ok === 1) {
  print('rs0 already initiated');
} else {
  printjson(rs.initiate({
    _id: 'rs0',
    members: [
      { _id: 0, host: 'mm-rs1:27017', priority: 2 },
      { _id: 1, host: 'mm-rs2:27017', priority: 1 },
      { _id: 2, host: 'mm-rs3:27017', priority: 1 }
    ]
  }));
}
for (let i = 0; i < 60 && !db.hello().isWritablePrimary; i++) sleep(1000);
const hello = db.hello();
if (!hello.isWritablePrimary) throw new Error('rs0 has no primary after 60 s');
print('rs0 ready, primary: ' + hello.primary);
