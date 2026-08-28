# Arquitectura C4

## Contexto

```mermaid
C4Context
    title Sistema de Gestion de Microcredito - Contexto

    Person(cliente, "Cliente", "Solicita credito y realiza pagos")
    Person(asesor, "Asesor de credito", "Registra solicitudes y gestiona originacion")
    Person(comite, "Comite de credito", "Aprueba o rechaza solicitudes")
    Person(caja, "Oficial de caja", "Registra pagos")
    Person(gerencia, "Gerencia", "Consulta cierres y riesgo")
    Person(casa, "Casa de cobro", "Gestiona recuperaciones de incobrables")
    System(sistema, "Sistema de Gestion de Microcredito", "Gestiona originacion, calculo financiero, cobros y cierres")

    Rel(cliente, sistema, "Solicita credito y paga")
    Rel(asesor, sistema, "Gestiona solicitudes")
    Rel(comite, sistema, "Decide aprobaciones")
    Rel(caja, sistema, "Registra pagos")
    Rel(gerencia, sistema, "Consulta cierres y cartera en riesgo")
    Rel(casa, sistema, "Reporta recuperaciones")
```

## Contenedores logicos

```mermaid
C4Container
    title Sistema de Gestion de Microcredito - Contenedores

    Person(usuario, "Usuarios operativos", "Cliente, asesor, caja, comite y gerencia")
    System_Boundary(sistema, "Sistema de Gestion de Microcredito") {
        Container(contratos, "Contratos / API", "TypeScript", "Expone casos de uso; no contiene reglas de negocio")
        Container(originacion, "Modulo Originacion", "TypeScript", "Cliente, solicitud, evaluacion, aprobacion y desembolso")
        Container(calculo, "Modulo Calculo financiero", "TypeScript puro", "Plan, cuota, interes, mora y redondeo")
        Container(cobros, "Modulo Cartera y cobros", "TypeScript puro", "Pagos, prelacion, saldos y tramos")
        Container(cierres, "Modulo Cierres y reporteria", "TypeScript", "Cierres idempotentes y cartera en riesgo")
        ContainerDb(repositorio, "Puerto de persistencia", "Interfaz", "Adaptador futuro; fuera del alcance E4")
    }

    Rel(usuario, contratos, "Invoca casos de uso")
    Rel(contratos, originacion, "Solicita originacion")
    Rel(contratos, cobros, "Registra pago")
    Rel(contratos, cierres, "Genera cierre")
    Rel(originacion, calculo, "Construye plan")
    Rel(cobros, calculo, "Calcula mora")
    Rel(cierres, cobros, "Consulta saldos y riesgo")
    Rel(originacion, repositorio, "Usa puerto")
    Rel(cobros, repositorio, "Usa puerto")
    Rel(cierres, repositorio, "Usa puerto")
```

La arquitectura es un monolito modular con frontera hexagonal: el dominio no depende de HTTP, base de datos ni reloj del sistema. El walking skeleton actual es `calculo` y las funciones de `src/dominio`.

## Componentes del nucleo financiero y de cartera

```mermaid
C4Component
    title Aplicacion SGMC - Componentes del nucleo de dominio

    Container_Boundary(sgmc, "Aplicacion SGMC - Nucleo de dominio") {
        Component(dinero, "Dinero", "TypeScript / decimal.js", "Representa importes exactos en GTQ o USD")
        Component(plan, "Plan de amortizacion", "TypeScript", "Genera las cuotas del sistema frances y ajusta la ultima cuota")
        Component(mora, "Calculadora de mora", "TypeScript / date-fns", "Calcula dias de atraso, tramo e interes moratorio")
        Component(prelacion, "Prelacion de pagos", "TypeScript", "Aplica pagos a gastos, mora, interes corriente y capital")
        Component(cartera, "Cartera en riesgo", "TypeScript", "Calcula cartera activa, saldo en riesgo e incobrables")
    }

    Rel(plan, dinero, "Calcula y redondea importes")
    Rel(mora, dinero, "Calcula interes moratorio")
    Rel(prelacion, dinero, "Distribuye importes")
    Rel(cartera, dinero, "Acumula saldos")
```

El componente `Dinero` es el valor compartido del dominio; los demas componentes dependen de el y no conocen detalles de transporte o persistencia. La implementacion actual cubre calculo financiero, mora, prelacion de pagos y resumen de cartera como componentes independientes.
