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
3. **Parte D · Punta de lanza y frente amplio** (añadida después: va antes que la C, porque mejora la guerra de tierra que ya se juega con la parte A).
4. **Parte C · Cohetes, misiles y armas nucleares**.

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

## Parte D · Punta de lanza y frente amplio

### Por qué
- **(Usuario)** «Un ataque tipo punta de flecha, es decir, ataques rápidos y de conquista rápida; luego otros más lentos que vayan creando logística por detrás, y poder abarcar mucha más amplitud para conquistar territorio, más que para destruir».
- Hoy (tras la parte A) toda ofensiva es un **asalto**: se reúne, avanza en bloque por un pasillo de 3 casillas al paso del más lento y ataca en masa. Va bien contra una masa enemiga, pero es lenta para ganar terreno, y nadie se ocupa de lo que queda detrás: ciudades asediadas que hay que mantener, carreteras rotas al conquistar y bolsas de enemigos sorteadas.

### D1 · Doctrina de la ofensiva
- **(Usuario)** La doctrina de sus ofensivas **la elige el jugador**. El juego solo propone una por defecto: la que crea más conveniente, preseleccionada y marcada como «recomendada» con su motivo (por ejemplo, «tienes muchos tanques y el enemigo no tiene masas»). Se calcula con la misma regla con la que elige la IA (D5). Nunca se cambia sola: una vez elegida, o si el jugador cambia la propuesta, se queda así. La anchura y la logística siguen el mismo criterio: valor por defecto según la doctrina, y el jugador lo cambia cuando quiera.
- **(Decisión mía)** Cada ofensiva tiene una **doctrina**, que se elige al dibujarla y se puede cambiar en su ficha:
  - **Asalto**: lo de la parte A, sin cambios.
  - **Punta de lanza**: conquista rápida en profundidad (D2), con un escalón de seguimiento que asegura y da logística (D3).
  - **Frente amplio**: ocupar territorio a lo ancho; evita las batallas grandes (D4).
- **Anchura del frente (Decisión mía):** se elige en la ficha entre estrecha, media y amplia. Por defecto, estrecha en asalto y en punta de lanza, y amplia en frente amplio.
  - En el mapa de Europa son 3, 6 y 10 casillas a cada lado de la flecha.
  - Se calcula en km como los demás radios (60, 120 y 200 km), con un mínimo de 3, 4 y 6 casillas: en el mundo, donde cada casilla mide unos 85 km, quedan 3, 4 y 6, y el asalto conserva el pasillo de 3 casillas de la parte A.
- **(Decisión mía)** Las fases de la parte A (reunión con lanzamiento «cuando esté lista» o «cuando yo lo diga») valen para las tres doctrinas.

### D2 · Punta de lanza
- **(Usuario)** Ataques rápidos y de conquista rápida.
- **(Decisión mía)** Al lanzarse, la ofensiva reparte a sus miembros en dos escalones:
  - **Punta**: los ejércitos de velocidad 6 o más. Un ejército va a la velocidad de su unidad más lenta. **(Usuario)** En las ofensivas del jugador no se parte ningún ejército: si lo ha formado mixto, va junto y a su paso; el comportamiento lo elige él. La IA sí puede separar los tipos rápidos de sus ejércitos para formar su punta, si le conviene.
  - **Seguimiento**: el resto.
  - Si no hay ninguno rápido, la punta es el miembro más rápido. La ficha deja pasar un ejército de un escalón al otro a mano.
- **La punta (Decisión mía):**
  - Avanza a toda velocidad por los puntos de la flecha. Solo guarda la cohesión de 2 casillas con los otros miembros de la punta, no con el seguimiento.
  - **Rodea lo fuerte**: no ataca una casilla cuya relación conjunta no llegue a `op.ratio`; busca paso alrededor dentro del pasillo. Los ejércitos que sortea quedan anotados como **bolsas** para el seguimiento.
  - Prefiere ocupar ciudades sin guarnición o con guarnición débil y los cruces de carreteras. Al entrar en una ciudad enemiga empieza el asedio, como hoy.
  - **Deja guarnición**: al seguir adelante desde una ciudad asediada, deja en ella un destacamento que mantiene el asedio. Son 2 infanterías, o la unidad más barata si no lleva infantería. Así el asedio no se pierde.
  - Una punta que se queda sin suministro o pasa hambre lo dice el parte. Igualmente sigue mientras tenga el umbral.
  - Se detiene si se aleja más de 6 casillas por delante del seguimiento, en los dos mapas (unos 120 km en Europa y 510 km en el mundo), para no quedar cercada. Espera a que el seguimiento se acerque.
- **(Decisión mía)** Con la parte A, «aislado» y «sin carretera» ya castigan a la punta que se interna sola. Es el precio de la velocidad, y el seguimiento lo compensa (D3).

### D3 · Escalón de seguimiento y logística
- **(Usuario)** Otros más lentos que vayan creando logística por detrás.
- **(Decisión mía)** El seguimiento va por el camino de la punta, con su propia cohesión (la de la parte A, a su paso), y hace por orden:
  1. **Releva las guarniciones** de las ciudades asediadas que dejó la punta: entra en ellas, se funde con el destacamento y, si el asedio necesita más tropas, las deja. Cuando la ciudad cae, el parte la da por tomada y su guarnición sigue con el seguimiento; si nadie llegó a relevarla, vuelve a la operación como seguimiento (ruling M1). Quien mantiene un asedio no cuenta como ejército libre para otras operaciones.
  2. **Limpia las bolsas** anotadas por la punta con ataque conjunto, solo si llega a `op.ratio`. Si no llega, las cerca, pero solo si con la bolsa cercada (su defensa con el factor de cercado de su dueño) todo el seguimiento llegaría a `op.ratio`: ocupa casillas vecinas para que queden rodeadas (rodeado ×0,75 / cercado ×0,5 y, en territorio ocupado, hambre). Si ni así, la **contiene**: la vigila un solo ejército y los demás siguen; el parte lo recuerda cada 3 turnos («el seguimiento contiene una bolsa en X»). El tope de la punta solo cuenta a los del seguimiento que marchan, no a los que relevan, asedian, cercan o vigilan (ruling I1).
  3. **Logística** con el oro de la operación:
     - Un ajuste nuevo, **«Logística»**, decide qué parte del oro por turno de la operación (`op.gold`) va a obras: 0, 25, 50 o 75 %. Por defecto es 50 % en punta de lanza y en frente amplio, y 0 en asalto.
     - Con ese oro, cada turno, en este orden:
       - **repara** los tramos rotos dentro del pasillo, en territorio ya propio (`startRepair`);
       - **construye** la carretera más corta desde la red propia hasta la casilla propia más cercana a la punta (`planRoad`), para que la punta tenga suministro y el pasillo cuente para la renta. Un tramo roto del camino no se rehace: se repara (una autovía rota sigue siendo autovía) y se sigue cuando esté listo.
     - Las obras siguen las reglas de siempre: turnos de obra y no se trabaja con enemigo al lado.
     - La ficha y el parte dicen qué se ha reparado y construido.
- **(Decisión mía)** Lo que se recluta por la plantilla de la operación entra en el seguimiento.

### D4 · Frente amplio
- **(Usuario)** Abarcar mucha más amplitud para conquistar territorio, más que para destruir.
- **(Decisión mía)** Con frente amplio:
  - Los miembros se reparten a lo ancho del pasillo (amplio por defecto), cada uno con su **franja**: el pasillo dividido en tantas franjas como miembros, ordenadas de un lado a otro de la flecha.
  - Cada uno avanza por su franja hacia la línea del siguiente punto. La cohesión mide cuánto ha avanzado cada franja a lo largo de la flecha (nadie más de 2 casillas por delante de la franja más atrasada), y no exige estar pegado al vecino.
  - **Objetivo: terreno.**
    - Ocupa casillas enemigas vacías.
    - Ataca solo guarniciones débiles: relación propia de al menos `op.ratio` + 0,5, solo o en conjunto con el vecino de franja.
    - Prefiere las ciudades, porque tomar una ciudad da la provincia entera, y deja guarnición al seguir, como la punta (D2).
    - Evita las masas enemigas: si un ejército enemigo fuerte entra en su franja, el miembro se aparta a la franja vecina o se detiene. La ficha avisa: «Masa enemiga en la franja 3: el frente se detiene ahí».
  - La logística es la de D3, con el seguimiento formado por los miembros más lentos. Con pocos miembros (menos de 3), todos van en el frente y la logística la hace la propia operación.
- **(Decisión mía)** Con frente amplio, una ofensiva no termina al tomar el objetivo si quedan provincias enemigas con ciudad dentro del pasillo: termina cuando no quede ninguna.
- **(Ruling M11)** Antes del objetivo, si pasan 6 turnos sin avanzar (sin ganar terreno enemigo del pasillo, sin que el frente avance media casilla y sin asediar), también termina, con aviso. La ficha avisa cuando espera ante un objetivo defendido entre `op.ratio` y `op.ratio` + 0,5 (un asalto ya atacaría). Lo que el jugador elige en la ficha para cada escalón se respeta en los repartos; solo si no cabe en las franjas vuelve al seguimiento, con aviso.

### D5 · IA
- **(Decisión mía)** La IA elige la doctrina de sus ofensivas nuevas:
  - **Punta de lanza**: si al menos un tercio de su fuerza de ataque es rápida (velocidad ≥ 6) y el enemigo del frente no tiene masas mayores que las suyas.
  - **Frente amplio**: contra un vecino mucho más débil (su fuerza ≤ 0,5 de la propia en ese frente).
  - **Asalto**: en los demás casos, y contra objetivos fortificados o capitales.
- Usa la logística igual que el jugador.

### D6 · Interfaz y mapa
- **Al dibujar** una ofensiva (herramienta Operación), un selector de doctrina con una línea que explica cada una. En la ficha, doctrina, anchura y logística.
- **En la ficha:**
  - qué miembros van en la punta y cuáles en el seguimiento, con el botón para pasar uno de escalón;
  - las bolsas sorteadas;
  - las guarniciones dejadas;
  - las obras en curso;
  - en frente amplio, las franjas, con qué miembro lleva cada una y si alguna está detenida.
- **En el mapa:**
  - **punta de lanza**: la flecha, con la punta más marcada; los miembros de la punta con una marca de escalón distinta de los del seguimiento;
  - **frente amplio**: el pasillo ancho, con sus franjas en un tono muy suave;
  - las bolsas, con un contorno a trazos;
  - las obras de logística, como las demás obras de carretera.
- **Símbolos:** la flecha de penetración de la OTAN para la punta de lanza y la flecha de avance de frente ancho para el frente amplio, en el estilo de las flechas que ya se dibujan.

---

## Parte E · Guerras con motivo

### Por qué
- **(Usuario)** «Las guerras que empiezan en un turno y acaban al siguiente. Una guerra se declara por un motivo: o se consigue ese objetivo, o se ve en inferioridad, o lo que sea, y entonces se negocia. Pero declarar la guerra y proponer la paz al siguiente pasa en casi todos los turnos con muchísimos países».
- **(Usuario)** «Si eres aliado pero no quiere entrar, no se declara la guerra y luego la paz: mejor no declarar la guerra».
- **(Usuario)** «Si se ve muy superior, no tiene por qué proponer la paz, ni aceptarla. Solo si ha pasado un tiempo, se ve igual, ha perdido algo de territorio o la guerra no la empezó él».
- **Lo que pasa hoy:**
  - Al atacar a un miembro de un bloque, `declareWar` mete en la guerra a todos sus aliados, sin preguntarles.
  - Cada turno, `wantsPeace` compara la fuerza de un país con la de un solo enemigo, sin contar a los aliados de ninguno de los dos. Así, un aliado pequeño que acaba de entrar «se ve inferior» y pide la paz al momento.
  - Entre dos IA, la paz se firma si el otro también la quiere o, si no, con un 30 % al azar.
  - Además, a partir de `peaceAfter` turnos, cualquiera la quiere con un 25 % al azar, gane o pierda.

### E1 · Cada guerra tiene un motivo
- **(Decisión mía)** Al declarar una guerra se guarda en la relación (`rel`):
  - `war = { by, goal, since, gain }`;
  - `by` es quien la declaró;
  - `goal` es su objetivo:
    - **conquista**: las provincias fronterizas del atacado que tocan al atacante, las que elige la IA para su ataque. Son las suyas de derecho (`legal`) y en su poder: lo que el atacado solo ocupa de un tercero no entra;
    - **defensa**: para el atacado;
    - **alianza**: para quien entra a defender a un aliado;
    - **señor**: para el satélite que entra por su señor;
  - `gain` es lo más que ha llegado a ocupar cada bando del otro y en qué turno, para saber si la guerra se estanca. Se apunta una vez por turno, al empezar la fase de la IA; mirar la guerra no cambia nada.
  - **(Revisión final)** Lo ganado y lo perdido se mide por lo ocupado entre los dos bandos, no con las casillas legales al empezar: el campo `start` que se pensó para eso se quita (las paces con terceros lo falseaban).
- Las guerras de partidas viejas cargan sin `by`, porque no se sabe quién empezó, y se tratan como si ninguno la hubiera empezado.

### E2 · Los aliados deciden si entran
- **(Usuario)** El aliado que no quiere entrar no declara la guerra.
- **(Decisión mía)** Cuando atacan a un miembro de su bloque, cada aliado de la IA decide si entra:
  - **Entra seguro** si comparte frontera con el atacante o con el atacado y el bando defensor, con él dentro, suma al menos el 70 % de la fuerza del bando atacante.
  - **Si no**, entra con una probabilidad que crece con la fuerza del bando defensor frente al atacante (de 0 a 0,8). Si el aliado es mucho más débil que el atacante (menos de un 15 % de su fuerza, la del país atacante solo, sin sus aliados ni satélites), no entra.
  - **El que no entra** no está en guerra. El registro dice «X no acude en defensa de Y». Si el bloque es público, pierde la confianza del atacado: deja el bloque con un 30 % de probabilidad.
- Los satélites siguen entrando siempre en las guerras de su señor, como hoy.
- El jugador aliado sigue recibiendo la llamada y decidiendo él, como hoy.

### E3 · Cuándo se quiere la paz
- **(Decisión mía)** La fuerza se mide **por bandos**: cada uno con sus aliados en esa misma guerra y sus satélites. Ya no se compara un país contra otro solo.
- **(Decisión mía)** Hay un **mínimo de 8 turnos de guerra** antes de proponer o aceptar la paz. Solo hay una salida antes: estar **vencido** (capital ocupada, el 40 % de su tierra ocupada o menos de un tercio de la fuerza del otro bando). El vencido puede pedirla en cualquier momento.
- **(Usuario)** Pasado ese mínimo, un país quiere la paz (proponerla o aceptarla) si se cumple al menos una de estas condiciones:
  1. **Objetivo cumplido**: el atacante tiene ocupadas todas las provincias de su objetivo, o la mitad si lleva más de `peaceAfter` turnos. Entonces quiere la paz quedándose lo ocupado. **(Revisión final)** Las provincias del objetivo que dejan de ser de derecho del atacado (otro país se las anexiona en otra paz) salen del objetivo: ya no se le pueden quitar a él. Si no queda ninguna, el objetivo está cumplido.
  2. **Se ve igual o inferior**: la fuerza de su bando es menos de 1,25 veces la del otro.
  3. **Ha perdido territorio**: el otro bando le ocupa más casillas de las que él le ocupa.
  4. **Ha pasado un tiempo** (para todos, también para quien la empezó): la guerra lleva más de `peaceAfter` turnos y no ha ganado terreno en los últimos 6 (**estancada**); o lleva `2 × peaceAfter` turnos o más (**dura ya demasiado**), en cuyo caso la quiere siempre.
- **(Usuario)** Si es muy superior (su bando tiene 1,25 veces la fuerza del otro o más), no ha perdido territorio, la empezó él y aún no ha cumplido su objetivo, **ni propone ni acepta** la paz, hasta que «ha pasado un tiempo» (condición 4).
- **(Revisión final)** Antes, la condición 4 valía solo para quien no la empezó. Así, un objetivo que se volvía imposible (una provincia que el atacado solo ocupaba y que volvía a su dueño, o que tomaba un tercero) dejaba a los dos países en guerra para siempre; con el jugador como defensor, sin salida. La salida por tiempo es la de las palabras del usuario: «solo si ha pasado un tiempo». Coste: alguna guerra larga termina sin que el fuerte cumpla su objetivo.
- **(Decisión mía)** Fuera el azar: dos IA firman la paz solo si las dos la quieren según estas reglas. Ya no hay un 30 % al azar.
- **(Decisión mía)** Una paz firmada da la tregua de siempre (`TRUCE_TURNS`). Después de una guerra, la IA no vuelve a declarar la guerra al mismo país hasta pasados otros 10 turnos.
- **Con el jugador:**
  - La IA propone la paz al jugador con las mismas reglas.
  - Acepta la del jugador con las mismas reglas, pero una **paz blanca** solo si está vencida o si no pierde nada con ella (no ocupa más del bando del jugador de lo que este le ocupa). **(Revisión final)** Con el objetivo cumplido quiere la paz quedándose lo ocupado: si aceptase la blanca, bastaría con dejarla cumplir su objetivo para que lo devolviera todo. Cuando propone la paz por eso, el diálogo dice que aceptará anexionar lo ocupado y no una paz blanca.
  - Además acepta, como hoy, «quedarse lo ocupado» si va ganando y no la empezó ella, y ser satélite solo si está vencida. Vencida se mide por bandos, así que al jugador le cuentan sus aliados en esa guerra; el diálogo de paz lo dice («su bando está vencido: el tuyo…»).
  - El aliado de la IA al que el jugador llama a su guerra no acude contra un país con el que firmó la paz hace menos de `TRUCE_TURNS` + 10 turnos (la misma tregua extra que al declarar).

### E4 · Declarar la guerra
- **(Decisión mía)** La IA declara la guerra con un objetivo y contando con lo que pasará:
  - suma a la fuerza del objetivo la de los aliados de este que **probablemente entren** (la regla de E2, sin azar: los que entrarían seguro, más la mitad de la fuerza de los dudosos);
  - solo declara si, aun así, supera la `warRatio` de su agresividad.
- Así se evita declarar la guerra para pedir la paz al turno siguiente al ver entrar a los aliados del otro.

### E5 · Que se vea
- **En el cajón de Países, para cada guerra del jugador:**
  - quién la empezó, el motivo, cuántos turnos lleva y la fuerza de cada bando;
  - y lo que hace falta para que el otro acepte la paz, por ejemplo: «No aceptará la paz: se ve muy superior y aún no ha cumplido su objetivo. Lo hará si pierde territorio, si se igualan fuerzas, cuando cumpla su objetivo, dentro de 4 turnos si se estanca y, en todo caso, dentro de 18 turnos».
  - Con niebla la frase no deja ver la fuerza del otro bando: si aceptaría por verse inferior o vencido, dice solo «Aceptaría la paz»; si no, «no sabes cuánta fuerza reúne su bando» y las vías (sin la del objetivo si no la empezó él). Si no la empezó él y te ocupa más de lo que le ocupas, dice que aún puede aceptar que cada uno se quede lo ocupado.
- **En el registro:**
  - «X no acude en defensa de Y»;
  - «X propone la paz: ha cumplido su objetivo» (o «se ve inferior», «ha perdido territorio», «la guerra se ha estancado», «la guerra dura ya demasiado», «está vencido»). La primera vez y luego cada 5 turnos mientras la propuesta siga en pie; la propuesta y el aviso, cada turno.
- **Medida de éxito:** en 30 turnos de Europa y del mundo con «Caos total», casi ninguna guerra dura 1 o 2 turnos. Solo valen las de un país vencido de verdad.

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
