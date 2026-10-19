// Terreno real por casilla para europa-data.js y el relieve pintado (relieve.png).
// Fuentes (se descargan una vez a tools/cache/):
//   - Elevación: Terrarium de Mapzen en AWS (elevation-tiles-prod), nivel 6, ~1–2 km por píxel.
//   - Usos del suelo: ESA WorldCover 2021 v200 (CC BY 4.0), vista general de ~600 m por píxel de cada tesela de 3°.
//   - Ríos: Natural Earth 10m rivers_lake_centerlines (dominio público).
// Uso: lo llama build-map.mjs al final, o `node tools/build-terrain.mjs` sobre el europa-data.js existente.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { fromUrl } from 'geotiff';
import mapshaper from 'mapshaper';
import { projectLonLat, unprojectXY } from './projection.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CACHE = join(here, 'cache');

// Clases de terreno (una letra por casilla en data.terrain; '.' es mar).
export const TERRAIN_CODES = { p: 'plain', f: 'forest', h: 'hills', m: 'mountain', w: 'marsh', u: 'urban', l: 'lake' };
// Umbrales de clasificación (metros y fracciones de la casilla). Cuenta sobre todo el desnivel dentro de la casilla:
// una meseta alta y llana (Castilla, Anatolia) es llanura; las colinas y montañas son terreno quebrado.
const MOUNTAIN_RELIEF = 900, MOUNTAIN_HIGH = 1800, MOUNTAIN_HIGH_RELIEF = 500, MOUNTAIN_MEAN = 2000;
const HILLS_RELIEF = 280, HILLS_HIGH = 900, HILLS_HIGH_RELIEF = 150;
const URBAN = 0.2, LAKE = 0.6, MARSH = 0.25, FOREST = 0.5;
const RIVER_MAX_RANK = 6;    // ríos de Natural Earth con scalerank ≤ 6: los que se dibujan y cuentan para las reglas
const RELIEF_RES = 1;        // unidades del mapa por píxel de relieve.png (~5 km)

const fetchBuf = async (url, tries = 3) => {
    for (let k = 0; ; k++) {
        try {
            const res = await fetch(url);
            if (res.status === 404 || res.status === 403) return null;
            if (!res.ok) throw new Error(`${res.status} ${url}`);
            return Buffer.from(await res.arrayBuffer());
        } catch (e) {
            if (k + 1 >= tries) throw e;
            await new Promise(r => setTimeout(r, 1000 * (k + 1)));
        }
    }
};
async function pool(items, n, fn) {
    let i = 0;
    await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

// --- Elevación (Terrarium) ---
const Z = 6, TN = 2 ** Z;
const elevTiles = new Map();
const tileXY = (lon, lat) => {
    const s = Math.sin(lat * Math.PI / 180);
    return [(lon + 180) / 360 * TN * 256, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TN * 256];
};
async function loadElevation(lonlats) {
    const need = new Set();
    for (const [lon, lat] of lonlats) {
        const [x, y] = tileXY(lon, lat);
        for (const dx of [-1, 1]) for (const dy of [-1, 1]) need.add(`${Math.floor((x + dx) / 256)}/${Math.floor((y + dy) / 256)}`);
    }
    const dir = join(CACHE, `terrarium-${Z}`);
    mkdirSync(dir, { recursive: true });
    const keys = [...need].filter(k => !elevTiles.has(k));
    let done = 0;
    await pool(keys, 8, async key => {
        const file = join(dir, key.replace('/', '_') + '.png');
        let buf = existsSync(file) ? readFileSync(file) : null;
        if (!buf) {
            const [tx, ty] = key.split('/');
            buf = await fetchBuf(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${tx}/${ty}.png`);
            if (!buf) throw new Error(`Falta la tesela de elevación ${key}`);
            writeFileSync(file, buf);
        }
        const png = PNG.sync.read(buf), e = new Float32Array(256 * 256);
        for (let i = 0; i < e.length; i++) e[i] = png.data[i * 4] * 256 + png.data[i * 4 + 1] + png.data[i * 4 + 2] / 256 - 32768;
        elevTiles.set(key, e);
        if (++done % 40 === 0) console.log(`  elevación: ${done}/${keys.length} teselas`);
    });
}
function elevPx(ix, iy) {
    const t = elevTiles.get(`${Math.floor(ix / 256)}/${Math.floor(iy / 256)}`);
    return t ? t[(iy & 255) * 256 + (ix & 255)] : 0;
}
function elevAt(lon, lat) {
    const [x, y] = tileXY(lon, lat), fx = x - 0.5, fy = y - 0.5, ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy;
    return (elevPx(ix, iy) * (1 - u) + elevPx(ix + 1, iy) * u) * (1 - v) + (elevPx(ix, iy + 1) * (1 - u) + elevPx(ix + 1, iy + 1) * u) * v;
}

// --- Usos del suelo (ESA WorldCover) ---
const wcTiles = new Map();   // "lat0,lon0" → { w, h, bbox, data } o null (océano, sin tesela)
const wcKey = (lon, lat) => `${Math.floor(lat / 3) * 3},${Math.floor(lon / 3) * 3}`;
const pad = (n, w) => String(Math.abs(n)).padStart(w, '0');
async function loadLandCover(lonlats) {
    const need = new Set(lonlats.map(([lon, lat]) => wcKey(lon, lat)));
    const dir = join(CACHE, 'worldcover');
    mkdirSync(dir, { recursive: true });
    const keys = [...need].filter(k => !wcTiles.has(k));
    let done = 0;
    await pool(keys, 6, async key => {
        const [lat0, lon0] = key.split(',').map(Number);
        const name = `ESA_WorldCover_10m_2021_v200_${lat0 >= 0 ? 'N' : 'S'}${pad(lat0, 2)}${lon0 >= 0 ? 'E' : 'W'}${pad(lon0, 3)}_Map`;
        const file = join(dir, `${name}.json`);
        if (existsSync(file)) {
            const meta = JSON.parse(readFileSync(file, 'utf8'));
            wcTiles.set(key, meta.missing ? null : { ...meta, data: readFileSync(join(dir, `${name}.bin`)) });
        } else {
            const url = `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/${name}.tif`;
            const head = await fetch(url, { method: 'HEAD' });
            if (!head.ok) { writeFileSync(file, JSON.stringify({ missing: true })); wcTiles.set(key, null); }
            else {
                const tif = await fromUrl(url);
                const full = await tif.getImage(0), bbox = full.getBoundingBox();
                const img = await tif.getImage((await tif.getImageCount()) - 1);
                const [band] = await img.readRasters();
                const meta = { w: img.getWidth(), h: img.getHeight(), bbox };
                writeFileSync(join(dir, `${name}.bin`), Buffer.from(band));
                writeFileSync(file, JSON.stringify(meta));
                wcTiles.set(key, { ...meta, data: Buffer.from(band) });
            }
        }
        if (++done % 25 === 0) console.log(`  usos del suelo: ${done}/${keys.length} teselas`);
    });
}
// Clase WorldCover en un punto: 10 árboles, 20 matorral, 30 pasto, 40 cultivo, 50 urbano, 60 suelo desnudo,
// 70 nieve y hielo, 80 agua, 90 humedal, 95 manglar, 100 musgo y liquen; 0 sin dato (océano).
function coverAt(lon, lat) {
    const t = wcTiles.get(wcKey(lon, lat));
    if (!t) return 0;
    const [x0, y0, x1, y1] = t.bbox;
    const px = Math.floor((lon - x0) / (x1 - x0) * t.w), py = Math.floor((y1 - lat) / (y1 - y0) * t.h);
    if (px < 0 || py < 0 || px >= t.w || py >= t.h) return 0;
    return t.data[py * t.w + px];
}

// --- Ríos (Natural Earth) ---
async function loadRivers() {
    const file = join(CACHE, 'ne_10m_rivers_lake_centerlines.zip');
    if (!existsSync(file)) {
        mkdirSync(CACHE, { recursive: true });
        const buf = await fetchBuf('https://naciscdn.org/naturalearth/10m/physical/ne_10m_rivers_lake_centerlines.zip');
        if (!buf) throw new Error('No se pudo descargar ne_10m_rivers_lake_centerlines.zip');
        writeFileSync(file, buf);
    }
    const out = await mapshaper.applyCommands(`-i "${file}" -filter "scalerank <= ${RIVER_MAX_RANK} && featurecla != 'Lake Centerline'" -o out.json format=geojson`);
    return Object.values(out).map(b => JSON.parse(b.toString())).flatMap(fc => fc.features ?? []);
}
function simplify(pts, tol) {   // Douglas-Peucker
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
        const [a, b] = stack.pop();
        const [ax, ay] = pts[a], [bx, by] = pts[b], L = Math.hypot(bx - ax, by - ay) || 1e-9;
        let best = -1, bd = tol;
        for (let i = a + 1; i < b; i++) {
            const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L;
            if (d > bd) { bd = d; best = i; }
        }
        if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
    }
    return pts.filter((_, i) => keep[i]);
}
const segCross = (a, b, c, d) => {
    const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};

// --- Rejilla (la misma que index.html) ---
function makeGrid(data) {
    const { cols, rows, hex: S, x0, y0 } = data, W = Math.sqrt(3) * S, STEP = 1.5 * S, N = cols * rows;
    const cx = new Float64Array(N), cy = new Float64Array(N), nb = new Int32Array(N * 6).fill(-1);
    const EVEN = [[1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]], ODD = [[1, 0], [1, 1], [0, 1], [-1, 0], [0, -1], [1, -1]];
    for (let i = 0; i < N; i++) {
        const r = Math.floor(i / cols), c = i % cols;
        cx[i] = x0 + W * (c + 0.5 * (r & 1)); cy[i] = y0 + STEP * r;
        (r & 1 ? ODD : EVEN).forEach(([dc, dr], d) => {
            const nc = c + dc, nr = r + dr;
            if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) nb[i * 6 + d] = nr * cols + nc;
        });
    }
    const cellAt = (x, y) => {
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
        return bd <= S * S ? best : -1;
    };
    return { S, W, STEP, N, cx, cy, nb, cellAt, width: W * (cols + 0.5), height: STEP * (rows - 1) + 2 * S, ox: x0 - W / 2, oy: y0 - S };
}
// 19 puntos repartidos por el hexágono: centro, anillo interior y anillo exterior.
function hexSamples(S) {
    const pts = [[0, 0]];
    for (let k = 0; k < 6; k++) { const a = Math.PI / 3 * k; pts.push([Math.cos(a) * S * 0.45, Math.sin(a) * S * 0.45]); }
    for (let k = 0; k < 12; k++) { const a = Math.PI / 6 * k + Math.PI / 12; pts.push([Math.cos(a) * S * 0.8, Math.sin(a) * S * 0.8]); }
    return pts;
}

// Añade a `data` (europa-data) el terreno por casilla, los ríos y el marco de relieve.png; escribe relieve.png en `pngOut`.
export async function addTerrain(data, pngOut) {
    const G = makeGrid(data), land = [];
    for (let i = 0; i < G.N; i++) if (data.cells[i] >= 0) land.push(i);
    const SAMPLES = hexSamples(G.S);
    const cityCells = new Set(data.provinces.map(p => p.city));

    // Puntos que hay que consultar: muestras de cada casilla y centros de los píxeles del relieve sobre tierra o junto a ella.
    const RW = Math.ceil(G.width / RELIEF_RES), RH = Math.ceil(G.height / RELIEF_RES);
    const pixLonLat = new Float64Array(RW * RH * 2), pixNear = new Uint8Array(RW * RH);
    for (let py = 0; py < RH; py++) for (let px = 0; px < RW; px++) {
        const x = G.ox + (px + 0.5) * RELIEF_RES, y = G.oy + (py + 0.5) * RELIEF_RES, k = py * RW + px;
        const [lon, lat] = unprojectXY([x, y]);
        pixLonLat[k * 2] = lon; pixLonLat[k * 2 + 1] = lat;
        const c = G.cellAt(x, y);
        pixNear[k] = c >= 0 && (data.cells[c] >= 0 || [0, 1, 2, 3, 4, 5].some(d => G.nb[c * 6 + d] >= 0 && data.cells[G.nb[c * 6 + d]] >= 0)) ? 1 : 0;
    }
    const cellLonLat = land.map(i => SAMPLES.map(([dx, dy]) => unprojectXY([G.cx[i] + dx, G.cy[i] + dy])));
    const all = cellLonLat.flat();
    for (let k = 0; k < RW * RH; k++) if (pixNear[k]) all.push([pixLonLat[k * 2], pixLonLat[k * 2 + 1]]);
    console.log(`Terreno: ${land.length} casillas, relieve ${RW}×${RH}`);
    await loadElevation(all);
    await loadLandCover(all);

    // --- Clase de cada casilla ---
    const terrain = new Array(G.N).fill('.');
    const stats = {};
    land.forEach((i, n) => {
        const elev = [], cover = {};
        for (const [lon, lat] of cellLonLat[n]) {
            const e = elevAt(lon, lat);
            elev.push(Math.max(0, e));
            let c = coverAt(lon, lat);
            if (c === 80 && e < 0) c = 0;   // agua bajo el nivel del mar: es mar, no lago
            cover[c] = (cover[c] ?? 0) + 1;
        }
        const k = elev.length, frac = c => (cover[c] ?? 0) / k;
        elev.sort((a, b) => a - b);
        const mean = elev.reduce((a, b) => a + b, 0) / k, p10 = elev[Math.floor(k * 0.1)], p90 = elev[Math.floor(k * 0.9)], relief = p90 - p10;
        const tree = frac(10) + frac(95), water = frac(80), wet = frac(90), built = frac(50);
        let t = 'p';
        if (water >= LAKE && !cityCells.has(i)) t = 'l';
        else if (built >= URBAN) t = 'u';
        else if (relief >= MOUNTAIN_RELIEF || (p90 >= MOUNTAIN_HIGH && relief >= MOUNTAIN_HIGH_RELIEF) || mean >= MOUNTAIN_MEAN) t = 'm';
        else if (relief >= HILLS_RELIEF || (mean >= HILLS_HIGH && relief >= HILLS_HIGH_RELIEF)) t = 'h';
        else if (wet >= MARSH) t = 'w';
        else if (tree >= FOREST) t = 'f';
        terrain[i] = t;
        stats[t] = (stats[t] ?? 0) + 1;
    });
    console.log('  casillas por terreno:', Object.entries(stats).map(([t, n]) => `${TERRAIN_CODES[t]} ${n}`).join(', '));

    // --- relieve.png: R elevación (raíz cuadrada, 0–4800 m), G % de árboles (×2), B clase dominante + 8 × agua (0–31) ---
    const CLASS = { 30: 0, 100: 0, 0: 0, 40: 1, 20: 2, 60: 3, 50: 4, 80: 5, 90: 6, 70: 7, 10: 0, 95: 0 };
    const png = new PNG({ width: RW, height: RH, colorType: 2 });
    const OFF = [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]].map(([a, b]) => [a * RELIEF_RES, b * RELIEF_RES]);
    for (let py = 0; py < RH; py++) for (let px = 0; px < RW; px++) {
        const k = py * RW + px, o = k * 4;
        png.data[o + 3] = 255;
        if (!pixNear[k]) { png.data[o + 2] = 5 + 8 * 31; continue; }   // mar abierto
        const x = G.ox + (px + 0.5) * RELIEF_RES, y = G.oy + (py + 0.5) * RELIEF_RES;
        const counts = {};
        let tree = 0, water = 0;
        for (const [dx, dy] of OFF) for (const [ex, ey] of [[0, 0], [0.12, 0.12]]) {
            const [lon, lat] = unprojectXY([x + dx + ex, y + dy + ey]), c = coverAt(lon, lat);
            if (c === 10 || c === 95) tree++;
            else if (c === 80 || c === 0) water++;
            else counts[c] = (counts[c] ?? 0) + 1;
        }
        const n = OFF.length * 2;
        const dom = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 30;
        const e = Math.max(0, elevAt(pixLonLat[k * 2], pixLonLat[k * 2 + 1]));
        png.data[o] = Math.round(Math.sqrt(Math.min(e, 4800) / 4800) * 255);
        png.data[o + 1] = Math.round(tree / n * 200);
        png.data[o + 2] = CLASS[dom] + 8 * Math.round(water / n * 31);
    }
    writeFileSync(pngOut, PNG.sync.write(png, { colorType: 2 }));

    // --- Ríos: trazado en unidades del mapa y aristas de casilla que cruzan ---
    const feats = await loadRivers();
    const rivers = [], riverEdge = new Set();
    const inside = ([x, y]) => x >= G.ox && y >= G.oy && x <= G.ox + G.width && y <= G.oy + G.height;
    for (const f of feats) {
        const lines = f.geometry?.type === 'LineString' ? [f.geometry.coordinates] : f.geometry?.type === 'MultiLineString' ? f.geometry.coordinates : [];
        const rank = f.properties.scalerank, width = rank <= 3 ? 3 : rank <= 5 ? 2 : 1;
        for (const line of lines) {
            const pts = simplify(line.map(p => projectLonLat(p)), 0.2).filter(inside);
            if (pts.length < 2) continue;
            let len = 0;
            for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
            if (len < 4) continue;
            rivers.push([width, ...pts.flatMap(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10])]);
            for (let k = 1; k < pts.length; k++) {
                const a = pts[k - 1], b = pts[k], steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (G.S * 0.5)) + 1;
                const cand = new Set();
                for (let s = 0; s <= steps; s++) {
                    const c = G.cellAt(a[0] + (b[0] - a[0]) * s / steps, a[1] + (b[1] - a[1]) * s / steps);
                    if (c >= 0) cand.add(c);
                }
                for (const i of cand) {
                    if (data.cells[i] < 0) continue;
                    for (let d = 0; d < 6; d++) {
                        const j = G.nb[i * 6 + d];
                        if (j < 0 || data.cells[j] < 0) continue;
                        if (segCross([G.cx[i], G.cy[i]], [G.cx[j], G.cy[j]], a, b)) riverEdge.add(d < 3 ? `${i}:${d}` : `${j}:${d - 3}`);
                    }
                }
            }
        }
    }
    console.log(`  ríos: ${rivers.length} tramos, ${riverEdge.size} aristas de casilla cruzan un río`);

    data.terrain = terrain.join('');
    data.relief = { x0: +G.ox.toFixed(3), y0: +G.oy.toFixed(3), res: RELIEF_RES, w: RW, h: RH };
    data.rivers = rivers;
    data.riverEdges = [...riverEdge].flatMap(k => k.split(':').map(Number));
    if (!/WorldCover/.test(data.sources)) data.sources += '; relieve: Mapzen Terrarium (SRTM, GMTED, ETOPO); usos del suelo: ESA WorldCover 2021 (CC BY 4.0); ríos: Natural Earth 5.1.1';
    return data;
}
