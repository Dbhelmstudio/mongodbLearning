# MongoDB Mastery

An interactive MongoDB course that runs entirely in the browser: from the first query to sharded clusters, production incidents and interview preparation.

**Live site:** https://dbhelmstudio.github.io/mongodbLearning/

## What is inside

- 56 lessons in 41 modules across seven levels, from the document model to sharding, WiredTiger internals, Kubernetes operators, Percona Backup and Monitoring, and vector search. Every example runs against a seeded `shop` database in the page.
- 31 auto-checked exercises and 7 production incident scenarios (slow queries, failed unique index builds, TTL that never fires, point-in-time recovery from the oplog, unbounded arrays, index bloat, schema validation rollout).
- 80 interview questions with model answers, timed mock interviews and a spaced-repetition review deck.
- A certification track mapped to the Associate Developer and Associate DBA exam objectives, with timed practice exams.
- Guides on architecture, performance, internals and version differences, with interactive simulators for elections, rollback, sharding and the write path.
- Docker labs for a real three-member replica set (with Percona Backup for MongoDB) and a minimal sharded cluster.

## Run it locally

It is a static site with no build step.

```bash
npm run serve        # python3 -m http.server on http://127.0.0.1:8765/
```

## Tests

```bash
npm test             # content integrity, engine assertions, every lesson example, exercise and scenario
npm run test:quick   # same, lessons in one mode only
npm install && npm run test:browser   # Playwright smoke test of every route (needs the site served on 8765)
node tests/probe.js -e 'db.orders.findOne()'   # run mongosh code against a fresh seeded engine
```

## Labs

See `labs/replica-set` and `labs/sharded`, and the Labs page on the site for guided drills. Requires Docker with Compose v2. The labs run without authentication and bind to 127.0.0.1; they are for learning only.

## How the in-browser database works

Queries run on [mingo](https://github.com/kofrasa/mingo) (MIT) with [acorn](https://github.com/acornjs/acorn) (MIT) parsing shell code, plus a modelled query planner and `explain()`, indexes (unique, TTL, compound, geospatial, wildcard), schema validation, transactions, change streams, an oplog and collation. Results follow MongoDB semantics; timings and plan choices are modelled, not measured.

MongoDB is a trademark of MongoDB, Inc. Percona is a trademark of Percona LLC. This project is independent and not endorsed by either company.
