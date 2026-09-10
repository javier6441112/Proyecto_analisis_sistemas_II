import { Decimal } from 'decimal.js';
import { Dinero } from '../dinero.js';

export type TramoMora = 'AL_DIA' | 'MORA_1' | 'MORA_2' | 'MORA_3' | 'VENCIDO' | 'INCOBRABLE';

export interface PoliticaMora {
  readonly id: string;
  readonly nombre: string;
  readonly vigenteDesde: string;
  calcular(capitalEnMora: Dinero, diasAtraso: number): Dinero;
}

export function redondearDinero(valor: Decimal, moneda: 'GTQ' | 'USD' = 'GTQ'): Dinero {
  return Dinero.de(valor.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2), moneda);
}
