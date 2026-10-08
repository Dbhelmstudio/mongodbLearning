/* =====================================================================
   shell.js — mongosh-like runner on top of engine.js.

   User code is parsed with acorn; every top-level expression statement is
   wrapped so its value is printed, like typing lines into mongosh.
   `use`, `show` and `it` are rewritten into helper calls first.
   ===================================================================== */
(function () {
  'use strict';
  var MM = window.MM, U = MM.util;
  var AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

  if (!String.prototype.getTimestamp) {
    Object.defineProperty(String.prototype, 'getTimestamp', {
      configurable: true, writable: true, enumerable: false,
      value: function () {
        if (!U.isOid(String(this))) throw new TypeError('getTimestamp() is only available on ObjectId values');
        return new Date(parseInt(String(this).slice(0, 8), 16) * 1000);
      }
    });
    Object.defineProperty(String.prototype, 'toHexString', {
      configurable: true, writable: true, enumerable: false,
      value: function () { return String(this); }
    });
  }

  function Timestamp(t, i) {
    if (!(this instanceof Timestamp)) return new Timestamp(t, i);
    if (U.isObj(t)) { i = t.i; t = t.t; }
    this.t = t || Math.floor(Date.now() / 1000); this.i = i || 1;
  }
  Timestamp.prototype.__mmDisplay = function () { return 'Timestamp({ t: ' + this.t + ', i: ' + this.i + ' })'; };
  Timestamp.prototype.getTime = function () { return this.t; };
  /* mingo orders unknown object types by toString(), so it must sort the way BSON timestamps do: by t, then i. */
  Timestamp.prototype.toString = function () { return 'Timestamp(' + String(this.t).padStart(12, '0') + ',' + String(this.i).padStart(10, '0') + ')'; };
  Timestamp.prototype.valueOf = function () { return this.t * 4294967296 + this.i; };
  MM.Timestamp = Timestamp;

  function ObjectId(h) {
    if (h === undefined || h === null) return U.newOid();
    if (typeof h === 'number') return U.newOid(h * 1000).slice(0, 8) + U.newOid().slice(8);
    h = String(h).toLowerCase();
    if (!U.isOid(h)) throw new TypeError('Argument passed in must be a string of 12 bytes or a string of 24 hex characters');
    return h;
  }
  ObjectId.isValid = function (h) { return U.isOid(String(h).toLowerCase()); };
  ObjectId.createFromTime = function (sec) { return U.hex(Math.floor(sec), 8) + '0000000000000000'; };
  ObjectId.createFromHexString = ObjectId;
  function ISODate(s) {
    var d = s === undefined ? new Date() : new Date(s);
    if (isNaN(d.getTime())) throw new Error('invalid ISO date: ' + s);
    return d;
  }
  function num(x) { var n = Number(x); if (isNaN(n)) throw new TypeError('not a number: ' + x); return n; }
  function NumberInt(x) { return Math.trunc(num(x === undefined ? 0 : x)); }
  function NumberLong(x) { return Math.trunc(num(x === undefined ? 0 : x)); }
  function NumberDecimal(x) { return num(x === undefined ? 0 : x); }
  var Decimal128 = { fromString: NumberDecimal };
  var Long = { fromNumber: NumberLong, fromString: NumberLong };
  function UUID() {
    var s = '';
    for (var i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s.slice(0, 8) + '-' + s.slice(8, 12) + '-4' + s.slice(13, 16) + '-a' + s.slice(17, 20) + '-' + s.slice(20, 32);
  }

  /* ------------------------------------------------------------------
     Collection proxy: db.system.profile, db.orders.archive, ...
     ------------------------------------------------------------------ */
  function wrapColl(c) {
    return new Proxy(c, {
      get: function (t, p) {
        if (typeof p === 'symbol' || p in t) return t[p];
        if (p === 'then' || p === 'toJSON' || p === 'inspect' || p.charAt(0) === '_') return undefined;
        return wrapColl(new MM.Collection(t._engine, t._dbName, t._name + '.' + p, t._session));
      }
    });
  }

  function fmtSize(bytes) {
    var u = ['B', 'KiB', 'MiB', 'GiB'], i = 0;
    while (bytes >= 1024 && i < u.length - 1) { bytes /= 1024; i++; }
    return bytes.toFixed(2) + ' ' + u[i];
  }

  /* ------------------------------------------------------------------
     db object
     ------------------------------------------------------------------ */
  MM.makeDb = function (engine, fixedName, session) {
    function name() { return fixedName || engine.currentDb; }
    function coll(n) { return wrapColl(new MM.Collection(engine, name(), String(n), session)); }
    function infos(filter) {
      var d = engine.dbs[name()] || {};
      var list = Object.keys(d).sort().map(function (n) {
        var s = d[n], type = s.options.viewOn ? 'view' : (s.options.timeseries ? 'timeseries' : 'collection');
        var o = { name: n, type: type, options: U.clone(s.options), info: { readOnly: type === 'view' } };
        if (type === 'collection') o.idIndex = { v: 2, key: { _id: 1 }, name: '_id_' };
        return o;
      });
      if (filter && Object.keys(filter).length) { var q = new window.mingo.Query(filter); list = list.filter(function (x) { return q.test(x); }); }
      return list;
    }
    function usersStore() { return engine.getStore('admin', 'system.users', true); }
    function rolesStore() { return engine.getStore('admin', 'system.roles', true); }
    function normRoles(roles) { return (roles || []).map(function (r) { return typeof r === 'string' ? { role: r, db: name() } : { role: r.role, db: r.db || name() }; }); }
    function userDoc(u) { return { _id: u._id, userId: u.userId, user: u.user, db: u.db, roles: U.clone(u.roles), mechanisms: u.mechanisms }; }

    var api = {
      getName: function () { return name(); },
      toString: function () { return name(); },
      __mmDisplay: function () { return name(); },
      getSiblingDB: function (n) { return MM.makeDb(engine, n, session); },
      getCollection: function (n) { return coll(n); },
      getCollectionNames: function () { return Object.keys(engine.dbs[name()] || {}).sort(); },
      getCollectionInfos: function (filter) { return infos(filter); },
      createCollection: function (n, opts) {
        opts = opts || {};
        if (engine.getStore(name(), n, false)) throw U.serverError('Collection ' + name() + '.' + n + ' already exists.', 48, 'NamespaceExists');
        if (opts.viewOn && !Array.isArray(opts.pipeline || [])) throw U.serverError('pipeline must be an array', 2, 'BadValue');
        if (opts.timeseries && !opts.timeseries.timeField) throw U.serverError("'timeseries' must contain 'timeField'", 40414, 'Location40414');
        var s = engine.getStore(name(), n, true);
        s.options = U.clone(opts);
        if (opts.viewOn) s.indexes = [];
        if (opts.timeseries) {
          s.options.timeseries.granularity = s.options.timeseries.granularity || 'seconds';
          s.options.timeseries.bucketMaxSpanSeconds = { seconds: 3600, minutes: 86400, hours: 2592000 }[s.options.timeseries.granularity] || 3600;
        }
        if (opts.clusteredIndex) s.options.clusteredIndex = { key: { _id: 1 }, unique: true };
        engine.touch(s);
        return { ok: 1 };
      },
      createView: function (n, source, pipeline, opts) { return api.createCollection(n, Object.assign({ viewOn: source, pipeline: pipeline || [] }, opts || {})); },
      dropDatabase: function () { var n = name(); delete engine.dbs[n]; engine._dirty = true; return { ok: 1, dropped: n }; },
      stats: function (scale) {
        scale = scale || 1;
        var d = engine.dbs[name()] || {}, out = { db: name(), collections: 0, views: 0, objects: 0, avgObjSize: 0, dataSize: 0, storageSize: 0, indexes: 0, indexSize: 0, totalSize: 0, scaleFactor: scale, fsUsedSize: 48318382080, fsTotalSize: 250790436864, ok: 1 };
        Object.keys(d).forEach(function (n) {
          if (d[n].options.viewOn) { out.views++; return; }
          var st = coll(n).stats();
          out.collections++; out.objects += st.count; out.dataSize += st.size; out.storageSize += st.storageSize || 0;
          out.indexes += st.nindexes || 0; out.indexSize += st.totalIndexSize || 0;
        });
        out.avgObjSize = out.objects ? Math.round(out.dataSize / out.objects) : 0;
        out.totalSize = out.storageSize + out.indexSize;
        ['dataSize', 'storageSize', 'indexSize', 'totalSize'].forEach(function (k) { out[k] = Math.round(out[k] / scale); });
        return out;
      },
      version: function () { return '8.0.4'; },
      hostInfo: function () { return { system: { hostname: 'mastery-sim', cpuArch: 'x86_64', numCores: 8, memSizeMB: 32768, numaEnabled: false }, os: { type: 'Linux', name: 'Ubuntu', version: '24.04' }, extra: { pageSize: 4096, kernelVersion: '6.8.0' }, ok: 1 }; },
      serverStatus: function () {
        var st = api.stats(), up = Math.round((Date.now() - engine.startedAt.getTime()) / 1000);
        return {
          host: 'mastery-sim:27017', version: '8.0.4', process: 'mongod', pid: 4242, uptime: up, uptimeMillis: up * 1000, localTime: new Date(),
          connections: { current: 7, available: 838853, totalCreated: 42, active: 2 },
          opcounters: U.clone(engine.opcounters),
          globalLock: { currentQueue: { total: 0, readers: 0, writers: 0 }, activeClients: { total: 2, readers: 0, writers: 0 } },
          mem: { bits: 64, resident: 412, virtual: 2900, supported: true },
          wiredTiger: {
            cache: { 'maximum bytes configured': 16106127360, 'bytes currently in the cache': Math.round(st.dataSize * 1.15), 'tracked dirty bytes in the cache': 0, 'pages read into cache': 1840, 'pages written from cache': 912, 'pages evicted by application threads': 0 },
            concurrentTransactions: { write: { out: 0, available: 128, totalTickets: 128 }, read: { out: 0, available: 128, totalTickets: 128 } }
          },
          storageEngine: { name: 'wiredTiger', supportsCommittedReads: true, persistent: true },
          ok: 1,
          _simulator: 'opcounters are real for this browser session; other sections are representative sample values.'
        };
      },
      hello: function () { return { isWritablePrimary: true, topologyVersion: { processId: 'sim', counter: 0 }, maxBsonObjectSize: 16777216, maxMessageSizeBytes: 48000000, maxWriteBatchSize: 100000, localTime: new Date(), logicalSessionTimeoutMinutes: 30, connectionId: 7, minWireVersion: 0, maxWireVersion: 25, readOnly: false, ok: 1, _simulator: 'Standalone node. Replica set behaviour is taught with the Replica Set simulator.' }; },
      isMaster: function () { return api.hello(); },
      currentOp: function () {
        return { inprog: [
          { type: 'op', host: 'mastery-sim:27017', desc: 'conn7', connectionId: 7, client: '127.0.0.1:52144', appName: 'mongosh', active: true, currentOpTime: new Date().toISOString(), opid: 9001, secs_running: 0, microsecs_running: 412, op: 'command', ns: 'admin.$cmd.aggregate', command: { aggregate: 1, pipeline: [{ $currentOp: {} }] }, waitingForLock: false },
          { type: 'op', desc: 'conn12', connectionId: 12, client: '10.0.4.17:40122', appName: 'orders-api', active: true, opid: 9002, secs_running: 14, op: 'query', ns: name() + '.orders', command: { find: 'orders', filter: { 'shipping.city': 'Pune' } }, planSummary: 'COLLSCAN', numYields: 212, waitingForLock: false, _simulator: 'sample long-running query' }
        ], ok: 1 };
      },
      killOp: function (id) { return { info: 'attempting to kill op ' + id + ' (simulated)', ok: 1 }; },
      setProfilingLevel: function (level, opts) {
        var prev = engine.profiling[name()] || { level: 0, slowms: 100 };
        var slowms = typeof opts === 'number' ? opts : (opts && opts.slowms !== undefined ? opts.slowms : prev.slowms);
        engine.profiling[name()] = { level: level, slowms: slowms };
        return { was: prev.level, slowms: prev.slowms, sampleRate: 1, ok: 1 };
      },
      getProfilingStatus: function () { var p = engine.profiling[name()] || { level: 0, slowms: 100 }; return { was: p.level, slowms: p.slowms, sampleRate: 1 }; },
      getProfilingLevel: function () { return (engine.profiling[name()] || { level: 0 }).level; },
      getMongo: function () {
        return {
          startSession: function (opts) { return new MM.Session(engine, opts); },
          getDB: function (n) { return MM.makeDb(engine, n, null); },
          getDBNames: function () { return engine.dbNames(); },
          setReadPref: function () {}, getReadPrefMode: function () { return 'primary'; },
          __mmDisplay: function () { return 'mongodb://127.0.0.1:27017/?directConnection=true (in-browser simulator)'; }
        };
      },
      aggregate: function (pipeline) {
        if (!Array.isArray(pipeline) || !pipeline.length) throw U.serverError('db.aggregate() needs a pipeline array', 2, 'BadValue');
        var first = Object.keys(pipeline[0])[0], docs, rest = pipeline.slice(1);
        if (first === '$documents') docs = U.clone(pipeline[0].$documents);
        else if (first === '$currentOp') docs = api.currentOp().inprog;
        else if (first === '$listLocalSessions') docs = engine.sessions.map(function (s) { return { _id: s.id }; });
        else throw U.serverError('db.aggregate() must start with $documents, $currentOp or $listLocalSessions', 73, 'InvalidNamespace');
        var c = new MM.Collection(engine, name(), '$cmd.aggregate', session);
        return new MM.ArrayCursor(window.mingo.aggregate(docs, rest, { collectionResolver: c._resolver() }));
      },
      watch: function (pipeline, opts) { return new MM.ChangeStream(engine, { db: name() }, pipeline, opts); },
      createUser: function (spec) {
        if (!spec || !spec.user) throw U.serverError('createUser requires a user name', 2, 'BadValue');
        var id = name() + '.' + spec.user, st = usersStore();
        if (st.docs.some(function (d) { return d._id === id; })) throw U.serverError('User "' + spec.user + '@' + name() + '" already exists', 51003, 'Location51003');
        engine._insert(st, { _id: id, userId: UUID(), user: spec.user, db: name(), credentials: { 'SCRAM-SHA-256': { iterationCount: 15000, salt: btoa(UUID()).slice(0, 24), storedKey: '(derived, never the password)', serverKey: '(derived)' } }, roles: normRoles(spec.roles), mechanisms: ['SCRAM-SHA-1', 'SCRAM-SHA-256'] });
        return { ok: 1 };
      },
      getUser: function (u) { var d = usersStore().docs.filter(function (x) { return x._id === name() + '.' + u; })[0]; return d ? userDoc(d) : null; },
      getUsers: function () { return { users: usersStore().docs.filter(function (x) { return x.db === name(); }).map(userDoc), ok: 1 }; },
      dropUser: function (u) { var st = usersStore(), d = st.docs.filter(function (x) { return x._id === name() + '.' + u; })[0]; if (!d) throw U.serverError('User ' + u + '@' + name() + ' not found', 11, 'UserNotFound'); engine._remove(st, d); return true; },
      grantRolesToUser: function (u, roles) { return api._mutUser(u, function (d) { normRoles(roles).forEach(function (r) { if (!d.roles.some(function (x) { return x.role === r.role && x.db === r.db; })) d.roles.push(r); }); }); },
      revokeRolesFromUser: function (u, roles) { return api._mutUser(u, function (d) { var rm = normRoles(roles); d.roles = d.roles.filter(function (x) { return !rm.some(function (r) { return r.role === x.role && r.db === x.db; }); }); }); },
      _mutUser: function (u, fn) {
        var st = usersStore(), d = st.docs.filter(function (x) { return x._id === name() + '.' + u; })[0];
        if (!d) throw U.serverError('Could not find user "' + u + '" for db "' + name() + '"', 11, 'UserNotFound');
        var next = U.clone(d); fn(next); engine._replaceDoc(st, d, next, 'replace');
      },
      createRole: function (spec) {
        var st = rolesStore(), id = name() + '.' + spec.role;
        if (st.docs.some(function (d) { return d._id === id; })) throw U.serverError('Role "' + spec.role + '@' + name() + '" already exists', 51002, 'Location51002');
        engine._insert(st, { _id: id, role: spec.role, db: name(), privileges: U.clone(spec.privileges || []), roles: normRoles(spec.roles) });
        return { ok: 1 };
      },
      dropRole: function (r) { var st = rolesStore(), d = st.docs.filter(function (x) { return x._id === name() + '.' + r; })[0]; if (!d) throw U.serverError('Role ' + r + '@' + name() + ' not found', 31, 'RoleNotFound'); engine._remove(st, d); return true; },
      getRoles: function () { return rolesStore().docs.filter(function (r) { return r.db === name(); }).map(U.clone); },
      fsyncLock: function () { return { info: 'now locked against writes (simulated; remember db.fsyncUnlock())', lockCount: 1, ok: 1 }; },
      fsyncUnlock: function () { return { info: 'fsyncUnlock completed (simulated)', lockCount: 0, ok: 1 }; },
      getReplicationInfo: function () { return rs.printReplicationInfo(); },
      printCollectionStats: function () { var d = engine.dbs[name()] || {}; return Object.keys(d).map(function (n) { return coll(n).stats(); }); },
      help: function () { return HELP; },
      runCommand: function (cmd) { return runCommand(api, coll, name, engine, cmd); },
      adminCommand: function (cmd) { return runCommand(MM.makeDb(engine, 'admin', session), function (n) { return wrapColl(new MM.Collection(engine, 'admin', n, session)); }, function () { return 'admin'; }, engine, cmd); }
    };
    return new Proxy(api, {
      get: function (t, p) {
        if (typeof p === 'symbol' || p in t) return t[p];
        if (p === 'then' || p === 'toJSON' || p === 'inspect' || p.charAt(0) === '_' || p === 'explainVersion') return undefined;
        return coll(p);
      }
    });
  };

  function runCommand(db, coll, name, engine, cmd) {
    if (typeof cmd === 'string') { var o = {}; o[cmd] = 1; cmd = o; }
    var c = Object.keys(cmd)[0], v = cmd[c];
    switch (c) {
      case 'ping': return { ok: 1 };
      case 'hello': case 'isMaster': case 'ismaster': return db.hello();
      case 'buildInfo': case 'buildinfo': return { version: '8.0.4', gitVersion: 'in-browser-simulator', modules: [], allocator: 'tcmalloc', javascriptEngine: 'mozjs', versionArray: [8, 0, 4, 0], bits: 64, maxBsonObjectSize: 16777216, ok: 1 };
      case 'serverStatus': return db.serverStatus();
      case 'hostInfo': return db.hostInfo();
      case 'dbStats': return db.stats(cmd.scale);
      case 'collStats': return coll(v).stats();
      case 'listCollections': return { cursor: { id: 0, ns: name() + '.$cmd.listCollections', firstBatch: db.getCollectionInfos(cmd.filter) }, ok: 1 };
      case 'listDatabases': return rsListDatabases(engine, db);
      case 'listIndexes': return { cursor: { id: 0, ns: name() + '.' + v, firstBatch: coll(v).getIndexes() }, ok: 1 };
      case 'count': return { n: coll(v).countDocuments(cmd.query || {}, { limit: cmd.limit, skip: cmd.skip }), ok: 1 };
      case 'distinct': return { values: coll(v).distinct(cmd.key, cmd.query), ok: 1 };
      case 'find': {
        var cur = coll(v).find(cmd.filter || {}, cmd.projection);
        if (cmd.sort) cur.sort(cmd.sort); if (cmd.skip) cur.skip(cmd.skip); if (cmd.limit) cur.limit(cmd.limit); if (cmd.hint) cur.hint(cmd.hint);
        return { cursor: { firstBatch: cur.toArray(), id: 0, ns: name() + '.' + v }, ok: 1 };
      }
      case 'aggregate':
        if (cmd.explain) return coll(v).aggregate(cmd.pipeline, { explain: cmd.explain });
        return { cursor: { firstBatch: coll(v).aggregate(cmd.pipeline || []).toArray(), id: 0, ns: name() + '.' + v }, ok: 1 };
      case 'insert': { var r = coll(v).insertMany(cmd.documents || [], { ordered: cmd.ordered !== false }); return { n: Object.keys(r.insertedIds).length, ok: 1 }; }
      case 'update': {
        var n = 0, nm = 0, ups = [];
        (cmd.updates || []).forEach(function (u, i) {
          var res = coll(v)[u.multi ? 'updateMany' : 'updateOne'](u.q, u.u, { upsert: u.upsert, arrayFilters: u.arrayFilters });
          n += res.matchedCount + res.upsertedCount; nm += res.modifiedCount;
          if (res.upsertedCount) ups.push({ index: i, _id: res.insertedId });
        });
        var out = { n: n, nModified: nm, ok: 1 }; if (ups.length) out.upserted = ups; return out;
      }
      case 'delete': { var dn = 0; (cmd.deletes || []).forEach(function (d) { dn += coll(v)[d.limit === 1 ? 'deleteOne' : 'deleteMany'](d.q).deletedCount; }); return { n: dn, ok: 1 }; }
      case 'findAndModify': case 'findandmodify': return { value: coll(v).findAndModify(cmd), ok: 1 };
      case 'createIndexes': {
        var before = coll(v).getIndexes().length;
        (cmd.indexes || []).forEach(function (spec) { var o2 = U.clone(spec); delete o2.key; coll(v).createIndex(spec.key, o2); });
        return { numIndexesBefore: before, numIndexesAfter: coll(v).getIndexes().length, ok: 1 };
      }
      case 'dropIndexes': return coll(v).dropIndexes(cmd.index === '*' ? undefined : cmd.index);
      case 'create': { var opts = U.clone(cmd); delete opts.create; return db.createCollection(v, opts); }
      case 'drop': if (!coll(v).drop()) throw U.serverError('ns not found', 26, 'NamespaceNotFound'); return { ns: name() + '.' + v, ok: 1 };
      case 'collMod': {
        var s = engine.getStore(name(), v, false);
        if (!s) throw U.serverError('ns does not exist: ' + name() + '.' + v, 26, 'NamespaceNotFound');
        ['validator', 'validationLevel', 'validationAction', 'viewOn', 'pipeline', 'expireAfterSeconds', 'changeStreamPreAndPostImages'].forEach(function (k) { if (cmd[k] !== undefined) s.options[k] = U.clone(cmd[k]); });
        var res2 = { ok: 1 };
        if (cmd.index) {
          var idx = s.indexes.filter(function (i) { return cmd.index.name ? i.name === cmd.index.name : U.keyOf(i.key) === U.keyOf(cmd.index.keyPattern); })[0];
          if (!idx) throw U.serverError('cannot find index for collMod', 27, 'IndexNotFound');
          if (cmd.index.expireAfterSeconds !== undefined) { res2.expireAfterSeconds_old = idx.expireAfterSeconds; idx.expireAfterSeconds = cmd.index.expireAfterSeconds; res2.expireAfterSeconds_new = idx.expireAfterSeconds; }
          if (cmd.index.hidden !== undefined) { res2.hidden_old = !!idx.hidden; if (cmd.index.hidden) idx.hidden = true; else delete idx.hidden; res2.hidden_new = !!cmd.index.hidden; }
          if (cmd.index.unique === true) { res2.unique_new = true; idx.unique = true; s.uniq = null; }
        }
        engine.touch(s);
        return res2;
      }
      case 'explain': {
        var inner = v, verb = MM.normalizeVerbosity(cmd.verbosity || 'allPlansExecution'), ic = Object.keys(inner)[0];
        if (ic === 'find') { var c2 = coll(inner.find).find(inner.filter || {}, inner.projection); if (inner.sort) c2.sort(inner.sort); if (inner.limit) c2.limit(inner.limit); if (inner.skip) c2.skip(inner.skip); if (inner.hint) c2.hint(inner.hint); return c2.explain(verb); }
        if (ic === 'aggregate') return coll(inner.aggregate)._explainAggregate(inner.pipeline || [], verb);
        if (ic === 'count') return coll(inner.count).find(inner.query || {}).explain(verb);
        throw U.serverError('Simulator: explain supports find, aggregate and count', 2, 'BadValue');
      }
      case 'validate': return coll(v).validate();
      case 'profile': if (v === -1) return db.getProfilingStatus(); return db.setProfilingLevel(v, { slowms: cmd.slowms });
      case 'currentOp': return db.currentOp();
      case 'killOp': return db.killOp(cmd.op);
      case 'replSetGetStatus': return rs.status();
      case 'replSetGetConfig': return { config: rs.conf(), ok: 1 };
      case 'getCmdLineOpts': return { argv: ['mongod', '--config', '/etc/mongod.conf'], parsed: { config: '/etc/mongod.conf', net: { bindIp: '127.0.0.1', port: 27017 }, storage: { dbPath: '/var/lib/mongodb', wiredTiger: { engineConfig: { cacheSizeGB: 15 } } }, replication: { replSetName: 'rs0', oplogSizeMB: 51200 }, security: { authorization: 'enabled' } }, ok: 1, _simulator: 'sample production config' };
      case 'getParameter':
        if (cmd.featureCompatibilityVersion) { var fcv = engine.getStore('admin', 'system.version', true).docs.filter(function (d) { return d._id === 'featureCompatibilityVersion'; })[0]; return { featureCompatibilityVersion: { version: fcv ? fcv.version : '8.0' }, ok: 1 }; }
        return { ok: 1, _simulator: 'parameters are not modelled except featureCompatibilityVersion' };
      case 'setFeatureCompatibilityVersion': {
        if (['7.0', '8.0'].indexOf(v) < 0) throw U.serverError('Invalid feature compatibility version value; expected 7.0 or 8.0', 2, 'BadValue');
        if (!cmd.confirm) throw U.serverError('Once you have upgraded to ' + v + ', you will not be able to downgrade FCV and binary version without support assistance. Please re-run this command with \'confirm: true\' to acknowledge this and continue with the FCV upgrade.', 7369100, 'Location7369100');
        var st = engine.getStore('admin', 'system.version', true), cur2 = st.docs.filter(function (d) { return d._id === 'featureCompatibilityVersion'; })[0];
        var next = { _id: 'featureCompatibilityVersion', version: v };
        if (cur2) engine._replaceDoc(st, cur2, next, 'replace'); else engine._insert(st, next);
        return { ok: 1 };
      }
      case 'renameCollection': {
        var from = String(v).split('.'), to = String(cmd.to).split('.');
        if (from[0] !== to[0]) throw U.serverError('Simulator: cross-database rename is not modelled', 2, 'BadValue');
        return new MM.Collection(engine, from[0], from.slice(1).join('.'), null).renameCollection(to.slice(1).join('.'), cmd.dropTarget);
      }
      case 'getDefaultRWConcern': return { defaultReadConcern: { level: 'local' }, defaultWriteConcern: { w: 'majority', wtimeout: 0 }, defaultReadConcernSource: 'implicit', defaultWriteConcernSource: 'implicit', ok: 1 };
      case 'setDefaultRWConcern': return { defaultReadConcern: cmd.defaultReadConcern || { level: 'local' }, defaultWriteConcern: cmd.defaultWriteConcern || { w: 'majority', wtimeout: 0 }, ok: 1, _simulator: 'accepted; the single-node simulator does not change behaviour' };
      case 'connectionStatus': return { authInfo: { authenticatedUsers: [], authenticatedUserRoles: [] }, ok: 1, _simulator: 'auth is not enforced in the playground' };
      case 'usersInfo': return db.getUsers();
      case 'createUser': { var spec = U.clone(cmd); spec.user = v; delete spec.createUser; return db.createUser(spec); }
      default: throw U.serverError("no such command: '" + c + "'", 59, 'CommandNotFound');
    }
  }
  function rsListDatabases(engine) {
    var dbs = engine.dbNames().sort().map(function (n) { var st = MM.makeDb(engine, n, null).stats(); return { name: n, sizeOnDisk: Math.max(8192, st.totalSize), empty: st.objects === 0 }; });
    return { databases: dbs, totalSize: dbs.reduce(function (a, d) { return a + d.sizeOnDisk; }, 0), ok: 1 };
  }

  /* ------------------------------------------------------------------
     rs / sh — static, clearly-labelled samples
     ------------------------------------------------------------------ */
  function now(offsetMs) { return new Date(Date.now() - (offsetMs || 0)); }
  var rs = {
    status: function () {
      var t = Math.floor(Date.now() / 1000);
      function member(id, state, lagMs, self) {
        var m = { _id: id, name: 'mongo-' + id + '.db.internal:27017', health: 1, state: state === 'PRIMARY' ? 1 : 2, stateStr: state, uptime: 864000 - id * 60,
          optime: { ts: new Timestamp(t - Math.round(lagMs / 1000), 1), t: 7 }, optimeDate: now(lagMs), lastAppliedWallTime: now(lagMs), lastDurableWallTime: now(lagMs),
          syncSourceHost: state === 'PRIMARY' ? '' : 'mongo-0.db.internal:27017', syncSourceId: state === 'PRIMARY' ? -1 : 0, configVersion: 5, configTerm: 7 };
        if (self) { m.self = true; m.electionTime = new Timestamp(t - 604800, 1); m.electionDate = now(604800000); }
        else { m.lastHeartbeat = now(900); m.lastHeartbeatRecv = now(1100); m.pingMs = 1 + id; }
        return m;
      }
      return {
        set: 'rs0', date: new Date(), myState: 1, term: 7, syncSourceHost: '', heartbeatIntervalMillis: 2000,
        majorityVoteCount: 2, writeMajorityCount: 2, votingMembersCount: 3, writableVotingMembersCount: 3,
        optimes: { lastCommittedOpTime: { ts: new Timestamp(t, 1), t: 7 }, lastCommittedWallTime: now(0), readConcernMajorityWallTime: now(0), appliedOpTime: { ts: new Timestamp(t, 1), t: 7 }, durableOpTime: { ts: new Timestamp(t, 1), t: 7 } },
        electionCandidateMetrics: { lastElectionReason: 'stepUpRequestSkipDryRun', lastElectionDate: now(604800000), electionTerm: 7, numVotesNeeded: 2, priorityAtElection: 2, electionTimeoutMillis: 10000 },
        members: [member(0, 'PRIMARY', 0, true), member(1, 'SECONDARY', 1000), member(2, 'SECONDARY', 2000)],
        ok: 1,
        _simulator: 'Static sample of a healthy 3-member replica set. The playground itself is a single node; use the Replica Set simulator on the Architecture page.'
      };
    },
    conf: function () {
      return { _id: 'rs0', version: 5, term: 7, members: [0, 1, 2].map(function (i) { return { _id: i, host: 'mongo-' + i + '.db.internal:27017', arbiterOnly: false, buildIndexes: true, hidden: false, priority: i === 0 ? 2 : 1, tags: { dc: i < 2 ? 'east' : 'west' }, secondaryDelaySecs: 0, votes: 1 }; }),
        protocolVersion: 1, writeConcernMajorityJournalDefault: true,
        settings: { chainingAllowed: true, heartbeatIntervalMillis: 2000, heartbeatTimeoutSecs: 10, electionTimeoutMillis: 10000, catchUpTimeoutMillis: -1, getLastErrorDefaults: { w: 1, wtimeout: 0 } }, _simulator: 'static sample' };
    },
    printReplicationInfo: function () { return 'actual oplog size\n51200 MB\n---\nconfigured oplog size\n51200 MB\n---\nlog length start to end\n172800 secs (48 hrs)\n---\noplog first event time\n' + now(172800000).toString() + '\n---\noplog last event time\n' + now(0).toString() + '\n---\nnow\n' + new Date().toString() + '\n(simulated sample)'; },
    printSecondaryReplicationInfo: function () { return 'source: mongo-1.db.internal:27017\n{\n  syncedTo: \'' + now(1000).toString() + '\',\n  replLag: \'1 secs (0 hrs) behind the primary \'\n}\n---\nsource: mongo-2.db.internal:27017\n{\n  syncedTo: \'' + now(2000).toString() + '\',\n  replLag: \'2 secs (0 hrs) behind the primary \'\n}\n(simulated sample)'; },
    hello: function () { return { topologyVersion: { counter: 6 }, hosts: ['mongo-0.db.internal:27017', 'mongo-1.db.internal:27017', 'mongo-2.db.internal:27017'], setName: 'rs0', setVersion: 5, isWritablePrimary: true, secondary: false, primary: 'mongo-0.db.internal:27017', me: 'mongo-0.db.internal:27017', electionId: '7fffffff0000000000000007', ok: 1, _simulator: 'static sample' }; },
    initiate: notHere('rs.initiate()'), add: notHere('rs.add()'), remove: notHere('rs.remove()'), stepDown: notHere('rs.stepDown()'), reconfig: notHere('rs.reconfig()'), freeze: notHere('rs.freeze()'), syncFrom: notHere('rs.syncFrom()'),
    help: function () { return 'rs.status(), rs.conf(), rs.hello(), rs.printReplicationInfo(), rs.printSecondaryReplicationInfo() return labelled samples. Elections, failover and rollback are interactive on the Architecture page.'; }
  };
  function notHere(n) { return function () { return n + ' changes a real replica set and is not modelled in the playground. Try it in the Replica Set simulator (Architecture page).'; }; }
  var sh = {
    status: function () {
      return {
        shardingVersion: { _id: 1, clusterId: '66f0c1a2b3c4d5e6f7a8b9c0' },
        shards: [{ _id: 'shard-a', host: 'shard-a/sa-0:27018,sa-1:27018,sa-2:27018', state: 1, topologyTime: new Timestamp(1727600000, 1) }, { _id: 'shard-b', host: 'shard-b/sb-0:27018,sb-1:27018,sb-2:27018', state: 1, topologyTime: new Timestamp(1727600100, 1) }, { _id: 'shard-c', host: 'shard-c/sc-0:27018,sc-1:27018,sc-2:27018', state: 1, topologyTime: new Timestamp(1727600200, 1) }],
        'active mongoses': [{ '8.0.4': 4 }],
        autosplit: { 'Currently enabled': 'yes' },
        balancer: { 'Currently enabled': 'yes', 'Currently running': 'no', 'Failed balancer rounds in last 5 attempts': 0, 'Migration Results for the last 24 hours': { 14: 'Success' } },
        databases: [{ database: { _id: 'shop', primary: 'shard-a', version: { uuid: 'sim', timestamp: new Timestamp(1727600300, 1), lastMod: 1 } },
          collections: { 'shop.orders': { shardKey: { customerId: 'hashed' }, unique: false, balancing: true, chunkMetadata: [{ shard: 'shard-a', nChunks: 4 }, { shard: 'shard-b', nChunks: 4 }, { shard: 'shard-c', nChunks: 4 }], tags: [] } } }],
        _simulator: 'Static sample of a 3-shard cluster. The playground is a single node; use the Sharding simulator on the Architecture page.'
      };
    },
    enableSharding: notHere('sh.enableSharding()'), shardCollection: notHere('sh.shardCollection()'), addShard: notHere('sh.addShard()'), reshardCollection: notHere('sh.reshardCollection()'),
    getBalancerState: function () { return true; }, isBalancerRunning: function () { return { mode: 'full', inBalancerRound: false, numBalancerRounds: 1442, ok: 1 }; },
    startBalancer: notHere('sh.startBalancer()'), stopBalancer: notHere('sh.stopBalancer()'), addShardToZone: notHere('sh.addShardToZone()'), updateZoneKeyRange: notHere('sh.updateZoneKeyRange()'),
    help: function () { return 'sh.status() returns a labelled sample. Shard key, chunk and balancer behaviour is interactive on the Architecture page.'; }
  };

  var HELP = [
    'Database methods: db.getName(), db.getCollectionNames(), db.createCollection(name, opts), db.createView(name, source, pipeline),',
    '  db.stats(), db.runCommand({...}), db.adminCommand({...}), db.serverStatus(), db.currentOp(), db.setProfilingLevel(level, {slowms}),',
    '  db.getSiblingDB(name), db.getMongo().startSession(), db.createUser({...}), db.aggregate([{ $documents: [...] }, ...]), db.watch()',
    'Collection methods: find, findOne, insertOne, insertMany, updateOne, updateMany, replaceOne, deleteOne, deleteMany,',
    '  findOneAndUpdate/Replace/Delete, bulkWrite, countDocuments, estimatedDocumentCount, distinct, aggregate,',
    '  createIndex, createIndexes, getIndexes, dropIndex, hideIndex, explain(), stats(), watch(), drop(), createSearchIndex',
    'Cursor methods: sort, skip, limit, project, hint, count, toArray, forEach, map, next, hasNext, itcount, explain',
    'Shell: use <db>, show dbs, show collections, it, print(), printjson(), ObjectId(), ISODate(), rs.status(), sh.status()'
  ].join('\n');

  /* ------------------------------------------------------------------
     Runner
     ------------------------------------------------------------------ */
  function preprocess(code) {
    return code.split('\n').map(function (line) {
      var m;
      if ((m = /^\s*use\s+([\w\-]+)\s*;?\s*$/.exec(line))) return '__use(' + JSON.stringify(m[1]) + ');';
      if ((m = /^\s*show\s+(dbs|databases|collections|tables|profile|users|roles)\s*;?\s*$/.exec(line))) return '__show(' + JSON.stringify(m[1]) + ');';
      if (/^\s*it\s*;?\s*$/.test(line)) return '__it();';
      if (/^\s*(exit|quit)\s*(\(\s*\))?\s*;?\s*$/.test(line)) return '';
      return line;
    }).join('\n');
  }
  function transform(src) {
    var ast = window.acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true, locations: true });
    var edits = [];
    ast.body.forEach(function (st) {
      if (st.type === 'ExpressionStatement' && !st.directive) edits.push([st.expression.start, st.expression.end]);
    });
    edits.sort(function (a, b) { return b[0] - a[0]; }).forEach(function (e) {
      src = src.slice(0, e[0]) + '__emit(await (' + src.slice(e[0], e[1]) + '))' + src.slice(e[1]);
    });
    return src;
  }
  function errorText(e) {
    if (!e) return 'Error';
    if (e.name === 'MongoServerError') {
      var t = 'MongoServerError' + (e.code !== 11000 && e.codeName ? '[' + e.codeName + ']' : '') + ': ' + e.message;
      if (e.errInfo) t += '\nAdditional information: ' + MM.fmt(e.errInfo);
      if (e.errorLabels) t += '\nerrorLabels: ' + MM.fmt(e.errorLabels);
      return t;
    }
    return (e.name || 'Error') + ': ' + (e.message || String(e));
  }
  MM.errorText = errorText;

  function Shell(engine) {
    this.engine = engine;
    this.db = MM.makeDb(engine, null, null);
    this.lastCursor = null;
  }
  MM.Shell = Shell;

  Shell.prototype.render = function (v) {
    if (v && typeof v.__mmDisplay === 'function') return { type: 'result', text: v.__mmDisplay() };
    if (v && v._isCursor) {
      if (v._explainMode) return { type: 'result', text: MM.fmt(v.explain(v._explainMode)), explain: true };
      var b = v._batch(20);
      this.lastCursor = b.more ? v : null;
      if (!b.docs.length) return { type: 'info', text: '(no documents)' };
      return { type: 'result', text: MM.fmt(b.docs) + (b.more ? '\nType "it" for more' : ''), count: b.docs.length };
    }
    if (typeof v === 'string' && !U.isOid(v)) return { type: 'result', text: v };
    if (v && v.explainVersion) return { type: 'result', text: MM.fmt(v), explain: true };
    return { type: 'result', text: MM.fmt(v) };
  };

  Shell.prototype.run = async function (code, opts) {
    opts = opts || {};
    var self = this, engine = this.engine, outputs = [], values = [], error = null, t0 = performance.now();
    engine.ttlPass();
    engine._warn = function (msg) { outputs.push({ type: 'warn', text: msg }); };
    engine.lastPipeline = null; engine.lastExplain = null;

    function emit(v) {
      if (v === undefined) return;
      if (opts.collect && v && v._isCursor && !v._explainMode) v = v.toArray();
      if (opts.collect && v && v._isCursor && v._explainMode) v = v.explain(v._explainMode);
      values.push(v);
      outputs.push(self.render(v));
    }
    function print() {
      var parts = Array.prototype.map.call(arguments, function (a) { return typeof a === 'string' ? a : MM.fmt(a); });
      outputs.push({ type: 'print', text: parts.join(' ') });
    }
    function printjson(x) { outputs.push({ type: 'print', text: MM.fmt(x) }); }
    function use(n) {
      if (!/^[^\/\\. "$*<>:|?]+$/.test(n)) throw U.serverError('Invalid database name: ' + n, 73, 'InvalidNamespace');
      outputs.push({ type: 'info', text: engine.currentDb === n ? 'already on db ' + n : 'switched to db ' + n });
      engine.currentDb = n;
    }
    function show(what) {
      if (what === 'dbs' || what === 'databases') {
        var list = rsListDatabases(engine).databases;
        var w = Math.max.apply(null, list.map(function (d) { return d.name.length; }));
        outputs.push({ type: 'result', text: list.map(function (d) { var s = fmtSize(d.sizeOnDisk); return d.name + new Array(w - d.name.length + 3).join(' ') + new Array(Math.max(1, 11 - s.length)).join(' ') + s; }).join('\n') });
      } else if (what === 'collections' || what === 'tables') {
        var names = self.db.getCollectionNames();
        outputs.push(names.length ? { type: 'result', text: names.join('\n') } : { type: 'info', text: '(no collections in ' + engine.currentDb + ')' });
      } else if (what === 'profile') {
        emit(self.db.system.profile.find().sort({ ts: -1 }).limit(5));
      } else if (what === 'users') {
        emit(self.db.getUsers().users);
      } else if (what === 'roles') {
        emit(self.db.getRoles());
      }
    }
    function it() {
      if (!self.lastCursor) { outputs.push({ type: 'info', text: 'no cursor' }); return; }
      outputs.push(self.render(self.lastCursor));
    }
    var consoleObj = { log: print, info: print, warn: print, error: print, table: printjson };

    var src;
    try { src = transform(preprocess(code)); }
    catch (e) {
      var loc = e.loc ? ' (line ' + e.loc.line + ', col ' + (e.loc.column + 1) + ')' : '';
      outputs.push({ type: 'error', text: 'SyntaxError: ' + String(e.message).replace(/\s*\(\d+:\d+\)$/, '') + loc });
      return { outputs: outputs, values: values, error: e, ms: performance.now() - t0 };
    }
    try {
      var names = ['db', 'rs', 'sh', '__emit', '__use', '__show', '__it', 'print', 'printjson', 'tojson', 'ObjectId', 'ISODate', 'NumberInt', 'NumberLong', 'NumberDecimal', 'Decimal128', 'Long', 'Int32', 'Double', 'UUID', 'Timestamp', 'console', 'sleep', 'help'];
      var vals = [this.db, rs, sh, emit, use, show, it, print, printjson, MM.fmt, ObjectId, ISODate, NumberInt, NumberLong, NumberDecimal, Decimal128, Long, NumberInt, Number, UUID, Timestamp, consoleObj, function () {}, function () { return HELP; }];
      var fn = new AsyncFunction(names.join(','), src);
      await fn.apply(null, vals);
    } catch (e) {
      error = e;
      outputs.push({ type: 'error', text: errorText(e) });
    }
    if (!opts.noSave) {
      var sv = engine.save();
      if (!sv.ok) outputs.push({ type: 'warn', text: sv.error });
    }
    return { outputs: outputs, values: values, value: values[values.length - 1], error: error, ms: performance.now() - t0, pipeline: engine.lastPipeline, explain: engine.lastExplain };
  };

  /* Fresh, isolated engine for exercise checking. */
  MM.evaluate = async function (code) {
    var eng = new MM.Engine({ persist: false });
    var sh2 = new Shell(eng);
    var r = await sh2.run(code, { collect: true, noSave: true });
    r.engine = eng; r.shell = sh2;
    return r;
  };

  MM.shellHelp = HELP;
})();
