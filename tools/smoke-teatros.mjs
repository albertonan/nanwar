// Pruebas de los teatros en el navegador: guarniciones (fichas de lejos, pestaña Batalla), teatros y propuesta de organización.
// Sirve el juego por HTTP, crea partidas nuevas con GameEngine y comprueba las reglas una a una.
// Uso: node basicmilitary/tools/smoke-teatros.mjs [filtro]   (CHROME=<ruta> para usar otro navegador)
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
        // Ciudad propia de `owner` sin ejércitos a 3 casillas ni capital, con su casilla.
        cleanCity(g, owner, skip = 0) {
            for (const p of PROVINCES) {
                const c = p.city;
                if (g.owner[c] !== owner || CAPITAL_OF[c] >= 0 || afloat(c) || skip-- > 0) continue;
                for (const k of g.nearCells(c, 3).keys()) { const x = g.armyOn(k); if (x) g.removeArmy(x); }
                return c;
            }
            throw new Error('no hay ciudad');
        },
        // Casilla de tierra libre a `d` pasos exactos de `cell`.
        ringCell(g, cell, d) {
            const c = [...g.nearCells(cell, d)].find(([c, k]) => k === d && isLand(c) && !g.armyAt[c] && CITY_OF[c] < 0)?.[0];
            if (c === undefined) throw new Error('no hay casilla a ' + d);
            return c;
        },
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
        bloc(g, ...ids) { const b = g.createBloc(ids[0], 'Pacto de prueba', false); for (const x of ids) b.members.add(x); g.blocsChanged(); return b; },
        // Pasa a `a` todas las casillas de las provincias dadas (dueño y dueño legítimo), sin los ejércitos ajenos de encima.
        give(g, a, pids) {
            for (const pid of pids) for (const c of PROVINCES[pid].cells) { const x = g.armyOn(c); if (x && x.owner !== a) g.removeArmy(x); g.owner[c] = a; g.legal[c] = a; }
            g.version++;
        },
        // ¿Toca la provincia `pid` tierra de `a` (fuera de ella misma)?
        touches(g, a, pid) {
            return PROVINCES[pid].cells.some(c => [0, 1, 2, 3, 4, 5].some(d => { const j = G.nb[c * 6 + d]; return j >= 0 && isLand(j) && g.owner[j] === a && G.prov[j] !== pid; }));
        },
        // Dos teatros para `a`: le pasa un bloque de 4 provincias de `b` lejos de su capital, sin tocar su tierra. Devuelve sus ids.
        twoBlocks(g, a, b, n = 4) {
            const cap = g.nations[a].capitalCell, theirs = PROVINCES.filter(p => g.owner[p.city] === b && p.country === b && CAPITAL_OF[p.city] < 0);
            const nbs = p => new Set(p.cells.flatMap(c => [0, 1, 2, 3, 4, 5].map(d => G.nb[c * 6 + d]).filter(j => j >= 0 && isLand(j) && G.prov[j] !== p.id).map(j => G.prov[j])));
            const seed = theirs.reduce((m, p) => (hexDist(p.city, cap) > hexDist(m.city, cap) ? p : m));
            const block = [seed.id];
            for (let i = 0; i < block.length && block.length < n; i++)
                for (const q of nbs(PROVINCES[block[i]])) if (block.length < n && !block.includes(q) && theirs.some(p => p.id === q) && !T.touches(g, a, q)) block.push(q);
            if (block.length < n) throw new Error('no hay bloque de ' + n);
            T.give(g, a, block);
            T.ok(block.every(pid => !PROVINCES[pid].cells.some(c => [0, 1, 2, 3, 4, 5].some(d => { const j = G.nb[c * 6 + d]; return j >= 0 && g.owner[j] === a && !block.includes(G.prov[j]); }))), 'el bloque no toca la metrópoli');
            return block;
        },
        // Casilla de tierra libre y sin ciudad en las provincias dadas.
        freeIn(g, pids, skip = 0) {
            for (const pid of pids) for (const c of PROVINCES[pid].cells) if (T.free(g, c) && skip-- <= 0) return c;
            throw new Error('no hay casilla libre');
        },
        // Ejército grande de `b` a 2 casillas de la frontera con `a`, fuera de ciudad.
        armedNear(g, a, b, units = 20) {
            const [c0] = T.border(g, a, b);
            const two = [...g.nearCells(c0, 2)].find(([x, k]) => k === 2 && isLand(x) && g.owner[x] === b && CITY_OF[x] < 0 && !g.armyAt[x])[0];
            return T.army(g, b, two, units);
        },
        // España sin más ejércitos que seis sueltos junto a Portugal y uno portugués grande cerca de la frontera (en paz).
        lineScene(g = T.game()) {
            const es = T.nation('es'), pt = T.nation('pt');
            if (g.player === null) g.start(es);
            for (const a of [...g.armies.values()]) g.removeArmy(a);
            const mine = [0, 1, 2, 3, 4, 5].map(() => T.army(g, es, T.border(g, es, pt)[0], 6));
            const big = T.armedNear(g, es, pt);
            return { g, es, pt, mine, big, metro: g.theatres(es).find(t => t.capital).idx };
        },
        // España sin más ejércitos que cuatro sueltos juntos (a una casilla unos de otros) en el llano; sin vecinos armados.
        clusterScene(g = T.game()) {
            const es = T.nation('es');
            if (g.player === null) g.start(es);
            for (const a of [...g.armies.values()]) g.removeArmy(a);
            const [n, c] = T.plainPair(g, es);
            const cells = [c, ...[0, 1, 2, 3, 4, 5].map(d => G.nb[c * 6 + d]).filter(j => j !== n).slice(0, 3)];
            return { g, es, four: cells.map((x, i) => T.army(g, es, x, 4 + i)), metro: g.theatres(es).find(t => t.capital).idx };
        },
        // Dos teatros (tarea 4) con toda la tropa en el francés, Francia aliada (el camino) y guerra con Portugal.
        marchScene(g = T.game()) {
            const es = T.nation('es'), pt = T.nation('pt'), fr = T.nation('fr');
            if (g.player === null) g.start(es);
            const block = T.twoBlocks(g, es, fr);
            for (const a of [...g.armies.values()]) g.removeArmy(a);
            const spots = [];   // separados (a más de 2 casillas), para que no hagan un racimo de agrupación
            for (const pid of block) for (const c of PROVINCES[pid].cells) if (spots.length < 3 && T.free(g, c) && spots.every(x => hexDist(x, c) > 2)) spots.push(c);
            T.ok(spots.length === 3, 'tres casillas separadas en el bloque');
            const mine = spots.map(c => T.army(g, es, c, 10));
            T.bloc(g, es, fr);
            g.declareWar(es, pt);
            const th = g.theatres(es);
            return { g, es, pt, fr, mine, block, far: th.findIndex(t => !t.capital), metro: th.findIndex(t => t.capital) };
        },
        ids: xs => xs.map(a => (typeof a === 'number' ? a : a.id)).sort((x, y) => x - y),
        // En la interfaz: la escena de la línea (tarea 6) y, lejos de Portugal, cuatro sueltos juntos; la pestaña Mando abierta.
        uiScene() {
            const g = T.uiStart('es'), s = T.lineScene(g);
            for (let i = 0; i < 14; i++) s.mine.push(T.army(g, s.es, T.border(g, s.es, s.pt)[0], 6));   // de sobra para cubrir la línea
            let k = 0, c, n;
            do [n, c] = T.plainPair(g, s.es, k++); while (hexDist(c, s.big.cell) < 14);
            const cells = [c, ...[0, 1, 2, 3, 4, 5].map(d => G.nb[c * 6 + d]).filter(j => j !== n).slice(0, 3)];
            s.four = cells.map((x, i) => T.army(g, s.es, x, 4 + i));
            s.metro = g.theatres(s.es).find(t => t.capital).idx;
            for (const d of document.querySelectorAll('dialog[open]')) d.close();
            ui.draft = null; ui.tab = 'mando'; ui.drawerOpen = true; ui.render();
            s.card = () => $('#drawer-body').querySelector(`[data-theatre="${s.metro}"]`);
            s.click = (action, key) => s.card().querySelector(`[data-action="${action}"]${key ? `[data-key="${key}"]` : ''}`).click();
            return s;
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
    ['1 · isGarrison: pequeña y quieta en su ciudad sí; con encargo, grande, fuera o amenazada, no', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es);
        const C = T.cleanCity(g, es), a = T.army(g, es, C, 3);
        T.eq(g.isGarrison(a), true, 'pequeña y quieta');
        a.order = { kind: 'hold' };
        T.eq(g.isGarrison(a), true, 'con «Mantener» sigue siendo guarnición');
        a.order = null;
        const dest = T.farCell(g, es, C, 3);
        T.ok(g.setOrder(a, { kind: 'march', dest }), 'orden de marcha aceptada');
        T.eq(g.isGarrison(a), false, 'con orden de marcha');
        g.clearOrder(a);
        for (const k of ['op', 'group', 'form']) { a[k] = 1; T.eq(g.isGarrison(a), false, 'con ' + k); a[k] = 0; }
        a.units.infantry = 6; T.eq(g.isGarrison(a), false, 'de 6 unidades'); a.units.infantry = 3;
        T.eq(g.isGarrison(a), true, 'de vuelta al principio');
        const plain = T.plainPair(g, es)[1];
        T.eq(g.isGarrison(T.army(g, es, plain, 2)), false, 'fuera de una ciudad');
        const fc = PROVINCES.find(p => g.owner[p.city] === fr).city;
        const fa = g.armyOn(fc) ?? T.army(g, fr, fc, 2);
        fa.units = { infantry: 2, tank: 0, artillery: 0 };
        T.eq(g.isGarrison(fa), false, 'de otro país');
        g.declareWar(es, fr);
        const foe = T.army(g, fr, T.ringCell(g, C, 2), 3);
        T.eq(g.isGarrison(a), false, 'enemigo a 2 casillas');
        g.removeArmy(foe);
        const foe3 = T.army(g, fr, T.ringCell(g, C, 3), 3);
        T.eq(g.isGarrison(a), true, 'enemigo a 3 casillas');
        g.removeArmy(foe3);
        const land = T.ringCell(g, C, 2); g.owner[land] = fr; g.version++;
        T.eq(g.isGarrison(a), true, 'tierra enemiga a 2 sin ejército');
        return true;
    }],
    ['2 · de lejos, la guarnición es un punto y no una ficha; con la casilla, ficha', () => {
        const g = T.uiStart('es'), es = g.player;
        ui.view.setMode('sencilla');
        const C = T.cleanCity(g, es), D = T.cleanCity(g, es, 1);
        const small = T.army(g, es, C, 2), big = T.army(g, es, D, 40);
        T.ok(g.isGarrison(small) && !g.isGarrison(big), 'una guarnición y un ejército grande');
        const at = (calls, c) => calls.filter(t => t.wx === G.cx[c] && t.wy === G.cy[c]).length;
        const calls = [], draw = ui.view.drawCounter;
        ui.view.drawCounter = function (t, ...rest) { calls.push(t); return draw.call(this, t, ...rest); };
        try {
            ui.view.scale = 3 / G.S; ui.view.centerOn(C, 3); ui.view.draw();
            T.ok(G.S * ui.view.scale < FAR_HEX, 'de lejos');
            T.eq(at(calls, C), 0, 'sin ficha de la guarnición');
            T.ok(at(calls, D) > 0, 'el ejército grande se ve');
            ui.setLayer('garrisons', true);
            T.eq(readPrefs().garrisons, true, 'la casilla se recuerda');
            calls.length = 0; ui.view.draw();
            T.ok(at(calls, C) > 0, 'con la casilla, ficha');
            ui.setLayer('garrisons', false);
            const dest = T.farCell(g, es, C, 3);
            T.ok(g.setOrder(small, { kind: 'march', dest }), 'orden de marcha');
            calls.length = 0; ui.view.draw();
            T.ok(at(calls, C) > 0, 'con una orden de marcha vuelve la ficha');
        } finally { ui.view.drawCounter = draw; ui.setLayer('garrisons', false); }
        ui.mapMenu = true; ui.render();
        T.ok($('#map-menu').querySelector('[data-action="layer-garrisons"]') && $('#map-menu').textContent.includes('Guarniciones de lejos'), 'la casilla está en el panel Mapa');
        ui.mapMenu = false; ui.render();
        return true;
    }],
    ['3 · Batalla: guarniciones en una fila plegada que no cuenta en Sin agrupar', () => {
        const g = T.uiStart('es'), es = g.player;
        for (const a of [...g.armies.values()]) if (a.owner === es) g.removeArmy(a);
        const gars = [0, 1, 2].map(i => T.army(g, es, T.cleanCity(g, es, i), 2 + i));
        const bigs = [0, 1].map(i => T.army(g, es, T.plainPair(g, es, i)[1], 12));
        T.ok(gars.every(a => g.isGarrison(a)) && bigs.every(a => !g.isGarrison(a)), 'tres guarniciones y dos grandes');
        ui.tab = 'batalla'; ui.drawerOpen = true; ui.obGarrisonsOpen = false; ui.render();
        const body = $('#drawer-body'), row = body.querySelector('[data-ob-garrisons]');
        T.ok(row && row.textContent.includes('3 ejércitos') && row.textContent.includes('Guarniciones'), 'la fila dice «Guarniciones · 3 ejércitos»: ' + row?.textContent.replace(/s+/g, ' '));
        T.ok(row.textContent.includes('9 unidades'), 'y sus 9 unidades');
        T.eq(row.querySelectorAll('[data-ob-army]').length, 0, 'plegada: sin filas de ejército');
        T.ok(body.textContent.includes('Sin agrupar · 2'), 'Sin agrupar cuenta solo los grandes');
        T.eq(body.querySelectorAll('[data-ob-army]').length, 2, 'solo los dos grandes en la lista');
        body.querySelector('[data-action="ob-garrisons"]').click();
        T.eq($('#drawer-body').querySelectorAll('[data-ob-army]').length, 5, 'desplegada: tres filas más');
        T.eq($('#drawer-body').querySelector('[data-ob-garrisons]').querySelectorAll('[data-ob-army]').length, 3, 'dentro de la fila');
        $('#drawer-body').querySelector('[data-action="ob-garrisons"]').click();
        T.eq($('#drawer-body').querySelectorAll('[data-ob-army]').length, 2, 'se pliega otra vez');
        for (const a of gars) g.removeArmy(a);
        ui.render();
        T.ok(!$('#drawer-body').querySelector('[data-ob-garrisons]'), 'sin guarniciones, no sale la fila');
        return true;
    }],
    ['4 · teatros: dos bloques, un islote que se suma y nombres', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es);
        T.eq(g.theatres(es).length, 1, 'al empezar, un teatro');
        const block = T.twoBlocks(g, es, fr);
        let th = g.theatres(es);
        T.eq(th.length, 2, 'dos bloques, dos teatros');
        const metro = th.find(t => t.capital), far = th.find(t => !t.capital);
        T.ok(metro && metro.name.startsWith('Metrópoli: '), 'la metrópoli: ' + metro?.name);
        T.eq(far.name, g.nm(fr), 'el otro, con el nombre de Francia');
        T.ok(th[0].cells.size >= th[1].cells.size, 'de mayor a menor');
        T.ok(th.every((t, i) => t.idx === i), 'idx es su índice');
        T.eq(far.provinces.slice().sort((x, y) => x - y), block.slice().sort((x, y) => x - y), 'las provincias del bloque');
        for (const pid of block) T.eq(g.theatreOf(es, PROVINCES[pid].city), far.idx, 'theatreOf de una casilla del bloque');
        T.eq(g.theatreOf(es, g.nations[es].capitalCell), metro.idx, 'theatreOf de la capital');
        // Un ejército en el mar, junto a la costa española, va a la metrópoli.
        const sea = [...metro.cells].flatMap(c => CITY_OF[c] < 0 ? [0, 1, 2, 3, 4, 5].map(d => G.nb[c * 6 + d]) : []).find(j => j >= 0 && afloat(j) && !g.armyAt[j]);
        const boat = T.army(g, es, sea, 2);
        th = g.theatres(es);
        T.eq(g.theatreOf(es, sea), th.find(t => t.capital).idx, 'el mar junto a España, a la metrópoli');
        T.ok(th.find(t => t.capital).armies.includes(boat), 'y su ejército, en ella');
        // Islote: una provincia francesa suelta, cerca del bloque y sin tocar tierra española.
        const mine = G.land.filter(c => g.owner[c] === es).length;
        const isle = PROVINCES.filter(p => g.owner[p.city] === fr && CAPITAL_OF[p.city] < 0 && !T.touches(g, es, p.id) && p.cells.length < 0.03 * mine)
            .sort((x, y) => hexDist(x.city, PROVINCES[block[0]].city) - hexDist(y.city, PROVINCES[block[0]].city))[0];
        T.ok(isle, 'hay una provincia para el islote');
        const before = g.theatres(es).map(t => new Set(t.cells));
        T.give(g, es, [isle.id]);
        th = g.theatres(es);
        T.eq(th.length, 2, 'el islote se suma: siguen siendo 2');
        const gap = cells => Math.min(...isle.cells.flatMap(c => [...cells].map(x => hexDist(c, x))));
        const near = before.reduce((m, s, i) => (gap(s) < gap(before[m]) ? i : m), 0);
        const want = th.findIndex(t => [...before[near]].every(c => t.cells.has(c)));
        T.ok(th[want].provinces.includes(isle.id) && isle.cells.every(c => th[want].cells.has(c)), 'el islote, en el teatro más cercano');
        T.eq(g.theatreOf(es, isle.city), want, 'theatreOf del islote');
        return true;
    }],
    ['4 · frontera peligrosa: pesos por vecino', () => {
        const g = T.game(), es = T.nation('es'), pt = T.nation('pt'), fr = T.nation('fr');
        g.start(es);
        for (const a of [...g.armies.values()]) if (a.owner !== es) g.removeArmy(a);
        const metro = () => g.theatres(es).find(t => t.capital), w = o => metro().border.find(b => b.nation === o)?.weight ?? 0;
        T.ok(metro().border.length >= 2 && metro().border.every(b => b.weight === 1 && !b.war), 'en paz y sin ejércitos, todos peso 1');
        T.eq([w(pt), w(fr)], [1, 1], 'Portugal y Francia, peso 1');
        const ptb = metro().border.find(b => b.nation === pt);
        T.ok(ptb.cells.every(c => g.owner[c] === es && [0, 1, 2, 3, 4, 5].some(d => g.owner[G.nb[c * 6 + d]] === pt)), 'las casillas de frontera son españolas junto a Portugal');
        T.eq(metro().danger, metro().border.reduce((s, b) => s + b.weight * b.cells.length, 0), 'el peligro es la suma de casillas por peso');
        // Un ejército portugués grande a 2 casillas de la frontera, fuera de ciudad.
        const [c0] = T.border(g, es, pt);
        const two = [...g.nearCells(c0, 2)].find(([x, k]) => k === 2 && isLand(x) && g.owner[x] === pt && CITY_OF[x] < 0 && !g.armyAt[x])[0];
        const big = T.army(g, pt, two, 20);
        T.eq(w(pt), 2, 'con 20 unidades a 2 casillas, peso 2');
        g.removeArmy(big);
        T.eq(w(pt), 1, 'sin él, otra vez 1');
        // Uno pequeño en su propia ciudad, a 3 casillas o menos de la frontera: guarnición, no cuenta.
        const city = PROVINCES.map(p => p.city).find(c => g.owner[c] === pt && [...g.nearCells(c, 3).keys()].some(x => g.owner[x] === es));
        T.ok(city !== undefined, 'hay una ciudad portuguesa a 3 casillas de España');
        const gar = T.army(g, pt, city, 3);
        T.eq(w(pt), 1, 'una guarnición portuguesa en su ciudad no cuenta');
        gar.units.infantry = 6; g.armyVersion++;
        T.eq(w(pt), 2, 'con 6 unidades ya cuenta');
        g.removeArmy(gar);
        g.declareWar(es, fr);
        const f = metro().border.find(b => b.nation === fr);
        T.eq([f.weight, f.war], [3, true], 'en guerra con Francia, peso 3');
        const dz = metro().border.map(b => b.weight * b.cells.length);
        T.ok(dz.every((x, i) => !i || dz[i - 1] >= x), 'de más peligro a menos');
        T.bloc(g, es, pt);
        T.ok(!metro().border.some(b => b.nation === pt), 'un aliado no es frontera peligrosa');
        return true;
    }],
    ['4 · reparto: aviso con la tropa lejos del peligro', () => {
        const g = T.game(), es = T.nation('es'), pt = T.nation('pt'), fr = T.nation('fr');
        g.start(es);
        const block = T.twoBlocks(g, es, fr);
        for (const a of [...g.armies.values()]) g.removeArmy(a);
        for (let i = 0; i < 3; i++) T.army(g, es, T.freeIn(g, block), 10);
        const th = g.theatres(es), metro = th.find(t => t.capital).idx, far = th.find(t => !t.capital).idx;
        T.eq(th[far].units, 30, 'toda la tropa en el teatro francés');
        let r = g.troopBalance(es);
        T.eq([r.over, r.under], [[], []], 'sin guerra ni ejércitos vecinos, no avisa');
        T.eq(r.share.length, 2, 'una parte por teatro');
        T.eq(r.share[far].troops, 1, 'el francés tiene toda la tropa');
        g.declareWar(es, pt);
        r = g.troopBalance(es);
        T.ok(r.over.includes(far), 'el francés, muy defendido: ' + JSON.stringify(r));
        T.ok(r.under.includes(metro), 'la metrópoli, poco defendida');
        T.ok(Math.abs(r.share.reduce((s, x) => s + x.danger, 0) - 1) < 1e-9, 'las partes de peligro suman 1');
        return true;
    }],
    ['4 · sin territorio: sin teatros', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es);
        for (const a of [...g.armies.values()]) if (a.owner === es) g.removeArmy(a);
        for (const c of G.land) if (g.owner[c] === es) { g.owner[c] = fr; g.legal[c] = fr; }
        g.version++;
        const sea = G.land.flatMap(c => g.owner[c] === fr ? [0, 1, 2, 3, 4, 5].map(d => G.nb[c * 6 + d]) : []).find(j => j >= 0 && afloat(j) && !g.armyAt[j]);
        T.army(g, es, sea, 3);
        T.eq(g.theatres(es), [], 'sin territorio, sin teatros');
        T.eq(g.theatreOf(es, sea), -1, 'ni teatro para el mar');
        T.eq(g.troopBalance(es), { over: [], under: [], share: [] }, 'ni reparto');
        return true;
    }],
    ['5 · Mando: tarjetas de teatro, aviso y elegir los sin encargo', () => {
        const g = T.uiStart('es'), es = g.player, pt = T.nation('pt'), fr = T.nation('fr');
        const block = T.twoBlocks(g, es, fr);
        for (const a of [...g.armies.values()]) g.removeArmy(a);
        for (let i = 0; i < 3; i++) T.army(g, es, T.freeIn(g, block), 10);
        g.declareWar(es, pt);
        const th = g.theatres(es), far = th.findIndex(t => !t.capital), metro = th.findIndex(t => t.capital), N = th[far].idle.length;
        T.eq(N, 3, 'tres ejércitos sin encargo en el teatro francés');
        for (const d of document.querySelectorAll('dialog[open]')) d.close();
        ui.tab = 'mando'; ui.drawerOpen = true; ui.render();
        const body = $('#drawer-body'), cards = body.querySelectorAll('[data-theatre]');
        T.eq(cards.length, 2, 'dos tarjetas');
        th.forEach((t, i) => T.ok(cards[i].textContent.includes(t.name), 'la tarjeta ' + i + ' lleva su nombre: ' + t.name));
        const warn = body.querySelector('[data-th-warning]');
        T.ok(warn && warn.textContent.includes('Reparto descompensado'), 'el aviso de reparto');
        T.ok(warn.textContent.includes('100 % de tus tropas') && warn.textContent.includes(th[far].name), 'con el teatro francés y sus porcentajes: ' + warn.textContent);
        T.ok(body.innerHTML.indexOf('data-th-warning') < body.innerHTML.indexOf('data-theatre') && body.textContent.indexOf('Teatros') < body.textContent.indexOf('Operaciones ·'), 'la sección va antes de Operaciones');
        const card = body.querySelector(`[data-theatre="${far}"]`), mcard = body.querySelector(`[data-theatre="${metro}"]`);
        T.ok(card.textContent.includes(`Sin encargo: ${N}`), 'Sin encargo: N en la tarjeta francesa: ' + card.textContent.replace(/\s+/g, ' '));
        T.ok(card.textContent.includes('3 ejércitos') && card.textContent.includes('30 unidades') && card.textContent.includes('4 provincias'), 'el resumen del teatro');
        T.ok(mcard.textContent.includes(g.nm(pt)) && mcard.querySelector('.chip.guerra'), 'la frontera de la metrópoli con Portugal, en guerra');
        T.ok(card.querySelector('[data-action="th-goto"]') && card.querySelector('[data-action="th-propose"]'), 'los botones Ver y Proponer organización');
        card.querySelector('[data-action="th-pick"]').click();
        T.eq(ui.sel.size, N, 'elegir los sin encargo los pone en la selección');
        T.ok([...ui.sel].every(id => th[far].idle.some(a => a.id === id)), 'y son ellos');
        ui.tab = 'mando'; ui.drawerOpen = true; ui.render();
        $('#drawer-body').querySelector(`[data-theatre="${far}"] [data-action="th-goto"]`).click();
        const [sx, sy] = ui.view.toScreen(...(() => { const cs = [...th[far].cells]; return [cs.reduce((s, c) => s + G.cx[c], 0) / cs.length, cs.reduce((s, c) => s + G.cy[c], 0) / cs.length]; })());
        T.ok(sx > 0 && sx < ui.view.w && sy > 0 && sy < ui.view.h, 'Ver lleva el teatro a la pantalla');
        ui.tab = 'mando'; ui.drawerOpen = true;
        const t0 = performance.now();
        for (let i = 0; i < 20; i++) ui.render();
        const ms = (performance.now() - t0) / 20;
        T.ok(ms < 100, 'la pestaña Mando tarda ' + ms.toFixed(1) + ' ms');
        return true;
    }],
    ['6 · propuesta: línea contra un vecino armado en paz, ninguna contra uno tranquilo', () => {
        const { g, es, pt, mine, big, metro } = T.lineScene();
        const lines = () => g.proposeOrganization(es, metro).pieces.filter(p => p.kind === 'line');
        let ls = lines();
        T.ok(ls.length === 1 && ls[0].enemy === pt, 'una línea contra Portugal: ' + JSON.stringify(ls));
        const L = ls[0];
        T.ok(L.cells.length > 0 && L.cells.every(c => g.owner[c] === es), 'en tierra propia');
        T.ok(L.armies.length > 0 && L.armies.length <= L.cells.length && L.armies.every(id => mine.some(a => a.id === id)), 'con sus ejércitos sueltos, no más que casillas: ' + JSON.stringify(L));
        T.eq(L.short, Math.max(0, L.cells.length - L.armies.length), 'los que faltan');
        T.ok(L.makesOp && L.dest === -1 && L.turns === null, 'crea una operación; sin destino ni turnos');
        T.ok(L.text.includes(g.nm(pt)), 'la frase nombra a Portugal: ' + L.text);
        g.removeArmy(big);
        T.eq(lines().length, 0, 'sin el ejército portugués, ninguna línea');
        g.declareWar(es, pt);
        T.armedNear(g, es, pt);
        const want = g.frontPlan(es, pt).line;
        ls = lines();
        T.ok(ls.length === 1 && ls[0].enemy === pt, 'en guerra, una línea contra Portugal');
        T.eq(ls[0].cells, want, 'en guerra, la de frontPlan');
        return true;
    }],
    ['6 · propuesta: reserva, agrupaciones y nada cambia sin aceptar', () => {
        const { g, es, four, metro } = T.clusterScene();
        const snap = () => JSON.stringify([...g.armies.values()].map(a => [a.id, a.cell, a.op, a.group, a.order?.kind ?? null]));
        const before = snap(), ops0 = g.opsOf(es).length, groups0 = g.armyGroups(es).length;
        const p = g.proposeOrganization(es, metro);
        T.eq(snap(), before, 'proponer no cambia ningún ejército');
        T.eq([g.opsOf(es).length, g.armyGroups(es).length], [ops0, groups0], 'ni crea operaciones ni agrupaciones');
        T.eq(p.th, metro, 'el teatro');
        T.eq(p.stamp, g.theatreData(es).key, 'la clave de versiones de los teatros');
        T.eq(p.pieces.filter(x => x.kind === 'line').length, 0, 'sin vecinos armados, sin líneas');
        const grp = p.pieces.filter(x => x.kind === 'group');
        T.eq(grp.length, 1, 'una agrupación');
        T.eq(T.ids(grp[0].armies), T.ids(four), 'con los cuatro');
        T.ok(!grp[0].makesOp && grp[0].text.includes('4 ejércitos'), 'no crea operación y dice cuántos: ' + grp[0].text);
        const res = p.pieces.filter(x => x.kind === 'reserve');
        T.eq(res.length, 1, 'una reserva');
        const R = res[0], city = R.cells[0];
        T.ok(CITY_OF[city] >= 0 && g.owner[city] === es && g.theatreOf(es, city) === metro, 'en una ciudad propia del teatro');
        T.ok(R.dest === city && R.armies.length === 0 && R.makesOp, 'sin ejércitos y crea una operación');
        T.ok(R.text.includes('Retaguardia'), 'con Retaguardia apagada, la frase lo dice: ' + R.text);
        const order = ['line', 'reserve', 'group', 'march'];
        T.ok(p.pieces.every((x, i) => !i || order.indexOf(p.pieces[i - 1].kind) <= order.indexOf(x.kind)), 'en el orden de la spec');
        T.eq(new Set(p.pieces.map(x => x.key)).size, p.pieces.length, 'claves distintas');
        g.nations[es].command.rear = true;
        T.ok(!g.proposeOrganization(es, metro).pieces.find(x => x.kind === 'reserve').text.includes('Retaguardia'), 'con Retaguardia encendida, no');
        g.createOp(es, 'reserva', [city]);
        T.eq(g.proposeOrganization(es, metro).pieces.filter(x => x.kind === 'reserve').length, 0, 'con una reserva en el teatro, ninguna más');
        return true;
    }],
    ['6 · propuesta: marcha entre teatros con camino y turnos', () => {
        const { g, es, far, metro, mine } = T.marchScene();
        T.ok(g.troopBalance(es).over.includes(far), 'el teatro francés, muy defendido');
        const p = g.proposeOrganization(es, far), ms = p.pieces.filter(x => x.kind === 'march');
        T.ok(ms.length >= 1 && ms.length <= 6, 'marchas: ' + JSON.stringify(p.pieces.map(x => x.text)));
        for (const m of ms) {
            T.eq(g.theatreOf(es, m.dest), metro, 'destino en la metrópoli');
            T.ok(m.turns > 0 && m.text.includes('turnos'), 'con sus turnos: ' + m.text);
            T.ok(m.armies.length === 1 && mine.some(a => a.id === m.armies[0]) && !m.makesOp, 'un ejército y sin operación');
            T.eq([m.cells[0], m.cells[m.cells.length - 1]], [g.armies.get(m.armies[0]).cell, m.dest], 'el camino va del ejército al destino');
        }
        T.eq(g.proposeOrganization(es, metro).pieces.filter(x => x.kind === 'march').length, 0, 'la metrópoli no manda nada');
        return true;
    }],
    ['6 · propuesta: en el teatro muy defendido, la masa mayor marcha y no se agrupa', () => {
        const { g, es, far, mine, block } = T.marchScene();
        for (const a of mine) g.removeArmy(a);
        // Cuatro sueltos juntos (a una casilla del primero): el mayor haría racimo con los otros tres.
        const inBlock = c => block.includes(G.prov[c]);
        const c = block.flatMap(pid => PROVINCES[pid].cells).find(x => T.free(g, x) && [0, 1, 2, 3, 4, 5].map(d => G.nb[x * 6 + d]).filter(j => j >= 0 && inBlock(j) && T.free(g, j)).length >= 3);
        T.ok(c !== undefined, 'hay sitio para el racimo');
        const nbs = [0, 1, 2, 3, 4, 5].map(d => G.nb[c * 6 + d]).filter(j => j >= 0 && inBlock(j) && T.free(g, j)).slice(0, 3);
        const big = T.army(g, es, c, 40);
        for (const x of nbs) T.army(g, es, x, 5);
        T.ok(g.troopBalance(es).over.includes(far), 'el teatro francés, muy defendido');
        const p = g.proposeOrganization(es, far);
        T.ok(p.pieces.some(x => x.kind === 'march' && x.armies.includes(big.id)), 'la masa mayor marcha: ' + JSON.stringify(p.pieces.map(x => x.text)));
        T.ok(!p.pieces.some(x => x.kind === 'group' && x.armies.includes(big.id)), 'y no va en una agrupación');
        const all = p.pieces.flatMap(x => x.armies);
        T.eq(all.length, new Set(all).size, 'las piezas no comparten ejércitos');
        const order = ['line', 'reserve', 'group', 'march'];
        T.ok(p.pieces.every((x, i) => !i || order.indexOf(p.pieces[i - 1].kind) <= order.indexOf(x.kind)), 'la lista, en el orden de la spec');
        return true;
    }],
    ['6 · aceptar: exactamente sus ejércitos, sin tocar las operaciones del jugador', () => {
        // Línea, con una reserva del jugador de 2 ejércitos lejos de la frontera.
        let { g, es, mine, metro } = T.lineScene();
        const city = PROVINCES.map(p => p.city).find(c => g.owner[c] === es && CAPITAL_OF[c] < 0 && ![...g.nearCells(c, 4).keys()].some(x => g.armyAt[x]));
        const res = g.createOp(es, 'reserva', [city]), two = [1, 2].map(() => T.army(g, es, T.ringCell(g, city, 1), 8));
        for (const a of two) g.assignArmy(a, res.id);
        const L = g.proposeOrganization(es, metro).pieces.find(x => x.kind === 'line');
        T.ok(L && !L.armies.some(id => two.some(a => a.id === id)), 'la línea no toma los de la reserva');
        const ops0 = g.opsOf(es).length, logs0 = g.logs.length;
        T.ok(g.acceptPiece(es, L), 'acepta la línea');
        T.eq(g.opsOf(es).length, ops0 + 1, 'una operación más');
        const op = g.opsOf(es).find(o => o.kind === 'defensa');
        T.eq(op.cells, L.cells, 'con el trazado de la pieza');
        T.eq(T.ids(g.opMembers(op)), T.ids(L.armies), 'y exactamente sus ejércitos');
        T.eq(T.ids(g.opMembers(res)), T.ids(two), 'la reserva sigue con sus 2');
        T.ok(g.logs.slice(logs0).some(l => l.msg.startsWith('Aceptas: ')), 'lo apunta en el registro');
        T.ok(mine.filter(a => !L.armies.includes(a.id)).every(a => !a.op), 'los demás sueltos siguen sueltos');
        T.ok(g.pieceWhy(es, L).includes('otro encargo') && !g.acceptPiece(es, L), 'aceptarla otra vez no se puede');
        T.eq(g.opsOf(es).length, ops0 + 1, 'ni crea otra');
        // Agrupación.
        ({ g, es, metro } = T.clusterScene());
        const Gp = g.proposeOrganization(es, metro).pieces.find(x => x.kind === 'group');
        T.eq(g.pieceWhy(es, Gp), '', 'la agrupación se puede aceptar');
        T.ok(g.acceptPiece(es, Gp), 'acepta la agrupación');
        const grs = g.armyGroups(es);
        T.eq(grs.length, 1, 'una agrupación nueva');
        T.eq(T.ids(g.groupMembers(es, grs[0].id)), T.ids(Gp.armies), 'con esos ejércitos');
        // Marchas.
        ({ g, es } = T.marchScene());
        const sc = g.theatres(es), far = sc.findIndex(t => !t.capital), metro2 = sc.findIndex(t => t.capital);
        const ms = g.proposeOrganization(es, far).pieces.filter(x => x.kind === 'march');
        T.ok(ms.length, 'hay marchas');
        for (const m of ms) T.ok(g.acceptPiece(es, m), 'acepta la marcha');
        for (const m of ms) for (const id of m.armies) {
            const a = g.armies.get(id);
            T.ok(a.order?.kind === 'march' && g.theatreOf(es, a.order.dest) === metro2, 'con orden de marcha a la metrópoli');
        }
        return true;
    }],
    ['6 · aceptar: tope y ejércitos que ya no están libres', () => {
        const { g, es, metro } = T.lineScene();
        const L = g.proposeOrganization(es, metro).pieces.find(x => x.kind === 'line');
        T.eq(g.pieceWhy(es, L), '', 'con sitio, se puede');
        const cities = PROVINCES.filter(q => g.owner[q.city] === es).map(q => q.city);
        for (let i = 0; g.opsOf(es).length < g.commandCap(es); i++) T.ok(g.createOp(es, 'reserva', [cities[i % cities.length]]), 'reserva de relleno');
        T.ok(g.pieceWhy(es, L).includes('No caben más operaciones'), 'el estado mayor lleno: ' + g.pieceWhy(es, L));
        const n0 = g.opsOf(es).length;
        T.eq(g.acceptPiece(es, L), false, 'no se acepta');
        T.eq(g.opsOf(es).length, n0, 'ni crea la operación');
        T.ok(L.armies.every(id => !g.armies.get(id).op), 'ni asigna a nadie');
        const c = T.clusterScene();
        const Gp = c.g.proposeOrganization(c.es, c.metro).pieces.find(x => x.kind === 'group');
        c.g.setOrder(c.g.armies.get(Gp.armies[0]), { kind: 'hold' });
        T.ok(c.g.pieceWhy(c.es, Gp).includes('1 de sus ejércitos ya tiene otro encargo'), 'uno con una orden a mano: ' + c.g.pieceWhy(c.es, Gp));
        T.eq(c.g.acceptPiece(c.es, Gp), false, 'no se acepta');
        T.eq(c.g.armyGroups(c.es).length, 0, 'ni se crea la agrupación');
        return true;
    }],
    ['7 · la propuesta en la tarjeta: aceptar, descartar y el mapa', () => {
        const s = T.uiScene(), g = s.g, es = s.es;
        s.click('th-propose');
        const dr = ui.draft;
        T.ok(dr && dr.th === s.metro && dr.decided.size === 0, 'el borrador del teatro');
        const L = dr.pieces.find(p => p.kind === 'line'), R = dr.pieces.find(p => p.kind === 'reserve'), Gp = dr.pieces.find(p => p.kind === 'group');
        T.ok(L && R && Gp, 'línea, reserva y agrupación: ' + JSON.stringify(dr.pieces.map(p => p.text)));
        const rows = s.card().querySelectorAll('[data-piece]');
        T.eq(rows.length, dr.pieces.length, 'una fila por pieza');
        T.ok(dr.pieces.every((p, i) => rows[i].textContent.includes(p.text)), 'con su frase');
        T.ok(s.card().textContent.includes('Caben') && s.card().querySelector('[data-action="th-accept-all"]') && s.card().querySelector('[data-action="th-close"]'), 'el pie: cuántas caben, Aceptar todo y Cerrar');
        T.ok(s.card().textContent.includes(g.nm(T.nation('fr'))), 'nombra a los vecinos tranquilos');
        const shapes = () => ui.view.draftShapes().map(x => x.piece.key);
        T.eq(shapes(), dr.pieces.map(p => p.key), 'el mapa dibuja las pendientes');
        ui.view.draw();
        rows[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        T.eq(ui.draftFocus, dr.pieces[1].key, 'al pasar el ratón, la pieza se resalta');
        T.ok(ui.view.draftShapes().find(x => x.piece.key === dr.pieces[1].key).focus, 'y se dibuja resaltada');
        const snap = () => JSON.stringify([...g.armies.values()].map(a => [a.id, a.cell, a.op, a.group, a.order?.kind ?? null]));
        const before = snap(), ops0 = g.opsOf(es).length;
        s.click('th-discard', R.key);
        T.eq(ui.draft.decided.get(R.key), 'descartada', 'descartada');
        T.eq([snap(), g.opsOf(es).length], [before, ops0], 'descartar no toca nada');
        T.ok(s.card().querySelector(`[data-piece="${R.key}"]`).textContent.includes('Descartada') && !s.card().querySelector(`[data-action="th-accept"][data-key="${R.key}"]`), 'la fila dice Descartada, sin botones');
        T.ok(!shapes().includes(R.key), 'y ya no se dibuja');
        s.click('th-accept', L.key);
        T.eq(ui.draft.decided.get(L.key), 'aceptada', 'la línea, aceptada');
        const op = g.opsOf(es).find(o => o.kind === 'defensa');
        T.ok(op && T.ids(g.opMembers(op)).join() === T.ids(L.armies).join(), 'la operación existe con sus ejércitos');
        T.ok(!ui.draft.decided.has(Gp.key) && !s.card().querySelector(`[data-action="th-accept"][data-key="${Gp.key}"]`).disabled, 'la agrupación sigue pendiente');
        T.ok(!s.card().textContent.includes('La propuesta ha cambiado'), 'sin el aviso de cambio');
        s.click('th-close');
        T.eq(ui.draft, null, 'Cerrar quita el borrador');
        T.eq(ui.view.draftShapes().length, 0, 'y su dibujo');
        return true;
    }],
    ['7 · Aceptar todo dos veces no duplica', () => {
        const s = T.uiScene(), g = s.g, es = s.es;
        s.click('th-propose');
        const ops0 = g.opsOf(es).length, groups0 = g.armyGroups(es).length;
        s.click('th-accept-all');
        s.click('th-accept-all');
        const dr = ui.draft, ok = p => dr.decided.get(p.key) === 'aceptada';
        const made = dr.pieces.filter(p => p.makesOp && ok(p)).length;
        T.ok(made >= 2, 'acepta la línea y la reserva');
        T.eq(g.opsOf(es).length - ops0, made, 'tantas operaciones nuevas como piezas que las crean');
        T.eq(g.armyGroups(es).length - groups0, dr.pieces.filter(p => p.kind === 'group' && ok(p)).length, 'y tantas agrupaciones');
        T.ok(dr.pieces.every(ok), 'todas aceptadas');
        T.ok(!s.card().textContent.includes('La propuesta ha cambiado'), 'sin el aviso de cambio');
        return true;
    }],
    ['7 · la propuesta se marca vieja tras un turno y no se guarda', () => {
        const s = T.uiScene(), g = s.g, es = s.es;
        s.click('th-propose');
        T.ok(!s.card().textContent.includes('La propuesta ha cambiado'), 'recién hecha, al día');
        T.turns(g, es, 1);
        ui.render();
        T.ok(s.card().textContent.includes('La propuesta ha cambiado'), 'tras un turno, ha cambiado');
        const json = JSON.stringify(g.serialize());
        T.ok(!json.includes('"draft"') && !json.includes('decided'), 'el borrador no se guarda');
        T.ok(GameEngine.load(JSON.parse(json)), 'y la partida se carga');
        s.click('th-refresh');
        T.ok(ui.draft && !s.card().textContent.includes('La propuesta ha cambiado'), 'Volver a proponer la pone al día');
        ui.setGame(T.game());
        T.eq(ui.draft, null, 'al cargar otra partida se borra');
        return true;
    }],
    ['7 · tope: Aceptar desactivado con el estado mayor lleno', () => {
        const s = T.uiScene(), g = s.g, es = s.es;
        const cities = PROVINCES.filter(q => g.owner[q.city] === es).map(q => q.city);
        for (let i = 0; g.opsOf(es).length < g.commandCap(es); i++) g.createOp(es, 'reserva', [cities[i % cities.length]]);
        ui.render();
        s.click('th-propose');
        const L = ui.draft.pieces.find(p => p.kind === 'line'), b = s.card().querySelector(`[data-action="th-accept"][data-key="${L.key}"]`);
        T.ok(b.disabled && b.title.includes('No caben más operaciones'), 'Aceptar de la línea, desactivado con el motivo: ' + b.title);
        T.ok(s.card().textContent.includes('No caben más operaciones'), 'el pie lo dice');
        const n0 = g.opsOf(es).length, gr0 = g.armyGroups(es).length;
        s.click('th-accept-all');
        T.eq(g.opsOf(es).length, n0, 'Aceptar todo no crea operaciones');
        T.ok(g.armyGroups(es).length > gr0, 'pero sí la agrupación');
        T.ok(!ui.draft.decided.has(L.key), 'la línea sigue pendiente');
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
