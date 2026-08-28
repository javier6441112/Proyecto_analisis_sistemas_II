import { describe, expect, it } from 'vitest';
import { Dinero } from '../src/dominio/dinero.js';
import { calcularMora, clasificarMora } from '../src/dominio/calculadora-mora.js';
import { calcularTasaEfectivaAnual } from '../src/dominio/plan-amortizacion.js';
import { crearPoliticaCredito } from '../src/dominio/politica-credito.js';

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
    expect(clasificarMora(121)).toBe('VENCIDO');
  });

  it('rechaza tasas, capitales, fechas y bases invalidas', () => {
    expect(() => calcularMora(Dinero.de('10.00'), '2026-08-01', '2026-08-02', '-0.24')).toThrow(/tasa/);
    expect(() => calcularMora(Dinero.de('-10.00'), '2026-08-01', '2026-08-02', '0.24')).toThrow(/capital/);
    expect(() => calcularMora(Dinero.de('10.00'), 'fecha', '2026-08-02', '0.24')).toThrow(/fechas/);
    expect(() => calcularMora(Dinero.de('10.00'), '2026-08-01', '2026-08-02', '0.24', 360.5)).toThrow(/base/);
  });

  it('calcula la tasa efectiva anual equivalente', () => {
    expect(calcularTasaEfectivaAnual('0.03').toFixed(8)).toBe('0.42576089');
  });

  it('crea una politica versionada y rechaza tasas invalidas', () => {
    const politica = crearPoliticaCredito({ id: 'POL-001', version: '1.0', vigenteDesde: '2026-08-01', autor: 'comite', tasaOrdinariaMensual: '0.03', tasaMoratoriaAnual: '0.24', baseDias: 360 });
    expect(politica.version).toBe('1.0');
    expect(politica.tasaMoratoriaAnual.toFixed(2)).toBe('0.24');
    expect(() => crearPoliticaCredito({ id: 'POL-002', version: '1.0', vigenteDesde: '2026-08-01', autor: 'comite', tasaOrdinariaMensual: '-0.01', tasaMoratoriaAnual: '0.24', baseDias: 360 })).toThrow(/ordinaria/);
    expect(() => crearPoliticaCredito({ id: 'POL-003', version: '1.0', vigenteDesde: 'no-fecha', autor: 'comite', tasaOrdinariaMensual: '0.03', tasaMoratoriaAnual: '0.24', baseDias: 360 })).toThrow(/vigencia/);
  });
});
