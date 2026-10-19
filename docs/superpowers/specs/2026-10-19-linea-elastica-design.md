# Línea de defensa que piensa: repliegue a posiciones de ventaja

Fecha: 2026-10-19 · Afecta a: operaciones de defensa (`executeOp`, rama `defensa`), propuestas de frente (`frontPlan`, `frontSuggestions`), la IA (`aiCommand`), la pestaña Mando y el mapa. Todo está en `index.html`.

## Por qué

El jugador puso una línea de defensa en la frontera con Turquía. Los turcos la rompieron y entraron. Sus ejércitos hicieron cada uno una cosa distinta:

- unos se quedaron en la línea antigua, porque la operación no tiene ninguna regla para dejarla;
- otros contraatacaron, porque la regla de contraataque (ventaja 1,8 sobre una casilla de la línea ocupada) no mira el conjunto;
- otros retrocedieron, porque la regla de huida (`flee`, rodeado por 3 lados) los aparta a la casilla libre más cercana, sin criterio.

Nadie mira cuántas fuerzas hay a cada lado ni qué terreno queda detrás. Además, las líneas que propone el juego y las que crea la IA siguen la frontera casilla por casilla (`frontPlan`), aunque sea llanura y haya montañas dos casillas más atrás. Son posiciones sin valor.

Lo que quiere el jugador, con sus palabras: «al estar en inferioridad, deberían retroceder a un puesto de ventaja, reordenarse»; «tomar posiciones de ventaja donde la defensa es importante, zonas montañosas, ciudades… no a lo loco a defender una posición sin valor»; «la línea inicial debería ser una de superioridad»; «las ciudades conservan una guarnición que aguante».

## Objetivos

1. Una operación de defensa actúa como un **mando de sector**: cada turno compara fuerzas y decide junta si aguanta, se repliega o vuelve hacia delante.
2. **Si la rompen o queda en inferioridad, se repliega toda junta** a una línea mejor detrás y se reordena allí. No contraataca ni se queda clavada.
3. Una **línea es buena** si, con las fuerzas que hay, da **superioridad**: la defensa de tus ejércitos, multiplicada por el terreno, supera el ataque enemigo que tiene delante. Cuentan montaña, colinas, bosque, pantano, urbano, río delante, ciudad, capital y fortificación, con los mismos multiplicadores que el combate (`combatFactors`). También cuenta que sea lo bastante corta para cubrirla sin huecos y que quede entre el enemigo y las ciudades propias.
4. **Las ciudades que se quedan delante de la nueva línea conservan una guarnición que aguanta allí.** No se suma al repliegue.
5. **La línea que dibuja el jugador se respeta.** El terreno solo cuenta para replegarse desde ella y para volver a ella.
6. **Sin línea en un frente en guerra, el juego avisa** y propone una ya trazada en terreno bueno, que el jugador acepta o cambia.
7. **La IA usa lo mismo:** sus líneas salen en terreno bueno y se repliegan igual.

## No objetivos

- No cambian las ofensivas, las reservas, las plantillas ni la directiva, salvo lo que diga este documento.
- No cambian las reglas de combate, movimiento ni suministro.
- No hay tipos de unidad nuevos ni investigaciones nuevas.

## Antiobjetivos (fallaría aunque «funcione»)

- **Retirada sin fin:** abandonar medio país por una montaña lejana. La nueva línea está cerca (ver «Profundidad»).
- **Vaivén:** replegarse y volver a avanzar en turnos alternos. Tiene que haber margen entre el umbral de repliegue y el de volver.
- **Ciudades vacías:** ninguna ciudad propia que tuviera tropa se queda sin guarnición por el repliegue.
- **Retirarse a través del enemigo:** pasar junto a ejércitos enemigos, o por su zona de control, para llegar a la nueva línea.
- **Decisiones invisibles:** que la línea se mueva sin que el parte y el mapa digan adónde y por qué.
- **Líneas propuestas en llanura** con terreno defendible cerca y fuerzas que lo permitan.

## Cómo se comporta una línea cada turno

La operación de defensa pasa a tener un estado: **Aguanta**, **Se repliega** o **Restablece**. Lo recalcula cada turno, antes de mover.

### 1. Evaluar

- **Fuerza propia:** la suma de la defensa de los miembros, cada uno multiplicado por la bonificación de defensa de la casilla que ocupa o va a ocupar. Esa bonificación es la misma de `combatFactors`: terreno, ciudad, capital, fortificación, río y el mismo tope.
- **Fuerza enemiga:** la suma del ataque de los ejércitos enemigos del frente que el jugador ve a 3 casillas o menos de la línea. Con niebla se estima igual que `expectedRatio`.
- **Relación** = propia / enemiga. Sin enemigos a la vista no hay relación, y se aguanta.
- **Franja de la línea:** el terreno que cubre la línea. Va de su primer extremo al último, hasta 3 casillas por delante y hasta la profundidad máxima de repliegue por detrás. Todo lo que se evalúa se mira dentro de esa franja.
- **Brecha:** hay brecha si el enemigo ocupa o es dueño de una casilla de la línea, o si tiene ejércitos en territorio propio detrás de ella, dentro de la franja. Los enemigos que estén en otras partes del país no cuentan para esta línea.

### 2. Decidir

- **Aguanta** si no hay brecha y la relación es al menos 1. Hace lo de ahora: cubre primero las casillas más amenazadas, pone a los que sobran donde más aprieta y fortifica si tiene la casilla marcada. **Contraataca solo** si la previsión llega a la ventaja de la operación (`op.ratio`) y además la relación del sector no baja de 1 tras el ataque.
- **Se repliega** si hay una brecha que no puede cerrar con un contraataque a `op.ratio` este mismo turno, o si la relación es menor que 1. En este estado no ataca, salvo para romper un cerco (ver «Cortados»).
- **Restablece** cuando, ya replegada, la línea dibujada (`drawn`) volvería a dar una relación de al menos 1,5 con las fuerzas actuales. Avanza hacia ella y retoma casillas solo con ataques a `op.ratio`. Nunca pasa de la línea dibujada. `drawn` es la que trazó el jugador, la propuesta que aceptó (desde ese momento cuenta como suya) o la que creó la IA.

Los umbrales (1 para replegarse y 1,5 para volver) son una decisión mía. Se pueden ajustar al probar, siempre que se mantenga el margen entre los dos.

### 3. Replegarse

- **Se elige una línea nueva** con la búsqueda de línea (siguiente sección), detrás de la actual y dentro de la profundidad permitida. **La línea actual también es candidata:** si detrás no hay nada mejor, se queda donde está, pasa a «Aguanta» con aviso («ninguna posición detrás es mejor: hacen falta refuerzos») y sigue pidiendo ayuda. La nueva línea pasa a ser la línea activa de la operación (`op.cells`). La dibujada se guarda aparte (ver «Datos»).
- **Límite total:** sumando todos los repliegues, la línea activa nunca queda a más de 4 turnos de marcha (del miembro más lento) de la línea dibujada, y nunca deja la capital propia por delante. Si la capital está dentro de la franja, siempre forma parte de las candidatas.
- **Misma anchura:** la nueva línea cubre la misma franja que la anterior, entre dos puntos situados detrás de sus dos extremos. No tiene que apoyarse en el mar ni en otra frontera.
- **Se mueven todos los miembros a la vez** hacia la nueva línea, con la misma asignación de casillas que «Aguanta»: primero las más amenazadas y luego el resto donde más aprieta. Usan caminos por territorio propio o aliado que eviten casillas junto a ejércitos enemigos siempre que haya alternativa.
- **Guarniciones:** un miembro que esté en una ciudad propia que se queda delante de la nueva línea deja en ella una guarnición fuera de la operación, como mínimo una infantería (la misma regla que `detach`). El resto se repliega. Si la ciudad solo tiene esa guarnición, se queda entera. La guarnición tiene orden de mantener (`hold`) y se fortifica si la operación tiene marcado fortificar y hay oro. Una ciudad sin tropa no recibe a nadie: no se manda gente hacia delante.
- **Mientras se repliega**, la operación sigue pidiendo ayuda a la reserva si le faltan ejércitos para cubrir la nueva línea (`opNeed`).

### 4. Cortados

Un miembro cortado es el que no puede llegar a la nueva línea por territorio propio o aliado sin pasar junto al enemigo en los próximos 2 turnos de marcha. En ese caso:

- si está rodeado (`hostileSides` ≥ `FLANKED_SIDES`), intenta romper el cerco atacando la casilla enemiga más débil que lo acerque a la línea, aunque no llegue a `op.ratio`, siempre que la previsión dé al menos 1;
- si no, va a la ciudad propia, o a la montaña o colina propia, más cercana que pueda alcanzar, y aguanta allí con orden de mantener, fuera de la operación;
- **vuelta a la operación:** las guarniciones dejadas al replegarse y los cortados que aguantan recuerdan de qué operación salieron (`army.from`). Cuando la línea, al restablecerse, vuelve a pasar por su casilla o la deja por detrás, se reincorporan a la operación. Si la ciudad se quedaría vacía, la última unidad se queda de guarnición, como en `detach`;
- el parte lo dice: «2 ejércitos cortados aguantan en Kayseri».

## Búsqueda de línea (común a repliegue, propuesta e IA)

Una sola función devuelve la mejor línea para un propietario frente a un enemigo, con unas fuerzas dadas y, si las hay, una línea de referencia de la que partir. La usan el repliegue, la propuesta para un frente sin línea y la IA.

**Qué es una línea válida:** una cadena de casillas propias contiguas, sin huecos, que va de un extremo de la franja al otro, entre el enemigo y el territorio propio de detrás. En el repliegue, los extremos son dos puntos detrás de los extremos de la línea anterior. En la propuesta, son los extremos del tramo amenazado (ver «Línea propuesta»). No hace falta que se apoye en el mar ni en otra frontera. Si uno de sus extremos toca el mar, un país neutral o aliado u otra línea propia, mejor, pero no es obligatorio.

**Cómo se puntúa**, de más a menos importante:

1. **Superioridad:** la relación prevista (fuerza propia repartida por la línea, con la defensa de cada casilla, contra la fuerza enemiga del frente) llega al menos a 1.
2. **Se puede cubrir:** no tiene más casillas que ejércitos disponibles. Si las fuerzas no llegan, es mejor una línea más corta y más atrás que una larga con huecos.
3. **Defensa del terreno:** la media de la bonificación de defensa de sus casillas frente al lado enemigo, con río delante, ciudad, capital y fortificación.
4. **Lo que protege:** las ciudades propias que quedan detrás. Las que quedan delante restan, pero menos que perder la superioridad.
5. **Cercanía:** a igualdad, la más cercana a la línea de referencia o a la frontera.

Si ninguna línea da superioridad, se elige la mejor (la de mayor relación) y la operación avisa: «ninguna posición cercana da superioridad: hacen falta refuerzos».

**Profundidad:** el repliegue busca a 2 turnos de marcha o menos del miembro más lento, por territorio propio. La propuesta inicial busca a 3 casillas o menos de la frontera. Son cifras mías y se pueden ajustar.

**El algoritmo lo elige quien lo construya.** Una vía razonable: un camino de coste mínimo entre dos apoyos de flanco, por casillas propias dentro de la franja permitida, donde cada casilla cuesta más cuanto menos defiende. Así salen solas las cadenas montañosas y las orillas de los ríos. Se prueban unas pocas profundidades y unos pocos pares de apoyos y se queda la mejor puntuación. Debe estar acotado: no puede recorrer el mapa entero en cada turno de cada país.

## Línea propuesta y aviso

- **Aviso:** al empezar el turno, si el jugador está en guerra con un país con el que comparte frontera y no tiene ninguna operación de defensa en ese frente, el parte avisa una vez por frente y por guerra: «Frente con Turquía sin línea de defensa: hay una propuesta en Mando». Se sigue viendo la propuesta en la pestaña Mando, como ahora.
- **Propuesta:** el botón «Línea en la frontera» pasa a llamarse «Línea propuesta». **Solo cubre el tramo por donde aprieta el enemigo**, el que tiene sus ejércitos a 3 casillas o menos de la frontera, con un margen de 2 casillas a cada lado. Si hay varios tramos separados, cubre el más amenazado. Si no hay ningún ejército enemigo cerca, cubre el tramo frente a su ciudad más cercana. El resto del frente queda en manos de las guarniciones de las ciudades (decidido por el jugador). Usa la búsqueda de línea con los ejércitos que se asignarían (los cercanos libres, `nearbyFree`). Al pasar el ratón o tocarlo, la línea se ve en el mapa antes de crearla. Junto al botón, en una línea: la relación prevista, el terreno principal y las ciudades que quedan delante con guarnición. Por ejemplo: «Montes Tauro · 1,4 a 1 · deja delante Adana (con guarnición)».
- **La línea que dibuja el jugador no se toca.** Si, al dibujarla, la relación prevista es menor que 1, la ficha lo dice. No se corrige sola.

## Automatización (los tres niveles que ya existen)

- **Manual:** calcula y enseña el estado y la línea a la que se replegaría, solo como sugerencia en el mapa y en la ficha. `op.cells` y `state` no cambian, así que la reserva sigue mandando ayuda a la línea que hay.
- **Asistida:** el repliegue, la vuelta hacia delante y las guarniciones salen en la vista previa de fin de turno (`previewOps`) y se cumplen al confirmar. Si el jugador salta esa operación, no cambia nada: ni línea ni estado. Los cambios de estado solo se hacen en la partida real, nunca en la copia de la vista previa.
- **Automática:** lo hace sola.

## IA

- `aiCommand` crea sus líneas con la búsqueda de línea en vez de con la frontera de `frontPlan`.
- Sus líneas de defensa pasan por la misma lógica de estados: aguantar, replegarse, restablecer, guarniciones y cortados.
- La IA no recibe avisos y no pregunta.

## Cómo se ve

- **Mapa:** la línea activa se dibuja como ahora. Si la operación se ha replegado, la línea dibujada por el jugador se ve en trazo discontinuo y tenue, con una flecha corta de repliegue entre las dos, según los símbolos de maniobra de APP-6, como pide el estilo del proyecto.
- **Ficha de la operación:** estado (Aguanta, Se repliega o Restablece) y medidor de relación de fuerzas igual que el de las ofensivas. La raya marca 1 (repliegue) y otra marca 1,5 (vuelta).
- **Parte:** una línea por decisión, con el motivo. «Línea de Erzurum: brecha en Kars y relación 0,6 a 1; se repliega a los montes de Erzurum (colinas y río, 1,3 a 1 prevista). Deja guarnición en Kars». «Línea de Erzurum: 1,7 a 1; vuelve a la línea dibujada».

## Datos y partidas guardadas

En la operación de defensa:

- `drawn`: las casillas que dibujó el jugador, o la línea con la que se creó. `cells` pasa a ser la línea activa.
- `state`: `'aguanta'`, `'repliega'` o `'restablece'`.
- `rel`: la última relación calculada, para la ficha y el parte.

En el ejército:

- `from`: la operación de defensa de la que salió como guarnición o como cortado, para reincorporarse (0 si no).

En las partidas antiguas, al cargar: `drawn = cells`, `state = 'aguanta'` y `from = 0`. Se guardan con `serialize` y `load` como el resto de campos de la operación. Redibujar la línea desde la ficha cambia `drawn` y `cells` y vuelve el estado a `aguanta`.

## Líneas vecinas

Cada línea decide sola con su propia franja y sus propias brechas. Si una se repliega y el enemigo entra en la franja de la de al lado, esa también se replegará por su cuenta. Si no entra, se queda. No se coordinan entre ellas en esta versión.

## Segunda parte: reparto de esfuerzos entre operaciones

### Por qué

El jugador tenía una línea de defensa formándose y creó una ofensiva. Durante varios turnos la ofensiva no tuvo nada con qué atacar, por dos motivos:

- los ejércitos son de una sola operación, y la ofensiva solo recoge los que no tienen ninguna (`offensiveFree`); la línea ya tenía todos los cercanos y nada se los cedía;
- el reclutamiento va operación por operación en orden de creación (`stepReinforcements` → `reinforce`): la primera gasta el oro y ocupa el cupo de las ciudades, y la siguiente espera a que la primera acabe.

Lo que pide el jugador: «si se genera otra orden, en el mismo sitio o en otro, hay que dividir esfuerzos, no completar una y luego la otra».

### Reclutamiento repartido

- Cada turno las operaciones con refuerzos reclutan **por rondas**: una unidad para cada operación por turno, con las más prioritarias primero en cada ronda (prioridad del frente × lo que piden, como `directive`), hasta que no quede oro, cupo o fondo en ninguna. Ninguna completa su formación antes de que las demás reciban su parte.
- El fondo de cada operación (`op.pool`) sigue siendo suyo. Lo que se reparte por rondas es el oro de la nación y el cupo de las ciudades.
- Si dos operaciones quieren la misma ciudad, cada ronda toma la ciudad con cupo más cercana a su zona de reunión. Así se reparten las ciudades de forma natural.

### Ejércitos repartidos

- **Mínimo de una línea de defensa:** los ejércitos que necesita para cubrir todas sus casillas y mantener una relación de al menos 1 frente al enemigo de su franja. Ese mínimo **no se cede nunca** a otra operación (decisión mía, porque el jugador no eligió: así una ofensiva nueva no vacía la línea ni la hace replegarse).
- **Sobrante:** lo que una operación tiene por encima de su mínimo. Las ofensivas en marcha no tienen sobrante salvo que estén en pausa. La reserva lo tiene todo como sobrante.
- **Una operación que pide ayuda** (`opNeed` > 0, o una ofensiva sin ejércitos) recibe, al crearse y al empezar cada turno, ejércitos de este orden: libres (como ahora), reserva, sobrante de las líneas de defensa y sobrante de ofensivas en pausa. Solo cuentan los que lleguen en 3 turnos de marcha (`OP_GATHER_TURNS`). Primero el más cercano.
- **Reparto justo:** si varias operaciones piden a la vez, se reparten los ejércitos disponibles por rondas según prioridad × necesidad, igual que el reclutamiento. Ninguna se lo lleva todo.
- **Sin nada que ceder:** si no hay sobrante, la ofensiva espera a los reclutas nuevos, que ya le llegan por rondas, y su ficha lo dice: «la línea de Erzurum necesita todas sus tropas; esperando reclutas (2 en camino)».
- Un ejército cedido cambia de operación (`a.op`) y el parte lo dice una vez por turno y operación: «Línea de Erzurum cede 2 ejércitos a Ofensiva sobre Tiflis».
- Las órdenes propias del jugador y los ejércitos movidos a mano ese turno no se tocan, como ahora.

### IA

La IA usa el mismo reparto: deja de asignar solo ejércitos libres en `aiCommand` y pasa por la misma función de ceder sobrante.

### Pruebas (además de las de la primera parte)

11. Con una línea formándose y una ofensiva creada después, las dos reciben reclutas el mismo turno.
12. Una ofensiva creada junto a una línea con sobrante recibe ejércitos de ella ese mismo turno. La línea no baja de su mínimo.
13. Si la línea no tiene sobrante, la ofensiva no le quita nada y su ficha dice que espera reclutas.
14. Dos ofensivas que piden a la vez reciben ejércitos las dos.

## Rendimiento

La búsqueda de línea solo se ejecuta cuando hace falta: al crear una propuesta, al pasar a «Se repliega» o al evaluar si se puede volver. No se ejecuta todos los turnos en las líneas que aguantan sin brecha. El resultado se guarda en caché por turno. Objetivo: en el mundo «Caos total», el turno de la IA no sube más de un 10 % sobre lo que tarda hoy. `tools/perf-mapa.mjs` solo mide el dibujo del mapa, así que hay que añadir una medición del turno de la IA antes del cambio, para tener la referencia, y repetirla después.

## Pruebas

Se amplía `tools/smoke-mando.mjs` con estos escenarios mínimos:

1. Una línea en llanura con una brecha y colinas o montaña detrás se repliega a ellas. Todos sus miembros van a la nueva línea, ninguno contraataca y ninguno se queda en la antigua.
2. Una ciudad propia que queda delante conserva al menos una infantería con orden de mantener.
3. En inferioridad sin brecha (relación menor que 1), no contraataca aunque una casilla suelta dé 1,8.
4. Con refuerzos que dan 1,5 o más, vuelve hacia la línea dibujada y no pasa de ella.
5. No hay vaivén: con una relación entre 1 y 1,5 tras replegarse, se queda donde está.
6. Un miembro rodeado rompe el cerco o se refugia en la ciudad o montaña más cercana.
7. La línea propuesta para un frente con colinas o río cerca no sigue la frontera llana. La relación prevista llega a 1 si hay fuerzas.
8. Una línea de la IA sale en terreno defensivo.
9. Una partida guardada antes del cambio carga y sus líneas siguen funcionando.
10. Los niveles manual y asistida no mueven sin confirmar.

## Cierre

- Actualizar la sección «Mando estratégico» del README.
- Publicar una versión nueva como se hace en el proyecto (`tools/release.mjs`).

## Decidido por el jugador

- Si la rompen o queda en inferioridad, la línea se repliega a una posición de ventaja y se reordena, sin contraatacar a lo loco.
- La posición se valora por el terreno: montaña, ciudades y similares.
- El juego elige solo adónde replegarse. La propuse yo cuando no hubo elección explícita; el jugador había confirmado el comportamiento general.
- La línea que dibuja el jugador se respeta. Si no hay línea, se avisa y se propone una.
- La línea propuesta tiene que dar superioridad.
- Las ciudades que quedan delante conservan una guarnición que aguanta.
- En un frente largo, la línea propuesta cubre solo el tramo donde aprieta el enemigo. El resto queda en manos de las guarniciones de las ciudades.

## Decisiones mías (revisables)

- Umbrales: repliegue por debajo de 1 y vuelta desde 1,5.
- Profundidad: el repliegue busca a 2 turnos de marcha y la propuesta a 3 casillas de la frontera.
- La guarnición es como mínimo una infantería (regla de `detach`), con orden de mantener, y se fortifica si la operación fortifica.
- Fuerza enemiga contada a 3 casillas de la línea.
- Los cortados que no pueden llegar a 2 turnos se refugian en la ciudad o el terreno alto más cercano.
- Se respetan los tres niveles de automatización que ya existen. En manual y al saltar en asistida no cambia la línea.
- La línea actual es candidata. En total no retrocede más de 4 turnos de marcha desde la dibujada y nunca deja la capital detrás.
- Al replegarse se mantiene la misma anchura y las brechas solo cuentan dentro de la franja.
- Guarniciones y cortados vuelven a la operación cuando la línea pasa otra vez por donde están.
- Una propuesta aceptada cuenta como línea dibujada. Las líneas vecinas no se coordinan.

## Lo que queda para quien lo construya

- El algoritmo concreto de búsqueda de línea y sus límites de coste.
- Cómo se dibuja la flecha de repliegue dentro de APP-6.
- El texto exacto del parte y de la ficha, con el tono de los mensajes que ya hay.
- Ajustar los umbrales y las profundidades al probar, manteniendo los antiobjetivos.
