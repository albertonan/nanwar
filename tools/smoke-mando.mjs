// Pruebas del mando estratégico en el navegador: órdenes de varios turnos, operaciones, plantillas, directiva e IA.
// Sirve el juego por HTTP, crea partidas nuevas con GameEngine y comprueba las reglas una a una.
// Uso: node basicmilitary/tools/smoke-mando.mjs [filtro]   (CHROME=<ruta> para usar otro navegador)
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
    ['F1 · marchar a un destino lejano llega en varios turnos por el camino más rápido', () => {
        const g = T.game(), es = T.nation('es');
        g.start(es);
        const [, from] = T.plainPair(g, es);
        const a = T.army(g, es, from, 2);
        const dest = T.farCell(g, es, from, 14);
        T.ok(g.setOrder(a, { kind: 'march', dest }), 'orden aceptada');
        T.ok(a.order.path[0] === from && a.order.path.at(-1) === dest, 'camino de la casilla al destino');
        const eta = a.order.eta;
        T.ok(eta >= 3, `tarda varios turnos (${eta})`);
        let n = 0;
        while (a.order && n < eta + 3) { T.turns(g, es, 1); n++; }
        T.eq([g.armies.get(a.id)?.cell, a.order], [dest, null], 'llega y la orden termina');
        T.ok(n <= eta + 1, `llega a tiempo (${n} de ${eta})`);
        return true;
    }],
    ['F1 · la orden se cumple al terminar el turno y no hace falta mover a mano', () => {
        const g = T.game(), es = T.nation('es');
        g.start(es);
        const [, from] = T.plainPair(g, es);
        const a = T.army(g, es, from, 2), dest = T.farCell(g, es, from, 10);
        g.setOrder(a, { kind: 'march', dest });
        T.eq(g.pendingOrders(es), 1, 'una orden pendiente');
        g.endTurn();
        T.ok(g.armies.get(a.id).cell !== from, 'se ha movido al terminar el turno');
        return true;
    }],
    ['F1 · mover a mano manda ese turno; al siguiente vuelve a su orden', () => {
        const g = T.game(), es = T.nation('es');
        g.start(es);
        const [next, from] = T.plainPair(g, es);
        const a = T.army(g, es, from, 2), dest = T.farCell(g, es, from, 10);
        g.setOrder(a, { kind: 'march', dest });
        const moved = g.playerMove(a, { ...a.units }, next);
        T.eq([moved.id, moved.cell, moved.direct], [a.id, next, g.turn], 'movido a mano');
        const used = moved.used;
        g.executeOrders(es);
        T.eq([moved.cell, moved.used], [next, used], 'este turno no cumple la orden');
        g.turn++; moved.used = 0;
        g.executeOrders(es);
        T.ok(moved.cell !== next && moved.order, 'el turno siguiente sigue su orden');
        return true;
    }],
    ['F1 · atacar solo con la ventaja pedida, y tomar la casilla si gana', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es);
        g.declareWar(es, fr);
        const [fcell, mine] = T.plainPair(g, es);
        g.owner[fcell] = fr; g.legal[fcell] = fr; g.version++;
        const foe = T.army(g, fr, fcell, 10);
        const weak = T.army(g, es, mine, 1);
        g.setOrder(weak, { kind: 'attack', dest: fcell, ratio: 1.3 });
        T.eq(g.stepOrder(weak), 'waiting', 'sin ventaja espera');
        T.ok(g.armies.has(foe.id) && g.armies.has(weak.id), 'nadie combate');
        weak.units.tank = 12;
        T.eq(g.stepOrder(weak), 'arrived', 'con ventaja ataca y entra');
        T.eq([weak.cell, g.owner[fcell], weak.order], [fcell, es, null], 'casilla tomada y orden cumplida');
        return true;
    }],
    ['F1 · con niebla, la ventaja se calcula con lo peor del escalón', () => {
        const g = T.game(7, true), es = T.nation('es'), fr = T.nation('fr');
        g.start(es);
        g.declareWar(es, fr);
        const [fcell, mine] = T.plainPair(g, es);
        g.owner[fcell] = fr; g.legal[fcell] = fr; g.version++;
        const foe = T.army(g, fr, fcell, 10);   // brigada: se supone de 24
        const a = T.army(g, es, mine, 0, 8);
        const real = g.combatFactors(es, a.units, mine, foe, fcell), guess = g.expectedRatio(es, a.units, mine, foe, fcell);
        T.ok(real.atk / real.dfn > 1.3 && guess < 1.3, `estimación prudente (${guess} frente a ${real.atk / real.dfn})`);
        return true;
    }],
    ['F1 · mantener y fortificar: quietos, y fuera de «Siguiente ejército»', () => {
        const g = T.uiStart('es'), es = g.player;
        const [, from] = T.plainPair(g, es);
        const a = T.army(g, es, from, 3);
        const gold = g.nations[es].gold = 1000;
        g.playerOrder(a, { kind: 'fortify' });
        T.eq([g.fortWork.has(from), g.nations[es].gold, a.order.kind], [true, gold - g.rules(es).fortCost, 'hold'], 'paga la obra y se queda');
        T.eq(g.pendingOrders(es), 0, 'mantener no cuenta como pendiente');
        for (let i = 0; i < 40; i++) { ui.nextArmy(); T.ok(g.armyOn(ui.selected) !== a, '«Siguiente ejército» se lo salta'); }
        g.executeOrders(es);
        T.eq(a.cell, from, 'no se mueve');
        return true;
    }],
    ['F1 · seguir a otro ejército: va pegado detrás sin juntarse', () => {
        const g = T.game(), es = T.nation('es');
        g.start(es);
        const [, from] = T.plainPair(g, es);
        const lead = T.army(g, es, from, 0, 3);
        const back = T.army(g, es, T.farCell(g, es, from, 2, 3), 0, 0, 2);
        g.setOrder(lead, { kind: 'march', dest: T.farCell(g, es, from, 12) });
        T.ok(g.setOrder(back, { kind: 'follow', target: lead.id }), 'orden de seguir');
        for (let i = 0; i < 4; i++) T.turns(g, es, 1);
        T.ok(g.armies.has(back.id) && g.armies.has(lead.id), 'siguen separados');
        const gap = g.orderField(es, lead.cell).to(back.cell) / MOVE;
        T.ok(G.dirTo(back.cell, lead.cell) >= 0 || gap <= 4, `va cerca (${gap} puntos)`);
        return true;
    }],
    ['F1 · sin paso durante tres turnos la orden se cancela', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es);
        g.declareWar(es, fr);
        const [fcell, mine] = T.plainPair(g, es);
        g.owner[fcell] = fr; g.legal[fcell] = fr; g.version++;
        T.army(g, fr, fcell, 30);
        const a = T.army(g, es, mine, 1);
        g.setOrder(a, { kind: 'march', dest: fcell });   // marchar no ataca: el enemigo le cierra el paso
        T.turns(g, es, 2);
        T.eq(a.order?.stuck, 2, 'cuenta los turnos sin paso');
        T.turns(g, es, 1);
        T.eq(a.order, null, 'cancelada al tercero');
        return true;
    }],
    ['F1 · las órdenes se guardan y se cargan; las imposibles se descartan', () => {
        const g = T.game(), es = T.nation('es');
        g.start(es);
        const [, from] = T.plainPair(g, es);
        const a = T.army(g, es, from, 2), b = T.army(g, es, T.farCell(g, es, from, 2, 3), 1), dest = T.farCell(g, es, from, 9);
        g.setOrder(a, { kind: 'attack', dest, ratio: 1.8, flee: false });
        g.setOrder(b, { kind: 'follow', target: a.id });
        const data = JSON.parse(JSON.stringify(g.serialize()));
        data.orders.push([b.id, 'march', -5], [999999, 'hold'], [a.id, 'volar', 3]);
        const h = GameEngine.load(data);
        const ha = h.armies.get(a.id), hb = h.armies.get(b.id);
        T.eq([ha.order.kind, ha.order.dest, ha.order.ratio, ha.order.flee], ['attack', dest, 1.8, false], 'orden de atacar');
        T.eq([hb.order.kind, hb.order.target], ['follow', a.id], 'orden de seguir');
        T.ok(ha.order.path.length > 1, 'camino recalculado');
        return true;
    }],
    ['F1 · interfaz: botón de la ficha, clic en el destino, botón de la cabecera y tecla O', () => {
        const g = T.uiStart('es'), es = g.player;
        const [, from] = T.plainPair(g, es);
        const a = T.army(g, es, from, 2), dest = T.farCell(g, es, from, 12);
        ui.select(from);
        document.querySelector('[data-action="order"][data-kind="march"]').click();
        T.eq(ui.ordering?.kind, 'march', 'esperando el destino');
        ui.clickCell(dest);
        T.eq([a.order?.kind, a.order?.dest, ui.ordering], ['march', dest, null], 'orden dada');
        T.ok(a.cell !== from, 'empieza a cumplirla en el acto');
        T.ok(document.querySelector('#card').textContent.includes('Marcha hacia'), 'la ficha la explica');
        ui.view.draw();
        a.used = 0; ui.render();
        T.ok(!document.querySelector('#btn-orders').hidden, 'botón de la cabecera');
        const before = a.cell;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'o' }));
        T.ok(a.cell !== before, 'la tecla O la cumple');
        ui.select(a.cell);
        document.querySelector('[data-action="order-cancel"]').click();
        T.eq(a.order, null, 'cancelada desde la ficha');
        ui.select(a.cell);
        ui.clickCell(dest, true);
        T.eq(a.order?.kind, 'march', 'Mayúsculas + clic da la orden de marchar');
        return true;
    }],
    ['F2 · una ofensiva automática avanza, ataca y termina al tomar su objetivo', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es);
        g.declareWar(es, fr);
        const [start] = T.border(g, es, fr);
        const obj = T.nearestCity(g, es, fr, start);
        const op = g.createOp(es, 'ofensiva', [start, obj]);
        T.ok(op && op.name.startsWith('Ofensiva sobre'), 'creada con nombre del objetivo');
        let n = 0;
        for (const c of g.nearCells(start, 2).keys()) if (n < 3 && T.free(g, c) && g.owner[c] === es) { g.assignArmy(T.army(g, es, c, 4, 16, 2), op.id); n++; }
        T.eq(g.opMembers(op).length, 3, 'tres ejércitos asignados');
        const steps0 = Math.min(...g.opMembers(op).map(a => g.field(es, [obj])[a.cell]));
        T.turns(g, es, 1);
        const steps1 = Math.min(...g.opMembers(op).map(a => g.field(es, [obj])[a.cell]));
        T.ok(steps1 < steps0, `se acercan al objetivo (${steps0} → ${steps1})`);
        for (let i = 0; i < 25 && g.ops.has(op.id); i++) T.turns(g, es, 1);
        T.eq([g.owner[obj], g.ops.has(op.id)], [es, false], 'objetivo tomado y operación terminada');
        return true;
    }],
    ['F2 · una ofensiva nueva reúne los ejércitos libres de toda la zona, no solo los de la ciudad de salida', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr'), pt = T.nation('pt');
        g.start(es);
        g.declareWar(es, fr); g.declareWar(es, pt);
        const [start] = T.border(g, es, fr);
        const near = T.army(g, es, T.farCell(g, es, start, 1, 3), 3);
        const mid = T.army(g, es, T.farCell(g, es, start, 6, 9), 3);
        const far = T.army(g, es, T.farCell(g, es, start, 16, 40), 3);
        const f = g.orderField(es, start), apart = c => [near, mid].every(a => !g.nearCells(a.cell, 4).has(c));
        const gc = G.land.find(c => g.owner[c] === es && T.free(g, c) && f.to(c) >= 4 * MOVE && f.dist[c] <= 10 * MOVE && apart(c)
            && G.nb.slice(c * 6, c * 6 + 6).some(j => j >= 0 && T.free(g, j)));
        const guard = T.army(g, es, gc, 3);
        const foe = G.nb.slice(gc * 6, gc * 6 + 6).find(c => c >= 0 && T.free(g, c));
        T.army(g, pt, foe, 2);   // un portugués junto a él: guarda otro frente
        const op = g.playerCreateOp('ofensiva', [start, T.nearestCity(g, es, fr, start)]);
        T.eq([near.op, mid.op, far.op, guard.op].map(x => x === op.id), [true, true, false, false], 'cerca y a dos turnos sí; lejos y en otro frente, no');
        T.ok(g.opMembers(op).every(a => !(CITY_OF[a.cell] >= 0 && countUnits(a.units) <= 1)), 'no se lleva guarniciones de una unidad');
        return true;
    }],
    ['F2 · sin ventaja espera, pide ayuda y la reserva le manda un ejército', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es);
        g.declareWar(es, fr);
        const [fcell, mine] = T.plainPair(g, es);
        g.owner[fcell] = fr; g.legal[fcell] = fr; g.version++;
        T.army(g, fr, fcell, 20);
        const op = g.createOp(es, 'ofensiva', [mine, fcell], { ratio: 1.3 });
        const weak = T.army(g, es, mine, 1);
        g.assignArmy(weak, op.id);
        g.executeOp(op);
        T.eq([weak.cell, op.waiting, g.opNeed(op)], [mine, 1, 1], 'espera y pide ayuda');
        const zone = T.farCell(g, es, mine, 4, 8);
        const res = g.createOp(es, 'reserva', [zone]);
        const big = T.army(g, es, zone, 0, 20);
        g.assignArmy(big, res.id);
        g.executeOp(res);
        T.eq(big.op, op.id, 'la reserva lo pasa a la ofensiva');
        return true;
    }],
    ['F2 · una línea de defensa se cubre empezando por lo más amenazado, y fortifica', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es);
        g.declareWar(es, fr);
        const [a0] = T.border(g, es, fr), [a1] = T.border(g, es, fr, 6);
        const plan = g.planFort(es, a0, a1);
        T.ok(plan && plan.path.length >= 2, 'línea por tu territorio');
        const op = g.createOp(es, 'defensa', plan.path, { fortify: true });
        g.nations[es].gold = 5000;
        const spots = [...g.nearCells(plan.path[0], 4).keys()].filter(c => T.free(g, c) && g.owner[c] === es && !plan.path.includes(c));
        for (const c of spots.slice(0, plan.path.length)) g.assignArmy(T.army(g, es, c, 6), op.id);
        for (let i = 0; i < 8; i++) T.turns(g, es, 1);
        T.eq(g.opNeed(op), 0, `línea cubierta (${plan.path.length} casillas)`);
        T.ok(plan.path.some(c => g.fortWork.has(c) || g.fort[c]), 'fortifica la línea');
        return true;
    }],
    ['F2 · capacidad de mando: 3 operaciones, 4 con Doctrina 1', () => {
        const g = T.game(), es = T.nation('es');
        g.start(es);
        const [, from] = T.plainPair(g, es);
        T.eq(g.commandCap(es), 3 + Math.floor(g.citiesOf(es).length / 20), 'base');
        for (let i = 0, n = g.commandCap(es); i < n; i++) T.ok(g.createOp(es, 'reserva', [from]), `operación ${i + 1}`);
        T.eq(g.createOp(es, 'reserva', [from]), null, 'no cabe una más');
        T.learn(g, es, 'doctrina1');
        T.ok(g.createOp(es, 'reserva', [from]), 'con Doctrina 1 cabe otra');
        return true;
    }],
    ['F2 · manual no mueve; asistida solo al pedirla, y la vista previa no cambia la partida', () => {
        const g = T.game(), es = T.nation('es');
        g.start(es);
        const [, from] = T.plainPair(g, es);
        const dest = T.farCell(g, es, from, 10);
        const zone = g.createOp(es, 'reserva', [dest], { auto: 'manual' });
        const a = T.army(g, es, from, 3);
        g.assignArmy(a, zone.id);
        g.executeOrders(es);
        T.eq(a.cell, from, 'manual: quieto');
        zone.auto = 'asistida';
        g.executeOrders(es);
        T.eq(a.cell, from, 'asistida: quieta al terminar el turno sin confirmar');
        const v = g.armyVersion, ghost = g.previewOps(es, [zone.id]);
        T.ok(ghost.length === 1 && ghost[0].kind === 'move' && ghost[0].id === a.id, 'propone un movimiento');
        T.eq([a.cell, g.armyVersion], [from, v], 'la vista previa no toca la partida');
        g.executeOps(es, [zone.id]);
        T.eq(a.cell, ghost[0].cells.at(-1), 'al confirmar hace lo propuesto');
        return true;
    }],
    ['F2 · un ejército con orden propia o movido a mano no lo mueve su operación', () => {
        const g = T.game(), es = T.nation('es');
        g.start(es);
        const [next, from] = T.plainPair(g, es), [, from2] = T.plainPair(g, es, 3);
        const zone = g.createOp(es, 'reserva', [T.farCell(g, es, from, 10)]);
        const a = T.army(g, es, from, 3), b = T.army(g, es, from2, 3);
        g.assignArmy(a, zone.id); g.assignArmy(b, zone.id);
        g.setOrder(b, { kind: 'hold' });
        const moved = g.playerMove(a, { ...a.units }, next);
        g.executeOps(es, [zone.id]);
        T.eq([moved.cell, b.cell], [next, from2], 'los dos se quedan');
        return true;
    }],
    ['F2 · las operaciones y sus ejércitos se guardan y se cargan', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es);
        const [start, out] = T.border(g, es, fr);
        const op = g.createOp(es, 'ofensiva', [start, out], { ratio: 1.8, auto: 'asistida' });
        const a = T.army(g, es, T.farCell(g, es, start, 1, 3), 2);
        g.assignArmy(a, op.id);
        const data = JSON.parse(JSON.stringify(g.serialize()));
        data.ops.push({ id: 77, owner: es, kind: 'invasión', cells: [start, out] }, { id: 78, owner: es, kind: 'reserva', cells: [start, out] });
        data.armyOps.push([a.id, 77]);
        const h = GameEngine.load(data);
        const ho = h.ops.get(op.id);
        T.eq([ho.kind, ho.cells, ho.ratio, ho.auto, ho.name], ['ofensiva', [start, out], 1.8, 'asistida', op.name], 'operación');
        T.eq([h.ops.size, h.armies.get(a.id).op], [1, op.id], 'las inválidas se descartan y el ejército sigue en la suya');
        return true;
    }],
    ['F2 · interfaz: herramienta Operación, pestaña Mando y propuesta de la asistida al terminar el turno', async () => {
        const g = T.uiStart('es'), es = g.player;
        ui.prefs.watch = 'directo';
        const [, from] = T.plainPair(g, es);
        const zone = T.farCell(g, es, from, 6);
        T.army(g, es, from, 3);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '5' }));
        T.eq(ui.tool, 'op', 'tecla 5');
        document.querySelector('[data-action="op-kind"][data-kind="reserva"]').click();
        ui.clickCell(zone);
        document.querySelector('[data-action="op-create"]').click();
        const op = g.opsOf(es)[0];
        T.ok(op && op.kind === 'reserva', 'operación creada');
        T.eq([ui.tool, ui.tab, ui.focusOp], ['command', 'mando', op.id], 'abierta en la pestaña Mando');
        T.ok(document.querySelector('#drawer-body').textContent.includes(op.name), 'aparece en la pestaña');
        const a = g.armyOn(from);
        if (a.op !== op.id) g.assignArmy(a, op.id);
        document.querySelector('[data-action="op-set"][data-key="auto"][data-value="asistida"]').click();
        T.eq(op.auto, 'asistida', 'automatización desde la pestaña');
        ui.view.draw();
        const turn = g.turn;
        await ui.endTurnFlow();
        T.ok(ui.proposal && !document.querySelector('#confirm').hidden, 'propuesta a la vista');
        T.eq([g.turn, a.cell], [turn, from], 'aún no ha terminado el turno');
        ui.view.draw();
        document.querySelector('[data-action="assist-yes"]').click();
        for (let i = 0; i < 100 && g.turn === turn; i++) await new Promise(r => setTimeout(r, 50));
        T.ok(g.turn === turn + 1 && g.armies.get(a.id).cell !== from, 'confirmada: se mueve y pasa el turno');
        return true;
    }],
    ['F2 · al salir de una ciudad para su operación deja una infantería de guarnición', () => {
        const g = T.game(), es = T.nation('es');
        g.start(es);
        const city = PROVINCES.find(p => g.owner[p.city] === es && CAPITAL_OF[p.city] < 0).city;
        const a = g.armyOn(city);
        a.units = { infantry: 5, tank: 2, artillery: 0 };
        const zone = g.createOp(es, 'reserva', [T.farCell(g, es, city, 6)]);
        g.assignArmy(a, zone.id);
        g.executeOp(zone);
        const stay = g.armyOn(city), gone = [...g.armies.values()].find(x => x.op === zone.id);
        T.eq([stay.units, stay.op], [{ infantry: 1, tank: 0, artillery: 0 }, 0], 'guarnición sin operación');
        T.ok(gone && gone.cell !== city && countUnits(gone.units) === 6, 'el resto sale con la operación');
        return true;
    }],
    ['F3 · los refuerzos se reclutan, marchan a la zona y entran formados en la operación', () => {
        const g = T.game(), es = T.nation('es');
        g.start(es);
        g.nations[es].gold = 20000;
        const [, from] = T.plainPair(g, es);
        const op = g.createOp(es, 'reserva', [from], { gold: 400, template: 'acorazada' });
        T.turns(g, es, 1);
        T.ok(op.form && countUnits(op.form.recruited) > 0, 'empieza a reclutar');
        T.eq(op.form.units, TEMPLATES.acorazada.units, 'con la receta de la plantilla');
        const spent = 20000 - g.nations[es].gold;
        T.ok(spent > 0 && spent <= 400, `no gasta más que su oro por turno (${spent})`);
        let n = 0;
        while (!op.formed && n < 30) { T.turns(g, es, 1); n++; }
        T.ok(op.formed === 1, `formada en ${n + 1} turnos`);
        const army = g.opMembers(op).find(a => a.units.tank >= 8);
        T.ok(army && army.units.infantry >= 4 && !army.form && !army.order, 'el ejército entra en la operación');
        T.ok(op.form === null || countUnits(op.form.recruited) <= countUnits(op.form.units), 'y empieza otra');
        return true;
    }],
    ['F3 · composición sugerida según el tipo, el objetivo y el terreno', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es);
        const [start] = T.border(g, es, fr), [, from] = T.plainPair(g, es);
        T.eq(g.suggestTemplate(g.createOp(es, 'defensa', [from])).key, 'infanteria', 'defensa');
        T.eq(g.suggestTemplate(g.createOp(es, 'ofensiva', [start, g.nations[fr].capitalCell])).key, 'artilleria', 'contra una capital');
        const op = g.createOp(es, 'reserva', [from]);
        op.template = 'punta';
        T.eq(g.opTemplate(op).name, 'Punta de lanza', 'la elegida manda sobre la sugerida');
        return true;
    }],
    ['F3 · plantillas propias: se guardan, se usan y al borrarlas las operaciones vuelven a la sugerida', () => {
        const g = T.game(), es = T.nation('es');
        g.start(es);
        const [, from] = T.plainPair(g, es);
        T.ok(g.playerSaveTemplate('Montaña', { infantry: 12, tank: 0, artillery: 1 }), 'guardada');
        T.ok(g.playerSaveTemplate('Choque', { infantry: 0, tank: 6, artillery: 3 }), 'otra');
        const a = g.createOp(es, 'reserva', [from]), b = g.createOp(es, 'reserva', [from]);
        g.playerOpSet(a, 'template', 'c0'); g.playerOpSet(b, 'template', 'c1');
        T.eq(g.opTemplate(b).units, { infantry: 0, tank: 6, artillery: 3 }, 'usa la propia');
        const data = JSON.parse(JSON.stringify(g.serialize()));
        T.eq(GameEngine.load(data).nations[es].templates.map(t => t.name), ['Montaña', 'Choque'], 'se guardan con la partida');
        g.playerDeleteTemplate(0);
        T.eq([a.template, b.template, g.opTemplate(b).name], ['auto', 'c0', 'Choque'], 'las demás se corren un puesto');
        return true;
    }],
    ['F3 · la formación en curso se guarda y se carga', () => {
        const g = T.game(), es = T.nation('es');
        g.start(es);
        g.nations[es].gold = 20000;
        const [, from] = T.plainPair(g, es);
        const op = g.createOp(es, 'reserva', [from], { gold: 200, template: 'division' });
        T.turns(g, es, 3);
        const marching = [...g.armies.values()].filter(a => a.form === op.id).map(a => a.id).sort();
        const h = GameEngine.load(JSON.parse(JSON.stringify(g.serialize())));
        const ho = h.ops.get(op.id);
        T.eq([ho.gold, ho.template, ho.pool, ho.form.units, ho.form.recruited, ho.form.zone], [200, 'division', op.pool, op.form.units, op.form.recruited, op.form.zone], 'formación');
        T.eq([...h.armies.values()].filter(a => a.form === op.id).map(a => a.id).sort(), marching, 'ejércitos en camino');
        return true;
    }],
    ['F3 · interfaz: oro, plantilla y editor de plantillas en la pestaña Mando', () => {
        const g = T.uiStart('es'), es = g.player;
        const [, from] = T.plainPair(g, es);
        const op = g.playerCreateOp('reserva', [from]);
        ui.focusOp = op.id; ui.tab = 'mando'; ui.drawerOpen = true; ui.render();
        document.querySelector(`[data-action="op-set"][data-key="gold"][data-value="200"]`).click();
        T.eq(op.gold, 200, 'oro por turno');
        const sel = document.querySelector(`[data-op-template="${op.id}"]`);
        sel.value = 'artilleria'; sel.dispatchEvent(new Event('change', { bubbles: true }));
        T.eq(op.template, 'artilleria', 'plantilla');
        T.ok(document.querySelector('#drawer-body').textContent.includes('Grupo de artillería'), 'se ve en la pestaña');
        const name = document.querySelector('#tpl-name');
        name.value = 'Paracaidistas'; name.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('[data-action="tpl-step"][data-unit="tank"][data-delta="1"]').click();
        document.querySelector('[data-action="tpl-save"]').click();
        T.eq(g.nations[es].templates.at(-1), { name: 'Paracaidistas', units: { infantry: 6, tank: 3, artillery: 1 } }, 'plantilla propia guardada');
        T.ok([...document.querySelectorAll(`[data-op-template="${op.id}"] option`)].some(o => o.value === 'c0'), 'y elegible en la operación');
        return true;
    }],
    ['F4 · la postura fija la ventaja de las ofensivas nuevas y el reparto del presupuesto', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es);
        const [start, out] = T.border(g, es, fr);
        T.eq(g.createOp(es, 'ofensiva', [start, out]).ratio, 1.3, 'desgaste: 1,3');
        g.setPosture(es, 'total');
        T.eq([g.createOp(es, 'ofensiva', [start, out]).ratio, g.nations[es].command.budget], [1, POSTURES.total.budget], 'guerra total: 1 y su reparto');
        g.setPosture(es, 'defensa');
        T.eq(g.createOp(es, 'ofensiva', [start, out]).ratio, 1.8, 'defensa total: 1,8');
        return true;
    }],
    ['F4 · la directiva gasta por ti: fortifica lo amenazado, investiga y da oro a los refuerzos', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es);
        g.declareWar(es, fr);
        const c = g.nations[es].command;
        g.nations[es].gold = 100000;
        g.directive(es);
        T.eq([c.pools.forts, c.pools.research], [0, 0], 'apagada no hace nada');
        Object.assign(c, { spend: true, share: 100, budget: { recruit: 0, research: 0, forts: 100, roads: 0 } });
        const before = g.fortWork.size;
        for (let i = 0; i < 4; i++) { g.turn++; g.directive(es); }
        T.ok(g.fortWork.size > before, 'fortifica una ciudad amenazada');
        c.budget = { recruit: 0, research: 100, forts: 0, roads: 0 };
        for (let i = 0; i < 12 && !g.nations[es].tech.current.length; i++) { g.turn++; g.directive(es); }
        T.ok(g.nations[es].tech.current.length === 1, 'empieza a investigar');
        c.budget = { recruit: 100, research: 0, forts: 0, roads: 0 };
        const [, from] = T.plainPair(g, es);
        const op = g.createOp(es, 'reserva', [from]);
        g.turn++; g.directive(es);
        T.ok(op.extra > 0, `da oro a los refuerzos (${op.extra})`);
        T.turns(g, es, 3);   // la renta de un turno no basta para empezar una brigada: se va guardando
        T.ok(op.form && countUnits(op.form.recruited) > 0, 'y la operación recluta con él');
        return true;
    }],
    ['F4 · objetivos estratégicos: progreso y aviso al cumplirlos', () => {
        const g = T.game(), es = T.nation('es'), pt = T.nation('pt');
        g.start(es);
        g.declareWar(es, pt);
        const targets = PROVINCES.filter(p => p.country === pt).slice(0, 2);
        for (const p of targets) g.toggleGoal(es, p.id);
        T.eq(g.goalProgress(es), [{ nation: pt, total: 2, held: 0 }], 'dos provincias de Portugal');
        g.capture(targets[0].city, es, true);
        g.directive(es);
        T.eq(g.goalProgress(es)[0].held, 1, 'una tomada');
        g.capture(targets[1].city, es, true);
        g.directive(es);
        T.ok(g.nations[es].command.goalsMet.includes(pt) && g.logs.some(l => l.msg.includes('Objetivos estratégicos cumplidos')), 'aviso de que es momento de la paz');
        return true;
    }],
    ['F4 · teatros: el frente de cada operación, y la reserva atiende antes a la prioridad alta', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr'), pt = T.nation('pt');
        g.start(es);
        g.declareWar(es, fr); g.declareWar(es, pt);
        const [sf, ff] = T.border(g, es, fr), [sp, pp] = T.border(g, es, pt);
        const a = g.createOp(es, 'ofensiva', [sf, ff]), b = g.createOp(es, 'ofensiva', [sp, pp]);
        T.eq([g.opFront(a), g.opFront(b)], [fr, pt], 'frentes');
        const [, from] = T.plainPair(g, es);
        T.eq(g.opFront(g.createOp(es, 'defensa', [from])) >= 0, true, 'la defensa toma el enemigo más cercano');
        g.nations[es].command.priority[pt] = 'alta';
        T.learn(g, es, 'doctrina1');   // cabe una cuarta operación
        const res = g.createOp(es, 'reserva', [from]);
        const r1 = T.army(g, es, from, 5);
        g.assignArmy(r1, res.id);
        g.executeOp(res);
        T.eq(r1.op, b.id, 'el ejército va al frente de prioridad alta');
        return true;
    }],
    ['F4 · retaguardia: lo que sobra en las ciudades sin peligro va a la reserva', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es);
        g.declareWar(es, fr);
        const city = PROVINCES.filter(p => g.owner[p.city] === es && g.threat(es, p.city) === 0)[0].city;
        g.armyOn(city).units = { infantry: 4, tank: 1, artillery: 0 };
        const [, from] = T.plainPair(g, es);
        const res = g.createOp(es, 'reserva', [from]);
        g.directive(es);
        T.eq(!!g.armyOn(city).op, false, 'apagada no toca nada');
        g.nations[es].command.rear = true;
        g.directive(es);
        T.eq(g.armyOn(city).op, res.id, 'encendida, pasa a la reserva');
        g.executeOp(res);
        T.eq([g.armyOn(city).units, g.armyOn(city).op], [{ infantry: 1, tank: 0, artillery: 0 }, 0], 'y sale dejando una infantería');
        return true;
    }],
    ['F4 · propuestas para un frente nuevo: línea propuesta y ofensiva sobre la ciudad más cercana', () => {
        const g = T.uiStart('es'), es = g.player, pt = T.nation('pt');
        g.declareWar(es, pt);
        const sg = g.frontSuggestions(es).find(x => x.enemy === pt);
        T.ok(sg && sg.line.length > 3 && sg.line.every(c => g.owner[c] === es) && g.owner[sg.attack[1]] === pt, 'propuesta con línea y objetivo');
        ui.tab = 'mando'; ui.drawerOpen = true; ui.render();
        document.querySelector(`[data-action="op-suggest"][data-enemy="${pt}"][data-kind="defensa"]`).click();
        const op = g.opsOf(es).find(o => o.kind === 'defensa');
        T.ok(op && g.opFront(op) === pt, 'línea creada en ese frente');
        T.ok(!g.frontSuggestions(es).some(x => x.enemy === pt), 'el frente ya no pide propuesta');
        ui.view.draw();
        return true;
    }],
    ['F4 · la directiva se guarda y se carga', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es);
        g.setPosture(es, 'limitada');
        Object.assign(g.nations[es].command, { spend: true, share: 35, rear: true, priority: { [fr]: 'baja' } });
        g.toggleGoal(es, PROVINCES.find(p => p.country === fr).id);
        const data = JSON.parse(JSON.stringify(g.serialize()));
        data.nations[es].command.priority['999'] = 'alta';
        data.nations[es].command.posture = 'rendición';
        const c = GameEngine.load(data).nations[es].command, o = g.nations[es].command;
        T.eq([c.posture, c.spend, c.share, c.rear, c.budget, c.goals, c.priority], ['desgaste', true, 35, true, o.budget, o.goals, { [fr]: 'baja' }], 'directiva (lo inválido, descartado)');
        return true;
    }],
    ['F4 · interfaz: directiva, objetivo desde la ficha y vista de mando de lejos', () => {
        const g = T.uiStart('es'), es = g.player, fr = T.nation('fr');
        g.declareWar(es, fr);
        ui.tab = 'mando'; ui.drawerOpen = true; ui.render();
        document.querySelector('[data-action="cmd"][data-key="posture"][data-value="total"]').click();
        T.eq(g.nations[es].command.posture, 'total', 'postura desde la pestaña');
        document.querySelector('[data-action="cmd"][data-key="spend"]').click();
        T.ok(g.nations[es].command.spend && document.querySelector('#cmd-forts'), 'presupuesto encendido con sus deslizadores');
        const range = document.querySelector('#cmd-forts');
        range.value = '40'; range.dispatchEvent(new Event('input', { bubbles: true }));
        T.eq(g.nations[es].command.budget.forts, 40, 'deslizador');
        const city = PROVINCES.find(p => g.owner[p.city] === fr).city;
        ui.select(city);
        document.querySelector('[data-action="goal"]').click();
        T.eq(g.nations[es].command.goals.length, 1, 'objetivo marcado desde la ficha');
        const [start] = T.border(g, es, fr);
        const op = g.playerCreateOp('ofensiva', [start, city]);
        if (!g.opMembers(op).length) g.assignArmy(T.army(g, es, T.farCell(g, es, start, 1, 3), 3), op.id);
        ui.view.scale = 0.2; ui.view.draw();
        ui.view.scale = 3; ui.view.draw();
        return true;
    }],
    ['F5 · la IA en guerra crea una ofensiva si es más fuerte y una línea si es más débil, con sus ejércitos', () => {
        const g = T.game(), is = T.nation('is'), es = T.nation('es'), pt = T.nation('pt');
        g.start(is);
        g.declareWar(es, pt);
        g.aiCommand(es);
        g.aiCommand(pt);
        const off = g.opsOf(es).find(o => o.kind === 'ofensiva'), line = g.opsOf(pt).find(o => o.kind === 'defensa');
        T.ok(off && g.opFront(off) === pt && g.owner[off.cells[1]] === pt, 'España ataca Portugal');
        T.ok(line && line.cells.every(c => g.owner[c] === pt), 'Portugal traza su línea');
        T.ok(g.opMembers(off).length > 0 || [...g.armies.values()].some(a => a.form === off.id), 'la ofensiva tiene ejércitos');
        const members = g.opMembers(off).map(a => [a.id, a.cell]);
        const used = new Map(members.map(([id]) => [id, g.armies.get(id).used]));
        g.aiArmies(es);
        T.ok(members.every(([id]) => !g.armies.has(id) || g.armies.get(id).used === used.get(id)), 'aiArmies no mueve a los de la operación');
        return true;
    }],
    ['F5 · al firmar la paz, la IA termina las operaciones de ese frente', () => {
        const g = T.game(), is = T.nation('is'), es = T.nation('es'), pt = T.nation('pt');
        g.start(is);
        g.declareWar(es, pt);
        g.aiCommand(es);
        T.ok(g.opsOf(es).length > 0, 'con operaciones en guerra');
        g.makePeace(es, pt, true);
        g.aiCommand(es);
        T.eq(g.opsOf(es).length, 0, 'sin operaciones en paz');
        T.ok(![...g.armies.values()].some(a => a.owner === es && (a.op || a.form)), 'sus ejércitos quedan libres');
        return true;
    }],
    ['F5 · las ofensivas enemigas se ven con un espía en su salida o con Reconocimiento aéreo', () => {
        const g = T.game(7, true), fr = T.nation('pt'), es = T.nation('es');
        g.start(fr);
        g.declareWar(es, fr);
        g.aiCommand(es);
        const off = g.opsOf(es).find(o => o.kind === 'ofensiva' && g.opFront(o) === fr);
        T.ok(off, 'España prepara una ofensiva contra Portugal');
        T.eq(g.knownEnemyOps(fr).length, 0, 'sin información no se ve');
        g.spies.set(G.prov[off.cells[0]], { since: g.turn, revealedTurn: g.turn }); g.spyVersion++;
        T.eq(g.knownEnemyOps(fr).map(o => o.id), [off.id], 'con un espía en su salida, sí');
        return true;
    }],
    ['F5 · una partida con la IA mandando operaciones se juega y se guarda sin errores', () => {
        const g = T.game(3), is = T.nation('is');
        g.configure({ aggression: 'caos', alliances: 'reales', victory: 1, fog: true });
        g.start(is);
        for (let i = 0; i < 12 && !g.over; i++) g.endTurn();
        T.ok(g.ops.size > 0, `la IA tiene operaciones (${g.ops.size})`);
        const h = GameEngine.load(JSON.parse(JSON.stringify(g.serialize())));
        T.eq([h.ops.size, [...h.armies.values()].filter(a => a.op).length], [g.ops.size, [...g.armies.values()].filter(a => a.op && g.ops.has(a.op)).length], 'se cargan igual');
        h.endTurn();
        return true;
    }],
    ['Revisión · el presupuesto de la directiva se reparte una sola vez por turno', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es);
        g.declareWar(es, fr);
        const c = g.nations[es].command;
        Object.assign(c, { spend: true, share: 100, budget: { recruit: 0, research: 100, forts: 0, roads: 0 } });
        g.nations[es].tech.current = ['infanteria1'];   // laboratorio ocupado: lo guardado no se gasta
        g.nations[es].tech.progress.set('infanteria1', 0);
        g.directive(es);
        const once = c.pools.research;
        g.directive(es); g.executeOrders(es);
        T.ok(once > 0 && c.pools.research === once, `una vez (${once} → ${c.pools.research})`);
        g.turn++;
        g.directive(es);
        T.ok(c.pools.research > once, 'y otra al turno siguiente');
        return true;
    }],
    ['Revisión · se puede redibujar una operación con el estado mayor lleno', () => {
        const g = T.uiStart('es'), es = g.player;
        const [, from] = T.plainPair(g, es);
        const ops = [];
        for (let i = 0; i < g.commandCap(es); i++) ops.push(g.createOp(es, 'reserva', [from]));
        const other = T.farCell(g, es, from, 4);
        T.ok(g.playerRedrawOp(ops[0], [other]) === ops[0] && ops[0].cells[0] === other, 'redibujada');
        T.eq(g.opsOf(es).length, g.commandCap(es), 'sin operaciones de más');
        return true;
    }],
    ['Revisión · claves raras en una partida guardada no rompen nada', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es);
        g.nations[es].gold = 5000;
        const [, from] = T.plainPair(g, es);
        g.createOp(es, 'reserva', [from], { gold: 100 });
        const data = JSON.parse(JSON.stringify(g.serialize()));
        data.ops[0].template = 'constructor';
        data.nations[es].command.priority = { [fr]: 'toString' };
        data.nations[es].command.posture = '__proto__';
        const h = GameEngine.load(data), op = [...h.ops.values()][0];
        T.eq([h.opTemplate(op).auto, h.nations[es].command.priority, h.nations[es].command.posture, h.priorityOf(op)], [true, {}, 'desgaste', 2], 'saneado');
        h.reinforce(op);
        return true;
    }],
    ['Revisión · al anexionar un satélite o eliminar un país, sus operaciones terminan', () => {
        const g = T.game(), es = T.nation('es'), pt = T.nation('pt'), fr = T.nation('fr');
        g.start(es);
        g.makeSatellite(pt, es);
        const [start, out] = T.border(g, pt, es);
        const op = g.createOp(pt, 'ofensiva', [start, out]);
        const a = T.army(g, pt, start, 3);
        g.assignArmy(a, op.id);
        const b = g.armyOn(g.nations[pt].capitalCell);
        g.setOrder(b, { kind: 'march', dest: start });
        g.playerAnnexSatellite(pt);
        T.eq([g.ops.has(op.id), a.owner, a.op, b.owner, b.order], [false, es, 0, es, null], 'anexión');
        g.declareWar(es, fr);
        const fop = g.createOp(fr, 'reserva', [PROVINCES.find(p => g.owner[p.city] === fr).city]);
        for (const c of G.land) if (g.owner[c] === fr) g.owner[c] = es;
        g.checkElimination(fr, es);
        T.eq([g.nations[fr].alive, g.ops.has(fop.id)], [false, false], 'eliminación');
        return true;
    }],
    ['Revisión · una formación cuya zona es una ciudad se completa', () => {
        const g = T.game(), es = T.nation('es');
        g.start(es);
        g.nations[es].gold = 20000;
        const city = PROVINCES.find(p => g.owner[p.city] === es && CAPITAL_OF[p.city] < 0).city;
        const op = g.createOp(es, 'reserva', [city], { gold: 400, template: 'guarnicion' });
        op.form = { name: 'Guarnición', units: { infantry: 3, tank: 0, artillery: 0 }, zone: city, recruited: { infantry: 0, tank: 0, artillery: 0 }, pending: [] };
        for (let i = 0; i < 15 && !op.formed; i++) T.turns(g, es, 1);
        T.eq(op.formed, 1, 'completada');
        return true;
    }],
    ['Revisión · la tecla O no hace nada mientras se confirma la propuesta', async () => {
        const g = T.uiStart('es'), es = g.player;
        ui.prefs.watch = 'directo';
        const [, from] = T.plainPair(g, es);
        const op = g.createOp(es, 'reserva', [T.farCell(g, es, from, 8)], { auto: 'asistida' });
        const a = T.army(g, es, from, 3);
        g.assignArmy(a, op.id);
        await ui.endTurnFlow();
        T.ok(ui.proposal, 'propuesta');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'o' }));
        T.eq(a.cell, from, 'O no la cumple a escondidas');
        document.querySelector('[data-action="assist-back"]').click();
        return true;
    }],
    ['Revisión · el parte de operaciones dice qué pide cada una y no se apila turno tras turno', async () => {
        const g = T.uiStart('es'), es = g.player, fr = T.nation('fr');
        ui.prefs.watch = 'directo';
        g.declareWar(es, fr);
        const [a0] = T.border(g, es, fr), [a1] = T.border(g, es, fr, 6);
        const op = g.createOp(es, 'defensa', g.planFort(es, a0, a1).path, { name: 'Línea de prueba' });
        g.assignArmy(T.army(g, es, op.cells[0], 2), op.id);
        for (let i = 0; i < 2; i++) await ui.endTurnFlow();
        const partes = ui.flashes.filter(f => f.key === 'parte');
        T.eq(partes.length, 1, 'un solo parte');
        T.ok(/Línea de prueba<\/b>: \d+ de sus \d+ casillas de línea est(á|án) sin tropas/.test(partes[0].html), `dice qué le falta: ${partes[0].html}`);
        T.eq([partes[0].label, partes[0].data], ['Ver la operación', op.id], 'el botón abre esa operación');
        return true;
    }],
    ['Revisión · sin infantería, deja de guarnición la primera unidad que tenga', () => {
        const g = T.game(), es = T.nation('es');
        g.start(es);
        const city = PROVINCES.find(p => g.owner[p.city] === es && CAPITAL_OF[p.city] < 0).city;
        g.armyOn(city).units = { infantry: 0, tank: 3, artillery: 0 };
        const zone = g.createOp(es, 'reserva', [T.farCell(g, es, city, 6)]);
        g.assignArmy(g.armyOn(city), zone.id);
        g.executeOp(zone);
        T.eq(g.armyOn(city)?.units, { infantry: 0, tank: 1, artillery: 0 }, 'un tanque se queda');
        return true;
    }],
    ['L1 · la franja y la relación de una línea', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es);
        g.declareWar(es, fr);
        const s = T.sector(g, es, fr);
        const op = g.createOp(es, 'defensa', s.line);
        T.eq([op.drawn, op.state], [s.line, 'aguanta'], 'línea dibujada y estado inicial');
        for (const c of s.line.slice(0, 2)) g.assignArmy(T.army(g, es, c, 2), op.id);
        let ev = g.lineEval(op);
        T.eq([ev.rel, ev.breach], [null, false], 'sin enemigos a la vista no hay relación ni brecha');
        for (let k = 0; k < 3; k++) T.army(g, fr, s.front(k), 0, 3);
        ev = g.lineEval(op);
        T.ok(ev.rel !== null && ev.rel < 1 && ev.enemy > 0 && ev.own > 0, `inferioridad ante 3 tanques (${ev.rel})`);
        const far = G.land.find(c => g.owner[c] === es && T.free(g, c) && !g.nearCells(s.center, 12).has(c));
        T.army(g, fr, far, 5);
        T.eq(g.lineEval(op).breach, false, 'un enemigo en otra parte del país no es una brecha de esta línea');
        const behind = s.back.find(c => !g.armyAt[c]);
        T.army(g, fr, behind, 1);
        T.eq(g.lineEval(op).breach, true, 'un enemigo detrás de la línea, en su franja, es una brecha');
        g.removeArmy(g.armyOn(behind));
        const lost = s.line[s.line.length - 1];
        g.owner[lost] = fr; g.version++;
        T.eq(g.lineEval(op).breach, true, 'una casilla de la línea en manos del enemigo es una brecha');
        T.ok(g.defBonus(es, s.back.find(c => CELL_TERRAIN[c] === 'mountain') ?? s.back[0]) > g.defBonus(es, s.line[0]), 'el terreno áspero defiende más que la llanura');
        return true;
    }],
    ['L1 · drawn, state y from se guardan y se cargan', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es);
        g.declareWar(es, fr);
        const s = T.sector(g, es, fr);
        const op = g.createOp(es, 'defensa', s.line);
        op.cells = s.line.slice(1); op.state = 'repliega'; op.rel = 0.6;
        const a = T.army(g, es, s.back[0], 2);
        a.from = op.id;
        const data = JSON.parse(JSON.stringify(g.serialize()));
        const h = GameEngine.load(data), o = h.ops.get(op.id);
        T.eq([o.drawn, o.cells, o.state, h.armies.get(a.id).from], [s.line, s.line.slice(1), 'repliega', op.id], 'vuelven igual');
        for (const x of data.ops) { delete x.drawn; delete x.state; }
        delete data.armyFrom;
        const old = GameEngine.load(data), oo = old.ops.get(op.id);
        T.eq([oo.drawn, oo.state, old.armies.get(a.id).from], [oo.cells, 'aguanta', 0], 'partida antigua: drawn = cells, aguanta');
        return true;
    }],
    ['L2 · la búsqueda prefiere las colinas o la montaña de detrás a la llanura de la frontera', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es);
        g.declareWar(es, fr);
        const s = T.sector(g, es, fr);
        const forces = s.back.slice(0, 4).map(c => T.army(g, es, c, 3));
        for (let k = 0; k < 4; k++) T.army(g, fr, s.front(k), 0, 4);
        const dir = g.lineDir(es, s.line), enemy = 4 * 4 * CONFIG.TYPES.tank.atk;
        const res = g.bestLine(es, { ref: s.line, forces, enemy, dir, limit: 2 * 4 * MOVE });
        const flat = s.line.reduce((t, c) => t + g.defBonus(es, c), 0) / s.line.length;
        T.ok(res && !res.same, 'propone otra línea');
        T.ok(res.mean > flat, `defiende más (${res.mean.toFixed(2)} > ${flat.toFixed(2)})`);
        T.ok(res.cells.every(c => g.owner[c] === es), 'por territorio propio');
        T.ok(res.cells.every((c, i) => i === 0 || G.dirTo(res.cells[i - 1], c) >= 0), 'continua, sin huecos');
        T.ok(res.cells.every(c => g.lineSide(s.line, dir, c) <= 0), 'detrás de la frontera');
        T.eq(res.cover, res.cells.length <= forces.length, 'dice si se puede cubrir');
        return true;
    }],
    ['L2 · líneas de una o dos casillas y la capital nunca por delante', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es);
        g.declareWar(es, fr);
        const s = T.sector(g, es, fr);
        const dir = g.lineDir(es, s.line), forces = [T.army(g, es, s.back[0], 2)];
        for (const ref of [[s.center], s.line.slice(0, 2)]) {
            const res = g.bestLine(es, { ref, forces, enemy: 100, dir: g.lineDir(es, ref), limit: 2 * 4 * MOVE });
            T.ok(res && res.cells.length >= 1, `línea de ${ref.length}: ${res?.cells.length} casillas`);
        }
        const keep = s.back[0];
        const res = g.bestLine(es, { ref: s.line, forces, enemy: 100, dir, limit: 2 * 4 * MOVE, keep });
        T.ok(g.lineSide(res.cells, dir, keep) <= 0, 'la casilla que no se puede dejar queda en la línea o detrás');
        T.eq(g.bestLine(es, { ref: [], forces, enemy: 0, dir, limit: 10 }), null, 'sin trazado no hay línea');
        return true;
    }],
    ['L3 · rota en llanura, se repliega junta a las colinas y nadie se queda en la línea antigua', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es);
        g.declareWar(es, fr);
        const s = T.sector(g, es, fr);
        const op = g.createOp(es, 'defensa', s.line);
        for (const c of s.line) g.assignArmy(T.army(g, es, c, 2), op.id);
        for (let k = 0; k < 4; k++) T.army(g, fr, s.front(k), 0, 4);
        const foes = [...g.armies.values()].filter(a => a.owner === fr && g.nearCells(s.center, 4).has(a.cell)).length;
        T.turns(g, es, 1);
        T.eq(op.state, 'repliega', 'se repliega');
        T.ok(op.cells.join() !== s.line.join() && op.drawn.join() === s.line.join(), 'nueva línea activa; la dibujada se guarda');
        const mean = cells => cells.reduce((t, c) => t + g.defBonus(es, c), 0) / cells.length;
        T.ok(mean(op.cells) > mean(s.line), 'a mejor terreno');
        for (let i = 0; i < 3; i++) T.turns(g, es, 1);
        const old = s.line.filter(c => !op.cells.includes(c));
        T.ok(g.opMembers(op).every(a => !old.includes(a.cell)), 'nadie se queda en la línea antigua');
        T.eq([...g.armies.values()].filter(a => a.owner === fr && g.nearCells(s.center, 4).has(a.cell)).length, foes, 'ni contraataca');
        return true;
    }],
    ['L3 · la ciudad que queda delante conserva guarnición con orden de mantener', () => {
        const g = T.game(), de = T.nation('de'), pl = T.nation('pl');
        g.start(de);
        g.declareWar(de, pl);
        const s = T.sector(g, de, pl, { city: true });
        const old = g.armyOn(s.center);
        if (old) g.removeArmy(old);
        const op = g.createOp(de, 'defensa', s.line);
        for (const c of new Set([...s.line, s.center])) g.assignArmy(T.army(g, de, c, c === s.center ? 3 : 2), op.id);
        for (let k = 0; k < 4; k++) T.army(g, pl, s.front(k), 0, 4);
        T.turns(g, de, 2);
        T.ok(g.lineSide(op.cells, g.lineDir(de, op.drawn), s.center) > 0, 'la ciudad queda delante de la nueva línea');
        const gar = g.armyOn(s.center);
        T.ok(gar && gar.owner === de && countUnits(gar.units) >= 1, 'la ciudad sigue guarnecida');
        T.eq([gar.op || 0, gar.order?.kind, gar.from], [0, 'hold', op.id], 'fuera de la operación, mantiene y recuerda de dónde salió');
        return true;
    }],
    ['L3 · en inferioridad no contraataca aunque una casilla dé 1,8', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es);
        g.declareWar(es, fr);
        const s = T.sector(g, es, fr);
        const op = g.createOp(es, 'defensa', s.line);
        const lost = s.line[3];
        for (const c of s.line) if (c !== lost) g.assignArmy(T.army(g, es, c, 2), op.id);
        g.owner[lost] = fr; g.version++;
        const weak = T.army(g, fr, lost, 1);
        for (let k = 0; k < 4; k++) T.army(g, fr, s.front(k), 0, 4);
        T.turns(g, es, 1);
        T.ok(g.armies.has(weak.id) && weak.cell === lost, 'no ataca al débil');
        T.eq(op.state, 'repliega', 'se repliega');
        return true;
    }],
    ['L3 · con refuerzos vuelve a la línea dibujada y no pasa de ella; sin vaivén entre 1 y 1,5', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es);
        g.declareWar(es, fr);
        const s = T.sector(g, es, fr);
        const op = g.createOp(es, 'defensa', s.line);
        for (const c of s.line) g.assignArmy(T.army(g, es, c, 2), op.id);
        const foes = [0, 1, 2, 3].map(k => T.army(g, fr, s.front(k), 0, 4));
        T.turns(g, es, 3);
        T.ok(op.cells.join() !== s.line.join(), 'replegada');
        // Relación entre 1 y 1,5 en la línea dibujada: se queda.
        for (const f of foes.slice(1)) g.removeArmy(f);
        const ev = () => g.lineEval(op, op.drawn);
        const extra = [];
        for (const c of s.back) { if (ev().rel >= 1.1) break; if (!g.armyAt[c]) { const a = T.army(g, es, c, 3); g.assignArmy(a, op.id); extra.push(a); } }
        T.ok(ev().rel >= 1 && ev().rel < 1.5, `relación ${ev().rel?.toFixed(2)}`);
        const here = op.cells.join();
        T.turns(g, es, 1);
        T.eq(op.cells.join(), here, 'entre 1 y 1,5 no vuelve');
        // Con 1,5 o más vuelve a la dibujada y no la pasa.
        for (const c of s.back) { if (ev().rel >= 2) break; if (!g.armyAt[c]) g.assignArmy(T.army(g, es, c, 0, 3), op.id); }
        T.turns(g, es, 1);
        T.ok(['restablece', 'aguanta'].includes(op.state) && op.cells.join() === s.line.join(), `vuelve a la dibujada (${op.state})`);
        for (let i = 0; i < 4; i++) T.turns(g, es, 1);
        const dir = g.lineDir(es, op.drawn);
        T.ok(g.opMembers(op).every(a => g.lineSide(op.drawn, dir, a.cell) <= 0), 'nadie pasa de la línea dibujada');
        return true;
    }],
    ['L3 · rodeado rompe el cerco o se refugia; sin miembros no falla; nunca deja la capital delante', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es);
        g.declareWar(es, fr);
        const s = T.sector(g, es, fr);
        g.nations[es].capitalCell = s.back[0];
        const op = g.createOp(es, 'defensa', s.line);
        g.executeOp(op);   // sin miembros
        const lone = T.army(g, es, s.line[3], 2);
        g.assignArmy(lone, op.id);
        let n = 0;
        for (let d = 0; d < 6 && n < 4; d++) { const j = G.nb[s.line[3] * 6 + d]; if (j >= 0 && !g.armyAt[j]) { T.army(g, fr, j, 0, 3); n++; } }
        T.ok(g.hostileSides(es, lone.cell) >= CONFIG.FLANKED_SIDES, 'rodeado');
        const cell0 = lone.cell;
        T.turns(g, es, 1);
        const still = g.armies.get(lone.id);
        T.ok(!still || still.cell !== cell0 || (still.from === op.id && still.order?.kind === 'hold'), 'ataca para salir, se aparta o se queda aguantando');
        T.ok(g.lineSide(op.cells, g.lineDir(es, op.drawn), s.back[0]) <= 0, 'la capital no queda delante');
        return true;
    }],
    ['L3 · manual y asistida no cambian la línea sin confirmar', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es);
        g.declareWar(es, fr);
        const s = T.sector(g, es, fr);
        const op = g.createOp(es, 'defensa', s.line, { auto: 'manual' });
        for (const c of s.line) g.assignArmy(T.army(g, es, c, 2), op.id);
        for (let k = 0; k < 4; k++) T.army(g, fr, s.front(k), 0, 4);
        g.executeOrders(es);
        T.eq([op.cells.join(), op.state], [s.line.join(), 'aguanta'], 'manual: no cambia');
        T.eq(g.defenseDecide(op).state, 'repliega', 'pero sabe que se replegaría');
        op.auto = 'asistida';
        g.executeOrders(es);
        g.previewOps(es, [op.id]);
        T.eq([op.cells.join(), op.state], [s.line.join(), 'aguanta'], 'asistida: no cambia sin confirmar, ni con la vista previa');
        g.executeOps(es, [op.id]);
        T.eq(op.state, 'repliega', 'al confirmar, se repliega');
        return true;
    }],
    ['L4 · la línea propuesta cubre solo el tramo amenazado y busca el terreno', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es);
        g.declareWar(es, fr);
        const s = T.sector(g, es, fr);
        for (let k = 0; k < 3; k++) T.army(g, fr, s.front(k), 0, 2);
        for (const c of s.back.slice(0, 6)) T.army(g, es, c, 3);
        const plan = g.frontPlan(es, fr);
        T.ok(plan && plan.line.length >= 3, 'hay línea');
        T.ok(plan.line.every(c => g.nearCells(s.center, 9).has(c)), 'solo el tramo por donde aprieta, no toda la frontera');
        const mean = cells => cells.reduce((t, c) => t + g.defBonus(es, c), 0) / cells.length;
        T.ok(mean(plan.line) >= mean(s.line), `terreno igual o mejor que la frontera (${mean(plan.line).toFixed(2)})`);
        T.ok(plan.lineInfo && typeof plan.lineInfo.label === 'string' && plan.lineInfo.rel > 0, 'con su descripción y relación prevista');
        return true;
    }],
    ['L4 · aviso de frente sin línea, una sola vez por guerra', () => {
        const g = T.game(), es = T.nation('es'), pt = T.nation('pt');
        g.start(es);
        g.declareWar(es, pt);
        g.executeOrders(es); g.turn++; g.executeOrders(es);
        const warned = () => g.logs.filter(l => l.msg.includes('sin línea de defensa')).length;
        T.eq(warned(), 1, 'una vez');
        const data = JSON.parse(JSON.stringify(g.serialize())), h = GameEngine.load(data);
        h.turn++; h.executeOrders(es);
        T.eq(h.logs.filter(l => l.msg.includes('sin línea de defensa')).length, 1, 'tampoco tras cargar');
        return true;
    }],
    ['L4 · la IA crea su línea con la búsqueda', () => {
        const g = T.game(), es = T.nation('es'), pt = T.nation('pt');
        g.start(es);
        g.declareWar(es, pt);
        const plan = g.frontPlan(pt, es);
        g.aiCommand(pt);
        const op = g.opsOf(pt).find(o => o.kind === 'defensa');
        T.ok(op && op.drawn.join() === plan.line.join(), 'la línea de la IA es la propuesta');
        return true;
    }],
    ['Mapa · vista y capas en un solo panel, recordadas en el dispositivo', () => {
        const g = T.uiStart('es');
        const key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
        T.ok(!document.querySelector('[data-action="supply"].tool') && !document.querySelector('.tool[data-action="view-mode"]'), 'sin botones sueltos de logística y relieve');
        document.querySelector('.tool[data-action="map-menu"]').click();
        T.ok(!document.querySelector('#map-menu').hidden, 'el botón Mapa abre el panel');
        const view = ui.prefs.view, other = view === 'realista' ? 'sencilla' : 'realista';
        document.querySelector(`#map-menu [data-action="view-set"][data-value="${other}"]`).click();
        T.eq(ui.prefs.view, other, 'cambia la vista');
        document.querySelector('#map-menu [data-action="supply"]').click();
        T.eq([ui.view.showSupply, readPrefs().supply], [true, true], 'logística encendida y recordada');
        document.querySelector('#map-menu [data-action="layer-ops"]').click();
        T.eq([ui.view.showOps, readPrefs().ops], [false, false], 'operaciones ocultas y recordadas');
        ui.view.draw();
        key('l');
        T.eq(ui.view.showSupply, false, 'la tecla L sigue valiendo');
        key('Escape');
        T.ok(document.querySelector('#map-menu').hidden, 'Esc lo cierra');
        key('m');
        T.ok(!document.querySelector('#map-menu').hidden, 'M lo abre');
        document.querySelector('#map-menu [data-action="layer-ops"]').click();
        document.querySelector(`#map-menu [data-action="view-set"][data-value="${view}"]`).click();
        key('m');
        T.ok(document.querySelector('#map-menu').hidden && ui.view.showOps, 'todo como estaba');
        return true;
    }],
    ['Carreteras · la casilla «Autopista» va en el panel de la carretera, no en la barra', () => {
        T.uiStart('es');
        T.ok(!document.querySelector('#tools [data-action="highway"]'), 'fuera de la barra de herramientas');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '2' }));
        const tick = document.querySelector('#confirm [data-action="highway"]');
        T.ok(tick && !document.querySelector('#confirm').hidden, 'en el panel de la carretera');
        tick.click();
        T.eq([ui.highway, document.querySelector('#confirm [data-action="highway"]').getAttribute('aria-pressed')], [true, 'true'], 'marcada');
        document.querySelector('#confirm [data-action="highway"]').click();
        return true;
    }],
    ['Carreteras · elegir un tramo existente y pasarlo a autopista pagando solo la diferencia', () => {
        const g = T.uiStart('es'), es = g.player;
        g.nations[es].gold = 100000;
        const cities = PROVINCES.filter(p => g.owner[p.city] === es);
        const a = cities[0].city, b = cities.map(p => p.city).find(c => c !== a && g.planRoad(es, a, x => x === c, 1)?.path.length > 4);
        const plan = g.planRoad(es, a, x => x === b, 1);
        g.buildRoad(es, plan);
        const mid = plan.path[Math.floor(plan.path.length / 2)];
        const st = g.roadStretch(es, mid);
        T.eq(st.edges.length, plan.path.length - 1, 'el tramo va de ciudad a ciudad');
        const full = g.planRoad(es, a, x => x === b, 2);   // por las mismas casillas, como autopista
        const fresh = Math.round(plan.path.slice(0, -1).reduce((s, c, i) => s + (CONFIG.ROAD_COST + CONFIG.HIGHWAY_COST) * Math.max(terrainOf(c).cost, terrainOf(plan.path[i + 1]).cost) + 0, 0));
        T.ok(st.cost < fresh, `mejorar (${st.cost}) cuesta menos que hacerla nueva (${fresh})`);
        T.eq(full.cost, st.cost, 'el trazado de autopista por encima cuesta lo mismo que la mejora');
        ui.setTool('road');
        ui.clickCell(mid);
        const btn = document.querySelector('[data-action="upgrade-stretch"]');
        T.ok(btn && btn.textContent.includes(String(st.cost)), 'el panel ofrece la mejora con su precio');
        const gold = g.nations[es].gold;
        btn.click();
        T.eq([g.nations[es].gold, plan.path.slice(0, -1).every((c, i) => g.road[c * 6 + G.dirTo(c, plan.path[i + 1])] === 2)], [gold - st.cost, true], 'autopista y cobrado');
        T.eq(g.roadStretch(es, mid), null, 'ya no queda carretera que mejorar');
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
