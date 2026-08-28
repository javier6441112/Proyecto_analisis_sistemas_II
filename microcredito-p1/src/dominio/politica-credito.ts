import { Decimal } from 'decimal.js';
import { isValid, parseISO } from 'date-fns';

export interface PoliticaCredito {
  readonly id: string;
  readonly version: string;
  readonly vigenteDesde: string;
  readonly autor: string;
  readonly tasaOrdinariaMensual: Decimal;
  readonly tasaMoratoriaAnual: Decimal;
  readonly baseDias: number;
}

export function crearPoliticaCredito(entrada: Omit<PoliticaCredito, 'tasaOrdinariaMensual' | 'tasaMoratoriaAnual'> & {
  tasaOrdinariaMensual: string | Decimal;
  tasaMoratoriaAnual: string | Decimal;
}): PoliticaCredito {
  const tasaOrdinariaMensual = new Decimal(entrada.tasaOrdinariaMensual);
  const tasaMoratoriaAnual = new Decimal(entrada.tasaMoratoriaAnual);
  if (!entrada.id || !entrada.version || !entrada.vigenteDesde || !entrada.autor) throw new Error('La politica requiere identificacion, vigencia y autor');
  if (!isValid(parseISO(entrada.vigenteDesde))) throw new Error('La fecha de vigencia debe ser ISO valida');
  if (!tasaOrdinariaMensual.isFinite() || tasaOrdinariaMensual.isNegative()) throw new Error('La tasa ordinaria debe ser finita y no negativa');
  if (!tasaMoratoriaAnual.isFinite() || tasaMoratoriaAnual.isNegative()) throw new Error('La tasa moratoria debe ser finita y no negativa');
  if (!Number.isInteger(entrada.baseDias) || entrada.baseDias <= 0) throw new Error('La base de dias debe ser un entero positivo');
  return Object.freeze({ ...entrada, tasaOrdinariaMensual, tasaMoratoriaAnual });
}