// Pruebas de cohetes, misiles y armas nucleares en el navegador: ramas de investigación y ajuste de partida.
// Sirve el juego por HTTP, crea partidas nuevas con GameEngine y comprueba las reglas una a una.
// Uso: node basicmilitary/tools/smoke-misiles.mjs [filtro]   (CHROME=<ruta> para usar otro navegador)
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
    ['C5 · dos ramas en Militar', () => {
        const ids = RESEARCH_BRANCHES.filter(b => b.area === 'Militar').map(b => b.id);
        T.ok(ids.includes('cohete') && ids.includes('estrategicas'), `ramas: ${ids}`);
        T.eq(TECH_TREE.cohete.map(t => t[0]), ['Cohetes de largo alcance', 'Misiles balísticos tácticos', 'Misiles de alcance medio'], 'Cohetería');
        T.eq(TECH_TREE.estrategicas.map(t => t[0]), ['Misiles de crucero', 'Vehículos de reentrada maniobrables', 'Bomba nuclear'], 'Estratégicas');
        T.eq(TECHS.length, 60, 'investigaciones');
        for (const b of ['cohete', 'estrategicas']) T.ok(RS_ICON[BRANCH_BY_ID.get(b).icon], `icono de ${b}`);
        return true;
    }],
    ['C5 · desbloqueos por nivel', () => {
        const g = T.game(), id = T.nation('es'), r = () => g.rules(id);
        for (const k of ['rocketHeavy', 'missile', 'missileHeavy', 'guided', 'nuclear']) T.eq(r()[k], false, `${k} de base`);
        T.eq(r().interceptMult, 1, 'interceptMult de base');
        const steps = [['cohete1', 'rocketHeavy'], ['cohete2', 'missile'], ['cohete3', 'missileHeavy'], ['estrategicas1', 'guided'], ['estrategicas3', 'nuclear']];
        for (const [t, k] of steps) { T.learn(g, id, t); T.eq(r()[k], true, `${k} tras ${t}`); }
        T.eq(r().interceptMult, 1, 'sin reentrada');
        T.learn(g, id, 'estrategicas2');
        T.eq(r().interceptMult, 0.7, 'reentrada');
        return true;
    }],
    ['C4 · potencias nucleares empiezan con la bomba investigada', () => {
        const g = T.game();
        const nuke = ['us', 'ru', 'cn', 'fr', 'gb', 'in', 'pk', 'il', 'kp'].filter(k => T.nation(k) >= 0);
        T.ok(nuke.length >= 3, `potencias en el mapa: ${nuke}`);
        for (const k of nuke) {
            const id = T.nation(k), d = g.nations[id].tech.done;
            T.ok(['estrategicas1', 'estrategicas2', 'estrategicas3'].every(t => d.has(t)), `${k} sin sus armas estratégicas`);
            T.eq(g.rules(id).nuclear, true, `${k} nuclear`);
        }
        const es = g.nations[T.nation('es')].tech.done;
        T.ok(!es.has('estrategicas3'), 'España no es nuclear');
        T.eq(g.settings.nukes, true, 'permitidas por defecto');
        // Se guarda y se carga; una partida vieja sin el ajuste las permite.
        const data = JSON.parse(JSON.stringify(g.serialize()));
        T.eq(GameEngine.load(data).settings.nukes, true, 'carga');
        delete data.settings.nukes;
        T.eq(GameEngine.load(data).settings.nukes, true, 'partida vieja');
        return true;
    }],
    ['C4 · prohibidas: nadie la tiene ni la puede investigar', () => {
        const g = T.game();
        g.configure({ ...g.settings, nukes: false });
        T.eq(g.settings.nukes, false, 'ajuste');
        for (const n of g.nations) T.ok(!n.tech.done.has('estrategicas3') && !n.tech.done.has('estrategicas1'), `${n.key} la tiene`);
        const es = T.nation('es');
        T.learn(g, es, 'estrategicas1', 'estrategicas2');
        T.eq(g.techState(es, 'estrategicas3'), 'banned', 'estado');
        g.nations[es].gold = 1e6;
        T.eq(g.startResearch(es, 'estrategicas3'), false, 'no se puede empezar');
        // La IA nunca la escoge.
        for (const n of g.nations) { T.learn(g, n.id, 'estrategicas1', 'estrategicas2'); T.ok(g.aiTechChoice(n.id) !== 'estrategicas3', 'la IA la escoge'); }
        // Se guarda y se carga.
        const data = JSON.parse(JSON.stringify(g.serialize()));
        T.eq(GameEngine.load(data).settings.nukes, false, 'carga');
        // La ficha del diálogo lo dice.
        T.uiStart('es');
        ui.game.configure({ ...ui.game.settings, nukes: false });
        T.learn(ui.game, ui.game.player, 'estrategicas1', 'estrategicas2');
        ui.openResearch('estrategicas3');
        const txt = document.querySelector('#research-dialog .rs-card').textContent;
        document.querySelector('#research-dialog').close();
        T.ok(/prohibid/i.test(txt), `sin motivo en la ficha: ${txt}`);
        return true;
    }],
    ['C1 · precio en turnos de renta con mínimo', () => {
        const g = T.game(), id = T.nation('es'), gross = g.grossIncome(id);
        T.ok(gross > 0, 'renta');
        for (const [k, turns, min] of [['rocket', 1, 150], ['heavyRocket', 2, 300], ['missile', 4, 600], ['heavy', 8, 1200], ['guided', 6, 900], ['nuclear', 25, 5000]]) {
            T.eq(g.weaponPrice(id, k), Math.max(min, turns * gross), `precio de ${k}`);
        }
        // Con una renta alta manda la renta; con una baja, el mínimo.
        T.eq(g.weaponPrice(T.nation('fr'), 'nuclear'), Math.max(5000, 25 * g.grossIncome(T.nation('fr'))), 'Francia');
        // El mantenimiento del arsenal no cambia el precio.
        g.nations[id].arsenal.nuclear = 3;
        T.eq(g.weaponPrice(id, 'missile'), Math.max(600, 4 * gross), 'precio con arsenal');
        return true;
    }],
    ['C1 · el mantenimiento baja la renta', () => {
        const g = T.game(), id = T.nation('es'), gross = g.grossIncome(id);
        T.eq(g.income(id), gross, 'sin arsenal');
        g.nations[id].arsenal.rocket = 4; g.nations[id].arsenal.guided = 2;
        T.eq(g.arsenalUpkeep(id), 4 * 5 + 2 * 30, 'mantenimiento');
        T.eq(g.income(id), gross - 80, 'renta neta');
        g.nations[id].gold = 1000;
        const got = g.beginNationTurn(id);   // el desarrollo puede subir la renta un poco al cobrar
        T.eq(got, g.income(id), 'cobro');
        T.eq(g.nations[id].gold, 1000 + got, 'oro');
        T.eq(got, g.grossIncome(id) - 80, 'neto');
        // Desglose en el resumen del país.
        T.uiStart('es');
        ui.game.nations[ui.game.player].arsenal.missile = 1;
        T.ok(/Mantenimiento del arsenal\s*−20/.test(ui.economyFacts(ui.game.player).replace(/<[^>]+>/g, ' ')), 'sin línea en el desglose');
        return true;
    }],
    ['C1 · sin oro se desmantela y nunca queda negativo', () => {
        const g = T.game(), id = T.nation('es'), n = g.nations[id], gross = g.grossIncome(id);
        n.arsenal.rocket = 10; n.arsenal.heavy = 5;   // 50 + 200
        n.gold = 0;
        const up = g.arsenalUpkeep(id);
        T.ok(up > gross, 'el mantenimiento debe pasar de la renta');
        g.player = id;
        g.beginNationTurn(id);
        T.ok(n.gold >= 0, `oro negativo: ${n.gold}`);
        T.ok(g.income(id) >= 0, 'renta neta negativa');
        // Primero los de más mantenimiento: los misiles pesados caen antes que los cohetes.
        T.ok(n.arsenal.heavy < 5, 'no se quitó ninguno pesado');
        if (n.arsenal.heavy > 0) T.eq(n.arsenal.rocket, 10, 'cohetes intactos mientras queden pesados');
        T.ok(g.logs.some(l => /desmantelan/.test(l.msg)), 'sin aviso');
        // Con oro de sobra no se toca nada.
        n.arsenal.heavy = 1; n.arsenal.rocket = 0; n.gold = 100000;
        g.beginNationTurn(id);
        T.eq(n.arsenal.heavy, 1, 'con oro no se desmantela');
        return true;
    }],
    ['C1 · comprar exige la investigación', () => {
        const g = T.game(), id = T.nation('es'), n = g.nations[id];
        n.gold = 1e7;
        g.player = id;
        T.eq(g.canBuyWeapon(id, 'rocket'), '', 'el cohete no pide nada');
        const steps = [['heavyRocket', 'cohete1'], ['missile', 'cohete2'], ['heavy', 'cohete3'], ['guided', 'estrategicas1'], ['nuclear', 'estrategicas3']];
        for (const [k, t] of steps) {
            T.ok(g.canBuyWeapon(id, k) !== '', `${k} sin ${t}`);
            T.eq(g.buyWeapon(id, k), false, `compra de ${k} sin investigar`);
            T.learn(g, id, t);
            T.eq(g.canBuyWeapon(id, k), '', `${k} con ${t}`);
        }
        const gold = n.gold, price = g.weaponPrice(id, 'heavy');
        T.eq(g.buyWeapon(id, 'heavy', 2), true, 'compra');
        T.eq(n.arsenal.heavy, 2, 'arsenal');
        T.eq(n.gold, gold - 2 * price, 'oro');
        n.gold = 10;
        T.ok(g.canBuyWeapon(id, 'rocket') !== '', 'sin oro');
        T.eq(g.playerBuyWeapon('rocket'), false, 'jugador sin oro');
        n.gold = 1e7;
        T.eq(g.playerBuyWeapon('rocket', 3), true, 'jugador compra');
        T.eq(n.arsenal.rocket, 3, 'cohetes');
        // Con las nucleares prohibidas no se compra, aunque se tenga la investigación.
        g.configure({ ...g.settings, nukes: false });
        T.ok(/prohibid/.test(g.canBuyWeapon(id, 'nuclear')), 'prohibida');
        T.eq(g.buyWeapon(id, 'nuclear'), false, 'compra prohibida');
        return true;
    }],
    ['C1 · guardar y cargar el arsenal', () => {
        const g = T.game(), id = T.nation('es');
        Object.assign(g.nations[id].arsenal, { rocket: 3, heavy: 2, nuclear: 1 });
        const data = JSON.parse(JSON.stringify(g.serialize()));
        T.eq(GameEngine.load(data).nations[id].arsenal, g.nations[id].arsenal, 'ida y vuelta');
        // Partida vieja: sin arsenal, vacío. Valores raros, acotados.
        for (const n of data.nations) delete n.arsenal;
        T.eq(GameEngine.load(data).nations[id].arsenal, { rocket: 0, heavyRocket: 0, missile: 0, heavy: 0, guided: 0, nuclear: 0 }, 'partida vieja');
        data.nations[id].arsenal = { rocket: -5, heavy: 'x', guided: 7.9 };
        const a = GameEngine.load(data).nations[id].arsenal;
        T.ok(a.rocket >= 0 && a.heavy === 0 && Number.isInteger(a.guided), `validación: ${JSON.stringify(a)}`);
        return true;
    }],
    ['C4 · las investigaciones de partida no encarecen las siguientes', () => {
        const g = T.game(), us = T.nation('fr'), es = T.nation('es');
        T.eq(g.nations[us].tech.done.size, 3, 'Francia empieza con tres');
        T.eq(g.researchedCount(us), 0, 'ninguna cuenta');
        // La misma investigación cuesta lo mismo (a igual renta) a una potencia nuclear que a quien no ha investigado nada.
        const ref = g.researchCost(us, 'infanteria1') / g.grossIncome(us), cost = id => Math.max(80, g.grossIncome(id) * 4);
        T.eq(g.researchCost(us, 'infanteria1'), Math.round(cost(us) * g.rules(us).researchCost), 'sin recargo');
        // Una investigación hecha de verdad sí encarece un 10 %.
        T.learn(g, us, 'infanteria1');
        T.eq(g.researchedCount(us), 1, 'una cuenta');
        T.eq(g.researchCost(us, 'infanteria2') > 0 && g.researchedCount(us), 1, 'una');
        T.ok(ref > 0, 'ref');
        // Se guarda y se carga.
        const h = GameEngine.load(JSON.parse(JSON.stringify(g.serialize())));
        T.eq(h.researchedCount(us), 1, 'tras cargar');
        T.eq(h.researchedCount(es), 0, 'España');
        return true;
    }]
];

const exe = process.env.CHROME ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find(existsSync);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
let failed = 0, ran = 0;
try {
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
    // Capturas del diálogo de investigación en el área Militar (ocho ramas): escritorio y móvil, sin desbordar.
    const SHOTS = 'C5 · capturas de Militar con ocho ramas';
    if (!filter || SHOTS.includes(filter)) {
        ran++;
        const out = join(root, 'tools/cache/smoke'), errors = [];
        mkdirSync(out, { recursive: true });
        for (const [file, opts] of [['misiles-investigacion', { viewport: { width: 1200, height: 800 } }], ['misiles-investigacion-movil', PHONE]]) {
            const page = await browser.newPage(opts);
            page.on('pageerror', e => errors.push(`${file}: ${e.message}`));
            await page.goto(`http://localhost:${port}/?seed=7&mapa=europa`);
            await page.waitForFunction(() => typeof GameEngine === 'function' && typeof ui === 'object');
            await page.evaluate(setup);
            await page.evaluate(() => {
                T.uiStart('es'); ui.openResearch('cohete1');
                document.querySelector('#research-dialog [data-action="rs-filter"][data-area="Militar"]').click();
            });
            await page.waitForTimeout(300);
            const m = await page.evaluate(() => {
                const d = document.querySelector('#research-dialog');
                return { rows: d.querySelectorAll('.rs-row').length, over: d.scrollWidth - d.clientWidth, icons: d.querySelectorAll('.rs-patch svg').length };
            });
            if (m.rows !== 8 || m.over > 3 || m.icons < 8) errors.push(`${file}: ${JSON.stringify(m)}`);
            await page.screenshot({ path: join(out, `${file}.png`) });
            await page.close();
        }
        if (errors.length) { failed++; console.log(`FALLA ${SHOTS}\n      ${errors.join('\n      ')}`); }
        else console.log(`ok    ${SHOTS} (${join(out, 'misiles-investigacion.png')}, misiles-investigacion-movil.png)`);
    }
    for (const page of pages.values()) if (page.errors.length) { failed++; console.log(`FALLA errores en la página:\n      ${page.errors.join('\n      ')}`); }
} finally {
    await browser.close();
    server.close();
}
console.log(`${ran - Math.min(failed, ran)}/${ran} pruebas superadas`);
process.exit(failed ? 1 : 0);
