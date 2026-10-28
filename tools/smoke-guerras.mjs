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
        // Empieza una partida en la interfaz con el país dado y devuelve su motor.
        uiStart(key, fog = false) {
            for (const d of document.querySelectorAll('dialog[open]')) d.close();
            ui.setGame(T.game(7, fog));
            ui.choice = T.nation(key); ui.render();
            document.querySelector('[data-action="start"]').click();
            return ui.game;
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
        T.ok(!('start' in w), 'sin casillas al empezar: lo ganado y lo perdido se mide por lo ocupado');
        const h =GameEngine.load(JSON.parse(JSON.stringify(g.serialize())));
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
        T.power(g, pt, 20);   // menos de un tercio de España y ya ha perdido el 15 % de su tierra: vencido
        T.occupy(g, es, pt, Math.ceil(G.land.filter(c => g.legal[c] === pt).length * CONFIG.CRUSH_LOST));
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
        for (const k of [CONFIG.WAR_MIN_TURNS, 10]) {   // más allá de peaceAfter, ver la salida por tiempo
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
        g.trackWarGains();   // gana terreno en este turno
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
    ['E5 · el cajón explica por qué no acepta la paz y qué la haría aceptar', () => {
        const start = fog => {
            const g = T.uiStart('es', fog), es = g.player, fr = T.nation('fr');
            T.power(g, es, 100); T.power(g, fr, 300);
            g.declareWar(fr, es);
            g.turn = g.rel(es, fr).since + 10;
            ui.drawerOpen = true; ui.tab = 'paises'; ui.focusNation = fr; ui.render();
            return { g, es, fr, text: document.querySelector('#drawer-body').innerText };
        };
        let { g, fr, text } = start(false);
        const name = g.nm(fr);
        T.ok(new RegExp(`La declaró ${name}`).test(text) && /conquistar/.test(text), `quién y para qué: ${text}`);
        T.ok(/10 turnos/.test(text), 'turnos de guerra');
        T.ok(/Tu bando\s+fuerza \d+/.test(text) && /Su bando\s+fuerza \d+/.test(text), `fuerza de cada bando: ${JSON.stringify(text)}`);
        T.ok(/No aceptará la paz: se ve muy superior/.test(text) && /si pierde territorio, si se igualan fuerzas/.test(text), `qué la haría aceptar: ${text}`);
        // Si se iguala, dice que aceptaría y por qué.
        T.power(g, g.player, 300); ui.render();
        text = document.querySelector('#drawer-body').innerText;
        T.ok(/Aceptaría la paz: se ve inferior/.test(text), `aceptaría: ${text}`);
        // El diálogo de paz lo muestra igual.
        T.power(g, g.player, 100);
        ui.peace = { target: fr, mode: 'annex', keep: true, mine: -1, satGains: 'self' };
        ui.renderPeaceDialog();
        T.ok(/No aceptará la paz: se ve muy superior/.test(document.querySelector('#peace-body').innerText), 'en el diálogo de paz');
        // Con niebla no se ve la fuerza del otro bando ni se deduce de la frase.
        ({ g, text } = start(true));
        T.ok(/Su bando\s+fuerza \?/.test(text), `niebla: fuerza del otro bando oculta: ${text}`);
        T.ok(!/muy superior/.test(text) && /No aceptará la paz/.test(text), `niebla: sin revelar la relación de fuerzas: ${text}`);
        return true;
    }],
    ['E5 · el registro dice por qué propone la paz', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es);
        T.power(g, es, 300); T.power(g, fr, 100);
        g.declareWar(es, fr);
        g.turn = g.rel(es, fr).since + 10;
        const from = g.logs.length;
        g.aiDiplomacy(fr, g.powers());
        const pr = g.proposals.find(p => p.kind === 'paz' && p.from === fr);
        T.ok(pr && pr.why === 'inferior', `propuesta con motivo: ${JSON.stringify(g.proposals)}`);
        T.ok(T.logs(g, from).includes(`${g.nm(fr)} propone la paz: se ve inferior.`), `registro: ${T.logs(g, from)}`);
        g.aiDiplomacy(fr, g.powers());
        T.eq(T.logs(g, from).filter(m => /propone la paz/.test(m)).length, 1, 'una sola vez');
        return true;
    }],
    ['E5 · «no acude en defensa» en el registro', () => {
        const g = T.game(7), es = T.nation('es'), pt = T.nation('pt'), ru = T.nation('ru'), fr = T.nation('fr');
        g.start(es);
        T.power(g, ru, 10); T.power(g, fr, 400);
        T.bloc(g, pt, ru);   // Portugal y Rusia: aliados públicos; Rusia, lejana y débil, no acude
        const from = g.logs.length;
        g.declareWar(fr, pt);
        T.ok(!g.atWar(ru, fr), 'Rusia no entra');
        T.ok(T.logs(g, from).includes(`${g.nm(ru)} no acude en defensa de ${g.nm(pt)}.`), `registro: ${T.logs(g, from)}`);
        return true;
    }],
    ['C1 · el objetivo son provincias legales del atacado, y la guerra con un objetivo imposible termina', () => {
        // La sonda de la revisión: Portugal ocupa una provincia española que toca Francia y Francia le declara la guerra.
        const g = T.game(), fr = T.nation('fr'), es = T.nation('es'), pt = T.nation('pt'), it = T.nation('it');
        g.start(it);
        const touchesFr = c => [0, 1, 2, 3, 4, 5].some(d => { const j = G.nb[c * 6 + d]; return j >= 0 && g.owner[j] === fr; });
        const pid = PROVINCES.findIndex(p => p.country === es && p.cells.some(touchesFr));
        for (const c of PROVINCES[pid].cells) g.owner[c] = pt;
        g.version++;
        T.power(g, fr, 200); T.power(g, pt, 10);
        g.declareWar(fr, pt);
        const goal = g.rel(fr, pt).war.goal.provinces;
        T.ok(!goal.includes(pid), `la provincia española ocupada no entra en el objetivo: ${goal.map(p => PROVINCES[p].name)}`);
        T.ok(goal.length && goal.every(p => g.legal[PROVINCES[p].city] === pt), 'solo provincias de Portugal');
        for (const c of PROVINCES[pid].cells) g.owner[c] = es;   // vuelve a España, que no está en esta guerra
        g.version++;
        const since = g.turn, after = g.ai.peaceAfter;
        for (let k = 0; k < 3 * after && g.atWar(fr, pt); k++) {
            g.turn++;
            g.trackWarGains();
            const pw = g.powers();
            g.aiDiplomacy(fr, pw); g.aiDiplomacy(pt, pw);
        }
        T.ok(!g.atWar(fr, pt), 'la guerra termina');
        T.ok(g.turn - since <= 2 * after, `antes de 2 × peaceAfter (${g.turn - since} turnos)`);
        return true;
    }],
    ['C1 · la provincia que deja de ser legalmente del atacado sale del objetivo; sin ninguna, cumplido', () => {
        const g = T.game(), es = T.nation('es'), pt = T.nation('pt'), fr = T.nation('fr');
        T.power(g, es, 300); T.power(g, pt, 110);
        g.declareWar(es, pt);
        const goal = g.rel(es, pt).war.goal.provinces;
        T.ok(goal.length >= 2, `objetivo de varias provincias (${goal.length})`);
        g.turn += 10;
        const [first, ...rest] = goal;
        g.owner[PROVINCES[first].city] = es;
        for (const pid of rest) for (const c of PROVINCES[pid].cells) g.legal[c] = fr;   // las demás, de un tercero tras otra paz
        g.version++;
        T.eq(g.peaceWish(es, pt).why, 'objetivo', 'tiene la única que sigue siendo de Portugal: cumplido');
        g.owner[PROVINCES[first].city] = pt;
        for (const c of PROVINCES[first].cells) g.legal[c] = fr;
        g.version++;
        T.eq(g.peaceWish(es, pt).why, 'objetivo', 'ninguna sigue siendo de Portugal: cumplido');
        return true;
    }],
    ['C1 · salida por tiempo: estancada tras peaceAfter también para quien la empezó y, tras 2 × peaceAfter, siempre', () => {
        const run = stopAt => {
            const g = T.game(), es = T.nation('es'), pt = T.nation('pt');
            g.start(T.nation('it'));
            T.power(g, es, 300); T.power(g, pt, 110);
            g.declareWar(es, pt);
            const since = g.turn, after = g.ai.peaceAfter, seen = [];
            for (let k = 1; k <= 2 * after; k++) {
                g.turn = since + k;
                if (k < stopAt) T.occupy(g, es, pt, 1);   // gana terreno cada turno hasta stopAt
                g.trackWarGains();
                const w = g.peaceWish(es, pt);
                seen.push(w.wants ? w.why : '-');
            }
            return { seen, after };
        };
        let { seen, after } = run(1e9);
        T.eq(seen.indexOf('larga'), 2 * after - 1, `siempre ganando: solo a los 2 × peaceAfter turnos (${seen})`);
        T.eq(seen.slice(0, 2 * after - 1).every(x => x === '-'), true, `antes, nunca (${seen})`);
        ({ seen, after } = run(after - 2));   // deja de ganar a los peaceAfter − 3 turnos
        T.eq(seen.findIndex(x => x !== '-') + 1, after + 3, `estancada: 6 turnos después de lo último ganado (${seen})`);
        T.eq(seen[after + 2], 'estancada', 'por estancada');
        const g = T.game(), es = T.nation('es'), pt = T.nation('pt');
        T.power(g, es, 300); T.power(g, pt, 110);
        g.declareWar(es, pt);
        T.occupy(g, es, pt, 3);
        g.turn += 10; g.trackWarGains();
        T.ok(/en todo caso, dentro de \d+ turnos/.test(g.peaceWish(es, pt).blocker), `el bloqueo dice cuándo, en todo caso: ${g.peaceWish(es, pt).blocker}`);
        return true;
    }],
    ['E3 · los aliados que entran en la guerra no bastan para rendirse: hace falta perder tierra', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr'), it = T.nation('it'), de = T.nation('de');
        g.start(es);
        T.power(g, es, 100); T.power(g, fr, 90); T.power(g, it, 200); T.power(g, de, 200);
        T.bloc(g, es, it, de);
        g.declareWar(es, fr);
        for (const x of [it, de]) if (!g.atWar(x, fr)) g.declareWar(x, fr);
        const { A } = g.warSides(es, fr);
        T.ok(A.has(it) && A.has(de) && g.sidePower(A) > 3 * g.sidePower(new Set([fr])), 'su bando no llega a un tercio del tuyo');
        T.ok(!g.isCrushed(fr) && g.peaceWish(fr, es).why !== 'vencido', 'sin perder tierra no está vencido');
        T.ok(!g.acceptsPeace(fr, { mode: 'satellite' }, false), 'ni acepta ser tu satélite');
        T.occupy(g, es, fr, Math.ceil(G.land.filter(c => g.legal[c] === fr).length * CONFIG.CRUSH_LOST));
        T.ok(g.isCrushed(fr) && g.peaceWish(fr, es).why === 'vencido', 'con el 15 % perdido, sí');
        return true;
    }],
    ['I1 · con el objetivo cumplido la IA no acepta una paz blanca, solo quedarse lo ocupado', () => {
        const setup = () => {
            const g = T.game(), es = T.nation('es'), pt = T.nation('pt');
            g.start(pt);
            T.power(g, es, 100); T.power(g, pt, 60);
            g.declareWar(es, pt);
            for (const pid of g.rel(es, pt).war.goal.provinces) for (const c of PROVINCES[pid].cells) if (g.owner[c] === pt) g.owner[c] = es;
            g.version++; g.turn += 9;
            return { g, es, pt };
        };
        let { g, es, pt } = setup();
        T.eq(g.peaceWish(es, pt).why, 'objetivo', 'ha cumplido su objetivo');
        T.eq([g.acceptsPeace(es, { mode: 'white' }, false), g.acceptsPeace(es, { mode: 'annex' }, false)], [false, true], 'blanca no; anexionar sí');
        T.eq(g.playerPeace(es, { mode: 'white' }), false, 'la paz blanca del jugador se rechaza');
        T.ok(g.atWar(es, pt), 'sigue la guerra');
        T.ok(/no una paz blanca/.test(g.warBrief(es).accept), `el cajón lo dice: ${g.warBrief(es).accept}`);
        // La IA propone la paz por objetivo cumplido: tampoco acepta la blanca, y el diálogo no la promete.
        ({ g, es, pt } = setup());
        g.aiDiplomacy(es, g.powers());
        T.eq(g.proposals.find(p => p.kind === 'paz' && p.from === es)?.why, 'objetivo', 'propone la paz');
        ui.setGame(g);
        ui.peace = { target: es, mode: 'white', keep: true, mine: -1, satGains: 'self' };
        ui.renderPeaceDialog();
        const note = document.querySelector('#peace-body .note').innerText;
        T.ok(/aceptará anexionar lo ocupado/.test(note) && !/o una paz blanca/.test(note), `la nota no promete la paz blanca: ${note}`);
        T.eq(g.playerPeace(es, { mode: 'white' }), false, 'paz blanca a su propuesta: no');
        T.eq(g.playerPeace(es, { mode: 'annex' }), true, 'anexionar lo ocupado: sí');
        // El vencido sí acepta la blanca.
        ({ g, es, pt } = setup());
        T.power(g, es, 10);
        T.occupy(g, pt, es, Math.ceil(G.land.filter(c => g.legal[c] === es).length * CONFIG.CRUSH_LOST));
        T.eq(g.acceptsPeace(es, { mode: 'white' }, false), true, 'vencido: acepta la blanca');
        return true;
    }],
    ['M1 · «propone la paz» en el registro una vez y luego cada 5 turnos', () => {
        const g = T.game(), es = T.nation('es'), fr = T.nation('fr');
        g.start(es);
        T.power(g, es, 300); T.power(g, fr, 100);
        g.declareWar(es, fr);
        g.turn = g.rel(es, fr).since + 10;
        const from = g.logs.length;
        for (let k = 0; k < 7; k++) {
            g.proposals = [];   // cada turno se vacían
            g.aiDiplomacy(fr, g.powers());
            T.ok(g.proposals.some(p => p.kind === 'paz' && p.from === fr), `turno ${k}: la propuesta sigue en pie`);
            g.turn++;
        }
        T.eq(T.logs(g, from).filter(m => /propone la paz/.test(m)).length, 2, 'en 7 turnos, dos líneas (la primera y a los 5)');
        const h = GameEngine.load(JSON.parse(JSON.stringify(g.serialize())));
        T.eq(h.rel(es, fr).war.told, g.rel(es, fr).war.told, 'se guarda');
        return true;
    }],
    ['N1 · las propuestas de paz se ocultan 10 turnos o siempre, por país, y se vuelven a mostrar desde su ficha', () => {
        const g = T.uiStart('es'), es = g.player, fr = T.nation('fr');
        T.power(g, es, 300); T.power(g, fr, 100);
        g.declareWar(es, fr);
        g.turn = g.rel(es, fr).since + 10;
        g.aiDiplomacy(fr, g.powers());
        T.ok(g.proposals.some(p => p.kind === 'paz' && p.from === fr), 'Francia propone la paz');
        const toast = () => [...document.querySelectorAll('#toasts .toast')].find(t => t.textContent.includes(g.nm(fr)) && t.textContent.includes('propone la paz'));
        ui.render();
        T.ok(toast(), 'se ve el aviso');
        toast().querySelector('[data-action="peace-mute"][data-turns="10"]').click();
        T.ok(!toast() && g.peaceMuted(fr), 'oculto 10 turnos');
        T.ok(g.proposals.some(p => p.kind === 'paz' && p.from === fr), 'la propuesta sigue en pie (se puede negociar desde su ficha)');
        // Oculta: ni «propone la paz» ni «Ignoras» en el registro.
        let from = g.logs.length;
        g.rel(es, fr).war.told = null; g.proposals = []; g.aiDiplomacy(fr, g.powers());
        g.answerProposal(g.proposals.findIndex(p => p.from === fr), false, true);
        T.eq(T.logs(g, from).filter(m => m.includes(g.nm(fr))), [], 'el registro tampoco la repite');
        g.turn += 10; g.aiDiplomacy(fr, g.powers()); ui.render();
        T.ok(!g.peaceMuted(fr) && toast(), 'a los 10 turnos vuelve');
        toast().querySelector('[data-action="peace-mute"][data-turns="0"]').click();
        g.turn += 1000; ui.render();
        T.ok(g.peaceMuted(fr) && !toast(), 'oculta para siempre');
        const h = GameEngine.load(JSON.parse(JSON.stringify(g.serialize())));
        T.ok(h.peaceMuted(fr) && !h.peaceMuted(T.nation('pt')), 'se guarda');
        // Su ficha lo dice y deja volver a mostrarla.
        ui.drawerOpen = true; ui.tab = 'paises'; ui.focusNation = fr; ui.render();
        const back = document.querySelector('#drawer-body [data-action="peace-unmute"]');
        T.ok(back, 'en su ficha, «Volver a mostrarlas»');
        back.click();
        T.ok(!g.peaceMuted(fr) && toast(), 'y vuelve a verse');
        return true;
    }],
    ['N2 · los partes de guerra: no se cierran con Intro y avisan también del satélite y del señor que entran contra ti', () => {
        const g = T.uiStart('es'), es = g.player, fr = T.nation('fr'), be = T.nation('be'), it = T.nation('it'), ch = T.nation('ch');
        g.declareWar(fr, es);
        T.ok(g.alerts.some(a => a.kind === 'war' && a.from === fr), 'Francia te declara la guerra');
        ui.openAlerts();
        const dlg = document.querySelector('#alerts-dialog');
        T.ok(dlg.open && document.activeElement?.tagName !== 'BUTTON', `el foco no está en un botón (${document.activeElement?.tagName}), así que Intro no lo cierra`);
        dlg.close(); g.alerts = [];
        // Un país que pasa a ser satélite de Francia entra en sus guerras: también en la tuya.
        g.makeSatellite(be, fr);
        T.ok(g.atWar(be, es) && g.alerts.some(a => a.from === be), `aviso del satélite: ${JSON.stringify(g.alerts)}`);
        ui.renderAlerts();
        T.ok(document.querySelector('#alerts-body').textContent.includes(g.nm(be)), 'en el parte');
        g.alerts = [];
        // Atacas a un satélite: su señor entra contra ti.
        g.makeSatellite(ch, it);
        T.ok(g.declareWar(es, ch), 'declaras la guerra a Suiza');
        T.ok(g.atWar(it, es) && g.alerts.some(a => a.from === it), `aviso del señor: ${JSON.stringify(g.alerts)}`);
        return true;
    }],
    ['N3 · a un vencido se le anexiona entero de una vez, como a un satélite; sus satélites pasan a ser tuyos', () => {
        const g = T.uiStart('es'), es = g.player, fr = T.nation('fr'), be = T.nation('be');
        g.declareWar(es, fr);
        g.makeSatellite(be, fr);
        g.alerts = [];
        const open = () => { document.querySelector('#peace-dialog').open && document.querySelector('#peace-dialog').close(); ui.drawerOpen = true; ui.tab = 'paises'; ui.focusNation = fr; ui.render(); document.querySelector('#drawer-body [data-action="peace-open"]').click(); };
        open();
        const opt = () => document.querySelector('#peace-body [data-action="peace-mode"][data-mode="total"]');
        T.ok(opt()?.disabled, 'sin vencerlo, la opción está pero no se puede elegir');
        T.ok(!g.acceptsPeace(fr, { mode: 'total' }, false), 'y no la acepta');
        g.owner[g.nations[fr].capitalCell] = es; g.version++;   // le tomas la capital: vencido
        T.ok(g.isCrushed(fr), 'vencido');
        open();
        opt().click();
        const armies = [...g.armies.values()].filter(a => a.owner === fr).length, gold = g.nations[es].gold + g.nations[fr].gold;
        document.querySelector('#peace-body [data-action="peace-send"]').click();
        T.ok(!g.nations[fr].alive, 'Francia desaparece');
        T.ok(G.land.every(c => g.legal[c] !== fr && g.owner[c] !== fr), 'todo su territorio es de otro');
        T.ok(G.land.filter(c => g.legal[c] === es).length > 0 && g.legal[g.nations[fr].capitalCell] === es, 'su capital, tuya');
        T.ok(armies > 0 && ![...g.armies.values()].some(a => a.owner === fr), 'su ejército pasa a ti');
        T.eq(g.nations[es].gold, gold, 'y su tesoro');
        T.ok(g.nations[be].overlord === es && !g.atWar(be, es), 'su satélite pasa a ser tuyo, en paz contigo');
        T.ok(g.logs.some(l => l.msg.includes(`se anexiona ${g.nm(fr)} entera`)), 'el registro lo dice');
        return true;
    }],
    ['M2 · con niebla el cajón no deja ver la relación de fuerzas; frases exactas', () => {
        const drawer = (g, t) => { ui.drawerOpen = true; ui.tab = 'paises'; ui.focusNation = t; ui.render(); return document.querySelector('#drawer-body').innerText; };
        let g = T.uiStart('es', true), es = g.player, fr = T.nation('fr');
        T.power(g, es, 300); T.power(g, fr, 100);
        g.declareWar(fr, es);
        g.turn = g.rel(es, fr).since + 10;
        let text = drawer(g, fr);
        T.ok(/Aceptaría la paz\./.test(text) && !/inferior/.test(text), `niebla: aceptaría, sin decir que se ve inferior: ${text}`);
        // El otro no la empezó: con niebla no se habla de su objetivo, sino de cuándo se estanca.
        g = T.uiStart('es', true); es = g.player;
        T.power(g, es, 100); T.power(g, fr, 300);
        g.declareWar(es, fr);
        g.turn = g.rel(es, fr).since + 10;
        text = drawer(g, fr);
        T.ok(/No aceptará la paz/.test(text) && !/objetivo/.test(text) && /se estanca/.test(text), `niebla, sin objetivo: ${text}`);
        // Sin niebla, si no la empezó y te ocupa más, dice que puede aceptar quedarse lo ocupado.
        g = T.uiStart('es', false); es = g.player;
        T.power(g, es, 100); T.power(g, fr, 300);
        g.declareWar(es, fr);
        T.occupy(g, fr, es, 5);
        g.turn = g.rel(es, fr).since + 10;
        text = drawer(g, fr);
        T.ok(/puede aceptar que cada uno se quede lo ocupado/.test(text), `nombra la salida de anexionar: ${text}`);
        return true;
    }],
    ['M3 · warState no cambia nada al leerlo; lo ganado se apunta al empezar la fase de la IA', () => {
        const g = T.game(), es = T.nation('es'), pt = T.nation('pt');
        g.start(es);
        T.power(g, es, 300); T.power(g, pt, 110);
        g.declareWar(es, pt);
        g.turn += 2;
        T.occupy(g, es, pt, 4);
        const before = JSON.stringify(g.rel(es, pt).war);
        g.warState(es, pt); g.peaceWish(pt, es); g.warBrief(pt);
        T.eq(JSON.stringify(g.rel(es, pt).war), before, 'leer no cambia la guerra');
        g.beginAiPhase();
        T.eq(g.rel(es, pt).war.gain[es], [4, g.turn], 'la fase de la IA apunta lo ganado');
        T.eq(g.warState(es, pt).stallIn, CONFIG.WAR_STALL_TURNS, 'y warState lo ve');
        return true;
    }],
    ['M5 · la llamada del jugador respeta la tregua extra del aliado', () => {
        const g = T.game(), es = T.nation('es'), pt = T.nation('pt'), fr = T.nation('fr');
        g.start(es);
        T.bloc(g, es, fr);
        g.declareWar(es, pt);
        T.ok(g.callToWarOdds(fr, pt) > 0, 'de partida, puede acudir');
        g.rel(fr, pt).noWarUntil = g.turn + 5;
        T.eq(g.callToWarOdds(fr, pt), 0, 'firmó la paz hace poco: no puede');
        T.eq(g.playerCallToWar(fr, pt), false, 'no acude');
        T.ok(!g.atWar(fr, pt), 'no entra en guerra');
        return true;
    }],
    ['M6 · el modo satélite dice que cuenta a tu bando', () => {
        const g = T.uiStart('es'), pt = T.nation('pt');
        T.power(g, g.player, 100); T.power(g, pt, 90);   // no está vencido: se ve la condición
        g.declareWar(g.player, pt);
        ui.peace = { target: pt, mode: 'annex', keep: true, mine: -1, satGains: 'self' };
        ui.renderPeaceDialog();
        const text = document.querySelector('#peace-body').innerText;
        T.ok(/su bando/.test(text) && /tus aliados en esta guerra/.test(text), `texto del modo satélite: ${text}`);
        return true;
    }],
    ['M7 · el 15 % se mide contra el atacante, no contra su bando', () => {
        const g = T.game(), es = T.nation('es'), pt = T.nation('pt'), it = T.nation('it'), fi = T.nation('fi');
        g.nations[it].overlord = es; g.blocsChanged();   // Italia, satélite de España: su bando suma 300
        T.bloc(g, pt, fi);
        T.power(g, es, 100); T.power(g, it, 200); T.power(g, pt, 60);
        T.power(g, fi, 20);
        T.ok(g.allyOdds(fi, es, pt) > 0, `con el 20 % del atacante puede acudir (${g.allyOdds(fi, es, pt)})`);
        T.power(g, fi, 10);
        T.eq(g.allyOdds(fi, es, pt), 0, 'con el 10 %, no');
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
