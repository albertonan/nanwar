// NanWar: animación de ejércitos (las dos vistas) y vista realista «Relieve pintado».
// Se carga antes del script principal de index.html; usa sus globales (G, E, PROVINCES, CELL_TERRAIN, CONFIG...) solo
// cuando se la llama, así que el orden de carga no importa más allá de que las clases existan al construir MapView.
'use strict';

const TAU = Math.PI * 2;
const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mixRGB = (c, d, t) => [c[0] + (d[0] - c[0]) * t, c[1] + (d[1] - c[1]) * t, c[2] + (d[2] - c[2]) * t];
function hash2(x, y, s) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const hexToRgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const shadeHex = (h, f) => { const c = hexToRgb(h).map(v => Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f))); return `rgb(${c[0]},${c[1]},${c[2]})`; };
const rgbaHex = (h, a) => { const [r, g, b] = hexToRgb(h); return `rgba(${r},${g},${b},${a})`; };
function catmullRom(p0, p1, p2, p3, u) {
    const u2 = u * u, u3 = u2 * u;
    return [0, 1].map(k => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * u + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * u3));
}

// Aristas [(casilla, dirección)] → polilíneas encadenadas por sus vértices; `closed` si la cadena vuelve a su inicio.
function chainEdges(edges) {
    const key = (x, y) => `${Math.round(x * 100)},${Math.round(y * 100)}`;
    const segs = [], at = new Map();
    for (const [i, d] of edges) {
        const a = G.corners[d], b = G.corners[(d + 1) % 6];
        const s = { a: [G.cx[i] + a[0], G.cy[i] + a[1]], b: [G.cx[i] + b[0], G.cy[i] + b[1]], used: false };
        s.ka = key(...s.a); s.kb = key(...s.b);
        segs.push(s);
        for (const k of [s.ka, s.kb]) { if (!at.has(k)) at.set(k, []); at.get(k).push(s); }
    }
    const out = [];
    const ends = segs.filter(s => at.get(s.ka).length === 1 || at.get(s.kb).length === 1);
    for (const s0 of [...ends, ...segs]) {
        if (s0.used) continue;
        s0.used = true;
        const pts = at.get(s0.ka).length === 1 ? [s0.a, s0.b] : [s0.b, s0.a];
        const k0 = key(...pts[0]);
        let k = key(...pts[1]), closed = false;
        for (;;) {
            if (k === k0) { closed = true; pts.pop(); break; }
            const nx = at.get(k).find(s => !s.used);
            if (!nx) break;
            nx.used = true;
            const p = nx.ka === k ? nx.b : nx.a;
            pts.push(p); k = key(...p);
        }
        out.push({ pts, closed });
    }
    return out;
}
function chaikin(pts, closed, it = 2) {
    let p = pts;
    for (let n = 0; n < it; n++) {
        const q = closed ? [] : [p[0]], m = p.length, last = closed ? m : m - 1;
        for (let k = 0; k < last; k++) {
            const a = p[k], b = p[(k + 1) % m];
            q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
        }
        if (!closed) q.push(p[m - 1]);
        p = q;
    }
    return p;
}
function addPoly(path, pts, closed) {
    path.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < pts.length; k++) path.lineTo(pts[k][0], pts[k][1]);
    if (closed) path.closePath();
}
const smoothChains = (edges, it = 2) => chainEdges(edges).filter(c => c.pts.length > 1).map(c => ({ pts: chaikin(c.pts, c.closed, it), closed: c.closed }));
function smoothRegion(edges, it = 2) {
    const p = new Path2D();
    for (const c of smoothChains(edges, it)) addPoly(p, c.pts, c.closed);
    return p;
}
// Líneas repartidas en trozos de CHUNK unidades del mapa, para trazar solo las que caen en lo que se pinta: costa,
// fronteras y ríos del mundo entero son trazados enormes, y trazarlos enteros en cada tesela era lo que más costaba.
const CHUNK = 16;
function chunkLines(chains) {
    const out = new Map();
    for (const { pts, closed } of chains) {
        const n = closed ? pts.length : pts.length - 1;
        let path = null, cur = null;
        for (let k = 0; k < n; k++) {
            const a = pts[k], b = pts[(k + 1) % pts.length];
            const key = `${Math.floor((a[0] + b[0]) / 2 / CHUNK)},${Math.floor((a[1] + b[1]) / 2 / CHUNK)}`;
            if (key !== cur) {
                cur = key;
                path = out.get(key) ?? out.set(key, new Path2D()).get(key);
                path.moveTo(a[0], a[1]);
            }
            path.lineTo(b[0], b[1]);
        }
    }
    return out;
}
// Traza los trozos que tocan `rect` (ampliado en `m` unidades, para el grosor de la línea).
function strokeChunks(x, chunks, rect, m = 2) {
    for (let cy = Math.floor((rect[1] - m) / CHUNK); cy <= Math.floor((rect[3] + m) / CHUNK); cy++)
        for (let cx = Math.floor((rect[0] - m) / CHUNK); cx <= Math.floor((rect[2] + m) / CHUNK); cx++) {
            const p = chunks.get(`${cx},${cy}`);
            if (p) x.stroke(p);
        }
}

// ---------------------------------------------------------------------------------------------------------------
// Animación de ejércitos. El motor apunta en game.motion lo que pasa ({kind:'move', cells...}, {kind:'battle'...} y las
// misiones aéreas, {kind:'air', from, cell, result...}); la vista lo reproduce encadenado por ejército. La partida ya
// está resuelta: esto solo enseña cómo ha ocurrido.
class ArmyMotion {
    constructor(view) {
        this.view = view;
        this.tracks = new Map();   // id → [tramos pendientes o en curso]
        this.fx = [];              // combates
        this.air = [];             // misiones aéreas: un trazo de cada base al blanco
        this.particles = [];
        this.busy = new Map();     // id → instante en que queda libre
        this.speed = 1;            // multiplicador de duración (velocidad de la repetición de la IA)
        this.facings = new Map();  // hacia dónde mira cada miniatura (1 derecha, -1 izquierda)
    }
    facingOf(id, pose) {
        if (pose?.moving) this.facings.set(id, pose.facing);
        return this.facings.get(id) ?? 1;
    }
    clear() { this.tracks.clear(); this.fx = []; this.air = []; this.particles = []; this.busy.clear(); }
    stepMs(u, v) {
        if (!this.view.isRealistic()) return 70 * this.speed;
        const g = this.view.game, d = G.dirTo(u, v);
        let cost = 1;
        if (!isLand(v) || !isLand(u)) cost = 1;
        else if (d >= 0 && g.road[u * 6 + d]) cost = g.road[u * 6 + d] === 2 ? 0.34 : 0.5;
        else cost = terrainOf(v).cost + (d >= 0 && RIVER[u * 6 + d] ? 0.5 : 0);
        return Math.min(460, Math.max(70, 150 * cost)) * this.speed;
    }
    visible(cells) {
        const g = this.view.game;
        if (g.player === null || !g.settings.fog) return true;
        return cells.some(c => g.sees(g.player, c));
    }
    consume(now) {
        const g = this.view.game;
        if (!g.motion?.length) return;
        const evs = g.motion.splice(0);
        if (this.view.instantMotion || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        for (const ev of evs) {
            if (ev.kind === 'move') {
                if (ev.cells.length < 2 || !this.visible([ev.cells[0], ev.cells[ev.cells.length - 1]])) continue;
                const start = Math.max(now, this.busy.get(ev.id) ?? 0);
                const times = [0];
                for (let k = 1; k < ev.cells.length; k++) times.push(times[k - 1] + this.stepMs(ev.cells[k - 1], ev.cells[k]));
                const total = times[times.length - 1], cap = 2600 * this.speed;
                if (total > cap) for (let k = 0; k < times.length; k++) times[k] *= cap / total;
                const tr = { ...ev, pts: ev.cells.map(c => [G.cx[c], G.cy[c]]), times, start, end: start + times[times.length - 1] };
                if (!this.tracks.has(ev.id)) this.tracks.set(ev.id, []);
                this.tracks.get(ev.id).push(tr);
                this.busy.set(ev.id, tr.end);
            } else if (ev.kind === 'battle') {
                if (!this.visible([ev.cell, ev.from])) continue;
                const start = Math.max(now, this.busy.get(ev.att) ?? 0, this.busy.get(ev.def) ?? 0);
                const dur = 900 * Math.max(0.5, this.speed);
                this.fx.push({ ...ev, start, end: start + dur, last: 0 });
                this.busy.set(ev.att, start + dur); this.busy.set(ev.def, start + dur);
            } else if (ev.kind === 'air') {   // se ve si es del jugador o si ve el blanco
                if (ev.owner !== g.player && !this.visible([ev.cell])) continue;
                this.air.push({ from: ev.from, cell: ev.cell, owner: ev.owner, result: ev.result, mission: ev.mission, start: now, end: now + 900 * this.speed, done: false });
            }
        }
    }
    // Posición de un ejército en este instante, o null si está quieto en su casilla.
    pose(id, now) {
        const q = this.tracks.get(id);
        if (!q) return null;
        while (q.length && now >= q[0].end) q.shift();
        if (!q.length) { this.tracks.delete(id); return null; }
        const tr = q[0];
        if (now < tr.start) return { x: tr.pts[0][0], y: tr.pts[0][1], moving: false, heading: 0, track: tr };
        const t = now - tr.start, T = tr.times, n = tr.pts.length;
        let k = 0;
        while (k < n - 2 && t > T[k + 1]) k++;
        const u = clamp01((t - T[k]) / (T[k + 1] - T[k] || 1));
        let p;
        if (this.view.isRealistic()) p = catmullRom(tr.pts[Math.max(0, k - 1)], tr.pts[k], tr.pts[k + 1], tr.pts[Math.min(n - 1, k + 2)], u);
        else p = [tr.pts[k][0] + (tr.pts[k + 1][0] - tr.pts[k][0]) * u, tr.pts[k][1] + (tr.pts[k + 1][1] - tr.pts[k][1]) * u];
        const dx = tr.pts[k + 1][0] - tr.pts[k][0], dy = tr.pts[k + 1][1] - tr.pts[k][1];
        return { x: p[0], y: p[1], moving: true, heading: Math.atan2(dy, dx), facing: dx < -0.01 ? -1 : 1, track: tr };
    }
    // Tramos de ejércitos que ya no existen (se han unido a otro o han caído): se dibujan como fantasmas hasta acabar.
    ghosts(now) {
        const out = [];
        for (const [id, q] of this.tracks) if (!this.view.game.armies.has(id)) {
            const p = this.pose(id, now);
            if (p) out.push({ id, p, tr: p.track });
        }
        return out;
    }
    pendingMs(now = performance.now()) {
        let end = now;
        for (const q of this.tracks.values()) for (const t of q) end = Math.max(end, t.end);
        for (const f of this.fx) end = Math.max(end, f.end);
        for (const t of this.air) end = Math.max(end, t.end);
        return end - now;
    }
    active(now) {
        this.fx = this.fx.filter(f => now < f.end + 600);
        this.air = this.air.filter(t => now < t.end + 700);
        this.particles = this.particles.filter(p => now - p.t0 < p.life);
        return this.tracks.size > 0 || this.fx.length > 0 || this.air.length > 0 || this.particles.length > 0;
    }
    spawn(kind, x, y, extra = {}) { this.particles.push({ kind, x, y, t0: performance.now(), life: 600, vx: 0, vy: 0, ...extra }); }
    // Polvo tras las miniaturas y fogonazos y humo en los combates (vista realista); un aro rojo en la sencilla. Al llegar
    // una misión aérea, su resultado en el blanco: un fogonazo y humo si acierta y una bocanada gris si fracasa (en la
    // sencilla, el aro); la interceptada, un aspa amarilla a medio camino.
    effects(now) {
        const real = this.view.isRealistic();
        for (const [id] of this.tracks) {
            const p = this.pose(id, now);
            if (!p?.moving || !real) continue;
            const tr = p.track;
            if (now - (tr.lastDust ?? 0) > 55) {
                tr.lastDust = now;
                this.spawn('dust', p.x - Math.cos(p.heading) * 0.9 + (Math.random() - 0.5) * 0.5, p.y + 0.5 + (Math.random() - 0.5) * 0.3,
                    { life: 650, vx: -Math.cos(p.heading) * 0.0006, vy: -0.0003 });
            }
        }
        for (const f of this.fx) {
            if (now < f.start || now > f.end || now - f.last < 110) continue;
            f.last = now;
            const [ax, ay] = [G.cx[f.from], G.cy[f.from]], [dx, dy] = [G.cx[f.cell], G.cy[f.cell]];
            if (!real) { if (now - f.start < 130) this.spawn('ring', dx, dy, { life: 650 }); continue; }
            this.spawn('flash', ax + (dx - ax) * 0.25, ay + (dy - ay) * 0.25 - 0.5, { life: 160 });
            if (Math.random() < 0.6) this.spawn('flash', dx + (Math.random() - 0.5) * 1.5, dy - 0.4 + (Math.random() - 0.5), { life: 140 });
            this.spawn('smoke', (ax + dx) / 2 + (Math.random() - 0.5) * 2.5, (ay + dy) / 2 + (Math.random() - 0.5) * 1.5,
                { life: 1500, vy: -0.0009, g: 90 + Math.random() * 60 });
        }
        for (const t of this.air) {
            const cut = t.result === 'intercepted', at = cut ? (t.start + t.end) / 2 : t.end;
            if (t.done || now < at) continue;
            t.done = true;
            const tx = G.cx[t.cell], ty = G.cy[t.cell];
            if (cut) { for (const b of t.from) this.spawn('cross', (G.cx[b] + tx) / 2, (G.cy[b] + ty) / 2, { life: 1100 }); continue; }
            if (!real || t.mission === 'patrol') { this.spawn('ring', tx, ty, { life: 650 }); continue; }
            if (t.result === 'hit') {
                this.spawn('flash', tx, ty - 0.3, { life: 240 });
                for (let i = 0; i < 4; i++) this.spawn('smoke', tx + (Math.random() - 0.5) * 1.6, ty - 0.2 + (Math.random() - 0.5), { life: 1600, vy: -0.0009, g: 70 + Math.random() * 50 });
            } else this.spawn('smoke', tx, ty - 0.2, { life: 1200, vy: -0.0006, g: 180 });
        }
    }
    shake(id, now) {
        for (const f of this.fx) if ((f.att === id || f.def === id) && now >= f.start && now < f.end) return [Math.sin(now / 23 + id) * 1.8, Math.cos(now / 31) * 1];
        return null;
    }
    drawParticles(ctx, view, now) {
        const s = view.scale;
        for (const p of this.particles) {
            const t = (now - p.t0) / p.life, [x, y] = view.toScreen(p.x + p.vx * (now - p.t0), p.y + p.vy * (now - p.t0));
            if (p.kind === 'dust') { ctx.fillStyle = `rgba(196,178,138,${0.42 * (1 - t)})`; ctx.beginPath(); ctx.arc(x, y, (0.25 + t * 0.7) * s, 0, TAU); ctx.fill(); }
            else if (p.kind === 'smoke') { ctx.fillStyle = `rgba(${p.g | 0},${p.g | 0},${p.g | 0},${0.5 * (1 - t)})`; ctx.beginPath(); ctx.arc(x, y, (0.4 + t * 1.3) * s, 0, TAU); ctx.fill(); }
            else if (p.kind === 'flash') {
                ctx.save(); ctx.globalCompositeOperation = 'lighter';
                const r = Math.max(4, 1.5 * s), gr = ctx.createRadialGradient(x, y, 0, x, y, r);
                gr.addColorStop(0, `rgba(255,240,180,${1 - t})`); gr.addColorStop(1, 'rgba(255,140,40,0)');
                ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.restore();
            } else if (p.kind === 'ring') { ctx.strokeStyle = `rgba(224,90,71,${1 - t})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, Math.max(6, s * (0.8 + t * 2)), 0, TAU); ctx.stroke(); }
            else if (p.kind === 'cross') {   // aspa amarilla: la misión interceptada
                const r = Math.max(5, s * 0.9);
                ctx.lineCap = 'round';
                for (const [c, w] of [[`rgba(21,26,18,${1 - t})`, 4.6], [`rgba(240,196,25,${1 - t})`, 2.4]]) {
                    ctx.strokeStyle = c; ctx.lineWidth = w;
                    ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke();
                }
                ctx.lineCap = 'butt';
            }
        }
    }
}

// Misiones aéreas en vuelo, en píxeles de pantalla, de cada base al blanco en 900 ms (× speed). En la vista realista,
// la estela del avión: un punto que avanza y una línea que se desvanece detrás; en la sencilla, una línea discontinua
// clara y el avión del color del país. La interceptada se queda a medio camino. Al acabar, el trazo se apaga en 700 ms.
function drawAirTrails(ctx, view, now) {
    const M = view.motion;
    if (!M.air.length) return;
    const real = view.isRealistic(), g = view.game;
    ctx.save();
    ctx.lineCap = 'round';
    for (const t of M.air) {
        const stop = t.result === 'intercepted' ? 0.5 : 1, u = Math.min(stop, (now - t.start) / (t.end - t.start));
        if (u < 0) continue;
        const fade = clamp01(1 - (now - t.end) / 700), color = g.nations[t.owner].color, [tx, ty] = view.toScreen(G.cx[t.cell], G.cy[t.cell]);
        for (const b of t.from) {
            const [bx, by] = view.toScreen(G.cx[b], G.cy[b]), hx = bx + (tx - bx) * u, hy = by + (ty - by) * u;
            if (real) {
                const k = Math.max(0, u - 0.35), sx = bx + (tx - bx) * k, sy = by + (ty - by) * k, gr = ctx.createLinearGradient(sx, sy, hx, hy);
                gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, `rgba(255,255,255,${0.9 * fade})`);
                ctx.strokeStyle = gr; ctx.lineWidth = 2.4;
                ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(hx, hy); ctx.stroke();
            } else {
                ctx.globalAlpha = fade; ctx.setLineDash([6, 4]);
                ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(hx, hy);
                ctx.strokeStyle = INK; ctx.lineWidth = 3.8; ctx.stroke();
                ctx.strokeStyle = '#f3efe2'; ctx.lineWidth = 2; ctx.stroke();
                ctx.setLineDash([]); ctx.globalAlpha = 1;
            }
            if (u < stop) {   // el avión
                ctx.beginPath(); ctx.arc(hx, hy, 3.8, 0, TAU);
                ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = real ? '#fff' : INK; ctx.stroke();
            }
        }
    }
    ctx.restore();
}

// ---------------------------------------------------------------------------------------------------------------
// Vista realista: terreno pintado a partir de relieve.png (elevación, bosque y usos del suelo reales) recortado por la
// costa de las casillas, para que lo que se ve coincida con lo que cuenta en las reglas.
const PAINT = {
    grass: [143, 166, 90], crop: [204, 186, 118], crop2: [182, 176, 98], shrub: [164, 152, 98], bare: [198, 176, 132],
    built: [176, 160, 148], wet: [112, 138, 98], forest1: [70, 98, 48], forest2: [88, 112, 56], conifer: [56, 84, 52],
    hill: [150, 146, 98], rock: [140, 128, 112], rockhi: [184, 174, 160], snow: [244, 243, 238],
    seaDeep: [36, 82, 108], seaShallow: [74, 134, 156], lake: [80, 136, 156]
};
const BASE_RES = window.MAPA?.paintRes ?? 3;   // píxeles del lienzo del terreno por unidad del mapa (el del mundo, menos: es muy grande)
const TILE = 512;          // lado en píxeles de las teselas del mundo pintado
const MAX_TILES = 64;      // teselas guardadas (1 MB cada una): una pantalla grande con zoom entero y algo de margen
const PAINT_MS = 8;        // tiempo máximo por fotograma pintando teselas nuevas (siempre al menos una)
const SEA_COLOR = '#2a5670';

class RealisticMap {
    constructor(view) {
        this.view = view;
        this.state = 'idle';   // idle → loading → ready (o failed: se queda la vista sencilla)
        this.tiles = new Map();
        this.ownerKey = -1;
        this.minis = new Map();   // miniaturas de la aviación ya pintadas (drawMini)
    }

    prepare() {
        if (this.state !== 'idle') return;
        this.state = 'loading';
        this.load().then(() => { this.state = 'ready'; this.view.requestFrame(); this.view.onRealisticReady?.(); })
            .catch(err => { console.error('Vista realista:', err); this.state = 'failed'; this.view.onRealisticFailed?.(); });
    }

    async load() {
        const R = E.relief;
        if (!R) throw new Error('los datos del mapa no traen relieve');
        const img = new Image();
        img.src = R.src ?? 'relieve.png';
        await img.decode();
        const c = document.createElement('canvas');
        c.width = R.w; c.height = R.h;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(img, 0, 0);
        const px = x.getImageData(0, 0, R.w, R.h).data, n = R.w * R.h;
        this.elev = new Float32Array(n); this.tree = new Float32Array(n); this.cls = new Uint8Array(n);
        for (let i = 0; i < n; i++) {
            this.elev[i] = (px[i * 4] / 255) ** 2 * 4800;
            this.tree[i] = px[i * 4 + 1] / 200;
            this.cls[i] = px[i * 4 + 2] & 7;
        }
        // Sombreado del relieve, luz del noroeste; pendientes exageradas para que se lean a esta escala (más en el mapa
        // del mundo, donde cada píxel abarca más y las pendientes medias salen más suaves).
        this.shade = new Float32Array(n);
        const unitKm = E.unitKm ?? 5, metersPerPx = unitKm * 1000 * R.res, exaggerate = 9 * Math.sqrt(unitKm / 5);
        for (let yy = 1; yy < R.h - 1; yy++) for (let xx = 1; xx < R.w - 1; xx++) {
            const i = yy * R.w + xx, e = this.elev;
            const sx = (e[i + 1] - e[i - 1]) / (2 * metersPerPx), sy = (e[i + R.w] - e[i - R.w]) / (2 * metersPerPx);
            this.shade[i] = Math.max(-1, Math.min(1, (sx + sy) * exaggerate));
        }
        this.buildStatic();
        await this.buildBase();
        this.buildItems();
    }

    field(arr, x, y) {   // muestreo bilineal en coordenadas del mapa
        const R = E.relief, fx = (x - R.x0) / R.res - 0.5, fy = (y - R.y0) / R.res - 0.5;
        const ix = Math.max(0, Math.min(R.w - 2, Math.floor(fx))), iy = Math.max(0, Math.min(R.h - 2, Math.floor(fy)));
        const u = clamp01(fx - ix), v = clamp01(fy - iy), i = iy * R.w + ix;
        return (arr[i] * (1 - u) + arr[i + 1] * u) * (1 - v) + (arr[i + R.w] * (1 - u) + arr[i + R.w + 1] * u) * v;
    }
    clsAt(x, y) {
        const R = E.relief, ix = Math.max(0, Math.min(R.w - 1, Math.floor((x - R.x0) / R.res))), iy = Math.max(0, Math.min(R.h - 1, Math.floor((y - R.y0) / R.res)));
        return this.cls[iy * R.w + ix];
    }

    // Costa y lagos (de las casillas), ríos.
    buildStatic() {
        const water = i => i < 0 || !isLand(i) || CELL_TERRAIN[i] === 'lake';
        const coast = [];
        for (const i of G.land) {
            if (CELL_TERRAIN[i] === 'lake') continue;
            for (let d = 0; d < 6; d++) if (water(G.nb[i * 6 + d])) coast.push([i, d]);
        }
        const chains = smoothChains(coast, 3);
        this.landPath = new Path2D();
        for (const c of chains) addPoly(this.landPath, c.pts, c.closed);
        this.coastChunks = chunkLines(chains);
        const rivers = { 1: [], 2: [], 3: [] };
        for (const r of E.rivers ?? []) {
            const pts = [];
            for (let k = 1; k + 1 < r.length; k += 2) pts.push([r[k], r[k + 1]]);
            rivers[r[0]].push({ pts: chaikin(pts, false, 2), closed: false });
        }
        this.rivers = Object.fromEntries(Object.entries(rivers).map(([w, list]) => [w, chunkLines(list)]));
    }

    // Lienzo del terreno: color por usos del suelo y altura, sombreado y una textura de parcelas.
    async buildBase() {
        const W = Math.ceil(G.width * BASE_RES), H = Math.ceil(G.height * BASE_RES);
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const x = c.getContext('2d'), img = x.createImageData(W, H), d = img.data;
        const R = E.relief, ox = R.x0, oy = R.y0;
        // Ruido en tablas de 256×256 que se repiten: mucho más barato que calcularlo en cada píxel.
        const NT = 256, T1 = new Float32Array(NT * NT), T2 = new Float32Array(NT * NT), T3 = new Float32Array(NT * NT);
        for (let j = 0; j < NT; j++) for (let i = 0; i < NT; i++) {
            const q = (a, f, sd) => (vnoise(a * f, j * f, sd) * (NT - i) + vnoise((a - NT) * f, j * f, sd) * i) / NT;   // periódico
            T1[j * NT + i] = q(i, 0.3, 3); T2[j * NT + i] = q(i, 0.87, 5); T3[j * NT + i] = q(i, 0.3, 9);
        }
        let t0 = performance.now();
        for (let py = 0; py < H; py++) {
            const wy = oy + (py + 0.5) / BASE_RES, row = (py & (NT - 1)) * NT;
            for (let px = 0; px < W; px++) {
                const wx = ox + (px + 0.5) / BASE_RES, o = (py * W + px) * 4, ti = row + (px & (NT - 1));
                const n1 = T1[ti], n2 = T2[ti];
                const e = this.field(this.elev, wx, wy), tr = this.field(this.tree, wx, wy), sh = this.field(this.shade, wx, wy);
                const k = this.clsAt(wx + (n1 - 0.5) * 1.6, wy + (T3[ti] - 0.5) * 1.6);
                let col;
                switch (k) {
                    case 1: col = mixRGB(PAINT.crop, PAINT.crop2, n2); break;
                    case 2: col = PAINT.shrub; break;
                    case 3: col = PAINT.bare; break;
                    case 4: col = PAINT.built; break;
                    case 6: col = PAINT.wet; break;
                    case 7: col = PAINT.snow; break;
                    default: col = mixRGB(PAINT.grass, PAINT.crop2, n2 * 0.6);
                }
                const forest = smoothstep(0.3, 0.65, tr + (n1 - 0.5) * 0.35);
                const conifer = smoothstep(500, 1100, e) + smoothstep(470, 420, wy);   // montaña y norte (más allá de ~58° N)
                col = mixRGB(col, mixRGB(mixRGB(PAINT.forest1, PAINT.forest2, n2), PAINT.conifer, clamp01(conifer)), forest * 0.9);
                col = mixRGB(col, PAINT.hill, smoothstep(500, 1100, e) * 0.35);
                col = mixRGB(col, PAINT.rock, smoothstep(1300, 2200, e));
                col = mixRGB(col, PAINT.rockhi, smoothstep(2200, 2800, e));
                col = mixRGB(col, PAINT.snow, Math.max(smoothstep(2700, 3300, e), k === 7 ? 0.85 : 0));
                const light = 1 + sh * 0.55 + (n2 - 0.5) * 0.06;
                d[o] = col[0] * light; d[o + 1] = col[1] * light; d[o + 2] = col[2] * light; d[o + 3] = 255;
            }
            if (performance.now() - t0 > 24) { await new Promise(r => setTimeout(r, 0)); t0 = performance.now(); }
        }
        x.putImageData(img, 0, 0);
        this.base = c;
    }

    // Elementos de decoración, en coordenadas del mapa y repartidos en cubetas de 8 unidades.
    buildItems() {
        const items = [];
        const isDry = i => isLand(i) && CELL_TERRAIN[i] !== 'lake';
        const cellAt = (x, y) => G.cellAt(x, y);
        // Árboles: densidad según el bosque real del píxel.
        const sp = 0.8, R = E.relief;
        let iy = 0;
        for (let y = R.y0; y < R.y0 + G.height; y += sp * 0.866, iy++) {
            let ix = 0;
            for (let x = R.x0 + (iy & 1 ? sp / 2 : 0); x < R.x0 + G.width; x += sp, ix++) {
                const jx = x + (hash2(ix, iy, 1) - 0.5) * sp * 0.9, jy = y + (hash2(ix, iy, 2) - 0.5) * sp * 0.9;
                const tr = this.field(this.tree, jx, jy), h = hash2(ix, iy, 3);
                if (h > smoothstep(0.18, 0.72, tr) * 0.95 + 0.01) continue;   // arboleda dispersa: pocos árboles; bosque: lleno
                const c = cellAt(jx, jy);
                if (c < 0 || !isDry(c) || CITY_OF[c] >= 0 || CELL_TERRAIN[c] === 'urban') continue;
                const e = this.field(this.elev, jx, jy);
                if (e > 2300) continue;
                items.push({ k: e > 700 || jy < 445 ? 1 : 0, x: jx, y: jy, s: 0.3 + h * 0.18, h });
            }
        }
        for (const i of G.land) {
            const t = CELL_TERRAIN[i], cx = G.cx[i], cy = G.cy[i], S = G.S;
            const jit = (k, s) => [(hash2(i, k, s) - 0.5) * S * 1.1, (hash2(i, k, s + 1) - 0.5) * S * 0.9];
            if (t === 'mountain') {
                for (let k = 0; k < 3; k++) {
                    const [dx, dy] = jit(k, 11), x = cx + dx, y = cy + dy + 0.6, e = this.field(this.elev, x, y - 0.5);
                    items.push({ k: 2, x, y, s: 1.05 + hash2(i, k, 13) * 0.55, e, h: hash2(i, k, 14) });
                }
            } else if (t === 'hills') {
                for (let k = 0; k < 2; k++) { const [dx, dy] = jit(k, 21); items.push({ k: 3, x: cx + dx, y: cy + dy, s: 0.8 + hash2(i, k, 23) * 0.4 }); }
            } else if (t === 'marsh') {
                for (let k = 0; k < 4; k++) { const [dx, dy] = jit(k, 31); items.push({ k: 4, x: cx + dx, y: cy + dy, s: 0.5 + hash2(i, k, 33) * 0.3 }); }
            }
            if (t === 'urban' || CITY_OF[i] >= 0) {
                const p = PROVINCES[G.prov[i]], big = t === 'urban' || CAPITAL_OF[i] >= 0;
                const n = big ? 14 : Math.max(4, Math.min(10, Math.round(Math.log10(p.population) * 2 - 6)));
                const rad = big ? 1.9 : 1.2;
                for (let k = 0; k < n; k++) {
                    const a = hash2(i, k, 41) * TAU, r = Math.sqrt(hash2(i, k, 42)) * rad;
                    items.push({ k: 5, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * 0.8, s: 0.26 + hash2(i, k, 43) * 0.12, h: hash2(i, k, 44) });
                }
            }
        }
        // Olas junto a la costa
        for (const i of G.land) for (let d = 0; d < 6; d++) {
            const j = G.nb[i * 6 + d];
            if (j < 0 || isLand(j) || hash2(i, d, 51) > 0.5) continue;
            const a = G.corners[d], b = G.corners[(d + 1) % 6], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], L = Math.hypot(m[0], m[1]);
            items.push({ k: 6, x: G.cx[i] + m[0] * (1 + 1.3 / L * G.S), y: G.cy[i] + m[1] * (1 + 1.3 / L * G.S), s: 0.6 + hash2(i, d, 52) * 0.4 });
        }
        items.sort((p, q) => p.y - q.y);
        items.forEach((it, k) => { it.r = hash2(k, 7, 61); });   // para aclarar árboles y olas de lejos sin que parpadeen
        this.items = items;
        this.buckets = new Map();
        items.forEach((it, idx) => {
            const key = `${Math.floor(it.x / 8)},${Math.floor(it.y / 8)}`;
            if (!this.buckets.has(key)) this.buckets.set(key, []);
            this.buckets.get(key).push(idx);
        });
    }

    drawItem(x, it) {
        const X = it.x, Y = it.y, s = it.s;
        switch (it.k) {
            case 0: case 1: {
                x.fillStyle = 'rgba(20,30,10,0.33)'; x.beginPath(); x.ellipse(X + s * 0.6, Y + s * 0.45, s * 1.1, s * 0.55, 0, 0, TAU); x.fill();
                if (it.k === 1) {
                    x.fillStyle = '#35553a'; x.beginPath(); x.moveTo(X, Y - s * 2.5); x.lineTo(X + s, Y + 0.1 * s); x.lineTo(X - s, Y + 0.1 * s); x.closePath(); x.fill();
                    x.fillStyle = 'rgba(150,185,110,0.35)'; x.beginPath(); x.moveTo(X, Y - s * 2.5); x.lineTo(X - s * 0.1, Y); x.lineTo(X - s, Y + 0.1 * s); x.closePath(); x.fill();
                } else {
                    x.fillStyle = it.h > 0.5 ? '#47693a' : '#3f5e30'; x.beginPath(); x.arc(X, Y - s * 0.6, s, 0, TAU); x.fill();
                    x.fillStyle = 'rgba(170,200,100,0.42)'; x.beginPath(); x.arc(X - s * 0.32, Y - s * 0.95, s * 0.5, 0, TAU); x.fill();
                }
                break;
            }
            case 2: {   // montaña: dos caras y nieve por encima de ~2200 m
                const h = 2.2 * s, w = h * (1.25 + it.h * 0.3), tip = X + (it.h - 0.5) * 0.5;
                x.fillStyle = '#cbbfa8'; x.beginPath(); x.moveTo(X - w / 2, Y); x.lineTo(tip, Y - h); x.lineTo(X + w * 0.06, Y); x.closePath(); x.fill();
                x.fillStyle = '#7b6d5c'; x.beginPath(); x.moveTo(X + w * 0.06, Y); x.lineTo(tip, Y - h); x.lineTo(X + w / 2, Y); x.closePath(); x.fill();
                if (it.e > 1900) {
                    const f = Math.min(0.75, 0.45 + (it.e - 1900) / 3000);
                    x.fillStyle = '#f6f3ec'; x.beginPath();
                    x.moveTo(tip - w * 0.5 * f * 0.7, Y - h * (1 - f * 0.6)); x.lineTo(tip, Y - h); x.lineTo(tip + w * 0.5 * f * 0.75, Y - h * (1 - f * 0.62));
                    x.lineTo(tip + w * 0.05, Y - h * (1 - f * 0.45)); x.closePath(); x.fill();
                }
                x.strokeStyle = 'rgba(58,44,30,0.45)'; x.lineWidth = 0.08;
                x.beginPath(); x.moveTo(X - w / 2, Y); x.lineTo(tip, Y - h); x.lineTo(X + w / 2, Y); x.stroke();
                break;
            }
            case 3: {   // colina
                const w = 1.3 * s, h = 0.75 * s;
                x.fillStyle = 'rgba(96,84,52,0.32)'; x.beginPath(); x.ellipse(X, Y, w, h, 0, Math.PI, 0); x.fill();
                x.strokeStyle = 'rgba(255,250,228,0.4)'; x.lineWidth = 0.1; x.beginPath(); x.ellipse(X, Y, w, h, 0, Math.PI * 1.05, Math.PI * 1.5); x.stroke();
                break;
            }
            case 4: {   // juncos
                x.strokeStyle = 'rgba(52,78,52,0.75)'; x.lineWidth = 0.09;
                x.beginPath();
                for (let k = -2; k <= 2; k++) { x.moveTo(X + k * 0.18 * s, Y); x.lineTo(X + k * 0.32 * s, Y - (0.9 - Math.abs(k) * 0.15) * s); }
                x.stroke();
                x.strokeStyle = 'rgba(200,225,230,0.5)'; x.beginPath(); x.moveTo(X - s, Y + 0.15); x.lineTo(X + s, Y + 0.15); x.stroke();
                break;
            }
            case 5: {   // casa
                const w = s * (1 + it.h * 0.6) * 1.4, h = s;
                x.fillStyle = 'rgba(30,20,10,0.3)'; x.fillRect(X - w / 2 + 0.12, Y - h + 0.12, w, h);
                x.fillStyle = '#efe4c9'; x.fillRect(X - w / 2, Y - h, w, h);
                x.fillStyle = it.h > 0.3 ? '#b4553d' : '#8f4434';
                x.beginPath(); x.moveTo(X - w / 2 - 0.08, Y - h); x.lineTo(X, Y - h - s * 0.85); x.lineTo(X + w / 2 + 0.08, Y - h); x.closePath(); x.fill();
                break;
            }
            case 6: {   // ola
                x.strokeStyle = 'rgba(235,245,245,0.3)'; x.lineWidth = 0.1;
                x.beginPath(); x.arc(X, Y, 0.55 * s, Math.PI * 1.15, Math.PI * 1.85); x.stroke();
                break;
            }
        }
    }

    // Territorio de cada país (suavizado) y fronteras entre países, rehechos cuando cambian los dueños.
    buildOwners() {
        const g = this.view.game;
        const per = new Map(), border = [];
        for (const i of G.land) {
            const o = g.owner[i];
            if (!per.has(o)) per.set(o, []);
            for (let d = 0; d < 6; d++) {
                const j = G.nb[i * 6 + d];
                if (j < 0 || !isLand(j) || g.owner[j] !== o) per.get(o).push([i, d]);
                if (d < 3 && j >= 0 && isLand(j) && g.owner[j] !== o) border.push([i, d]);
            }
        }
        this.nations = new Map();
        for (const [o, edges] of per) {
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            for (const [i] of edges) { x0 = Math.min(x0, G.cx[i]); y0 = Math.min(y0, G.cy[i]); x1 = Math.max(x1, G.cx[i]); y1 = Math.max(y1, G.cy[i]); }
            this.nations.set(o, { path: smoothRegion(edges, 3), bbox: [x0 - 3, y0 - 3, x1 + 3, y1 + 3] });
        }
        this.borders = chunkLines(smoothChains(border, 3));
        this.ownerKey = g.version;
    }

    // Carreteras: curvas que pasan por el centro de cada casilla y por el punto medio de cada tramo.
    buildRoads() {
        const g = this.view.game;
        this.roads = { 1: new Path2D(), 2: new Path2D() };
        const mid = (i, d) => { const j = G.nb[i * 6 + d]; return [(G.cx[i] + G.cx[j]) / 2, (G.cy[i] + G.cy[j]) / 2]; };
        for (const i of G.land) {
            const ds = [0, 1, 2, 3, 4, 5].filter(d => g.road[i * 6 + d]);
            if (!ds.length) continue;
            for (const cls of [1, 2]) {
                const mine = ds.filter(d => g.road[i * 6 + d] >= cls), p = this.roads[cls];
                if (mine.length === 2) {
                    const a = mid(i, mine[0]), b = mid(i, mine[1]);
                    p.moveTo(a[0], a[1]); p.quadraticCurveTo(G.cx[i], G.cy[i], b[0], b[1]);
                } else for (const d of mine) { const a = mid(i, d); p.moveTo(G.cx[i], G.cy[i]); p.lineTo(a[0], a[1]); }
            }
        }
        // Tramos rotos y en obra: discontinuos, con una marca de corte en su centro
        this.cuts = { line: new Path2D(), work: new Path2D(), mark: new Path2D() };
        for (const i of G.land) for (let d = 0; d < 3; d++) {
            if (!g.broken[i * 6 + d]) continue;
            const j = G.nb[i * 6 + d], len = Math.hypot(G.cx[j] - G.cx[i], G.cy[j] - G.cy[i]) || 1, k = G.S * 0.2;
            const nx = -(G.cy[j] - G.cy[i]) / len * k, ny = (G.cx[j] - G.cx[i]) / len * k, [mx, my] = mid(i, d);
            const into = g.roadWork.has(edgeKey(i, d)) ? this.cuts.work : this.cuts.line;
            into.moveTo(G.cx[i], G.cy[i]); into.lineTo(G.cx[j], G.cy[j]);
            this.cuts.mark.moveTo(mx - nx, my - ny); this.cuts.mark.lineTo(mx + nx, my + ny);
        }
        this.roadKey = g.roadVersion;
    }

    // Pinta el mundo en `x` (ya transformado a coordenadas del mapa) a `b` píxeles por unidad, dentro de `rect`.
    paintWorld(x, b, rect) {
        const g = this.view.game, [wx0, wy0, wx1, wy1] = rect, R = E.relief;
        const detail = smoothstep(7, 12, G.S * b);
        const meets = bb => !(bb[2] < wx0 || bb[0] > wx1 || bb[3] < wy0 || bb[1] > wy1);
        x.fillStyle = SEA_COLOR; x.fillRect(wx0, wy0, wx1 - wx0, wy1 - wy0);
        x.lineJoin = 'round'; x.lineCap = 'round';
        x.strokeStyle = 'rgba(96,156,176,0.45)'; x.lineWidth = 3.2; strokeChunks(x, this.coastChunks, rect, 2);
        x.strokeStyle = 'rgba(140,190,200,0.5)'; x.lineWidth = 1.2; strokeChunks(x, this.coastChunks, rect, 2);

        x.save();
        x.clip(this.landPath, 'evenodd');
        x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
        const sx0 = Math.max(0, Math.floor((wx0 - R.x0) * BASE_RES) - 2), sy0 = Math.max(0, Math.floor((wy0 - R.y0) * BASE_RES) - 2);
        const sx1 = Math.min(this.base.width, Math.ceil((wx1 - R.x0) * BASE_RES) + 2), sy1 = Math.min(this.base.height, Math.ceil((wy1 - R.y0) * BASE_RES) + 2);
        if (sx1 > sx0 && sy1 > sy0) x.drawImage(this.base, sx0, sy0, sx1 - sx0, sy1 - sy0,
            R.x0 + sx0 / BASE_RES, R.y0 + sy0 / BASE_RES, (sx1 - sx0) / BASE_RES, (sy1 - sy0) / BASE_RES);
        // Velo del color de cada país: fuerte de lejos (mapa político), suave de cerca
        x.globalAlpha = 0.62 - 0.44 * detail;
        for (const [o, n] of this.nations) if (meets(n.bbox)) { x.fillStyle = g.nations[o].color; x.fill(n.path, 'evenodd'); }
        x.globalAlpha = 1;
        x.strokeStyle = '#4a86a0';
        for (const [w, wl] of [[1, 0.24], [2, 0.36], [3, 0.5]]) { x.lineWidth = Math.max(wl, 0.9 / b); strokeChunks(x, this.rivers[w], rect, 1); }
        x.restore();

        // Árboles, montañas, colinas, juncos, casas y olas. Nivel de detalle: los árboles y las olas, pequeños y muchísimos,
        // solo de cerca y aclarándose al alejarse (el color del bosque ya está en el lienzo del terreno); montañas, colinas,
        // juncos y casas desde un poco antes.
        const trees = smoothstep(6, 12, b), waves = smoothstep(6, 10, b);
        if (detail > 0.01) {
            x.globalAlpha = detail;
            const m = 3;
            for (let by = Math.floor((wy0 - m) / 8); by <= Math.floor((wy1 + m) / 8); by++) {
                const idx = [];
                for (let bx = Math.floor((wx0 - m) / 8); bx <= Math.floor((wx1 + m) / 8); bx++) {
                    const list = this.buckets.get(`${bx},${by}`);
                    if (list) idx.push(...list);
                }
                idx.sort((p, q) => p - q);   // ya ordenados por y: así se solapan bien
                for (const k of idx) {
                    const it = this.items[k];
                    if (it.k <= 1 ? it.r >= trees : it.k === 6 && it.r >= waves) continue;
                    this.drawItem(x, it);
                }
            }
            x.globalAlpha = 1;
        }

        // Carreteras
        x.strokeStyle = 'rgba(70,55,35,0.6)'; x.lineWidth = Math.max(0.42, 2.2 / b); x.stroke(this.roads[1]);
        x.strokeStyle = '#efe3c0'; x.lineWidth = Math.max(0.2, 1.1 / b); x.stroke(this.roads[1]);
        x.strokeStyle = 'rgba(70,45,20,0.7)'; x.lineWidth = Math.max(0.6, 3 / b); x.stroke(this.roads[2]);
        x.strokeStyle = '#f3d27a'; x.lineWidth = Math.max(0.32, 1.6 / b); x.stroke(this.roads[2]);
        x.lineCap = 'butt'; x.setLineDash([2.2 / b, 2.2 / b]); x.lineWidth = Math.max(0.3, 1.5 / b);
        x.strokeStyle = 'rgba(70,55,35,0.75)'; x.stroke(this.cuts.line);
        x.strokeStyle = '#e3d9c0'; x.stroke(this.cuts.work);
        x.setLineDash([]); x.strokeStyle = 'rgba(60,25,15,0.9)'; x.lineWidth = Math.max(0.45, 2 / b); x.stroke(this.cuts.mark);
        x.lineCap = 'round';

        // Fronteras: cinta del color de cada país por dentro de su territorio y línea discontinua encima
        const band = Math.max(0.55, 4 / b);
        for (const [o, n] of this.nations) {
            if (!meets(n.bbox)) continue;
            const r = [Math.max(wx0, n.bbox[0]), Math.max(wy0, n.bbox[1]), Math.min(wx1, n.bbox[2]), Math.min(wy1, n.bbox[3])];
            x.save(); x.clip(n.path, 'evenodd');
            x.strokeStyle = rgbaHex(g.nations[o].color, 0.9); x.lineWidth = band * 2; strokeChunks(x, this.borders, r, band + 1);
            x.restore();
        }
        x.strokeStyle = 'rgba(40,30,18,0.85)'; x.lineWidth = 1.3 / b;
        x.setLineDash([6 / b, 3 / b]); strokeChunks(x, this.borders, rect); x.setLineDash([]);
        x.strokeStyle = 'rgba(40,52,58,0.55)'; x.lineWidth = 0.9 / b; strokeChunks(x, this.coastChunks, rect);
    }

    // Capa del mundo: una vista general de todo el mapa y, al acercarse, teselas guardadas a la resolución de la pantalla.
    // Solo se repintan cuando cambian los dueños o las carreteras; mientras, se sigue enseñando la versión anterior.
    drawWorld(ctx, now) {
        const v = this.view, g = v.game, R = E.relief;
        if (this.ownerKey !== g.version) this.buildOwners();
        if (this.roadKey !== g.roadVersion) this.buildRoads();
        const ver = `${this.ownerKey}:${this.roadKey}`;
        if (this.overviewKey !== ver) {
            const OV = 1.5, c = this.overview ?? document.createElement('canvas');
            c.width = Math.ceil(G.width * OV); c.height = Math.ceil(G.height * OV);
            const x = c.getContext('2d');
            x.setTransform(OV, 0, 0, OV, -R.x0 * OV, -R.y0 * OV);
            this.paintWorld(x, OV, [R.x0, R.y0, R.x0 + G.width, R.y0 + G.height]);
            this.overview = c; this.overviewKey = ver;
        }
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(this.overview, R.x0, R.y0, this.overview.width / 1.5, this.overview.height / 1.5);
        const eff = v.scale * v.dpr;
        if (eff <= 1.9) return;
        const b = 2 ** Math.max(1, Math.min(6, Math.round(Math.log2(eff)))), span = TILE / b;
        const [wx0, wy0] = v.toWorld(0, 0), [wx1, wy1] = v.toWorld(v.w, v.h);
        // Mientras se pintan las de este nivel, debajo van las ya pintadas de los niveles vecinos (al hacer zoom quedan
        // así un momento algo borrosas o afiladas, pero sin huecos ni saltos al mapa general).
        for (const lb of [b / 4, b / 2, b * 2]) {
            if (lb < 2 || lb > 64) continue;
            const ls = TILE / lb;
            for (let ty = Math.floor(wy0 / ls); ty <= Math.floor(wy1 / ls); ty++)
                for (let tx = Math.floor(wx0 / ls); tx <= Math.floor(wx1 / ls); tx++) {
                    const t = this.tiles.get(`${lb}:${tx}:${ty}`);
                    if (t && t.ver === ver) ctx.drawImage(t.c, tx * ls, ty * ls, ls, ls);
                }
        }
        // Las de este nivel: se pintan las que falten, del centro de la pantalla hacia fuera, hasta gastar PAINT_MS
        // por fotograma (al menos una); las demás, en los siguientes.
        const need = [], ccx = (wx0 + wx1) / 2, ccy = (wy0 + wy1) / 2;
        for (let ty = Math.floor(wy0 / span); ty <= Math.floor(wy1 / span); ty++)
            for (let tx = Math.floor(wx0 / span); tx <= Math.floor(wx1 / span); tx++) need.push([tx, ty]);
        need.sort((p, q) => Math.hypot((p[0] + 0.5) * span - ccx, (p[1] + 0.5) * span - ccy) - Math.hypot((q[0] + 0.5) * span - ccx, (q[1] + 0.5) * span - ccy));
        const t0 = performance.now();
        let painted = 0, pending = false;
        for (const [tx, ty] of need) {
            const key = `${b}:${tx}:${ty}`;
            let t = this.tiles.get(key);
            if (!t || t.ver !== ver) {
                if (painted === 0 || performance.now() - t0 < PAINT_MS) {
                    painted++;
                    const c = t?.c ?? document.createElement('canvas');
                    c.width = c.height = TILE;
                    const x = c.getContext('2d');
                    x.setTransform(b, 0, 0, b, -tx * span * b, -ty * span * b);
                    this.paintWorld(x, b, [tx * span, ty * span, (tx + 1) * span, (ty + 1) * span]);
                    t = { c, ver };
                } else { pending = true; t = null; }
            }
            if (t) {
                this.tiles.delete(key); this.tiles.set(key, t);   // LRU: al final
                ctx.drawImage(t.c, tx * span, ty * span, span, span);
            }
        }
        while (this.tiles.size > MAX_TILES) this.tiles.delete(this.tiles.keys().next().value);
        if (pending) v.requestFrame();
    }

    // Miniatura de un ejército: carro, pelotón, cañón o lanzador antiaéreo sobre una peana del color del país. Si no se sabe qué es
    // (niebla de guerra sin inteligencia), un camión con lona y el escalón de la OTAN en lugar del número. Embarcado
    // (o.afloat), la peana es el casco de un barco de transporte que se mece con las olas.
    drawArmy(ctx, o) {
        const { x, y, hexPx, color, type, n, mine, spent, selected, moving, facing, now } = o;
        const alpha = (o.alpha ?? 1) * (spent ? 0.6 : 1);
        ctx.save();
        ctx.globalAlpha = alpha;
        if (hexPx < 6) {
            ctx.beginPath(); ctx.arc(x, y, 3.6, 0, TAU); ctx.fillStyle = color; ctx.fill();
            ctx.lineWidth = 1.4; ctx.strokeStyle = selected ? '#fff' : mine ? SIGNAL : '#f4efe0'; ctx.stroke();
            ctx.restore();
            return;
        }
        const U = Math.max(8, Math.min(24, hexPx * 0.82)), k = U / 16;
        if (o.afloat) {   // vaivén: el barco sube, baja y se escora un poco, con todo lo que lleva encima
            const roll = Math.sin(now / 400);
            ctx.translate(x, y + roll * U * 0.05); ctx.rotate(roll * 0.04 * facing); ctx.translate(-x, -y);
            this.drawHull(ctx, o, U);
        } else this.drawBase(ctx, o, U);
        // banderín
        const fx = x - facing * U * 0.8, wave = moving ? Math.sin(now / 120) * 1.4 : 0;
        ctx.strokeStyle = '#3a3222'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(fx, y + U * 0.15); ctx.lineTo(fx, y - U * 1.45); ctx.stroke();
        ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(fx, y - U * 1.45); ctx.lineTo(fx - facing * U * 0.75, y - U * 1.25 + wave); ctx.lineTo(fx, y - U * 1.02); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 0.8; ctx.stroke();
        ctx.translate(x, y + U * 0.22); ctx.scale(k * facing, k);
        if (type === 'tank') miniTank(ctx, now, moving, color);
        else if (type === 'artillery') miniGun(ctx, now, moving);
        else if (type === 'antiair') miniAA(ctx, now, moving);
        else if (type === null) miniTruck(ctx, now, moving);
        else { miniSoldier(ctx, -8, -1, now, moving, 0); miniSoldier(ctx, 9, -1, now, moving, 2.1); miniSoldier(ctx, 0.5, 1.5, now, moving, 1.1); }
        ctx.restore();
        ctx.save();
        const dpr = this.view.dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.globalAlpha = alpha;
        const t = n === null ? o.echelon : String(n);
        ctx.font = `700 ${Math.round(Math.max(10, Math.min(15, U * 0.62)))}px 'Barlow Semi Condensed', Bahnschrift, 'Arial Narrow', sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const w = Math.max(ctx.measureText(t).width + 8, 16), by = y + U * 0.82;
        ctx.fillStyle = mine ? SIGNAL : '#ebe7d8'; ctx.strokeStyle = INK; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.roundRect(x - w / 2, by - 7, w, 14, 7); ctx.fill(); ctx.stroke();
        ctx.fillStyle = INK; ctx.fillText(t, x, by + 0.5);
        ctx.restore();
    }
    // Peana de tierra: sombra, anillo de elegido, borde del nivel y la señal de estado.
    drawBase(ctx, o, U) {
        const { x, y, color, flanked, noSupply, starving, selected, now } = o;
        ctx.fillStyle = 'rgba(20,16,8,0.38)'; ctx.beginPath(); ctx.ellipse(x + U * 0.2, y + U * 0.45, U * 1.12, U * 0.42, 0, 0, TAU); ctx.fill();
        if (selected) {
            ctx.strokeStyle = SIGNAL; ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.ellipse(x, y + U * 0.28, U * 1.28 + Math.sin(now / 220) * 1.2, U * 0.5, 0, 0, TAU); ctx.stroke();
        }
        ctx.fillStyle = shadeHex(color, -0.4); ctx.beginPath(); ctx.ellipse(x, y + U * 0.34, U, U * 0.38, 0, 0, TAU); ctx.fill();
        if (o.level > 0) {   // borde de la peana: bronce, plata u oro según el nivel de su rama de tropa
            ctx.strokeStyle = BASE_RIM[o.level]; ctx.lineWidth = Math.max(1.6, U * 0.13);
            ctx.beginPath(); ctx.ellipse(x, y + U * 0.34, U, U * 0.38, 0, 0, Math.PI); ctx.stroke();
        }
        ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(x, y + U * 0.25, U, U * 0.36, 0, 0, TAU); ctx.fill();
        if (starving || flanked || noSupply) {   // la misma señal que el borde de la ficha: sin víveres, rodeado, sin suministro
            ctx.strokeStyle = starving ? HUNGER : flanked ? '#e05a47' : '#ff9f1c'; ctx.lineWidth = 2.4;
            ctx.beginPath(); ctx.ellipse(x, y + U * 0.3, U, U * 0.37, 0, 0, TAU); ctx.stroke();
        } else {
            ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.ellipse(x, y + U * 0.25, U * 0.9, U * 0.29, 0, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
        }
    }
    // Casco de un barco de transporte visto de costado, con la proa hacia donde mira el ejército: obra muerta del color
    // del país, obra viva más oscura bajo la línea de flotación, ojos de buey, regala con el borde del nivel y espuma.
    // Las tropas van en cubierta, a la altura de la peana.
    drawHull(ctx, o, U) {
        const { x, y, color, facing: f, flanked, noSupply, starving, selected, moving, now } = o;
        const deck = y + U * 0.22, keel = y + U * 0.66, water = y + U * 0.52;
        ctx.fillStyle = 'rgba(6,20,34,0.4)'; ctx.beginPath(); ctx.ellipse(x, water + U * 0.06, U * 1.45, U * 0.22, 0, 0, TAU); ctx.fill();
        if (selected) {
            ctx.strokeStyle = SIGNAL; ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.ellipse(x, water, U * 1.6 + Math.sin(now / 220) * 1.2, U * 0.42, 0, 0, TAU); ctx.stroke();
        }
        const sheer = () => {   // la cubierta, de popa a proa, que sube en la proa lanzada
            ctx.moveTo(x - f * U * 1.12, deck - U * 0.05);
            ctx.lineTo(x + f * U * 0.95, deck);
            ctx.quadraticCurveTo(x + f * U * 1.25, deck - U * 0.02, x + f * U * 1.36, deck - U * 0.18);
        };
        const hull = () => {
            ctx.beginPath(); sheer();
            ctx.quadraticCurveTo(x + f * U * 1.2, keel - U * 0.06, x + f * U * 0.8, keel);                 // roda hasta la quilla
            ctx.lineTo(x - f * U * 0.95, keel);
            ctx.quadraticCurveTo(x - f * U * 1.12, keel - U * 0.08, x - f * U * 1.12, deck - U * 0.05);    // espejo de popa
            ctx.closePath();
        };
        hull(); ctx.fillStyle = color; ctx.fill();
        ctx.save(); hull(); ctx.clip();
        ctx.fillStyle = shadeHex(color, -0.45); ctx.fillRect(x - U * 1.5, water, U * 3, U);
        ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x - U * 1.5, deck, U * 3, U * 0.06);
        ctx.restore();
        ctx.fillStyle = 'rgba(20,24,30,0.55)';
        for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.arc(x + i * U * 0.36, deck + U * 0.15, Math.max(0.9, U * 0.05), 0, TAU); ctx.fill(); }
        // regala: bronce, plata u oro según el nivel de su rama de tropa, como el borde de la peana
        ctx.strokeStyle = o.level > 0 ? BASE_RIM[o.level] : 'rgba(255,255,255,0.4)'; ctx.lineWidth = o.level > 0 ? Math.max(1.6, U * 0.11) : 1;
        ctx.beginPath(); sheer(); ctx.stroke();
        // contorno: la misma señal de estado que la peana, o una línea oscura
        hull();
        if (starving || flanked || noSupply) { ctx.strokeStyle = starving ? HUNGER : flanked ? '#e05a47' : '#ff9f1c'; ctx.lineWidth = 2.4; }
        else { ctx.strokeStyle = shadeHex(color, -0.6); ctx.lineWidth = 1; }
        ctx.stroke();
        // espuma en la línea de flotación, en la roda y en la popa: más larga si navega
        const foam = moving ? 0.5 : 0.22 + Math.sin(now / 400) * 0.04;
        ctx.strokeStyle = 'rgba(240,248,255,0.75)'; ctx.lineWidth = Math.max(1, U * 0.07); ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x + f * U * 1.22, water - U * 0.04); ctx.quadraticCurveTo(x + f * U * 1.4, water + U * 0.06, x + f * U * (1.3 + foam), water + U * 0.12);
        ctx.moveTo(x - f * U * 1.1, water); ctx.lineTo(x - f * U * (1.1 + foam * 1.6), water + U * 0.08);
        ctx.stroke();
        ctx.lineCap = 'butt';
    }

    // --- Aviación: miniaturas sobre peana, como los ejércitos (o: x, y, hexPx, color, n, level, down, left, mine) ---
    drawAirfield(ctx, o) { this.drawMini(ctx, o, 'field', this.paintAirfield); }
    drawSquadrons(ctx, o) { this.drawMini(ctx, o, 'sq', this.paintSquadrons); }
    drawAASite(ctx, o) { this.drawMini(ctx, o, 'aa', this.paintAASite); }
    // Cada miniatura se pinta una vez por aspecto (clase, color, tamaño, nivel, estado y etiqueta) en una imagen aparte y
    // luego solo se copia: a media distancia se ven cientos. El tamaño va en píxeles enteros para que el zoom no las
    // repinte en cada fotograma; se guardan las 300 últimas.
    drawMini(ctx, o, kind, paint) {
        const dpr = this.view.dpr, U = Math.round(Math.max(8, Math.min(24, o.hexPx * 0.82)));
        const key = `${kind}:${o.color}:${U}:${o.hexPx < 6}:${o.level}:${o.down}:${o.left > 0}:${o.n}:${o.mine}:${!!o.flying}:${dpr}:${document.fonts?.status}`;
        const W = 1.8 * U + 10, T = 2 * U + 4, B = 0.8 * U + 9;
        let c = this.minis.get(key);
        if (!c) {
            c = document.createElement('canvas');
            c.width = Math.ceil(2 * W * dpr); c.height = Math.ceil((T + B) * dpr);
            const x = c.getContext('2d');
            x.setTransform(dpr, 0, 0, dpr, W * dpr, T * dpr);
            paint.call(this, x, { ...o, x: 0, y: 0, U });
            if (this.minis.size >= 300) this.minis.delete(this.minis.keys().next().value);
            this.minis.set(key, c);
        }
        ctx.drawImage(c, Math.round((o.x - W) * dpr) / dpr, Math.round((o.y - T) * dpr) / dpr, c.width / dpr, c.height / dpr);
    }
    // Peana de las miniaturas de la aviación: sombra, canto oscuro del color del país con el borde del nivel y la cara de
    // arriba (del color del país, o `top`).
    drawPlinth(ctx, x, y, R, color, level, top = color) {
        ctx.fillStyle = 'rgba(20,16,8,0.38)'; ctx.beginPath(); ctx.ellipse(x + R * 0.18, y + R * 0.4, R * 1.1, R * 0.4, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = shadeHex(color, -0.4); ctx.beginPath(); ctx.ellipse(x, y + R * 0.3, R, R * 0.36, 0, 0, TAU); ctx.fill();
        if (level > 0) {
            ctx.strokeStyle = BASE_RIM[level]; ctx.lineWidth = Math.max(1.4, R * 0.1);
            ctx.beginPath(); ctx.ellipse(x, y + R * 0.3, R, R * 0.36, 0, 0, Math.PI); ctx.stroke();
        }
        ctx.fillStyle = top; ctx.beginPath(); ctx.ellipse(x, y + R * 0.22, R, R * 0.34, 0, 0, TAU); ctx.fill();
        if (top !== color) { ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.4, R * 0.08); ctx.stroke(); }
    }
    // Etiqueta redonda bajo una miniatura (el número, o «?»), como la de los ejércitos.
    miniLabel(ctx, x, y, text, mine, U) {
        ctx.font = `700 ${Math.round(Math.max(10, Math.min(14, U * 0.58)))}px 'Barlow Semi Condensed', Bahnschrift, 'Arial Narrow', sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const w = Math.max(ctx.measureText(text).width + 8, 15);
        ctx.fillStyle = mine ? SIGNAL : '#ebe7d8'; ctx.strokeStyle = INK; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.roundRect(x - w / 2, y - 6.5, w, 13, 6.5); ctx.fill(); ctx.stroke();
        ctx.fillStyle = INK; ctx.fillText(text, x, y + 0.5);
    }
    // Aeródromo: una pista con su hangar del color del país, sobre una peana de hierba. En obra, solo el armazón del
    // hangar; inservible, atenuado y con cráteres en la pista. Si no sabes cuántos escuadrones tiene, «?».
    paintAirfield(ctx, o) {
        const { x, y, hexPx, color, U } = o, k = U / 16;
        ctx.save();
        ctx.globalAlpha = o.left > 0 ? 0.6 : o.down ? 0.55 : 1;
        if (hexPx < 6) { ctx.fillStyle = color; ctx.fillRect(x - 3, y - 2, 6, 4); ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.strokeRect(x - 3, y - 2, 6, 4); ctx.restore(); return; }
        this.drawPlinth(ctx, x, y, U * 1.2, color, o.level, '#8a9a5b');
        ctx.translate(x, y); ctx.scale(k, k);
        // pista en diagonal con su línea central
        ctx.fillStyle = '#4b4c48'; miniPoly(ctx, [[-17, 6.4], [12, 0.6], [17, 2.2], [-12, 8.4]]); ctx.fill();
        ctx.strokeStyle = 'rgba(240,238,226,0.85)'; ctx.lineWidth = 0.7; ctx.setLineDash([2.4, 2]);
        ctx.beginPath(); ctx.moveTo(-13.5, 7.1); ctx.lineTo(13.5, 1.7); ctx.stroke(); ctx.setLineDash([]);
        if (o.down && !o.left) {   // cráteres
            ctx.fillStyle = 'rgba(30,24,16,0.85)';
            for (const [cx, cy] of [[-7, 5.6], [2, 3.8], [9, 2.4]]) { ctx.beginPath(); ctx.ellipse(cx, cy, 1.8, 0.9, 0, 0, TAU); ctx.fill(); }
        }
        // hangar: medio cilindro del color del país, con su frente oscuro
        ctx.save(); ctx.translate(-7, 1.6);
        if (o.left > 0) {
            ctx.strokeStyle = '#3a3222'; ctx.lineWidth = 0.9;   // el armazón: el arco y sus costillas
            ctx.beginPath(); ctx.ellipse(0, 0, 6, 6, 0, Math.PI, 0);
            for (const i of [-3, 0, 3]) { ctx.moveTo(i, 0); ctx.lineTo(i, -Math.sqrt(36 - i * i)); }
            ctx.stroke();
        } else {
            ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(0, 0, 6.5, 6, 0, Math.PI, 0); ctx.closePath(); ctx.fill();
            ctx.strokeStyle = shadeHex(color, -0.5); ctx.lineWidth = 0.8; ctx.stroke();
            ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 0.6;
            ctx.beginPath(); for (const i of [-3, 0, 3]) { ctx.moveTo(i, 0); ctx.lineTo(i, -Math.sqrt(36 - i * i * 0.85)); } ctx.stroke();
            ctx.fillStyle = shadeHex(color, -0.55); ctx.beginPath(); ctx.ellipse(6.2, 0, 1.4, 5.4, 0, Math.PI * 1.5, Math.PI * 0.5, true); ctx.closePath(); ctx.fill();
            ctx.fillStyle = 'rgba(20,20,16,0.75)'; ctx.fillRect(5.1, -3, 1.4, 3);
        }
        ctx.restore();
        ctx.restore();
        if (o.n === null && !o.left) { ctx.save(); ctx.globalAlpha = o.down ? 0.7 : 1; this.miniLabel(ctx, x - U * 0.2, y + U * 0.75, '?', o.mine, U); ctx.restore(); }
    }
    // Escuadrones: un avión de ala en flecha sobre la pista del aeródromo, con una etiqueta con cuántos son; atenuado
    // si ninguno puede volar. En patrulla (o.flying), el avión va en vuelo sobre el soporte de una peana pequeña.
    paintSquadrons(ctx, o) {
        const { x, y, hexPx, color, U } = o, k = U / 16;
        if (hexPx < 6) return;
        ctx.save();
        ctx.globalAlpha = o.down ? 0.6 : 1;
        let px = x + U * 0.42, py = y + U * 0.2, rot = -0.2, size = 0.62;   // sobre la pista, delante del hangar
        if (o.flying) {
            this.drawPlinth(ctx, x, y, U * 0.6, color, o.level);
            py = y - U * 1.1; px = x; rot = -0.35; size = 1;
            ctx.strokeStyle = 'rgba(225,235,240,0.8)'; ctx.lineWidth = Math.max(1, U * 0.08);
            ctx.beginPath(); ctx.moveTo(x, y + U * 0.15); ctx.lineTo(x, py + U * 0.2); ctx.stroke();
        }
        ctx.translate(px, py); ctx.scale(k * size, k * size); ctx.rotate(rot);
        miniJet(ctx, color);
        ctx.restore();
        ctx.save();
        this.miniLabel(ctx, o.flying ? x : x - U * 0.2, y + U * 0.75, String(o.n), o.mine, U);
        ctx.restore();
    }
    // Antiaéreo fijo: un lanzador con dos misiles sobre la peana; dañado, atenuado, con uno solo y humo negro.
    paintAASite(ctx, o) {
        const { x, y, hexPx, color, U } = o, k = U / 16;
        ctx.save();
        ctx.globalAlpha = o.left > 0 ? 0.6 : o.down ? 0.75 : 1;
        if (hexPx < 6) { ctx.beginPath(); ctx.arc(x, y, 3, Math.PI, 0); ctx.closePath(); ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.stroke(); ctx.restore(); return; }
        this.drawPlinth(ctx, x, y, U * 0.85, color, o.level);
        ctx.translate(x, y + U * 0.2); ctx.scale(k, k);
        // la base del lanzador y el pedestal
        ctx.fillStyle = '#4b5530'; miniRect(ctx, -8, -3.5, 16, 4, 1.2); ctx.fill();
        ctx.fillStyle = '#3e4428'; miniRect(ctx, -2, -6.5, 4, 3.5, 0.8); ctx.fill();
        // la rampa inclinada y los misiles
        ctx.save(); ctx.translate(0, -6.5); ctx.rotate(-0.55);
        ctx.fillStyle = '#5f6b3c'; miniRect(ctx, -6, -1, 15, 2, 0.6); ctx.fill();
        if (o.left === 0) for (const dy of o.down ? [-2.6] : [-2.6, -5.2]) {
            ctx.fillStyle = '#e8e6dc'; miniRect(ctx, -5, dy, 13, 2.2, 1.1); ctx.fill();
            ctx.fillStyle = '#b8473a'; ctx.beginPath(); ctx.moveTo(8, dy); ctx.lineTo(10.4, dy + 1.1); ctx.lineTo(8, dy + 2.2); ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#9a988c'; ctx.fillRect(-5, dy - 0.6, 1.6, 3.4);
        }
        ctx.restore();
        if (o.down && o.left === 0) {
            ctx.fillStyle = 'rgba(40,36,30,0.55)';
            for (const [cx, cy, r] of [[4, -10, 2.4], [6.5, -13, 3], [8, -16.5, 3.4]]) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill(); }
        }
        ctx.restore();
    }
}

const BASE_RIM = [null, '#b87333', '#c9ced6', '#e8b931'];
function miniRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function miniPoly(ctx, pts) { ctx.beginPath(); pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); }
function miniSoldier(ctx, x, y, now, moving, ph, k = 1) {
    const step = moving ? Math.sin(now / 110 + ph) : 0, lift = moving ? Math.abs(Math.cos(now / 110 + ph)) * 1.3 : 0;
    ctx.save(); ctx.translate(x, y - lift); ctx.scale(k, k);
    ctx.strokeStyle = '#3b4126'; ctx.lineWidth = 1.7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-1, -6); ctx.lineTo(-1 - step * 1.8, 0); ctx.moveTo(1, -6); ctx.lineTo(1 + step * 1.8, 0); ctx.stroke();
    ctx.fillStyle = '#4b5530'; miniRect(ctx, -4.4, -12.5, 2.4, 5.2, 1); ctx.fill();
    ctx.fillStyle = '#5f6b3c'; miniRect(ctx, -2.8, -13.2, 5.6, 8, 2); ctx.fill();
    ctx.fillStyle = '#d8b48c'; ctx.beginPath(); ctx.arc(0.4, -15.2, 2.1, 0, TAU); ctx.fill();
    ctx.fillStyle = '#4b5530'; ctx.beginPath(); ctx.arc(0.4, -15.8, 2.6, Math.PI, TAU); ctx.fill(); ctx.fillRect(-2.6, -16, 6, 0.9);
    ctx.strokeStyle = '#2a2a20'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(2.2, -8.5); ctx.lineTo(5.6, -18.5); ctx.stroke();
    ctx.restore();
}
function miniTank(ctx, now, moving, color) {
    ctx.translate(0, moving ? Math.sin(now / 45) * 0.4 : 0);
    ctx.fillStyle = '#2a2a22'; miniRect(ctx, -14, -5, 28, 7, 3.5); ctx.fill();
    ctx.fillStyle = '#55534a'; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(-10 + i * 5, -1.5, 1.9, 0, TAU); ctx.fill(); }
    if (moving) { ctx.fillStyle = 'rgba(210,200,170,0.6)'; const off = (now / 30) % 4; for (let i = 0; i < 7; i++) ctx.fillRect(-13 + ((i * 4 + off) % 26), -5, 1, 1); }
    ctx.fillStyle = '#6b7342'; miniPoly(ctx, [[-15, -5], [15, -5], [12, -10], [-13, -10]]); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,230,0.2)'; miniPoly(ctx, [[-13, -10], [12, -10], [11, -9], [-12, -9]]); ctx.fill();
    ctx.fillStyle = '#7d874c'; miniRect(ctx, -7, -15.5, 13, 6, 3); ctx.fill();
    ctx.fillStyle = '#3e4428'; ctx.fillRect(5, -13.8, 14, 2.2); ctx.fillRect(18, -14.3, 2.2, 3.2);
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(-1.5, -12.5, 2.1, 0, TAU); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 0.6; ctx.stroke();
}
function miniTruck(ctx, now, moving) {
    ctx.translate(0, moving ? Math.sin(now / 50) * 0.3 : 0);
    ctx.fillStyle = '#2a2a22';
    for (const x of [-9, 0, 9]) { ctx.beginPath(); ctx.arc(x, -1.5, 2.6, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#4b5530'; miniRect(ctx, -14, -6, 28, 4, 1.5); ctx.fill();
    ctx.fillStyle = '#6b7342'; miniRect(ctx, 6, -12, 8, 7, 2); ctx.fill();
    ctx.fillStyle = 'rgba(200,220,230,0.5)'; ctx.fillRect(9.5, -11, 3.5, 2.8);
    ctx.fillStyle = '#7a7d5c';
    ctx.beginPath(); ctx.moveTo(-14, -6); ctx.lineTo(-14, -12); ctx.quadraticCurveTo(-4.5, -18, 5, -12); ctx.lineTo(5, -6); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(-9, -6); ctx.lineTo(-9, -14.5); ctx.moveTo(-3, -6); ctx.lineTo(-3, -15.6); ctx.stroke();
}
// Avión de ala en flecha visto desde arriba, con el morro a la derecha: fuselaje gris, alas y deriva, y una franja del
// color del país en las alas.
function miniJet(ctx, color) {
    ctx.fillStyle = 'rgba(20,16,8,0.25)'; miniPoly(ctx, [[12, 2.2], [1, 1], [-5, 9.5], [-8, 9.5], [-4, 1.4], [-10, 1.6], [-13, 5], [-14.5, 5], [-13, 1.6]]); ctx.fill();
    ctx.fillStyle = '#9aa1a6'; ctx.strokeStyle = '#3c4246'; ctx.lineWidth = 0.6;
    miniPoly(ctx, [[2, -0.8], [-5, -9], [-8.5, -9], [-4.5, -0.9], [-4.5, 0.9], [-8.5, 9], [-5, 9], [2, 0.8]]); ctx.fill(); ctx.stroke();   // alas
    miniPoly(ctx, [[-10, -0.6], [-13.5, -4.5], [-15, -4.5], [-13.5, -0.6], [-13.5, 0.6], [-15, 4.5], [-13.5, 4.5], [-10, 0.6]]); ctx.fill(); ctx.stroke();   // timón
    ctx.fillStyle = '#b2b8bc'; ctx.beginPath(); ctx.moveTo(13, 0); ctx.quadraticCurveTo(8, -1.7, 0, -1.6); ctx.lineTo(-14, -1); ctx.lineTo(-14, 1); ctx.lineTo(0, 1.6); ctx.quadraticCurveTo(8, 1.7, 13, 0); ctx.fill(); ctx.stroke();   // fuselaje
    ctx.fillStyle = 'rgba(40,60,80,0.8)'; ctx.beginPath(); ctx.ellipse(7, 0, 2.4, 0.8, 0, 0, TAU); ctx.fill();   // cabina
    ctx.fillStyle = color; miniPoly(ctx, [[-3.6, -5], [-5.4, -5], [-6.3, -6.8], [-4.4, -6.8]]); ctx.fill(); miniPoly(ctx, [[-3.6, 5], [-5.4, 5], [-6.3, 6.8], [-4.4, 6.8]]); ctx.fill();
}
// Antiaéreo autopropulsado: un camión con la rampa alzada hacia delante y dos misiles en ella.
function miniAA(ctx, now, moving) {
    ctx.translate(0, moving ? Math.sin(now / 50) * 0.3 : 0);
    ctx.fillStyle = '#2a2a22';
    for (const x of [-9, 0, 9]) { ctx.beginPath(); ctx.arc(x, -1.5, 2.6, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#4b5530'; miniRect(ctx, -14, -6, 28, 4, 1.5); ctx.fill();
    ctx.fillStyle = '#6b7342'; miniRect(ctx, 6, -12, 8, 7, 2); ctx.fill();
    ctx.fillStyle = 'rgba(200,220,230,0.5)'; ctx.fillRect(9.5, -11, 3.5, 2.8);
    ctx.fillStyle = '#3e4428'; miniRect(ctx, -9, -9, 4, 3.5, 0.8); ctx.fill();   // el pedestal de la rampa
    ctx.save(); ctx.translate(-7, -9); ctx.rotate(-0.5);
    ctx.fillStyle = '#5f6b3c'; miniRect(ctx, -6, -1, 16, 2, 0.6); ctx.fill();
    for (const dy of [-2.6, -5.2]) {
        ctx.fillStyle = '#e8e6dc'; miniRect(ctx, -5, dy, 13, 2.2, 1.1); ctx.fill();
        ctx.fillStyle = '#b8473a'; ctx.beginPath(); ctx.moveTo(8, dy); ctx.lineTo(10.4, dy + 1.1); ctx.lineTo(8, dy + 2.2); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#9a988c'; ctx.fillRect(-5, dy - 0.6, 1.6, 3.4);
    }
    ctx.restore();
}
function miniGun(ctx, now, moving) {
    ctx.strokeStyle = '#4a4a35'; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-2, -4); ctx.lineTo(-15, 0); ctx.stroke();
    ctx.save(); ctx.translate(-1, -7); ctx.rotate(-0.36);
    ctx.fillStyle = '#3e4428'; miniRect(ctx, -3, -1.6, 20, 3.2, 1.5); ctx.fill(); ctx.fillRect(15.5, -2.2, 2.4, 4.4);
    ctx.restore();
    ctx.fillStyle = '#6b7342'; miniPoly(ctx, [[-2, -12.5], [3, -13.5], [3.5, -5], [-1.5, -4.5]]); ctx.fill();
    ctx.save(); ctx.translate(-1, -4);
    ctx.fillStyle = '#2e2d24'; ctx.beginPath(); ctx.arc(0, 0, 4.6, 0, TAU); ctx.fill();
    ctx.rotate(moving ? now / 140 : 0); ctx.strokeStyle = '#8a8570'; ctx.lineWidth = 0.7;
    ctx.beginPath(); for (let i = 0; i < 4; i++) { const t = i * Math.PI / 4; ctx.moveTo(Math.cos(t) * 3.8, Math.sin(t) * 3.8); ctx.lineTo(-Math.cos(t) * 3.8, -Math.sin(t) * 3.8); } ctx.stroke();
    ctx.restore();
    miniSoldier(ctx, -11, 1, now, moving, 0.6, 0.85);
}
