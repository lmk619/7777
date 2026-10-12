import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const source = path.join(root, 'public');
const dist = path.join(root, 'dist');

if (!fs.existsSync(source)) {
  throw new Error('public 目录不存在');
}

fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(source, dist, { recursive: true });

console.log('EdgeOne build: public -> dist');
