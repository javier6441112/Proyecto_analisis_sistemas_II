# Casos de uso del sistema

```mermaid
flowchart LR
    cliente[Cliente]
    asesor[Asesor de credito]
    comite[Comite de credito]
    caja[Oficial de caja]
    gerente[Gerencia]
    casa[Caso de cobro externa]

    subgraph sistema[Sistema de Gestion de Microcredito]
        UC01((UC-01<br/>Registrar cliente))
        UC02((UC-02<br/>Solicitar credito))
        UC03((UC-03<br/>Evaluar y aprobar credito))
        UC04((UC-04<br/>Desembolsar credito))
        UC05((UC-05<br/>Registrar pago de cuota))
        UC06((UC-06<br/>Calcular mora))
        UC07((UC-07<br/>Generar cierre))
        UC08((UC-08<br/>Consultar cartera en riesgo))
        UC09((UC-09<br/>Registrar recuperacion de incobrable))
    end

    cliente --> UC01
    cliente --> UC02
    cliente --> UC05
    asesor --> UC01
    asesor --> UC02
    asesor --> UC03
    comite --> UC03
    asesor --> UC04
    caja --> UC05
    caja --> UC09
    gerente --> UC07
    gerente --> UC08
    casa --> UC09

    UC05 -. <<include>> .-> UC06
    UC07 -. <<include>> .-> UC08
```

## Alcance

`UC-06` y `UC-08` son calculos del nucleo actual. Los casos de uso de originacion, cierre, persistencia y recuperacion son contratos del dominio futuro y no implican que exista un servidor o base de datos en E4.
