# Contrato API

El contrato se define una sola vez mediante esquemas Zod en `src/contratos/` y se genera en:

- `docs/api/openapi.json`
- `docs/api/openapi.yaml`

## Comandos

```powershell
npm run generar
npm run validar
npm run typecheck
npm test
```

`openapi.yaml` y `openapi.json` son artefactos generados: no se editan manualmente. Para cambiar el contrato se modifica Zod y se ejecuta `npm run generar`.

## Operaciones

- `POST /clientes`: registra un cliente.
- `POST /solicitudes-credito`: registra una solicitud de credito.
- `POST /creditos/{creditoId}/desembolso`: desembolsa un credito aprobado.
- `GET /api/cierres/{periodo}`: consulta una vista previa (`PREVIA`) sin cerrar, o devuelve el resultado definitivo guardado (`EJECUTADO`) sin recalcular.
- `POST /api/cierres/{periodo}/ejecucion`: solo Gerencia; guarda el cierre definitivo o devuelve el existente de forma idempotente por período. Ambos casos responden 200.
- `POST /creditos/{creditoId}/pagos`: registra pagos con `Idempotency-Key` obligatorio y desglose de prelacion.
- `GET /cartera-riesgo?fechaCorte=AAAA-MM-DD`: calcula cartera en riesgo con fecha de corte obligatoria.

Todos los importes viajan como `{ valor: "100.00", moneda: "GTQ" }`. Los errores usan `application/problem+json`.

El contrato ejecutable de cierres está en `src/contratos/api.ts`. Conserva las cifras anteriores, estado, corte, operador y políticas utilizadas, e incorpora `provisiones`, `contabilizacionProvisiones` y `devengo`. Este último separa apertura, flujos del período y suspenso final. El esquema conceptual antiguo de `src/contratos/cierres.ts` no describe esta ruta: su campo plano `interesesDevengados` no sustituye el objeto `devengo` real. Véanse [devengo corriente](../devengo-corriente.md) y [ADR-003](../adr/ADR-003.md) para históricos, cronología y restricciones de retroactividad.
