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
        game(seed = 7, fog = false, nukes = true) { const g = new GameEngine(seed); g.configure({ aggression: 'normal', alliances: 'ninguna', victory: 1, fog, nukes }); return g; },
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
        // Como `clear`, la primera que cumpla `ok(c)` (p. ej., a alcance de un lanzador).
        clearWhere(g, owner, R, ok) {
            for (let k = 0; ; k++) { const c = T.clear(g, owner, R, k); if (ok(c)) return c; }
        },
        // Sin ejércitos de `owner`.
        noArmies(g, owner) { for (const a of [...g.armies.values()]) if (a.owner === owner) g.removeArmy(a); },
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
    }],
    ['C2 · cohete solo desde un ejército a 80 km y una salva por ejército y turno', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); T.bare(g); T.noIntegrated(g); g.declareWar(es, fr);
        T.noArmies(g, es);
        const target = T.clear(g, fr, 6), foe = T.army(g, fr, target, 20);
        g.nations[es].arsenal.rocket = 4;
        T.eq(g.launchers(es, 'rocket', target), [], 'sin ejército, ninguno');
        T.ok(/ejército/.test(g.strikeCheck(es, 'rocket', 1, 'army', target)), `dice por qué: ${g.strikeCheck(es, 'rocket', 1, 'army', target)}`);
        // Un ejército a más de 80 km no llega; uno a 80 km, sí. Las ciudades no lanzan cohetes.
        const R = kmCells(80);
        T.eq(R, 4, '80 km');
        const ring = d => hexDisc(target, d).filter(c => hexDist(c, target) === d && isLand(c) && !g.armyAt[c] && CITY_OF[c] < 0);
        T.army(g, es, ring(R + 1)[0]);
        const near = T.army(g, es, ring(R)[0], 3);
        T.eq(g.launchers(es, 'rocket', target), [near.cell], 'solo el que llega');
        T.eq(g.strikeOdds(es, 'rocket', 2, 'army', target).through, 2, 'sin defensas, pasan todos');
        T.luck(g, 0.5);
        const res = g.launchStrike(es, 'rocket', 2, 'army', target);
        let want = 20;
        for (let i = 0; i < 2; i++) want -= Math.min(want, Math.max(1, Math.round(want * 0.075)));   // 6–9 %, compuestas
        T.eq([res.result, res.through, countUnits(foe.units), g.nations[es].arsenal.rocket, near.rocketTurn], ['hit', 2, want, 2, g.turn], `salva: ${res.text}`);
        T.eq(g.motion[g.motion.length - 1], { kind: 'strike', owner: es, from: near.cell, cell: target, weapon: 'rocket', n: 2, through: 2 }, 'evento para la animación');
        T.ok(g.logs.some(l => l.msg === res.text), 'parte');
        // Una salva por ejército y turno.
        T.eq(g.launchers(es, 'rocket', target), [], 'ya ha disparado');
        T.ok(/este turno/.test(g.strikeCheck(es, 'rocket', 1, 'army', target)), 'una salva por turno');
        T.eq([g.launchStrike(es, 'rocket', 1, 'army', target).result, g.nations[es].arsenal.rocket], ['invalid', 2], 'no lanza');
        // Se guarda: cargar no le da otra salva.
        T.eq(GameEngine.load(JSON.parse(JSON.stringify(g.serialize()))).launchers(es, 'rocket', target), [], 'tras cargar');
        // Otro ejército sí puede; al turno siguiente, también el primero.
        const other = T.army(g, es, ring(R)[0]);
        T.eq(g.launchers(es, 'rocket', target), [other.cell], 'otro ejército');
        g.turn++;
        T.eq(g.launchers(es, 'rocket', target), [near.cell, other.cell].sort((a, b) => a - b), 'turno siguiente');
        // El cohete pesado sale también de una ciudad, a 300 km.
        T.learn(g, es, 'cohete1');
        const [, b] = T.border(g, es, fr), city = T.baseFor(g, es, b, kmCells(300));
        T.ok(g.launchers(es, 'heavyRocket', b).includes(city) && !g.launchers(es, 'rocket', b).includes(city), 'ciudad: cohete pesado sí, cohete no');
        return true;
    }],
    ['C2 · misil baja un nivel de fortificación por cada uno que llega', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); T.bare(g); T.noIntegrated(g); g.declareWar(es, fr); T.learn(g, es, 'cohete1', 'cohete2', 'cohete3');
        const [, cell] = T.border(g, es, fr);
        if (g.armyOn(cell)) g.removeArmy(g.armyOn(cell));
        g.fort[cell] = 3; g.fortVersion++;
        Object.assign(g.nations[es].arsenal, { missile: 3, heavy: 1, rocket: 1 });
        T.ok(g.launchers(es, 'missile', cell).length > 0, 'una ciudad a alcance');
        T.ok(/fortificación/.test(g.strikeCheck(es, 'rocket', 1, 'fort', cell)), 'el cohete no baja fortificaciones');
        T.near(g.strikeOdds(es, 'missile', 2, 'fort', cell).levels, 2, 1e-9, 'previsión: dos niveles');
        T.luck(g, 0.5);
        let res = g.launchStrike(es, 'missile', 2, 'fort', cell);
        T.eq([res.result, res.through, g.fort[cell], g.nations[es].arsenal.missile], ['hit', 2, 1, 1], `dos misiles, dos niveles: ${res.text}`);
        T.ok(/sacos terreros/.test(res.text), `el parte dice a qué baja: ${res.text}`);
        res = g.launchStrike(es, 'heavy', 1, 'fort', cell);
        T.eq([g.fort[cell], g.nations[es].arsenal.heavy], [0, 0], `el pesado quita dos (aquí, el que queda): ${res.text}`);
        T.eq(g.strikeCheck(es, 'missile', 1, 'fort', cell), 'No hay fortificación.', 'sin fortificación');
        // Las que llegan cuando ya no queda nada no hacen nada más.
        g.fort[cell] = 1; g.fortVersion++;
        res = g.launchStrike(es, 'missile', 1, 'fort', cell);
        T.eq([g.fort[cell], g.nations[es].arsenal.missile], [0, 0], 'el último');
        return true;
    }],
    ['C2 · el misil pesado alcanza las vecinas al 8 % y baja el desarrollo de una ciudad', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); T.bare(g); T.noIntegrated(g); g.declareWar(es, fr); T.learn(g, es, 'cohete3');
        const city = PROVINCES.filter(p => g.owner[p.city] === fr && hexDisc(p.city, 1).every(j => isLand(j))).map(p => p.city)[0];
        for (const j of hexDisc(city, 1)) if (g.armyOn(j)) g.removeArmy(g.armyOn(j));
        const nbs = hexDisc(city, 1).filter(j => j !== city);
        const foe = T.army(g, fr, city, 40), n1 = T.army(g, fr, nbs[0], 25), mine = T.army(g, es, nbs[1], 50);
        const pid = G.prov[city];
        g.dev[pid] = 400;
        g.nations[es].arsenal.heavy = 1;
        T.luck(g, 0.5);
        const res = g.launchStrike(es, 'heavy', 1, 'army', city);
        T.eq([res.result, countUnits(foe.units)], ['hit', 40 - Math.round(40 * 0.275)], `25–30 %: ${res.text}`);
        T.eq([countUnits(n1.units), countUnits(mine.units)], [25 - 2, 50 - 4], 'vecinas al 8 %, también lo propio');
        T.eq(g.dev[pid], 300, 'desarrollo −25 %');
        T.eq(foe.disorgUntil || 0, 0, 'la tabla no lo desorganiza');
        // El misil sí desorganiza, y no toca las vecinas ni el desarrollo.
        T.learn(g, es, 'cohete2'); g.nations[es].arsenal.missile = 1;
        g.launchStrike(es, 'missile', 1, 'army', city);
        T.ok(foe.disorgUntil >= g.turn, 'desorganizado');
        T.eq([countUnits(n1.units), g.dev[pid]], [23, 300], 'el misil solo da al blanco');
        return true;
    }],
    ['C2 · a ciegas rinde la mitad salvo el guiado', () => {
        const g = T.game(7, true), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); T.bare(g); T.noIntegrated(g); g.declareWar(es, fr);
        T.learn(g, es, 'cohete2', 'estrategicas1', 'aviacion1', 'aviacion2');   // con Munición guiada (es de la aviación)
        const cell = G.land.find(c => g.owner[c] === fr && CITY_OF[c] < 0 && !g.armyAt[c] && !g.knownCell(es, c) && g.launchers(es, 'missile', c).length);
        T.ok(cell !== undefined, 'blanco desconocido a alcance');
        g.fort[cell] = 3; g.fortVersion++;
        Object.assign(g.nations[es].arsenal, { missile: 4, guided: 2 });
        const o = g.strikeOdds(es, 'missile', 2, 'fort', cell);
        T.eq([o.why, o.known, o.hit], ['', false, 0.5], 'a ciegas, la mitad');
        T.eq(g.strikeOdds(es, 'guided', 2, 'fort', cell).hit, 1, 'el guiado, entero');
        T.ok(o.unknown && /defensas que no conoces/.test(o.warn), 'avisa de que puede haber defensas');
        T.luck(g, 0.4);   // por debajo de la mitad, la tirada a ciegas falla
        let res = g.launchStrike(es, 'missile', 2, 'fort', cell);
        T.eq([res.result, res.through, g.fort[cell]], ['miss', 2, 3], `fallan: ${res.text}`);
        T.luck(g, 0.6);
        g.launchStrike(es, 'missile', 2, 'fort', cell);
        T.eq(g.fort[cell], 1, 'aciertan');
        T.luck(g, 0.4);
        res = g.launchStrike(es, 'guided', 2, 'fort', cell);
        T.eq([res.result, g.fort[cell]], ['hit', 0], `el guiado no falla a ciegas: ${res.text}`);
        return true;
    }],
    ['C3 · las baterías y el antiaéreo interceptan según la tabla y la capacidad', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); T.bare(g); T.noIntegrated(g); g.declareWar(es, fr); T.learn(g, fr, 'defensa1');
        const cell = T.clear(g, fr, 3), foe = T.army(g, fr, cell, 30), b = T.battery(g, fr, cell);
        T.army(g, es, hexDisc(cell, 1).find(c => c !== cell && isLand(c)), 2);
        g.nations[es].arsenal.rocket = 6;
        // Previsión: la batería (nivel 1: cohetes al 70 %, 4 por ronda) atiende 4 de los 6.
        T.near(g.strikeOdds(es, 'rocket', 6, 'army', cell).through, 2 + 4 * 0.3, 1e-9, 'previsión');
        T.eq(b.used, 0, 'la previsión no gasta');
        T.luck(g, 0);
        const res = g.launchStrike(es, 'rocket', 6, 'army', cell);
        T.eq([res.through, res.stopped, b.used, b.known.has(es)], [2, { drones: 0, batteries: 4, aa: 0 }, 4, true], 'para 4 y pasan 2; se delata');
        T.ok(/4 de 6 cohetes interceptados/.test(res.text), `parte: ${res.text}`);
        let want = 30;
        for (let i = 0; i < 2; i++) want -= Math.max(1, Math.round(want * 0.06));
        T.eq(countUnits(foe.units), want, 'bajas de los que llegan');
        // Antiaéreo: cuatro sitios con Defensa aérea 2 (S = 64) paran el 55 % de los misiles, 3 armas cada uno por ronda.
        const h = T.game();
        h.start(es); T.bare(h); T.noIntegrated(h); h.declareWar(es, fr); T.learn(h, fr, 'antiaerea1', 'antiaerea2'); T.learn(h, es, 'cohete2');
        const c = T.clearWhere(h, fr, 2, j => h.launchers(es, 'missile', j).length), sites = [c, ...hexDisc(c, 1).filter(j => j !== c && isLand(j))].slice(0, 4);
        for (const s of sites) T.site(h, fr, s);
        T.army(h, fr, c, 30);
        h.nations[es].arsenal.missile = 16;
        T.ok(h.launchers(es, 'missile', c).length > 0, 'a alcance');
        T.near(h.strikeOdds(es, 'missile', 1, 'army', c).through, Math.exp(-0.8), 1e-9, 'un misil');
        const exp = 9 * Math.exp(-0.8) + Math.exp(-0.6) + Math.exp(-0.4) + Math.exp(-0.2) + 1;
        T.near(h.strikeOdds(es, 'missile', 13, 'army', c).through, exp, 1e-9, 'trece: la capacidad se agota');
        h.player = fr;   // el parte de la víctima
        T.luck(h, 0);
        const r2 = h.launchStrike(es, 'missile', 13, 'army', c);
        T.eq([r2.through, r2.stopped.aa, h.nations[es].arsenal.missile], [1, 12, 3], 'doce interceptados, la 13.ª pasa');
        T.ok(sites.every(s => h.aaSites.get(s).known.has(es)), 'los sitios que disparan se delatan');
        T.ok(h.logs.some(l => l.msg.startsWith(h.nm(es)) && /12 de 13 misiles interceptados/.test(l.msg)), `parte para la víctima: ${h.logs.slice(-2).map(l => l.msg)}`);
        return true;
    }],
    ['C3 · Armas estratégicas 2 rebaja la intercepción ×0,7', () => {
        const g = T.game(7, false, false), es = T.nation('es'), fr = T.nation('fr');
        T.eq(g.rules(fr).interceptMult, 1, 'sin nucleares, Francia empieza sin ella');
        T.eq(T.game(7, false, true).rules(fr).interceptMult, 0.7, 'con nucleares, Francia empieza con ella');
        g.start(es); T.bare(g); T.noIntegrated(g); g.declareWar(es, fr); T.learn(g, fr, 'defensa1', 'defensa2'); T.learn(g, es, 'cohete2');
        const cell = T.clearWhere(g, fr, 3, j => g.launchers(es, 'missile', j).length);
        T.army(g, fr, cell, 10);
        g.nations[es].arsenal.missile = 1;
        T.battery(g, fr, cell);
        const pass = () => g.strikeOdds(es, 'missile', 1, 'army', cell).through;
        T.near(pass(), 0.4, 1e-9, 'batería de nivel 2: el 60 %');
        T.learn(g, es, 'estrategicas2');
        T.near(pass(), 1 - 0.6 * 0.7, 1e-9, 'con reentrada maniobrable, ×0,7');
        T.near(g.incomingDefense(es, 'rocket', cell, 1, { simulate: true }).through, 0.2, 1e-9, 'los cohetes no cambian');
        // Y el antiaéreo: un sitio sin investigar (S = 10), k = 0,5.
        g.batteries.delete(cell); T.site(g, fr, cell);
        T.near(pass(), 1 - 0.7 * (1 - Math.exp(-10 * 0.5 / 40)), 1e-9, 'antiaéreo ×0,7');
        return true;
    }],
    ['C2 · salva mayor que el arsenal o sin lanzador: no lanza y dice por qué', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); T.bare(g); T.noIntegrated(g); g.declareWar(es, fr); T.learn(g, es, 'cohete2', 'estrategicas3');
        T.noArmies(g, es);
        const [, cell] = T.border(g, es, fr);
        if (!g.armyOn(cell)) T.army(g, fr, cell, 10);
        const ar = g.nations[es].arsenal;
        Object.assign(ar, { rocket: 3, missile: 2, nuclear: 1 });
        // Lo más lejos de las ciudades de España en Francia, fuera del alcance del misil.
        const cities = PROVINCES.filter(p => g.owner[p.city] === es).map(p => p.city), gap = c => Math.min(...cities.map(x => hexDist(x, c)));
        const far = G.land.filter(c => g.owner[c] === fr).sort((a, b) => gap(b) - gap(a))[0];
        T.ok(gap(far) > kmCells(500), 'Francia tiene tierra a más de 500 km');
        if (!g.armyOn(far)) T.army(g, fr, far, 10);
        const before = JSON.stringify(ar), moves = g.motion.length, units = countUnits(g.armyOn(cell).units);
        for (const [key, n, kind, c, why] of [['missile', 3, 'army', cell, /Solo tienes 2 misiles/], ['missile', 1, 'army', far, /alcance/], ['rocket', 1, 'army', cell, /ejército/],
            ['missile', 0, 'army', cell, /salva/i], ['rocket', 1, 'fort', cell, /fortificación/], ['nuclear', 1, 'fort', cell, /nuclear no sirve/], ['nuclear', 2, 'army', cell, /Solo tienes 1 bomba nuclear/], ['guided', 1, 'army', cell, /No tienes/]]) {
            const res = g.playerStrike(key, n, kind, c);
            T.eq(res.result, 'invalid', `${key} × ${n}`);
            T.ok(why.test(res.text), `${key} × ${n}: ${res.text}`);
            T.eq(g.logs[g.logs.length - 1].msg, res.text, 'el parte dice por qué');
        }
        T.eq([JSON.stringify(ar), g.motion.length, countUnits(g.armyOn(cell).units)], [before, moves, units], 'no lanza nada');
        // La nuclear, contra un ejército o una casilla, sí (C4).
        T.eq(g.strikeCheck(es, 'nuclear', 1, 'army', cell), '', 'nuclear contra un ejército');
        // Con lo justo, sí.
        T.eq(g.playerStrike('missile', 2, 'army', cell).result, 'hit', 'lanza');
        T.eq(ar.missile, 0, 'gasta');
        return true;
    }],
    ['C4 · destruye la casilla y la mitad en el radio, también lo propio', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr'), R = kmCells(40);
        T.eq(R, 2, 'radio de 40 km en Europa');
        g.start(es); T.bare(g); T.noIntegrated(g); g.declareWar(es, fr); T.learn(g, es, 'estrategicas3');
        const cell = T.clear(g, fr, R + 1), ring = d => hexDisc(cell, d).filter(c => hexDist(c, cell) === d && isLand(c) && !g.armyAt[c]);
        T.ok(g.launchers(es, 'nuclear', cell).length > 0, 'a alcance de una ciudad');
        const foe = T.army(g, fr, cell, 40), near = T.army(g, fr, ring(1)[0], 20), edge = T.army(g, fr, ring(R)[0], 9);
        const mine = T.army(g, es, ring(1)[0], 10), out = T.army(g, fr, ring(R + 1)[0], 20);
        g.nations[es].arsenal.nuclear = 2;
        const o = g.strikeOdds(es, 'nuclear', 1, 'army', cell);
        T.eq([o.why, o.through, o.hit], ['', 1, 1], 'previsión: sin defensas, llega');
        T.ok(/mitad/.test(o.effect) && /paria/.test(o.effect) && /contamina/.test(o.effect), `previsión: ${o.effect}`);
        T.eq(g.isPariah(es), false, 'aún no es paria');
        const t0 = g.turn, res = g.launchStrike(es, 'nuclear', 1, 'army', cell);
        T.eq(res.result, 'hit', res.text);
        T.ok(/bomba nuclear/.test(res.text) && /tus ejércitos pierden 5 unidades/.test(res.text), `parte: ${res.text}`);
        T.ok(!g.armies.has(foe.id), 'el ejército de la casilla, destruido');
        T.eq([countUnits(near.units), countUnits(edge.units), countUnits(mine.units), countUnits(out.units)], [10, 4, 5, 20], 'la mitad en el radio, también lo propio; fuera, nada');
        T.eq(g.dev[G.prov[cell]], 0, 'desarrollo de la provincia a 0');
        T.eq([g.isPariah(es), g.nations[es].pariahUntil, g.nations[es].arsenal.nuclear], [true, t0 + 30, 1], 'paria 30 turnos; gasta una');
        T.ok(g.motion.some(e => e.kind === 'strike' && e.weapon === 'nuclear' && e.cell === cell), 'evento para la animación');
        // También contra una casilla sin ejército (blanco «area»), y solo en guerra.
        const empty = ring(R)[1];
        T.eq(g.strikeCheck(es, 'nuclear', 1, 'area', empty), '', 'casilla enemiga');
        T.ok(/guerra/.test(g.strikeCheck(es, 'nuclear', 1, 'area', T.clear(g, T.nation('it'), 0))), 'no contra quien está en paz');
        // Con las nucleares prohibidas no se lanza aunque se tenga.
        const h = T.game(7, false, false);
        h.start(es); T.bare(h); h.declareWar(es, fr); T.learn(h, es, 'estrategicas3'); h.nations[es].arsenal.nuclear = 1;
        T.ok(/prohibidas/.test(h.strikeCheck(es, 'nuclear', 1, 'area', T.clear(h, fr, 0))), 'prohibidas');
        return true;
    }],
    ['C4 · instalaciones, aeródromos, enjambres y carreteras del radio', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr'), R = kmCells(40);
        g.start(es); T.bare(g); T.noIntegrated(g); g.declareWar(es, fr); T.learn(g, es, 'estrategicas3');
        // Una ciudad de Francia con todo alrededor en tierra francesa (sin lagos): el blanco, sin ejércitos cerca.
        const city = PROVINCES.map(p => p.city).find(c => g.owner[c] === fr && c !== g.nations[fr].capitalCell
            && hexDisc(c, R + 1).every(j => isLand(j) && g.owner[j] === fr && CELL_TERRAIN[j] !== 'lake'));
        T.ok(city !== undefined, 'ciudad francesa de interior');
        for (const j of hexDisc(city, R + 1)) if (g.armyOn(j)) g.removeArmy(g.armyOn(j));
        const ring = d => hexDisc(city, d).filter(c => hexDist(c, city) === d);
        const [a1, a2, a3] = ring(1), b1 = ring(R)[0], o1 = ring(R + 1)[0];
        T.airfield(g, fr, a1); const sqs = T.squad(g, fr, a1, 2);
        T.site(g, fr, a2); T.battery(g, fr, a3); const sws = T.swarm(g, fr, city, 2);
        g.fort[city] = 3; g.fort[b1] = 2; g.fortVersion++;
        const d = [0, 1, 2, 3, 4, 5].find(k => G.nb[city * 6 + k] === a1);
        g.road[city * 6 + d] = 1; g.road[a1 * 6 + (d + 3) % 6] = 1; g.roadVersion++;
        // Fuera del radio, todo sigue.
        T.airfield(g, fr, o1); const kept = T.squad(g, fr, o1)[0]; T.site(g, fr, o1);
        g.dev[G.prov[city]] = 500; g.devVersion++;
        g.nations[es].arsenal.nuclear = 1;
        T.luck(g, 0.99);   // ninguna defensa la para
        const res = g.launchStrike(es, 'nuclear', 1, 'area', city);
        T.eq(res.result, 'hit', res.text);
        T.ok(!g.airfields.has(a1) && sqs.every(q => !g.squadrons.has(q.id)), 'aeródromo y escuadrones');
        T.ok(!g.aaSites.has(a2) && !g.batteries.has(a3), 'antiaéreo y batería');
        T.ok(sws.every(q => !g.swarms.has(q.id)), 'enjambres');
        T.eq([g.fort[city], g.fort[b1]], [0, 0], 'fortificaciones');
        T.eq([g.road[city * 6 + d], g.broken[city * 6 + d]], [0, 1], 'carretera rota');
        T.ok(g.airfields.has(o1) && g.squadrons.has(kept.id) && g.aaSites.has(o1), 'fuera del radio, intacto');
        T.eq(g.dev[G.prov[city]], 0, 'desarrollo a 0');
        T.ok(/aeródromo/.test(res.text) && /enjambres/.test(res.text), `parte: ${res.text}`);
        return true;
    }],
    ['C4 · contaminación 15 turnos: sin renta y −10 % al que termina en ella', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr'), R = kmCells(40);
        g.start(es); T.bare(g); T.noIntegrated(g); g.declareWar(es, fr); T.learn(g, es, 'estrategicas3');
        const cell = T.clear(g, fr, R + 1), zone = hexDisc(cell, R).filter(c => isLand(c)), outside = hexDisc(cell, R + 1).find(c => hexDist(c, cell) === R + 1);
        const before = g.economy(fr), value = zone.reduce((s, c) => s + CELL_VALUE[c], 0);
        g.nations[es].arsenal.nuclear = 1;
        const t0 = g.turn;
        g.launchStrike(es, 'nuclear', 1, 'area', cell);
        T.ok(zone.every(c => g.contaminated(c)) && !g.contaminated(outside), 'contamina el radio');
        T.near(before.base - g.economy(fr).base, value, 1.01, 'las casillas contaminadas no dan renta');
        // Pierde el 10 % (al menos una) el ejército que termina el turno de su dueño en ella; los demás, no.
        const spots = zone.filter(c => c !== cell);
        const a = T.army(g, fr, spots[0], 20), b = T.army(g, es, spots[1], 20), c = T.army(g, fr, spots[2], 3);
        g.beginNationTurn(fr);
        T.eq([countUnits(a.units), countUnits(b.units), countUnits(c.units)], [18, 20, 2], '−10 % al de Francia');
        g.beginNationTurn(es);
        T.eq(countUnits(b.units), 18, 'y al de España en su turno');
        T.ok(g.logs.some(l => /contaminación/.test(l.msg) && /pierde 2 unidades/.test(l.msg)), 'el parte lo dice');
        // Quince turnos: el 14.º sigue; al empezar el 15.º, se acaba.
        g.turn = t0 + 14;
        T.ok(g.contaminated(cell), 'sigue el turno 14');
        g.turn = t0 + 15;
        g.beginNationTurn(fr);
        T.ok(!g.contaminated(cell) && g.fallout.size === 0, 'se acaba a los 15');
        T.eq(countUnits(a.units), 18, 'sin contaminación, sin desgaste');
        T.near(g.economy(fr).base, before.base, 1.01, 'vuelve la renta');
        return true;
    }],
    ['C4 · paria 30 turnos: sin paz ni alianzas y aliados que se van', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr'), it = T.nation('it');
        g.start(es); T.bare(g); T.noIntegrated(g); g.declareWar(es, fr); T.learn(g, es, 'estrategicas3');
        // Diez aliados de España: cada uno deja el bloque con un 50 %.
        const allies = ['pt', 'it', 'de', 'nl', 'be', 'pl', 'at', 'ch', 'cz', 'dk'].map(T.nation).filter(i => i >= 0);
        T.eq(allies.length, 10, 'aliados');
        const bloc = g.createBloc(es, 'Pacto de prueba', false);
        for (const x of allies) bloc.members.add(x);
        g.blocsChanged();
        g.nations[es].arsenal.nuclear = 1;
        g.launchStrike(es, 'nuclear', 1, 'area', T.clear(g, fr, 0));
        const left = allies.filter(x => !bloc.members.has(x)).length;
        T.ok(left >= 2 && left <= 8, `se van ${left} de 10`);
        T.ok(g.logs.some(l => /sale de Pacto de prueba tras el ataque nuclear/.test(l.msg)), 'el registro lo dice');
        T.ok(g.logs.some(l => /Eres un paria nuclear hasta el turno/.test(l.msg)), 'aviso al jugador');
        T.luck(g, 0);   // sin el paria, aceptarían alianzas y admisiones
        // Una guerra muy larga: sin el paria, ya querría la paz («dura ya demasiado»).
        g.turn += 100;
        g.nations[es].pariahUntil = g.turn + 30;
        const w = g.peaceWish(fr, es);
        T.eq(w.wants, false, 'nadie firma la paz con el paria');
        T.ok(/eres un paria nuclear/.test(w.blocker), `motivo: ${w.blocker}`);
        T.ok(/paria nuclear/.test(g.warBrief(fr).accept), `cajón: ${g.warBrief(fr).accept}`);
        g.settings.fog = true;
        T.ok(/paria nuclear/.test(g.warBrief(fr).accept), `cajón con niebla: ${g.warBrief(fr).accept}`);
        T.eq(g.acceptsPeace(fr, { mode: 'annex' }, true), false, 'ni la que propuso');
        T.eq(g.playerPeace(fr, { mode: 'annex' }), false, 'rechaza');
        T.ok(/paria nuclear/.test(g.logs[g.logs.length - 1].msg), `parte: ${g.logs[g.logs.length - 1].msg}`);
        // Ni alianzas: ni le aceptan ni le admiten.
        T.eq(g.acceptsBloc(it, null, es), false, 'no entra con él');
        const mine = g.playerCreateBloc('Solo', false);
        g.playerInvite(mine.id, it);
        T.ok(/paria nuclear/.test(g.logs[g.logs.length - 1].msg), `invitación: ${g.logs[g.logs.length - 1].msg}`);
        const other = g.createBloc(it, 'Ajeno', false); other.members.add(T.nation('de')); g.blocsChanged();
        T.eq(g.admits(other, es), false, 'no le admiten');
        // Pasados los 30 turnos, la guerra larga termina por las reglas de siempre: no hay guerras eternas.
        g.turn = g.nations[es].pariahUntil;
        T.eq([g.isPariah(es), g.peaceWish(fr, es).wants], [false, true], 'tras el paria, la paz de siempre');
        // Entre dos IA: Alemania declara la guerra al paria con ×0,6 de la warRatio y no firma la paz con él.
        for (const paria of [true, false]) {
            const h = T.game(), de = T.nation('de');
            h.start(es); h.turn = 20;
            T.ok(h.borderSets()[de].has(fr), 'Alemania y Francia vecinas');
            if (paria) h.makePariah(fr);
            const powers = h.powers().map(() => 1e9);
            powers[de] = 100; powers[fr] = 100 / (0.8 * h.ai.warRatio);   // ni ×1 ni ×0,6: en medio
            T.luck(h, 0);
            h.aiDiplomacy(de, powers);
            T.eq(h.atWar(de, fr), paria, paria ? 'declara al paria' : 'sin paria, no');
            if (!paria) continue;
            const r = h.rel(de, fr); r.since = r.war.since = h.turn - 100;
            T.eq(h.peaceWish(de, fr).wants, false, 'la IA no firma la paz con él');
            T.eq([h.acceptsBloc(it, null, fr), h.acceptsBloc(fr, null, it)], [false, false], 'ni alianzas, en ningún sentido');
            h.turn = h.nations[fr].pariahUntil;
            T.eq(h.peaceWish(de, fr).wants, true, 'después, sí');
        }
        return true;
    }],
    ['C4 · la IA solo la usa perdiendo', () => {
        const setup = (nukes = true) => {
            const g = T.game(7, false, nukes), es = T.nation('es'), fr = T.nation('fr');
            g.start(es); T.bare(g); T.noIntegrated(g); g.declareWar(es, fr);
            T.learn(g, fr, 'estrategicas3');
            g.nations[fr].arsenal.nuclear = 1;
            return { g, es, fr, cap: g.nations[fr].capitalCell };
        };
        const { g, es, fr, cap } = setup();
        // Ejércitos de España dentro de Francia, lejos de París: no basta.
        const deep = G.land.filter(c => g.owner[c] === fr && CITY_OF[c] < 0 && !g.armyAt[c] && hexDist(c, cap) > 4 && CELL_TERRAIN[c] !== 'lake');
        const big = T.army(g, es, deep[0], 60), small = T.army(g, es, deep[deep.length - 1], 30);
        T.eq(g.nukeLosing(fr), false, 'aún no pierde de verdad');
        g.aiNukes(fr);
        T.eq([g.nations[fr].arsenal.nuclear, g.isPariah(fr)], [1, false], 'no la usa');
        // Con un enemigo al lado de la capital, sí: contra el mayor ejército enemigo en su territorio.
        const nb = hexDisc(cap, 1).find(c => c !== cap && isLand(c) && !g.armyAt[c]);
        T.army(g, es, nb, 5);
        T.eq(g.nukeLosing(fr), true, 'capital con enemigo al lado');
        T.eq(g.nukeTarget(fr), big.cell, 'el mayor');
        g.aiStep(fr);   // en su turno
        T.eq([g.nations[fr].arsenal.nuclear, g.isPariah(fr), g.armies.has(big.id), g.armies.has(small.id)], [0, true, false, true], 'la usa');
        T.ok(g.logs.some(l => /Francia lanza una bomba nuclear/.test(l.msg)), 'el jugador se entera');
        // Prohibidas: nunca.
        const p = setup(false);
        T.army(p.g, p.es, hexDisc(p.cap, 1).find(c => c !== p.cap && isLand(c) && !p.g.armyAt[c]), 50);
        p.g.aiNukes(p.fr);
        T.eq(p.g.nations[p.fr].arsenal.nuclear, 1, 'prohibidas: no');
        // El 40 % de sus provincias de partida perdidas en una guerra en curso.
        const q = setup(), lost = Math.ceil(0.4 * START_PROVINCES[q.fr]);
        const far = PROVINCES.filter(x => q.g.owner[x.city] === q.fr && hexDist(x.city, q.cap) > 2).map(x => x.city);
        T.ok(far.length >= lost, 'provincias');
        for (const c of far.slice(0, lost - 1)) q.g.owner[c] = q.es;
        q.g.version++;
        T.eq(q.g.nukeLosing(q.fr), false, `${lost - 1} de ${START_PROVINCES[q.fr]}: no`);
        q.g.owner[far[lost - 1]] = q.es; q.g.version++;
        T.eq(q.g.nukeLosing(q.fr), true, `${lost} de ${START_PROVINCES[q.fr]}: sí`);
        // Comprar: rica (tercio alto de renta) y en guerra con alguien más fuerte.
        const b = setup();
        b.g.nations[b.fr].arsenal.nuclear = 0;
        const price = b.g.weaponPrice(b.fr, 'nuclear');
        b.g.nations[b.fr].gold = price;
        T.ok(b.g.nukeRich(b.fr), 'Francia, en el tercio alto');
        T.army(b.g, b.fr, T.clear(b.g, b.fr, 0), 3000);   // más fuerte que España: no compra
        b.g.aiNukes(b.fr);
        T.eq(b.g.nations[b.fr].arsenal.nuclear, 0, 'contra uno más débil, no compra');
        T.army(b.g, b.es, T.clear(b.g, b.es, 0), 9000);   // ahora España es más fuerte
        b.g.aiNukes(b.fr);
        T.eq([b.g.nations[b.fr].arsenal.nuclear, b.g.nations[b.fr].gold], [1, 0], 'compra una');
        // La más pobre no compra, aunque pueda pagarla.
        const poor = b.g.nations.filter(n => n.alive && n.id !== b.es).sort((x, y) => b.g.grossIncome(x.id) - b.g.grossIncome(y.id))[0].id;
        T.eq(b.g.nukeRich(poor), false, 'la más pobre no es rica');
        T.learn(b.g, poor, 'estrategicas3'); b.g.declareWar(b.es, poor); b.g.nations[poor].gold = 1e6;
        b.g.aiNukes(poor);
        T.eq(b.g.nations[poor].arsenal.nuclear, 0, 'la pobre no compra');
        return true;
    }],
    ['C4 · guardar y cargar contaminación y paria', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); T.bare(g); T.noIntegrated(g); g.declareWar(es, fr); T.learn(g, es, 'estrategicas3');
        g.nations[es].arsenal.nuclear = 1;
        g.launchStrike(es, 'nuclear', 1, 'area', T.clear(g, fr, 3));
        const data = JSON.parse(JSON.stringify(g.serialize())), h = GameEngine.load(data);
        T.ok(g.fallout.size > 0, 'hay contaminación');
        T.eq([...h.fallout], [...g.fallout], 'contaminación');
        T.eq([h.nations[es].pariahUntil, h.isPariah(es)], [g.nations[es].pariahUntil, true], 'paria');
        T.eq(h.economy(fr).base, g.economy(fr).base, 'la renta, igual');
        // Partida vieja: sin contaminación ni parias.
        const old = JSON.parse(JSON.stringify(data));
        delete old.fallout;
        for (const n of old.nations) delete n.pariahUntil;
        const o = GameEngine.load(old);
        T.eq([o.fallout.size, o.isPariah(es), o.nations[es].pariahUntil], [0, false, 0], 'partida vieja');
        // Datos raros: fuera.
        const bad = JSON.parse(JSON.stringify(data)), sea = G.landless?.[0] ?? [...Array(G.N).keys()].find(c => !isLand(c));
        bad.fallout = [[-5, 99], [sea, 99], [G.land[0], 'x'], 'zz', [G.land[1], g.turn - 1], [G.land[2], 1e9]];
        bad.nations[es].pariahUntil = -7;
        const b = GameEngine.load(bad);
        T.eq([...b.fallout], [[G.land[2], 1e6]], 'solo lo válido');
        T.eq(b.nations[es].pariahUntil, 0, 'paria no válido');
        return true;
    }],
    ['C6 · la IA rica en guerra compra y lanza contra el antiaéreo de su camino', () => {
        const g = T.game(7, true), es = T.nation('es'), fr = T.nation('fr'), pt = T.nation('pt');
        g.start(pt); T.bare(g); T.noIntegrated(g); g.declareWar(es, fr);
        T.learn(g, es, 'cohete2'); T.learn(g, fr, 'defensa1');
        const n = g.nations[es];
        n.gold = 1e5;
        T.ok(g.grossIncome(es) >= 100, `España no es pobre: ${g.grossIncome(es)}`);
        // Una ofensiva de España con dos escuadrones de un aeródromo propio; su camino pasa por tierra francesa.
        const [b, t] = T.pair(g, es, fr, (x, y) => flightPath(x, y).filter(c => isLand(c) && g.owner[c] === fr && CITY_OF[c] < 0 && !g.armyAt[c]).length >= 3);
        T.airfield(g, es, b);
        const op = g.createOp(es, 'ofensiva', [b, t], { auto: 'auto', noCap: true });
        for (const q of T.squad(g, es, b, 2)) g.assignSquadron(q, op.id);
        const lane = flightPath(b, t).filter(c => isLand(c) && g.owner[c] === fr && CITY_OF[c] < 0 && !g.armyAt[c]);
        // En el camino: un antiaéreo y una batería que conoce, y otro antiaéreo que no conoce.
        const site = T.site(g, fr, lane[0]), hidden = T.site(g, fr, lane[1]), bat = T.battery(g, fr, lane[2]);
        site.known.add(es); bat.known.add(es);
        T.eq(g.aiStrikeTargets(es, ['missile']).filter(x => lane.includes(x.cell)).map(x => [x.kind, x.cell]), [['aa', lane[0]], ['battery', lane[2]]], 'blancos: el antiaéreo y la batería que conoce');
        const gold = n.gold, price = g.weaponPrice(es, 'missile'), moves = g.motion.length;
        T.luck(g, 0.99);
        g.aiStrikes(es);
        const shots = g.motion.slice(moves).filter(e => e.kind === 'strike');
        T.eq(shots.map(e => [e.owner, e.weapon, e.cell]), [[es, 'missile', lane[0]], [es, 'missile', lane[2]]], 'lanza contra los dos');
        T.eq([g.aaSites.has(lane[0]), g.batteries.has(lane[2]), g.aaSites.get(lane[1]) === hidden], [false, false, true], 'destruye lo que conoce');
        T.eq([n.arsenal.missile, n.gold], [0, gold - 2 * price], 'compra lo justo');
        T.eq(n.lastStrike, g.turn, 'queda a la vista que ha lanzado');
        // Sin guerra no lanza.
        const h = T.game();
        h.start(pt); T.bare(h); T.learn(h, es, 'cohete2'); h.nations[es].gold = 1e5;
        T.airfield(h, es, b);
        const op2 = h.createOp(es, 'ofensiva', [b, t], { auto: 'auto', noCap: true });
        for (const q of T.squad(h, es, b, 2)) h.assignSquadron(q, op2.id);
        T.site(h, fr, lane[0]).known.add(es);
        const m2 = h.motion.length;
        h.aiStrikes(es);
        T.eq([h.motion.length, h.nations[es].gold], [m2, 1e5], 'en paz, nada');
        return true;
    }],
    ['C6 · la IA pobre no gasta en arsenal', () => {
        const g = T.game(), pt = T.nation('pt');
        g.start(pt); T.bare(g); T.noIntegrated(g);
        // El país más pobre con vecino por tierra y capital con tierra libre alrededor.
        const free = c => isLand(c) && !g.armyAt[c] && CITY_OF[c] < 0 && CELL_TERRAIN[c] !== 'lake';
        const poor = g.nations.filter(x => x.alive && x.id !== pt && g.borderSets()[x.id].size && hexDisc(x.capitalCell, 1).filter(free).length >= 2)
            .sort((x, y) => g.grossIncome(x.id) - g.grossIncome(y.id))[0].id;
        const foe = [...g.borderSets()[poor]].find(o => o !== pt);
        T.ok(g.grossIncome(poor) < 100, `es pobre: ${g.grossIncome(poor)}`);
        g.declareWar(poor, foe); T.learn(g, poor, 'cohete1', 'cohete2');
        const n = g.nations[poor];
        n.gold = 1e6;
        // Un ejército enemigo enorme junto a su capital y uno suyo al lado, desde el que llegan los cohetes.
        const [c1, c2] = hexDisc(n.capitalCell, 1).filter(free);
        T.army(g, foe, c1, 300); T.army(g, poor, c2, 5);
        const moves = g.motion.length;
        g.aiStrikes(poor);
        g.aiRecruit(poor);
        T.eq([g.motion.slice(moves).filter(e => e.kind === 'strike').length, n.armsFund, WEAPON_KEYS.every(k => !n.arsenal[k])], [0, 0, true], 'ni compra, ni lanza, ni aparta');
        // Con renta de rico, el mismo blanco sí.
        g.grossIncome = () => 1000;
        n.gold = 1e6;
        g.aiStrikes(poor);
        T.ok(g.motion.slice(moves).some(e => e.kind === 'strike' && e.owner === poor && e.cell === c1), 'rico, lanza');
        return true;
    }],
    ['C6 · aparta para la salva solo si la reúne pronto, y la compra con lo apartado', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr'), pt = T.nation('pt');
        g.start(pt); T.bare(g); T.noIntegrated(g); g.declareWar(es, fr); T.learn(g, es, 'cohete2');
        const [b, t] = T.pair(g, es, fr, (x, y) => flightPath(x, y).some(c => isLand(c) && g.owner[c] === fr && CITY_OF[c] < 0 && !g.armyAt[c]));
        T.airfield(g, es, b);
        const op = g.createOp(es, 'ofensiva', [b, t], { auto: 'auto', noCap: true });
        for (const q of T.squad(g, es, b, 2)) g.assignSquadron(q, op.id);
        const cell = flightPath(b, t).find(c => isLand(c) && g.owner[c] === fr && CITY_OF[c] < 0 && !g.armyAt[c]);
        T.site(g, fr, cell).known.add(es);
        const n = g.nations[es], price = g.weaponPrice(es, 'missile'), inc = g.income(es), step = Math.round(AI_ARMS_SHARE * inc);
        T.luck(g, 0.99);
        // Un misil son 4 turnos de renta: al 25 % no lo reúne en 6 turnos, así que no aparta.
        T.ok(price > AI_ARMS_SAVE * AI_ARMS_SHARE * inc, 'el misil no se reúne en 6 turnos');
        n.gold = price;
        g.aiStrikes(es); g.aiRecruit(es);
        T.eq([n.armsFund, g.aaSites.has(cell)], [0, true], 'no aparta ni compra');
        // Con parte ya apartada, lo que falta sí se reúne pronto: aparta cada turno hasta tenerlo, y lo compra.
        const start = price - 2 * step - 1;
        n.armsFund = start;
        let turns = 0;
        while (g.aaSites.has(cell) && turns < 10) {
            n.gold = price;
            g.aiStrikes(es);
            if (!g.aaSites.has(cell)) break;
            g.aiRecruit(es);
            turns++;
            T.eq(n.armsFund, Math.min(price, start + turns * step), `apartado tras ${turns} turnos`);
            T.ok(n.gold >= n.armsFund, 'no recluta con lo apartado');
        }
        T.eq(turns, 3, 'turnos que tarda');
        T.eq([g.aaSites.has(cell), n.armsFund, n.arsenal.missile], [false, 0, 0], 'lo compra con lo apartado y lo lanza');
        // Lo apartado se guarda AI_ARMS_KEEP turnos sin un blanco así y luego vuelve a las tropas.
        g.turn++; g.aiStrikes(es); g.aiRecruit(es);
        T.eq(n.armsFund, 0, 'sin blanco, nada');
        n.armsFund = 500; g.armsSave.set(es, { turn: g.turn, cap: price });
        g.turn += AI_ARMS_KEEP; n.gold = 1e4;
        g.aiStrikes(es); g.aiRecruit(es);
        T.eq(n.armsFund, 500, `guardado ${AI_ARMS_KEEP} turnos`);
        g.turn++; g.aiStrikes(es); g.aiRecruit(es);
        T.eq(n.armsFund, 0, 'vuelve a las tropas');
        return true;
    }],
    ['C6 · fortificación del objetivo de su ofensiva y ejércitos grandes junto a sus ciudades', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr'), pt = T.nation('pt');
        g.start(pt); T.bare(g); T.noIntegrated(g); g.declareWar(es, fr); T.learn(g, es, 'cohete2');
        g.nations[es].gold = 1e6;
        const [b, t] = T.pair(g, es, fr);
        const op = g.createOp(es, 'ofensiva', [b, t], { auto: 'auto', noCap: true });
        g.fort[t] = 2; g.fortVersion++;
        // Un ejército francés enorme a 2 casillas de una ciudad española, y otro pequeño.
        const esCities = PROVINCES.filter(p => g.owner[p.city] === es).map(p => p.city);
        const near = G.land.filter(c => g.owner[c] === fr && T.free(g, c) && CELL_TERRAIN[c] !== 'lake' && esCities.some(x => hexDist(x, c) <= 2));
        T.ok(near.length >= 2, 'tierra francesa junto a una ciudad española');
        T.army(g, fr, near[0], 300); T.army(g, fr, near[1], 3);
        const kinds = () => g.aiStrikeTargets(es, ['missile']).map(x => [x.kind, x.cell]);
        T.eq(kinds().filter(([k, c]) => c === t || c === near[0] || c === near[1]), [['army', near[0]]], 'la ofensiva aún se reúne: solo el ejército grande');
        op.phase = 'avance';
        T.eq(kinds().filter(([k, c]) => c === t || c === near[0] || c === near[1]), [['fort', t], ['army', near[0]]], 'en marcha: primero la fortificación');
        T.luck(g, 0.99);
        const moves = g.motion.length, units = countUnits(g.armyOn(near[0]).units);
        g.aiStrikes(es);
        const shots = g.motion.slice(moves).filter(e => e.kind === 'strike').map(e => e.cell);
        T.eq(shots, [t, near[0]], 'lanza contra los dos');
        T.ok(g.fort[t] < 2 && countUnits(g.armyOn(near[0]).units) < units, 'baja la fortificación y causa bajas');
        return true;
    }],
    ['C6 · cohetes contra una división junto a sus ciudades o en el objetivo de su ofensiva', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr'), pt = T.nation('pt');
        g.start(pt); T.bare(g); T.noIntegrated(g); g.declareWar(es, fr);
        T.noArmies(g, es); T.noArmies(g, fr);
        const n = g.nations[es];
        n.gold = 1e5;
        // Junto a una ciudad española, una división francesa (30) y una brigada (20); un ejército español a tiro de cohete.
        const esCities = PROVINCES.filter(p => g.owner[p.city] === es).map(p => p.city);
        const near = G.land.filter(c => g.owner[c] === fr && T.free(g, c) && CELL_TERRAIN[c] !== 'lake' && esCities.some(x => hexDist(x, c) <= 2));
        T.army(g, fr, near[0], 30); T.army(g, fr, near[1], 20);
        const own = G.land.find(c => g.owner[c] === es && T.free(g, c) && hexDist(c, near[0]) <= kmCells(80) && hexDist(c, near[0]) >= 1);
        T.army(g, es, own, 3);
        // Y otra división en el objetivo de una ofensiva española, lejos de sus ciudades.
        const obj = PROVINCES.filter(p => g.owner[p.city] === fr && esCities.every(x => hexDist(x, p.city) > AI_STRIKE_NEAR + 1) && !g.armyAt[p.city]).map(p => p.city)[0];
        T.army(g, fr, obj, 40);
        const op = g.createOp(es, 'ofensiva', [esCities[0], obj], { auto: 'auto', noCap: true });
        const armies = () => g.aiStrikeTargets(es, ['rocket']).filter(x => x.kind === 'army').map(x => x.cell);
        T.eq(armies().filter(c => [near[0], near[1], obj].includes(c)), [near[0]], 'la división junto a la ciudad; la brigada no; la ofensiva aún se reúne');
        op.phase = 'avance';
        T.eq(armies().filter(c => [near[0], near[1], obj].includes(c)), [obj, near[0]], 'en marcha, también la del objetivo (la mayor, antes)');
        // Sin investigar nada, con cohetes: el ejército del objetivo no tiene lanzador a tiro; la división junto a la ciudad, sí.
        T.luck(g, 0.99);
        const moves = g.motion.length, units = countUnits(g.armyOn(near[0]).units);
        g.aiStrikes(es);
        const shots = g.motion.slice(moves).filter(e => e.kind === 'strike');
        T.eq(shots.map(e => [e.weapon, e.cell, e.from]), [['rocket', near[0], own]], 'una salva de cohetes desde su ejército');
        T.ok(countUnits(g.armyOn(near[0]).units) < units, 'causa bajas');
        T.eq(g.armyOn(own).rocketTurn, g.turn, 'el ejército gasta su salva');
        return true;
    }],
    ['C6 · aparta para la bomba solo si la reúne pronto y mientras lo necesite; nunca prohibidas', () => {
        const setup = (nukes = true) => {
            const g = T.game(7, false, nukes), es = T.nation('es'), fr = T.nation('fr'), pt = T.nation('pt');
            g.start(pt); T.bare(g); g.declareWar(es, fr);
            T.army(g, es, T.clear(g, es, 0), 9000);   // España, mucho más fuerte
            return { g, es, fr, n: g.nations[fr] };
        };
        const { g, es, fr, n } = setup();
        T.ok(g.rules(fr).nuclear && g.nukeRich(fr), 'Francia: la bomba y rica');
        const price = g.weaponPrice(fr, 'nuclear'), inc = g.income(fr), step = Math.round(AI_ARMS_SHARE * inc);
        // 25 turnos de renta: desde cero no la reúne en 6 al 25 %, así que no aparta.
        n.gold = 0;
        g.aiNukes(fr); g.aiRecruit(fr);
        T.eq(n.nukeFund, 0, 'desde cero, no');
        // Con casi todo apartado, sí: aparta lo suyo y nada para otras armas.
        n.nukeFund = price - 3 * step;
        g.aiNukes(fr); g.aiRecruit(fr);
        T.eq([n.nukeFund, n.armsFund], [price - 2 * step, 0], 'aparta para la bomba');
        // En paz deja de necesitarla: lo apartado vuelve a las tropas.
        g.settlePeace(es, fr);
        g.aiNukes(fr);
        T.eq(n.nukeFund, 0, 'en paz, suelta lo apartado');
        // En guerra con uno más débil que la tiene al lado de la capital (pierde de verdad), también aparta.
        const h = T.game(), m = h.nations[fr], it = T.nation('it');
        h.start(T.nation('pt')); T.bare(h); h.declareWar(it, fr);
        const cap = m.capitalCell;
        T.army(h, it, hexDisc(cap, 1).find(c => c !== cap && isLand(c) && !h.armyAt[c]), 3);
        T.ok(h.nukeLosing(fr) && h.nukeRich(fr), 'pierde de verdad y es rica');
        m.gold = 0; m.nukeFund = h.weaponPrice(fr, 'nuclear') - step;
        h.aiNukes(fr); h.aiRecruit(fr);
        T.ok(m.nukeFund > h.weaponPrice(fr, 'nuclear') - step, 'perdiendo, aparta');
        m.gold = h.weaponPrice(fr, 'nuclear');
        h.aiNukes(fr);
        T.eq([m.arsenal.nuclear, m.nukeFund], [1, 0], 'la compra y lo apartado vuelve a 0');
        // Prohibidas: ni aparta.
        const p = setup(false);
        p.n.gold = 0; p.n.nukeFund = 500;
        p.g.aiNukes(p.fr); p.g.aiRecruit(p.fr);
        T.eq([p.n.nukeFund, p.n.arsenal.nuclear], [0, 0], 'prohibidas: nada');
        return true;
    }],
    ['C6 · baterías también contra un arsenal enemigo conocido', () => {
        const g = T.game(7, true), es = T.nation('es'), fr = T.nation('fr'), pt = T.nation('pt');
        g.start(pt); T.bare(g); g.declareWar(es, fr); T.learn(g, es, 'defensa1');
        const n = g.nations[es], foes = new Set([fr]), cities = g.citiesOf(es);
        n.gold = 1e5;
        g.aiBatteries(es, foes, cities);
        T.eq(g.batteries.size, 0, 'sin drones ni arsenal conocido, nada');
        // Francia guarda misiles, pero con niebla España no lo sabe.
        g.nations[fr].arsenal.missile = 3;
        T.eq(g.arsenalKnown(es, fr), false, 'con niebla no se ve el arsenal');
        g.aiBatteries(es, foes, cities);
        T.eq(g.batteries.size, 0, 'no lo sabe');
        // Ha lanzado hace poco: eso lo ve cualquiera.
        g.nations[fr].lastStrike = g.turn - 2;
        T.ok(g.arsenalKnown(es, fr), 'conocido al lanzar');
        g.aiBatteries(es, foes, cities);
        T.eq([...g.batteries.values()].map(b => b.owner), [es], 'construye una batería');
        g.nations[fr].lastStrike = g.turn - AI_ARMS_MEMORY - 1;
        T.eq(g.arsenalKnown(es, fr), false, 'y se olvida');
        return true;
    }],
    ['C6 · la IA no acaba el turno en una casilla contaminada si puede evitarlo', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr'), pt = T.nation('pt');
        g.start(pt); T.bare(g); g.declareWar(es, fr);
        // Un ejército libre sobre una casilla contaminada: sale de ella.
        const a = T.army(g, es, T.clear(g, es, 2), 3);
        g.fallout.set(a.cell, g.turn + 10); g.falloutVersion++;
        g.aiArmies(es);
        const mine = [...g.armies.values()].filter(x => x.owner === es);
        T.ok(!mine.some(x => g.contaminated(x.cell)), 'ningún ejército suyo en la contaminación');
        T.ok(!g.armies.has(a.id) || a.cell !== [...g.fallout.keys()][0], 'se ha movido');
        // Con una orden (como en sus operaciones): rodea la casilla contaminada si hay otro paso igual de bueno.
        const h = T.game();
        h.start(pt); T.bare(h); h.declareWar(es, fr);
        T.noArmies(h, es);
        const from = T.clear(h, es, 2), b = T.army(h, es, from, 2);
        const dest = G.land.filter(c => h.owner[c] === es && hexDist(c, from) === 6 && T.free(h, c)).sort((x, y) => x - y)[0];
        const copy = () => GameEngine.load(JSON.parse(JSON.stringify(h.serialize())));
        const pick = game => { const x = game.armyOn(from); game.advance(x, dest, game.reach(es, from, game.mp(x), true)); return x.cell; };
        const clean = pick(copy());
        T.ok(clean !== from, 'sin contaminación avanza');
        h.fallout.set(clean, h.turn + 10); h.falloutVersion++;
        const p = copy(), other = pick(h);
        T.ok(other !== from && other !== clean && !h.contaminated(other), `la evita: ${other}`);
        // El jugador decide en lo suyo: su ejército no se desvía.
        p.player = es;
        T.eq(pick(p), clean, 'el del jugador va por donde va');
        return true;
    }],
    ['C6 · la repetición de la IA espera a sus lanzamientos', async () => {
        const g = T.uiStart('es'), fr = T.nation('fr'), de = T.nation('de');
        T.bare(g); g.declareWar(fr, de); T.learn(g, fr, 'cohete2', 'defensa1'); T.learn(g, de, 'defensa1');
        const cell = T.clearWhere(g, de, 1, c => g.launchers(fr, 'missile', c).length);
        T.battery(g, de, cell).known.add(fr);
        g.nations[fr].arsenal.missile = 1;
        ui.prefs.watch = 'ver'; ui.prefs.speed = 'rapida';
        const motion = ui.view.motion, pending = motion.pendingMs;
        let waits = 0;
        motion.pendingMs = () => { waits++; return 0; };
        g.aiOrder = () => [fr];
        try {
            g.aiStep = id => { g.launchStrike(id, 'missile', 1, 'battery', cell); return true; };   // solo lanza: nada más cambia
            await ui.endTurnFlow();
            T.ok(!g.batteries.has(cell) || g.motion.some(e => e.kind === 'strike'), 'ha lanzado');
            T.ok(waits >= 1, 'espera a la animación');
            waits = 0;
            g.aiStep = () => true;   // quien no hace nada no hace esperar
            await ui.endTurnFlow();
            T.eq(waits, 0, 'sin nada, no espera');
        } finally { motion.pendingMs = pending; delete g.aiOrder; delete g.aiStep; }
        return true;
    }],
    ['C6 · guardar y cargar los fondos del arsenal', () => {
        const g = T.game(), es = T.nation('es');
        g.start(es);
        Object.assign(g.nations[es], { lastStrike: 3, armsFund: 700, nukeFund: 9000 });
        const data = JSON.parse(JSON.stringify(g.serialize())), h = GameEngine.load(data);
        T.eq([h.nations[es].lastStrike, h.nations[es].armsFund, h.nations[es].nukeFund], [3, 700, 9000], 'se guardan');
        for (const x of data.nations) { delete x.lastStrike; delete x.armsFund; delete x.nukeFund; }
        const o = GameEngine.load(data).nations[es];
        T.eq([o.lastStrike, o.armsFund, o.nukeFund], [0, 0, 0], 'partida vieja');
        data.nations[es].armsFund = -5; data.nations[es].nukeFund = 'x'; data.nations[es].lastStrike = 1e9;
        const b = GameEngine.load(data).nations[es];
        T.eq([b.lastStrike, b.armsFund, b.nukeFund], [1e6, 0, 0], 'no válidos: al rango o a 0');
        return true;
    }],
    ['C7 · tecla 7 abre la herramienta y lista el arsenal', () => {
        const g = T.uiStart('es'), es = g.player;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '7' }));
        T.eq(ui.tool, 'strike', 'herramienta');
        T.ok(document.querySelector('#tools [data-tool="strike"] svg'), 'botón con su símbolo');
        const card = document.querySelector('#card'), text = () => card.textContent;
        T.ok(!card.hidden && /Ataque a distancia/.test(text()) && /Arsenal/.test(text()), 'ficha con el arsenal');
        for (const k of WEAPON_KEYS) T.ok(card.querySelector(`[data-weapon="${k}"]`), `fila de ${k}`);
        // Precio, mantenimiento y alcance de cada una; las que faltan por investigar lo dicen.
        T.ok(text().includes(`${g.weaponPrice(es, 'rocket')} de oro`) && /5 por turno/.test(text()) && /80 km/.test(text()), 'precio, mantenimiento y alcance');
        T.ok(!card.querySelector('[data-action="strike-buy"][data-weapon="rocket"]').disabled, 'el cohete se puede comprar');
        T.ok(card.querySelector('[data-action="strike-buy"][data-weapon="missile"]').disabled && /Misiles balísticos tácticos/.test(text()), 'el misil pide su investigación');
        // Sin armas, nada que lanzar; con alguna, se elige sola.
        T.eq(ui.strike.weapon, null, 'nada elegido');
        g.nations[es].arsenal.rocket = 2; ui.render();
        T.ok(/2 en el arsenal|× ?2/.test(card.querySelector('[data-weapon="rocket"]').closest('.strike-w').textContent), 'existencias');
        // Con las nucleares prohibidas, la bomba no sale.
        g.settings.nukes = false; ui.render();
        T.ok(!card.querySelector('[data-weapon="nuclear"]'), 'prohibidas: sin bomba');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        T.eq(ui.tool, 'command', 'Esc la cierra');
        return true;
    }],
    ['C7 · comprar y lanzar con clic, con previsión', () => {
        const g = T.uiStart('es'), es = g.player, fr = T.nation('fr');
        g.declareWar(es, fr); T.bare(g); T.noIntegrated(g); T.noArmies(g, es);
        g.nations[es].gold = 1e5;
        const target = T.clear(g, fr, 6), foe = T.army(g, fr, target, 20);
        const near = T.army(g, es, hexDisc(target, 3).find(c => hexDist(c, target) === 3 && isLand(c) && !g.armyAt[c] && CITY_OF[c] < 0), 3);
        ui.setTool('strike');
        const $c = sel => document.querySelector(`#card ${sel}`), price = g.weaponPrice(es, 'rocket'), gold = g.nations[es].gold;
        for (let i = 0; i < 3; i++) $c('[data-action="strike-buy"][data-weapon="rocket"]').click();
        T.eq([g.nations[es].arsenal.rocket, g.nations[es].gold], [3, gold - 3 * price], 'compra tres');
        T.ok(g.logs.some(l => /Compras cohete/.test(l.msg)), 'en el parte');
        T.eq(ui.strike.weapon, 'rocket', 'elegido al comprarlo');
        $c('[data-action="strike-n"][data-delta="1"]').click();
        T.eq(ui.strike.n, 2, 'salva de dos');
        // El mapa enseña el alcance desde los lanzadores.
        const pick = ui.view.strikePick;
        T.ok(pick && pick.reach.has(target) && pick.reach.has(near.cell) && !pick.reach.has(T.clear(g, T.nation('de'), 0)), 'alcance desde el ejército');
        // Fuera de alcance: lo dice, sin lanzar.
        ui.clickCell(PROVINCES.find(p => g.owner[p.city] === fr && hexDist(p.city, near.cell) > 10).city);
        T.ok(/Fuera de alcance/.test($c('').textContent) && !$c('[data-action="strike-launch"]'), 'fuera de alcance');
        // Clic en el blanco: previsión y confirmar.
        ui.clickCell(target);
        const t = document.querySelector('#card').textContent;
        T.ok(/Desde tu ejército en/.test(t) && /lleguen/.test(t) && /bajas|unidades/.test(t), `previsión: ${t}`);
        T.eq([ui.view.strikePick.from, ui.view.strikePick.target], [near.cell, target], 'el mapa: del lanzador al blanco');
        T.eq(g.nations[es].arsenal.rocket, 3, 'aún no lanza');
        T.luck(g, 0.5);
        $c('[data-action="strike-launch"]').click();
        T.ok(countUnits(foe.units) < 20 && g.nations[es].arsenal.rocket === 1, 'lanzado');
        T.ok(g.logs.some(l => /Lanzas 2 cohetes/.test(l.msg)), 'en el parte');
        T.eq(ui.view.motion.strikes.length, 1, 'se anima');
        // El ejército ya ha lanzado su salva: la ficha lo dice.
        T.ok(/ya han lanzado/.test(document.querySelector('#card').textContent), 'una salva por turno');
        return true;
    }],
    ['C7 · la bomba pide confirmación con sus consecuencias', () => {
        const g = T.uiStart('es'), es = g.player, fr = T.nation('fr');
        g.declareWar(es, fr); T.bare(g); T.noIntegrated(g); T.learn(g, es, 'estrategicas3');
        g.nations[es].arsenal.nuclear = 1;
        const cell = T.clear(g, fr, 3), mine = T.army(g, es, hexDisc(cell, 1).find(c => c !== cell && isLand(c) && !g.armyAt[c]), 4);
        ui.setTool('strike');
        document.querySelector('#card [data-action="strike-weapon"][data-weapon="nuclear"]').click();
        ui.clickCell(cell);
        document.querySelector('#card [data-action="strike-launch"]').click();
        const t = document.querySelector('#card').textContent;
        T.eq(g.nations[es].arsenal.nuclear, 1, 'aún no');
        T.ok(/paria 30 turnos/.test(t) && /contaminada 15 turnos/.test(t) && /1 ejército tuyo/.test(t), `consecuencias: ${t}`);
        document.querySelector('#card [data-action="strike-nuke"]').click();
        T.eq([g.nations[es].arsenal.nuclear, g.isPariah(es), countUnits(mine.units)], [0, true, 2], 'lanzada');
        T.ok(g.fallout.size > 0 && ui.view.falloutZones().length === 1, 'zona contaminada');
        return true;
    }],
    ['C7 · el desglose de la renta muestra el mantenimiento', () => {
        const g = T.uiStart('es'), es = g.player;
        Object.assign(g.nations[es].arsenal, { rocket: 2, missile: 1 });
        ui.tab = 'paises'; ui.focusNation = es; ui.drawerOpen = true; ui.render();
        const t = document.querySelector('#drawer-body').textContent;
        T.ok(/Mantenimiento del arsenal\s*−30/.test(t), `mantenimiento: ${t}`);
        T.ok(/Arsenal\s*2 cohetes y 1 misil/.test(t), 'existencias en el resumen');
        T.ok(new RegExp(`Total\\s*${g.income(es)} de oro`).test(t), 'total neto');
        return true;
    }],
    ['C7 · Países enseña al paria y la tarjeta, la contaminación', () => {
        const g = T.uiStart('es'), fr = T.nation('fr');
        g.nations[fr].pariahUntil = g.turn + 6;
        ui.tab = 'paises'; ui.focusNation = null; ui.drawerOpen = true; ui.render();
        const row = document.querySelector(`#nation-list [data-action="nation"][data-id="${fr}"]`);
        T.ok(/paria/.test(row.textContent), 'en la lista');
        ui.focusNation = fr; ui.render();
        T.ok(new RegExp(`Paria nuclear\\s*hasta el turno ${g.turn + 5}`).test(document.querySelector('#drawer-body').textContent), 'en su resumen');
        const c = T.clear(g, fr, 2);
        g.fallout.set(c, g.turn + 7); g.falloutVersion++;
        T.ok(/Contaminada.*7 turnos/.test(T.hover(c)), `tarjeta: ${T.hover(c)}`);
        return true;
    }],
    ['C7 · el mapa anima la salva con sus intercepciones y dibuja la zona contaminada', () => {
        const g = T.uiStart('es'), es = g.player, fr = T.nation('fr');
        g.declareWar(es, fr);
        const [mine, theirs] = T.pair(g, es, fr);
        // Un lanzamiento de la IA (en la repetición): seis misiles, cuatro interceptados.
        ui.view.motion.clear();
        g.note({ kind: 'strike', owner: fr, from: theirs, cell: mine, weapon: 'missile', n: 6, through: 2 });
        ui.view.draw();
        const s = ui.view.motion.strikes.at(-1);
        T.ok(s, 'se anima');
        T.eq([s.arcs.length, s.arcs.filter(a => a.cut).length, s.cell, s.from], [6, 4, mine, theirs], 'arcos e interceptados');
        T.ok(ui.view.motion.pendingMs() > 0, 'la repetición espera a que acabe');
        // Una salva enorme se dibuja con unos pocos arcos, en proporción.
        g.note({ kind: 'strike', owner: fr, from: theirs, cell: mine, weapon: 'rocket', n: 40, through: 30 });
        ui.view.draw();
        const big = ui.view.motion.strikes.at(-1);
        T.ok(big.arcs.length <= 8 && big.arcs.some(a => a.cut) && big.arcs.some(a => !a.cut), 'en proporción');
        // La zona contaminada: una por zona, con los turnos que quedan.
        const c = T.clear(g, fr, 3);
        for (const j of hexDisc(c, 2)) if (isLand(j)) g.fallout.set(j, g.turn + 12);
        g.falloutVersion++;
        const z = ui.view.falloutZones();
        T.eq([z.length, z[0].left, z[0].cells.size], [1, 12, hexDisc(c, 2).filter(isLand).length], 'zona');
        g.turn += 12;
        T.eq(ui.view.falloutZones().length, 0, 'se acaba');
        return true;
    }],
    // --- Revisión final ---
    ['Revisión · lo apartado para la salva se libera también tras cargar la partida', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es);
        // Francia aparta 300 para una salva que quiso este turno; sin guerra, no vuelve a quererla: se libera a los
        // AI_ARMS_KEEP turnos, cargue o no la partida.
        g.nations[fr].armsFund = 300;
        (g.armsSave ??= new Map()).set(fr, { turn: g.turn, cap: 300 });
        const run = h => Array.from({ length: AI_ARMS_KEEP + 3 }, () => { h.turn++; h.aiStrikes(fr); h.aiRecruit(fr); return h.nations[fr].armsFund; });
        const data = JSON.parse(JSON.stringify(g.serialize()));
        const want = [...Array(AI_ARMS_KEEP).fill(300), 0, 0, 0];
        T.eq(run(GameEngine.load(JSON.parse(JSON.stringify(data)))), want, 'cargada');
        T.eq(run(g), want, 'sin cargar');
        // Una partida que no trae la cuenta: empieza al cargar, y también se libera.
        for (const x of data.nations) delete x.armsSave;
        const old = run(GameEngine.load(data));
        T.eq([old[0], old.at(-1)], [300, 0], `partida sin la cuenta: ${old}`);
        return true;
    }],
    ['Revisión · la invitación de un país que se vuelve paria se retira, y no se acepta la de un paria', () => {
        const g = T.game(), es = T.nation('es'), it = T.nation('it'), de = T.nation('de'), fr = T.nation('fr');
        g.start(es);
        const bl = g.createBloc(de, 'Pacto de prueba', false);
        bl.members.add(fr); g.blocsChanged();
        g.proposals.push({ kind: 'bloque', from: it, blocId: null }, { kind: 'bloque', from: de, blocId: bl.id }, { kind: 'paz', from: it });
        g.makePariah(it);
        T.eq(g.proposals.map(p => p.kind + p.from), ['bloque' + de, 'paz' + it], 'la de Italia se retira; la paz sigue');
        T.luck(g, 0.99);   // nadie deja el bloque
        g.makePariah(fr);
        T.eq(g.proposals.map(p => p.kind + p.from), ['paz' + it], 'la de un bloque con un paria, también');
        // Aunque estuviera en pie, aceptarla no alía con el paria.
        g.proposals.push({ kind: 'bloque', from: it, blocId: null });
        g.answerProposal(g.proposals.length - 1, true);
        T.eq(g.allied(es, it), false, 'sin alianza');
        T.ok(/paria nuclear/.test(g.logs.at(-1).msg), `parte: ${g.logs.at(-1).msg}`);
        return true;
    }],
    ['Revisión · la provincia contaminada no recupera desarrollo mientras dure', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr'), R = kmCells(40);
        g.start(es); T.bare(g); T.noIntegrated(g); g.declareWar(es, fr); T.learn(g, es, 'estrategicas3');
        const cell = T.clear(g, fr, R + 1), pid = G.prov[cell];
        const other = PROVINCES.find(p => g.owner[p.city] === fr && g.legal[p.city] === fr && hexDist(p.city, cell) > 2 * R + 2).id;
        g.nations[es].arsenal.nuclear = 1;
        const t0 = g.turn;
        g.launchStrike(es, 'nuclear', 1, 'area', cell);
        g.dev[other] = 0;
        T.eq(g.dev[pid], 0, 'arrasada');
        g.beginNationTurn(fr);
        T.eq([g.dev[pid], g.dev[other] > 0], [0, true], 'no crece; otra provincia sí');
        g.turn = t0 + NUKE.FALLOUT_TURNS;
        g.beginNationTurn(fr);
        T.ok(g.dev[pid] > 0, 'sin contaminación, vuelve a crecer');
        return true;
    }],
    ['Revisión · el misil pesado destruye el aeródromo con sus escuadrones; el misil lo deja inservible', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); T.bare(g); T.noIntegrated(g); g.declareWar(es, fr); T.learn(g, es, 'cohete3');
        const city = PROVINCES.map(p => p.city).find(c => g.owner[c] === fr && g.launchers(es, 'missile', c).length > 0);
        T.airfield(g, fr, city);
        const sqs = T.squad(g, fr, city, 2);
        Object.assign(g.nations[es].arsenal, { missile: 1, heavy: 1 });
        T.luck(g, 0.5);
        let res = g.launchStrike(es, 'missile', 1, 'airfield', city);
        T.ok(g.airfields.has(city) && !g.airfieldUp(city) && sqs.every(q => g.squadrons.has(q.id)), `misil: inservible: ${res.text}`);
        g.airfields.get(city).downUntil = 0;
        T.ok(/destruye con sus escuadrones/.test(g.strikeOdds(es, 'heavy', 1, 'airfield', city).effect), 'previsión');
        res = g.launchStrike(es, 'heavy', 1, 'airfield', city);
        T.ok(!g.airfields.has(city) && sqs.every(q => !g.squadrons.has(q.id)), `pesado: destruido: ${res.text}`);
        T.ok(/queda destruido con 2 escuadrones/.test(res.text), `parte: ${res.text}`);
        return true;
    }],
    ['Revisión · una partida de antes de las nucleares siembra a las potencias al cargar', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr'), S = ['estrategicas1', 'estrategicas2', NUKE_TECH];
        g.start(es);
        const data = JSON.parse(JSON.stringify(g.serialize()));
        // Como era: sin el ajuste ni la rama; Francia, a medias con la primera.
        delete data.settings.nukes;
        for (const x of data.nations) { x.tech.done = x.tech.done.filter(t => !S.includes(t)); x.tech.seeded = []; }
        data.nations[fr].tech.progress = [['estrategicas1', 1]]; data.nations[fr].tech.current = ['estrategicas1'];
        const h = GameEngine.load(JSON.parse(JSON.stringify(data))), t = h.nations[fr].tech;
        T.ok(S.every(x => t.done.has(x) && t.seeded.has(x)), 'Francia las tiene, sembradas');
        T.eq([t.progress.has('estrategicas1'), t.current], [false, []], 'sin lo que tenía a medias');
        T.eq(h.researchedCount(fr), 0, 'no encarecen');
        T.ok(!h.nations[es].tech.done.has('estrategicas1'), 'España, no');
        // Con el ajuste guardado (prohibidas o permitidas), no se toca.
        data.settings.nukes = false;
        T.ok(!GameEngine.load(JSON.parse(JSON.stringify(data))).nations[fr].tech.done.has(NUKE_TECH), 'prohibidas: nada');
        data.settings.nukes = true;
        T.ok(!GameEngine.load(data).nations[fr].tech.done.has(NUKE_TECH), 'partida nueva: lo guardado');
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
    // Capturas de una salva de misiles con intercepciones junto a una zona contaminada, en las dos vistas, y de la ficha
    // de la herramienta en el escritorio y en el móvil (para revisarlas a ojo).
    const SHOTS7 = 'C7 · capturas de la salva, la zona contaminada y la ficha';
    if (!filter || SHOTS7.includes(filter)) {
        ran++;
        const out = join(root, 'tools/cache/smoke'), errors = [];
        mkdirSync(out, { recursive: true });
        const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 });
        page.on('pageerror', e => errors.push(e.message));
        await page.goto(`http://localhost:${port}/?seed=7&mapa=europa`);
        await page.waitForFunction(() => typeof GameEngine === 'function' && typeof ui === 'object');
        await page.evaluate(setup);
        await page.evaluate(() => {
            const g = T.uiStart('es'), es = g.player, fr = T.nation('fr');
            g.declareWar(es, fr); T.bare(g); T.noIntegrated(g);
            T.learn(g, es, 'cohete1', 'cohete2'); T.learn(g, fr, 'defensa1', 'defensa2');
            g.nations[es].gold = 1e5; Object.assign(g.nations[es].arsenal, { rocket: 4, heavyRocket: 2, missile: 8 });
            // El blanco: un ejército francés a 5 casillas o más de una ciudad española cercana, con una batería y un
            // antiaéreo franceses al lado que conoces.
            const [mine] = T.pair(g, es, fr);
            const target = G.land.filter(c => g.owner[c] === fr && T.free(g, c) && hexDist(c, mine) >= 5 && CELL_TERRAIN[c] !== 'lake')
                .sort((a, b) => hexDist(a, mine) - hexDist(b, mine) || a - b)[0];
            T.army(g, fr, target, 30, 6, 4);
            const nbs = hexDisc(target, 1).filter(c => c !== target && isLand(c) && g.owner[c] === fr && CITY_OF[c] < 0);
            T.battery(g, fr, nbs[0]).known.add(es); T.site(g, fr, nbs[1]).known.add(es);
            // Y una zona contaminada a unas casillas, al otro lado del blanco.
            const zone = G.land.filter(c => g.owner[c] === fr && hexDist(c, target) === 6 && hexDist(c, mine) > hexDist(target, mine) + 3)[0];
            for (const j of hexDisc(zone, 2)) if (isLand(j)) g.fallout.set(j, g.turn + 12);
            g.falloutVersion++;
            const mid = G.cellAt((G.cx[mine] + G.cx[zone]) / 2, (G.cy[mine] + G.cy[zone]) / 2);
            window.SHOT = { mine, target, zone, mid };
            ui.view.setMode('sencilla');
            ui.setTool('strike');
            document.querySelector('#card [data-action="strike-weapon"][data-weapon="missile"]').click();
            ui.strike.n = 8; ui.clickCell(target);
        });
        await page.waitForFunction(() => ui.view.realistic.state === 'ready' || ui.view.realistic.state === 'failed', null, { timeout: 60000 });
        const card = async name => {
            await page.evaluate(() => new Promise(r => {
                ui.view.centerOn(SHOT.target, 12); ui.render();
                document.querySelector('#card [data-action="strike-launch"]')?.scrollIntoView({ block: 'center' });
                requestAnimationFrame(() => requestAnimationFrame(r));
            }));
            await page.waitForTimeout(300);
            const m = await page.evaluate(() => { const c = document.querySelector('#card'); return { over: c.scrollWidth - c.clientWidth, launch: !!c.querySelector('[data-action="strike-launch"]'), warn: /defensas que no conoces|pararían/.test(c.textContent) }; });
            if (m.over > 2 || !m.launch || !m.warn) errors.push(`${name}: ${JSON.stringify(m)}`);
            await page.screenshot({ path: join(out, `${name}.png`) });
        };
        await card('misiles-ficha');
        // Lanza la salva con la repetición muy lenta y la deja en el momento en que ya han caído o las han parado todas.
        const fired = await page.evaluate(() => {
            ui.view.motion.speed = 40;
            document.querySelector('#card [data-action="strike-launch"]').click();
            ui.view.motion.speed = 1;
            const t = ui.view.motion.strikes.at(-1);
            if (!t) return null;
            const dt = t.end - performance.now() + 200;
            for (const a of t.arcs) { a.start -= dt; a.end -= dt; }
            t.end -= dt;
            return { n: t.n, through: t.through, cut: t.arcs.filter(a => a.cut).length };
        });
        if (!fired || !fired.cut || fired.through === 0) errors.push(`la salva no tiene intercepciones y llegadas: ${JSON.stringify(fired)}`);
        const shot = async (name, mode) => {
            await page.evaluate(m => new Promise(r => {
                ui.setTool('command'); ui.select(-1); ui.view.setMode(m); ui.view.scale = 1; ui.view.centerOn(SHOT.mid, 24);
                ui.render(); ui.view.draw(); requestAnimationFrame(() => requestAnimationFrame(r));
            }), mode);
            await page.waitForTimeout(900);
            await page.screenshot({ path: join(out, `${name}.png`) });
        };
        await shot('misiles-sencilla', 'sencilla');
        await shot('misiles-realista', 'realista');
        // La ficha en el móvil, con el blanco elegido.
        await page.setViewportSize({ width: 390, height: 844 });
        await page.evaluate(() => {
            ui.game.nations[ui.game.player].arsenal.missile = 8;
            ui.view.setMode('sencilla'); ui.drawerOpen = false; ui.setSheet('media'); ui.setTool('strike');
            document.querySelector('#card [data-action="strike-weapon"][data-weapon="missile"]').click();
            ui.strike.n = 4; ui.clickCell(SHOT.target);
        });
        await card('misiles-ficha-movil');
        await page.close();
        if (errors.length) { failed++; console.log(`FALLA ${SHOTS7}\n      ${errors.join('\n      ')}`); }
        else console.log(`ok    ${SHOTS7} (${join(out, 'misiles-sencilla.png')}, misiles-realista.png, misiles-ficha.png, misiles-ficha-movil.png; salva ${JSON.stringify(fired)})`);
    }
    for (const page of pages.values()) if (page.errors.length) { failed++; console.log(`FALLA errores en la página:\n      ${page.errors.join('\n      ')}`); }
} finally {
    await browser.close();
    server.close();
}
console.log(`${ran - Math.min(failed, ran)}/${ran} pruebas superadas`);
process.exit(failed ? 1 : 0);
