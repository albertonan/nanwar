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
