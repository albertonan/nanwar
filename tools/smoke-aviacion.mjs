// Pruebas de la aviación en el navegador: escala, fortificaciones con nivel, escuadrones, antiaéreo y satélites.
// Sirve el juego por HTTP, crea partidas nuevas con GameEngine y comprueba las reglas una a una.
// Uso: node basicmilitary/tools/smoke-aviacion.mjs [filtro]   (CHROME=<ruta> para usar otro navegador)
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
        learn(g, id, ...ids) { for (const t of ids) g.nations[id].tech.done.add(t); g.techVersion++; },
        ok(c, msg) { if (!c) throw new Error(msg); },
        // Ejército nuevo de `owner` en `cell` (sin moverse aún este turno).
        army(g, owner, cell, inf = 1, tank = 0, art = 0) { return g.settle(g.newArmy(owner, cell, { infantry: inf, tank, artillery: art }, 0)); },
        // Casilla de mar libre y vecina de tierra: sin ejército encima.
        seaFree: (g, c) => afloat(c) && !g.armyAt[c],
        // Tierra de `owner` sin ciudad, sin ejército en ella ni en sus vecinas de tierra, con una vecina de mar libre.
        // Devuelve [tierra, mar]. Con `near`, la más cercana en línea recta a esa casilla; con `skip`, fuera de esa provincia.
        coast(g, owner, { near = -1, skip = -1 } = {}) {
            const nbs = c => [0, 1, 2, 3, 4, 5].map(d => G.nb[c * 6 + d]).filter(j => j >= 0);
            const cands = G.land.filter(c => g.owner[c] === owner && CITY_OF[c] < 0 && !g.armyAt[c] && G.prov[c] !== skip
                && nbs(c).every(j => !isLand(j) || !g.armyAt[j]) && nbs(c).some(j => T.seaFree(g, j)));
            if (near >= 0) cands.sort((a, b) => Math.hypot(G.cx[a] - G.cx[near], G.cy[a] - G.cy[near]) - Math.hypot(G.cx[b] - G.cx[near], G.cy[b] - G.cy[near]));
            if (!cands.length) throw new Error('no hay costa libre');
            const c = cands[0];
            return [c, nbs(c).find(j => T.seaFree(g, j))];
        },
        // Tierra de `A`, tierra de `B` y una casilla de mar vecina de las dos, todas libres: [a, s, b].
        strait(g, A, B) {
            for (let s = 0; s < G.N; s++) {
                if (!T.seaFree(g, s)) continue;
                const l = [0, 1, 2, 3, 4, 5].map(d => G.nb[s * 6 + d]).filter(j => j >= 0 && isLand(j) && !g.armyAt[j] && CITY_OF[j] < 0);
                const a = l.find(j => g.owner[j] === A), b = l.find(j => g.owner[j] === B);
                if (a !== undefined && b !== undefined) return [a, s, b];
            }
            throw new Error('no hay estrecho');
        },
        // Ejército de `n` infanterías de `owner` embarcado en la casilla de mar `sea`.
        embark(g, owner, sea, n = 1) { return g.settle(g.newArmy(owner, sea, { infantry: n, tank: 0, artillery: 0 }, 0)); },
        // Partida empezada desde la interfaz, como haría el jugador (la de smoke-desgaste).
        uiStart(key, fog = false) {
            for (const d of document.querySelectorAll('dialog[open]')) d.close();
            ui.setGame(T.game(7, fog));
            ui.choice = T.nation(key); ui.render();
            document.querySelector('[data-action="start"]').click();
            return ui.game;
        },
        // Igual que T.eq, con tolerancia: dos números, o dos listas de números del mismo largo.
        near(a, b, tol, msg) {
            const xs = [a].flat(), ys = [b].flat();
            if (xs.length !== ys.length || xs.some((x, i) => !(Math.abs(x - ys[i]) <= tol))) throw new Error(`${msg}: ${JSON.stringify(a)} ≉ ${JSON.stringify(b)} (±${tol})`);
        },
        // Suerte fija: cada tirada de `g` da `x` (y el estado del generador se conserva para guardar la partida).
        luck(g, x) { const state = g.rng.state; g.rng = () => x; g.rng.state = state; },
        // De smoke-desgaste: tierra libre sin ciudad.
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
        // Casilla libre de `a` junto a la frontera con `b`, y la de `b` de al lado.
        border(g, a, b, skip = 0) {
            for (const c of G.land) {
                if (g.owner[c] !== a || !T.free(g, c)) continue;
                for (let d = 0; d < 6; d++) { const j = G.nb[c * 6 + d]; if (j >= 0 && isLand(j) && g.owner[j] === b && skip-- <= 0) return [c, j]; }
            }
            throw new Error('no hay frontera');
        },
        // De smoke-research: rodea con `k` ejércitos de `enemy` una casilla de `owner` (la dada o una libre).
        surround(g, owner, enemy, k, cell) {
            const c = cell ?? T.plainPair(g, owner)[1];
            for (let d = 0; d < k; d++) { const j = G.nb[c * 6 + d]; g.settle(g.newArmy(enemy, j, { infantry: 1, tank: 0, artillery: 0 }, 0)); }
            return c;
        },
        // Partida sin aviación: ni escuadrones, ni aeródromos, ni antiaéreo, ni satélites.
        bare(g) {
            for (const k of ['squadrons', 'airfields', 'aaSites', 'sats']) {
                const x = g[k];
                if (x instanceof Map || x instanceof Set) x.clear(); else if (Array.isArray(x)) x.length = 0;
            }
            g.airVersion++;
        },
        // Aeródromo terminado y en servicio de `owner` en `cell`.
        airfield(g, owner, cell) { g.airfields.set(cell, { owner, left: 0, downUntil: 0 }); g.airVersion++; },
        // `n` escuadrones de `owner` en el aeródromo `base`, listos para volar.
        squad(g, owner, base, n = 1) { return Array.from({ length: n }, () => g.newSquadron(owner, base, 0)); },
        // Antiaéreo fijo terminado de `owner` en `cell`, sin daños y sin que nadie lo conozca.
        site(g, owner, cell) { const s = { owner, left: 0, hits: 0, known: new Set() }; g.aaSites.set(cell, s); g.airVersion++; return s; },
        // La pareja más cercana [ciudad de A, ciudad de B] con min ≤ hexDist ≤ max que cumpla `ok(a, b)`.
        pair(g, A, B, ok = () => true, min = 6, max = 18) {
            const of = id => PROVINCES.filter(p => g.owner[p.city] === id).map(p => p.city);
            let best = null, bd = Infinity;
            for (const a of of(A)) for (const b of of(B)) {
                const d = hexDist(a, b);
                if (d >= min && d <= max && d < bd && ok(a, b)) { best = [a, b]; bd = d; }
            }
            if (!best) throw new Error('no hay pareja de ciudades');
            return best;
        },
        // La ciudad de `owner` más cercana a `cell`, a `R` casillas o menos.
        baseFor(g, owner, cell, R = 25) {
            const c = PROVINCES.filter(p => g.owner[p.city] === owner && hexDist(p.city, cell) <= R).map(p => p.city)
                .sort((a, b) => hexDist(a, cell) - hexDist(b, cell) || a - b)[0];
            if (c === undefined) throw new Error('no hay base a su alcance');
            return c;
        },
        // Alto de la ficha y del mapa, como los mide smoke-vista en el móvil.
        mobileCard() {
            const card = document.querySelector('#card'), h = sel => document.querySelector(sel).getBoundingClientRect().height;
            return { hidden: card.hidden, card: h('#card'), stage: h('#stage') };
        },
        // Texto de la tarjeta al pasar el ratón por `cell` ('' si no sale).
        hover(cell) {
            ui.cellFromEvent = () => cell; ui.view.hoverCell = -1;
            try { ui.hover({ clientX: 0, clientY: 0 }); } finally { delete ui.cellFromEvent; }
            const tip = document.querySelector('#tooltip');
            return tip.hidden ? '' : tip.textContent;
        }
    };
};

const CHECKS = [
['1 · escala: kilómetros a casillas y distancia en casillas', () => {
    const g = T.game(), es = T.nation('es');
    T.eq([kmCells(500), kmCells(60), kmCells(400), kmCells(600), kmCells(750), kmCells(150), kmCells(170)], [25, 3, 20, 30, 38, 8, 9], 'Europa');
    const [a, b] = T.plainPair(g, es);
    T.eq([hexDist(a, a), hexDist(a, b)], [0, 1], 'vecinas');
    const m = g.nations[es].capitalCell, l = g.nations[T.nation('pt')].capitalCell, path = flightPath(m, l);
    T.eq(path.length, hexDist(m, l) - 1, 'una casilla por paso');
    T.ok([m, ...path, l].every((c, i, all) => i === 0 || hexDist(all[i - 1], c) === 1), 'casillas seguidas');
    return true;
}],
['M · escala del mundo: 500 km son 6 casillas', () => {
    T.eq([kmCells(500), kmCells(60), kmCells(400), kmCells(600), kmCells(750), kmCells(150), kmCells(170)], [6, 1, 5, 7, 9, 2, 2], 'mundo');
    return true;
}],
['1 · una fortificación nueva nace al nivel máximo de su dueño', () => {
    const g = T.game(), es = T.nation('es');
    g.start(es); g.nations[es].gold = 1e5;
    T.learn(g, es, 'fortificacion1');
    const [, c] = T.plainPair(g, es);
    g.buildFort(es, g.planFort(es, c, c));
    for (let i = 0; i < g.rules(es).fortTurns; i++) g.beginNationTurn(es);
    T.eq([g.fort[c], g.fortMax(es), g.fortLevel(es, c)], [2, 2, 1], 'hormigón');
    return true;
}],
['1 · los efectos salen del nivel de la casilla, no de lo investigado', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); g.declareWar(es, fr);
    T.learn(g, es, 'fortificacion1', 'fortificacion2', 'fortificacion3');
    const [from, cell] = T.plainPair(g, es), d = G.dirTo(from, cell);
    const def = { owner: es, units: { infantry: 1, tank: 0, artillery: 0 } }, att = { infantry: 1, tank: 0, artillery: 0 };
    const look = () => { const fx = g.combatFactors(fr, att, from, def, cell); return [fx.parts.find(([n]) => n === 'fortificación')?.[1], fx.cap, g.stepCost(fr, from, d, true) - g.stepCost(fr, from, d, false) - MOVE / 2]; };
    g.fort[cell] = 4; T.eq(look(), [2, 3.5, 2 * MOVE], 'casamatas');
    g.fort[cell] = 2; T.eq(look(), [2, 3, MOVE], 'casamata bajada a hormigón');
    g.fort[cell] = 1; T.eq(look()[0], 1.75, 'sacos terreros');
    T.surround(g, es, fr, 3, cell);
    g.fort[cell] = 4; T.eq(g.flankFactor(es, cell), 1, 'casamatas: sin rodeo');
    g.fort[cell] = 3; T.eq(g.flankFactor(es, cell), 0.75, 'búnkeres: rodeada');
    return true;
}],
['1 · al terminar una investigación de Fortificación suben las intactas, no las dañadas', () => {
    const g = T.game(), es = T.nation('es');
    g.start(es); T.learn(g, es, 'fortificacion1');
    const [a, b] = T.plainPair(g, es);
    g.fort[a] = 2; g.fort[b] = 1;
    const s = g.nations[es].tech;
    s.progress.set('fortificacion2', g.techTurns(es, 'fortificacion2') - 1); s.current = ['fortificacion2'];
    g.advanceResearch(es);
    T.eq([g.fort[a], g.fort[b], g.fortMax(es)], [3, 1, 3], 'sube la intacta');
    return true;
}],
['1 · reparar sube un nivel por obra, cuesta la mitad y se para con el enemigo al lado', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); g.declareWar(es, fr); g.nations[es].gold = 1000;
    T.learn(g, es, 'fortificacion1', 'fortificacion2');
    const [a, c] = T.plainPair(g, es);
    g.fort[c] = 1;
    const plan = g.fortRepairPlan(es, c);
    T.eq(plan.cost, Math.round(g.rules(es).fortCost / 2), 'la mitad');
    T.ok(g.startFortRepair(es, plan), 'en obra');
    T.eq([g.nations[es].gold, g.fortWork.get(c).up, g.fortRepairPlan(es, c)], [1000 - plan.cost, true, null], 'cobra y no se repite');
    const foe = T.army(g, fr, a, 1);
    for (let i = 0; i < 5; i++) g.beginNationTurn(es);
    T.eq(g.fort[c], 1, 'parada con el enemigo al lado');
    g.removeArmy(foe);
    for (let i = 0; i < g.rules(es).fortTurns; i++) g.beginNationTurn(es);
    T.eq([g.fort[c], g.fortWork.has(c)], [2, false], 'un nivel');
    return true;
}],
['1 · una partida de antes de los niveles carga sus fortificaciones al máximo de su dueño', () => {
    const g = T.game(), es = T.nation('es');
    g.start(es); T.learn(g, es, 'fortificacion1');
    const [, c] = T.plainPair(g, es);
    g.fort[c] = 1;
    const data = JSON.parse(JSON.stringify(g.serialize()));
    T.eq(GameEngine.load(JSON.parse(JSON.stringify(data))).fort[c], 1, 'la nueva guarda su nivel');
    delete data.fortLv; data.forts = [c];
    T.eq(GameEngine.load(data).fort[c], 2, 'la antigua, al máximo');
    return true;
}],
['1 · la herramienta Fortificar ofrece reparar una fortificación dañada', () => {
    const g = T.uiStart('es'), es = g.player;
    T.learn(g, es, 'fortificacion1'); g.nations[es].gold = 1000;
    const [, c] = T.plainPair(g, es);
    g.fort[c] = 1; g.fortVersion++;
    ui.setTool('fort'); ui.clickCell(c);
    const btn = document.querySelector('[data-action="repair-fort"]');
    T.ok(btn && /Reparar un nivel/.test(btn.textContent), 'botón');
    btn.click();
    T.ok(g.fortWork.get(c)?.up, 'obra de reparación');
    return true;
}],
// Del plan, Task 8: lo que prueba (la IA repara carreteras y fortificaciones) se construye aquí; en la Task 8 queda como regresión.
['1 · la IA repara la carretera y la fortificación que le bombardean', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); g.declareWar(es, fr);
    const [a, c] = T.plainPair(g, fr), d = G.dirTo(a, c);
    g.road[a * 6 + d] = 1; g.road[c * 6 + (d + 3) % 6] = 1; g.breakRoads(c);
    g.fort[c] = 1; T.learn(g, fr, 'fortificacion1'); g.nations[fr].gold = 5000;
    g.aiRepairs(fr);
    T.ok(g.roadWork.has(edgeKey(a, d)) && g.fortWork.get(c)?.up, 'repara las dos');
    return true;
}],
['2 · aviación inicial de España: 165 aviones, 7 escuadrones en 2 aeródromos (la capital y la ciudad mayor)', () => {
    const g = T.game(), es = T.nation('es'), cap = g.nations[es].capitalCell;
    const big = PROVINCES.filter(p => p.country === es && p.city !== cap).sort((a, b) => b.population - a.population)[0].city;
    const fields = [...g.airfields].filter(([, f]) => f.owner === es).map(([c]) => c).sort((a, b) => a - b);
    T.eq([airFleet('es'), [...g.squadrons.values()].filter(s => s.owner === es).length, fields, g.squadronsAt(cap).length],
        [165, 7, [cap, big].sort((a, b) => a - b), 4], 'España');
    return true;
}],
['2 · sin aviones de combate no hay escuadrones; con pocos, uno', () => {
    const g = T.game(), n = k => [...g.squadrons.values()].filter(s => s.owner === T.nation(k)).length;
    T.eq([n('ie'), n('at'), n('ru')], [0, 1, 38], 'Irlanda, Austria y la Rusia europea');
    return true;
}],
// Del plan, con Taiwán en vez de Israel: en el mundo Israel solo tiene 2 casillas, y en ellas caben 8 de sus 13 escuadrones.
['M · Estados Unidos empieza con 115 escuadrones en 29 aeródromos; Taiwán, con 12 aunque tenga una sola ciudad; Israel, los que caben', () => {
    const g = T.game(), us = T.nation('us'), tw = T.nation('tw'), il = T.nation('il');
    const count = id => [[...g.squadrons.values()].filter(s => s.owner === id).length, [...g.airfields.values()].filter(f => f.owner === id).length];
    T.eq([count(us), count(tw), count(il)], [[115, 29], [12, 3], [8, 2]], 'escuadrones y aeródromos');
    T.eq(PROVINCES.filter(p => p.country === tw).length, 1, 'una sola ciudad');
    T.ok([...g.airfields].filter(([, f]) => f.owner === tw || f.owner === il).every(([c, f]) => g.owner[c] === f.owner && g.squadronsAt(c).length <= 4), 'en su tierra y 4 como mucho');
    return true;
}],
['2 · comprar: 300 de oro en una ciudad con aeródromo, listo al turno siguiente y 4 como mucho', () => {
    const g = T.game(), es = T.nation('es');
    g.start(es); T.bare(g); g.nations[es].gold = 2000;
    const cap = g.nations[es].capitalCell;
    T.eq(g.buySquadron(es, cap), null, 'sin aeródromo, no');
    T.airfield(g, es, cap);
    const s = g.buySquadron(es, cap);
    T.eq([g.nations[es].gold, s.ready, g.canFly(s)], [1700, g.turn + 1, false], 'listo el turno que viene');
    g.buySquadron(es, cap); g.buySquadron(es, cap); g.buySquadron(es, cap);
    T.eq(g.buySquadron(es, cap), null, 'no cabe un quinto');
    return true;
}],
['2 · construir un aeródromo: 150 de oro y las obras de una fortificación, solo en una ciudad tuya', () => {
    const g = T.game(), es = T.nation('es');
    g.start(es); T.bare(g); g.nations[es].gold = 1000;
    const city = PROVINCES.find(p => p.country === es && p.city !== g.nations[es].capitalCell).city, [, plain] = T.plainPair(g, es);
    T.eq(g.planAirfield(es, plain), null, 'fuera de una ciudad, no');
    T.ok(g.buildAirfield(es, g.planAirfield(es, city)), 'en obra');
    T.eq([g.nations[es].gold, g.airfields.get(city).left, g.airfieldUp(city)], [850, g.rules(es).fortTurns, false], 'obra');
    for (let i = 0; i < g.rules(es).fortTurns; i++) g.beginNationTurn(es);
    T.ok(g.airfieldUp(city), 'listo');
    return true;
}],
// Del plan, con el alcance del mundo (6 casillas): Canarias solo existe en ese mapa.
['M · trasladar gasta la misión del turno y solo dentro del alcance', () => {
    const g = T.game(), es = T.nation('es');
    g.start(es); T.bare(g);
    const cap = g.nations[es].capitalCell;
    const near = PROVINCES.find(p => p.country === es && p.city !== cap && hexDist(cap, p.city) <= 6).city, far = PROVINCES.find(p => p.name === 'Canarias').city;
    T.eq([g.airRange(es), hexDist(cap, far) > 6], [6, true], 'alcance de 500 km');
    T.airfield(g, es, cap); T.airfield(g, es, near); T.airfield(g, es, far);
    const [s] = T.squad(g, es, cap);
    T.ok(!g.rebase(s, far), 'Canarias queda fuera de alcance');
    T.ok(g.rebase(s, near), 'traslado');
    T.eq([s.base, s.flown, g.canFly(s)], [near, g.turn, false], 'gasta la misión');
    return true;
}],
['2 · tomar a la fuerza la ciudad de un aeródromo lo pierde con sus escuadrones', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); g.declareWar(es, fr);
    const city = PROVINCES.find(p => p.country === fr && CAPITAL_OF[p.city] < 0).city;
    T.airfield(g, fr, city); T.squad(g, fr, city, 2);
    if (g.armyOn(city)) g.removeArmy(g.armyOn(city));
    g.capture(city, es, true);
    T.eq([g.airfields.has(city), [...g.squadrons.values()].filter(s => s.owner === fr).length], [false, 0], 'perdidos');
    return true;
}],
['2 · una ciudad que cambia de manos sin combate traslada sus escuadrones a otro aeródromo propio', () => {
    const g = T.game(), es = T.nation('es'), pt = T.nation('pt');
    g.start(es); T.bare(g);
    const cap = g.nations[es].capitalCell, city = PROVINCES.find(p => p.country === es && p.city !== cap).city;
    T.airfield(g, es, cap); T.airfield(g, es, city);
    const [s] = T.squad(g, es, city);
    g.owner[city] = pt; g.version++; g.airSweep();
    T.eq([g.airfields.has(city), g.squadrons.get(s.id)?.base], [false, cap], 'a la capital');
    return true;
}],
['2 · guardar y cargar conserva escuadrones y aeródromos', () => {
    const g = T.game(), es = T.nation('es');
    g.start(es);
    const s = [...g.squadrons.values()].find(x => x.owner === es); s.ready = g.turn + 1; s.flown = g.turn;
    const h = GameEngine.load(JSON.parse(JSON.stringify(g.serialize())));
    T.eq([h.squadrons.size, h.airfields.size, h.squadrons.get(s.id), h.nextSquadronId], [g.squadrons.size, g.airfields.size, s, g.nextSquadronId], 'igual');
    return true;
}],
['2 · una partida de antes de la aviación la recibe al cargar, según quién tiene qué ciudades', () => {
    const g = T.game(), es = T.nation('es'), pt = T.nation('pt'), lis = g.nations[pt].capitalCell;
    g.start(es); g.declareWar(es, pt); g.owner[lis] = es; g.version++;
    const data = JSON.parse(JSON.stringify(g.serialize()));
    delete data.air;
    const h = GameEngine.load(data), n = id => [...h.squadrons.values()].filter(s => s.owner === id).length;
    T.eq([n(es), n(pt), h.airfields.has(lis), [...h.airfields.values()].filter(f => f.owner === pt).length], [7, 1, false, 1], 'sembrada');
    return true;
}],
['2 · el turno siguiente del dueño: este si aún no ha jugado, el que viene si ya', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es);
    T.eq([g.nextOwnTurn(es), g.nextOwnTurn(fr)], [g.turn + 1, g.turn], 'empezada');
    const h = GameEngine.load(JSON.parse(JSON.stringify(g.serialize())));
    T.eq([h.nextOwnTurn(es), h.nextOwnTurn(fr)], [h.turn + 1, h.turn], 'cargada');
    return true;
}],
['3 · antiaéreo inicial: uno en la capital y otro por cada 4 escuadrones en las ciudades mayores', () => {
    const g = T.game(), es = T.nation('es'), cap = g.nations[es].capitalCell;
    const big = PROVINCES.filter(p => p.country === es && p.city !== cap).sort((a, b) => b.population - a.population)[0].city;
    const sites = [...g.aaSites].filter(([, s]) => s.owner === es).map(([c]) => c).sort((a, b) => a - b);
    T.eq(sites, [cap, big].sort((a, b) => a - b), 'Madrid y la ciudad mayor');
    T.eq([...g.aaSites.values()].filter(s => s.owner === T.nation('ie')).length, 0, 'sin aviación, sin antiaéreo');
    return true;
}],
['3 · construir un antiaéreo fijo: 60 de oro y 2 turnos; se pierde si el enemigo toma la casilla', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); g.declareWar(es, fr); g.nations[es].gold = 500;
    const [, c] = T.plainPair(g, es);
    T.ok(g.buildAA(es, g.planAA(es, c)), 'en obra');
    T.eq([g.nations[es].gold, g.aaSites.get(c).left], [440, 2], 'cobra');
    g.beginNationTurn(es); g.beginNationTurn(es);
    T.eq(g.aaSites.get(c).left, 0, 'listo');
    g.capture(c, fr, true);
    T.ok(!g.aaSites.has(c), 'perdido');
    return true;
}],
['3 · cobertura: 3 casillas en Europa; dañado, la mitad; casamatas en ciudad, el doble', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); g.declareWar(es, fr);
    const [base, target] = T.pair(g, es, fr);
    const ring = d => [...g.nearCells(target, 4)].find(([c, k]) => k === d && isLand(c) && g.owner[c] === fr && !flightPath(base, target).includes(c))[0];
    T.site(g, fr, ring(3)); T.eq(g.aaCover(es, [base], target).fire, 10, 'a 3 casillas cubre');
    g.aaSites.clear(); T.site(g, fr, ring(4)); g.airVersion++;
    T.eq(g.aaCover(es, [base], target).fire, 0, 'a 4, no');
    g.aaSites.clear(); T.site(g, fr, target); g.aaSites.get(target).hits = 1; g.airVersion++;
    T.eq(g.aaCover(es, [base], target).fire, 5, 'dañado');
    g.aaSites.clear(); g.fort[target] = 4; g.fortVersion++; g.airVersion++;
    T.eq(g.aaCover(es, [base], target).fire, 20, 'integrado: el doble');
    g.fort[target] = 3; g.fortVersion++;
    T.eq(g.aaCover(es, [base], target).fire, 0, 'sin casamatas no hay integrado');
    return true;
}],
['3 · probabilidades: con 2 a 1 fracasa el 70 % y cae el 40 %; con 1 a 2 sale bien el 87 % y cae el 5 %', () => {
    const g = T.game(), a = g.airOdds(2, 2), b = g.airOdds(0.5, 0.5);
    T.near([a.fail, a.down, a.damaged], [0.702, 0.4, 0.4], 0.005, '2 a 1');
    T.near([1 - b.fail, b.down], [0.872, 0.05], 0.005, '1 a 2');
    T.eq(g.airOdds(0, 0), { fail: 0, down: 0, damaged: 0 }, 'sin antiaéreo');
    T.near([g.airOdds(9, 9).down, g.airOdds(9, 9).damaged], [0.6, 0.4], 1e-9, 'tope');
    return true;
}],
['3 · el antiaéreo que no conoces cuenta en lo que pasa, no en lo que sabes; conocido, rebaja las pérdidas', () => {
    const g = T.game(7, true), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); g.declareWar(es, fr);
    const [base, target] = T.pair(g, es, fr);
    T.site(g, fr, target);
    const c = g.aaCover(es, [base], target);
    T.eq([c.fire, c.loss, c.seen.fire, c.unknown], [10, 10, 0, true], 'no lo sabes');
    g.aaSites.get(target).known.add(es); g.airVersion++;
    const k = g.aaCover(es, [base], target);
    T.eq([k.fire, k.seen.fire, k.loss], [10, 10, 7.5], 'conocido: pérdidas ×0,75');
    return true;
}],
['3 · el antiaéreo conocido del camino se rodea si sobra alcance; si no, cuenta la mitad', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); g.declareWar(es, fr);
    const onPath = (b, t) => flightPath(b, t).find(x => g.owner[x] === fr && hexDist(x, t) > 3 && hexDist(x, b) > 3);
    const [base, target] = T.pair(g, es, fr, (b, t) => onPath(b, t) !== undefined);
    T.site(g, fr, onPath(base, target));
    T.eq([g.aaCover(es, [base], target).fire, g.aaCover(es, [base], target).loss], [0, 0], 'se rodea');
    T.eq(g.aaCover(es, [base], target, { range: hexDist(base, target) }).loss, 5, 'sin alcance de sobra: la mitad');
    return true;
}],
['3 · partida anterior a la aviación: al cargarla recibe la aviación y el antiaéreo iniciales y sus fortificaciones toman nivel', () => {
    const g = T.game(), es = T.nation('es');
    g.start(es); T.learn(g, es, 'fortificacion1');
    const [, c] = T.plainPair(g, es); g.fort[c] = 2;
    const data = JSON.parse(JSON.stringify(g.serialize()));
    delete data.air; delete data.fortLv; data.forts = [c];
    const h = GameEngine.load(data), fresh = T.game();
    const sum = x => [x.squadrons.size, x.airfields.size, x.aaSites.size];
    T.eq([sum(h), h.fort[c], h.squadronsAt(h.nations[es].capitalCell).length], [sum(fresh), 2, 4], 'aviación de partida y fortificación al máximo');
    return true;
}],
// Además del plan: reglas de la Task 3 que el plan no prueba por sí mismo.
['3 · antiaéreo inicial con un múltiplo de 4 escuadrones: la capital y uno más por cada 4', () => {
    const g = T.game(), n = id => squadronsFor(airFleet(E.countries[id].key));
    const id = g.nations.findIndex(x => x.alive && n(x.id) >= 4 && n(x.id) % 4 === 0);
    T.ok(id >= 0, 'hay un país así');
    T.eq([...g.aaSites.values()].filter(s => s.owner === id).length, 1 + n(id) / 4, 'uno más que aeródromos');
    T.ok([...g.aaSites].every(([c, s]) => g.owner[c] === s.owner && s.left === 0 && s.hits === 0), 'terminados y en su tierra');
    return true;
}],
['3 · guardar y cargar conserva el antiaéreo, sus daños y quién lo conoce (solo países válidos)', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); g.nations[es].gold = 500;
    const [, c] = T.plainPair(g, es);
    g.buildAA(es, g.planAA(es, c));
    const cap = g.nations[fr].capitalCell, s = g.aaSites.get(cap); s.hits = 1; s.known.add(es);
    const data = JSON.parse(JSON.stringify(g.serialize()));
    data.air.aa.find(x => x[0] === cap)[4].push(9999, -1, 'x');
    const h = GameEngine.load(data), t = h.aaSites.get(c);
    T.eq([h.aaSites.size, t.owner, t.left, t.hits, t.known.size, h.aaSites.get(cap).hits, [...h.aaSites.get(cap).known]],
        [g.aaSites.size, es, 2, 0, 0, 1, [es]], 'igual');
    return true;
}],
['3 · un antiaéreo en tierra que cambia de manos sin combate se pierde, sin trasladarse', () => {
    const g = T.game(), es = T.nation('es'), pt = T.nation('pt');
    g.start(es); T.bare(g);
    const [, c] = T.plainPair(g, es);
    T.site(g, es, c);
    g.owner[c] = pt; g.version++;
    T.eq(g.aaList().length, 0, 'ya no dispara');
    g.beginNationTurn(es);
    T.eq(g.aaSites.size, 0, 'perdido');
    return true;
}],
['3 · con niebla, el antiaéreo se ve con Reconocimiento 2 a la vista o con un espía en la provincia', () => {
    const g = T.game(7, true), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); g.declareWar(es, fr);
    const [base, target] = T.pair(g, es, fr), src = () => g.aaList().find(x => x.cell === target);
    T.site(g, fr, target);
    T.eq([g.aaVisible(es, target), g.aaKnown(es, src()), g.aaVisible(fr, target)], [false, false, true], 'sin nada, no');
    g.spies.set(G.prov[target], { since: g.turn, revealedTurn: g.turn }); g.spyVersion++;
    T.ok(g.aaKnown(es, src()), 'con un espía');
    T.eq(g.aaCover(es, [base], target).seen.fire, 10, 'cuenta en lo que sabes');
    g.spies.clear(); g.spyVersion++;
    T.learn(g, es, 'reconocimiento1', 'reconocimiento2');
    T.ok(g.rules(es).intelExact, 'Reconocimiento 2 da información exacta');
    T.eq(g.aaVisible(es, target), g.sees(es, target), 'el jugador, solo lo que tiene a la vista');
    const hidden = G.land.find(x => g.owner[x] === fr && !g.sees(es, x));
    T.ok(hidden !== undefined && !g.aaVisible(es, hidden), 'fuera de la vista, no');
    T.learn(g, fr, 'reconocimiento1', 'reconocimiento2');
    T.ok(g.aaVisible(fr, G.land.find(x => g.owner[x] === es)), 'la IA, con Reconocimiento 2');
    g.aaSites.clear(); g.fort[target] = 4; g.fortVersion++;
    T.eq(g.aaKnown(es, src()), g.fortLevel(es, target) !== null, 'el integrado, si se conoce la fortificación');
    return true;
}],
['3 · con Reconocimiento 2 y sin conocer las fortificaciones, el integrado de unas casamatas sigue siendo antiaéreo que no conoces', () => {
    const g = T.game(7, true), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); g.declareWar(es, fr);
    T.learn(g, es, 'reconocimiento1', 'reconocimiento2');
    T.eq([g.rules(es).intelExact, g.rules(es).intelLevels], [true, false], 'información exacta, sin niveles');
    // Ejércitos españoles junto al camino y al blanco, para tenerlo todo a la vista.
    const [base, target] = T.pair(g, es, fr, () => true, 1);
    for (const c of [target, ...flightPath(base, target)]) {
        if (!isLand(c) || g.owner[c] !== fr || g.sees(es, c)) continue;
        T.army(g, es, [...g.nearCells(c, 3).keys()].find(x => x !== target && T.free(g, x)));
    }
    g.fort[target] = 0; g.fortVersion++;
    T.eq(g.aaCover(es, [base], target).unknown, false, 'todo a la vista y sin antiaéreo');
    g.fort[target] = 4; g.fortVersion++;
    const c = g.aaCover(es, [base], target);
    T.eq([c.fire, c.seen.fire, c.unknown], [20, 0, true], 'casamatas: dispara y no lo sabes');
    return true;
}],
['3 · el jugador construye un antiaéreo: cobra, lo anota en el parte y no repite casilla', () => {
    const g = T.uiStart('es'), es = g.player;
    T.bare(g); g.nations[es].gold = 100;
    const [, c] = T.plainPair(g, es);
    T.ok(g.playerBuildAA(c), 'en obra');
    T.ok(/antiaéreo/.test(g.logs.at(-1).msg), 'parte');
    T.ok(!g.playerBuildAA(c), 'no repite');
    T.ok(!g.playerBuildAA(g.nations[T.nation('fr')].capitalCell), 'en tierra ajena, no');
    T.eq(g.nations[es].gold, 40, 'una vez');
    return true;
}],
['4 · atacar un ejército: le quita un 15 %, primero tanques, y lo desorganiza ×0,8 dos turnos suyos', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); g.declareWar(es, fr);
    const [base, target] = T.pair(g, es, fr);
    T.airfield(g, es, base); const sq = T.squad(g, es, base, 2);
    if (g.armyOn(target)) g.removeArmy(g.armyOn(target));
    const a = T.army(g, fr, target, 10, 10);
    T.luck(g, 0.99);
    T.eq(g.airMission(es, sq.map(s => s.id), 'army', target).result, 'hit', 'acierto');
    T.eq([a.units.tank, a.units.infantry], [7, 10], 'tres tanques');
    const dis = () => g.armyState(fr, target, a.units, a.id).parts.some(([k, x]) => k === 'desorganizado' && x === 0.8);
    T.ok(dis(), 'desorganizado'); g.turn++; T.ok(dis(), 'el segundo turno'); g.turn++; T.ok(!dis(), 'se le pasa');
    return true;
}],
['4 · cortar carreteras rompe los tramos de la casilla y lo dice el parte', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); g.declareWar(es, fr);
    const [base, target] = T.pair(g, es, fr);
    T.airfield(g, es, base); const sq = T.squad(g, es, base, 1);
    let n = 0;
    for (let d = 0; d < 3; d++) { const j = G.nb[target * 6 + d]; if (j >= 0 && isLand(j)) { g.road[target * 6 + d] = 1; g.road[j * 6 + (d + 3) % 6] = 1; n++; } }
    g.roadVersion++; T.luck(g, 0.99);
    T.eq(g.airMission(es, [sq[0].id], 'roads', target).result, 'hit', 'acierto');
    T.eq([0, 1, 2, 3, 4, 5].filter(d => g.broken[target * 6 + d]).length, n, 'rotos');
    T.ok(g.logs.some(l => l.msg.includes(`Bombardeada la carretera de ${g.placeName(target)}: ${plural(n, 'tramo roto', 'tramos rotos')}`)), 'parte');
    return true;
}],
['4 · bajar fortificación: un nivel por acierto y, por debajo de 1, desaparece', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); g.declareWar(es, fr);
    const [base, target] = T.pair(g, es, fr);
    T.airfield(g, es, base); const [s] = T.squad(g, es, base, 1);
    g.fort[target] = 2; T.luck(g, 0.99);
    g.airMission(es, [s.id], 'fort', target); T.eq(g.fort[target], 1, 'baja a sacos terreros');
    g.turn++; g.airMission(es, [s.id], 'fort', target); T.eq(g.fort[target], 0, 'desaparece');
    return true;
}],
['4 · un acierto por blanco y turno: cuatro escuadrones bajan un solo nivel y la segunda misión no despega', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); g.declareWar(es, fr);
    const [base, target] = T.pair(g, es, fr), base2 = PROVINCES.find(p => g.owner[p.city] === es && p.city !== base && hexDist(p.city, target) <= 25).city;
    T.airfield(g, es, base); T.airfield(g, es, base2);
    const four = T.squad(g, es, base, 4), two = T.squad(g, es, base2, 2);
    g.fort[target] = 4; T.luck(g, 0.99);
    T.eq(g.airMission(es, four.map(s => s.id), 'fort', target).result, 'hit', 'acierto');
    T.eq(g.fort[target], 3, 'un solo nivel');
    T.eq(g.missionCheck(es, two, 'fort', target), 'Ese blanco ya ha recibido un acierto este turno.', 'motivo');
    T.eq([g.airMission(es, two.map(s => s.id), 'fort', target).result, g.fort[target], two.every(s => g.canFly(s))], ['blocked', 3, true], 'no despega');
    return true;
}],
['4 · destruir antiaéreo: solo el que conoces; el primer acierto lo daña y el segundo lo destruye', () => {
    const g = T.game(7, true), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); g.declareWar(es, fr);
    const [base, target] = T.pair(g, es, fr);
    T.airfield(g, es, base); const sq = T.squad(g, es, base, 2); T.site(g, fr, target);
    T.eq(g.missionCheck(es, sq, 'aa', target), 'No conoces ningún antiaéreo en esa casilla.', 'desconocido');
    g.aaSites.get(target).known.add(es); g.airVersion++; T.luck(g, 0.99);
    g.airMission(es, sq.map(s => s.id), 'aa', target); T.eq(g.aaSites.get(target).hits, 1, 'dañado');
    g.turn++; g.airMission(es, sq.map(s => s.id), 'aa', target); T.ok(!g.aaSites.has(target), 'destruido');
    return true;
}],
['4 · atacar un aeródromo lo deja inservible dos turnos de su dueño, y sus escuadrones lo defienden', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); g.declareWar(es, fr);
    const [base, target] = T.pair(g, es, fr);
    T.airfield(g, es, base); T.airfield(g, fr, target);
    const [s] = T.squad(g, es, base, 1); T.luck(g, 0.99);
    T.eq(g.airMission(es, [s.id], 'airfield', target).result, 'hit', 'acierto');
    T.eq(g.airfieldUp(target), false, 'inservible'); g.turn++; T.eq(g.airfieldUp(target), false, 'segundo turno'); g.turn++; T.ok(g.airfieldUp(target), 'vuelve');
    T.squad(g, fr, target, 4);
    T.eq(g.airMission(es, [s.id], 'airfield', target).result, 'intercepted', 'lo defienden');
    return true;
}],
// Del plan, con la casilla española de la frontera (la del plan era la francesa): se protege una casilla propia.
['4 · proteger casilla: la misión enemiga pasa antes por la patrulla y, si gana, no llega; acaba al volver su dueño', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); g.declareWar(es, fr);
    const [c] = T.border(g, es, fr);
    T.airfield(g, es, T.baseFor(g, es, c)); T.airfield(g, fr, T.baseFor(g, fr, c));
    const [mine] = T.squad(g, es, T.baseFor(g, es, c)), [theirs] = T.squad(g, fr, T.baseFor(g, fr, c));
    const army = T.army(g, es, c, 5); T.luck(g, 0.99);
    T.eq([g.airMission(es, [mine.id], 'patrol', c).result, mine.patrol], ['hit', c], 'protege');
    T.eq([g.airMission(fr, [theirs.id], 'army', c).result, countUnits(army.units)], ['intercepted', 5], 'no llega');
    g.beginNationTurn(es); T.eq(mine.patrol, -1, 'acaba en su turno');
    return true;
}],
['4 · a ciegas rinde la mitad; con un espía, entero', () => {
    const g = T.game(7, true), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); g.declareWar(es, fr);
    const [, c] = T.border(g, es, fr), base = T.baseFor(g, es, c);
    T.airfield(g, es, base); const sq = T.squad(g, es, base, 1); T.army(g, fr, c, 5);
    T.eq([g.missionOdds(es, sq, 'army', c).known, g.missionOdds(es, sq, 'army', c).hit], [false, 0.5], 'a ciegas');
    g.spies.set(G.prov[c], { since: g.turn, revealedTurn: g.turn }); g.spyVersion++;
    T.eq(g.missionOdds(es, sq, 'army', c).hit, 1, 'con espía');
    return true;
}],
['4 · el antiaéreo derriba o daña; el dañado no vuela el turno siguiente y el sitio que dispara queda conocido', () => {
    const g = T.game(7, true), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); g.declareWar(es, fr);
    const [base, target] = T.pair(g, es, fr);
    T.airfield(g, es, base); const [s, t] = T.squad(g, es, base, 2); T.site(g, fr, target); g.fort[target] = 2;
    T.luck(g, 0.2);
    T.eq([g.airMission(es, [s.id], 'fort', target).result, g.fort[target], g.aaSites.get(target).known.has(es)], ['miss', 2, true], 'falla y lo conoce');
    T.eq([g.squadrons.has(s.id), g.canFly(s)], [true, false], 'dañado'); g.turn++; T.ok(!g.canFly(s), 'tampoco el siguiente'); g.turn++; T.ok(g.canFly(s), 'vuelve');
    T.luck(g, 0.05); g.airMission(es, [t.id], 'fort', target); T.ok(!g.squadrons.has(t.id), 'derribado');
    return true;
}],
['4 · la misión desvela la casilla ese turno: tipo y número', () => {
    const g = T.game(7, true), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); g.declareWar(es, fr);
    const [, c] = T.border(g, es, fr), base = T.baseFor(g, es, c);
    T.airfield(g, es, base); const sq = T.squad(g, es, base, 1); const a = T.army(g, fr, c, 5);
    T.eq(g.armyView(es, a).n, null, 'sin identificar');
    T.luck(g, 0.99); g.airMission(es, [sq[0].id], 'army', c);
    T.eq(g.armyView(es, a).n, countUnits(a.units), 'desvelado'); g.turn++; T.eq(g.armyView(es, a).n, null, 'solo ese turno');
    return true;
}],
['4 · contra un ejército embarcado: el doble de bajas y sin el antiaéreo fijo de la costa', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); g.declareWar(es, fr);
    const [c, s] = T.coast(g, fr, { near: g.nations[es].capitalCell }), base = T.baseFor(g, es, s);
    T.airfield(g, es, base); const sq = T.squad(g, es, base, 2);
    const boat = T.embark(g, fr, s, 20); T.site(g, fr, c);
    T.eq(g.aaCover(es, [base], s).fire, 0, 'el antiaéreo de la costa no protege al barco');
    T.luck(g, 0.99); g.airMission(es, sq.map(x => x.id), 'army', s);
    T.eq(boat.units.infantry, 14, 'seis bajas: el doble');
    return true;
}],
['4 · un escuadrón que protege una casilla de mar escolta al barco', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); g.declareWar(es, fr);
    const [, s] = T.coast(g, es, { near: g.nations[fr].capitalCell });
    T.airfield(g, es, T.baseFor(g, es, s)); T.airfield(g, fr, T.baseFor(g, fr, s, 25));
    const [mine] = T.squad(g, es, T.baseFor(g, es, s)), [theirs] = T.squad(g, fr, T.baseFor(g, fr, s, 25));
    const boat = T.embark(g, es, s, 6); T.luck(g, 0.99);
    g.airMission(es, [mine.id], 'patrol', s);
    T.eq([g.airMission(fr, [theirs.id], 'army', s).result, countUnits(boat.units)], ['intercepted', 6], 'escoltado');
    return true;
}],
// Del plan, con un segundo escuadrón que no ha volado: el primero ya no puede, y el motivo sería otro.
['4 · guardar a media partida conserva desorganizado, el acierto del turno y lo desvelado', () => {
    const g = T.game(7, true), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); g.declareWar(es, fr);
    const [, c] = T.border(g, es, fr), base = T.baseFor(g, es, c);
    T.airfield(g, es, base); const sq = T.squad(g, es, base, 2); const a = T.army(g, fr, c, 5);
    T.luck(g, 0.99); g.airMission(es, [sq[0].id], 'army', c);
    const h = GameEngine.load(JSON.parse(JSON.stringify(g.serialize())));
    T.eq([h.armies.get(a.id).disorgUntil, h.missionCheck(es, [h.squadrons.get(sq[1].id)], 'army', c), h.armyView(es, h.armies.get(a.id)).n],
        [a.disorgUntil, 'Ese blanco ya ha recibido un acierto este turno.', countUnits(a.units)], 'igual');
    return true;
}],
// Además del plan: reglas de la Task 4 que el plan no prueba por sí mismo.
['4 · desorganizado pasa al dividir el ejército y, al juntarse, se queda el que más dura; también en el mar', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); g.declareWar(es, fr);
    const [a0, c] = T.plainPair(g, es), a = T.army(g, es, c, 6);
    a.disorgUntil = g.turn + 1;
    T.eq(g.split(a, { infantry: 2, tank: 0, artillery: 0 }).disorgUntil, g.turn + 1, 'al dividir');
    const d = T.army(g, es, a0, 1); d.disorgUntil = g.turn + 3; g.removeArmy(d); d.cell = c;
    T.eq(g.settle(d).disorgUntil, g.turn + 3, 'al juntarse, el mayor');
    const [, sea] = T.coast(g, fr), boat = T.embark(g, fr, sea, 3); boat.disorgUntil = g.turn;
    T.ok(g.combatFactors(es, { infantry: 1, tank: 0, artillery: 0 }, c, boat, sea).defState.parts.some(([k]) => k === 'desorganizado'), 'en el mar');
    return true;
}],
['4 · motivos: listo, alcance, guerra, blanco y casilla que proteger', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr'), pt = T.nation('pt');
    g.start(es); T.bare(g); g.declareWar(es, fr);
    const [base, target] = T.pair(g, es, fr), far = PROVINCES.find(p => g.owner[p.city] === fr && hexDist(base, p.city) > 25).city;
    T.airfield(g, es, base); const [s] = T.squad(g, es, base, 1);
    if (g.armyOn(target)) g.removeArmy(g.armyOn(target));
    const why = (kind, cell, sq = s) => g.missionCheck(es, [sq], kind, cell);
    T.eq([why('fort', far), why('army', target), why('roads', target), why('fort', target), why('airfield', target), why('patrol', target), why('patrol', base)],
        ['Fuera de alcance.', 'No ves ningún ejército enemigo ahí.', 'No hay carreteras intactas en esa casilla.', 'No hay fortificación.',
            'No hay aeródromo enemigo que funcione.', 'Solo se protege una casilla tuya, de un aliado o de mar.', ''], 'motivos');
    const [, pc] = T.border(g, es, pt), pb = T.baseFor(g, es, pc);
    T.airfield(g, es, pb); const [q] = T.squad(g, es, pb, 1);
    T.eq(why('fort', pc, q), 'Solo contra un país con el que estás en guerra.', 'en paz');
    s.ready = g.turn + 1; T.eq(why('patrol', base), 'Ningún escuadrón listo.', 'dañado');
    T.eq([g.airMission(es, [s.id], 'patrol', base).result, s.flown], ['invalid', 0], 'no despega');
    return true;
}],
['4 · niebla: el parte del que bombardea una fortificación solo nombra el nivel si conoce los niveles', () => {
    const g = T.game(7, true), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); g.declareWar(es, fr);
    const [base, target] = T.pair(g, es, fr);
    T.airfield(g, es, base); const [s] = T.squad(g, es, base, 1);
    g.fort[target] = 3; T.luck(g, 0.99);
    T.eq(g.fortLevel(es, target), null, 'no conoce los niveles');
    g.airMission(es, [s.id], 'fort', target);
    const named = msg => FORT_LEVELS.some(n => msg.includes(n));
    T.ok(g.fort[target] === 2 && /baja un nivel/.test(g.logs.at(-1).msg) && !named(g.logs.at(-1).msg), `sin nivel: ${g.logs.at(-1).msg}`);
    T.learn(g, es, 'reconocimiento1', 'reconocimiento2', 'reconocimiento3');
    g.turn++; g.airMission(es, [s.id], 'fort', target);
    T.ok(g.logs.at(-1).msg.includes(`baja a ${FORT_LEVELS[0]}`), `con nivel: ${g.logs.at(-1).msg}`);
    g.turn++; g.airMission(es, [s.id], 'fort', target);
    T.ok(/desaparece/.test(g.logs.at(-1).msg), 'desaparece');
    return true;
}],
['4 · un mismo escuadrón dos veces en la lista vuela una sola vez', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); g.declareWar(es, fr);
    const [base, target] = T.pair(g, es, fr);
    T.airfield(g, es, base); const [s] = T.squad(g, es, base, 1); T.site(g, fr, target); g.fort[target] = 2;
    let rolls = 0;
    g.rng = () => { rolls++; return 0.99; };
    g.airMission(es, [s.id, s.id], 'fort', target);
    T.eq(rolls, 2, 'una tirada de antiaéreo y la de fracaso (sin niebla no hay la de precisión)');
    T.ok(/^Tu escuadrón /.test(g.logs.at(-1).msg), 'un escuadrón en el parte');
    return true;
}],
['4 · un ejército que se queda sin unidades por un ataque aéreo desaparece de la casilla', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); g.declareWar(es, fr);
    const [base, target] = T.pair(g, es, fr);
    T.airfield(g, es, base); const [s] = T.squad(g, es, base, 1);
    if (g.armyOn(target)) g.removeArmy(g.armyOn(target));
    const a = T.army(g, fr, target, 1); T.luck(g, 0.99);
    T.eq(g.airMission(es, [s.id], 'army', target).result, 'hit', 'acierto');
    T.eq([g.armyAt[target], g.armies.has(a.id)], [0, false], 'desaparece');
    T.ok(/se disuelve/.test(g.logs.at(-1).msg), 'lo dice el parte');
    return true;
}],
['5 · tecla 6: herramienta Aviación; un clic en tu aeródromo elige sus escuadrones listos', () => {
    const g = T.uiStart('es'), es = g.player, cap = g.nations[es].capitalCell;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '6' }));
    T.eq(ui.tool, 'air', 'herramienta');
    ui.clickCell(cap);
    T.eq([ui.air.base, ui.air.picked.size], [cap, g.squadronsAt(cap).filter(s => g.canFly(s)).length], 'elegidos');
    T.ok(/Escuadrones en/.test(document.querySelector('#card').textContent), 'ficha del aeródromo');
    return true;
}],
['5 · un blanco a tu alcance enseña sus misiones con la previsión; fuera de alcance, no', () => {
    const g = T.uiStart('es'), es = g.player, fr = T.nation('fr');
    g.declareWar(es, fr); T.bare(g);
    const [base, target] = T.pair(g, es, fr);
    T.airfield(g, es, base); T.squad(g, es, base, 2); g.fort[target] = 2; g.fortVersion++;
    ui.setTool('air'); ui.clickCell(base); ui.clickCell(target);
    const b = document.querySelector('[data-action="air-mission"][data-kind="fort"]');
    T.ok(b && /% de acierto/.test(b.closest('.air-mission').textContent), 'previsión');
    const pick = ui.view.airPick;
    T.eq([pick.bases, pick.target, pick.range, pick.path.length], [[base], target, g.airRange(es), flightPath(base, target).length], 'lo que dibuja el mapa');
    ui.clickCell(PROVINCES.find(p => g.owner[p.city] === fr && hexDist(base, p.city) > 25).city);
    T.ok(!document.querySelector('[data-action="air-mission"]') && /Fuera de alcance/.test(document.querySelector('#card').textContent), 'fuera');
    return true;
}],
['5 · mandar la misión desde la ficha la resuelve y sale en el parte', () => {
    const g = T.uiStart('es'), es = g.player, fr = T.nation('fr');
    g.declareWar(es, fr); T.bare(g);
    const [base, target] = T.pair(g, es, fr);
    T.airfield(g, es, base); T.squad(g, es, base, 2); g.fort[target] = 2; g.fortVersion++; T.luck(g, 0.99);
    ui.setTool('air'); ui.clickCell(base); ui.clickCell(target);
    document.querySelector('[data-action="air-mission"][data-kind="fort"]').click();
    T.ok(g.fort[target] === 1 && g.logs.some(l => /Tus 2 escuadrones/.test(l.msg)), 'resuelta y en el parte');
    T.eq(ui.air.picked.size, 0, 'ya no queda ninguno listo');
    T.ok(/Ya ha volado/.test(document.querySelector('#card').textContent), 'su estado');
    return true;
}],
['5 · niebla: el antiaéreo que no conoces no cuenta en la previsión; dispara entero y después se conoce', () => {
    const g = T.uiStart('es', true), es = g.player, fr = T.nation('fr');
    g.declareWar(es, fr); T.bare(g);
    const [base, target] = T.pair(g, es, fr);
    T.airfield(g, es, base); const [s] = T.squad(g, es, base, 1); g.fort[target] = 2; g.fortVersion++; T.site(g, fr, target);
    ui.setTool('air'); ui.clickCell(base); ui.clickCell(target);
    const o = g.missionOdds(es, [s], 'fort', target);
    T.eq([o.fire, o.unknown], [0, true], 'no cuenta');
    const text = () => document.querySelector('#card').textContent;
    T.ok(/Puede haber antiaéreo que no conoces/.test(text()), 'avisa');
    T.ok(/A ciegas: rinde la mitad/.test(text()), 'a ciegas');
    T.ok(!ui.view.airPick.known.some(k => k.cell === target), 'el mapa no lo dibuja');
    T.luck(g, 0.2);
    document.querySelector('[data-action="air-mission"][data-kind="fort"]').click();
    T.eq([g.fort[target], g.canFly(s)], [2, false], 'dispara entero: fracasa y vuelve dañado');
    T.ok(/Dañado: vuelve a volar el turno/.test(text()), 'dañado en la ficha');
    const [s2] = T.squad(g, es, base, 1);
    T.eq(g.missionOdds(es, [s2], 'fort', target).fire, 10, 'ahora lo conoces');
    ui.render();
    T.ok(ui.view.airPick.known.some(k => k.cell === target), 'y el mapa lo dibuja');
    return true;
}],
['5 · desde la ficha se compra un escuadrón y se construyen aeródromo y antiaéreo', () => {
    const g = T.uiStart('es'), es = g.player, cap = g.nations[es].capitalCell;
    g.nations[es].gold = 5000; T.bare(g);
    ui.setTool('air'); ui.clickCell(cap);
    document.querySelector('[data-action="air-build-field"]').click();
    T.ok(g.airfields.get(cap)?.left > 0, 'aeródromo en obra');
    document.querySelector('[data-action="air-build-aa"]').click();
    T.eq(g.aaSites.get(cap)?.left, 2, 'antiaéreo en obra');
    g.airfields.get(cap).left = 0; g.airVersion++; ui.clickCell(cap);
    document.querySelector('[data-action="air-buy"]').click();
    T.eq(g.squadronsAt(cap).length, 1, 'comprado');
    return true;
}],
['5 · la ficha quita y pone escuadrones, traslada a otro aeródromo y Esc deshace por pasos', () => {
    const g = T.uiStart('es'), es = g.player;
    T.bare(g);
    const [a, b] = T.pair(g, es, es, (x, y) => x !== y, 2, 20);
    T.airfield(g, es, a); T.airfield(g, es, b); const [s1, s2] = T.squad(g, es, a, 2);
    ui.setTool('air'); ui.clickCell(a);
    document.querySelector(`[data-action="air-pick"][data-id="${s1.id}"]`).click();
    T.eq([...ui.air.picked], [s2.id], 'quitado');
    ui.clickCell(b);
    T.eq(ui.air.target, b, 'el otro aeródromo es el blanco');
    T.ok(document.querySelector('[data-action="air-mission"][data-kind="patrol"]'), 'se puede proteger');
    document.querySelector('[data-action="air-rebase"]').click();
    T.eq([s1.base, s2.base, ui.air.base], [a, b, b], 'trasladado el elegido');
    ui.clickCell(a); ui.clickCell(g.nations[T.nation('fr')].capitalCell);
    T.ok(ui.air.target >= 0, 'blanco');
    ui.cancel(); T.eq([ui.tool, ui.air.target, ui.air.base], ['air', -1, a], 'Esc: el blanco');
    ui.cancel(); T.eq([ui.tool, ui.air.base, ui.air.picked.size], ['air', -1, 0], 'Esc: la base');
    ui.cancel(); T.eq(ui.tool, 'command', 'Esc: la herramienta');
    return true;
}],
['5 · en el mar solo se elige un blanco: sin escuadrones elegidos no hace nada', () => {
    const g = T.uiStart('es'), es = g.player;
    T.bare(g);
    const [, sea] = T.coast(g, es), base = T.baseFor(g, es, sea);
    T.airfield(g, es, base); T.squad(g, es, base, 1);
    ui.setTool('air'); ui.clickCell(sea);
    T.eq([ui.air.base, ui.air.target], [-1, -1], 'nada');
    ui.clickCell(base); ui.clickCell(sea);
    T.eq(ui.air.target, sea, 'blanco en el mar');
    T.ok(document.querySelector('[data-action="air-mission"][data-kind="patrol"]'), 'proteger el mar');
    return true;
}],
['5 · móvil: la ficha de Aviación va en la hoja inferior y no tapa el mapa', () => {
    const g = T.uiStart('es');
    T.ok(isMobile(), 'pantalla de móvil');
    ui.setSheet('media'); ui.setTool('air'); ui.clickCell(g.nations[g.player].capitalCell);
    const m = T.mobileCard();
    T.ok(!m.hidden && m.card > 0 && m.card <= m.stage * 0.42, `media: ${JSON.stringify(m)}`);
    ui.setSheet('mini'); const mini = T.mobileCard().card;
    ui.setSheet('grande'); const big = T.mobileCard().card;
    ui.setSheet('media');
    T.ok(mini <= 90 && big >= m.stage * 0.8, `tamaños de la hoja: ${mini}, ${big} de ${m.stage}`);
    return true;
}]
];

const exe = process.env.CHROME ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find(existsSync);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
let failed = 0, ran = 0;
try {
    // Las pruebas «M ·» usan el mapa del mundo; las «· móvil», el de Europa en una pantalla de teléfono como la de
    // smoke-vista; el resto, el de Europa.
    const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
    const pages = new Map();
    const pageFor = async kind => {
        if (pages.has(kind)) return pages.get(kind);
        const page = await browser.newPage(kind === 'movil' ? PHONE : {});
        page.errors = [];
        page.on('pageerror', e => page.errors.push(e.message));
        await page.goto(`http://localhost:${port}/?seed=7&mapa=${kind === 'mundo' ? 'mundo' : 'europa'}`);
        await page.waitForFunction(() => typeof GameEngine === 'function' && typeof ui === 'object');
        await page.evaluate(setup);
        pages.set(kind, page);
        return page;
    };
    for (const [name, fn] of CHECKS) {
        if (filter && !name.includes(filter)) continue;
        ran++;
        const page = await pageFor(name.startsWith('M ·') ? 'mundo' : name.includes('· móvil') ? 'movil' : 'europa');
        const result = await page.evaluate(`Promise.resolve().then(${fn.toString()}).catch(e => String(e && e.stack || e))`);
        if (result === true) console.log(`ok    ${name}`);
        else { failed++; console.log(`FALLA ${name}\n      ${String(result).split('\n').slice(0, 3).join('\n      ')}`); }
    }
    // Capturas de la herramienta Aviación con los escuadrones de la capital elegidos y un blanco: escritorio y móvil.
    const SHOTS = '5 · capturas de la ficha de Aviación';
    if (!filter || SHOTS.includes(filter)) {
        ran++;
        const out = join(root, 'tools/cache/smoke'), errors = [];
        mkdirSync(out, { recursive: true });
        for (const [file, opts] of [['aviacion-ficha', { viewport: { width: 1200, height: 800 } }], ['aviacion-ficha-movil', PHONE]]) {
            const page = await browser.newPage(opts);
            page.on('pageerror', e => errors.push(`${file}: ${e.message}`));
            await page.goto(`http://localhost:${port}/?seed=7&mapa=europa`);
            await page.waitForFunction(() => typeof GameEngine === 'function' && typeof ui === 'object');
            await page.evaluate(setup);
            await page.evaluate(() => {
                const g = T.uiStart('es'), es = g.player, fr = T.nation('fr'), cap = g.nations[es].capitalCell;
                g.declareWar(es, fr);
                const target = PROVINCES.filter(p => g.owner[p.city] === fr && hexDist(cap, p.city) <= g.airRange(es))
                    .sort((a, b) => hexDist(cap, a.city) - hexDist(cap, b.city))[0].city;
                g.fort[target] = 2; g.fortVersion++;
                ui.setTool('air'); ui.clickCell(cap); ui.clickCell(target);
            });
            await page.waitForFunction(() => ['ready', 'failed'].includes(ui.view.realistic.state), null, { timeout: 60000 });
            await page.evaluate(() => new Promise(r => { ui.view.centerOn(ui.air.target, 10); ui.render(); requestAnimationFrame(() => requestAnimationFrame(r)); }));
            await page.waitForTimeout(400);
            await page.screenshot({ path: join(out, `${file}.png`) });
            await page.close();
        }
        if (errors.length) { failed++; console.log(`FALLA ${SHOTS}\n      ${errors.join('\n      ')}`); }
        else console.log(`ok    ${SHOTS} (${join(out, 'aviacion-ficha.png')}, aviacion-ficha-movil.png)`);
    }
    for (const page of pages.values()) if (page.errors.length) { failed++; console.log(`FALLA errores en la página:\n      ${page.errors.join('\n      ')}`); }
} finally {
    await browser.close();
    server.close();
}
console.log(`${ran - Math.min(failed, ran)}/${ran} pruebas superadas`);
process.exit(failed ? 1 : 0);
