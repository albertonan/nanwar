// Pruebas del desgaste en el navegador: ejércitos aislados, sin carretera al alcance o sin víveres, y carreteras rotas.
// Sirve el juego por HTTP, crea partidas nuevas con GameEngine y comprueba las reglas una a una.
// Uso: node basicmilitary/tools/smoke-desgaste.mjs [filtro]   (CHROME=<ruta> para usar otro navegador)
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
        // Rodea `cell` de territorio de `foe` (dueño y legal) y la deja ocupada por `owner`.
        pocket(g, owner, foe, cell) {
            for (let d = 0; d < 6; d++) { const j = G.nb[cell * 6 + d]; if (j >= 0 && isLand(j)) { g.owner[j] = foe; g.legal[j] = foe; } }
            g.owner[cell] = owner; g.legal[cell] = foe; g.version++;
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
['B6 · tomar una casilla a la fuerza deja sus tramos rotos, no borrados', () => {
    const g = T.game(), es = T.nation('es'), pt = T.nation('pt');
    g.start(es); g.declareWar(es, pt);
    const [mine, theirs] = T.border(g, es, pt);
    const d = G.dirTo(mine, theirs);
    g.road[mine * 6 + d] = 2; g.road[theirs * 6 + (d + 3) % 6] = 2;
    g.capture(theirs, es, true);
    T.eq([g.road[mine * 6 + d], g.broken[mine * 6 + d], g.broken[theirs * 6 + (d + 3) % 6]], [0, 2, 2], 'roto y con su clase');
    return true;
}],
['B6 · construir encima de un tramo roto lo arregla', () => {
    const g = T.game(), es = T.nation('es');
    g.start(es);
    const [a, b] = T.plainPair(g, es), d = G.dirTo(a, b);
    g.broken[a * 6 + d] = 1; g.broken[b * 6 + (d + 3) % 6] = 1;
    g.nations[es].gold = 1e4;
    g.buildRoad(es, { path: [a, b], cost: 10, cls: 1 });
    T.eq([g.road[a * 6 + d], g.broken[a * 6 + d]], [1, 0], 'carretera nueva y sin rotura');
    return true;
}],
['B6 · los tramos rotos se guardan y se cargan', () => {
    const g = T.game(), es = T.nation('es');
    g.start(es);
    const [a, b] = T.plainPair(g, es), d = G.dirTo(a, b);
    g.road[a * 6 + d] = 1; g.road[b * 6 + (d + 3) % 6] = 1;
    T.eq(g.breakRoads(a), 1, 'rompe un tramo');
    const h = GameEngine.load(JSON.parse(JSON.stringify(g.serialize())));
    T.eq([h.road[a * 6 + d], h.broken[a * 6 + d], h.broken[b * 6 + (d + 3) % 6]], [0, 1, 1], 'igual tras cargar');
    return true;
}],
['B6 · reparar cuesta la mitad, tarda los turnos de una fortificación y devuelve la autopista', () => {
    const g = T.game(), es = T.nation('es');
    g.start(es);
    const [a, b] = T.plainPair(g, es), d = G.dirTo(a, b);
    g.broken[a * 6 + d] = 2; g.broken[b * 6 + (d + 3) % 6] = 2;
    const full = g.roadEdgeCost(a, d, 2, g.rules(es).roadCost);
    const plan = g.repairPlan(es, a);
    T.eq([plan.edges.length, plan.cost], [1, Math.round(full / 2)], 'un tramo a mitad de precio');
    const gold = g.nations[es].gold = 1e4;
    T.eq(g.startRepair(es, plan), 1, 'en obra');
    T.eq(g.nations[es].gold, gold - plan.cost, 'cobrado');
    T.eq(g.repairPlan(es, a), null, 'no se puede empezar dos veces');
    for (let i = 0; i < g.rules(es).fortTurns; i++) g.beginNationTurn(es);
    T.eq([g.road[a * 6 + d], g.broken[a * 6 + d], g.roadWork.size], [2, 0, 0], 'autopista otra vez');
    return true;
}],
['B6 · la obra se para con el enemigo al lado y no se puede reparar un tramo con una casilla ajena', () => {
    const g = T.game(), es = T.nation('es'), pt = T.nation('pt');
    g.start(es); g.declareWar(es, pt);
    const [mine, theirs] = T.border(g, es, pt), d = G.dirTo(mine, theirs);
    g.broken[mine * 6 + d] = 1; g.broken[theirs * 6 + (d + 3) % 6] = 1;
    T.eq(g.repairPlan(es, mine)?.edges.some(([u, k]) => edgeKey(u, k) === edgeKey(mine, d)) ?? false, false, 'el tramo hacia Portugal no se ofrece');
    const [a, b] = T.plainPair(g, es), k = G.dirTo(a, b);
    g.broken[a * 6 + k] = 1; g.broken[b * 6 + (k + 3) % 6] = 1;
    g.nations[es].gold = 1e4;
    g.startRepair(es, g.repairPlan(es, a));
    const foeCell = [0, 1, 2, 3, 4, 5].map(x => G.nb[a * 6 + x]).find(j => j >= 0 && j !== b && T.free(g, j));
    T.army(g, pt, foeCell, 1);
    const left = g.roadWork.get(edgeKey(a, k)).left;
    g.beginNationTurn(es);
    T.eq(g.roadWork.get(edgeKey(a, k)).left, left, 'parada');
    return true;
}],
['B6 · la IA repara sus carreteras rotas', () => {
    const g = T.game(), fr = T.nation('fr');
    g.start(T.nation('es'));
    const [a, b] = T.plainPair(g, fr), d = G.dirTo(a, b);
    g.broken[a * 6 + d] = 1; g.broken[b * 6 + (d + 3) % 6] = 1;
    g.nations[fr].gold = 1e4;
    T.ok(g.aiRepairRoads(fr, 1e4) > 0, 'gasta en reparar');
    T.ok(g.roadWork.has(edgeKey(a, d)), 'obra empezada');
    return true;
}],
['B6 · las obras de reparación se guardan', () => {
    const g = T.game(), es = T.nation('es');
    g.start(es);
    const [a, b] = T.plainPair(g, es), d = G.dirTo(a, b);
    g.broken[a * 6 + d] = 1; g.broken[b * 6 + (d + 3) % 6] = 1;
    g.nations[es].gold = 1e4; g.startRepair(es, g.repairPlan(es, a));
    const h = GameEngine.load(JSON.parse(JSON.stringify(g.serialize())));
    T.eq([...h.roadWork], [...g.roadWork], 'misma obra');
    return true;
}],
['A3 · cercado en tierra ocupada pierde una infantería cada 3 turnos; con Sanidad militar, cada 4', () => {
    const g = T.game(), es = T.nation('es'), pt = T.nation('pt');
    g.start(es); g.declareWar(es, pt);
    const [, c] = T.plainPair(g, es);
    T.pocket(g, es, pt, c);
    const a = T.army(g, es, c, 2, 1);
    T.ok(g.starving(es, c), 'pasa hambre');
    for (let i = 0; i < 3; i++) g.beginNationTurn(es);
    T.eq([a.units.infantry, a.units.tank], [1, 1], 'pierde primero infantería');
    T.learn(g, es, 'doctrina3');
    for (let i = 0; i < 3; i++) g.beginNationTurn(es);
    T.eq(a.units.infantry, 1, 'aún no con Sanidad militar');
    g.beginNationTurn(es);
    T.eq(a.units.infantry, 0, 'al cuarto');
    return true;
}],
['A3 · un ejército de una unidad que pasa hambre desaparece limpio', () => {
    const g = T.game(), es = T.nation('es'), pt = T.nation('pt');
    g.start(es); g.declareWar(es, pt);
    const [, c] = T.plainPair(g, es);
    T.pocket(g, es, pt, c);
    const a = T.army(g, es, c, 1);
    for (let i = 0; i < 3; i++) g.beginNationTurn(es);
    T.eq([g.armies.has(a.id), g.armyAt[c]], [false, 0], 'sin ejército ni rastro');
    return true;
}],
['A3 · en la costa, el mar también cerca; con una vecina propia, no hay hambre y el contador vuelve a 0', () => {
    const g = T.game(), es = T.nation('es'), pt = T.nation('pt');
    g.start(es); g.declareWar(es, pt);
    const coast = G.land.find(c => g.owner[c] === es && CITY_OF[c] < 0 && !g.armyAt[c] && [0, 1, 2, 3, 4, 5].some(d => G.nb[c * 6 + d] >= 0 && !isLand(G.nb[c * 6 + d])));
    T.pocket(g, es, pt, coast);
    const a = T.army(g, es, coast, 3);
    T.ok(g.starving(es, coast), 'costa cercada');
    g.beginNationTurn(es);
    T.eq(a.hunger, 1, 'cuenta');
    const j = [0, 1, 2, 3, 4, 5].map(d => G.nb[coast * 6 + d]).find(x => x >= 0 && isLand(x));
    g.owner[j] = es; g.version++;
    g.beginNationTurn(es);
    T.eq([g.starving(es, coast), a.hunger], [false, 0], 'se rompe el cerco');
    return true;
}],
['A3 · un cerco de vecinas en paz no pasa hambre', () => {
    const g = T.game(), es = T.nation('es'), pt = T.nation('pt'), fr = T.nation('fr');
    g.start(es); g.declareWar(es, pt);
    const [, c] = T.plainPair(g, es);
    T.pocket(g, es, fr, c);
    T.ok(!g.starving(es, c), 'dueño legal en paz: no no hay hambre');
    g.legal[c] = pt; g.version++;   // dueño legal en guerra: solo las vecinas (de Francia, en paz) lo salvan
    const a = T.army(g, es, c, 2);
    T.ok(!g.starving(es, c), 'vecinas en paz: no hay hambre');
    for (let i = 0; i < 4; i++) g.beginNationTurn(es);
    T.eq([a.hunger, a.units.infantry], [0, 2], 'sin contar ni perder');
    return true;
}],
['A3 · el hambre se guarda', () => {
    const g = T.game(), es = T.nation('es'), pt = T.nation('pt');
    g.start(es); g.declareWar(es, pt);
    const [, c] = T.plainPair(g, es);
    T.pocket(g, es, pt, c);
    const a = T.army(g, es, c, 3);
    g.beginNationTurn(es); g.beginNationTurn(es);
    const h = GameEngine.load(JSON.parse(JSON.stringify(g.serialize())));
    T.eq(h.armies.get(a.id).hunger, 2, 'dos turnos de hambre');
    return true;
}],
    ['A1 · un ejército solo fuera de una ciudad pierde un 10 %; con un compañero al lado o en una ciudad, no', () => {
        const g = T.game(), es = T.nation('es');
        g.start(es);
        const [n, c] = T.plainPair(g, es);
        const a = T.army(g, es, c, 3);
        T.eq(g.armyState(es, c, a.units, a.id).mult, 0.9, 'aislado');
        T.army(g, es, n, 1);
        T.eq(g.armyState(es, c, a.units, a.id).mult, 1, 'con apoyo');
        const city = PROVINCES.find(p => g.owner[p.city] === es).city;   // al empezar, todas sus ciudades tienen guarnición
        T.eq(g.armyState(es, city, a.units).mult, 1, 'en ciudad no cuenta');
        return true;
    }],
    ['A1 · atacar desde la casilla de al lado no cuenta al propio atacante como apoyo', () => {
        const g = T.game(), es = T.nation('es');
        g.start(es);
        const [n, c] = T.plainPair(g, es);
        const a = T.army(g, es, c, 3);
        T.eq(g.armyState(es, n, a.units, a.id).parts.some(([k]) => k === 'aislado'), true, 'solo él cerca de n: aislado');
        return true;
    }],
    ['A2 · en territorio enemigo sin carretera al alcance pierde un 15 %; con una carretera a su alcance, no', () => {
        const g = T.game(), es = T.nation('es'), pt = T.nation('pt');
        g.start(es); g.declareWar(es, pt);
        const [, theirs] = T.border(g, es, pt);
        for (const c of g.nearCells(theirs, 8).keys()) for (let d = 0; d < 6; d++) g.road[c * 6 + d] = 0;
        g.roadVersion++;
        g.capture(theirs, es, true);
        const units = { infantry: 3, tank: 0, artillery: 0 };
        T.ok(g.armyState(es, theirs, units).parts.some(([k, x]) => k === 'sin carretera' && x === 0.85), 'sin carretera');
        const d = [0, 1, 2, 3, 4, 5].find(k => G.nb[theirs * 6 + k] >= 0 && isLand(G.nb[theirs * 6 + k]));
        const j = G.nb[theirs * 6 + d], k = [0, 1, 2, 3, 4, 5].find(x => G.nb[j * 6 + x] >= 0 && G.nb[j * 6 + x] !== theirs);
        g.road[j * 6 + k] = 1; g.road[G.nb[j * 6 + k] * 6 + (k + 3) % 6] = 1; g.roadVersion++;
        T.ok(!g.armyState(es, theirs, units).parts.some(([n]) => n === 'sin carretera'), 'carretera enemiga a una casilla: sirve');
        return true;
    }],
    ['A1+A2 · el combate y su parte llevan los factores nuevos', () => {
        const g = T.game(), es = T.nation('es'), pt = T.nation('pt');
        g.start(es); g.declareWar(es, pt);
        const [mine, theirs] = T.border(g, es, pt);
        for (let d = 0; d < 6; d++) { const x = g.armyOn(G.nb[mine * 6 + d]); if (x && x.owner === es) g.removeArmy(x); }   // atacante aislado seguro
        const a = T.army(g, es, mine, 3), def = T.army(g, pt, theirs, 3);
        const fx = g.combatFactors(es, a.units, mine, def, theirs, a.id);
        T.eq(fx.atk, fx.baseAtk * fx.attState.mult, 'ataque con su estado');
        T.ok(g.battleReport(es, pt, PROVINCES[G.prov[theirs]], fx, fx.atk, fx.dfn, true, 3, 3, 3, 1, '').includes('aislado'), 'el parte lo dice');
        return true;
    }],

['B6 · la herramienta Carretera ofrece reparar un tramo roto y lo pone en obra', () => {
    const g = T.uiStart('es'), es = g.player;
    const [a, b] = T.plainPair(g, es), d = G.dirTo(a, b);
    g.broken[a * 6 + d] = 1; g.broken[b * 6 + (d + 3) % 6] = 1; g.roadVersion++;
    g.nations[es].gold = 1e4;
    ui.setTool('road'); ui.clickCell(a);
    const btn = document.querySelector('[data-action="repair-roads"]');
    T.ok(btn && /Reparar \d+ tramos? \(\d+ de oro, \d+ turnos?\)/.test(btn.textContent), 'botón de reparar con su precio: ' + btn?.textContent);
    const v0 = g.roadVersion;
    btn.click();
    T.ok(g.roadVersion !== v0, 'la versión de carreteras cambia para repintar la obra');
    T.ok(g.roadWork.has(edgeKey(a, d)), 'obra empezada');
    return true;
}],
['A · la ficha del ejército explica aislado, sin carretera y sin víveres', () => {
    const g = T.uiStart('es'), es = g.player, pt = T.nation('pt');
    g.declareWar(es, pt);
    const [, c] = T.plainPair(g, es);
    T.pocket(g, es, pt, c);
    const a = T.army(g, es, c, 3);
    g.beginNationTurn(es);
    ui.select(a.cell);
    const txt = document.body.textContent;
    T.ok(/Aislado ×0,9/.test(txt), 'aislado');
    T.ok(/Sin víveres: pierde 1 unidad dentro de 2 turnos/.test(txt), 'hambre con su cuenta');
    return true;
}],
['A · la ficha al pasar el ratón también lo dice, con «sin carretera al alcance»', () => {
    const g = T.uiStart('es'), es = g.player, pt = T.nation('pt');
    g.declareWar(es, pt);
    const [, c] = T.plainPair(g, es);
    T.pocket(g, es, pt, c);
    for (const x of g.nearCells(c, 8).keys()) for (let d = 0; d < 6; d++) g.road[x * 6 + d] = 0;
    g.roadVersion++;
    const a = T.army(g, es, c, 3);
    g.beginNationTurn(es);
    ui.cellFromEvent = () => a.cell;
    try { ui.hover({ clientX: 0, clientY: 0 }); } finally { delete ui.cellFromEvent; }
    const txt = document.querySelector('#tooltip').textContent;
    T.ok(/Aislado ×0,9/.test(txt), 'aislado: ' + txt);
    T.ok(/Sin carretera al alcance ×0,85/.test(txt), 'sin carretera: ' + txt);
    T.ok(/Sin víveres: pierde 1 unidad dentro de 2 turnos/.test(txt), 'hambre: ' + txt);
    return true;
}],
['A · la leyenda explica el borde de sin víveres', () => {
    T.uiStart('es');
    T.ok(/Ficha con borde violeta: ejército sin víveres/.test(document.querySelector('#legend').textContent), 'leyenda');
    return true;
}],
['A · la IA saca de la bolsa a un ejército que pasa hambre si puede', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); g.declareWar(fr, es);
    const [, c] = T.plainPair(g, fr);
    T.pocket(g, fr, es, c);
    const hole = G.nb[c * 6 + [0, 1, 2, 3, 4, 5].find(d => isLand(G.nb[c * 6 + d]))];
    g.owner[hole] = fr; g.legal[hole] = fr; g.version++;   // una salida
    const a = T.army(g, fr, c, 3);
    g.aiStep(fr);
    T.ok(!g.starving(fr, g.armies.get(a.id)?.cell ?? c), 'ha salido');
    return true;
}],
['A · la IA rompe el cerco atacando a un vecino con previsión de al menos 1', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); g.declareWar(fr, es);
    const [n, c] = T.plainPair(g, fr);
    T.pocket(g, fr, es, c);
    const weak = T.army(g, es, n, 1), a = T.army(g, fr, c, 4, 2);
    T.ok(g.starving(fr, c), 'pasa hambre');
    let hit = -1;
    const attack = g.attack;
    g.attack = function (army, from, target, r) { if (army.owner === fr) hit = target; return attack.call(this, army, from, target, r); };
    g.aiPockets(fr);
    T.eq(hit, weak.cell, 'ataca al vecino débil');
    return true;
}],
['A · sin nadie a quien atacar, la IA marcha hacia lo suyo', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); g.declareWar(fr, es);
    const [, c] = T.plainPair(g, fr);
    T.pocket(g, fr, es, c);
    const a = T.army(g, fr, c, 3);
    g.aiPockets(fr);
    const b = g.armies.get(a.id);
    T.ok(b && b.cell !== c, 'se ha movido');
    T.ok(!g.starving(fr, b.cell), 'ya come');
    return true;
}],
['A · la IA no saca de la bolsa a quien tiene una orden', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); g.declareWar(fr, es);
    const [, c] = T.plainPair(g, fr);
    T.pocket(g, fr, es, c);
    const a = T.army(g, fr, c, 3);
    a.order = { kind: 'march', dest: c, stuck: 0 };
    g.aiPockets(fr);
    T.eq(g.armies.get(a.id)?.cell, c, 'quieto');
    return true;
}],
['A · declarar la guerra o firmar la paz renueva la carretera al alcance', () => {
    const g = T.game(), es = T.nation('es'), pt = T.nation('pt');
    g.start(es);
    const [mine, theirs] = T.border(g, es, pt);
    for (const x of g.nearCells(mine, 8).keys()) for (let d = 0; d < 6; d++) g.road[x * 6 + d] = 0;
    const k = [0, 1, 2, 3, 4, 5].find(x => { const j = G.nb[theirs * 6 + x]; return j >= 0 && j !== mine && isLand(j) && g.owner[j] === pt; });
    g.road[theirs * 6 + k] = 1; g.road[G.nb[theirs * 6 + k] * 6 + (k + 3) % 6] = 1; g.roadVersion++;
    const units = { infantry: 3, tank: 0, artillery: 0 };
    T.eq(g.roadInReach(es, mine, units), false, 'en paz no se cruza Portugal');
    g.declareWar(es, pt);
    T.eq(g.roadInReach(es, mine, units), true, 'en guerra, la carretera portuguesa está a su alcance');
    g.makePeace(es, pt, true);
    T.eq(g.roadInReach(es, mine, units), false, 'con la paz, otra vez no');
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
