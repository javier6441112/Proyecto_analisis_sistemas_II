import { describe, expect, it } from 'vitest';
import { Dinero } from '../src/dominio/dinero.js';
import { resumirCarteraPorTramo } from '../src/dominio/cartera.js';

describe('cartera por tramo', () => {
  it('separa cartera en mora y cartera en riesgo por tramo', () => {
    const creditos = [
      { id: 'C-1', saldoCapital: Dinero.de('1000.00'), diasAtraso: 10, estado: 'EN_MORA' as const },
      { id: 'C-2', saldoCapital: Dinero.de('2000.00'), diasAtraso: 45, estado: 'EN_MORA' as const },
      { id: 'C-3', saldoCapital: Dinero.de('3000.00'), diasAtraso: 75, estado: 'REESTRUCTURADO' as const },
      { id: 'C-4', saldoCapital: Dinero.de('5000.00'), diasAtraso: 121, estado: 'INCOBRABLE' as const },
    ];

    const resumen = resumirCarteraPorTramo(creditos);
    expect(resumen.carteraEnMora.formato()).toBe('6000.00');
    expect(resumen.carteraEnRiesgo.formato()).toBe('5000.00');
    expect(resumen.porTramo.some((item) => item.tramo === 'MORA_1')).toBe(true);
    expect(resumen.porTramo.some((item) => item.tramo === 'MORA_2')).toBe(true);
    expect(resumen.porTramo.some((item) => item.tramo === 'MORA_3')).toBe(true);
  });
});
