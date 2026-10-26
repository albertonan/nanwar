# Mando de grandes ejércitos, drones, defensa automática y misiles

Fecha: 2026-10-26 · Afecta a: el motor (combate, órdenes, operaciones, plantillas, aviación, economía, investigación, niebla, diplomacia e IA), la interfaz (selección, fichas, cajón, herramientas) y la vista realista. Casi todo está en `index.html`; el dibujo, también en `vista-realista.js`.

## Por qué

El jugador, con sus palabras:

- «Al haber decenas o cientos de unidades se vuelve un caos». Quiere **crear escuadrones o divisiones manuales, seleccionando a mano o asignando desde un menú**, y que sea **visual**.
- «El límite de 60 de cada tipo es inviable, porque la IA acaba teniendo grupos de 3000, 4000. Si quiero planear un ataque, mis grupos de 90 en 90 son pulverizados aunque sean más en números».
- Las ofensivas: «una envió barcos a la costa, dos las generaba donde empieza la flecha. No siguen el recorrido que pongo en la flecha, intentan llegar cuanto antes al objetivo, y he puesto varios sitios por algo». Quiere que **ataquen a la vez** (también desde el mar) o **esperen y luego salgan**: «prefiero tenerlo todo listo y que no lleguen a destiempo estropeando toda la operación y siendo masacrados uno a uno».
- Más oro por turno que una operación puede gastar sola en reforzarse, y **mejorar divisiones ya creadas**.
- Ampliar la inteligencia: **enjambres de drones, sistemas de defensa automáticos, escolta de drones y aviones a unidades para defensa o ataque**.
- **Cohetes, cohetes más fuertes, misiles, misiles más fuertes, misiles guiados y bombas nucleares**. «Cada una vale muchísimo y quita dinero que generas por turno». Les afectan **los drones, que pueden defender, los antiaéreos y su nivel**.

Cómo se ve el éxito: con cientos de ejércitos, el jugador agrupa los suyos en divisiones y cuerpos con nombre, color y número que se reconocen de un vistazo en el mapa, los elige con un arrastre o desde una lista y les da una orden a todos a la vez. Una ofensiva reúne sus tropas, sigue el camino dibujado y golpea con todo a la vez: varios ejércitos juntos derrotan a una masa de 3000 si entre todos son más. Antes de atacar, ciega al enemigo con drones, le revienta el antiaéreo con misiles guiados y cubre a sus tropas con aviones de escolta. El enemigo puede hacer lo mismo, y unas baterías automáticas bien puestas le paran buena parte.

## Tres partes, en este orden

1. **Parte A · Mando de masas**: plantillas sin tope, escalones mayores, ataque conjunto, agrupaciones, ofensivas que siguen la flecha y atacan a la vez, más oro y refuerzo de lo ya creado. Es lo que más duele hoy: se publica sola, en cuanto esté.
2. **Parte B · Drones, escolta y defensa automática**.
3. **Parte C · Cohetes, misiles y armas nucleares**.

Marcas:
- **(Usuario)**: lo pidió el jugador.
- **(Decisión mía)**: una decisión razonable; el constructor puede afinar números probando. El jugador pidió que no se le pregunte: estas decisiones son mías y se le cuentan al publicar.

Reglas del proyecto que siguen valiendo:
- Investigación **lenta y cara**: 6·10·15 turnos, 4·8·12 turnos de renta (mínimo 80·160·240) y +10 % por cada investigación terminada. No se abarata.
- **Símbolos militares reales** (OTAN, APP-6): nada de emojis ni pictogramas inventados. Interfaz orgánica, superficies redondeadas, sin mayúsculas espaciadas.
- Textos en castellano, con el tono de los que ya hay. Toda regla nueva aparece en la ficha, en la previsión y en el parte, como las de desgaste.
- Las partidas guardadas siguen cargando: todo campo nuevo tiene valor por defecto y se valida al cargar como los demás (`deserialize`).
- La IA usa los mismos sistemas que el jugador.
- Pruebas: un `tools/smoke-*.mjs` por parte, como los que ya hay.

---

## Parte A · Mando de masas

### A1 · Plantillas sin tope
- **(Usuario)** Fuera el tope de 60 por tipo del editor de plantillas (`tpl-step`). **(Decisión mía)** Nuevo tope de 9999 por tipo. El editor tiene botones −100 −10 −1 +1 +10 +100 y un campo numérico en el que se escribe la cifra.
- **(Decisión mía)** Plantillas propias: hasta 24 (hoy 12).
- **(Decisión mía)** Dos plantillas de serie más: **Cuerpo de ejército** (60 infantería, 24 tanques, 12 artillería: 96, escalón XXX) y **Ejército de campaña** (240 infantería, 100 tanques, 50 artillería: 390, escalón XXXX).

### A2 · Escalones mayores
- **(Decisión mía)** La tabla `ECHELONS` sigue hasta el ejército, con los escalones de la OTAN: II batallón 1–3, III regimiento 4–9, X brigada 10–24, XX división 25–99, **XXX cuerpo 100–399, XXXX ejército 400–1499, XXXXX grupo de ejércitos 1500 o más**. Se ven sobre la ficha enemiga sin identificar y en la propia. Así una masa de 3000 se reconoce de lejos.
- Hay que comprobar que las cinco X caben sobre la ficha a todos los tamaños de casilla (más estrechas o en dos líneas si hace falta).

### A3 · Ataque conjunto
Hoy un combate es un ejército contra otro. Diez ejércitos de 90 atacan de uno en uno y caen de uno en uno contra 3000.
- **(Usuario)** Varios ejércitos propios atacan la misma casilla **a la vez**, y su fuerza se suma.
- **(Decisión mía)** Reglas:
  - Puede sumarse al ataque cualquier ejército propio que tenga la casilla atacada entre sus ataques posibles este turno (`reach(...).attacks`), con movimiento, sin haber atacado ya.
  - Ataque total = suma del ataque de cada participante, cada uno con su estado (rodeado, aislado, desorganizado…), su asalto anfibio si sale del mar y, si cruza un río sin Pontoneros, su ataque ÷1,25 (es lo mismo que la defensa ×1,25 de hoy, pero por participante). La defensa se calcula una vez, como hoy, sin el río.
  - Las pérdidas se reparten: todos los atacantes pierden la misma fracción, la que hoy perdería un único atacante con ese ataque total.
  - Si se gana, entra en la casilla el participante con más ataque (como hoy entra el atacante); los demás se quedan donde estaban. Todos gastan el turno (`used = 999`).
  - Rodeado: la regla de hoy ya da ×0,75 o ×0,5 al defensor con ejércitos enemigos en 3 o 5 lados. Atacar desde varios lados se premia así; no hay bonificación nueva.
- **(Decisión mía)** Interfaz: al elegir un ejército y pasar el ratón sobre un enemigo atacable, la previsión dice «Atacan contigo: N ejércitos vecinos» con la fuerza sumada y la probabilidad conjunta. Por defecto se suman los ejércitos de la **selección actual** (A4) que puedan llegar. Si no hay selección múltiple, los de la misma agrupación. Una casilla «Sumar a todos los vecinos» suma también los demás propios que puedan atacarla. El parte de batalla lista a los participantes.
- **(Decisión mía)** La IA lo usa: antes de descartar un ataque por no llegar a 1,3 a 1, suma los ejércitos suyos libres que también llegan a esa casilla. Las operaciones (A5) atacan siempre así.

### A4 · Agrupaciones
- **(Usuario)** Divisiones o grupos hechos a mano, eligiendo los ejércitos a mano o desde un menú, y que se vea en el mapa.
- **(Decisión mía)** Nombre en la interfaz: **agrupación**. En el código, `group` (el campo `form` ya existe para los refuerzos de las operaciones). Su nombre por defecto sale de su escalón y su número, por ejemplo «3.ª División», «1.er Cuerpo» o «2.º Ejército», y se puede cambiar.
- **Modelo (Decisión mía):**
  - `nation.groups`: lista de `{ id, name, num, color }`. `color` es un índice de una paleta de 8 colores distinguibles en las dos vistas y que no choquen con los de operaciones ni con los de país.
  - `army.group`: id de la agrupación o 0.
  - Al juntarse dos ejércitos (`settle`), el que recibe conserva la suya; si no tenía, toma la del que llega. Al dividirse (`split`), la parte que sale la conserva.
  - Una agrupación sin ejércitos se borra sola al empezar el turno.
  - Un ejército puede estar a la vez en una agrupación y en una operación: la agrupación es una etiqueta para elegir y mandar, y la operación sigue mandando.
- **Elegir (Decisión mía):**
  - Clic: un ejército, como hoy.
  - Ctrl/⌘ + clic: añade o quita un ejército de la selección.
  - Ctrl/⌘ + arrastrar: rectángulo de selección con los ejércitos propios dentro. En pantallas táctiles, un botón **«Seleccionar zona»** en la ficha o en la barra hace que el siguiente arrastre sea un rectángulo en vez de mover el mapa.
  - Doble clic sobre un ejército de una agrupación: elige toda la agrupación.
  - Alt + 1–9: elige la agrupación de ese número y centra el mapa en ella. Alt + Mayúsculas + 1–9: crea con la selección la agrupación de ese número (o la sustituye). Las teclas 1–6 solas siguen siendo las herramientas, y Ctrl + número lo usa el navegador para las pestañas.
  - Desde el cajón (abajo).
- **Ficha de selección múltiple (Decisión mía):**
  - Totales: unidades por tipo, ataque, defensa, velocidad del más lento y escalón del total.
  - Lista de los ejércitos, cada uno con su lugar y estado. Un clic en uno lo centra; una cruz lo quita de la selección.
  - Acciones:
    - **Crear agrupación** o **Añadir a…** (lista de agrupaciones).
    - **Marchar**: elige una casilla. Cada ejército recibe una orden de marcha a la casilla libre más cercana a ella (repartidos alrededor, sin apelotonarse en una).
    - **Reunir**: todos van a una casilla y se funden en un solo ejército. Por defecto la del ejército más fuerte; se puede elegir otra.
    - **Ataque coordinado**: elige una casilla enemiga (A4b).
    - **Mantener posición**, **Fortificar**, **Asignar a operación**, **Reforzar** (A7).
    - **Disolver la agrupación**.
- **A4b · Ataque coordinado (Decisión mía):**
  - Orden de agrupación `{ kind: 'assault', target, ratio }`, guardada en la agrupación. Cada miembro recibe una casilla de partida distinta junto al objetivo, repartidas por lados distintos, y marcha hacia ella.
  - Nadie ataca hasta que **todos** están en su sitio, o hasta que lleven 3 turnos esperando a uno que no llega: entonces atacan los que están. En ese momento, ataque conjunto (A3) si la relación conjunta llega a `ratio` (por defecto el de la postura). Si no llega, esperan y la ficha lo dice.
  - Mientras esperan, mantienen la posición.
- **Cajón «Orden de batalla» (Decisión mía):**
  - Pestaña nueva del cajón (junto a Operaciones), con su botón y su tecla (`B`).
  - Arriba, las agrupaciones. Cada una lleva su símbolo OTAN (el del tipo dominante con el escalón del total), su color, nombre, número de ejércitos, unidades, estado (sin órdenes, marchando, atacando, esperando, en operación…) y su escolta (parte B).
  - Desplegada, lista sus ejércitos con casilla de verificación. Debajo, «Sin agrupar», agrupados por provincia o por operación.
  - Filtros: todas, en pantalla, por operación.
  - Botones: elegir en el mapa (selección múltiple), centrar, renombrar, cambiar color, disolver. Con varios marcados, «Crear agrupación» o «Añadir a…».
- **En el mapa (Decisión mía):**
  - Cada ficha de un ejército agrupado lleva el **número de su agrupación** en la casilla de designación de la OTAN (abajo a la izquierda del marco, campo de designación única de APP-6) y una franja de su color en la peana o bajo la ficha. En la vista realista, el banderín de la peana toma el color de la agrupación.
  - Al elegir una agrupación, o al pasar el ratón por su fila del cajón, sus miembros se rodean de un contorno suave de su color y se dibuja una envolvente translúcida que los une.
  - **De lejos** (por debajo de `FAR_HEX`), en vez de cada ficha, se dibuja **un solo símbolo por agrupación** en el centro de sus miembros, con escalón y total («XXX · 340»). Los ejércitos sin agrupar se siguen viendo como hoy.
  - Capa nueva **Agrupaciones** en el menú Mapa (tecla G): tiñe las fichas con el color de su agrupación y atenúa las que no tienen.

### A5 · Ofensivas que siguen la flecha y atacan a la vez
Hoy, en `executeOp`, cada ejército de una ofensiva va directo al objetivo (`advance(a, obj, r)`), ignora los puntos intermedios de la flecha, ataca por su cuenta en cuanto tiene ventaja y puede embarcar si el mar le sale más corto.
- **(Usuario)** La ofensiva sigue el recorrido dibujado, punto por punto.
- **(Usuario)** Las tropas no llegan a destiempo: o salen todas juntas cuando estén listas, o esperan.
- **(Usuario)** Si una parte va por mar, ataca a la vez que la de tierra.
- **(Decisión mía)** Una ofensiva pasa por tres fases, que su ficha enseña:
  1. **Reunión.** Sus ejércitos marchan a la zona de reunión, la casilla de salida de la flecha y las de alrededor, repartidos y sin apelotonarse en una. La fase acaba según la opción **Lanzamiento**:
     - **«Cuando esté lista»** (por defecto): todos los miembros están en la zona y no queda ninguna formación de refuerzo (`op.form`) a medio reclutar o en marcha. Además, la fuerza reunida llega a `op.ratio` contra la defensa conocida del primer tramo: ejércitos enemigos vistos a 3 casillas o menos del primer segmento de la flecha.
     - **«Cuando yo lo diga»**: espera al botón **«Lanzar la ofensiva»** de su ficha, que enseña la fuerza reunida y la previsión contra lo conocido.
     - Con cualquiera de las dos, si lleva 8 turnos esperando a un miembro que no llega, sale sin él y la ficha lo avisa.
  2. **Avance.** La ofensiva sigue los puntos de la flecha **en orden**.
     - Su meta es el siguiente punto de la flecha. Un punto se da por alcanzado cuando el ejército más adelantado está a 1 casilla o menos de él, o cuando es propio.
     - Los ejércitos van **juntos**. Ninguno termina el turno más de 2 casillas por delante, medido a lo largo de la flecha, del más atrasado. Los rápidos esperan.
     - Avanzan en frente, ocupando casillas vecinas dentro de un pasillo de 3 casillas a cada lado del trazado. No se desvían fuera del pasillo ni atacan fuera de él.
     - Al ir juntos se apoyan y evitan «aislado».
  3. **Asalto.** Cada turno, para cada casilla enemiga a tiro dentro del pasillo, se suman todos los miembros que pueden atacarla (A3). Se ataca si la relación conjunta llega a `op.ratio`, empezando por la mejor relación. Nadie ataca solo si la relación conjunta no llega.
- **Mar (Decisión mía):**
  - Un ejército de una ofensiva solo embarca si el trazado dibujado cruza el mar: un punto de la flecha está en el mar, o la recta entre dos puntos seguidos pasa por casillas de mar. Si el jugador dibujó por tierra, se va por tierra aunque sea más largo.
  - Si la ofensiva lleva parte por mar, el grupo embarcado espera a una casilla de la costa hasta que el grupo de tierra esté en posición de asalto (a 1 casilla de su meta), y entonces desembarcan y atacan el mismo turno. Es una generalización de `holdLanding`, que hoy solo espera a otros barcos.
  - Si toda la ofensiva va por mar, desembarcan todos el mismo turno.
- **Refuerzos que llegan tarde (Decisión mía):** lo que se une a una ofensiva ya lanzada (formaciones de su plantilla, envíos de la reserva) no ataca solo. Marcha por el trazado hasta alcanzar al grueso, y solo entonces cuenta para los ataques.
- **Zona de reunión de los refuerzos (Decisión mía):** sigue siendo la salida de la flecha, como hoy, que es donde se reúne la ofensiva. La ficha de la operación lo explica: «Los refuerzos se reúnen en X, la salida de la flecha». Se puede cambiar con un botón **«Mover la zona de reunión»** y un clic en una casilla propia.
- **La IA** usa las mismas fases en sus ofensivas.

### A6 · Más oro para las operaciones
- **(Usuario)** Subir el tope de oro por turno que una operación gasta sola en reforzarse.
- **(Decisión mía)** `OP_GOLD` pasa de `[0, 50, 100, 200, 400]` a `[0, 50, 100, 200, 400, 800, 1600, 3200, 6400]`.
- **(Decisión mía)** El fondo acumulado se topa en el mayor de 6 turnos de su oro o 3 plantillas (hoy, 4 turnos o 2 plantillas), para que una plantilla grande pueda completarse.
- Las partidas guardadas con los valores de antes siguen siendo válidas.

### A7 · Reforzar lo ya creado
- **(Usuario)** «Mejorar divisiones ya creadas».
- **(Decisión mía)** Lo entiendo como completar o engordar un ejército o una agrupación que ya existe, con tropas nuevas que llegan hasta él. Desde la ficha de un ejército, de una selección o de una agrupación, **«Reforzar»** abre un editor como el de plantillas:
  - **Hasta una plantilla**: elige una plantilla y se recluta lo que falte para igualarla, contando lo que ya tiene.
  - **Añadir**: cantidades por tipo, con los mismos botones −100…+100.
  - **Oro por turno**: lo que puede gastar cada turno, de `OP_GOLD`, o «todo lo que haga falta ya».
  - **Mantener completa**: si se marca, cuando el ejército o la agrupación pierde tropas en combate, se vuelve a reclutar lo perdido hasta la plantilla.
- **(Decisión mía)** Funciona como los refuerzos de las operaciones (`reinforceBegin`, `recruitOne`, `reinforceEnd`). Se recluta en las ciudades con cupo más cercanas al ejército. Al turno siguiente, los reclutas marchan con una orden nueva `{ kind: 'join', target: id }`: van tras ese ejército y se funden con él al llegar. Con agrupación, se unen al miembro más cercano. El estado se guarda en el propio ejército (`army.reinforce`) o en la agrupación (`group.reinforce`).
- La ficha enseña el progreso («reclutadas 40 de 120, 25 en camino»).

---

## Parte B · Drones, escolta y defensa automática

### B1 · Investigación nueva
Dos ramas en el área Inteligencia, con las mismas reglas de coste y tiempo que las demás:

| Rama | Nivel 1 | Nivel 2 | Nivel 3 |
| --- | --- | --- | --- |
| **Drones** | **Drones tácticos**: desbloquea los enjambres (B2): reconocer, atacar y patrullar, alcance 150 km. | **Municiones merodeadoras**: alcance 300 km, más daño, y los enjambres pueden escoltar (B4). | **Enjambres autónomos**: saturan el antiaéreo (B2) y su reconocimiento ve galones y fortificaciones. |
| **Defensa automática** | **Defensa de punto** (tipo C-RAM): desbloquea la batería automática (B3) contra drones y cohetes. | **Interceptores de medio alcance** (tipo Cúpula de Hierro): más radio y capacidad; también contra misiles y misiles guiados. | **Escudo antimisiles con láser** (tipo Arrow y láser de alta energía): más radio y capacidad; también contra misiles pesados y nucleares. |

- **Galones (Decisión mía):** los enjambres llevan los de Drones; las baterías, los de Defensa automática.
- **IA (Decisión mía):** pesa estas ramas en guerra, más si el enemigo tiene drones o misiles.

### B2 · Enjambres de drones
- **(Usuario)** Crear enjambres de drones.
- **(Decisión mía)** El enjambre es una pieza como el escuadrón (`swarms`, con base, listo, volado, dañado y encargo). Se diferencia en esto:
  - Se compra en **cualquier ciudad propia**, sin aeródromo, hasta 4 por ciudad, por **120 de oro**, y vuela al turno siguiente.
  - Su alcance desde la base es 150 km, y 300 km con Drones 2.
  - Su fuerza es la mitad de la de un escuadrón.
  - Si toman su ciudad, se pierde. Si la ciudad cambia de dueño sin combate, vuela a la ciudad propia más cercana con sitio.
  - Una misión por turno. Un mismo blanco puede recibir en un turno un acierto aéreo, uno de drones y los de misiles: cada arma tiene su propia cuenta de aciertos por turno.
- **Misiones (Decisión mía):**

| Misión | Qué hace si sale bien |
| --- | --- |
| **Reconocer** | Desvela un círculo de 60 km (mínimo 1 casilla) alrededor del blanco durante este turno y el siguiente del jugador: tipo y número de los ejércitos, antiaéreo fijo, baterías y aeródromos. Con Drones 3, también galones y fortificaciones. Lo desvelado cuenta como «conocido» para la precisión de la aviación, los drones y los misiles. |
| **Atacar ejército** | Le quita un 4–7 % de las unidades (6–10 % con Drones 2). Con Drones 3, además lo desorganiza un turno. |
| **Patrullar** | Como «Proteger casilla» de la aviación, pero contra drones y cohetes: cubre su casilla y las vecinas hasta el próximo turno de su dueño. |
| **Escoltar** | Ver B4. Requiere Drones 2. |

- **Contra el antiaéreo (Decisión mía):**
  - El antiaéreo derriba drones con más facilidad que aviones: la probabilidad de derribo se multiplica por 1,5. El dron es lento, pero barato.
  - Un escuadrón que protege una casilla derriba los drones que entran en ella con la tirada del combate aéreo, a fuerza doble.
  - **Saturación (Drones 3):** contra una misión de 3 o más enjambres juntos, el antiaéreo cuenta la mitad.
- Símbolo: el de la OTAN (APP-6) para vehículo aéreo no tripulado, el marco de unidad aérea con el símbolo de UAV. En la vista realista, una miniatura de dron de ala fija sobre peana.

### B3 · Baterías de defensa automática
- **(Usuario)** Sistemas de defensa automáticos.
- **(Decisión mía)** Una **batería automática** es una instalación como el antiaéreo fijo:
  - se construye en una casilla propia por 150 de oro, con 2 turnos de obra;
  - se pierde si toman la casilla;
  - el enemigo solo la conoce como al antiaéreo fijo: Reconocimiento 2, espía, satélite, reconocimiento con drones, o porque le ha disparado.
- **(Decisión mía)** Dispara sola contra todo lo que entra en su radio con destino a una casilla de ese radio: drones, cohetes y misiles según el nivel. Tiene una **capacidad** de interceptaciones por ronda; una ronda es el turno de cada país atacante, y se repone al empezar el turno de cada país. Pasada la capacidad, lo demás llega: la saturación es la manera de romperla.

| Nivel de Defensa automática de su dueño | Radio | Capacidad | Drones | Cohetes | Misil | Misil guiado | Misil pesado | Nuclear |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 40 km | 4 | 80 % | 70 % | — | — | — | — |
| 2 | 100 km | 8 | 85 % | 80 % | 60 % | 45 % | — | — |
| 3 | 200 km | 12 | 90 % | 90 % | 70 % | 60 % | 50 % | 35 % |

- Las baterías ya construidas mejoran al investigar, como el antiaéreo fijo.
- Un acierto de «Destruir antiaéreo» (aviación) o de un misil la destruye; no tiene estado dañado.
- **Símbolo (Decisión mía):** marco de instalación de la OTAN con el símbolo de defensa antimisil (cúpula de defensa aérea con el modificador de misil). En la vista realista, un lanzador con contenedores verticales.

### B4 · Escolta de aviones y drones
- **(Usuario)** Acompañamiento de drones y aviones a unidades, para defensa o ataque.
- **(Decisión mía)** Un escuadrón (sin requisito) o un enjambre (con Drones 2) recibe el encargo **Escoltar** sobre un ejército o una agrupación, en modo **defensa** o **ataque**:
  - Gasta su misión de cada turno en eso.
  - Si lo escoltado sale de su alcance, la escolta se suspende y la ficha avisa.
  - En la agrupación, la escolta cubre a todos sus miembros; en ataque, apoya al primero que ataque cada turno (o al ataque conjunto entero).
  - Si el ejército escoltado desaparece, la escolta pasa al ejército con el que se fundió o, si no lo hay, queda libre.
- **Defensa:**
  - Lo escoltado cuenta como casilla protegida, como «Proteger casilla» en cada casilla de sus miembros, durante los turnos del enemigo. Las misiones aéreas enemigas contra ellos tienen que pasar antes por los escuadrones de escolta (combate aéreo). Los drones de escolta interceptan drones y cohetes con un 50 % cada uno (70 % con Drones 3), hasta 2 por enjambre y turno.
  - En combate de tierra en que lo escoltado defiende: defensa ×1,1 por escuadrón (tope ×1,3) y ×1,05 por enjambre (tope ×1,15). Aparece como factor «apoyo aéreo» en el desglose.
- **Ataque:**
  - Cuando lo escoltado ataca, antes del combate cada escolta hace gratis una misión «Atacar ejército» contra el defensor, con sus reglas normales de antiaéreo e intercepción.
  - En el combate: ataque ×1,1 por escuadrón (tope ×1,3) y ×1,05 por enjambre (tope ×1,15), como factor «apoyo aéreo».
  - Los drones de escolta, además, dejan conocido al defensor: previsión exacta y sin castigo a ciegas.
- **En el mapa:** junto a la ficha del ejército escoltado, una ficha pequeña de escuadrón o de dron con una línea fina hasta ella.
- **El mando:** las operaciones con el fin «Proteger y escoltar» reparten sus escuadrones y enjambres como escolta de sus ejércitos más expuestos (en defensa) o de los que van a asaltar (en ataque).

### B5 · Alas
- **(Usuario)** Crear escuadrones, además de divisiones.
- **(Decisión mía)** Las agrupaciones de A4 también sirven para la aviación. Con la herramienta Aviación se pueden marcar escuadrones y enjambres de varias bases y guardarlos como **ala**, con nombre y número. Un ala se elige entera, vuela junta (una misión con todos los que puedan) y se asigna entera a una escolta o a una operación.

---

## Parte C · Cohetes, misiles y armas nucleares

### C1 · Arsenal
- **(Usuario)** Seis armas: cohetes, cohetes más fuertes, misiles, misiles más fuertes, misiles guiados y bombas nucleares. Cada una vale muchísimo y quita dinero de lo que se genera por turno.
- **(Decisión mía)** Las armas se compran y quedan en un **arsenal nacional**: `nation.arsenal`, unidades de cada tipo. Cada unidad en el arsenal tiene un **mantenimiento por turno**, que se resta de la renta: así «quitan dinero que generas por turno». Si al cobrar el oro quedaría por debajo de 0, se desmantelan armas, primero las de mantenimiento más alto, hasta que no. El parte lo avisa.
- **(Decisión mía)** El precio sigue la regla de los satélites: unos turnos de renta del país, con un mínimo. Así es muchísimo para todos, grandes y pequeños.

| Arma | Requiere | Alcance | Desde | Precio | Mantenimiento por turno |
| --- | --- | --- | --- | --- | --- |
| **Cohete** (lanzacohetes múltiple) | nada | 80 km | un ejército propio | 1 turno de renta (mín. 150) | 5 |
| **Cohete pesado** (de largo alcance) | Cohetería 1 | 300 km | un ejército o una ciudad propia | 2 turnos (mín. 300) | 10 |
| **Misil** (balístico táctico) | Cohetería 2 | 500 km | una ciudad propia | 4 turnos (mín. 600) | 20 |
| **Misil pesado** (balístico de alcance medio) | Cohetería 3 | 2500 km | una ciudad propia | 8 turnos (mín. 1200) | 40 |
| **Misil guiado** (de crucero) | Armas estratégicas 1 | 1500 km | una ciudad propia | 6 turnos (mín. 900) | 30 |
| **Bomba nuclear** | Armas estratégicas 3 | 8000 km | la capital o una ciudad propia | 25 turnos (mín. 5000) | 150 |

- Para el precio cuenta la renta del turno, sin el mantenimiento del arsenal.

### C2 · Lanzar
- **(Decisión mía)** Herramienta nueva **«Ataque a distancia»** (tecla 7), con el símbolo OTAN de misil:
  - Se elige el arma y cuántas se lanzan juntas, una **salva**.
  - Se hace clic en el blanco. El lanzador se elige solo: el más cercano que valga para esa arma, con el blanco a su alcance.
  - Antes de confirmar, la ficha enseña el alcance (círculo), las defensas **conocidas** que cubren el blanco, cuántas armas se espera que pasen y el efecto esperado. Si hay defensas que no se conocen, lo dice: «puede haber defensas que no conoces».
  - Se resuelve al lanzar, como una misión aérea, y sale en el parte.
- **(Decisión mía)** Cada ejército propio dispara como mucho una salva de cohetes por turno. Desde las ciudades no hay límite: el límite es el arsenal.
- **Efecto de cada arma que llega (Decisión mía):**

| Arma | Contra un ejército | Contra instalaciones | Otros |
| --- | --- | --- | --- |
| Cohete | 6–9 % de bajas | — | Corta las carreteras de la casilla (si se elige ese blanco) |
| Cohete pesado | 10–14 % | Daña un antiaéreo fijo (como un acierto) | Corta carreteras |
| Misil | 15–20 % y lo desorganiza 2 turnos | Fortificación −1 nivel; destruye un antiaéreo, una batería o un aeródromo, inservible 3 turnos | |
| Misil pesado | 25–30 % en la casilla y 8 % en las vecinas | Fortificación −2 niveles; destruye un antiaéreo, una batería o un aeródromo | Ciudad: desarrollo de la provincia −25 % |
| Misil guiado | 15–20 % | Como el misil, contra la instalación elegida | Precisión: rinde entero aunque el blanco no se conozca |
| Nuclear | Ver C4 | | |

- Se elige el blanco como en la aviación: ejército, carreteras, fortificación, antiaéreo o batería, aeródromo.
- Las armas de una salva se aplican una tras otra: las bajas se componen y cada misil baja un nivel de fortificación. No hay tope de aciertos por turno para los misiles: el precio es el tope.
- **Inteligencia (Decisión mía):** salvo el misil guiado, contra un blanco que no se conoce rinden la mitad, como la aviación a ciegas (`blindHit`). Con Munición guiada no cambia: es de la aviación.

### C3 · Defensas: drones, antiaéreo y su nivel
- **(Usuario)** A cohetes y misiles les afectan los drones (que pueden defender), los antiaéreos y el nivel del antiaéreo.
- **(Decisión mía)** Cada arma que llega pasa por tres capas, en este orden. La que intercepta la elimina.
  1. **Drones** que patrullan la casilla o escoltan a quien está en ella: contra cohetes y cohetes pesados, 50 % (70 % con Drones 3), hasta 2 por enjambre y ronda. Contra misil guiado, 25 %. Contra los demás, nada.
  2. **Baterías automáticas** que cubren la casilla (tabla de B3), mientras les quede capacidad. Se usa primero la de más probabilidad.
  3. **Antiaéreo** que cubre la casilla: sitios fijos, integrado y móvil, con la fuerza de `aaList` (que ya depende del nivel de Defensa aérea) y el tope `AA_CAP`. La probabilidad de interceptar cada arma es `1 − e^(−S·k/40)`, donde S es la fuerza total y k depende del arma: cohete 1, cohete pesado 0,8, misil 0,5, misil guiado 0,6, misil pesado 0,3, nuclear 0,15. Como capacidad, cada sitio, cada ciudad con integrado y cada ejército con antiaéreas atiende como mucho 3 armas por ronda.
- **(Decisión mía)** Referencias: un sitio fijo sin investigar (S = 10) para un cohete el 22 %. Cuatro sitios con Defensa aérea 2 (S = 64) paran el 80 % de los cohetes, el 55 % de los misiles y el 21 % de las nucleares.
- **Armas estratégicas 2** hace a los misiles más difíciles de interceptar (C5).
- Lo interceptado se ve en el mapa como un destello en el aire y en el parte: «3 de 8 misiles interceptados».

### C4 · Armas nucleares
- **(Usuario)** Bombas nucleares, carísimas.
- **(Decisión mía)** Lo que hace una que llega:
  - Destruye los ejércitos de la casilla y, en un radio de 40 km (mínimo 1 casilla), quita la mitad de las unidades.
  - En ese radio destruye fortificaciones, antiaéreo, baterías, aeródromos (con sus escuadrones) y enjambres, y rompe todas las carreteras.
  - La provincia del blanco queda con desarrollo 0. Sus casillas en el radio quedan **contaminadas** 15 turnos: no dan renta, y un ejército que termina su turno en una pierde el 10 % de sus unidades.
  - En el mapa: zona rayada con el marcado CBRN de la OTAN y los turnos que quedan.
- **Diplomacia (Decisión mía):** quien la lanza queda **paria** 30 turnos:
  - Las IA le declaran la guerra con mucha menos ventaja (`warRatio` ×0,6 contra él).
  - Nadie firma la paz ni alianzas con él.
  - Cada aliado suyo deja el bloque con un 50 % de probabilidad.
- **(Decisión mía)** Ajuste de partida nuevo, **«Armas nucleares: permitidas / prohibidas»**, permitidas por defecto. Prohibidas: Armas estratégicas 3 no existe para nadie.
- **(Decisión mía)** Las potencias nucleares reales (Estados Unidos, Rusia, China, Francia, Reino Unido, India, Pakistán, Israel y Corea del Norte, las que estén en el mapa) empiezan con Armas estratégicas 3 ya investigado, sin arsenal. Si las nucleares están prohibidas, no.
- **IA (Decisión mía):** solo lanza una nuclear si se cumplen las dos cosas:
  - tiene una en el arsenal;
  - está perdiendo de verdad: su capital asediada o con enemigo al lado, o ha perdido el 40 % de sus provincias de partida en una guerra en curso.
  
  El blanco es el mayor ejército enemigo dentro de su territorio o junto a su capital. Solo compra nucleares si es rica (renta en el tercio alto) y está en guerra con alguien más fuerte.

### C5 · Investigación
Dos ramas nuevas en el área Militar:

| Rama | Nivel 1 | Nivel 2 | Nivel 3 |
| --- | --- | --- | --- |
| **Cohetería** | **Cohetes de largo alcance**: desbloquea el cohete pesado. | **Misiles balísticos tácticos**: desbloquea el misil. | **Misiles de alcance medio**: desbloquea el misil pesado. |
| **Armas estratégicas** | **Misiles de crucero**: desbloquea el misil guiado. | **Vehículos de reentrada maniobrables**: todas las interceptaciones de misiles, guiados, pesados y nucleares ×0,7. | **Bomba nuclear**: desbloquea el arma nuclear. |

### C6 · IA
- **(Decisión mía)** En guerra, si le cuesta poco en turnos de renta (como `AI_AIR_TURNS`), aparta un fondo para el arsenal, como hace con la aviación. Lanza sobre:
  - antiaéreo y baterías conocidos en el camino de sus operaciones aéreas;
  - la fortificación del objetivo de sus ofensivas;
  - ejércitos enemigos grandes que amenazan sus ciudades.
- **(Decisión mía)** Construye baterías en las ciudades del frente si el enemigo tiene drones o misiles, y compra enjambres para reconocer antes de sus misiones y para escoltar sus ofensivas.

### C7 · Interfaz y vista
- **Arsenal:** sección en la herramienta «Ataque a distancia» y en el resumen del país: existencias, comprar, precio y mantenimiento. El desglose de la renta muestra «Mantenimiento del arsenal −X».
- **Símbolos (APP-6):** misil de superficie a superficie para los misiles; lanzacohetes múltiple para los cohetes. Para la nuclear, el marcado CBRN de la OTAN.
- **En el mapa:** cada lanzamiento se dibuja como un arco del lanzador al blanco, con su resultado, también en la repetición de los turnos de la IA. Las interceptaciones, como un destello.
- **Vista realista:** arcos y destellos con el mismo estilo que los trazos de las misiones aéreas.

---

## Lo que no se hace
- No se pone tope al tamaño de un ejército ni se añade «anchura de frente»: el ataque conjunto y el rodeo ya dan la respuesta.
- No hay misiles antibuque ni guerra naval nueva.
- No hay intercepción de escuadrones por baterías: las baterías son contra drones y armas; contra aviones sigue el antiaéreo.

## Lo que queda al constructor
- Los números marcados como decisión mía se ajustan probando, salvo los de investigación.
- La forma exacta de la envolvente de agrupación, la paleta de 8 colores y cómo se apilan las fichas pequeñas de escolta.
- Cómo encaja la tecla `B` y la tecla 7 con los atajos que ya existen. Si chocan, se elige otra libre y se documenta en el README.
- Rendimiento: la IA con decenas de países no debe tardar más de un 15 % más por turno en «Caos total» del mundo. Se mide con `tools/perf-mapa.mjs` o equivalente.
