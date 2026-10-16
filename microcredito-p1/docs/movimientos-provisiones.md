# Movimientos de provisiones del cierre mensual

Decisión académica del equipo para Crédito Vecino: la reserva es un saldo por crédito. Cada cierre definitivo registra **variación = objetivo al corte − saldo anterior reconstruido**. Q100 anteriores y Q150 objetivo constituyen Q50; Q150 anteriores y Q120 objetivo reducen Q30 (importe −Q30). Un objetivo sin cambio no genera filas. Si un crédito deja de estar en el objetivo, su objetivo es cero y se libera su reserva anterior. Se conservan la política versionada, las exclusiones de cancelados e incobrables y el redondeo del cálculo puro.

El registro de provisiones no modifica deuda, cuotas, capital, pagos, intereses ni cartera bruta. Se presenta separado de recuperaciones e intereses cobrados. **No se implementa devengo de intereses**. Los movimientos son el registro auxiliar de reservas; no se introduce aquí un plan de cuentas de partida doble ni se vuelve a imputar el objetivo completo como gasto mensual.

## Registro, atomicidad y trazabilidad

Las tablas aditivas `aperturas_provisiones` y `movimientos_provisiones` no alteran el paquete canónico. La apertura conserva origen, fecha contable, cierre de referencia, usuario y motivo. Cada movimiento conserva identificador, crédito, período, cierre, fecha contable explícita, importe con signo, concepto (`APERTURA`, `CONSTITUCION` o `REDUCCION`), usuario, versión y copia de los parámetros de la política. La fecha contable es el último día del período correspondiente; no se consulta el reloj.

Los saldos se reconstruyen sumando movimientos por crédito hasta la fecha recibida, incluyendo las aperturas y sin consumir movimientos futuros. Una fecha anterior a la apertura se identifica como no disponible, nunca como saldo cero confirmado. Las lecturas del registro usan una transacción para mantener juntos saldos y detalle.

La vista previa mensual sigue mostrando el objetivo y no escribe apertura, cierre ni movimientos. Solo la ejecución definitiva contabiliza variaciones. La apertura histórica es una acción separada y explícita: incorpora saldos ya existentes, no gasto nuevo. El cierre y sus movimientos se guardan en una sola transacción nativa; un fallo revierte también la apertura inicial que se hubiera creado en esa transacción. Hay exclusión mutua de operaciones en el adaptador, bloqueo de tablas dentro de la transacción, claves deterministas y restricciones únicas. Repetir o ejecutar concurrentemente el mismo período devuelve el cierre original antes de generar movimientos nuevos.

Los registros son acumulativos. Triggers rechazan `UPDATE` y `DELETE` en aperturas y movimientos; no se ofrece una ruta que los sobrescriba. `contabilizacionProvisiones` dentro del nuevo cierre definitivo contiene apertura, saldo anterior, variación, saldo final y los movimientos con sus identificadores. Los cierres históricos conservan exactamente su JSON original: su falta de este campo significa que esa versión no tenía contabilización asociada, no que la reserva objetivo fuera cero.

## Saldo inicial y apertura histórica

1. **Sin ningún cierre mensual histórico:** la primera ejecución registra explícitamente una apertura `CERO_SIN_HISTORICOS`, con el usuario que ejecutó el cierre, la fecha de corte y el motivo «Primera ejecución mensual sin cierres históricos: saldo inicial cero». Esta es la convención institucional para empezar el registro; la reserva objetivo de ese primer cierre se constituye contra ese cero documentado. Una cartera vacía también registra la apertura aunque no genere movimientos monetarios.
2. **Con cierres mensuales anteriores sin registro de movimientos:** no se presume saldo cero. Se bloquea la siguiente ejecución hasta que Gerencia confirme la apertura desde el **último cierre mensual definitivo** mediante `POST /api/provisiones/apertura`, con `periodoCierre` y un `motivo` no vacío. Se importan sus provisiones individuales congeladas (comprobando su suma), con concepto `APERTURA`, fecha y política originales. No se recalculan reservas históricas ni se modifica ese cierre. La apertura no representa un gasto adicional.
3. **Histórico sin detalle de provisiones:** se rechaza la apertura automática y se exige conciliación documental. Esta versión no permite introducir saldos manuales sin respaldo, fabricar un cero o reconstruir silenciosamente una política antigua. El procedimiento para registrar saldos conciliados cuando falta el detalle histórico queda pendiente; hasta resolverlo no puede continuarse la contabilización en esa base.

Solo existe una apertura por registro. Repetir exactamente su cierre de referencia, usuario y motivo es idempotente; intentar sustituirla se rechaza. No se puede escoger un histórico anterior para saltarse uno posterior ni volver a importar reservas ya contabilizadas. La importación histórica queda trazada en el registro consultable; el cierre antiguo continúa inmutable.

## Cronología elegida y limitaciones

Los nuevos cierres mensuales deben avanzar estrictamente respecto del último cierre mensual definitivo y de la apertura. Se rechaza un período nuevo anterior o igual al último, en vez de reabrir cierres posteriores o tomar saldos futuros. Repetir un cierre que ya existe siempre devuelve su resultado original, sin añadirle movimientos aunque sea anterior a esta funcionalidad. Los cierres diarios no registran variaciones de provisiones y no condicionan la secuencia mensual.

Se permiten meses omitidos: el siguiente cierre ajusta contra el último saldo contabilizado. No se prorratea ni se inventan movimientos de meses faltantes. Una vista previa puede consultarse para cualquier período soportado por su política, pero esto no garantiza que pueda ejecutarse fuera de orden. Las correcciones retroactivas, la reapertura y los ajustes de saldos históricos requieren un procedimiento posterior; no se alteran aquí los cierres congelados.

## API, pantalla y comprobaciones

`GET /api/provisiones?fechaCorte=AAAA-MM-DD` expone apertura, movimientos y saldos reconstruidos sin escribir. `POST /api/provisiones/apertura` requiere Gerencia, usuario y motivo. No se habilita apertura desde el modelo de lenguaje. La consulta MCP existente del cierre expone también `contabilizacionProvisiones` cuando pertenece a esa versión.

En **Gerencia → Cierres → Mensual**, consultar muestra el objetivo. Tras **Ejecutar cierre definitivo**, la sección **Movimientos de provisiones del cierre** muestra saldo anterior, variación, saldo final y detalle. **Consultar registro de provisiones al corte** permite seguir los movimientos acumulados y la apertura. Un histórico con detalle ofrece **Abrir provisiones desde este histórico** y exige motivo; el servidor comprueba que sea el último y que aún no exista apertura. El formulario no calcula importes ni modifica la instantánea histórica.

Las pruebas usan bases temporales y comprueban +Q50, −Q30, ausencia de movimientos sin variación, reconstrucción por fecha, reinicio, concurrencia, rollback, inmutabilidad, apertura histórica, rechazo de cortes fuera de orden, permisos de Gerencia y conservación de la deuda. Los datos canónicos y la base habitual no se modifican.
