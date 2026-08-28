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

export function aplicarPago(pago: Dinero, adeudo: Adeudo): AplicacionPago {
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
