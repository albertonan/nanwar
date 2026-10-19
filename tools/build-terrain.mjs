// Añade al europa-data.js existente el terreno real por casilla y los ríos, y genera relieve.png.
// Uso: node basicmilitary/tools/build-terrain.mjs   (build-map.mjs ya lo hace al regenerar el mapa entero)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addTerrain } from './terrain.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const file = join(here, '../europa-data.js');
const text = readFileSync(file, 'utf8');
const data = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
await addTerrain(data, join(here, '../relieve.png'));
writeFileSync(file, `// Generado por tools/build-map.mjs. No editar a mano.\nwindow.EUROPA = ${JSON.stringify(data)};\n`);
console.log(`europa-data.js: ${(readFileSync(file).length / 1024).toFixed(0)} kB; relieve.png: ${(readFileSync(join(here, '../relieve.png')).length / 1024).toFixed(0)} kB`);
