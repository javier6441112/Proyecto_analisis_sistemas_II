import { differenceInCalendarDays, isValid, parseISO } from 'date-fns';
import { Decimal } from 'decimal.js';
import { Dinero } from './dinero.js';

export type TramoMora = 'AL_DIA' | 'MORA_1' | 'MORA_2' | 'MORA_3' | 'VENCIDO';

export interface Mora {
  diasAtraso: number;
  tramo: TramoMora;
  interesMoratorio: Dinero;
}

export function calcularDiasAtraso(vencimiento: string, corte: string): number {
  const fechaVencimiento = parseISO(vencimiento);
  const fechaCorte = parseISO(corte);
  if (!isValid(fechaVencimiento) || !isValid(fechaCorte)) throw new Error('Las fechas de mora deben ser validas');
  return Math.max(0, differenceInCalendarDays(fechaCorte, fechaVencimiento));
}

export function clasificarMora(diasAtraso: number): TramoMora {
  if (!Number.isInteger(diasAtraso) || diasAtraso < 0) throw new Error('Los dias de atraso deben ser enteros no negativos');
  if (diasAtraso === 0) return 'AL_DIA';
  if (diasAtraso <= 30) return 'MORA_1';
  if (diasAtraso <= 60) return 'MORA_2';
  if (diasAtraso <= 90) return 'MORA_3';
  if (diasAtraso <= 120) return 'VENCIDO';
  return 'VENCIDO';
}

export function calcularMora(
  capitalEnMora: Dinero,
  vencimiento: string,
  corte: string,
  tasaMoratoriaAnual: string | Decimal,
  baseDias = 360,
): Mora {
  const tasa = new Decimal(tasaMoratoriaAnual);
  if (!tasa.isFinite() || tasa.isNegative()) throw new Error('La tasa moratoria debe ser finita y no negativa');
  if (!Number.isInteger(baseDias) || baseDias <= 0) throw new Error('La base de dias debe ser un entero positivo');
  if (capitalEnMora.valor.isNegative()) throw new Error('El capital en mora no puede ser negativo');
  const diasAtraso = calcularDiasAtraso(vencimiento, corte);
  const interes = capitalEnMora.multiplicar(tasa.div(baseDias).times(diasAtraso));
  return { diasAtraso, tramo: clasificarMora(diasAtraso), interesMoratorio: interes };
}
