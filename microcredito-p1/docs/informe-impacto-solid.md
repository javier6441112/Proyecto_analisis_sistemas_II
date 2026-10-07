# Informe de impacto SOLID — núcleo financiero Crédito Vecino

**Alcance:** correcciones determinables a partir de las observaciones docentes recibidas y de la documentación/código existente en el repositorio. No se ha consultado ni se afirma haber consultado un enunciado del Proyecto 2 que no está disponible.

## 1. Base y métricas verificables

Base comparada: commit P1 `398353e626acd1f9c5b8c3829b8cf2231a3b6c19` (`Reforzar invariantes financieras`). Las métricas se obtuvieron del diff real de `microcredito-p1/src/dominio` entre esa base y el árbol de trabajo actual, no de una estimación manual:

| Métrica del dominio | Resultado del diff |
|---|---:|
| Archivos agregados | 8 |
| Archivos P1 modificados | 1 (`src/dominio/credito.ts`) |
| Líneas añadidas | 463 |
| Líneas eliminadas | 9 |
| Cambio neto | +454 líneas |
| Motor previo `calcularMora` de P1 modificado | No |
| Pruebas heredadas de P1 modificadas | 0 |

La extensión añade las políticas y componentes de cartera al árbol comparado; las correcciones de esta tarea modifican sobre todo `credito.ts` y la familia `politica-mora/`. “Motor previo sin modificar” se refiere exclusivamente a `src/dominio/calculadora-mora.ts`, no a que el núcleo completo permanezca intacto.

## 2. Evidencia de implementación y comportamiento

### Mora y desglose — CP-04.3

El contrato común expone tanto el cálculo monetario como su desglose. La estrategia escalonada conserva para cada tramo recorrido los días, tasa diaria e importe decimal sin redondear; solo redondea el total al producir `totalMoratorio`:

```ts
const tasaDiaria = tramo.tasaNominalAnual.div(360);
const devengo = capitalEnMora.valor.times(tasaDiaria).times(diasEnEsteTramo);
totalSinRedondear = totalSinRedondear.plus(devengo);
detalleTramos.push({ tramo: tramo.nombre, dias: diasEnEsteTramo, tasaNominalAnual: tramo.tasaNominalAnual, tasaDiaria, importeSinRedondear: devengo });
```

Evidencia: `src/dominio/politica-mora/politica-mora.ts` y `src/dominio/politica-mora/politica-escalonada.ts`. El cálculo mantiene Actual/360, los tramos hasta el día 120 y deja de acumular días después de ese límite. La política plana usa 24%/360; la escalonada usa 18%, 24%, 30% y 36% nominal anual por tramo. El cálculo moratorio usa únicamente el capital en mora.

### Suspensión de interés corriente — CP-04.2

`Credito.registrarDevengoInteresCorriente(periodoId, importe)` registra una sola vez cada período: mientras el crédito está suspendido, el importe va a `interesEnSuspenso`, no al acumulado reconocido ni al adeudo exigible. `Credito.calcularAdeudoCuota(...)` integra esta clasificación al flujo del núcleo y exige un identificador estable del corte. `Credito.regularizar(...)` reactiva el devengo, transfiere el acumulado de suspenso al reconocido, vacía la cuenta de orden y devuelve el importe reconocido en esa operación. Una segunda reactivación no vuelve a reconocerlo. Los acumuladores internos conservan `Decimal`; esta capa no redondea el devengo recibido. Los valores `Dinero` de salida siguen la representación monetaria general del núcleo.

La búsqueda de archivos del repositorio y del directorio del curso no encontró el enunciado P1 (PDF/DOCX). El código P1 disponible sí muestra que el plan francés calcula el interés de cuota multiplicando el saldo inicial por la tasa ordinaria mensual en `src/dominio/plan-amortizacion.ts`; no define el cálculo prorrateado entre dos cortes arbitrarios, sus días de inicio/fin ni la política de redondeo para ese devengo. Por tanto, la nueva operación recibe el importe del período ya calculado por el llamador y **no deriva fórmula, base ni redondeo**. Esta parte de CP-04.2 permanece pendiente hasta localizar el enunciado P1 o confirmar esas reglas con el docente.

La prueba usa importes de ejemplo para verificar la clasificación, idempotencia y transferencia contable; dichos valores no son una especificación de la fórmula financiera.

### Cartera EN RIESGO por tramo — CP-04.3 (§7.8)

`resumirCartera(...)` expone `riesgoPorTramo` desde el núcleo con saldo y proporción sobre cartera activa. Se separa `REESTRUCTURADO_AL_DIA` y el resto se clasifica por días de atraso. La prueba canónica verifica Q24,000 en MORA_2 (3.00%), Q18,000 en MORA_3 (2.25%), Q8,000 en VENCIDO (1.00%) y Q6,000 reestructurado al día (0.75%): Q56,000 / Q800,000 = 7.00%. La versión previa del núcleo devolvía solo totales en `ResumenCartera`; no exponía ese desglose.

### Retroactiva comparativa — no adoptada

`PoliticaRetroactiva` aplica a todos los días la tasa anual asociada al tramo vigente al corte, dividida entre 360. Oráculo M-3: `Q725.76 × 0.36 / 360 × 100 = Q72.576`, redondeado a Q72.58. El catálogo de `src/dominio/politica-mora/catalogo-politicas.ts` sigue resolviendo únicamente plana o escalonada por fecha de otorgamiento; no registra la retroactiva para créditos reales. La prueba comparativa ejercita las tres políticas con resultados diferenciados.

### Gasto de gestión

`GastoGestionCobroService` usa la identidad crédito/cuota, genera el cargo una vez al alcanzar 31 días, expone por separado lo generado y el saldo pendiente, y disminuye el saldo al recibir el pago. La política concreta se valida contra `POL-2026-10`; repetir el corte o cruzar a otro tramo no crea otro cargo. `Credito.calcularAdeudoCuota(...)` lo integra al adeudo que consume la prelación.

El registro es en memoria y vive con la instancia del crédito; el repositorio no incluye persistencia, que está fuera del alcance solicitado. No se afirma idempotencia tras reconstruir una instancia desde almacenamiento inexistente.

### M-5 y prelación

`Credito.calcularAdeudoCuota(...)` construye el adeudo usando el moratorio calculado, el gasto pendiente y los importes corrientes/capital recibidos para la cuota. La prueba M-5 verifica la suma del núcleo: Q25 + Q18.14 + Q278.86 + Q725.76 = **Q1,047.76**. El importe esperado solo está en la prueba. También comprueba que un pago parcial consume en orden gastos → moratorio → interés corriente → capital.

## 3. Evaluación SOLID basada en código

### SRP — Responsabilidad única: parcial, con fricción

La clasificación/cálculo por política está en `politica-escalonada.ts`; la regla y registro de cargos está en `gasto-gestion-cobro.ts`. Son separaciones observables de responsabilidades. Sin embargo, `Credito` sigue concentrando ciclo de vida, saldos, pagos y composición del adeudo (`calcularAdeudoCuota`); no es correcto afirmar que cada clase tenga una única razón de cambio. Separar un servicio de adeudos sería una evolución posible, no parte de esta corrección.

### OCP — Abierto/cerrado: favorecido, no absoluto

`PoliticaMora` permite que plana, escalonada y retroactiva suministren su propio desglose y total, y el cliente opera sobre el contrato. La retroactiva compara alternativas sin alterar el motor P1. No obstante, el catálogo versionado debe editarse para adoptar una nueva política real y añadir el método `desglosar` al contrato obliga a actualizar implementaciones existentes. OCP se cumple por estrategia en el cálculo, no para toda selección/configuración del sistema.

### LSP — Sustitución de Liskov: consistente en el contrato probado

Las tres políticas implementan `PoliticaMora`, validan entradas equivalentes y devuelven `DesgloseMora`/`Dinero` en la misma moneda. Las diferencias monetarias son deliberadas por la política, no violaciones de sustitución. `tests/contrato-politica.test.ts` ejercita las tres y sus oráculos. La prueba no demuestra por sí sola todas las propiedades posibles ni formaliza una especificación exhaustiva del contrato.

### ISP — Segregación de interfaces: parcial

`Adeudo` agrupa solo los cuatro rubros consumidos por la prelación, y `PoliticaMora` expresa las operaciones de política financiera. Como contrapartida, el contrato de política combina metadatos y operaciones de cálculo/desglose, y `Credito` expone una API de ciclo de vida amplia. No hay interfaces de puertos por caso de uso en esta entrega; el diseño no justifica afirmar cumplimiento pleno de ISP.

### DIP — Inversión de dependencias: parcial

`Credito` conserva la política de mora como abstracción (`PoliticaMora`), y los consumidores calculan por ese contrato. Pero `Credito` resuelve política mediante el catálogo concreto y crea directamente `GastoGestionCobroService`; no recibe esas dependencias por constructor ni por puerto. La inyección de dependencias y sustitución del registro quedan como puntos de fricción.

## 4. Evidencia de validación

Ejecución desde `microcredito-p1/`:

- `npm test`: **12 archivos aprobados, 52 pruebas aprobadas**.
- `npm run typecheck`: **correcto**, `tsc --noEmit` con `strict: true`.
- Las suites heredadas del P1 se mantuvieron intactas; las expectativas revisadas corresponden únicamente a pruebas del comportamiento agregado P2 (entre ellas el resultado retroactivo, que antes era idéntico a la plana).

## 5. Limitación pendiente

El destino del suspenso al regularizar ya está implementado. Solo queda pendiente confirmar el cálculo del importe de interés corriente devengado entre cortes; no se encontró el enunciado P1 y los documentos de dominio disponibles no resuelven esa fórmula.

Preguntas abiertas que deben confirmar el docente:

1. ¿Cuál es la base del interés corriente durante cada intervalo: saldo de capital vigente, capital de cuota u otra base?
2. ¿Cómo se deriva la tasa del período desde `tasaOrdinariaMensual` y `baseDias`, y qué convención define si el día inicial/final del corte cuenta?
3. ¿Cuándo y con qué precisión se redondean los importes reconocidos y los trasladados a suspenso?
4. ¿El devengo entre cortes aplica la tasa mensual contractual directamente sobre el saldo inicial de la cuota, o el enunciado P1 especifica otra base/prorrateo?

La transferencia al regularizar no espera aclaración adicional: está definida por la regla aportada para P2. El cálculo entre cortes sigue **pendiente**; no se presenta CP-04.2 como completamente cerrado mientras falten su fórmula, período y redondeo.
