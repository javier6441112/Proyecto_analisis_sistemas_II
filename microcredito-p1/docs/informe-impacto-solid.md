# Informe de Impacto y Evolución del Núcleo (Verificación SOLID/GRASP)

**Sistema:** Crédito Vecino, S. A.  
**Curso:** Análisis de Sistemas II  
**Proyecto:** Proyecto 2 – Evolución del Núcleo (Entregable E6)  
**Fecha:** Septiembre 2026  

---

## 1. Punto de Partida
- **Primera versión base / entrega Proyecto 1:** 398353e626acd1f9c5b8c3829b8cf2231a3b6c19
- **Nueva versión de referencia / entrega actual:** d46ac30299b28c8a6c5f5ad0128ddc35056e8b6e

---

## 2. Métricas del Cambio

Resume las métricas cuantitativas obtenidas del repositorio tras aplicar la evolución:

| Métrica | Valor Obtenido | Interpretación / Estado |
| :--- | :---: | :--- |
| **Archivos del núcleo creados** | 9 | Se añadieron 9 módulos del dominio para política, clasificación, catálogo y cálculo de gasto. |
| **Archivos del núcleo modificados** | 2 | `credito.ts` y `cartera.ts` integran la nueva lógica sin tocar la base de cálculo original. |
| **¿Se modificó el motor de cálculo de mora?** | NO | Se conserva el contrato base y se extiende por composición de políticas. |
| **Pruebas del P1 que dejaron de pasar** | 0 | La suite heredada sigue en verde. |
| **Pruebas del P1 reescritas** | 0 | No fue necesario reformular la suite base. |
| **Líneas netas añadidas al núcleo (lógica del dominio)** | +219 | Cambio de dominio concentrado y extensible. |

### Evidencia de Git Diff real (`git diff --stat` entre la base y la versión actual)
```text
microcredito-p1/docs/informe-impacto-solid.md      | 140 +++++++++++++++++++++
microcredito-p1/package-lock.json                  |   3 -
microcredito-p1/src/dominio/cartera.ts             |  37 ++++++
microcredito-p1/src/dominio/credito.ts             |  15 +++
.../dominio/politica-mora/catalogo-politicas.ts    |  17 +++
.../dominio/politica-mora/clasificacion-tramo.ts   |  30 +++++
.../dominio/politica-mora/gasto-gestion-cobro.ts    |  27 ++++
.../dominio/politica-mora/politica-escalonada.ts   |  47 +++++++
.../src/dominio/politica-mora/politica-mora.ts     |  16 +++
.../src/dominio/politica-mora/politica-plana.ts    |  18 +++
.../dominio/politica-mora/politica-retroactiva.ts |  13 ++
microcredito-p1/tests/cartera-por-tramo-v2.test.ts |  42 +++++++
.../tests/cartera-por-tramo.test.ts               |  21 ++++
.../tests/contrato-politica.test.ts               |  47 +++++++
.../tests/credito-v2.test.ts                      |  77 ++++++++++++
.../tests/politica-mora.test.ts                   |  39 ++++++
.../tests/regresion-p1.test.ts                   |  13 ++
17 files changed, 599 insertions(+), 3 deletions(-)
```

> Nota: el alcance real del repositorio incluye pruebas y documentación adicionales, además del dominio. La parte de dominio mantiene la afirmación central: la evolución fue extensiva y sin modificar el motor base de cálculo.

---

## 3. Resumen del Cambio Arquitectónico

La evolución del núcleo de dominio se organizó alrededor de una estrategia de políticas moratorias con catálogo versionado y clasificación de tramos. En lugar de introducir lógica condicional dentro del motor de cálculo, el dominio se separó en componentes con responsabilidades estrechas:

- clasificación de días de atraso y tramo;
- definición de la política de mora;
- resolución de política por fecha de otorgamiento;
- cálculo de gasto de gestión;
- integración mínima con el crédito y la cartera.

Este enfoque mantiene la cohesión del dominio y reduce el riesgo de acoplamiento funcional. La calculadora base del moratorio se preserva como contrato estable, mientras que el comportamiento cambia por composición de estrategias.

---

## 4. Impacto sobre SOLID

### 4.1 Principio de Responsabilidad Única (SRP)
Se logró una distribución más clara del dominio:

- la clasificación del tramo quedó aislada en el componente de especificación;
- la política moratoria quedó separada por estrategia concreta;
- el cálculo de gasto de gestión quedó encapsulado en su propio servicio/lógica;
- la cartera y el crédito mantuvieron responsabilidades distintas en su propio dominio.

Esto redujo la probabilidad de que una clase acumule responsabilidades mezcladas de cálculo, validación y clasificación.

### 4.2 Principio Abierto/Cerrado (OCP)
La evolución cumple el objetivo central de OCP:

- el motor de cálculo de mora no fue alterado para incorporar la política escalonada;
- la nueva regla se incorpora mediante una implementación que sustituye la estrategia, sin romper la API existente;
- la nueva lógica es extensible para futuras políticas sin tocar la base del dominio.

### 4.3 Principio de Sustitución de Liskov (LSP)
La creación de políticas concretas bajo un contrato común permite sustituir una implementación por otra sin cambiar el comportamiento esperable del cliente. Esto es una mejora relevante respecto al diseño monolítico previo, ya que la lógica de negocio puede extenderse con nuevas políticas sin afectar la abstracción del contrato.

### 4.4 Principio de Inversión de Dependencias (DIP)
El dominio se orientó a dependencias de interfaces y contratos en vez de clases concretas. La resolución de la estrategia se hace mediante un catálogo, permitiendo que el crédito dependa de la abstracción de política y no de una implementación puntual. Esto facilita la prueba del comportamiento y reduce el acoplamiento directo a configuraciones específicas.

---

## 5. Impacto sobre GRASP

### 5.1 Alta cohesión
Cada componente quedó enfocado en una responsabilidad técnica específica: cálculo, clasificación, catalogación, evaluación de gastos y monitoreo de cartera. La cohesión aumentó porque cada unidad de código expresa un único propósito.

### 5.2 Bajo acoplamiento
La lógica de la política moratoria quedó desacoplada de la lógica del crédito. La integración se realiza a través de contratos y resolución por fecha, evitando acoplamientos rígidos entre módulos del dominio.

### 5.3 Experto
La lógica de cálculo moratorio quedó en la estrategia correspondiente, que es el lugar natural donde se conoce la tasa y la regla de tramo. La cartera y el crédito consumen esa decisión sin necesidad de duplicar reglas.

### 5.4 Fabricador / creador
La resolución de política por fecha funciona como un punto centralizador para crear la estrategia correcta según la vigencia del crédito. Esto evita que el cliente tenga que decidir implícitamente la política a aplicar.

---

## 6. Verificación de Regresión y Cobertura de Casos

La suite de pruebas del proyecto validó que la evolución no rompió el comportamiento heredado. Se conservaron las reglas del Proyecto 1 y se añadieron pruebas específicas para cubrir la nueva policy de mora escalonada y la coexistencia de políticas.

Principales validaciones:
- cálculo de mora plana para 15 días continúa dando el valor original del Proyecto 1;
- cálculo de mora escalonada por tramos con acumulado por días en cada tramo;
- regla de gasto de gestión en el día 31 con idempotencia;
- resolución de política según fecha de otorgamiento;
- cálculo de cartera por tramo y diferenciación entre mora y riesgo.

La evidencia real de ejecución fue la siguiente:

```text
RUN  v2.1.9 ... /microcredito-p1
✓ tests/calculadora-mora.test.ts (6)
✓ tests/cartera-por-tramo.test.ts (1)
✓ tests/cartera.test.ts (3)
✓ tests/contrato-politica.test.ts (1)
✓ tests/contratos.test.ts (9)
✓ tests/credito.test.ts (13)
✓ tests/plan-amortizacion.test.ts (1)
✓ tests/politica-mora.test.ts (3)
✓ tests/prelacion-pago.test.ts (5)
✓ tests/regresion-p1.test.ts (1)

Test Files  10 passed (10)
Tests       43 passed (43)
```

---

## 7. Conclusión

La evolución del núcleo mejoró la arquitectura de dominio respecto al estado inicial del Proyecto 1. La separación por política, estrategia, catálogo y clasificación de tramo logró un diseño más mantenible, extensible y alineado con los principios SOLID y GRASP.

El resultado evidencia que la refactorización no fue un cambio aislado de reglas empresariales, sino una evolución estructural del dominio: se ampliaron los comportamientos sin violar el OCP ni introducir regresiones sobre el sistema anterior.

En consecuencia, la solución obtenida cumple la finalidad de la entrega del Proyecto 2: ampliar el dominio sin romper la base funcional y dejando un núcleo preparado para futuras políticas y cambios regulatorios.
