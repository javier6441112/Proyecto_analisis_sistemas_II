import { Decimal } from 'decimal.js';
import { Dinero } from '../dinero.js';
import { redondearDinero, type PoliticaMora } from './politica-mora.js';

export class PoliticaPlana implements PoliticaMora {
  readonly id = 'POL-2024-01';
  readonly nombre = 'Plana 24%';
  readonly vigenteDesde = '2024-01-01';
  readonly tasaDiaria = new Decimal('0.0006666666666666667');

  calcular(capitalEnMora: Dinero, diasAtraso: number): Dinero {
    if (capitalEnMora.valor.isNegative()) throw new Error('El capital en mora no puede ser negativo');
    if (!Number.isInteger(diasAtraso) || diasAtraso < 0) throw new Error('Los días de atraso deben ser enteros no negativos');
    if (diasAtraso === 0) return Dinero.cero(capitalEnMora.moneda);
    const totalSinRedondear = capitalEnMora.valor.times(this.tasaDiaria).times(diasAtraso);
    return redondearDinero(totalSinRedondear, capitalEnMora.moneda);
  }
}
