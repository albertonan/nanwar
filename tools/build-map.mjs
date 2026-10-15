// Genera europa-data.js: Europa en una rejilla de hexágonos (vértice arriba, filas impares desplazadas),
// a partir del pack europe-2025 de GeoSim (geometría LAEA 1000×1000, regiones NUTS/admin-1, asentamientos, terreno,
// fuerzas 2024). Las carreteras no vienen dadas: las construyen los jugadores. Rusia (distritos federales) y Turquía (NUTS 1) se subdividen en óblast (Natural Earth) y NUTS 2
// para que sus provincias tengan un tamaño parecido al del resto.
// Uso: node basicmilitary/tools/build-map.mjs [radioHex]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { naturalEarthFeatures } from '../../tools/geometry/lib/naturalearth.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const pack = join(root, 'src/data/packs/europe-2025');
const out = join(here, '../europa-data.js');
const readJson = f => JSON.parse(readFileSync(f, 'utf8'));
const read = f => readJson(join(pack, f));

const HEX = Number(process.argv[2]) || 2.5;   // radio del hexágono en unidades del viewBox (~5 km por unidad)
const geometry = read('geometry.json');
const settlements = read('settlements.json').settlements;
const military = read('military.json');

// --- Proyección (la misma que tools/geometry/lib/project.mjs) ---
const R = 6371000;
const rad = d => d * Math.PI / 180;
function laea([lon, lat], [lon0, lat0]) {
    const phi = rad(lat), phi0 = rad(lat0), dl = rad(lon - lon0);
    const k = Math.sqrt(2 / (1 + Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(dl)));
    return [R * k * Math.cos(phi) * Math.sin(dl), R * k * (Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * Math.cos(phi) * Math.cos(dl))];
}
const CENTER = [10, 52], CLIP_LON = [-25, 60], CLIP_LAT = [34, 72];
const fit = (() => {
    const pts = [];
    for (let i = 0; i <= 64; i++) {
        const lon = CLIP_LON[0] + (CLIP_LON[1] - CLIP_LON[0]) * i / 64;
        const lat = CLIP_LAT[0] + (CLIP_LAT[1] - CLIP_LAT[0]) * i / 64;
        pts.push(laea([lon, CLIP_LAT[0]], CENTER), laea([lon, CLIP_LAT[1]], CENTER), laea([CLIP_LON[0], lat], CENTER), laea([CLIP_LON[1], lat], CENTER));
    }
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const scale = Math.min(1000 / (maxX - minX), 1000 / (maxY - minY));
    return ([x, y]) => [500 + (x - (minX + maxX) / 2) * scale, 500 - (y - (minY + maxY) / 2) * scale];
})();
const projectLonLat = p => fit(laea(p, CENTER));

// --- Geometría ---
function parsePath(d) {
    const rings = [];
    const tokens = d.match(/[MmLlZz]|-?\d*\.?\d+(?:e-?\d+)?/g);
    let cmd = null, x = 0, y = 0, startX = 0, startY = 0, ring = null, i = 0;
    while (i < tokens.length) {
        const t = tokens[i];
        if (/[MmLlZz]/.test(t)) {
            cmd = t; i++;
            if (cmd === 'z' || cmd === 'Z') { if (ring) rings.push(ring); ring = null; x = startX; y = startY; }
            continue;
        }
        const a = +tokens[i], b = +tokens[i + 1]; i += 2;
        if (cmd === 'M' || cmd === 'm') {
            if (ring) rings.push(ring);
            x = cmd === 'M' ? a : x + a; y = cmd === 'M' ? b : y + b;
            startX = x; startY = y; ring = [[x, y]];
            cmd = cmd === 'M' ? 'L' : 'l';
        } else {
            x = cmd === 'L' ? a : x + a; y = cmd === 'L' ? b : y + b;
            ring.push([x, y]);
        }
    }
    if (ring) rings.push(ring);
    return rings;
}

const geoRings = g => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []).flat();

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
const inShape = (s, x, y) => x >= s.bbox[0] && x <= s.bbox[2] && y >= s.bbox[1] && y <= s.bbox[3] && inRings(s.rings, x, y);

const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// --- Provincias del pack ---
const insetRegions = new Set(geometry.projection.insets.flatMap(i => i.regions));
const countryKeys = Object.keys(geometry.countries).sort();
const countryFiles = Object.fromEntries(countryKeys.map(k => [k, read(`countries/${k}.json`)]));

let provinces = [];
for (const ck of countryKeys) {
    const meta = Object.fromEntries(countryFiles[ck].regions.map(r => [r.key, r]));
    for (const key of geometry.countries[ck].regions) {
        if (insetRegions.has(key)) continue;
        const g = geometry.regions[key];
        const m = meta[key] ?? {};
        const rings = parsePath(g.d);
        provinces.push({
            key, country: ck, name: m.name ?? key,
            population: m.population ?? 100000, productivity: m.productivity ?? 1,
            terrain: military.regions[key]?.terrain ?? 'plain',
            rings, bbox: bboxOf(rings), centroid: g.centroid,
            towns: settlements[key] ?? [], forcesFrom: [key]
        });
    }
}

// --- Rejilla ---
const W = Math.sqrt(3) * HEX, STEP = 1.5 * HEX;
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const p of provinces) { minX = Math.min(minX, p.bbox[0]); minY = Math.min(minY, p.bbox[1]); maxX = Math.max(maxX, p.bbox[2]); maxY = Math.max(maxY, p.bbox[3]); }
const x0 = minX - W, y0 = minY - HEX;
const cols = Math.ceil((maxX - x0) / W) + 2, rows = Math.ceil((maxY - y0) / STEP) + 2;
const center = idx => { const r = Math.floor(idx / cols), c = idx % cols; return [x0 + W * (c + 0.5 * (r & 1)), y0 + STEP * r]; };
let cells = new Int16Array(cols * rows).fill(-1);
for (let idx = 0; idx < cells.length; idx++) {
    const [cx, cy] = center(idx);
    const i = provinces.findIndex(p => inShape(p, cx, cy));
    cells[idx] = i;
}

const nearestCell = ([px, py], filter = () => true) => {
    let best = -1, bestD = Infinity;
    for (let idx = 0; idx < cells.length; idx++) {
        if (!filter(idx)) continue;
        const [cx, cy] = center(idx), d = (cx - px) ** 2 + (cy - py) ** 2;
        if (d < bestD) { bestD = d; best = idx; }
    }
    return best;
};
const countCells = () => { const n = new Array(provinces.length).fill(0); for (const v of cells) if (v >= 0) n[v]++; return n; };

// --- Subdivisión de Rusia y Turquía ---
const neDefs = readJson(join(root, 'tools/pack/sources/regions-ne.json'));
const ruFeatures = await naturalEarthFeatures(join(root, 'tools/geometry/cache/ne_10m_admin_1_states_provinces.zip'), neDefs.ru.flatMap(r => r.ne));
const nuts2 = readJson(join(root, 'tools/geometry/cache/NUTS_RG_03M_2024_4326_LEVL_2.geojson'));
const subShapes = [
    ...ruFeatures.map(f => ({ country: 'ru', name: f.properties.name_es || f.properties.name, geometry: f.geometry })),
    ...nuts2.features.filter(f => f.properties.CNTR_CODE === 'TR')
        .map(f => ({ country: 'tr', name: f.properties.NAME_LATN.split(',')[0].trim(), geometry: f.geometry }))
].map(s => {
    const rings = geoRings(s.geometry).map(r => r.map(projectLonLat));
    return { country: s.country, name: s.name, rings, bbox: bboxOf(rings) };
});

{
    const refined = new Set(subShapes.map(s => s.country));
    const kept = provinces.filter(p => !refined.has(p.country));
    const remap = provinces.map(p => kept.indexOf(p));
    const subCells = subShapes.map(() => []);
    const parentVotes = subShapes.map(() => new Map());
    for (let idx = 0; idx < cells.length; idx++) {
        const old = cells[idx];
        if (old < 0 || remap[old] >= 0) continue;
        const parent = provinces[old];
        const [cx, cy] = center(idx);
        let s = subShapes.findIndex(sh => sh.country === parent.country && inShape(sh, cx, cy));
        if (s < 0) {   // la línea de costa simplificada no coincide exactamente: subdivisión más cercana
            let bestD = Infinity;
            subShapes.forEach((sh, k) => {
                if (sh.country !== parent.country) return;
                const d = (cx - Math.max(sh.bbox[0], Math.min(cx, sh.bbox[2]))) ** 2 + (cy - Math.max(sh.bbox[1], Math.min(cy, sh.bbox[3]))) ** 2;
                if (d < bestD) { bestD = d; s = k; }
            });
        }
        subCells[s].push(idx);
        parentVotes[s].set(old, (parentVotes[s].get(old) ?? 0) + 1);
    }
    const newCells = new Int16Array(cells.length).fill(-1);
    for (let idx = 0; idx < cells.length; idx++) if (cells[idx] >= 0 && remap[cells[idx]] >= 0) newCells[idx] = remap[cells[idx]];
    const subs = [];
    const usedKeys = new Set(kept.map(p => p.key));
    subShapes.forEach((sh, k) => {
        if (!subCells[k].length) return;
        const parentIdx = [...parentVotes[k].entries()].sort((a, b) => b[1] - a[1])[0][0];
        const parent = provinces[parentIdx];
        let key = `${sh.country}-${slug(sh.name)}`;
        while (usedKeys.has(key)) key += '-b';
        usedKeys.add(key);
        const sub = { key, country: sh.country, name: sh.name, productivity: parent.productivity, terrain: parent.terrain,
            rings: sh.rings, bbox: sh.bbox, parent: parentIdx, cellCount: subCells[k].length, towns: [], forcesFrom: [] };
        const ni = kept.length + subs.length;
        for (const idx of subCells[k]) newCells[idx] = ni;
        subs.push(sub);
    });
    // Asentamientos al hexágono que les toca; la población del distrito se reparte por población urbana y superficie.
    const cellAt = (x, y) => nearestCell([x, y], idx => newCells[idx] >= kept.length);
    for (const [pi, parent] of provinces.entries()) {
        if (remap[pi] >= 0) continue;
        const mine = subs.filter(s => s.parent === pi);
        for (const t of parent.towns) {
            const sub = subs[newCells[cellAt(t[3], t[4])] - kept.length];
            (mine.includes(sub) ? sub : mine[0])?.towns.push(t);
        }
        const townPop = mine.map(s => s.towns.reduce((a, t) => a + t[2], 0));
        const totalTown = townPop.reduce((a, b) => a + b, 0) || 1;
        const totalCells = mine.reduce((a, s) => a + s.cellCount, 0);
        mine.forEach((s, k) => { s.population = Math.round(parent.population * (0.7 * townPop[k] / totalTown + 0.3 * s.cellCount / totalCells)); });
        // Las fuerzas del distrito se acuartelan en la subdivisión de su mayor ciudad.
        const top = parent.towns.reduce((a, t) => (!a || t[2] > a[2] ? t : a), null);
        const host = top ? subs[newCells[cellAt(top[3], top[4])] - kept.length] : mine[0];
        (mine.includes(host) ? host : mine[0]).forcesFrom.push(parent.key);
    }
    provinces = [...kept, ...subs];
    cells = newCells;
}

// Toda provincia tiene al menos un hexágono (Malta, Luxemburgo, ciudades-región...): la celda más cercana a su centroide.
{
    const counts = countCells();
    provinces.forEach((p, i) => {
        if (counts[i] > 0) return;
        const idx = nearestCell(p.centroid ?? [(p.bbox[0] + p.bbox[2]) / 2, (p.bbox[1] + p.bbox[3]) / 2], k => cells[k] === -1 || counts[cells[k]] > 3);
        if (cells[idx] >= 0) counts[cells[idx]]--;
        cells[idx] = i; counts[i] = 1;
    });
}

// --- Ciudad de cada provincia: el mayor asentamiento, en el hexágono propio más cercano ---
provinces.forEach((p, i) => {
    const top = p.towns.reduce((a, t) => (!a || t[2] > a[2] ? t : a), null);
    p.cityName = top ? top[1] : p.name;
    p.city = nearestCell(top ? [top[3], top[4]] : (p.centroid ?? [(p.bbox[0] + p.bbox[2]) / 2, (p.bbox[1] + p.bbox[3]) / 2]), k => cells[k] === i);
});

// --- Países: capital y color (coloreado voraz sobre el grafo de vecinos) ---
const PALETTE = ['#c0392b', '#2e86c1', '#27ae60', '#d4ac0d', '#8e44ad', '#d35400', '#16a085', '#95a5a6',
    '#e84393', '#5b6fd6', '#a0522d', '#9e9d24', '#00acc1', '#f39c12', '#6d4c41', '#1a5276'];
const neighborCountries = Object.fromEntries(countryKeys.map(k => [k, new Set()]));
for (const [a, list] of Object.entries(geometry.neighbors)) {
    for (const b of list) {
        const ca = a.split('-')[0], cb = b.split('-')[0];
        if (ca !== cb && neighborCountries[ca] && neighborCountries[cb]) { neighborCountries[ca].add(cb); neighborCountries[cb].add(ca); }
    }
}
const colorOf = {};
for (const k of [...countryKeys].sort((a, b) => neighborCountries[b].size - neighborCountries[a].size)) {
    const used = new Set([...neighborCountries[k]].map(n => colorOf[n]));
    // Entre los colores libres, el menos usado: así no se repite el mismo tono por todo el mapa.
    const uses = c => Object.values(colorOf).filter(x => x === c).length;
    colorOf[k] = PALETTE.filter(c => !used.has(c)).sort((x, y) => uses(x) - uses(y))[0] ?? PALETTE[0];
}

const countries = countryKeys.map(k => {
    const f = countryFiles[k];
    const pt = projectLonLat([f.capital[1], f.capital[0]]);
    const own = provinces.map((p, i) => i).filter(i => provinces[i].country === k);
    const capProv = own.find(i => inShape(provinces[i], pt[0], pt[1]))
        ?? own.reduce((a, i) => (provinces[i].population > provinces[a].population ? i : a), own[0]);
    const p = provinces[capProv];
    p.city = nearestCell(pt, idx => cells[idx] === capProv);
    const capTown = p.towns.reduce((a, t) => { const d = (t[3] - pt[0]) ** 2 + (t[4] - pt[1]) ** 2; return !a || d < a.d ? { d, name: t[1] } : a; }, null);
    if (capTown) p.cityName = capTown.name;
    return { key: k, name: f.name, color: colorOf[k], capital: capProv };
});

// --- Fuerzas iniciales (IISS 2024): 1 unidad de infantería = 10 000 efectivos, 1 de blindados/artillería = 100 sistemas ---
const SCALE = { infantry: ['infantry', 10000], armour: ['tank', 100], artillery: ['artillery', 100] };
const forcesByRegion = {};
for (const v of Object.values(military.countries)) {
    for (const u of v.units) {
        const s = SCALE[u.type];
        if (!s) continue;
        const f = (forcesByRegion[u.region] ??= { infantry: 0, tank: 0, artillery: 0 });
        f[s[0]] += u.strength / s[1];
    }
}
const forcesOf = p => {
    const f = { infantry: 0, tank: 0, artillery: 0 };
    for (const k of p.forcesFrom) for (const t in f) f[t] += forcesByRegion[k]?.[t] ?? 0;
    for (const t in f) f[t] = Math.round(f[t]);
    return f.infantry + f.tank + f.artillery ? f : null;
};

// --- Casilla más cercana (para recursos) ---
function cellAt(x, y) {
    const r0 = Math.round((y - y0) / STEP);
    let best = -1, bestD = Infinity;
    for (let r = r0 - 1; r <= r0 + 1; r++) {
        if (r < 0 || r >= rows) continue;
        const c0 = Math.round((x - x0) / W - 0.5 * (r & 1));
        for (let c = c0 - 1; c <= c0 + 1; c++) {
            if (c < 0 || c >= cols) continue;
            const i = r * cols + c, [cx, cy] = center(i), d = (cx - x) ** 2 + (cy - y) ** 2;
            if (d < bestD) { bestD = d; best = i; }
        }
    }
    return best;
}

// --- Recursos ---
const resourceDefs = readJson(join(here, 'resources.json'));
const resources = resourceDefs.sites.map(([type, name, lon, lat]) => {
    const pt = projectLonLat([lon, lat]);
    let cell = cellAt(pt[0], pt[1]);
    if (cell < 0 || cells[cell] < 0) cell = nearestCell(pt, idx => cells[idx] >= 0);
    return { type, name, cell, value: resourceDefs.types[type].value };
});

const data = {
    hex: HEX, x0: +x0.toFixed(3), y0: +y0.toFixed(3), cols, rows,
    cells: Array.from(cells),
    countries,
    resourceTypes: Object.fromEntries(Object.entries(resourceDefs.types).map(([k, v]) => [k, v.name])),
    resources,
    provinces: provinces.map(p => ({
        key: p.key, country: countries.findIndex(c => c.key === p.country), name: p.name, city: p.city, cityName: p.cityName,
        terrain: p.terrain, population: p.population, productivity: p.productivity, forces: forcesOf(p)
    })),
    alliances: {
        OTAN: ['al', 'be', 'bg', 'cz', 'de', 'dk', 'ee', 'es', 'fi', 'fr', 'gb', 'gr', 'hr', 'hu', 'is', 'it', 'lt', 'lu', 'lv', 'me', 'mk', 'nl', 'no', 'pl', 'pt', 'ro', 'se', 'si', 'sk', 'tr'],
        OTSC: ['by', 'ru']
    },
    sources: 'GeoSim pack europe-2025 (GISCO NUTS 2024, Natural Earth 5.1.1, GeoNames, IISS Military Balance 2024 / SIPRI)'
};

writeFileSync(out, `// Generado por tools/build-map.mjs. No editar a mano.\nwindow.EUROPA = ${JSON.stringify(data)};\n`);
const counts = countCells();
const sorted = [...counts].sort((a, b) => a - b);
console.log(`${resources.length} recursos`);
console.log(`hex ${HEX}: ${cols}×${rows}, ${counts.reduce((a, b) => a + b, 0)} hexágonos de tierra, ${provinces.length} provincias ` +
    `(mín ${sorted[0]}, mediana ${sorted[sorted.length >> 1]}, máx ${sorted.at(-1)}), ${countries.length} países, ${(readFileSync(out).length / 1024).toFixed(0)} kB`);
