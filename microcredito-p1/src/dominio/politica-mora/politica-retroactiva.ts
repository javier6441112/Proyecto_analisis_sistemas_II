import { Dinero } from '../dinero.js';
import { Decimal } from 'decimal.js';
import { clasificarTramo } from './clasificacion-tramo.js';
import { redondearDinero, type DesgloseMora, type PoliticaMora } from './politica-mora.js';

export class PoliticaRetroactiva implements PoliticaMora {
  readonly id = 'POL-RETRO';
  readonly nombre = 'Retroactiva';
  readonly vigenteDesde = '2024-01-01';
  private readonly tasasAnuales = new Map<string, Decimal>([
    ['MORA_1', new Decimal('0.18')],
    ['MORA_2', new Decimal('0.24')],
    ['MORA_3', new Decimal('0.30')],
    ['VENCIDO', new Decimal('0.36')],
  ]);

  calcular(capitalEnMora: Dinero, diasAtraso: number): Dinero {
    return this.desglosar(capitalEnMora, diasAtraso).totalMoratorio;
  }

  desglosar(capitalEnMora: Dinero, diasAtraso: number): DesgloseMora {
    if (capitalEnMora.valor.isNegative()) throw new Error('El capital en mora no puede ser negativo');
    if (!Number.isInteger(diasAtraso) || diasAtraso < 0) throw new Error('Los días de atraso deben ser enteros no negativos');
    const diasEfectivos = Math.min(diasAtraso, 120);
    const tramoActual = clasificarTramo(diasEfectivos);
    const tasaNominalAnual = this.tasasAnuales.get(tramoActual) ?? new Decimal(0);
    const tasaDiaria = tasaNominalAnual.div(360);
    const importeSinRedondear = capitalEnMora.valor.times(tasaDiaria).times(diasEfectivos);
    const tramos = diasEfectivos === 0 ? [] : [{
      tramo: tramoActual,
      dias: diasEfectivos,
      tasaNominalAnual,
      tasaDiaria,
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
