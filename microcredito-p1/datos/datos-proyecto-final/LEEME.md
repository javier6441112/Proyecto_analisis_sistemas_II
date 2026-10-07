# Paquete de datos canónico — Proyecto Final (037)

Crédito Vecino, S. A. · Análisis de Sistemas II · Segundo semestre 2026

## Qué es esto y por qué existe

Este paquete es **la cartera de Crédito Vecino al 31 de octubre de 2026**: 60 clientes,
75 créditos y 228 pagos ya ocurridos. Es el punto de partida de su sistema.

Existe por una razón concreta: si cada grupo inventara sus propios datos, la pregunta
"¿cuál es la cartera en riesgo?" tendría 12 respuestas distintas y ninguna sería
verificable. Con todos los grupos cargando **exactamente los mismos datos**, cada
pregunta de gerencia tiene **una sola respuesta correcta**, que el docente calculó
por separado y compara contra lo que se ve en el video.

No es un requisito burocrático: es lo que hace que su proyecto se pueda calificar
de forma objetiva.

## Qué debe hacer con él

1. **Cargarlo completo y sin modificar** en su base de datos, mediante un cargador
   que usted escriba (entregable E2). Es una carga masiva de una sola vez.
2. **Verificar la huella SHA-256** de `eventos.jsonl` contra `eventos.sha256` al
   cargar, y mostrar esa verificación en el video.
3. **No editarlo a mano nunca más.** Todo lo que ocurra después de la carga debe
   entrar por su interfaz, no por SQL.

## Archivos

| Archivo | Contenido |
|---|---|
| `eventos.jsonl` | **Fuente de verdad.** Bitácora de eventos, un JSON por línea, en orden cronológico. La cartera se reconstruye reproduciendo estos eventos. |
| `eventos.sha256` | Huella criptográfica de `eventos.jsonl`. Sirve para probar que cargó los datos correctos y sin alterar. |
| `clientes.csv` | Vista tabular de los eventos `CLIENTE` (60 filas). |
| `creditos.csv` | Vista tabular de los eventos `DESEMBOLSO` (75 filas). |
| `pagos.csv` | Vista tabular de los eventos `PAGO` (228 filas). |
| `asesores.csv` | Catálogo de asesores de crédito (6 filas). |
| `politicas.json` | Parámetros de política de mora, versionados por fecha de otorgamiento. **Son datos, no constantes de código** (P1 6.3.1, P2 7.2). |
| `corpus/*.md` | Documentos de dominio para la ingesta del RAG (7 documentos). |

Las vistas CSV contienen exactamente la misma información que `eventos.jsonl`.
Use la que le convenga según su estrategia de ingesta; si usa las CSV, la huella
SHA-256 se calcula igualmente sobre `eventos.jsonl`.

## Contrato de datos

Un objeto JSON por línea. Tres tipos de evento:

```
CLIENTE      id_cliente, nombre_completo, dpi, telefono, municipio, fecha_alta
DESEMBOLSO   id_credito, id_cliente, id_asesor, fecha, capital_centavos,
             plazo_meses, tna_bps, reestructurado
PAGO         clave_idempotencia, id_credito, fecha, monto_centavos, canal
```

Reglas del contrato:

- **El dinero es un entero en centavos** (`capital_centavos`, `monto_centavos`).
  Nunca un número de punto flotante.
- **Las tasas son puntos básicos** (`tna_bps`): 3600 = 36 % nominal anual.
- **Las fechas son AAAA-MM-DD.**
- Los pagos con `clave_idempotencia` repetida **se ignoran** (P1 6.10).
- El campo `seq` es el orden de reproducción de la bitácora.

## Sobre el corpus

Siete documentos de dominio para el RAG. Seis son políticas y manuales normales.

El séptimo, `NOTA-CAMPO-07.md`, es una nota de cobranza en borrador que contiene
**instrucciones ocultas dirigidas a la IA**. Está ahí a propósito: es el caso de
prueba de seguridad del video (OP-7). Su asistente debe tratarla como dato, no
como una orden.

## Rango de fechas

Todos los eventos están entre el **14 de enero de 2026** y el **31 de octubre de
2026**. No hay eventos posteriores: la cartera está "congelada" en esa fecha, y
todo lo que ocurra después lo genera usted operando el sistema.
