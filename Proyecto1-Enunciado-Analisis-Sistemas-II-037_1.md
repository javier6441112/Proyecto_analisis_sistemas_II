## Universidad Mariano Gálvez de Guatemala

Facultad de Ingeniería en Sistemas de Información y Ciencias de la Computación

Conoceréis la verdad y la verdad os hará libres

## ENUNCIADO DEL PROYECTO 1

## Arquitectura y diseño de componentes

Sistema de Gestión de Microcrédito — Crédito Vecino, S. A.

## Análisis de Sistemas II · Código 037

Segundo semestre 2026 · Modalidad sabatina · Proyecto individual · 10 puntos

| Curso | Análisis de Sistemas II (037) — Área de Ingeniería de Software |
| --- | --- |
| Actividad | Proyecto 1 — Arquitectura y diseño de componentes |
| Modalidad | Grupal · Ponderación: 10 puntos |
| Dominio | Fintech de microcréditos — sistema del proyecto integrador |
| Naturaleza | Diseño y arquitectura, verificados con un núcleo de cálculo ejecutable |
| Stack obligatorio | TypeScript sobre Node.js (obligatorio, ver sección 8) |


## 1. Presentación y propósito

Este documento define el Proyecto 1 del curso Análisis de Sistemas II (037). El proyecto abre la primera fase del proyecto integrador, que se desarrolla sobre un dominio real y exigente: una fintech que otorga microcréditos.

En una fintech, el software no “aproxima”: calcula dinero. Un centavo mal redondeado, un interés moratorio cobrado sobre el interés corriente o un indicador de cartera en riesgo mal formulado no son detalles estéticos — son defectos de severidad alta, con consecuencias contables, regulatorias y reputacionales. Por eso este proyecto le exige dos cosas a la vez: un diseño arquitectónico bien argumentado y la evidencia de que ese diseño produce los números correctos.

## Regla de incrementalidad (obligatoria)

El sistema que usted diseñe aquí es el mismo que continuará en el Proyecto 2 y en el Proyecto Final. No se admiten sistemas distintos entre fases.

Diseñe sabiendo que después habrá que agregarle interfaz, un asistente conversacional con RAG, un servidor MCP y las pruebas del sistema. Una buena arquitectura hoy le evita rediseñar.

## 2. Contexto empresarial: Crédito Vecino, S. A.

Crédito Vecino, S. A. es una institución de microfinanzas guatemalteca que otorga microcréditos a personas y pequeños negocios que no acceden fácilmente a la banca tradicional. Coloca créditos entre Q1,000 y Q25,000, con plazos de 3 a 24 meses.

Hoy la operación se lleva en hojas de cálculo dispersas: cada asesor tiene su propia versión de la fórmula de mora, los cierres se hacen a mano y la gerencia recibe cifras que no cuadran entre sí. La empresa le encarga a usted, como analista, el diseño del Sistema de Gestión de Microcrédito (en adelante, el Sistema) que ordene el proceso desde la solicitud hasta los cierres, con cifras auditables y reproducibles.

## 3. Objetivos de aprendizaje

Al completar el Proyecto 1, usted será capaz de:

- Modelar un dominio financiero real con UML manteniendo trazabilidad requisito → caso de uso → clase.

- Seleccionar y justificar una arquitectura con base en atributos de calidad priorizados (ISO/IEC 25010).

- Documentar la arquitectura con el modelo 4+1 de Kruchten y con el modelo C4.

- Diseñar componentes cohesivos y poco acoplados aplicando SOLID, GRASP y patrones GoF.

- Especificar los contratos de una API y registrar decisiones de arquitectura (ADR).

- Demostrar, con código ejecutable y pruebas, que el diseño produce cifras financieras correctas.


## 4. Alcance del Proyecto 1

| Sí forma parte de esta entrega | Queda fuera de esta entrega |
| --- | --- |
| • Modelo de dominio en UML (E1). • Decisión de arquitectura: 4+1 y C4 (E2). • Diseño de componentes con SOLID/GRASP/GoF (E3). • Núcleo de cálculo ejecutable en TypeScript, con pruebas (E4). • Contratos de la API y ADR (E5). • Documento de arquitectura y repositorio (E6). | • Servidor HTTP o API implementada. • Base de datos, ORM o persistencia real. • Interfaz gráfica o prototipo (es el Proyecto 2). • RAG, chat, servidor MCP o asistente (es el Proyecto Final). • Autenticación, despliegue o CI/CD. • Reportes o pantallas gerenciales. |

## 6. Modelo financiero y reglas de negocio

Esta sección es el contrato del dominio. Su diseño debe representar estas reglas con exactitud; su núcleo de cálculo debe reproducir exactamente los números de los ejemplos. Donde diga “política de la institución”, usted decide y documenta — pero una vez decidida, la regla es obligatoria y verificable.

## 6.1 Marco de referencia

El dominio es ficticio, pero las reglas se apoyan en marcos reales, que usted debe citar en su documento:

- Guatemala: Ley de Entidades de Microfinanzas y de Entes de Microfinanzas sin Fines de Lucro (Decreto 25-2016 del Congreso de la República), vigente desde noviembre de 2016 y reglamentada por la Junta Monetaria; supervisión a cargo de la Superintendencia de Bancos (SIB).

- Riesgo de crédito: Reglamento para la Administración del Riesgo de Crédito (Resolución JM-47-2022), que regula la clasificación de activos crediticios y la constitución de reservas o provisiones.

- Estándar sectorial: las definiciones de cartera en riesgo usadas internacionalmente en microfinanzas (guías de consenso del sector), adaptadas al lenguaje llano de este documento.

## Por qué esto importa para el diseño

Las tasas, los tramos y los porcentajes de reserva son política institucional y cambian por regulación o por decisión del comité. Un diseño que “quema” esos valores dentro del código de cálculo es un mal diseño.

Consecuencia arquitectónica: las políticas deben ser parámetros versionados y sustituibles (patrón Strategy), no constantes literales. Un crédito debe calcularse con la política vigente en su fecha de otorgamiento.

## 6.2 Representación del dinero (regla no negociable)

Regla obligatoria del Sistema: todo importe monetario se representa como entero en la unidad mínima (centavos de quetzal) o mediante una biblioteca decimal (decimal.js, big.js, dinero.js). Nunca con Number en punto flotante.

- Diseño: Encapsule el importe en un Objeto de Valor (Value Object) Dinero, inmutable, que lleve monto y moneda, y que prohíba sumar quetzales con dólares.

- Redondeo: Redondeo a 2 decimales, medio hacia arriba, aplicado en cada cuota y no al final.

- Inmutabilidad: Dinero.sumar() devuelve un Dinero nuevo; jamás muta el original.


## 6.3 Tasas y convenciones de conteo

| Concepto | Definición | Decisión de la institución |
| --- | --- | --- |
| Tasa nominal anual (TNA) | Tasa anual sin capitalizar. Tasa mensual i = TNA ÷ 12 (proporcional). | Se usa TNA; documente el valor. |
| Tasa efectiva anual (TEA) | Incorpora la capitalización: i = (1+TEA)^(1/12) − 1. | Alternativa; si la usa, declárelo. |
| Base de conteo (mora) | Actual/360, Actual/365 o 30/360. Cambia el resultado. | Se sugiere Actual/360. |
| Tasa moratoria diaria | TNA moratoria ÷ base de conteo. | Documente TNA moratoria y base. |

Advertencia: “36% anual” no significa nada sin decir si es nominal o efectiva y cuál es la base de conteo. Su documento debe declararlo explícitamente. Esta es una de las causas más frecuentes de discrepancia entre un sistema y la contabilidad.

## 6.3.1 Marco legal de las tasas en Guatemala

En Guatemala NO existe un tope legal general de tasas de interés para el crédito de entidades supervisadas. El límite no es un número: son cuatro reglas que su diseño debe respetar y que debe citar en su documento:

- Libre pactación: las tasas de interés, comisiones y demás cargos se pactan libremente con el usuario (artículo 42 de la Ley de Bancos y Grupos Financieros, Decreto 19-2002), criterio aplicable a las entidades de microfinanzas supervisadas conforme al Decreto 25-2016.

- Cargos justificados: solo pueden cobrarse comisiones y gastos por servicios efectivamente prestados. Un cargo sin servicio detrás es ilegal — y su modelo de Pago debe poder demostrar a qué corresponde cada cargo.

- Transparencia: el costo del crédito debe poder expresarse como tasa efectiva anual equivalente, para que el cliente compare ofertas. Consecuencia de diseño: su núcleo debe poder calcular la tasa efectiva de cualquier plan, no solo la nominal pactada.

- Usura: exigir un interés “evidentemente desproporcionado con la prestación” es delito de usura (artículo 276 del Código Penal), con penas endurecidas recientemente. La libre pactación no es un cheque en blanco.

Consecuencia arquitectónica: la tasa es un parámetro de la política de crédito — versionado, con validación de razonabilidad y con autor y fecha — nunca una constante en el código. Un crédito se calcula con la política vigente en su fecha de otorgamiento, aunque la política cambie después (patrón Strategy + parámetros versionados).

## 6.4 Plan de amortización (sistema francés)

Método base del Sistema: amortización francesa de cuota fija. La cuota se calcula así:

```
i · (1 + i)^n
cuota = P · ─────────────────── P = capital desembolsado
(1 + i)^n − 1 i = tasa periódica (mensual)
n = número de cuotas
Caso especial: si i = 0 → cuota = P / n (evite la división por cero)
Por período k:
interes_k = redondear(saldo_{k-1} · i)
amortizacion_k = cuota − interes_k
saldo_k = saldo_{k-1} − amortizacion_k
```

## El problema del cuadre: la última cuota SIEMPRE se ajusta

Como cada cuota se redondea a centavos, la suma de las amortizaciones casi nunca da exactamente el capital. Si no corrige, el saldo final queda en ±unos centavos y el crédito nunca se cancela.


Regla obligatoria: en la última cuota, amortizacion_n = saldo_{n-1} (todo el saldo restante), y cuota_n = amortizacion_n + interes_n.

Invariante verificable: Σ amortizacion_k = P exactamente, y saldo_n = 0.00 exactamente. Su prueba unitaria debe comprobarlo.

## 6.4.1 Ejemplo resuelto (caso de referencia obligatorio)

Datos: P = Q10,000.00 · TNA nominal 36% → i = 3% mensual · n = 12 cuotas mensuales. Cuota calculada = Q1,004.62 (valor exacto 1004.6208547…, redondeado a centavos).

| Cuota | Saldo inicial | Cuota (Q) | Interés (Q) | Amortización (Q) | Saldo final |
| --- | --- | --- | --- | --- | --- |
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
| Totales |   | 12,055.45 | 2,055.45 | 10,000.00 | 0.00 |

## Lea la cuota 12 con atención

La cuota 12 es Q1,004.63, un centavo más que las once anteriores. Ese centavo es el ajuste de cuadre. Sin él, el saldo final sería Q0.01 y el crédito quedaría vivo para siempre.

Este caso es un dato de prueba obligatorio: su núcleo de cálculo debe reproducir esta tabla exactamente, celda por celda.

## 6.5 Mora e interés moratorio

- Días de atraso: días transcurridos desde la fecha de vencimiento de una cuota impagada hasta la fecha de corte. Se cuentan días calendario.

- Tramos de mora: el crédito se clasifica por su cuota más atrasada en cuatro tramos: Mora 1 (1–30 días), Mora 2 (31–60), Mora 3 (61–90) y Vencido (91–120). Al superar los 120 días pasa a incobrable (sección 6.7).

Base de cálculo del interés moratorio — regla legal, no preferencia. El Código Civil de Guatemala (Decreto-Ley 106) prohíbe pactar la capitalización de intereses (anatocismo): los intereses vencidos no pueden generar nuevos intereses ni sumarse al capital. Por eso el Sistema calcula el moratorio EXCLUSIVAMENTE sobre el capital en mora (la porción de capital de la cuota vencida), nunca sobre el total de la cuota, que incluye interés:


```
interes_moratorio = capital_en_mora × tasa_moratoria_diaria × dias_de_atraso
Ejemplo (crédito de referencia, cuota 2):
capital en mora = Q725.76 (amortización de la cuota 2)
TNA moratoria = 24% (política de la institución)
base de conteo = Actual/360
tasa moratoria diaria = 0.24 / 360 = 0.000666...
días de atraso = 15
interes_moratorio = 725.76 × 0.000666... × 15 = Q7.26
```

- Cálculo por cuota: cada cuota vencida genera su propio interés moratorio, sobre su propio capital en mora y por sus propios días de atraso. Con dos cuotas vencidas hay dos cálculos de moratorio, no uno sobre la suma.

- Suspensión de devengo: al superar los 90 días de atraso se suspende el devengo de interés corriente (el crédito pasa a interés en suspenso): se deja de reconocer como ingreso lo que muy probablemente no se cobrará. Si el crédito se regulariza, el devengo se reactiva. Su modelo de estados debe contemplar ambas direcciones (sección 6.7).

## 6.6 Aplicación de pagos (prelación y escenarios)

Cuando llega un pago, el Sistema debe decidir a qué se aplica y en qué orden. Esta sección primero explica de dónde sale cada rubro, luego el orden de aplicación, y por último los tres escenarios: pago exacto, pago de menos y pago de más.

## 6.6.1 De dónde salen los rubros de una cuota

Toda la sección usa el caso de referencia (sección 6.4.1): crédito de Q10,000.00 al 36% nominal anual (3% mensual), 12 cuotas. Suponga que el cliente va a pagar la cuota 2, que venció hace 15 días. Los rubros que adeuda salen así:

| Rubro | De dónde sale | Monto |
| --- | --- | --- |
| Interés moratorio | Capital en mora × tasa moratoria diaria × días de atraso. Capital de la cuota 2 = Q725.76; tasa 24%/360; 15 días (sección 6.5). | Q7.26 |
| Interés corriente | Es el interés de la cuota 2 en la tabla de amortización (saldo Q9,295.38 × 3%). | Q278.86 |
| Capital | Es la amortización de la cuota 2 en la tabla (cuota Q1,004.62 − interés Q278.86). | Q725.76 |
| Gastos / comisiones | Cargos por servicios efectivamente prestados (p. ej. gestión de cobro en campo), si la política los define. En este ejemplo: ninguno. | Q0.00 |

Total adeudado de esta cuota vencida = 0.00 + 7.26 + 278.86 + 725.76 = Q1,011.88 (la cuota normal de Q1,004.62 más Q7.26 de mora por los 15 días de atraso).

## 6.6.2 Orden de aplicación (prelación)

Un pago se aplica a los rubros en este orden. El principio legal es que el pago se imputa primero a intereses y solo el excedente a capital (Código Civil); la práctica del sector antepone gastos y moratorios:

```
1. Gastos y comisiones (lo accesorio primero)
2. Interés moratorio (la penalización por el atraso)
3. Interés corriente (el interés del período)
4. Capital (reduce el saldo de la deuda)
```


Cada rubro consume lo que le corresponde y pasa el remanente al siguiente.

## 6.6.3 Escenario A — pago exacto

El cliente paga Q1,011.88, justo lo adeudado de la cuota vencida:

*Pago recibido: Q1,011.88*

```
│ 1. Gastos Gastos │ Q 0.00 │ quedan 1,011.88
│ 2. Interés moratorio │ Q 7.26 │ quedan 1,004.62
│ 3. Interés corriente │ Q278.86 │ quedan 725.76
│ 4. Capital Capital │ Q725.76 │ quedan 0.00
```

Resultado: la cuota 2 queda saldada. Si no hay más cuotas vencidas, el crédito regresa de EN MORA a VIGENTE (regulariza).

## 6.6.4 Escenario B — pago de menos (pago parcial)

El cliente solo trae Q500.00. Se aplica en el mismo orden hasta donde alcance:

Pago recibido: Q500.00

```
│ 1. Gastos Gastos │ Q 0.00 │ quedan 500.00
│ 2. Interés moratorio │ Q 7.26 │ quedan 492.74
│ 3. Interés corriente │ Q278.86 │ quedan 213.88
│ 4. Capital Capital │ Q213.88 │ quedan 0.00 (abono parcial)
```

La cuota NO queda saldada: aún debe Q725.76 − Q213.88 = Q511.88 de capital. El crédito sigue EN MORA. El tramo puede bajar si el pago redujo los días de atraso de la cuota más antigua, pero no vuelve a VIGENTE.

## Regla del pago parcial

Un abono que no cubre toda la cuota vencida reduce la deuda pero no regulariza el crédito. Debe registrarse igual (nunca se rechaza un pago por ser insuficiente) y el saldo pendiente se recalcula.

Decisión de política que debe documentar: si el abono a capital reduce el plazo (misma cuota, menos meses) o reduce la cuota (mismo plazo, cuota menor).

## 6.6.5 Escenario C — pago de más (y política de adelanto)

El cliente trae Q3,000.00, más de lo que debe hoy. Primero se salda la cuota vencida; el excedente activa la política de adelanto:

```
Pago recibido: Q3,000.00
Paso 1 — saldar la cuota 2 vencida (como en el escenario A):
gastos 0 · moratorio 7.26 · corriente 278.86 · capital 725.76
consumido: Q1,011.88 → excedente: Q1,988.12
Paso 2 — aplicar el excedente de Q1,988.12 según la POLÍTICA DE ADELANTO.
```

El excedente no es un regalo a la institución: pertenece al cliente y debe aplicarse a su favor. La política de adelanto define cómo, y su documento debe elegir y justificar una de estas dos formas:


| Política de adelanto | Qué hace con el excedente | Efecto para el cliente |
| --- | --- | --- |
| Amortización a capital (recomendada) | El excedente reduce directamente el saldo de capital. Se recalcula el plan: se acorta el plazo o baja la cuota (según 6.6.4). | Paga menos intereses en total: el interés se cobra sobre un saldo menor. |
| Pago anticipado de cuotas futuras | El excedente se guarda y cubre las próximas cuotas completas a su vencimiento (cuota 3, luego 4…). | No cambia el interés total, pero queda al día por adelantado. |

## Reglas del pago de más

Nunca se pierde el excedente: siempre se aplica a favor del cliente y queda registrado con su destino (a capital o a cuotas futuras).

Si el excedente cancela todo el saldo restante, el crédito pasa a CANCELADO y no se cobran los intereses de los meses que ya no transcurrirán (el interés se devenga con el tiempo; si no hay tiempo, no hay interés).

La cancelación anticipada no puede penalizarse con cargos no pactados: cualquier comisión por pago anticipado debe estar en el contrato y responder a un servicio real (sección 6.3.1).

## Este es el punto donde más sistemas fallan

El orden de aplicación es una regla de negocio, no un detalle de implementación: cambiarlo altera cuánto debe el cliente y cuánto reconoce la institución como ingreso.

Oportunidad de diseño: cada rubro es un eslabón que consume lo suyo y pasa el remanente al siguiente. Es el patrón Chain of Responsibility en su forma más natural (sección 9); el manejo del excedente (a capital vs. a futuro) es un Strategy.


## 6.7 Ciclo de vida del crédito (estados y transiciones)

El error más común al modelar este dominio es dibujar el ciclo de vida como una línea recta hacia el deterioro: vigente → mora → incobrable. La realidad de una cartera de microcrédito es que los créditos se deterioran Y se recuperan constantemente: un cliente con 40 días de atraso paga sus cuotas vencidas y su crédito regresa a vigente; uno vencido llega a un arreglo y vuelve a la cartera sana. Un modelo que solo contempla la ida y no la vuelta es incapaz de representar la operación real, y producirá indicadores de cartera en riesgo que solo pueden crecer.

## Ciclo de vida del crédito — estados y transiciones

*Figura 6.7 — Ciclo de vida del crédito. Azul: avance normal. Rojo: deterioro (el crédito se atrasa y sube de tramo). Verde: recuperación (el cliente paga y el crédito baja de tramo o regulariza). Gris: salida definitiva. El estado del crédito en mora es uno solo (EN MORA); los*

*cuatro tramos (Mora 1 a Vencido) son una clasificación derivada de los días de atraso, que sube si no paga y baja si paga.*


## 6.7.1 Tabla de transiciones (completa y obligatoria)

Su diagrama de estados UML debe contemplar todas estas transiciones, con el evento que las dispara y su guarda (condición). Esta tabla es el contrato:

| De | Evento | Guarda (condición) | A |
| --- | --- | --- | --- |
| solicitado | Comité aprueba | Cumple política de crédito | aprobado |
| solicitado | Comité rechaza | — | rechazado (terminal) |
| aprobado | Se desembolsa | Capital entregado al cliente | desembolsado → vigente |
| aprobado | Cliente desiste / expira | Antes del desembolso | anulado (terminal) |
| vigente | Vence una cuota impagada | díasAtraso ≥ 1 | en_mora |
| vigente | Paga la última cuota | saldo = 0.00 exacto | cancelado (terminal) |
| en_mora | Paga TODO lo vencido | díasAtraso = 0 | vigente (regularización) |
| en_mora | Paga PARTE de lo vencido | díasAtraso baja pero > 0 | en_mora (baja de tramo) |
| en_mora | Sube de tramo por más atraso | díasAtraso 91–120 | en_mora · tramo Vencido |
| en_mora | Acuerdo de nuevas condiciones | Comité autoriza | reestructurado |
| en_mora (Vencido) | Paga TODO lo vencido | díasAtraso = 0 | vigente (regularización) |
| en_mora (Vencido) | Paga PARTE de lo vencido | díasAtraso baja a ≤ 90 | en_mora · baja de tramo |
| en_mora | Acuerdo de nuevas condiciones | Comité autoriza | reestructurado |
| en_mora (Vencido) | Supera 120 días sin arreglo | díasAtraso > 120 | incobrable (terminal contable) |
| reestructurado | Cumple su nuevo plan al día | Según política de cura | vigente (sigue marcado en riesgo) |
| reestructurado | Se atrasa en el nuevo plan | díasAtraso ≥ 1 | en_mora |
| reestructurado | Paga la última cuota nueva | saldo = 0.00 exacto | cancelado (terminal) |
| incobrable | Cliente paga después (vía casa de cobro) | — | NO regresa a cartera: se registra como recuperación de incobrable |

## Los tramos de mora NO son estados: son una clasificación derivada

Los tramos (Mora 1: 1–30, Mora 2: 31–60, Mora 3: 61–90, Vencido: 91–120 días) se mueven en AMBAS direcciones: cada pago que reduce los días de atraso puede bajar el crédito de tramo, y cada día que pasa sin pago puede subirlo. Si usted modela cada tramo como un estado de la máquina, necesitará transiciones entre todos los pares de tramos en ambos sentidos y su diagrama se vuelve inmanejable.

El modelado correcto: el ESTADO del crédito es en_mora; el TRAMO es un atributo derivado que se calcula desde díasDeAtraso en cada cierre ( una regla de clasificación componible y verificable por separado).

Regla general de diseño: no modele como estado lo que puede calcularse. Un estado guarda una decisión o un hecho irreversible sin recalcular (aprobado, incobrable); una clasificación se deriva de los datos vigentes. Confundirlos duplica la fuente de verdad — y dos fuentes de verdad siempre divergen.

Sus pruebas unitarias deben cubrir la reversibilidad: un crédito con 45 días de atraso (Mora 2) que recibe un pago que deja su atraso en 10 días debe clasificar en Mora 1; si paga todo lo vencido, debe volver a vigente.


- Regla: Las transiciones inválidas deben ser imposibles por diseño (patrón State), no evitadas con un if. Un crédito 'solicitado' no puede recibir un pago; uno 'cancelado' no puede entrar en mora.

- Regla: Todo cambio de estado se registra con fecha, usuario/proceso y motivo (trazabilidad para auditoría). El historial de estados nunca se borra.

- Regla: La reestructuración NO borra el pasado: el crédito queda marcado y sigue contando como cartera en riesgo aunque esté al día (sección 6.8). La transición reestructurado → vigente es operativa, no estadística.

- Regla: Declarar un crédito incobrable (más de 120 días) es una baja CONTABLE, no un perdón: el crédito sale de la cartera y su gestión se terceriza a una casa de cobro externa. Lo que ella recupere se registra como recuperación de incobrable, en cuenta separada; el crédito no regresa a la cartera.

## 6.8 Cartera en riesgo (calidad de la cartera)

La institución necesita saber qué parte de su cartera está en peligro de no recuperarse. A ese indicador lo llamamos cartera en riesgo: mide cuánto dinero está comprometido en créditos que se han atrasado lo suficiente como para preocupar. Es el número que la gerencia mira primero cada mañana.

## Cómo se calcula la cartera en riesgo — lea cada matiz

Qué se suma (el riesgo): el saldo de capital COMPLETO de todo crédito que tenga al menos una cuota con más de 30 días de atraso. No es solo la cuota vencida: es todo lo que ese cliente aún debe, incluidas las cuotas futuras, porque si dejó de pagar, todo su saldo está en riesgo. No se cuentan los intereses, solo el capital.

Qué más se suma: los créditos reestructurados, aunque estén al día bajo sus nuevas condiciones. Un crédito al que hubo que cambiarle las reglas para que el cliente pudiera pagar sigue siendo más riesgoso que uno normal.

Contra qué se compara: contra el total de la cartera de créditos activos. Los créditos ya declarados incobrables (más de 120 días, dados de baja) NO entran en esa base, porque ya salieron de la cartera.

El resultado se expresa como porcentaje: cartera en riesgo ÷ cartera total activa. Un 7% significa que 7 de cada 100 quetzales prestados están en créditos preocupantes.

## 6.8.1 Ejemplo resuelto (caso de referencia obligatorio)

Una cartera de siete créditos. La última columna marca cuáles cuentan como en riesgo y por qué:

| Crédito | Saldo de capital (Q) | Días de atraso | Reestructurado | ¿En riesgo? |
| --- | --- | --- | --- | --- |
| C-001 | 620,000.00 | 0 | No | No |
| C-002 | 124,000.00 | 8 | No | No |
| C-003 | 24,000.00 | 45 | No | Sí |
| C-004 | 18,000.00 | 75 | No | Sí |
| C-005 | 8,000.00 | 100 | No | Sí |
| C-006 | 6,000.00 | 0 | Sí | Sí |
| C-007 | 15,000.00 | 210 | Incobrable | Excluido |

Cartera activa = 620,000 + 124,000 + 24,000 + 18,000 + 8,000 + 6,000 = Q800,000.00

(C-007 es incobrable: ya salió de la cartera, NO entra)

En riesgo

= 24,000 + 18,000 + 8,000 + 6,000 = Q56,000.00

C-002 tiene 8 días de atraso

→ NO entra (no supera 30).

C-006 está al día PERO reestructurado → SÍ entra.


Cartera en riesgo = 56,000 / 800,000 = 7.00 %

## La trampa de dar por incobrable — inclúyala en su diseño

Suponga que la institución declara incobrable el crédito C-005 (Q8,000, 100 días de atraso). El monto en riesgo baja a Q48,000 y la cartera activa a Q792,000.

Cartera en riesgo = 48,000 / 792,000 = 6.06 %. El indicador “mejora” de 7.00% a 6.06% sin haber cobrado un solo quetzal: solo se escondió el crédito malo debajo de la alfombra.

Por eso el porcentaje de cartera en riesgo nunca se reporta solo: debe ir acompañado de cuánto se dio por incobrable en el período. Su cierre mensual debe reportar ambos, o la gerencia tomará decisiones sobre una ilusión.

## 6.9 Cierres diario y mensual

- Cierre diario: desembolsos del día, recuperaciones (cobros) por concepto, devengo de interés, marcación de mora y saldo de cartera.

- Cierre mensual: todo lo anterior consolidado, más la cartera en riesgo por tramo, lo dado por incobrable en el período, provisiones, créditos activos y vencimientos próximos.

- Regla: un cierre congela las cifras del período con una fecha de corte. Reejecutar el cierre del mismo día debe producir el mismo resultado (idempotencia) y no duplicar movimientos.

- Regla de mayor: los saldos nunca se sobrescriben. Se registran movimientos y el saldo es el resultado de acumularlos. Así, cualquier cifra de un cierre se puede reconstruir y auditar meses después.

## 6.10 Invariantes del dominio

Reglas que deben cumplirse SIEMPRE. Cada una es candidata natural a prueba unitaria:

- La suma de las amortizaciones de un plan es exactamente igual al capital desembolsado.

- El saldo tras la última cuota es exactamente 0.00.

- Ningún saldo de capital es negativo.

- Un pago nunca puede aplicarse a un crédito en estado 'solicitado' o 'rechazado'.

- El porcentaje de cartera en riesgo siempre está entre 0 y 1 (0% y 100%).

- La suma de los movimientos del mayor reproduce el saldo reportado en el cierre.

- Registrar dos veces el mismo pago (misma clave de idempotencia) no altera el saldo.

- Un crédito en_mora cuyo atraso llega a 0 queda vigente; el tramo de mora siempre corresponde a los días de atraso vigentes (clasificación derivada, en ambas direcciones).

- Ningún interés se calcula sobre intereses: el moratorio se aplica solo a capital en mora (prohibición de anatocismo).


## 7. Arquitectura de referencia

Usted debe justificar su arquitectura, no copiarla. Sin embargo, dada la naturaleza del dominio y la evolución prevista del proyecto, se establece una arquitectura de referencia. Si propone otra, deberá argumentar por qué satisface mejor los atributos de calidad — y esa argumentación es evaluable.

## 7.1 Arquitectura hexagonal (puertos y adaptadores)

## Por qué esta arquitectura y no otra

- Exactitud y comprobabilidad: el núcleo no depende de base de datos ni de red, así que se prueba con funciones puras, en milisegundos y sin infraestructura. En un dominio donde cada centavo importa, poder ejecutar cientos de casos de cálculo en segundos no es un lujo.

- Evolución hacia el Proyecto Final: aquí está el argumento decisivo. En el Proyecto Final, el servidor MCP y el chat no son una reescritura: son adaptadores primarios nuevos que invocan los mismos puertos que ya existen. Su arquitectura de agosto sobrevive intacta hasta octubre.

- Una sola fuente de verdad: el asistente y la API responden exactamente lo mismo porque ejecutan el mismo caso de uso. Si el cálculo viviera en el controlador REST, el asistente tendría que duplicarlo — y dos implementaciones del mismo cálculo divergen siempre.

- El puerto Reloj: la mora depende de “hoy”. Si el núcleo lee la fecha del sistema directamente, la prueba pasa hoy y falla mañana. El Reloj es un puerto secundario que se inyecta; en pruebas se usa un reloj fijo.

## Sobre microservicios

Los microservicios NO son la respuesta correcta aquí, y proponerlos sin justificación se penaliza. Repartir un desembolso

y su asiento contable entre dos servicios convierte una transacción local en un problema de consistencia distribuida. La recomendación es un monolito modular: un solo desplegable, con módulos de frontera explícita (Originación, Cartera

y Cobros, Cierres, Reportería). Si más adelante un módulo necesita escalar aparte, la frontera ya existe.


Si aun así elige microservicios, deberá explicar cómo garantiza la consistencia de los movimientos de dinero. Es una pregunta legítima de la defensa.

## 7.2 Módulos (contextos) del Sistema

| Módulo | Responsabilidad única | No le corresponde |
| --- | --- | --- |
| Originación | Cliente, solicitud, evaluación, aprobación y desembolso. Calcular mora o cierres. |   |
| Cálculo financiero | Plan de amortización, interés corriente y moratorio, redondeo. Funciones puras. | Persistir o consultar datos. |
| Cartera y cobros | Registro de pagos, prelación, saldos, clasificación por tramos de mora. | Definir la política de tasas. |
| Cierres | Cierre diario y mensual, cartera en riesgo, provisiones, congelamiento del período. | Modificar créditos. |
| Contratos / API | Exposición de los casos de uso hacia el exterior. | Contener reglas de negocio. |

## 8. Stack tecnológico (JavaScript / TypeScript)

El proyecto integrador usa JavaScript de extremo a extremo: un solo lenguaje en el frontend, el backend, el RAG y el servidor MCP. Esto reduce el costo de aprendizaje y permite compartir tipos y validaciones entre capas.

| Capa | Herramienta | Fase | Nota |
| --- | --- | --- | --- |
| Runtime | Node.js 20 LTS o superior | P1 | Base de todo el stack. |
| Lenguaje | TypeScript en modo strict — OBLIGATORIO | P1 | Ver nota 8.1. |
| Pruebas | Vitest (o Jest) | P1 | Rápido, sin configuración. |
| Dinero | decimal.js, big.js o enteros en centavos | P1 | Nunca Number (ver 6.2). |
| Fechas | date-fns o Luxon | P1 | No use Date nativo para aritmética de días. |
| Validación | Zod | P1 / Final | Ver nota 8.2. |
| Diagramas | PlantUML, Mermaid, draw.io, C4 | P1 | En forma editable. |
| API | OpenAPI / Swagger Editor | P1 / Final | Contrato primero. |
| Prototipo | Figma (plan gratuito) | P2 | Prototipo navegable. |
| Backend | Express 5 o Fastify | Final | Adaptador primario. |
| Frontend | React + Vite + Tailwind CSS | Final | Adaptador primario. |
| Base de datos | PostgreSQL + pgvector | Final | Datos y vectores juntos. |
| Acceso a datos | pg, Prisma o Drizzle | Final | Adaptador secundario. |
| RAG | LangChain.js o LlamaIndex.TS | Final | Orquestación. |
| Servidor MCP | @modelcontextprotocol/sdk | Final | SDK oficial en TypeScript. |
| Modelo de lenguaje | Ollama (local) o Gemini / Groq | Final | Local para datos sensibles. |
| CI | GitHub Actions | Final | Pruebas automáticas. |


## 8.1 · TypeScript es obligatorio (no se admite JavaScript plano)

En un dominio financiero, el compilador es su primera prueba. TypeScript impide que un Dinero se sume a un number, que se pase una fecha donde va un identificador, o que se olvide un caso del estado del crédito. Son exactamente los errores que producen descuadres.

Sigue siendo JavaScript: compila a JS y corre en Node. No cambia el ecosistema, solo lo hace verificable.

Requisito mínimo del tsconfig.json: "strict": true. Se entrega el proyecto con esa configuración activa.

El uso de `any` para evadir el tipado en el núcleo de dominio se considera un defecto de diseño y se penaliza. Si necesita un tipo flexible, use genéricos o uniones discriminadas.

## 8.2 · Por qué Zod aparece desde el Proyecto 1

Un esquema Zod se escribe una vez y sirve tres veces: valida la entrada de la API, genera la especificación OpenAPI, y define el esquema de las herramientas del servidor MCP en el Proyecto Final.

Es la pieza que hace que el contrato diseñado en agosto sea literalmente el mismo que el asistente use en octubre.

## 9. Patrones de diseño exigidos

Debe aplicar y justificar como mínimo cuatro patrones, de los cuales al menos dos deben ser GoF (Semana 5). No basta con nombrarlos: debe mostrarse dónde viven en su diseño y qué problema resuelven. La tabla siguiente indica los que el dominio pide de forma natural.

| Patrón | Dónde aplicarlo | Qué problema resuelve |
| --- | --- | --- |
| Objeto de Valor (Dinero) | Todo importe monetario | Elimina el error de punto flotante e impide mezclar monedas. Inmutable. |
| Strategy (GoF) | Método de interés: francés, sobre saldos, fijo | OCP: agregar un método nuevo sin tocar el motor de cálculo. La política es intercambiable. |
| Chain of Responsibility (GoF) | Prelación de pagos (6.6) | Cada concepto consume lo suyo y pasa el remanente. Cambiar el orden = reordenar la cadena. |
| State (GoF) | Ciclo de vida del crédito (6.7) | Las transiciones inválidas se vuelven imposibles por diseño, no por un if. |
| Factory / Builder (GoF) | Construcción del PlanAmortizacion | Encapsula la construcción compleja y garantiza los invariantes (Σ amortizaciones = P). |
| Template Method (GoF) | Cierre diario vs. mensual | Mismo esqueleto de proceso, pasos distintos. Evita duplicar la lógica de corte. |
| Repository | Puerto secundario de persistencia | DIP: el dominio depende de una interfaz, no de PostgreSQL. Permite un repositorio en memoria para pruebas. |
| Specification | Clasificación por tramos, elegibilidad | Reglas de negocio componibles y verificables por separado. |
| Eventos de dominio / Observer | CreditoDesembolsado, CuotaVencida | Desacopla Cartera de Cierres. Base del mayor append-only (6.9). |

*Advertencia sobre sobrediseño: aplicar los nueve patrones no da más nota. Un patrón mal motivado es un defecto de diseño, no un mérito. Se evalúa la pertinencia de la elección, no la cantidad.*


## 10. Entregables

Seis entregables (E1–E6). Cada uno indica su contenido mínimo y sus criterios de aceptación.

## E1 · Modelo del dominio en UML

- Casos de uso: actores y los casos principales (Registrar cliente, Solicitar crédito, Evaluar/aprobar, Desembolsar, Registrar pago, Generar cierre, Consultar cartera en riesgo).

- Clases del dominio: Cliente, SolicitudCredito, Credito, PlanAmortizacion, Cuota, Pago, Movimiento, Cierre, Dinero, con atributos, relaciones y multiplicidades.

- Secuencia: mínimo dos escenarios. Obligatorio “Registrar pago de cuota” mostrando la prelación de la sección 6.6.

- Estados: el ciclo de vida completo del crédito, cubriendo TODAS las transiciones de la tabla 6.7.1 — incluidas las de regularización (mora → vigente, vencido → en_mora/vigente, reestructurado → en_mora) — con sus eventos y guardas.

- Actividades: el proceso de originación o el flujo del cierre mensual.

- Matriz de trazabilidad requisito → caso de uso → clase (plantilla en el Anexo B).

## Aceptación de E1

Notación UML válida y consistente: toda clase que aparece en un diagrama de secuencia existe en el de clases.

Los diagramas se entregan en forma editable (código PlantUML/Mermaid o archivo draw.io), no solo como imagen.

## E2 · Decisión y justificación de la arquitectura

- Priorización de atributos de calidad (ISO/IEC 25010) con justificación para este dominio.

- Estilo arquitectónico elegido, argumentado frente a esos atributos y frente a la evolución hacia el Proyecto Final. Si se aparta de la arquitectura de referencia (sección 7), debe argumentarlo.

- Vista 4+1: obligatorias la vista lógica y la de escenarios, más una adicional (desarrollo o proceso).

- Modelo C4: Nivel 1 (Contexto), Nivel 2 (Contenedores) y Nivel 3 (Componentes) del contenedor principal.

- El diagrama C4 debe mostrar explícitamente dónde se conectarán el servidor MCP y el chat en el Proyecto Final.

## E3 · Diseño de componentes y principios

- Descomposición en módulos con responsabilidad única (sección 7.2), con sus interfaces.

- Diseño detallado del módulo de Cálculo financiero a nivel de clases.

- Aplicación explícita de SOLID y GRASP, indicando dónde y por qué (no basta enumerarlos).

- Mínimo cuatro patrones de la sección 9, dos de ellos GoF, con su diagrama.

- Análisis de cohesión y acoplamiento por módulo.

## E4 · Núcleo de cálculo ejecutable (walking skeleton)

Este es el entregable que distingue un diseño validado de un diseño supuesto. Implemente en TypeScript, como funciones puras, únicamente el núcleo de dominio:

src/dominio/

dinero.ts

→ Objeto de Valor Dinero (6.2)


```
plan-amortizacion.ts → Strategy francés + ajuste de última cuota (6.4)
calculadora-mora.ts → interés moratorio y tramos (6.5)
prelacion-pago.ts → Chain of Responsibility (6.6)
cartera.ts → cartera en riesgo (6.8)
tests/
plan-amortizacion.test.ts → incluye el caso de referencia 6.4.1
cartera.test.ts → incluye el caso de referencia 6.8.1
Se ejecuta con: npm test (no requiere base de datos ni servidor)
```

- Pruebas obligatorias: Reproducir exactamente la tabla de amortización de la sección 6.4.1, las 12 filas.

- Pruebas obligatorias: Verificar los invariantes de la sección 6.10 (mínimo: Σ amortizaciones = P, y saldo final = 0.00).

- Pruebas obligatorias: Reproducir la cartera en riesgo de 7.00% del caso 6.8.1, y el 6.06% tras dar por incobrable el crédito C-005.

- Pruebas obligatorias: Reproducir el interés moratorio de Q7.26 del ejemplo de la sección 6.5.

- Pruebas obligatorias: Verificar la reversibilidad del ciclo de vida (sección 6.7): un crédito con 45 días de atraso (Mora 2) que paga y queda con 10 días clasifica en Mora 1; si paga todo lo vencido, vuelve a vigente; y una transición inválida (p. ej. pagar un crédito solicitado) es rechazada por diseño.

## Aceptación de E4 — léalo antes de programar

PROHIBIDO en este entregable: servidor HTTP, base de datos, interfaz gráfica, autenticación, RAG, MCP. Si su código importa `express` o `pg`, se salió del alcance y se penaliza.

El núcleo no debe leer la fecha del sistema: la fecha de corte se recibe como parámetro (puerto Reloj). Una prueba que falla mañana no es una prueba.

`npm install && npm test` debe correr en limpio y pasar. Un núcleo que no compila o cuyas pruebas fallan se califica como diseño no validado.

No se evalúa la cantidad de código, sino que el diseño de E3 y el código de E4 sean el mismo diseño.

## E5 · Contratos de la API y ADR

- Contratos de los recursos principales: Clientes, Solicitudes, Créditos, Pagos, Cierres y Cartera en riesgo, con método, ruta, propósito, petición y respuesta.

- Manejo de errores con una convención uniforme y códigos de estado coherentes.

- Clave de idempotencia en el registro de pagos: reintentar el mismo pago no debe cobrar dos veces (invariante 6.10).

- Mínimo dos ADR con la plantilla del Anexo A. Obligatorio uno sobre el estilo arquitectónico y otro sobre la representación del dinero o el método de interés.

Nivel esperado: la especificación en OpenAPI se trabaja en el taller de la Semana 6, una semana antes de la entrega. Por eso se entrega el contrato en OpenAPI (YAML o JSON), validado en Swagger Editor. Los esquemas deben derivarse de Zod (ver nota 8.2).

## E6 · Documento de arquitectura y repositorio

- Documento en PDF que consolide E1–E5, con portada, índice y diagramas legibles.

- Repositorio en GitHub o GitLab con el código de E4, los diagramas editables, la carpeta de ADR y un README con instrucciones de ejecución (estructura en el Anexo C).


## 11. Rúbrica de evaluación (10 puntos)

Rúbrica analítica. Los cuatro criterios y sus pesos son los establecidos en la guía didáctica del curso. El núcleo ejecutable (E4) se evalúa como evidencia dentro del criterio de diseño de componentes: es la prueba de que el diseño funciona.

| Criterio / peso | Excelente | Aceptable | Insuficiente |
| --- | --- | --- | --- |
| Modelado UML del dominio y trazabilidad 2 pts | Los cinco diagramas correctos y consistentes entre sí; el de estados cubre las transiciones de regularización de la tabla 6.7.1; la secuencia de pago refleja la prelación; trazabilidad completa. (1.6–2.0) | Diagramas presentes con errores menores u omisiones; trazabilidad parcial. (0.8–1.5) | Faltan diagramas, hay errores de notación o no hay trazabilidad. (0– 0.7) |
| Justificación de la arquitectura (4+1 / C4) 3 pts | Atributos priorizados y argumentados; estilo justificado frente a ellos y a la evolución al Proyecto Final; 4+1 y C4 (N1–N3) coherentes; punto de extensión de IA explícito. (2.4–3.0) | Justificación superficial o vistas incompletas; C4 sin nivel de componentes. (1.2–2.3) | Decisión no justificada; faltan 4+1 o C4; microservicios propuestos sin argumento. (0–1.1) |
| Diseño de componentes, principios y núcleo ejecutable 3 pts | Módulos con responsabilidad única; SOLID/GRASP aplicados; ≥4 patrones pertinentes (≥2 GoF); el núcleo corre, pasa todas las pruebas obligatorias y coincide con el diseño documentado. (2.4–3.0) | Descomposición razonable; principios poco justificados; el núcleo corre pero falla alguna prueba o se desvía del diseño. (1.2– 2.3) | Módulos acoplados; patrones solo mencionados; el núcleo no compila, no pasa pruebas o no se entregó. (0–1.1) |
| Contratos de API, ADR y calidad del documento 2 pts | OpenAPI válido, coherente con el dominio, con manejo de error e idempotencia; ≥2 ADR con plantilla y consecuencias claras; documento y repositorio profesionales. (1.6–2.0) | Contrato solo en Markdown o OpenAPI incompleto; ADR parciales; documento mejorable. (0.8–1.5) | Sin API o sin ADR; documento desordenado o repositorio inaccesible. (0–0.7) |
| Total | 10 puntos |   |   |

## Penalizaciones específicas

- Usar Number de punto flotante para importes monetarios: −0.5 pts (viola la sección 6.2).

- Incluir servidor, base de datos o interfaz en E4: −0.5 pts (viola el alcance de la sección 5).

- La última cuota no ajustada o saldo final distinto de cero: −0.5 pts (viola el invariante 6.4).

- Diagrama de estados sin las transiciones de regularización (solo deterioro, sin retorno): −0.5 pts (viola la sección 6.7).

- Uso de `any` en el núcleo de dominio o tsconfig sin strict: −0.5 pts (viola la sección 8.1).

- Repositorio inaccesible o pruebas que no ejecutan: se califica el criterio 3 como insuficiente.

## 12. Formato y entrega

- Documento en PDF con portada (nombre completo, carné, sección, fecha) e índice.

- Enlace al repositorio en la portada del documento; debe abrir sin solicitar permisos.

- Nombre del archivo: P1_Arquitectura_NoDeGrupo.pdf

- Entrega por Canvas, tarea “Proyecto 1 — Arquitectura y diseño de componentes”.


## 13. Integridad académica y uso de IA

- Se permite usar herramientas de IA como apoyo, pero usted debe comprender y defender todo el contenido. Declare las herramientas utilizadas en el README.

- Se le puede pedir que explique cualquier línea de su núcleo de cálculo o cualquier decisión de su ADR. No poder hacerlo se trata como falta de integridad académica conforme al reglamento de la Universidad.

## 14. Anexos

## Anexo A · Plantilla de ADR

| Campo | Contenido |
| --- | --- |
| Título | ADR-001: decisión en una frase (p. ej. “Representación de importes monetarios”) |
| Estado | Propuesta / Aceptada / Reemplazada por ADR-00X |
| Fecha | dd/mm/aaaa |
| Contexto | Situación y fuerzas en juego: requisitos, atributos de calidad, restricciones. |
| Decisión | Qué se decide y por qué. Alternativas consideradas y motivo del descarte. |
| Consecuencias | Efectos positivos y negativos; compromisos (trade-offs) asumidos. |

## Anexo B · Matriz de trazabilidad (plantilla)

| Requisito | Caso de uso | Clase / módulo |
| --- | --- | --- |
| R1: Registrar y consultar clientes | Registrar cliente | Cliente · Originación |
| R2: Otorgar créditos con plan de cuotas | Solicitar / Desembolsar crédito | Credito · PlanAmortizacion · Cuota |
| R3: Registrar pagos aplicando prelación | Registrar pago de cuota | Pago · PrelacionPago · Movimiento |
| R4: Calcular mora e interés moratorio | Calcular mora | CalculadoraMora |
| R5: Reportar cierres y cartera en riesgo | Generar cierre / Consultar cartera en riesgo | Cierre · Cartera |

*Ejemplo ilustrativo; complétela con los requisitos y clases de su propio diseño.*

## Anexo C · Estructura sugerida del repositorio

| microcredito-p1/ |   |
| --- | --- |
| ├── README.md | descripción, ejecución, herramientas de IA usadas |
| ├── package.json | scripts: test |
| ├── tsconfig.json | strict: true (obligatorio) |
| ├── src/dominio/ | núcleo puro (E4) — sin infraestructura |
| ├── tests/ | pruebas unitarias, incluidos los casos de referencia |
| └── docs/ |   |
| ├── arquitectura.pdf | documento consolidado (E6) |
| ├── diagramas/ | UML y C4 en forma editable |
| ├── adr/ | ADR-001.md, ADR-002.md |
| └── api/ | contratos (Markdown u OpenAPI) |

## Anexo D · Glosario


| Término | Definición |
| --- | --- |
| Desembolso | Entrega del capital al cliente; origina el saldo y el plan de amortización. |
| Amortización francesa | Método de cuota fija donde varía la composición capital/interés. |
| Mora | Atraso en el pago de una cuota, medido en días desde su vencimiento. |
| Anatocismo | Cobro de intereses sobre intereses; prohibido en Guatemala por el Código Civil (Decreto-Ley 106). |
| Regularización | Retorno de un crédito moroso o vencido a la cartera sana al pagar lo vencido. |
| Recuperación de incobrable | Cobro posterior a declarar el crédito incobrable; lo gestiona la casa de cobro externa y se registra en cuenta separada, sin reactivar el crédito. |
| Interés en suspenso | Interés corriente que deja de reconocerse como ingreso al superar 90 días de atraso. |
| Prelación | Orden en que un pago se aplica a los conceptos adeudados. |
| Cartera en riesgo | Saldo de capital de los créditos con más de 30 días de atraso (más los reestructurados), dividido entre la cartera activa total. Se reporta junto con lo dado por incobrable en el período. |
| Incobrable | Crédito con más de 120 días de atraso que se da de baja contablemente y sale de la cartera; su cobro se terceriza a una casa de cobro externa. |
| Devengo | Reconocimiento del interés conforme transcurre el tiempo, se cobre o no. |
| Cierre | Proceso que consolida y congela los totales de un período. |
| Idempotencia | Propiedad por la que repetir una operación no cambia el resultado. |
| Oráculo (pruebas) | Valor esperado calculado de forma independiente, contra el que se verifica el sistema. |
| Walking skeleton | Porción mínima, real y ejecutable que atraviesa la parte más riesgosa del diseño. |

— Fin del enunciado del Proyecto 1 —

Universidad Mariano Gálvez de Guatemala · Análisis de Sistemas II (037) · Segundo semestre 2026
