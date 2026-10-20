// Pruebas del agua en el navegador: ejércitos por mar (embarcar, navegar y desembarcar).
// Sirve el juego por HTTP, crea partidas nuevas con GameEngine y comprueba las reglas una a una.
// Uso: node basicmilitary-agua/tools/smoke-agua.mjs [filtro]   (CHROME=<ruta> para usar otro navegador)
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
['1 · embarcado: velocidad de mar completa, sin suministro ni rodeado que la recorte', () => {
    const g = T.game(), es = T.nation('es');
    g.start(es);
    const [, s] = T.coast(g, es);
    const a = T.embark(g, es, s, 3);
    T.eq(g.mp(a), 6 * MOVE, 'seis casillas');
    return true;
}],
['1 · un barco enemigo no rodea, no frena y no hace zona de control en la costa', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); g.declareWar(es, fr);
    const [c, s] = T.coast(g, es);
    const a = T.army(g, es, c, 3);
    const before = g.mp(a);
    T.embark(g, fr, s, 20);
    T.eq([g.hostileSides(es, c), g.zoc(c, es), g.mp(a)], [0, false, before], 'sin presión');
    return true;
}],
['1 · un barco propio no salva de «aislado» y el embarcado no tiene estado de tierra', () => {
    const g = T.game(), es = T.nation('es');
    g.start(es);
    const [c, s] = T.coast(g, es);
    const a = T.army(g, es, c, 3), b = T.embark(g, es, s, 3);
    T.ok(g.isolated(es, c, a.id), 'el barco no cuenta como apoyo');
    T.eq(g.armyState(es, s, b.units, b.id).parts, [], 'sin partes en el mar');
    return true;
}],
['1 · una partida guardada con un ejército en el mar lo conserva', () => {
    const g = T.game(), es = T.nation('es');
    g.start(es);
    const [, s] = T.coast(g, es);
    const a = T.embark(g, es, s, 4);
    const h = GameEngine.load(JSON.parse(JSON.stringify(g.serialize())));
    T.eq([h.armies.get(a.id)?.cell, countUnits(h.armies.get(a.id)?.units ?? {})], [s, 4], 'en su casilla');
    return true;
}],
['1 · SEA_PROV da la provincia de la costa más cercana', () => {
    const g = T.game(), es = T.nation('es');
    const [c, s] = T.coast(g, es);
    T.ok(SEA_PROV[s] >= 0 && SEA_PROV[c] === G.prov[c], 'costa');
    return true;
}],
['2 · desde la costa se embarca y el turno acaba', () => {
    const g = T.game(), es = T.nation('es');
    g.start(es);
    const [c, s] = T.coast(g, es);
    const a = T.army(g, es, c, 3);
    const r = g.reach(es, c, g.mp(a), true);
    T.ok(g.destinations(r).has(s), 'el mar es destino');
    const b = g.moveArmy(a, s, r);
    T.eq([b.cell, b.used], [s, 999], 'embarcado y sin movimiento');
    g.beginNationTurn(es);
    T.eq(g.mp(g.armies.get(b.id)), 6 * MOVE, 'al turno siguiente navega entero');
    return true;
}],
['2 · embarcado navega 6 casillas por el mar y no atraviesa barcos ajenos', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es);
    const [, s] = T.coast(g, es);
    const a = T.embark(g, es, s, 3);
    const r = g.reach(es, s, g.mp(a));
    const far = Math.max(...[...r.exp].filter(([v]) => !isLand(v)).map(([, e]) => e.cost));
    T.eq(far, 6 * MOVE, 'seis casillas como mucho');
    const blocker = G.nb[s * 6 + [0, 1, 2, 3, 4, 5].find(d => { const j = G.nb[s * 6 + d]; return j >= 0 && !isLand(j); })];
    T.embark(g, fr, blocker, 1);
    T.ok(!g.reach(es, s, g.mp(a)).exp.has(blocker), 'la casilla ocupada corta el paso');
    return true;
}],
['2 · embarcado desembarca en una costa vecina y gasta el turno', () => {
    const g = T.game(), es = T.nation('es');
    g.start(es);
    const [c, s] = T.coast(g, es);
    const a = T.embark(g, es, s, 3);
    const r = g.reach(es, s, g.mp(a));
    T.ok(r.term.get(c)?.landing, 'desembarco');
    T.eq(g.moveArmy(a, c, r).used, 999, 'turno gastado');
    return true;
}],
['2 · un ejército de tierra ataca desde tierra aunque el salto por mar sea más barato', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); g.declareWar(es, fr);
    const nbs = c => [0, 1, 2, 3, 4, 5].map(d => G.nb[c * 6 + d]).filter(j => j >= 0);
    // Costa c con mar s; enemigo en t, vecina de s y de la tierra l (vecina de c), pero no de c.
    let set = null;
    for (const c of G.land) {
        if (set || g.owner[c] !== es || CITY_OF[c] >= 0 || g.armyAt[c] || !g.inSupply(es, c) || nbs(c).some(j => isLand(j) && g.armyAt[j])) continue;
        for (const s of nbs(c).filter(j => T.seaFree(g, j))) {
            const t = nbs(s).find(j => isLand(j) && j !== c && !nbs(c).includes(j) && !g.armyAt[j] && CITY_OF[j] < 0
                && nbs(c).some(l => isLand(l) && g.owner[l] === es && !g.armyAt[l] && nbs(j).includes(l)));
            if (t !== undefined) { set = [c, s, t]; break; }
        }
    }
    T.ok(set, 'no hay costa así');
    const [c, s, t] = set;
    const a = T.army(g, es, c, 3);
    T.army(g, fr, t, 1);
    const r = g.reach(es, c, g.mp(a), true);
    T.ok(r.exp.get(s)?.hop && r.attacks.has(t), 'el salto y el ataque existen');
    T.ok(isLand(r.attacks.get(t)), `ataca desde ${r.attacks.get(t)}, que es de mar`);
    return true;
}],
['2 · un ejército rodeado no huye al mar', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); g.declareWar(es, fr);
    const nbs = c => [0, 1, 2, 3, 4, 5].map(d => G.nb[c * 6 + d]).filter(j => j >= 0);
    // Costa con 3 vecinas de tierra o más, todas libres, y una de mar libre: el enemigo ocupa toda la tierra.
    const c = G.land.find(c => g.owner[c] === es && CITY_OF[c] < 0 && !g.armyAt[c] && nbs(c).some(j => T.seaFree(g, j))
        && nbs(c).filter(isLand).length >= 3 && nbs(c).every(j => !isLand(j) || (!g.armyAt[j] && CITY_OF[j] < 0)));
    T.ok(c !== undefined, 'no hay costa así');
    const a = T.army(g, es, c, 3);
    for (const j of nbs(c).filter(isLand)) T.army(g, fr, j, 1);
    const r = g.reach(es, c, g.mp(a), true);
    T.ok([...g.destinations(r)].some(afloat), 'el mar es destino');
    g.flee(a, r);
    T.ok(isLand(g.armies.get(a.id).cell), 'sigue en tierra');
    return true;
}],
['2 · embarcar sobre un barco propio los une', () => {
    const g = T.game(), es = T.nation('es');
    g.start(es);
    const [c, s] = T.coast(g, es);
    const a = T.army(g, es, c, 3);
    T.embark(g, es, s, 2);
    const r = g.reach(es, c, g.mp(a), true);
    T.ok(r.term.get(s)?.embark, 'se puede embarcar');
    g.moveArmy(a, s, r);
    const at = [...g.armies.values()].filter(x => x.cell === s);
    T.eq([at.length, countUnits(at[0].units)], [1, 5], 'un solo ejército con las cinco');
    return true;
}],
['M · cruce corto: de España a Marruecos en un turno, desembarcando', () => {
    const g = T.game(), es = T.nation('es'), ma = T.nation('ma');
    g.start(es); g.declareWar(es, ma);
    const [a0, , b] = T.strait(g, es, ma);
    const a = T.army(g, es, a0, 3);
    const r = g.reach(es, a0, g.mp(a), true);
    T.ok(r.term.get(b)?.landing, 'llega a la otra orilla');
    return true;
}],
['2 · embarcado navega a otra casilla de mar y le queda movimiento', () => {
    const g = T.game(), es = T.nation('es');
    g.start(es);
    const [, s] = T.coast(g, es);
    const a = T.embark(g, es, s, 3);
    const r = g.reach(es, s, g.mp(a));
    const v = [...r.exp].find(([j, e]) => !isLand(j) && e.cost === 2 * MOVE)[0];
    T.ok(g.destinations(r).has(v), 'el mar es destino');
    const b = g.moveArmy(a, v, r);
    T.eq([b.cell, b.used, g.mp(b)], [v, 2 * MOVE, 4 * MOVE], 'navega dos casillas y le quedan cuatro');
    return true;
}],
['M · el cruce corto lleva el ejército a la otra orilla pasando por el mar', () => {
    const g = T.game(), es = T.nation('es'), ma = T.nation('ma');
    g.start(es); g.declareWar(es, ma);
    const [a0, , b] = T.strait(g, es, ma);
    const a = T.army(g, es, a0, 3);
    const moved = g.moveArmy(a, b, g.reach(es, a0, g.mp(a), true));
    const cells = g.motion[g.motion.length - 1].cells;
    T.eq([moved.cell, moved.used, g.owner[b], cells.length, afloat(cells[1])], [b, 999, es, 3, true], 'tierra, mar y tierra');
    return true;
}],
['M · desde tierra no se encadenan dos casillas de mar', () => {
    const g = T.game(), es = T.nation('es');
    g.start(es);
    const [c] = T.coast(g, es);
    const a = T.army(g, es, c, 3);
    const r = g.reach(es, c, g.mp(a), true);
    for (const [v, e] of r.exp) if (!isLand(v)) T.ok(isLand(e.prev), `la casilla de mar ${v} viene de tierra`);
    return true;
}],
['3 · asalto anfibio ×0,5 y defensa embarcada ×0,25', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); g.declareWar(es, fr);
    const [c, s] = T.coast(g, es);
    const def = T.army(g, es, c, 5), boat = T.embark(g, fr, s, 5);
    const fx = g.combatFactors(fr, boat.units, s, def, c, boat.id);
    T.eq(fx.attParts, [['asalto anfibio', 0.5]], 'asalto');
    const fy = g.combatFactors(es, def.units, c, boat, s, def.id);
    T.eq([fy.parts, fy.dfn], [[['embarcado', 0.25]], Math.max(0.5, unitPower(boat.units, 'def', g.rules(fr)) * 0.25)], 'barco');
    return true;
}],
['3 · el de tierra que gana a un barco se queda en la orilla y el barco sin costa propia se hunde', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); g.declareWar(es, fr);
    const [c, s] = T.coast(g, es);
    const att = T.army(g, es, c, 30), boat = T.embark(g, fr, s, 2);
    g.battle(att, boat, s);
    T.eq([att.cell, g.armies.has(boat.id), g.armyAt[s]], [c, false, 0], 'orilla y hundido');
    T.ok(g.logs.some(l => /hund/i.test(l.msg)), 'el parte dice hundido');
    return true;
}],
['3 · el barco que pierde con costa propia al lado se retira a ella', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); g.declareWar(es, fr);
    const [c, s] = T.coast(g, es);
    const boat = T.embark(g, es, s, 12);
    const enemySea = G.nb[s * 6 + [0, 1, 2, 3, 4, 5].find(d => { const j = G.nb[s * 6 + d]; return j >= 0 && !isLand(j); })];
    const att = T.embark(g, fr, enemySea, 12);
    g.battle(att, boat, s);
    T.eq([att.cell, isLand(g.armies.get(boat.id)?.cell ?? -1)], [enemySea, true], 'el atacante no se mueve; el barco toca tierra');
    return true;
}],
['3 · un asalto que gana entra en la casilla de tierra', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); g.declareWar(es, fr);
    const [c, s] = T.coast(g, es);
    const def = T.army(g, es, c, 1), boat = T.embark(g, fr, s, 40);
    g.battle(boat, def, c);
    T.eq(boat.cell, c, 'desembarca');
    return true;
}],
['4 · Transporte naval acelera los barcos y mejora el asalto', () => {
    const g = T.game(), es = T.nation('es');
    g.start(es);
    const [, s] = T.coast(g, es);
    const a = T.embark(g, es, s, 3);
    T.learn(g, es, 'naval1');
    T.eq(g.mp(a), 8 * MOVE, 'nivel 1');
    T.learn(g, es, 'naval2', 'naval3');
    T.eq([g.mp(a), g.rules(es).amphibious], [10 * MOVE, 0.65], 'niveles 2 y 3');
    return true;
}],
['4 · el árbol tiene 16 ramas y 48 investigaciones', () => { T.eq([RESEARCH_BRANCHES.length, TECHS.length], [16, 48], 'árbol'); return true; }],
['M · una orden de marcha lleva un ejército de la península a Canarias en 5 turnos o menos', () => {
    const g = T.game(), es = T.nation('es');
    g.start(es);
    const can = PROVINCES.find(p => p.name === 'Canarias'), city = can.city;
    g.armyOn(city) && g.removeArmy(g.armyOn(city));
    const [c] = T.coast(g, es, { near: city, skip: can.id });
    const a = T.army(g, es, c, 3);
    T.ok(g.setOrder(a, { kind: 'march', dest: city }), 'orden aceptada');
    let turns = 0, b = a;
    while (b.cell !== city && turns < 8) { g.beginNationTurn(es); g.stepOrder(b); b = [...g.armies.values()].find(x => x.owner === es && countUnits(x.units) === 3 && (x.id === a.id || x.cell === city)) ?? b; turns++; }
    T.ok(b.cell === city && turns <= 5, `llega en ${turns} turnos`);
    return true;
}],
['M · la ficha de la orden cuenta los turnos por mar como se navegan', () => {
    const g = T.game(), es = T.nation('es');
    g.start(es);
    const can = PROVINCES.find(p => p.name === 'Canarias'), city = can.city;
    g.armyOn(city) && g.removeArmy(g.armyOn(city));
    const [c] = T.coast(g, es, { near: city, skip: can.id });
    const a = T.army(g, es, c, 3);
    g.setOrder(a, { kind: 'march', dest: city });
    const eta = a.order.eta;
    let turns = 0, b = a;
    while (b.cell !== city && turns < 8) { g.beginNationTurn(es); g.stepOrder(b); b = [...g.armies.values()].find(x => x.owner === es && countUnits(x.units) === 3 && (x.id === a.id || x.cell === city)) ?? b; turns++; }
    T.eq(eta, turns, 'turnos previstos');
    return true;
}],
['5 · en una ofensiva, el barco junto a la costa espera 2 turnos como mucho a otro que aún navega', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); g.declareWar(es, fr);
    const [c, s] = T.coast(g, fr);
    const open = j => T.seaFree(g, j) && [0, 1, 2, 3, 4, 5].every(d => { const x = G.nb[j * 6 + d]; return x < 0 || !isLand(x); });
    const far = [...g.nearCells(s, 4)].find(([j, d]) => d === 4 && open(j))?.[0];
    T.ok(far !== undefined, 'no hay alta mar cerca');
    const a = T.embark(g, es, s, 3), b = T.embark(g, es, far, 3);
    const op = g.createOp(es, 'ofensiva', [g.nations[es].capitalCell, c], { noCap: true });
    a.op = b.op = op.id;
    g.setOrder(b, { kind: 'hold' });   // el otro se queda donde está: la ofensiva no lo mueve
    const cells = [];
    for (let t = 0; t < 3; t++) { g.executeOp(op); cells.push(g.armies.get(a.id)?.cell); g.turn++; g.beginNationTurn(es); }
    T.eq(cells, [s, s, c], 'espera dos turnos y desembarca');
    return true;
}],
['5 · la orden prefiere no terminar el turno en una casilla de mar expuesta', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); g.declareWar(es, fr);
    const [, s] = T.coast(g, es);
    T.ok(g.exposedAtSea(es, s) === false, 'libre');
    const n = G.nb[s * 6 + [0, 1, 2, 3, 4, 5].find(d => { const j = G.nb[s * 6 + d]; return j >= 0 && !isLand(j); })];
    T.embark(g, fr, n, 1);
    T.ok(g.exposedAtSea(es, s), 'expuesta');
    return true;
}],
['5 · un barco enemigo cerca de la costa cuenta como amenaza', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); g.declareWar(es, fr);
    const [c, s] = T.coast(g, es);
    const before = g.threat(es, c);
    T.embark(g, fr, s, 3);
    T.ok(g.threat(es, c) > before, `amenaza ${before} → ${g.threat(es, c)}`);
    return true;
}],
['M · la IA ataca un barco enemigo que tiene a tiro', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); g.declareWar(fr, es);
    const [c, s] = T.coast(g, fr);
    T.army(g, fr, c, 10);
    const boat = T.embark(g, es, s, 3);
    g.aiArmies(fr);
    T.ok(!g.armies.has(boat.id) || g.armies.get(boat.id).cell !== s, 'el barco ha caído o se ha retirado');
    return true;
}],
['M · una paz entre otros dos países deja en su sitio un barco en el mar', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr'), de = T.nation('de');
    g.start(es); g.declareWar(fr, de);
    const [, s] = T.coast(g, es), [, t] = T.coast(g, fr);
    const mine = T.embark(g, es, s, 3), theirs = T.embark(g, fr, t, 3);
    g.settlePeace(fr, de, { mode: 'white' });
    T.eq([g.armies.get(mine.id)?.cell, g.armies.get(theirs.id)?.cell], [s, t], 'los dos barcos siguen en el mar');
    return true;
}],
['M · un barco de la IA en paz vuelve a su costa', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es);
    T.eq(g.enemiesOf(fr), [], 'precondición: Francia en paz');
    const [, s] = T.coast(g, fr);
    const nbs = j => [0, 1, 2, 3, 4, 5].map(d => G.nb[j * 6 + d]).filter(x => x >= 0);
    const far = [...g.nearCells(s, 3)].find(([j, d]) => d === 3 && T.seaFree(g, j) && nbs(j).every(x => !isLand(x)))?.[0];
    T.ok(far !== undefined, 'no hay alta mar cerca');
    const a = T.embark(g, fr, far, 3);
    const cells = [];
    for (let t = 0; t < 4; t++) {
        g.beginNationTurn(fr); g.aiArmies(fr);
        const b = g.armies.get(a.id);
        cells.push(b?.cell);
        if (b && isLand(b.cell)) break;
    }
    const b = g.armies.get(a.id);
    T.ok(b && isLand(b.cell) && g.owner[b.cell] === fr, `casillas: ${cells.map(j => (j === undefined ? '—' : afloat(j) ? 'mar' : PROVINCES[G.prov[j]].name)).join(', ')}`);
    return true;
}],
['M · el espía de la provincia de la costa ve el barco', () => {
    const g = T.game(7, true), es = T.nation('es'), fr = T.nation('fr');
    g.start(es);
    const [, s] = T.coast(g, fr);
    const boat = T.embark(g, fr, s, 3);
    g.spies.set(SEA_PROV[s], { since: g.turn, revealedTurn: g.turn }); g.spyVersion++;
    T.ok(g.intel(es, fr, s).exact, 'sabe tipo y número');
    return true;
}],
['5 · una orden en el mar no termina en una casilla expuesta si tiene otra', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); g.declareWar(es, fr);
    const [c, s] = T.coast(g, es);
    const nbs = j => [0, 1, 2, 3, 4, 5].map(d => G.nb[j * 6 + d]).filter(x => x >= 0);
    const open = j => T.seaFree(g, j) && nbs(j).every(x => !isLand(x));
    // Alta mar a 9 casillas de la costa: desde allí no se llega en un turno a esa costa.
    const far = [...g.nearCells(s, 9)].find(([j, d]) => d === 9 && open(j))?.[0];
    T.ok(far !== undefined, 'no hay alta mar lejos');
    const a = T.embark(g, es, far, 3);
    T.ok(g.setOrder(a, { kind: 'march', dest: c }), 'orden aceptada');
    // La casilla más directa a la que llega, y un barco enemigo pegado a ella por detrás.
    const f = g.orderField(es, c), r = g.reach(es, far, g.mp(a));
    const sea = [...g.destinations(r)].filter(v => afloat(v) && f.to(v) < Infinity);
    const best = sea.reduce((x, y) => (f.dist[y] < f.dist[x] ? y : x));
    const behind = nbs(best).filter(j => T.seaFree(g, j)).sort((x, y) => f.dist[y] - f.dist[x])[0];
    T.embark(g, fr, behind, 1);
    T.ok(g.exposedAtSea(es, best), 'la más directa queda expuesta');
    T.eq(g.stepOrder(a), 'moved', 'avanza');
    const b = g.armies.get(a.id);
    T.ok(b.cell !== far && !g.exposedAtSea(es, b.cell), `acaba en ${b.cell}, expuesta`);
    // La expuesta cuenta tres casillas de mar más: si todo lo que está a menos de dos pasos de mar de la más directa
    // estuviera expuesto, aun así prefiere una casilla segura dos pasos más atrás.
    const h = T.game();
    h.start(es); h.declareWar(es, fr);
    const a2 = T.embark(h, es, far, 3);
    h.setOrder(a2, { kind: 'march', dest: c });
    const f2 = h.orderField(es, c), r2 = h.reach(es, far, h.mp(a2));
    const dests = [...h.destinations(r2)].filter(v => f2.to(v) < f2.to(far));
    const minD = Math.min(...dests.filter(afloat).map(v => f2.dist[v])), cut = minD + 2 * 3 * MOVE;
    h.exposedAtSea = (o, v) => afloat(v) && f2.dist[v] < cut;
    // Con la penalización de una sola casilla de mar, la expuesta más directa (minD + 3 MOVE) ganaría a todas estas.
    T.ok(dests.some(v => !h.exposedAtSea(es, v) && f2.dist[v] > minD + 3 * MOVE && f2.dist[v] < minD + 3 * 3 * MOVE), 'hay una segura algo más atrás');
    h.stepOrder(a2);
    T.ok(!h.exposedAtSea(es, h.armies.get(a2.id).cell), 'acaba en una casilla segura');
    return true;
}],
['M · una orden que solo puede seguir por un mar expuesto embarca igualmente', () => {
    const g = T.game(), es = T.nation('es');
    g.start(es);
    const can = PROVINCES.find(p => p.name === 'Canarias'), city = can.city;
    g.armyOn(city) && g.removeArmy(g.armyOn(city));
    const [c] = T.coast(g, es, { near: city, skip: can.id });
    const a = T.army(g, es, c, 3);
    g.setOrder(a, { kind: 'march', dest: city });
    // Lo pone en la casilla del camino donde embarca.
    const path = a.order.path, k = path.findIndex((j, i) => isLand(j) && afloat(path[i + 1]));
    g.armyAt[c] = 0; a.cell = path[k]; g.settle(a);
    g.setOrder(a, { kind: 'march', dest: city });
    T.ok(afloat(a.order.path[1]), 'el camino embarca enseguida');
    g.exposedAtSea = (o, v) => afloat(v);   // todo el mar, expuesto
    T.eq(g.stepOrder(a), 'moved', 'no se queda bloqueada');
    T.ok(afloat(g.armies.get(a.id).cell), 'embarca');
    return true;
}],
['M · la IA lleva por mar un ejército que no tiene camino por tierra', () => {
    const g = T.game(), es = T.nation('es'), ma = T.nation('ma');
    g.start(ma); g.declareWar(es, ma);
    // Un ejército libre en Canarias: hasta Marruecos solo se llega por mar.
    const can = PROVINCES.find(p => p.name === 'Canarias');
    const cell = can.cells.find(j => CITY_OF[j] < 0 && !g.armyAt[j]);
    const a = T.army(g, es, cell, 5);
    T.ok(g.landSteps(es, PROVINCES.filter(p => g.owner[p.city] === ma).map(p => p.city))[cell] >= 1e9, 'sin camino por tierra');
    const cells = [];
    for (let t = 0; t < 8 && g.armies.has(a.id); t++) {
        g.beginNationTurn(es); g.aiArmies(es);
        const b = g.armies.get(a.id);
        if (b) cells.push(b.cell);
        if (b && isLand(b.cell) && g.legal[b.cell] === ma) break;
    }
    const sailed = cells.findIndex(afloat), landed = cells.findIndex(j => isLand(j) && g.legal[j] === ma);
    T.ok(sailed >= 0 && landed > sailed, `casillas: ${cells.map(j => (afloat(j) ? 'mar' : PROVINCES[G.prov[j]].name)).join(', ')}`);
    return true;
}],
['6 · se elige un barco propio en el mar y se le mueve con un clic', () => {
    const g = T.uiStart('es'), es = g.player;
    const [c, s] = T.coast(g, es);
    const a = T.embark(g, es, s, 3);
    ui.clickCell(s);
    T.eq(ui.selectedArmy()?.id, a.id, 'elegido');
    ui.clickCell(c);
    T.eq(g.armies.get(a.id)?.cell ?? g.armyOn(c)?.cell, c, 'desembarcado');
    return true;
}],
['6 · la ficha del barco dice «Embarcado: defensa ×0,25»', () => {
    const g = T.uiStart('es'), es = g.player;
    const [, s] = T.coast(g, es);
    T.embark(g, es, s, 3);
    ui.select(s);
    T.ok(/Embarcado: defensa ×0,25/.test(document.body.textContent), 'texto');
    return true;
}],
['6 · una orden con Mayúsculas a una casilla de mar se acepta', () => {
    const g = T.uiStart('es'), es = g.player;
    const [c, s] = T.coast(g, es);
    const a = T.army(g, es, c, 3);
    ui.select(c); ui.clickCell(s, true);
    T.ok(g.armies.get(a.id)?.order || g.armyOn(s), 'orden o embarque');
    return true;
}],
['6 · la ficha avisa de que el barco se hunde si no tiene costa propia libre al lado', () => {
    const g = T.uiStart('es'), es = g.player, fr = T.nation('fr');
    const [c, s] = T.coast(g, es);
    T.embark(g, es, s, 3);
    ui.select(s);
    T.ok(!/se hunde/.test($('#card').textContent), 'con costa propia libre, no se hunde');
    for (let d = 0; d < 6; d++) { const j = G.nb[s * 6 + d]; if (j >= 0 && isLand(j) && !g.armyAt[j]) T.army(g, g.owner[j] === es ? es : fr, j, 1); }
    T.eq(g.retreatCell(g.armyOn(s), s), -1, 'sin costa libre');
    ui.select(s);
    T.ok(/Si pierde un combate, se hunde/.test($('#card').textContent), 'aviso de hundimiento');
    return true;
}],
['6 · la tarjeta al pasar el ratón enseña el barco «En el mar», sin terreno, y nada bajo la niebla', () => {
    const g = T.uiStart('es', true), es = g.player, fr = T.nation('fr');
    const [, s] = T.coast(g, es);
    T.embark(g, es, s, 3);
    const txt = T.hover(s);
    T.ok(/En el mar/.test(txt) && /Ejército de España/.test(txt) && /Embarcado: defensa ×0,25/.test(txt), 'barco propio: ' + txt);
    T.ok(!/mover cuesta/.test(txt), 'sin terreno: ' + txt);
    const [, t] = T.coast(g, fr, { near: g.nations[fr].capitalCell });
    T.embark(g, fr, t, 5);
    T.ok(!g.sees(es, t), 'precondición: el barco francés no se ve');
    const fog = T.hover(t);
    T.ok(!/Ejército de/.test(fog), 'bajo la niebla no se enseña el barco: ' + fog);
    return true;
}],
['6 · un barco enemigo a la vista sin inteligencia sale sin tipo ni número', () => {
    const g = T.uiStart('es', true), es = g.player, fr = T.nation('fr');
    const [, s] = T.coast(g, es);
    const b = T.embark(g, fr, s, 5);
    T.ok(g.sees(es, s) && !g.intel(es, fr, s).exact, 'precondición: se ve sin identificar');
    T.ok(/sin identificar/.test(T.hover(s)), 'escalón sin identificar');
    ui.view.setMode('sencilla');
    const seen = new Map(), orig = ui.view.drawCounter;
    ui.view.drawCounter = function (t, ...rest) { seen.set(t.id, t); return orig.call(this, t, ...rest); };
    try { ui.view.scale = 1; ui.view.centerOn(s, 14); ui.view.draw(); } finally { delete ui.view.drawCounter; }
    const t = seen.get(b.id);
    T.ok(t && t.afloat && t.type === null && t.n === null, 'ficha redonda y vacía: ' + JSON.stringify(t && { afloat: t.afloat, type: t.type, n: t.n }));
    return true;
}],
['6 · la leyenda explica el mar con las cifras de tu investigación', () => {
    const g = T.uiStart('es'), es = g.player;
    const txt = () => $('#legend').textContent;
    T.ok(/Mar: .*navega 6 casillas.*×0,25.*asalto anfibio ×0,5.*se hunde/.test(txt()), 'entrada Mar: ' + txt());
    T.learn(g, es, 'naval1', 'naval2'); ui.render();
    T.ok(/navega 8 casillas.*asalto anfibio ×0,65/.test(txt()), 'con Transporte naval');
    return true;
}],
['6 · el panel Mando se dibuja con un ejército de una operación en el mar', () => {
    const g = T.uiStart('es'), es = g.player;
    const [c, s] = T.coast(g, es);
    const a = T.embark(g, es, s, 3);
    const op = g.createOp(es, 'reserva', [c], { noCap: true });
    a.op = op.id;
    ui.focusOp = op.id; ui.tab = 'mando'; ui.drawerOpen = true; ui.render();
    T.ok(/el mar junto a/.test($('#drawer-body').textContent), 'el miembro sale en el mar: ' + $('#drawer-body').textContent.slice(0, 300));
    return true;
}],
['6 · con niebla, navegar de una casilla de mar a otra deja un trazo animado', () => {
    const g = T.uiStart('es', true), es = g.player;
    const [, s] = T.coast(g, es);
    const a = T.embark(g, es, s, 3);
    const r = g.reach(es, s, g.mp(a));
    const v = [...r.exp].find(([j, e]) => !isLand(j) && e.cost === 2 * MOVE && !g.armyAt[j])[0];
    g.motion.length = 0; ui.view.motion.clear();
    g.moveArmy(a, v, r);
    ui.view.motion.consume(performance.now());
    const has = ui.view.motion.tracks.has(a.id);
    ui.view.motion.clear();   // que el trazo no pase a las pruebas siguientes (otra partida reusa los números de ejército)
    T.ok(has, 'sin trazo para el barco');
    return true;
}],
['6 · en la vista sencilla el barco tiene t.afloat y el ejército de tierra no', () => {
    const g = T.uiStart('es'), es = g.player;
    const [c, s] = T.coast(g, es);
    const land = T.army(g, es, c, 2), ship = T.embark(g, es, s, 3);
    ui.view.setMode('sencilla');
    const seen = new Map(), orig = ui.view.drawCounter;
    ui.view.drawCounter = function (t, ...rest) { seen.set(t.id, t.afloat); return orig.call(this, t, ...rest); };
    try { ui.view.scale = 1; ui.view.centerOn(s, 14); ui.view.draw(); } finally { delete ui.view.drawCounter; }
    T.eq([seen.get(ship.id), seen.get(land.id)], [true, false], 'afloat');
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
    // Capturas de un barco en las dos vistas (tools/cache/smoke/agua-*.png): un círculo en la sencilla y un casco en la
    // realista, junto a un ejército en tierra para comparar.
    const SHOTS = '6 · capturas de un barco en las dos vistas';
    if (!filter || SHOTS.includes(filter)) {
        ran++;
        const out = join(root, 'tools/cache/smoke');
        mkdirSync(out, { recursive: true });
        const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
        page.errors = [];
        page.on('pageerror', e => page.errors.push(e.message));
        await page.goto(`http://localhost:${port}/?seed=7&mapa=europa`);
        await page.waitForFunction(() => typeof GameEngine === 'function' && typeof ui === 'object');
        await page.evaluate(setup);
        const s = await page.evaluate(() => {
            const g = T.uiStart('es'), es = g.player, fr = T.nation('fr');
            const [c, s] = T.coast(g, es);
            T.army(g, es, c, 4, 2);
            T.embark(g, es, s, 6);
            const other = [0, 1, 2, 3, 4, 5].map(d => G.nb[s * 6 + d]).find(j => j >= 0 && T.seaFree(g, j));
            if (other !== undefined) g.settle(g.newArmy(es, other, { infantry: 0, tank: 3, artillery: 0 }, 0));
            const far = [...g.nearCells(s, 3).keys()].find(j => T.seaFree(g, j) && G.dirTo(j, s) < 0 && G.dirTo(j, other) < 0);
            if (far !== undefined) T.embark(g, fr, far, 4);
            ui.select(-1);
            return s;
        });
        await page.waitForFunction(() => ui.view.realistic.state === 'ready' || ui.view.realistic.state === 'failed', null, { timeout: 60000 });
        const shot = async (name, mode) => {
            await page.evaluate(([m, c]) => new Promise(r => { ui.view.setMode(m); ui.view.scale = 1; ui.view.centerOn(c, 30); ui.view.draw(); requestAnimationFrame(() => requestAnimationFrame(r)); }), [mode, s]);
            await page.waitForTimeout(400);
            await page.screenshot({ path: join(out, `${name}.png`) });
        };
        await shot('agua-sencilla', 'sencilla');
        await shot('agua-realista', 'realista');
        const state = await page.evaluate(() => ui.view.realistic.state);
        if (state !== 'ready' || page.errors.length) { failed++; console.log(`FALLA ${SHOTS}\n      vista realista: ${state}; ${page.errors.join('; ')}`); }
        else console.log(`ok    ${SHOTS} (${join(out, 'agua-sencilla.png')}, agua-realista.png)`);
        await page.close();
    }
    for (const page of pages.values()) if (page.errors.length) { failed++; console.log(`FALLA errores en la página:\n      ${page.errors.join('\n      ')}`); }
} finally {
    await browser.close();
    server.close();
}
console.log(`${ran - Math.min(failed, ran)}/${ran} pruebas superadas`);
process.exit(failed ? 1 : 0);
