# Modelo de dominio

El modelo distingue entidades del negocio de los servicios puros ya implementados en `src/dominio`.

```mermaid
classDiagram
    class Cliente {
        +string id
        +string nombre
        +string identificacion
        +registrar()
    }
    class SolicitudCredito {
        +string id
        +Dinero montoSolicitado
        +number numeroCuotas
        +string estado
        +solicitar()
        +aprobar()
    }
    class Credito {
        +string id
        +Dinero capital
        +string estado
        +number diasAtraso
        +desembolsar()
        +registrarPago()
        +reestructurar()
    }
    class PlanAmortizacion {
        +Dinero capital
        +Cuota[] cuotas
    }
    class Cuota {
        +number numero
        +Dinero saldoInicial
        +Dinero pago
        +Dinero interes
        +Dinero amortizacion
        +Dinero saldoFinal
    }
    class Pago {
        +string id
        +Dinero importe
        +string fecha
    }
    class Movimiento {
        +string id
        +string tipo
        +Dinero importe
        +string fecha
        +string motivo
    }
    class Cierre {
        +string periodo
        +string fechaCorte
        +Dinero carteraActiva
        +Dinero saldoEnRiesgo
        +Dinero incobrable
        +congelar()
    }
    class Dinero {
        <<Value Object>>
        +Decimal valor
        +Moneda moneda
        +sumar(otro) Dinero
        +restar(otro) Dinero
        +multiplicar(factor) Dinero
    }
    class Adeudo {
        +Dinero gastos
        +Dinero interesMoratorio
        +Dinero interesCorriente
        +Dinero capital
    }
    class AplicacionPago {
        +Adeudo aplicado
        +Dinero remanente
        +boolean cuotaSaldada
    }
    class generarPlanFrances {
        <<funcion pura E4>>
    }
    class calcularMora {
        <<funcion pura E4>>
    }
    class aplicarPago {
        <<funcion pura E4>>
    }
    class resumirCartera {
        <<funcion pura E4>>
    }

    Cliente "1" --> "0..*" SolicitudCredito : presenta
    SolicitudCredito "1" --> "0..1" Credito : origina
    Credito "1" *-- "1" PlanAmortizacion : contiene
    PlanAmortizacion "1" *-- "1..*" Cuota : contiene
    Cuota "1" --> "1" Dinero : valores
    Credito "1" --> "0..*" Pago : recibe
    Pago "1" --> "1..*" Movimiento : genera
    Credito "1" --> "0..*" Movimiento : historial
    Cierre "1" --> "0..*" Credito : consolida
    Adeudo "1" --> "4" Dinero : rubros
    Pago ..> Adeudo : aplica
    aplicarPago ..> AplicacionPago : produce
    generarPlanFrances ..> PlanAmortizacion : construye
    calcularMora ..> Dinero : calcula
    resumirCartera ..> Credito : resume
```

## Reglas representadas

- `Dinero` es inmutable, usa `decimal.js`, redondea a dos decimales y valida moneda.
- `generarPlanFrances` ajusta la ultima amortizacion para dejar saldo cero.
- `calcularMora` usa exclusivamente capital en mora y una base de dias parametrizable.
- `aplicarPago` aplica gastos, moratorio, corriente y capital, en ese orden.
- `resumirCartera` excluye incobrables de cartera activa y conserva reestructurados como riesgo.
