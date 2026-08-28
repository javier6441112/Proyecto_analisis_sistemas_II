import { Decimal } from 'decimal.js';
import { Dinero } from './dinero.js';

export interface Cuota {
  numero: number;
  saldoInicial: Dinero;
  pago: Dinero;
  interes: Dinero;
  amortizacion: Dinero;
  saldoFinal: Dinero;
}

export function calcularTasaEfectivaAnual(tasaMensual: string | Decimal): Decimal {
  const tasa = new Decimal(tasaMensual);
  if (!tasa.isFinite() || tasa.isNegative()) throw new Error('La tasa mensual debe ser finita y no negativa');
  return new Decimal(1).plus(tasa).pow(12).minus(1);
}

export interface PlanAmortizacion {
  capital: Dinero;
  cuotas: readonly Cuota[];
}

export function generarPlanFrances(
  capital: Dinero,
  tasaMensual: string | Decimal,
  numeroCuotas: number,
): PlanAmortizacion {
  if (numeroCuotas < 1 || !Number.isInteger(numeroCuotas)) throw new Error('El numero de cuotas debe ser entero positivo');
  const tasa = new Decimal(tasaMensual);
  if (tasa.isNegative()) throw new Error('La tasa no puede ser negativa');

  const factor = new Decimal(1).plus(tasa).pow(numeroCuotas);
  const pagoBase = tasa.isZero()
    ? capital.valor.div(numeroCuotas)
    : capital.valor.times(tasa).times(factor).div(factor.minus(1));
  const pagoRedondeado = Dinero.de(pagoBase, capital.moneda);
  const resultado: Cuota[] = [];
  let saldo = capital;

  for (let numero = 1; numero <= numeroCuotas; numero += 1) {
    const saldoInicial = saldo;
    const interes = Dinero.de(saldo.valor.times(tasa), capital.moneda);
    const amortizacion = numero === numeroCuotas
      ? saldo
      : pagoRedondeado.restar(interes);
    const pago = amortizacion.sumar(interes);
    saldo = saldo.restar(amortizacion);
    resultado.push({ numero, saldoInicial, pago, interes, amortizacion, saldoFinal: saldo });
  }

  return { capital, cuotas: resultado };
}
