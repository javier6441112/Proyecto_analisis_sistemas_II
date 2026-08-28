# Proyecto 1 - Sistema de Gestion de Microcredito

Nucleo de calculo financiero para el Sistema de Gestion de Microcredito de Credito Vecino, S. A. El proyecto implementa el entregable E4 como funciones y modelos de dominio puros, sin servidor web ni base de datos.

## Requisitos

- Node.js 20 o superior
- npm

## Instalacion

Desde esta carpeta:

```powershell
npm install
```

## Comandos

Ejecutar las pruebas unitarias:

```powershell
npm test
```

Verificar tipos y compilacion estricta:

```powershell
npm run typecheck
```

Generar los contratos OpenAPI:

```powershell
npm run generar
```

Validar el contrato OpenAPI:

```powershell
npm run validar
```

El comando `npm run build` es equivalente a `npm run typecheck`.

## Funcionalidad actual

- Generacion de planes de amortizacion con sistema frances.
- Redondeo monetario determinista mediante `decimal.js`.
- Calculo de dias de atraso e interes moratorio.
- Clasificacion de tramos de mora.
- Aplicacion de pagos por prelacion: gastos, mora, interes corriente y capital.
- Calculo de cartera activa, saldo en riesgo e incobrables.
- Validacion de contratos con Zod.
- Generacion y validacion de documentos OpenAPI.

## Estructura

```text
src/dominio/       Nucleo financiero puro.
src/contratos/     Esquemas Zod para los contratos.
src/openapi.ts     Documento OpenAPI generado desde los esquemas.
tests/             Pruebas unitarias y casos de referencia.
docs/diagramas/    Diagramas UML y C4 editables en Markdown.
docs/adr/          Decisiones de arquitectura.
docs/api/          Contratos OpenAPI y documentacion de API.
```

## Documentacion

- [Diagramas y trazabilidad](docs/README.md)
- [Resultados de pruebas](RESULTADOS-PRUEBAS.md)
- [Contrato OpenAPI en YAML](docs/api/openapi.yaml)
- [Decisiones de arquitectura](docs/adr/ADR-001.md) y [ADR-002](docs/adr/ADR-002.md)

Los diagramas Mermaid pueden visualizarse en la vista previa Markdown de VS Code, en GitHub o en Mermaid Live Editor.

## Herramientas de IA utilizadas

- GitHub Copilot para apoyar el analisis, diseno, implementacion, documentacion y revision del proyecto.
- Mermaid para representar los diagramas editables de arquitectura, UML y flujos.

La autoria, revision y validacion final del contenido corresponden al equipo del proyecto.
