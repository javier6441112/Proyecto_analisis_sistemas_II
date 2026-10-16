# Provisiones de Crédito Vecino

Decisión del equipo para la institución ficticia Crédito Vecino, en el marco de P1 §6 y §6.1. Estos porcentajes son una política académica institucional elegida por el equipo; no se atribuyen al docente ni a una regulación.

| Clasificación | Reserva |
| --- | --- |
| Vigente sin atraso (`AL_DIA`) | 1 % |
| Mora 1 | 5 % |
| Mora 2 | 20 % |
| Mora 3 | 50 % |
| Vencido | 100 % |

Los reestructurados usan el mayor entre el porcentaje del tramo y 20 %. Se reutilizan los límites existentes: 0, 1–30, 31–60, 61–90 y 91–120 días. La clasificación `INCOBRABLE` para más de 120 días no demuestra una baja: mientras siga activo se aplica el porcentaje de vencido. El dato explícito `dadoDeBaja` distingue la baja efectiva; solo se acepta para estado `INCOBRABLE`. Los cancelados y los incobrables dados de baja se excluyen, con base, porcentaje aplicado y provisión cero en el detalle.

La base es exclusivamente el saldo de capital pendiente al corte. No incluye intereses, gastos ni moratorios. Cada provisión se redondea a dos decimales, medio hacia arriba, mediante `Dinero`; el total suma los importes individuales ya redondeados. Se rechazan saldos negativos, monedas mezcladas, identificadores repetidos y días de atraso inválidos. Una cartera vacía devuelve cero GTQ.

La configuración independiente está en `configuracion/provisiones/credito-vecino-v1.json`, fuera de los datos canónicos. Incluye versión, vigencia desde 2026-01-01 (decisión del equipo para este ejercicio), institución, autor y motivo. La fecha final opcional es inclusiva; su ausencia indica vigencia abierta. Los porcentajes se expresan como cadenas decimales en unidades porcentuales (por ejemplo, `"20"` significa 20 %). Cambiar una política requiere conservar la versión anterior y crear otro archivo con nueva versión y vigencia.

`validarPoliticaProvisiones(datos)` valida la configuración cargada por el consumidor. `calcularProvisiones(politica, fechaCorte, creditos)` recibe la política aplicable y la fotografía de créditos correspondiente al corte explícito `AAAA-MM-DD`; comprueba su vigencia sin consultar el reloj. La correspondencia de los saldos, estados y días de atraso con el corte es responsabilidad del consumidor. Devuelve fecha de corte, versión utilizada, base, porcentaje y provisión por crédito, y total. El cálculo no carga archivos, no selecciona automáticamente políticas ni accede a persistencia. En esta etapa no se integra con contabilidad, API, interfaz ni chat.
