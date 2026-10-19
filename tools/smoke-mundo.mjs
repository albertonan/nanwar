// Prueba en el navegador del selector de mapas y del mapa del mundo: elige «Mundo» en la pantalla de nueva partida,
// empieza con Estados Unidos, espera al relieve, juega turnos de la IA midiendo cuánto tardan, mide los fotogramas,
// y comprueba que una partida guardada en el mundo se carga desde el mapa de Europa (cambiando de mapa).
// Uso: node basicmilitary/tools/smoke-mundo.mjs [carpeta de capturas]   (CHROME=<ruta> para usar otro navegador)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ?? join(root, 'tools/cache/smoke');
mkdirSync(out, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
    const path = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/$/, '/index.html'));
    if (!path.startsWith(root) || !existsSync(path)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(readFileSync(path));
}).listen(0);
const port = server.address().port;

const exe = process.env.CHROME ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find(existsSync);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on('pageerror', e => failures.push(`pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') failures.push(`console: ${m.text()}`); });
    await page.goto(`http://localhost:${port}/?seed=7`);
    check(await page.evaluate(() => MAP_ID) === 'europa', 'el mapa por defecto no es Europa');

    // Selector: pulsar «Mundo» recarga con el mapa del mundo y lo recuerda.
    await Promise.all([page.waitForNavigation(), page.click('.map-pick[data-value="mundo"]')]);
    const info = await page.evaluate(() => ({ id: MAP_ID, land: G.land.length, provinces: PROVINCES.length, nations: game.nations.length, stored: localStorage.getItem(MAP_KEY), lead: document.querySelector('#setup .lead').textContent }));
    console.log(`mapa ${info.id}: ${info.land} casillas, ${info.provinces} provincias, ${info.nations} países`);
    check(info.id === 'mundo' && info.stored === 'mundo', `el selector no cambia al mundo: ${JSON.stringify(info)}`);
    check(/mundo/i.test(info.lead), 'la pantalla de inicio no habla del mundo');
    await page.screenshot({ path: join(out, 'm1-inicio.png') });

    const t0 = Date.now();
    await page.evaluate(() => { ui.choice = E.countries.findIndex(c => c.key === 'us'); ui.render(); document.querySelector('[data-action="start"]').click(); });
    await page.waitForFunction(() => ui.view.realistic.state === 'ready' || ui.view.realistic.state === 'failed', null, { timeout: 120000 });
    console.log(`relieve del mundo listo en ${Date.now() - t0} ms`);
    check(await page.evaluate(() => ui.view.realistic.state) === 'ready', 'la vista realista del mundo no carga');

    const shot = async (name, fn, arg) => {
        if (fn) await page.evaluate(fn, arg);
        await page.evaluate(() => new Promise(r => { ui.view.draw(); requestAnimationFrame(() => requestAnimationFrame(r)); }));
        await page.waitForTimeout(400);
        await page.screenshot({ path: join(out, `${name}.png`) });
    };
    const near = city => { ui.view.scale = 1; ui.view.centerOn(PROVINCES.find(p => p.cityName === city).city, 14); };
    await shot('m2-mundo', () => { ui.select(-1); ui.view.fit(); });
    await shot('m3-himalaya', near, 'Kathmandu');
    await shot('m4-andes', near, 'La Paz');
    await shot('m5-sencilla', () => { ui.toggleViewMode(); ui.select(-1); ui.view.fit(); });
    await page.evaluate(() => ui.toggleViewMode());

    // Turnos de la IA (181 países) en «directo», midiendo cada uno.
    const times = await page.evaluate(async () => {
        ui.prefs.watch = 'directo';
        const t = [];
        for (let i = 0; i < 4; i++) { const s = performance.now(); await ui.endTurnFlow(); t.push(Math.round(performance.now() - s)); }
        return t;
    });
    console.log(`turnos de la IA: ${times.join(', ')} ms`);
    check(Math.max(...times) < 20000, `un turno de la IA tarda demasiado: ${Math.max(...times)} ms`);
    await shot('m6-turno-5');
    for (const [name, mode] of [['mundo realista', 'realista'], ['mundo sencilla', 'sencilla']]) {
        await page.evaluate(m => ui.view.setMode(m), mode);
        const fps = await page.evaluate(() => new Promise(res => {
            ui.view.fit();
            let n = 0; const t = performance.now();
            const tick = () => { ui.view.ox += 0.5; ui.view.draw(); n++; if (performance.now() - t < 1500) requestAnimationFrame(tick); else res(n / (performance.now() - t) * 1000); };
            requestAnimationFrame(tick);
        }));
        console.log(`fotogramas por segundo, ${name}: ${fps.toFixed(0)}`);
    }

    // Guardar en el mundo, ir a Europa y cargar desde allí la partida del mundo.
    const turn = await page.evaluate(() => { writeSave('s1', game); return game.turn; });
    await page.goto(`http://localhost:${port}/?mapa=europa&seed=7`);
    check(await page.evaluate(() => MAP_ID) === 'europa', '?mapa=europa no carga Europa');
    await page.evaluate(() => document.querySelector('[data-action="open-game"]').click());
    const other = page.locator('[data-action="load"][data-map="mundo"][data-slot="s1"]');
    check(await other.count() === 1, 'el diálogo de partidas de Europa no ofrece la del mundo');
    if (await other.count()) {
        await Promise.all([page.waitForNavigation(), other.click()]);
        await page.waitForFunction(() => typeof game !== 'undefined' && game.player !== null, null, { timeout: 30000 });
        const loaded = await page.evaluate(() => ({ id: MAP_ID, turn: game.turn, nation: game.nations[game.player].key }));
        check(loaded.id === 'mundo' && loaded.turn === turn && loaded.nation === 'us', `no se carga la partida del mundo: ${JSON.stringify(loaded)}`);
    }
    // La de Europa (sin mapId en partidas antiguas) no se carga en el mundo.
    const refused = await page.evaluate(() => { try { GameEngine.load({ format: 'eurowar-1', map: '1:1' }); return null; } catch (e) { return e.message; } });
    check(/Europa/.test(refused ?? ''), `una partida de Europa no se rechaza en el mundo: ${refused}`);
    console.log(`capturas en ${out}`);
} finally {
    await browser.close();
    server.close();
}
if (failures.length) { console.error('FALLOS:\n' + failures.join('\n')); process.exit(1); }
console.log('ok');
