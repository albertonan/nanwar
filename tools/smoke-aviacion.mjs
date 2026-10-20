// Pruebas de la aviación en el navegador: escala, fortificaciones con nivel, escuadrones, antiaéreo y satélites.
// Sirve el juego por HTTP, crea partidas nuevas con GameEngine y comprueba las reglas una a una.
// Uso: node basicmilitary/tools/smoke-aviacion.mjs [filtro]   (CHROME=<ruta> para usar otro navegador)
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
}]
];

const exe = process.env.CHROME ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find(existsSync);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
let failed = 0, ran = 0;
try {
    // Las pruebas «M ·» usan el mapa del mundo; el resto, el de Europa.
    const pages = new Map();
    const pageFor = async mapa => {
        if (pages.has(mapa)) return pages.get(mapa);
        const page = await browser.newPage();
        page.errors = [];
        page.on('pageerror', e => page.errors.push(e.message));
        await page.goto(`http://localhost:${port}/?seed=7&mapa=${mapa}`);
        await page.waitForFunction(() => typeof GameEngine === 'function' && typeof ui === 'object');
        await page.evaluate(setup);
        pages.set(mapa, page);
        return page;
    };
    for (const [name, fn] of CHECKS) {
        if (filter && !name.includes(filter)) continue;
        ran++;
        const page = await pageFor(name.startsWith('M ·') ? 'mundo' : 'europa');
        const result = await page.evaluate(`Promise.resolve().then(${fn.toString()}).catch(e => String(e && e.stack || e))`);
        if (result === true) console.log(`ok    ${name}`);
        else { failed++; console.log(`FALLA ${name}\n      ${String(result).split('\n').slice(0, 3).join('\n      ')}`); }
    }
    for (const page of pages.values()) if (page.errors.length) { failed++; console.log(`FALLA errores en la página:\n      ${page.errors.join('\n      ')}`); }
} finally {
    await browser.close();
    server.close();
}
console.log(`${ran - Math.min(failed, ran)}/${ran} pruebas superadas`);
process.exit(failed ? 1 : 0);
