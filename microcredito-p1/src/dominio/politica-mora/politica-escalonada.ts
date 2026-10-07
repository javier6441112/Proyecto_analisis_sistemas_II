import { Decimal } from 'decimal.js';
import { Dinero } from '../dinero.js';
import { clasificarTramo, diasEnTramo, type TramoConfiguracion } from './clasificacion-tramo.js';
import { redondearDinero, type DesgloseMora, type PoliticaMora } from './politica-mora.js';

const TRAMOS_ESCALONADOS: readonly TramoConfiguracion[] = [
  { nombre: 'MORA_1', desde: 1, hasta: 30, tasaNominalAnual: new Decimal('0.18') },
  { nombre: 'MORA_2', desde: 31, hasta: 60, tasaNominalAnual: new Decimal('0.24') },
  { nombre: 'MORA_3', desde: 61, hasta: 90, tasaNominalAnual: new Decimal('0.30') },
  { nombre: 'VENCIDO', desde: 91, hasta: 120, tasaNominalAnual: new Decimal('0.36') },
];

export class PoliticaEscalonada implements PoliticaMora {
  readonly id: string;
  readonly nombre = 'Mora escalonada';
  readonly vigenteDesde = '2026-10-01';
  readonly tramos: readonly TramoConfiguracion[];

  constructor(id = 'POL-2026-10', tramos: readonly TramoConfiguracion[] = TRAMOS_ESCALONADOS) {
    this.id = id;
    this.tramos = tramos;
  }

  calcular(capitalEnMora: Dinero, diasAtraso: number): Dinero {
    return this.desglosar(capitalEnMora, diasAtraso).totalMoratorio;
  }

  desglosar(capitalEnMora: Dinero, diasAtraso: number): DesgloseMora {
    if (capitalEnMora.valor.isNegative()) throw new Error('El capital en mora no puede ser negativo');
    if (!Number.isInteger(diasAtraso) || diasAtraso < 0) throw new Error('Los días de atraso deben ser enteros no negativos');
    const diasEfectivos = Math.min(diasAtraso, 120);

    let totalSinRedondear = new Decimal(0);
    const detalleTramos: DesgloseMora['tramos'][number][] = [];
    for (const tramo of this.tramos) {
      const diasEnEsteTramo = diasEnTramo(diasEfectivos, tramo.desde, tramo.hasta);
      if (diasEnEsteTramo <= 0) continue;
      const tasaDiaria = tramo.tasaNominalAnual.div(360);
      const devengo = capitalEnMora.valor.times(tasaDiaria).times(diasEnEsteTramo);
      totalSinRedondear = totalSinRedondear.plus(devengo);
      detalleTramos.push({ tramo: tramo.nombre, dias: diasEnEsteTramo, tasaNominalAnual: tramo.tasaNominalAnual, tasaDiaria, importeSinRedondear: devengo });
    }

    return {
      capitalEnMora,
      diasAtraso,
      diasEfectivos,
      incobrable: diasAtraso > 120,
      tramos: detalleTramos,
      totalSinRedondear,
      totalMoratorio: redondearDinero(totalSinRedondear, capitalEnMora.moneda),
    };
  }

  clasificar(diasAtraso: number): string {
    return clasificarTramo(diasAtraso);
  }
}
