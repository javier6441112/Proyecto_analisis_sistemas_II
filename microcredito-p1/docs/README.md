# Diagramas y trazabilidad

Los diagramas de este directorio estan escritos en Mermaid y son editables como Markdown. Se pueden visualizar en VS Code con una extension de Mermaid, en GitHub o en Mermaid Live Editor.

## Catalogo

- `01-casos-uso.md`: actores y casos de uso principales.
- `02-modelo-dominio.md`: clases conceptuales y nucleo ejecutable E4.
- `03-secuencias.md`: registrar pago y generar cierre mensual.
- `04-estados-credito.md`: ciclo de vida completo del credito.
- `05-actividad-originacion.md`: actividad de originacion y desembolso.
- `06-c4-arquitectura.md`: contexto y contenedores C4 de la arquitectura hexagonal.
- `07-trazabilidad.md`: requisito -> caso de uso -> clase o modulo -> evidencia.

## Decisiones de arquitectura

- `adr/ADR-001.md`: arquitectura hexagonal como monolito modular.
- `adr/ADR-002.md`: dinero encapsulado y calculos financieros deterministas.

Las entidades de originacion, pagos persistentes, movimientos y cierres son parte del modelo conceptual E1. El codigo ejecutable actual corresponde al nucleo puro E4 y esta identificado como tal en el modelo de clases y la matriz.

Actualización de cierres del Proyecto Final: la consulta y ejecución persistida se implementan según [ADR-003](adr/ADR-003.md). GET devuelve una vista previa o el resultado congelado; el POST de Gerencia guarda una única ejecución por período con sus políticas. El cierre mensual incorpora [provisiones con política versionada](politica-provisiones.md) y sus [movimientos acumulativos por variación](movimientos-provisiones.md), con apertura explícita para históricos y sin alterar resultados congelados. Los cierres diarios y mensuales incorporan [devengo corriente](devengo-corriente.md), con apertura, suspenso y regularización separados de los intereses cobrados.
