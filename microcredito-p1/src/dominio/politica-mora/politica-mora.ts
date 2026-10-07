import { Decimal } from 'decimal.js';
import { Dinero } from '../dinero.js';

export type TramoMora = 'AL_DIA' | 'MORA_1' | 'MORA_2' | 'MORA_3' | 'VENCIDO' | 'INCOBRABLE';

export interface PoliticaMora {
  readonly id: string;
  readonly nombre: string;
  readonly vigenteDesde: string;
  desglosar(capitalEnMora: Dinero, diasAtraso: number): DesgloseMora;
  calcular(capitalEnMora: Dinero, diasAtraso: number): Dinero;
  clasificar?(diasAtraso: number): string;
}

export interface DetalleMoraTramo {
  readonly tramo: string;
  readonly dias: number;
  readonly tasaNominalAnual: Decimal;
  readonly tasaDiaria: Decimal;
  readonly importeSinRedondear: Decimal;
}

export interface DesgloseMora {
  readonly capitalEnMora: Dinero;
  readonly diasAtraso: number;
  readonly diasEfectivos: number;
  readonly incobrable: boolean;
  readonly tramos: readonly DetalleMoraTramo[];
  readonly totalSinRedondear: Decimal;
  readonly totalMoratorio: Dinero;
}

export function redondearDinero(valor: Decimal, moneda: 'GTQ' | 'USD' = 'GTQ'): Dinero {
  return Dinero.de(valor.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2), moneda);
}
