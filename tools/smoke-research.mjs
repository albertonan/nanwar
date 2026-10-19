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
