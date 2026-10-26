// Pruebas de la parte D: doctrina de la ofensiva, anchura del frente, punta de lanza, seguimiento y frente amplio.
// Mismo arnés que smoke-masas: sirve el juego por HTTP y comprueba las reglas una a una en la página.
// Uso: node basicmilitary/tools/smoke-lanza.mjs [filtro]   (CHROME=<ruta> para usar otro navegador)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
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
        // Casilla llana de `owner` (sin ciudad ni ejército, con sus vecinas de tierra suyas y libres) que pasa a `foe`, y
        // `k` vecinas suyas: las `river` primeras cruzando un río, las demás sin río. Con `sea`, también una vecina de mar
        // libre. Devuelve { target, sides, sea }.
        ring(g, owner, foe, k, { river = 0, sea = false, skip = 0 } = {}) {
            for (const c of G.land) {
                if (g.owner[c] !== owner || CELL_TERRAIN[c] !== 'plain' || !T.free(g, c)) continue;
                const nbs = [0, 1, 2, 3, 4, 5].map(d => G.nb[c * 6 + d]).filter(j => j >= 0);
                const land = nbs.filter(isLand);
                if (!land.every(j => T.free(g, j) && g.owner[j] === owner)) continue;
                const wet = land.filter(j => RIVER[j * 6 + G.dirTo(j, c)]), dry = land.filter(j => !RIVER[j * 6 + G.dirTo(j, c)]);
                const water = nbs.find(j => !isLand(j) && !g.armyAt[j]);
                if (wet.length < river || dry.length < k - river || (sea && water === undefined) || skip-- > 0) continue;
                g.owner[c] = foe; g.legal[c] = foe; g.version++;
                return { target: c, sides: [...wet.slice(0, river), ...dry.slice(0, k - river)], sea: water ?? -1 };
            }
            throw new Error('no hay casilla rodeable');
        },
        // Casillas libres de `owner` (tierra, sin ciudad) a `d` pasos de `center`, por cada `d` de `dists`, distintas entre
        // sí y con camino por tierra hasta `center`.
        cellsAt(g, owner, center, dists) {
            const near = g.nearCells(center, Math.max(...dists)), f = g.orderField(owner, center), used = new Set();
            return dists.map(d => {
                const c = [...near].find(([c, k]) => k === d && !used.has(c) && T.free(g, c) && g.owner[c] === owner && f.to(c) < Infinity)?.[0];
                if (c === undefined) throw new Error(`no hay casilla a ${d}`);
                used.add(c);
                return c;
            });
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
        // Casilla libre de `owner`, sin ciudad, lo más lejos posible de sus ciudades (para que los reclutas tarden).
        remote(g, owner) {
            const cities = PROVINCES.filter(p => g.owner[p.city] === owner).map(p => p.city), f = g.landSteps(owner, cities);
            const ok = c => g.owner[c] === owner && T.free(g, c) && f[c] < 1e9;
            return G.land.filter(ok).sort((x, y) => f[y] - f[x] || x - y)[0];
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
        // Casillas que pisa la recta de `a` a `b`, cada media casilla (como el trazado de una ofensiva).
        samples(a, b) {
            const k = Math.max(1, Math.round(Math.hypot(G.cx[b] - G.cx[a], G.cy[b] - G.cy[a]) / G.W)) * 2, out = new Set([a, b]);
            for (let j = 1; j < k; j++) { const c = G.cellAt(G.cx[a] + (G.cx[b] - G.cx[a]) * j / k, G.cy[a] + (G.cy[b] - G.cy[a]) * j / k); if (c >= 0) out.add(c); }
            return [...out];
        },
        // ¿Son de `owner` y de tierra todas las casillas a `m` o menos del trazado `pts` (y con suministro, si `supply`)?
        // Si lo son, quita los ejércitos que haya en ellas y devuelve true.
        clearRoute(g, owner, pts, m, supply = false) {
            const area = new Set();
            for (let i = 0; i + 1 < pts.length; i++) for (const s of T.samples(pts[i], pts[i + 1])) for (const x of g.nearCells(s, m).keys()) {
                if (!isLand(x) || g.owner[x] !== owner || CAPITAL_OF[x] >= 0 || (supply && !g.inSupply(owner, x))) return false;
                area.add(x);
            }
            for (const x of area) { const a = g.armyOn(x); if (a) g.removeArmy(a); }
            return true;
        },
        // Flecha recta de `len` casillas por tierra de `owner`, con margen `m` alrededor: [salida, objetivo].
        straight(g, owner, len, { m = 2, supply = false, skip = 0 } = {}) {
            for (const S of G.land) {
                if (g.owner[S] !== owner || CITY_OF[S] >= 0) continue;
                for (const [O, d] of g.nearCells(S, len)) if (d === len && isLand(O) && CITY_OF[O] < 0 && T.clearRoute(g, owner, [S, O], m, supply) && skip-- <= 0) return [S, O];
            }
            throw new Error('no hay sitio para la flecha');
        },
        // Flecha en L por tierra de `owner`: dos tramos de `leg` casillas, y el punto intermedio a `perp` casillas o más de
        // la recta entre la salida y el objetivo (fuera de su pasillo): [salida, intermedio, objetivo].
        elbow(g, owner, { leg = 7, perp = 4.5, m = 1 } = {}) {
            for (const S of G.land) {
                if (g.owner[S] !== owner || CITY_OF[S] >= 0) continue;
                for (const [M, d] of g.nearCells(S, leg)) {
                    if (d !== leg || !isLand(M) || g.owner[M] !== owner) continue;
                    for (const [O, e] of g.nearCells(M, leg)) {
                        if (e !== leg || !isLand(O) || CITY_OF[O] >= 0 || hexDist(S, O) < leg + 2) continue;
                        const so = Math.hypot(G.cx[O] - G.cx[S], G.cy[O] - G.cy[S]);
                        const p = Math.abs((G.cx[O] - G.cx[S]) * (G.cy[M] - G.cy[S]) - (G.cy[O] - G.cy[S]) * (G.cx[M] - G.cx[S])) / so / G.W;
                        if (p >= perp && T.clearRoute(g, owner, [S, M, O], m)) return [S, M, O];
                    }
                }
            }
            throw new Error('no hay sitio para la L');
        },
        // Dos costas de un mismo país frente a frente por mar (a 3–5 casillas) con un camino por tierra suya mucho más
        // largo, por el que la marcha de siempre iría embarcada: { owner, A, B, pts: el camino por tierra, casilla a casilla }.
        bay(g) {
            const nbs = c => [0, 1, 2, 3, 4, 5].map(d => G.nb[c * 6 + d]).filter(j => j >= 0);
            for (let owner = 0; owner < g.nations.length; owner++) for (const A of G.land) {
                if (g.owner[A] !== owner || !T.free(g, A) || !nbs(A).some(j => !isLand(j))) continue;
                let steps = null;
                for (const [B, d] of g.nearCells(A, 5)) {
                    if (d < 3 || !isLand(B) || g.owner[B] !== owner || !T.free(g, B) || !nbs(B).some(j => !isLand(j))) continue;
                    steps ??= g.landSteps(owner, [A]);
                    if (steps[B] < d * 3 || steps[B] > 30) continue;
                    const pts = [B];
                    while (pts[pts.length - 1] !== A) { const c = pts[pts.length - 1]; pts.push(nbs(c).find(j => isLand(j) && steps[j] === steps[c] - 1)); }
                    pts.reverse();
                    if (!pts.every(c => g.owner[c] === owner && CAPITAL_OF[c] < 0)) continue;
                    if (!g.fieldPath(g.orderField(owner, B), A).some(afloat)) continue;   // por mar le saldría más corto
                    return { owner, A, B, pts };
                }
            }
            throw new Error('no hay bahía');
        },
        // Ciudad X de Francia que la punta `a` (3 infanterías y 6 tanques) acaba de tomar y asedia, con un camino de 8
        // casillas por delante hasta otra provincia, y el seguimiento `b` (6 infanterías) a 2 casillas por detrás:
        // { g, es, X, a, b, op }.
        siege() {
            const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
            g.start(es); g.declareWar(es, fr);
            let X = -1, O = -1;
            for (const p of PROVINCES) {
                if (g.owner[p.city] !== es || CAPITAL_OF[p.city] >= 0) continue;
                for (const [c, d] of g.nearCells(p.city, 8)) if (d === 8 && isLand(c) && CITY_OF[c] < 0 && G.prov[c] !== G.prov[p.city] && T.clearRoute(g, es, [p.city, c], 1)) { X = p.city; O = c; break; }
                if (X >= 0) break;
            }
            T.ok(X >= 0, 'ciudad con camino');
            g.owner[X] = fr; g.legal[X] = fr; g.owner[O] = fr; g.legal[O] = fr; g.version++;
            const a = T.army(g, es, X, 3, 6, 0);
            g.capture(X, es, true);
            const op = g.createOp(es, 'ofensiva', [X, O], { doctrine: 'lanza' });
            const back = [...g.nearCells(X, 2)].find(([c, d]) => d === 2 && T.free(g, c) && g.owner[c] === es && g.opAlong(op, c) === 0)?.[0];
            T.ok(back !== undefined, 'casilla detrás de la ciudad');
            const b = T.army(g, es, back, 6, 0, 0);
            for (const x of [a, b]) g.assignArmy(x, op.id);
            g.opLaunch(op);
            op.echelon = { [a.id]: 'punta', [b.id]: 'seguimiento' };
            return { g, es, X, a, b, op };
        },
        // Casilla de la recta de S a O a unos `along` de la salida de `op`, con carretera (si no tiene, se le pone una hacia
        // la siguiente casilla de la recta).
        roadAt(g, op, S, O, along) {
            const pts = T.samples(S, O).sort((x, y) => g.opAlong(op, x) - g.opAlong(op, y));
            const i = pts.reduce((b, c, k) => Math.abs(g.opAlong(op, c) - along) < Math.abs(g.opAlong(op, pts[b]) - along) ? k : b, 0), C = pts[i];
            if (![0, 1, 2, 3, 4, 5].some(d => g.road[C * 6 + d])) {
                const d = G.dirTo(C, pts[i + 1]);
                T.ok(d >= 0, 'casillas seguidas');
                g.road[C * 6 + d] = 1; g.road[pts[i + 1] * 6 + (d + 3) % 6] = 1; g.roadVersion++;
            }
            return C;
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
    ['D1 · doctrina, anchura y logística se guardan y se cargan; las viejas son asalto', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); g.declareWar(es, fr);
        const [S, O] = T.straight(g, es, 8);
        g.owner[O] = fr; g.legal[O] = fr; g.version++;
        T.eq(Object.keys(OP_DOCTRINES), ['asalto', 'lanza', 'amplio'], 'tres doctrinas');
        T.ok(Object.values(OP_DOCTRINES).every(d => d.name && d.desc), 'con nombre y explicación');
        T.eq(OP_WIDTHS, { estrecha: 60, media: 120, amplia: 200 }, 'anchuras en km');
        const pick = o => [o.doctrine, o.width, o.logistics];
        const a = g.createOp(es, 'ofensiva', [S, O]);
        T.eq([...pick(a), a.echelon, a.pockets, a.garrisons], ['asalto', 'estrecha', 0, {}, [], []], 'por defecto, asalto');
        T.eq(pick(g.createOp(es, 'ofensiva', [S, O], { doctrine: 'lanza', noCap: true })), ['lanza', 'estrecha', 50], 'punta de lanza: estrecha y la mitad a logística');
        T.eq(pick(g.createOp(es, 'ofensiva', [S, O], { doctrine: 'amplio', noCap: true })), ['amplio', 'amplia', 50], 'frente amplio: amplia');
        T.eq(pick(g.createOp(es, 'ofensiva', [S, O], { doctrine: 'x', width: 'enorme', logistics: 33, noCap: true })), ['asalto', 'estrecha', 0], 'lo desconocido, de serie');
        const op = g.createOp(es, 'ofensiva', [S, O], { doctrine: 'lanza', width: 'media', logistics: 25, noCap: true });
        T.eq(pick(op), ['lanza', 'media', 25], 'lo pedido');
        // Ficha: anchura y logística se cambian; la doctrina pone las de serie de la nueva.
        g.playerOpSet(op, 'width', 'amplia'); g.playerOpSet(op, 'logistics', 75);
        g.playerOpSet(op, 'width', 'enorme'); g.playerOpSet(op, 'logistics', 30); g.playerOpSet(op, 'doctrine', 'nada');
        T.eq(pick(op), ['lanza', 'amplia', 75], 'la ficha cambia anchura y logística, y no admite lo que no existe');
        g.playerOpSet(op, 'doctrine', 'asalto');
        T.eq(pick(op), ['asalto', 'estrecha', 0], 'otra doctrina, con sus valores de serie');
        g.playerOpSet(op, 'doctrine', 'lanza'); g.playerOpSet(op, 'width', 'media'); g.playerOpSet(op, 'logistics', 25);
        // Escalones, bolsas y guarniciones de una punta a mitad de camino.
        const x = T.army(g, es, S, 0, 4, 0), y = T.army(g, es, T.cellsAt(g, es, S, [1])[0], 4, 0, 0);
        for (const b of [x, y]) g.assignArmy(b, op.id);
        g.opLaunch(op);
        op.pockets.push(O); op.garrisons.push(S);
        T.eq(op.echelon, { [x.id]: 'punta', [y.id]: 'seguimiento' }, 'escalones al lanzar');
        const data = JSON.parse(JSON.stringify(g.serialize()));
        let h = GameEngine.load(JSON.parse(JSON.stringify(data)));
        const all = o => [...pick(o), o.echelon, o.pockets, o.garrisons, o.phase];
        T.eq(all(h.ops.get(op.id)), all(op), 'se guardan y se cargan');
        T.eq([h.opEchelon(h.ops.get(op.id), h.armies.get(x.id)), h.opEchelon(h.ops.get(op.id), h.armies.get(y.id))], ['punta', 'seguimiento'], 'los escalones siguen');
        // Lo que no vale, fuera.
        const bad = JSON.parse(JSON.stringify(data));
        for (const o of bad.ops) if (o.id === op.id) Object.assign(o, { doctrine: 'zz', width: 3, logistics: 'mucho', echelon: [[x.id, 'jefe'], ['a', 'punta'], [y.id, 'punta']], pockets: [-1, 'b', O, O, 1e9], garrisons: null });
        h = GameEngine.load(bad);
        T.eq(all(h.ops.get(op.id)), ['asalto', 'estrecha', 0, { [y.id]: 'punta' }, [O], [], 'avance'], 'se valida al cargar');
        // Partida de antes de la parte D: sin esos campos, asaltos.
        for (const o of data.ops) for (const k of ['doctrine', 'width', 'logistics', 'echelon', 'pockets', 'garrisons']) delete o[k];
        h = GameEngine.load(data);
        for (const o of h.ops.values()) if (o.kind === 'ofensiva') T.eq([...pick(o), o.echelon, o.pockets, o.garrisons], ['asalto', 'estrecha', 0, {}, [], []], 'las viejas son asalto');
        h.endTurn();
        return true;
    }],
    ['D1 · la anchura cambia el pasillo', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); g.declareWar(es, fr);
        const [S, O] = T.straight(g, es, 8);
        g.owner[O] = fr; g.legal[O] = fr; g.version++;
        const op = g.createOp(es, 'ofensiva', [S, O]), pts = T.samples(S, O);
        const R = () => Math.max(...[...g.opCorridor(op)].map(c => Math.min(...pts.map(p => hexDist(p, c)))));
        const sizes = [];
        for (const [w, km, n] of [['estrecha', 60, 3], ['media', 120, 6], ['amplia', 200, 10]]) {
            g.playerOpSet(op, 'width', w);
            T.eq([kmCells(km), R()], [n, n], `${w}: ${n} casillas a cada lado`);
            T.ok(pts.every(p => [...g.nearCells(p, n).keys()].every(c => g.opCorridor(op).has(c))), `${w}: todo lo que está a ${n} o menos`);
            T.eq(g.opTrace(op).first.size, g.opCorridor(op).size, `${w}: el primer tramo es el pasillo entero`);
            sizes.push(g.opCorridor(op).size);
        }
        T.ok(sizes[0] < sizes[1] && sizes[1] < sizes[2], `crece con la anchura (${sizes})`);
        // La reunión mira al enemigo del primer tramo con la anchura elegida.
        g.playerOpSet(op, 'width', 'estrecha');
        const far = [...g.nearCells(S, 9).keys()].find(c => isLand(c) && T.free(g, c) && !g.opCorridor(op).has(c) && Math.min(...pts.map(p => hexDist(p, c))) === 5);
        T.ok(far !== undefined, 'casilla a 5 de la flecha');
        g.owner[far] = fr; g.legal[far] = fr; g.version++;
        g.settle(g.newArmy(fr, far, { infantry: 50, tank: 0, artillery: 0 }, 0));
        T.eq(g.opReady(op).ratio, null, 'estrecha: el enemigo a 5 casillas no cuenta');
        g.playerOpSet(op, 'width', 'media');
        T.ok(g.opReady(op).ratio !== null, 'media: sí');
        return true;
    }],
    ['D2 · al lanzar, los rápidos van en la punta y el resto en el seguimiento', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); g.declareWar(es, fr);
        const [S, O] = T.straight(g, es, 10, { m: 1 });
        g.owner[O] = fr; g.legal[O] = fr; g.version++;
        const op = g.createOp(es, 'ofensiva', [S, O], { doctrine: 'lanza' });
        const cs = T.cellsAt(g, es, S, [0, 1, 1, 1]);
        const [tk1, tk2, inf, mix] = [[0, 6, 0], [0, 3, 0], [6, 0, 0], [2, 4, 0]].map(([i, t, r], k) => T.army(g, es, cs[k], i, t, r));
        for (const a of [tk1, tk2, inf, mix]) g.assignArmy(a, op.id);
        T.eq([tk1, tk2, inf, mix].map(a => g.opSpeedy(a)), [true, true, false, false], 'rápido: velocidad 6 o más');
        T.learn(g, es, 'infanteria3');
        T.ok(!g.opSpeedy(inf), 'la infantería mecanizada (5) aún no');
        T.eq([tk1, inf].map(a => g.opEchelon(op, a)), ['seguimiento', 'seguimiento'], 'antes de salir, nadie en la punta');
        g.opLaunch(op);
        T.eq([tk1, tk2, inf, mix].map(a => g.opEchelon(op, a)), ['punta', 'punta', 'seguimiento', 'seguimiento'], 'los tanques, en la punta');
        T.ok(g.logs.some(l => l.msg.includes('2 en la punta y 2 en el seguimiento')), 'el parte lo dice');
        const late = T.army(g, es, T.cellsAt(g, es, S, [2])[0], 0, 5, 0);
        g.assignArmy(late, op.id);
        T.eq(g.opEchelon(op, late), 'seguimiento', 'el que llega después, al seguimiento');
        g.playerOpSet(op, `echelon:${late.id}`, 'punta'); g.playerOpSet(op, `echelon:${inf.id}`, 'jefe'); g.playerOpSet(op, `echelon:${tk1.id}`, 'seguimiento');
        T.eq([late, inf, tk1].map(a => g.opEchelon(op, a)), ['punta', 'seguimiento', 'seguimiento'], 'la ficha pasa ejércitos de un escalón a otro');
        // Sin ninguno rápido, la punta es el más rápido.
        const op2 = g.createOp(es, 'ofensiva', [S, O], { doctrine: 'lanza', noCap: true });
        const [a, b] = T.cellsAt(g, es, S, [2, 2]).map((c, k) => T.army(g, es, c, 3, 0, k));
        for (const x of [a, b]) g.assignArmy(x, op2.id);
        g.opLaunch(op2);
        T.eq([a, b].map(x => g.opEchelon(op2, x)), ['punta', 'seguimiento'], 'la infantería sola es más rápida que con artillería');
        // Un asalto no reparte escalones.
        const op3 = g.createOp(es, 'ofensiva', [S, O], { noCap: true });
        const c = T.army(g, es, T.cellsAt(g, es, S, [3])[0], 0, 4, 0);
        g.assignArmy(c, op3.id); g.opLaunch(op3);
        T.eq(op3.echelon, {}, 'el asalto, sin escalones');
        // Pasar a punta de lanza ya en marcha reparte los escalones.
        g.playerOpSet(op3, 'doctrine', 'lanza');
        T.eq(g.opEchelon(op3, c), 'punta', 'al cambiar la doctrina en marcha');
        return true;
    }],
    ['D2 · la punta no espera al seguimiento hasta el límite y luego para', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); g.declareWar(es, fr);
        const [S, O] = T.straight(g, es, 10, { m: 1, supply: true });
        g.owner[O] = fr; g.legal[O] = fr; g.version++;
        const op = g.createOp(es, 'ofensiva', [S, O], { doctrine: 'lanza' });
        const [tk, inf] = T.cellsAt(g, es, S, [0, 1]).map((c, i) => T.army(g, es, c, i ? 6 : 0, i ? 0 : 6, 0));
        for (const a of [tk, inf]) g.assignArmy(a, op.id);
        g.opLaunch(op);
        T.eq([g.opEchelon(op, tk), g.opEchelon(op, inf)], ['punta', 'seguimiento'], 'escalones');
        const LEAD = Math.max(kmCells(120), 6), along = a => g.opAlong(op, a.cell);
        T.eq(LEAD, 6, 'en Europa, 6 casillas');
        g.setOrder(inf, { kind: 'hold' });   // el seguimiento no se mueve
        let gap = 0, still = 0;
        for (let t = 0; t < 6 && g.ops.has(op.id); t++) {
            const before = along(tk);
            T.turns(g, es, 1);
            gap = along(tk) - along(inf);
            T.ok(gap <= LEAD + 1e-9, `no pasa de ${LEAD} casillas por delante (${gap.toFixed(2)})`);
            if (t === 0) T.ok(gap > OP_LEAD + 1, `no espera al seguimiento (${gap.toFixed(2)})`);
            if (along(tk) - before < 0.25) still++;
        }
        T.ok(g.ops.has(op.id) && gap > LEAD - 1.5 && still >= 2, `se para junto al límite (${gap.toFixed(2)}, ${still} turnos quieta)`);
        T.ok(g.logs.some(l => l.msg.includes('La punta espera al seguimiento')), 'el parte lo dice');
        // Cuando el seguimiento avanza, la punta sigue.
        g.clearOrder(inf);
        const tip = along(tk);
        T.turns(g, es, 2);
        T.ok(!g.ops.has(op.id) || along(tk) > tip + 1, 'sigue cuando avanza el seguimiento');
        return true;
    }],
    ['D2 · la punta rodea una masa fuerte y la anota como bolsa', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); g.declareWar(es, fr);
        const [S, O] = T.straight(g, es, 10, { m: 1, supply: true });
        g.owner[O] = fr; g.legal[O] = fr; g.version++;
        const op = g.createOp(es, 'ofensiva', [S, O], { doctrine: 'lanza' });
        const M = T.samples(S, O).sort((x, y) => Math.abs(g.opAlong(op, x) - 5) - Math.abs(g.opAlong(op, y) - 5))[0];
        g.owner[M] = fr; g.legal[M] = fr; g.version++;
        const foe = g.settle(g.newArmy(fr, M, { infantry: 400, tank: 0, artillery: 0 }, 0));
        const tk = T.army(g, es, S, 0, 8, 0);
        g.assignArmy(tk, op.id);
        g.opLaunch(op);
        const seen = new Set(g.motion);
        for (let t = 0; t < 14 && g.ops.has(op.id); t++) T.turns(g, es, 1);
        T.eq(g.motion.filter(e => e.kind === 'battle' && !seen.has(e) && e.cell === M).length, 0, 'no ataca la masa');
        T.ok(g.armies.has(foe.id) && foe.units.infantry === 400, 'la masa sigue entera');
        T.ok(g.owner[O] === es || g.opAlong(op, tk.cell) > g.opAlong(op, M) + 1, 'la deja atrás');
        T.ok(g.opCorridor(op).has(tk.cell) || g.owner[O] === es, 'sin salir del pasillo');
        T.eq(op.pockets, [M], 'y la anota como bolsa');
        return true;
    }],
    ['D2 · al dejar una ciudad asediada deja 2 infanterías y el asedio sigue', () => {
        // Una ciudad de Francia que `units` acaba de tomar y asedia, y una ofensiva de punta de lanza que sale de ella.
        const besiege = (units) => {
            const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
            g.start(es); g.declareWar(es, fr);
            let X = -1, O = -1;
            for (const p of PROVINCES) {
                if (g.owner[p.city] !== es || CAPITAL_OF[p.city] >= 0) continue;
                for (const [c, d] of g.nearCells(p.city, 8)) if (d === 8 && isLand(c) && CITY_OF[c] < 0 && T.clearRoute(g, es, [p.city, c], 1)) { X = p.city; O = c; break; }
                if (X >= 0) break;
            }
            T.ok(X >= 0, 'ciudad con camino');
            g.owner[X] = fr; g.legal[X] = fr; g.owner[O] = fr; g.legal[O] = fr; g.version++;
            const a = T.army(g, es, X, ...units);
            g.capture(X, es, true);
            T.ok(g.sieges.get(X)?.by === es, 'la asedia');
            const op = g.createOp(es, 'ofensiva', [X, O], { doctrine: 'lanza' });
            g.assignArmy(a, op.id);
            g.opLaunch(op);
            T.eq(g.opEchelon(op, a), 'punta', 'es la punta');
            return { g, es, X, a, op };
        };
        let { g, es, X, a, op } = besiege([3, 6, 0]);
        T.turns(g, es, 1);
        let gar = g.armyOn(X);
        T.ok(gar && gar !== a && gar.owner === es && !gar.op, 'queda una guarnición fuera de la operación');
        T.eq([gar.units.infantry, gar.units.tank, gar.units.artillery], [2, 0, 0], 'de 2 infanterías');
        T.ok(g.armies.has(a.id) && a.cell !== X && a.op === op.id, 'la punta sigue');
        T.eq([a.units.infantry, a.units.tank], [1, 6], 'con el resto');
        T.eq(op.garrisons, [X], 'la operación la anota');
        T.ok(g.logs.some(l => l.msg.includes('deja 2 infanterías de guarnición')), 'el parte lo dice');
        const held = g.sieges.get(X)?.held;
        T.ok(held !== undefined, 'el asedio sigue');
        g.beginNationTurn(es);
        T.eq(g.sieges.get(X)?.held ?? 'tomada', held + 1, 'y avanza');
        // Sin infantería, deja la unidad más barata.
        ({ g, es, X, a, op } = besiege([0, 4, 2]));
        T.turns(g, es, 1);
        gar = g.armyOn(X);
        T.ok(gar && gar !== a, 'deja guarnición');
        T.eq([gar.units.infantry, gar.units.tank, gar.units.artillery], [0, 1, 0], 'un tanque, más barato que la artillería');
        // Si no puede dejar a nadie, no sale.
        ({ g, es, X, a, op } = besiege([0, 1, 0]));
        T.eq(g.leaveGarrison(op, a), null, 'una sola unidad no puede dejar guarnición');
        T.turns(g, es, 1);
        T.eq([a.cell, g.armyOn(X)?.id, g.sieges.get(X)?.by], [X, a.id, es], 'la punta se queda en la ciudad');
        T.ok(g.logs.some(l => l.msg.includes('no puede dejar guarnición')), 'y el parte lo dice');
        return true;
    }],
    ['D2 · el asalto sigue igual que en la parte A', () => {
        // Las pruebas A5 de smoke-masas, con la doctrina de asalto pedida.
        let g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); g.declareWar(es, fr);
        const [S, O] = T.straight(g, es, 10, { m: 1, supply: true });
        g.owner[O] = fr; g.legal[O] = fr; g.version++;
        let op = g.createOp(es, 'ofensiva', [S, O], { doctrine: 'asalto' });
        const [tk, inf] = T.cellsAt(g, es, S, [0, 1]).map((c, i) => T.army(g, es, c, i ? 6 : 0, i ? 0 : 6, 0));
        for (const a of [tk, inf]) g.assignArmy(a, op.id);
        let turns = 0;
        for (let t = 0; t < 25 && g.ops.has(op.id); t++) {
            T.turns(g, es, 1);
            if (!g.ops.has(op.id)) break;
            const [a, b] = [tk, inf].map(x => g.opAlong(op, x.cell));
            T.ok(a - b <= OP_LEAD + 1e-9, `los tanques no se adelantan más de ${OP_LEAD} (${a.toFixed(2)} / ${b.toFixed(2)})`);
            turns++;
        }
        T.ok(turns >= 2 && g.owner[O] === es, 'van juntos y toman el objetivo');
        T.eq(op.echelon, {}, 'sin escalones');
        g = T.game(); es = T.nation('es'); fr = T.nation('fr');
        g.start(es); g.declareWar(es, fr);
        const { target, sides } = T.ring(g, es, fr, 3);
        g.settle(g.newArmy(fr, target, { infantry: 400, tank: 0, artillery: 0 }, 0));
        const xs = sides.map(c => T.army(g, es, c, 0, 0, 30));
        op = g.createOp(es, 'ofensiva', [sides[0], target], { doctrine: 'asalto' });
        for (const a of xs) g.assignArmy(a, op.id);
        const seen = new Set(g.motion);
        g.executeOp(op);
        const bs = g.motion.filter(e => e.kind === 'battle' && !seen.has(e));
        T.eq(bs.length, 1, 'un solo combate');
        T.eq(bs[0].joint.slice().sort(), xs.map(a => a.id).sort(), 'con los tres a la vez');
        T.eq(g.owner[target], es, 'y lo ganan');
        return true;
    }],
    ['D1 · la anchura no baja de 3, 4 y 6 casillas: Europa 3/6/10 y el mundo 3/4/6', () => {
        const g = T.game(), es = T.nation('es');
        g.start(es);
        const [S, O] = T.straight(g, es, 8);
        const op = g.createOp(es, 'ofensiva', [S, O]);
        const widths = () => Object.keys(OP_WIDTHS).map(w => { op.width = w; return g.opLaneWidth(op); });
        const was = MAP.cellKm;
        try {
            T.eq(widths(), [3, 6, 10], 'Europa');
            MAP.cellKm = MAPS.mundo.cellKm;
            T.eq(widths(), [3, 4, 6], 'el mundo');
        } finally { MAP.cellKm = was; }
        return true;
    }],
    ['D3 · el seguimiento releva la guarnición y el asedio termina', () => {
        const { g, es, X, a, b, op } = T.siege();
        T.turns(g, es, 1);
        const gar = g.armyOn(X);
        T.ok(gar && gar !== a && !gar.op && op.garrisons.includes(X), 'la punta deja guarnición');
        let relieved = null;
        for (let t = 0; t < 4 && !relieved; t++) {
            T.turns(g, es, 1);
            const at = g.armyOn(X);
            if (at && at.op === op.id) relieved = at;
        }
        T.ok(relieved, 'el seguimiento entra en la ciudad');
        T.ok(!g.armies.has(b.id) || relieved.id === b.id, 'y se funde con la guarnición');
        T.ok(relieved.units.infantry >= 8, `con las tropas de los dos (${relieved.units.infantry})`);
        T.eq(g.opEchelon(op, relieved), 'seguimiento', 'en el seguimiento');
        T.ok(g.logs.some(l => l.msg.includes('releva la guarnición')), 'el parte lo dice');
        // Mantiene el asedio hasta que cae: no se va con el seguimiento.
        const cell = relieved.cell;
        for (let t = 0; t < 4 && g.sieges.has(X); t++) {
            g.beginNationTurn(es);
            if (!g.sieges.has(X)) break;
            T.turns(g, es, 1);
            T.ok(g.armyOn(X)?.owner === es, 'la ciudad no queda vacía');
            T.eq(relieved.cell, cell, 'el relevo no se va mientras dura el asedio');
        }
        T.ok(!g.sieges.has(X) && g.owner[X] === es && g.ops.has(op.id), 'el asedio termina: la ciudad es suya');
        T.turns(g, es, 1);
        T.eq(op.garrisons, [], 'y sale de la lista');
        // Una ciudad que se pierde también sale.
        const lost = PROVINCES.find(p => g.owner[p.city] === T.nation('fr')).city;
        op.garrisons.push(lost);
        T.turns(g, es, 1);
        T.ok(!op.garrisons.includes(lost), 'sin asedio, fuera de la lista');
        return true;
    }],
    ['D3 · limpia una bolsa con ataque conjunto si llega, y si no la cerca', () => {
        let g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); g.declareWar(es, fr);
        // Llega: tres del seguimiento junto a una bolsa débil atacan juntos.
        let { target, sides } = T.ring(g, es, fr, 3);
        let foe = g.settle(g.newArmy(fr, target, { infantry: 2, tank: 0, artillery: 0 }, 0));
        let far = T.cellsAt(g, es, target, [5])[0];
        let op = g.createOp(es, 'ofensiva', [far, target], { doctrine: 'lanza' });
        let xs = sides.map(c => T.army(g, es, c, 0, 0, 30));
        for (const x of xs) g.assignArmy(x, op.id);
        g.opLaunch(op);
        for (const x of xs) g.playerOpSet(op, `echelon:${x.id}`, 'seguimiento');
        op.pockets = [target];
        const seen = new Set(g.motion);
        g.opPockets(op);
        const bs = g.motion.filter(e => e.kind === 'battle' && !seen.has(e) && e.cell === target);
        T.eq(bs.length, 1, 'un combate');
        T.eq(bs[0].joint.slice().sort(), xs.map(a => a.id).sort(), 'con los tres');
        T.ok(!g.armies.has(foe.id) || foe.cell !== target, 'la bolsa cae');
        T.eq(op.pockets, [], 'y sale de la lista');
        // No llega: cinco del seguimiento a 2 casillas ocupan las vecinas libres y la cercan, sin atacar.
        g = T.game(); es = T.nation('es'); fr = T.nation('fr');
        g.start(es); g.declareWar(es, fr);
        target = G.land.find(c => CELL_TERRAIN[c] === 'plain' && [...g.nearCells(c, 2).keys()].every(x => T.free(g, x) && g.owner[x] === es && CAPITAL_OF[x] < 0));
        g.owner[target] = fr; g.legal[target] = fr; g.version++;
        foe = g.settle(g.newArmy(fr, target, { infantry: 400, tank: 0, artillery: 0 }, 0));
        far = T.cellsAt(g, es, target, [6])[0];
        op = g.createOp(es, 'ofensiva', [far, target], { doctrine: 'lanza' });
        xs = T.cellsAt(g, es, target, [2, 2, 2, 2, 2, 2]).map(c => T.army(g, es, c, 2, 0, 0));
        for (const x of xs) g.assignArmy(x, op.id);
        g.opLaunch(op);
        for (const x of xs) g.playerOpSet(op, `echelon:${x.id}`, 'seguimiento');
        op.pockets = [target];
        const seen2 = new Set(g.motion);
        const said = { notes: [], attacked: 0 };
        g.opPockets(op, undefined, said);
        T.eq(g.motion.filter(e => e.kind === 'battle' && !seen2.has(e)).length, 0, 'no ataca lo que no puede');
        T.eq(g.hostileSides(fr, target), CONFIG.SURROUNDED_SIDES, 'la cerca: 5 de sus 6 lados');
        T.eq(g.flankFactor(fr, target), g.rules(fr).surrounded, 'cercada');
        T.eq(op.pockets, [target], 'sigue en la lista');
        T.ok(xs.some(x => g.armies.has(x.id) && hexDist(x.cell, target) === 2), 'no manda a más de los que hacen falta');
        // El turno siguiente los que la cercan no se van con el seguimiento.
        const ring = xs.filter(x => g.armies.has(x.id) && hexDist(x.cell, target) === 1).map(x => [x.id, x.cell]);
        for (const x of g.armies.values()) if (x.owner === es) x.used = 0;
        g.executeOp(op);
        T.eq(ring.map(([id]) => g.armies.get(id)?.cell), ring.map(([, c]) => c), 'mantienen el cerco');
        T.ok(said.notes.some(s => s.includes('cerca la bolsa de') && s.includes('5 de sus 6 lados')), `el parte lo dice: ${said.notes}`);
        return true;
    }],
    ['D3 · logística repara los tramos rotos del pasillo con el oro de la operación', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); g.declareWar(es, fr);
        const [S, O] = T.straight(g, es, 10, { m: 1, supply: true });
        g.owner[O] = fr; g.legal[O] = fr; g.version++;
        // El oro de la operación se reparte: la parte de logística al fondo de obras, el resto a refuerzos.
        const op = g.createOp(es, 'ofensiva', [S, O], { doctrine: 'lanza', gold: 100 });
        g.reinforceBegin(op);
        T.eq([op.workPool, op.pool], [50, 50], 'la mitad a obras');
        const old = g.createOp(es, 'ofensiva', [S, O], { gold: 100, noCap: true });
        g.reinforceBegin(old);
        T.eq([old.workPool, old.pool], [0, 100], 'el asalto, todo a refuerzos');
        const tk = T.army(g, es, S, 0, 4, 0);
        g.assignArmy(tk, op.id);
        g.opLaunch(op);
        // Tramos rotos en mitad del pasillo, en territorio propio.
        const C = T.roadAt(g, op, S, O, 5);
        const n = g.breakRoads(C);
        T.ok(n > 0, 'rotos');
        op.workPool = 500;
        const nat = g.nations[es];
        nat.gold = 5000;
        const res = g.opLogistics(op);
        T.eq(res.repaired, n, `repara los ${n} tramos`);
        T.ok(res.cost > 0 && nat.gold === 5000 - res.cost && op.workPool === 500 - res.cost, `con el oro de la operación (${res.cost})`);
        for (let d = 0; d < 6; d++) if (g.broken[C * 6 + d]) T.eq(g.roadWork.get(edgeKey(C, d))?.owner, es, 'en obra');
        T.eq(g.opLogistics(op).repaired, 0, 'no paga dos veces la misma obra');
        // Con los turnos de obra, quedan reparados.
        for (let t = 0; t < g.rules(es).fortTurns; t++) g.beginNationTurn(es);
        T.ok([0, 1, 2, 3, 4, 5].every(d => !g.broken[C * 6 + d]), 'reparados');
        // El parte lo dice.
        g.breakRoads(C);
        const tally = { notes: [] };
        g.opLogistics(op, tally);
        T.ok(tally.notes.some(s => s.includes('repara') && s.includes('de oro')), `el parte: ${tally.notes}`);
        return true;
    }],
    ['D3 · logística construye carretera hacia la punta', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); g.declareWar(es, fr);
        const [S, O] = T.straight(g, es, 10, { m: 1, supply: true });
        g.owner[O] = fr; g.legal[O] = fr; g.version++;
        const op = g.createOp(es, 'ofensiva', [S, O], { doctrine: 'lanza' });
        const P = T.samples(S, O).sort((x, y) => Math.abs(g.opAlong(op, x) - 6) - Math.abs(g.opAlong(op, y) - 6))[0];
        // Sin carreteras alrededor de la punta: queda fuera de la red.
        for (const c of g.nearCells(P, 3).keys()) for (let d = 0; d < 6; d++) { const j = G.nb[c * 6 + d]; if (j >= 0) { g.road[c * 6 + d] = 0; g.road[j * 6 + (d + 3) % 6] = 0; g.broken[c * 6 + d] = 0; g.broken[j * 6 + (d + 3) % 6] = 0; } }
        g.roadVersion++;
        T.ok(!g.economy(es).seen[P], 'la punta, fuera de la red');
        const tk = T.army(g, es, P, 0, 4, 0), inf = T.army(g, es, S, 4, 0, 0);
        for (const x of [tk, inf]) g.assignArmy(x, op.id);
        g.opLaunch(op);
        T.eq(g.opEchelon(op, tk), 'punta', 'los tanques, en la punta');
        op.workPool = 3000;
        const nat = g.nations[es];
        nat.gold = 10000;
        const res = g.opLogistics(op);
        T.ok(res.built > 0, 'construye');
        T.ok(g.economy(es).seen[P] === 1, 'la punta queda unida a la red');
        T.ok(nat.gold === 10000 - res.cost && op.workPool === 3000 - res.cost, `con el oro de la operación (${res.cost})`);
        T.eq(g.opLogistics(op).built, 0, 'ya unida, no construye más');
        // Con poco oro construye desde la red lo que pague y sigue el turno siguiente.
        for (const c of g.nearCells(P, 3).keys()) for (let d = 0; d < 6; d++) { const j = G.nb[c * 6 + d]; if (j >= 0) { g.road[c * 6 + d] = 0; g.road[j * 6 + (d + 3) % 6] = 0; } }
        g.roadVersion++;
        op.workPool = 40;
        const part = g.opLogistics(op);
        T.ok(part.built >= 1 && part.cost <= 40 && !g.economy(es).seen[P], `obra a medias (${part.built} tramos, ${part.cost} de oro)`);
        op.workPool = 3000;
        T.ok(g.opLogistics(op).built >= 1 && g.economy(es).seen[P] === 1, 'y la termina después');
        return true;
    }],
    ['D3 · sin oro o con enemigo al lado no gasta y el parte dice por qué', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); g.declareWar(es, fr);
        const [S, O] = T.straight(g, es, 10, { m: 1, supply: true });
        g.owner[O] = fr; g.legal[O] = fr; g.version++;
        const op = g.createOp(es, 'ofensiva', [S, O], { doctrine: 'lanza' });
        const C = T.roadAt(g, op, S, O, 6);
        g.breakRoads(C);
        // La punta, en la red y lejos de la obra: no hay carretera que construir.
        const home = [...g.opCorridor(op)].find(c => T.free(g, c) && g.owner[c] === es && g.economy(es).seen[c] === 1 && hexDist(c, C) > 3);
        T.ok(home !== undefined, 'casilla en la red');
        const tk = T.army(g, es, home, 0, 4, 0);
        g.assignArmy(tk, op.id);
        g.opLaunch(op);
        const nat = g.nations[es];
        nat.gold = 5000;
        // Sin oro en la operación.
        let res = g.opLogistics(op);
        T.eq([res.repaired, res.built, res.cost, nat.gold], [0, 0, 0, 5000], 'sin oro no gasta');
        T.ok(/oro/.test(res.why), `dice por qué (${res.why})`);
        g.executeOp(op);
        T.ok(g.logs.some(l => l.msg.includes('Logística') && l.msg.includes('oro')), 'el parte lo dice');
        // Sin oro en el tesoro.
        op.workPool = 500; nat.gold = 0;
        res = g.opLogistics(op);
        T.eq([res.cost, op.workPool, nat.gold], [0, 500, 0], 'sin tesoro no gasta');
        T.ok(/tesoro/.test(res.why), `dice por qué (${res.why})`);
        // Con un enemigo al lado de la obra.
        nat.gold = 5000;
        const nb = [0, 1, 2, 3, 4, 5].map(d => G.nb[C * 6 + d]).find(j => j >= 0 && isLand(j) && !g.armyAt[j]);
        const foe = g.settle(g.newArmy(fr, nb, { infantry: 1, tank: 0, artillery: 0 }, 0));
        const tally = { notes: [] };
        res = g.opLogistics(op, tally);
        T.eq([res.repaired, res.cost, nat.gold, op.workPool], [0, 0, 5000, 500], 'con el enemigo al lado no gasta');
        T.ok(/enemigo/.test(res.why) && tally.notes.some(s => s.includes('enemigo')), `y lo dice (${res.why})`);
        // No se queda bloqueada: cuando el enemigo se va, repara.
        g.removeArmy(foe);
        T.ok(g.opLogistics(op).repaired > 0, 'sin enemigo, repara');
        return true;
    }],
    ['D3 · bolsas que se van o mueren salen de la lista', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); g.declareWar(es, fr);
        const [S, O] = T.straight(g, es, 10, { m: 1, supply: true });
        g.owner[O] = fr; g.legal[O] = fr; g.version++;
        const op = g.createOp(es, 'ofensiva', [S, O], { doctrine: 'lanza' });
        const tk = T.army(g, es, S, 0, 4, 0);
        g.assignArmy(tk, op.id);
        g.opLaunch(op);
        const pts = T.samples(S, O).filter(c => g.opAlong(op, c) >= 3 && CITY_OF[c] < 0 && !g.armyAt[c]);
        const [P1, P2, P3, P4] = pts;
        const foes = [P1, P2, P3].map(c => g.settle(g.newArmy(fr, c, { infantry: 1, tank: 0, artillery: 0 }, 0)));
        op.pockets = [P1, P2, P3, P4];
        g.opPockets(op);
        T.eq(op.pockets, [P1, P2, P3], 'fuera la casilla sin enemigo');
        g.removeArmy(foes[0]);   // muere
        const away = [...g.nearCells(P2, 12).keys()].find(c => isLand(c) && !g.armyAt[c] && !g.opCorridor(op).has(c));
        g.armyAt[P2] = 0; foes[1].cell = away; g.settle(foes[1]);   // se va
        g.changeOwner(foes[2], es);   // se rinde
        g.opPockets(op);
        T.eq(op.pockets, [], 'las que mueren, se van o se rinden, fuera');
        // Y en el paso de la operación.
        op.pockets = [P4];
        T.turns(g, es, 1);
        T.ok(!op.pockets.includes(P4), 'el turno las limpia');
        return true;
    }],
    ['D3 · guardar y cargar a mitad conserva escalones, bolsas, guarniciones y fondo de obras', () => {
        const { g, es, X, b, op } = T.siege();
        T.turns(g, es, 1);
        T.ok(op.garrisons.includes(X), 'guarnición anotada');
        const P = [...g.nearCells(X, 3).keys()].find(c => isLand(c) && !g.armyAt[c] && CITY_OF[c] < 0);
        g.settle(g.newArmy(T.nation('fr'), P, { infantry: 1, tank: 0, artillery: 0 }, 0));
        op.pockets.push(P);
        op.workPool = 123;
        const data = JSON.parse(JSON.stringify(g.serialize()));
        let h = GameEngine.load(JSON.parse(JSON.stringify(data)));
        const ho = h.ops.get(op.id), all = o => [o.echelon, o.pockets, o.garrisons, o.workPool, o.logistics, o.doctrine];
        T.eq(all(ho), all(op), 'se conserva');
        // Lo que no vale, a cero (o al tope); las de antes, sin fondo.
        for (const [v, w] of [['x', 0], [-5, 0], [null, 0], [1e12, 1e7]]) {
            const bad = JSON.parse(JSON.stringify(data));
            for (const o of bad.ops) if (o.id === op.id) o.workPool = v;
            T.eq(GameEngine.load(bad).ops.get(op.id).workPool, w, `fondo ${v}`);
        }
        const older = JSON.parse(JSON.stringify(data));
        for (const o of older.ops) delete o.workPool;
        T.eq(GameEngine.load(older).ops.get(op.id).workPool, 0, 'las de antes, sin fondo');
        // La partida cargada sigue: el seguimiento releva la guarnición.
        let relieved = false;
        for (let t = 0; t < 4 && !relieved; t++) { T.turns(h, es, 1); relieved = h.armyOn(X)?.op === op.id; }
        T.ok(relieved, 'tras cargar, el seguimiento releva la guarnición');
        T.ok(h.armies.has(b.id) || h.armyOn(X).units.infantry >= 8, 'con su tropa');
        return true;
    }],
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
