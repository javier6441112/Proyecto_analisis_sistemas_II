---
doc_id: POL-COBRO-01
titulo: Gestión de cobro, gasto de gestión y prelación de pagos
vigencia: créditos otorgados desde el 1 de octubre de 2026 (gasto de gestión)
---
# Gestión de cobro y prelación de pagos

## Gasto de gestión de cobro
Es el cargo por la visita del asesor al domicilio o negocio del cliente con una cuota vencida. Es un servicio efectivamente prestado. El monto es Q25.00 fijos por cuota vencida.

- Se genera una sola vez por cuota vencida, cuando esa cuota llega a 31 días de atraso (entrada a Mora 2).
- No se cobra en Mora 1.
- No se genera de nuevo al pasar a Mora 3 o a Vencido, ni al volver a ejecutar un cierre del mismo día.
- Aplica a los créditos otorgados desde el 1 de octubre de 2026 (política POL-2026-10). Los créditos con política plana no lo generan.

## Prelación de pagos
Un pago se aplica en este orden, y cada rubro consume lo que le corresponde y pasa el remanente al siguiente:
1. Gastos y comisiones.
2. Interés moratorio.
3. Interés corriente.
4. Capital.

## Pagos repetidos
Cada pago lleva una clave de idempotencia. Registrar dos veces el mismo pago con la misma clave no cambia el saldo.

## Total exigible de una cuota
Gastos + moratorio + interés corriente + capital. Ejemplo con la política escalonada y 45 días de atraso sobre una cuota de capital Q725.76 e interés Q278.86: 25.00 + 18.14 + 278.86 + 725.76 = Q1,047.76.
