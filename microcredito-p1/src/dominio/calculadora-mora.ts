import { differenceInCalendarDays, parseISO } from 'date-fns';
import { Decimal } from 'decimal.js';
import { Dinero } from './dinero.js';

export type TramoMora = 'AL_DIA' | 'MORA_1' | 'MORA_2' | 'MORA_3' | 'VENCIDO' | 'INCOBRABLE';

export interface Mora {
  diasAtraso: number;
  tramo: TramoMora;
  interesMoratorio: Dinero;
}

export function calcularDiasAtraso(vencimiento: string, corte: string): number {
  return Math.max(0, differenceInCalendarDays(parseISO(corte), parseISO(vencimiento)));
}

export function clasificarMora(diasAtraso: number): TramoMora {
  if (diasAtraso <= 0) return 'AL_DIA';
  if (diasAtraso <= 30) return 'MORA_1';
  if (diasAtraso <= 60) return 'MORA_2';
  if (diasAtraso <= 90) return 'MORA_3';
  if (diasAtraso <= 120) return 'VENCIDO';
  return 'INCOBRABLE';
}

export function calcularMora(
  capitalEnMora: Dinero,
  vencimiento: string,
  corte: string,
  tasaMoratoriaAnual: string | Decimal,
  baseDias = 360,
): Mora {
  if (baseDias <= 0) throw new Error('La base de dias debe ser positiva');
  const diasAtraso = calcularDiasAtraso(vencimiento, corte);
  const interes = capitalEnMora.multiplicar(new Decimal(tasaMoratoriaAnual).div(baseDias).times(diasAtraso));
  return { diasAtraso, tramo: clasificarMora(diasAtraso), interesMoratorio: interes };
}
