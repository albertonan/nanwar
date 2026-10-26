// Pruebas del mando de masas: plantillas sin tope, escalones mayores, oro de operaciones, mando por masas, drones y misiles.
// Mismo arnés que smoke-mando: sirve el juego por HTTP y comprueba las reglas una a una en la página.
// Uso: node basicmilitary/tools/smoke-masas.mjs [filtro]   (CHROME=<ruta> para usar otro navegador)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const filter = process.argv[2] ?? '';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
    const path = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/$/, '/index.html'));
    if (!path.startsWith(root) || !existsSync(path)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(readFileSync(path));
}).listen(0);
const port = server.address().port;

// Cada prueba corre dentro de la página: devuelve true si pasa, o un texto que explica el fallo.
const setup = () => {
    window.T = {
        game(seed = 7, fog = false) { const g = new GameEngine(seed); g.configure({ aggression: 'normal', alliances: 'ninguna', victory: 1, fog }); return g; },
        nation: key => E.countries.findIndex(c => c.key === key),
        eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); },
        ok(c, msg) { if (!c) throw new Error(msg); },
        learn(g, id, ...ids) { for (const t of ids) g.nations[id].tech.done.add(t); g.techVersion++; },
        free: (g, c) => isLand(c) && !g.armyAt[c] && CITY_OF[c] < 0,
        // Casilla llana de `owner`, sin ciudad, con sus seis vecinas de tierra libres; y una vecina sin río por medio.
        plainPair(g, owner, skip = 0) {
            for (const c of G.land) {
                if (g.owner[c] !== owner || CELL_TERRAIN[c] !== 'plain' || !T.free(g, c)) continue;
                const nbs = [0, 1, 2, 3, 4, 5].map(d => G.nb[c * 6 + d]);
                if (!nbs.every(j => j >= 0 && T.free(g, j) && g.owner[j] === owner)) continue;
                const d = [0, 1, 2, 3, 4, 5].find(k => !RIVER[c * 6 + k]);
                if (d !== undefined && skip-- <= 0) return [G.nb[c * 6 + d], c];
            }
            throw new Error('no hay casilla llana libre');
        },
        // Ejército nuevo de `owner` en `cell` (sin moverse aún este turno).
        army(g, owner, cell, inf = 1, tank = 0, art = 0) { return g.settle(g.newArmy(owner, cell, { infantry: inf, tank, artillery: art }, 0)); },
        // Casilla libre de `owner`, sin ciudad, a entre `min` y `max` puntos de movimiento de `from` por su territorio.
        farCell(g, owner, from, min, max = min * 2) {
            const f = g.orderField(owner, from);
            for (const c of G.land) if (g.owner[c] === owner && T.free(g, c) && f.to(c) >= min * MOVE && f.dist[c] <= max * MOVE) return c;
            throw new Error('no hay casilla a esa distancia');
        },
        // Casilla libre de `a` junto a la frontera con `b`, y la de `b` de al lado.
        border(g, a, b, skip = 0) {
            for (const c of G.land) {
                if (g.owner[c] !== a || !T.free(g, c)) continue;
                for (let d = 0; d < 6; d++) { const j = G.nb[c * 6 + d]; if (j >= 0 && isLand(j) && g.owner[j] === b && skip-- <= 0) return [c, j]; }
            }
            throw new Error('no hay frontera');
        },
        // Ciudad de `b` más cerca (por tierra) de la casilla dada.
        nearestCity(g, owner, b, cell) {
            const steps = g.field(owner, [cell]);
            return PROVINCES.filter(p => g.owner[p.city] === b).sort((x, y) => steps[x.city] - steps[y.city])[0].city;
        },
        // Pasa turnos solo para `owner`: cumple sus órdenes y le devuelve el movimiento.
        turns(g, owner, n) { for (let i = 0; i < n; i++) { g.executeOrders(owner); g.turn++; g.nations[owner].recruited.clear(); for (const a of g.armies.values()) if (a.owner === owner) a.used = 0; } },
        // Frente artificial: alrededor de una casilla de `a` (una ciudad si `city`) con colinas o montaña detrás, lo que
        // queda más allá en una dirección pasa a `b`. Devuelve { line: la frontera de `a` como línea continua, center, back:
        // casillas ásperas de detrás, front(k): casillas de `b` junto a la línea }. Sin ejércitos ni ciudades por medio.
        sector(g, a, b, { city = false, skip = 0 } = {}) {
            const rough = c => ['hills', 'mountain'].includes(CELL_TERRAIN[c]);
            for (const h of G.land) {
                if (g.owner[h] !== a || (city ? CITY_OF[h] < 0 || CAPITAL_OF[h] >= 0 : CITY_OF[h] >= 0 || CELL_TERRAIN[h] !== 'plain')) continue;
                const area = [...g.nearCells(h, 6).keys()].filter(isLand);
                for (let d = 0; d < 6; d++) {
                    const n = G.nb[h * 6 + d];
                    if (n < 0) continue;
                    const L = Math.hypot(G.cx[n] - G.cx[h], G.cy[n] - G.cy[h]), ux = (G.cx[n] - G.cx[h]) / L, uy = (G.cy[n] - G.cy[h]) / L;
                    const proj = c => ((G.cx[c] - G.cx[h]) * ux + (G.cy[c] - G.cy[h]) * uy) / G.W, perp = c => ((G.cx[c] - G.cx[h]) * -uy + (G.cy[c] - G.cy[h]) * ux) / G.W;
                    const back = area.filter(c => proj(c) <= -1.5 && proj(c) >= -5 && Math.abs(perp(c)) <= 3 && rough(c) && g.owner[c] === a && !g.armyAt[c]);
                    if (back.length < 4) continue;
                    const edge = area.filter(c => proj(c) < 0.8 && proj(c) > -0.6 && Math.abs(perp(c)) <= 2.6);
                    if (edge.length < 3 || edge.some(c => c !== h && (g.owner[c] !== a || g.armyAt[c] || CITY_OF[c] >= 0 || CELL_TERRAIN[c] !== 'plain'))) continue;
                    const foe = area.filter(c => proj(c) >= 0.8);
                    if (foe.some(c => CAPITAL_OF[c] >= 0) || skip-- > 0) continue;
                    for (const c of foe) { const x = g.armyOn(c); if (x) g.removeArmy(x); g.owner[c] = b; g.legal[c] = b; }
                    g.version++;
                    const ends = edge.sort((x, y) => perp(x) - perp(y));
                    const line = g.planFort(a, ends[0], ends[ends.length - 1]).path;
                    const front = k => [...new Set(line.flatMap(c => [...G.nb.slice(c * 6, c * 6 + 6)]))].filter(j => j >= 0 && isLand(j) && g.owner[j] === b && !g.armyAt[j])[k];
                    return { line, center: h, back, front, proj, perp };
                }
            }
            throw new Error('no hay sitio para el frente');
        },
        // Empieza una partida en la interfaz con el país dado y devuelve su motor.
        uiStart(key, fog = false) {
            for (const d of document.querySelectorAll('dialog[open]')) d.close();
            ui.setGame(T.game(7, fog));
            ui.choice = T.nation(key); ui.render();
            document.querySelector('[data-action="start"]').click();
            return ui.game;
        }
    };
};

const CHECKS = [
    ['A1 · plantillas: tope 9999 y 24 propias', () => {
        const g = T.uiStart('es');
        ui.tplDraft = { name: 'Masa', units: { infantry: 9990, tank: 0, artillery: 0 } };
        ui.tab = 'mando'; ui.drawerOpen = true; ui.tplOpen = true; ui.render();
        for (let i = 0; i < 3; i++) document.querySelector('[data-action="tpl-step"][data-unit="infantry"][data-delta="10"]').click();
        T.eq(ui.tplDraft.units.infantry, 9999, 'tope 9999');
        const box = document.querySelector('input[data-tpl-unit="infantry"]');
        box.value = '123456'; box.dispatchEvent(new Event('input', { bubbles: true }));
        T.eq(ui.tplDraft.units.infantry, 9999, 'la cifra escrita también topa');
        box.value = '250'; box.dispatchEvent(new Event('input', { bubbles: true }));
        T.eq(ui.tplDraft.units.infantry, 250, 'la cifra escrita se fija');
        for (let i = 0; i < 24; i++) T.ok(g.playerSaveTemplate(`P${i}`, { infantry: 100, tank: 0, artillery: 0 }), `guarda la ${i + 1}.ª`);
        T.ok(!g.playerSaveTemplate('P25', { infantry: 1, tank: 0, artillery: 0 }), 'la 25.ª no');
        T.eq(g.nations[g.player].templates.length, 24, 'son 24');
        T.eq(g.nations[g.player].templates[0].units.infantry, 100, 'una plantilla');
        g.nations[g.player].templates.length = 0;
        g.playerSaveTemplate('Enorme', { infantry: 20000, tank: 0, artillery: 0 });
        T.eq(g.nations[g.player].templates[0].units.infantry, 9999, 'topa cada tipo');
        const h = GameEngine.load(JSON.parse(JSON.stringify(g.serialize())));
        T.eq(h.nations[g.player].templates[0].units.infantry, 9999, 'se carga sin recortar a 99');
        T.eq([TEMPLATES.cuerpo.units.infantry, TEMPLATES.cuerpo.units.tank, TEMPLATES.cuerpo.units.artillery], [60, 24, 12], 'cuerpo');
        T.eq([TEMPLATES.campana.units.infantry, TEMPLATES.campana.units.tank, TEMPLATES.campana.units.artillery], [240, 100, 50], 'ejército de campaña');
        return true;
    }],
    ['A2 · escalones hasta grupo de ejércitos', () => {
        T.eq([24, 25, 99, 100, 399, 400, 1499, 1500, 4000].map(n => echelonOf(n).mark), ['X', 'XX', 'XX', 'XXX', 'XXX', 'XXXX', 'XXXX', 'XXXXX', 'XXXXX'], 'marcas');
        T.eq(echelonOf(3000).name, 'grupo de ejércitos', 'nombre');
        T.eq(ECHELONS.length, 7, 'siete escalones');
        return true;
    }],
    ['A6 · oro de operación hasta 6400 y fondo mayor', () => {
        const g = T.game(), es = T.nation('es');
        g.start(es);
        T.eq(OP_GOLD, [0, 50, 100, 200, 400, 800, 1600, 3200, 6400], 'OP_GOLD');
        const op = g.createOp(es, 'reserva', [g.nations[es].capitalCell ?? PROVINCES.find(p => g.owner[p.city] === es).city], { gold: 6400, template: 'campana' });
        T.eq(op.gold, 6400, 'acepta 6400');
        g.nations[es].gold = 1e6;
        op.pool = 1e9; op.poolTurn = -1; g.reinforceBegin(op);
        T.eq(op.pool, Math.max(6400 * 6, g.templateCost(es, TEMPLATES.campana.units) * 3), 'tope del fondo');
        const h = GameEngine.load(JSON.parse(JSON.stringify(g.serialize())));
        T.eq([...h.ops.values()][0].gold, 6400, 'el oro sobrevive a guardar y cargar');
        return true;
    }]
];

const exe = process.env.CHROME ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find(existsSync);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
let failed = 0, ran = 0;
try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://localhost:${port}/?seed=7`);
    await page.waitForFunction(() => typeof GameEngine === 'function' && typeof ui === 'object');
    await page.evaluate(setup);
    for (const [name, fn] of CHECKS) {
        if (filter && !name.includes(filter)) continue;
        ran++;
        const result = await page.evaluate(`Promise.resolve().then(${fn.toString()}).catch(e => String(e && e.stack || e))`);
        if (result === true) console.log(`ok    ${name}`);
        else { failed++; console.log(`FALLA ${name}\n      ${String(result).split('\n').slice(0, 3).join('\n      ')}`); }
    }
    if (errors.length) { failed++; console.log(`FALLA errores en la página:\n      ${errors.join('\n      ')}`); }
} finally {
    await browser.close();
    server.close();
}
console.log(`${ran - Math.min(failed, ran)}/${ran} pruebas superadas`);
process.exit(failed ? 1 : 0);
