import { Decimal } from 'decimal.js';
import { Dinero } from '../dinero.js';
import { redondearDinero, type DesgloseMora, type PoliticaMora } from './politica-mora.js';

export class PoliticaPlana implements PoliticaMora {
  readonly id: string = 'POL-2024-01';
  readonly nombre: string = 'Plana 24%';
  readonly vigenteDesde: string = '2024-01-01';
  readonly tasaDiaria: Decimal;

  constructor(readonly tasaNominalAnual = new Decimal('0.24')) {
    this.tasaDiaria = tasaNominalAnual.div(360);
  }

  calcular(capitalEnMora: Dinero, diasAtraso: number): Dinero {
    return this.desglosar(capitalEnMora, diasAtraso).totalMoratorio;
  }

  desglosar(capitalEnMora: Dinero, diasAtraso: number): DesgloseMora {
    if (capitalEnMora.valor.isNegative()) throw new Error('El capital en mora no puede ser negativo');
    if (!Number.isInteger(diasAtraso) || diasAtraso < 0) throw new Error('Los días de atraso deben ser enteros no negativos');
    const diasEfectivos = Math.min(diasAtraso, 120);
    const importeSinRedondear = capitalEnMora.valor.times(this.tasaDiaria).times(diasEfectivos);
    const tramos = diasEfectivos === 0 ? [] : [{
      tramo: 'PLANA',
      dias: diasEfectivos,
      tasaNominalAnual: this.tasaNominalAnual,
      tasaDiaria: this.tasaDiaria,
      importeSinRedondear,
    }];
    return {
      capitalEnMora,
      diasAtraso,
      diasEfectivos,
      incobrable: diasAtraso > 120,
      tramos,
      totalSinRedondear: importeSinRedondear,
      totalMoratorio: redondearDinero(importeSinRedondear, capitalEnMora.moneda),
    };
  }
}
