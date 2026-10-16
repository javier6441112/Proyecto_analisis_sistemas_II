# Devengo corriente por competencia

## Política académica versionada

Decisión del equipo para la institución ficticia Crédito Vecino, no una fórmula impuesta por el docente ni una disposición regulatoria: distribuir el **interés contractual de cada cuota del plan** entre los días reales de su período. El período va del desembolso o vencimiento anterior al vencimiento de esa cuota, excluyendo el inicio e incluyendo el final. No se usan tasas ni importes moratorios para calcular interés corriente.

Para cada cuota, el acumulado al corte es su interés contractual multiplicado por los días transcurridos limitados al período, dividido por sus días reales, redondeado a dos decimales, medio hacia arriba. El devengo entre cortes es la diferencia de esos acumulados ya redondeados. Al vencimiento el acumulado coincide exactamente con el interés del plan. Las diferencias telescópicas hacen que subdividir el intervalo conserve el importe; no se redondea un cociente diario independiente para multiplicarlo después. Por ejemplo, Q0.03 en dos días se distribuyen Q0.02 y Q0.01.

`configuracion/devengo/credito-vecino-v1.json` conserva versión `CV-DEV-1.0`, vigencia, autor, motivo, convención y umbrales P1/P2 (91 y 121 días). La vigencia inicial desde 2020 permite reconstruir los préstamos históricos del ejercicio. La selección se hace por la **fecha explícita de desembolso**, como política contractual de toda la vida del crédito, no por el reloj ni por la fecha de cobro. Los catálogos ambiguos, incompletos o inválidos se rechazan. Al contabilizar se conserva la asignación por crédito y la copia de política; posteriores versiones se aplican a nuevos otorgamientos, y los créditos contabilizados siguen usando su copia original. No se deben borrar las versiones anteriores.

El núcleo puro `src/dominio/devengo.ts` recibe cuotas, fechas, eventos y política; usa `Dinero` y no conoce Zod, archivos, persistencia ni reloj real. El adaptador reutiliza el plan francés y los pagos deduplicados del núcleo existente para reconstruir su entrada. Las validaciones externas pertenecen a contratos/configuración.

## Orden cronológico, suspensión y terminación

Se reconstruye el atraso de la cuota pendiente más antigua, respetando pagos completos en su orden estable. Desde el día 91 el nuevo devengo se envía a suspenso, sin ingreso. La suspensión permanece hasta que el crédito quede **sin atraso**, como la reactivación existente en P1/P2; un pago que solo reduzca el atraso por debajo de 91 no libera el suspenso.

Orden institucional para eventos del mismo día:

1. Baja explícita, o automática al día 121 de atraso, antes de devengar o cobrar. Es consistente con la reconstrucción actual: los cobros posteriores a baja son recuperaciones, no reactivaciones.
2. Devengo del día según el estado al inicio. El día 91 ya es suspenso. La cancelación al final del día incluye ese día, pero nunca días posteriores.
3. Pagos en orden de la historia del núcleo (desempate estable por identificador en la entrada pura), saldando la cuota más antigua.
4. Si ya no existe atraso, reconocimiento de todo el suspenso por cuota, una sola vez, en esa fecha de regularización. El movimiento `REGULARIZACION` reduce el suspenso y aumenta el ingreso, sin volver a generar interés.
5. Cancelación si todas las cuotas quedaron pagadas, o cancelación explícita. Una cancelación después de pago total reconoce primero el suspenso regularizado. Si una cancelación explícita no regulariza el crédito, el suspenso restante se retira sin ingreso.

La baja retira el suspenso con `RETIRO_SUSPENSO`, sin reconocerlo como ingreso ni revertir ingreso anterior. Se conserva la trazabilidad de ese retiro. Después de cancelar o dar de baja no hay devengo nuevo. El tratamiento de cobros anticipados no cambia la deuda ni anticipa automáticamente ingreso contractual futuro: se reconoce lo ganado hasta la cancelación. No se implanta un módulo nuevo de reprogramación de planes o tratamiento contable de anticipos.

## Registro y cierres diarios/mensuales

Las tablas aditivas e inmutables `movimientos_devengo`, `cortes_devengo` y `aperturas_devengo` guardan movimientos positivos por crédito/cuota, intervalo, fecha contable, concepto, importe, cierre, origen, usuario y política completa. Los conceptos separan `DEVENGO` (ingreso corriente ordinario), `SUSPENSO`, `REGULARIZACION` y `RETIRO_SUSPENSO`. El identificador diario estable y la restricción única impiden reconocer dos veces el mismo hecho.

La vista previa reconstruye el objetivo sin escribir filas. La ejecución definitiva calcula contra el registro dentro de la misma transacción nativa que guarda el cierre y los movimientos de provisiones. Un error revierte todos ellos, incluida una apertura nueva. Se usan el bloqueo transaccional y la exclusión mutua existentes. No se modifican pagos, deuda, intereses exigibles, datos canónicos ni cartera bruta.

El mensual **consolida** los movimientos con fecha contable dentro del mes, incluidos los registrados por cierres diarios, y completa solo los faltantes. Por ejemplo, un diario del 15 de enero registra el día y la apertura previa; el mensual de enero informa el total de enero y añade únicamente los días aún no registrados. Los totales diario y mensual son ventanas que se solapan y no deben sumarse como si fueran asientos distintos. La tabla de movimientos es la fuente para sumar ingreso sin duplicaciones.

La respuesta `devengo` muestra, separadamente:

- `periodo.generado`: interés contractual generado dentro del período.
- `periodo.ingresoReconocido`: devengo ordinario más suspenso reconocido por regularización dentro del período.
- `periodo.enviadoSuspenso` y `periodo.suspensoRegularizado`.
- `periodo.suspensoRetirado`: baja/cancelación sin ingreso.
- `saldoFinalSuspenso` = suspenso de apertura + enviado − regularizado − retirado.

Los intereses **cobrados** permanecen en `recuperaciones.interesCorriente`. Cobrar interés ya devengado no añade ingreso al registro de devengo. El modelo de lenguaje y la interfaz solo presentan los importes del servidor.

## Apertura histórica y cierres anteriores

En la primera nueva ejecución se reconstruye el devengo desde los planes y los pagos disponibles, validados por el adaptador, hasta el corte. Los hechos anteriores al inicio del período se incorporan con origen `APERTURA`, sus fechas históricas y el cierre que documentó su incorporación; **no son ingreso del período actual**. `aperturas_devengo` identifica la fecha anterior al período, usuario, cierre, motivo de reconstrucción y huella de fuentes. En cada respuesta, `apertura` distingue generado, reconocido y suspenso anteriores de los movimientos del período. En ejecuciones posteriores esos saldos son reconstruibles desde movimientos ya guardados.

Esta es una apertura explícitamente identificada como **reconstruida**, no una presunción de saldo cero ni una importación de cifras que no existían en cierres antiguos. Supone que los planes y pagos cargados constituyen la historia completa del ejercicio. Si faltan eventos o hay una conciliación externa distinta, se requiere revisar esa historia antes de contabilizar: no se admite editar los saldos del registro para disimular diferencias. La conciliación manual con contabilidad externa queda fuera de esta etapa.

Los cierres definitivos anteriores se devuelven sin recalcular. Si no tenían `devengo`, la lectura añade «Devengo no disponible en esta versión del cierre histórico», sin escribir en el JSON original ni inventar ceros. Repetir su ejecución devuelve ese mismo cierre y no lo migra silenciosamente. La apertura de provisiones continúa siguiendo su procedimiento independiente; no se elude su conciliación histórica.

## Cronología, retroactividad y límites

Se permite ejecutar diario y mensual para la misma fecha final: el segundo consolida y no duplica movimientos. Una nueva ejecución no puede terminar antes del último corte de devengo contabilizado. Por ello, se debe consolidar un mes antes de avanzar a un corte del mes siguiente si se quiere guardar ese mensual. Consultar un cierre definitivo anterior continúa permitido.

Las huellas de planes, políticas asignadas y eventos hasta el último corte detectan pagos retroactivos, préstamos insertados con fecha pasada y modificaciones del plan. Se rechaza la nueva contabilización si cambió esa historia, incluso si todavía no cambió el importe del devengo. Los cierres antiguos siguen intactos. La vista previa indica no disponible y explica la conciliación requerida. El sistema de cobros previo no se bloquea globalmente: si admite una operación retroactiva, la siguiente contabilización de devengo exige resolverla. No se implementan aquí asientos automáticos de corrección ni reapertura de períodos cerrados.

Las regularizaciones, cancelaciones y bajas que hoy persiste la aplicación se derivan de los pagos y la regla de antigüedad del núcleo. La función pura también acepta eventos explícitos; no se agregan nuevas rutas para reestructuraciones con cambio de plan ni para cancelaciones administrativas. No hay un catálogo de cuentas de partida doble ni conciliación bancaria nueva en esta etapa.

## Comprobación manual y evidencia

En una base de pruebas, abrir **Gerencia → Cierres**, seleccionar **Diario** o **Mensual** y pulsar **Consultar período**. **Devengo de interés corriente** presenta las cinco cifras solicitadas y el retiro sin ingreso, separadas de recuperaciones. Desplegar **Apertura e historia anterior** para comprobar que no se atribuye todo el histórico al período, y **Movimientos del período** para ver crédito, cuota, intervalo, concepto, cierre y versión.

Ejecutar primero un diario intermedio y después el mensual de ese mismo mes. Verificar en el detalle que los movimientos del diario mantienen su cierre original y que solo se añaden los faltantes. **Reejecutar comprobación** debe devolver el resultado guardado. Para el chat, pedir el devengo del mismo período: MCP entrega las mismas cifras y versiones, sin volcar miles de movimientos en el contexto del modelo; el detalle completo está en API/pantalla.

Las pruebas independientes cubren meses de distinta duración, extremos, cortes parciales, diferencias de acumulados y redondeo; días 90–100, pagos parciales del atraso, regularización, cancelación y baja; apertura histórica, reinicio, concurrencia, rollback conjunto y combinación diario/mensual. Las bases usadas por las pruebas son temporales. Las limitaciones anteriores se documentan como pendientes y no como funcionalidades probadas.
