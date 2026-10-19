// Prueba en el navegador de la vista realista: sirve el juego por HTTP, empieza una partida con España, espera al relieve,
// mueve un ejército (comprueba que se anima) y guarda capturas de las dos vistas.
// Uso: node basicmilitary/tools/smoke-vista.mjs [carpeta de capturas]   (CHROME=<ruta> para usar otro navegador)
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
try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on('pageerror', e => failures.push(`pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') failures.push(`console: ${m.text()}`); });
    await page.goto(`http://localhost:${port}/?seed=7`);
    await page.evaluate(() => {
        ui.choice = E.countries.findIndex(c => c.key === 'es');
        ui.render();
        document.querySelector('[data-action="start"]').click();
    });
    const t0 = Date.now();
    await page.waitForFunction(() => ui.view.realistic.state === 'ready' || ui.view.realistic.state === 'failed', null, { timeout: 60000 });
    console.log(`relieve listo en ${Date.now() - t0} ms`);
    const state = await page.evaluate(() => ui.view.realistic.state);
    if (state !== 'ready') failures.push(`vista realista: ${state}`);

    const shot = async (name, fn) => {
        if (fn) await page.evaluate(fn);
        await page.evaluate(() => new Promise(r => { ui.view.draw(); requestAnimationFrame(() => requestAnimationFrame(r)); }));
        await page.waitForTimeout(400);
        await page.screenshot({ path: join(out, `${name}.png`) });
    };
    await shot('1-europa', () => { ui.select(-1); ui.view.fit(); });
    await shot('2-pirineos', () => { ui.view.scale = 1; ui.view.centerOn(PROVINCES.find(p => p.cityName === 'Zaragoza').city, 14); });
    await shot('3-alpes', () => { ui.view.scale = 1; ui.view.centerOn(PROVINCES.find(p => /Innsbruck|Tirol/.test(p.cityName + p.name))?.city ?? PROVINCES[0].city, 22); });

    // Mover un ejército español y fotografiarlo a medio camino
    const moved = await page.evaluate(() => {
        const g = game, a = [...g.armies.values()].filter(x => x.owner === g.player).sort((p, q) => q.units.tank - p.units.tank)[0];
        ui.view.centerOn(a.cell, 16);
        ui.select(a.cell); ui.render();
        const dests = [...(ui.reachInfo?.moves ?? [])].filter(c => isLand(c));
        if (!dests.length) return 'sin destinos';
        const far = dests.sort((p, q) => Math.hypot(G.cx[q] - G.cx[a.cell], G.cy[q] - G.cy[a.cell]) - Math.hypot(G.cx[p] - G.cx[a.cell], G.cy[p] - G.cy[a.cell]))[0];
        ui.clickCell(far);
        return { from: a.cell, to: far, tracks: ui.view.motion.tracks.size };
    });
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(out, '4-moviendo.png') });
    const animated = await page.evaluate(() => ui.view.motion.tracks.size);
    if (typeof moved === 'string') failures.push(moved);
    else if (!animated) failures.push('el movimiento no se anima');
    await page.waitForTimeout(2500);
    await shot('5-llegada');
    await shot('6-sencilla', () => { ui.toggleViewMode(); });
    const pref = await page.evaluate(() => JSON.parse(localStorage.getItem('nanwar.prefs')).view);
    if (pref !== 'sencilla') failures.push(`preferencia de vista no guardada: ${pref}`);
    // Un turno de la IA con «ver sus jugadas» para ejercitar la repetición animada
    await page.evaluate(() => { ui.toggleViewMode(); ui.prefs.watch = 'ver'; ui.prefs.speed = 'rapida'; ui.endTurnFlow(); });
    await page.waitForFunction(() => !ui.replaying, null, { timeout: 120000 });
    await shot('7-tras-turno');
    // Fotogramas por segundo redibujando sin parar 1,5 s, lejos y cerca
    for (const [name, hex, mode] of [['Europa', 0, 'realista'], ['cerca', 16, 'realista'], ['Europa sencilla', 0, 'sencilla'], ['cerca sencilla', 16, 'sencilla']]) {
        await page.evaluate(m => ui.view.setMode(m), mode);
        const fps = await page.evaluate(h => new Promise(res => {
            if (h) { ui.view.scale = 1; ui.view.centerOn(PROVINCES.find(p => p.cityName === 'Zaragoza').city, h); } else ui.view.fit();
            let n = 0; const t = performance.now();
            const tick = () => { ui.view.ox += 0.5; ui.view.draw(); n++; if (performance.now() - t < 1500) requestAnimationFrame(tick); else res(n / (performance.now() - t) * 1000); };
            requestAnimationFrame(tick);
        }), hex);
        console.log(`fotogramas por segundo, ${name}: ${fps.toFixed(0)}`);
    }
    await page.evaluate(() => ui.view.setMode(ui.prefs.view));
    // Cinco turnos más con la IA en «directo»
    const err = await page.evaluate(async () => {
        ui.prefs.watch = 'directo';
        for (let i = 0; i < 5; i++) { await ui.endTurnFlow(); if (game.motion.length) return 'quedan movimientos sin consumir'; }
        return null;
    });
    if (err) failures.push(err);
    await shot('8-turno-7');
    // Móvil: pantalla estrecha y táctil
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    phone.on('pageerror', e => failures.push(`móvil pageerror: ${e.message}`));
    await phone.goto(`http://localhost:${port}/?seed=7`);
    await phone.evaluate(() => { ui.choice = E.countries.findIndex(c => c.key === 'it'); ui.render(); document.querySelector('[data-action="start"]').click(); });
    await phone.waitForFunction(() => ui.view.realistic.state === 'ready', null, { timeout: 60000 });
    await phone.evaluate(() => new Promise(r => { ui.view.scale = 1; ui.view.centerOn(game.nations[game.player].capitalCell, 14); ui.view.draw(); setTimeout(r, 1500); }));
    await phone.screenshot({ path: join(out, '9-movil.png') });
    console.log(`capturas en ${out}`);
} finally {
    await browser.close();
    server.close();
}
if (failures.length) { console.error('FALLOS:\n' + failures.join('\n')); process.exit(1); }
console.log('ok');
