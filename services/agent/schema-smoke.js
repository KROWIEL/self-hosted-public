const { execSync } = require('node:child_process');
const base = 'http://localhost:18099/api';
const H = { 'Content-Type': 'application/json', Authorization: 'Bearer testtoken' };

async function j(path, opts) {
  const r = await fetch(base + path, opts);
  return r.json();
}
const sh = (c) => execSync(c).toString().trim();

async function waitReady(container, engine, user, pass, dbName) {
  for (let i = 0; i < 40; i++) {
    await new Promise((s) => setTimeout(s, 1500));
    const st = await j('/databases/status', {
      method: 'POST', headers: H,
      body: JSON.stringify({ container, engine, user, password: pass, dbName }),
    });
    if (st.ready) return true;
  }
  return false;
}

async function testPostgres() {
  const container = 'pg-sc', volume = 'pgvol-sc';
  await j('/databases', { method: 'POST', headers: H, body: JSON.stringify({
    container, volume, image: 'postgres:16-alpine', dataDir: '/var/lib/postgresql/data',
    internalPort: 5432, env: { POSTGRES_USER: 'app', POSTGRES_PASSWORD: 'pw', POSTGRES_DB: 'main_db' },
  }) });
  await waitReady(container, 'postgres', 'app', 'pw', 'main_db');
  console.log('pg schema:', JSON.stringify(await j('/databases/schema', {
    method: 'POST', headers: H,
    body: JSON.stringify({ container, engine: 'postgres', user: 'app', password: 'pw', schema: 'admin_db' }),
  })));
  const list = sh(`docker exec ${container} psql -U app -d postgres -tAc "SELECT datname FROM pg_database"`);
  const ok = list.includes('main_db') && list.includes('admin_db');
  console.log('pg databases:', list.replace(/\s+/g, ' '), ok ? 'PG_OK' : 'PG_FAIL');
  await j('/databases', { method: 'DELETE', headers: H, body: JSON.stringify({ container, volume, keepVolume: false }) });
  return ok;
}

async function testMysql() {
  const container = 'my-sc', volume = 'myvol-sc';
  await j('/databases', { method: 'POST', headers: H, body: JSON.stringify({
    container, volume, image: 'mysql:8.4', dataDir: '/var/lib/mysql',
    internalPort: 3306, env: { MYSQL_ROOT_PASSWORD: 'pw', MYSQL_DATABASE: 'main_db', MYSQL_USER: 'app', MYSQL_PASSWORD: 'pw' },
  }) });
  const ready = await waitReady(container, 'mysql', 'app', 'pw', 'main_db');
  console.log('mysql ready:', ready);
  let res = { ok: false };
  for (let i = 0; i < 25 && !res.ok; i++) {
    res = await j('/databases/schema', {
      method: 'POST', headers: H,
      body: JSON.stringify({ container, engine: 'mysql', user: 'app', password: 'pw', schema: 'admin_db' }),
    });
    if (!res.ok) await new Promise((s) => setTimeout(s, 1500));
  }
  console.log('mysql schema:', JSON.stringify(res));
  const list = sh(`docker exec ${container} mysql -uroot -ppw -N -e "SHOW DATABASES"`);
  const ok = list.includes('main_db') && list.includes('admin_db');
  console.log('mysql databases:', list.replace(/\s+/g, ' '), ok ? 'MYSQL_OK' : 'MYSQL_FAIL');
  await j('/databases', { method: 'DELETE', headers: H, body: JSON.stringify({ container, volume, keepVolume: false }) });
  return ok;
}

(async () => {
  const pg = await testPostgres();
  const my = await testMysql();
  console.log(pg && my ? 'ALL_OK' : 'SOME_FAIL');
})().catch((e) => { console.error(e); process.exit(1); });
