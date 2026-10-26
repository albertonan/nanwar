// Pruebas de los drones y la defensa automática en el navegador: ramas de investigación, enjambres, baterías y escolta.
// Sirve el juego por HTTP, crea partidas nuevas con GameEngine y comprueba las reglas una a una.
// Uso: node basicmilitary/tools/smoke-drones.mjs [filtro]   (CHROME=<ruta> para usar otro navegador)
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
            for (const k of ['squadrons', 'airfields', 'aaSites', 'sats', 'swarms', 'batteries', 'defUsed']) {
                const x = g[k];
                if (x instanceof Map || x instanceof Set) x.clear(); else if (Array.isArray(x)) x.length = 0;
            }
            g.airVersion++;
        },
        // Aeródromo terminado y en servicio de `owner` en `cell`.
        airfield(g, owner, cell) { g.airfields.set(cell, { owner, left: 0, downUntil: 0 }); g.airVersion++; },
        // `n` escuadrones de `owner` en el aeródromo `base`, listos para volar.
        squad(g, owner, base, n = 1) { return Array.from({ length: n }, () => g.newSquadron(owner, base, 0)); },
        // `n` enjambres de `owner` en la ciudad `base`, listos para volar.
        swarm(g, owner, base, n = 1) { return Array.from({ length: n }, () => g.newSwarm(owner, base, 0)); },
        // Antiaéreo fijo terminado de `owner` en `cell`, sin daños y sin que nadie lo conozca.
        site(g, owner, cell) { const s = { owner, left: 0, hits: 0, known: new Set() }; g.aaSites.set(cell, s); g.airVersion++; return s; },
        // Batería automática terminada de `owner` en `cell`, sin usar y sin que nadie la conozca.
        battery(g, owner, cell) { const b = { owner, left: 0, known: new Set(), used: 0 }; g.batteries.set(cell, b); g.airVersion++; return b; },
        // Sin antiaéreo integrado: las ciudades con casamatas bajan a búnkeres.
        noIntegrated(g) { for (const p of PROVINCES) if (g.fort[p.city] === 4) g.fort[p.city] = 3; g.fortVersion++; },
        // Tierra de `owner` (no lago), sin ciudad, y sin ejércitos ni tierra de otro a `R` casillas o menos: un blanco limpio.
        clear(g, owner, R = 1, skip = 0) {
            for (const c of G.land) {
                if (g.owner[c] !== owner || CELL_TERRAIN[c] === 'lake' || CITY_OF[c] >= 0) continue;
                if (hexDisc(c, R).every(j => !g.armyAt[j] && (!isLand(j) || g.owner[j] === owner)) && skip-- <= 0) return c;
            }
            throw new Error('no hay casilla limpia');
        },
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
['B1 · dos ramas nuevas en Inteligencia con tres niveles', () => {
    for (const [id, name, icon] of [['drones', 'Drones', 'uav'], ['defensa', 'Defensa automática', 'cram']]) {
        const b = BRANCH_BY_ID.get(id);
        T.ok(b && b.area === 'Inteligencia' && b.name === name && b.icon === icon && RS_ICON[icon], `rama ${id}`);
        T.eq([1, 2, 3].map(i => TECH_BY_ID.has(`${id}${i}`)), [true, true, true], `niveles de ${id}`);
        for (const i of [1, 2, 3]) { const t = TECH_BY_ID.get(`${id}${i}`); T.ok(t.changes.length && t.note, `filas y nota de ${id}${i}`); }
    }
    T.eq(['drones1', 'drones2', 'drones3', 'defensa1', 'defensa2', 'defensa3'].map(i => TECH_BY_ID.get(i).name),
        ['Drones tácticos', 'Municiones merodeadoras', 'Enjambres autónomos', 'Defensa de punto', 'Interceptores de medio alcance', 'Escudo antimisiles con láser'], 'nombres');
    T.eq([RESEARCH_BRANCHES.length, TECHS.length], [18, 54], 'árbol');
    // Cada rama pinta su icono en el diálogo de investigación, sin emojis.
    T.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(RS_ICON.uav + RS_ICON.cram), 'sin emojis');
    return true;
}],
['B1 · reglas al investigar', () => {
    const g = T.game(), es = T.nation('es');
    const r0 = g.rules(es);
    T.eq([r0.drones, r0.droneRangeKm, r0.droneHit, r0.droneEscort, r0.droneSwarm, r0.defense], [0, 150, [0.04, 0.03], false, false, 0], 'de partida');
    T.learn(g, es, 'drones1');
    T.eq([g.rules(es).drones, g.rules(es).droneRangeKm], [1, 150], 'drones1');
    T.learn(g, es, 'drones2');
    const r = g.rules(es);
    T.eq([r.drones, r.droneRangeKm, r.droneHit, r.droneEscort, r.droneSwarm], [2, 300, [0.06, 0.04], true, false], 'drones2');
    T.learn(g, es, 'drones3', 'defensa1', 'defensa2');
    T.eq([g.rules(es).drones, g.rules(es).droneSwarm, g.rules(es).defense], [3, true, 2], 'drones3 y defensa2');
    T.learn(g, es, 'defensa3');
    T.eq(g.rules(es).defense, 3, 'defensa3');
    // Las reglas base no se contaminan: otra nación y una partida nueva siguen en cero.
    T.eq([g.rules(T.nation('fr')).droneHit, baseRules().droneHit, g.techLevel(es, 'drones'), g.techLevel(es, 'defensa')], [[0.04, 0.03], [0.04, 0.03], 3, 3], 'sin contaminar');
    return true;
}],
['B1 · la IA las elige en guerra contra quien tiene drones', () => {
    const g = T.game(), fr = T.nation('fr'), pt = T.nation('pt');
    g.declareWar(fr, pt);
    // Todo lo demás ya investigado: solo quedan las dos ramas nuevas por elegir.
    for (const t of TECHS) if (t.branch !== 'drones' && t.branch !== 'defensa') g.nations[fr].tech.done.add(t.id);
    T.learn(g, pt, 'drones1');
    g.techVersion++;
    const pick = g.aiTechChoice(fr);
    T.ok(['drones1', 'defensa1'].includes(pick), `elige ${pick}`);
    return true;
}],
['B2 · comprar en una ciudad sin aeródromo, 4 como mucho, vuela al turno siguiente', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); g.nations[es].gold = 2000;
    const city = PROVINCES.find(p => p.country === es && p.city !== g.nations[es].capitalCell).city;
    T.eq(g.buySwarm(es, city), null, 'sin Drones 1, no');
    T.learn(g, es, 'drones1');
    T.ok(!g.airfields.has(city), 'sin aeródromo');
    const s = g.buySwarm(es, city);
    T.eq([g.nations[es].gold, s.ready, g.canFlySwarm(s), g.swarmsAt(city).length, s.owner, s.base], [1880, g.turn + 1, false, 1, es, city], 'listo el turno que viene');
    g.buySwarm(es, city); g.buySwarm(es, city); g.buySwarm(es, city);
    T.eq([g.buySwarm(es, city), g.swarmsAt(city).length, g.nations[es].gold], [null, 4, 1520], 'no cabe un quinto');
    const foreign = PROVINCES.find(p => p.country === fr).city, field = G.land.find(c => g.owner[c] === es && CITY_OF[c] < 0);
    T.eq([g.buySwarm(es, foreign), g.buySwarm(es, field)], [null, null], 'solo en una ciudad propia');
    g.nations[es].gold = 100;
    T.eq(g.playerBuySwarm(g.nations[es].capitalCell), null, 'sin oro');
    T.ok(/120/.test(g.logs[g.logs.length - 1].msg), 'el parte dice el precio');
    g.turn++;
    T.ok(g.canFlySwarm(s), 'vuela');
    T.eq([g.droneRange(es), g.dronePower(es)], [kmCells(150), g.airPower(es) / 2], 'alcance y fuerza');
    T.learn(g, es, 'drones2'); T.eq(g.droneRange(es), kmCells(300), 'alcance con Drones 2');
    // Patrullar: cubre su casilla hasta que vuelve su dueño.
    T.eq([g.droneMission(es, [s.id], 'patrol', city).result, s.patrol], ['hit', city], 'patrulla');
    T.eq(g.droneMission(es, [s.id], 'patrol', city).result, 'invalid', 'una misión por turno');
    g.beginNationTurn(es); T.eq(s.patrol, -1, 'acaba en su turno');
    return true;
}],
['B2 · reconocer desvela 60 km y cuenta como conocido para la aviación', () => {
    const g = T.game(7, true), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); g.declareWar(es, fr); T.learn(g, es, 'drones1');
    const [, c] = T.border(g, es, fr), base = T.baseFor(g, es, c, g.droneRange(es));
    T.airfield(g, es, base); const sq = T.squad(g, es, base, 1), [sw] = T.swarm(g, es, base);
    const a = T.army(g, fr, c, 5);
    // Un ejército y un antiaéreo a 2 casillas, dentro de los 60 km (3 casillas), y otro ejército fuera.
    const near = G.land.find(x => g.owner[x] === fr && hexDist(x, c) === 2 && T.free(g, x)), far = G.land.find(x => g.owner[x] === fr && hexDist(x, c) === 5 && T.free(g, x));
    const b = T.army(g, fr, near, 3), d = T.army(g, fr, far, 3), site = T.site(g, fr, near);
    T.eq([g.missionOdds(es, sq, 'army', c).known, g.armyView(es, b).n, g.aaVisible(es, near), g.droneRevealed(es, near)], [false, null, false, false], 'antes, a ciegas');
    T.luck(g, 0.99);
    T.eq(g.droneMission(es, [sw.id], 'recon', c).result, 'hit', 'reconoce');
    T.eq([g.missionOdds(es, sq, 'army', c).known, g.armyView(es, a).n, g.armyView(es, b).n, g.armyView(es, d).n], [true, 5, 3, null], 'desvelado en 60 km');
    T.eq([g.droneRevealed(es, near), g.sees(es, near), site.known.has(es), g.aaVisible(es, near), g.armyView(es, b).level], [true, true, true, true, null], 'el antiaéreo, conocido; sin galones');
    g.turn++; T.eq(g.armyView(es, b).n, 3, 'el turno siguiente');
    g.beginNationTurn(es); T.eq(g.armyView(es, b).n, 3, 'todo su turno siguiente');
    g.turn++; g.beginNationTurn(es); T.eq([g.armyView(es, b).n, g.droneSeen.size, site.known.has(es)], [null, 0, true], 'se acaba; el antiaéreo sigue conocido');
    // Con Drones 3, galones y fortificaciones.
    T.learn(g, es, 'drones2', 'drones3'); sw.ready = 0;
    g.droneMission(es, [sw.id], 'recon', c);
    T.ok(g.armyView(es, b).level !== null && g.fortLevel(es, near) !== null, 'galones con Drones 3');
    return true;
}],
['B2 · atacar ejército quita 4–7 %', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); g.declareWar(es, fr); T.learn(g, es, 'drones1');
    const [, c] = T.border(g, es, fr), base = T.baseFor(g, es, c, g.droneRange(es));
    const sws = T.swarm(g, es, base, 4), a = T.army(g, fr, c, 90, 10);
    T.luck(g, 0);
    T.eq(g.droneMission(es, [sws[0].id], 'army', c).result, 'hit', 'acierto');
    T.eq([a.units.tank, a.units.infantry, a.disorgUntil], [6, 90, 0], '4 %, primero tanques y sin desorganizar');
    T.eq(g.droneMission(es, [sws[1].id], 'army', c).result, 'blocked', 'un acierto de drones por turno');
    T.airfield(g, es, base); const [q] = T.squad(g, es, base);
    T.eq(g.missionCheck(es, [q], 'army', c), '', 'el acierto aéreo es aparte');
    g.turn++; T.luck(g, 0.999); a.units.tank = 10; a.units.infantry = 90;
    g.droneMission(es, [sws[1].id], 'army', c);
    T.eq(a.units.tank, 3, '7 %');
    g.turn++; T.learn(g, es, 'drones2', 'drones3'); a.units.tank = 10; a.units.infantry = 90;
    g.droneMission(es, [sws[2].id], 'army', c);
    T.eq([a.units.tank, a.disorgUntil >= g.turn], [0, true], '10 % y desorganizado con Drones 3');
    // Un ejército pequeño pierde al menos una unidad.
    g.turn++; a.units.tank = 0; a.units.infantry = 2; T.luck(g, 0);
    g.droneMission(es, [sws[3].id], 'army', c);
    T.eq(countUnits(a.units), 1, 'al menos una');
    return true;
}],
['B2 · el antiaéreo derriba más drones que aviones', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); g.declareWar(es, fr); T.learn(g, es, 'drones1');
    const [base, target] = T.pair(g, es, fr, () => true, 3, g.droneRange(es));
    T.airfield(g, es, base); const sq = T.squad(g, es, base, 1), sws = T.swarm(g, es, base, 2);
    for (const p of PROVINCES) if (g.fort[p.city] === 4) g.fort[p.city] = 3;   // sin integrado por el camino
    g.fortVersion++;
    if (g.armyOn(target)) g.removeArmy(g.armyOn(target));
    T.army(g, fr, target, 5); T.site(g, fr, target);
    const air = g.missionOdds(es, sq, 'army', target), dr = g.droneOdds(es, sws, 'army', target);
    T.eq([dr.why, dr.power, air.power], ['', air.power, air.power], 'misma fuerza');
    T.ok(air.down > 0 && air.down < 0.4, `derribo de un escuadrón ${air.down}`);
    T.near(dr.down, 1.5 * air.down, 1e-9, 'drones ×1,5');
    T.near(dr.fire, air.fire, 1e-9, 'el mismo antiaéreo');
    return true;
}],
['B2 · saturación con 3 enjambres y Drones 3', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); g.declareWar(es, fr); T.learn(g, es, 'drones1', 'drones2');
    const [base, target] = T.pair(g, es, fr, () => true, 3, g.droneRange(es));
    const sws = T.swarm(g, es, base, 3);
    if (g.armyOn(target)) g.removeArmy(g.armyOn(target));
    T.army(g, fr, target, 5); T.site(g, fr, target);
    const three = g.droneOdds(es, sws, 'army', target);
    T.ok(three.fire > 0, 'hay antiaéreo');
    T.learn(g, es, 'drones3');
    const sat = g.droneOdds(es, sws, 'army', target), two = g.droneOdds(es, sws.slice(0, 2), 'army', target);
    T.near([sat.fire, sat.loss], [three.fire / 2, three.loss / 2], 1e-9, 'tres con Drones 3: la mitad');
    T.near([two.fire, two.loss], [three.fire, three.loss], 1e-9, 'dos: entero');
    T.ok(sat.down < three.down && sat.hit > three.hit, 'menos derribo y más acierto');
    return true;
}],
['B2 · un caza que protege la casilla para la misión', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); g.declareWar(es, fr); T.learn(g, fr, 'drones1');
    const [c] = T.border(g, es, fr), fb = T.baseFor(g, fr, c, g.droneRange(fr));
    T.airfield(g, es, T.baseFor(g, es, c)); const [mine] = T.squad(g, es, T.baseFor(g, es, c));
    const sws = T.swarm(g, fr, fb, 2), army = T.army(g, es, c, 20);
    T.luck(g, 0.99);
    T.eq(g.airMission(es, [mine.id], 'patrol', c).result, 'hit', 'protege');
    T.ok(g.droneOdds(fr, sws, 'army', c).patrol === 2 * g.airPower(es), 'la previsión lo cuenta a fuerza doble');
    const res = g.droneMission(fr, sws.map(s => s.id), 'army', c);
    T.eq([res.result, countUnits(army.units), g.squadrons.has(mine.id), mine.ready <= g.turn], ['intercepted', 20, true, true], 'no llega');
    T.ok(/intercept/.test(g.logs[g.logs.length - 1].msg), 'el parte lo cuenta');
    // Con mala suerte para los drones, caen.
    g.turn++; for (const s of sws) s.ready = 0;
    mine.patrol = c; T.luck(g, 0.1);
    const r2 = g.droneMission(fr, sws.map(s => s.id), 'army', c);
    T.eq([r2.result, r2.down, sws.filter(s => g.swarms.has(s.id)).length], ['intercepted', 2, 0], 'derribados');
    return true;
}],
['B2 · ciudad perdida en paz: los enjambres se mudan', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr'), pt = T.nation('pt');
    g.start(es); T.bare(g);
    // Sin combate: a la ciudad propia más cercana con sitio.
    const cities = PROVINCES.filter(p => p.country === es).map(p => p.city), city = cities.find(c => c !== g.nations[es].capitalCell);
    const order = cities.filter(c => c !== city).sort((a, b) => hexDist(a, city) - hexDist(b, city) || a - b);
    T.swarm(g, es, order[0], 3);
    const [s, t] = T.swarm(g, es, city, 2);
    g.owner[city] = pt; g.version++; g.airSweep();
    T.eq([s.base, t.base, g.swarmsAt(order[0]).length, g.swarms.has(s.id), g.swarms.has(t.id)], [order[0], order[1], 4, true, true], 'se mudan');
    // A la fuerza: se pierden.
    g.declareWar(es, fr);
    const fc = PROVINCES.find(p => p.country === fr && CAPITAL_OF[p.city] < 0).city, lost = T.swarm(g, fr, fc, 2);
    if (g.armyOn(fc)) g.removeArmy(g.armyOn(fc));
    g.capture(fc, es, true);
    T.eq(lost.map(x => g.swarms.has(x.id)), [false, false], 'perdidos');
    return true;
}],
['B2 · guardar y cargar, y partida vieja sin enjambres', () => {
    const g = T.game(7, true), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); g.declareWar(es, fr); T.learn(g, es, 'drones1');
    const [, c] = T.border(g, es, fr), base = T.baseFor(g, es, c, g.droneRange(es));
    const [s, t] = T.swarm(g, es, base, 2); T.army(g, fr, c, 30);
    T.luck(g, 0.99);
    g.droneMission(es, [s.id], 'recon', c); g.droneMission(es, [t.id], 'army', c);
    t.damaged = true; t.patrol = base; t.op = 0;
    const data = JSON.parse(JSON.stringify(g.serialize())), h = GameEngine.load(data);
    T.eq([...h.swarms.values()], [...g.swarms.values()], 'enjambres');
    T.eq([h.nextSwarmId, [...h.droneSeen], [...h.droneHits]], [g.nextSwarmId, [...g.droneSeen], [...g.droneHits]], 'contador, desvelado y aciertos');
    T.eq(h.droneMission(es, [h.swarms.get(s.id).id], 'army', c).result, 'invalid', 'ya ha volado');
    // Basura: fuera de una ciudad, dueño imposible, repetido.
    data.drones.sw.push([99, es, G.land.find(x => CITY_OF[x] < 0), 0, 0, -1, 0, 0], [s.id, es, base, 0, 0, -1, 0, 0], ['x']);
    T.eq(GameEngine.load(data).swarms.size, 2, 'sin basura');
    delete data.drones;
    const old = GameEngine.load(data);
    T.eq([old.swarms.size, old.nextSwarmId, old.droneSeen.size, old.droneHits.size], [0, 1, 0, 0], 'partida vieja');
    return true;
}],
['B3 · construir batería y que tarde 2 turnos', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); T.noIntegrated(g); g.declareWar(es, fr); g.nations[es].gold = 1000;
    const cell = T.clear(g, es);
    T.eq([g.planBattery(es, cell), g.playerBuildBattery(cell)], [null, false], 'sin Defensa de punto, no');
    T.ok(/Defensa de punto/.test(g.logs[g.logs.length - 1].msg), 'el parte dice qué falta');
    T.learn(g, es, 'defensa1');
    T.eq(CONFIG.BATTERY, { COST: 150, TURNS: 2 }, 'precio y obra');
    T.eq(g.planBattery(es, cell), { cell, cost: 150 }, 'plan');
    T.ok(g.playerBuildBattery(cell), 'construye');
    T.ok(/150/.test(g.logs[g.logs.length - 1].msg), 'el parte dice el precio');
    const b = g.batteries.get(cell);
    T.eq([b.owner, b.left, [...b.known], b.used, g.nations[es].gold], [es, 2, [], 0, 850], 'en obra');
    let sea = 0; while (isLand(sea)) sea++;
    T.eq([g.planBattery(es, cell), g.planBattery(es, PROVINCES.find(p => p.country === fr).city), g.planBattery(es, sea)], [null, null, null], 'una por casilla, solo en tierra propia');
    T.eq(g.incomingDefense(fr, 'drone', cell, 1, { simulate: true }).through, 1, 'en obra no dispara');
    g.beginNationTurn(es); T.eq(b.left, 1, 'un turno');
    g.beginNationTurn(es); T.eq(b.left, 0, 'terminada');
    T.ok(g.logs.some(l => /Batería .*terminada/.test(l.msg)), 'el parte lo dice');
    T.near(g.incomingDefense(fr, 'drone', cell, 1, { simulate: true }).through, 0.2, 1e-9, 'dispara');
    // Sin nivel (un país que no la ha investigado y la tiene), no dispara.
    const pt = T.nation('pt'), c2 = T.clear(g, pt); T.battery(g, pt, c2); g.declareWar(pt, fr);
    T.eq(g.incomingDefense(fr, 'drone', c2, 1, { simulate: true }).through, 1, 'sin nivel');
    return true;
}],
['B3 · nivel 1 para drones y cohetes, no misiles', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); T.noIntegrated(g); g.declareWar(es, fr); T.learn(g, es, 'defensa1');
    const cell = T.clear(g, es, 3); T.battery(g, es, cell);
    const CL = ['drone', 'rocket', 'heavyRocket', 'missile', 'guided', 'heavy', 'nuclear'];
    const pass = (c = cell, who = fr) => CL.map(k => +g.incomingDefense(who, k, c, 1, { simulate: true }).through.toFixed(6));
    T.eq(pass(), [0.2, 0.3, 0.3, 1, 1, 1, 1], 'nivel 1');
    T.eq(BATTERY_LEVELS[1], { km: 40, cap: 4, p: { drone: 0.8, rocket: 0.7 } }, 'tabla');
    const R = kmCells(40), edge = hexDisc(cell, R + 1).find(j => hexDist(j, cell) === R), out = hexDisc(cell, R + 1).find(j => hexDist(j, cell) === R + 1);
    T.eq([pass(edge)[0], pass(out)[0]], [0.2, 1], 'radio de 40 km');
    T.eq(pass(cell, T.nation('de')), [1, 1, 1, 1, 1, 1, 1], 'solo contra quien está en guerra');
    T.learn(g, es, 'defensa2');
    T.eq(pass(), [0.15, 0.2, 0.2, 0.4, 0.55, 1, 1], 'nivel 2: misiles y guiados');
    T.learn(g, es, 'defensa3');
    T.eq(pass(), [0.1, 0.1, 0.1, 0.3, 0.4, 0.5, 0.65], 'nivel 3: todo');
    // Lo que deja la parte C: las clases con reentrada se paran menos (rules.interceptMult).
    const rules = g.rules.bind(g);
    g.rules = id => (id === fr ? { ...rules(id), interceptMult: 0.7 } : rules(id));
    T.eq(pass(), [0.1, 0.1, 0.1, 0.51, 0.58, 0.65, 0.755], 'interceptMult en misiles');
    return true;
}],
['B3 · capacidad: la quinta arma pasa con nivel 1', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); T.noIntegrated(g); g.declareWar(es, fr); T.learn(g, es, 'defensa1');
    const cell = T.clear(g, es, 3), b = T.battery(g, es, cell);
    T.luck(g, 0);
    const d = g.incomingDefense(fr, 'rocket', cell, 5);
    T.eq([d.through, d.stopped, d.sources, b.used, b.known.has(fr)], [1, { drones: 0, batteries: 4, aa: 0 }, [cell], 4, true], 'para 4 y la quinta pasa; se delata');
    T.eq(g.incomingDefense(fr, 'rocket', cell, 2).through, 2, 'sin capacidad, todo pasa');
    T.eq(g.incomingDefense(fr, 'rocket', cell, 2, { simulate: true }).through, 2, 'la previsión lo sabe');
    // La capacidad se gasta aunque falle: cada arma que atiende cuenta.
    b.used = 0; T.luck(g, 0.99);
    const e = g.incomingDefense(fr, 'drone', cell, 6);
    T.eq([e.through, e.stopped.batteries, b.used], [6, 0, 4], 'falla, pero gasta');
    // Con dos baterías, primero la de más probabilidad; la previsión no gasta nada.
    b.used = 0;
    const b2 = T.battery(g, es, hexDisc(cell, 2).find(j => hexDist(j, cell) === 2 && isLand(j)));
    T.near(g.incomingDefense(fr, 'rocket', cell, 10, { simulate: true }).through, 2 + 8 * 0.3, 1e-9, 'previsión: dos baterías, 8 atendidas');
    T.eq([b.used, b2.used], [0, 0], 'sin gastar');
    T.learn(g, T.nation('fr'), 'defensa2');   // la de otro país no cambia nada
    T.near(g.incomingDefense(fr, 'drone', cell, 1, { simulate: true }).through, 0.2, 1e-9, 'el nivel es el de su dueño');
    return true;
}],
['B3 · capacidad repuesta en el turno del siguiente atacante', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); T.noIntegrated(g); g.declareWar(es, fr); T.learn(g, es, 'defensa1', 'drones1');
    const [cell] = T.border(g, es, fr), b = T.battery(g, es, cell);
    T.luck(g, 0);
    T.eq(g.incomingDefense(fr, 'rocket', cell, 6).through, 2, 'gasta');
    g.beginNationTurn(T.nation('de'));
    T.eq([b.used, g.incomingDefense(fr, 'rocket', cell, 6).through], [0, 2], 'repuesta para el siguiente');
    // Los enjambres que patrullan: 2 por enjambre y ronda, en la casilla o una vecina.
    g.batteries.clear(); g.airVersion++;
    const next = [0, 1, 2, 3, 4, 5].map(d => G.nb[cell * 6 + d]).find(j => j >= 0 && isLand(j) && g.owner[j] === es);
    const [sw] = T.swarm(g, es, T.baseFor(g, es, cell, g.droneRange(es)));
    T.eq(g.droneMission(es, [sw.id], 'patrol', next).result, 'hit', 'patrulla al lado');
    const d = g.incomingDefense(fr, 'rocket', cell, 3);
    T.eq([d.through, d.stopped.drones, d.sources], [1, 2, [next]], 'dos por enjambre');
    T.eq(g.incomingDefense(fr, 'heavyRocket', cell, 1).through, 1, 'gastado');
    g.beginNationTurn(fr);
    T.eq(g.incomingDefense(fr, 'guided', cell, 3).stopped.drones, 2, 'repuesto');
    T.eq(g.incomingDefense(fr, 'missile', cell, 1, { simulate: true }).through, 1, 'misiles, nada');
    g.beginNationTurn(fr);
    T.near(g.incomingDefense(fr, 'guided', cell, 1, { simulate: true }).through, 0.75, 1e-9, 'guiados, 25 %');
    T.near(g.incomingDefense(fr, 'rocket', cell, 3, { simulate: true }).through, 2 * 0.5 + 1, 1e-9, 'cohetes, 50 %');
    T.learn(g, es, 'drones2', 'drones3');
    T.near(g.incomingDefense(fr, 'drone', cell, 1, { simulate: true }).through, 0.3, 1e-9, 'con Drones 3, 70 %');
    // Y los drones enemigos que van contra esa casilla caen.
    T.learn(g, fr, 'drones1');
    const a = T.army(g, es, cell, 10), sws = T.swarm(g, fr, T.baseFor(g, fr, cell, g.droneRange(fr)), 2);
    T.near(g.droneOdds(fr, sws, 'army', cell).through, 2 * 0.3, 1e-9, 'la previsión de la misión los cuenta');
    const res = g.droneMission(fr, sws.map(s => s.id), 'army', cell);
    T.eq([res.result, res.down, countUnits(a.units)], ['intercepted', 2, 10], 'interceptados por la patrulla');
    return true;
}],
['B3 · antiaéreo: 4 sitios con Defensa aérea 2 paran ~80 % de los cohetes', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); T.noIntegrated(g); g.declareWar(es, fr);
    const cell = T.clear(g, es, 2);
    const sites = [cell, ...[0, 1, 2, 3, 4, 5].map(d => G.nb[cell * 6 + d]).filter(j => j >= 0 && isLand(j))].slice(0, 4);
    T.eq(sites.length, 4, 'cuatro sitios');
    T.site(g, es, sites[0]);
    T.near(1 - g.incomingDefense(fr, 'rocket', cell, 1, { simulate: true }).through, 0.22, 0.005, 'un sitio sin investigar, 22 %');
    for (const c of sites.slice(1)) T.site(g, es, c);
    T.learn(g, es, 'antiaerea1', 'antiaerea2');
    const n = 3, sim = k => g.incomingDefense(fr, k, cell, n, { simulate: true }).through / n;
    T.near(sim('rocket'), 0.2, 0.03, 'cohetes');
    T.near(sim('missile'), 0.45, 0.03, 'misiles');
    T.near(sim('nuclear'), 0.79, 0.03, 'nucleares');
    T.eq(sim('drone'), 1, 'los drones ya pasan por el antiaéreo en su misión');
    // Disparan los cuatro a cada arma, pero cada una gasta la capacidad de uno solo.
    T.near(g.incomingDefense(fr, 'rocket', cell, 4, { simulate: true }).through, 4 * Math.exp(-1.6), 1e-9, 'cuatro armas, fuerza entera');
    T.luck(g, 0);
    const d = g.incomingDefense(fr, 'rocket', cell, 4);
    T.eq([d.through, d.stopped.aa, d.sources.length, [...g.defUsed.values()]], [0, 4, 4, [1, 1, 1, 1]], 'tirada: cuatro paradas, una por fuente');
    T.ok(sites.every(c => g.aaSites.get(c).known.has(fr)), 'los sitios que disparan se delatan');
    return true;
}],
['C3 · cuatro sitios atienden hasta 12 armas por ronda', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); T.noIntegrated(g); g.declareWar(es, fr); T.learn(g, es, 'antiaerea1', 'antiaerea2');
    const cell = T.clear(g, es, 2);
    const sites = [cell, ...[0, 1, 2, 3, 4, 5].map(d => G.nb[cell * 6 + d]).filter(j => j >= 0 && isLand(j))].slice(0, 4);
    for (const c of sites) T.site(g, es, c);
    // Previsión: 9 armas con los cuatro (64), y luego con 3, 2 y 1 fuentes que aún atienden; la 13.ª pasa entera.
    const want = 9 * Math.exp(-1.6) + Math.exp(-1.2) + Math.exp(-0.8) + Math.exp(-0.4) + 1;
    T.near(g.incomingDefense(fr, 'rocket', cell, 13, { simulate: true }).through, want, 1e-9, 'previsión');
    T.eq(g.defUsed.size, 0, 'la previsión no gasta');
    T.luck(g, 0);
    const d = g.incomingDefense(fr, 'rocket', cell, 13);
    T.eq([d.through, d.stopped.aa, [...g.defUsed.values()]], [1, 12, [3, 3, 3, 3]], 'doce paradas y la 13.ª no ve antiaéreo');
    T.eq(g.incomingDefense(fr, 'rocket', cell, 2).through, 2, 'agotado hasta la ronda siguiente');
    g.beginNationTurn(T.nation('de'));
    T.eq(g.incomingDefense(fr, 'rocket', cell, 1).stopped.aa, 1, 'repuesto');
    return true;
}],
['B3 · la previsión no cuenta baterías que no conoces y avisa de que puede haberlas', () => {
    const g = T.game(7, true), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); T.noIntegrated(g); g.declareWar(es, fr); T.learn(g, es, 'defensa1');
    const [, cell] = T.border(g, fr, es), b = T.battery(g, es, cell);
    T.ok(!g.batteryKnown(fr, cell) && g.batteryKnown(es, cell), 'fr no la conoce');
    const d = g.incomingDefense(fr, 'drone', cell, 2, { simulate: true });
    T.eq([d.through, d.unknown], [2, true], 'no la cuenta y avisa');
    // El reconocimiento con drones la desvela.
    T.learn(g, fr, 'drones1');
    g.droneEffect(fr, 'recon', cell);
    T.ok(b.known.has(fr) && g.batteryKnown(fr, cell), 'reconocida');
    T.near(g.incomingDefense(fr, 'drone', cell, 2, { simulate: true }).through, 0.4, 1e-9, 'ahora la cuenta');
    // Con Reconocimiento 2 lo ve todo (la IA no necesita tenerlo a la vista): ya no hay dudas.
    b.known.clear(); T.learn(g, fr, 'reconocimiento1', 'reconocimiento2');
    const e = g.incomingDefense(fr, 'drone', cell, 2, { simulate: true });
    T.ok(g.batteryKnown(fr, cell), 'la ve');
    T.near(e.through, 0.4, 1e-9, 'la cuenta');
    T.eq(e.unknown, false, 'sin dudas');
    // Sin niebla no hay dudas.
    const h = T.game(), x = T.nation('es'), y = T.nation('fr');
    h.start(x); T.bare(h); h.declareWar(x, y);
    T.eq(h.incomingDefense(y, 'missile', T.clear(h, x), 2, { simulate: true }).unknown, false, 'sin niebla');
    return true;
}],
['B3 · se pierde al tomar la casilla, Destruir antiaéreo la destruye, guardar y cargar', () => {
    const g = T.game(7, true), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); T.noIntegrated(g); g.declareWar(es, fr); T.learn(g, fr, 'defensa1');
    const [, cell] = T.border(g, es, fr), b = T.battery(g, fr, cell);
    // Destruir antiaéreo contra una batería conocida: un acierto la destruye.
    const base = T.baseFor(g, es, cell); T.airfield(g, es, base); const [q] = T.squad(g, es, base);
    T.eq(g.missionCheck(es, [q], 'aa', cell), 'No conoces ningún antiaéreo en esa casilla.', 'sin conocerla, no');
    b.known.add(es);
    T.luck(g, 0.99);
    const res = g.airMission(es, [q.id], 'aa', cell);
    T.eq([res.result, g.batteries.has(cell)], ['hit', false], `destruida: ${res.text}`);
    // Guardar y cargar: obra, conocidos y capacidad gastada en la ronda.
    const c2 = T.clear(g, fr, 2), b2 = T.battery(g, fr, c2); b2.used = 3; b2.known.add(es);
    T.learn(g, es, 'defensa1', 'drones1'); g.nations[es].gold = 500;
    const [, c3] = T.border(g, fr, es, 1); g.buildBattery(es, g.planBattery(es, c3));
    const [sw] = T.swarm(g, es, T.baseFor(g, es, c3, g.droneRange(es)));
    g.droneMission(es, [sw.id], 'patrol', c3);
    T.luck(g, 0);
    g.incomingDefense(fr, 'rocket', c3, 1);   // el enjambre gasta una (la batería, en obra, no dispara)
    T.eq([...g.defUsed], [[`s:${sw.id}`, 1]], 'el enjambre cuenta');
    const data = JSON.parse(JSON.stringify(g.serialize())), h = GameEngine.load(data);
    const dump = x => [...x.batteries].map(([c, v]) => [c, v.owner, v.left, [...v.known], v.used]);
    T.eq(dump(h), dump(g), 'baterías');
    T.eq([...h.defUsed], [...g.defUsed], 'contadores de la ronda');
    // Basura: en el mar, repetida, rota; contadores de clave o número imposibles.
    let sea = 0; while (isLand(sea)) sea++;
    data.defense.bat.push([sea, es, 0, [], 0], [c2, es, 0, [], 0], ['x']);
    data.defense.used.push(['zz', 1], ['s:1', 99]);
    const k = GameEngine.load(data);
    T.eq([k.batteries.size, k.defUsed.size], [2, 1], 'sin basura');
    // Al tomar la casilla, se pierde.
    if (g.armyOn(c2)) g.removeArmy(g.armyOn(c2));
    g.capture(c2, es, true);
    T.eq(g.batteries.has(c2), false, 'perdida al tomarla');
    delete data.defense;
    const old = GameEngine.load(data);
    T.eq([old.batteries.size, old.defUsed.size], [0, 0], 'partida vieja');
    return true;
}],
['B4 · escolta de defensa intercepta la misión enemiga', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); T.noIntegrated(g); g.declareWar(es, fr); T.learn(g, es, 'drones1'); T.learn(g, fr, 'drones1');
    const [c] = T.border(g, es, fr), base = T.baseFor(g, es, c, g.droneRange(es));
    T.airfield(g, es, base); const qs = T.squad(g, es, base, 2), [w] = T.swarm(g, es, base);
    const army = T.army(g, es, c, 20);
    T.eq(g.setEscort(w, { army: army.id }, 'defensa'), false, 'el enjambre necesita Municiones merodeadoras');
    T.learn(g, es, 'drones2');
    T.eq([...qs, w].map(q => g.setEscort(q, { army: army.id }, 'defensa')), [true, true, true], 'encargos');
    T.eq(qs[0].task, { kind: 'escort', army: army.id, group: 0, mode: 'defensa' }, 'el encargo');
    T.eq(g.escortCovers(c).map(q => q.id), [qs[0].id, qs[1].id, w.id], 'cubren su casilla');
    T.eq(g.interceptors(fr, 'army', c), qs, 'los escuadrones salen al paso');
    T.eq(g.defenseSwarms(fr, c), [w], 'y el enjambre está en la primera capa');
    T.near(g.incomingDefense(fr, 'drone', c, 1, { simulate: true }).stopped.drones, 0.5, 1e-9, 'para la mitad de los drones');
    // Una misión aérea francesa contra el ejército: el doble de cazas la para.
    const fb = T.baseFor(g, fr, c); T.airfield(g, fr, fb); const [f] = T.squad(g, fr, fb);
    T.luck(g, 0.99);
    const res = g.airMission(fr, [f.id], 'army', c);
    T.eq([res.result, countUnits(army.units)], ['intercepted', 20], 'interceptada');
    // Una misión a mano gasta su turno: hasta el próximo de su dueño no escolta.
    qs[0].flown = g.turn; qs[1].flown = g.turn;
    T.eq(g.interceptors(fr, 'army', c), [], 'han volado a otra cosa');
    g.turn++;
    T.eq(g.interceptors(fr, 'army', c), [], 'aún no ha empezado su turno');
    g.nations[es].lastTurn = g.turn;
    T.eq(g.interceptors(fr, 'army', c), qs, 'en su turno nuevo vuelven a escoltar');
    return true;
}],
['B4 · apoyo aéreo ×1,1 por escuadrón con tope ×1,3 en el desglose', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); g.declareWar(es, fr); T.learn(g, es, 'drones1', 'drones2');
    const [c, e] = T.border(g, es, fr), base = T.baseFor(g, es, c, g.droneRange(es));
    T.airfield(g, es, base); const sqs = T.squad(g, es, base, 4), sws = T.swarm(g, es, base, 4);
    const mine = T.army(g, es, c, 10), foe = g.armyOn(e) ?? T.army(g, fr, e, 10);
    T.eq(g.escortFactor(es, mine.id, 'atk'), null, 'sin escolta');
    const fx0 = g.combatFactors(es, mine.units, c, foe, e, mine.id);
    const f = [];
    for (const q of sqs) { g.setEscort(q, { army: mine.id }, 'ataque'); f.push(g.escortFactor(es, mine.id, 'atk')[1]); }
    T.near(f, [1.1, 1.21, 1.3, 1.3], 1e-9, '×1,1 por escuadrón, tope ×1,3');
    T.eq(g.escortFactor(es, mine.id, 'def'), null, 'la de ataque no defiende');
    const h = [];
    for (const q of sws) { g.setEscort(q, { army: mine.id }, 'ataque'); h.push(g.escortFactor(es, mine.id, 'atk')[1] / 1.3); }
    T.near(h, [1.05, 1.1025, 1.15, 1.15], 1e-9, '×1,05 por enjambre, tope ×1,15');
    const fx = g.combatFactors(es, mine.units, c, foe, e, mine.id);
    T.near(fx.atk, fx0.atk * 1.3 * 1.15, 1e-9, 'en el ataque');
    T.eq(fx.attParts.map(([n]) => n), ['apoyo aéreo'], 'en el desglose del ataque');
    // Una parte del ejército que ataca (attId 0, sale de él) también lo lleva; un ejército sin escolta, no.
    T.near(g.combatFactors(es, { infantry: 5, tank: 0, artillery: 0 }, c, foe, e, 0, mine.id).attParts[0][1], 1.3 * 1.15, 1e-9, 'una parte');
    // La que ya ha volado este turno no apoya.
    for (const q of [...sqs, ...sws]) q.flown = g.turn;
    T.eq(g.escortFactor(es, mine.id, 'atk'), null, 'ya han volado');
    // En la defensa: escolta francesa del defensor.
    const fb = T.baseFor(g, fr, e); T.airfield(g, fr, fb); const [d] = T.squad(g, fr, fb);
    g.setEscort(d, { army: foe.id }, 'defensa');
    const fx2 = g.combatFactors(es, mine.units, c, foe, e, mine.id);
    T.eq(fx2.defState.parts.filter(([n]) => n === 'apoyo aéreo'), [['apoyo aéreo', 1.1]], 'en el desglose de la defensa');
    T.near(fx2.dfn, fx0.dfn * 1.1, 1e-9, 'defensa ×1,1');
    // El parte del combate lo cuenta.
    T.luck(g, 0.5);
    const n = g.logs.length;
    g.attack(mine, c, e, g.reach(es, c, g.mp(mine), true));
    T.ok(g.logs.slice(n).some(l => /×1,1 apoyo aéreo/.test(l.msg)), 'en el parte');
    return true;
}],
['B4 · escolta de ataque golpea antes del combate', () => {
    const run = (mode, { drones = false, fog = false } = {}) => {
        const g = T.game(7, fog), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); T.bare(g); T.noIntegrated(g); g.declareWar(es, fr); T.learn(g, es, 'drones1', 'drones2');
        const [c, e] = T.border(g, es, fr), base = T.baseFor(g, es, c, g.droneRange(es));
        T.airfield(g, es, base); const [q] = drones ? T.swarm(g, es, base) : T.squad(g, es, base);
        const mine = T.army(g, es, c, 40), foe = g.armyOn(e) ?? T.army(g, fr, e, 20);
        if (mode) g.setEscort(q, { army: mine.id }, mode);
        const n = g.logs.length, before = countUnits(foe.units);
        g.attack(mine, c, e, g.reach(es, c, g.mp(mine), true));
        return { g, q, es, e, before, logs: g.logs.slice(n).map(l => l.msg), state: g.rng.state };
    };
    const none = run(null), idle = run('defensa');
    T.eq([idle.state, idle.logs], [none.state, none.logs], 'sin escolta de ataque, el combate de siempre');
    const att = run('ataque');
    T.ok(/^Tu escuadrón ataca el ejército/.test(att.logs[0]), `primero el golpe: ${att.logs[0]}`);
    T.ok(/apoyo aéreo/.test(att.logs[att.logs.length - 1]), `luego el combate: ${att.logs[att.logs.length - 1]}`);
    T.eq(att.q.flown, att.g.turn, 'gasta su vuelo');
    // Con drones, el defensor queda conocido: sin niebla para el golpe y para el parte.
    const dr = run('ataque', { drones: true, fog: true });
    T.ok(/^Tu enjambre ataca el ejército/.test(dr.logs[0]), `golpe de drones: ${dr.logs[0]}`);
    T.ok(dr.g.droneRevealed(dr.es, dr.e), 'el defensor, conocido');
    return true;
}],
['B4 · al fundirse, la escolta sigue al ejército nuevo', () => {
    const g = T.game(), es = T.nation('es');
    g.start(es); T.bare(g);
    const [c, n] = T.plainPair(g, es), base = T.baseFor(g, es, c);
    T.airfield(g, es, base); const [q] = T.squad(g, es, base);
    const a = T.army(g, es, c, 5), b = T.army(g, es, n, 5);
    g.setEscort(q, { army: a.id }, 'defensa');
    g.moveArmy(a, n, g.reach(es, c, g.mp(a), true));
    T.eq([g.armies.has(a.id), q.task.army], [false, b.id], 'pasa al ejército con el que se funde');
    T.eq(g.escortsOf(es, b.id).squadrons, [q], 'y lo escolta');
    // Si se parte, se queda con el que tenía.
    const part = g.split(b, { infantry: 2, tank: 0, artillery: 0 });
    T.eq([q.task.army, g.escortsOf(es, part.id).squadrons.length], [b.id, 0], 'la parte va sin escolta');
    // Si desaparece sin fundirse, queda libre al empezar su turno.
    g.removeArmy(b);
    T.eq(g.escortsOf(es, b.id).squadrons, [], 'sin ejército no escolta');
    g.turn++; g.beginNationTurn(es);
    T.eq(q.task, null, 'libre');
    return true;
}],
['B4 · fuera de alcance queda suspendida', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); g.declareWar(es, fr);
    const [c] = T.border(g, es, fr), base = T.baseFor(g, es, c), R = g.airRange(es);
    T.airfield(g, es, base); const [q] = T.squad(g, es, base);
    const far = G.land.find(x => hexDist(base, x) > R + 1 && T.free(g, x));
    const a = T.army(g, es, far, 5);
    g.setEscort(q, { army: a.id }, 'defensa');
    T.eq(g.escortsOf(es, a.id), { squadrons: [], swarms: [], suspended: [q] }, 'suspendida');
    T.eq([g.escortFactor(es, a.id, 'def'), g.escortCovers(far)], [null, []], 'no hace nada');
    // Vuelve a su alcance: escolta otra vez.
    g.removeArmy(a); a.cell = c; g.armies.set(a.id, a); g.settle(a);
    T.eq(g.escortsOf(es, a.id), { squadrons: [q], swarms: [], suspended: [] }, 'de nuevo');
    T.eq(g.escortFactor(es, a.id, 'def'), ['apoyo aéreo', 1.1], 'y apoya');
    return true;
}],
['B4 · escolta de una agrupación cubre a todos sus miembros', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); g.declareWar(es, fr);
    const [c1, e] = T.border(g, es, fr), [c2] = T.border(g, es, fr, 3), base = T.baseFor(g, es, c1);
    T.airfield(g, es, base); const [q] = T.squad(g, es, base);
    const a1 = T.army(g, es, c1, 5), a2 = T.army(g, es, c2, 5), lone = T.army(g, es, T.plainPair(g, es)[1], 5);
    const gr = g.createGroup(es, [a1.id, a2.id]);
    T.eq(g.setEscort(q, { group: gr.id }, 'defensa'), true, 'encargo');
    T.eq(q.task, { kind: 'escort', army: 0, group: gr.id, mode: 'defensa' }, 'a la agrupación');
    T.eq([g.interceptors(fr, 'army', c1), g.interceptors(fr, 'army', c2)], [[q], [q]], 'cubre a los dos');
    T.eq([g.escortsOf(es, a1.id).squadrons, g.escortsOf(es, a2.id).squadrons, g.escortsOf(es, lone.id).squadrons], [[q], [q], []], 'solo a sus miembros');
    // En ataque, apoya al primero que ataca en el turno.
    g.setEscort(q, { group: gr.id }, 'ataque');
    const foe = g.armyOn(e) ?? T.army(g, fr, e, 5);
    T.luck(g, 0.5);
    g.attack(a1, c1, e, g.reach(es, c1, g.mp(a1), true));
    T.eq([q.flown, g.escortFactor(es, a2.id, 'atk')], [g.turn, null], 'el segundo ya no lo tiene');
    T.ok(foe, 'había defensor');
    return true;
}],
['B4 · la operación con «Proteger y escoltar» reparte escoltas', () => {
    const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
    g.start(es); T.bare(g); g.declareWar(es, fr);
    // Línea: la escolta va a defender al ejército más expuesto; el otro escuadrón protege como siempre.
    const [c, e] = T.border(g, es, fr), base = T.baseFor(g, es, c);
    T.airfield(g, es, base); const sqs = T.squad(g, es, base, 2);
    const line = g.createOp(es, 'defensa', [c], { auto: 'auto' }); line.aims = ['patrol'];
    const a = T.army(g, es, c, 8); g.assignArmy(a, line.id);
    for (const q of sqs) g.assignSquadron(q, line.id);
    if (!g.armyOn(e)) T.army(g, fr, e, 8);
    g.opAir(line);
    const esc = sqs.filter(q => q.task?.kind === 'escort');
    T.eq(esc.map(q => [q.task.army, q.task.mode, q.op]), [[a.id, 'defensa', line.id]], 'una escolta de defensa, sin salir de la operación');
    T.ok(sqs.some(q => q.task === null && q.patrol === c), 'el otro protege la casilla');
    T.eq(g.interceptors(fr, 'army', c).length, 2, 'los dos salen al paso');
    // Ofensiva: la escolta va en ataque con quien va a asaltar.
    const [b2, t2] = T.pair(g, es, fr), off = g.createOp(es, 'ofensiva', [b2, t2], { auto: 'auto' }); off.aims = ['patrol'];
    T.airfield(g, es, b2); const more = T.squad(g, es, b2, 2);
    const near = G.land.filter(x => g.owner[x] === es && T.free(g, x)).sort((x, y) => hexDist(x, t2) - hexDist(y, t2))[0];
    const m = T.army(g, es, near, 8); g.assignArmy(m, off.id);
    for (const q of more) g.assignSquadron(q, off.id);
    g.opAir(off);
    T.eq(more.filter(q => q.task?.kind === 'escort').map(q => [q.task.army, q.task.mode]), [[m.id, 'ataque']], 'una escolta de ataque');
    // Sin el fin, o al salir de la operación, la escolta se deshace.
    off.aims = ['army']; g.opAir(off);
    T.eq(more.map(q => q.task), [null, null], 'sin el fin, nada');
    g.assignSquadron(esc[0], 0);
    T.eq(esc[0].task, null, 'fuera de la operación, libre');
    return true;
}],
['B4 · guardar y cargar la escolta', () => {
    const g = T.game(), es = T.nation('es');
    g.start(es); T.bare(g); T.learn(g, es, 'drones1', 'drones2');
    const [c, n] = T.plainPair(g, es), base = T.baseFor(g, es, c);
    T.airfield(g, es, base); const [q, z] = T.squad(g, es, base, 2), [w] = T.swarm(g, es, base);
    const a = T.army(g, es, c, 5), b = T.army(g, es, n, 5), gr = g.createGroup(es, [b.id]);
    g.setEscort(q, { army: a.id }, 'ataque'); g.setEscort(w, { group: gr.id }, 'defensa'); g.setAirTask(z, { cell: c, aims: ['army'] });
    const data = JSON.parse(JSON.stringify(g.serialize())), h = GameEngine.load(JSON.parse(JSON.stringify(data)));
    T.eq([h.squadrons.get(q.id).task, h.swarms.get(w.id).task, h.squadrons.get(z.id).task], [q.task, w.task, z.task], 'encargos');
    // Basura: ejército que no existe o ajeno, modo imposible.
    data.air.sq.find(x => x[0] === q.id)[10] = [999999, 0, 1];
    data.drones.sw.find(x => x[0] === w.id)[8] = [a.id, 0, 7];
    const k = GameEngine.load(data);
    T.eq([k.squadrons.get(q.id).task, k.swarms.get(w.id).task], [null, null], 'sin basura');
    return true;
}],
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
    // Capturas del diálogo de investigación en el área Inteligencia (cinco ramas): escritorio y móvil, sin desbordar.
    const SHOTS = 'B1 · capturas de Inteligencia con cinco ramas';
    if (!filter || SHOTS.includes(filter)) {
        ran++;
        const out = join(root, 'tools/cache/smoke'), errors = [];
        mkdirSync(out, { recursive: true });
        for (const [file, opts] of [['drones-investigacion', { viewport: { width: 1200, height: 800 } }], ['drones-investigacion-movil', PHONE]]) {
            const page = await browser.newPage(opts);
            page.on('pageerror', e => errors.push(`${file}: ${e.message}`));
            await page.goto(`http://localhost:${port}/?seed=7&mapa=europa`);
            await page.waitForFunction(() => typeof GameEngine === 'function' && typeof ui === 'object');
            await page.evaluate(setup);
            await page.evaluate(() => {
                T.uiStart('es'); ui.openResearch('drones1');
                document.querySelector('#research-dialog [data-action="rs-filter"][data-area="Inteligencia"]').click();
            });
            await page.waitForTimeout(300);
            const m = await page.evaluate(() => {
                const d = document.querySelector('#research-dialog');
                return { rows: d.querySelectorAll('.rs-row').length, over: d.scrollWidth - d.clientWidth, icons: d.querySelectorAll('.rs-patch svg').length };
            });
            if (m.rows !== 5 || m.over > 3 || m.icons < 5) errors.push(`${file}: ${JSON.stringify(m)}`);
            await page.screenshot({ path: join(out, `${file}.png`) });
            await page.close();
        }
        if (errors.length) { failed++; console.log(`FALLA ${SHOTS}\n      ${errors.join('\n      ')}`); }
        else console.log(`ok    ${SHOTS} (${join(out, 'drones-investigacion.png')}, drones-investigacion-movil.png)`);
    }
    for (const page of pages.values()) if (page.errors.length) { failed++; console.log(`FALLA errores en la página:\n      ${page.errors.join('\n      ')}`); }
} finally {
    await browser.close();
    server.close();
}
console.log(`${ran - Math.min(failed, ran)}/${ran} pruebas superadas`);
process.exit(failed ? 1 : 0);
