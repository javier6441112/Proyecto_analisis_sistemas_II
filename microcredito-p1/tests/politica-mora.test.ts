import { describe, expect, it } from 'vitest';
import { Dinero } from '../src/dominio/dinero.js';
import { resolverPoliticaMoraPorFecha } from '../src/dominio/politica-mora/catalogo-politicas.js';
import { PoliticaEscalonada } from '../src/dominio/politica-mora/politica-escalonada.js';
import { PoliticaPlana } from '../src/dominio/politica-mora/politica-plana.js';
import { debeGenerarGastoGestion, gastoGestionCobro } from '../src/dominio/politica-mora/gasto-gestion-cobro.js';

const CAPITAL_EN_MORA = Dinero.de('725.76');

describe('politica de mora escalonada', () => {
  it('calcula mora por tramo sin retroactividad ni redondeo intermedio', () => {
    const politica = new PoliticaEscalonada('POL-2026-10');

    expect(politica.calcular(CAPITAL_EN_MORA, 15).formato()).toBe('5.44');
    expect(politica.calcular(CAPITAL_EN_MORA, 45).formato()).toBe('18.14');
    expect(politica.calcular(CAPITAL_EN_MORA, 100).formato()).toBe('50.80');
    expect(politica.calcular(CAPITAL_EN_MORA, 120).formato()).toBe('65.32');
    expect(politica.calcular(CAPITAL_EN_MORA, 121).formato()).toBe('65.32');
  });

  it('genera el gasto de gestion una sola vez al entrar a mora 2', () => {
    expect(gastoGestionCobro(Dinero.de('725.76'), 30).formato()).toBe('0.00');
    expect(gastoGestionCobro(Dinero.de('725.76'), 31).formato()).toBe('25.00');
    expect(gastoGestionCobro(Dinero.de('725.76'), 45).formato()).toBe('0.00');
    expect(debeGenerarGastoGestion(30)).toBe(false);
    expect(debeGenerarGastoGestion(31)).toBe(true);
    expect(debeGenerarGastoGestion(60)).toBe(false);
  });

  it('resuelve la politica por fecha de otorgamiento', () => {
    const anterior = resolverPoliticaMoraPorFecha('2026-09-30');
    const posterior = resolverPoliticaMoraPorFecha('2026-10-01');

    expect(anterior).toBeInstanceOf(PoliticaPlana);
    expect(posterior).toBeInstanceOf(PoliticaEscalonada);
    expect(new PoliticaPlana().calcular(CAPITAL_EN_MORA, 45).formato()).toBe('21.77');
    expect(new PoliticaEscalonada('POL-2026-10').calcular(CAPITAL_EN_MORA, 45).formato()).toBe('18.14');
  });
});
