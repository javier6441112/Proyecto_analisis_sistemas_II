# Resultados de pruebas - Proyecto 1 Microcredito

Fecha de ejecucion: 26/08/2026
Ruta del proyecto: `microcredito-p1`

## Como repetir la ejecucion

Desde PowerShell, ubicado en la carpeta `microcredito-p1`:

```powershell
npm install
npm test
npm run build
```

Es importante ejecutar los comandos dentro de `microcredito-p1`, porque el repositorio padre tiene otra configuracion de Node y TypeScript.

## Resultado real de la ejecucion

Comando ejecutado:

```text
npm test
```

Resultado:

```text
Test Files  6 passed (6)
Tests       32 passed (32)
```

Suites ejecutadas:

| Archivo | Pruebas | Resultado |
|---|---:|---|
| `tests/plan-amortizacion.test.ts` | 1 | PASO |
| `tests/calculadora-mora.test.ts` | 5 | PASO |
| `tests/prelacion-pago.test.ts` | 4 | PASO |
| `tests/cartera.test.ts` | 2 | PASO |
| `tests/contratos.test.ts` | 9 | PASO |
| `tests/credito.test.ts` | 11 | PASO |

Comando de compilacion:

```text
npm run build
```

Resultado: compilacion TypeScript estricta exitosa, sin errores.

## Entradas y resultados esperados

### 1. Plan de amortizacion francesa

Entrada:

| Dato | Valor |
|---|---:|
| Capital | Q10,000.00 |
| Tasa nominal mensual | 3.00% |
| Numero de cuotas | 12 |

La prueba compara cada fila contra la tabla del enunciado:

| Cuota | Saldo inicial | Pago | Interes | Amortizacion | Saldo final |
|---:|---:|---:|---:|---:|---:|
| 1 | 10,000.00 | 1,004.62 | 300.00 | 704.62 | 9,295.38 |
| 2 | 9,295.38 | 1,004.62 | 278.86 | 725.76 | 8,569.62 |
| 3 | 8,569.62 | 1,004.62 | 257.09 | 747.53 | 7,822.09 |
| 4 | 7,822.09 | 1,004.62 | 234.66 | 769.96 | 7,052.13 |
| 5 | 7,052.13 | 1,004.62 | 211.56 | 793.06 | 6,259.07 |
| 6 | 6,259.07 | 1,004.62 | 187.77 | 816.85 | 5,442.22 |
| 7 | 5,442.22 | 1,004.62 | 163.27 | 841.35 | 4,600.87 |
| 8 | 4,600.87 | 1,004.62 | 138.03 | 866.59 | 3,734.28 |
| 9 | 3,734.28 | 1,004.62 | 112.03 | 892.59 | 2,841.69 |
| 10 | 2,841.69 | 1,004.62 | 85.25 | 919.37 | 1,922.32 |
| 11 | 1,922.32 | 1,004.62 | 57.67 | 946.95 | 975.37 |
| 12 | 975.37 | 1,004.63 | 29.26 | 975.37 | 0.00 |

Invariantes comprobados:

- La suma de amortizaciones es exactamente Q10,000.00.
- La ultima cuota ajusta el saldo pendiente.
- El saldo final es exactamente Q0.00.

### 2. Calculo de mora

Entrada:

| Dato | Valor |
|---|---:|
| Capital en mora | Q725.76 |
| Fecha de vencimiento | 2026-08-01 |
| Fecha de corte | 2026-08-16 |
| Tasa moratoria anual | 24.00% |
| Base de conteo | Actual/360 |

Resultado esperado y obtenido:

- Dias de atraso: 15.
- Interes moratorio: Q7.26.
- El calculo usa solamente el capital en mora, no el interes corriente.

Tramos comprobados:

- 45 dias: `MORA_2`.
- 10 dias: `MORA_1`.
- 0 dias: `AL_DIA`.
- 121 dias: `INCOBRABLE`.

### 3. Prelacion de pagos

Adeudo de la cuota:

| Rubro | Monto |
|---|---:|
| Gastos | Q0.00 |
| Interes moratorio | Q7.26 |
| Interes corriente | Q278.86 |
| Capital | Q725.76 |

Pago parcial de Q500.00:

- Moratorio aplicado: Q7.26.
- Interes corriente aplicado: Q278.86.
- Capital aplicado: Q213.88.
- Cuota saldada: no.

Pago de Q3,000.00:

- Cuota saldada: si.
- Excedente a favor del cliente: Q1,988.12.

Orden comprobado: gastos, moratorio, interes corriente y capital.

### 4. Cartera en riesgo

Cartera de referencia:

| Credito | Saldo | Dias de atraso | Estado | En riesgo |
|---|---:|---:|---|---|
| C-001 | Q620,000.00 | 0 | VIGENTE | No |
| C-002 | Q124,000.00 | 8 | VIGENTE | No |
| C-003 | Q24,000.00 | 45 | VIGENTE | Si |
| C-004 | Q18,000.00 | 75 | VIGENTE | Si |
| C-005 | Q8,000.00 | 100 | VIGENTE | Si |
| C-006 | Q6,000.00 | 0 | REESTRUCTURADO | Si |
| C-007 | Q15,000.00 | 210 | INCOBRABLE | Excluido |

Resultado esperado y obtenido:

- Cartera activa: Q800,000.00.
- Saldo en riesgo: Q56,000.00.
- Porcentaje de riesgo: 7.00%.

Despues de declarar C-005 como incobrable:

- Cartera activa: Q792,000.00.
- Saldo en riesgo: Q48,000.00.
- Porcentaje de riesgo: 6.06%.

## Matriz de cumplimiento del walking skeleton E4

| Requisito | Estado | Evidencia |
|---|---|---|
| TypeScript con `strict: true` | Cumple | `tsconfig.json` y `npm run build` |
| Sin `any` en el dominio | Cumple | Archivos en `src/dominio/` |
| Dinero sin punto flotante | Cumple | `Dinero` usa `decimal.js` |
| Redondeo half-up por cuota | Cumple | `Dinero` redondea a 2 decimales |
| Plan frances y ajuste final | Cumple | `plan-amortizacion.test.ts` |
| Mora sobre capital en mora | Cumple | `calculadora-mora.test.ts` |
| Fechas recibidas como parametros | Cumple | `calcularMora(vencimiento, corte, ...)` |
| Prelacion de pagos | Cumple | `prelacion-pago.test.ts` |
| Cartera en riesgo | Cumple | `cartera.test.ts` |
| Servidor o base de datos | No incluido | Correctamente fuera del alcance E4 |

## Observacion de alcance

Las pruebas anteriores verifican el nucleo de calculo solicitado. El ciclo de vida completo de `Credito` y una prueba ejecutable que rechace un pago para un credito `SOLICITADO` no estan modelados todavia como una clase de dominio; por tanto, ese requisito del enunciado debe implementarse antes de afirmar que todo el Proyecto 1 esta cubierto al 100%.
