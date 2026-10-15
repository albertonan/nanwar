# NanWar

Estrategia por turnos sobre un mapa hexagonal de Europa: 42 países y 343 provincias reales, divididas en más de 11 500 hexágonos. Ejércitos con las fuerzas de 2024, carreteras y autopistas que construyes tú, fortificaciones, logística, recursos y alianzas públicas o secretas.

**Jugar:** https://albertonan.github.io/nanwar/

Es una aplicación web instalable (PWA) que funciona sin conexión:

- **Android (Chrome):** abre el enlace y pulsa «Instalar» o, en el menú ⋮, «Instalar aplicación».
- **iPhone / iPad (Safari):** botón Compartir → «Añadir a pantalla de inicio».
- **Ordenador (Chrome o Edge):** icono de instalar en la barra de direcciones.

Las partidas se guardan en el propio dispositivo (autoguardado al final de cada turno y tres ranuras). Para pasar una partida a otro dispositivo, usa «Partida → Exportar a archivo» e «Importar archivo».

## Archivos

| Archivo | Qué es |
| --- | --- |
| `index.html` | El juego entero: motor, mapa e interfaz. |
| `europa-data.js` | El mapa generado: rejilla de hexágonos, provincias, países, recursos y fuerzas iniciales. |
| `manifest.webmanifest`, `sw.js`, `icons/` | Lo que la convierte en aplicación instalable y sin conexión. |
| `fonts/` | Barlow Semi Condensed, incluida para que se vea igual sin conexión. |
| `tools/build-map.mjs` | Genera `europa-data.js` a partir de los datos del simulador GeoSim (no incluidos aquí). |
| `tools/resources.json` | Yacimientos (petróleo, gas, carbón, hierro, minerales), editable a mano. |

## Fuentes y licencias de los datos

- Fronteras de las regiones: © EuroGeographics para las fronteras administrativas, vía Eurostat GISCO (NUTS 2021/2024); Natural Earth 5.1.1 (dominio público) para Rusia, Ucrania, Bielorrusia, Moldavia, Bosnia y Herzegovina y Kosovo.
- Ciudades: GeoNames (CC BY 4.0) y Natural Earth.
- Fuerzas armadas iniciales: aproximación a partir de IISS Military Balance 2024 y SIPRI.
- Yacimientos: ubicación aproximada de cuencas y minas conocidas.
- Tipografía: Barlow Semi Condensed, © The Barlow Project Authors, SIL Open Font License 1.1 (`fonts/OFL.txt`).

Los datos de población, fuerzas y recursos están simplificados para el juego y no pretenden ser exactos.
