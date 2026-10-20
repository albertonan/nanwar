// Pruebas del agua en el navegador: ejércitos por mar (embarcar, navegar y desembarcar).
// Sirve el juego por HTTP, crea partidas nuevas con GameEngine y comprueba las reglas una a una.
// Uso: node basicmilitary-agua/tools/smoke-agua.mjs [filtro]   (CHROME=<ruta> para usar otro navegador)
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
        embark(g, owner, sea, n = 1) { return g.settle(g.newArmy(owner, sea, { infantry: n, tank: 0, artillery: 0 }, 0)); }
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
['4 · el árbol tiene 13 ramas y 39 investigaciones', () => { T.eq([RESEARCH_BRANCHES.length, TECHS.length], [13, 39], 'árbol'); return true; }]
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
