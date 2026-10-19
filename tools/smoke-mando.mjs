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
        turns(g, owner, n) { for (let i = 0; i < n; i++) { g.executeOrders(owner); g.turn++; for (const a of g.armies.values()) if (a.owner === owner) a.used = 0; } },
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
