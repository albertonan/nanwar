# Teatros: quitar ruido y reorganizar una partida enorme

Fecha: 2026-10-27 · Afecta a: el dibujo de ejércitos de lejos (`MapView.draw`), la pestaña Batalla (`renderBattleOrder`), la pestaña Mando (`renderCommand`), las propuestas de frente (`frontPlan`) y el panel Mapa. Todo está en `index.html`. No cambian las reglas del juego ni la IA.

## Por qué

El jugador lleva una partida del mapa del mundo (España, turno 2243; copia local en `tools/cache/partida-mundo-2243.json`, sin subir). Tiene 211 de 1033 provincias, 30 aliados, 349 000 de oro y 342 ejércitos, pero ninguna operación ni agrupación, y solo 16 órdenes, todas de «Mantener». Sus palabras: «llevo casi medio mundo. Y creo que es imposible ir mirando cada cosa. Quiero poder montar operaciones».

Lo que se ve al cargar la partida:

| Bloque de territorio | Provincias | Ejércitos | Unidades | Frontera con no aliados |
|---|---|---|---|---|
| Sudamérica y Centroamérica | 132 | 137 (116 de 1–3 unidades) | 18 270 | 18 casillas |
| Magreb y Sahel | 57 | 167 (54 de 1–3) | 5 029 | 476 casillas |
| Francia y España | 16 | 26 (17 de 1–3) | 3 775 | ninguna |

- **Ruido:** 174 ejércitos de 1–3 unidades parados en sus ciudades llenan el mapa de lejos y la pestaña Batalla sin hacer nada.
- **Fuerza en el sitio equivocado:** las masas enormes (7 600, 3 500, 2 300 unidades) están en plena Amazonía, lejos de cualquier frontera peligrosa. África tiene casi toda la frontera y poca tropa, y nada en el juego lo dice.

Tras ver la propuesta en tres piezas, el jugador dijo «adelante con todo esto».

## Objetivos

1. **Guarniciones fuera de la vista.**
   - **Qué es:** un ejército pequeño en su propia ciudad, sin orden de marcha, operación ni agrupación.
   - **De lejos:** deja de dibujarse como ficha y pasa a ser una marca discreta en la ciudad.
   - **En Batalla:** todas juntas en una fila plegada.
   - **En las reglas:** no cambia nada.
2. **Teatros en la pestaña Mando.**
   - El territorio del jugador por bloques conectados, también en paz.
   - Cada teatro muestra un resumen: provincias, ejércitos, unidades, frontera peligrosa y ejércitos sin encargo.
   - Avisa cuando el reparto de tropas no se corresponde con el peligro.
3. **«Proponer organización» en cada teatro.**
   - Es un borrador dibujado en el mapa: líneas de defensa, una reserva, agrupaciones y marchas del sobrante a otro teatro.
   - El jugador acepta o descarta cada pieza, o todas a la vez.
   - Nada se mueve ni se crea hasta que acepta.

## No objetivos

- No cambian combate, movimiento, suministro, reclutamiento ni las operaciones existentes.
- La IA no usa teatros ni propuestas: ya manda con operaciones.
- No hay datos geográficos nuevos (continentes): los teatros salen del territorio.
- No se guardan los teatros ni las propuestas: se calculan.

## Antiobjetivos (fallaría aunque «funcione»)

- **Decidir por el jugador:**
  - mover, fundir, partir o reasignar un ejército sin que lo acepte;
  - cambiar por su cuenta algo que el jugador ya organizó: sus operaciones, agrupaciones y órdenes no se tocan.
  - Así lo pidió: «El juego propone, no decide ni reorganiza lo del jugador».
- **Esconder lo que importa:**
  - que de lejos desaparezca un ejército grande;
  - que desaparezca uno con una orden de marcha o atacar, uno en una operación o en una agrupación;
  - que desaparezca uno amenazado.
- **Lentitud en el mapa del mundo:** la pestaña Mando o Batalla que tarda en abrir, o el mapa que pierde fluidez, en la partida del jugador (342 ejércitos, 1475 en total).
- **Propuesta imposible:**
  - una línea con 190 casillas que no hay tropa para cubrir;
  - una marcha a un teatro por un camino que no existe;
  - aceptar más operaciones de las que caben en el estado mayor.

## 1. Guarniciones

### Qué es una guarnición

Se calcula cada vez, nunca se guarda: los reclutas se funden con el ejército de la ciudad, y su tamaño cambia de un turno a otro. Un ejército `a` del jugador es guarnición si se cumple todo esto:

- está asentado en una casilla de ciudad (`CITY_OF[a.cell] >= 0`) cuyo dueño es él;
- no está en el mar;
- tiene `GARRISON_MAX = 5` unidades o menos *(mi decisión: en su partida casi todas las pequeñas tienen 1–3 unidades; 5 deja margen a unos pocos reclutas sin esconder un batallón)*;
- no tiene operación (`a.op`), agrupación (`a.group`), formación (`a.form`) ni refuerzo en curso;
- no tiene orden, salvo «Mantener» (`hold`), que es lo que dejan las líneas que se repliegan (`a.from`). Una guarnición que mantiene sigue siendo guarnición;
- no hay ningún **ejército** enemigo en guerra a 2 casillas o menos. La guarnición amenazada se ve siempre. *(Mi decisión: no se usa `threat()`, que también da positivo con tierra enemiga sin ejércitos; si no, todas las guarniciones de un frente tranquilo seguirían a la vista.)*

Una función del motor, `isGarrison(a)`, lo decide. La vista, Batalla y Mando la usan todas.

### En el mapa

- **De lejos** (`far`, `hexPx < FAR_HEX`), si la casilla «Guarniciones de lejos» del panel Mapa está apagada (por defecto):
  - la guarnición no se dibuja como ficha en ninguna de las dos vistas;
  - en su lugar va una marca pequeña en la ciudad: un punto de 3 px del color del país con borde oscuro;
  - la marca no tapa el nombre de la capital ni las fichas de agrupación;
  - va en el mismo bucle de ejércitos (`MapView.draw`, junto a las reglas de lejos de las líneas 11444–11447).
- **De cerca:** todo como hoy.
- **La casilla del panel Mapa:** «Guarniciones de lejos» (encendida: fichas como hoy; apagada: marcas). Se recuerda en el dispositivo (`prefs.garrisons`, como las demás capas).
- **Al pasar el ratón sobre la ciudad:** la tarjeta dice «Guarnición: N unidades».
- **Elegir:** la guarnición se sigue eligiendo con un clic en su casilla (la elección ya es por casilla).

### En la pestaña Batalla

- **Arriba de «Sin agrupar»:** una fila plegada, «Guarniciones · N ejércitos · M unidades», con un botón para desplegarla.
- **Desplegada:** sus filas por provincia, como hoy «Sin agrupar».
- **«Sin agrupar»** ya no cuenta las guarniciones.
- **Filtros:** los de hoy (todas, en pantalla, por operación) se aplican también dentro de la fila.
- **Rendimiento:** la prueba de rendimiento de la pestaña (400 ejércitos, menos de 50 ms) sigue pasando.

## 2. Teatros

### Qué es un teatro

Un bloque conectado del territorio del jugador: las casillas de tierra que son suyas (`owner`), unidas por vecindad de tierra.

- **Bloques pequeños:** uno de 3 provincias o menos y con menos del 3 % de las casillas del jugador se suma al teatro más cercano (distancia entre sus casillas más próximas). Así una isla con una ciudad no es un teatro aparte. *(Mi decisión.)*
- **Ejércitos:**
  - un ejército en tierra pertenece al teatro de su casilla;
  - uno en el mar o en tierra ajena (ocupada en guerra, aliada), al teatro más cercano.
- **Nombre:**
  - los dos países de origen con más provincias en el teatro (`PROVINCES[i].country`) y cuántos más hay: «Brasil, Perú y 9 más»;
  - con uno solo, su nombre;
  - el de la capital del jugador lleva delante «Metrópoli: ».
- **Caché:** se recalcula con una clave de turno y versiones (`version`, `armyVersion`, `blocVersion`, `warVersion`), como `frontPlan`.

### Frontera peligrosa

En paz no hay frente (`opFront` y `lineDir` dependen de la guerra), así que se define aparte. Son las casillas del teatro con una vecina de tierra de un país que no es el jugador, ni un aliado, ni un satélite suyo, separadas por vecino.

Cada vecino tiene un peso:

| Vecino | Peso |
|---|---|
| En guerra contigo | 3 |
| Con ejércitos que ves a 3 casillas o menos de esa frontera, sin contar las guarniciones de sus ciudades (5 unidades o menos en su propia ciudad) | 2 |
| El resto | 1 |

El **peligro** del teatro es la suma, por vecino, de las casillas de frontera por su peso.

### Resumen de cada teatro

Una tarjeta por teatro en la pestaña Mando, encima de la lista de operaciones, en la sección «Teatros»:

- nombre;
- provincias;
- ejércitos (sin las guarniciones) y, aparte, «N guarniciones»;
- unidades;
- operaciones del teatro: las que tienen su punto clave (`opKey`) en él;
- frontera peligrosa por vecino, de mayor a menor, con un chip de guerra si lo está: «Egipto 194, Burkina Faso 95 (guerra)…»;
- **sin encargo:** ejércitos que no son guarnición y no tienen operación, agrupación, formación ni orden. Botón «Elegirlos»: los pone en la selección múltiple (la de Ctrl + clic) y centra el mapa en ellos;
- **«Ver»:** centra el mapa en el teatro.

### Aviso de reparto

Para cada teatro:
- `parte de tropa` = sus unidades / todas;
- `parte de peligro` = su peligro / todo el peligro.

- **Muy defendido:** el teatro con `parte de tropa > 2 × parte de peligro` y más del 20 % de la tropa.
- **Poco defendido:** el teatro con `parte de peligro > 2 × parte de tropa` y más del 20 % del peligro.

Si hay al menos uno de cada, la sección dice, por ejemplo: «Reparto descompensado: Brasil, Perú y 9 más tiene el 67 % de tus tropas y el 4 % del peligro; Marruecos, Argelia y 6 más, el 18 % de las tropas y el 92 % del peligro». Sin guerra ni vecinos peligrosos, no avisa.

## 3. «Proponer organización»

### El flujo

- **Pedirla:** el botón «Proponer organización» de cada tarjeta de teatro calcula un borrador para ese teatro.
- **Dónde se ve:**
  - en la tarjeta, como una lista de piezas;
  - en el mapa, a trazos blancos, como hoy la línea propuesta.
- **Cada pieza:** una frase con el porqué y dos botones, «Aceptar» y «Descartar».
- **Al pasar el ratón por una pieza:** se resalta en el mapa.
- **Aceptar todo:** acepta las que caben (ver «Tope»).
- **Si la partida cambia:** el borrador es estado de la interfaz, no se guarda. Si cambia la versión de la partida mientras está abierto (un turno, un movimiento), se marca «La propuesta ha cambiado» y se recalcula con un botón.

### Las piezas no comparten ejércitos *(mi decisión)*

- Cada pieza lleva la lista exacta de los ejércitos que usaría. Las piezas se calculan en orden (líneas, reserva, agrupaciones, marchas) y cada una solo toma ejércitos libres que ninguna anterior haya tomado.
- Aceptar una pieza asigna exactamente sus ejércitos. Ni barre los cercanos (`nearbyFree`) ni reparte fuerzas (`shareForces`): las operaciones, agrupaciones y órdenes que el jugador ya tiene no se tocan nunca. Las operaciones se crean con `createOp` y la asignación directa (`assignArmy`), no con `playerCreateOp`.
- Lo que cambia la propia aceptación no marca el borrador como «ha cambiado»: tras aceptar, el borrador apunta la nueva versión. Una pieza pendiente cuyos ejércitos ya no están libres (porque el jugador los movió, por ejemplo) se quita de la lista con su motivo.
- Se marca «La propuesta ha cambiado» solo si la versión cambia por otra cosa (un turno, un movimiento a mano).

### Las piezas, en este orden

1. **Líneas de defensa.**
   - **Cuántas:** como mucho 3 por teatro, para los vecinos de más peligro.
   - **Para qué vecinos:** solo los que están en guerra o tienen ejércitos visibles cerca de la frontera (peso 2 o 3). Los vecinos tranquilos (peso 1) se quedan a las guarniciones, y la tarjeta lo dice.
   - **El trazado:** sale de `frontPlan`, generalizado para la paz:
     - sin guerra, la dirección de la línea (`lineDir`) apunta hacia la tierra del vecino en vez de hacia casillas en guerra;
     - el tramo amenazado se busca con los ejércitos visibles del vecino.
   - **Si no hay tropa para cubrirla:**
     - el trazado más corto de `bestLine` deja casillas sin cubrir con los ejércitos libres del teatro;
     - la frase lo dice («faltan N ejércitos»);
     - se ofrece igual: el jugador puede mandar tropa con una marcha de la pieza 4.
   - **Sus ejércitos:** los libres del teatro más cercanos a la línea, tantos como casillas tenga, sin pasar de los que hay.
   - **Aceptar:** crea la operación de defensa (manual, asistida o automática según la postura por defecto de `createOp`), le asigna sus ejércitos y pone `op.front` si hay guerra.
2. **Reserva.**
   - **Cuántas:** una por teatro, si no tiene ya una.
   - **Dónde:** en la ciudad propia del teatro que deja en menos turnos de marcha (`orderField`) la casilla más lejana de las líneas propuestas o, sin líneas, de la frontera peligrosa.
   - **Sus ejércitos:** ninguno; la reserva los recibe luego de la retaguardia o del jugador.
   - **Aceptar:** crea la operación de reserva en esa ciudad, sin asignarle nada.
   - **La retaguardia:** si la casilla «Retaguardia» de la directiva está apagada, la frase lo dice («enciende Retaguardia para que mande aquí lo que sobra en las ciudades sin peligro»). No se enciende sola.
3. **Agrupaciones.**
   - **Qué junta:** ejércitos sin encargo (no guarniciones) que están a 2 casillas o menos unos de otros, en racimos de 3 o más.
   - **Cuántas:** como mucho 6 por teatro, las de más unidades primero.
   - **Aceptar:** `playerCreateGroup(ids)`, con su nombre automático.
4. **Marchas entre teatros.**
   - **Cuándo:** solo si el aviso de reparto marca este teatro como muy defendido y hay otro poco defendido.
   - **Qué propone:**
     - mandar las masas más grandes sin encargo, de mayor a menor;
     - cada una al teatro poco defendido con más diferencia entre su parte de peligro y su parte de tropa en ese momento (contando lo que ya va de camino en la propuesta);
     - para cuando ningún teatro esté ya poco defendido (su parte de tropa llega a la mitad de su parte de peligro) o cuando la parte de tropa de este teatro baje a 1,5 veces su parte de peligro, lo primero que pase *(mi decisión: no vacía el teatro que manda)*;
     - como mucho 6 marchas por propuesta;
     - destino: la reserva propuesta (o la existente) del teatro que la recibe, o su ciudad más cercana a su frontera peligrosa.
   - **La frase:** «Mandar 7 623 unidades de Pucallpa a Trípoli: 11 turnos, por mar», con los turnos de `pathTurns`.
   - **Sin camino:** si `orderField` no encuentra camino, la pieza no se propone.
   - **Aceptar:** una orden de marcha (`setOrder({ kind: 'march', dest })`) a cada ejército, a casillas repartidas alrededor del destino como `groupMarch`.

### Tope

- **El aviso:** la tarjeta dice cuántas operaciones caben aún en el estado mayor (`commandCap` menos las que hay).
- **Sin sitio:** las piezas que crearían una operación de más tienen el botón «Aceptar» desactivado con el motivo.
- **Aceptar todo:** se detiene en el tope, en el orden de la lista.
- Las agrupaciones y las marchas no cuentan para el tope.

### Lo que cuenta la frase de cada pieza

Cuántos ejércitos y unidades lleva, y si faltan para cubrirla. Lo que se acepta es exactamente lo que dice.

## Rendimiento

- **Caché:** teatros, frontera, sin encargo y reparto se cachean por turno y versiones.
- **Coste por turno en el mapa del mundo:** recorrer `G.land` una vez y los ejércitos del jugador una vez.
- **La propuesta:** se calcula solo al pedirla, y en la partida del jugador debe tardar menos de 1 s por teatro.
- **La pestaña Mando:** con los teatros, debe abrir en menos de 100 ms en esa partida.
- **El dibujo de lejos:** `isGarrison` no debe bajar los fotogramas de la vista del mundo (prueba de `smoke-mundo` y `smoke-vista`).
- **Banco de pruebas:** un script local (`tools/cache/inspect-save.mjs`, sin subir) carga la partida del jugador y mide estos tiempos.

## Pruebas

Un archivo nuevo, `tools/smoke-teatros.mjs`, con el mismo arnés que `smoke-mando.mjs`, con al menos estas pruebas:

- **`isGarrison`:**
  - sí: un ejército de 1–5 unidades en su ciudad, también con «Mantener»;
  - no: con más de 5 unidades, con orden de marcha, en una operación, en una agrupación, fuera de ciudad, en el mar o amenazado.
- **El dibujo:** de lejos no se llama `drawCounter` para la guarnición y sí para un ejército grande en otra ciudad. Con la casilla del panel encendida, sí para ambos.
- **Batalla:** la fila «Guarniciones» cuenta bien, está plegada y se despliega; «Sin agrupar» no las incluye.
- **Teatros:**
  - con territorio en dos bloques salen dos teatros;
  - un islote de una provincia se suma al más cercano;
  - nombre, frontera por vecino y peso de guerra correctos.
- **El aviso de reparto:** aparece con la tropa en un teatro sin peligro y el peligro en otro, y no aparece sin vecinos peligrosos.
- **La propuesta:**
  - en paz con un vecino armado propone una línea;
  - con un vecino tranquilo, no;
  - propone una reserva y agrupaciones de racimos de 3 o más;
  - la marcha entre teatros sale con camino y turnos;
  - aceptar crea la operación, la agrupación o las órdenes;
  - descartar no toca nada;
  - antes de aceptar nada, ningún ejército cambia (orden, operación, agrupación, casilla).
- **El tope:** con el estado mayor lleno, «Aceptar» de una línea está desactivado y «Aceptar todo» solo crea agrupaciones y marchas.
- **El borrador:** una pieza se resalta al pasar el ratón; tras un cambio en la partida sale «La propuesta ha cambiado».

## Lo que queda al constructor

- Colores, tamaños y texto final de tarjetas y frases, siguiendo el estilo del cajón (`.bloc`, `.chip`, `.note`) y los símbolos OTAN ya existentes.
- La estructura del borrador en el mapa: puede ampliar `ui.opPreview` a una lista de piezas o reutilizar el dibujo de `ui.proposal.ghost` para las marchas.
- Cómo se generaliza `frontPlan`/`lineDir` para la paz sin cambiar sus resultados en guerra; las pruebas de `smoke-mando` y `smoke-masas` siguen pasando.
- Las rutas exactas del README: una sección «Teatros» en «Mando estratégico» y una línea en «Mando de masas» sobre las guarniciones.
