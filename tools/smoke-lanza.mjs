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
        // casillas por delante hasta otra provincia, y el seguimiento `b` (`follow` infanterías) a 2 casillas por
        // detrás: { g, es, X, a, b, op }.
        siege(follow = 6) {
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
            const b = T.army(g, es, back, follow, 0, 0);
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
        // Frente amplio estrecho (3 casillas a cada lado) por una flecha recta de `len` casillas sin ciudades en el pasillo;
        // lo que queda a 3 o más a lo largo de la flecha pasa a Francia. `n` ejércitos junto a la salida: los primeros con
        // `units` y, si son 3 o más, el último con `last` (el más lento, al seguimiento). Ya lanzada: { g, es, fr, op, xs }.
        wide(n, { units = [0, 4, 0], last = [4, 0, 0], len = 14 } = {}) {
            const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
            g.start(es); g.declareWar(es, fr);
            let op = null;
            for (let skip = 0; !op; skip++) {
                const [S, O] = T.straight(g, es, len, { m: 3, skip });
                const o = g.createOp(es, 'ofensiva', [S, O], { doctrine: 'amplio', width: 'estrecha', noCap: true });
                if ([...g.opCorridor(o)].some(c => CITY_OF[c] >= 0)) { g.endOp(o); continue; }
                op = o;
            }
            for (const c of g.opCorridor(op)) if (isLand(c) && g.opAlong(op, c) >= 3) { g.owner[c] = fr; g.legal[c] = fr; }
            g.version++;
            const cs = T.cellsAt(g, es, op.cells[0], [0, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2].slice(0, n));
            const xs = cs.map((c, k) => T.army(g, es, c, ...(n >= 3 && k === n - 1 ? last : units)));
            for (const a of xs) g.assignArmy(a, op.id);
            g.opLaunch(op);
            return { g, es, fr, op, xs };
        },
        // Partida con Portugal de jugador y España (IA) en guerra con Francia, sin ejércitos de ninguna de las dos: el plan
        // de ataque de la IA, { g, es, fr, S: salida, O: objetivo }.
        aiFront() {
            const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
            g.start(T.nation('pt')); g.declareWar(es, fr);
            for (const a of [...g.armies.values()]) if (a.owner === es || a.owner === fr) g.removeArmy(a);
            const plan = g.frontPlan(es, fr);
            T.ok(plan?.attack, 'plan de ataque');
            return { g, es, fr, S: plan.attack[0], O: plan.attack[1] };
        },
        // Flecha de `len` casillas por la meseta, de cerca de Madrid hacia el este (para las capturas): [salida, objetivo].
        meseta(g, es, len) {
            const mad = g.nations[es].capitalCell;
            const S = [...g.nearCells(mad, 3)].filter(([c, d]) => d === 3 && isLand(c) && T.free(g, c)).sort((x, y) => G.cx[y[0]] - G.cx[x[0]])[0][0];
            const east = c => (G.cx[c] - G.cx[S]) - 2 * Math.abs(G.cy[c] - G.cy[S]);
            const O = [...g.nearCells(S, len)].filter(([c, d]) => d === len && isLand(c) && CITY_OF[c] < 0).sort((x, y) => east(y[0]) - east(x[0]))[0][0];
            return [S, O];
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
        T.ok(g.logs.some(l => l.msg.includes('no puede dejar guarnición') && l.msg.includes('se queda hasta que caiga')), 'y el parte lo dice');
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
        T.eq(g.opEchelon(op, relieved), 'seguimiento', 'en el seguimiento');
        T.ok(g.logs.some(l => l.msg.includes('releva la guarnición')), 'el parte lo dice');
        if (countUnits(relieved.units) > 2) T.turns(g, es, 1);   // sin movimiento al llegar: sale el turno siguiente
        // La guarnición, ya de la operación, mantiene el asedio hasta que cae.
        const keep = g.armyOn(X);
        T.ok(keep?.op === op.id && countUnits(keep.units) === 2, 'queda la guarnición en la ciudad');
        for (let t = 0; t < 4 && g.sieges.has(X); t++) {
            g.beginNationTurn(es);
            if (!g.sieges.has(X)) break;
            T.turns(g, es, 1);
            T.eq(g.armyOn(X)?.id, keep.id, 'la guarnición no se va mientras dura el asedio');
        }
        T.ok(!g.sieges.has(X) && g.owner[X] === es && g.ops.has(op.id), 'el asedio termina: la ciudad es suya');
        T.turns(g, es, 1);
        T.eq(op.garrisons, [], 'y sale de la lista');
        T.ok(g.logs.some(l => l.msg.includes(`${g.placeName(X)} ya es tuya: su guarnición sigue con el seguimiento`)), 'el parte la da por tomada');
        T.ok(!g.logs.some(l => l.msg.includes(`Se pierde el asedio de ${g.placeName(X)}`)), 'y no dice que se pierde');
        T.ok([...g.armies.values()].some(x => x.op === op.id && x.units.infantry > 0 && g.opEchelon(op, x) === 'seguimiento'), 'la guarnición vuelve al seguimiento');
        // Una ciudad que se pierde también sale.
        const lost = PROVINCES.find(p => g.owner[p.city] === T.nation('fr')).city;
        op.garrisons.push(lost);
        T.turns(g, es, 1);
        T.ok(!op.garrisons.includes(lost), 'sin asedio, fuera de la lista');
        return true;
    }],
    ['D3 · el relevo deja la guarnición y sigue con el resto', () => {
        const { g, es, X, b, op } = T.siege();
        T.turns(g, es, 1);
        let rest = null;
        for (let t = 0; t < 5 && !rest; t++) {
            T.turns(g, es, 1);
            rest = [...g.armies.values()].find(x => x.op === op.id && x.cell !== X && g.opEchelon(op, x) === 'seguimiento' && x.units.infantry === 6);
        }
        const keep = g.armyOn(X);
        T.ok(keep && keep.owner === es && keep.op === op.id, 'la guarnición queda en la ciudad, en la operación');
        T.eq([keep.units.infantry, keep.units.tank], [2, 0], 'con 2 infanterías');
        T.ok(rest, 'el resto (6 infanterías) sale de la ciudad con el seguimiento');
        T.eq(g.sieges.get(X)?.by, es, 'el asedio sigue');
        T.ok(g.logs.some(l => l.msg.includes('deja 2 infanterías de guarnición en') && l.msg.includes('sigue con el resto')), 'el parte lo dice');
        // El resto sigue avanzando con el seguimiento.
        const along = g.opAlong(op, rest.cell);
        T.turns(g, es, 2);
        T.ok(!g.armies.has(rest.id) || g.opAlong(op, rest.cell) > along, 'y sigue adelante');
        T.eq(g.armyOn(X)?.id, keep.id, 'la guarnición no se mueve');
        return true;
    }],
    ['D3 · con enemigo al lado deja más guarnición, como mucho la mitad', () => {
        const { g, es, X, op } = T.siege(12), fr = T.nation('fr');
        T.turns(g, es, 1);
        const relief = { id: 0, owner: es, cell: X, units: { infantry: 14, tank: 0, artillery: 0, antiair: 0 } };
        T.eq(g.opGarrisonNeed(op, X, relief), { infantry: 2, tank: 0, artillery: 0, antiair: 0 }, 'sin enemigo, 2 infanterías');
        const nb = [0, 1, 2, 3, 4, 5].map(d => G.nb[X * 6 + d]).find(j => j >= 0 && isLand(j) && !g.armyAt[j] && g.opAlong(op, j) === 0);
        T.ok(nb !== undefined, 'vecina libre detrás de la ciudad');
        const foe = g.settle(g.newArmy(fr, nb, { infantry: 1, tank: 0, artillery: 0 }, 0));
        // Lo justo para que su defensa llegue a op.ratio contra el enemigo de al lado.
        const holds = u => { const f = g.combatFactors(fr, foe.units, nb, { id: 0, owner: es, units: u }, X, foe.id); return f.dfn >= f.atk * op.ratio; };
        let mid = null;
        for (let k = 1; k <= 40 && !mid; k++) {
            foe.units.infantry = k;
            const u = g.opGarrisonNeed(op, X, relief), n = countUnits(u);
            if (n > 2 && n < 7) mid = [k, u];
        }
        T.ok(mid, 'algún enemigo pide más de 2 y menos de la mitad');
        foe.units.infantry = mid[0];
        T.ok(holds(mid[1]), `llega a ${op.ratio} a 1 con ${countUnits(mid[1])}`);
        const less = { ...mid[1], infantry: mid[1].infantry - 1 };
        T.ok(!holds(less), 'y con una menos no llega');
        // Un enemigo enorme: como mucho, la mitad del relevo.
        foe.units.infantry = 400;
        T.eq(countUnits(g.opGarrisonNeed(op, X, relief)), 7, 'la mitad de 14');
        // En el juego: el relevo de 12 con el destacamento de 2 deja 7 y sigue con 7.
        let keep = null;
        for (let t = 0; t < 5 && !(keep && countUnits(keep.units) === 7); t++) { T.turns(g, es, 1); keep = g.armyOn(X); }
        T.ok(keep?.op === op.id && countUnits(keep.units) === 7, `deja 7 de guarnición (${keep && countUnits(keep.units)})`);
        T.ok([...g.armies.values()].some(x => x.op === op.id && x.cell !== X && x.units.infantry === 7), 'y sigue con 7');
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
        // No llega, pero llegaría cercada: cinco del seguimiento a 2 casillas ocupan las vecinas libres y la cercan, sin atacar.
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
        // Lo más grande que tomarían con ella cercada (el cerco divide su defensa por el factor de cercado).
        while (foe.units.infantry > 1 && g.opRingOdds(op, target, foe, xs) < op.ratio) foe.units.infantry--;
        T.ok(foe.units.infantry > 2 && g.opRingOdds(op, target, foe, xs) >= op.ratio, `cercada caería (${foe.units.infantry})`);
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
        T.ok(!h.armies.has(b.id) && [...h.armies.values()].filter(x => x.op === op.id).reduce((s, x) => s + x.units.infantry, 0) >= 8, 'con su tropa y la del destacamento');
        return true;
    }],
    ['D3 · una bolsa que ni cercada caería: la vigila uno, los demás siguen y el parte lo recuerda', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); g.declareWar(es, fr);
        const target = G.land.find(c => CELL_TERRAIN[c] === 'plain' && [...g.nearCells(c, 2).keys()].every(x => T.free(g, x) && g.owner[x] === es && CAPITAL_OF[x] < 0));
        g.owner[target] = fr; g.legal[target] = fr; g.version++;
        const foe = g.settle(g.newArmy(fr, target, { infantry: 400, tank: 0, artillery: 0 }, 0));
        const op = g.createOp(es, 'ofensiva', [T.cellsAt(g, es, target, [6])[0], target], { doctrine: 'lanza' });
        const xs = T.cellsAt(g, es, target, [2, 2, 2, 2, 2, 2]).map(c => T.army(g, es, c, 2, 0, 0));
        for (const x of xs) g.assignArmy(x, op.id);
        g.opLaunch(op);
        for (const x of xs) g.playerOpSet(op, `echelon:${x.id}`, 'seguimiento');
        op.pockets = [target];
        T.ok(g.opRingOdds(op, target, foe, xs) < op.ratio, 'ni cercada');
        const seen = new Set(g.motion), said = { notes: [], attacked: 0 };
        const hold = g.opPockets(op, undefined, said);
        T.eq(g.motion.filter(e => e.kind === 'battle' && !seen.has(e)).length, 0, 'no la ataca');
        const side = xs.filter(x => g.armies.has(x.id) && hexDist(x.cell, target) === 1);
        T.eq(side.length, 1, 'uno solo se pone a su lado');
        T.eq(xs.filter(x => g.armies.has(x.id) && hexDist(x.cell, target) === 2).length, 5, 'los demás no van a cercarla');
        T.ok([...hold].every(id => id === side[0].id), 'solo él queda retenido');
        T.eq(op.pockets, [target], 'sigue en la lista');
        T.ok(said.notes.some(s => s.includes(`El seguimiento contiene una bolsa en ${g.placeName(target)}`)), `el parte lo dice: ${said.notes}`);
        // El turno siguiente la sigue vigilando el mismo, sin moverse.
        for (const x of g.armies.values()) if (x.owner === es) x.used = 0;
        T.eq([...g.opPockets(op)], [side[0].id], 'el mismo la vigila');
        // El parte lo recuerda cada 3 turnos, y no dos veces el mismo turno.
        const count = () => { const t = { notes: [], attacked: 0 }; g.opPockets(op, undefined, t); return t.notes.filter(s => s.includes('contiene una bolsa')).length; };
        T.eq(count(), 0, 'no lo repite el mismo turno');
        const seq = [];
        for (let k = 0; k < 6; k++) { g.turn++; seq.push(count()); }
        T.eq(seq, [0, 0, 1, 0, 0, 1], 'cada 3 turnos');
        // En la ficha.
        ui.setGame(g); ui.focusOp = op.id; ui.tab = 'mando'; ui.drawerOpen = true; ui.render();
        T.ok(document.querySelector('#drawer-body').textContent.includes('el seguimiento lo contiene'), 'la ficha lo dice');
        return true;
    }],
    ['D3 · una bolsa que ni cercada caería no detiene la ofensiva', () => {
        // La prueba P1 de la revisión: una masa de 400 en el eje que la punta rodea; el seguimiento no puede con ella.
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); g.declareWar(es, fr);
        const [S, O] = T.straight(g, es, 18, { m: 1 });
        g.owner[O] = fr; g.legal[O] = fr; g.version++;
        const op = g.createOp(es, 'ofensiva', [S, O], { doctrine: 'lanza' });
        const M = T.samples(S, O).sort((x, y) => Math.abs(g.opAlong(op, x) - 3) - Math.abs(g.opAlong(op, y) - 3))[0];
        g.owner[M] = fr; g.legal[M] = fr; g.version++;
        const foe = g.settle(g.newArmy(fr, M, { infantry: 400, tank: 0, artillery: 0 }, 0));
        const tk = T.army(g, es, S, 0, 8, 0), fs = T.cellsAt(g, es, S, [1, 1]).map(c => T.army(g, es, c, 6, 0, 0));
        for (const a of [tk, ...fs]) g.assignArmy(a, op.id);
        g.opLaunch(op);
        T.eq([tk, ...fs].map(a => g.opEchelon(op, a)), ['punta', 'seguimiento', 'seguimiento'], 'escalones');
        let tip = 0, back = 0, t = 0, guard = [];
        for (; t < 24 && g.ops.has(op.id); t++) {
            T.turns(g, es, 1);
            if (!g.ops.has(op.id)) break;
            const ms = g.opMembers(op), follow = ms.filter(a => g.opEchelon(op, a) === 'seguimiento');
            guard = follow.filter(a => hexDist(a.cell, M) === 1);
            for (const a of ms) {
                const x = g.opAlong(op, a.cell);
                if (g.opEchelon(op, a) === 'punta') tip = Math.max(tip, x); else back = Math.max(back, x);
            }
        }
        T.ok(g.armies.has(foe.id) && foe.cell === M && foe.units.infantry === 400, 'la bolsa sigue ahí, entera');
        T.eq(guard.length, 1, 'uno la vigila');
        T.ok(g.owner[O] === es || tip >= 15, `la punta sigue hasta el objetivo (${tip.toFixed(1)}, ${t} turnos)`);
        T.ok(back >= 8, `el seguimiento deja atrás la bolsa (${back.toFixed(1)})`);
        T.ok(g.logs.some(l => l.msg.includes(`El seguimiento contiene una bolsa en ${g.placeName(M)}`)), 'el parte lo dice');
        return true;
    }],
    ['D3 · si nadie releva la guarnición, al caer la ciudad vuelve al seguimiento', () => {
        const { g, es, X, b, op } = T.siege();
        g.setOrder(b, { kind: 'hold' });   // el seguimiento no llega
        T.turns(g, es, 1);
        const gar = g.armyOn(X);
        T.ok(gar && !gar.op && op.garrisons.includes(X), 'la punta deja guarnición');
        for (let t = 0; t < 5 && g.sieges.has(X); t++) g.beginNationTurn(es);
        T.ok(!g.sieges.has(X) && g.owner[X] === es && g.ops.has(op.id), 'la ciudad cae');
        T.eq(gar.op, 0, 'aún fuera de la operación');
        T.turns(g, es, 1);
        T.ok(g.armies.has(gar.id) && gar.op === op.id && g.opEchelon(op, gar) === 'seguimiento', 'vuelve a la operación, en el seguimiento');
        T.eq(op.garrisons, [], 'y sale de la lista');
        T.ok(g.logs.some(l => l.msg.includes(`${g.placeName(X)} ya es tuya: su guarnición vuelve a la operación con el seguimiento`)), 'el parte lo dice');
        T.ok(!g.logs.some(l => l.msg.includes('Se pierde el asedio')), 'y no dice que se pierde');
        return true;
    }],
    ['D3 · quien mantiene un asedio no es un ejército libre', () => {
        const { g, es, X, b, op } = T.siege();
        g.setOrder(b, { kind: 'hold' });
        T.turns(g, es, 1);
        const gar = g.armyOn(X);
        T.ok(gar && !gar.op && g.sieges.get(X)?.by === es && countUnits(gar.units) === 2, 'una guarnición de 2 mantiene el asedio');
        const off = g.createOp(es, 'ofensiva', [T.cellsAt(g, es, X, [1])[0], op.cells[1]], { noCap: true });
        const line = g.createOp(es, 'defensa', [X], { noCap: true });
        T.ok(!g.offensiveFree(off).includes(gar), 'no se la lleva una ofensiva nueva');
        T.ok(!g.nearbyFree(line, 3).includes(gar), 'ni «Añadir los libres»');
        g.shareForces(es, { free: true });
        T.eq(gar.op, 0, 'ni el reparto de fuerzas');
        // Sin el asedio sí sería libre.
        const sg = g.sieges.get(X);
        g.sieges.delete(X);
        T.ok(g.offensiveFree(off).includes(gar) && g.nearbyFree(line, 3).includes(gar), 'sin el asedio, sí');
        g.sieges.set(X, sg);
        return true;
    }],
    ['D3 · cambiar la doctrina o redibujar limpia bolsas y guarniciones', () => {
        const { g, es, X, a, b, op } = T.siege(), fr = T.nation('fr');
        g.setOrder(b, { kind: 'hold' });
        T.turns(g, es, 1);
        g.setOrder(a, { kind: 'hold' });   // la punta no toma el objetivo mientras tanto
        T.ok(op.garrisons.includes(X), 'guarnición anotada');
        const P = [...g.opCorridor(op)].find(c => isLand(c) && !g.armyAt[c] && CITY_OF[c] < 0 && g.opAlong(op, c) > 1);
        g.settle(g.newArmy(fr, P, { infantry: 1, tank: 0, artillery: 0 }, 0));
        op.pockets.push(P);
        g.playerOpSet(op, 'doctrine', 'asalto');
        T.eq(op.pockets, [], 'el asalto, sin seguimiento, olvida las bolsas');
        T.eq(op.garrisons, [X], 'la guarnición sigue mientras dure el asedio');
        for (let t = 0; t < 5 && g.sieges.has(X); t++) g.beginNationTurn(es);
        T.ok(!g.sieges.has(X) && g.owner[X] === es, 'la ciudad cae');
        T.turns(g, es, 1);
        T.eq(op.garrisons, [], 'también en el asalto sale de la lista');
        T.ok(g.logs.some(l => l.msg.includes(`${g.placeName(X)} ya es tuya`)), 'y el parte lo dice');
        // Redibujar: fuera las bolsas que quedan fuera del nuevo pasillo.
        const [S, O] = T.straight(g, es, 10, { m: 1 });
        g.owner[O] = fr; g.legal[O] = fr; g.version++;
        const op2 = g.createOp(es, 'ofensiva', [S, O], { doctrine: 'lanza', noCap: true });
        const pts = T.samples(S, O).sort((x, y) => g.opAlong(op2, x) - g.opAlong(op2, y));
        const near = pts.find(c => g.opAlong(op2, c) >= 1 && !g.armyAt[c]), far = [...pts].reverse().find(c => c !== O && !g.armyAt[c]);
        for (const c of [near, far]) g.settle(g.newArmy(fr, c, { infantry: 1, tank: 0, artillery: 0 }, 0));
        op2.pockets = [near, far];
        const mid = pts.find(c => Math.abs(g.opAlong(op2, c) - 3) < 0.6 && !g.armyAt[c]);
        g.owner[mid] = fr; g.legal[mid] = fr; g.version++;
        T.ok(g.playerRedrawOp(op2, [S, mid]), 'redibuja');
        T.eq(op2.pockets, [near], 'la del nuevo pasillo se queda; la otra, fuera');
        return true;
    }],
    ['D3 · logística no rehace un tramo roto: lo repara, y la autovía sigue siendo autovía', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); g.declareWar(es, fr);
        // La punta, fuera del pasillo, en una casilla propia sin carreteras alrededor.
        let op = null, P, O;
        for (let skip = 0; !op && skip < 40; skip++) {
            const [S, O1] = T.straight(g, es, 10, { m: 1, supply: true, skip });
            const o = g.createOp(es, 'ofensiva', [S, O1], { doctrine: 'lanza', noCap: true }), lane = g.opCorridor(o);
            P = G.land.find(c => g.owner[c] === es && T.free(g, c) && !lane.has(c) && Math.abs(g.opPerp(o, c)) >= 4.5 && Math.abs(g.opPerp(o, c)) <= 7
                && g.opAlong(o, c) > 3 && g.opAlong(o, c) < 7 && [...g.nearCells(c, 2).keys()].every(x => isLand(x) && g.owner[x] === es && g.inSupply(es, x)));
            if (P === undefined) g.endOp(o); else { op = o; O = O1; }
        }
        T.ok(op, 'casilla al lado del pasillo');
        g.owner[O] = fr; g.legal[O] = fr; g.version++;
        for (const c of g.nearCells(P, 2).keys()) for (let d = 0; d < 6; d++) { const j = G.nb[c * 6 + d]; if (j >= 0) { g.road[c * 6 + d] = 0; g.road[j * 6 + (d + 3) % 6] = 0; g.broken[c * 6 + d] = 0; g.broken[j * 6 + (d + 3) % 6] = 0; } }
        g.roadVersion++;
        const tk = T.army(g, es, P, 0, 4, 0);
        g.assignArmy(tk, op.id);
        g.opLaunch(op);
        // El último tramo del camino hacia la punta, una autovía rota.
        const net = g.economy(es).seen;
        T.ok(!net[P], 'la punta, fuera de la red');
        const plan = g.planRoad(es, P, x => net[x] === 1, 1), u = plan.path[1], v = plan.path[0], d = G.dirTo(u, v);
        g.broken[u * 6 + d] = 2; g.broken[v * 6 + (d + 3) % 6] = 2; g.roadVersion++;
        op.workPool = 3000; g.nations[es].gold = 10000;
        const res = g.opLogistics(op);
        T.ok(res.built > 0 && res.repaired === 1, `construye hasta el tramo roto y lo repara (${res.built}, ${res.repaired})`);
        T.eq([g.road[u * 6 + d], g.broken[u * 6 + d], g.roadWork.get(edgeKey(u, d))?.cls], [0, 2, 2], 'no lo rehace: en obra de reparación');
        for (let t = 0; t < g.rules(es).fortTurns; t++) g.beginNationTurn(es);
        T.eq([g.road[u * 6 + d], g.broken[u * 6 + d]], [2, 0], 'reparado, vuelve a ser autovía');
        T.ok(g.economy(es).seen[P] === 1, 'y la punta queda unida a la red');
        return true;
    }],
    ['D4 · los miembros se reparten por franjas y ocupan a lo ancho', () => {
        const { g, es, op, xs } = T.wide(4);
        const [tk1, tk2, tk3, inf] = xs;
        T.eq(xs.map(a => g.opEchelon(op, a)), ['punta', 'punta', 'punta', 'seguimiento'], 'el más lento, al seguimiento; los demás, al frente');
        const lanes = g.opLanes(op), lane = g.opCorridor(op);
        T.eq(lanes.length, 3, 'tres franjas, una por miembro del frente');
        T.eq(lanes.map(l => l.member).sort(), [tk1, tk2, tk3].map(a => a.id).sort(), 'cada una con su miembro');
        T.ok(lanes.every(l => [...l.cells].some(isLand) && !l.stalled), 'con tierra y sin detenerse');
        T.eq(lanes.reduce((s, l) => s + l.cells.size, 0), lane.size, 'sin repetir casillas');
        T.ok([...lane].every(c => lanes.some(l => l.cells.has(c))), 'y cubren el pasillo');
        const mid = l => { const p = [...l.cells].map(c => g.opPerp(op, c)); return p.reduce((s, x) => s + x, 0) / p.length; };
        T.ok(mid(lanes[0]) < mid(lanes[1]) && mid(lanes[1]) < mid(lanes[2]), 'ordenadas a lo ancho');
        const perpOf = id => g.opPerp(op, g.armies.get(id).cell);
        T.ok(perpOf(lanes[0].member) <= perpOf(lanes[1].member) && perpOf(lanes[1].member) <= perpOf(lanes[2].member), 'cada miembro a la franja de su lado');
        const ids = [...op.lanes];
        const spread = [];
        for (let t = 0; t < 7 && g.ops.has(op.id); t++) {
            T.turns(g, es, 1);
            const al = [tk1, tk2, tk3].filter(a => g.armies.has(a.id)).map(a => g.opAlong(op, a.cell));
            spread.push(Math.max(...al) - Math.min(...al));
            T.ok(spread[t] <= OP_LEAD + 1e-9, `nadie más de ${OP_LEAD} por delante del más atrasado (${spread.map(x => x.toFixed(2))})`);
            T.eq(op.lanes, ids, 'cada uno sigue en su franja');
        }
        // Ocupa a lo ancho: casillas tomadas en las tres franjas.
        const taken = lanes.map(l => [...l.cells].filter(c => isLand(c) && g.owner[c] === es && g.opAlong(op, c) >= 3).length);
        T.ok(taken.every(n => n >= 2), `toma casillas en cada franja (${taken})`);
        T.ok([tk1, tk2, tk3].every((a, k) => g.opLanes(op).find(l => l.member === a.id).cells.has(a.cell)), 'cada uno por la suya');
        T.ok(g.opAlong(op, inf.cell) > 0.5, 'el seguimiento también avanza');
        // Se guardan y se cargan.
        const h = GameEngine.load(JSON.parse(JSON.stringify(g.serialize())));
        T.eq(h.ops.get(op.id).lanes, op.lanes, 'las franjas se guardan');
        const bad = JSON.parse(JSON.stringify(g.serialize()));
        for (const o of bad.ops) if (o.id === op.id) o.lanes = ['x', -3, tk1.id, tk1.id];
        T.eq(GameEngine.load(bad).ops.get(op.id).lanes, [tk1.id], 'y se validan');
        return true;
    }],
    ['D4 · evita la masa y ataca la guarnición débil', () => {
        // Se aparta a la franja vecina: masa en la del centro.
        let { g, es, fr, op, xs } = T.wide(4);
        let lanes = g.opLanes(op);
        const at = (l, x) => [...l.cells].filter(c => T.free(g, c) && g.owner[c] === fr && Math.abs(g.opPerp(op, c) - l.mid) < 0.6).sort((p, q) => Math.abs(g.opAlong(op, p) - x) - Math.abs(g.opAlong(op, q) - x))[0];
        const M = at(lanes[1], 5);
        const mass = g.settle(g.newArmy(fr, M, { infantry: 400, tank: 0, artillery: 0 }, 0));
        const mover = g.armies.get(lanes[1].member);
        lanes = g.opLanes(op);
        T.ok(lanes[1].mass === M && lanes[1].shift >= 0 && !lanes[1].stalled, 'la franja del centro ve la masa y se aparta');
        const seen = new Set(g.motion);
        for (let t = 0; t < 8 && g.ops.has(op.id); t++) T.turns(g, es, 1);
        T.eq(g.motion.filter(e => e.kind === 'battle' && !seen.has(e) && e.cell === M).length, 0, 'no ataca la masa');
        T.ok(g.armies.has(mass.id) && mass.units.infantry === 400, 'la masa sigue entera');
        T.ok(hexDist(mover.cell, M) > 1 || !g.armies.has(mover.id), 'no se queda a su lado');
        T.ok(g.logs.some(l => l.msg.includes('Masa enemiga en la franja 2') && l.msg.includes('se aparta a la franja')), 'el parte lo dice');
        T.ok(op.pockets.includes(M) || g.opAlong(op, M) > Math.min(...xs.filter(a => g.armies.has(a.id) && g.opEchelon(op, a) === 'punta').map(a => g.opAlong(op, a.cell))), 'la que deja atrás, bolsa');
        // Sin franja vecina se detiene.
        ({ g, es, fr, op, xs } = T.wide(1));
        lanes = g.opLanes(op);
        T.eq(lanes.length, 1, 'una franja');
        const M2 = at(lanes[0], 4), a = xs[0];
        g.settle(g.newArmy(fr, M2, { infantry: 400, tank: 0, artillery: 0 }, 0));
        T.ok(g.opLanes(op)[0].stalled, 'se detiene');
        const seen2 = new Set(g.motion);
        for (let t = 0; t < 4; t++) T.turns(g, es, 1);
        T.eq(g.motion.filter(e => e.kind === 'battle' && !seen2.has(e)).length, 0, 'sin atacar');
        T.ok(g.opAlong(op, a.cell) < g.opAlong(op, M2) - 1, 'sin pasar de la masa');
        T.ok(g.logs.some(l => l.msg.includes('Masa enemiga en la franja 1: el frente se detiene ahí')), 'el parte lo dice');
        // Ataca una guarnición débil solo con op.ratio + 0.5.
        const strike = off => {
            const { g, es, fr, op, xs } = T.wide(1), a = xs[0];
            const W = [...g.nearCells(a.cell, 1)].find(([c, d]) => d === 1 && T.free(g, c) && g.opCorridor(op).has(c))[0];
            g.owner[W] = fr; g.legal[W] = fr; g.version++;
            const w = g.settle(g.newArmy(fr, W, { infantry: 3, tank: 0, artillery: 0 }, 0));
            const from = g.reach(es, a.cell, g.mp(a), true).attacks.get(W);
            const j = g.jointFactors(es, [{ units: a.units, from, id: a.id }], w, W);
            op.ratio = j.atk / j.dfn - off;
            const seen = new Set(g.motion);
            g.executeOp(op);
            return g.motion.some(e => e.kind === 'battle' && !seen.has(e) && e.cell === W);
        };
        T.ok(!strike(0.3), 'con op.ratio no basta');
        T.ok(strike(0.6), 'con op.ratio + 0,5, ataca');
        // Con el vecino de franja: ninguno solo llega, juntos sí.
        ({ g, es, fr, op, xs } = T.wide(4, { units: [2, 0, 0], last: [1, 0, 0] }));
        lanes = g.opLanes(op);
        const [l0, l1] = [lanes[0], lanes[1]].map(l => g.armies.get(l.member));
        const W = [...g.nearCells(l0.cell, 1).keys()].find(c => hexDist(c, l1.cell) === 1 && c !== l0.cell && c !== l1.cell && T.free(g, c));
        T.ok(W !== undefined, 'casilla al lado de los dos');
        g.owner[W] = fr; g.legal[W] = fr; g.version++;
        const w = g.settle(g.newArmy(fr, W, { infantry: 2, tank: 0, artillery: 0 }, 0));
        const ratio = list => { const j = g.jointFactors(es, list.map(x => ({ units: x.units, from: g.reach(es, x.cell, g.mp(x), true).attacks.get(W), id: x.id })), w, W); return j.atk / j.dfn; };
        const solo = Math.max(ratio([l0]), ratio([l1])), both = ratio([l0, l1]);
        T.ok(both > solo + 0.2, `juntos pueden más (${solo.toFixed(2)} / ${both.toFixed(2)})`);
        op.ratio = Math.min(solo + 0.1 - 0.5, both - 0.5 - 0.05);
        T.ok(solo < op.ratio + 0.5 && both >= op.ratio + 0.5, 'umbral entre los dos');
        g.setOrder(xs[3], { kind: 'hold' });   // el seguimiento, quieto: ataca con op.ratio
        const seen3 = new Set(g.motion);
        g.executeOp(op);
        const bs = g.motion.filter(e => e.kind === 'battle' && !seen3.has(e) && e.cell === W);
        T.eq(bs.length, 1, 'un ataque');
        T.eq(bs[0].joint.slice().sort(), [l0.id, l1.id].sort(), 'con el vecino de franja');
        return true;
    }],
    ['D4 · no termina al tomar el objetivo si quedan provincias en el pasillo; la del jugador, nunca sola', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); g.declareWar(es, fr);
        let X = -1, S = -1, O = -1;
        for (const p of PROVINCES) {
            if (g.owner[p.city] !== es || CAPITAL_OF[p.city] >= 0 || !p.cells.every(c => g.owner[c] === es)) continue;
            const ok = c => isLand(c) && T.free(g, c) && g.owner[c] === es && G.prov[c] !== p.id && CELL_TERRAIN[c] === 'plain';
            for (const [s, d] of g.nearCells(p.city, 3)) {
                if (d !== 3 || !ok(s)) continue;
                const o = [...g.nearCells(s, 2)].find(([c, k]) => k === 2 && ok(c) && hexDist(c, p.city) >= 3)?.[0];
                if (o !== undefined && T.clearRoute(g, es, [s, o], 1)) { X = p.city; S = s; O = o; break; }
            }
            if (X >= 0) break;
        }
        T.ok(X >= 0, 'ciudad cerca de la flecha');
        const P = PROVINCES[CITY_OF[X]];
        for (const c of P.cells) { const x = g.armyOn(c); if (x) g.removeArmy(x); g.owner[c] = fr; g.legal[c] = fr; }
        g.owner[O] = fr; g.legal[O] = fr; g.version++;
        const op = g.createOp(es, 'ofensiva', [S, O], { doctrine: 'amplio', width: 'estrecha' });
        T.ok(g.opCorridor(op).has(X), 'la ciudad, dentro del pasillo');
        const a = T.army(g, es, S, 8, 4, 0);
        g.assignArmy(a, op.id);
        g.opLaunch(op);
        T.eq(g.opWideLeft(op), [X], 'queda una provincia enemiga en el pasillo');
        let t = 0;
        for (; t < 6 && g.owner[O] !== es; t++) T.turns(g, es, 1);
        T.ok(g.owner[O] === es, 'toma el objetivo');
        g.executeOp(op);
        T.ok(g.ops.has(op.id), 'y no termina');
        T.ok(g.logs.some(l => l.msg.includes('quedan') && l.msg.includes(P.cityName)), 'el parte dice lo que queda');
        // Un asalto con el mismo objetivo lo tiene cumplido ya: el del jugador se queda, esperando sus órdenes.
        const op2 = g.createOp(es, 'ofensiva', [S, O], { noCap: true });
        g.executeOp(op2);
        T.ok(g.ops.has(op2.id) && op2.done.startsWith('objetivo cumplido'), 'el asalto del jugador no termina solo');
        T.ok(g.logs.some(l => l.msg.startsWith(op2.name) && l.msg.includes('esperan tus órdenes')), 'el parte dice que espera órdenes');
        // El de la IA, sí termina.
        const op3 = g.createOp(es, 'ofensiva', [S, O], { noCap: true });
        g.player = fr; g.executeOp(op3); g.player = es;
        T.ok(!g.ops.has(op3.id), 'el de la IA, sí');
        // Redibujarlo lo quita de cumplido; se guarda y se carga.
        g.playerRedrawOp(op2, [S, O]);
        T.eq(op2.done, '', 'al redibujarlo deja de estar cumplido');
        g.executeOp(op2);
        T.ok(op2.done, 'y lo vuelve a estar con el mismo objetivo');
        T.ok(GameEngine.load(JSON.parse(JSON.stringify(g.serialize()))).ops.get(op2.id).done === op2.done, 'se guarda');
        g.endOp(op2, 'terminada por orden tuya');
        // Toma la ciudad: la ofensiva cumple y sigue con sus ejércitos.
        for (t = 0; t < 14 && !op.done; t++) { g.beginNationTurn(es); T.turns(g, es, 1); }
        T.ok(g.owner[X] === es && !g.sieges.has(X), 'toma la ciudad');
        T.ok(g.ops.has(op.id) && op.done.includes('no quedan provincias enemigas en el pasillo'), 'objetivo cumplido, y no termina');
        T.ok(g.opMembers(op).length >= 1, 'sus ejércitos siguen en ella');
        T.ok(g.logs.some(l => l.msg.includes('no quedan provincias enemigas en el pasillo')), 'el parte lo dice');
        return true;
    }],
    ['D4 · un solo miembro y más miembros que casillas de ancho', () => {
        // Un solo miembro: una franja, todo el pasillo; sin seguimiento.
        let { g, es, op, xs } = T.wide(1);
        let lanes = g.opLanes(op);
        T.eq([lanes.length, lanes[0].member, lanes[0].cells.size], [1, xs[0].id, g.opCorridor(op).size], 'una franja con todo el pasillo');
        T.eq(g.opEchelon(op, xs[0]), 'punta', 'en el frente');
        const O = op.cells[op.cells.length - 1];
        for (let t = 0; t < 12 && !op.done; t++) T.turns(g, es, 1);
        T.ok(g.ops.has(op.id) && op.done && g.owner[O] === es, 'llega y espera órdenes');
        // Dos: los dos en el frente.
        ({ g, es, op, xs } = T.wide(2));
        T.eq([xs.map(a => g.opEchelon(op, a)), g.opLanes(op).length], [['punta', 'punta'], 2], 'con menos de 3, todos en el frente');
        // Más miembros que casillas de ancho: tantas franjas como caben; los demás, al seguimiento.
        ({ g, es, op, xs } = T.wide(12));
        const R = g.opLaneWidth(op);
        lanes = g.opLanes(op);
        T.ok(lanes.length <= 2 * R + 1 && lanes.length >= 3, `franjas que caben (${lanes.length} de ${2 * R + 1})`);
        T.ok(lanes.every(l => [...l.cells].some(isLand)), 'todas con tierra');
        T.eq(new Set(lanes.map(l => l.member)).size, lanes.length, 'un miembro distinto en cada una');
        const front = xs.filter(a => g.opEchelon(op, a) === 'punta');
        T.eq(front.length, lanes.length, 'los del frente, uno por franja');
        T.ok(xs.length - front.length >= 4, 'el resto, al seguimiento');
        for (let t = 0; t < 4 && g.ops.has(op.id); t++) T.turns(g, es, 1);
        // Los atascados (sin paso entre tantos) no marcan el paso hasta alcanzar a los demás.
        const alive = front.filter(a => g.armies.has(a.id) && a.op === op.id && (op.wideStall?.get(a.id) ?? 0) < OP_STALL);
        T.ok(alive.length >= front.length - 2, `casi todos marcan el paso (${alive.length} de ${front.length})`);
        const al = alive.map(a => g.opAlong(op, a.cell));
        T.ok(Math.max(...al) - Math.min(...al) <= OP_LEAD + 1e-9, 'avanzan juntos');
        // Si se va un miembro del frente, las franjas se rehacen.
        const gone = g.armies.get(g.opLanes(op)[0].member);
        g.removeArmy(gone);
        const after = g.opLanes(op);
        T.ok(after.every(l => l.member && g.armies.get(l.member)?.op === op.id), 'sin franjas vacías');
        T.ok(!after.some(l => l.member === gone.id), 'sin el que se fue');
        return true;
    }],
    ['D4 · con el objetivo tomado, avisa a los 6 turnos sin tomar provincias (la de la IA termina)', () => {
        // Una ciudad del pasillo demasiado defendida para el frente amplio: el objetivo ya es suyo y no toma nada más.
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); g.declareWar(es, fr);
        let X = -1, S = -1, O = -1;
        for (const p of PROVINCES) {
            if (g.owner[p.city] !== es || CAPITAL_OF[p.city] >= 0 || !p.cells.every(c => g.owner[c] === es)) continue;
            const ok = c => isLand(c) && T.free(g, c) && g.owner[c] === es && G.prov[c] !== p.id && CELL_TERRAIN[c] === 'plain';
            for (const [s, d] of g.nearCells(p.city, 3)) {
                if (d !== 3 || !ok(s)) continue;
                const o = [...g.nearCells(s, 2)].find(([c, k]) => k === 2 && ok(c) && hexDist(c, p.city) >= 3)?.[0];
                if (o !== undefined && T.clearRoute(g, es, [s, o], 1)) { X = p.city; S = s; O = o; break; }
            }
            if (X >= 0) break;
        }
        T.ok(X >= 0, 'ciudad cerca de la flecha');
        const P = PROVINCES[CITY_OF[X]];
        for (const c of P.cells) { const x = g.armyOn(c); if (x) g.removeArmy(x); g.owner[c] = fr; g.legal[c] = fr; }
        g.owner[O] = fr; g.legal[O] = fr; g.version++;
        T.army(g, fr, X, 80, 0, 0);   // demasiado para el frente
        const op = g.createOp(es, 'ofensiva', [S, O], { doctrine: 'amplio', width: 'estrecha' });
        g.assignArmy(T.army(g, es, S, 8, 4, 0), op.id);
        g.opLaunch(op);
        T.eq(g.opWideLeft(op), [X], 'queda una provincia en el pasillo');
        let t = 0;
        for (; t < 8 && g.owner[O] !== es; t++) T.turns(g, es, 1);
        T.ok(g.owner[O] === es && g.ops.has(op.id), 'toma el objetivo y sigue');
        // Guardar y cargar no pierde la cuenta.
        T.turns(g, es, 2);
        T.ok(op.wideIdle >= 1 && op.wideIdle < 6 && op.wideLast === 1, `cuenta los turnos sin tomar nada (${op.wideIdle})`);
        const data = JSON.parse(JSON.stringify(g.serialize())), h = GameEngine.load(JSON.parse(JSON.stringify(data)));
        T.eq([h.ops.get(op.id).wideIdle, h.ops.get(op.id).wideLast], [op.wideIdle, op.wideLast], 'la cuenta se guarda');
        for (const o of data.ops) { delete o.wideIdle; delete o.wideLast; }
        const k = GameEngine.load(data).ops.get(op.id);
        T.eq([k.wideIdle, k.wideLast], [0, -1], 'las viejas, sin cuenta');
        for (t = 0; t < 8 && op.wideIdle < OP_WIDE_IDLE; t++) T.turns(g, es, 1);
        T.ok(g.ops.has(op.id) && op.wideIdle >= OP_WIDE_IDLE, 'la del jugador no termina: sigue esperando');
        T.ok(g.owner[X] === fr, 'sin tomar la ciudad');
        T.ok(g.logs.some(l => /queda 1 ciudad demasiado defendida en el pasillo/i.test(l.msg)), 'el parte dice por qué');
        g.player = fr; T.turns(g, es, 1); g.player = es;
        T.ok(!g.ops.has(op.id), 'la de la IA, termina');
        // Tomar una provincia pone la cuenta a cero.
        const op2 = g.createOp(es, 'ofensiva', [S, O], { doctrine: 'amplio', width: 'estrecha' });
        Object.assign(op2, { phase: 'avance', wideIdle: 4, wideLast: 2 });
        g.executeOp(op2);
        T.eq([op2.wideIdle, op2.wideLast], [0, 1], 'con una provincia menos, a cero');
        return true;
    }],
    ['D5 · la IA elige punta con tanques contra un enemigo sin masas', () => {
        const { g, es, fr, S, O } = T.aiFront();
        T.ok(CAPITAL_OF[O] < 0 && !g.fort[O], 'objetivo ni capital ni fortificado');
        // Dos tercios del ataque, rápido (tanques); el enemigo, sin ejércitos.
        for (const [i, c] of T.cellsAt(g, es, S, [1, 1, 2]).entries()) T.army(g, es, c, i === 2 ? 12 : 0, i === 2 ? 0 : 8, 0);
        g.aiCommand(es);
        const op = g.opsOf(es).find(o => o.kind === 'ofensiva');
        T.ok(op, 'la IA crea la ofensiva');
        T.eq(g.opMembers(op).length, 3, 'con sus tres ejércitos');
        T.eq([op.doctrine, op.width, op.logistics], ['lanza', 'estrecha', 50], 'punta de lanza, con su logística');
        const s = g.suggestDoctrine(op);
        T.eq(s.key, 'lanza', 'la misma regla');
        T.ok(s.why.includes('rápid') && s.why.includes('masas'), `con su motivo (${s.why})`);
        // Con una masa enemiga mayor que la suya en el pasillo, ya no.
        const near = [...g.opCorridor(op)].find(c => isLand(c) && g.owner[c] === fr && T.free(g, c));
        T.army(g, fr, near, 60, 10, 0);
        T.eq(g.suggestDoctrine(op).key, 'asalto', 'contra una masa mayor, asalto');
        return true;
    }],
    ['D2 · al lanzar, los tanques de cada miembro forman la punta y el resto el seguimiento (IA)', () => {
        // España es de la IA (juega Portugal).
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(T.nation('pt')); g.declareWar(es, fr);
        const [S, O] = T.straight(g, es, 12, { m: 2 });
        g.owner[O] = fr; g.legal[O] = fr; g.version++;
        const op = g.createOp(es, 'ofensiva', [S, O], { doctrine: 'lanza', gold: 100 });
        const cs = T.cellsAt(g, es, S, [0, 1, 1]);
        const xs = [[8, 6, 2], [10, 4, 0], [12, 0, 3]].map(([i, t, r], k) => T.army(g, es, cs[k], i, t, r));
        for (const a of xs) g.assignArmy(a, op.id);
        const total = () => { const u = emptyUnits(); for (const a of g.armies.values()) if (a.owner === es && a.op === op.id) for (const k of UNIT_KEYS) u[k] += a.units[k]; return u; };
        const before = total();
        g.opLaunch(op);
        const ms = g.opMembers(op), tips = ms.filter(a => g.opEchelon(op, a) === 'punta'), rest = ms.filter(a => g.opEchelon(op, a) === 'seguimiento');
        T.eq(total(), before, 'no se pierde ni se gana nada');
        T.eq(tips.length, 2, 'una punta por cada miembro con tanques');
        T.ok(tips.every(a => a.units.tank > 0 && countUnits(a.units) === a.units.tank && g.opSpeedy(a)), 'solo tanques, rápidas');
        T.eq(tips.map(a => a.units.tank).sort(), [4, 6], 'los de cada uno');
        T.eq(rest.map(a => a.id).sort(), xs.map(a => a.id).sort(), 'los de siempre, en el seguimiento');
        T.ok(rest.every(a => !a.units.tank), 'sin tanques');
        T.ok(tips.every(a => g.armyAt[a.cell] === a.id && !xs.some(x => x.cell === a.cell) && hexDist(a.cell, xs.find(x => g.splitFrom.get(a.id)?.[0] === x.id)?.cell ?? a.cell) <= 2), 'cada una en su casilla, al lado');
        T.ok(tips.every(a => op.body.includes(a.id)), 'en el grueso');
        // La punta sale por delante; el seguimiento, a su paso.
        T.turns(g, es, 2);
        const al = list => Math.max(...list.filter(a => g.armies.has(a.id)).map(a => g.opAlong(op, a.cell)));
        T.ok(al(tips) > al(rest), `la punta va delante (${al(tips).toFixed(1)} y ${al(rest).toFixed(1)})`);
        return true;
    }],
    ['D2 · en una ofensiva del jugador no se parte ningún ejército', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); g.declareWar(es, fr);
        for (const a of [...g.armies.values()]) if (a.owner === es || a.owner === fr) g.removeArmy(a);
        const [S, O] = T.straight(g, es, 12, { m: 2 });
        g.owner[O] = fr; g.legal[O] = fr; g.version++;
        const op = g.createOp(es, 'ofensiva', [S, O], { doctrine: 'lanza' });
        const cs = T.cellsAt(g, es, S, [0, 1, 1]);
        const xs = [[8, 6, 2], [10, 4, 0], [0, 5, 0]].map(([i, t, r], k) => T.army(g, es, cs[k], i, t, r));
        for (const a of xs) g.assignArmy(a, op.id);
        const units = () => xs.map(a => JSON.stringify(a.units));
        const before = units(), n = g.armies.size;
        g.opLaunch(op);
        T.eq([g.armies.size, units()], [n, before], 'ni ejércitos nuevos ni unidades movidas');
        T.eq(xs.map(a => g.opEchelon(op, a)), ['seguimiento', 'seguimiento', 'punta'], 'por ejércitos enteros: solo el de tanques va en la punta');
        // Solo mixtos: la punta es el más rápido, entero.
        const op2 = g.createOp(es, 'ofensiva', [S, O], { doctrine: 'lanza', noCap: true });
        const ys = T.cellsAt(g, es, S, [3, 3]).map((c, k) => T.army(g, es, c, 8, 6, k * 2));
        for (const a of ys) g.assignArmy(a, op2.id);
        g.opLaunch(op2);
        T.eq([g.armies.size, ys.map(a => g.opEchelon(op2, a))], [n + 2, ['punta', 'seguimiento']], 'el más rápido, sin partirlo');
        // La recomendación mira lo mismo: con mixtos con muchos tanques no promete una punta, y dice por qué.
        g.endOp(op2);
        const s = g.suggestDoctrine(op2, ys);
        T.ok(s.key !== 'lanza', `no recomienda la punta (${s.key})`);
        T.ok(s.why.includes('tus ejércitos mixtos van a la velocidad de su unidad más lenta'), `y lo dice (${s.why})`);
        T.eq(g.suggestDoctrine(op, [xs[2]]).key, 'lanza', 'con un ejército de tanques, sí');
        return true;
    }],
    ['D5 · con ejércitos mixtos con muchos tanques, la IA elige punta de lanza', () => {
        const { g, es, fr, S, O } = T.aiFront();
        // Ningún ejército llega a velocidad 6 (todos llevan infantería), pero los tanques son la mayor parte del ataque.
        for (const c of T.cellsAt(g, es, S, [1, 1, 2])) T.army(g, es, c, 10, 6, 2);
        const probe = g.createOp(es, 'ofensiva', [S, O], { noCap: true });
        const mixed = [...g.armies.values()].filter(a => a.owner === es);
        T.ok(mixed.every(a => !g.opSpeedy(a)), 'ninguno es rápido entero');
        T.eq(g.suggestDoctrine(probe, mixed).key, 'lanza', 'el ataque rápido se cuenta por tipos de unidad');
        g.endOp(probe);
        g.aiCommand(es);
        const op = g.opsOf(es).find(o => o.kind === 'ofensiva');
        T.ok(op, 'la IA crea la ofensiva');
        T.eq(op.doctrine, 'lanza', 'punta de lanza');
        if (op.phase !== 'avance') g.opLaunch(op);
        const tips = g.opMembers(op).filter(a => g.opEchelon(op, a) === 'punta');
        T.ok(tips.length >= 1 && tips.every(a => countUnits(a.units) === a.units.tank), 'la punta, de tanques');
        T.ok(g.opMembers(op).filter(a => g.opEchelon(op, a) === 'seguimiento').every(a => !a.units.tank), 'el seguimiento, sin tanques');
        // Pocos tanques: no llega al tercio.
        const few = [...g.armies.values()].filter(a => a.owner === es).map(a => ({ ...a, units: { infantry: 20, tank: 1, artillery: 2, antiair: 0 } }));
        T.ok(g.suggestDoctrine(op, few).key !== 'lanza', 'con pocos tanques, no');
        return true;
    }],
    ['D5 · frente amplio contra un vecino débil', () => {
        const { g, es, fr, S, O } = T.aiFront();
        for (const c of T.cellsAt(g, es, S, [1, 1, 2, 2])) T.army(g, es, c, 12, 0, 0);   // solo infantería
        T.army(g, fr, O, 3, 0, 0);   // una guarnición pequeña
        g.aiCommand(es);
        const op = g.opsOf(es).find(o => o.kind === 'ofensiva');
        T.ok(op, 'la IA crea la ofensiva');
        T.eq([op.doctrine, op.width, op.logistics], ['amplio', 'amplia', 50], 'frente amplio');
        T.ok(g.suggestDoctrine(op).why.includes('débil'), 'por ser débil');
        // La IA decide mientras se reúne; una vez en marcha no la cambia.
        if (op.phase !== 'avance') g.opLaunch(op);
        const far = [...g.opCorridor(op)].find(c => isLand(c) && g.owner[c] === fr && T.free(g, c));
        T.army(g, fr, far, 90, 0, 0);
        T.eq(g.suggestDoctrine(op).key, 'asalto', 'ya no es débil');
        g.aiCommand(es);
        T.eq(op.doctrine, 'amplio', 'en marcha no cambia');
        return true;
    }],
    ['D5 · asalto contra una capital fortificada', () => {
        const { g, es, fr, S, O } = T.aiFront();
        const cap = g.nations[fr].capitalCell;
        g.fort[cap] = 2;
        for (const c of T.cellsAt(g, es, S, [1, 1, 2])) T.army(g, es, c, 0, 8, 0);   // todo tanques, y el enemigo sin ejércitos
        const op = g.createOp(es, 'ofensiva', [S, cap], { auto: 'auto' });
        op.front = fr;
        g.aiCommand(es);
        T.ok(g.ops.has(op.id) && g.opMembers(op).length === 3, 'con sus ejércitos');
        T.eq([op.doctrine, op.width, op.logistics], ['asalto', 'estrecha', 0], 'asalto');
        T.ok(g.suggestDoctrine(op).why.includes('capital'), 'por ser capital');
        // Una ciudad que no es capital pero está fortificada, también.
        const op2 = g.createOp(es, 'ofensiva', [S, O], { noCap: true });
        T.eq(g.suggestDoctrine(op2, g.opMembers(op)).key, 'lanza', 'sin fortificar, punta');
        g.fort[O] = 1;
        const s = g.suggestDoctrine(op2, g.opMembers(op));
        T.ok(s.key === 'asalto' && s.why.includes('fortificad'), `fortificada, asalto (${s.why})`);
        // Sin ejércitos aún, asalto.
        T.eq(g.suggestDoctrine(op2, []).key, 'asalto', 'sin ejércitos');
        return true;
    }],
    ['D6 · al dibujar sale preseleccionada la recomendada con su motivo, y el jugador elige otra', () => {
        const g = T.uiStart('es'), es = g.player, fr = T.nation('fr');
        g.declareWar(es, fr);
        for (const a of [...g.armies.values()]) if (a.owner === es || a.owner === fr) g.removeArmy(a);
        const [S, O] = T.straight(g, es, 8);
        g.owner[O] = fr; g.legal[O] = fr; g.version++;
        for (const c of T.cellsAt(g, es, S, [0, 1, 1])) T.army(g, es, c, 0, 6, 0);   // tanques: punta de lanza
        const rec = g.draftDoctrine(es, [S, O]);
        T.eq(rec.key, 'lanza', 'recomienda la punta');
        const draw = () => { ui.setTool('op', { kind: 'ofensiva', cells: [], redraw: null }); ui.clickCell(S); ui.clickCell(O); };
        draw();
        const card = () => document.querySelector('#card');
        let on = card().querySelector('[data-action="op-doctrine"].on');
        T.eq(on?.dataset.value, 'lanza', 'preseleccionada');
        T.ok(on.textContent.includes('recomendada'), 'marcada como recomendada');
        T.ok(card().textContent.includes(rec.why), 'con su motivo');
        T.ok(Object.values(OP_DOCTRINES).every(d => card().textContent.includes(d.name) && card().textContent.includes(d.desc)), 'cada una con su explicación');
        card().querySelector('[data-action="op-doctrine"][data-value="amplio"]').click();
        on = card().querySelector('[data-action="op-doctrine"].on');
        T.eq(on.dataset.value, 'amplio', 'el jugador elige otra');
        T.ok(card().querySelector('[data-action="op-doctrine"][data-value="lanza"]').textContent.includes('recomendada'), 'la recomendada sigue marcada');
        ui.opClick(O);   // otro clic (en el mismo punto) no le cambia la elección
        T.eq(card().querySelector('[data-action="op-doctrine"].on').dataset.value, 'amplio', 'se queda la suya');
        card().querySelector('[data-action="op-create"]').click();
        const op = g.opsOf(es).find(o => o.kind === 'ofensiva');
        T.eq([op.doctrine, op.width, op.logistics], ['amplio', 'amplia', 50], 'la creada lleva la elegida');
        // Sin tocarla, la recomendada.
        g.endOp(op);
        draw();
        card().querySelector('[data-action="op-create"]').click();
        const op2 = g.opsOf(es).find(o => o.kind === 'ofensiva');
        T.eq([op2.doctrine, op2.width, op2.logistics], ['lanza', 'estrecha', 50], 'sin tocarla, la recomendada');
        // Las otras clases de operación no tienen doctrina.
        ui.setTool('op', { kind: 'defensa', cells: [], redraw: null });
        T.ok(!card().querySelector('[data-action="op-doctrine"]'), 'la defensa no la tiene');
        return true;
    }],
    ['D6 · la doctrina elegida por el jugador no cambia sola en los turnos siguientes', () => {
        const g = T.uiStart('es'), es = g.player, fr = T.nation('fr');
        g.declareWar(es, fr);
        for (const a of [...g.armies.values()]) if (a.owner === es || a.owner === fr) g.removeArmy(a);
        const [S, O] = T.straight(g, es, 10);
        g.owner[O] = fr; g.legal[O] = fr; g.version++;
        for (const c of T.cellsAt(g, es, S, [0, 1, 1])) T.army(g, es, c, 0, 8, 0);
        const op = g.playerCreateOp('ofensiva', [S, O], { doctrine: 'asalto' });
        T.eq(g.opMembers(op).length, 3, 'con sus ejércitos');
        T.eq(g.suggestDoctrine(op).key, 'lanza', 'la recomendada es otra');
        g.playerOpSet(op, 'width', 'media'); g.playerOpSet(op, 'logistics', 25);
        const pick = () => [op.doctrine, op.width, op.logistics];
        for (let t = 0; t < 4 && g.ops.has(op.id); t++) {
            g.endTurn();
            T.eq(pick(), ['asalto', 'media', 25], `turno ${t + 1}`);
        }
        T.ok(op.phase === 'avance', 'ya en marcha');
        // Una punta elegida contra la recomendación, igual.
        const op2 = g.playerCreateOp('ofensiva', [S, O], { doctrine: 'lanza' });
        g.playerOpSet(op2, 'logistics', 0);
        for (const a of g.opMembers(op)) { g.assignArmy(a, op2.id); a.units = { infantry: 20, tank: 0, artillery: 0, antiair: 0 }; }
        g.endOp(op);
        T.ok(g.suggestDoctrine(op2).key !== 'lanza', 'la recomendada ya es otra');
        g.endTurn(); g.endTurn();
        T.eq([op2.doctrine, op2.width, op2.logistics], ['lanza', 'estrecha', 0], 'sigue la suya');
        return true;
    }],
    ['D6 · cambiar doctrina en la ficha', () => {
        const g = T.uiStart('es'), es = g.player, fr = T.nation('fr');
        g.declareWar(es, fr);
        const [S, O] = T.straight(g, es, 9);
        g.owner[O] = fr; g.legal[O] = fr; g.version++;
        const op = g.playerCreateOp('ofensiva', [S, O]);
        ui.focusOp = op.id; ui.tab = 'mando'; ui.drawerOpen = true; ui.render();
        const body = () => document.querySelector('#drawer-body'), click = (k, v) => body().querySelector(`[data-action="op-set"][data-key="${k}"][data-value="${v}"]`).click();
        T.ok(body().textContent.includes('Doctrina') && body().textContent.includes(OP_DOCTRINES.asalto.desc), 'la ficha enseña la doctrina');
        T.ok(body().querySelector('[data-action="op-set"][data-key="doctrine"][data-value="asalto"]').classList.contains('on'), 'la suya, marcada');
        click('doctrine', 'lanza');
        T.eq([op.doctrine, op.width, op.logistics], ['lanza', 'estrecha', 50], 'punta de lanza, con sus valores de serie');
        T.ok(body().textContent.includes(OP_DOCTRINES.lanza.desc), 'y su explicación');
        click('width', 'media');
        click('logistics', 75);
        T.eq([op.doctrine, op.width, op.logistics], ['lanza', 'media', 75], 'anchura y logística a mano');
        T.ok(body().querySelector('[data-action="op-set"][data-key="width"][data-value="media"]').classList.contains('on'), 'anchura marcada');
        T.ok(body().textContent.includes('casillas a cada lado'), 'dice cuántas casillas');
        click('doctrine', 'amplio');
        T.eq([op.doctrine, op.width, op.logistics], ['amplio', 'amplia', 50], 'frente amplio');
        return true;
    }],
    ['D6 · pasar un miembro de escalón', () => {
        const g = T.uiStart('es'), es = g.player, fr = T.nation('fr');
        g.declareWar(es, fr);
        for (const a of [...g.armies.values()]) if (a.owner === es || a.owner === fr) g.removeArmy(a);
        const [S, O] = T.straight(g, es, 10);
        g.owner[O] = fr; g.legal[O] = fr; g.version++;
        const [c0, c1, c2] = T.cellsAt(g, es, S, [0, 1, 1]);
        const tk = T.army(g, es, c0, 0, 8, 0), in1 = T.army(g, es, c1, 10, 0, 0);
        T.army(g, es, c2, 10, 0, 0);
        const op = g.playerCreateOp('ofensiva', [S, O], { doctrine: 'lanza' });
        g.playerLaunchOp(op);
        T.eq([g.opEchelon(op, tk), g.opEchelon(op, in1)], ['punta', 'seguimiento'], 'al lanzar');
        // Bolsas, guarniciones y obras, en la ficha.
        const P = PROVINCES.find(p => g.owner[p.city] === es && CAPITAL_OF[p.city] < 0);
        op.pockets = [O]; op.garrisons = [P.city]; op._work = { turn: g.turn, repaired: 2, built: 3, cost: 40, why: '' };
        ui.focusOp = op.id; ui.tab = 'mando'; ui.drawerOpen = true; ui.render();
        const body = () => document.querySelector('#drawer-body');
        T.ok(body().textContent.includes('Punta (1)') && body().textContent.includes('Seguimiento (2)'), 'escalones en la ficha');
        T.ok(body().textContent.includes('Bolsas') && body().textContent.includes(g.placeName(O)), 'bolsas');
        T.ok(body().textContent.includes('Guarniciones') && body().textContent.includes(P.cityName), 'guarniciones');
        T.ok(body().textContent.includes('2 tramos rotos') && body().textContent.includes('3 tramos'), 'obras');
        body().querySelector(`[data-action="op-set"][data-key="echelon:${in1.id}"][data-value="punta"]`).click();
        T.eq(g.opEchelon(op, in1), 'punta', 'pasa a la punta');
        T.ok(body().textContent.includes('Punta (2)') && body().textContent.includes('Seguimiento (1)'), 'la ficha lo dice');
        body().querySelector(`[data-action="op-set"][data-key="echelon:${tk.id}"][data-value="seguimiento"]`).click();
        T.eq(g.opEchelon(op, tk), 'seguimiento', 'y vuelve');
        // Se dibuja en las dos vistas sin errores, con la punta, las bolsas y las franjas de un frente amplio.
        ui.view.setMode('sencilla'); ui.view.draw();
        g.playerOpSet(op, 'doctrine', 'amplio');
        g.opLanes(op); ui.render(); ui.view.draw();
        T.ok(body().textContent.includes('Franjas') && body().textContent.includes('Frente ('), 'franjas en la ficha');
        return true;
    }],
    ['D2 · la IA separa sus tanques solo donde llegan por tierra; sin sitio, a otra punta o el miembro entero (IA)', () => {
        const g = T.game(), es = T.nation('es');
        g.start(es);
        // Una casilla de un país de la IA con otra suya a 2 casillas o menos al otro lado del agua (sin camino por tierra suya).
        const landBfs = (o, A, depth) => {
            const d = new Map([[A, 0]]), q = [A];
            for (let i = 0; i < q.length; i++) { const u = q[i]; if (d.get(u) < depth) for (let k = 0; k < 6; k++) { const v = G.nb[u * 6 + k]; if (v >= 0 && isLand(v) && !d.has(v) && g.owner[v] === o) { d.set(v, d.get(u) + 1); q.push(v); } } }
            return d;
        };
        let o = -1, A = -1, X = -1;
        for (let k = 0; k < g.nations.length && X < 0; k++) {
            if (k === es) continue;
            for (const c of G.land) {
                if (g.owner[c] !== k || !T.free(g, c)) continue;
                const bfs = landBfs(k, c, 14), x = [...g.nearCells(c, 2)].find(([v, d]) => d > 0 && isLand(v) && g.owner[v] === k && T.free(g, v) && !bfs.has(v));
                if (x) { o = k; A = c; X = x[0]; break; }
            }
        }
        T.ok(X >= 0, 'costa con otra casilla suya al otro lado del agua');
        // Las demás casillas de tierra a 2 o menos, ocupadas.
        const fill = [...g.nearCells(A, 2)].filter(([c, d]) => d > 0 && c !== X && isLand(c) && !g.armyAt[c]).map(([c, d]) => [c, d]);
        for (const [c] of fill) g.settle(g.newArmy(o, c, { infantry: 1, tank: 0, artillery: 0 }, 0));
        let op = g.createOp(o, 'ofensiva', [A, X], { doctrine: 'lanza', noCap: true });
        const m = T.army(g, o, A, 4, 4, 0);
        g.assignArmy(m, op.id);
        let n = g.armies.size;
        g.opLaunch(op);
        T.eq([g.armies.size, m.units.tank, g.opEchelon(op, m)], [n, 4, 'seguimiento'], 'sin sitio por tierra, entero en el seguimiento');
        T.ok(!g.armyAt[X], 'no salta el agua');
        // Con una punta de tanques al lado (por tierra), sus tanques se suman a ella.
        g.endOp(op);
        const [hc] = fill.find(([, d]) => d === 1);
        g.removeArmy(g.armyOn(hc));
        const host = T.army(g, o, hc, 0, 3, 0);
        op = g.createOp(o, 'ofensiva', [A, X], { doctrine: 'lanza', noCap: true });
        for (const x of [host, m]) g.assignArmy(x, op.id);
        n = g.armies.size;
        g.opLaunch(op);
        T.eq([g.armies.size, host.units.tank, m.units.tank], [n, 7, 0], 'los tanques se suman a la punta de al lado');
        T.eq([g.opEchelon(op, host), g.opEchelon(op, m)], ['punta', 'seguimiento'], 'escalones');
        T.ok(!g.armyAt[X], 'y nada al otro lado del agua');
        return true;
    }],
    ['D4 · lo que el jugador elige en la ficha se respeta; lo que no cabe vuelve al seguimiento con aviso', () => {
        const { g, op, xs } = T.wide(9);
        const front = () => xs.filter(a => g.armies.has(a.id) && a.op === op.id && g.opEchelon(op, a) === 'punta');
        g.opLanes(op);
        T.eq(front().length, 6, 'dos tercios en el frente');
        // Pasa uno del frente al seguimiento; luego sale otro de la operación: el reparto no lo devuelve al frente.
        const F = front().sort((x, y) => x.id - y.id)[0];
        T.eq(g.playerOpSet(op, `echelon:${F.id}`, 'seguimiento'), '', 'sin aviso');
        g.opLanes(op);
        const gone = xs.find(a => a !== F && g.opEchelon(op, a) === 'seguimiento');
        g.assignArmy(gone, 0);
        g.opLanes(op);
        T.eq(g.opEchelon(op, F), 'seguimiento', 'sigue donde lo puso el jugador');
        T.eq(front().length, 6, 'el frente se completa con otro');
        // Guardar y cargar lo conserva.
        const h = GameEngine.load(JSON.parse(JSON.stringify(g.serialize())));
        T.ok(h.ops.get(op.id).manual.includes(F.id), 'se guarda');
        // Todos al frente: los que no caben vuelven al seguimiento, y el jugador lo sabe.
        const fit = g.opLaneGeo(op, 99).lanes.length;
        const notes = xs.filter(a => a.op === op.id).map(a => g.playerOpSet(op, `echelon:${a.id}`, 'punta')).filter(Boolean);
        T.eq(front().length, fit, `caben ${fit}`);
        T.ok(notes.length >= 1 && notes.every(s => s.includes('no cabe')), `con aviso: ${notes}`);
        // En la interfaz, el aviso sale al pulsar el botón.
        ui.setGame(g); ui.focusOp = op.id; ui.tab = 'mando'; ui.drawerOpen = true; ui.render();
        const back = xs.find(a => a.op === op.id && g.opEchelon(op, a) === 'seguimiento');
        document.querySelector(`#drawer-body [data-action="op-set"][data-key="echelon:${back.id}"][data-value="punta"]`).click();
        T.ok(g.logs[g.logs.length - 1].msg.includes('no cabe'), `aviso: ${g.logs[g.logs.length - 1].msg}`);
        return true;
    }],
    ['D4 · antes del objetivo también avisa tras 6 turnos sin avanzar (la de la IA termina), y la ficha dice por qué espera', () => {
        const { g, es, fr, op } = T.wide(2);
        const O = op.cells[1];
        const foe = T.army(g, fr, O, 400, 0, 0);   // primero, demasiado para nadie: el frente se detiene delante
        let t = 0;
        for (; t < 20 && g.ops.has(op.id) && !(op.wideIdle >= 1); t++) T.turns(g, es, 1);
        T.ok(g.ops.has(op.id) && op.wideIdle >= 1 && g.owner[O] === fr, `espera ante el objetivo (${t} turnos)`);
        // Una defensa que un asalto ya atacaría, pero no el frente amplio (que pide op.ratio + 0,5).
        const odds = () => g.opWideObjOdds(op);
        while (foe.units.infantry > 1 && odds().ratio < op.ratio + 0.25) foe.units.infantry--;
        T.ok(odds().ratio >= op.ratio && odds().ratio < op.ratio + 0.5, `entre ${op.ratio} y ${op.ratio + 0.5} (${odds().ratio.toFixed(2)})`);
        ui.setGame(g);
        T.ok(ui.rearSection(op).includes(`El frente espera ante ${g.placeName(O)}`), 'la ficha dice por qué espera');
        for (t = 0; t < 10 && op.wideIdle < OP_WIDE_IDLE; t++) T.turns(g, es, 1);
        T.ok(g.ops.has(op.id) && op.wideIdle >= OP_WIDE_IDLE && g.owner[O] === fr, 'sin tomarlo, la del jugador sigue esperando');
        T.ok(g.logs.some(l => l.msg.includes('turnos sin avanzar ni tomar terreno antes de')), 'y el parte dice por qué');
        g.player = fr; T.turns(g, es, 1); g.player = es;
        T.ok(!g.ops.has(op.id), 'la de la IA, termina');
        // La cuenta se guarda.
        const op2 = g.createOp(es, 'ofensiva', op.cells, { doctrine: 'amplio', width: 'estrecha', noCap: true });
        Object.assign(op2, { phase: 'avance', wideIdle: 3, wideLast: 40, wideRear: 7 });
        const k = GameEngine.load(JSON.parse(JSON.stringify(g.serialize()))).ops.get(op2.id);
        T.eq([k.wideIdle, k.wideLast, k.wideRear], [3, 40, 7], 'se guarda');
        return true;
    }],
    ['D6 · la ficha explica el avance de cada doctrina y la anchura de verdad', () => {
        const g = T.uiStart('es'), es = g.player, fr = T.nation('fr');
        g.declareWar(es, fr);
        for (const a of [...g.armies.values()]) if (a.owner === es || a.owner === fr) g.removeArmy(a);
        const [S, O] = T.straight(g, es, 10);
        g.owner[O] = fr; g.legal[O] = fr; g.version++;
        T.army(g, es, S, 0, 8, 0);
        const op = g.playerCreateOp('ofensiva', [S, O], { doctrine: 'lanza' });
        g.playerLaunchOp(op);
        ui.focusOp = op.id; ui.tab = 'mando'; ui.drawerOpen = true; ui.render();
        const text = () => document.querySelector('#drawer-body').textContent;
        T.ok(text().includes('La punta va por delante') && !text().includes('Van juntos'), 'la punta de lanza');
        g.playerOpSet(op, 'doctrine', 'amplio'); ui.render();
        T.ok(text().includes(`solo ataca con ${decimal(op.ratio + 0.5)} a 1`) && !text().includes('Van juntos'), 'el frente amplio, con su ventaja');
        g.playerOpSet(op, 'doctrine', 'asalto'); ui.render();
        T.ok(text().includes('Van juntos'), 'el asalto, como antes');
        // La anchura de verdad: en el mundo, 3 casillas son bastante más de 60 km.
        const was = MAP.cellKm;
        try {
            MAP.cellKm = MAPS.mundo.cellKm;
            T.ok(ui.doctrineSection(op, g.opMembers(op)).includes(`unos ${Math.round(3 * MAPS.mundo.cellKm)} km: nunca menos de 3 casillas`), 'en el mundo');
        } finally { MAP.cellKm = was; }
        T.ok(ui.doctrineSection(op, g.opMembers(op)).includes(`unos ${Math.round(3 * MAP.cellKm)} km)`), 'en Europa');
        return true;
    }],
    ['D6 · con niebla, la ficha no cuenta lo que no se ve', () => {
        const g = T.uiStart('es', true), es = g.player, fr = T.nation('fr');
        g.declareWar(es, fr);
        const [S, O] = T.straight(g, es, 10);
        g.owner[O] = fr; g.legal[O] = fr; g.version++;
        const op = g.playerCreateOp('ofensiva', [S, O], { doctrine: 'lanza' });
        const hidden = G.land.find(c => g.owner[c] === fr && !g.armyAt[c] && !g.sees(es, c));
        T.ok(hidden !== undefined, 'casilla fuera de la vista');
        T.army(g, fr, hidden, 30, 0, 0);
        op.pockets = [hidden];
        ui.focusOp = op.id; ui.tab = 'mando'; ui.drawerOpen = true; ui.render();
        const text = document.querySelector('#drawer-body').textContent;
        T.ok(text.includes('fuera de la vista') && !text.includes('sorteado'), 'no dice quién hay');
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
    // Capturas de las doctrinas (D6), en las dos vistas: una punta de lanza con su seguimiento, una bolsa y obras de
    // logística; un frente amplio con sus franjas; la tarjeta de dibujo con la recomendada; y la ficha, en escritorio y
    // en el móvil.
    const D_SHOTS = 'D6 · capturas de la punta de lanza y el frente amplio';
    if (!filter || D_SHOTS.includes(filter)) {
        ran++;
        const out = join(root, 'tools/cache/smoke');
        mkdirSync(out, { recursive: true });
        const sp = await browser.newPage({ viewport: { width: 1200, height: 800 } });
        const errs = [], names = [];
        sp.on('pageerror', e => errs.push(e.message));
        await sp.goto(`http://localhost:${port}/?seed=7`);
        await sp.waitForFunction(() => typeof GameEngine === 'function' && typeof ui === 'object');
        await sp.evaluate(setup);
        const shot = async (name, mode, fn) => {
            await sp.evaluate(m => { ui.prefs.view = m; ui.view.setMode(m); }, mode);
            if (mode === 'realista') await sp.waitForFunction(() => ui.view.realistic.state === 'ready' || ui.view.realistic.state === 'failed', null, { timeout: 60000 });
            if (fn) await sp.evaluate(fn);
            await sp.waitForTimeout(mode === 'realista' ? 1500 : 300);
            await sp.evaluate(() => ui.view.draw());
            await sp.screenshot({ path: join(out, name) });
            names.push(name);
        };
        // Punta de lanza: dos de tanques en la punta y tres de infantería detrás, ya en marcha; una bolsa sorteada y tramos
        // rotos del pasillo en obra.
        await sp.evaluate(() => {
            const g = T.uiStart('es'), es = g.player, fr = T.nation('fr');
            g.declareWar(es, fr);
            for (const a of [...g.armies.values()]) if (a.owner === es || a.owner === fr) g.removeArmy(a);
            const [S, O] = T.meseta(g, es, 15);
            const op = g.createOp(es, 'ofensiva', [S, O], { doctrine: 'lanza', gold: 100 });
            for (const c of g.opCorridor(op)) if (isLand(c) && CAPITAL_OF[c] < 0) { const x = g.armyOn(c); if (x) g.removeArmy(x); if (g.opAlong(op, c) >= 4) { g.owner[c] = fr; g.legal[c] = fr; } }
            g.version++;
            const cs = T.cellsAt(g, es, S, [0, 1, 1, 2, 2]);
            const xs = cs.map((c, i) => T.army(g, es, c, i < 2 ? 0 : 18, i < 2 ? 12 : 0, i < 2 ? 0 : 4));
            for (const a of xs) g.assignArmy(a, op.id);
            g.opLaunch(op);
            T.turns(g, es, 6);
            const tip = Math.max(...xs.filter(a => g.armies.has(a.id) && g.opEchelon(op, a) === 'punta').map(a => g.opAlong(op, a.cell)));
            const back = Math.max(...xs.filter(a => g.armies.has(a.id) && g.opEchelon(op, a) !== 'punta').map(a => g.opAlong(op, a.cell)));
            const pk = [...g.opCorridor(op)].find(c => isLand(c) && T.free(g, c) && g.owner[c] === fr && Math.abs(g.opPerp(op, c)) >= 1.5 && g.opAlong(op, c) > back && g.opAlong(op, c) < tip - 0.5);
            if (pk !== undefined) { T.army(g, fr, pk, 9, 2, 0); op.pockets.push(pk); }
            const C = T.roadAt(g, op, S, O, 2);
            g.breakRoads(C);
            op.workPool = 500; g.nations[es].gold = 5000;
            g.opLogistics(op, { notes: [] });
            g.motion.length = 0; ui.view.motion.clear();   // sin la animación de los turnos pasados
            window.SHOT = { op: op.id, S, O, mid: G.cellAt(G.cx[S] * 0.6 + G.cx[O] * 0.4, G.cy[S] * 0.6 + G.cy[O] * 0.4) };
            ui.focusOp = op.id; ui.tab = 'mando'; ui.drawerOpen = true; ui.select(-1); ui.render();
        });
        for (const mode of ['sencilla', 'realista']) await shot(`lanza-punta-${mode}.png`, mode, () => { ui.view.scale = 26 / G.S; ui.view.centerOn(SHOT.mid, 26); ui.view.ox -= 170; ui.render(); });
        await sp.setViewportSize({ width: 390, height: 844 });
        await shot('lanza-ficha-movil.png', 'sencilla', () => { ui.setSheet('grande'); ui.drawerOpen = true; ui.render(); document.querySelector('#drawer-body').scrollTop = 520; });
        await sp.setViewportSize({ width: 1200, height: 800 });
        await shot('lanza-ficha.png', 'sencilla', () => { ui.drawerOpen = true; ui.render(); document.querySelector('#drawer-body').scrollTop = 480; });
        // Frente amplio: cuatro rápidos en el frente y dos lentos detrás, con una masa enemiga en una franja.
        await sp.evaluate(() => {
            const g = T.uiStart('es'), es = g.player, fr = T.nation('fr');
            g.declareWar(es, fr);
            for (const a of [...g.armies.values()]) if (a.owner === es || a.owner === fr) g.removeArmy(a);
            const [S, O] = T.meseta(g, es, 14);
            const op = g.createOp(es, 'ofensiva', [S, O], { doctrine: 'amplio', width: 'media', gold: 100 });
            for (const c of g.opCorridor(op)) if (isLand(c) && CAPITAL_OF[c] < 0) { const x = g.armyOn(c); if (x) g.removeArmy(x); if (g.opAlong(op, c) >= 3) { g.owner[c] = fr; g.legal[c] = fr; } }
            g.version++;
            const cs = T.cellsAt(g, es, S, [0, 1, 1, 1, 2, 2]);
            const xs = cs.map((c, i) => T.army(g, es, c, i < 4 ? 0 : 20, i < 4 ? 8 : 0, 0));
            for (const a of xs) g.assignArmy(a, op.id);
            g.opLaunch(op);
            const lanes = g.opLanes(op), L = lanes[lanes.length - 1];
            const mass = [...L.cells].find(c => isLand(c) && T.free(g, c) && g.opAlong(op, c) >= 7 && g.opAlong(op, c) < 8);
            if (mass !== undefined) T.army(g, fr, mass, 40, 10, 0);
            T.turns(g, es, 5);
            g.motion.length = 0; ui.view.motion.clear();   // sin la animación de los turnos pasados
            window.SHOT = { op: op.id, S, O, mid: G.cellAt((G.cx[S] + G.cx[O]) / 2, (G.cy[S] + G.cy[O]) / 2) };
            ui.focusOp = op.id; ui.tab = 'mando'; ui.drawerOpen = true; ui.select(-1); ui.render();
            document.querySelector('#drawer-body').scrollTop = 99999;
        });
        for (const mode of ['sencilla', 'realista']) await shot(`lanza-amplio-${mode}.png`, mode, () => { ui.view.scale = 17 / G.S; ui.view.centerOn(SHOT.mid, 17); ui.view.ox -= 170; ui.render(); [...document.querySelectorAll('#drawer-body .group-title')].find(e => e.textContent.startsWith('Franjas'))?.scrollIntoView(); });
        // Tarjeta de dibujo, con la recomendada preseleccionada y su motivo.
        await sp.evaluate(() => {
            const g = T.uiStart('es'), es = g.player, fr = T.nation('fr');
            g.declareWar(es, fr);
            for (const a of [...g.armies.values()]) if (a.owner === es || a.owner === fr) g.removeArmy(a);
            const [S, O] = T.straight(g, es, 9);
            g.owner[O] = fr; g.legal[O] = fr; g.version++;
            for (const c of T.cellsAt(g, es, S, [0, 1, 1])) T.army(g, es, c, 0, 8, 0);
            ui.drawerOpen = false;
            ui.setTool('op', { kind: 'ofensiva', cells: [], redraw: null }); ui.clickCell(S); ui.clickCell(O);
            window.SHOT = { mid: G.cellAt((G.cx[S] + G.cx[O]) / 2, (G.cy[S] + G.cy[O]) / 2) };
        });
        await shot('lanza-dibujo.png', 'sencilla', () => { ui.view.scale = 20 / G.S; ui.view.centerOn(SHOT.mid, 20); ui.view.ox += 120; ui.render(); });
        await sp.setViewportSize({ width: 390, height: 844 });
        await shot('lanza-dibujo-movil.png', 'sencilla', () => { ui.render(); });
        if (errs.length) { failed++; console.log(`FALLA ${D_SHOTS}\n      ${errs.join('\n      ')}`); }
        else console.log(`ok    ${D_SHOTS} (${join(out, names[0])}, ${names.slice(1).join(', ')})`);
        await sp.close();
    }
} finally {
    await browser.close();
    server.close();
}
console.log(`${ran - Math.min(failed, ran)}/${ran} pruebas superadas`);
process.exit(failed ? 1 : 0);
