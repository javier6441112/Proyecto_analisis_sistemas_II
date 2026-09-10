import { describe, expect, it } from 'vitest';
import { Dinero } from '../src/dominio/dinero.js';
import { PoliticaEscalonada } from '../src/dominio/politica-mora/politica-escalonada.js';
import { PoliticaPlana } from '../src/dominio/politica-mora/politica-plana.js';
import { PoliticaRetroactiva } from '../src/dominio/politica-mora/politica-retroactiva.js';

const CAPITAL = Dinero.de('725.76');

describe('contrato de politicas de mora', () => {
  it('cumple el contrato de sustitucion entre la politica plana, escalonada y retroactiva', () => {
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
    expect(new PoliticaRetroactiva().calcular(CAPITAL, 15).formato()).toBe('7.26');
  });
});
