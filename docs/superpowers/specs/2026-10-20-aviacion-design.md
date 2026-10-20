# Aviación, antiaéreo, satélites y desgaste de los ejércitos

Fecha: 2026-10-20 · Afecta a: el motor (combate, suministro, carreteras, fortificaciones, niebla, investigación, mando e IA), los datos de los dos mapas, la interfaz y la vista realista. Casi todo está en `index.html`; el dibujo, también en `vista-realista.js`.

## Por qué

Hoy solo se puede dañar algo atacándolo desde la casilla de al lado, con tropas que se pierden. El jugador quiere, con sus palabras, «atacar desde lejos sin perder infantería, adelantado en la partida, romper carreteras o fortificaciones de ciudades». Y quiere la otra cara: «tener preparados antiaéreos, cuanto mejor, más eficacia, y si hay superioridad lo más probable es que defienda bien». Todo debe mejorar con la investigación y con la información: «todo mejora con inteligencia y demás».

Para que romper carreteras importe de verdad, el jugador propone a la vez unas reglas de desgaste. Un ejército aislado, lejos de una carretera en territorio enemigo o cercado sin víveres se debilita. Así un bombardeo que corta la red deja sin fuerza a quien depende de ella.

Cómo se ve el éxito: a mitad de partida, el jugador ve una ciudad fortificada que le costaría muchas bajas tomar a pie. Manda sus escuadrones, le baja la fortificación nivel a nivel y le corta las carreteras de detrás. Luego la toma con pocas pérdidas. Si el enemigo tiene buen antiaéreo, esa misma jugada le cuesta aviones. Al revés también vale: una línea con antiaéreo preparado y una ciudad fortificada al máximo aguantan desde el aire.

## Dos piezas, en este orden

1. **Desgaste** (parte A): tres reglas nuevas sobre la fuerza y los víveres de los ejércitos. Es independiente de la aviación y se puede publicar sola.
2. **Aviación** (parte B): aeródromos, escuadrones, misiones, antiaéreo fijo y móvil, combate aéreo, satélites, investigación, mando e IA.

Las marcas significan:
- **(Usuario)**: lo decidió el jugador en la conversación.
- **(Propuesta)**: lo propuse yo y el jugador no lo rechazó, pero tampoco lo pidió.
- **(Decisión mía)**: una decisión razonable que el constructor puede afinar.

Los números son de partida. Se ajustan probando, salvo los de investigación, que siguen la regla del proyecto: lenta y cara, sin abaratarla sin preguntar.

---

## Parte A · Desgaste

Lo que ya existe y no cambia:
- **Suministro** (`supplyMap`): sin suministro, el ejército solo avanza una casilla por turno.
- **Rodeado o cercado** (`flankFactor`): con ejércitos enemigos en 3 o más lados, ×0,75; en 5 o más, ×0,5.

Lo nuevo se suma a eso.

### A1 · Apoyo mutuo
- **(Usuario)** Un ejército sin ningún ejército propio a una casilla pierde algo de fuerza. Vale en territorio propio o enemigo, siempre que esté **fuera de una ciudad**. Dentro de una ciudad, propia o enemiga (por ejemplo, mientras la asedia), no hay castigo.
- **(Propuesta)** Cuentan también los ejércitos aliados.
- **(Decisión mía)** El castigo es ataque y defensa ×0,9.

### A2 · Sin carretera al alcance
- **(Usuario)** En territorio enemigo, si no hay ninguna carretera a la que el ejército pueda llegar con su movimiento de ese turno, pierde fuerza.
- **(Propuesta)** Sirve cualquier tramo de carretera o autopista intacto, de cualquier dueño. Un tramo roto (parte B) no cuenta.
- **(Decisión mía)** El castigo es ataque y defensa ×0,85. «Territorio enemigo» es una casilla cuyo dueño legal (`legal`) es un país con el que está en guerra, aunque ya la tenga ocupada. «Llegar» se mide con su movimiento completo del turno (`mp` sin gastar) y sus reglas de terreno.

### A3 · Hambre
- **(Usuario)** Si el ejército está sobre una casilla en disputa (ocupada al enemigo, `isDisputed`) y todo lo que la rodea es territorio enemigo, cada cierto número de turnos pierde 1.
- **(Propuesta)** Pierde una unidad cada 3 turnos seguidos en esa situación, primero infantería, luego artillería y luego tanques. Doctrina 3 (Sanidad militar) lo alarga a cada 4 turnos.
- **(Decisión mía)** «Rodeada de territorio enemigo»: las 6 vecinas son de un país en guerra con él, o mar o casillas fuera del mapa, que tampoco dan de comer. El contador se pone a cero en cuanto deja de cumplirse. Un ejército de una sola unidad que la pierde desaparece.

### Factores comunes de la parte A
- **Cómo se combinan:** los tres castigos se multiplican entre sí y con el de rodeado.
- **Dónde se ven:** en la ficha del ejército, como hoy se ve «Rodeado». Por ejemplo: «Aislado ×0,9», «Sin carretera al alcance ×0,85», «Sin víveres: pierde 1 unidad dentro de 2 turnos».
- **En combate:** el desglose del combate y la previsión los incluyen.
- **En el mapa:** el borde de la ficha avisa igual que hoy con rodeado (rojo) y sin suministro (naranja). Hace falta una señal para «sin víveres», por ser la grave.
- **La IA y las operaciones los tienen en cuenta:**
  - las ofensivas no dejan ejércitos sueltos en territorio enemigo sin carretera;
  - las órdenes de marcha prefieren caminos con apoyo;
  - un ejército que pasa hambre rompe el cerco o se refugia, como ya hacen los ejércitos cortados de la línea elástica.

---

## Parte B · Aviación

### B1 · Aeródromos
- **(Usuario)** La aviación vive en aeródromos.
- **(Propuesta)** El aeródromo se construye en una ciudad propia, con oro y turnos de obra, como una fortificación. Si el enemigo toma la ciudad, se pierden el aeródromo y los escuadrones que estuvieran en él.
- **(Decisión mía)** Caben hasta 4 escuadrones por aeródromo. Un escuadrón puede trasladarse de aeródromo dentro de su alcance; eso gasta su misión del turno.
- **(Decisión mía)** El aeródromo es un blanco. Un bombardeo que acierta lo deja inservible 2 turnos: sus escuadrones no despegan.

### B2 · Escuadrones
- **(Usuario)** Los escuadrones son piezas que se compran y se pierden si el antiaéreo los derriba. Cada uno tiene un radio de acción y mejora con la investigación.
- **(Usuario)** Cada país empieza con una aviación aproximadamente real de 2024.
- **(Propuesta)** Hay un único tipo de escuadrón, sin cazas ni bombarderos separados. El encargo que se le da decide lo que hace.
- **(Decisión mía)** La aviación inicial sale de los aviones de combate de cada país (IISS Military Balance 2024 o una fuente pública equivalente, como ya se hace con las fuerzas de tierra), a un escuadrón por cada 24 aviones aproximadamente y al menos uno si tiene alguno. Los escuadrones se reparten entre aeródromos en la capital y en las ciudades mayores. Es una tabla nueva en `tools/`, generada dentro de `europa-data.js` y `mundo-data.js`. Para el mapa del mundo, la tabla de fuerzas de `build-world.mjs` gana una columna.
- **(Decisión mía)** Un escuadrón cuesta unos 300 de oro, se compra en una ciudad con aeródromo y está listo al turno siguiente.
- **(Decisión mía)** Tras una misión, el escuadrón puede volver:
  - **Intacto:** sigue operativo.
  - **Dañado:** no vuela el turno siguiente.
  - **Derribado:** se pierde.
- **(Decisión mía)** El alcance se fija en kilómetros y se pasa a casillas según el mapa: unos 500 km, que son 25 casillas en Europa y 6 en el mundo. Lo mismo vale para todos los radios de esta parte.

### B3 · Misiones
Cada escuadrón hace una misión por turno contra una casilla a su alcance. Hay seis:

| Misión | Qué hace si sale bien |
| --- | --- |
| Atacar ejército | **(Usuario)** Le mata unidades **y** le quita fuerza unos turnos. **(Decisión mía)** Le quita en torno al 10–15 % de sus unidades, primero tanques y artillería, y lo deja **desorganizado** 2 turnos (ataque y defensa ×0,8). |
| Cortar carreteras | **(Usuario)** Los tramos de esa casilla quedan **rotos**: siguen rotos hasta que su dueño los repara a mano, y el jugador tiene que verlo. Detalle en B6. |
| Bajar fortificación | **(Usuario)** La fortificación baja un nivel. Si se sigue atacando, sigue bajando hasta desaparecer. Detalle en B7. |
| Destruir antiaéreo | **(Usuario)** El antiaéreo que se conoce se puede atacar. **(Decisión mía)** Un sitio fijo aguanta dos aciertos: el primero lo deja dañado (media eficacia) y el segundo lo destruye. |
| Atacar aeródromo | **(Decisión mía)** Lo deja inservible 2 turnos (B1). Los escuadrones que estén en él lo defienden en combate aéreo. |
| Proteger casilla | **(Usuario)** Dos escuadrones enemigos solo se enfrentan si coinciden en la misma casilla. **(Propuesta)** El escuadrón que protege una casilla se queda sobre ella hasta el próximo turno de su dueño. Cualquier misión enemiga contra esa casilla tiene que pasar antes por él. |

- **(Decisión mía)** Una misión puede llevar varios escuadrones juntos. Más escuadrones dan más probabilidad de acertar y reparten las pérdidas, pero el resultado es uno solo: cada blanco recibe como mucho **un acierto por turno**, ya sea un nivel de fortificación, un golpe a un ejército, un corte de carretera o un golpe a un antiaéreo o a un aeródromo. Así cuatro escuadrones no arrasan unas casamatas en un turno.
- **(Decisión mía)** La misión se resuelve al darla, como un ataque de tierra (`battle`), y su resultado sale en el parte. Además, desvela la casilla de destino ese turno: tipo y número de lo que hay.

### B4 · Inteligencia y precisión
- **(Usuario)** Lo que sabes del blanco cuenta. Bombardear algo que tus espías o tu reconocimiento han descubierto es más eficaz.
- **(Propuesta)** Se puede bombardear a ciegas, pero rinde la mitad. «Conocido» quiere decir:
  - verlo con Reconocimiento 2 (`intelExact`);
  - o tener un espía en esa provincia;
  - o tener un satélite que la cubra (B10);
  - o haberlo desvelado una misión propia este turno.
- **(Usuario)** El antiaéreo que se conoce se puede atacar. Si se prefiere no atacarlo, los aviones lo esquivan o, si lo sobrevuelan, sobreviven con más probabilidad. El antiaéreo que no se conoce pilla a los aviones de lleno.
- **(Decisión mía)** El vuelo va en línea recta de la base al blanco.
  - **Antiaéreo conocido en el camino:** si se puede rodear dentro del alcance, se rodea sin riesgo. Si no se puede, se sobrevuela con su eficacia a la mitad.
  - **Antiaéreo desconocido en el camino:** dispara a plena eficacia.
- **(Decisión mía)** Visibilidad de cada cosa:
  - **Antiaéreo fijo:** solo lo ve el enemigo con Reconocimiento 2, con un espía en la provincia o con un satélite. Un sitio que te ha disparado queda conocido a partir de entonces.
  - **Antiaéreo móvil:** se ve cuando se conoce el tipo de tropa del ejército que lo lleva.
  - **Aeródromos:** se ven como una ciudad: los ve cualquiera.

### B5 · Antiaéreo y combate aéreo
- **(Usuario)** Primero existe el **antiaéreo fijo**, que se construye en una casilla y protege la zona. Cuanto mejor sea lo investigado, más eficaz. Con superioridad, lo más probable es que defienda bien.
- **(Usuario)** Las **ciudades fortificadas al máximo** (nivel 4, casamatas; ver B7) traen antiaéreo integrado, de la calidad que tenga investigada su dueño.
- **(Usuario)** Más adelante, con investigación, llega el **antiaéreo móvil**: muy caro, bastante menos eficaz y va con los ejércitos.
- **(Decisión mía)** Antiaéreo fijo:
  - se construye en cualquier casilla propia, por unos 60 de oro, con 2 turnos de obra;
  - cubre unos 60 km (3 casillas en Europa, 1 en el mundo);
  - se pierde si el enemigo toma la casilla.
- **(Decisión mía)** Antiaéreo móvil:
  - es un cuarto tipo de tropa, «Antiaérea», con coste alto (unos 250), ataque y defensa de tierra bajos y velocidad 4;
  - protege su casilla y las vecinas, con en torno a la mitad de la eficacia de un sitio fijo por unidad;
  - entra en las plantillas como opción, sin estar en las siete de serie.
- **(Decisión mía)** Cómo se resuelve:
  - Se suma la fuerza antiaérea que cubre el blanco y el camino. Las coberturas se suman, con un tope.
  - Se compara con la fuerza de los escuadrones de la misión, con sus mejoras de investigación.
  - De la relación salen la probabilidad de fracaso de la misión y la de derribado o dañado de cada escuadrón.
  - Referencias: con 2 a 1 a favor del antiaéreo, la misión fracasa en torno al 70 % y cae un 40 % de los escuadrones. Con 1 a 2, la misión sale bien en torno al 90 % y cae un 5 %.
- **(Decisión mía)** Combate aéreo: fuerza contra fuerza con la investigación, y una tirada como la de `battle`.
  - **Si gana el que protege:** la misión enemiga no llega y sus escuadrones pueden ser derribados o volver dañados.
  - **Si pierde el que protege:** cae él o vuelve dañado, y la misión sigue contra el antiaéreo del blanco.
- **(Decisión mía)** Antiaéreo inicial: cada país que empieza con aviación tiene un sitio fijo en su capital, y otro más por cada 4 escuadrones, en sus ciudades mayores.

### B6 · Carreteras rotas
- **(Usuario)** Una carretera rota está rota: no se arregla sola. Su dueño tiene que verla y repararla a mano.
- **(Propuesta)** Una misión que acierta rompe todos los tramos de carretera y autopista que salen de esa casilla. Una autopista se rompe entera, no baja a carretera. El tramo roto no cuenta para moverse, para la renta (red unida a la capital) ni para el suministro.
- **(Usuario)** Reparar lleva **turnos de obra**: 2, como una fortificación, con la mejora de Fortificación que acorta las obras. No se puede reparar con un ejército enemigo en una casilla vecina. Así un bombardeo tiene efecto durante varios turnos.
- **(Decisión mía)** Reparar cuesta la mitad de construir lo que había (carretera, o carretera más autopista) y devuelve el tramo a lo que era. Se hace con la herramienta de carreteras sobre el tramo roto. Puede repararlo quien tenga la casilla de su lado del tramo.
- **(Usuario)** Al tomar una casilla por la fuerza, sus tramos ya no desaparecen como hoy (`wreck`): quedan **rotos**. El que conquista puede repararlos para abastecerse. Así la regla A2 castiga a quien avanza sin arreglar la red, no a todo el que avanza.
- **(Decisión mía)** Visibilidad:
  - el tramo roto se dibuja claramente roto en las dos vistas, para quien ve la casilla;
  - la capa Logística resalta los tramos rotos propios;
  - el parte avisa: «Bombardeada la carretera de X: 3 tramos rotos».
- **(Decisión mía)** La IA repara sus carreteras rotas por prioridad: primero las que dejan territorio sin suministro o sin conexión con la capital. El presupuesto de la directiva lo paga desde «Carreteras».

### B7 · Fortificaciones con nivel propio
Hoy una casilla está fortificada o no (`fort` es 0 o 1), y su nivel sale de lo que tiene investigado su dueño (`rules(owner)`).
- **(Usuario)** La fortificación baja de nivel con cada bombardeo hasta quedarse sin nada. Para eso, cada fortificación necesita su propio nivel.
- **(Propuesta)** Funciona así:
  - Hay cuatro niveles por casilla: sacos terreros (1), hormigón (2), búnkeres (3) y casamatas (4).
  - Una fortificación nueva nace al nivel máximo de su dueño: 1 + su nivel en la rama Fortificación.
  - Cada acierto le quita un nivel, y por debajo de 1 desaparece.
  - Reparar cuesta oro y la sube hasta el máximo de su dueño. **(Usuario)** Como las carreteras, lleva turnos de obra (los de construir una fortificación, un nivel por obra) y no se puede hacer con un ejército enemigo al lado.
  - Los efectos de la fortificación salen de su nivel, no de las reglas del dueño. Por ejemplo, una casamata bajada a nivel 2 defiende como hormigón.
- **(Decisión mía)** Al completar una investigación de Fortificación, las fortificaciones intactas suben solas al nuevo máximo, como pasa hoy. Las dañadas, no. Las partidas guardadas cargan sus fortificaciones al máximo de su dueño.
- **(Usuario)** **Antiaéreo integrado:** solo lo trae una ciudad con fortificación de **nivel 4 (casamatas)**, es decir, de un dueño que ha terminado las tres investigaciones de Fortificación. Es un premio caro y tardío. En cuanto la bajas un nivel, lo pierde y queda expuesta.

### B8 · Mando
- **(Usuario)** El mando también controla la aviación. Se elige cuál o cuáles de las acciones se quieren conseguir con ella.
- **(Propuesta)** Operaciones:
  - Una ofensiva o una línea de defensa pueden llevar escuadrones asignados, igual que llevan ejércitos.
  - En cada una se marcan sus fines: golpear ejércitos, cortar carreteras, bajar fortificaciones, destruir antiaéreo o proteger.
  - Cada turno eligen, dentro de su alcance, los blancos que sirven a esos fines. La ofensiva mira su objetivo, lo que defiende el camino y las carreteras que lo abastecen. La línea mira los ejércitos enemigos a 3 casillas y protege sus casillas más amenazadas.
- **(Propuesta)** Un escuadrón suelto puede recibir una orden de varios turnos: una zona y sus fines.
- **(Propuesta)** Siempre se puede mandar una misión a mano ese turno. Al siguiente vuelve a su encargo.
- **(Propuesta)** Respetan los modos manual, asistido y automático. La reserva puede tener escuadrones y mandarlos a la operación que pide ayuda, igual que con los ejércitos.
- **(Propuesta)** La IA usa la aviación con el mismo sistema:
  - compra escuadrones y antiaéreo según la amenaza;
  - construye antiaéreo en sus ciudades del frente;
  - repara carreteras y fortificaciones.

### B9 · Investigación
Siguen las mismas reglas que las ramas actuales: 6·10·15 turnos, 4·8·12 turnos de renta (con su mínimo) y +10 % por cada investigación terminada.

**(Decisión mía)** Tres ramas nuevas. Los nombres son técnicas reales; el constructor puede afinarlos:

| Rama | Área | Nivel 1 | Nivel 2 | Nivel 3 |
| --- | --- | --- | --- | --- |
| Aviación | Militar | Reabastecimiento en vuelo: +50 % de alcance | Munición guiada: más daño y el bombardeo a ciegas rinde el 75 % en vez del 50 % | Guerra electrónica: menos probabilidad de derribo |
| Defensa aérea | Militar | Radar de alerta temprana: antiaéreo más eficaz | Misiles tierra-aire de largo alcance: más radio y más eficacia | Antiaéreo autopropulsado: desbloquea el antiaéreo móvil |
| Espacio | Inteligencia | Lanzadores: permite satélites, uno a la vez | Óptica de alta resolución: el satélite ve galones y fortificaciones y cubre más | Constelación: dos satélites a la vez y duran más |

- **Galones:** los escuadrones llevan los galones de la rama Aviación, y el antiaéreo móvil los de Defensa aérea.
- **Antiaéreo integrado:** su calidad es la de Defensa aérea de su dueño.
- **IA:** pesa estas ramas según su guerra y su aviación.

### B10 · Satélites
- **(Usuario)** Llegan más adelante con investigación, son muy caros y dan información sobre una zona amplia.
- **(Propuesta)** Se lanza uno con un coste alto, del orden de 20 turnos de renta, y vigila una región circular durante varios turnos, del orden de 8. Dentro de ella se sabe el tipo y el número de los ejércitos, el antiaéreo fijo y los aeródromos. Con Espacio 2, también galones y niveles de fortificación.
- **(Decisión mía)** Radio de unos 400 km (20 casillas en Europa y 5 en el mundo); con Espacio 2, 600 km. Al terminar, se puede lanzar otro sobre otra región. No se pueden derribar.

### B11 · Interfaz y vista
- **Símbolos (regla del proyecto):** nada inventado.
  - Los escuadrones llevan el símbolo OTAN (APP-6) de aeronave de ala fija.
  - El antiaéreo, el de defensa aérea.
  - El aeródromo, el de instalación aérea.
  - En la vista realista, miniaturas sobre peana, como los ejércitos.
- **Fichas:** de escuadrón (base, alcance, estado, encargo) y de aeródromo (escuadrones, comprar, construir).
- **Herramienta de misión aérea:** al elegir un escuadrón se dibuja su círculo de alcance y el camino a cada blanco, con la cobertura antiaérea conocida.
- **Previsión de cada misión:** probabilidad de éxito y de pérdidas, con los mismos límites de niebla que la previsión de combate.
- **Animación:** un trazo de la base al blanco, en las dos vistas, con su resultado.
- **Pestaña Mando:** los escuadrones en las operaciones y los fines marcados.
- **Teclas:** atajo para la herramienta y entrada en la ayuda.
- **Móvil:** todo cabe en la hoja inferior de tres tamaños, sin tapar el mapa.

---

## Restricciones

- Todo vive en `index.html` y `vista-realista.js`, sin dependencias nuevas.
- Funciona igual en los dos mapas. Los radios se miden en kilómetros y se convierten según el tamaño de casilla de cada mapa (unos 20 km en Europa, unos 85 km en el mundo).
- Las partidas guardadas siguen cargando. Una partida anterior a esta versión recibe, al cargarla, la aviación y el antiaéreo iniciales de cada país, y sus fortificaciones toman nivel (B7).
- La niebla de guerra es obligatoria: nada de lo nuevo puede enseñar lo que el jugador no debería saber.
- El rendimiento del mapa no puede empeorar de forma apreciable (`tools/perf-mapa.mjs`, sobre todo en el mapa del mundo).
- Datos reales para la aviación inicial, con su fuente en el README.
- Cada pieza lleva sus pruebas en el navegador, al estilo de `tools/smoke-*.mjs`, y el README se actualiza.

## Fuera de alcance

- Marina, portaaviones, misiles balísticos y armas nucleares.
- Paracaidistas y transporte aéreo.
- Varios tipos de avión.
- Combustible o munición como recurso.
- Derribar satélites.

## Lo que sería un fracaso aunque funcione

- La aviación sustituye a la tierra. Debe preparar y apoyar, nunca conquistar, y no debe ser la jugada obvia en cada turno.
- Obligar a mover escuadrón a escuadrón en una guerra larga.
- Que una ciudad fortificada al máximo, con buen antiaéreo, caiga desde el aire sin pagar un precio alto.
- Símbolos inventados.
- Investigación más rápida o barata que la actual.
- Que la IA no sepa reparar sus carreteras y se quede bloqueada tras un bombardeo.

## Orden de construcción sugerido

1. Parte A completa.
2. Base de la parte B:
   - aeródromos y escuadrones con los datos iniciales;
   - misiones a mano;
   - antiaéreo fijo;
   - carreteras rotas y fortificaciones con nivel;
   - interfaz y vista.
3. Mando e IA de la aviación.
4. Investigación, antiaéreo móvil y satélites.

Cada paso deja el juego jugable y se puede publicar por separado.

## Queda en manos del constructor

- El ajuste de todas las cifras marcadas como decisión mía.
- La forma exacta de las fichas y de los iconos, dentro de los símbolos reales.
- Cómo guardar el estado de tramos rotos, niveles de fortificación, escuadrones y satélites.
- La estrategia exacta de la IA.

## Preguntas resueltas en la revisión

- **Antiaéreo integrado:** solo con casamatas, nivel 4 (B7).
- **Reparar:** lleva turnos de obra y no se puede con el enemigo al lado (B6, B7).
- **Conquistar:** deja los tramos rotos en vez de borrarlos (B6).
- **Misión con varios escuadrones:** un solo acierto por blanco y turno (B3).
