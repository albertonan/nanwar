// Genera mundo-data.js y relieve-mundo.png: el mundo entero (sin la Antártida) en una rejilla de hexágonos de ~50 km
// de radio sobre la proyección Equal Earth (tools/projection-world.mjs).
// - Países: Natural Earth admin-0 agrupado por soberanía (Groenlandia con Dinamarca, Puerto Rico con Estados Unidos…).
//   Población y PIB de Natural Earth (POP_EST, GDP_MD). Los microestados sin casilla propia y con menos de
//   MIN_COUNTRY_POP habitantes se quedan fuera; los que llegan a esa población reciben al menos una casilla.
// - Provincias: Natural Earth admin-1 (estados, provincias, regiones). Las que quedan con menos de MIN_CELLS casillas se
//   funden con una vecina del mismo país (si es posible, de su misma región) para que tengan un tamaño jugable.
// - Ciudades: GeoNames cities1000 (la mayor de cada provincia) y capitales de Natural Earth populated places.
// - Fuerzas iniciales: aproximación a IISS Military Balance 2024 (tabla FORCES); las de los países europeos son las
//   mismas que en europa-data.js. Recursos: resources.json + resources-world.json.
// - Terreno, relieve y ríos: tools/terrain.mjs (los mismos datos reales que el mapa de Europa).
// Uso: node basicmilitary/tools/build-world.mjs   (necesita el repositorio padre GeoSim para cities1000 y admin-1)
//      NO_TERRAIN=salida.json node basicmilitary/tools/build-world.mjs   escribe los datos sin terreno, para revisarlos rápido.
import { existsSync, readFileSync, writeFileSync, mkdirSync, createReadStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import mapshaper from 'mapshaper';
import { projectLonLat, unprojectXY, projectRing, KM_PER_UNIT } from './projection-world.mjs';
import { addTerrain } from './terrain.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const CACHE = join(here, 'cache');
const GEO = join(root, 'tools/geometry/cache');
const out = join(here, '../mundo-data.js');
const readJson = f => JSON.parse(readFileSync(f, 'utf8'));

const HEX = 2.5;                 // radio del hexágono en unidades del mapa (× KM_PER_UNIT km)
const MIN_CELLS = 6;             // casillas mínimas por provincia (si tiene vecinas del mismo país con las que fundirse)
const MIN_COUNTRY_POP = 150000;  // por debajo, un país sin casilla propia no entra en el mapa
const REGION_CELLS = 18;        // regiones que se juntan enteras si sus divisiones son pequeñas (ver más abajo)
const ISLAND_MIN_KM2 = 1500;     // islas (provincias) sin casilla que reciben una propia si son al menos así de grandes
const KM2 = KM_PER_UNIT * KM_PER_UNIT;

// --- Natural Earth (admin-0 y admin-1), simplificado y en caché ---
async function naturalEarth(name, zipUrl, localZip) {
    const file = join(CACHE, `world-${name}.json`);
    if (existsSync(file)) return readJson(file).features;
    mkdirSync(join(CACHE, 'ne'), { recursive: true });
    let zip = localZip;
    if (!zip || !existsSync(zip)) {
        zip = join(CACHE, 'ne', `${name}.zip`);
        if (!existsSync(zip)) {
            const res = await fetch(zipUrl);
            if (!res.ok) throw new Error(`${res.status} ${zipUrl}`);
            writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
        }
    }
    const res = await mapshaper.applyCommands(`-i "${zip}" encoding=utf8 -simplify 10% keep-shapes -o precision=0.001 out.json format=geojson`);
    const features = Object.values(res).map(b => JSON.parse(b.toString())).flatMap(fc => fc.features ?? []);
    writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features }));
    return features;
}
const admin0 = await naturalEarth('admin0', 'https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_countries.zip');
const admin1 = await naturalEarth('admin1', 'https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_1_states_provinces.zip',
    join(GEO, 'ne_10m_admin_1_states_provinces.zip'));

// --- Países: grupos de soberanía ---
// Territorios que se suman a otro grupo (control de hecho) o que forman el suyo propio.
const GROUP_OF = { CYN: 'CYP', CNM: 'CYP', SOL: 'SOM', SAH: 'MAR', PSX: 'PSX', USG: 'US1', KAB: 'KA1' };
const SKIP = new Set(['ATA', 'KAS', 'SPI', 'BRT', 'BRI', 'PGA', 'BJN', 'SER', 'SCR', 'ATF', 'HMD', 'SGS', 'CLP', 'CSI', 'ATC', 'UMI', 'IOT']);
const NAME_FIX = { TWN: 'Taiwán', SWZ: 'Esuatini', CZE: 'Chequia', MMR: 'Birmania', PSX: 'Palestina', IS1: 'Israel' };
const groupOfAdm0 = {};
const groups = new Map();   // clave de grupo → { key, name, pop, gdp, iso2s:Set, main }
for (const f of admin0) {
    const p = f.properties, a3 = p.ADM0_A3;
    if (SKIP.has(a3)) continue;
    const g = GROUP_OF[a3] ?? p.SOV_A3;
    groupOfAdm0[a3] = g;
    const G = groups.get(g) ?? { id: g, pop: 0, gdp: 0, iso2s: new Set(), main: null };
    G.pop += Math.max(0, p.POP_EST); G.gdp += Math.max(0, p.GDP_MD);
    if (p.ISO_A2_EH && p.ISO_A2_EH !== '-99') G.iso2s.add(p.ISO_A2_EH);
    if (!G.main || p.POP_EST > G.main.POP_EST) G.main = p;
    groups.set(g, G);
}
for (const G of groups.values()) {
    G.key = (G.main.ISO_A2_EH !== '-99' ? G.main.ISO_A2_EH : G.main.ADM0_A3.slice(0, 2)).toLowerCase();
    G.name = NAME_FIX[G.main.ADM0_A3] ?? NAME_FIX[G.id] ?? G.main.NAME_ES;
}

// --- Provincias de Natural Earth (admin-1), proyectadas ---
const geoRings = g => (g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : []);
function bboxOf(rings) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const r of rings) for (const [x, y] of r) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
    return [a, b, c, d];
}
function inRings(rings, px, py) {
    let inside = false;
    for (const r of rings) {
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
            const [xi, yi] = r[i], [xj, yj] = r[j];
            if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
        }
    }
    return inside;
}
const ringArea = r => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(s) / 2; };
function ringCentroid(r) {
    let a = 0, x = 0, y = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
        a += f; x += (r[j][0] + r[i][0]) * f; y += (r[j][1] + r[i][1]) * f;
    }
    return Math.abs(a) < 1e-9 ? r[0] : [x / (3 * a), y / (3 * a)];
}
const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const shapes = [];
for (const f of admin1) {
    const p = f.properties;
    // Crimea y Sebastopol, con Ucrania como en el mapa de Europa (Natural Earth las da a Rusia en admin-1).
    const crimea = p.adm0_a3 === 'RUS' && /^(Crimea|Sevastopol)$/.test(p.name);
    const g = crimea ? 'UKR' : groupOfAdm0[p.adm0_a3] ?? GROUP_OF[p.adm0_a3] ?? (SKIP.has(p.adm0_a3) ? null : p.sov_a3);
    if (!g || !groups.has(g) || SKIP.has(p.adm0_a3)) continue;
    const polys = geoRings(f.geometry).map(poly => poly.map(projectRing));
    const rings = polys.flat();
    if (!rings.length) continue;
    // El polígono exterior más grande da el punto de la provincia y su superficie.
    let big = null, area = 0;
    for (const poly of polys) { const ar = ringArea(poly[0]); area += ar; if (!big || ar > ringArea(big)) big = poly[0]; }
    shapes.push({ group: g, name: (crimea ? (p.name === 'Crimea' ? 'Crimea' : 'Sebastopol') : (p.name_es || p.name || p.woe_name || '').trim()) || groups.get(g).name, region: (p.region || '').trim(),
        rings, bbox: bboxOf(rings), area: area * KM2, label: ringCentroid(big) });
}
console.log(`${groups.size} grupos de soberanía, ${shapes.length} provincias de Natural Earth`);

// --- Rejilla ---
const W = Math.sqrt(3) * HEX, STEP = 1.5 * HEX;
const LAT_MIN = -57, LAT_MAX = 84;
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const s of shapes) { minX = Math.min(minX, s.bbox[0]); maxX = Math.max(maxX, s.bbox[2]); minY = Math.min(minY, s.bbox[1]); maxY = Math.max(maxY, s.bbox[3]); }
minY = Math.max(minY, projectLonLat([0, LAT_MAX])[1]); maxY = Math.min(maxY, projectLonLat([0, LAT_MIN])[1]);
const x0 = +(minX - W).toFixed(3), y0 = +(minY - HEX).toFixed(3);
const cols = Math.ceil((maxX - x0) / W) + 2, rows = Math.ceil((maxY - y0) / STEP) + 2, N = cols * rows;
const cx = new Float64Array(N), cy = new Float64Array(N), nb = new Int32Array(N * 6).fill(-1);
{
    const EVEN = [[1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]], ODD = [[1, 0], [1, 1], [0, 1], [-1, 0], [0, -1], [1, -1]];
    for (let i = 0; i < N; i++) {
        const r = Math.floor(i / cols), c = i % cols;
        cx[i] = x0 + W * (c + 0.5 * (r & 1)); cy[i] = y0 + STEP * r;
        (r & 1 ? ODD : EVEN).forEach(([dc, dr], d) => { const nc = c + dc, nr = r + dr; if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) nb[i * 6 + d] = nr * cols + nc; });
    }
}
function cellAt(x, y) {
    const r0 = Math.round((y - y0) / STEP);
    let best = -1, bd = Infinity;
    for (let r = r0 - 1; r <= r0 + 1; r++) {
        if (r < 0 || r >= rows) continue;
        const c0 = Math.round((x - x0) / W - 0.5 * (r & 1));
        for (let c = c0 - 1; c <= c0 + 1; c++) {
            if (c < 0 || c >= cols) continue;
            const i = r * cols + c, d = (cx[i] - x) ** 2 + (cy[i] - y) ** 2;
            if (d < bd) { bd = d; best = i; }
        }
    }
    return best;
}
const neighbors = i => { const o = []; for (let d = 0; d < 6; d++) { const j = nb[i * 6 + d]; if (j >= 0) o.push(j); } return o; };

// Provincia de Natural Earth (índice de `shapes`) que contiene un punto, con un índice espacial por cubos.
const shapeAt = (() => {
    const B = 20, bx = Math.ceil(cols * W / B) + 2, buckets = new Map();
    const bkey = (x, y) => Math.floor((y - y0) / B) * bx + Math.floor((x - x0) / B);
    shapes.forEach((s, k) => {
        for (let y = Math.floor((s.bbox[1] - y0) / B); y <= Math.floor((s.bbox[3] - y0) / B); y++)
            for (let x = Math.floor((s.bbox[0] - x0) / B); x <= Math.floor((s.bbox[2] - x0) / B); x++) {
                const key = y * bx + x; (buckets.get(key) ?? buckets.set(key, []).get(key)).push(k);
            }
    });
    return (x, y) => {
        for (const k of buckets.get(bkey(x, y)) ?? []) {
            const s = shapes[k];
            if (x >= s.bbox[0] && x <= s.bbox[2] && y >= s.bbox[1] && y <= s.bbox[3] && inRings(s.rings, x, y)) return k;
        }
        return -1;
    };
})();
// Casilla → provincia de Natural Earth por su centro.
let cellShape = new Int32Array(N).fill(-1);
for (let i = 0; i < N; i++) cellShape[i] = shapeAt(cx[i], cy[i]);
const shapeCells = () => { const n = new Array(shapes.length).fill(0); for (const v of cellShape) if (v >= 0) n[v]++; return n; };

// Islas sin casilla: las grandes reciben la casilla de mar más cercana a su centro.
{
    const n = shapeCells();
    let added = 0;
    shapes.forEach((s, k) => {
        if (n[k] || s.area < ISLAND_MIN_KM2) return;
        const c = cellAt(...s.label);
        if (c >= 0 && cellShape[c] < 0) { cellShape[c] = k; added++; }
    });
    console.log(`${added} islas sin casilla reciben una`);
}
// Países: los que se quedan sin casillas entran con una si tienen bastante población; los muy pequeños, fuera.
{
    const cellsOf = new Map();
    for (let i = 0; i < N; i++) if (cellShape[i] >= 0) { const g = shapes[cellShape[i]].group; cellsOf.set(g, (cellsOf.get(g) ?? 0) + 1); }
    const dropped = [];
    for (const [g, G] of groups) {
        if (cellsOf.get(g)) continue;
        const own = shapes.map((s, k) => k).filter(k => shapes[k].group === g);
        if (G.pop < MIN_COUNTRY_POP || !own.length) { if (G.pop >= 50000) dropped.push(G.name); groups.delete(g); continue; }
        const k = own.reduce((a, b) => (shapes[b].area > shapes[a].area ? b : a));
        let c = cellAt(...shapes[k].label);
        // Si cae en tierra de otro país (enclave: Singapur, Baréin…), se queda la casilla igualmente.
        if (c < 0) { groups.delete(g); continue; }
        cellShape[c] = k;
    }
    // Sin provincias de admin-1 no hay país: Natural Earth no tiene admin-1 para algunos.
    for (const [g] of groups) if (!shapes.some((s, k) => s.group === g)) groups.delete(g);
    console.log(`fuera del mapa por tamaño: ${dropped.join(', ') || 'ninguno'}`);
}

// --- Provincias: las de Natural Earth con casillas, fundiendo las pequeñas ---
const shapeN = shapeCells();
let provOfShape = new Int32Array(shapes.length).fill(-1);
let provinces = [];
shapes.forEach((s, k) => {
    if (!shapeN[k] || !groups.has(s.group)) return;
    provOfShape[k] = provinces.length;
    provinces.push({ group: s.group, members: [k], cells: shapeN[k], alive: true });
});
let cells = new Int32Array(N).fill(-1);
for (let i = 0; i < N; i++) if (cellShape[i] >= 0) cells[i] = provOfShape[cellShape[i]];
// Vecindad entre provincias por aristas de casilla.
const adj = provinces.map(() => new Map());
for (let i = 0; i < N; i++) {
    const a = cells[i];
    if (a < 0) continue;
    for (const j of neighbors(i)) { const b = cells[j]; if (b >= 0 && b !== a) adj[a].set(b, (adj[a].get(b) ?? 0) + 1); }
}
const regionOf = p => { const r = new Set(p.members.map(k => shapes[k].region)); return r.size === 1 ? [...r][0] : null; };
{
    const parent = provinces.map((_, i) => i);
    const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const merge = (from, into) => {
        const p = provinces[from], q = provinces[into];
        q.members.push(...p.members); q.cells += p.cells; p.alive = false; parent[from] = into;
        for (const [j, n] of adj[from]) {
            adj[j].delete(from);
            if (j === into) continue;
            adj[into].set(j, (adj[into].get(j) ?? 0) + n); adj[j].set(into, (adj[j].get(into) ?? 0) + n);
        }
        adj[into].delete(from); adj[from].clear();
    };
    // Países con divisiones diminutas (departamentos, condados, provincias italianas): primero se juntan por región
    // las regiones que caben en REGION_CELLS casillas.
    const byRegion = new Map();
    provinces.forEach((p, i) => { const r = shapes[p.members[0]].region; if (r) (byRegion.get(`${p.group}|${r}`) ?? byRegion.set(`${p.group}|${r}`, []).get(`${p.group}|${r}`)).push(i); });
    for (const list of byRegion.values()) {
        if (list.length < 2 || list.reduce((a, i) => a + provinces[i].cells, 0) > REGION_CELLS) continue;
        const into = list.reduce((a, i) => (provinces[i].cells > provinces[a].cells ? i : a));
        for (const i of list) if (i !== into) merge(i, into);
    }
    for (;;) {
        // La más pequeña que aún no llega al mínimo y tiene vecinas del mismo país.
        let best = -1;
        for (let i = 0; i < provinces.length; i++) {
            const p = provinces[i];
            if (!p.alive || p.cells >= MIN_CELLS) continue;
            if (![...adj[i].keys()].some(j => provinces[j].group === p.group)) continue;
            if (best < 0 || p.cells < provinces[best].cells) best = i;
        }
        if (best < 0) break;
        const p = provinces[best], reg = regionOf(p);
        const cand = [...adj[best].keys()].filter(j => provinces[j].group === p.group);
        cand.sort((a, b) => {
            const ra = reg && regionOf(provinces[a]) === reg ? 0 : 1, rb = reg && regionOf(provinces[b]) === reg ? 0 : 1;
            return ra - rb || provinces[a].cells - provinces[b].cells;
        });
        merge(best, cand[0]);
    }
    const remap = new Int32Array(provinces.length).fill(-1);
    const kept = [];
    provinces.forEach((p, i) => { if (p.alive) { remap[i] = kept.length; kept.push(p); } });
    for (let i = 0; i < N; i++) if (cells[i] >= 0) cells[i] = remap[find(cells[i])];
    provinces = kept;
}
for (const p of provinces) p.area = p.members.reduce((a, k) => a + shapes[k].area, 0);
// Islotes (provincias de una o dos casillas sin vecina de su país) se suman a la provincia de su país más cercana si
// está a menos de ISLET_REACH casillas: archipiélagos como las Salomón o las Bahamas no son una docena de provincias.
const ISLET_REACH = 8 * W;
{
    let provCells = provinces.map(() => []);
    for (let i = 0; i < N; i++) if (cells[i] >= 0) provCells[cells[i]].push(i);
    const into = provinces.map((_, i) => i);
    const order = provinces.map((_, i) => i).sort((a, b) => provinces[a].cells - provinces[b].cells);
    for (const i of order) {
        const p = provinces[i];
        if (p.cells > 2) continue;
        if (provCells[i].some(c => neighbors(c).some(j => cells[j] >= 0 && cells[j] !== i && provinces[cells[j]].group === p.group))) continue;
        let best = -1, bd = ISLET_REACH ** 2;
        provinces.forEach((q, k) => {
            if (k === i || q.group !== p.group || into[k] !== k) return;
            for (const a of provCells[i]) for (const b of provCells[k]) { const d = (cx[a] - cx[b]) ** 2 + (cy[a] - cy[b]) ** 2; if (d < bd) { bd = d; best = k; } }
        });
        if (best < 0) continue;
        into[i] = best;
        const q = provinces[best];
        q.members.push(...p.members); q.cells += p.cells; q.area += p.area;
        for (const c of provCells[i]) cells[c] = best;
        provCells[best].push(...provCells[i]); provCells[i] = [];
    }
    const remap = new Int32Array(provinces.length).fill(-1), kept = [];
    provinces.forEach((p, i) => { if (into[i] === i) { remap[i] = kept.length; kept.push(p); } });
    for (let i = 0; i < N; i++) if (cells[i] >= 0) cells[i] = remap[cells[i]];
    provinces = kept;
}
const provCells = provinces.map(() => []);
for (let i = 0; i < N; i++) if (cells[i] >= 0) provCells[cells[i]].push(i);

// --- Ciudades (GeoNames cities1000) ---
const groupOfIso2 = new Map();
for (const [g, G] of groups) for (const iso of G.iso2s) groupOfIso2.set(iso, g);
groupOfIso2.set('XK', [...groups.values()].find(G => G.key === 'xk')?.id);
const provOfShapeFinal = new Int32Array(shapes.length).fill(-1);
provinces.forEach((p, i) => { for (const k of p.members) provOfShapeFinal[k] = i; });
const towns = provinces.map(() => []);
{
    const rl = createInterface({ input: createReadStream(join(GEO, 'cities1000.txt'), 'utf8'), crlfDelay: Infinity });
    for await (const line of rl) {
        const f = line.split('\t');
        const pop = +f[14];
        if (!pop || f[6] !== 'P') continue;
        const g = groupOfIso2.get(f[8]);
        if (!g) continue;
        const [x, y] = projectLonLat([+f[5], +f[4]]);
        // La provincia de Natural Earth que la contiene; si esa no tiene casillas, la de su casilla (o, en la costa,
        // la de la casilla de tierra de su país más cercana).
        // La costa simplificada puede dejar fuera una ciudad costera: se prueba también a su alrededor.
        let k = shapeAt(x, y);
        for (let a = 0; k < 0 && a < 8; a++) k = shapeAt(x + 0.4 * Math.cos(a * Math.PI / 4), y + 0.4 * Math.sin(a * Math.PI / 4));
        let pi = k >= 0 && provOfShapeFinal[k] >= 0 && provinces[provOfShapeFinal[k]].group === g ? provOfShapeFinal[k] : -1;
        if (pi < 0) {
            const c = cellAt(x, y);
            if (c < 0) continue;
            const ring1 = neighbors(c), ring2 = ring1.flatMap(neighbors);
            const hit = [c, ...ring1, ...ring2].find(j => cells[j] >= 0 && provinces[cells[j]].group === g);
            if (hit === undefined) continue;
            pi = cells[hit];
        }
        towns[pi].push({ name: f[1], ascii: f[2], pop, x, y, shape: k });
    }
}

// --- Población y productividad ---
// Población del país (Natural Earth): 70 % según la población urbana de cada provincia y 30 % según su superficie.
// Productividad del país: raíz del PIB por habitante respecto a 12 000 $ (entre 0,3 y 2,5), igual en todas sus provincias.
const productivity = new Map();
for (const [g, G] of groups) {
    const pc = G.pop ? G.gdp * 1e6 / G.pop : 0;
    productivity.set(g, +Math.min(2.5, Math.max(0.3, Math.sqrt(pc / 12000) || 0.3)).toFixed(2));
}
{
    const byGroup = new Map();
    provinces.forEach((p, i) => (byGroup.get(p.group) ?? byGroup.set(p.group, []).get(p.group)).push(i));
    for (const [g, list] of byGroup) {
        const townPop = list.map(i => towns[i].reduce((a, t) => a + t.pop, 0));
        const tTown = townPop.reduce((a, b) => a + b, 0) || 1, tCells = list.reduce((a, i) => a + provinces[i].cells, 0);
        const pop = groups.get(g).pop;
        list.forEach((i, k) => { provinces[i].population = Math.max(1000, Math.round(pop * (0.7 * townPop[k] / tTown + 0.3 * provinces[i].cells / tCells))); });
    }
}
const nearestOwn = (pt, i) => provCells[i].reduce((a, c) => ((cx[c] - pt[0]) ** 2 + (cy[c] - pt[1]) ** 2 < (cx[a] - pt[0]) ** 2 + (cy[a] - pt[1]) ** 2 ? c : a), provCells[i][0]);
// Ciudad: la mayor. Nombre de la provincia: el de la región si la cubre entera; si no, el de la parte donde está su
// ciudad (o, sin ciudad, el de su parte más grande).
const regionShapes = new Map();
shapes.forEach((s, k) => { if (shapeN[k] && s.region) { const key = `${s.group}|${s.region}`; regionShapes.set(key, (regionShapes.get(key) ?? 0) + 1); } });
// Nombres que Natural Earth solo trae en inglés o en la lengua local.
const PROVINCE_NAME_FIX = { 'Canary Is.': 'Canarias', Sicily: 'Sicilia', Sardegna: 'Cerdeña', 'Northern Ireland': 'Irlanda del Norte',
    'Highlands and Islands': 'Tierras Altas e Islas', 'Nouvelle-Aquitaine': 'Nueva Aquitania', 'Grand Est': 'Gran Este',
    'Pays de la Loire': 'País del Loira', 'Bourgogne-Franche-Comté': 'Borgoña-Franco Condado' };
const nameProvince = (p, k) => {
    const reg = regionOf(p);
    if (!p.members.includes(k)) k = cellShape[p.city];   // ciudad en una división sin casillas (Berlín, París): la de su casilla
    const part = k >= 0 && p.members.includes(k) ? k : p.members.reduce((a, b) => (shapeN[b] > shapeN[a] ? b : a));
    p.name = p.members.length > 1 && reg && regionShapes.get(`${p.group}|${reg}`) === p.members.length ? reg : shapes[part].name;
    p.name = PROVINCE_NAME_FIX[p.name] ?? p.name;
};
provinces.forEach((p, i) => {
    const top = towns[i].reduce((a, t) => (!a || t.pop > a.pop ? t : a), null);
    if (top) { p.cityName = top.name; p.city = nearestOwn([top.x, top.y], i); }
    else {
        const mx = provCells[i].reduce((a, c) => a + cx[c], 0) / provCells[i].length, my = provCells[i].reduce((a, c) => a + cy[c], 0) / provCells[i].length;
        p.city = nearestOwn([mx, my], i);
    }
    nameProvince(p, top ? top.shape : -1);
    if (!top) p.cityName = p.name;
});

// --- Países: capital, color ---
const places = readJson(join(GEO, 'ne_10m_populated_places_simple.geojson')).features.map(f => f.properties);
const CAPITAL_FIX = { ZAF: 'Pretoria', BOL: 'La Paz', NLD: 'Amsterdam', CIV: 'Abidjan', MYS: 'Kuala Lumpur', LKA: 'Colombo', BEN: 'Porto-Novo' };
const groupKeys = [...groups.keys()].filter(g => provinces.some(p => p.group === g)).sort((a, b) => groups.get(a).name.localeCompare(groups.get(b).name, 'es'));
const countryIdx = new Map(groupKeys.map((g, i) => [g, i]));
const countries = groupKeys.map(g => {
    const G = groups.get(g), main = G.main.ADM0_A3;
    const caps = places.filter(p => /^Admin-0 capital/.test(p.featurecla) && (groupOfAdm0[p.adm0_a3] ?? p.sov_a3) === g);
    const cap = caps.find(p => CAPITAL_FIX[main] && p.name === CAPITAL_FIX[main])
        ?? caps.filter(p => p.adm0_a3 === main && p.featurecla === 'Admin-0 capital').sort((a, b) => b.pop_max - a.pop_max)[0]
        ?? caps.sort((a, b) => b.pop_max - a.pop_max)[0];
    const own = provinces.map((p, i) => i).filter(i => provinces[i].group === g);
    let capProv = own.reduce((a, i) => (provinces[i].population > provinces[a].population ? i : a), own[0]);
    if (cap) {
        const pt = projectLonLat([cap.longitude, cap.latitude]);
        const k = shapeAt(...pt), c = cellAt(...pt);
        const hit = own.find(i => k >= 0 && i === provOfShapeFinal[k]) ?? own.find(i => c >= 0 && i === cells[c]);
        if (hit !== undefined) capProv = hit;
        const p = provinces[capProv];
        p.city = nearestOwn(pt, capProv);
        nameProvince(p, k);
        // Nombre de la capital: la ciudad de GeoNames que se llama como la de Natural Earth y está cerca; si no hay,
        // la más cercana de al menos 50 000 habitantes; si tampoco, el nombre de Natural Earth.
        const d2 = t => (t.x - pt[0]) ** 2 + (t.y - pt[1]) ** 2;
        const near = own.flatMap(i => towns[i]).filter(t => d2(t) < (1.5 * HEX) ** 2);
        const norm = s => s.split(',')[0].trim().toLowerCase();
        const names = new Set([cap.name, cap.nameascii, cap.namealt].filter(Boolean).map(norm));
        const named = near.filter(t => names.has(norm(t.name)) || names.has(norm(t.ascii))).sort((a, b) => b.pop - a.pop)[0];
        const big = near.filter(t => t.pop >= 50000 && d2(t) < (0.6 * HEX) ** 2).sort((a, b) => d2(a) - d2(b))[0];
        p.cityName = named?.name ?? big?.name ?? cap.name;
    }
    return { g, key: G.key, name: G.name, capital: capProv };
});
{
    const PALETTE = ['#c0392b', '#2e86c1', '#27ae60', '#d4ac0d', '#8e44ad', '#d35400', '#16a085', '#95a5a6',
        '#e84393', '#5b6fd6', '#a0522d', '#9e9d24', '#00acc1', '#f39c12', '#6d4c41', '#1a5276'];
    const nbr = countries.map(() => new Set());
    for (let i = 0; i < N; i++) {
        if (cells[i] < 0) continue;
        const a = countryIdx.get(provinces[cells[i]].group);
        for (const j of neighbors(i)) if (cells[j] >= 0) { const b = countryIdx.get(provinces[cells[j]].group); if (a !== b) nbr[a].add(b); }
    }
    const color = [], uses = new Map();
    for (const k of countries.map((c, i) => i).sort((a, b) => nbr[b].size - nbr[a].size)) {
        const used = new Set([...nbr[k]].map(n => color[n]));
        color[k] = PALETTE.filter(c => !used.has(c)).sort((x, y) => (uses.get(x) ?? 0) - (uses.get(y) ?? 0))[0] ?? PALETTE[0];
        uses.set(color[k], (uses.get(color[k]) ?? 0) + 1);
    }
    countries.forEach((c, i) => { c.color = color[i]; });
}

// --- Fuerzas iniciales ---
// Aproximación a IISS Military Balance 2024: [miles de efectivos en activo, carros de combate, piezas de artillería]
// (artillería: autopropulsada, remolcada, lanzacohetes y morteros pesados). 1 infantería = 10 000 efectivos,
// 1 tanque o artillería = 100 sistemas. Los países europeos salen de europa-data.js salvo Rusia, que allí solo cuenta
// sus distritos europeos. Los que no están en la tabla: 0,15 % de su población en infantería.
const FORCES = {
    us: [1328, 2640, 5200], cn: [2035, 4800, 9500], in: [1475, 3740, 9700], ru: [1134, 2000, 4500], pk: [660, 2540, 4600],
    kp: [1280, 3500, 17900], kr: [500, 2150, 11000], ir: [610, 1510, 6800], eg: [440, 2300, 4500], il: [170, 1300, 1000],
    sa: [257, 1060, 1000], jp: [247, 470, 1700], tw: [169, 1000, 2000], vn: [450, 1300, 3000], th: [360, 400, 2600],
    id: [400, 100, 1200], mm: [150, 200, 1000], br: [366, 310, 900], mx: [216, 0, 400], co: [250, 0, 600],
    ve: [123, 170, 400], ar: [72, 230, 300], cl: [69, 250, 400], pe: [81, 160, 700], dz: [140, 1300, 1000],
    ma: [196, 900, 1400], et: [140, 400, 500], ng: [143, 120, 500], za: [70, 30, 400], iq: [193, 400, 1000],
    sy: [170, 1500, 3000], kz: [39, 300, 600], uz: [48, 340, 500], au: [58, 59, 100], ca: [63, 80, 300],
    cu: [49, 300, 1000], sd: [100, 400, 800], ao: [107, 300, 1200], cd: [134, 170, 500], ly: [40, 200, 400],
    ae: [63, 380, 500], jo: [100, 250, 900], bd: [163, 320, 900], lk: [255, 60, 900], ph: [146, 0, 350],
    my: [113, 48, 400], sg: [51, 96, 400], mn: [10, 420, 600], tm: [37, 650, 600], ke: [24, 80, 100],
    ug: [45, 240, 300], tz: [27, 45, 300], er: [200, 270, 600], ye: [40, 100, 300], om: [43, 117, 300],
    kw: [18, 300, 200], qa: [17, 92, 100], ec: [40, 30, 200], bo: [34, 0, 100], zw: [29, 40, 200],
    td: [33, 60, 50], az: [64, 500, 900], am: [42, 110, 300], ge: [21, 120, 250], kg: [11, 150, 300],
    tj: [9, 40, 100], np: [96, 0, 200], nz: [9, 0, 30], tn: [36, 80, 300], la: [29, 25, 300],
    kh: [124, 200, 450], ni: [12, 60, 100], uy: [21, 0, 150], py: [14, 0, 100], lb: [60, 270, 400], bh: [8, 180, 100]
};
const europe = (() => {
    const t = readFileSync(join(here, '../europa-data.js'), 'utf8'), d = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
    const by = {};
    for (const p of d.provinces) {
        if (!p.forces) continue;
        const k = d.countries[p.country].key, f = (by[k] ??= { infantry: 0, tank: 0, artillery: 0 });
        for (const u in f) f[u] += p.forces[u];
    }
    return { forces: by, keys: new Set(d.countries.map(c => c.key)) };
})();
function countryForces(c) {
    if (FORCES[c.key]) { const [k, t, a] = FORCES[c.key]; return { infantry: Math.round(k / 10), tank: Math.round(t / 100), artillery: Math.round(a / 100) }; }
    if (europe.keys.has(c.key)) return europe.forces[c.key] ?? { infantry: 0, tank: 0, artillery: 0 };
    return { infantry: Math.round(groups.get(c.g).pop * 0.0015 / 10000), tank: 0, artillery: 0 };
}
// Reparto entre provincias por población (la capital pesa el triple), con restos mayores.
const forces = provinces.map(() => null);
countries.forEach((c, ci) => {
    const total = countryForces(c), own = provinces.map((p, i) => i).filter(i => provinces[i].group === c.g);
    const w = own.map(i => provinces[i].population * (i === c.capital ? 3 : 1)), tw = w.reduce((a, b) => a + b, 0) || 1;
    for (const u of ['infantry', 'tank', 'artillery']) {
        const exact = own.map((i, k) => total[u] * w[k] / tw), base = exact.map(Math.floor);
        let left = total[u] - base.reduce((a, b) => a + b, 0);
        exact.map((e, k) => [e - base[k], k]).sort((a, b) => b[0] - a[0]).forEach(([, k]) => { if (left > 0) { base[k]++; left--; } });
        own.forEach((i, k) => { if (base[k]) (forces[i] ??= { infantry: 0, tank: 0, artillery: 0 })[u] = base[k]; });
    }
});

// --- Recursos ---
const resEurope = readJson(join(here, 'resources.json')), resWorld = readJson(join(here, 'resources-world.json'));
const usedCells = new Set();
const resources = [];
for (const [type, name, lon, lat] of [...resEurope.sites, ...resWorld.sites]) {
    const pt = projectLonLat([lon, lat]);
    let c = cellAt(...pt);
    if (c < 0 || cells[c] < 0) {
        let best = -1, bd = Infinity;
        for (let i = 0; i < N; i++) if (cells[i] >= 0) { const d = (cx[i] - pt[0]) ** 2 + (cy[i] - pt[1]) ** 2; if (d < bd) { bd = d; best = i; } }
        c = best;
    }
    if (usedCells.has(c)) continue;   // dos yacimientos en la misma casilla: se queda el primero
    usedCells.add(c);
    resources.push({ type, name, cell: c, value: resEurope.types[type].value });
}

// --- Datos ---
const keyCount = new Map();
const data = {
    id: 'mundo', name: 'el mundo',
    hex: HEX, x0, y0, cols, rows,
    cells: Array.from(cells),
    countries: countries.map(c => ({ key: c.key, name: c.name, color: c.color, capital: c.capital })),
    resourceTypes: Object.fromEntries(Object.entries(resEurope.types).map(([k, v]) => [k, v.name])),
    resources,
    provinces: provinces.map((p, i) => {
        const ck = groups.get(p.group).key;
        let key = `${ck}-${slug(p.name) || 'p'}`;
        const n = (keyCount.get(key) ?? 0) + 1; keyCount.set(key, n);
        if (n > 1) key += `-${n}`;
        return { key, country: countryIdx.get(p.group), name: p.name, city: p.city, cityName: p.cityName,
            terrain: 'plain', population: p.population, productivity: productivity.get(p.group), forces: forces[i] };
    }),
    alliances: {
        OTAN: ['al', 'be', 'bg', 'ca', 'cz', 'de', 'dk', 'ee', 'es', 'fi', 'fr', 'gb', 'gr', 'hr', 'hu', 'is', 'it', 'lt', 'lu', 'lv', 'me', 'mk', 'nl', 'no', 'pl', 'pt', 'ro', 'se', 'si', 'sk', 'tr', 'us'],
        OTSC: ['am', 'by', 'kg', 'kz', 'ru', 'tj']
    },
    sources: 'Natural Earth 5.1.1 (países, provincias, capitales, población y PIB), GeoNames cities1000 (CC BY 4.0), aproximación a IISS Military Balance 2024'
};

if (process.env.NO_TERRAIN) { writeFileSync(process.env.NO_TERRAIN, JSON.stringify(data)); console.log(data.provinces.length, 'provincias;', data.countries.length, 'países'); process.exit(0); }
await addTerrain(data, join(here, '../relieve-mundo.png'), {
    proj: { projectLonLat, unprojectXY, projectLine: projectRing }, unitKm: KM_PER_UNIT, zoom: 5, dense: true, riverMaxRank: 5,
    // Casillas de ~50 km: el desnivel dentro de cada una es mayor que en las de Europa, así que los umbrales suben.
    thresholds: { MOUNTAIN_RELIEF: 1500, MOUNTAIN_HIGH: 2200, MOUNTAIN_HIGH_RELIEF: 800, MOUNTAIN_MEAN: 2400, HILLS_RELIEF: 600, HILLS_HIGH: 1000, HILLS_HIGH_RELIEF: 300 }
});
data.relief.src = 'relieve-mundo.png';
// Terreno dominante de cada provincia (por si alguna casilla no lo trae).
const TERRAIN_NAMES = { p: 'plain', f: 'forest', h: 'hills', m: 'mountain', w: 'marsh', u: 'urban', l: 'lake' };
data.provinces.forEach((p, i) => {
    const n = {};
    for (const c of provCells[i]) n[data.terrain[c]] = (n[data.terrain[c]] ?? 0) + 1;
    const top = Object.entries(n).filter(([t]) => t !== 'l' && t !== 'u').sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'p';
    p.terrain = TERRAIN_NAMES[top];
});
writeFileSync(out, `// Generado por tools/build-world.mjs. No editar a mano.\nwindow.MAPA = ${JSON.stringify(data)};\n`);
const counts = provCells.map(c => c.length).sort((a, b) => a - b);
console.log(`${resources.length} recursos`);
console.log(`hex ${HEX} (${HEX * KM_PER_UNIT} km): ${cols}×${rows}, ${counts.reduce((a, b) => a + b, 0)} hexágonos de tierra, ${provinces.length} provincias ` +
    `(mín ${counts[0]}, mediana ${counts[counts.length >> 1]}, máx ${counts.at(-1)}), ${countries.length} países, ${(readFileSync(out).length / 1024).toFixed(0)} kB`);
