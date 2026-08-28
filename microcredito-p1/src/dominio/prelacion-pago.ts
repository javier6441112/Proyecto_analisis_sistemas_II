import { Dinero } from './dinero.js';

export interface Adeudo {
  gastos: Dinero;
  interesMoratorio: Dinero;
  interesCorriente: Dinero;
  capital: Dinero;
}

export interface AplicacionPago {
  aplicado: Adeudo;
  remanente: Dinero;
  cuotaSaldada: boolean;
}

export type DestinoExcedente = 'amortizacion_capital' | 'cuotas_futuras';

export interface AplicacionExcedente {
  destino: DestinoExcedente;
  montoAplicado: Dinero;
  saldoExcedente: Dinero;
}

export function aplicarPago(pago: Dinero, adeudo: Adeudo): AplicacionPago {
  if (pago.esCero() || pago.valor.isNegative()) throw new Error('El pago debe ser positivo');
  const rubrosValidos: Array<keyof Adeudo> = ['gastos', 'interesMoratorio', 'interesCorriente', 'capital'];
  for (const rubro of rubrosValidos) {
    if (adeudo[rubro].valor.isNegative()) throw new Error(`El adeudo de ${rubro} no puede ser negativo`);
    if (adeudo[rubro].moneda !== pago.moneda) throw new Error('El adeudo debe usar la moneda del pago');
  }
  const rubros: Array<keyof Adeudo> = ['gastos', 'interesMoratorio', 'interesCorriente', 'capital'];
  let remanente = pago;
  const aplicado: Adeudo = {
    gastos: Dinero.cero(pago.moneda),
    interesMoratorio: Dinero.cero(pago.moneda),
    interesCorriente: Dinero.cero(pago.moneda),
    capital: Dinero.cero(pago.moneda),
  };

  for (const rubro of rubros) {
    const consumo = remanente.menorQue(adeudo[rubro]) ? remanente : adeudo[rubro];
    aplicado[rubro] = consumo;
    remanente = remanente.restar(consumo);
  }

  return {
    aplicado,
    remanente,
    cuotaSaldada: rubros.every((rubro) => aplicado[rubro].valor.equals(adeudo[rubro].valor)),
  };
}

export function aplicarExcedente(excedente: Dinero, saldoCapital: Dinero, destino: DestinoExcedente): AplicacionExcedente {
  if (excedente.esCero() || excedente.valor.isNegative()) throw new Error('El excedente debe ser positivo');
  if (saldoCapital.valor.isNegative()) throw new Error('El saldo de capital no puede ser negativo');
  if (excedente.moneda !== saldoCapital.moneda) throw new Error('El excedente debe usar la moneda del capital');
  const montoAplicado = destino === 'amortizacion_capital'
    ? (excedente.menorQue(saldoCapital) ? excedente : saldoCapital)
    : Dinero.cero(excedente.moneda);
  return { destino, montoAplicado, saldoExcedente: excedente.restar(montoAplicado) };
}
