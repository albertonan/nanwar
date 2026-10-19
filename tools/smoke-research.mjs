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
        ok(c, msg) { if (!c) throw new Error(msg); }
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
        const result = await page.evaluate(`(() => { try { return (${fn.toString()})(); } catch (e) { return String(e && e.stack || e); } })()`);
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
