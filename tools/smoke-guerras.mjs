// Pruebas de las guerras con motivo: quién la empieza y para qué, aliados que deciden si entran, cuándo se quiere la paz
// y cómo declara la IA contando con los aliados del otro.
// Mismo arnés que smoke-mando: sirve el juego por HTTP y comprueba las reglas una a una en la página.
// Uso: node basicmilitary/tools/smoke-guerras.mjs [filtro]   (CHROME=<ruta> para usar otro navegador)
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
        free: (g, c) => isLand(c) && !g.armyAt[c] && CITY_OF[c] < 0,
        // Deja a `id` con un solo ejército de `n` infanterías: su fuerza pasa a ser n veces la de una infantería.
        power(g, id, n) {
            for (const a of [...g.armies.values()]) if (a.owner === id) g.removeArmy(a);
            if (!n) return;
            const c = G.land.find(i => g.owner[i] === id && T.free(g, i));
            g.settle(g.newArmy(id, c, { infantry: n, tank: 0, artillery: 0 }, 0));
        },
        // Bloque público con los miembros dados.
        bloc(g, ...ids) { const b = g.createBloc(ids[0], 'Pacto de prueba', false); for (const x of ids) b.members.add(x); g.blocsChanged(); return b; },
        // `by` ocupa `k` casillas sin ciudad de `of` (las primeras que encuentra).
        occupy(g, by, of, k) {
            let n = 0;
            for (const c of G.land) if (n < k && g.owner[c] === of && g.legal[c] === of && T.free(g, c)) { g.owner[c] = by; n++; }
            g.version++;
            return n;
        },
        logs: (g, from = 0) => g.logs.slice(from).map(l => l.msg)
    };
};

const CHECKS = [
    ['E1 · la guerra guarda quién la empezó y su objetivo, y se carga', () => {
        const g = T.game(), es = T.nation('es'), pt = T.nation('pt');
        g.start(es);
        T.ok(g.declareWar(es, pt), 'declara');
        const w = g.rel(es, pt).war;
        T.eq([w.by, w.goal.kind, w.since], [es, 'conquista', g.turn], 'quién, motivo y desde cuándo');
        T.ok(w.goal.provinces.length > 0, 'el objetivo tiene provincias');
        const touches = pid => PROVINCES[pid].cells.some(c => [0, 1, 2, 3, 4, 5].some(d => { const j = G.nb[c * 6 + d]; return j >= 0 && g.owner[j] === es; }));
        T.ok(w.goal.provinces.every(pid => g.owner[PROVINCES[pid].city] === pt && touches(pid)), 'provincias fronterizas de Portugal que tocan España');
        const legal = id => G.land.filter(i => g.legal[i] === id).length;
        T.eq([w.start[es], w.start[pt]], [legal(es), legal(pt)], 'casillas legales de cada bando al empezar');
        const h = GameEngine.load(JSON.parse(JSON.stringify(g.serialize())));
        T.eq(h.rel(es, pt).war, w, 'se carga igual');
        h.settlePeace(es, pt, { mode: 'white' });
        T.eq([h.rel(es, pt).war, h.rel(es, pt).noWarUntil], [null, h.turn + CONFIG.TRUCE_TURNS + 10], 'la paz quita el motivo y da 10 turnos más sin volver a declarar');
        const k = GameEngine.load(JSON.parse(JSON.stringify(h.serialize())));
        T.eq(k.rel(es, pt).noWarUntil, h.rel(es, pt).noWarUntil, 'la tregua extra se guarda');
        return true;
    }],
    ['E1 · guerras de partidas viejas cargan sin by', () => {
        const g = T.game(), es = T.nation('es'), pt = T.nation('pt');
        g.start(es);
        T.power(g, es, 100); T.power(g, pt, 90);   // ninguno vencido
        g.declareWar(es, pt);
        g.turn += 3;
        const data = JSON.parse(JSON.stringify(g.serialize()));
        data.relations = data.relations.map(x => x.slice(0, 5));   // como se guardaban antes
        const h = GameEngine.load(data);
        const w = h.rel(es, pt).war;
        T.eq([h.atWar(es, pt), w.by, w.goal, w.since], [true, -1, null, g.turn - 3], 'en guerra, sin saber quién la empezó');
        T.eq([h.warState(es, pt).started, h.warState(pt, es).started], [false, false], 'ninguno la empezó');
        T.eq([h.peaceWish(es, pt).wants, h.peaceWish(pt, es).wants], [false, false], 'y las reglas nuevas se aplican: sin paz antes de 8 turnos');
        h.endTurn();
        T.ok(h.atWar(es, pt), 'se juega un turno sin paz inmediata');
        return true;
    }],
    ['E2 · el aliado lejano y débil no acude y no hay guerra ni paz con él', () => {
        const g = T.game(), es = T.nation('es'), pt = T.nation('pt'), fi = T.nation('fi');
        T.bloc(g, pt, fi);
        T.power(g, es, 100); T.power(g, pt, 60); T.power(g, fi, 10);   // Finlandia: menos del 15 % de España
        T.ok(!g.borderSets()[fi].has(es) && !g.borderSets()[fi].has(pt), 'Finlandia no toca a ninguno');
        T.eq(g.allyJoins(fi, es, pt), false, 'no entra');
        const from = g.logs.length;
        g.declareWar(es, pt);
        T.ok(!g.atWar(fi, es), 'Finlandia no está en guerra');
        const lines = T.logs(g, from);
        T.ok(lines.some(l => l.includes(`${g.nm(fi)} no acude en defensa de ${g.nm(pt)}`)), `el registro lo dice: ${lines.join(' | ')}`);
        g.aiDiplomacy(fi, g.powers());
        T.ok(!T.logs(g, from).some(l => l.startsWith('PAZ') && l.includes(g.nm(fi))), 'y no firma ninguna paz');
        return true;
    }],
    ['E2 · el aliado fronterizo y fuerte entra', () => {
        const g = T.game(), es = T.nation('es'), pt = T.nation('pt'), fr = T.nation('fr'), fi = T.nation('fi');
        T.bloc(g, pt, fr, fi);
        T.power(g, es, 100); T.power(g, pt, 30); T.power(g, fr, 60); T.power(g, fi, 50);
        T.eq(g.allyJoins(fr, es, pt, { sure: true }), true, 'Francia toca a España y el bando llega al 70 %: entra seguro');
        T.eq(g.allyJoins(fi, es, pt, { sure: true }), false, 'Finlandia, lejos, no entra seguro (solo con probabilidad)');
        g.declareWar(es, pt);
        T.ok(g.atWar(fr, es), 'Francia entra en guerra con España');
        const w = g.rel(fr, es).war;
        T.eq([w.by, w.goal.kind, w.goal.for], [fr, 'alianza', pt], 'entra por alianza, en defensa de Portugal');
        T.eq([g.warState(es, fr).started, g.warState(fr, es).started], [true, false], 'España la empezó; Francia no');
        const s = g.warSides(es, pt);
        T.ok(s.B.has(fr) && s.B.has(pt) && !s.A.has(fr), 'los bandos cuentan a Francia con Portugal');
        return true;
    }],
    ['E3 · nadie pide ni acepta la paz antes de 8 turnos salvo el vencido', () => {
        const g = T.game(), es = T.nation('es'), pt = T.nation('pt');
        g.start(pt);
        T.power(g, es, 100); T.power(g, pt, 90);
        g.declareWar(es, pt);
        T.occupy(g, pt, es, 6);   // Portugal va ganando: aun así España no acepta quedarse lo ocupado antes de tiempo
        const since = g.turn;
        for (let k = 0; k < CONFIG.WAR_MIN_TURNS; k++) {
            g.turn = since + k;
            T.eq([g.peaceWish(es, pt).wants, g.peaceWish(pt, es).wants], [false, false], `turno ${k} de guerra`);
            for (let i = 0; i < 10; i++) T.ok(!g.acceptsPeace(es, { mode: 'annex' }, false), `turno ${k}: España no acepta`);
        }
        g.turn = since + CONFIG.WAR_MIN_TURNS;
        T.eq(g.peaceWish(es, pt).wants, true, 'a los 8 turnos, España (inferior y perdiendo) sí');
        g.turn = since + 2;
        T.power(g, pt, 20);   // menos de un tercio de España: vencido
        T.eq(g.peaceWish(pt, es), { ...g.peaceWish(pt, es), wants: true, why: 'vencido' }, 'el vencido la pide');
        T.eq(g.peaceWish(es, pt).wants, false, 'el otro aún no');
        g.player = null;
        g.aiDiplomacy(pt, g.powers()); g.aiDiplomacy(es, g.powers());
        T.ok(g.atWar(es, pt), 'entre dos IA no hay paz');
        return true;
    }],
    ['E3 · el muy superior que no ha cumplido su objetivo no acepta', () => {
        const g = T.game(), es = T.nation('es'), pt = T.nation('pt');
        g.start(pt);
        T.power(g, es, 300); T.power(g, pt, 110);
        g.declareWar(es, pt);
        T.occupy(g, es, pt, 6);   // va ganando: hoy aceptaría quedarse lo ocupado
        const since = g.turn;
        for (const k of [CONFIG.WAR_MIN_TURNS, 10, g.ai.peaceAfter + 5]) {
            g.turn = since + k;
            const w = g.peaceWish(es, pt);
            T.eq([w.wants, w.why], [false, null], `turno ${k}`);
            T.ok(w.blocker && /superior/.test(w.blocker) && /objetivo/.test(w.blocker), `explica por qué: ${w.blocker}`);
            for (let i = 0; i < 10; i++) T.ok(!g.acceptsPeace(es, { mode: 'annex' }, false), `turno ${k}: no acepta`);
        }
        return true;
    }],
    ['E3 · acepta si pierde territorio, si se igualan o si la ha cumplido', () => {
        const fresh = () => {
            const g = T.game(), es = T.nation('es'), pt = T.nation('pt');
            T.power(g, es, 300); T.power(g, pt, 110);
            g.declareWar(es, pt);
            g.turn += 10;
            T.eq(g.peaceWish(es, pt).wants, false, 'de partida no la quiere');
            return { g, es, pt };
        };
        let { g, es, pt } = fresh();
        T.occupy(g, pt, es, 5);
        T.eq(g.peaceWish(es, pt).why, 'territorio', 'pierde territorio');
        ({ g, es, pt } = fresh());
        T.power(g, pt, 250);
        T.eq(g.peaceWish(es, pt).why, 'inferior', 'se igualan');
        ({ g, es, pt } = fresh());
        const goal = g.rel(es, pt).war.goal.provinces;
        T.ok(goal.length >= 2, `objetivo de varias provincias (${goal.length})`);
        for (const pid of goal) g.owner[PROVINCES[pid].city] = es;
        g.version++;
        T.eq(g.peaceWish(es, pt).why, 'objetivo', 'cumplido');
        ({ g, es, pt } = fresh());
        for (const pid of goal.slice(0, Math.ceil(goal.length / 2))) g.owner[PROVINCES[pid].city] = es;
        g.version++;
        T.eq(g.peaceWish(es, pt).wants, false, 'la mitad no basta pronto');
        g.turn = g.rel(es, pt).since + g.ai.peaceAfter + 1;
        T.eq(g.peaceWish(es, pt).why, 'objetivo', 'la mitad basta tras peaceAfter');
        return true;
    }],
    ['E3 · el defensor acepta si se estanca tras peaceAfter', () => {
        const g = T.game(), es = T.nation('es'), pt = T.nation('pt');
        T.power(g, es, 100); T.power(g, pt, 300);   // Portugal, atacado, es muy superior
        g.declareWar(es, pt);
        const since = g.turn, after = g.ai.peaceAfter;
        g.turn = since + after - 1;
        T.eq(g.peaceWish(pt, es).wants, false, 'antes de peaceAfter no');
        g.turn = since + after + 1;
        T.eq(g.peaceWish(pt, es).why, 'estancada', 'estancada: la acepta');
        g.turn = since + after - 1;
        T.occupy(g, pt, es, 3);
        g.warState(pt, es);   // gana terreno en este turno
        g.turn = since + after + 1;
        const w = g.peaceWish(pt, es);
        T.eq(w.wants, false, 'ganó terreno hace dos turnos: aún no');
        T.ok(w.blocker && /estanca/.test(w.blocker), `explica cuándo: ${w.blocker}`);
        g.turn = since + after + 5;
        T.eq(g.peaceWish(pt, es).why, 'estancada', 'seis turnos sin ganar: sí');
        T.eq(g.warState(es, pt).started && g.peaceWish(es, pt).why, 'inferior', 'el atacante, inferior, también');
        return true;
    }],
    ['E4 · no declara si los aliados probables del otro le dan la vuelta', () => {
        const run = (ally, power, esPower = 100) => {
            const g = T.game(), es = T.nation('es'), pt = T.nation('pt');
            g.ai = { ...g.ai, warChance: 1, warFrom: 0, maxWars: 5, warRatio: 1.6 };
            for (const b of g.borderSets()[es]) if (b !== pt) g.rel(es, b).truceUntil = 1e6;   // solo puede ir a por Portugal
            T.bloc(g, pt, T.nation(ally));
            T.power(g, es, esPower); T.power(g, pt, 50); T.power(g, T.nation(ally), power);
            g.aiDiplomacy(es, g.powers());
            return g.atWar(es, pt);
        };
        T.eq(run('fr', 60), false, 'Francia, fronteriza y fuerte, entraría seguro: no declara');
        T.eq(run('fi', 14), true, 'Finlandia, lejana y débil, no entraría: declara');
        T.eq(run('fi', 40, 100), false, 'Finlandia dudosa cuenta la mitad: con 100 no basta');
        T.eq(run('fi', 40, 120), true, 'con 120 sí');
        return true;
    }],
    ['E3 · 30 turnos de Europa en Caos total: ninguna guerra de 1–2 turnos salvo vencidos', () => {
        const out = [];
        for (const seed of [1, 2]) {
            const g = new GameEngine(seed);
            g.configure({ aggression: 'caos', alliances: 'reales', victory: 1, fog: false });
            g.start(T.nation('ru'));
            const n = g.nations.length, open = new Map(), done = [];
            let crushed = false;
            const settle = g.settlePeace.bind(g);
            g.settlePeace = (a, b, terms) => {
                crushed = g.warState(a, b).crushed || g.warState(b, a).crushed;
                settle(a, b, terms);
                scan();
                crushed = false;
            };
            const scan = () => {
                for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
                    const k = a * n + b, w = g.atWar(a, b) && g.nations[a].alive && g.nations[b].alive;
                    if (w && !open.has(k)) open.set(k, g.turn);
                    else if (!w && open.has(k)) {
                        const dead = !g.nations[a].alive || !g.nations[b].alive;
                        done.push({ a, b, d: g.turn - open.get(k), ok: dead || crushed });
                        open.delete(k);
                    }
                }
            };
            for (let t = 0; t < 30 && !g.over; t++) {
                if (!g.beginAiPhase()) break;
                for (const id of g.aiOrder()) { g.aiStep(id); scan(); }
                g.finishAiPhase(); scan();
            }
            const short = done.filter(w => w.d <= 2 && !w.ok);
            T.ok(done.length + open.size > 10, `semilla ${seed}: hay guerras (${done.length + open.size})`);
            T.eq(short.map(w => `${g.nations[w.a].key}-${g.nations[w.b].key}:${w.d}`), [], `semilla ${seed}: guerras de 1–2 turnos sin vencido`);
            out.push(`${seed}: ${done.length} acabadas, ${open.size} abiertas`);
        }
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
