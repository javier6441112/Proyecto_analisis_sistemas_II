import { Decimal } from 'decimal.js';
import { Dinero } from '../dinero.js';
import { clasificarTramo, diasEnTramo, type TramoConfiguracion } from './clasificacion-tramo.js';
import { redondearDinero, type PoliticaMora } from './politica-mora.js';

const TRAMOS_ESCALONADOS: readonly TramoConfiguracion[] = [
  { nombre: 'MORA_1', desde: 1, hasta: 30, tasaDiaria: new Decimal('0.0005') },
  { nombre: 'MORA_2', desde: 31, hasta: 60, tasaDiaria: new Decimal('0.000666667') },
  { nombre: 'MORA_3', desde: 61, hasta: 90, tasaDiaria: new Decimal('0.000833333') },
  { nombre: 'VENCIDO', desde: 91, hasta: 120, tasaDiaria: new Decimal('0.001') },
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
    if (capitalEnMora.valor.isNegative()) throw new Error('El capital en mora no puede ser negativo');
    if (!Number.isInteger(diasAtraso) || diasAtraso < 0) throw new Error('Los días de atraso deben ser enteros no negativos');
    const diasEfectivos = Math.min(diasAtraso, 120);
    if (diasEfectivos === 0) return Dinero.cero(capitalEnMora.moneda);

    let totalSinRedondear = new Decimal(0);
    for (const tramo of this.tramos) {
      const diasEnEsteTramo = diasEnTramo(diasEfectivos, tramo.desde, tramo.hasta);
      if (diasEnEsteTramo <= 0) continue;
      const devengo = capitalEnMora.valor.times(tramo.tasaDiaria).times(diasEnEsteTramo);
      totalSinRedondear = totalSinRedondear.plus(devengo);
    }

    const totalFinal = totalSinRedondear.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const tope = capitalEnMora.valor; 
    const valorAplicable = totalFinal.lessThan(tope) ? totalFinal : tope;
    return redondearDinero(valorAplicable, capitalEnMora.moneda);
  }

  clasificar(diasAtraso: number): string {
    return clasificarTramo(diasAtraso);
  }
}
