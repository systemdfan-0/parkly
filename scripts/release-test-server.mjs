// Тестовый сервер релизов: отдаёт release-test/ (манифесты и тестовый APK) на порту из release.config.json.
// Из эмулятора Android компьютер доступен как http://10.0.2.2:<порт>. Только для отладочной сборки:
// в релизе приложение принимает манифест и APK исключительно по HTTPS с доверенных хостов.
import { createServer } from 'node:http';
import { readFileSync, statSync, createReadStream } from 'node:fs';
import { join, extname, normalize } from 'node:path';

const cfg = JSON.parse(readFileSync(new URL('../release.config.json', import.meta.url)));
const root = new URL('../release-test/', import.meta.url).pathname;
const types = { '.json': 'application/json; charset=utf-8', '.apk': 'application/vnd.android.package-archive' };

createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(root, path);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  try {
    const st = statSync(file);
    if (!st.isFile()) throw new Error();
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Content-Length': st.size });
    createReadStream(file).pipe(res);
    console.log(new Date().toISOString(), req.socket.remoteAddress, 'GET', path, 200, st.size);
  } catch {
    res.writeHead(404).end('not found');
    console.log(new Date().toISOString(), req.socket.remoteAddress, 'GET', path, 404);
  }
}).listen(cfg.testServerPort, '127.0.0.1', () => console.log(`release-test server: http://localhost:${cfg.testServerPort}/ (эмулятор: http://10.0.2.2:${cfg.testServerPort}/)`));
