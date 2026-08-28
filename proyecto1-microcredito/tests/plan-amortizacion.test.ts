import { describe, expect, it } from 'vitest';
import { Dinero } from '../src/dominio/dinero.js';
import { generarPlanFrances } from '../src/dominio/plan-amortizacion.js';

describe('plan de amortizacion francesa', () => {
  it('reproduce las 12 cuotas del caso de referencia', () => {
    const plan = generarPlanFrances(Dinero.de('10000'), '0.03', 12);
    const esperadas = [
      ['10000.00', '1004.62', '300.00', '704.62', '9295.38'],
      ['9295.38', '1004.62', '278.86', '725.76', '8569.62'],
      ['8569.62', '1004.62', '257.09', '747.53', '7822.09'],
      ['7822.09', '1004.62', '234.66', '769.96', '7052.13'],
      ['7052.13', '1004.62', '211.56', '793.06', '6259.07'],
      ['6259.07', '1004.62', '187.77', '816.85', '5442.22'],
      ['5442.22', '1004.62', '163.27', '841.35', '4600.87'],
      ['4600.87', '1004.62', '138.03', '866.59', '3734.28'],
      ['3734.28', '1004.62', '112.03', '892.59', '2841.69'],
      ['2841.69', '1004.62', '85.25', '919.37', '1922.32'],
      ['1922.32', '1004.62', '57.67', '946.95', '975.37'],
      ['975.37', '1004.63', '29.26', '975.37', '0.00'],
    ];
    expect(plan.cuotas).toHaveLength(12);
    expect(plan.cuotas.map((cuota) => [cuota.saldoInicial.formato(), cuota.pago.formato(), cuota.interes.formato(), cuota.amortizacion.formato(), cuota.saldoFinal.formato()])).toEqual(esperadas);
    expect(plan.cuotas.reduce((total, cuota) => total.sumar(cuota.amortizacion), Dinero.cero()).formato()).toBe('10000.00');
    expect(plan.cuotas.at(-1)?.saldoFinal.formato()).toBe('0.00');
  });
});
