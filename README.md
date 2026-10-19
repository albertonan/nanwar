# NanWar

Estrategia por turnos sobre un mapa hexagonal de Europa: 42 países y 343 provincias reales, divididas en más de 11 500 hexágonos. Ejércitos con las fuerzas de 2024, carreteras y autopistas que construyes tú, fortificaciones, logística, recursos y alianzas públicas o secretas.

**Jugar:** https://albertonan.github.io/nanwar/

Es una aplicación web instalable (PWA) que funciona sin conexión:

- **Android (Chrome):** abre el enlace y pulsa «Instalar» o, en el menú ⋮, «Instalar aplicación».
- **iPhone / iPad (Safari):** botón Compartir → «Añadir a pantalla de inicio».
- **Ordenador (Chrome o Edge):** icono de instalar en la barra de direcciones.

La app instalada comprueba sola si hay una versión nueva (al abrirse, al volver a primer plano y cada 15 minutos) y, si la hay, se actualiza y continúa la partida en curso.

El mapa tiene dos vistas, que se cambian en cualquier momento con el botón «Relieve» o la tecla V (se recuerda en cada dispositivo):

- **Sencilla:** colores planos por país, casillas y fichas OTAN.
- **Realista:** el relieve, los bosques, los ríos y las ciudades reales pintados a mano alzada, casillas casi invisibles y ejércitos en miniatura que avanzan por su camino. Al alejarte se ve como un mapa político.

El terreno de cada casilla sale de datos reales y cuenta en las reglas (coste de mover y defensa): llanura 1, urbano 1 (×1,4), bosque 2 (×1,25), colinas 2 (×1,3), montaña 3 (×1,6), pantano 3 (×1,2) y lago 4. Cruzar un río sin carretera cuesta medio punto más, y quien defiende al otro lado tiene ×1,25.

Las partidas se guardan en el propio dispositivo (autoguardado al final de cada turno y tres ranuras). Para pasar una partida a otro dispositivo, usa «Partida → Exportar a archivo» e «Importar archivo».

## Archivos

| Archivo | Qué es |
| --- | --- |
| `index.html` | El juego entero: motor, mapa e interfaz. |
| `europa-data.js` | El mapa generado: rejilla de hexágonos, provincias, países, recursos, fuerzas iniciales, terreno de cada casilla y ríos. |
| `relieve.png` | Elevación, bosque y usos del suelo a ~5 km por píxel, para pintar la vista realista. |
| `vista-realista.js` | La vista realista y las animaciones de los ejércitos (en las dos vistas). |
| `manifest.webmanifest`, `sw.js`, `icons/` | Lo que la convierte en aplicación instalable y sin conexión. |
| `fonts/` | Barlow Semi Condensed, incluida para que se vea igual sin conexión. |
| `tools/build-map.mjs` | Genera `europa-data.js` a partir de los datos del simulador GeoSim (no incluidos aquí). Al final llama a `tools/terrain.mjs`. |
| `tools/build-terrain.mjs` | Añade al `europa-data.js` existente el terreno real por casilla y los ríos, y genera `relieve.png`. Descarga los datos la primera vez a `tools/cache/` (unos 50 s). |
| `tools/smoke-vista.mjs` | Prueba en el navegador (Playwright): empieza una partida, comprueba la vista realista y las animaciones y guarda capturas. |
| `tools/release.mjs` | Marca una versión nueva (`index.html`, `sw.js`, `version.json`) antes de publicar. |
| `tools/resources.json` | Yacimientos (petróleo, gas, carbón, hierro, minerales), editable a mano. |

## Fuentes y licencias de los datos

- Fronteras de las regiones: © EuroGeographics para las fronteras administrativas, vía Eurostat GISCO (NUTS 2021/2024); Natural Earth 5.1.1 (dominio público) para Rusia, Ucrania, Bielorrusia, Moldavia, Bosnia y Herzegovina y Kosovo.
- Ciudades: GeoNames (CC BY 4.0) y Natural Earth.
- Fuerzas armadas iniciales: aproximación a partir de IISS Military Balance 2024 y SIPRI.
- Yacimientos: ubicación aproximada de cuencas y minas conocidas.
- Relieve: teselas Terrarium de Mapzen en AWS (elevation-tiles-prod), a partir de SRTM, GMTED2010, ETOPO1 y otras fuentes públicas.
- Bosques, humedales, lagos y zonas urbanas: © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium (CC BY 4.0).
- Ríos: Natural Earth 5.1.1, rivers_lake_centerlines (dominio público).
- Tipografía: Barlow Semi Condensed, © The Barlow Project Authors, SIL Open Font License 1.1 (`fonts/OFL.txt`).

Los datos de población, fuerzas y recursos están simplificados para el juego y no pretenden ser exactos.
