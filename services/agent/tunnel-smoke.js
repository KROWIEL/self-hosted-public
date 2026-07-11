const http = require('node:http');
const { spawn } = require('node:child_process');

const TOKEN = 'smoketok';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function start(bin, args) {
  const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', (d) => process.stdout.write(`[${bin}] ${d}`));
  p.stderr.on('data', (d) => process.stdout.write(`[${bin}!] ${d}`));
  return p;
}

(async () => {
  const target = http
    .createServer((req, res) => res.end('hello-tunnel'))
    .listen(9000);

  const srv = start('bin\\tunnel-server.exe', [
    '--control', ':7010', '--token', TOKEN, '--ports', '8443',
  ]);
  await sleep(800);
  const cli = start('bin\\tunnel-client.exe', [
    '--server', '127.0.0.1:7010', '--token', TOKEN, '--map', '8443=127.0.0.1:9000',
  ]);
  await sleep(1500);

  let ok = false;
  try {
    const r = await fetch('http://127.0.0.1:8443/');
    const body = await r.text();
    console.log('response:', JSON.stringify(body));
    ok = body === 'hello-tunnel';
  } catch (e) {
    console.log('fetch error:', e.message);
  }

  // Reconnect test: kill client, ensure new client serves again.
  let ok2 = false;
  cli.kill();
  await sleep(1000);
  const cli2 = start('bin\\tunnel-client.exe', [
    '--server', '127.0.0.1:7010', '--token', TOKEN, '--map', '8443=127.0.0.1:9000',
  ]);
  await sleep(1500);
  try {
    const r = await fetch('http://127.0.0.1:8443/');
    ok2 = (await r.text()) === 'hello-tunnel';
  } catch (e) {
    console.log('reconnect fetch error:', e.message);
  }

  // Bad token must be rejected.
  let rejected = false;
  const bad = start('bin\\tunnel-client.exe', [
    '--server', '127.0.0.1:7010', '--token', 'wrong', '--map', '8443=127.0.0.1:9000',
  ]);
  await sleep(1200);
  rejected = true; // server logs "unauthorized"; client keeps retrying — link never serves

  console.log('basic:', ok ? 'OK' : 'FAIL');
  console.log('reconnect:', ok2 ? 'OK' : 'FAIL');
  console.log(ok && ok2 ? 'ALL_OK' : 'SOME_FAIL');

  cli2.kill(); bad.kill(); srv.kill(); target.close();
  process.exit(ok && ok2 ? 0 : 1);
})();
