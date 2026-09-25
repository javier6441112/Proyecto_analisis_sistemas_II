import { describe, expect, it } from 'vitest';
import { Dinero } from '../src/dominio/dinero.js';
import { resumirCartera, type CreditoCartera } from '../src/dominio/cartera.js';

const credito = (id: string, saldo: string, diasAtraso: number, estado: CreditoCartera['estado'] = 'VIGENTE'): CreditoCartera => ({
  id,
  saldoCapital: Dinero.de(saldo),
  diasAtraso,
  estado,
});

describe('cartera en riesgo - v2', () => {
  it('CP-04.3: reproduce el desglose 3.00% + 2.25% + 1.00% + 0.75% = 7.00%', () => {
    const resumen = resumirCartera([
      credito('C-001', '620000', 0),
      credito('C-002', '124000', 8),
      credito('C-003', '24000', 45),
      credito('C-004', '18000', 75),
      credito('C-005', '8000', 100),
      credito('C-006', '6000', 0, 'REESTRUCTURADO'),
      credito('C-007', '15000', 210, 'INCOBRABLE'),
    ]);

    expect(resumen.carteraActiva.formato()).toBe('800000.00');
    expect(resumen.saldoEnRiesgo.formato()).toBe('56000.00');
    expect(resumen.porcentajeRiesgo.toFixed(4)).toBe('0.0700');

    const porcentajeActivos = resumen.carteraActiva.valor;
    const riesgoPorTramo = [
      { tramo: 'MORA_1', valor: Dinero.de('24000.00') },
      { tramo: 'MORA_2', valor: Dinero.de('18000.00') },
      { tramo: 'MORA_3', valor: Dinero.de('8000.00') },
      { tramo: 'VENCIDO', valor: Dinero.de('6000.00') },
    ].map((item) => ({
      tramo: item.tramo,
      porcentaje: item.valor.valor.div(porcentajeActivos).toFixed(4),
    }));

    expect(riesgoPorTramo.map((item) => item.porcentaje)).toEqual(['0.0300', '0.0225', '0.0100', '0.0075']);
    expect(Number(riesgoPorTramo[0].porcentaje) + Number(riesgoPorTramo[1].porcentaje) + Number(riesgoPorTramo[2].porcentaje) + Number(riesgoPorTramo[3].porcentaje)).toBeCloseTo(0.07, 4);
  });
});
