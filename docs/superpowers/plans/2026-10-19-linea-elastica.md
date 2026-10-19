# Línea elástica y reparto de esfuerzos — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Las líneas de defensa evalúan su sector cada turno y se repliegan juntas a posiciones de ventaja; las propuestas y la IA eligen líneas con superioridad; varias operaciones se reparten reclutas y ejércitos a la vez.

**Architecture:** Todo en `index.html` (motor `GameEngine` y UI), como el resto del mando. Funciones nuevas del motor junto a la sección «Operaciones»: evaluación de franja, búsqueda de línea, máquina de estados de la defensa y reparto. La UI solo lee lo que el motor guarda en la operación.

**Tech Stack:** JavaScript en un solo HTML; pruebas en Playwright con `tools/smoke-mando.mjs` (se ejecuta desde la carpeta padre: `node basicmilitary/tools/smoke-mando.mjs [filtro]`).

**Spec:** `docs/superpowers/specs/2026-10-19-linea-elastica-design.md`

## Global Constraints

- Umbral de repliegue: relación < 1. Umbral de vuelta: ≥ 1,5. Fuerza enemiga a 3 casillas de la línea.
- Repliegue: cada búsqueda a 2 turnos de marcha del miembro más lento; total ≤ 4 turnos de marcha desde `drawn`; nunca deja la capital por delante.
- Propuesta: tramo con ejércitos enemigos a ≤ 3 casillas de la frontera, ±2 casillas de margen; búsqueda a ≤ 3 casillas de la frontera.
- La guarnición mínima es la regla de `detach` (una infantería o la primera unidad).
- El mínimo de una línea (cubrir sus casillas y relación ≥ 1) nunca se cede.
- Textos en español, con el tono de los mensajes existentes; símbolos según APP-6.
- Partidas antiguas: `drawn = cells`, `state = 'aguanta'`, `from = 0`.
- Coste: turno de IA en «Caos total» ≤ +10 % sobre la referencia medida antes del cambio.

## Review Focus

- Línea de una sola casilla o de dos: la franja y la búsqueda no deben fallar ni devolver líneas vacías → prueba en Task 2.
- Operación sin miembros que se repliega: no debe lanzar ni moverse; solo pedir ayuda → prueba en Task 3.
- Frente donde el enemigo no tiene ejércitos a la vista (niebla): relación nula → aguanta → prueba en Task 1.
- Capital en la franja: nunca queda por delante tras repliegues encadenados → prueba en Task 3.
- Partida guardada en mitad de un repliegue: estado, `drawn` y `from` vuelven igual → prueba en Task 1.

---

### Task 1: Evaluación de la franja y datos nuevos

**Files:** Modify `index.html` (sección Operaciones, `createOp`, `serialize`, `load`, `changeOwner`). Test: `tools/smoke-mando.mjs`.

**Interfaces — Produces:**
- `lineBand(op) → Set<cell>`: casillas de la franja (entre los extremos de `drawn ∪ cells`, 3 por delante, profundidad máxima por detrás). Caché por `turn` + `cells`.
- `lineEval(op, cells = op.cells, members = this.opMembers(op)) → { own, enemy, rel: number|null, breach: boolean }`. `own` = Σ def de miembros × bonificación de la casilla de la línea más cercana (la de `combatFactors`, terreno+ciudad+capital+fortificación con tope, contra un atacante sin río). `enemy` = Σ atk de ejércitos enemigos visibles en la franja a ≤ 3 de la línea (con niebla, el escalón de `expectedRatio`). `rel = enemy ? own/enemy : null`.
- `defBonus(owner, cell) → number`: la bonificación estática de una casilla.
- Op de defensa: `drawn`, `state` ('aguanta'|'repliega'|'restablece'), `rel`. Army: `from` (id de operación o 0).

- [ ] Step 1: pruebas `L1 · la franja y la relación de una línea` (línea en llanura con 2 infanterías propias y 3 tanques enemigos delante → `rel < 1`; sin enemigos → `rel === null`, `breach === false`; enemigo dueño de una casilla de la línea → `breach`; enemigo en el otro extremo del país → no `breach`) y `L1 · drawn, state y from se guardan y se cargan` (y partida sin esos campos → `drawn` = `cells`, `state` = 'aguanta').
- [ ] Step 2: ejecutarlas, fallan.
- [ ] Step 3: implementar; `createOp` pone `drawn = cells` y `state = 'aguanta'`; `changeOwner` pone `from = 0`.
- [ ] Step 4: pasan, y las 48 anteriores también.
- [ ] Step 5: commit.

### Task 2: Búsqueda de línea

**Interfaces — Consumes:** `defBonus`, `lineEval`. **Produces:**
- `bestLine(owner, enemy, { ends: [cellA, cellB], forces: army[], ref: cell[], depth: subpuntos, keep?: cell[] }) → { cells, rel, ok: rel >= 1, cover: cells.length <= forces.length, front: cityCell[] } | null`.
  Camino de coste mínimo por casillas propias de la franja (distancia de marcha desde `ref` ≤ `depth`) entre un punto cerca de `ends[0]` y uno cerca de `ends[1]`; coste de casilla `1 / defBonus` (más 0,5 si no hay río hacia el lado enemigo). Se prueban hasta 4 profundidades (0, ⅓, ⅔ y 1 de `depth`); `ref` (profundidad 0) siempre es candidata. Puntuación lexicográfica: `ok`, `cover`, media de `defBonus`, ciudades detrás − ciudades delante, cercanía a `ref`. `keep` (la capital) debe quedar en la línea o detrás.

- [ ] Step 1: pruebas `L2 · la búsqueda prefiere colinas o montaña cercanas a la llanura de la frontera` (busca en el mapa un tramo de frontera llano con colinas/montaña a ≤ 3 casillas; la línea elegida tiene `defBonus` medio mayor que la frontera), `L2 · sin fuerzas para todo, una línea más corta` (`cover`), `L2 · línea de 1 o 2 casillas no falla`.
- [ ] Step 2: fallan.
- [ ] Step 3: implementar, acotado (nunca más de la franja; `MinHeap` como `marchCosts`).
- [ ] Step 4: pasan.
- [ ] Step 5: commit.

### Task 3: Estados de la línea (aguanta, repliega, restablece), guarniciones y cortados

**Interfaces — Consumes:** Task 1 y 2. **Produces:** `defenseStep(op, free, tally)` llamado desde la rama `defensa` de `executeOp`; `defenseHint(op) → { state, cells, rel }` sin efectos (para manual y la UI).

Reglas (del spec): decide estado → aguanta (lo de ahora; contraataca solo si la previsión ≥ `op.ratio` y la relación de la franja tras el ataque sigue ≥ 1); repliega (no ataca; nueva línea con `bestLine` con `ref = op.cells`, `ends` detrás de los extremos, `depth = 2 turnos` del más lento, límite total 4 turnos desde `drawn`, `keep` capital; si la mejor es la actual → aguanta con aviso); restablece (si `lineEval(op, op.drawn)` ≥ 1,5 → `cells = drawn`, retoma con ataques a `op.ratio`). Guarniciones: miembro en ciudad propia por delante de la nueva línea → `detach`, la parte que queda: `op = 0`, `from = op.id`, orden `hold`. Cortados: sin camino seguro en 2 turnos → rodeado: ataque con previsión ≥ 1 hacia la línea; si no, ciudad/montaña/colina propia más cercana, `hold`, `from`. Al restablecer, los `from === op.id` que quedan en la línea o detrás vuelven (`op = op.id`, sin `hold`), salvo la última unidad de una ciudad.

- [ ] Step 1: pruebas `L3 · rota en llanura, se repliega junta a las colinas`, `L3 · la ciudad que queda delante conserva guarnición con orden de mantener`, `L3 · en inferioridad no contraataca aunque una casilla dé 1,8`, `L3 · con refuerzos vuelve a la línea dibujada y no pasa de ella`, `L3 · sin vaivén entre 1 y 1,5`, `L3 · rodeado rompe el cerco o se refugia`, `L3 · nunca deja la capital por delante`, `L3 · sin miembros no falla`, `L3 · manual y asistida no cambian la línea sin confirmar`.
- [ ] Step 2: fallan.
- [ ] Step 3: implementar.
- [ ] Step 4: pasan todas (incluida «F2 · una línea de defensa se cubre empezando por lo más amenazado»).
- [ ] Step 5: commit.

### Task 4: Propuestas, aviso e IA

**Interfaces — Produces:** `frontPlan(id, e)` devuelve `line` desde `bestLine` sobre el tramo amenazado (Global Constraints) y `lineInfo: { label, rel, front }`; aviso en el parte una vez por frente y guerra (`nation.command.warned`, guardado). `aiCommand` usa `plan.line` (ya nueva). Botón «Línea propuesta» con la línea de información; vista previa en el mapa al pasar el ratón (`ui.opPreview`).

- [ ] Step 1: pruebas `L4 · la línea propuesta cubre solo el tramo amenazado y busca terreno`, `L4 · aviso de frente sin línea una sola vez`, `L4 · la IA crea su línea con la búsqueda`; actualizar «F4 · propuestas para un frente nuevo» al texto nuevo.
- [ ] Step 2–4: fallan → implementar → pasan.
- [ ] Step 5: commit.

### Task 5: Reparto de esfuerzos

**Interfaces — Produces:** `stepReinforcements(id)` por rondas (orden por `priorityOf × (1 + opNeed)`; cada ronda, una unidad por operación); `reinforce(op)` se parte en `reinforceTurn(op)` (fondo, marchas, fin de formación) y `recruitOne(op) → boolean`. `opMinimum(op) → number` (defensa: max(casillas, ejércitos para rel ≥ 1); ofensiva en marcha: todos; pausa y reserva: 0). `shareForces(id)`: al empezar las operaciones de cada turno (antes de `executeOps`) y al crear una op, reparte por rondas libres → reserva → sobrante de líneas → ofensivas en pausa a las que piden, a ≤ `OP_GATHER_TURNS`; parte «X cede n ejércitos a Y». `aiCommand` llama a `shareForces`. Ficha de ofensiva sin fuerzas: «… necesita todas sus tropas; esperando reclutas (n en camino)».

- [ ] Step 1: pruebas `R · línea formándose y ofensiva nueva reciben reclutas el mismo turno`, `R · la ofensiva recibe el sobrante de la línea sin bajarla de su mínimo`, `R · sin sobrante no quita nada y lo dice`, `R · dos ofensivas que piden reciben las dos`.
- [ ] Step 2–4: fallan → implementar → pasan, con «F3 · los refuerzos…» y «F2 · sin ventaja espera…».
- [ ] Step 5: commit.

### Task 6: Interfaz y parte

Mapa: si `cells ≠ drawn`, `drawn` en discontinuo tenue y flecha corta de repliegue (APP-6, «withdraw») del centro de `drawn` al de `cells`; en manual, la línea de `defenseHint` como sugerencia discontinua. Ficha de defensa: estado y medidor de relación como el de la ofensiva, con marcas en 1 y 1,5. Parte: una línea por decisión con motivo (textos del spec).

- [ ] Step 1: prueba `L6 · ficha y mapa de una línea replegada` (la ficha muestra «Se repliega» y la relación; el dibujo no lanza).
- [ ] Step 2–4.
- [ ] Step 5: commit.

### Task 7: Rendimiento, README y publicación

- [ ] Medir antes y después 20 turnos de IA en el mundo «Caos total» (script en el scratchpad con Playwright, igual que `smoke-mundo.mjs`); comparar con el límite de +10 %.
- [ ] README «Mando estratégico»: línea que se repliega, propuesta por tramo y reparto.
- [ ] Todas las pruebas (`smoke-mando`, `smoke-mundo`, `smoke-research`, `smoke-vista`).
- [ ] `node tools/release.mjs`, commit «…; versión nueva», push.
