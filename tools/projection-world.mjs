// Proyección del mapa del mundo: Equal Earth (equivalente: cada casilla abarca la misma superficie real en todo el
// planeta), centrada en 11° E para que el corte del antimeridiano caiga en el estrecho de Bering (169° O) y no parta
// Rusia ni Alaska. 1 unidad del mapa = KM_PER_UNIT km. La comparten build-world.mjs y terrain.mjs.
const R = 6371;   // km
export const KM_PER_UNIT = 20;
export const LON0 = 11;
const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, M = Math.sqrt(3) / 2;
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
// Desplazamiento para que las coordenadas queden en positivo (el origen no importa a la rejilla).
const OX = 900, OY = 460;

// Longitud relativa al meridiano central, en (-180, 180].
export const relLon = lon => { let l = lon - LON0; while (l <= -180) l += 360; while (l > 180) l -= 360; return l; };

function forward(l, lat) {
    const th = Math.asin(M * Math.sin(rad(lat))), t2 = th * th, t6 = t2 * t2 * t2;
    const x = 2 * Math.sqrt(3) * rad(l) * Math.cos(th) / (3 * (9 * A4 * t6 * t2 + 7 * A3 * t6 + 3 * A2 * t2 + A1));
    const y = th * (A1 + A2 * t2 + t6 * (A3 + A4 * t2));
    return [OX + x * R / KM_PER_UNIT, OY - y * R / KM_PER_UNIT];
}
// [lon, lat] → [x, y]. `l` (opcional) es la longitud relativa ya resuelta, para anillos que cruzan el corte.
export const projectLonLat = ([lon, lat], l = relLon(lon)) => forward(l, lat);

export function unprojectXY([u, v]) {
    const x = (u - OX) * KM_PER_UNIT / R, y = (OY - v) * KM_PER_UNIT / R;
    let th = y;
    for (let k = 0; k < 12; k++) {   // Newton
        const t2 = th * th, t6 = t2 * t2 * t2;
        const f = th * (A1 + A2 * t2 + t6 * (A3 + A4 * t2)) - y, df = A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2);
        const d = f / df;
        th -= d;
        if (Math.abs(d) < 1e-12) break;
    }
    const t2 = th * th, t6 = t2 * t2 * t2;
    const lon = 3 * x * (9 * A4 * t6 * t2 + 7 * A3 * t6 + 3 * A2 * t2 + A1) / (2 * Math.sqrt(3) * Math.cos(th));
    const lat = Math.asin(Math.max(-1, Math.min(1, Math.sin(th) / M)));
    let L = deg(lon) + LON0;
    if (L > 180) L -= 360; else if (L <= -180) L += 360;
    return [L, deg(lat)];
}

// Proyecta un anillo de polígono sin que se estire de un borde a otro del mapa si cruza el corte: todos sus puntos
// se quedan en el lado donde tiene más.
export function projectRing(ring) {
    const ls = ring.map(p => relLon(p[0]));
    const east = ls.filter(l => l > 90).length, west = ls.filter(l => l < -90).length;
    if (east && west) for (let i = 0; i < ls.length; i++) {
        if (east >= west && ls[i] < -90) ls[i] += 360;
        else if (west > east && ls[i] > 90) ls[i] -= 360;
    }
    return ring.map((p, i) => forward(ls[i], p[1]));
}
