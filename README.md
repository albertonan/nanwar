# NanWar

Estrategia por turnos sobre un mapa hexagonal de Europa o del mundo entero. Ejércitos con las fuerzas de 2024, carreteras y autopistas que construyes tú, fortificaciones, logística, recursos y alianzas públicas o secretas.

Al empezar una partida nueva se elige el mapa (se recuerda en cada dispositivo; también vale `?mapa=europa` o `?mapa=mundo` en la dirección):

- **Europa:** 42 países y 343 provincias reales en más de 11 500 hexágonos de unos 20 km.
- **Mundo:** 181 países y unas mil provincias (estados, provincias y regiones reales) en unos 21 000 hexágonos de unos 85 km, sobre una proyección equivalente (Equal Earth): cada casilla abarca la misma superficie real en todo el planeta. Quedan fuera la Antártida y los microestados de menos de 150 000 habitantes sin superficie para una casilla. Las rentas salen de la población y del PIB por habitante de cada país.

**Jugar:** https://albertonan.github.io/nanwar/

Es una aplicación web instalable (PWA) que funciona sin conexión:

- **Android (Chrome):** abre el enlace y pulsa «Instalar» o, en el menú ⋮, «Instalar aplicación».
- **iPhone / iPad (Safari):** botón Compartir → «Añadir a pantalla de inicio».
- **Ordenador (Chrome o Edge):** icono de instalar en la barra de direcciones.

La app instalada comprueba sola si hay una versión nueva (al abrirse, al volver a primer plano y cada 15 minutos) y, si la hay, se actualiza y continúa la partida en curso.

El botón «Mapa» (tecla M) reúne la vista y las capas, y se recuerda en cada dispositivo. Hay dos vistas, que también se cambian con la tecla V:

- **Sencilla:** colores planos por país, casillas y fichas OTAN.
- **Realista:** el relieve, los bosques, los ríos y las ciudades reales pintados a mano alzada, casillas casi invisibles y ejércitos en miniatura que avanzan por su camino. Al alejarte se ve como un mapa político.

Y dos capas que se encienden o apagan: **Logística** (tecla L), tu territorio sin suministro en naranja, y **Operaciones y órdenes**, las flechas, líneas y zonas de tus operaciones y los caminos de tus ejércitos.

De lejos solo se ven las capitales y, de los ejércitos, los tuyos, los de tus enemigos en guerra y los que se están moviendo; al acercarte aparecen ciudades, yacimientos y el resto de tropas, y en la vista realista los árboles y las olas.

El terreno de cada casilla sale de datos reales y cuenta en las reglas (coste de mover y defensa): llanura 1, urbano 1 (×1,4), bosque 2 (×1,25), colinas 2 (×1,3), montaña 3 (×1,6), pantano 3 (×1,2) y lago 4. Cruzar un río sin carretera cuesta medio punto más, y quien defiende al otro lado tiene ×1,25.

Las partidas se guardan en el propio dispositivo (autoguardado al final de cada turno y tres ranuras por mapa). Para pasar una partida a otro dispositivo, usa «Partida → Exportar a archivo» e «Importar archivo». Cargar o importar una partida del otro mapa cambia a ese mapa.

## Investigación

Cada país puede investigar mejoras permanentes (botón de la cabecera o tecla I). Hay 36 investigaciones en 12 ramas de tres niveles, agrupadas en cuatro áreas:

- **Militar:** Infantería, Blindados y Artillería (ataque, defensa y velocidad de cada tipo) y Doctrina (menos castigo al estar rodeado, asedios más cortos, menos bajas al ganar).
- **Estado:** Movilización (más reclutas por turno), Ciencia (investigar más rápido, más barato y dos cosas a la vez) e Industria (yacimientos que rinden más y abaratan más las tropas).
- **Terreno:** Infraestructura (carreteras más baratas y más rápidas, suministro más lejos), Movilidad (montaña, colinas, bosque, pantano, ríos y lagos) y Fortificación (más defensa, obras más cortas, búnkeres y casamatas).
- **Inteligencia:** Reconocimiento (más visión, tipo y número de los ejércitos enemigos, sus niveles) y Espionaje (espías más baratos, que duran más y que informan de más).

Cada investigación se paga al empezar (entre 4 y 12 turnos de renta según el nivel, un 10 % más por cada una ya terminada) y tarda 6, 10 o 15 turnos. Se investiga una cosa a la vez (dos con Ciencia 3); si se cambia, la anterior queda en pausa con su progreso. La IA también investiga, según esté en guerra o en paz, sus tropas y su terreno.

En el mapa, los galones bajo la ficha (o el borde de bronce, plata u oro de la peana en la vista realista) indican el nivel investigado en la rama de su tipo de tropa, y las fortificaciones cambian de material con el nivel de su dueño: sacos terreros, hormigón, búnkeres y casamatas.

La niebla de guerra es obligatoria (y antes de elegir país no se ve ningún ejército): de un ejército enemigo a la vista solo se sabe de quién es y su tamaño aproximado, con el escalón de la OTAN sobre una ficha vacía (II batallón, III regimiento, X brigada, XX división). Su tipo y su número se conocen con Reconocimiento 2 o con un espía en la provincia; sus galones y el nivel de sus fortificaciones, con Reconocimiento 3 o con Agentes dobles.

## Mando estratégico

Para que una guerra larga no obligue a mover ficha a ficha, se manda en tres escalones. Cualquier ejército se puede mover a mano en cualquier momento: ese turno manda lo tuyo y al siguiente vuelve a su orden o a su operación.

- **Órdenes de varios turnos** (ficha del ejército): marchar a, atacar, mantener, fortificar aquí y seguir a otro ejército. Mayúsculas + clic da la orden de marchar. Van por el camino más rápido, atacan solo con la ventaja que marques (1,8, 1,3 o 1 a 1; con niebla, contra lo peor del escalón enemigo), se apartan si los rodean y se cancelan tras tres turnos sin paso. Se cumplen solas al terminar el turno o ya con «Ejecutar órdenes» (tecla O). El camino y los turnos que faltan se ven en el mapa.
- **Operaciones** (herramienta Operación, tecla 5, y pestaña Mando): una flecha de ofensiva hasta un objetivo, una línea de defensa por tu territorio o una zona de reunión de reserva, con sus ejércitos asignados. La ofensiva reúne los ejércitos libres a 3 turnos de marcha del punto de partida, de todas las ciudades de la zona (sin tocar a los que guardan otro frente), y avanza y ataca hasta tomar el objetivo; la defensa cubre primero las casillas más amenazadas y puede fortificar; la reserva manda ejércitos a las operaciones que piden ayuda. Cada una puede ser manual (solo dibuja y calcula), asistida (al terminar el turno enseña lo que haría y confirmas) o automática. Al salir de una ciudad dejan una infantería de guarnición. Tu estado mayor lleva 3 a la vez, hasta 6 con Doctrina, y una más por cada 20 provincias.
- **Línea de defensa que piensa**: cada turno compara su fuerza (defensa de sus ejércitos por el terreno: montaña, colinas, bosque, ciudad, capital, río delante y fortificación) con el ataque enemigo que tiene a 3 casillas. Si aguanta, contraataca solo con ventaja; si la rompen o queda por debajo de 1 a 1, se repliega junta a la mejor posición a 2 turnos de marcha (nunca más de 4 desde la línea dibujada ni dejando la capital delante) y se reordena allí. Las ciudades que quedan delante conservan una guarnición que aguanta; los ejércitos cortados rompen el cerco o se refugian en una ciudad o en un monte. Con 1,5 a 1 en la línea dibujada vuelve a ella y recoge a quien dejó atrás. En el mapa, la línea dibujada queda tenue con la flecha de repliegue (W); la ficha enseña el estado y la relación de fuerzas.
- **Reparto de esfuerzos**: las operaciones reclutan por rondas, una unidad cada una, en vez de acabar una antes de empezar la siguiente; la que pide ayuda recibe ejércitos de la reserva, del sobrante de las líneas (nunca por debajo de lo que necesitan para aguantar) y de las ofensivas en pausa, y el parte dice quién cede a quién.
- **Plantillas y refuerzos**: siete plantillas de serie (guarnición, brigadas de infantería, mecanizada y acorazada, punta de lanza, grupo de artillería y división) y hasta doce propias. Con oro por turno, una operación recluta su plantilla (o la sugerida según su tipo, su objetivo y el terreno) en las ciudades más cercanas; las tropas marchan a la zona de reunión y, completa, entra en la operación.
- **Directiva nacional** (pestaña Mando): postura (defensa total, desgaste, ofensiva limitada o guerra total), objetivos estratégicos marcados desde la ficha de cada provincia, con aviso al cumplirlos, y un presupuesto opcional (apagado al empezar) que reparte parte de la renta entre refuerzos, investigación, fortificación y carreteras. Las operaciones se agrupan por frente, con prioridad alta, media o baja; un frente en guerra sin línea lo avisa una vez y propone una línea sobre el tramo por donde aprieta el enemigo, llevada al mejor terreno cercano con su relación prevista (se ve en el mapa al pasar por el botón), y una ofensiva; el resto del frente queda a las guarniciones. La retaguardia manda a la reserva lo que sobra en las ciudades sin peligro. De lejos se ve una ficha por operación y, al volver al turno, un parte de operaciones.

La IA manda con el mismo sistema: en cada frente, una ofensiva si es lo bastante fuerte y una línea en buen terreno si no, que se repliega igual que las tuyas. Sus ofensivas se ven venir con un espía en la provincia de salida o del objetivo, o con Reconocimiento aéreo.

## Archivos

| Archivo | Qué es |
| --- | --- |
| `index.html` | El juego entero: motor, mapa e interfaz. |
| `europa-data.js` | El mapa de Europa generado: rejilla de hexágonos, provincias, países, recursos, fuerzas iniciales, terreno de cada casilla y ríos. |
| `relieve.png` | Elevación, bosque y usos del suelo de Europa a ~5 km por píxel, para pintar la vista realista. |
| `mundo-data.js`, `relieve-mundo.png` | Lo mismo para el mapa del mundo (~20 km por píxel). |
| `vista-realista.js` | La vista realista y las animaciones de los ejércitos (en las dos vistas). |
| `manifest.webmanifest`, `sw.js`, `icons/` | Lo que la convierte en aplicación instalable y sin conexión. |
| `fonts/` | Barlow Semi Condensed, incluida para que se vea igual sin conexión. |
| `tools/build-map.mjs` | Genera `europa-data.js` a partir de los datos del simulador GeoSim (no incluidos aquí). Al final llama a `tools/terrain.mjs`. |
| `tools/build-world.mjs` | Genera `mundo-data.js` y `relieve-mundo.png` a partir de Natural Earth (países y provincias), GeoNames (ciudades) y una tabla de fuerzas; el terreno, con `tools/terrain.mjs`. La primera vez descarga unos 2 700 bloques de usos del suelo (varios minutos). |
| `tools/projection-world.mjs` | La proyección Equal Earth del mapa del mundo. |
| `tools/build-terrain.mjs` | Añade al `europa-data.js` existente el terreno real por casilla y los ríos, y genera `relieve.png`. Descarga los datos la primera vez a `tools/cache/` (unos 50 s). |
| `tools/smoke-research.mjs` | Pruebas del motor y de la interfaz en el navegador (Playwright): investigación, sus efectos en las reglas, la IA, la inteligencia y las insignias. |
| `tools/smoke-mando.mjs` | Pruebas del mando estratégico en el navegador (Playwright): órdenes de varios turnos, operaciones, plantillas y refuerzos, directiva, teatros y la IA con operaciones. |
| `tools/smoke-vista.mjs` | Prueba en el navegador (Playwright): empieza una partida, comprueba la vista realista y las animaciones y guarda capturas. |
| `tools/perf-mapa.mjs` | Mide cuánto cuesta dibujar el mapa al arrastrar y al hacer zoom, en las dos vistas y los dos mapas. |
| `tools/smoke-mundo.mjs` | Prueba en el navegador (Playwright) del selector de mapas y del mapa del mundo: relieve, turnos de la IA, fotogramas y cargar una partida del otro mapa. |
| `tools/release.mjs` | Marca una versión nueva (`index.html`, `sw.js`, `version.json`) antes de publicar. |
| `tools/resources.json` | Yacimientos (petróleo, gas, carbón, hierro, minerales), editable a mano. |
| `tools/resources-world.json` | Los yacimientos del resto del mundo para el mapa del mundo (que también usa los de Europa). |

## Fuentes y licencias de los datos

- Mapa del mundo: países, provincias, capitales, población y PIB de Natural Earth 5.1.1 (dominio público); Crimea y Sebastopol, con Ucrania como en el mapa de Europa.
- Fronteras de las regiones: © EuroGeographics para las fronteras administrativas, vía Eurostat GISCO (NUTS 2021/2024); Natural Earth 5.1.1 (dominio público) para Rusia, Ucrania, Bielorrusia, Moldavia, Bosnia y Herzegovina y Kosovo.
- Ciudades: GeoNames (CC BY 4.0) y Natural Earth.
- Fuerzas armadas iniciales: aproximación a partir de IISS Military Balance 2024 y SIPRI (en el mapa del mundo, por países; los que no están en la tabla, el 0,15 % de su población en infantería).
- Yacimientos: ubicación aproximada de cuencas y minas conocidas.
- Relieve: teselas Terrarium de Mapzen en AWS (elevation-tiles-prod), a partir de SRTM, GMTED2010, ETOPO1 y otras fuentes públicas.
- Bosques, humedales, lagos y zonas urbanas: © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium (CC BY 4.0).
- Ríos: Natural Earth 5.1.1, rivers_lake_centerlines (dominio público).
- Tipografía: Barlow Semi Condensed, © The Barlow Project Authors, SIL Open Font License 1.1 (`fonts/OFL.txt`).

Los datos de población, fuerzas y recursos están simplificados para el juego y no pretenden ser exactos.
