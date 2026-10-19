// Mide el coste de dibujar el mapa: fotogramas al arrastrar y al hacer zoom (de lejos, a media distancia y de cerca),
// en las dos vistas y en los dos mapas, y el tiempo de pintar una tesela de la vista realista.
// Uso: node basicmilitary/tools/perf-mapa.mjs [europa|mundo ...]   (CHROME=<ruta> para usar otro navegador)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
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
const maps = process.argv.slice(2).length ? process.argv.slice(2) : ['europa', 'mundo'];
try {
    for (const map of maps) {
        const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
        page.on('pageerror', e => console.log('pageerror', e.message));
        await page.goto(`http://localhost:${port}/?mapa=${map}&seed=7`);
        await page.evaluate(k => { ui.choice = E.countries.findIndex(c => c.key === k); ui.render(); document.querySelector('[data-action="start"]').click(); }, map === 'mundo' ? 'us' : 'de');
        await page.waitForFunction(() => ui.view.realistic.state === 'ready', null, { timeout: 120000 });
        const res = await page.evaluate(async () => {
            const v = ui.view, out = {};
            const frame = () => new Promise(r => requestAnimationFrame(r));
            // Cada prueba: 90 fotogramas seguidos; se mide el tiempo de draw() (medio y peor).
            const run = async (setup, step) => {
                setup();
                for (let i = 0; i < 5; i++) { v.draw(); await frame(); }
                const ts = [];
                for (let i = 0; i < 90; i++) { step(i); const t = performance.now(); v.draw(); ts.push(performance.now() - t); await frame(); }
                ts.sort((a, b) => a - b);
                return `${(ts.reduce((a, b) => a + b, 0) / ts.length).toFixed(1)} / ${ts[ts.length - 1].toFixed(0)} ms`;
            };
            const cap = game.nations[game.player].capitalCell;
            for (const mode of ['sencilla', 'realista']) {
                v.setMode(mode);
                for (const [name, hex] of [['lejos', 0], ['medio', 6], ['cerca', 20]]) {
                    const setup = () => { if (hex) { v.scale = 1; v.centerOn(cap, hex); } else v.fit(); };
                    out[`${mode} ${name} arrastrar`] = await run(setup, () => { v.ox += 6; v.oy += 2; });
                    out[`${mode} ${name} zoom`] = await run(setup, i => v.zoomAt(v.w / 2, v.h / 2, i % 40 < 20 ? 1.03 : 1 / 1.03));
                }
            }
            // Una tesela de la vista realista a 4 y a 16 píxeles por unidad
            const R = ui.view.realistic, c = document.createElement('canvas'); c.width = c.height = 512;
            const x = c.getContext('2d');
            for (const b of [4, 16]) {
                const span = 512 / b, tx = Math.floor(G.cx[cap] / span), ty = Math.floor(G.cy[cap] / span);
                const t = performance.now();
                for (let k = 0; k < 3; k++) { x.setTransform(b, 0, 0, b, -tx * span * b, -ty * span * b); R.paintWorld(x, b, [tx * span, ty * span, (tx + 1) * span, (ty + 1) * span]); }
                x.getImageData(0, 0, 1, 1);
                out[`tesela b=${b}`] = `${((performance.now() - t) / 3).toFixed(1)} ms`;
            }
            return out;
        });
        console.log(`\n== ${map} ==  (draw medio / peor)`);
        for (const [k, v] of Object.entries(res)) console.log(`${k.padEnd(28)} ${v}`);
        await page.close();
    }
} finally {
    await browser.close();
    server.close();
}
