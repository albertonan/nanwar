# Ejércitos por mar: embarcar, navegar y desembarcar

Fecha: 2026-10-20 · Afecta a: el motor (movimiento, combate, niebla, desgaste, órdenes, mando e IA), la interfaz y las dos vistas. Casi todo está en `index.html`; el dibujo, también en `vista-realista.js`. Completa el diseño de aviación (`2026-10-20-aviacion-design.md`), que dejaba fuera la marina.

## Por qué

El jugador quiso, en el mapa del mundo, atacar desde España a Marruecos y llevar un ejército de España a Canarias, y el juego no le dejó. Hoy:
- un ejército puede cruzar casillas de mar, pero tiene que volver a tierra en el mismo turno (`reach`: «hay que poder desembarcar»). Canarias está a 15 casillas de mar de la península: no se llega nunca;
- no se puede atacar desde el mar (`tryAttack` exige salir de tierra): una costa con un ejército enemigo no se puede asaltar. El Estrecho es una sola casilla de mar, así que lo que falla ahí es el asalto.

Lo que pide, con sus palabras: «se tiene que poder mover por agua, haz que se embarquen, donde serán muy débiles, y fácilmente atacables por aviones, a menos que lleven antiaéreo. Pero se tiene que poder transportar y atacar desde mar».

Cómo se ve el éxito: el jugador embarca un ejército en Cádiz, lo ve navegar unos 3 turnos como una pieza en el mar y desembarca en Canarias. Otro ejército cruza el Estrecho y asalta la costa marroquí, con un precio alto si está defendida. Mientras navega, un ejército es un blanco tentador: si el enemigo lo pilla en el mar, lo pierde casi entero.

## Dos piezas, en este orden

1. **Agua** (este documento, partes 1 a 6): embarcar, navegar, desembarcar, asalto anfibio y debilidad en el mar. Se publica sola, antes que la aviación.
2. **Aviación** (diseño de aviación, parte B), que se construye después. La parte 7 de este documento dice qué añade al agua.

Las marcas significan:
- **(Usuario)**: lo decidió el jugador en la conversación.
- **(Propuesta)**: lo propuse yo y el jugador no lo rechazó, pero tampoco lo pidió.
- **(Decisión mía)**: una decisión razonable que el constructor puede afinar.

Los números son de partida y se ajustan probando.

---

## 1 · Embarcar

- **(Usuario)** Un ejército puede entrar en el mar y quedarse en él varios turnos, como una pieza visible en el mapa.
- **(Propuesta)** Se embarca desde cualquier casilla de tierra propia o aliada que toque el mar, sin necesidad de puerto ni de ciudad.
- **(Propuesta)** Embarcar gasta lo que le quede de movimiento: el ejército puede andar por tierra hasta la costa y entrar en la casilla de mar vecina, y ahí se detiene ese turno. El turno siguiente ya navega.
- **(Usuario)** **Excepción, el cruce corto:** si del otro lado hay tierra a una sola casilla de mar (Gibraltar en el mundo), el ejército cruza en el mismo turno, como hoy: entra en el mar y desembarca o asalta (con el ×0,5 de la parte 3) sin quedarse en el agua, siempre que le quede movimiento para ello, igual que exige hoy `reach`. Si no le queda, se queda embarcado en esa casilla. Los cruces de dos casillas de mar o más sí se quedan en el mar entre turnos.
- **(Decisión mía)** Embarcan todos los tipos de tropa, sin límite de tamaño. Una casilla de mar admite un solo ejército, como una de tierra; dos ejércitos propios que coinciden se unen como en tierra (`settle`).
- **(Decisión mía)** «Mar» es toda casilla sin provincia (`!isLand`). Los lagos son tierra y siguen como hoy.

## 2 · Navegar

- **(Propuesta)** En el mar, todos los ejércitos van a la misma velocidad, sea cual sea su tropa: **6 casillas por turno** en los dos mapas, igual que las velocidades de tierra se cuentan en casillas y no en kilómetros. España–Canarias en el mundo son unos 3 turnos en el mar; Baleares en Europa, uno. **(Decisión mía)** No se mide en kilómetros: 500 km serían 25 casillas en Europa, seis veces la infantería, y la costa se volvería una autopista.
- **(Decisión mía)** Las casillas de mar con un ejército ajeno cortan el paso; no hay zona de control en el mar.
- **(Decisión mía)** Un ejército embarcado no presiona la tierra: no hace zona de control sobre las casillas de costa (`zoc`), no cuenta como lado enemigo para rodeado o cercado ni para frenar la marcha (`hostileSides`, `moveBudget`) y no sirve de apoyo contra «aislado» (`isolated`). Si no, un barco barato aparcado frente a la costa bloquearía y rodearía a quien está en tierra. Un ejército embarcado no conquista nada ni tiene suministro, y las reglas de desgaste de tierra (aislado, sin carretera, sin víveres) no se le aplican: ya tiene su propio castigo (parte 4).
- **(Decisión mía)** Se puede quedar en el mar los turnos que quiera.

## 3 · Desembarcar y asalto anfibio

- **(Usuario)** Se tiene que poder atacar desde el mar.
- **(Propuesta)** Desembarcar es entrar en una casilla de tierra vecina sin ejército: propia, aliada o de un enemigo en guerra (y entonces la toma, como hoy). Desembarcar gasta lo que le quede del turno, como hoy.
- **(Propuesta)** **Asalto anfibio:** un ejército embarcado puede atacar a un ejército enemigo en una casilla de tierra vecina. El atacante tiene **×0,5**, porque es el ataque más difícil. Se suma a todo lo demás: terreno, ciudad y fortificación del que defiende. Si gana, entra en la casilla como en un ataque de tierra; si pierde, se queda en el mar con sus bajas.
- **(Decisión mía)** Un ejército que ya empezó el turno embarcado puede navegar y desembarcar, o navegar y asaltar, en el mismo turno, siempre que llegue a la casilla de mar vecina con movimiento de sobra.

## 4 · Débil en el mar

- **(Usuario)** Embarcado es muy débil.
- **(Propuesta)** Un ejército embarcado defiende con **×0,25** y no tiene bono de terreno, ciudad ni fortificación.
- **(Propuesta)** Quién puede atacarlo:
  - un ejército de tierra en una casilla de costa vecina, desde la orilla;
  - otro ejército embarcado en una casilla de mar vecina, que ataca también con ×0,5.
- **(Decisión mía)** Un ejército de tierra que gana desde la orilla se queda en la orilla: no embarca al ganar. Un ejército embarcado que gana contra otro barco tampoco se mueve.
- **(Decisión mía)** Si un ejército embarcado pierde un combate, se retira a una casilla de costa vecina propia o aliada, si la hay. Si no la hay, **se hunde con todos sus supervivientes**. Esto es lo que lo hace un blanco tentador. Hoy `retreatCell` ya solo busca tierra y, sin sitio, los supervivientes se rinden; aquí el parte dice «hundido».
- **(Decisión mía)** El ejército embarcado que ataca (asalto o contra otro barco) también tiene su ×0,5 al atacar, no el ×0,25, que es solo para defender.

## 5 · Mando, órdenes e IA

- **(Propuesta)** Las órdenes de marcha y las operaciones pueden tener un destino al otro lado del mar. El camino embarca, navega y desembarca solo, a lo largo de varios turnos. Hoy `orderField` ya cuenta el mar al triple para preferir la tierra; se mantiene, con la nueva velocidad en el mar.
- **(Propuesta)** Una operación que lleva varios ejércitos por mar los hace desembarcar a la vez siempre que pueda, para no dejar uno solo en la playa.
- **(Propuesta)** La IA:
  - lleva ejércitos por mar a objetivos que no puede alcanzar por tierra, como islas o la otra orilla de un estrecho;
  - no deja ejércitos en el mar al alcance de un enemigo en la orilla o en el agua si puede evitarlo;
  - ataca los ejércitos embarcados enemigos que tenga a tiro, porque son presa fácil;
  - defiende sus costas e islas amenazadas por un ejército en el mar.
- **(Decisión mía)** La IA no se queda parada si no sabe ir por mar: un objetivo sin camino sigue descartándose como hoy.

## 6 · Interfaz y vista

- **Símbolos (regla del proyecto):** nada inventado.
  - **(Decisión mía)** En la vista sencilla, la ficha OTAN del ejército embarcado pasa al marco de unidad de superficie marítima de APP-6 (un círculo en el caso propio), con su mismo símbolo dentro.
  - En la vista realista, la miniatura va sobre un barco de transporte en lugar de la peana.
- **Mover:** al elegir un ejército en la costa, las casillas de mar vecinas se ofrecen como destino («Embarcar»). Embarcado, se ofrecen las casillas de mar a su alcance y las de costa donde puede desembarcar o asaltar.
- **Ficha y tarjeta:** «Embarcado: defensa ×0,25». La previsión de combate y el parte incluyen «Asalto anfibio ×0,5», «Embarcado ×0,25» y el riesgo de hundirse si pierde sin costa propia al lado.
- **Parte:** «Hundido frente a X: se pierden N unidades».
- **Animación:** el ejército navega casilla a casilla, como hoy anda por tierra.
- **Niebla:** un ejército en el mar se ve con las mismas reglas que en tierra: lo ve quien tenga esa casilla a la vista, y su tipo y su número solo con Reconocimiento 2 o un espía. Para el espía cuenta la provincia de la costa más cercana. **(Decisión mía)**
- **Ayuda y README:** entrada nueva con las reglas del mar.
- **Móvil:** todo cabe en la hoja inferior de tres tamaños.

---

## 7 · Lo que añade la aviación cuando llegue

Se construye con la aviación, no en la pieza del agua. Se anota también en el diseño de aviación.

- **(Usuario)** En el mar, un ejército es fácilmente atacable por aviones.
  - **(Propuesta)** La misión «Atacar ejército» contra un ejército embarcado le quita el doble de unidades.
  - **(Propuesta)** El ejército embarcado no cuenta con el antiaéreo fijo de ninguna casilla de tierra.
- **(Usuario)** Salvo que lleve antiaéreo.
  - **(Propuesta)** El antiaéreo móvil (Defensa aérea 3) protege también en el mar, con su eficacia normal. Un convoy con antiaéreo aguanta mucho mejor.
  - **(Propuesta)** Hasta tener antiaéreo móvil, la protección de un convoy son los escuadrones propios con la misión «Proteger casilla» sobre la casilla de mar.
- **(Propuesta)** El mando puede asignar escuadrones a escoltar los ejércitos de una operación que va por mar.

---

## Restricciones

- Todo vive en `index.html` y `vista-realista.js`, sin dependencias nuevas.
- Funciona igual en los dos mapas, con la misma velocidad en el mar en casillas.
- Las partidas guardadas siguen cargando. Una partida guardada nunca tiene ejércitos en el mar, porque hoy no pueden quedarse en él.
- La niebla de guerra es obligatoria: el mar no puede enseñar lo que el jugador no debería saber.
- El rendimiento del mapa y de los turnos de la IA no puede empeorar de forma apreciable (`tools/perf-mapa.mjs` y los tiempos de `tools/smoke-mundo.mjs`). El mar tiene unas 58 000 casillas en el mundo, más que la tierra: los cálculos de camino no deben recorrerlo entero para cada ejército de tierra que no se acerca a la costa.
- Lleva sus pruebas en el navegador, al estilo de `tools/smoke-*.mjs` (`tools/smoke-agua.mjs`), y el README se actualiza.
- Al terminar, se publica una versión nueva (`tools/release.mjs`) en `main`, antes de empezar la aviación.

## Fuera de alcance

- Buques de guerra, flotas, portaaviones y submarinos: en el mar solo hay ejércitos embarcados.
- Puertos, capacidad de transporte o coste por embarcar.
- Bloqueos y comercio marítimo.
- Corrientes, tormentas o casillas de mar con distinto coste.

## Lo que sería un fracaso aunque funcione

- Que no se pueda ir a Canarias o asaltar Marruecos sin trucos.
- Que el mar sea una autopista sin riesgo: un ejército embarcado debe ser presa fácil.
- Que asaltar una costa defendida y fortificada sea tan fácil como atacar por tierra.
- Que la IA no sepa usar el mar, o que deje sus ejércitos hundiéndose uno tras otro.
- Que los turnos de la IA en el mapa del mundo se vuelvan mucho más lentos.
- Símbolos inventados.

## Preguntas resueltas en la revisión

- **Cruce corto:** una sola casilla de mar se cruza en un turno, como hoy, también para asaltar (parte 1).
- **Presión desde el mar:** un barco no hace zona de control ni rodea a nadie en tierra (parte 2).
- **Velocidad:** 6 casillas por turno en los dos mapas, no en kilómetros (parte 2).
- **Ganar desde la orilla:** el de tierra no embarca al ganar (parte 4).

## Queda en manos del constructor

- El ajuste de las cifras marcadas como decisión mía o propuesta.
- Cómo marcar en el estado del juego que un ejército está embarcado (basta con que su casilla sea de mar, si sirve).
- La forma exacta del barco en la vista realista y del marco en la sencilla, dentro de los símbolos reales.
- La estrategia exacta de la IA en el mar.
