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

- `POST /creditos/{creditoId}/pagos`: registra pagos con `Idempotency-Key` obligatorio y desglose de prelacion.
- `GET /cartera-riesgo?fechaCorte=AAAA-MM-DD`: calcula cartera en riesgo con fecha de corte obligatoria.

Todos los importes viajan como `{ valor: "100.00", moneda: "GTQ" }`. Los errores usan `application/problem+json`.
