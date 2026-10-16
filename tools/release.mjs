// Marca una versión nueva de NanWar antes de publicar: escribe el mismo número en index.html (APP_VERSION),
// sw.js (VERSION) y version.json. Las apps instaladas comparan su APP_VERSION con version.json y se actualizan solas.
// Uso: node tools/release.mjs   (después, commit y push)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const now = new Date();
const pad = n => String(n).padStart(2, '0');
const version = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

const stamp = (file, pattern, replacement) => {
    const path = join(root, file), text = readFileSync(path, 'utf8');
    if (!pattern.test(text)) throw new Error(`No encuentro la versión en ${file}`);
    writeFileSync(path, text.replace(pattern, replacement));
};
stamp('index.html', /const APP_VERSION = '[^']*';/, `const APP_VERSION = '${version}';`);
stamp('sw.js', /const VERSION = '[^']*';/, `const VERSION = '${version}';`);
writeFileSync(join(root, 'version.json'), JSON.stringify({ version }) + '\n');
console.log(`Versión ${version}`);
