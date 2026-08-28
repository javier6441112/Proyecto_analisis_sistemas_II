# Estados del credito

Los tramos de mora son una clasificacion derivada de `diasAtraso`, no estados. Las transiciones invalidas deben quedar protegidas por el patron State en la implementacion futura.

```mermaid
stateDiagram-v2
    [*] --> solicitado

    solicitado --> aprobado: Comite aprueba [cumple politica]
    solicitado --> rechazado: Comite rechaza
    rechazado --> [*]

    aprobado --> vigente: Se desembolsa [capital entregado]
    aprobado --> anulado: Cliente desiste o expira [antes del desembolso]
    anulado --> [*]

    vigente --> en_mora: Vence cuota impagada [diasAtraso >= 1]
    vigente --> cancelado: Paga ultima cuota [saldo = 0.00]
    cancelado --> [*]

    en_mora --> vigente: Paga todo lo vencido [diasAtraso = 0]
    en_mora --> en_mora: Paga parte [diasAtraso baja pero > 0]
    en_mora --> en_mora: Sube de tramo [91..120 dias -> Vencido]
    en_mora --> reestructurado: Acuerdo autorizado [comite autoriza]

    reestructurado --> vigente: Cumple nuevo plan [politica de cura]
    reestructurado --> en_mora: Se atrasa en nuevo plan [diasAtraso >= 1]
    reestructurado --> cancelado: Paga ultima cuota [saldo = 0.00]

    en_mora --> incobrable: Supera 120 dias [sin arreglo]
    incobrable --> incobrable: Pago posterior [recuperacion separada]
    incobrable --> [*]

    note right of en_mora
        Tramos derivados:
        Mora 1: 1-30
        Mora 2: 31-60
        Mora 3: 61-90
        Vencido: 91-120
        Incobrable: >120
    end note
```

La transicion `incobrable --> incobrable` representa una recuperacion contable que no reactiva el credito ni lo devuelve a cartera.
