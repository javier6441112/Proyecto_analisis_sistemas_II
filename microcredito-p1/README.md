# Crédito Vecino — Sistema de Gestión de Microcrédito

Proyecto integrador de Análisis de Sistemas II (037), desarrollado incrementalmente desde el Proyecto 1 hasta el Proyecto Final. Incluye el núcleo financiero en TypeScript, persistencia PGlite, API REST, interfaz React y un asistente gerencial con MCP y RAG sobre modelos locales de Ollama.

El núcleo de dominio conserva las funciones puras del P1 y las estrategias de mora del P2; la API, la persistencia y la interfaz se incorporan en el Proyecto Final. Las instrucciones de instalación y ejecución están en la sección **Proyecto Final — Asistente gerencial**.

## Video de defensa

**Enlace:** <!-- Pegar aquí el enlace compartible del video. -->

## Funcionalidad actual

- Generacion de planes de amortizacion con sistema frances.
- Redondeo monetario determinista mediante `decimal.js`.
- Calculo de dias de atraso e interes moratorio.
- Clasificacion de tramos de mora.
- Aplicacion de pagos por prelacion: gastos, mora, interes corriente y capital.
- Calculo de cartera activa, saldo en riesgo e incobrables.
- Ciclo de vida de credito con transiciones State, mora y recuperaciones de incobrables.
- Validacion de contratos con Zod.
- Generacion y validacion de documentos OpenAPI.

## Estructura

```text
src/dominio/       Nucleo financiero puro.
src/contratos/     Esquemas Zod para los contratos.
src/openapi.ts     Documento OpenAPI generado desde los esquemas.
src/api/           API REST y rutas del asistente.
src/persistencia/  Base de datos, carga canonica y operaciones.
src/mcp/           Herramientas del nucleo y aprobacion humana.
src/rag/           Ingesta, embeddings y recuperacion documental.
src/chat/          Orquestacion del asistente y guardias de salida.
web/               Interfaz React y pruebas de sus componentes.
tests/             Pruebas unitarias, integracion y casos de referencia.
tests/evals/       Comprobaciones del asistente con Ollama real.
docs/diagramas/    Diagramas UML y C4 editables en Markdown.
docs/adr/          Decisiones de arquitectura.
docs/api/          Contratos OpenAPI y documentacion de API.
```

## Documentación

- [Diagramas y trazabilidad](docs/README.md)
- [Resultados de pruebas](RESULTADOS-PRUEBAS.md)
- [Contrato OpenAPI en YAML](docs/api/openapi.yaml)
- [Decisiones de arquitectura](docs/adr/ADR-001.md), [ADR-002](docs/adr/ADR-002.md) y [ADR-003: cierres persistidos](docs/adr/ADR-003.md)

Los diagramas Mermaid pueden visualizarse en la vista previa Markdown de VS Code, en GitHub o en Mermaid Live Editor.

La declaración de herramientas de IA utilizadas se encuentra al final de este README.

## Proyecto Final — Asistente gerencial

La aplicación integra el núcleo de cálculo (P1/P2), persistencia (E2), API, interfaz React (E1), servidor MCP (E3), RAG con citación (E4) y chat gerencial (E5). Después de instalar las dependencias y descargar los modelos, se ejecuta en la computadora del equipo **sin conexión a internet**.

| Pieza | Dónde | Detalle |
|---|---|---|
| Núcleo (no se reescribe) | `src/dominio/` | Cuotas, mora por tramo, prelación, cartera |
| Persistencia y carga (E2) | `src/persistencia/` | PGlite + pgvector en `.cv-db`; operaciones en `bitacora_operaciones` |
| API REST | `src/api/` | Fastify 5 + Zod; fecha de corte obligatoria |
| Interfaz (E1) | `web/` (proyecto con su propio `package.json`) | React 19 + Vite + Tailwind; replica el prototipo de Figma; tipos del contrato `src/contratos/api.ts` |
| Servidor MCP (E3) | `src/mcp/` | SDK oficial; solo lectura por defecto; pago con aprobación humana |
| RAG (E4) | `src/rag/` | Fragmentos por sección, `bge-m3`, pgvector, citación por `doc_id` |
| Chat (E5) | `src/chat/`, `web/src/gerencia/Asistente.tsx` | `qwen2.5:7b` local; guardias en código |
| Pruebas (E6) | `tests/` | `npm test` (incluye el contrato OpenAPI) y `npm run evals` |

Detalle técnico del asistente, la seguridad y los resultados de las evals: [docs/asistente-ia.md](docs/asistente-ia.md).

Guía de la carga canónica (E2): [docs/E2-persistencia-carga.md](docs/E2-persistencia-carga.md).

### Requisitos

- Windows 10/11 (o macOS/Linux), **16 GB de RAM recomendados** (8 GB funciona, lento).
- [Node.js 22 LTS](https://nodejs.org), [Git](https://git-scm.com) y [Ollama](https://ollama.com/download) instalados de forma nativa (sin Docker).
- npm, incluido con Node.js. Los comandos siguientes están escritos para PowerShell en Windows; `iniciar.ps1` es el arranque automático para ese entorno.

### Instalación (una sola vez, con internet)

```powershell
cd microcredito-p1       # desde la raíz del repositorio; omitir si ya está en esta carpeta
npm install
ollama pull qwen2.5:7b
ollama pull bge-m3
npm run web:install   # dependencias de la interfaz (web/)
```

Abra la aplicación Ollama y manténgala ejecutándose antes de ingerir el corpus o utilizar el chat. Si PowerShell bloquea `npm.ps1`, use `npm.cmd` en lugar de `npm` en los comandos manuales, sin cambiar la política de ejecución.

### Carga de datos y arranque

```powershell
$env:CV_DATA_DIR = (Resolve-Path .\datos\datos-proyecto-final).Path
$env:CV_DB_DIR   = Join-Path $PWD.Path '.cv-db'
npm run cargar:datos     # Bloque 1: SHA-256 en verde · 60 clientes · 75 créditos · 228 pagos
npm run rag:ingestar     # 7 documentos → 32 fragmentos con bge-m3
npm run web:build        # compila la interfaz
npm run api              # http://127.0.0.1:3000  (API + interfaz + /mcp + chat)
```

O todo de una vez: `.\iniciar.ps1` (verifica Ollama, modelos y base, y arranca).

> Un solo proceso puede abrir `.cv-db`: no ejecute `cargar:datos` ni `rag:ingestar` con la API encendida. `npm test` y `npm run evals` trabajan sobre copias y no modifican la base.

Para desarrollar la interfaz con recarga en caliente: `npm run api` en una terminal y `npm run web:dev` en otra (http://localhost:5173, redirige `/api` al puerto 3000).

La configuración de mora se lee de `parametros_politicas` al abrir el adaptador; si no contiene parámetros, se usa `CV_DATA_DIR/politicas.json`. Las estrategias del núcleo se construyen con `tna_bps` (100 bps = 1 % anual), los límites `ini`/`fin` y tasas `bps` de `tramos`, y `gasto_gestion_cobro` (`monto_centavos`, `dia_generacion`, `aplica_a_politicas`). Una tasa válida no necesita coincidir con una constante. Cambiar un archivo después de cargarlo no sustituye los parámetros ya persistidos: hay que actualizar la configuración de la base correspondiente y reabrir el adaptador.

La fecha explícita de otorgamiento selecciona la política mediante `vigencia_otorgamiento`, con extremos inclusivos. Se rechazan fechas inválidas, vigencias superpuestas, tasas negativas o fraccionarias en bps, tramos con huecos o solapamientos y gastos inválidos. Los tramos cubren los días 1 a 120; se conserva el límite de devengo de 120 días, Actual/360, redondeo y reglas de pago existentes. Un día sin política aplicable produce un error, sin recurrir al reloj del sistema.

Los identificadores, versión disponible, vigencia, autor y motivo se conservan en la configuración; el cierre definitivo guarda una copia completa y sus huellas. Consultarlo o repetir su ejecución devuelve el resultado histórico aunque cambie la configuración vigente. Para comprobar la carga sin tocar los archivos canónicos ni la base habitual: `npm test -- tests/parametros-mora.test.ts`. La prueba escribe configuraciones temporales, cambia la tasa plana a 3600 bps y verifica Q30.00 de mora para Q1000 durante 30 días; también prueba vigencias, gastos y un cierre en una base temporal.

### Pruebas

Ejecute primero la instalación de dependencias del servidor y de `web/`, y la carga canónica descritas arriba. La suite completa necesita una base cargada en `CV_DB_DIR` (o `.cv-db`) para crear sus copias temporales; no necesita Ollama. Detenga la API antes de copiar la base. Las evals del asistente sí necesitan Ollama y ambos modelos descargados.

```powershell
npm test            # Bloque 0: suite del P1/P2 + carga + adaptador + API + MCP + RAG + chat
npm run typecheck   # TypeScript estricto del servidor (la interfaz se revisa en npm run web:build)
npm run web:build   # verifica tipos de la interfaz y genera web/dist
npm run evals       # evals del asistente contra qwen2.5:7b real → tests/evals/resultados.md
```

Otros comandos de documentación: `npm run generar` actualiza OpenAPI desde Zod y `npm run validar` valida la especificación. `npm run build` equivale a `npm run typecheck`; para compilar la interfaz se usa `npm run web:build`. No existe un script `npm run web`.

### Variables de entorno

| Variable | Por defecto | Uso |
|---|---|---|
| `CV_DATA_DIR` | — | Ruta del paquete canónico para la carga y respaldo de lectura de `politicas.json` si la base no contiene parámetros |
| `CV_DB_DIR` | `./.cv-db` | Base PGlite |
| `PORT` | `3000` | Puerto de la API y la interfaz |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama local |
| `CV_LLM_MODELO` | `qwen2.5:7b` | Modelo de chat |
| `CV_EMBEDDINGS` | `bge-m3` | Modelo de embeddings |
| `CV_LLM_CONTEXTO` | `8192` | Contexto del modelo (4096 con 8 GB de RAM) |
| `CV_LLM_MAX_TOKENS` | `600` | Máximo de tokens generados por respuesta del modelo |
| `CV_LLM_LIMITE_MS` | `900000` | Tiempo máximo de espera por inactividad de la petición HTTP a Ollama, en milisegundos |
| `CV_RAG_UMBRAL` | `0.50` | Similitud mínima para citar un fragmento |

### Modelo de lenguaje

`qwen2.5:7b` vía Ollama, local. Se eligió midiendo: con las 7 herramientas reales y las preguntas del guion, `qwen2.5:7b` acertó herramienta y argumentos en 6/6 y `mistral` 7B en 0/5 (describía la función en vez de llamarla e inventaba cifras). Embeddings: `bge-m3` (multilingüe, buen español).

Para una solicitud concreta de propuesta de pago, el chat ejecuta `calcular_deuda_cuota` y después `proponer_pago` con el crédito y la fecha indicados. Si no se indicó monto, lo obtiene el núcleo; si se indicó uno, se valida sin sustituirlo silenciosamente. Los ejemplos del corpus y los importes de respuestas anteriores no determinan la deuda. La propuesta válida muestra el desglose y el botón **Aprobar**; consultar documentos solo muestra fuentes. Proponer no registra un pago: sigue siendo necesaria la aprobación humana en la interfaz.

Comprobación con Ollama real: `node --import tsx tests/evals/propuestas-ollama.ts` desde `microcredito-p1`. Requiere los modelos locales de chat y embeddings. Trabaja sobre una copia temporal de `CV_DB_DIR` (o `.cv-db`), verifica los importes contra el núcleo y que la bitácora no cambie; no aprueba ni registra pagos y elimina la copia al terminar.

### Estrategia de RAG y citación

- **Fragmentación:** se separa cada documento por secciones Markdown (`##`) y se conserva su introducción como otro fragmento. El corpus canónico produce 32 fragmentos a partir de siete documentos. Cada sección desarrolla una regla concreta: recuperarla completa conserva su contexto y permite citar una unidad reconocible, sin mezclar políticas de distintas vigencias. Cada fragmento incorpora `doc_id`, título y vigencia.
- **Embeddings:** se utiliza `bge-m3` mediante Ollama porque es multilingüe, permite trabajar con el corpus en español y se ejecuta localmente; además, es una de las opciones sugeridas por el enunciado. Su función es recuperar documentos, no calcular cifras financieras.
- **Recuperación:** los vectores se guardan en pgvector y se consultan por similitud coseno. El umbral predeterminado es `0.50`, configurable con `CV_RAG_UMBRAL`. La respuesta normativa cita el documento recuperado; sin fragmentos suficientes se indica que no se encontró una fuente verificable.
- **Seguridad:** el corpus se trata como dato. Se filtran instrucciones incrustadas y datos personales, y los borradores sin aprobar no se citan como política normativa. Los importes reales de un crédito proceden de las herramientas del núcleo.

### Tabla pantalla ↔ caso de uso (sección 6.1)

Al entrar se elige el perfil (asesor con su nombre, o gerencia). El asesor ve la versión móvil con pestañas; la gerencia, la de escritorio.

| Pantalla (pestaña) | Perfil · formato | Casos de uso | Operaciones / consultas del video |
|---|---|---|---|
| Inicio | Asesor · móvil | — (resumen de su cartera y accesos) | — |
| Clientes (alta y búsqueda) | Asesor · móvil | UC-01 Registrar cliente | OP-3 |
| Solicitudes (formulario → plan simulado → envío al comité → desembolso) | Asesor · móvil | UC-02 Solicitar crédito, UC-04 Desembolsar | OP-3 |
| Comité | Gerencia · escritorio | UC-03 Evaluar y aprobar crédito | OP-3 |
| Créditos (detalle → plan de amortización → detalle de la mora por tramo) | Asesor · móvil (también desde gerencia) | UC-06 Calcular mora (consulta) | OP-2, G-5 |
| Pagos (prelación, aprobación, rechazos, reintento) | Asesor · móvil | UC-05 Registrar pago de cuota | OP-1, OP-2, OP-4, OP-5, OP-6 |
| Tablero | Gerencia · escritorio | UC-08 Consultar cartera en riesgo | G-1, G-4 |
| Cierres (diario / mensual) | Gerencia · escritorio | UC-07 Generar cierre | G-2, G-3 |
| Asistente (chat) | Gerencia · escritorio | UC-05 a UC-08 vía MCP | G-1 a G-8, OP-7 |

Flujos navegables: **originación** (Clientes → Solicitudes → Comité → Desembolso), **cobro en campo** (Créditos → Detalle → Mora → Pagos) y **consulta gerencial** (Tablero → cartera en riesgo por tramo → créditos).

En Gerencia → Cierres, **Consultar período** obtiene una vista previa o un cierre ya guardado. **Ejecutar cierre definitivo** congela las cifras y políticas del período; **Reejecutar comprobación** devuelve ese mismo resultado mediante POST. Los cierres se conservan al reiniciar. La migración añade `cierres_ejecutados` al abrir la base, sin reconstruir datos. Véase [ADR-003](docs/adr/ADR-003.md) para el contrato y el comportamiento ante operaciones posteriores en períodos cerrados.

La fecha de operación elegida en pantalla es el puerto Reloj: arranca en 2026-10-31 y toda consulta la envía como fecha de corte. La interfaz no calcula dinero: todo monto y porcentaje viene de la API. La API se documenta en `docs/api/openapi.yaml`, generado desde el mismo contrato que valida el servidor.

### Herramientas de IA utilizadas

- **GitHub Copilot**: apoyo en análisis, diseño, implementación, documentación y revisión del proyecto.
- **Claude (Anthropic)**: apoyo en arquitectura, implementación de API, MCP, RAG, chat e interfaz, pruebas y documentación.
- **Gemini (Google)**: borradores iniciales del cargador y del adaptador.
- **Codex (OpenAI)**: revisión de requisitos y código, correcciones de políticas configurables y propuestas de pago, pruebas de regresión, comprobaciones con Ollama real y actualización de documentación.
- **qwen2.5:7b y bge-m3 (Ollama)**: modelos que usa el sistema en ejecución.

El equipo revisó, probó y puede explicar todo lo entregado.

## Política de provisiones

El cálculo puro, la configuración versionada de reservas y su integración en el cierre mensual se describen en [Política de provisiones](docs/politica-provisiones.md). Son decisiones académicas del equipo para Crédito Vecino. La pantalla de Cierres muestra total, detalle y versión; los cierres definitivos conservan su resultado y parámetros originales. No se generan movimientos contables de provisiones ni devengo de intereses.
