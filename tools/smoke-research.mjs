// Pruebas del motor en el navegador: investigación, movimiento, inteligencia y partidas guardadas.
// Sirve el juego por HTTP, crea partidas nuevas con GameEngine y comprueba las reglas una a una.
// Uso: node basicmilitary/tools/smoke-research.mjs [filtro]   (CHROME=<ruta> para usar otro navegador)
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
// Ayudantes disponibles en la página (se definen en `setup`): T.game(seed), T.nation(key), T.eq(a, b, msg).
const setup = () => {
    window.T = {
        game(seed = 7) { const g = new GameEngine(seed); g.configure({ aggression: 'normal', alliances: 'ninguna', victory: 1, fog: false }); return g; },
        nation: key => E.countries.findIndex(c => c.key === key),
        eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); },
        ok(c, msg) { if (!c) throw new Error(msg); },
        // Da por investigadas estas investigaciones.
        learn(g, id, ...ids) { for (const t of ids) g.nations[id].tech.done.add(t); g.techVersion++; },
        free: (g, c) => isLand(c) && !g.armyAt[c] && CITY_OF[c] < 0,
        // Casilla llana de `owner`, sin ciudad, con sus seis vecinas de tierra libres; y una vecina sin río por medio.
        plainPair(g, owner) {
            for (const c of G.land) {
                if (g.owner[c] !== owner || CELL_TERRAIN[c] !== 'plain' || !T.free(g, c)) continue;
                const nbs = [0, 1, 2, 3, 4, 5].map(d => G.nb[c * 6 + d]);
                if (!nbs.every(j => j >= 0 && T.free(g, j))) continue;
                const d = [0, 1, 2, 3, 4, 5].find(k => !RIVER[c * 6 + k]);
                if (d !== undefined) return [G.nb[c * 6 + d], c];
            }
            throw new Error('no hay casilla llana libre');
        },
        // Rodea con `k` ejércitos de `enemy` una casilla de `owner` (la dada o una libre).
        surround(g, owner, enemy, k, cell) {
            const c = cell ?? T.plainPair(g, owner)[1];
            for (let d = 0; d < k; d++) { const j = G.nb[c * 6 + d]; g.settle(g.newArmy(enemy, j, { infantry: 1, tank: 0, artillery: 0 }, 0)); }
            return c;
        },
        // Primer paso u → dirección d entre casillas de tierra que cumple la condición.
        // Empieza una partida en la interfaz con el país dado y devuelve su motor.
        uiStart(key) {
            for (const d of document.querySelectorAll('dialog[open]')) d.close();
            ui.setGame(T.game(7));
            ui.choice = T.nation(key); ui.render();
            document.querySelector('[data-action="start"]').click();
            return ui.game;
        },
        edge(g, pred) {
            for (const u of G.land) for (let d = 0; d < 6; d++) { const v = G.nb[u * 6 + d]; if (v >= 0 && isLand(v) && pred(u, v, d)) return [u, d]; }
            throw new Error('no hay tramo así');
        }
    };
};

const CHECKS = [
    ['F0 · el punto de movimiento son 12 subpuntos', () => {
        T.eq(MOVE, 12, 'MOVE');
        T.eq(CONFIG.ROAD_MOVE, { 1: 6, 2: 4 }, 'carretera y autopista');
        T.eq(CONFIG.RIVER_CROSSING, 6, 'río');
        return true;
    }],
    ['F0 · una partida antigua (6 subpuntos) duplica el movimiento gastado al cargarla', () => {
        const g = T.game(), es = T.nation('es');
        g.start(es);
        const [a, b] = [...g.armies.values()].filter(x => x.owner === es);
        a.used = 3; b.used = 999;
        const data = g.serialize();
        delete data.move;
        const h = GameEngine.load(JSON.parse(JSON.stringify(data)));
        T.eq(h.armies.get(a.id).used, 6, 'movimiento gastado');
        T.eq(h.armies.get(b.id).used, 999, 'ejército que ya no se mueve');
        const k = GameEngine.load(JSON.parse(JSON.stringify(g.serialize())));
        T.eq(k.armies.get(a.id).used, 3, 'partida nueva: sin conversión');
        return true;
    }],

    ['F1 · el árbol: 12 ramas de 3 niveles', () => {
        T.eq(TECHS.length, 36, 'investigaciones');
        T.eq(RESEARCH_BRANCHES.length, 12, 'ramas');
        for (const b of RESEARCH_BRANCHES) T.eq(TECHS.filter(t => t.branch === b.id).map(t => t.tier), [1, 2, 3], b.id);
        T.ok(TECHS.every(t => TECH_BY_ID.get(t.id) === t), 'índice por id');
        return true;
    }],
    ['F1 · investigar cobra al empezar y termina en sus turnos', () => {
        const g = T.game(), es = T.nation('es');
        g.start(es);
        const n = g.nations[es];
        n.gold = 100000;
        const cost = Math.round(Math.max(80, g.income(es) * 4));
        T.eq(g.researchCost(es, 'infanteria1'), cost, 'coste de nivel 1');
        T.eq(g.techState(es, 'infanteria2'), 'locked', 'nivel 2 sin el 1');
        T.ok(!g.startResearch(es, 'infanteria2'), 'no deja empezar el nivel 2');
        T.ok(g.startResearch(es, 'infanteria1'), 'empieza');
        T.eq(n.gold, 100000 - cost, 'oro tras pagar');
        T.eq(g.techState(es, 'infanteria1'), 'current', 'en curso');
        for (let t = 0; t < 5; t++) g.beginNationTurn(es);
        T.eq(g.techState(es, 'infanteria1'), 'current', 'tras 5 turnos sigue en curso');
        g.beginNationTurn(es);
        T.eq(g.techState(es, 'infanteria1'), 'done', 'tras 6 turnos, hecha');
        T.eq(g.techState(es, 'infanteria2'), 'open', 'el nivel 2 queda disponible');
        T.ok(g.logs.some(l => /Investigación terminada: Fusil de asalto moderno/.test(l.msg)), 'aviso en el registro');
        T.eq(g.researchCost(es, 'blindados1'), Math.round(Math.max(80, g.income(es) * 4) * 1.1), '+10 % por cada una terminada');
        return true;
    }],
    ['F1 · sin oro no se investiga', () => {
        const g = T.game(), es = T.nation('es');
        g.start(es);
        g.nations[es].gold = 10;
        T.ok(!g.startResearch(es, 'infanteria1'), 'no empieza');
        T.eq(g.nations[es].gold, 10, 'no cobra');
        return true;
    }],
    ['F1 · cambiar de investigación pausa la anterior y reanudar no cuesta', () => {
        const g = T.game(), es = T.nation('es');
        g.start(es);
        const n = g.nations[es];
        n.gold = 100000;
        g.startResearch(es, 'infanteria1');
        g.beginNationTurn(es); g.beginNationTurn(es);
        g.startResearch(es, 'blindados1');
        T.eq(g.techState(es, 'infanteria1'), 'paused', 'la anterior en pausa');
        T.eq(g.techProgress(es, 'infanteria1'), 2, 'progreso guardado');
        const gold = n.gold;
        T.ok(g.startResearch(es, 'infanteria1'), 'reanuda');
        T.eq(n.gold, gold, 'reanudar no cuesta');
        T.eq(g.techState(es, 'blindados1'), 'paused', 'la otra queda en pausa');
        g.pauseResearch(es, 'infanteria1');
        T.eq(n.tech.current, [], 'pausar libera el laboratorio');
        return true;
    }],
    ['F1 · las reglas son de cada país', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es);
        g.nations[es].tech.done.add('infanteria1'); g.techVersion++;
        T.eq(g.rules(es).types.infantry.atk, 6, 'España');
        T.eq(g.rules(fr).types.infantry.atk, 5, 'Francia');
        T.eq(CONFIG.TYPES.infantry.atk, 5, 'CONFIG intacto');
        return true;
    }],
    ['F1 · la investigación se guarda, se valida y las partidas antiguas cargan sin ella', () => {
        const g = T.game(), es = T.nation('es');
        g.start(es);
        g.nations[es].gold = 100000;
        g.startResearch(es, 'infanteria1');
        for (let t = 0; t < 6; t++) g.beginNationTurn(es);
        g.startResearch(es, 'infanteria2'); g.beginNationTurn(es);
        g.startResearch(es, 'ciencia1');
        const data = JSON.parse(JSON.stringify(g.serialize()));
        const h = GameEngine.load(data);
        T.eq([...h.nations[es].tech.done], ['infanteria1'], 'hechas');
        T.eq([...h.nations[es].tech.progress], [['infanteria2', 1], ['ciencia1', 0]], 'progreso');
        T.eq(h.nations[es].tech.current, ['ciencia1'], 'en curso');
        T.eq(h.rules(es).types.infantry.atk, 6, 'reglas tras cargar');
        data.nations[es].tech = { done: ['infanteria3', 'nada', 'blindados1'], progress: [['infanteria2', 99], ['x', 1]], current: ['infanteria2', 'blindados1'] };
        const bad = GameEngine.load(data);
        T.eq([...bad.nations[es].tech.done], ['blindados1'], 'descarta ids raros y requisitos incumplidos');
        T.eq([...bad.nations[es].tech.progress], [], 'descarta progreso imposible');
        T.eq(bad.nations[es].tech.current, [], 'descarta lo que no está en progreso');
        delete data.nations[es].tech;
        T.eq(GameEngine.load(data).nations[es].tech.done.size, 0, 'partida antigua');
        return true;
    }],

    ['F2 · tropas: ataque, defensa y velocidad según el dueño', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); g.declareWar(es, fr);
        const [from, cell] = T.plainPair(g, fr);
        const def = { owner: fr, units: { infantry: 1, tank: 0, artillery: 0 } }, att = { infantry: 2, tank: 1, artillery: 1 };
        T.eq(g.combatFactors(es, att, from, def, cell).baseAtk, 2 * 5 + 20 + 40, 'ataque sin investigar');
        T.learn(g, es, 'infanteria1', 'blindados1', 'blindados2', 'artilleria1');
        T.eq(g.combatFactors(es, att, from, def, cell).baseAtk, 2 * 6 + 24 + 46, 'ataque investigado');
        T.learn(g, fr, 'infanteria1', 'infanteria2');
        T.eq(g.combatFactors(es, att, from, def, cell).baseDef, 8, 'defensa del defensor con sus reglas');
        const city = g.nations[es].capitalCell;
        const inf = { infantry: 1, tank: 0, artillery: 0 };
        T.eq(g.moveBudget(es, city, inf, 0), 4 * MOVE, 'velocidad base');
        T.learn(g, es, 'infanteria2', 'infanteria3');
        T.eq(g.moveBudget(es, city, inf, 0), 5 * MOVE, 'infantería mecanizada');
        T.eq(g.powers()[es] > 0, true, 'poder calculado');
        return true;
    }],
    ['F2 · doctrina: rodeado, asedio y bajas', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); g.declareWar(es, fr);
        const cell = T.surround(g, es, fr, 3);
        T.eq(g.flankFactor(es, cell), 0.75, 'rodeado sin investigar');
        T.learn(g, es, 'doctrina1');
        T.eq(g.flankFactor(es, cell), 0.85, 'rodeado con Mando y control');
        T.learn(g, es, 'doctrina2');
        T.eq(g.rules(es).siegeTurns, 2, 'asedio');
        // Sanidad militar: la misma batalla, con la misma suerte, cuesta menos al vencedor.
        const lost = withTech => {
            const h = T.game(11); h.start(es); h.declareWar(es, fr);
            if (withTech) T.learn(h, es, 'doctrina1', 'doctrina2', 'doctrina3');
            const [from, to] = T.plainPair(h, fr);
            for (const c of [from, to]) { const x = h.armyOn(c); if (x) h.removeArmy(x); }
            h.owner[from] = es;
            const a = h.newArmy(es, from, { infantry: 40, tank: 0, artillery: 0 }, 0); h.settle(a);
            const d = h.newArmy(fr, to, { infantry: 10, tank: 0, artillery: 0 }, 0); h.settle(d);
            h.battle(a, d, to);
            return 40 - countUnits(a.units);
        };
        const [plainLoss, medLoss] = [lost(false), lost(true)];
        T.ok(medLoss < plainLoss, `bajas del vencedor ${medLoss} < ${plainLoss}`);
        return true;
    }],
    ['F2 · movilización: cupo de reclutas', () => {
        const g = T.game(), es = T.nation('es');
        g.start(es);
        const cap = PROVINCES.find(p => p.city === g.nations[es].capitalCell), other = PROVINCES.find(p => p.country === es && p !== cap);
        const b0 = g.recruitCap(es, cap), o0 = g.recruitCap(es, other);
        T.learn(g, es, 'movilizacion1');
        T.eq([g.recruitCap(es, cap), g.recruitCap(es, other)], [b0 + 1, o0 + 1], 'servicio militar');
        T.ok(g.recruitBreakdown(es, other).some(([w, n]) => w === 'investigación' && n === 1), 'línea en el desglose');
        T.learn(g, es, 'movilizacion2');
        T.eq(g.recruitCap(es, cap), b0 + 1 + 2, 'academias: capital +4');
        T.learn(g, es, 'movilizacion3');
        T.eq(g.recruitCap(es, cap), Math.floor((b0 + 3) * 1.5), 'movilización general ×1,5');
        T.eq(g.recruitCap(es, other), Math.floor((o0 + 1) * 1.5), 'otra provincia ×1,5');
        return true;
    }],
    ['F2 · ciencia: turnos, coste y segundo laboratorio', () => {
        const g = T.game(), es = T.nation('es');
        g.start(es);
        g.nations[es].gold = 1e6;
        T.learn(g, es, 'ciencia1');
        T.eq(['infanteria1', 'infanteria2', 'infanteria3'].map(t => g.techTurns(es, t)), [5, 8, 11], 'Universidades');
        const c = g.researchCost(es, 'blindados1');
        T.learn(g, es, 'ciencia2');
        T.ok(c > 0, 'coste');
        T.eq(g.researchCost(es, 'blindados1'), Math.round(Math.max(80, g.income(es) * 4) * 1.2 * 0.7), 'Institutos: −30 %');
        T.learn(g, es, 'ciencia3');
        g.startResearch(es, 'blindados1'); g.startResearch(es, 'infanteria1');
        T.eq(g.nations[es].tech.current, ['blindados1', 'infanteria1'], 'dos a la vez');
        return true;
    }],
    ['F2 · industria: renta y descuentos de los yacimientos', () => {
        const g = T.game(), es = T.nation('es');
        g.start(es);
        const id = g.nations.map(n => n.id).sort((a, b) => g.economy(b).res - g.economy(a).res)[0];
        const e0 = g.economy(id);
        T.ok(e0.res > 0, 'hay un país con yacimientos');
        const pid = [...e0.access.keys()][0];
        const tank0 = g.unitCost(id, 'tank', pid);
        T.learn(g, id, 'industria1');
        const e1 = g.economy(id);
        T.ok(e1.industry >= e0.industry && (e0.industry === 0 || e1.industry > e0.industry), `industria ${e0.industry} → ${e1.industry}`);
        T.learn(g, id, 'industria2');
        T.ok(g.unitCost(id, 'tank', pid) <= tank0, 'tanque igual o más barato');
        T.learn(g, id, 'industria3');
        T.ok(Math.abs(g.economy(id).res - Math.round(e0.res * 1.5)) <= 1, `renta de yacimientos ×1,5: ${e0.res} → ${g.economy(id).res}`);
        return true;
    }],
    ['F2 · infraestructura: precio, tramos más rápidos y suministro', () => {
        const g = T.game(), es = T.nation('es');
        g.start(es);
        const cap = g.nations[es].capitalCell;
        const target = PROVINCES.find(p => p.country === es && p.city !== cap).city;
        const p0 = g.planRoad(es, cap, c => c === target, 1);
        T.learn(g, es, 'infraestructura1');
        const p1 = g.planRoad(es, cap, c => c === target, 1);
        T.ok(Math.abs(p1.cost - p0.cost * 0.7) <= 1, `carretera −30 %: ${p0.cost} → ${p1.cost}`);
        const d = [0, 1, 2, 3, 4, 5].find(k => { const j = G.nb[cap * 6 + k]; return j >= 0 && isLand(j) && g.owner[j] === es; });
        T.eq(g.stepCost(es, cap, d, false) > 0, true, 'paso sin carretera');
        g.road[cap * 6 + d] = 1; g.road[G.nb[cap * 6 + d] * 6 + (d + 3) % 6] = 1; g.roadVersion++;
        T.eq(g.stepCost(es, cap, d, false), 6, 'carretera ½');
        T.learn(g, es, 'infraestructura2');
        T.eq(g.stepCost(es, cap, d, false), 4, 'carretera ⅓');
        g.road[cap * 6 + d] = 2; g.road[G.nb[cap * 6 + d] * 6 + (d + 3) % 6] = 2; g.roadVersion++;
        T.eq(g.stepCost(es, cap, d, false), 4, 'autopista ⅓');
        const supplied = () => g.supplyMap(es).filter(x => x >= 0).length;
        const s0 = supplied();
        T.learn(g, es, 'infraestructura3');
        T.eq(g.stepCost(es, cap, d, false), 3, 'autopista ¼');
        T.ok(supplied() > s0, `más casillas abastecidas: ${s0} → ${supplied()}`);
        return true;
    }],
    ['F2 · movilidad: montaña, bosque y ríos', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es);
        const step = kind => T.edge(g, (u, v, d) => CELL_TERRAIN[v] === kind && !RIVER[u * 6 + d] && !g.road[u * 6 + d]);
        const [mu, md] = step('mountain'), [fu, fd] = step('forest');
        T.eq(g.stepCost(es, mu, md, false), 3 * MOVE, 'montaña');
        T.eq(g.stepCost(es, fu, fd, false), 2 * MOVE, 'bosque');
        T.learn(g, es, 'movilidad1');
        T.eq(g.stepCost(es, mu, md, false), 2 * MOVE, 'tropas de montaña');
        T.learn(g, es, 'movilidad2');
        T.eq(g.stepCost(es, fu, fd, false), 1.5 * MOVE, 'tropas de bosque');
        const [ru, rd] = T.edge(g, (u, v, d) => RIVER[u * 6 + d] && CELL_TERRAIN[v] === 'plain' && !g.road[u * 6 + d]);
        T.eq(g.stepCost(es, ru, rd, false), MOVE + 6, 'río sin puente');
        T.eq(g.stepCost(fr, ru, rd, false), MOVE + 6, 'Francia sigue pagando el río');
        T.learn(g, es, 'movilidad3');
        T.eq(g.stepCost(es, ru, rd, false), MOVE, 'pontoneros');
        g.declareWar(es, fr);
        const def = { owner: fr, units: { infantry: 1, tank: 0, artillery: 0 } }, v = G.nb[ru * 6 + rd];
        T.ok(!g.combatFactors(es, { infantry: 1, tank: 0, artillery: 0 }, ru, def, v).parts.some(([n]) => n === 'río'), 'sin defensa de río frente a pontoneros');
        T.ok(g.combatFactors(fr, { infantry: 1, tank: 0, artillery: 0 }, ru, { owner: es, units: def.units }, v).parts.some(([n]) => n === 'río'), 'los demás sí la sufren');
        return true;
    }],
    ['F2 · fortificación: defensa, obra, tope, muro, rodeado y precio', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es); g.declareWar(es, fr);
        const [from, cell] = T.plainPair(g, es);
        g.fort[cell] = 1;
        const def = { owner: es, units: { infantry: 1, tank: 0, artillery: 0 } }, att = { infantry: 1, tank: 0, artillery: 0 };
        const fortPart = () => g.combatFactors(fr, att, from, def, cell).parts.find(([n]) => n === 'fortificación')[1];
        T.eq(fortPart(), 1.75, 'sin investigar');
        T.learn(g, es, 'fortificacion1');
        T.eq(fortPart(), 2, 'hormigón');
        const a = PROVINCES.find(p => p.country === es && p.city !== g.nations[es].capitalCell).city;
        const plan = g.planFort(es, a, a);
        g.nations[es].gold = 1e5;
        g.buildFort(es, plan);
        T.eq(g.fortWork.get(a).left, 2, 'obra de 2 turnos');
        T.eq(g.combatFactors(fr, att, from, def, cell).cap, 3, 'tope ×3');
        const wall0 = g.stepCost(fr, from, G.dirTo(from, cell), true);
        T.learn(g, es, 'fortificacion2');
        T.eq(g.combatFactors(fr, att, from, def, cell).cap, 3.5, 'búnkeres: tope ×3,5');
        T.eq(g.stepCost(fr, from, G.dirTo(from, cell), true), wall0 + MOVE, 'cruzar el muro cuesta un punto más');
        const ring = T.surround(g, es, fr, 3, cell);
        T.eq(g.flankFactor(es, ring), 0.75, 'rodeado en el muro');
        T.learn(g, es, 'fortificacion3');
        T.eq(g.flankFactor(es, ring), 1, 'casamatas: sin penalización');
        const b = PROVINCES.filter(p => p.country === es)[2].city;
        T.eq(g.planFort(es, b, b).cost, 25, 'fortificar cuesta 25');
        return true;
    }],

    ['F3 · la IA investiga sin desarmarse y la partida es reproducible', () => {
        const run = () => {
            const g = new GameEngine(5);
            g.configure({ aggression: 'agresiva', alliances: 'reales', victory: 1, fog: false });
            g.start(T.nation('ru'));
            for (let t = 0; t < 40 && !g.over; t++) g.endTurn();
            return g;
        };
        const g = run();
        const alive = g.nations.filter(n => n.alive && n.id !== g.player);
        const idle = alive.filter(n => !n.tech.done.size && !n.tech.current.length);
        T.ok(idle.length <= alive.length / 10, `sin investigar: ${idle.map(n => n.key).join(', ')}`);
        const unarmed = alive.filter(n => g.citiesOf(n.id).length && ![...g.armies.values()].some(a => a.owner === n.id));   // sin ciudades no se puede reclutar
        T.ok(!unarmed.length, `sin ejército: ${unarmed.map(n => `${n.key} oro ${n.gold} guerra ${g.enemiesOf(n.id).length} ciudades ${g.citiesOf(n.id).length} hechas ${n.tech.done.size} curso ${n.tech.current}`).join('; ')}`);
        T.ok(alive.every(n => n.gold >= 0), 'nadie en números rojos');
        T.ok(!alive.some(n => [...n.tech.done].some(t => TECH_BY_ID.get(t).branch === 'reconocimiento' || TECH_BY_ID.get(t).branch === 'espionaje')), 'la IA no investiga inteligencia');
        const total = alive.reduce((s, n) => s + n.tech.done.size, 0);
        T.eq(JSON.stringify(run().serialize()), JSON.stringify(g.serialize()), 'misma semilla, misma partida');
        return total > 0 || 'nadie terminó nada';
    }],

    ['F4 · la tecla I abre el diálogo con las 36 investigaciones y sus filtros', () => {
        T.uiStart('es');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true }));
        T.ok($('#research-dialog').open, 'diálogo abierto');
        T.eq(document.querySelectorAll('#research-dialog .rs-node').length, 36, 'casillas');
        document.querySelector('#research-dialog [data-action="rs-filter"][data-area="Militar"]').click();
        T.eq(document.querySelectorAll('#research-dialog .rs-node').length, 12, 'filtro Militar');
        document.querySelector('#research-dialog [data-action="rs-filter"][data-area="Todas"]').click();
        T.eq(document.querySelectorAll('#research-dialog .rs-node.locked').length, 24, 'niveles 2 y 3 cerrados');
        $('#research-dialog').close();
        return true;
    }],
    ['F4 · investigar desde el diálogo, la cabecera y el aviso de laboratorio libre', () => {
        const g = T.uiStart('es'), p = g.player;
        g.nations[p].gold = 100000; ui.render();
        T.ok($('#end-turn').classList.contains('nudge'), 'aviso con el laboratorio libre');
        T.ok(/Laboratorio libre/.test($('#fig-research').textContent), 'cabecera libre');
        ui.openResearch();
        document.querySelector('#research-dialog .rs-node[data-tech="blindados1"]').click();
        T.ok(/Blindaje compuesto/.test($('#research-dialog .rs-card').textContent), 'ficha de la seleccionada');
        document.querySelector('#research-dialog [data-action="rs-start"]').click();
        T.eq(g.nations[p].tech.current, ['blindados1'], 'en curso');
        T.ok(/Blindaje compuesto/.test($('#fig-research').textContent), 'cabecera: en curso');
        T.ok(!$('#end-turn').classList.contains('nudge'), 'sin aviso');
        T.ok(document.querySelector('#research-dialog .rs-node[data-tech="blindados1"]').classList.contains('current'), 'casilla en curso');
        document.querySelector('#research-dialog [data-action="rs-pause"]').click();
        T.eq(g.nations[p].tech.current, [], 'pausada');
        T.ok(document.querySelector('#research-dialog .rs-node[data-tech="blindados1"]').classList.contains('paused'), 'casilla en pausa');
        $('#research-dialog').close();
        return true;
    }],
    ['F4 · al terminar una investigación sale un aviso', async () => {
        const g = T.uiStart('es'), p = g.player;
        g.nations[p].gold = 100000;
        g.startResearch(p, 'infanteria1');
        g.nations[p].tech.progress.set('infanteria1', g.techTurns(p, 'infanteria1') - 1);
        ui.prefs.watch = 'directo';
        await ui.endTurnFlow();
        T.ok(g.nations[p].tech.done.has('infanteria1'), 'terminada');
        T.ok(/Investigación terminada/.test($('#toasts').textContent), 'aviso en pantalla');
        T.ok($('#end-turn').classList.contains('nudge'), 'laboratorio libre otra vez');
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
