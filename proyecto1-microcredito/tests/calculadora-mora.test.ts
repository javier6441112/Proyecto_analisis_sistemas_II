import { describe, expect, it } from 'vitest';
import { Dinero } from '../src/dominio/dinero.js';
import { calcularMora, clasificarMora } from '../src/dominio/calculadora-mora.js';

describe('calculadora de mora', () => {
  it('calcula Q7.26 sobre capital en mora, no sobre la cuota total', () => {
    const mora = calcularMora(Dinero.de('725.76'), '2026-08-01', '2026-08-16', '0.24');
    expect(mora.diasAtraso).toBe(15);
    expect(mora.interesMoratorio.formato()).toBe('7.26');
  });

  it('clasifica tramos en ambas direcciones', () => {
    expect(clasificarMora(45)).toBe('MORA_2');
    expect(clasificarMora(10)).toBe('MORA_1');
    expect(clasificarMora(0)).toBe('AL_DIA');
    expect(clasificarMora(121)).toBe('INCOBRABLE');
  });
});
