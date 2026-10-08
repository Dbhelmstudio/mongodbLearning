/* =====================================================================
   engine.js — in-browser MongoDB simulator built on mingo.

   mingo evaluates query operators, update operators and aggregation
   expressions. Everything that makes it feel like a real server lives
   here: collections and indexes, unique and schema validation, upserts,
   positional updates, a cost-based planner model that produces explain()
   output, the profiler, change streams and multi-document transactions.

   Deliberate simplifications (documented in the UI):
     - ObjectIds are stored as 24-char lowercase hex strings.
     - Planner counters are modelled, not measured on a real B-tree.
     - Single node; replication and sharding are taught with visual simulators.
   ===================================================================== */
(function () {
  'use strict';
  var MM = window.MM = window.MM || {};
  var mingo = window.mingo;

  /* ------------------------------------------------------------------
     Value helpers
     ------------------------------------------------------------------ */
  var toStr = Object.prototype.toString;
  var hasOwn = Object.prototype.hasOwnProperty;
  var HEX24 = /^[0-9a-f]{24}$/;
  function isDate(v) { return toStr.call(v) === '[object Date]'; }
  function isRegExp(v) { return toStr.call(v) === '[object RegExp]'; }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v) && !isDate(v) && !isRegExp(v); }
  function isOid(v) { return typeof v === 'string' && HEX24.test(v); }
  function isOperatorObj(v) { if (!isObj(v)) return false; var k = Object.keys(v); return k.length > 0 && k.every(function (x) { return x.charAt(0) === '$'; }); }

  function clone(v) {
    if (v === null || typeof v !== 'object') return v;
    if (isDate(v)) return new Date(v.getTime());
    if (isRegExp(v)) return v;
    if (Array.isArray(v)) return v.map(clone);
    if (MM.Timestamp && v instanceof MM.Timestamp) return v;
    var o = {};
    for (var k in v) if (hasOwn.call(v, k)) o[k] = clone(v[k]);
    return o;
  }
  function toBson(v) {
    if (v === undefined) return null;
    if (v === null || typeof v !== 'object') return typeof v === 'function' ? null : v;
    if (isDate(v)) return new Date(v.getTime());
    if (isRegExp(v)) return v;
    if (Array.isArray(v)) return v.map(toBson);
    if (MM.Timestamp && v instanceof MM.Timestamp) return v;
    var o = {};
    for (var k in v) if (hasOwn.call(v, k) && typeof v[k] !== 'function' && v[k] !== undefined) o[k] = toBson(v[k]);
    return o;
  }
  function keyOf(v) {
    if (v === undefined) return 'u';
    if (v === null) return 'n';
    if (isDate(v)) return 'd' + v.getTime();
    if (typeof v === 'number') return 'x' + v;
    if (typeof v === 'string') return 's' + v;
    if (typeof v === 'boolean') return 'b' + v;
    if (isRegExp(v)) return 'r' + String(v);
    if (Array.isArray(v)) return '[' + v.map(keyOf).join(',') + ']';
    if (typeof v === 'object') return '{' + Object.keys(v).map(function (k) { return JSON.stringify(k) + ':' + keyOf(v[k]); }).join(',') + '}';
    return String(v);
  }
  function typeRank(v) {
    if (v === undefined || v === null) return 1;
    if (typeof v === 'number') return 2;
    if (typeof v === 'string') return 3;
    if (Array.isArray(v)) return 5;
    if (typeof v === 'boolean') return 8;
    if (isDate(v)) return 9;
    if (MM.Timestamp && v instanceof MM.Timestamp) return 10;
    if (isRegExp(v)) return 11;
    if (typeof v === 'object') return 4;
    return 12;
  }
  function cmp(a, b) {
    var ra = typeRank(a), rb = typeRank(b);
    if (ra !== rb) return ra - rb;
    switch (ra) {
      case 1: return 0;
      case 2: return a < b ? -1 : (a > b ? 1 : 0);
      case 3: return a < b ? -1 : (a > b ? 1 : 0);
      case 8: return (a ? 1 : 0) - (b ? 1 : 0);
      case 9: return a.getTime() - b.getTime();
      case 10: return (a.t - b.t) || (a.i - b.i);
      case 5:
        for (var i = 0; i < Math.min(a.length, b.length); i++) { var c = cmp(a[i], b[i]); if (c) return c; }
        return a.length - b.length;
      default: var ka = keyOf(a), kb = keyOf(b); return ka < kb ? -1 : (ka > kb ? 1 : 0);
    }
  }
  function getExact(doc, path) {
    var parts = path.split('.'), cur = doc;
    for (var i = 0; i < parts.length; i++) {
      if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }
  function setExact(obj, path, val) {
    var parts = path.split('.'), cur = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (!isObj(cur[parts[i]]) && !Array.isArray(cur[parts[i]])) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = val;
    return obj;
  }
  /* Values an index stores for `path` (arrays fan out = multikey). */
  function indexValues(doc, path, info) {
    var parts = path.split('.'), out = [];
    (function walk(v, i) {
      if (i === parts.length) {
        if (Array.isArray(v)) {
          if (info) info.multikey = true;
          if (!v.length) out.push(undefined); else v.forEach(function (x) { out.push(x); });
        } else out.push(v);
        return;
      }
      if (v === null || v === undefined || typeof v !== 'object') { out.push(undefined); return; }
      if (Array.isArray(v)) {
        if (/^\d+$/.test(parts[i])) { walk(v[+parts[i]], i + 1); return; }
        if (info) info.multikey = true;
        var any = false;
        v.forEach(function (el) { if (isObj(el)) { any = true; walk(el, i); } });
        if (!any) out.push(undefined);
        return;
      }
      walk(v[parts[i]], i + 1);
    })(doc, 0);
    var seen = {}, res = [];
    out.forEach(function (x) { var k = keyOf(x); if (!seen[k]) { seen[k] = 1; res.push(x); } });
    return res;
  }
  function hashStr(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0);
  }
  function hex(n, len) { var h = n.toString(16); while (h.length < len) h = '0' + h; return h.slice(-len); }
  var oidCounter = Math.floor(Math.random() * 0xffffff);
  var oidRandom = hex(Math.floor(Math.random() * 0xffffffff), 8) + hex(Math.floor(Math.random() * 255), 2);
  function newOid(ts) {
    oidCounter = (oidCounter + 1) % 0xffffff;
    return hex(Math.floor((ts || Date.now()) / 1000), 8) + oidRandom + hex(oidCounter, 6);
  }

  function serverError(msg, code, codeName, extra) {
    var e = new Error(msg);
    e.name = 'MongoServerError';
    e.code = code; e.codeName = codeName;
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    return e;
  }
  var OID_RE = /^[0-9a-f]{24}$/;
  function bsonSize(v) {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'boolean') return 1;
    if (typeof v === 'number') return Number.isInteger(v) && Math.abs(v) < 2147483648 ? 4 : 8;
    if (typeof v === 'string') return OID_RE.test(v) ? 12 : 5 + new TextEncoder().encode(v).length;
    if (v instanceof Date) return 8;
    if (v instanceof RegExp) return v.source.length + v.flags.length + 2;
    if (typeof v === 'object') {
      var n = 5, ks = Object.keys(v);
      for (var i = 0; i < ks.length; i++) n += 2 + (Array.isArray(v) ? String(i).length : ks[i].length) + bsonSize(v[ks[i]]);
      return n;
    }
    return 8;
  }
  /* mingo falls back to its global operator registry for anything not in this context. */
  var AGG_CONTEXT = mingo.Context.init().addExpressionOps({
    $bsonSize: function (obj, expr) {
      var val = expr === '$$ROOT' ? obj : mingo.aggregate([obj], [{ $project: { _id: 0, v: expr } }])[0].v;
      return val === null || val === undefined ? null : bsonSize(val);
    }
  });
  /* ---------- geospatial ---------- */
  /* MongoDB converts $centerSphere radians with the equatorial radius, so distances use the same constant. */
  var EARTH_RADIUS_M = 6378100;
  function geoPoint(v) {
    if (Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number') return [v[0], v[1]];
    if (isObj(v) && v.type === 'Point' && Array.isArray(v.coordinates)) return [v.coordinates[0], v.coordinates[1]];
    if (isObj(v) && typeof v.lng === 'number' && typeof v.lat === 'number') return [v.lng, v.lat];
    return null;
  }
  function haversine(a, b) {
    var r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function inRing(p, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function inPolygon(p, rings) { return inRing(p, rings[0]) && !rings.slice(1).some(function (h) { return inRing(p, h); }); }
  function geoWithin(p, spec) {
    if (!p) return false;
    if (spec.$centerSphere) return haversine(geoPoint(spec.$centerSphere[0]), p) <= spec.$centerSphere[1] * EARTH_RADIUS_M;
    if (spec.$center) { var c = spec.$center[0]; return Math.hypot(p[0] - c[0], p[1] - c[1]) <= spec.$center[1]; }
    if (spec.$box) { var b = spec.$box; return p[0] >= Math.min(b[0][0], b[1][0]) && p[0] <= Math.max(b[0][0], b[1][0]) && p[1] >= Math.min(b[0][1], b[1][1]) && p[1] <= Math.max(b[0][1], b[1][1]); }
    if (spec.$polygon) return inRing(p, spec.$polygon);
    var g = spec.$geometry;
    if (g && g.type === 'Polygon') return inPolygon(p, g.coordinates);
    if (g && g.type === 'MultiPolygon') return g.coordinates.some(function (poly) { return inPolygon(p, poly); });
    throw serverError('Simulator: $geoWithin supports $centerSphere, $center, $box, $polygon and Polygon/MultiPolygon $geometry', 2, 'BadValue');
  }
  function hasGeoIndex(store, field) { return store.indexes.some(function (ix) { return ix.key[field] === '2dsphere' || ix.key[field] === '2d'; }); }
  var QUERY_CONTEXT = mingo.Context.init().addQueryOps({
    $geoWithin: function (selector, spec) {
      return function (obj) { return indexValues(obj, selector).some(function (v) { return geoWithin(geoPoint(v), spec); }); };
    },
    $geoIntersects: function (selector, spec) {
      return function (obj) {
        var g = spec.$geometry;
        return indexValues(obj, selector).some(function (v) {
          var p = geoPoint(v);
          if (!p || !g) return false;
          if (g.type === 'Point') return p[0] === g.coordinates[0] && p[1] === g.coordinates[1];
          return geoWithin(p, { $geometry: g });
        });
      };
    }
  });
  function schemaPredicate(schema) { return function (doc) { var e = []; checkSchema(schema, doc, '', e); return !e.length; }; }
  function compileQuery(filter) {
    try { return new mingo.Query(filter || {}, { context: QUERY_CONTEXT, jsonSchemaValidator: schemaPredicate }); }
    catch (e) { throw serverError(String(e.message || e).replace(/^MingoError:\s*/, ''), 2, 'BadValue'); }
  }
  /* Pulls a top-level { field: { $near | $nearSphere } } out of a filter so find() can sort by distance. */
  function extractNear(filter) {
    var out = null, rest = {};
    Object.keys(filter || {}).forEach(function (k) {
      var v = filter[k];
      if (k.charAt(0) !== '$' && isObj(v) && (v.$near !== undefined || v.$nearSphere !== undefined)) {
        var spec = v.$near !== undefined ? v.$near : v.$nearSphere, sphere = v.$nearSphere !== undefined, pt, max = v.$maxDistance, min = v.$minDistance;
        if (isObj(spec) && spec.$geometry) { pt = geoPoint(spec.$geometry); if (spec.$maxDistance !== undefined) max = spec.$maxDistance; if (spec.$minDistance !== undefined) min = spec.$minDistance; }
        else { pt = geoPoint(spec); if (max !== undefined) max = sphere ? max * EARTH_RADIUS_M : max; }
        out = { field: k, point: pt, max: max, min: min, legacy: !(isObj(spec) && spec.$geometry) && !sphere };
      } else rest[k] = v;
    });
    return out ? { near: out, rest: rest } : null;
  }
  function geoDistance(near, p) { return near.legacy ? Math.hypot(p[0] - near.point[0], p[1] - near.point[1]) : haversine(near.point, p); }
  function nearFilter(docs, near) {
    var withD = [];
    docs.forEach(function (d) {
      var ps = indexValues(d, near.field).map(geoPoint).filter(Boolean);
      if (!ps.length) return;
      var dist = Math.min.apply(null, ps.map(function (p) { return geoDistance(near, p); }));
      if (near.max !== undefined && dist > near.max) return;
      if (near.min !== undefined && dist < near.min) return;
      withD.push({ d: d, dist: dist });
    });
    withD.sort(function (a, b) { return a.dist - b.dist; });
    return withD;
  }

  /* ---------- collation ---------- */
  /* Strength 1 ignores case and accents, 2 ignores case only, 3 (default) compares both but orders lowercase first. */
  function makeCollator(col) {
    if (!isObj(col) || !col.locale || col.locale === 'simple') return null;
    var strength = col.strength || 3;
    var c = new Intl.Collator(col.locale, { sensitivity: strength === 1 ? 'base' : strength === 2 ? 'accent' : 'variant', numeric: !!col.numericOrdering, caseFirst: col.caseFirst || 'false' });
    return { compare: c.compare, equalStrings: strength <= 2 ? function (a, b) { return c.compare(a, b) === 0; } : null };
  }
  /* Collation-aware equality on top-level string predicates; the rest of the filter still runs through mingo. */
  function applyCollationFilter(filter, collator) {
    if (!collator || !collator.equalStrings) return { filter: filter, preds: [] };
    var rest = {}, preds = [], eq = collator.equalStrings;
    Object.keys(filter || {}).forEach(function (k) {
      var v = filter[k];
      if (k.charAt(0) === '$') { rest[k] = v; return; }
      var check = null;
      if (typeof v === 'string') check = function (x) { return typeof x === 'string' && eq(x, v); };
      else if (isObj(v) && Object.keys(v).length === 1 && typeof v.$eq === 'string') check = function (x) { return typeof x === 'string' && eq(x, v.$eq); };
      else if (isObj(v) && Object.keys(v).length === 1 && Array.isArray(v.$in) && v.$in.every(function (s) { return typeof s === 'string'; })) check = function (x) { return typeof x === 'string' && v.$in.some(function (s) { return eq(x, s); }); };
      if (check) preds.push(function (d) { return indexValues(d, k).some(check); });
      else rest[k] = v;
    });
    return { filter: rest, preds: preds };
  }

  /* ------------------------------------------------------------------
     mongosh-style formatter
     ------------------------------------------------------------------ */
  var IDENT = /^[A-Za-z_$][\w$]*$/;
  function quoteStr(s) {
    return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + "'";
  }
  function fmtScalar(v) {
    if (v === undefined) return 'undefined';
    if (v === null) return 'null';
    if (typeof v === 'string') return isOid(v) ? "ObjectId('" + v + "')" : quoteStr(v);
    if (typeof v === 'number') return Object.is(v, -0) ? '-0' : String(v);
    if (typeof v === 'boolean') return String(v);
    if (isDate(v)) return isNaN(v.getTime()) ? 'Invalid Date' : "ISODate('" + v.toISOString() + "')";
    if (isRegExp(v)) return String(v);
    if (typeof v === 'function') return '[Function: ' + (v.name || 'anonymous') + ']';
    if (typeof v === 'bigint') return 'Long(' + v.toString() + ')';
    return null;
  }
  function fmtKey(k) { return IDENT.test(k) ? k : quoteStr(k); }
  function fmtInline(v, depth) {
    var s = fmtScalar(v);
    if (s !== null) return s;
    if (depth > 12) return '[Object]';
    if (typeof v.__mmDisplay === 'function') return v.__mmDisplay();
    if (Array.isArray(v)) {
      if (!v.length) return '[]';
      return '[ ' + v.map(function (x) { return fmtInline(x, depth + 1); }).join(', ') + ' ]';
    }
    var keys = Object.keys(v);
    if (!keys.length) return '{}';
    return '{ ' + keys.map(function (k) { return fmtKey(k) + ': ' + fmtInline(v[k], depth + 1); }).join(', ') + ' }';
  }
  function fmt(v, indent, prefixLen) {
    indent = indent || 0; prefixLen = prefixLen || 0;
    var s = fmtScalar(v);
    if (s !== null) return s;
    if (v && v.__mmDisplay) return v.__mmDisplay();
    var one = fmtInline(v, 0);
    if (one.length + indent + prefixLen <= 76 && one.indexOf('\n') < 0) return one;
    var pad = new Array(indent + 3).join(' '), padEnd = new Array(indent + 1).join(' ');
    if (Array.isArray(v)) {
      var shown = v.slice(0, 100).map(function (x) { return pad + fmt(x, indent + 2, 0); });
      if (v.length > 100) shown.push(pad + '... ' + (v.length - 100) + ' more items');
      return '[\n' + shown.join(',\n') + '\n' + padEnd + ']';
    }
    var lines = Object.keys(v).map(function (k) {
      var kk = fmtKey(k);
      return pad + kk + ': ' + fmt(v[k], indent + 2, kk.length + 2);
    });
    return '{\n' + lines.join(',\n') + '\n' + padEnd + '}';
  }

  /* ------------------------------------------------------------------
     Text search (simplified tokenizer + light stemming)
     ------------------------------------------------------------------ */
  var STOP = {};
  'a an and are as at be but by for from has have i in is it its of on or so that the this to was were will with would not no too very'.split(' ').forEach(function (w) { STOP[w] = 1; });
  /* Approximates Porter step 1 plus final-e removal; index and query terms go through the same function. */
  function stem(w) {
    if (w.length <= 3) return w;
    if (/sses$/.test(w)) w = w.slice(0, -2);
    else if (/ies$/.test(w)) w = w.slice(0, -3) + 'y';
    else if (/s$/.test(w) && !/(ss|us)$/.test(w)) w = w.slice(0, -1);
    var cut = false;
    if (w.length > 5 && /ing$/.test(w)) { w = w.slice(0, -3); cut = true; }
    else if (w.length > 4 && /ed$/.test(w) && !/eed$/.test(w)) { w = w.slice(0, -2); cut = true; }
    if (cut) {
      if (/(at|bl|iz)$/.test(w)) w += 'e';
      else if (/([^aeiouylsz])\1$/.test(w)) w = w.slice(0, -1);
    }
    if (w.length > 4 && /e$/.test(w)) w = w.slice(0, -1);
    return w;
  }
  function tokenize(text) {
    return String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(function (w) { return w && !STOP[w]; }).map(stem);
  }
  function parseSearch(s) {
    var phrases = [], neg = [], terms = [];
    String(s).replace(/"([^"]+)"/g, function (_, p) { phrases.push(p.toLowerCase()); return ' '; })
      .split(/\s+/).forEach(function (w) {
        if (!w) return;
        if (w.charAt(0) === '-' && w.length > 1) tokenize(w.slice(1)).forEach(function (t) { neg.push(t); });
        else tokenize(w).forEach(function (t) { terms.push(t); });
      });
    phrases.forEach(function (p) { tokenize(p).forEach(function (t) { if (terms.indexOf(t) < 0) terms.push(t); }); });
    return { phrases: phrases, neg: neg, terms: terms };
  }
  function textFields(idx, doc) {
    var fields = [];
    Object.keys(idx.key).forEach(function (f) {
      if (idx.key[f] !== 'text') return;
      if (f === '$**') {
        (function walk(v, p) {
          if (typeof v === 'string') fields.push([p, v]);
          else if (Array.isArray(v)) v.forEach(function (x) { walk(x, p); });
          else if (isObj(v)) Object.keys(v).forEach(function (k) { walk(v[k], p ? p + '.' + k : k); });
        })(doc, '');
      } else {
        indexValues(doc, f).forEach(function (v) { if (typeof v === 'string') fields.push([f, v]); });
      }
    });
    return fields;
  }
  function textSearch(store, spec) {
    var idx = store.indexes.filter(function (i) { return Object.keys(i.key).some(function (k) { return i.key[k] === 'text'; }); })[0];
    if (!idx) throw serverError('text index required for $text query', 27, 'IndexNotFound');
    if (!spec || typeof spec.$search !== 'string') throw serverError('$text requires a $search string', 2, 'BadValue');
    var q = parseSearch(spec.$search), weights = idx.weights || {}, scores = new Map(), postings = 0;
    store.docs.forEach(function (doc) {
      var fields = textFields(idx, doc), score = 0, all = '', hitTerms = {};
      fields.forEach(function (fv) {
        var toks = tokenize(fv[1]), w = weights[fv[0]] || 1, counts = {};
        all += ' ' + fv[1].toLowerCase();
        toks.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
        q.terms.forEach(function (t) {
          if (counts[t]) { hitTerms[t] = 1; score += w * (1 + 0.5 * (counts[t] - 1)) * (0.5 + 1 / (1 + Math.log(1 + toks.length))); }
        });
        if (q.neg.some(function (t) { return counts[t]; })) score = -Infinity;
      });
      postings += Object.keys(hitTerms).length;
      if (!(score > 0)) return;
      if (q.phrases.some(function (p) { return all.indexOf(p) < 0; })) return;
      scores.set(doc, Math.round(score * 1e4) / 1e4);
    });
    return { scores: scores, index: idx, terms: q.terms, postings: postings };
  }

  /* ------------------------------------------------------------------
     $jsonSchema (subset) — enough for real-world validators
     ------------------------------------------------------------------ */
  function bsonTypeOf(v) {
    if (v === null || v === undefined) return 'null';
    if (Array.isArray(v)) return 'array';
    if (isDate(v)) return 'date';
    if (isRegExp(v)) return 'regex';
    if (typeof v === 'boolean') return 'bool';
    if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'double';
    if (typeof v === 'string') return isOid(v) ? 'objectId' : 'string';
    return 'object';
  }
  function bsonTypeMatches(v, t) {
    var actual = bsonTypeOf(v);
    if (t === actual) return true;
    if (t === 'string' && actual === 'objectId') return true;
    if ((t === 'long' || t === 'int') && actual === 'int') return true;
    if ((t === 'double' || t === 'decimal' || t === 'number') && typeof v === 'number') return true;
    return false;
  }
  function jsonTypeMatches(v, t) {
    if (t === 'integer') return typeof v === 'number' && Number.isInteger(v);
    if (t === 'number') return typeof v === 'number';
    if (t === 'boolean') return typeof v === 'boolean';
    if (t === 'null') return v === null;
    if (t === 'array') return Array.isArray(v);
    if (t === 'object') return isObj(v);
    if (t === 'string') return typeof v === 'string';
    return false;
  }
  function checkSchema(schema, v, path, errs) {
    var p = path || '(root)';
    if (schema.bsonType) {
      var bt = Array.isArray(schema.bsonType) ? schema.bsonType : [schema.bsonType];
      if (!bt.some(function (t) { return bsonTypeMatches(v, t); })) { errs.push(p + ': expected bsonType ' + bt.join('|') + ', got ' + bsonTypeOf(v)); return; }
    }
    if (schema.type) {
      var jt = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!jt.some(function (t) { return jsonTypeMatches(v, t); })) { errs.push(p + ': expected type ' + jt.join('|')); return; }
    }
    if (schema.enum && !schema.enum.some(function (e) { return keyOf(e) === keyOf(v); })) errs.push(p + ': value ' + fmtInline(v, 0) + ' not in enum ' + fmtInline(schema.enum, 0));
    if (typeof v === 'number') {
      if (schema.minimum !== undefined && (schema.exclusiveMinimum === true ? v <= schema.minimum : v < schema.minimum)) errs.push(p + ': ' + v + ' is below minimum ' + schema.minimum);
      if (schema.maximum !== undefined && (schema.exclusiveMaximum === true ? v >= schema.maximum : v > schema.maximum)) errs.push(p + ': ' + v + ' is above maximum ' + schema.maximum);
    }
    if (typeof v === 'string') {
      if (schema.minLength !== undefined && v.length < schema.minLength) errs.push(p + ': shorter than minLength ' + schema.minLength);
      if (schema.maxLength !== undefined && v.length > schema.maxLength) errs.push(p + ': longer than maxLength ' + schema.maxLength);
      if (schema.pattern && !new RegExp(schema.pattern).test(v)) errs.push(p + ': does not match pattern ' + schema.pattern);
    }
    if (Array.isArray(v)) {
      if (schema.minItems !== undefined && v.length < schema.minItems) errs.push(p + ': fewer than minItems ' + schema.minItems);
      if (schema.maxItems !== undefined && v.length > schema.maxItems) errs.push(p + ': more than maxItems ' + schema.maxItems);
      if (schema.uniqueItems) { var ks = v.map(keyOf); if (new Set(ks).size !== ks.length) errs.push(p + ': items are not unique'); }
      if (isObj(schema.items)) v.forEach(function (x, i) { checkSchema(schema.items, x, p + '.' + i, errs); });
    }
    if (isObj(v)) {
      (schema.required || []).forEach(function (r) { if (!hasOwn.call(v, r)) errs.push(p + ": missing required field '" + r + "'"); });
      var props = schema.properties || {};
      Object.keys(props).forEach(function (k) { if (hasOwn.call(v, k)) checkSchema(props[k], v[k], path ? path + '.' + k : k, errs); });
      if (schema.additionalProperties === false) {
        Object.keys(v).forEach(function (k) { if (!hasOwn.call(props, k)) errs.push(p + ": additional property '" + k + "' not allowed" + (k === '_id' ? ' (add _id to properties when additionalProperties is false)' : '')); });
      }
    }
    ['allOf', 'anyOf', 'oneOf'].forEach(function (kw) {
      if (!Array.isArray(schema[kw])) return;
      var results = schema[kw].map(function (s) { var e = []; checkSchema(s, v, path, e); return e; });
      var ok = results.filter(function (e) { return !e.length; }).length;
      if (kw === 'allOf' && ok !== results.length) results.forEach(function (e) { errs.push.apply(errs, e); });
      if (kw === 'anyOf' && !ok) errs.push(p + ': does not match anyOf');
      if (kw === 'oneOf' && ok !== 1) errs.push(p + ': must match exactly one schema in oneOf');
    });
    if (isObj(schema.not)) { var ne = []; checkSchema(schema.not, v, path, ne); if (!ne.length) errs.push(p + ': must not match "not" schema'); }
  }
  function validateDoc(store, doc) {
    var opts = store.options;
    if (!opts.validator || opts.validationLevel === 'off') return null;
    var v = opts.validator, rest = {}, errs = [];
    Object.keys(v).forEach(function (k) { if (k !== '$jsonSchema') rest[k] = v[k]; });
    if (v.$jsonSchema) checkSchema(v.$jsonSchema, doc, '', errs);
    if (Object.keys(rest).length && !compileQuery(rest).test(doc)) errs.push('query-operator rules: ' + fmtInline(rest, 0));
    return errs.length ? errs : null;
  }

  /* ------------------------------------------------------------------
     Query planner model
     ------------------------------------------------------------------ */
  function parsePreds(filter) {
    var preds = {}, orList = null, text = null, others = [];
    function regexInfo(p, src, flags) {
      var m = /^\^([\w\- @.]+)/.exec(src);
      if (m && (flags || '').indexOf('i') < 0) p.prefix = m[1]; else p.other = true;
    }
    function add(path, cond) {
      var p = preds[path] || (preds[path] = { path: path, eq: null, ne: null, range: null, prefix: null, other: false, multiPoint: false, hasNull: false });
      if (isOperatorObj(cond)) {
        Object.keys(cond).forEach(function (op) {
          var v = cond[op];
          if (op === '$eq') { p.eq = [v]; if (v === null) p.hasNull = true; }
          else if (op === '$in' && Array.isArray(v) && !v.some(isRegExp)) { p.eq = v.slice(); p.multiPoint = v.length > 1; if (v.indexOf(null) >= 0) p.hasNull = true; }
          else if (op === '$gt' || op === '$gte' || op === '$lt' || op === '$lte') { p.range = p.range || {}; p.range[op] = v; }
          else if (op === '$ne') p.ne = [v];
          else if (op === '$nin' && Array.isArray(v)) p.ne = v.slice();
          else if (op === '$regex') regexInfo(p, isRegExp(v) ? v.source : String(v), (isRegExp(v) ? v.flags : '') + (cond.$options || ''));
          else if (op === '$options') { /* consumed with $regex */ }
          else if (op === '$exists' && v === false) { p.other = true; p.hasNull = true; }
          else p.other = true;
        });
      } else if (isRegExp(cond)) regexInfo(p, cond.source, cond.flags);
      else { p.eq = [cond]; if (cond === null) p.hasNull = true; }
    }
    (function walk(f) {
      Object.keys(f || {}).forEach(function (k) {
        if (k === '$and' && Array.isArray(f.$and)) f.$and.forEach(walk);
        else if (k === '$or') orList = f.$or;
        else if (k === '$text') text = f.$text;
        else if (k.charAt(0) === '$') others.push(k);
        else add(k, f[k]);
      });
    })(filter);
    return { preds: preds, orList: orList, text: text, others: others };
  }
  function predBounded(p) { return !!(p && (p.eq || p.range || p.prefix || p.ne)); }
  function predPinned(p) { return !!(p && p.eq && !p.multiPoint && !p.range && !p.ne); }

  function fmtBoundVal(v) {
    if (v === Infinity) return 'inf.0';
    if (v === -Infinity) return '-inf.0';
    if (typeof v === 'string') return '"' + v + '"';
    if (isDate(v)) return 'new Date(' + v.getTime() + ')';
    return fmtInline(v, 0);
  }
  function intervalsFor(p, dir) {
    var iv = [];
    if (!predBounded(p)) iv.push('[MinKey, MaxKey]');
    else if (p.eq) p.eq.slice().sort(cmp).forEach(function (v) { iv.push('[' + fmtBoundVal(v) + ', ' + fmtBoundVal(v) + ']'); });
    else if (p.range) {
      var r = p.range, lo = r.$gte !== undefined ? r.$gte : r.$gt, hi = r.$lte !== undefined ? r.$lte : r.$lt;
      var typed = lo !== undefined ? lo : hi;
      var minV = typeof typed === 'number' ? -Infinity : (isDate(typed) ? new Date(-8.64e15) : (typeof typed === 'string' ? '' : 'MinKey'));
      var maxV = typeof typed === 'number' ? Infinity : (isDate(typed) ? new Date(8.64e15) : (typeof typed === 'string' ? {} : 'MaxKey'));
      iv.push((r.$gt !== undefined ? '(' : '[') + (lo !== undefined ? fmtBoundVal(lo) : fmtBoundVal(minV)) + ', ' + (hi !== undefined ? fmtBoundVal(hi) : fmtBoundVal(maxV)) + (r.$lt !== undefined ? ')' : ']'));
    } else if (p.prefix) {
      var next = p.prefix.slice(0, -1) + String.fromCharCode(p.prefix.charCodeAt(p.prefix.length - 1) + 1);
      iv.push('["' + p.prefix + '", "' + next + '")', '[/^' + p.prefix + '/, /^' + p.prefix + '/]');
    } else if (p.ne) {
      var sorted = p.ne.slice().sort(cmp);
      iv.push('[MinKey, ' + fmtBoundVal(sorted[0]) + ')');
      for (var i = 0; i < sorted.length - 1; i++) iv.push('(' + fmtBoundVal(sorted[i]) + ', ' + fmtBoundVal(sorted[i + 1]) + ')');
      iv.push('(' + fmtBoundVal(sorted[sorted.length - 1]) + ', MaxKey]');
    }
    if (dir < 0) iv = iv.reverse().map(function (s) {
      var m = /^([\[(])(.*), (.*)([\])])$/.exec(s);
      if (!m) return s;
      return (m[4] === ']' ? '[' : '(') + m[3] + ', ' + m[2] + (m[1] === '[' ? ']' : ')');
    });
    return iv;
  }
  function valueInPred(v, p, hashed) {
    if (hashed) return p.eq.some(function (e) { return hashStr(keyOf(e)) === v; });
    if (p.eq) return p.eq.some(function (e) { return cmp(e, v) === 0 || (Array.isArray(e) && keyOf(e) === keyOf(v)); });
    if (p.ne) return !p.ne.some(function (e) { return cmp(e, v) === 0; });
    if (p.prefix) return typeof v === 'string' && v.indexOf(p.prefix) === 0;
    if (p.range) {
      var r = p.range;
      for (var op in r) {
        var b = r[op];
        if (typeRank(b) !== typeRank(v)) return false;
        var c = cmp(v, b);
        if (op === '$gt' && !(c > 0)) return false;
        if (op === '$gte' && !(c >= 0)) return false;
        if (op === '$lt' && !(c < 0)) return false;
        if (op === '$lte' && !(c <= 0)) return false;
      }
      return true;
    }
    return true;
  }
  function isTextIndex(idx) { return Object.keys(idx.key).some(function (k) { return idx.key[k] === 'text'; }); }
  function isGeoIndex(idx) { return Object.keys(idx.key).some(function (k) { return idx.key[k] === '2dsphere' || idx.key[k] === '2d'; }); }
  function wildcardPrefix(idx) {
    var k = Object.keys(idx.key)[0];
    if (k === '$**') return '';
    if (/\.\$\*\*$/.test(k)) return k.slice(0, -4);
    return null;
  }

  /* Sorted index entries for a (possibly virtual) index; cached per write version. */
  function indexEntries(store, idx) {
    var cacheKey = idx.name + '|' + Object.keys(idx.key).join(',');
    var c = store.ixCache[cacheKey];
    if (c) return c;
    var keys = Object.keys(idx.key), entries = [], info = { multikey: false, multikeyPaths: {} };
    var pfe = idx.partialFilterExpression ? compileQuery(idx.partialFilterExpression) : null;
    store.docs.forEach(function (doc, di) {
      if (pfe && !pfe.test(doc)) return;
      var perField = keys.map(function (f) {
        var fi = { multikey: false };
        var vals = indexValues(doc, f, fi);
        if (fi.multikey) { info.multikey = true; info.multikeyPaths[f] = true; }
        if (idx.key[f] === 'hashed') vals = vals.map(function (v) { return hashStr(keyOf(v === undefined ? null : v)); });
        return vals;
      });
      if (idx.sparse && perField.every(function (vals) { return vals.length === 1 && vals[0] === undefined; })) return;
      var combos = [[]];
      perField.forEach(function (vals) {
        var next = [];
        combos.forEach(function (cmb) { vals.forEach(function (v) { next.push(cmb.concat([v === undefined ? null : v])); }); });
        combos = next;
      });
      combos.forEach(function (k) { entries.push({ k: k, d: doc, i: di }); });
    });
    var dirs = keys.map(function (f) { return idx.key[f] === -1 ? -1 : 1; });
    entries.sort(function (a, b) {
      for (var i = 0; i < dirs.length; i++) { var x = cmp(a.k[i], b.k[i]) * dirs[i]; if (x) return x; }
      return a.i - b.i;
    });
    c = { entries: entries, multikey: info.multikey, multikeyPaths: info.multikeyPaths };
    store.ixCache[cacheKey] = c;
    return c;
  }

  function candidateIndexes(store, parsed, sort) {
    var out = [];
    store.indexes.forEach(function (idx) {
      if (idx.hidden || isTextIndex(idx) || isGeoIndex(idx)) return;
      var wp = wildcardPrefix(idx);
      if (wp !== null) {
        Object.keys(parsed.preds).forEach(function (path) {
          if (path === '_id' || !predBounded(parsed.preds[path])) return;
          if (wp && path.indexOf(wp + '.') !== 0) return;
          var vk = {}; vk[path] = 1;
          out.push({ name: idx.name, key: vk, display: (function () { var d = { $_path: 1 }; d[path] = 1; return d; })(), wildcard: true, spec: idx });
        });
        return;
      }
      var keys = Object.keys(idx.key), first = parsed.preds[keys[0]];
      var hashed = idx.key[keys[0]] === 'hashed';
      if (hashed && !(first && first.eq && !first.range)) return;
      if (idx.sparse && keys.some(function (k) { return parsed.preds[k] && parsed.preds[k].hasNull; })) return;
      var usable = predBounded(first) && !(first && first.hasNull && idx.sparse);
      if (!usable && sort && !idx.sparse && !idx.partialFilterExpression && !hashed) {
        usable = sortInfo(idx, parsed, sort).ok && Object.keys(sort).some(function (f) { return keys.indexOf(f) >= 0; });
      }
      if (usable && idx.partialFilterExpression) {
        usable = Object.keys(idx.partialFilterExpression).every(function (f) { return f.charAt(0) === '$' || predBounded(parsed.preds[f]); });
      }
      if (usable) out.push({ name: idx.name, key: idx.key, display: idx.key, spec: idx });
    });
    return out;
  }
  function sortInfo(idx, parsed, sort) {
    if (!sort || !Object.keys(sort).length) return { ok: true, dir: 1, none: true };
    var keys = Object.keys(idx.key);
    if (keys.some(function (k) { return idx.key[k] === 'hashed' || idx.key[k] === 'text'; })) return { ok: false };
    var sk = Object.keys(sort).filter(function (f) { return !predPinned(parsed.preds[f]); });
    if (!sk.length) return { ok: true, dir: 1 };
    var i = 0, dir = 0;
    for (var j = 0; j < keys.length && i < sk.length; j++) {
      var f = keys[j];
      if (f === sk[i]) {
        var d = (sort[f] < 0 ? -1 : 1) * (idx.key[f] < 0 ? -1 : 1);
        if (dir && d !== dir) return { ok: false };
        dir = d; i++;
        continue;
      }
      var p = parsed.preds[f];
      if (predPinned(p)) continue;
      break;
    }
    return { ok: i === sk.length, dir: dir || 1 };
  }

  function simulateIndexPlan(store, cand, parsed, q, fullQuery) {
    var idx = cand, keys = Object.keys(idx.key), ent = indexEntries(store, idx.wildcard ? { name: 'wc:' + idx.name, key: idx.key } : idx.spec);
    var si = sortInfo(idx, parsed, q.sort);
    var nonBlocking = si.ok;
    var tight = [], keyFilter = [], isTight = true;
    keys.forEach(function (f, fi) {
      var p = parsed.preds[f];
      if (isTight && predBounded(p)) { tight.push(fi); if (!predPinned(p) && !(p.eq && p.multiPoint)) isTight = false; }
      else { if (predBounded(p) && !ent.multikeyPaths[f]) keyFilter.push(fi); isTight = false; }
    });
    var hashedFlags = keys.map(function (f) { return idx.key[f] === 'hashed'; });
    var covered = isCovered(idx, keys, parsed, q, ent);
    var needed = q.limit ? (q.skip || 0) + q.limit : Infinity;
    var list = ent.entries, dir = si.ok && !si.none ? si.dir : 1;
    var seen = new Set(), keysEx = 0, docsEx = 0, matched = 0, trialWorks = null, dupsDropped = 0, keyPassed = 0;
    var trialTarget = Math.min(needed, 101);
    var lo = 0, hi = list.length, p0 = tight.length && tight[0] === 0 ? parsed.preds[keys[0]] : null;
    if (p0 && predPinned(p0) && !hashedFlags[0] && !Array.isArray(p0.eq[0])) {
      var v0 = p0.eq[0], d0 = idx.key[keys[0]] === -1 ? -1 : 1;
      var bs = function (strict) {
        var a = 0, b = list.length;
        while (a < b) { var mid = (a + b) >> 1, c = cmp(list[mid].k[0], v0) * d0; if (c < 0 || (strict && c === 0)) a = mid + 1; else b = mid; }
        return a;
      };
      lo = bs(false); hi = bs(true);
    }
    for (var n = 0; n < hi - lo; n++) {
      var e = list[dir < 0 ? hi - 1 - n : lo + n], ok = true, t;
      for (t = 0; t < tight.length; t++) if (!valueInPred(e.k[tight[t]], parsed.preds[keys[tight[t]]], hashedFlags[tight[t]])) { ok = false; break; }
      if (!ok) continue;
      keysEx++;
      for (t = 0; t < keyFilter.length; t++) if (!valueInPred(e.k[keyFilter[t]], parsed.preds[keys[keyFilter[t]]], false)) { ok = false; break; }
      if (!ok) continue;
      if (seen.has(e.i)) { dupsDropped++; continue; }
      seen.add(e.i);
      keyPassed++;
      if (!covered) docsEx++;
      if (fullQuery.test(e.d)) {
        matched++;
        if (trialWorks === null && matched >= trialTarget && nonBlocking) trialWorks = keysEx + docsEx;
        if (nonBlocking && matched >= needed) break;
      }
    }
    var total = keysEx + docsEx;
    if (trialWorks === null) trialWorks = nonBlocking ? total : total + matched;
    return {
      kind: 'IXSCAN', index: idx, keys: keys, sortOk: nonBlocking, dir: dir, covered: covered,
      keysExamined: keysEx, docsExamined: docsEx, keyPassed: keyPassed, matched: matched,
      multikey: ent.multikey, multikeyPaths: ent.multikeyPaths, dupsDropped: dupsDropped,
      tightCount: tight.length, cost: trialWorks
    };
  }
  function isCovered(idx, keys, parsed, q, ent) {
    var p = q.projection;
    if (!p || !Object.keys(p).length || ent.multikey || idx.wildcard) return false;
    if (parsed.others.length || parsed.orList || parsed.text) return false;
    var incl = Object.keys(p).filter(function (k) { return k !== '_id'; });
    if (!incl.length) return false;
    if (!incl.every(function (k) { return (p[k] === 1 || p[k] === true) && keys.indexOf(k) >= 0; })) return false;
    if (!(p._id === 0 || p._id === false || keys.indexOf('_id') >= 0)) return false;
    if (!Object.keys(parsed.preds).every(function (f) { var pr = parsed.preds[f]; return keys.indexOf(f) >= 0 && !pr.other; })) return false;
    if (q.sort && !Object.keys(q.sort).every(function (f) { return keys.indexOf(f) >= 0; })) return false;
    return true;
  }
  function simulateCollScan(store, q, fullQuery, natural) {
    var needed = q.limit ? (q.skip || 0) + q.limit : Infinity, docsEx = 0, matched = 0;
    var blocking = !!(q.sort && Object.keys(q.sort).length && !natural);
    var list = store.docs, rev = natural && natural < 0;
    for (var n = 0; n < list.length; n++) {
      var d = list[rev ? list.length - 1 - n : n];
      docsEx++;
      if (fullQuery.test(d)) { matched++; if (!blocking && matched >= needed) break; }
    }
    return { kind: 'COLLSCAN', keysExamined: 0, docsExamined: docsEx, matched: matched, sortOk: !blocking, dir: rev ? -1 : 1, cost: docsEx + (blocking ? matched : 0) };
  }
  function simulateOr(store, parsed, q, fullQuery) {
    var branches = [];
    for (var b = 0; b < parsed.orList.length; b++) {
      var bp = parsePreds(parsed.orList[b]);
      var cands = candidateIndexes(store, bp, null);
      if (!cands.length) return null;
      var bq = compileQuery(parsed.orList[b]);
      var best = null;
      cands.forEach(function (c) {
        var s = simulateIndexPlan(store, c, bp, { projection: null }, bq);
        if (!best || s.cost < best.cost) best = s;
      });
      best.parsed = bp;
      best.parsedPreds = bp.preds;
      branches.push(best);
    }
    var keysEx = 0, docSet = new Set();
    branches.forEach(function (s) {
      keysEx += s.keysExamined;
      var ent = indexEntries(store, s.index.wildcard ? { name: 'wc:' + s.index.name, key: s.index.key } : s.index.spec);
      ent.entries.forEach(function (e) {
        var ok = s.keys.every(function (f, fi) { var p = s.parsed.preds[f]; return !predBounded(p) || valueInPred(e.k[fi], p, s.index.key[f] === 'hashed'); });
        if (ok) docSet.add(e.i);
      });
    });
    var matched = 0;
    docSet.forEach(function (i) { if (fullQuery.test(store.docs[i])) matched++; });
    var blocking = !!(q.sort && Object.keys(q.sort).length);
    return { kind: 'OR', branches: branches, keysExamined: keysEx, docsExamined: docSet.size, matched: matched, sortOk: !blocking, cost: keysEx + docSet.size + (blocking ? matched : 0) };
  }

  /* Decide the winning plan; returns { win, rejected } with counters. */
  function planQuery(store, filter, q) {
    var parsed = parsePreds(filter);
    var fullQuery = compileQuery(stripText(filter));
    if (parsed.text) {
      var ts = textSearch(store, parsed.text), matched = 0;
      ts.scores.forEach(function (_, doc) { if (fullQuery.test(doc)) matched++; });
      return { win: { kind: 'TEXT', index: ts.index, keysExamined: ts.postings, docsExamined: ts.scores.size, matched: matched, terms: ts.terms, sortOk: !(q.sort && Object.keys(q.sort).length) }, rejected: [], parsed: parsed };
    }
    if (q.hint) {
      if (q.hint.$natural) return { win: simulateCollScan(store, q, fullQuery, q.hint.$natural), rejected: [], parsed: parsed, hinted: true };
      var hinted = store.indexes.filter(function (i) { return typeof q.hint === 'string' ? i.name === q.hint : keyOf(i.key) === keyOf(q.hint); })[0];
      if (!hinted) throw serverError('error processing query: planner returned error :: caused by :: hint provided does not correspond to an existing index', 2, 'BadValue');
      return { win: simulateIndexPlan(store, { name: hinted.name, key: hinted.key, display: hinted.key, spec: hinted }, parsed, q, fullQuery), rejected: [], parsed: parsed, hinted: true };
    }
    var cands = candidateIndexes(store, parsed, q.sort);
    var sims = cands.map(function (c) { return simulateIndexPlan(store, c, parsed, q, fullQuery); });
    if (parsed.orList && parsed.orList.length) {
      var orSim = simulateOr(store, parsed, q, fullQuery);
      if (orSim) sims.push(orSim);
    }
    if (!sims.length) return { win: simulateCollScan(store, q, fullQuery), rejected: [], parsed: parsed };
    sims.forEach(function (s, i) { s.order = i; });
    sims.sort(function (a, b) {
      if (a.cost !== b.cost) return a.cost - b.cost;
      if (!!b.covered !== !!a.covered) return b.covered ? 1 : -1;
      if (b.sortOk !== a.sortOk) return b.sortOk ? 1 : -1;
      if ((b.tightCount || 0) !== (a.tightCount || 0)) return (b.tightCount || 0) - (a.tightCount || 0);
      return a.order - b.order;
    });
    return { win: sims[0], rejected: sims.slice(1), parsed: parsed };
  }
  function stripText(filter) {
    if (!filter || !filter.$text) return filter || {};
    var f = {};
    Object.keys(filter).forEach(function (k) { if (k !== '$text') f[k] = filter[k]; });
    return f;
  }
  function simMillis(s) { return Math.round((s.keysExamined || 0) * 0.004 + (s.docsExamined || 0) * 0.03 + (s.sortOk ? 0 : (s.matched || 0) * 0.01)); }
  function planSummary(s) {
    if (s.kind === 'COLLSCAN') return 'COLLSCAN';
    if (s.kind === 'TEXT') return 'IXSCAN { ' + Object.keys(s.index.key).map(function (k) { return k + ': "text"'; }).join(', ') + ' }';
    if (s.kind === 'OR') return s.branches.map(planSummary).join(', ');
    return 'IXSCAN ' + fmtInline(s.index.display, 0);
  }
  function residualFilter(filter, s) {
    if (s.kind !== 'IXSCAN') return filter;
    var out = {};
    Object.keys(filter || {}).forEach(function (k) {
      var idxPos = s.keys.indexOf(k);
      if (idxPos < 0 || s.multikeyPaths[k] || k.charAt(0) === '$') out[k] = filter[k];
      else { var v = filter[k]; if (isOperatorObj(v) && Object.keys(v).some(function (o) { return ['$eq', '$in', '$gt', '$gte', '$lt', '$lte', '$ne', '$nin'].indexOf(o) < 0; })) out[k] = v; }
    });
    return Object.keys(out).length ? out : null;
  }
  function normalizeQuery(filter) {
    var parts = [];
    Object.keys(filter || {}).forEach(function (k) {
      var v = filter[k];
      if (k.charAt(0) === '$') { var o = {}; o[k] = v; parts.push(o); return; }
      if (isOperatorObj(v)) Object.keys(v).forEach(function (op) { var o = {}, c = {}; c[op] = v[op]; o[k] = c; parts.push(o); });
      else { var o2 = {}; o2[k] = { $eq: v }; parts.push(o2); }
    });
    if (!parts.length) return {};
    return parts.length === 1 ? parts[0] : { $and: parts };
  }
  function shapeHash(filter, sort, proj) {
    function shape(v) {
      if (Array.isArray(v)) return '[' + v.map(shape).join(',') + ']';
      if (isObj(v)) return '{' + Object.keys(v).sort().map(function (k) { return k + ':' + (k.charAt(0) === '$' || isObj(v[k]) || Array.isArray(v[k]) ? shape(v[k]) : '?'); }).join(',') + '}';
      return '?';
    }
    return hex(hashStr(shape(filter) + '|' + keyOf(sort || {}) + '|' + keyOf(proj || {})), 8).toUpperCase();
  }

  function buildStages(s, filter, q, withStats, ns) {
    var ms = simMillis(s);
    function stat(o, extra) { if (withStats) { o.nReturned = extra.n; o.executionTimeMillisEstimate = extra.ms || 0; o.works = extra.works; } return o; }
    var tree, ixsLocal = null;
    if (s.kind === 'COLLSCAN') {
      tree = stat({ stage: 'COLLSCAN' }, { n: s.matched, works: s.docsExamined + 1, ms: ms });
      var f = normalizeQuery(filter);
      if (Object.keys(f).length) tree.filter = f;
      tree.direction = s.dir < 0 ? 'backward' : 'forward';
      if (withStats) tree.docsExamined = s.docsExamined;
    } else if (s.kind === 'TEXT') {
      var ix = stat({ stage: 'IXSCAN', keyPattern: { _fts: 'text', _ftsx: 1 }, indexName: s.index.name, isMultiKey: true, direction: 'backward', indexBounds: {} }, { n: s.keysExamined, works: s.keysExamined + 1 });
      if (withStats) ix.keysExamined = s.keysExamined;
      tree = stat({ stage: 'TEXT_MATCH', indexPrefix: {}, indexName: s.index.name, parsedTextQuery: { terms: s.terms, negatedTerms: [], phrases: [], negatedPhrases: [] }, inputStage: stat({ stage: 'TEXT_OR', inputStage: ix }, { n: s.docsExamined, works: s.keysExamined + 1 }) }, { n: s.matched, works: s.keysExamined + 1, ms: ms });
      if (withStats) tree.inputStage.docsExamined = s.docsExamined;
    } else if (s.kind === 'OR') {
      var inputs = s.branches.map(function (b) { return buildStages(b, null, { projection: null }, withStats, ns).ixscan; });
      tree = stat({ stage: 'FETCH', filter: normalizeQuery(filter), inputStage: stat({ stage: 'OR', inputStages: inputs }, { n: s.docsExamined, works: s.keysExamined + 1 }) }, { n: s.matched, works: s.keysExamined + s.docsExamined + 1, ms: ms });
      if (withStats) tree.docsExamined = s.docsExamined;
      tree = { stage: 'SUBPLAN', inputStage: tree };
    } else {
      var bounds = {};
      s.keys.forEach(function (f, fi) {
        var p = s.index.key[f] === 'hashed' && s.parsedPreds && s.parsedPreds[f] ? { eq: s.parsedPreds[f].eq.map(function (v) { return hashStr(keyOf(v)); }) } : (s.parsedPreds || {})[f];
        bounds[f] = intervalsFor(p, (s.index.key[f] === -1 ? -1 : 1) * s.dir);
      });
      var mkp = {};
      s.keys.forEach(function (f) { mkp[f] = s.multikeyPaths[f] ? [f] : []; });
      var ixs = stat({ stage: 'IXSCAN', keyPattern: s.index.display, indexName: s.index.name, isMultiKey: !!s.multikey, multiKeyPaths: mkp,
        isUnique: !!s.index.spec.unique || s.index.name === '_id_', isSparse: !!s.index.spec.sparse, isPartial: !!s.index.spec.partialFilterExpression,
        indexVersion: 2, direction: s.dir < 0 ? 'backward' : 'forward', indexBounds: bounds }, { n: s.keyPassed, works: s.keysExamined + 1 });
      if (withStats) { ixs.keysExamined = s.keysExamined; ixs.seeks = 1; ixs.dupsTested = s.multikey ? s.keysExamined : 0; ixs.dupsDropped = s.dupsDropped; }
      ixsLocal = ixs;
      if (s.covered) tree = ixs;
      else {
        var rf = residualFilter(filter, s);
        tree = stat({ stage: 'FETCH' }, { n: s.matched, works: s.keysExamined + s.docsExamined + 1, ms: ms });
        if (rf) tree.filter = normalizeQuery(rf);
        if (withStats) tree.docsExamined = s.docsExamined;
        tree.inputStage = ixs;
      }
    }
    var root = tree;
    var returned = Math.max(0, Math.min(s.matched - (q.skip || 0), q.limit || Infinity));
    if (q.sort && Object.keys(q.sort).length && !s.sortOk) {
      root = stat({ stage: 'SORT', sortPattern: q.sort, memLimit: 104857600, type: 'simple' }, { n: (q.limit ? Math.min(s.matched, (q.skip || 0) + q.limit) : s.matched), works: s.matched + 2, ms: ms });
      if (q.limit) root.limitAmount = (q.skip || 0) + q.limit;
      if (withStats) { root.totalDataSizeSorted = s.matched * 280; root.usedDisk = false; root.spills = 0; }
      root.inputStage = tree;
      tree = root;
    }
    if (q.projection && Object.keys(q.projection).length) {
      var simple = Object.keys(q.projection).every(function (k) { return k.indexOf('.') < 0 && (q.projection[k] === 0 || q.projection[k] === 1 || q.projection[k] === true || q.projection[k] === false); });
      root = stat({ stage: s.covered ? 'PROJECTION_COVERED' : (simple ? 'PROJECTION_SIMPLE' : 'PROJECTION_DEFAULT'), transformBy: q.projection }, { n: returned, works: s.matched + 1 });
      root.inputStage = tree; tree = root;
    }
    if (q.skip) { root = stat({ stage: 'SKIP', skipAmount: q.skip }, { n: returned, works: s.matched + 1 }); root.inputStage = tree; tree = root; }
    if (q.limit && (s.sortOk || !(q.sort && Object.keys(q.sort).length))) { root = stat({ stage: 'LIMIT', limitAmount: q.limit }, { n: returned, works: returned + 1 }); root.inputStage = tree; tree = root; }
    return { tree: tree, ixscan: ixsLocal || tree, returned: returned };
  }

  function buildExplain(store, ns, filter, q, verbosity, extraCommand) {
    var plan = planQuery(store, filter || {}, q);
    var withStats = verbosity !== 'queryPlanner';
    plan.win.parsedPreds = plan.parsed.preds;
    plan.rejected.forEach(function (r) { r.parsedPreds = plan.parsed.preds; });
    var win = buildStages(plan.win, filter, q, false, ns);
    var out = {
      explainVersion: '1',
      queryPlanner: {
        namespace: ns,
        parsedQuery: normalizeQuery(filter),
        indexFilterSet: false,
        queryHash: shapeHash(filter, q.sort, q.projection),
        planCacheKey: hex(hashStr(ns + shapeHash(filter, q.sort, q.projection)), 8).toUpperCase(),
        maxIndexedOrSolutionsReached: false,
        maxIndexedAndSolutionsReached: false,
        maxScansToExplodeReached: false,
        winningPlan: win.tree,
        rejectedPlans: plan.rejected.map(function (r) { return buildStages(r, filter, q, false, ns).tree; })
      }
    };
    if (withStats) {
      var exec = buildStages(plan.win, filter, q, true, ns);
      out.executionStats = {
        executionSuccess: true,
        nReturned: exec.returned,
        executionTimeMillis: simMillis(plan.win),
        totalKeysExamined: plan.win.keysExamined || 0,
        totalDocsExamined: plan.win.docsExamined || 0,
        executionStages: exec.tree
      };
      if (verbosity === 'allPlansExecution') {
        out.executionStats.allPlansExecution = plan.rejected.map(function (r) {
          return { nReturned: Math.min(r.matched, 101), executionTimeMillisEstimate: simMillis(r), totalKeysExamined: r.keysExamined, totalDocsExamined: r.docsExamined, score: Math.round(1000 * (1 + Math.min(r.matched, 101) / Math.max(1, r.cost))) / 1000, executionStages: buildStages(r, filter, q, true, ns).tree };
        });
      }
    }
    var cmd = { find: ns.split('.').slice(1).join('.'), filter: filter || {} };
    if (q.sort) cmd.sort = q.sort;
    if (q.projection) cmd.projection = q.projection;
    if (q.skip) cmd.skip = q.skip;
    if (q.limit) cmd.limit = q.limit;
    if (q.hint) cmd.hint = q.hint;
    cmd.$db = ns.split('.')[0];
    out.command = extraCommand || cmd;
    out.serverInfo = { host: 'mastery-sim:27017', port: 27017, version: '8.0.4', gitVersion: 'in-browser-simulator' };
    out.ok = 1;
    out.simulatorNote = 'Plan choice and counters come from the MongoDB Mastery planner model, not a real mongod. Shapes follow the classic engine.';
    return { explain: out, plan: plan };
  }

  /* ------------------------------------------------------------------
     Engine state
     ------------------------------------------------------------------ */
  var seedCache = null;
  function seedData() { if (!seedCache) seedCache = MM.seed(); return seedCache; }
  function idIndex() { return { v: 2, key: { _id: 1 }, name: '_id_', createdAt: new Date() }; }
  function newStore(ns, options) {
    return { ns: ns, docs: [], indexes: [idIndex()], options: options || {}, ixCache: {}, uniq: null, version: 0, dirty: true, usage: {} };
  }

  function Engine(opts) {
    opts = opts || {};
    this.persistKey = opts.persist ? 'mm-shell-db-v1' : null;
    this.currentDb = 'shop';
    this.sessions = [];
    this.watchers = [];
    this.opcounters = { insert: 0, query: 0, update: 0, delete: 0, getmore: 0, command: 0 };
    this.profiling = {};
    this.startedAt = new Date();
    this.lastPipeline = null;
    this.lastExplain = null;
    this.reset(true);
    if (this.persistKey) this.load();
  }
  MM.Engine = Engine;
  var EP = Engine.prototype;

  EP.reset = function (silent) {
    var seed = seedData();
    this.dbs = { shop: {}, admin: {}, config: {}, local: {} };
    var shop = this.dbs.shop;
    Object.keys(seed).forEach(function (name) {
      var st = newStore('shop.' + name);
      st.docs = seed[name].map(clone);
      st.dirty = false;
      shop[name] = st;
    });
    this.dbs.admin['system.version'] = newStore('admin.system.version');
    this.dbs.admin['system.version'].docs = [{ _id: 'featureCompatibilityVersion', version: '8.0' }];
    this.dbs.admin['system.version'].dirty = false;
    this.dbs.local['startup_log'] = newStore('local.startup_log');
    this.dbs.local['startup_log'].dirty = false;
    this.currentDb = 'shop';
    this.profiling = {};
    if (!silent && this.persistKey) { try { localStorage.removeItem(this.persistKey); } catch (e) { /* storage disabled */ } }
  };
  EP.getStore = function (db, coll, create) {
    var d = this.dbs[db];
    if (!d) { if (!create) return null; d = this.dbs[db] = {}; }
    var s = d[coll];
    if (!s && create) {
      if (!/^[^$\0]+$/.test(coll) || coll.charAt(0) === '.' || /\.$/.test(coll)) throw serverError("Invalid collection name: '" + coll + "'", 73, 'InvalidNamespace');
      s = d[coll] = newStore(db + '.' + coll);
    }
    return s || null;
  };
  EP.dbNames = function () {
    var self = this;
    return Object.keys(this.dbs).filter(function (n) { return Object.keys(self.dbs[n]).length; });
  };
  EP.touch = function (store) {
    store.version++;
    store.ixCache = {};
    store.dirty = true;
    this._dirty = true;
  };

  /* ---------- persistence ---------- */
  function encode(v) {
    if (v === null || typeof v !== 'object') return v;
    if (isDate(v)) return { $date: v.getTime() };
    if (isRegExp(v)) return { $regex: v.source, $flags: v.flags };
    if (Array.isArray(v)) return v.map(encode);
    var o = {}; for (var k in v) if (hasOwn.call(v, k)) o[k] = encode(v[k]); return o;
  }
  function decode(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(decode);
    var ks = Object.keys(v);
    if (ks.length === 1 && ks[0] === '$date') return new Date(v.$date);
    if (ks.length === 2 && hasOwn.call(v, '$regex') && hasOwn.call(v, '$flags')) return new RegExp(v.$regex, v.$flags);
    var o = {}; ks.forEach(function (k) { o[k] = decode(v[k]); }); return o;
  }
  EP.save = function () {
    if (!this.persistKey || !this._dirty) return { ok: true };
    var self = this, out = { v: 1, currentDb: this.currentDb, dbs: {} };
    Object.keys(this.dbs).forEach(function (dn) {
      out.dbs[dn] = {};
      Object.keys(self.dbs[dn]).forEach(function (cn) {
        var s = self.dbs[dn][cn];
        var e = { indexes: encode(s.indexes), options: encode(s.options), usage: s.usage };
        if (s.dirty) e.docs = encode(s.docs);
        out.dbs[dn][cn] = e;
      });
    });
    try { localStorage.setItem(this.persistKey, JSON.stringify(out)); this._dirty = false; return { ok: true }; }
    catch (err) { return { ok: false, error: 'Changes are kept for this session but are too large to save in browser storage.' }; }
  };
  EP.load = function () {
    var raw;
    try { raw = localStorage.getItem(this.persistKey); } catch (e) { return; }
    if (!raw) return;
    try {
      var data = JSON.parse(raw), self = this;
      if (data.v !== 1) return;
      var seeded = this.dbs;
      this.dbs = {};
      Object.keys(data.dbs).forEach(function (dn) {
        self.dbs[dn] = {};
        Object.keys(data.dbs[dn]).forEach(function (cn) {
          var e = data.dbs[dn][cn], s = newStore(dn + '.' + cn, decode(e.options));
          s.indexes = decode(e.indexes);
          s.usage = e.usage || {};
          if (e.docs) s.docs = decode(e.docs);
          else if (seeded[dn] && seeded[dn][cn]) { s.docs = seeded[dn][cn].docs; s.dirty = false; }
          else s.dirty = false;
          self.dbs[dn][cn] = s;
        });
      });
      this.currentDb = data.currentDb || 'shop';
    } catch (err) { this.reset(true); }
  };

  /* ---------- TTL monitor (runs at the start of each shell run) ---------- */
  EP.ttlPass = function () {
    var self = this, now = Date.now();
    Object.keys(this.dbs).forEach(function (dn) {
      Object.keys(self.dbs[dn]).forEach(function (cn) {
        var s = self.dbs[dn][cn];
        s.indexes.forEach(function (idx) {
          if (typeof idx.expireAfterSeconds !== 'number') return;
          var f = Object.keys(idx.key)[0], before = s.docs.length;
          s.docs = s.docs.filter(function (d) {
            var v = getExact(d, f), dates = Array.isArray(v) ? v.filter(isDate) : (isDate(v) ? [v] : []);
            if (!dates.length) return true;
            var earliest = Math.min.apply(null, dates.map(function (x) { return x.getTime(); }));
            return earliest + idx.expireAfterSeconds * 1000 > now;
          });
          if (s.docs.length !== before) { s.uniq = null; self.touch(s); }
        });
      });
    });
  };

  /* ---------- unique index enforcement ---------- */
  function uniqueKeys(idx, doc) {
    var keys = Object.keys(idx.key);
    if (idx.partialFilterExpression && !compileQuery(idx.partialFilterExpression).test(doc)) return [];
    var per = keys.map(function (f) { return indexValues(doc, f); });
    if (idx.sparse && per.every(function (v) { return v.length === 1 && v[0] === undefined; })) return [];
    var combos = [[]];
    per.forEach(function (vals) { var n = []; combos.forEach(function (c) { vals.forEach(function (v) { n.push(c.concat([v === undefined ? null : v])); }); }); combos = n; });
    return combos.map(function (c) { return { str: keyOf(c), vals: c }; });
  }
  function uniqueMaps(store) {
    if (store.uniq) return store.uniq;
    var maps = {};
    store.indexes.forEach(function (idx) {
      if (!(idx.unique || idx.name === '_id_')) return;
      var m = new Map();
      store.docs.forEach(function (d) { uniqueKeys(idx, d).forEach(function (k) { if (!m.has(k.str)) m.set(k.str, d); }); });
      maps[idx.name] = m;
    });
    store.uniq = maps;
    return maps;
  }
  function dupError(store, idx, vals) {
    var parts = Object.keys(idx.key).map(function (f, i) { return f + ': ' + (typeof vals[i] === 'string' ? (isOid(vals[i]) ? "ObjectId('" + vals[i] + "')" : '"' + vals[i] + '"') : fmtInline(vals[i], 0)); });
    return serverError('E11000 duplicate key error collection: ' + store.ns + ' index: ' + idx.name + ' dup key: { ' + parts.join(', ') + ' }', 11000, 'DuplicateKey', { keyPattern: idx.key, keyValue: (function () { var o = {}; Object.keys(idx.key).forEach(function (f, i) { o[f] = vals[i]; }); return o; })() });
  }
  function checkUnique(store, doc, self) {
    var maps = uniqueMaps(store);
    store.indexes.forEach(function (idx) {
      var m = maps[idx.name];
      if (!m) return;
      uniqueKeys(idx, doc).forEach(function (k) {
        var other = m.get(k.str);
        if (other && other !== self) throw dupError(store, idx, k.vals);
      });
    });
  }
  function removeUnique(store, doc) {
    if (!store.uniq) return;
    store.indexes.forEach(function (idx) {
      var m = store.uniq[idx.name];
      if (m) uniqueKeys(idx, doc).forEach(function (k) { if (m.get(k.str) === doc) m.delete(k.str); });
    });
  }
  function addUnique(store, doc) {
    if (!store.uniq) return;
    store.indexes.forEach(function (idx) {
      var m = store.uniq[idx.name];
      if (m) uniqueKeys(idx, doc).forEach(function (k) { m.set(k.str, doc); });
    });
  }

  /* ---------- writes (single choke point for txn, events, validation) ---------- */
  EP._validateOrWarn = function (store, doc, existing) {
    if (store.options.validationLevel === 'moderate' && existing && validateDoc(store, existing)) return;
    var errs = validateDoc(store, doc);
    if (!errs) return;
    if (store.options.validationAction === 'warn') { this._warn && this._warn('Document failed validation (validationAction: "warn", write allowed): ' + errs.join('; ')); return; }
    throw serverError('Document failed validation', 121, 'DocumentValidationFailure', { errInfo: { failingDocumentId: doc._id, details: errs } });
  };
  EP._conflictCheck = function (store, id) {
    var idk = keyOf(id), self = this;
    this.sessions.forEach(function (sess) {
      var t = sess.txn;
      if (!t || t === store.txn) return;
      var w = t.colls[store.ns];
      if (w && w.touched.has(idk)) {
        if (store.txn) throw serverError('WriteConflict error: this operation conflicted with another operation. Please retry your operation or multi-document transaction.', 112, 'WriteConflict', { errorLabels: ['TransientTransactionError'] });
        throw serverError('Simulator: this document is held by an open transaction. A real mongod would make this write wait until that transaction commits or aborts (or hits maxTransactionLockRequestTimeoutMillis).', 24, 'LockTimeout');
      }
    });
    if (store.txn) {
      var committed = self.getStore(store.ns.split('.')[0], store.ns.split('.').slice(1).join('.'), false);
      var cur = committed ? committed.docs.filter(function (d) { return keyOf(d._id) === idk; })[0] : undefined;
      var curStr = cur ? keyOf(cur) : null, snap = store.snapshot.has(idk) ? store.snapshot.get(idk) : null;
      if (curStr !== snap) throw serverError('WriteConflict error: the document was modified outside this transaction after its snapshot was taken.', 112, 'WriteConflict', { errorLabels: ['TransientTransactionError'] });
      store.touched.add(idk);
    }
  };
  EP._insert = function (store, doc) {
    if (store.options.viewOn) throw serverError('Namespace ' + store.ns + ' is a view, not a collection', 166, 'CommandNotSupportedOnView');
    if (!isObj(doc)) throw serverError('document must be an object', 2, 'BadValue');
    doc = toBson(doc);
    if (!hasOwn.call(doc, '_id')) { var withId = { _id: newOid() }; Object.keys(doc).forEach(function (k) { withId[k] = doc[k]; }); doc = withId; }
    if (Array.isArray(doc._id)) throw serverError("can't use an array for _id", 2, 'BadValue');
    Object.keys(doc).forEach(function (k) { if (k.charAt(0) === '$') throw serverError("Document can't have $ prefixed field names: " + k, 52, 'DollarPrefixedFieldName'); });
    this._validateOrWarn(store, doc, null);
    checkUnique(store, doc, null);
    if (store.txn) this._conflictCheck(store, doc._id);
    store.docs.push(doc);
    addUnique(store, doc);
    if (store.options.capped && store.options.max && store.docs.length > store.options.max) { store.docs.shift(); store.uniq = null; }
    this.touch(store);
    this.opcounters.insert++;
    if (!store.txn) this._event(store, { operationType: 'insert', fullDocument: clone(doc), documentKey: { _id: doc._id } });
    return doc._id;
  };
  EP._replaceDoc = function (store, oldDoc, newDoc, opType, extra) {
    if (keyOf(oldDoc._id) !== keyOf(newDoc._id)) throw serverError("Performing an update on the path '_id' would modify the immutable field '_id'", 66, 'ImmutableField');
    if (keyOf(oldDoc) === keyOf(newDoc)) return false;
    this._validateOrWarn(store, newDoc, oldDoc);
    checkUnique(store, newDoc, oldDoc);
    if (store.options.capped) { /* capped collections allow updates in modern servers */ }
    this._conflictCheck(store, oldDoc._id);
    var i = store.docs.indexOf(oldDoc);
    store.docs[i] = newDoc;
    removeUnique(store, oldDoc);
    addUnique(store, newDoc);
    this.touch(store);
    if (!store.txn) this._event(store, buildUpdateEvent(oldDoc, newDoc, opType, extra));
    return true;
  };
  EP._remove = function (store, doc) {
    this._conflictCheck(store, doc._id);
    var i = store.docs.indexOf(doc);
    if (i >= 0) store.docs.splice(i, 1);
    removeUnique(store, doc);
    this.touch(store);
    this.opcounters.delete++;
    if (!store.txn) this._event(store, { operationType: 'delete', documentKey: { _id: doc._id }, fullDocumentBeforeChange: clone(doc) });
  };
  function buildUpdateEvent(oldDoc, newDoc, opType, extra) {
    if (opType === 'replace') return { operationType: 'replace', documentKey: { _id: newDoc._id }, fullDocument: clone(newDoc), fullDocumentBeforeChange: clone(oldDoc) };
    var updated = {}, removed = [];
    (function diff(a, b, p) {
      Object.keys(b).forEach(function (k) {
        var path = p ? p + '.' + k : k;
        if (!hasOwn.call(a, k)) updated[path] = clone(b[k]);
        else if (isObj(a[k]) && isObj(b[k])) diff(a[k], b[k], path);
        else if (keyOf(a[k]) !== keyOf(b[k])) updated[path] = clone(b[k]);
      });
      Object.keys(a).forEach(function (k) { if (!hasOwn.call(b, k)) removed.push(p ? p + '.' + k : k); });
    })(oldDoc, newDoc, '');
    return { operationType: 'update', documentKey: { _id: newDoc._id }, updateDescription: { updatedFields: updated, removedFields: removed, truncatedArrays: [] }, fullDocument: clone(newDoc), fullDocumentBeforeChange: clone(oldDoc), _extra: extra };
  }

  /* ---------- change streams ---------- */
  var tokenSeq = 0;
  /* Simplified local.oplog.rs: entries record resulting values (idempotent), not operators such as $inc. */
  EP._oplog = function (store, ev) {
    if (!MM.Timestamp || /^(local|config)\./.test(store.ns) || /\.system\.profile$/.test(store.ns)) return;
    var local = this.dbs.local || (this.dbs.local = {});
    var op = local['oplog.rs'];
    if (!op) { op = local['oplog.rs'] = newStore('local.oplog.rs', { capped: true, size: 53687091200 }); op.indexes = []; }
    var now = new Date(), secs = Math.floor(now.getTime() / 1000);
    this._opInc = secs === this._opSecs ? this._opInc + 1 : 1;
    this._opSecs = secs;
    var parts = store.ns.split('.'), id = ev.documentKey ? ev.documentKey._id : undefined, e;
    if (ev.operationType === 'insert') e = { op: 'i', ns: store.ns, o: clone(ev.fullDocument), o2: { _id: id } };
    else if (ev.operationType === 'delete') e = { op: 'd', ns: store.ns, o: { _id: id } };
    else if (ev.operationType === 'replace') e = { op: 'u', ns: store.ns, o: clone(ev.fullDocument), o2: { _id: id } };
    else if (ev.operationType === 'update') {
      var diff = {}, u = ev.updateDescription.updatedFields, d = ev.updateDescription.removedFields;
      if (Object.keys(u).length) diff.u = clone(u);
      if (d.length) { diff.d = {}; d.forEach(function (f) { diff.d[f] = false; }); }
      e = { op: 'u', ns: store.ns, o: { $v: 2, diff: diff }, o2: { _id: id } };
    } else if (ev.operationType === 'drop') e = { op: 'c', ns: parts[0] + '.$cmd', o: { drop: parts.slice(1).join('.') } };
    else return;
    e.ts = new MM.Timestamp(secs, this._opInc); e.t = 1; e.v = 2; e.wall = now;
    op.docs.push(e);
    if (op.docs.length > 3000) op.docs.splice(0, 1000);
    op.version++; op.ixCache = {}; op.dirty = false;
  };
  EP._event = function (store, ev) {
    this._oplog(store, ev);
    /* History is only kept once a change stream has been opened, so bulk loads stay cheap; it plays the role of the oplog window for resumeAfter. */
    if (!this.watchers.length && !this.csHistory) return;
    tokenSeq++;
    var parts = store.ns.split('.'), now = new Date();
    ev._id = { _data: '82' + hex(Math.floor(now.getTime() / 1000), 8).toUpperCase() + hex(tokenSeq, 8).toUpperCase() + '2B042C0100296E5A1004' };
    ev.clusterTime = { t: Math.floor(now.getTime() / 1000), i: tokenSeq };
    ev.wallTime = now;
    ev.ns = { db: parts[0], coll: parts.slice(1).join('.') };
    this.csHistory.push(ev);
    if (this.csHistory.length > 2000) this.csHistory.shift();
    this.watchers.forEach(function (w) { w._offer(ev); });
  };
  function ChangeStream(engine, scope, pipeline, options) {
    this._engine = engine; this._scope = scope; this._pipeline = pipeline || []; this._options = options || {};
    this._queue = []; this._closed = false; this._token = null;
    engine.csHistory = engine.csHistory || [];
    var tok = this._options.resumeAfter || this._options.startAfter;
    if (tok) {
      var data = tok && tok._data, hist = engine.csHistory, at = -1;
      for (var i = 0; i < hist.length; i++) if (hist[i]._id._data === data) { at = i; break; }
      if (at < 0) throw serverError('Resume of change stream was not possible, as the resume point may no longer be in the oplog.', 286, 'ChangeStreamHistoryLost');
      for (var j = at + 1; j < hist.length; j++) this._offer(hist[j]);
    }
    engine.watchers.push(this);
  }
  ChangeStream.prototype._offer = function (ev) {
    if (this._closed) return;
    if (this._scope.db && ev.ns.db !== this._scope.db) return;
    if (this._scope.coll && ev.ns.coll !== this._scope.coll) return;
    var e = clone(ev);
    delete e._extra;
    var fd = this._options.fullDocument, fdb = this._options.fullDocumentBeforeChange;
    if (e.operationType === 'update' && !(fd === 'updateLookup' || fd === 'whenAvailable' || fd === 'required')) delete e.fullDocument;
    if (!(fdb === 'whenAvailable' || fdb === 'required')) delete e.fullDocumentBeforeChange;
    if (e.operationType === 'delete') delete e.fullDocument;
    var ordered = { _id: e._id, operationType: e.operationType, clusterTime: e.clusterTime, wallTime: e.wallTime };
    Object.keys(e).forEach(function (k) { if (!(k in ordered)) ordered[k] = e[k]; });
    var out = this._pipeline.length ? mingo.aggregate([ordered], this._pipeline) : [ordered];
    Array.prototype.push.apply(this._queue, out);
  };
  ChangeStream.prototype.tryNext = function () { var e = this._queue.shift() || null; if (e) this._token = e._id; return e; };
  ChangeStream.prototype.hasNext = function () { return this._queue.length > 0; };
  ChangeStream.prototype.next = function () {
    if (!this._queue.length) throw new Error('No change events are pending. A real change stream would block here; the simulator returns immediately. Use tryNext() in loops.');
    return this.tryNext();
  };
  ChangeStream.prototype.getResumeToken = function () { return this._token; };
  ChangeStream.prototype.isClosed = function () { return this._closed; };
  ChangeStream.prototype.close = function () { this._closed = true; var w = this._engine.watchers, i = w.indexOf(this); if (i >= 0) w.splice(i, 1); };
  ChangeStream.prototype.__mmDisplay = function () { return 'ChangeStreamCursor on ' + (this._scope.coll ? this._scope.db + '.' + this._scope.coll : (this._scope.db || 'cluster')) + ' (' + this._queue.length + ' pending event' + (this._queue.length === 1 ? '' : 's') + ')'; };
  MM.ChangeStream = ChangeStream;

  /* ------------------------------------------------------------------
     Update application
     ------------------------------------------------------------------ */
  function positionalIndex(doc, prefix, filter) {
    var sub = {};
    (function walk(f) {
      Object.keys(f || {}).forEach(function (k) {
        if (k === '$and' && Array.isArray(f.$and)) f.$and.forEach(walk);
        else if (k === prefix || k.indexOf(prefix + '.') === 0) sub[k] = f[k];
      });
    })(filter);
    var arr = getExact(doc, prefix);
    if (!Object.keys(sub).length || !Array.isArray(arr)) throw serverError('The positional operator did not find the match needed from the query.', 2, 'BadValue');
    var q = compileQuery(sub);
    for (var i = 0; i < arr.length; i++) if (q.test(setExact({}, prefix, [arr[i]]))) return i;
    throw serverError('The positional operator did not find the match needed from the query.', 2, 'BadValue');
  }
  function applyUpdate(doc, update, filter, arrayFilters, isInsert) {
    if (Array.isArray(update)) {
      var res;
      try { res = mingo.aggregate([clone(doc)], update)[0]; } catch (e) { throw serverError(String(e.message || e), 2, 'BadValue'); }
      if (!res) throw serverError('pipeline update produced no document', 2, 'BadValue');
      if (!hasOwn.call(res, '_id')) res._id = doc._id;
      return res;
    }
    var out = clone(doc), paths = [];
    Object.keys(update).forEach(function (op) {
      var spec = update[op];
      if (!isObj(spec)) throw serverError('Modifiers operate on fields but we found type ' + bsonTypeOf(spec) + ' instead. For example: {$mod: {<field>: ...}} not {' + op + ': ' + fmtInline(spec, 0) + '}', 9, 'FailedToParse');
      Object.keys(spec).forEach(function (field) {
        var real = field;
        if (/(^|\.)\$(\.|$)/.test(field)) {
          var prefix = field.split('.$')[0];
          real = field.replace(/(^|\.)\$(\.|$)/, '$1' + positionalIndex(out, prefix, filter) + '$2');
        }
        paths.push(real.replace(/\.\$\[[^\]]*\]/g, ''));
        if (op === '$rename' && typeof spec[field] === 'string') paths.push(spec[field]);
      });
    });
    for (var a = 0; a < paths.length; a++) for (var b = a + 1; b < paths.length; b++) {
      var x = paths[a], y = paths[b];
      if (x === y || x.indexOf(y + '.') === 0 || y.indexOf(x + '.') === 0) throw serverError("Updating the path '" + y + "' would create a conflict at '" + x + "'", 40, 'ConflictingUpdateOperators');
    }
    Object.keys(update).forEach(function (op) {
      var spec = update[op], fixed = {};
      Object.keys(spec).forEach(function (field) {
        var real = field;
        if (/(^|\.)\$(\.|$)/.test(field)) {
          var prefix = field.split('.$')[0];
          real = field.replace(/(^|\.)\$(\.|$)/, '$1' + positionalIndex(out, prefix, filter) + '$2');
        }
        fixed[real] = spec[field];
      });
      if (op === '$setOnInsert') { if (isInsert) Object.keys(fixed).forEach(function (f) { setExact(out, f, toBson(fixed[f])); }); return; }
      if (op === '$currentDate') { Object.keys(fixed).forEach(function (f) { setExact(out, f, new Date()); }); return; }
      if (op === '$set' || op === '$setOnInsert') Object.keys(fixed).forEach(function (f) { fixed[f] = toBson(fixed[f]); });
      var u = {}; u[op] = fixed;
      try { mingo.update(out, u, arrayFilters || []); }
      catch (e) {
        var m = String(e.message || e);
        if (/not supported/.test(m)) throw serverError('Unknown modifier: ' + op + '. Expected a valid update modifier or pipeline-style update specified as an array', 9, 'FailedToParse');
        throw serverError(m, 2, 'BadValue');
      }
    });
    if (keyOf(out._id) !== keyOf(doc._id)) throw serverError("Performing an update on the path '_id' would modify the immutable field '_id'", 66, 'ImmutableField');
    return out;
  }
  function upsertBase(filter) {
    var base = {};
    (function walk(f) {
      Object.keys(f || {}).forEach(function (k) {
        if (k === '$and' && Array.isArray(f.$and)) f.$and.forEach(walk);
        else if (k.charAt(0) === '$') return;
        else {
          var v = f[k];
          if (isOperatorObj(v)) { if (hasOwn.call(v, '$eq')) setExact(base, k, clone(v.$eq)); else if (Array.isArray(v.$in) && v.$in.length === 1) setExact(base, k, clone(v.$in[0])); }
          else if (!isRegExp(v)) setExact(base, k, clone(v));
        }
      });
    })(filter);
    return base;
  }
  function validateUpdateDoc(update, replacement) {
    if (replacement) {
      if (!isObj(update)) throw serverError('replacement document must be an object', 2, 'BadValue');
      if (Object.keys(update).some(function (k) { return k.charAt(0) === '$'; })) throw serverError('Replacement document must not contain atomic operators', 2, 'BadValue');
      return;
    }
    if (Array.isArray(update)) return;
    if (!isObj(update) || !Object.keys(update).length) throw serverError('Update document requires atomic operators', 9, 'FailedToParse');
    if (!Object.keys(update).every(function (k) { return k.charAt(0) === '$'; })) throw serverError('Update document requires atomic operators', 9, 'FailedToParse');
  }

  /* ------------------------------------------------------------------
     Read path helpers
     ------------------------------------------------------------------ */
  function replaceMeta(v, metaName, field) {
    if (Array.isArray(v)) return v.map(function (x) { return replaceMeta(x, metaName, field); });
    if (isObj(v)) {
      var ks = Object.keys(v);
      if (ks.length === 1 && ks[0] === '$meta' && v.$meta === metaName) return '$' + field;
      var o = {}; ks.forEach(function (k) { o[k] = replaceMeta(v[k], metaName, field); }); return o;
    }
    return v;
  }
  function sortDocs(docs, sort, collator) {
    if (!sort || !Object.keys(sort).length) return docs;
    if (hasOwn.call(sort, '$natural')) return sort.$natural < 0 ? docs.slice().reverse() : docs.slice();
    var keys = Object.keys(sort);
    var cmpFn = collator ? function (x, y) { return typeof x === 'string' && typeof y === 'string' ? collator.compare(x, y) : cmp(x, y); } : cmp;
    var dec = docs.map(function (d, i) { return { d: d, i: i, v: keys.map(function (k) { return sortValue(d, k, sort[k]); }) }; });
    dec.sort(function (a, b) {
      for (var j = 0; j < keys.length; j++) { var c = cmpFn(a.v[j], b.v[j]); if (c) return sort[keys[j]] < 0 ? -c : c; }
      return a.i - b.i;
    });
    return dec.map(function (x) { return x.d; });
  }
  function sortValue(d, path, dir) {
    var vals = indexValues(d, path);
    if (vals.length === 1) return vals[0] === undefined ? null : vals[0];
    vals = vals.map(function (v) { return v === undefined ? null : v; }).sort(cmp);
    return dir < 0 ? vals[vals.length - 1] : vals[0];
  }
  function applyProjection(docs, proj, scores) {
    if (!proj || !Object.keys(proj).length) return docs;
    var meta = [], p2 = {};
    Object.keys(proj).forEach(function (k) {
      var v = proj[k];
      if (isObj(v) && v.$meta) meta.push([k, v.$meta]); else p2[k] = v;
    });
    var nonId = Object.keys(p2).filter(function (k) { return k !== '_id'; });
    var hasIncl = nonId.some(function (k) { var v = p2[k]; return v === 1 || v === true || (typeof v === 'object' && v !== null) || typeof v === 'string'; });
    var hasExcl = nonId.some(function (k) { return p2[k] === 0 || p2[k] === false; });
    if (hasIncl && hasExcl) {
      var ex = nonId.filter(function (k) { return p2[k] === 0 || p2[k] === false; })[0];
      throw serverError('Cannot do exclusion on field ' + ex + ' in inclusion projection', 31254, 'Location31254');
    }
    var out;
    if (Object.keys(p2).length) {
      try { out = new mingo.Query({}).find(docs, p2).all(); }
      catch (e) { throw serverError(String(e.message || e), 2, 'BadValue'); }
    } else out = docs.map(clone);
    return out.map(function (o, i) {
      meta.forEach(function (m) { o[m[0]] = scores ? scores[i] : null; });
      if (hasOwn.call(o, '_id')) { var r = { _id: o._id }; Object.keys(o).forEach(function (k) { if (k !== '_id') r[k] = o[k]; }); return r; }
      return o;
    });
  }

  /* ------------------------------------------------------------------
     Cursor
     ------------------------------------------------------------------ */
  function Cursor(coll, filter, projection) {
    this._coll = coll; this._filter = filter || {}; this._proj = projection || null;
    this._sort = null; this._skip = 0; this._limit = 0; this._hint = null; this._maps = [];
    this._buf = null; this._pos = 0; this._explain = null; this._collation = null;
  }
  MM.Cursor = Cursor;
  var CP = Cursor.prototype;
  CP._isCursor = true;
  function mutable(c, fn) { if (c._buf) throw new Error('Cursor is already executing; build the full chain before reading results.'); fn(); return c; }
  CP.sort = function (s) { var c = this; return mutable(c, function () { c._sort = s; }); };
  CP.skip = function (n) { var c = this; return mutable(c, function () { c._skip = n; }); };
  CP.limit = function (n) { var c = this; return mutable(c, function () { c._limit = Math.abs(n); }); };
  CP.project = CP.projection = function (p) { var c = this; return mutable(c, function () { c._proj = p; }); };
  CP.hint = function (h) { var c = this; return mutable(c, function () { c._hint = h; }); };
  CP.collation = function (col) { this._collation = col; return this; };
  CP.batchSize = CP.comment = CP.maxTimeMS = CP.allowDiskUse = CP.readPref = CP.noCursorTimeout = CP.readConcern = CP.maxAwaitTimeMS = function () { return this; };
  CP.pretty = function () { return this; };
  CP.map = function (fn) { this._maps.push(fn); return this; };
  CP._exec = function () {
    if (!this._buf) {
      var docs = this._coll._runFind(this), maps = this._maps;
      if (maps.length) docs = docs.map(function (d) { return maps.reduce(function (acc, f) { return f(acc); }, d); });
      this._buf = docs;
    }
    return this._buf;
  };
  CP.toArray = function () { var b = this._exec(), r = b.slice(this._pos); this._pos = b.length; return r; };
  CP.hasNext = function () { return this._pos < this._exec().length; };
  CP.next = function () { var b = this._exec(); return this._pos < b.length ? b[this._pos++] : null; };
  CP.tryNext = CP.next;
  CP.forEach = function (fn) { var b = this._exec(); while (this._pos < b.length) fn(b[this._pos++]); };
  CP.itcount = function () { var b = this._exec(), n = b.length - this._pos; this._pos = b.length; return n; };
  CP.count = function (applySkipLimit) {
    if (applySkipLimit) return this.size();
    return this._coll.countDocuments(this._filter, this._collation ? { collation: this._collation } : {});
  };
  CP.size = function () { return this._coll._runFind(this).length; };
  CP.isExhausted = function () { return this._buf !== null && this._pos >= this._buf.length; };
  CP.close = function () { this._pos = this._exec().length; };
  CP.explain = function (verbosity) { return this._coll._explainFind(this, normalizeVerbosity(verbosity)); };
  CP._batch = function (n) { var b = this._exec(), r = b.slice(this._pos, this._pos + n); this._pos += r.length; return { docs: r, more: this._pos < b.length }; };
  function normalizeVerbosity(v) {
    if (v === true || v === 'allPlansExecution') return 'allPlansExecution';
    if (v === 'executionStats') return 'executionStats';
    return 'queryPlanner';
  }
  MM.normalizeVerbosity = normalizeVerbosity;

  function ArrayCursor(docs) { this._buf = docs; this._pos = 0; this._maps = []; }
  MM.ArrayCursor = ArrayCursor;
  ['toArray', 'hasNext', 'next', 'tryNext', 'forEach', 'itcount', 'isExhausted', 'close', '_batch'].forEach(function (m) { ArrayCursor.prototype[m] = CP[m]; });
  ArrayCursor.prototype._isCursor = true;
  ArrayCursor.prototype._exec = function () { return this._buf; };
  ArrayCursor.prototype.map = function (fn) { this._buf = this._buf.slice(this._pos).map(fn); this._pos = 0; return this; };
  ArrayCursor.prototype.pretty = ArrayCursor.prototype.batchSize = ArrayCursor.prototype.maxTimeMS = function () { return this; };
  ArrayCursor.prototype.size = ArrayCursor.prototype.count = function () { return this._buf.length; };
  ArrayCursor.prototype.explain = function (v) {
    if (!this._explainFn) throw new Error('explain() is only available on find and aggregate cursors');
    return this._explainFn(normalizeVerbosity(v === undefined ? 'queryPlanner' : v));
  };

  /* ------------------------------------------------------------------
     Collection
     ------------------------------------------------------------------ */
  function Collection(engine, dbName, name, session) {
    this._engine = engine; this._dbName = dbName; this._name = name; this._session = session || null;
  }
  MM.Collection = Collection;
  var CO = Collection.prototype;
  CO._isCollection = true;
  CO.__mmDisplay = function () { return this._dbName + '.' + this._name; };
  CO.getName = function () { return this._name; };
  CO.getFullName = function () { return this._dbName + '.' + this._name; };
  CO.toString = CO.getFullName;
  CO._s = function (create) {
    var eng = this._engine, txn = this._session && this._session.txn;
    if (!txn) return eng.getStore(this._dbName, this._name, create);
    var ns = this._dbName + '.' + this._name;
    if (!txn.colls[ns]) {
      var committed = eng.getStore(this._dbName, this._name, false);
      if (!committed && !create) return null;
      var w = newStore(ns, committed ? committed.options : {});
      w.indexes = committed ? committed.indexes : [idIndex()];
      w.docs = committed ? committed.docs.map(clone) : [];
      w.txn = txn; w.snapshot = new Map(); w.touched = new Set(); w.created = !committed;
      w.docs.forEach(function (d) { w.snapshot.set(keyOf(d._id), keyOf(d)); });
      txn.colls[ns] = w;
    }
    return txn.colls[ns];
  };
  CO._resolveView = function () {
    var s = this._engine.getStore(this._dbName, this._name, false);
    if (!s || !s.options.viewOn) return null;
    var pipe = [], cur = s, guard = 0, base = null;
    while (cur && cur.options.viewOn && guard++ < 10) {
      pipe = (cur.options.pipeline || []).concat(pipe);
      base = cur.options.viewOn;
      cur = this._engine.getStore(this._dbName, base, false);
    }
    return { base: base, pipeline: pipe, docs: cur ? cur.docs : [] };
  };
  CO._resolver = function () {
    var eng = this._engine, dbName = this._dbName, session = this._session;
    return function (name) {
      var c = new Collection(eng, dbName, name, session);
      var v = c._resolveView();
      if (v) return runPipeline(c, v.docs.map(clone), v.pipeline);
      var s = c._s(false);
      return s ? s.docs.map(clone) : [];
    };
  };
  CO._profile = function (op, command, sim, nreturned) {
    var eng = this._engine, level = eng.profiling[this._dbName];
    if (!level || !level.level || this._name === 'system.profile') return;
    var millis = sim ? simMillis(sim) : 0;
    if (level.level === 1 && millis < (level.slowms || 100)) return;
    var st = eng.getStore(this._dbName, 'system.profile', true);
    var entry = { op: op, ns: this._dbName + '.' + this._name, command: clone(command), keysExamined: sim ? sim.keysExamined || 0 : 0, docsExamined: sim ? sim.docsExamined || 0 : 0,
      nreturned: nreturned, millis: millis, planSummary: sim ? planSummary(sim) : 'n/a', ts: new Date(), client: '127.0.0.1', appName: 'mongosh (simulated)', user: '' };
    if (sim && !sim.sortOk && command.sort) entry.hasSortStage = true;
    st.docs.push(entry);
    st.ixCache = {}; st.dirty = true;
    if (st.docs.length > 500) st.docs.shift();
  };
  CO._recordUsage = function (store, sim) {
    if (!sim) return;
    var names = sim.kind === 'IXSCAN' ? [sim.index.name] : (sim.kind === 'OR' ? sim.branches.map(function (b) { return b.index.name; }) : (sim.kind === 'TEXT' ? [sim.index.name] : []));
    names.forEach(function (n) { var u = store.usage[n] || (store.usage[n] = { ops: 0, since: Date.now() }); u.ops++; });
  };

  /* --- reads --- */
  CO.find = function (filter, projection) {
    if (filter !== undefined && filter !== null && !isObj(filter)) throw serverError('filter must be an object, got ' + bsonTypeOf(filter), 2, 'BadValue');
    return new Cursor(this, filter || {}, projection || null);
  };
  CO.findOne = function (filter, projection, options) {
    var c = this.find(filter, projection).limit(1);
    if (options && options.sort) c.sort(options.sort);
    var r = c.toArray();
    return r.length ? r[0] : null;
  };
  CO._runFind = function (cur) {
    this._engine.opcounters.query++;
    var view = this._resolveView();
    if (view) {
      var pipe = view.pipeline.concat([{ $match: cur._filter }]);
      if (cur._sort) pipe.push({ $sort: cur._sort });
      if (cur._skip) pipe.push({ $skip: cur._skip });
      if (cur._limit) pipe.push({ $limit: cur._limit });
      var vd = runPipeline(this, view.docs.map(clone), pipe);
      return cur._proj ? applyProjection(vd, cur._proj) : vd;
    }
    var store = this._s(false);
    if (!store) return [];
    var filter = cur._filter, docs = store.docs, scores = null;
    var fk = Object.keys(filter);
    if (fk.length === 1 && fk[0] === '_id' && !isObj(filter._id) && !isRegExp(filter._id) && !Array.isArray(filter._id) && !store.txn) {
      var hit = uniqueMaps(store)._id_.get(keyOf([filter._id]));
      docs = hit ? [hit] : [];
    }
    if (filter.$text) {
      var ts = textSearch(store, filter.$text);
      docs = docs.filter(function (d) { return ts.scores.has(d); });
      scores = ts.scores;
    }
    var nearInfo = extractNear(filter);
    if (nearInfo && !hasGeoIndex(store, nearInfo.near.field)) throw serverError('error processing query: ns=' + this._dbName + '.' + this._name + ' planner returned error :: caused by :: unable to find index for $geoNear query', 291, 'NoQueryExecutionPlans');
    var collator = makeCollator(cur._collation);
    var cf = applyCollationFilter(stripText(nearInfo ? nearInfo.rest : filter), collator);
    var q = compileQuery(cf.filter);
    var res = docs.filter(function (d) { return q.test(d) && cf.preds.every(function (p) { return p(d); }); });
    if (nearInfo) res = nearFilter(res, nearInfo.near).map(function (x) { return x.d; });
    var sort = cur._sort;
    if (sort && scores) {
      var metaKey = Object.keys(sort).filter(function (k) { return isObj(sort[k]) && sort[k].$meta === 'textScore'; })[0];
      if (metaKey) {
        res = res.slice().sort(function (a, b) { return scores.get(b) - scores.get(a); });
        var rest = {}; Object.keys(sort).forEach(function (k) { if (k !== metaKey) rest[k] = sort[k]; });
        if (Object.keys(rest).length) res = sortDocs(res, rest);
        sort = null;
      }
    }
    if (sort) res = sortDocs(res, sort, collator);
    if (cur._skip) res = res.slice(cur._skip);
    if (cur._limit) res = res.slice(0, cur._limit);
    var sim = null;
    try {
      var qp = { sort: cur._sort && !scores ? cur._sort : null, skip: cur._skip, limit: cur._limit, projection: cur._proj, hint: cur._hint };
      sim = planQuery(store, filter, qp).win;
    } catch (e) { if (cur._hint) throw e; }
    this._recordUsage(store, sim);
    var cmd = { find: this._name, filter: filter };
    if (cur._sort) cmd.sort = cur._sort;
    if (cur._proj) cmd.projection = cur._proj;
    if (cur._limit) cmd.limit = cur._limit;
    this._profile('query', cmd, sim, res.length);
    var sc = scores ? res.map(function (d) { return scores.get(d); }) : null;
    return applyProjection(res.map(clone), cur._proj, sc);
  };
  CO._explainFind = function (cur, verbosity) {
    var store = this._s(false) || newStore(this._dbName + '.' + this._name);
    if (this._resolveView()) throw serverError('Simulator: explain() on views is not modelled. Explain the underlying aggregate instead.', 2, 'BadValue');
    var nearInfo = extractNear(cur._filter);
    if (nearInfo) {
      var t0 = Date.now(), c2 = new Cursor(this, cur._filter, cur._proj);
      c2._sort = cur._sort; c2._skip = cur._skip; c2._limit = cur._limit; c2._collation = cur._collation;
      var out = this._runFind(c2), gi = store.indexes.filter(function (ix) { return ix.key[nearInfo.near.field] === '2dsphere' || ix.key[nearInfo.near.field] === '2d'; })[0];
      var stage = { stage: 'GEO_NEAR_' + (gi.key[nearInfo.near.field] === '2d' ? '2D' : '2DSPHERE'), keyPattern: clone(gi.key), indexName: gi.name };
      var plan = { stage: 'FETCH', inputStage: stage };
      if (cur._limit) plan = { stage: 'LIMIT', limitAmount: cur._limit, inputStage: plan };
      var ex = { explainVersion: '1', queryPlanner: { namespace: this._dbName + '.' + this._name, parsedQuery: clone(cur._filter), winningPlan: plan, rejectedPlans: [] } };
      if (verbosity !== 'queryPlanner') ex.executionStats = { executionSuccess: true, nReturned: out.length, executionTimeMillis: Date.now() - t0, totalKeysExamined: out.length * 2, totalDocsExamined: out.length, executionStages: clone(plan) };
      ex.command = { find: this._name, filter: clone(cur._filter) };
      ex.ok = 1;
      this._engine.lastExplain = ex;
      return ex;
    }
    var r = buildExplain(store, this._dbName + '.' + this._name, cur._filter, { sort: cur._sort, skip: cur._skip, limit: cur._limit, projection: cur._proj, hint: cur._hint }, verbosity);
    this._engine.lastExplain = r.explain;
    return r.explain;
  };
  CO.countDocuments = function (filter, options) {
    options = options || {};
    var c = this.find(filter || {});
    if (options.skip) c.skip(options.skip);
    if (options.limit) c.limit(options.limit);
    if (options.hint) c.hint(options.hint);
    if (options.collation) c.collation(options.collation);
    return c._coll._runFind(c).length;
  };
  CO.count = function (filter) { return this.countDocuments(filter || {}); };
  CO.estimatedDocumentCount = function () { var s = this._s(false); return s ? s.docs.length : 0; };
  CO.distinct = function (field, filter) {
    var docs = this.find(filter || {}).toArray(), seen = {}, out = [];
    docs.forEach(function (d) {
      indexValues(d, field).forEach(function (v) {
        if (v === undefined) return;
        var k = keyOf(v);
        if (!seen[k]) { seen[k] = 1; out.push(v); }
      });
    });
    return out.sort(cmp);
  };

  /* --- aggregation --- */
  function idFirst(d) {
    if (!isObj(d) || !hasOwn.call(d, '_id')) return d;
    var ks = Object.keys(d);
    if (ks[0] === '_id') return d;
    var r = { _id: d._id };
    ks.forEach(function (k) { if (k !== '_id') r[k] = d[k]; });
    return r;
  }
  function runPipeline(coll, docs, pipeline) {
    try { return mingo.aggregate(docs, pipeline, { collectionResolver: coll._resolver(), context: AGG_CONTEXT, jsonSchemaValidator: schemaPredicate }).map(idFirst); }
    catch (e) {
      var m = String(e.message || e).replace(/^MingoError:\s*/, '');
      if (/unregistered pipeline operator \$(search|searchMeta|vectorSearch)/.test(m)) m = m + '. Search stages need a search index; in this simulator use db.coll.createSearchIndex() and $vectorSearch.';
      throw serverError(m, 40324, 'Location40324');
    }
  }
  CO.aggregate = function (pipeline, options) {
    if (!Array.isArray(pipeline)) pipeline = Array.prototype.slice.call(arguments).filter(isObj);
    options = (arguments.length === 2 && isObj(options)) ? options : {};
    if (options.explain) return this._explainAggregate(pipeline, options.explain === true ? 'queryPlanner' : normalizeVerbosity(options.explain));
    this._engine.lastPipeline = { db: this._dbName, coll: this._name, pipeline: clone(pipeline) };
    var ac = new ArrayCursor(this._aggregate(pipeline)), self = this;
    ac._explainFn = function (v) { return self._explainAggregate(pipeline, v); };
    return ac;
  };
  CO._geoNear = function (store, g) {
    if (!isObj(g) || !g.near || !g.distanceField) throw serverError('$geoNear requires near and distanceField', 2, 'BadValue');
    var geoFields = [];
    (store ? store.indexes : []).forEach(function (ix) { Object.keys(ix.key).forEach(function (k) { if (ix.key[k] === '2dsphere' || ix.key[k] === '2d') geoFields.push(k); }); });
    if (!geoFields.length) throw serverError('$geoNear requires a 2d or 2dsphere index, but none were found', 27, 'IndexNotFound');
    if (!g.key && geoFields.length > 1) throw serverError('There is more than one geo index; unsure which to use for $geoNear. Specify key.', 2, 'BadValue');
    var key = g.key || geoFields[0];
    var legacy = Array.isArray(g.near) && !g.spherical;
    var near = { field: key, point: geoPoint(g.near), max: g.maxDistance, min: g.minDistance, legacy: legacy };
    if (Array.isArray(g.near) && g.spherical) { if (near.max !== undefined) near.max *= EARTH_RADIUS_M; if (near.min !== undefined) near.min *= EARTH_RADIUS_M; }
    var q = compileQuery(g.query || {});
    var hits = nearFilter(store.docs.filter(function (d) { return q.test(d); }), near);
    var mult = g.distanceMultiplier || 1;
    if (Array.isArray(g.near) && g.spherical) mult = mult / EARTH_RADIUS_M;
    this._recordUsage(store, { kind: 'IXSCAN', index: store.indexes.filter(function (ix) { return ix.key[key] === '2dsphere' || ix.key[key] === '2d'; })[0] });
    return hits.map(function (h) {
      var c = clone(h.d);
      setExact(c, g.distanceField, h.dist * mult);
      if (g.includeLocs) setExact(c, g.includeLocs, clone(getExact(h.d, key)));
      return c;
    });
  };
  CO._aggregate = function (pipeline) {
    this._engine.opcounters.command++;
    var self = this, eng = this._engine;
    pipeline.forEach(function (st, i) {
      if (!isObj(st) || Object.keys(st).length !== 1) throw serverError('A pipeline stage specification object must contain exactly one field.', 40323, 'Location40323');
      var name = Object.keys(st)[0];
      if ((name === '$out' || name === '$merge') && i !== pipeline.length - 1) throw serverError(name + ' can only be the final stage in the pipeline', 40601, 'Location40601');
      if (name === '$geoNear' && i !== 0) throw serverError('$geoNear is only valid as the first stage in a pipeline', 40602, 'Location40602');
    });
    var last = pipeline.length ? Object.keys(pipeline[pipeline.length - 1])[0] : null;
    var writeStage = (last === '$out' || last === '$merge') ? pipeline[pipeline.length - 1] : null;
    var body = writeStage ? pipeline.slice(0, -1) : pipeline.slice();
    var docs, view = this._resolveView(), store = this._s(false);
    var first = body[0] ? Object.keys(body[0])[0] : null;
    if (first === '$indexStats') {
      docs = (store ? store.indexes : []).map(function (idx) {
        var u = store.usage[idx.name] || { ops: 0, since: (idx.createdAt || eng.startedAt).getTime ? (idx.createdAt || eng.startedAt).getTime() : Date.now() };
        return { name: idx.name, key: clone(idx.key), host: 'mastery-sim:27017', accesses: { ops: u.ops, since: new Date(u.since) }, spec: specOf(idx) };
      });
      body = body.slice(1);
    } else if (first === '$collStats') {
      docs = [{ ns: this._dbName + '.' + this._name, host: 'mastery-sim:27017', localTime: new Date(), storageStats: this.stats(), count: store ? store.docs.length : 0 }];
      body = body.slice(1);
    } else if (first === '$geoNear') {
      docs = this._geoNear(store, body[0].$geoNear);
      body = body.slice(1);
    } else if (first === '$vectorSearch') {
      docs = this._vectorSearch(body[0].$vectorSearch);
      body = body.slice(1).map(function (s) { return replaceMeta(s, 'vectorSearchScore', '__vs'); });
      body.push({ $unset: '__vs' });
    } else if (view) {
      docs = runPipeline(this, view.docs.map(clone), view.pipeline);
    } else if (!store) docs = [];
    else {
      var src = store.docs, prefix = [];
      if (first === '$match' && body[0].$match.$text) {
        var ts = textSearch(store, body[0].$match.$text);
        var restMatch = stripText(body[0].$match), rq = compileQuery(restMatch);
        src = [];
        store.docs.forEach(function (d) { if (ts.scores.has(d) && rq.test(d)) { var c = clone(d); c.__ts = ts.scores.get(d); src.push(c); } });
        body = body.slice(1).map(function (s) {
          var name = Object.keys(s)[0];
          if (name === '$sort') { var o = {}; Object.keys(s.$sort).forEach(function (k) { var v = s.$sort[k]; if (isObj(v) && v.$meta === 'textScore') o.__ts = -1; else o[k] = v; }); return { $sort: o }; }
          return replaceMeta(s, 'textScore', '__ts');
        });
        body.push({ $unset: '__ts' });
        this._recordUsage(store, { kind: 'TEXT', index: ts.index });
        docs = runPipeline(this, src, body);
        return this._finishWrite(writeStage, docs);
      }
      while (body.length && Object.keys(body[0])[0] === '$match' && !body[0].$match.$text) { prefix.push(body.shift().$match); }
      if (prefix.length) {
        var mf = prefix.length === 1 ? prefix[0] : { $and: prefix };
        var mq = compileQuery(mf);
        src = src.filter(function (d) { return mq.test(d); });
        try {
          var sortSt = body[0] && body[0].$sort ? body[0].$sort : null;
          this._recordUsage(store, planQuery(store, mf, { sort: sortSt }).win);
        } catch (e) { /* planner is advisory */ }
      }
      docs = runPipeline(this, src.map(clone), body);
      return this._finishWrite(writeStage, docs);
    }
    docs = runPipeline(this, docs, body);
    return this._finishWrite(writeStage, docs);
  };
  CO._finishWrite = function (writeStage, docs) {
    if (!writeStage) return docs;
    var eng = this._engine, name = Object.keys(writeStage)[0], spec = writeStage[name];
    if (name === '$out') {
      var tdb = this._dbName, tcoll = spec;
      if (isObj(spec)) { tdb = spec.db || tdb; tcoll = spec.coll; }
      var target = eng.getStore(tdb, tcoll, true);
      if (target.options.viewOn) throw serverError('$out cannot write to a view', 166, 'CommandNotSupportedOnView');
      var tmp = newStore(target.ns, target.options);
      tmp.indexes = target.indexes;
      docs.forEach(function (d) { eng._insert(tmp, d); });
      target.docs = tmp.docs; target.uniq = null; eng.touch(target);
      return [];
    }
    var into = isObj(spec) ? spec.into : spec, mdb = this._dbName, mcoll = into;
    if (isObj(into)) { mdb = into.db || mdb; mcoll = into.coll; }
    var on = isObj(spec) && spec.on ? (Array.isArray(spec.on) ? spec.on : [spec.on]) : ['_id'];
    var whenMatched = (isObj(spec) && spec.whenMatched) || 'merge', whenNotMatched = (isObj(spec) && spec.whenNotMatched) || 'insert';
    var t = eng.getStore(mdb, mcoll, true);
    docs.forEach(function (d) {
      if (!hasOwn.call(d, '_id') && on.indexOf('_id') >= 0) d = Object.assign({ _id: newOid() }, d);
      var match = t.docs.filter(function (x) { return on.every(function (f) { return keyOf(getExact(x, f)) === keyOf(getExact(d, f)); }); })[0];
      if (match) {
        if (whenMatched === 'fail') throw serverError('$merge failed: found an existing document with the same values for fields ' + on.join(', '), 11000, 'DuplicateKey');
        if (whenMatched === 'keepExisting') return;
        var next;
        if (whenMatched === 'replace') { next = clone(d); next._id = match._id; }
        else if (Array.isArray(whenMatched)) { next = mingo.aggregate([clone(match)], replaceVars(whenMatched, d))[0]; next._id = match._id; }
        else { next = clone(match); Object.keys(d).forEach(function (k) { if (k !== '_id') next[k] = clone(d[k]); }); }
        eng._replaceDoc(t, match, next, 'replace');
      } else {
        if (whenNotMatched === 'fail') throw serverError('$merge could not find a matching document in the target collection', 13113, 'MergeStageNoMatchingDocument');
        if (whenNotMatched === 'discard') return;
        eng._insert(t, d);
      }
    });
    return [];
  };
  function replaceVars(pipe, newDoc) {
    var s = JSON.stringify(pipe);
    return JSON.parse(s.replace(/"\$\$new\.([\w.]+)"/g, function (_, p) { return JSON.stringify(getExact(newDoc, p)); }));
  }
  CO._explainAggregate = function (pipeline, verbosity) {
    var store = this._s(false) || newStore(this._dbName + '.' + this._name);
    var body = pipeline.slice(), matches = [], sort = null, limit = 0, skip = 0, proj = null;
    while (body.length && body[0].$match) matches.push(body.shift().$match);
    if (body.length && body[0].$sort) sort = body.shift().$sort;
    while (body.length && (body[0].$skip !== undefined || body[0].$limit !== undefined)) {
      var st = body.shift();
      if (st.$skip !== undefined) skip += st.$skip; else limit = limit ? Math.min(limit, st.$limit) : st.$limit;
    }
    if (body.length && body[0].$project && Object.keys(body[0].$project).every(function (k) { var v = body[0].$project[k]; return v === 1 || v === 0 || v === true || v === false; })) proj = body.shift().$project;
    var filter = matches.length === 0 ? {} : (matches.length === 1 ? matches[0] : { $and: matches });
    var ns = this._dbName + '.' + this._name;
    var r = buildExplain(store, ns, filter, { sort: sort, skip: skip, limit: limit, projection: proj }, verbosity, { aggregate: this._name, pipeline: pipeline, explain: true, $db: this._dbName });
    var cursorStage = { queryPlanner: r.explain.queryPlanner };
    if (r.explain.executionStats) cursorStage.executionStats = r.explain.executionStats;
    var stages = [{ $cursor: cursorStage }];
    if (verbosity !== 'queryPlanner') {
      stages[0].nReturned = r.explain.executionStats.nReturned;
      stages[0].executionTimeMillisEstimate = r.explain.executionStats.executionTimeMillis;
    }
    var running = null;
    if (verbosity !== 'queryPlanner' && body.length) {
      var base = this.find(filter); if (sort) base.sort(sort); if (skip) base.skip(skip); if (limit) base.limit(limit); if (proj) base.project(proj);
      running = base.toArray();
    }
    var self = this;
    body.forEach(function (st) {
      var o = clone(st);
      if (running) {
        try { running = runPipeline(self, running, [st]); o.nReturned = running.length; o.executionTimeMillisEstimate = 0; }
        catch (e) { running = null; }
      }
      stages.push(o);
    });
    var out = { explainVersion: '1', stages: stages, command: r.explain.command, serverInfo: r.explain.serverInfo, ok: 1, simulatorNote: r.explain.simulatorNote };
    this._engine.lastExplain = out;
    return out;
  };
  CO._vectorSearch = function (spec) {
    var store = this._s(false);
    if (!store) return [];
    var sidx = (store.searchIndexes || []).filter(function (s) { return s.name === (spec.index || 'default'); })[0];
    if (!sidx) throw serverError("$vectorSearch: no search index named '" + (spec.index || 'default') + "' on " + store.ns + '. Create one with db.' + this._name + '.createSearchIndex({...}).', 291, 'SearchIndexNotFound');
    var field = (sidx.definition.fields || []).filter(function (f) { return f.type === 'vector' && f.path === spec.path; })[0];
    if (!field) throw serverError("$vectorSearch: path '" + spec.path + "' is not indexed as type 'vector' in index " + sidx.name, 2, 'BadValue');
    var qv = spec.queryVector;
    if (!Array.isArray(qv) || qv.length !== field.numDimensions) throw serverError('$vectorSearch: queryVector must have ' + field.numDimensions + ' dimensions', 2, 'BadValue');
    var pre = spec.filter ? compileQuery(spec.filter) : null;
    function sim(v) {
      var dot = 0, na = 0, nb = 0, d2 = 0;
      for (var i = 0; i < v.length; i++) { dot += v[i] * qv[i]; na += v[i] * v[i]; nb += qv[i] * qv[i]; d2 += (v[i] - qv[i]) * (v[i] - qv[i]); }
      if (field.similarity === 'euclidean') return 1 / (1 + d2);
      if (field.similarity === 'dotProduct') return (1 + dot) / 2;
      return (1 + dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)) / 2;
    }
    var scored = [];
    store.docs.forEach(function (d) {
      var v = getExact(d, spec.path);
      if (!Array.isArray(v) || v.length !== qv.length) return;
      if (pre && !pre.test(d)) return;
      var c = clone(d); c.__vs = Math.round(sim(v) * 1e6) / 1e6; scored.push(c);
    });
    scored.sort(function (a, b) { return b.__vs - a.__vs; });
    return scored.slice(0, Math.min(spec.limit || 10, spec.numCandidates || 100));
  };
  CO.createSearchIndex = function (def, maybe) {
    var spec = typeof def === 'string' ? { name: def, definition: maybe } : def;
    var store = this._s(true);
    store.searchIndexes = store.searchIndexes || [];
    spec = { name: spec.name || 'default', type: spec.type || 'search', definition: spec.definition || {} };
    store.searchIndexes = store.searchIndexes.filter(function (s) { return s.name !== spec.name; }).concat([spec]);
    this._engine.touch(store);
    return spec.name;
  };
  CO.getSearchIndexes = function () { var s = this._s(false); return s && s.searchIndexes ? clone(s.searchIndexes).map(function (x) { x.status = 'READY'; x.queryable = true; return x; }) : []; };
  CO.dropSearchIndex = function (name) { var s = this._s(false); if (s && s.searchIndexes) s.searchIndexes = s.searchIndexes.filter(function (x) { return x.name !== name; }); };

  /* --- writes --- */
  CO._writable = function () {
    var s = this._s(true);
    if (s.options.viewOn) throw serverError('Namespace ' + s.ns + ' is a view, not a collection', 166, 'CommandNotSupportedOnView');
    return s;
  };
  CO.insertOne = function (doc) {
    var s = this._writable();
    var id = this._engine._insert(s, doc);
    this._profile('insert', { insert: this._name, ordered: true }, null, 0);
    return { acknowledged: true, insertedId: id };
  };
  CO.insert = function (docOrDocs) { return Array.isArray(docOrDocs) ? this.insertMany(docOrDocs) : this.insertOne(docOrDocs); };
  CO.insertMany = function (docs, options) {
    if (!Array.isArray(docs)) throw serverError('insertMany requires an array of documents', 2, 'BadValue');
    var s = this._writable(), ordered = !(options && options.ordered === false), ids = {}, errors = [], eng = this._engine;
    for (var i = 0; i < docs.length; i++) {
      try { ids[i] = eng._insert(s, docs[i]); }
      catch (e) {
        errors.push({ index: i, code: e.code, errmsg: e.message });
        if (ordered) break;
      }
    }
    if (errors.length) {
      var err = new Error(errors[0].errmsg + '\n  insertedCount: ' + Object.keys(ids).length + ', writeErrors: ' + errors.length + (ordered ? ' (ordered: stopped at index ' + errors[0].index + ')' : ' (unordered: continued past errors)'));
      err.name = 'MongoBulkWriteError'; err.code = errors[0].code; err.writeErrors = errors; err.insertedIds = ids;
      throw err;
    }
    return { acknowledged: true, insertedIds: ids };
  };
  CO._matchDocs = function (store, filter, sort, one) {
    var docs = store.docs, scores = null;
    if (filter && filter.$text) { var ts = textSearch(store, filter.$text); docs = docs.filter(function (d) { return ts.scores.has(d); }); scores = ts.scores; }
    var q = compileQuery(stripText(filter || {}));
    var res = [];
    for (var i = 0; i < docs.length; i++) {
      if (q.test(docs[i])) { res.push(docs[i]); if (one && !sort) break; }
    }
    if (sort) res = sortDocs(res, sort);
    return one ? res.slice(0, 1) : res;
  };
  CO._update = function (filter, update, options, many, replacement) {
    options = options || {};
    if (!isObj(filter)) throw serverError('filter must be an object', 2, 'BadValue');
    validateUpdateDoc(update, replacement);
    var s = this._writable(), eng = this._engine, matched = this._matchDocs(s, filter, options.sort, !many), modified = 0, upsertedId = null;
    var sim = null; try { sim = planQuery(s, filter, {}).win; this._recordUsage(s, sim); } catch (e) { /* advisory */ }
    for (var i = 0; i < matched.length; i++) {
      var doc = matched[i], next;
      if (replacement) { next = toBson(update); next = Object.assign({ _id: doc._id }, next); if (hasOwn.call(update, '_id') && keyOf(update._id) !== keyOf(doc._id)) throw serverError("After applying the update, the (immutable) field '_id' was found to have been altered to _id: " + fmtInline(update._id, 0), 66, 'ImmutableField'); }
      else next = applyUpdate(doc, update, filter, options.arrayFilters, false);
      eng.opcounters.update++;
      if (eng._replaceDoc(s, doc, next, replacement ? 'replace' : 'update')) modified++;
    }
    if (!matched.length && options.upsert) {
      var base = upsertBase(filter), ins;
      if (replacement) { ins = toBson(update); if (!hasOwn.call(ins, '_id') && hasOwn.call(base, '_id')) ins = Object.assign({ _id: base._id }, ins); }
      else if (Array.isArray(update)) ins = applyUpdate(Object.assign({ _id: hasOwn.call(base, '_id') ? base._id : newOid() }, base), update, filter, options.arrayFilters, true);
      else {
        if (!hasOwn.call(base, '_id')) base = Object.assign({ _id: newOid() }, base);
        ins = applyUpdate(base, update, filter, options.arrayFilters, true);
      }
      upsertedId = eng._insert(s, ins);
    }
    this._profile('update', { q: filter, u: update, multi: !!many, upsert: !!options.upsert }, sim, 0);
    return { acknowledged: true, insertedId: upsertedId, matchedCount: matched.length, modifiedCount: modified, upsertedCount: upsertedId !== null ? 1 : 0 };
  };
  CO.updateOne = function (f, u, o) { return this._update(f, u, o, false, false); };
  CO.updateMany = function (f, u, o) { return this._update(f, u, o, true, false); };
  CO.replaceOne = function (f, r, o) { return this._update(f, r, o, false, true); };
  CO.update = function (f, u, o) { return this._update(f, u, o, !!(o && o.multi), !Object.keys(u || {}).some(function (k) { return k.charAt(0) === '$'; }) && !Array.isArray(u)); };
  CO._delete = function (filter, many, options) {
    if (!isObj(filter)) throw serverError('filter must be an object', 2, 'BadValue');
    var s = this._s(false);
    if (!s) return { acknowledged: true, deletedCount: 0 };
    if (s.options.viewOn) throw serverError('Namespace ' + s.ns + ' is a view, not a collection', 166, 'CommandNotSupportedOnView');
    var eng = this._engine, matched = this._matchDocs(s, filter, options && options.sort, !many);
    var sim = null; try { sim = planQuery(s, filter, {}).win; this._recordUsage(s, sim); } catch (e) { /* advisory */ }
    matched.forEach(function (d) { eng._remove(s, d); });
    this._profile('remove', { q: filter, limit: many ? 0 : 1 }, sim, 0);
    return { acknowledged: true, deletedCount: matched.length };
  };
  CO.deleteOne = function (f, o) { return this._delete(f, false, o); };
  CO.deleteMany = function (f, o) { return this._delete(f, true, o); };
  CO.remove = function (f, justOne) { return this._delete(f || {}, !justOne); };
  CO._findAndModify = function (filter, options, action, payload) {
    options = options || {};
    var s = action === 'delete' ? this._s(false) : this._writable();
    if (!s) return null;
    var eng = this._engine, doc = this._matchDocs(s, filter || {}, options.sort, true)[0];
    var after = options.returnDocument === 'after' || options.returnNewDocument === true || options.new === true;
    var result = null;
    if (action === 'delete') {
      if (!doc) return null;
      eng._remove(s, doc);
      result = doc;
    } else if (doc) {
      var next = action === 'replace' ? Object.assign({ _id: doc._id }, toBson(payload)) : applyUpdate(doc, payload, filter, options.arrayFilters, false);
      eng.opcounters.update++;
      eng._replaceDoc(s, doc, next, action === 'replace' ? 'replace' : 'update');
      result = after ? next : doc;
    } else if (options.upsert) {
      var base = upsertBase(filter || {});
      if (!hasOwn.call(base, '_id')) base = Object.assign({ _id: newOid() }, base);
      var ins = action === 'replace' ? Object.assign({ _id: base._id }, toBson(payload)) : applyUpdate(base, payload, filter, options.arrayFilters, true);
      eng._insert(s, ins);
      result = after ? ins : null;
    }
    if (!result) return null;
    return applyProjection([clone(result)], options.projection)[0];
  };
  CO.findOneAndUpdate = function (f, u, o) { validateUpdateDoc(u, false); return this._findAndModify(f, o, 'update', u); };
  CO.findOneAndReplace = function (f, r, o) { validateUpdateDoc(r, true); return this._findAndModify(f, o, 'replace', r); };
  CO.findOneAndDelete = function (f, o) { return this._findAndModify(f, o, 'delete'); };
  CO.findAndModify = function (spec) {
    spec = spec || {};
    if (spec.remove) return this.findOneAndDelete(spec.query, { sort: spec.sort, projection: spec.fields });
    var isRepl = spec.update && !Array.isArray(spec.update) && !Object.keys(spec.update).some(function (k) { return k.charAt(0) === '$'; });
    var opts = { sort: spec.sort, projection: spec.fields, upsert: spec.upsert, returnDocument: spec.new ? 'after' : 'before', arrayFilters: spec.arrayFilters };
    return isRepl ? this.findOneAndReplace(spec.query, spec.update, opts) : this.findOneAndUpdate(spec.query, spec.update, opts);
  };
  CO.bulkWrite = function (ops, options) {
    var ordered = !(options && options.ordered === false), r = { acknowledged: true, insertedCount: 0, matchedCount: 0, modifiedCount: 0, deletedCount: 0, upsertedCount: 0, insertedIds: {}, upsertedIds: {} }, errors = [], self = this;
    for (var i = 0; i < ops.length; i++) {
      try {
        var op = ops[i], kind = Object.keys(op)[0], a = op[kind], res;
        if (kind === 'insertOne') { r.insertedIds[i] = this.insertOne(a.document).insertedId; r.insertedCount++; }
        else if (kind === 'updateOne' || kind === 'updateMany' || kind === 'replaceOne') {
          res = kind === 'replaceOne' ? self.replaceOne(a.filter, a.replacement, a) : self[kind](a.filter, a.update, a);
          r.matchedCount += res.matchedCount; r.modifiedCount += res.modifiedCount;
          if (res.upsertedCount) { r.upsertedCount++; r.upsertedIds[i] = res.insertedId; }
        } else if (kind === 'deleteOne' || kind === 'deleteMany') { r.deletedCount += self[kind](a.filter).deletedCount; }
        else throw serverError('Unknown bulkWrite operation: ' + kind, 2, 'BadValue');
      } catch (e) {
        errors.push({ index: i, code: e.code, errmsg: e.message });
        if (ordered) break;
      }
    }
    if (errors.length) {
      var err = new Error(errors[0].errmsg + '\n  bulkWrite stopped/continued with ' + errors.length + ' write error(s); partial result: inserted ' + r.insertedCount + ', modified ' + r.modifiedCount + ', deleted ' + r.deletedCount);
      err.name = 'MongoBulkWriteError'; err.writeErrors = errors; err.result = r;
      throw err;
    }
    return r;
  };

  /* --- indexes --- */
  function defaultIndexName(key) { return Object.keys(key).map(function (k) { return k + '_' + key[k]; }).join('_'); }
  function specOf(idx) {
    var o = { v: 2, key: clone(idx.key), name: idx.name };
    ['unique', 'sparse', 'partialFilterExpression', 'expireAfterSeconds', 'hidden', 'weights', 'default_language', 'wildcardProjection', 'collation', 'textIndexVersion'].forEach(function (k) { if (idx[k] !== undefined) o[k] = clone(idx[k]); });
    return o;
  }
  CO.createIndex = function (key, options) {
    options = options || {};
    if (!isObj(key) || !Object.keys(key).length) throw serverError('Index key pattern must be a non-empty object', 67, 'CannotCreateIndex');
    var keys = Object.keys(key);
    keys.forEach(function (k) {
      var v = key[k];
      if (!(v === 1 || v === -1 || v === 'text' || v === 'hashed' || v === '2dsphere' || v === '2d')) throw serverError('Values in the index key pattern can only be 1, -1, "text", "hashed", "2dsphere" or "2d". Got ' + fmtInline(v, 0) + ' for ' + k, 67, 'CannotCreateIndex');
    });
    if (keys.filter(function (k) { return key[k] === 'hashed'; }).length > 1) throw serverError('A maximum of one index field is allowed to be hashed', 31303, 'Location31303');
    var s = this._writable(), eng = this._engine;
    var text = keys.some(function (k) { return key[k] === 'text'; });
    var name = options.name || (text ? keys.filter(function (k) { return key[k] === 'text'; }).map(function (k) { return k + '_text'; }).join('_') : defaultIndexName(key));
    var normKey = key;
    var sameKey = s.indexes.filter(function (i) { return keyOf(i.key) === keyOf(normKey) && keyOf(i.partialFilterExpression || null) === keyOf(options.partialFilterExpression || null); })[0];
    if (sameKey) {
      if (sameKey.name !== name && options.name) throw serverError('Index already exists with a different name: ' + sameKey.name, 85, 'IndexOptionsConflict');
      if (!!sameKey.unique !== !!options.unique) throw serverError('An existing index has the same name as the requested index. When index names are not specified, they are auto generated and can cause conflicts. Existing index: ' + fmtInline(specOf(sameKey), 0), 86, 'IndexKeySpecsConflict');
      return sameKey.name;
    }
    if (s.indexes.some(function (i) { return i.name === name; })) throw serverError('An existing index has the same name as the requested index but a different key: ' + name, 86, 'IndexKeySpecsConflict');
    if (text && s.indexes.some(isTextIndex)) throw serverError('An equivalent text index already exists. Only one text index is allowed per collection: ' + s.indexes.filter(isTextIndex)[0].name, 85, 'IndexOptionsConflict');
    if (keys.length > 1) {
      s.docs.forEach(function (d) {
        var arr = [], arrayPaths = {};
        keys.forEach(function (k) {
          var parts = k.split('.'), cur = d;
          for (var pi = 0; pi < parts.length && cur && typeof cur === 'object'; pi++) {
            cur = cur[parts[pi]];
            if (Array.isArray(cur)) { var p = parts.slice(0, pi + 1).join('.'); if (!arrayPaths[p]) { arrayPaths[p] = 1; arr.push(k); } return; }
          }
        });
        if (arr.length > 1) throw serverError('Index build failed: cannot index parallel arrays [' + arr[1] + '] [' + arr[0] + '] (document _id: ' + fmtInline(d._id, 0) + ')', 171, 'CannotIndexParallelArrays');
      });
    }
    if (options.expireAfterSeconds !== undefined && (keys.length > 1 || keys[0] === '_id')) throw serverError('TTL indexes are single-field indexes and cannot be on _id', 67, 'CannotCreateIndex');
    var idx = { v: 2, key: clone(key), name: name, createdAt: new Date() };
    ['unique', 'sparse', 'partialFilterExpression', 'expireAfterSeconds', 'hidden', 'weights', 'default_language', 'wildcardProjection', 'collation'].forEach(function (k) { if (options[k] !== undefined) idx[k] = clone(options[k]); });
    if (text) { idx.textIndexVersion = 3; idx.default_language = idx.default_language || 'english'; idx.weights = idx.weights || (function () { var w = {}; keys.forEach(function (k) { if (key[k] === 'text') w[k] = 1; }); return w; })(); }
    if (idx.unique) {
      var m = new Map();
      s.docs.forEach(function (d) {
        uniqueKeys(idx, d).forEach(function (k) {
          if (m.has(k.str)) throw dupError(s, idx, k.vals);
          m.set(k.str, d);
        });
      });
    }
    s.indexes.push(idx);
    s.uniq = null;
    eng.touch(s);
    return name;
  };
  CO.ensureIndex = CO.createIndex;
  CO.createIndexes = function (list, options) { var self = this; return list.map(function (k) { return self.createIndex(k, options); }); };
  CO.getIndexes = function () { var s = this._s(false); return s ? s.indexes.map(specOf) : []; };
  CO.getIndexKeys = function () { return this.getIndexes().map(function (i) { return i.key; }); };
  CO.dropIndex = function (nameOrKey) {
    var s = this._s(false);
    if (!s) throw serverError('ns not found ' + this.getFullName(), 26, 'NamespaceNotFound');
    if (nameOrKey === '*') return this.dropIndexes();
    var idx = s.indexes.filter(function (i) { return typeof nameOrKey === 'string' ? i.name === nameOrKey : keyOf(i.key) === keyOf(nameOrKey); })[0];
    if (!idx) throw serverError('index not found with name [' + (typeof nameOrKey === 'string' ? nameOrKey : fmtInline(nameOrKey, 0)) + ']', 27, 'IndexNotFound');
    if (idx.name === '_id_') throw serverError('cannot drop _id index', 72, 'InvalidOptions');
    s.indexes = s.indexes.filter(function (i) { return i !== idx; });
    delete s.usage[idx.name];
    s.uniq = null; this._engine.touch(s);
    return { nIndexesWas: s.indexes.length + 1, ok: 1 };
  };
  CO.dropIndexes = function (names) {
    var s = this._s(false);
    if (!s) throw serverError('ns not found ' + this.getFullName(), 26, 'NamespaceNotFound');
    var before = s.indexes.length;
    if (Array.isArray(names)) { var self = this; names.forEach(function (n) { self.dropIndex(n); }); }
    else if (names) this.dropIndex(names);
    else { s.indexes = s.indexes.filter(function (i) { return i.name === '_id_'; }); s.uniq = null; this._engine.touch(s); }
    return { nIndexesWas: before, msg: 'non-_id indexes dropped for collection', ok: 1 };
  };
  CO.hideIndex = function (n) { return this._setHidden(n, true); };
  CO.unhideIndex = function (n) { return this._setHidden(n, false); };
  CO._setHidden = function (n, hidden) {
    var s = this._s(false), idx = s && s.indexes.filter(function (i) { return typeof n === 'string' ? i.name === n : keyOf(i.key) === keyOf(n); })[0];
    if (!idx) throw serverError('index not found', 27, 'IndexNotFound');
    var was = !!idx.hidden;
    if (hidden) idx.hidden = true; else delete idx.hidden;
    this._engine.touch(s);
    return { hidden_old: was, hidden_new: hidden, ok: 1 };
  };

  /* --- collection admin --- */
  CO.stats = function () {
    var s = this._s(false);
    if (!s) return { ns: this.getFullName(), count: 0, size: 0, ok: 1 };
    var size = 0;
    s.docs.forEach(function (d) { size += JSON.stringify(encode(d)).length + 16; });
    var idxSizes = {}, total = 0;
    s.indexes.forEach(function (i) { var b = Math.round(s.docs.length * (18 + 9 * Object.keys(i.key).length)); idxSizes[i.name] = b; total += b; });
    return {
      ns: s.ns, size: size, count: s.docs.length, avgObjSize: s.docs.length ? Math.round(size / s.docs.length) : 0,
      storageSize: Math.round(size * 0.38), freeStorageSize: 0, capped: !!s.options.capped,
      wiredTiger: { 'block-manager': { 'file bytes available for reuse': 0 }, creationString: 'block_compressor=snappy,...' },
      nindexes: s.indexes.length, indexBuilds: [], totalIndexSize: total, totalSize: Math.round(size * 0.38) + total, indexSizes: idxSizes,
      scaleFactor: 1, ok: 1, simulatorNote: 'Sizes are estimates (snappy ~2.6x compression assumed).'
    };
  };
  CO.dataSize = function () { return this.stats().size; };
  CO.storageSize = function () { return this.stats().storageSize; };
  CO.totalIndexSize = function () { return this.stats().totalIndexSize; };
  CO.isCapped = function () { var s = this._s(false); return !!(s && s.options.capped); };
  CO.drop = function () {
    var d = this._engine.dbs[this._dbName];
    if (!d || !d[this._name]) return false;
    var s = d[this._name];
    delete d[this._name];
    this._engine._dirty = true;
    this._engine._event(s, { operationType: 'drop' });
    return true;
  };
  CO.renameCollection = function (newName, dropTarget) {
    var d = this._engine.dbs[this._dbName];
    if (!d || !d[this._name]) throw serverError('source namespace does not exist', 26, 'NamespaceNotFound');
    if (d[newName] && !dropTarget) throw serverError('target namespace exists', 48, 'NamespaceExists');
    var s = d[this._name]; delete d[this._name];
    s.ns = this._dbName + '.' + newName; s.dirty = true; d[newName] = s;
    this._engine._dirty = true;
    return { ok: 1 };
  };
  CO.validate = function () {
    var s = this._s(false);
    return { ns: this.getFullName(), nInvalidDocuments: 0, nNonCompliantDocuments: s && s.options.validator ? s.docs.filter(function (d) { return validateDoc(s, d); }).length : 0, nrecords: s ? s.docs.length : 0, nIndexes: s ? s.indexes.length : 0, valid: true, repaired: false, warnings: [], errors: [], ok: 1 };
  };
  CO.explain = function (verbosity) {
    var c = this, v = normalizeVerbosity(verbosity === undefined ? 'queryPlanner' : verbosity);
    return {
      find: function (f, p) { var cur = c.find(f, p); cur._explainMode = v; return cur; },
      aggregate: function (p) { return c._explainAggregate(Array.isArray(p) ? p : Array.prototype.slice.call(arguments), v); },
      count: function (f) { return c.find(f || {}).explain(v); },
      countDocuments: function (f) { return c.find(f || {}).explain(v); },
      distinct: function (field, f) { return c.find(f || {}).explain(v); },
      findOne: function (f, p) { return c.find(f, p).limit(1).explain(v); },
      __mmDisplay: function () { return 'Explainable(' + c.getFullName() + ')'; }
    };
  };
  CO.watch = function (pipeline, options) { return new ChangeStream(this._engine, { db: this._dbName, coll: this._name }, pipeline, options); };
  CO.getShardDistribution = function () { return 'Collection ' + this.getFullName() + ' is not sharded (the playground runs a single mongod). Use the Sharding simulator on the Architecture page.'; };

  /* ------------------------------------------------------------------
     Sessions + transactions
     ------------------------------------------------------------------ */
  var sessionSeq = 0;
  function Session(engine, options) {
    this._engine = engine; this.txn = null; this.options = options || {};
    this.id = { id: 'UUID("' + hex(hashStr(String(Date.now()) + (++sessionSeq)), 8) + '-0000-4000-8000-' + hex(sessionSeq, 12) + '")' };
    engine.sessions.push(this);
  }
  MM.Session = Session;
  Session.prototype.__mmDisplay = function () { return 'session { "id" : ' + this.id.id + ' }' + (this.txn ? ' (transaction in progress)' : ''); };
  Session.prototype.getDatabase = function (name) { return MM.makeDb(this._engine, name, this); };
  Session.prototype.startTransaction = function (opts) {
    if (this.txn) throw serverError('Transaction already in progress on this session.', 256, 'TransactionInProgress');
    this.txn = { colls: {}, options: opts || {}, startedAt: new Date() };
  };
  Session.prototype.inTransaction = function () { return !!this.txn; };
  Session.prototype.abortTransaction = function () {
    if (!this.txn) throw serverError('No transaction started', 251, 'NoSuchTransaction');
    this.txn = null;
    return { ok: 1 };
  };
  Session.prototype.commitTransaction = function () {
    if (!this.txn) throw serverError('No transaction started', 251, 'NoSuchTransaction');
    var eng = this._engine, txn = this.txn;
    var changes = [];
    Object.keys(txn.colls).forEach(function (ns) {
      var w = txn.colls[ns], dbName = ns.split('.')[0], cn = ns.split('.').slice(1).join('.');
      var committed = eng.getStore(dbName, cn, true);
      var curById = new Map();
      committed.docs.forEach(function (d) { curById.set(keyOf(d._id), d); });
      var workById = new Map();
      w.docs.forEach(function (d) { workById.set(keyOf(d._id), d); });
      w.touched.forEach(function (idk) {
        var cur = curById.get(idk), snap = w.snapshot.has(idk) ? w.snapshot.get(idk) : null;
        if ((cur ? keyOf(cur) : null) !== snap) {
          eng.sessions.forEach(function (s) { if (s.txn === txn) s.txn = null; });
          throw serverError('WriteConflict during commit: a document changed outside the transaction. The transaction was aborted.', 112, 'WriteConflict', { errorLabels: ['TransientTransactionError'] });
        }
      });
      changes.push({ committed: committed, work: w, workById: workById, curById: curById });
    });
    changes.forEach(function (c) {
      c.work.touched.forEach(function (idk) {
        var oldDoc = c.curById.get(idk), newDoc = c.workById.get(idk);
        if (oldDoc && newDoc) { var i = c.committed.docs.indexOf(oldDoc); c.committed.docs[i] = newDoc; eng._event(c.committed, buildUpdateEvent(oldDoc, newDoc, 'update')); }
        else if (oldDoc && !newDoc) { c.committed.docs.splice(c.committed.docs.indexOf(oldDoc), 1); eng._event(c.committed, { operationType: 'delete', documentKey: { _id: oldDoc._id } }); }
        else if (!oldDoc && newDoc) { c.committed.docs.push(newDoc); eng._event(c.committed, { operationType: 'insert', fullDocument: clone(newDoc), documentKey: { _id: newDoc._id } }); }
      });
      c.committed.uniq = null;
      eng.touch(c.committed);
    });
    this.txn = null;
    return { ok: 1 };
  };
  Session.prototype.withTransaction = function (fn, opts) {
    for (var attempt = 1; attempt <= 3; attempt++) {
      this.startTransaction(opts);
      try {
        var r = fn(this);
        this.commitTransaction();
        return r;
      } catch (e) {
        if (this.txn) this.txn = null;
        var transient = e.errorLabels && e.errorLabels.indexOf('TransientTransactionError') >= 0;
        if (!transient || attempt === 3) throw e;
      }
    }
  };
  Session.prototype.endSession = function () {
    this.txn = null;
    var a = this._engine.sessions, i = a.indexOf(this);
    if (i >= 0) a.splice(i, 1);
  };

  /* ------------------------------------------------------------------
     Pipeline stepper (for the visualizer)
     ------------------------------------------------------------------ */
  EP.stepPipeline = function (dbName, collName, pipeline) {
    var coll = new Collection(this, dbName, collName, null), out = [], docs;
    var store = this.getStore(dbName, collName, false);
    var view = coll._resolveView();
    docs = view ? runPipeline(coll, view.docs.map(clone), view.pipeline) : (store ? store.docs.map(clone) : []);
    out.push({ label: 'source: ' + dbName + '.' + collName, count: docs.length, sample: docs.slice(0, 3) });
    for (var i = 0; i < pipeline.length; i++) {
      var st = pipeline[i], name = Object.keys(st)[0], t0 = performance.now();
      if (name === '$out' || name === '$merge') { out.push({ label: name, stage: st, count: docs.length, sample: [], note: 'Writes ' + docs.length + ' documents to the target (not executed by the stepper).' }); break; }
      try {
        if (name === '$match' && st.$match.$text && store) {
          var ts = textSearch(store, st.$match.$text), q = compileQuery(stripText(st.$match));
          docs = store.docs.filter(function (d) { return ts.scores.has(d) && q.test(d); }).map(clone);
        } else docs = runPipeline(coll, docs, [replaceMeta(st, 'textScore', '__ts')]);
      } catch (e) { out.push({ label: name, stage: st, error: e.message }); break; }
      out.push({ label: name, stage: st, count: docs.length, sample: docs.slice(0, 3), ms: Math.round((performance.now() - t0) * 10) / 10 });
    }
    return out;
  };

  /* ------------------------------------------------------------------
     Exports
     ------------------------------------------------------------------ */
  MM.util = {
    clone: clone, keyOf: keyOf, cmp: cmp, isDate: isDate, isRegExp: isRegExp, isObj: isObj, isOid: isOid,
    getExact: getExact, setExact: setExact, newOid: newOid, serverError: serverError, hex: hex,
    fmt: fmt, fmtInline: fmtInline, encode: encode, decode: decode, specOf: specOf, planSummary: planSummary
  };
  MM.fmt = fmt;
})();
