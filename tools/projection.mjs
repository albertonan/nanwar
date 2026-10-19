// Proyección del mapa (la misma que tools/geometry/lib/project.mjs de GeoSim): Lambert acimutal equivalente centrada en
// 10° E 52° N, encajada en un viewBox de 1000×1000. Compartida por build-map.mjs y terrain.mjs.
const R = 6371000;
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
export const CENTER = [10, 52];
const CLIP_LON = [-25, 60], CLIP_LAT = [34, 72];

export function laea([lon, lat], [lon0, lat0] = CENTER) {
    const phi = rad(lat), phi0 = rad(lat0), dl = rad(lon - lon0);
    const k = Math.sqrt(2 / (1 + Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(dl)));
    return [R * k * Math.cos(phi) * Math.sin(dl), R * k * (Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * Math.cos(phi) * Math.cos(dl))];
}
function laeaInverse([x, y], [lon0, lat0] = CENTER) {
    const rho = Math.hypot(x, y);
    if (rho < 1e-9) return [lon0, lat0];
    const c = 2 * Math.asin(rho / (2 * R)), phi0 = rad(lat0);
    const lat = Math.asin(Math.cos(c) * Math.sin(phi0) + y * Math.sin(c) * Math.cos(phi0) / rho);
    const lon = rad(lon0) + Math.atan2(x * Math.sin(c), rho * Math.cos(phi0) * Math.cos(c) - y * Math.sin(phi0) * Math.sin(c));
    return [deg(lon), deg(lat)];
}

const frame = (() => {
    const pts = [];
    for (let i = 0; i <= 64; i++) {
        const lon = CLIP_LON[0] + (CLIP_LON[1] - CLIP_LON[0]) * i / 64;
        const lat = CLIP_LAT[0] + (CLIP_LAT[1] - CLIP_LAT[0]) * i / 64;
        pts.push(laea([lon, CLIP_LAT[0]]), laea([lon, CLIP_LAT[1]]), laea([CLIP_LON[0], lat]), laea([CLIP_LON[1], lat]));
    }
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    return { scale: Math.min(1000 / (maxX - minX), 1000 / (maxY - minY)), mx: (minX + maxX) / 2, my: (minY + maxY) / 2 };
})();

export const projectLonLat = p => { const [x, y] = laea(p); return [500 + (x - frame.mx) * frame.scale, 500 - (y - frame.my) * frame.scale]; };
export const unprojectXY = ([u, v]) => laeaInverse([(u - 500) / frame.scale + frame.mx, -(v - 500) / frame.scale + frame.my]);
