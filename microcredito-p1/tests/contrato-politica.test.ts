import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { Dinero } from '../src/dominio/dinero.js';
import { PoliticaEscalonada } from '../src/dominio/politica-mora/politica-escalonada.js';
import { PoliticaPlana } from '../src/dominio/politica-mora/politica-plana.js';
import { PoliticaRetroactiva } from '../src/dominio/politica-mora/politica-retroactiva.js';

const CAPITAL = Dinero.de('725.76');

describe('contrato de politicas de mora', () => {
  it('cumple la bateria de contrato y conserva los resultados propios de cada politica', () => {
    const politicas = [
      new PoliticaPlana(),
      new PoliticaEscalonada('POL-2026-10'),
      new PoliticaRetroactiva(),
    ];

    for (const politica of politicas) {
      const calculado = politica.calcular(CAPITAL, 45);
      expect(calculado.valor.isFinite()).toBe(true);
      expect(calculado.valor.isPositive() || calculado.esCero()).toBe(true);
      expect(calculado.moneda).toBe('GTQ');
    }

    expect(new PoliticaPlana().calcular(CAPITAL, 15).formato()).toBe('7.26');
    expect(new PoliticaEscalonada('POL-2026-10').calcular(CAPITAL, 45).formato()).toBe('18.14');
    expect(new PoliticaRetroactiva().calcular(CAPITAL, 15).formato()).toBe('5.44');
    expect(new PoliticaRetroactiva().calcular(CAPITAL, 100).formato()).toBe('72.58');
  });

  it('invariante 2: la mora escalonada no supera la retroactiva en el tramo recorrido', () => {
    const escalonada = new PoliticaEscalonada('POL-2026-10').calcular(CAPITAL, 45);
    const retroactiva = new PoliticaRetroactiva().calcular(CAPITAL, 45);

    expect(escalonada.formato()).toBe('18.14');
    expect(retroactiva.formato()).toBe('21.77');
    expect(escalonada.valor.lte(retroactiva.valor)).toBe(true);
  });

  it('invariante 4: para 15 días, la mora escalonada coincide con la tasa plana del 18%', () => {
    const escalonada = new PoliticaEscalonada('POL-2026-10').calcular(CAPITAL, 15);
    const tasaDiaria18 = new Decimal('0.18').div(360);
    const esperado = CAPITAL.valor.times(tasaDiaria18).times(15).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    expect(escalonada.formato()).toBe('5.44');
    expect(escalonada.valor.toFixed(2)).toBe(esperado.toFixed(2));
  });

  it('expone los días, la tasa y el importe no redondeado de cada tramo moratorio', () => {
    const detalle = new PoliticaEscalonada('POL-2026-10').desglosar(CAPITAL, 45);

    expect(detalle.capitalEnMora.formato()).toBe('725.76');
    expect(detalle.tramos.map(({ tramo, dias }) => ({ tramo, dias }))).toEqual([
      { tramo: 'MORA_1', dias: 30 },
      { tramo: 'MORA_2', dias: 15 },
    ]);
    expect(detalle.tramos[0]?.tasaNominalAnual.toString()).toBe('0.18');
    expect(detalle.tramos[0]?.tasaDiaria.toString()).toBe('0.0005');
    expect(detalle.tramos[0]?.importeSinRedondear.toFixed(4)).toBe('10.8864');
    expect(detalle.tramos[1]?.tasaDiaria.toString()).toBe('0.00066666666666666666667');
    expect(detalle.tramos[1]?.tasaNominalAnual.toString()).toBe('0.24');
    expect(detalle.tramos[1]?.importeSinRedondear.toFixed(4)).toBe('7.2576');
    expect(detalle.totalSinRedondear.toFixed(4)).toBe('18.1440');
    expect(detalle.totalMoratorio.formato()).toBe('18.14');
  });
});
