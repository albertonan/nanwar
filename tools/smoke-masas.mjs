// Pruebas del mando de masas: plantillas sin tope, escalones mayores, oro de operaciones, mando por masas, drones y misiles.
// Mismo arnés que smoke-mando: sirve el juego por HTTP y comprueba las reglas una a una en la página.
// Uso: node basicmilitary/tools/smoke-masas.mjs [filtro]   (CHROME=<ruta> para usar otro navegador)
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
        // Casilla llana de `owner` (sin ciudad ni ejército, con sus vecinas de tierra suyas y libres) que pasa a `foe`, y
        // `k` vecinas suyas: las `river` primeras cruzando un río, las demás sin río. Con `sea`, también una vecina de mar
        // libre. Devuelve { target, sides, sea }.
        ring(g, owner, foe, k, { river = 0, sea = false, skip = 0 } = {}) {
            for (const c of G.land) {
                if (g.owner[c] !== owner || CELL_TERRAIN[c] !== 'plain' || !T.free(g, c)) continue;
                const nbs = [0, 1, 2, 3, 4, 5].map(d => G.nb[c * 6 + d]).filter(j => j >= 0);
                const land = nbs.filter(isLand);
                if (!land.every(j => T.free(g, j) && g.owner[j] === owner)) continue;
                const wet = land.filter(j => RIVER[j * 6 + G.dirTo(j, c)]), dry = land.filter(j => !RIVER[j * 6 + G.dirTo(j, c)]);
                const water = nbs.find(j => !isLand(j) && !g.armyAt[j]);
                if (wet.length < river || dry.length < k - river || (sea && water === undefined) || skip-- > 0) continue;
                g.owner[c] = foe; g.legal[c] = foe; g.version++;
                return { target: c, sides: [...wet.slice(0, river), ...dry.slice(0, k - river)], sea: water ?? -1 };
            }
            throw new Error('no hay casilla rodeable');
        },
        // Casillas libres de `owner` (tierra, sin ciudad) a `d` pasos de `center`, por cada `d` de `dists`, distintas entre
        // sí y con camino por tierra hasta `center`.
        cellsAt(g, owner, center, dists) {
            const near = g.nearCells(center, Math.max(...dists)), f = g.orderField(owner, center), used = new Set();
            return dists.map(d => {
                const c = [...near].find(([c, k]) => k === d && !used.has(c) && T.free(g, c) && g.owner[c] === owner && f.to(c) < Infinity)?.[0];
                if (c === undefined) throw new Error(`no hay casilla a ${d}`);
                used.add(c);
                return c;
            });
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
        // Casillas que pisa la recta de `a` a `b`, cada media casilla (como el trazado de una ofensiva).
        samples(a, b) {
            const k = Math.max(1, Math.round(Math.hypot(G.cx[b] - G.cx[a], G.cy[b] - G.cy[a]) / G.W)) * 2, out = new Set([a, b]);
            for (let j = 1; j < k; j++) { const c = G.cellAt(G.cx[a] + (G.cx[b] - G.cx[a]) * j / k, G.cy[a] + (G.cy[b] - G.cy[a]) * j / k); if (c >= 0) out.add(c); }
            return [...out];
        },
        // ¿Son de `owner` y de tierra todas las casillas a `m` o menos del trazado `pts` (y con suministro, si `supply`)?
        // Si lo son, quita los ejércitos que haya en ellas y devuelve true.
        clearRoute(g, owner, pts, m, supply = false) {
            const area = new Set();
            for (let i = 0; i + 1 < pts.length; i++) for (const s of T.samples(pts[i], pts[i + 1])) for (const x of g.nearCells(s, m).keys()) {
                if (!isLand(x) || g.owner[x] !== owner || CAPITAL_OF[x] >= 0 || (supply && !g.inSupply(owner, x))) return false;
                area.add(x);
            }
            for (const x of area) { const a = g.armyOn(x); if (a) g.removeArmy(a); }
            return true;
        },
        // Flecha recta de `len` casillas por tierra de `owner`, con margen `m` alrededor: [salida, objetivo].
        straight(g, owner, len, { m = 2, supply = false, skip = 0 } = {}) {
            for (const S of G.land) {
                if (g.owner[S] !== owner || CITY_OF[S] >= 0) continue;
                for (const [O, d] of g.nearCells(S, len)) if (d === len && isLand(O) && CITY_OF[O] < 0 && T.clearRoute(g, owner, [S, O], m, supply) && skip-- <= 0) return [S, O];
            }
            throw new Error('no hay sitio para la flecha');
        },
        // Flecha en L por tierra de `owner`: dos tramos de `leg` casillas, y el punto intermedio a `perp` casillas o más de
        // la recta entre la salida y el objetivo (fuera de su pasillo): [salida, intermedio, objetivo].
        elbow(g, owner, { leg = 7, perp = 4.5, m = 1 } = {}) {
            for (const S of G.land) {
                if (g.owner[S] !== owner || CITY_OF[S] >= 0) continue;
                for (const [M, d] of g.nearCells(S, leg)) {
                    if (d !== leg || !isLand(M) || g.owner[M] !== owner) continue;
                    for (const [O, e] of g.nearCells(M, leg)) {
                        if (e !== leg || !isLand(O) || CITY_OF[O] >= 0 || hexDist(S, O) < leg + 2) continue;
                        const so = Math.hypot(G.cx[O] - G.cx[S], G.cy[O] - G.cy[S]);
                        const p = Math.abs((G.cx[O] - G.cx[S]) * (G.cy[M] - G.cy[S]) - (G.cy[O] - G.cy[S]) * (G.cx[M] - G.cx[S])) / so / G.W;
                        if (p >= perp && T.clearRoute(g, owner, [S, M, O], m)) return [S, M, O];
                    }
                }
            }
            throw new Error('no hay sitio para la L');
        },
        // Dos costas de un mismo país frente a frente por mar (a 3–5 casillas) con un camino por tierra suya mucho más
        // largo, por el que la marcha de siempre iría embarcada: { owner, A, B, pts: el camino por tierra, casilla a casilla }.
        bay(g) {
            const nbs = c => [0, 1, 2, 3, 4, 5].map(d => G.nb[c * 6 + d]).filter(j => j >= 0);
            for (let owner = 0; owner < g.nations.length; owner++) for (const A of G.land) {
                if (g.owner[A] !== owner || !T.free(g, A) || !nbs(A).some(j => !isLand(j))) continue;
                let steps = null;
                for (const [B, d] of g.nearCells(A, 5)) {
                    if (d < 3 || !isLand(B) || g.owner[B] !== owner || !T.free(g, B) || !nbs(B).some(j => !isLand(j))) continue;
                    steps ??= g.landSteps(owner, [A]);
                    if (steps[B] < d * 3 || steps[B] > 30) continue;
                    const pts = [B];
                    while (pts[pts.length - 1] !== A) { const c = pts[pts.length - 1]; pts.push(nbs(c).find(j => isLand(j) && steps[j] === steps[c] - 1)); }
                    pts.reverse();
                    if (!pts.every(c => g.owner[c] === owner && CAPITAL_OF[c] < 0)) continue;
                    if (!g.fieldPath(g.orderField(owner, B), A).some(afloat)) continue;   // por mar le saldría más corto
                    return { owner, A, B, pts };
                }
            }
            throw new Error('no hay bahía');
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
    ['A1 · plantillas: tope 9999 y 24 propias', () => {
        const g = T.uiStart('es');
        ui.tplDraft = { name: 'Masa', units: { infantry: 9990, tank: 0, artillery: 0 } };
        ui.tab = 'mando'; ui.drawerOpen = true; ui.tplOpen = true; ui.render();
        for (let i = 0; i < 3; i++) document.querySelector('[data-action="tpl-step"][data-unit="infantry"][data-delta="10"]').click();
        T.eq(ui.tplDraft.units.infantry, 9999, 'tope 9999');
        const box = document.querySelector('input[data-tpl-unit="infantry"]');
        box.value = '123456'; box.dispatchEvent(new Event('input', { bubbles: true }));
        T.eq(ui.tplDraft.units.infantry, 9999, 'la cifra escrita también topa');
        box.value = '250'; box.dispatchEvent(new Event('input', { bubbles: true }));
        T.eq(ui.tplDraft.units.infantry, 250, 'la cifra escrita se fija');
        for (let i = 0; i < 24; i++) T.ok(g.playerSaveTemplate(`P${i}`, { infantry: 100, tank: 0, artillery: 0 }), `guarda la ${i + 1}.ª`);
        T.ok(!g.playerSaveTemplate('P25', { infantry: 1, tank: 0, artillery: 0 }), 'la 25.ª no');
        T.eq(g.nations[g.player].templates.length, 24, 'son 24');
        T.eq(g.nations[g.player].templates[0].units.infantry, 100, 'una plantilla');
        g.nations[g.player].templates.length = 0;
        g.playerSaveTemplate('Enorme', { infantry: 20000, tank: 0, artillery: 0 });
        T.eq(g.nations[g.player].templates[0].units.infantry, 9999, 'topa cada tipo');
        const h = GameEngine.load(JSON.parse(JSON.stringify(g.serialize())));
        T.eq(h.nations[g.player].templates[0].units.infantry, 9999, 'se carga sin recortar a 99');
        T.eq([TEMPLATES.cuerpo.units.infantry, TEMPLATES.cuerpo.units.tank, TEMPLATES.cuerpo.units.artillery], [60, 24, 12], 'cuerpo');
        T.eq([TEMPLATES.campana.units.infantry, TEMPLATES.campana.units.tank, TEMPLATES.campana.units.artillery], [240, 100, 50], 'ejército de campaña');
        return true;
    }],
    ['A2 · escalones hasta grupo de ejércitos', () => {
        T.eq([24, 25, 99, 100, 399, 400, 1499, 1500, 4000].map(n => echelonOf(n).mark), ['X', 'XX', 'XX', 'XXX', 'XXX', 'XXXX', 'XXXX', 'XXXXX', 'XXXXX'], 'marcas');
        T.eq(echelonOf(3000).name, 'grupo de ejércitos', 'nombre');
        T.eq(ECHELONS.length, 7, 'siete escalones');
        return true;
    }],
    ['A2 · con niebla, una masa sin identificar se estima por su escalón', () => {
        const g = T.game(7, true), es = T.nation('es'), fr = T.nation('fr');
        g.start(es);
        g.declareWar(es, fr);
        const { target, sides } = T.ring(g, es, fr, 1);
        const a = T.army(g, es, sides[0], 0, 0, 10);
        for (const [n, guess] of [[2000, 3000], [300, 399], [30, 99], [10, 24]]) {
            const old = g.armyOn(target); if (old) g.removeArmy(old);
            const foe = T.army(g, fr, target, n);
            T.ok(!g.intel(es, fr, target).exact, 'no lo conoce');
            const fx = g.combatFactors(es, a.units, sides[0], { owner: fr, units: { infantry: guess, tank: 0, artillery: 0 } }, target);
            T.ok(Math.abs(g.expectedRatio(es, a.units, sides[0], foe, target) - fx.atk / fx.dfn) < 1e-9, `${n} se supone de ${guess} al atacar`);
            T.eq(g.seenPower(es, foe, 'def'), unitPower({ infantry: guess, tank: 0, artillery: 0 }, 'def', g.rules(fr)), `${n} se ve como ${guess}`);
        }
        return true;
    }],
    ['A3 · tres ejércitos juntos vencen a una masa que los vence por separado', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.declareWar(es, fr);
        const { target, sides } = T.ring(g, es, fr, 3);
        g.settle(g.newArmy(fr, target, { infantry: 400, tank: 0, artillery: 0 }, 0));
        const atts = sides.map(c => T.army(g, es, c, 0, 0, 30));    // 30 artillerías cada uno
        const one = g.combatFactors(es, atts[0].units, atts[0].cell, g.armyOn(target), target, atts[0].id);
        T.ok(one.atk / one.dfn < 1, 'uno solo no puede');
        const list = g.jointCandidates(es, target);
        T.eq(list.length, 3, 'los tres pueden');
        T.eq(g.jointCandidates(es, target, new Set([atts[1].id])).map(x => x.army.id), [atts[1].id], 'solo los pedidos');
        const fx = g.jointFactors(es, list.map(x => ({ units: x.army.units, from: x.from, id: x.army.id })), g.armyOn(target), target);
        T.ok(Math.abs(fx.atk - fx.members.reduce((s, m) => s + m.atk, 0)) < 1e-6, 'el ataque es la suma');
        T.ok(fx.atk / fx.dfn > 1.6, `juntos sí (${fx.atk / fx.dfn})`);
        g.player = es;   // para que salga el parte
        g.attackJoint(list, target);
        T.eq(g.owner[target], es, 'toma la casilla');
        const msg = g.logs[g.logs.length - 1].msg;
        T.ok(msg.includes('con 3 ejércitos (30, 30 y 30 unidades)') && msg.includes('VICTORIA'), `parte: ${msg}`);
        T.ok(atts.every(a => a.used === 999), 'todos gastan el turno');
        T.ok(atts.some(a => a.cell === target) && atts.filter(a => a.cell === target).length === 1, 'entra uno solo');
        const ev = g.motion.filter(e => e.kind === 'battle').pop();
        T.eq(ev.joint.slice().sort(), atts.map(a => a.id).sort(), 'la batalla lista a los tres');
        return true;
    }],
    ['A3 · un solo atacante da lo mismo que hoy', () => {
        const run = joint => { const g = T.game(11), es = T.nation('es'), fr = T.nation('fr'); g.declareWar(es, fr);
            const { target, sides } = T.ring(g, es, fr, 1); g.settle(g.newArmy(fr, target, { infantry: 10, tank: 0, artillery: 0 }, 0));
            const a = T.army(g, es, sides[0], 8, 4, 0), r = g.reach(es, a.cell, g.mp(a), true);
            if (joint) g.attackJoint([{ army: a, from: r.attacks.get(target), r }], target); else g.attack(a, r.attacks.get(target), target, r);
            return JSON.stringify([...g.armies.values()].map(x => [x.owner, x.cell, x.units])) + g.rng(); };
        T.eq(run(true), run(false), 'mismo resultado y misma semilla');
        return true;
    }],
    ['A3 · el río y el mar se descuentan por participante', () => {
        // Río: uno cruza y otro no; la defensa no lleva el río.
        let g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.declareWar(es, fr);
        let { target, sides } = T.ring(g, es, fr, 2, { river: 1 });
        let def = g.settle(g.newArmy(fr, target, { infantry: 10, tank: 0, artillery: 0 }, 0));
        const wet = T.army(g, es, sides[0], 0, 0, 5), dry = T.army(g, es, sides[1], 0, 0, 5);
        let fx = g.jointFactors(es, [wet, dry].map(a => ({ units: a.units, from: a.cell, id: a.id })), def, target);
        const cw = g.combatFactors(es, wet.units, wet.cell, def, target, wet.id), cd = g.combatFactors(es, dry.units, dry.cell, def, target, dry.id);
        T.ok(cw.parts.some(([n]) => n === 'río'), 'el ataque suelto lleva el río en la defensa');
        T.eq([fx.members[0].river, fx.members[1].river], [true, false], 'solo cruza uno');
        T.ok(Math.abs(fx.members[0].atk - cw.atk / CONFIG.RIVER_DEFENSE) < 1e-6, 'el que cruza ataca ÷1,25');
        T.ok(Math.abs(fx.members[1].atk - cd.atk) < 1e-6, 'el otro, entero');
        T.ok(!fx.parts.some(([n]) => n === 'río') && Math.abs(fx.dfn - cd.dfn) < 1e-6, 'la defensa, sin río');
        // Mar: uno embarcado (más fuerte) y otro en tierra; si ganan, entra el de tierra y el barco se queda.
        g = T.game(); es = T.nation('es'); fr = T.nation('fr');
        g.declareWar(es, fr);
        let ringSea;
        ({ target, sides, sea: ringSea } = T.ring(g, es, fr, 1, { sea: true }));
        def = g.settle(g.newArmy(fr, target, { infantry: 3, tank: 0, artillery: 0 }, 0));
        const ship = T.army(g, es, ringSea, 0, 0, 40), land = T.army(g, es, sides[0], 0, 0, 5);
        const list = g.jointCandidates(es, target);
        T.eq(list.map(x => x.army.id).sort(), [ship.id, land.id].sort(), 'los dos pueden');
        fx = g.jointFactors(es, list.map(x => ({ units: x.army.units, from: x.from, id: x.army.id })), def, target);
        const ms = fx.members.find(m => m.id === ship.id), ml = fx.members.find(m => m.id === land.id);
        T.ok(ms.attParts.some(([n]) => n === 'asalto anfibio') && !ml.attParts.length, 'el embarcado lleva asalto anfibio');
        T.ok(ms.atk > ml.atk, 'el barco ataca más');
        g.attackJoint(list, target);
        T.eq(g.owner[target], es, 'ganan');
        T.eq([g.armyOn(target)?.id, ship.cell, g.armyOn(ringSea)?.id], [land.id, ringSea, ship.id], 'entra el de tierra; el barco se queda');
        return true;
    }],
    ['A3 · la IA suma ejércitos para atacar', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.declareWar(fr, es);
        const { target, sides } = T.ring(g, fr, es, 2);
        for (const a of [...g.armies.values()]) if (a.owner === fr) g.removeArmy(a);
        const def = g.settle(g.newArmy(es, target, { infantry: 10, tank: 0, artillery: 0 }, 0));
        const [x, y] = sides.map(c => T.army(g, fr, c, 2, 0, 1));
        for (const a of [x, y]) {
            const fx = g.combatFactors(fr, a.units, a.cell, def, target, a.id);
            T.ok(fx.atk / fx.dfn < 1.3, `solo no llega (${fx.atk / fx.dfn})`);
        }
        const fx = g.jointFactors(fr, [x, y].map(a => ({ units: a.units, from: a.cell, id: a.id })), def, target);
        T.ok(fx.atk / fx.dfn > 1.5, `juntos sí (${fx.atk / fx.dfn})`);
        g.aiArmies(fr);
        T.eq(g.owner[target], fr, 'la casilla pasa a Francia');
        const ev = g.motion.filter(e => e.kind === 'battle').pop();
        T.eq(ev.joint.slice().sort(), [x.id, y.id].sort(), 'atacan juntos');
        return true;
    }],
    ['A4 · crear, nombre automático y número', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        const spot = () => T.plainPair(g, es)[1];
        const xs = [13, 13, 14].map(n => T.army(g, es, spot(), n));   // 40 en total
        T.eq(groupAutoName(1, 40), '1.ª División', 'división');
        T.eq([groupAutoName(3, 30), groupAutoName(4, 12), groupAutoName(1, 150), groupAutoName(2, 150), groupAutoName(3, 150), groupAutoName(1, 500), groupAutoName(2, 500), groupAutoName(1, 2000), groupAutoName(2, 5), groupAutoName(1, 2)],
            ['3.ª División', '4.ª Brigada', '1.er Cuerpo de ejército', '2.º Cuerpo de ejército', '3.er Cuerpo de ejército', '1.er Ejército', '2.º Ejército', '1.er Grupo de ejércitos', '2.º Regimiento', '1.er Batallón'], 'ordinales y género');
        T.eq(GROUP_COLORS.length, 8, 'ocho colores');
        T.ok(GROUP_COLORS.every(c => /^#[0-9a-f]{6}$/i.test(c) && !OP_COLORS.includes(c)), 'hex y distintos de los de operaciones');
        T.ok(new Set(GROUP_COLORS).size === 8, 'todos distintos');
        const a = g.createGroup(es, xs.map(x => x.id));
        T.ok(a, 'se crea');
        T.eq([a.num, a.name, a.custom, a.order, a.reinforce], [1, '1.ª División', false, null, null], 'número y nombre');
        T.ok(a.color >= 0 && a.color < 8, 'color de la paleta');
        T.eq(g.groupMembers(es, a.id).map(x => x.id).sort(), xs.map(x => x.id).sort(), 'miembros');
        T.eq(countUnits(g.groupUnits(es, a.id)), 40, 'unidades');
        T.eq(g.groupById(es, a.id), a, 'por id');
        const ys = [75, 75].map(n => T.army(g, es, spot(), n));
        const b = g.createGroup(es, ys.map(x => x.id));
        T.eq([b.num, b.name], [2, '2.º Cuerpo de ejército'], '150 unidades: cuerpo');
        T.ok(a.id !== b.id && g.nextGroupId > b.id, 'ids nuevos');
        T.ok(g.createGroup(es, [xs[0].id, 999999]) === null, 'un id que no existe: nada');
        const foe = T.army(g, fr, T.plainPair(g, fr)[0], 5);
        T.ok(g.createGroup(es, [foe.id]) === null && g.createGroup(es, []) === null, 'ajenos o vacío: nada');
        // Renombrar, colorear, añadir, quitar.
        T.ok(g.renameGroup(es, a.id, '  Tercio de Flandes  '), 'renombra');
        T.eq([a.name, a.custom], ['Tercio de Flandes', true], 'nombre propio');
        T.ok(g.recolorGroup(es, a.id, 5) && a.color === 5, 'color');
        g.addToGroup(es, a.id, [ys[0].id]);
        T.eq([ys[0].group, countUnits(g.groupUnits(es, a.id)), a.name], [a.id, 115, 'Tercio de Flandes'], 'añade y conserva el nombre propio');
        T.eq(b.name, '2.ª División', 'la otra, con 75, se renombra sola');
        T.ok(g.renameGroup(es, a.id, '') && a.custom === false && a.name === '1.er Cuerpo de ejército', 'sin nombre vuelve al automático');
        // Crear con un número ocupado lo sustituye: los antiguos miembros quedan sin agrupación.
        const c = g.createGroup(es, [xs[0].id], { num: 2 });
        T.eq(c.num, 2, 'número pedido');
        T.ok(!g.groupById(es, b.id) && ys[1].group === 0, 'la 2 vieja desaparece y su ejército queda suelto');
        T.eq(xs[0].group, c.id, 'el ejército pasa a la nueva');
        T.eq(g.createGroup(es, [ys[1].id]).num, 3, 'el número libre más bajo');
        g.ungroup(es, [xs[1].id]);
        T.eq(xs[1].group, 0, 'quitar');
        g.disbandGroup(es, a.id);
        T.ok(!g.groupById(es, a.id) && [xs[2], ys[0]].every(x => x.group === 0), 'disolver');
        return true;
    }],
    ['A4 · fundir, dividir y morir no deja restos', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        const spot = () => T.plainPair(g, es)[1];
        const [a1, a2] = [10, 10].map(n => T.army(g, es, spot(), n));
        const [b1, b2, b3] = [5, 5, 5].map(n => T.army(g, es, spot(), n));
        const u = T.army(g, es, spot(), 4);
        const A = g.createGroup(es, [a1.id, a2.id]), B = g.createGroup(es, [b1.id, b2.id, b3.id]);
        const into = (x, y) => { if (g.armyAt[x.cell] === x.id) g.armyAt[x.cell] = 0; x.cell = y.cell; return g.settle(x); };
        T.eq(into(b1, a1), a1, 'b1 se funde en a1');
        T.eq(a1.group, A.id, 'el que recibe conserva la suya');
        T.eq(into(b3, u), u, 'b3 se funde en u');
        T.eq(u.group, B.id, 'el que no tenía toma la del que llega');
        const part = g.split(a2, { infantry: 4, tank: 0, artillery: 0, antiair: 0 });
        T.ok(part !== a2 && part.group === A.id, 'la parte que sale la conserva');
        g.settle(Object.assign(part, { cell: spot() }));
        g.changeOwner(b2, fr);
        T.eq(b2.group, 0, 'el que cambia de dueño, sin agrupación');
        g.removeArmy(u);   // muere el último de B
        const stray = T.army(g, es, spot(), 1), foe = [...g.armies.values()].find(x => x.owner === fr);
        stray.group = 999; foe.group = A.id;   // restos que apuntan a nada o a otro dueño
        T.eq(g.groupMembers(es, B.id).length, 0, 'B se queda sin nadie');
        g.beginNationTurn(es); g.beginNationTurn(fr);
        T.ok(!g.groupById(es, B.id), 'B desaparece');
        T.ok(g.groupById(es, A.id), 'A sigue');
        T.eq(g.groupMembers(es, A.id).map(x => x.id).sort(), [a1.id, a2.id, part.id].sort(), 'miembros de A');
        T.eq(A.name, '1.ª División', 'nombre según su tamaño (25)');
        const ids = new Set(g.nations[es].groups.map(x => x.id));
        T.ok([...g.armies.values()].every(x => !x.group || (x.owner === es && ids.has(x.group))), 'ningún ejército apunta a nada');
        T.eq([stray.group, foe.group], [0, 0], 'los restos se limpian');
        return true;
    }],
    ['A4 · marchar repartidos y reunir en uno', () => {
        const g = T.game(), es = T.nation('es');
        const home = T.plainPair(g, es)[1];
        const xs = T.cellsAt(g, es, home, [0, 1, 2, 3]).map(c => T.army(g, es, c, 3, 2, 0));
        const total = xs.reduce((s, x) => s + countUnits(x.units), 0);
        const dest = T.farCell(g, es, home, 8, 16);
        const spread = g.spreadCells(es, dest, 4, new Set(xs.map(x => x.id)));
        T.eq(spread.length, 4, 'cuatro casillas');
        T.eq(spread[0], dest, 'empieza por el destino');
        T.ok(new Set(spread).size === 4 && spread.every(c => isLand(c) && !g.armyAt[c]), 'distintas, de tierra y libres');
        T.ok(spread.every(c => g.nearCells(dest, 2).has(c)), 'alrededor del destino');
        g.groupMarch(es, xs.map(x => x.id), dest);
        T.ok(xs.every(x => x.order?.kind === 'march'), 'todos marchan');
        T.eq(new Set(xs.map(x => x.order.dest)).size, 4, 'cada uno a una');
        T.turns(g, es, 12);
        T.ok(xs.every(x => g.armies.has(x.id)), 'ninguno se funde');
        T.eq(new Set(xs.map(x => x.cell)).size, 4, 'cuatro casillas distintas');
        T.ok(xs.every(x => spread.includes(x.cell)), `en las repartidas (${xs.map(x => x.cell)} / ${spread})`);
        const host = g.groupGather(es, xs.map(x => x.id));
        T.ok(host && host.order?.kind === 'hold', 'el anfitrión espera');
        T.ok(xs.filter(x => x !== host).every(x => x.order?.kind === 'join' && x.order.target === host.id), 'los demás van a juntarse');
        T.turns(g, es, 6);
        T.eq(xs.filter(x => g.armies.has(x.id)).map(x => x.id), [host.id], 'queda uno');
        T.eq(countUnits(host.units), total, 'con todas las unidades');
        // Si el que se busca desaparece, la orden se cancela.
        const [p, q] = T.cellsAt(g, es, home, [1, 4]).map(c => T.army(g, es, c, 2));
        T.ok(g.setOrder(p, { kind: 'join', target: q.id }), 'orden de juntarse');
        T.ok(!g.setOrder(p, { kind: 'join', target: p.id }), 'consigo mismo no');
        g.removeArmy(q);
        T.eq(g.stepOrder(p), 'cancelled', 'sin objetivo, se cancela');
        T.eq(p.order, null, 'sin orden');
        return true;
    }],
    ['A4b · ataque coordinado espera a todos y ataca a la vez', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.declareWar(es, fr);
        const { target } = T.ring(g, es, fr, 6);   // seis lados de tierra: sitio para todos
        g.settle(g.newArmy(fr, target, { infantry: 400, tank: 0, artillery: 0 }, 0));
        // Sin suministro (no hay carreteras) se avanza una casilla por turno: a 2, 3 y 3 pasos del objetivo, llegan a su
        // casilla en 1, 2 y 2 turnos.
        const f = g.orderField(es, target), hops = c => g.fieldPath(f, c).length - 1;
        const near = [...g.nearCells(target, 5).keys()].filter(c => T.free(g, c) && g.owner[c] === es);
        const pick = k => { const c = near.find(c => hops(c) === k && !g.armyAt[c]); if (c === undefined) throw new Error(`nada a ${k}`); return c; };
        const xs = [2, 3, 3].map(k => T.army(g, es, pick(k), 0, 0, 50));
        const gr = g.createGroup(es, xs.map(x => x.id));
        const o = g.setGroupAssault(es, gr.id, target, 1.3);
        T.ok(o && gr.order === o, 'orden de agrupación');
        T.eq([o.kind, o.target, o.ratio, o.waitSince], ['assault', target, 1.3, 0], 'campos');
        const seen = new Set(g.motion), battles = () => g.motion.filter(e => e.kind === 'battle' && !seen.has(e));
        const adj = x => g.armies.has(x.id) && G.dirTo(x.cell, target) >= 0;
        // Se ataca al empezar el turno (antes de mover): el turno del combate empieza con los tres en su sitio.
        let partial = false;
        for (let t = 0; t < 15 && g.owner[target] !== es; t++) {
            const before = xs.filter(adj).length;
            T.turns(g, es, 1);
            const n = xs.filter(adj).length;
            if (battles().length) T.eq(before, 3, 'el combate es con los tres en su sitio');
            else if (n > 0 && n < 3) partial = true;
        }
        T.ok(partial, 'hubo turnos con solo parte en su sitio');
        T.eq(g.owner[target], es, 'la casilla cambia de dueño');
        const bs = battles();
        T.eq(bs.length, 1, 'un solo combate');
        T.eq(bs[0].joint.slice().sort(), xs.map(x => x.id).sort(), 'los tres a la vez');
        T.eq(new Set(Object.values(o.slots)).size, 3, 'cada uno en su casilla');
        T.eq(gr.order, null, 'la orden se cumple');
        return true;
    }],
    ['A4b · con uno que no llega, atacan los demás a los 3 turnos', () => {
        let g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.declareWar(es, fr);
        let { target } = T.ring(g, es, fr, 3);
        g.settle(g.newArmy(fr, target, { infantry: 200, tank: 0, artillery: 0 }, 0));
        const near = T.cellsAt(g, es, target, [2, 3]).map(c => T.army(g, es, c, 0, 0, 50));
        const far = T.army(g, es, T.farCell(g, es, target, 45, 90), 0, 0, 50);
        let gr = g.createGroup(es, [...near, far].map(x => x.id));
        g.setGroupAssault(es, gr.id, target, 1.3);
        const seen = new Set(g.motion), battles = () => g.motion.filter(e => e.kind === 'battle' && !seen.has(e));
        const adj = x => g.armies.has(x.id) && G.dirTo(x.cell, target) >= 0;
        let arrived = 0, fought = 0;
        for (let t = 0; t < 12 && !fought; t++) {
            T.turns(g, es, 1);
            if (!arrived && near.some(adj)) arrived = g.turn - 1;
            if (battles().length) fought = g.turn - 1;
        }
        T.ok(arrived && fought, `llegan (${arrived}) y atacan (${fought})`);
        T.ok(fought - arrived >= 3, `esperan 3 turnos (${arrived} → ${fought})`);
        T.ok(!adj(far), 'el lejano no ha llegado');
        const b = battles()[0];
        T.eq(b.joint.slice().sort(), near.map(x => x.id).sort(), 'atacan los dos que están');
        T.eq(g.owner[target], es, 'y ganan');
        // Contra lo que no pueden, esperan: nadie ataca solo ni juntos por debajo de la relación pedida.
        g = T.game(); es = T.nation('es'); fr = T.nation('fr');
        g.declareWar(es, fr);
        ({ target } = T.ring(g, es, fr, 3));
        g.settle(g.newArmy(fr, target, { infantry: 3000, tank: 0, artillery: 0 }, 0));
        const two = T.cellsAt(g, es, target, [2, 3]).map(c => T.army(g, es, c, 0, 0, 10));
        gr = g.createGroup(es, two.map(x => x.id));
        g.setGroupAssault(es, gr.id, target, 1.3);
        const seen2 = new Set(g.motion);
        T.turns(g, es, 8);
        T.eq(g.motion.filter(e => e.kind === 'battle' && !seen2.has(e)).length, 0, 'sin combates');
        T.ok(two.every(x => G.dirTo(x.cell, target) >= 0 && x.order?.kind === 'hold'), 'esperan en su sitio');
        T.ok(gr.order?.kind === 'assault' && g.owner[target] === fr, 'la orden sigue');
        return true;
    }],
    ['A4 · guardar y cargar conserva agrupaciones y órdenes', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.declareWar(es, fr);
        const { target } = T.ring(g, es, fr, 2);
        g.settle(g.newArmy(fr, target, { infantry: 900, tank: 0, artillery: 0 }, 0));
        const xs = T.cellsAt(g, es, target, [2, 3, 4, 6]).map(c => T.army(g, es, c, 0, 0, 20));
        const a = g.createGroup(es, [xs[0].id, xs[1].id]);
        g.renameGroup(es, a.id, 'Agrupación Norte'); g.recolorGroup(es, a.id, 6);
        g.setGroupAssault(es, a.id, target, 1.8);
        T.turns(g, es, 1);   // reparte las casillas
        T.eq(Object.keys(a.order.slots).length, 2, 'casillas repartidas');
        const b = g.createGroup(es, [xs[2].id], { num: 7 });
        T.ok(g.setOrder(xs[3], { kind: 'join', target: xs[2].id }), 'orden de juntarse');
        const data = JSON.parse(JSON.stringify(g.serialize()));
        const h = GameEngine.load(data);
        T.eq(h.nations[es].groups, g.nations[es].groups, 'agrupaciones');
        T.eq(h.nextGroupId, g.nextGroupId, 'siguiente id');
        T.eq(xs.map(x => h.armies.get(x.id).group), [a.id, a.id, b.id, 0], 'cada ejército en la suya');
        T.eq([h.armies.get(xs[3].id).order.kind, h.armies.get(xs[3].id).order.target], ['join', xs[2].id], 'orden de juntarse');
        // Un archivo manipulado: números, colores, nombres, órdenes y miembros que no valen.
        const bad = JSON.parse(JSON.stringify(data));
        const foe = [...g.armies.values()].find(x => x.owner === fr);
        bad.nations[es].groups.push({ id: 60, num: 500, name: 'x', color: 2 }, { id: a.id, num: 9, name: 'repetida', color: 1 },
            { id: 61, num: 9, name: 'y'.repeat(100), color: 12, custom: 1, order: { kind: 'assault', target: -5 } }, { id: 62, num: 7, name: 'número repetido' });
        bad.nations[es].groups[0].order.slots[123456] = target;
        bad.armyGroups.push([foe.id, a.id], [987654, 61]);
        const k = GameEngine.load(bad), ks = k.nations[es].groups;
        T.eq(ks.map(x => x.id), [a.id, b.id, 61], 'se quedan las válidas');
        const y = ks[2];
        T.eq([y.num, y.name.length, y.color, y.order, y.custom], [9, 40, 0, null, true], 'se acota lo demás');
        T.eq(k.armies.get(foe.id).group, 0, 'un ejército ajeno no entra');
        T.eq(Object.keys(ks[0].order.slots).length, 2, 'casillas de ejércitos que no existen, fuera');
        return true;
    }],
    ['A4 · Ctrl+clic suma y quita de la selección', () => {
        const g = T.uiStart('es'), es = g.player, fr = T.nation('fr');
        const spot = () => T.plainPair(g, es)[1];
        const xs = [5, 6, 7].map(n => T.army(g, es, spot(), n));
        const ids = (...a) => a.map(x => x.id).sort((p, q) => p - q), sel = () => [...ui.sel].sort((p, q) => p - q);
        ui.clickCell(xs[0].cell);
        T.eq([ui.selectedArmy()?.id, ui.sel.size], [xs[0].id, 0], 'un clic: uno, sin selección múltiple');
        ui.clickCell(xs[1].cell, false, true);
        T.eq(sel(), ids(xs[0], xs[1]), 'Ctrl+clic suma al elegido');
        ui.clickCell(xs[2].cell, false, true);
        T.eq(sel(), ids(...xs), 'y otro más');
        T.ok(!$('#card').hidden && document.querySelector('#card [data-action="sel-clear"]'), 'ficha de selección múltiple');
        T.eq(document.querySelectorAll('#card [data-sel-row]').length, 3, 'una fila por ejército');
        const foe = T.army(g, fr, T.plainPair(g, fr)[1], 3);
        ui.clickCell(foe.cell, false, true);
        T.eq(sel(), ids(...xs), 'un ejército ajeno no entra');
        ui.clickCell(xs[1].cell, false, true);
        T.eq(sel(), ids(xs[0], xs[2]), 'Ctrl+clic en uno elegido lo quita');
        document.querySelector(`#card [data-action="sel-remove"][data-id="${xs[2].id}"]`).click();
        T.eq([ui.sel.size, ui.selectedArmy()?.id], [0, xs[0].id], 'la cruz lo quita; con uno solo, ficha normal');
        T.ok(!document.querySelector('#card [data-action="sel-clear"]'), 'sin ficha múltiple');
        ui.clickCell(xs[1].cell, false, true); ui.clickCell(xs[2].cell, false, true);
        ui.clickCell(xs[1].cell);
        T.eq([ui.sel.size, ui.selectedArmy()?.id], [0, xs[1].id], 'un clic sin Ctrl vuelve a uno');
        return true;
    }],
    ['A4 · rectángulo elige los propios de dentro', () => {
        const g = T.uiStart('es'), es = g.player, fr = T.nation('fr');
        const { target, sides } = T.ring(g, es, fr, 2);
        const mine = sides.map(c => T.army(g, es, c, 4)), foe = T.army(g, fr, target, 4);
        ui.view.centerOn(target, 30); ui.render();
        const pts = [...sides, target].map(c => ui.view.toScreen(G.cx[c], G.cy[c]));
        const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
        ui.boxSelect(Math.max(...xs) + 3, Math.max(...ys) + 3, Math.min(...xs) - 3, Math.min(...ys) - 3);   // de abajo arriba
        T.eq([...ui.sel].sort((p, q) => p - q), mine.map(x => x.id).sort((p, q) => p - q), 'los dos propios, no el ajeno');
        T.ok(!ui.sel.has(foe.id) && mine.some(x => x.cell === ui.selected), 'uno de ellos queda elegido');
        T.eq([...ui.view.sel].sort(), [...ui.sel].sort(), 'la vista los dibuja');
        // «Seleccionar zona»: el siguiente arrastre es un rectángulo y luego se apaga.
        ui.select(-1);
        ui.clickCell(mine[0].cell);
        document.querySelector('#card [data-action="box-mode"]').click();
        T.ok(ui.boxMode, 'modo rectángulo');
        ui.boxSelect(Math.min(...xs) - 3, Math.min(...ys) - 3, Math.max(...xs) + 3, Math.max(...ys) + 3);
        T.ok(!ui.boxMode && ui.sel.size === 2, 'tras un rectángulo, se apaga');
        ui.boxSelect(0, 0, 1, 1);
        T.eq([ui.sel.size, ui.selected], [0, -1], 'un rectángulo vacío no deja nada elegido');
        return true;
    }],
    ['A4 · Alt+Mayús+2 crea la agrupación 2 y Alt+2 la elige', () => {
        const g = T.uiStart('es'), es = g.player;
        const spot = () => T.plainPair(g, es)[1];
        const xs = [5, 6, 7].map(n => T.army(g, es, spot(), n)), ids = xs.map(x => x.id).sort((p, q) => p - q);
        ui.clickCell(xs[0].cell); ui.clickCell(xs[1].cell, false, true); ui.clickCell(xs[2].cell, false, true);
        const key = (k, code, shift) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, code, altKey: true, shiftKey: shift, bubbles: true, cancelable: true }));
        key('"', 'Digit2', true);
        const gr = g.nations[es].groups.find(x => x.num === 2);
        T.ok(gr, 'agrupación 2');
        T.eq(g.groupMembers(es, gr.id).map(x => x.id).sort((p, q) => p - q), ids, 'con los tres');
        T.ok(g.logs[g.logs.length - 1].msg.includes(gr.name), 'lo dice el registro');
        ui.select(-1);
        T.eq(ui.sel.size, 0, 'nada elegido');
        ui.view.ox += 900; const ox = ui.view.ox;
        key('2', 'Digit2', false);
        T.eq([...ui.sel].sort((p, q) => p - q), ids, 'Alt+2 la elige');
        T.eq(ui.tool, 'command', 'no cambia a la herramienta 2');
        T.ok(ui.view.ox !== ox, 'y centra el mapa');
        // Doble clic sobre uno de sus ejércitos: toda la agrupación.
        ui.select(xs[1].cell);
        ui.view.canvas.dispatchEvent(new MouseEvent('dblclick', { clientX: ui.view.canvas.getBoundingClientRect().left + ui.view.toScreen(G.cx[xs[1].cell], G.cy[xs[1].cell])[0],
            clientY: ui.view.canvas.getBoundingClientRect().top + ui.view.toScreen(G.cx[xs[1].cell], G.cy[xs[1].cell])[1], bubbles: true }));
        T.eq(ui.sel.size, 3, 'doble clic elige la agrupación');
        key('5', 'Digit5', false);
        T.eq(ui.tool, 'command', 'Alt+5 sin agrupación 5 no hace nada');
        return true;
    }],
    ['A4 · ficha múltiple: crear agrupación desde el botón', () => {
        const g = T.uiStart('es'), es = g.player;
        const spot = () => T.plainPair(g, es)[1];
        const xs = [5, 6, 7, 8].map(n => T.army(g, es, spot(), n));
        const pick = (...a) => { ui.select(-1); ui.clickCell(a[0].cell); for (const x of a.slice(1)) ui.clickCell(x.cell, false, true); };
        pick(xs[0], xs[1]);
        const card = $('#card').textContent;
        T.ok(card.includes('11') && card.includes('2 ejércitos'), `totales: ${card.slice(0, 200)}`);
        document.querySelector('#card [data-action="sel-group-new"]').click();
        const gr = g.nations[es].groups[0];
        T.ok(gr && xs[0].group === gr.id && xs[1].group === gr.id, 'agrupación creada');
        T.ok($('#card').textContent.includes(gr.name), 'la ficha la nombra');
        pick(xs[2], xs[3]);
        $('#card select[data-sel-group]').value = String(gr.id);
        document.querySelector('#card [data-action="sel-group-add"]').click();
        T.eq(g.groupMembers(es, gr.id).length, 4, 'Añadir a…');
        // Marchar: pide la casilla y reparte.
        const dest = T.farCell(g, es, xs[2].cell, 25, 60);
        document.querySelector('#card [data-action="sel-march"]').click();
        T.eq(ui.ordering?.kind, 'group-march', 'espera el destino');
        ui.clickCell(dest);
        T.ok([xs[2], xs[3]].every(x => x.order?.kind === 'march'), 'marchan');
        T.eq(new Set([xs[2], xs[3]].map(x => x.order.dest)).size, 2, 'cada uno a su casilla');
        T.ok(ui.sel.size === 2 && !ui.ordering, 'la selección sigue');
        document.querySelector('#card [data-action="sel-hold"]').click();
        T.ok([xs[2], xs[3]].every(x => x.order?.kind === 'hold'), 'mantener');
        T.ok(document.querySelector('#card [data-action="sel-reinforce"]').disabled, 'Reforzar, aún no');
        // Elegir la agrupación entera da su botón de disolver.
        ui.selectGroup(gr.id);
        T.eq(ui.sel.size, 4, 'toda la agrupación');
        document.querySelector('#card [data-action="sel-disband"]').click();
        T.ok(!g.groupById(es, gr.id) && xs.every(x => !x.group), 'disuelta');
        document.querySelector('#card [data-action="sel-clear"]').click();
        T.eq([ui.sel.size, ui.selected], [0, -1], 'quitar la selección');
        return true;
    }],
    ['A3 · clic de ataque con la selección hace un ataque conjunto', () => {
        const g = T.uiStart('es'), es = g.player, fr = T.nation('fr');
        g.declareWar(es, fr);
        const { target, sides } = T.ring(g, es, fr, 3);
        g.settle(g.newArmy(fr, target, { infantry: 400, tank: 0, artillery: 0 }, 0));
        const atts = sides.map(c => T.army(g, es, c, 0, 0, 30));
        ui.clickCell(atts[0].cell);
        T.eq(ui.jointList(target).length, 1, 'suelto y sin selección: ataca solo');
        ui.jointAll = true;
        T.eq(ui.jointList(target).length, 3, '«Sumar a todos los vecinos»');
        ui.jointAll = false;
        ui.clickCell(atts[1].cell, false, true); ui.clickCell(atts[2].cell, false, true);
        ui.select(atts[0].cell, true);   // vuelve a elegir el primero sin perder la selección
        T.eq(ui.sel.size, 3, 'la selección sigue');
        T.ok(ui.reachInfo?.attacks.has(target), 'el objetivo está a su alcance');
        T.eq(ui.jointList(target).length, 3, 'los tres de la selección');
        const r = ui.view.canvas.getBoundingClientRect(), [sx, sy] = ui.view.toScreen(G.cx[target], G.cy[target]);
        ui.hover({ clientX: r.left + sx, clientY: r.top + sy });
        const tip = $('#tooltip').textContent;
        T.ok(tip.includes('Atacan contigo: 2 ejércitos vecinos') && /\d+ %/.test(tip), `previsión: ${tip}`);
        ui.clickCell(target);
        const msg = g.logs[g.logs.length - 1].msg;
        T.ok(msg.includes('con 3 ejércitos'), `parte: ${msg}`);
        T.eq(g.owner[target], es, 'toma la casilla');
        T.ok(atts.every(a => a.used === 999), 'todos gastan el turno');
        // Sin selección, los de su agrupación.
        ui.select(-1);
        return true;
    }],
    ['A4 · ejércitos elegidos que mueren en el turno de la IA no rompen la ficha', () => {
        const g = T.uiStart('es'), es = g.player;
        const spot = () => T.plainPair(g, es)[1];
        const xs = [5, 6, 7].map(n => T.army(g, es, spot(), n));
        ui.clickCell(xs[0].cell); ui.clickCell(xs[1].cell, false, true); ui.clickCell(xs[2].cell, false, true);
        g.removeArmy(xs[1]);
        ui.render();
        T.eq(ui.selArmies().map(x => x.id), [xs[0].id, xs[2].id], 'se purga el muerto');
        T.eq(document.querySelectorAll('#card [data-sel-row]').length, 2, 'dos filas');
        g.removeArmy(xs[0]);   // el elegido también
        ui.render();
        T.eq([ui.sel.size, ui.selectedArmy()?.id], [0, xs[2].id], 'con uno solo, su ficha normal');
        g.removeArmy(xs[2]);
        ui.render();
        T.eq(ui.selArmies().length, 0, 'nada');
        return true;
    }],
    ['A6 · oro de operación hasta 6400 y fondo mayor', () => {
        const g = T.game(), es = T.nation('es');
        g.start(es);
        T.eq(OP_GOLD, [0, 50, 100, 200, 400, 800, 1600, 3200, 6400], 'OP_GOLD');
        const op = g.createOp(es, 'reserva', [g.nations[es].capitalCell ?? PROVINCES.find(p => g.owner[p.city] === es).city], { gold: 6400, template: 'campana' });
        T.eq(op.gold, 6400, 'acepta 6400');
        g.nations[es].gold = 1e6;
        op.pool = 1e9; op.poolTurn = -1; g.reinforceBegin(op);
        T.eq(op.pool, Math.max(6400 * 6, g.templateCost(es, TEMPLATES.campana.units) * 3), 'tope del fondo');
        const h = GameEngine.load(JSON.parse(JSON.stringify(g.serialize())));
        T.eq([...h.ops.values()][0].gold, 6400, 'el oro sobrevive a guardar y cargar');
        return true;
    }],
    ['A4 · el cajón lista agrupaciones y sin agrupar', () => {
        const g = T.uiStart('es'), es = g.player, spot = () => T.plainPair(g, es)[1];
        const xs = [5, 6, 7, 8, 9].map(n => T.army(g, es, spot(), n));
        const gr = g.createGroup(es, [xs[0].id, xs[1].id, xs[2].id]);
        ui.tab = 'batalla'; ui.drawerOpen = true; ui.render();
        const body = $('#drawer-body');
        T.ok(body.querySelector(`[data-ob-group="${gr.id}"]`), 'la agrupación sale');
        T.ok(body.textContent.includes('3 ejércitos') && body.textContent.includes('Sin agrupar'), `texto: ${body.textContent.slice(0, 200)}`);
        const own = [...g.armies.values()].filter(a => a.owner === es).length;
        T.eq(body.querySelectorAll('[data-ob-army]').length, own - 3, 'sin desplegar: solo los sueltos');
        body.querySelector('[data-action="ob-toggle"]').click();
        T.eq($('#drawer-body').querySelectorAll('[data-ob-army]').length, own, 'desplegada: sus tres ejércitos también');
        // Botones: elegir pone la selección; color cicla; disolver suelta.
        $('#drawer-body').querySelector('[data-action="ob-select"]').click();
        T.eq(ui.sel.size, 3, 'ob-select elige a los tres');
        const c0 = gr.color;
        $('#drawer-body').querySelector('[data-action="ob-color"]').click();
        T.eq(gr.color, (c0 + 1) % GROUP_COLORS.length, 'ob-color cicla la paleta');
        $('#drawer-body').querySelector('[data-action="ob-disband"]').click();
        T.ok(!g.groupById(es, gr.id) && !xs[0].group, 'ob-disband');
        // Foco al pasar el ratón.
        const g2 = g.createGroup(es, [xs[3].id, xs[4].id]); ui.render();
        const row = $('#drawer-body').querySelector(`[data-ob-group="${g2.id}"]`);
        row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        T.eq(ui.view.groupFocus, g2.id, 'groupFocus al pasar el ratón');
        row.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
        T.ok(!ui.view.groupFocus, 'y se quita al salir');
        return true;
    }],
    ['A4 · marcar dos sin agrupar y crear agrupación desde el cajón', () => {
        const g = T.uiStart('es'), es = g.player, spot = () => T.plainPair(g, es)[1];
        const xs = [5, 6, 7, 8].map(n => T.army(g, es, spot(), n));
        const first = g.createGroup(es, [xs[0].id]);
        ui.tab = 'batalla'; ui.drawerOpen = true; ui.render();
        const tick = a => { const i = $('#drawer-body').querySelector(`[data-ob-army="${a.id}"]`); i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true })); };
        tick(xs[1]); tick(xs[2]);
        T.ok(!$('#ob-bar').hidden && $('#ob-bar').textContent.includes('2'), 'la barra cuenta las marcadas');
        $('#drawer-body').querySelector('[data-action="ob-new"]').click();
        const gr = g.nations[es].groups.find(x => x.id !== first.id);
        T.ok(gr && xs[1].group === gr.id && xs[2].group === gr.id && !xs[3].group, 'nueva agrupación con las dos');
        T.eq(ui.obSel.size, 0, 'se borran las marcas');
        tick(xs[3]);
        $('#drawer-body').querySelector('[data-ob-pick]').value = String(gr.id);
        $('#drawer-body').querySelector('[data-action="ob-add"]').click();
        T.eq(g.groupMembers(es, gr.id).length, 3, 'Añadir a… suma la marcada');
        return true;
    }],
    ['A4 · renombrar desde el cajón fija el nombre', () => {
        const g = T.uiStart('es'), es = g.player, spot = () => T.plainPair(g, es)[1];
        const xs = [5, 6].map(n => T.army(g, es, spot(), n));
        const gr = g.createGroup(es, xs.map(a => a.id));
        ui.tab = 'batalla'; ui.drawerOpen = true; ui.render();
        const inp = $('#drawer-body').querySelector(`[data-group-name="${gr.id}"]`);
        inp.value = 'Vanguardia'; inp.dispatchEvent(new Event('change', { bubbles: true }));
        T.ok(gr.name === 'Vanguardia' && gr.custom, 'nombre fijado');
        inp.value = ''; inp.dispatchEvent(new Event('change', { bubbles: true }));
        T.ok(!gr.custom && gr.name !== 'Vanguardia' && inp.value === gr.name, 'vacío: vuelve al automático');
        return true;
    }],
    ['A4 · tecla B abre la pestaña', () => {
        const g = T.uiStart('es');
        ui.tab = 'registro'; ui.drawerOpen = false; ui.render();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
        T.ok(ui.tab === 'batalla' && ui.drawerOpen, 'abre la pestaña');
        T.ok($('#drawer .tabs button.on').dataset.tab === 'batalla', 'pestaña marcada');
        return true;
    }],
    ['A4 · groupMarks: un símbolo por agrupación con su total', () => {
        const g = T.uiStart('es'), es = g.player, fr = T.nation('fr');
        const spot = () => T.plainPair(g, es)[1];
        const xs = [[5, 2, 0], [6, 0, 1], [7, 3, 0], [4, 0, 0], [2, 0, 2]].map(([i, t, r]) => T.army(g, es, spot(), i, t, r));
        const a = g.createGroup(es, xs.slice(0, 3).map(x => x.id)), b = g.createGroup(es, xs.slice(3).map(x => x.id));
        const foe = g.createGroup(fr, [T.army(g, fr, T.plainPair(g, fr)[1], 9).id]);
        T.ok(foe, 'agrupación ajena');
        const m = ui.view.groupMarks();
        T.eq(m.map(x => x.gid).sort((p, q) => p - q), [a.id, b.id].sort((p, q) => p - q), 'solo las propias, una por agrupación');
        const ma = m.find(x => x.gid === a.id), mem = xs.slice(0, 3), u = g.groupUnits(es, a.id), n = countUnits(u);
        T.eq([ma.num, ma.color, ma.n, ma.mark, ma.type], [a.num, GROUP_COLORS[a.color], n, echelonOf(n).mark, dominantType(u)], 'número, color, total, escalón y tipo');
        const cx = mem.reduce((s, x) => s + G.cx[x.cell], 0) / 3, cy = mem.reduce((s, x) => s + G.cy[x.cell], 0) / 3;
        T.ok(Math.abs(ma.x - cx) < 1e-6 && Math.abs(ma.y - cy) < 1e-6, 'en el centro de sus miembros (mundo)');
        T.ok(ui.view.groupMarks() === m, 'cacheado mientras nada cambia');
        g.recolorGroup(es, a.id, 5);
        T.eq(ui.view.groupMarks().find(x => x.gid === a.id).color, GROUP_COLORS[5], 'cambiar el color lo rehace');
        g.addToGroup(es, b.id, [T.army(g, es, spot(), 10).id]);
        T.eq(ui.view.groupMarks().find(x => x.gid === b.id).n, 4 + 2 + 2 + 10, 'un ejército más suma');
        return true;
    }],
    ['A4 · capa G se enciende con la tecla y se recuerda', () => {
        T.uiStart('es');
        const key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
        T.ok(!ui.view.showGroups, 'apagada al empezar');
        key('g');
        T.ok(ui.view.showGroups && ui.prefs.groups === true && readPrefs().groups === true, 'G la enciende y se guarda');
        ui.mapMenu = true; ui.render();
        const box = $('#map-menu').querySelector('[data-action="layer-groups"]');
        T.ok(box?.checked && $('#map-menu').textContent.includes('Agrupaciones'), 'en el menú Mapa, marcada');
        box.click();
        T.ok(!ui.view.showGroups && readPrefs().groups === false, 'la casilla la apaga');
        key('G');
        T.ok(ui.view.showGroups, 'G mayúscula también');
        key('g');
        ui.mapMenu = false; ui.render();
        T.ok(!ui.view.showGroups && ui.tool === 'command', 'sin tocar las herramientas');
        return true;
    }],
    ['A4 · de lejos, la agrupación se dibuja una vez', () => {
        const g = T.uiStart('es'), es = g.player;
        ui.view.setMode('sencilla');
        const home = T.plainPair(g, es)[1];
        const cells = T.cellsAt(g, es, home, [0, 1, 1, 2, 2, 3]);
        const xs = cells.map((c, i) => T.army(g, es, c, 4 + i));
        const gr = g.createGroup(es, xs.slice(0, 5).map(x => x.id)), loose = xs[5], ids = new Set(xs.slice(0, 5).map(x => x.id));
        const calls = [], draw = ui.view.drawCounter;
        ui.view.drawCounter = function (t, ...rest) { calls.push(t); return draw.call(this, t, ...rest); };
        try {
            ui.view.scale = 3 / G.S; ui.view.centerOn(home, 3); ui.view.draw();
            T.ok(G.S * ui.view.scale < FAR_HEX, 'de lejos');
            T.eq(calls.filter(t => ids.has(t.id)).length, 0, 'sin las fichas de sus miembros');
            T.eq(calls.filter(t => t.groupMark === gr.id).length, 1, 'un símbolo de la agrupación');
            T.eq(calls.filter(t => t.id === loose.id).length, 1, 'el suelto se ve como hoy');
            calls.length = 0;
            ui.view.scale = 20 / G.S; ui.view.centerOn(home, 20); ui.view.draw();
            const mine = calls.filter(t => ids.has(t.id));
            T.eq(mine.length, 5, 'de cerca, cada ficha');
            T.ok(mine.every(t => t.group?.num === gr.num && t.group?.color === GROUP_COLORS[gr.color]), 'con el número y el color de su agrupación');
            T.ok(!calls.find(t => t.id === loose.id).group && !calls.some(t => t.groupMark), 'el suelto sin marca; ningún símbolo de grupo');
            // Capa G: los agrupados, teñidos; los demás, atenuados.
            calls.length = 0; ui.view.showGroups = true; ui.view.draw();
            T.ok(calls.filter(t => ids.has(t.id)).every(t => t.tint === GROUP_COLORS[gr.color] && t.alpha === 1), 'teñidas');
            T.ok(calls.find(t => t.id === loose.id).alpha < 1, 'el suelto, atenuado');
        } finally { ui.view.drawCounter = draw; ui.view.showGroups = false; }
        return true;
    }],
    ['A4 · enfocar o elegir la agrupación la rodea', () => {
        const g = T.uiStart('es'), es = g.player;
        ui.view.setMode('sencilla');
        const home = T.plainPair(g, es)[1];
        const xs = T.cellsAt(g, es, home, [0, 1, 2]).map((c, i) => T.army(g, es, c, 4 + i));
        const gr = g.createGroup(es, xs.slice(0, 2).map(x => x.id));
        T.eq(ui.view.focusGroup(), 0, 'nada enfocado');
        ui.view.groupFocus = gr.id;
        T.eq(ui.view.focusGroup(), gr.id, 'la del cajón');
        ui.view.groupFocus = 0;
        ui.selectGroup(gr.id);
        T.eq(ui.view.focusGroup(), gr.id, 'la elegida entera');
        ui.clickCell(xs[2].cell, false, true);
        T.eq(ui.view.focusGroup(), 0, 'con uno de fuera, ninguna');
        const hull = ui.view.groupHull(gr.id);
        T.ok(hull.length >= 3, 'envolvente con grosor aunque sean dos');
        ui.view.centerOn(home, 20); ui.view.groupFocus = gr.id; ui.view.draw(); ui.view.groupFocus = 0;
        return true;
    }],
    ['A4 · 400 ejércitos en 80 agrupaciones: el mapa se dibuja deprisa', () => {
        const g = T.uiStart('es'), es = g.player, ids = [];
        ui.view.setMode('sencilla');
        for (const c of G.land) { if (ids.length >= 400) break; if (T.free(g, c) && g.owner[c] === es) ids.push(T.army(g, es, c, 1 + ids.length % 7).id); }
        for (const c of G.land) { if (ids.length >= 400) break; if (T.free(g, c)) ids.push(T.army(g, es, c, 1 + ids.length % 7).id); }
        for (let i = 0; i < 80; i++) g.createGroup(es, ids.slice(i * 5, i * 5 + 5));
        ui.view.showGroups = true;
        const time = hex => { ui.view.scale = hex / G.S; ui.view.centerOn(g.nations[es].capitalCell, hex); ui.view.draw(); const t0 = performance.now(); for (let i = 0; i < 5; i++) ui.view.draw(); return (performance.now() - t0) / 5; };
        try {
            const far = time(3), near = time(14);
            T.ok(far < 40 && near < 40, `de lejos ${far.toFixed(1)} ms, de cerca ${near.toFixed(1)} ms`);
        } finally { ui.view.showGroups = false; }
        return true;
    }],
    ['A4 · 400 ejércitos: renderBattleOrder tarda menos de 50 ms', () => {
        const g = T.uiStart('es'), es = g.player, ids = [];
        for (const c of G.land) { if (ids.length >= 400) break; if (T.free(g, c)) ids.push(T.army(g, es, c, 1 + ids.length % 7).id); }
        T.ok(ids.length >= 400, `solo hay sitio para ${ids.length}`);
        for (let i = 0; i < 40; i++) g.createGroup(es, ids.slice(i * 5, i * 5 + 5));
        ui.tab = 'batalla'; ui.drawerOpen = true; ui.render();
        for (let i = 1; i <= 40; i++) ui.obOpen.add(g.nations[es].groups[i - 1].id);
        ui.renderBattleOrder();
        const t0 = performance.now(); ui.renderBattleOrder(); const ms = performance.now() - t0;
        T.ok(ms < 50, `${ms.toFixed(1)} ms`);
        T.ok($('#drawer-body').querySelectorAll('[data-ob-army]').length >= 400, 'todos listados');
        return true;
    }],
    ['A5 · espera en la zona hasta estar todos y luego sale', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); g.declareWar(es, fr);
        const [S, O] = T.straight(g, es, 8);
        g.owner[O] = fr; g.legal[O] = fr; g.version++;
        const op = g.createOp(es, 'ofensiva', [S, O]);
        T.eq([op.phase, op.launch, op.go, op.wp, op.zone, op.gatherSince], ['reunion', 'lista', false, 1, S, g.turn], 'empieza reuniéndose');
        const near = T.cellsAt(g, es, S, [0, 1]).map(c => T.army(g, es, c, 0, 6, 0));
        const far = T.army(g, es, T.farCell(g, es, S, 10, 16), 3);
        for (const a of [...near, far]) g.assignArmy(a, op.id);
        T.ok(hexDist(far.cell, S) > 2, 'el lejano no está en la zona');
        let launched = -1, waited = 0;
        for (let t = 0; t < 7 && launched < 0; t++) {
            const st = g.opReady(op);
            T.turns(g, es, 1);
            if (op.phase === 'avance') { launched = t; T.ok(st.ready && st.missing.length === 0, `sale con todos en la zona (${JSON.stringify(st)})`); }
            else { waited++; T.ok(near.every(a => hexDist(a.cell, S) <= 2), 'los que están esperan en la zona'); }
        }
        T.ok(launched > 0 && waited > 0, `espera ${waited} turnos y sale`);
        T.eq(op.body.slice().sort(), [...near, far].map(a => a.id).sort(), 'el grueso son los tres');
        T.ok(g.logs.some(l => l.msg.includes('Reunión: 2 de 3 en la zona')), 'el parte dice cómo va la reunión');
        const before = Math.max(...g.opMembers(op).map(a => g.opAlong(op, a.cell)));
        T.turns(g, es, 1);
        T.ok(!g.ops.has(op.id) || Math.max(...g.opMembers(op).map(a => g.opAlong(op, a.cell))) > before, 'y avanzan');
        return true;
    }],
    ['A5 · lista contra el enemigo más fuerte del primer tramo, no contra la suma', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); g.declareWar(es, fr);
        const [S, O] = T.straight(g, es, 10);
        g.owner[O] = fr; g.legal[O] = fr; g.version++;
        const op = g.createOp(es, 'ofensiva', [S, O]);
        // Dos ejércitos franceses en el pasillo del primer tramo, en tierra que les pasa a ellos.
        const spots = T.samples(S, O).filter(c => hexDist(c, S) >= 4 && hexDist(c, S) <= 7 && c !== O).slice(0, 2);
        T.eq(spots.length, 2, 'dos sitios');
        const foes = spots.map(c => { g.owner[c] = fr; g.legal[c] = fr; return g.settle(g.newArmy(fr, c, { infantry: 10, tank: 0, artillery: 0 }, 0)); });
        g.version++;
        const dfn = foes.map(e => g.combatFactors(es, { infantry: 1, tank: 0, artillery: 0 }, e.cell, e, e.cell).dfn);
        const per = unitPower({ infantry: 0, tank: 1, artillery: 0 }, 'atk', g.rules(es));
        const n = Math.ceil(op.ratio * Math.max(...dfn) / per / 2) + 1;   // dos ejércitos de n tanques
        const xs = T.cellsAt(g, es, S, [0, 1]).map(c => T.army(g, es, c, 0, n, 0));
        for (const a of xs) g.assignArmy(a, op.id);
        const atk = 2 * n * per;
        T.ok(atk >= op.ratio * Math.max(...dfn) && atk < op.ratio * (dfn[0] + dfn[1]), `puede con cada uno pero no con los dos juntos (${atk} / ${dfn})`);
        const st = g.opReady(op);
        T.ok(Math.abs(st.ratio - atk / Math.max(...dfn)) < 1e-9, `relación contra el más fuerte (${st.ratio})`);
        T.ok(st.strong && st.ready, 'lista');
        g.executeOp(op);
        T.eq(op.phase, 'avance', 'y sale');
        return true;
    }],
    ['A5 · sigue los puntos de la flecha en orden', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); g.declareWar(es, fr);
        const [S, M, O] = T.elbow(g, es);
        g.owner[O] = fr; g.legal[O] = fr; g.version++;
        const op = g.createOp(es, 'ofensiva', [S, M, O]), lane = g.opCorridor(op);
        T.ok(!g.opAxisSea(op), 'por tierra');
        const xs = T.cellsAt(g, es, S, [0, 1, 1]).map(c => T.army(g, es, c, 0, 5, 0));
        for (const a of xs) g.assignArmy(a, op.id);
        const ids = new Set(xs.map(a => a.id)), seen = new Set(g.motion);
        let atM = -1, nearO = -1, wps = [];
        for (let t = 0; t < 40 && g.ops.has(op.id); t++) {
            T.turns(g, es, 1);
            wps.push(op.wp);
            const mine = [...g.armies.values()].filter(a => a.owner === es && (ids.has(a.id) || a.op === op.id));
            for (const a of mine) T.ok(lane.has(a.cell), `fuera del pasillo en ${a.cell}`);
            if (atM < 0 && mine.some(a => hexDist(a.cell, M) <= 1)) atM = t;
            if (nearO < 0 && mine.some(a => hexDist(a.cell, O) < hexDist(M, O) - 1)) nearO = t;
        }
        for (const e of g.motion) if (!seen.has(e) && e.kind === 'move' && e.owner === es) for (const c of e.cells) T.ok(lane.has(c), `pasa fuera del pasillo por ${c}`);
        T.ok(atM >= 0, 'pasa por el punto intermedio');
        T.ok(nearO < 0 || atM <= nearO, `antes de acercarse al objetivo (${atM} / ${nearO})`);
        T.ok(wps.every((w, i) => !i || w >= wps[i - 1]), 'los puntos, en orden');
        T.eq([g.owner[O], g.ops.has(op.id)], [es, false], 'toma el objetivo');
        return true;
    }],
    ['A5 · los rápidos esperan a los lentos', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); g.declareWar(es, fr);
        const [S, O] = T.straight(g, es, 10, { m: 1, supply: true });
        g.owner[O] = fr; g.legal[O] = fr; g.version++;
        const op = g.createOp(es, 'ofensiva', [S, O]);
        const [tk, inf] = T.cellsAt(g, es, S, [0, 1]).map((c, i) => T.army(g, es, c, i ? 6 : 0, i ? 0 : 6, 0));
        for (const a of [tk, inf]) g.assignArmy(a, op.id);
        T.ok(g.mp(tk) > g.mp(inf) + MOVE, `los tanques corren más (${g.mp(tk)} / ${g.mp(inf)})`);
        let turns = 0, first = null;
        const t0 = g.opAlong(op, tk.cell);
        for (let t = 0; t < 25 && g.ops.has(op.id); t++) {
            T.turns(g, es, 1);
            if (!g.ops.has(op.id)) break;
            const [a, b] = [tk, inf].map(x => g.opAlong(op, x.cell));
            T.ok(a - b <= OP_LEAD + 1e-9, `los tanques no se adelantan más de ${OP_LEAD} (${a.toFixed(2)} / ${b.toFixed(2)})`);
            first ??= a - t0;
            turns++;
        }
        T.ok(first < 5 && turns >= 2, `los tanques esperan (${first?.toFixed(2)} casillas el primer turno) y van juntos ${turns} turnos`);
        T.eq(g.owner[O], es, 'y toman el objetivo');
        return true;
    }],
    ['A5 · nadie ataca solo: asalto conjunto con todos', () => {
        let g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); g.declareWar(es, fr);
        let { target, sides } = T.ring(g, es, fr, 3);
        g.settle(g.newArmy(fr, target, { infantry: 400, tank: 0, artillery: 0 }, 0));
        let xs = sides.map(c => T.army(g, es, c, 0, 0, 30));
        let op = g.createOp(es, 'ofensiva', [sides[0], target]);
        for (const a of xs) g.assignArmy(a, op.id);
        for (const a of xs) { const fx = g.combatFactors(es, a.units, a.cell, g.armyOn(target), target, a.id); T.ok(fx.atk / fx.dfn < 1, 'uno solo no puede'); }
        let seen = new Set(g.motion);
        g.executeOp(op);
        let bs = g.motion.filter(e => e.kind === 'battle' && !seen.has(e));
        T.eq(bs.length, 1, 'un solo combate');
        T.eq(bs[0].joint.slice().sort(), xs.map(a => a.id).sort(), 'con los tres a la vez');
        T.eq(g.owner[target], es, 'y lo ganan');
        T.ok(g.logs.some(l => l.msg.includes('Asalto conjunto sobre') && l.msg.includes('con 3 ejércitos')), 'el parte lo dice');
        // Contra lo que no pueden ni juntos, nadie ataca: esperan, y piden ayuda.
        g = T.game(); es = T.nation('es'); fr = T.nation('fr');
        g.start(es); g.declareWar(es, fr);
        ({ target, sides } = T.ring(g, es, fr, 3));
        g.settle(g.newArmy(fr, target, { infantry: 3000, tank: 0, artillery: 0 }, 0));
        xs = sides.map(c => T.army(g, es, c, 0, 0, 30));
        op = g.createOp(es, 'ofensiva', [sides[0], target]);
        for (const a of xs) g.assignArmy(a, op.id);
        g.opLaunch(op);
        seen = new Set(g.motion);
        T.turns(g, es, 3);
        T.eq(g.motion.filter(e => e.kind === 'battle' && !seen.has(e)).length, 0, 'sin combates');
        T.ok(xs.every(a => g.armies.has(a.id) && G.dirTo(a.cell, target) >= 0), 'esperan junto al objetivo');
        T.ok(op.waiting > 0 && g.opNeed(op) > 0, 'y piden ayuda');
        return true;
    }],
    ['A5 · por tierra no embarca aunque el mar sea más corto', () => {
        const g = T.game(), { owner: es, A, B, pts } = T.bay(g), fr = es === T.nation('fr') ? T.nation('es') : T.nation('fr');
        g.start(es); g.declareWar(es, fr);
        for (const c of pts) for (const x of g.nearCells(c, 1).keys()) { const a = g.armyOn(x); if (a) g.removeArmy(a); }
        g.owner[B] = fr; g.legal[B] = fr; g.version++;
        const op = g.createOp(es, 'ofensiva', pts);
        T.ok(op && !g.opAxisSea(op) && !op.bySea, 'la flecha va por tierra');
        const a = T.army(g, es, A, 0, 4, 0);
        g.assignArmy(a, op.id);
        const seen = new Set(g.motion);
        for (let t = 0; t < 40 && g.ops.has(op.id); t++) {
            T.turns(g, es, 1);
            T.ok(!afloat(a.cell), `embarcado en ${a.cell}`);
        }
        T.ok(!g.motion.some(e => !seen.has(e) && e.kind === 'move' && e.owner === es && e.cells.some(afloat)), 'nunca pisa el mar');
        T.eq(g.owner[B], es, 'llega por tierra y toma el objetivo');
        return true;
    }],
    ['A5 · con mar, desembarcan el mismo turno que asalta la tierra', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); g.declareWar(es, fr);
        const { target, sides, sea } = T.ring(g, es, fr, 1, { sea: true });
        g.settle(g.newArmy(fr, target, { infantry: 6, tank: 0, artillery: 0 }, 0));
        // Una salida desde la que la flecha cruza el mar; el de tierra empieza a 3 casillas del objetivo.
        const start = [...g.nearCells(target, 6)].find(([c, d]) => d >= 2 && isLand(c) && g.owner[c] === es && T.free(g, c) && T.samples(c, target).some(x => !isLand(x)))?.[0];
        T.ok(start !== undefined, 'hay salida al otro lado del mar');
        const op = g.createOp(es, 'ofensiva', [start, target]);
        T.ok(op.bySea, 'la flecha cruza el mar');
        const lc = T.cellsAt(g, es, target, [3])[0];
        const land = T.army(g, es, lc, 2, 0, 0), ship = T.army(g, es, sea, 0, 0, 40);
        for (const a of [land, ship]) g.assignArmy(a, op.id);
        const solo = g.combatFactors(es, ship.units, sea, g.armyOn(target), target, ship.id);
        T.ok(solo.atk / solo.dfn >= op.ratio, 'el barco solo podría atacar');
        op.phase = 'avance'; op.body = [land.id, ship.id];
        const seen = new Set(g.motion);
        let fought = -1, adj = -1;
        for (let t = 0; t < 10 && fought < 0; t++) {
            const ready = G.dirTo(land.cell, target) >= 0;
            T.turns(g, es, 1);
            const bs = g.motion.filter(e => e.kind === 'battle' && !seen.has(e));
            if (bs.length) {
                fought = t;
                T.ok(ready, 'el combate empieza con los de tierra junto al objetivo');
                T.eq(bs[0].joint.slice().sort(), [land.id, ship.id].sort(), 'tierra y mar a la vez');
            } else T.eq(ship.cell, sea, 'el barco espera junto a la costa');
            if (adj < 0 && G.dirTo(land.cell, target) >= 0) adj = t;
        }
        T.ok(adj >= 1 && fought === adj + 1, `llega la tierra (${adj}) y asaltan juntos (${fought})`);
        T.eq(g.owner[target], es, 'y lo toman');
        return true;
    }],
    ['A5 · con «cuando yo lo diga» no sale hasta Lanzar', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); g.declareWar(es, fr);
        const [S, O] = T.straight(g, es, 8);
        g.owner[O] = fr; g.legal[O] = fr; g.version++;
        const op = g.createOp(es, 'ofensiva', [S, O], { launch: 'orden' });
        T.eq(op.launch, 'orden', 'cuando yo lo diga');
        const xs = T.cellsAt(g, es, S, [0, 1]).map(c => T.army(g, es, c, 0, 6, 0));
        for (const a of xs) g.assignArmy(a, op.id);
        const cells = xs.map(a => a.cell);
        T.turns(g, es, 3);
        T.eq([op.phase, xs.map(a => a.cell)], ['reunion', cells], 'lista, pero espera la orden');
        T.ok(g.opReady(op).strong && !g.opReady(op).ready, 'tiene fuerza y no sale');
        T.ok(g.playerLaunchOp(op), 'Lanzar');
        T.eq(op.phase, 'avance', 'sale');
        T.turns(g, es, 1);
        T.ok(!g.ops.has(op.id) || xs.some((a, i) => a.cell !== cells[i]), 'y se mueven');
        return true;
    }],
    ['A5 · un miembro aislado: sale sin él a los 8 turnos', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); g.declareWar(es, fr);
        const [S, O] = T.straight(g, es, 8);
        g.owner[O] = fr; g.legal[O] = fr; g.version++;
        const op = g.createOp(es, 'ofensiva', [S, O]);
        const xs = T.cellsAt(g, es, S, [0, 1]).map(c => T.army(g, es, c, 0, 6, 0));
        const iso = T.army(g, es, T.farCell(g, es, S, 30, 60), 2);
        for (const a of [...xs, iso]) g.assignArmy(a, op.id);
        g.setOrder(iso, { kind: 'hold' });   // no viene: lo retiene su propia orden
        let out = -1;
        for (let t = 0; t < 12 && out < 0; t++) {
            const turn = g.turn;
            T.turns(g, es, 1);
            if (op.phase === 'avance') out = turn - op.gatherSince;
        }
        T.eq(out, OP_WAIT, `sale a los ${OP_WAIT} turnos`);
        T.ok(!op.body.includes(iso.id) && xs.every(a => op.body.includes(a.id)), 'sin el aislado');
        T.ok(g.logs.some(l => l.msg.includes('sin 1 ejército que no ha llegado')), 'el parte lo avisa');
        return true;
    }],
    ['A5 · ofensiva de una partida vieja carga en avance', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); g.declareWar(es, fr);
        const [S, M, O] = T.elbow(g, es);
        g.owner[O] = fr; g.legal[O] = fr; g.version++;
        const op = g.createOp(es, 'ofensiva', [S, M, O]), op2 = g.createOp(es, 'ofensiva', [S, O], { launch: 'orden', noCap: true });
        g.assignArmy(T.army(g, es, M, 0, 3, 0), op.id);
        op2.zone = T.cellsAt(g, es, S, [1])[0]; op2.gatherSince = 3;
        const data = JSON.parse(JSON.stringify(g.serialize()));
        // Partida nueva: se guarda y se carga igual.
        let h = GameEngine.load(JSON.parse(JSON.stringify(data)));
        const pick = o => [o.phase, o.launch, o.go, o.wp, o.zone, o.gatherSince, o.bySea];
        T.eq(pick(h.ops.get(op2.id)), pick(op2), 'se guardan las fases');
        // Partida de antes de las fases: sin esos campos, en avance hacia el primer punto aún no alcanzado.
        for (const o of data.ops) for (const k of ['phase', 'launch', 'go', 'wp', 'zone', 'gatherSince', 'body']) delete o[k];
        h = GameEngine.load(data);
        const old = h.ops.get(op.id);
        T.eq([old.phase, old.launch, old.wp, old.zone, old.body], ['avance', 'lista', 2, S, null], 'en avance, hacia el objetivo');
        T.eq([h.ops.get(op2.id).phase, h.ops.get(op2.id).wp], ['avance', 1], 'sin ejércitos, hacia el primer punto');
        h.endTurn();
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
    // Captura de la ficha de selección múltiple (cuatro ejércitos, dos de ellos en una agrupación), en el escritorio, con
    // el rectángulo de selección a medio trazar, y en el móvil.
    const SEL_SHOTS = 'A4 · captura de la ficha de selección múltiple';
    if (!filter || SEL_SHOTS.includes(filter)) {
        ran++;
        const out = join(root, 'tools/cache/smoke');
        mkdirSync(out, { recursive: true });
        const shotPage = await browser.newPage({ viewport: { width: 1200, height: 800 } });
        const errs = [];
        shotPage.on('pageerror', e => errs.push(e.message));
        await shotPage.goto(`http://localhost:${port}/?seed=7`);
        await shotPage.waitForFunction(() => typeof GameEngine === 'function' && typeof ui === 'object');
        await shotPage.evaluate(setup);
        await shotPage.evaluate(() => {
            const g = T.uiStart('es'), es = g.player;
            ui.view.setMode('sencilla');
            const home = T.plainPair(g, es)[1];
            const xs = T.cellsAt(g, es, home, [0, 1, 2, 3]).map((c, i) => T.army(g, es, c, [30, 12, 20, 8][i], [8, 6, 0, 2][i], [6, 0, 4, 2][i]));
            g.createGroup(es, [xs[0].id, xs[1].id]);
            g.setOrder(xs[3], { kind: 'hold' });
            ui.clickCell(xs[0].cell); for (const x of xs.slice(1)) ui.clickCell(x.cell, false, true);
            ui.view.centerOn(home, 26); ui.view.ox -= 90;
            const [x0, y0] = ui.view.toScreen(G.cx[home], G.cy[home]);
            ui.view.box = { x0: x0 - 120, y0: y0 - 90, x1: x0 + 60, y1: y0 + 40 };
            ui.render();
        });
        await shotPage.waitForTimeout(300);
        await shotPage.screenshot({ path: join(out, 'seleccion-ficha.png') });
        await shotPage.setViewportSize({ width: 390, height: 844 });
        await shotPage.evaluate(() => { ui.drawerOpen = false; ui.view.box = null; ui.setSheet('grande'); ui.render(); });
        await shotPage.waitForTimeout(300);
        await shotPage.screenshot({ path: join(out, 'seleccion-ficha-movil.png') });
        if (errs.length) { failed++; console.log(`FALLA ${SEL_SHOTS}\n      ${errs.join('\n      ')}`); }
        else console.log(`ok    ${SEL_SHOTS} (${join(out, 'seleccion-ficha.png')}, seleccion-ficha-movil.png)`);
        await shotPage.close();
    }
    // Captura de la pestaña Orden de batalla: tres agrupaciones (una desplegada) y ejércitos sueltos, en escritorio y móvil.
    const OB_SHOTS = 'A4 · captura del cajón Orden de batalla';
    if (!filter || OB_SHOTS.includes(filter)) {
        ran++;
        const out = join(root, 'tools/cache/smoke');
        mkdirSync(out, { recursive: true });
        const obPage = await browser.newPage({ viewport: { width: 1200, height: 800 } });
        const errs = [];
        obPage.on('pageerror', e => errs.push(e.message));
        await obPage.goto(`http://localhost:${port}/?seed=7`);
        await obPage.waitForFunction(() => typeof GameEngine === 'function' && typeof ui === 'object');
        await obPage.evaluate(setup);
        await obPage.evaluate(() => {
            const g = T.uiStart('es'), es = g.player;
            ui.view.setMode('sencilla');
            const spot = () => T.plainPair(g, es)[1];
            const xs = [30, 12, 20, 8, 15, 6, 25, 9].map((n, i) => T.army(g, es, spot(), n, i % 3 === 0 ? 6 : 0, i % 2 ? 4 : 0));
            const a = g.createGroup(es, [xs[0].id, xs[1].id, xs[2].id]), b = g.createGroup(es, [xs[3].id, xs[4].id]), c = g.createGroup(es, [xs[5].id], { name: 'Reserva del norte' });
            g.recolorGroup(es, b.id, 3);
            g.setOrder(xs[3], { kind: 'hold' }); g.setOrder(xs[4], { kind: 'hold' });
            ui.obOpen.add(a.id); ui.obSel.add(xs[6].id); ui.obSel.add(xs[7].id);
            ui.tab = 'batalla'; ui.drawerOpen = true; ui.render();
        });
        await obPage.waitForTimeout(300);
        await obPage.screenshot({ path: join(out, 'orden-batalla.png') });
        await obPage.setViewportSize({ width: 390, height: 844 });
        await obPage.evaluate(() => { ui.setSheet('grande'); ui.drawerOpen = true; ui.render(); });
        await obPage.waitForTimeout(300);
        await obPage.screenshot({ path: join(out, 'orden-batalla-movil.png') });
        if (errs.length) { failed++; console.log(`FALLA ${OB_SHOTS}\n      ${errs.join('\n      ')}`); }
        else console.log(`ok    ${OB_SHOTS} (${join(out, 'orden-batalla.png')}, orden-batalla-movil.png)`);
        await obPage.close();
    }
    // Capturas de las agrupaciones en el mapa, en las dos vistas: de cerca con una agrupación de 5 ejércitos enfocada
    // desde el cajón, de lejos con tres agrupaciones y, a media distancia, con la capa Agrupaciones.
    const MAP_SHOTS = 'A4 · captura de las agrupaciones en el mapa';
    if (!filter || MAP_SHOTS.includes(filter)) {
        ran++;
        const out = join(root, 'tools/cache/smoke');
        mkdirSync(out, { recursive: true });
        const mp = await browser.newPage({ viewport: { width: 1200, height: 800 } });
        const errs = [], names = [];
        mp.on('pageerror', e => errs.push(e.message));
        await mp.goto(`http://localhost:${port}/?seed=7`);
        await mp.waitForFunction(() => typeof GameEngine === 'function' && typeof ui === 'object');
        await mp.evaluate(setup);
        await mp.evaluate(() => {
            const g = T.uiStart('es'), es = g.player;
            ui.drawerOpen = false;
            // Tres centros separados por unas diez casillas, cada uno con su agrupación, y unos sueltos.
            const home = T.plainPair(g, es)[1], near = g.nearCells(home, 14);
            const pick = (d, avoid) => [...near].find(([c, k]) => k === d && T.free(g, c) && g.owner[c] === es && avoid.every(o => g.nearCells(o, 8).get(c) === undefined))?.[0];
            const b = pick(10, [home]) ?? pick(9, [home]), c = pick(10, [home, b]) ?? pick(12, [home, b]);
            const mk = (center, sizes, tank) => T.cellsAt(g, es, center, [0, 1, 1, 2, 2].slice(0, sizes.length)).map((x, i) => T.army(g, es, x, sizes[i], i % 2 ? tank : 0, i === 2 ? 3 : 0));
            const A = mk(home, [30, 12, 20, 8, 15], 4), B = mk(b, [40, 30, 25], 12), C = mk(c, [10, 6, 14, 9], 0);
            const ga = g.createGroup(es, A.map(x => x.id)), gb = g.createGroup(es, B.map(x => x.id)), gc = g.createGroup(es, C.map(x => x.id), { name: 'Reserva del norte' });
            g.recolorGroup(es, gb.id, 3);
            for (const x of T.cellsAt(g, es, home, [3, 4])) T.army(g, es, x, 7);
            g.nations[es].tech.done.add('infanteria1'); g.techVersion++;   // galones bajo la franja
            window.SHOT = { home, ga: ga.id, cells: [...A, ...B, ...C].map(x => x.cell) };
        });
        const views = [['sencilla', 'sencilla'], ['realista', 'realista']];
        for (const [mode, tag] of views) {
            await mp.evaluate(m => { ui.prefs.view = m; ui.view.setMode(m); }, mode);
            if (mode === 'realista') await mp.waitForFunction(() => ui.view.realistic.state === 'ready' || ui.view.realistic.state === 'failed', null, { timeout: 60000 });
            const shot = async (name, fn) => {
                await mp.evaluate(fn);
                await mp.waitForTimeout(mode === 'realista' ? 1500 : 300);
                await mp.evaluate(() => ui.view.draw());
                await mp.screenshot({ path: join(out, name) });
                names.push(name);
            };
            // Como al pasar el ratón por su fila del cajón (renderDrawer apaga el foco con el cajón cerrado).
            await shot(`agrupaciones-cerca-${tag}.png`, () => {
                ui.select(-1); ui.view.showGroups = false; ui.tab = 'batalla'; ui.drawerOpen = true;
                ui.view.scale = 26 / G.S; ui.view.centerOn(SHOT.home, 26); ui.view.ox -= 160; ui.render(); ui.view.groupFocus = SHOT.ga;
            });
            await shot(`agrupaciones-lejos-${tag}.png`, () => { ui.drawerOpen = false; ui.view.scale = 3.5 / G.S; ui.view.centerOn(SHOT.home, 3.5); ui.render(); });
            await shot(`agrupaciones-capa-g-${tag}.png`, () => { ui.view.showGroups = true; ui.view.scale = 11 / G.S; ui.view.centerOn(SHOT.home, 11); ui.render(); });
            await mp.evaluate(() => { ui.view.showGroups = false; });
        }
        if (errs.length) { failed++; console.log(`FALLA ${MAP_SHOTS}\n      ${errs.join('\n      ')}`); }
        else console.log(`ok    ${MAP_SHOTS} (${join(out, names[0])}, ${names.slice(1).join(', ')})`);
        await mp.close();
    }
} finally {
    await browser.close();
    server.close();
}
console.log(`${ran - Math.min(failed, ran)}/${ran} pruebas superadas`);
process.exit(failed ? 1 : 0);
