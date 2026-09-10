import { describe, expect, it } from 'vitest';
import { Dinero } from '../src/dominio/dinero.js';
import { PoliticaEscalonada } from '../src/dominio/politica-mora/politica-escalonada.js';
import { PoliticaPlana } from '../src/dominio/politica-mora/politica-plana.js';

const CAPITAL = Dinero.de('725.76');

describe('regresion proyecto 1', () => {
  it('mantiene la mora plana de 15 dias en Q7.26 y aplica la escalonada solo desde la fecha indicada', () => {
    expect(new PoliticaPlana().calcular(CAPITAL, 15).formato()).toBe('7.26');
    expect(new PoliticaEscalonada('POL-2026-10').calcular(CAPITAL, 15).formato()).toBe('5.44');
  });
});
