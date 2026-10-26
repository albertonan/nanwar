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
            for (const k of ['squadrons', 'airfields', 'aaSites', 'sats', 'swarms']) {
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
