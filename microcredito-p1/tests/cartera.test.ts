import { describe, expect, it } from 'vitest';
import { Dinero } from '../src/dominio/dinero.js';
import { resumirCartera, type CreditoCartera } from '../src/dominio/cartera.js';
import { generarPlanFrances } from '../src/dominio/plan-amortizacion.js';

const credito = (id: string, saldo: string, diasAtraso: number, estado: CreditoCartera['estado'] = 'VIGENTE'): CreditoCartera => ({ id, saldoCapital: Dinero.de(saldo), diasAtraso, estado });

describe('cartera en riesgo', () => {
  it('reproduce 7.00% y excluye incobrables de la cartera activa', () => {
    const resumen = resumirCartera([
      credito('C-001', '620000', 0), credito('C-002', '124000', 8), credito('C-003', '24000', 45),
      credito('C-004', '18000', 75), credito('C-005', '8000', 100), credito('C-006', '6000', 0, 'REESTRUCTURADO'),
      credito('C-007', '15000', 210, 'INCOBRABLE'),
    ]);
    expect(resumen.carteraActiva.formato()).toBe('800000.00');
    expect(resumen.saldoEnRiesgo.formato()).toBe('56000.00');
    expect(resumen.porcentajeRiesgo.toFixed(4)).toBe('0.0700');
  });

  it('actualiza el indicador al dar C-005 por incobrable', () => {
    const resumen = resumirCartera([
      credito('C-001', '620000', 0), credito('C-002', '124000', 8), credito('C-003', '24000', 45),
      credito('C-004', '18000', 75), credito('C-005', '8000', 100, 'INCOBRABLE'), credito('C-006', '6000', 0, 'REESTRUCTURADO'),
      credito('C-007', '15000', 210, 'INCOBRABLE'),
    ]);
    expect(resumen.carteraActiva.formato()).toBe('792000.00');
    expect(resumen.saldoEnRiesgo.formato()).toBe('48000.00');
    expect(resumen.porcentajeRiesgo.toFixed(4)).toBe('0.0606');
  });

  it('rechaza saldos y capitales negativos y mantiene riesgo entre cero y uno', () => {
    expect(() => resumirCartera([credito('C-008', '-50', 0)])).toThrow(/saldo/);
    expect(() => generarPlanFrances(Dinero.de('-1000'), '0.03', 12)).toThrow(/capital/);
    const resumen = resumirCartera([credito('C-009', '100', 45)]);
    expect(resumen.porcentajeRiesgo.greaterThanOrEqualTo(0)).toBe(true);
    expect(resumen.porcentajeRiesgo.lessThanOrEqualTo(1)).toBe(true);
  });
});
