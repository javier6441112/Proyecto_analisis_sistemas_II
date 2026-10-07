# E2 — Persistencia y carga canónica

Implementado sobre eb072dc5ce2d241cfac393c1d1ac7e9d74fb7b47, conservando las correcciones del núcleo publicadas por el equipo.

## Decisión técnica
PGlite (PostgreSQL embebido) con pgvector. Una misma base local conserva clientes, créditos, pagos, políticas y documentos; la tabla de fragmentos permite almacenar vectores del RAG futuro. No requiere instalar PostgreSQL ni Docker.
Referencias oficiales: https://pglite.dev/docs/api y https://pglite.dev/extensions/.

## Ejecutar desde microcredito-p1 en PowerShell
```powershell
npm install
$env:CV_DATA_DIR = (Resolve-Path .\datos\datos-proyecto-final).Path
$env:CV_DB_DIR = Join-Path $PWD.Path '.cv-db'
npm run cargar:datos
```
`CV_DATA_DIR` debe señalar la carpeta que contiene eventos.jsonl, NO el ZIP ni su carpeta padre. Es obligatoria; no está incrustada en el cargador.
`CV_DB_DIR` determina la base persistente; su valor predeterminado es .cv-db en el directorio de ejecución.
.env.example es una referencia: no se carga automáticamente. Usa las variables PowerShell de arriba.
Utiliza Node.js 22 LTS como pide el enunciado. npm y los scripts se ejecutan dentro de microcredito-p1, no en la raíz del repositorio.

## Evidencia esperada
- SHA-256 verificado en verde.
- Clientes: 60; créditos: 75; registros de pago: 228; eventos: 363.
- Pagos aplicables: 226; registros repetidos ignorados: 2.
Repite npm run cargar:datos: debe indicar «Carga ya registrada: sin duplicados» y conservar los conteos.

## Dos claves repetidas del paquete original
IDEM-000068 e IDEM-000127 aparecen dos veces cada una con los mismos datos.
No se modifica el paquete. La tabla pagos conserva los 228 registros y marca aplicado=false en las dos repeticiones. Un índice único parcial impide más de un pago aplicable por clave. Al reconstruir saldos o cierres, consume SOLO pagos WHERE aplicado=true; usar los 228 como efectos monetarios duplicaría cobros.
La palabra aplicado identifica elegibilidad por idempotencia en la ingesta; este cargador todavía no calcula ni contabiliza la prelación financiera.

## Qué carga
- eventos.jsonl en orden seq, validado con Zod; los CSV de clientes/créditos/pagos son vistas y no se cargan nuevamente.
- asesores.csv para satisfacer las referencias.
- politicas.json sin convertir las tasas en nuevas constantes de dominio.
- Los siete documentos del corpus, íntegros, incluida NOTA-CAMPO-07. Solo se guardan como texto; no se ejecutan instrucciones.
- esquema de fragmentos/vector vacío, preparado para E4. No se generan embeddings todavía.

## Integridad
La huella se compara antes de insertar. Luego una transacción crea el esquema y carga todo, con rollback si hay cualquier error. Fechas reales, centavos enteros seguros, tasas en puntos básicos, secuencia y referencias se validan. La primera carga exige cartera vacía.
Una marca de carga y un manifiesto de huellas para eventos, asesores, políticas y corpus permiten detectar cambios en archivos ya cargados. Una repetición no borra nuevas operaciones realizadas por la futura aplicación.
Los conteos canónicos se filtran por carga_id: siguen siendo 60/75/228 aunque la aplicación registre un cliente o crédito adicional.

## Tablas
cargas_canonicas, asesores, clientes, creditos, pagos, eventos_canonicos, parametros_politicas, documentos_rag y fragmentos_rag.
Dinero almacenado en bigint como centavos y tasa en integer como puntos básicos. No hay cálculos monetarios en SQL.
Las tablas operativas no guardan estados calculados de mora: el núcleo debe producirlos para la fecha de corte solicitada.

## Pruebas
```powershell
npm test
npm run typecheck
```
La suite nueva tests/carga.test.ts comprueba conteos, centavos y tasas, documentos intactos, idempotencia sin borrar datos nuevos, huella inválida, cambios en políticas, rollback por referencia inexistente, pgvector real y persistencia al cerrar/reabrir.

## Alcance y siguiente paso
E2 deja datos y eventos persistidos; NO reconstruye aún planes, prelación ni saldos de cartera. El siguiente paso es un adaptador que alimente el núcleo existente con los pagos únicos y políticas versionadas, sin reescribirlo.
La base solo debe abrirse desde un proceso de aplicación a la vez. Ejecuta el cargador con el backend detenido.
No se agregaron React, MCP ni generación RAG. La persistencia corresponde al Proyecto Final; src/dominio permanece intacto.
Para grabar la carga, usa una CV_DB_DIR NUEVA dedicada a la demostración. No borres tu base habitual para ensayar.

## Resultado verificado en esta entrega
59 pruebas aprobadas en 13 archivos; TypeScript sin errores. El cargador se ejecutó dos veces sobre la misma base persistente y mantuvo los conteos.
