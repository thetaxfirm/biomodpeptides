// Native SQLite transactions and synthetic anonymous categories only. No network or customer records.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, filename);
let networkCalls = 0;
global.fetch = async () => { networkCalls++; throw Error('Network forbidden in storage tests'); };
const root = path.resolve(__dirname, '..');
const server = require('../lib/traffic-metrics-server.ts');
const traffic = require('../lib/traffic-metrics.ts');
const shopping = require('../lib/shopping-metrics.ts');
const migrations = fs.readdirSync(path.join(root, 'drizzle')).filter(file => file.endsWith('.sql')).sort()
  .map(file => fs.readFileSync(path.join(root, 'drizzle', file), 'utf8')).join('\n');
const now = Date.parse('2026-11-27T14:20:30.123Z'), minute = Math.floor(now / 60000) * 60000;
const day = traffic.trafficUtcDay(now), DAY = traffic.TRAFFIC_DAY_MS;
const event = { event: 'page_view', pageGroup: 'product', sourceGroup: 'search' };
const stage = { event: 'cart_view' };
const privateText = 'PRIVATE_FIXTURE_NEVER_PERSIST';

// Keep the D1 statement result shape, including meta.changes from the actual SQL statement.
function d1(sqlite) {
  const queries = [];
  function prepare(sql, args = []) {
    const execute = () => { queries.push({ sql, args }); return { meta: sqlite.prepare(sql).run(...args) }; };
    return {
      bind: (...bound) => prepare(sql, bound),
      first: async () => { queries.push({ sql, args }); return sqlite.prepare(sql).get(...args) || null; },
      all: async () => { queries.push({ sql, args }); return { results: sqlite.prepare(sql).all(...args) }; },
      run: async () => execute(),
      _execute: execute,
    };
  }
  return { queries, prepare, async batch(statements) {
    sqlite.exec('BEGIN IMMEDIATE');
    try { const results = statements.map(statement => statement._execute()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
}
function fixture() {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec(migrations);
  return { sqlite, db: d1(sqlite), close: () => sqlite.close() };
}
const sum = (sqlite, table) => sqlite.prepare(`SELECT COALESCE(SUM(event_count),0) n FROM ${table}`).get().n;
const coverage = sqlite => sqlite.prepare('SELECT kind,started_at FROM metrics_time_coverage ORDER BY kind').all().map(row => ({ ...row }));
const health = sqlite => sqlite.prepare('SELECT * FROM traffic_metrics_health WHERE id=1').get();

async function acceptedAndCapped() {
  const { sqlite, db, close } = fixture();
  try {
    assert.equal(await server.recordTraffic(db, event, now), true);
    assert.equal(await server.recordTraffic(db, event, now + 1), true);
    assert.equal(sum(sqlite, 'traffic_daily'), 2);
    assert.deepEqual(sqlite.prepare('SELECT * FROM traffic_minute').all().map(row => ({ ...row })), [
      { bucket: minute, page_group: 'product', source_group: 'search', event_count: 2 },
    ]);
    assert.deepEqual(coverage(sqlite), [{ kind: 'traffic', started_at: now }]);
    await server.recordTraffic(db, { ...event, sourceGroup: 'social' }, now + 60000);
    assert.equal(sum(sqlite, 'traffic_daily'), 3); assert.equal(sum(sqlite, 'traffic_minute'), 3);
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM traffic_minute').get().n, 2);
    await server.recordShopping(db, stage, now + 2);
    assert.equal(sum(sqlite, 'shopping_daily'), 1); assert.equal(sum(sqlite, 'shopping_minute'), 1);
    assert.deepEqual(coverage(sqlite), [{ kind: 'shopping', started_at: now + 2 }, { kind: 'traffic', started_at: now }]);
    // Cross-category cap rejection must reset changes() after cleanup's successful health write.
    sqlite.prepare('INSERT INTO traffic_daily VALUES(?,?,?,?)').run(day, 'home', 'direct_or_unavailable', traffic.TRAFFIC_DAILY_CAP - 3);
    const before = coverage(sqlite);
    assert.equal(await server.recordTraffic(db, { ...event, pageGroup: 'guide' }, now + 120000), false);
    assert.equal(sum(sqlite, 'traffic_daily'), traffic.TRAFFIC_DAILY_CAP);
    assert.equal(sum(sqlite, 'traffic_minute'), 3); assert.deepEqual(coverage(sqlite), before);
    assert.equal(await server.recordShopping(db, stage, now + 120000), true, 'traffic saturation cannot consume shopping allowance');
    sqlite.prepare('INSERT INTO shopping_daily VALUES(?,?,?)').run(day, 'cart_add_confirmed', shopping.SHOPPING_DAILY_CAP - 2);
    assert.equal(await server.recordShopping(db, { event: 'checkout_form_view' }, now + 180000), false);
    assert.equal(sum(sqlite, 'shopping_daily'), shopping.SHOPPING_DAILY_CAP); assert.equal(sum(sqlite, 'shopping_minute'), 2);
    assert.equal(await server.recordTraffic(db, event, now + DAY), true, 'the next UTC date has its own allowance');
    assert.equal(await server.recordShopping(db, stage, now + DAY), true);
    assert.deepEqual(coverage(sqlite), before, 'future writes cannot move the first observed collection time forward');
  } finally { close(); }
  // Rejected first events provide no fabricated minute coverage, in either direction.
  for (const kind of ['traffic', 'shopping']) {
    const { sqlite, db, close } = fixture();
    try {
      if (kind === 'traffic') sqlite.prepare('INSERT INTO traffic_daily VALUES(?,?,?,?)').run(day, 'home', 'internal', traffic.TRAFFIC_DAILY_CAP);
      else sqlite.prepare('INSERT INTO shopping_daily VALUES(?,?,?)').run(day, 'cart_view', shopping.SHOPPING_DAILY_CAP);
      assert.equal(await (kind === 'traffic' ? server.recordTraffic(db, event, now) : server.recordShopping(db, stage, now)), false);
      assert.deepEqual(coverage(sqlite), []); assert.equal(sum(sqlite, kind + '_minute'), 0);
      const other = kind === 'traffic' ? 'shopping' : 'traffic';
      assert.equal(await (other === 'traffic' ? server.recordTraffic(db, event, now) : server.recordShopping(db, stage, now)), true);
      assert.deepEqual(coverage(sqlite), [{ kind: other, started_at: now }]);
    } finally { close(); }
  }
}

async function atomicFailures() {
  for (const kind of ['traffic', 'shopping']) {
    for (const failingTable of [kind + '_minute', 'metrics_time_coverage']) {
      const { sqlite, db, close } = fixture();
      try {
        const record = at => kind === 'traffic' ? server.recordTraffic(db, event, at) : server.recordShopping(db, stage, at);
        sqlite.exec(`CREATE TRIGGER fixture_reject BEFORE INSERT ON ${failingTable} BEGIN SELECT RAISE(ABORT,'fixture storage unavailable'); END`);
        await assert.rejects(record(now), /fixture storage unavailable/);
        assert.equal(sum(sqlite, kind + '_daily'), 0, 'failed minute or coverage insertion rolls back the daily acceptance');
        assert.equal(sum(sqlite, kind + '_minute'), 0); assert.deepEqual(coverage(sqlite), []);
        sqlite.exec('DROP TRIGGER fixture_reject');
        assert.equal(await record(now + 1), true);
        const firstCoverage = coverage(sqlite);
        sqlite.exec(`CREATE TRIGGER fixture_reject BEFORE UPDATE ON ${kind}_minute BEGIN SELECT RAISE(ABORT,'fixture storage unavailable'); END`);
        await assert.rejects(record(now + 2), /fixture storage unavailable/);
        assert.equal(sum(sqlite, kind + '_daily'), 1, 'existing daily increment also rolls back');
        assert.equal(sum(sqlite, kind + '_minute'), 1); assert.deepEqual(coverage(sqlite), firstCoverage);
      } finally { close(); }
    }
  }
}

async function retentionAndHealth() {
  const { sqlite, db, close } = fixture();
  try {
    const cutoff = Math.floor(now / DAY) * DAY - 89 * DAY, expired = cutoff - 60000;
    for (const stamp of [cutoff, expired]) {
      sqlite.prepare('INSERT INTO traffic_daily VALUES(?,?,?,?)').run(traffic.trafficUtcDay(stamp), 'home', 'internal', 1);
      sqlite.prepare('INSERT INTO shopping_daily VALUES(?,?,?)').run(traffic.trafficUtcDay(stamp), 'cart_view', 1);
      sqlite.prepare('INSERT INTO traffic_minute VALUES(?,?,?,?)').run(stamp, 'home', 'internal', 1);
      sqlite.prepare('INSERT INTO shopping_minute VALUES(?,?,?)').run(stamp, 'cart_view', 1);
    }
    sqlite.prepare('INSERT INTO metrics_time_coverage VALUES(?,?)').run('traffic', expired);
    sqlite.exec("CREATE TRIGGER fixture_cleanup_failure BEFORE DELETE ON shopping_minute BEGIN SELECT RAISE(ABORT,'PRIVATE_FIXTURE_NEVER_PERSIST'); END");
    await assert.rejects(server.cleanupTraffic(db, now), /^Error: Traffic storage is unavailable\.$/);
    for (const table of ['traffic_daily', 'shopping_daily', 'traffic_minute', 'shopping_minute']) assert.equal(sum(sqlite, table), 2, 'cleanup is atomic across all four aggregate tables');
    assert.equal(health(sqlite).last_status, 'failed'); assert.equal(health(sqlite).last_success, null); assert.equal(health(sqlite).last_failure, now);
    sqlite.exec('DROP TRIGGER fixture_cleanup_failure');
    const result = await server.cleanupTraffic(db, now + 1);
    assert.equal(result.status, 'ok'); assert.equal(result.lastFailureAt, new Date(now).toISOString());
    assert.equal(result.lastSuccessAt, new Date(now + 1).toISOString());
    for (const table of ['traffic_daily', 'shopping_daily', 'traffic_minute', 'shopping_minute']) assert.equal(sum(sqlite, table), 1);
    for (const table of ['traffic_minute', 'shopping_minute']) assert.equal(sqlite.prepare(`SELECT bucket FROM ${table}`).get().bucket, cutoff);
    assert.deepEqual(coverage(sqlite), [{ kind: 'traffic', started_at: expired }], 'retention never invents a new activation time');
    const unavailable = { prepare: sql => sql.startsWith('INSERT INTO traffic_metrics_health') ? { bind: () => ({ run: async () => { throw Error(privateText); } }) } : db.prepare(sql), batch: async () => { throw Error(privateText); } };
    await assert.rejects(server.cleanupTraffic(unavailable, now + 2), /^Error: Traffic storage is unavailable\.$/);
    assert(!JSON.stringify(health(sqlite)).includes(privateText));
  } finally { close(); }
}

async function privacyAndSchema() {
  const { sqlite, db, close } = fixture();
  try {
    for (const [table, columns] of [
      ['traffic_minute', ['bucket', 'page_group', 'source_group', 'event_count']],
      ['shopping_minute', ['bucket', 'stage', 'event_count']],
      ['metrics_time_coverage', ['kind', 'started_at']],
    ]) assert.deepEqual(sqlite.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name), columns);
    for (const invalid of [null, [], { ...event, email: privateText }, { ...event, path: privateText }, { ...event, pageGroup: privateText }]) await assert.rejects(server.recordTraffic(db, invalid, now), /Invalid traffic event/);
    for (const invalid of [null, [], { ...stage, order: privateText }, { event: privateText }]) await assert.rejects(server.recordShopping(db, invalid, now), /Invalid shopping event/);
    assert.deepEqual(db.queries, [], 'invalid and private attributes are rejected before any database access');
    for (const bucket of [-60000, minute + 1, 0.5]) {
      assert.throws(() => sqlite.prepare('INSERT INTO traffic_minute VALUES(?,?,?,1)').run(bucket, 'home', 'internal'));
      assert.throws(() => sqlite.prepare('INSERT INTO shopping_minute VALUES(?,?,1)').run(bucket, 'cart_view'));
    }
    for (const count of [0, -1, 50001, 1.2]) {
      assert.throws(() => sqlite.prepare('INSERT INTO traffic_minute VALUES(?,?,?,?)').run(minute, 'home', 'internal', count));
      assert.throws(() => sqlite.prepare('INSERT INTO shopping_minute VALUES(?,?,?)').run(minute, 'cart_view', count));
    }
    assert.throws(() => sqlite.prepare('INSERT INTO traffic_minute VALUES(?,?,?,1)').run(minute, privateText, 'internal'));
    assert.throws(() => sqlite.prepare('INSERT INTO traffic_minute VALUES(?,?,?,1)').run(minute, 'home', privateText));
    assert.throws(() => sqlite.prepare('INSERT INTO shopping_minute VALUES(?,?,1)').run(minute, privateText));
    assert.throws(() => sqlite.prepare('INSERT INTO metrics_time_coverage VALUES(?,?)').run(privateText, now));
    assert.throws(() => sqlite.prepare('INSERT INTO metrics_time_coverage VALUES(?,?)').run('traffic', -1));
    assert.throws(() => sqlite.prepare('INSERT INTO metrics_time_coverage VALUES(?,?)').run('traffic', 1.2));
    assert.equal(networkCalls, 0);
  } finally { close(); }
}

async function concurrentAcceptance() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trybiomod-minute-storage-'));
  const filename = path.join(directory, 'fixture.sqlite');
  const sqlite = new DatabaseSync(filename); sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000;'); sqlite.exec(migrations);
  sqlite.prepare('INSERT INTO traffic_daily VALUES(?,?,?,?)').run(day, 'home', 'internal', traffic.TRAFFIC_DAILY_CAP - 12);
  const gate = new SharedArrayBuffer(4);
  const code = `const {parentPort,workerData}=require('node:worker_threads');
    const fs=require('node:fs'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
    const ts=require(workerData.typescript);
    require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,f);
    global.fetch=async()=>{throw Error('Network forbidden');};
    const server=require(path.join(workerData.root,'lib/traffic-metrics-server.ts'));
    const sqlite=new DatabaseSync(workerData.filename);sqlite.exec('PRAGMA busy_timeout=10000;');
    const db=(${d1.toString()})(sqlite),gate=new Int32Array(workerData.gate);
    while(Atomics.load(gate,0)===0)Atomics.wait(gate,0,0);
    (async()=>{let accepted=0;for(let i=0;i<12;i++)if(await server.recordTraffic(db,workerData.event,workerData.now))accepted++;
      sqlite.close();parentPort.postMessage(accepted);})().catch(error=>{parentPort.postMessage({error:error.message});process.exitCode=1;});`;
  const workers = [];
  try {
    for (let index = 0; index < 4; index++) workers.push(new Worker(code, { eval: true, workerData: { root, filename, gate, now, typescript: require.resolve('typescript'), event: { ...event, pageGroup: traffic.TRAFFIC_PAGE_GROUPS[index], sourceGroup: 'search' } } }));
    const outcomes = workers.map(worker => new Promise((resolve, reject) => {
      worker.once('message', value => typeof value === 'number' ? resolve(value) : reject(Error(value.error)));
      worker.once('error', reject); worker.once('exit', code => { if (code) reject(Error('Fixture worker failed ' + code)); });
    }));
    Atomics.store(new Int32Array(gate), 0, 1); Atomics.notify(new Int32Array(gate), 0);
    const accepted = await Promise.all(outcomes);
    assert.equal(accepted.reduce((a, b) => a + b, 0), 12);
    assert.equal(sum(sqlite, 'traffic_daily'), traffic.TRAFFIC_DAILY_CAP);
    assert.equal(sum(sqlite, 'traffic_minute'), 12, 'exactly the accepted concurrent daily events reach minute storage');
    assert.deepEqual(coverage(sqlite), [{ kind: 'traffic', started_at: now }]);
  } finally { await Promise.all(workers.map(worker => worker.terminate())); sqlite.close(); fs.rmSync(directory, { recursive: true, force: true }); }
}

(async () => {
  await acceptedAndCapped(); await atomicFailures(); await retentionAndHealth(); await privacyAndSchema(); await concurrentAcceptance();
  assert.equal(networkCalls, 0);
  console.log('PASS: transactional daily/minute acceptance, independent caps, honest first coverage, rollback on minute/coverage failure, concurrent cap consistency, bounded retention and sanitized health, strict anonymous storage. Isolated SQLite only.');
})().catch(error => { console.error(error); process.exitCode = 1; });
