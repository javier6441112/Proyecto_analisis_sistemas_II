# Provisiones de Crédito Vecino

Decisión del equipo para la institución ficticia Crédito Vecino, en el marco de P1 §6 y §6.1. Estos porcentajes son una política académica institucional elegida por el equipo; no se atribuyen al docente ni a una regulación.

| Clasificación | Reserva |
| --- | --- |
| Vigente sin atraso (`AL_DIA`) | 1 % |
| Mora 1 | 5 % |
| Mora 2 | 20 % |
| Mora 3 | 50 % |
| Vencido | 100 % |

Los reestructurados usan el mayor entre el porcentaje del tramo y 20 %. Se reutilizan los límites existentes: 0, 1–30, 31–60, 61–90 y 91–120 días. Los estados `CANCELADO` e `INCOBRABLE` quedan siempre excluidos de la cartera activa y de provisiones, con base, porcentaje aplicado y provisión cero. El indicador anterior `dadoDeBaja` se conserva por compatibilidad y no puede reactivar un incobrable. Para los demás estados se conserva la clasificación por atraso; cuando el tramo por días supera 120 se utiliza el porcentaje de vencido, sin cambiar el estado recibido.

La base es exclusivamente el saldo de capital pendiente al corte. No incluye intereses, gastos ni moratorios. Cada provisión se redondea a dos decimales, medio hacia arriba, mediante `Dinero`; el total suma los importes individuales ya redondeados. Se rechazan saldos negativos, monedas mezcladas, identificadores repetidos y días de atraso inválidos. Una cartera vacía devuelve cero GTQ.

La configuración independiente está en `configuracion/provisiones/credito-vecino-v1.json`, fuera de los datos canónicos. Incluye versión, vigencia desde 2026-01-01 (decisión del equipo para este ejercicio), institución, autor y motivo. La fecha final opcional es inclusiva; su ausencia indica vigencia abierta. Los porcentajes se expresan como cadenas decimales en unidades porcentuales (por ejemplo, `"20"` significa 20 %). Cambiar una política requiere conservar la versión anterior y crear otro archivo con nueva versión y vigencia.

`validarConfiguracionProvisiones(datos)`, en `src/contratos/provisiones.ts`, valida con Zod la forma del archivo externo y delega las invariantes al dominio. El dominio define sus propios tipos y `validarPoliticaProvisiones(politica)`, sin depender de Zod, archivos, adaptadores ni contratos; el cálculo también ejecuta estas validaciones de negocio en llamadas directas. La dependencia va de contratos hacia dominio, sin ciclos. `calcularProvisiones(politica, fechaCorte, creditos)` recibe la política aplicable y la fotografía de créditos correspondiente al corte explícito `AAAA-MM-DD`; comprueba su vigencia sin consultar el reloj. Devuelve fecha de corte, versión utilizada, base, porcentaje y provisión por crédito, y total. El cálculo puro no carga archivos ni accede a persistencia.

## Integración en el cierre mensual

La capa externa `src/configuracion/provisiones.ts` lee los archivos JSON de `configuracion/provisiones`, valida su forma e invariantes y selecciona la política que cubre el corte explícito. Las fechas finales son inclusivas. Se rechazan versiones duplicadas, vigencias superpuestas (incluso en su límite) y cortes sin política; un error impide ejecutar un cierre nuevo, sin sustituirlo por cero. Para una nueva versión se debe cerrar la vigencia anterior sin superponer fechas. La opción `provisionesDir` del adaptador permite usar un catálogo independiente en pruebas sin tocar la configuración institucional.

El adaptador reconstruye saldos de capital, estados y días de atraso al último día del mes solicitado y entrega esa misma fotografía al cálculo puro. La vista previa mensual incluye `provisiones` con estado `DISPONIBLE`, total, detalle por crédito, fecha, versión y copia completa de los parámetros. No se suman estas reservas a recuperaciones, intereses cobrados ni cartera bruta. Los cierres diarios indican `NO_DISPONIBLE` porque esta incorporación es mensual.

Al ejecutar el cierre definitivo, el resultado completo y los parámetros de provisiones se guardan en la instantánea existente `cierres_ejecutados`. Consultar o repetir ese período devuelve el original antes de leer la configuración actual o reconstruir créditos, también después de reiniciar. Cambios posteriores en pagos o en el catálogo no alteran el cierre guardado.

Un cierre histórico sin el campo se presenta como `NO_DISPONIBLE`: «Provisiones no disponibles en esta versión del cierre histórico». Es una adaptación de lectura, sin calcular, sobrescribir el JSON original ni inventar un cero. El contrato también acepta la ausencia para consumidores de formatos anteriores y exige interpretarla como no disponible.

La API `GET /api/cierres/{periodo}` y `POST /api/cierres/{periodo}/ejecucion` exponen el mismo resultado tipado. La consulta MCP `consultar_cierre` entrega al chat el total, el detalle y los parámetros, con las mismas reglas para históricos. La pantalla y el modelo de lenguaje presentan los valores del servidor y no calculan provisiones.

Para comprobarlo: en Gerencia → Cierres, seleccionar **Mensual**, elegir por ejemplo **2026-10** y pulsar **Consultar período**. La sección **Provisiones de cartera al corte** muestra reserva, política, vigencia y detalle desplegable con base, porcentaje y provisión. **Ejecutar cierre definitivo** congela el resultado; **Reejecutar comprobación** verifica que siga idéntico. Para un cierre antiguo aparece la indicación de no disponibilidad.

Pendientes expresos: no se generan movimientos contables de provisiones ni devengo de intereses. Esta etapa incorpora únicamente el resultado y su trazabilidad en el cierre; los intereses mostrados entre recuperaciones siguen siendo los efectivamente cobrados.
