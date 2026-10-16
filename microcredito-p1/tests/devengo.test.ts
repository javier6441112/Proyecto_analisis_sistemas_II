import { expect, it } from 'vitest';
import { Dinero } from '../src/dominio/dinero.js';
import { acumuladoCuota, devengoEntreCortes, proyectarDevengo, resumirDevengo, type CreditoDevengo, type PoliticaDevengo } from '../src/dominio/devengo.js';

const politica: PoliticaDevengo = { version: 'PRUEBA-1', vigenteDesde: '2020-01-01', autor: 'Equipo', motivo: 'Académico', convencion: 'CONTRACTUAL_DIAS_REALES', suspensionDesdeDias: 91, bajaDesdeDias: 121 };
const cuota = (inicio: string, vencimiento: string, interes: string) => ({ numero: 1, inicio, vencimiento, interes: Dinero.de(interes) });
it.each([
  ['2026-01-01', '2026-02-01', '31', '2026-01-16', '15.00'],
  ['2026-02-01', '2026-03-01', '28', '2026-02-15', '14.00'],
  ['2024-02-01', '2024-03-01', '29', '2024-02-15', '14.00'],
  ['2026-04-01', '2026-05-01', '30', '2026-04-16', '15.00'],
  ['2026-01-31', '2026-02-28', '100', '2026-02-14', '50.00'],
])('acumulado independiente entre %s y %s', (inicio, vencimiento, interes, corte, esperado) => {
  const c = cuota(inicio, vencimiento, interes);
  expect(acumuladoCuota(c, corte).formato()).toBe(esperado);
  expect(acumuladoCuota(c, inicio).formato()).toBe('0.00');
  expect(acumuladoCuota(c, vencimiento).formato()).toBe(`${interes}.00`);
  expect(acumuladoCuota(c, '2027-01-01').formato()).toBe(`${interes}.00`);
});
it('medio hacia arriba por acumulado y diferencias telescópicas, sin redondear cada cociente diario', () => {
  const c = cuota('2026-01-01', '2026-01-03', '0.03');
  expect(devengoEntreCortes(c, '2026-01-01', '2026-01-02').formato()).toBe('0.02');
  expect(devengoEntreCortes(c, '2026-01-02', '2026-01-03').formato()).toBe('0.01');
  expect(devengoEntreCortes(c, '2026-01-01', '2026-01-03').formato()).toBe('0.03');
  const tres = cuota('2026-01-01', '2026-01-04', '0.01');
  expect(['02', '03', '04'].map((d, i) => devengoEntreCortes(tres, `2026-01-0${i + 1}`, `2026-01-${d}`).formato())).toEqual(['0.00', '0.01', '0.00']);
});
function credito(eventos: CreditoDevengo['eventos'] = []): CreditoDevengo {
  const fechas = ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01'];
  return { id: 'C1', desembolso: fechas[0], politica, eventos,
    cuotas: ['31', '28', '31', '30', '31', '30'].map((interes, i) => ({ numero: i + 1, inicio: fechas[i], vencimiento: fechas[i + 1], interes: Dinero.de(interes) })),
  };
}
it('días 90–100: el día 90 reconoce Q1 y los días 91–100 envían Q10 a suspenso', () => {
  const r = proyectarDevengo(credito(), '2026-05-12');
  expect(r.find(m => m.fechaContable === '2026-05-02')?.concepto).toBe('DEVENGO');
  const suspenso = r.filter(m => m.concepto === 'SUSPENSO');
  expect(suspenso).toHaveLength(10);
  expect(suspenso[0].fechaContable).toBe('2026-05-03');
  expect(resumirDevengo(suspenso).saldoSuspenso.formato()).toBe('10.00');
});
it('un pago parcial del atraso no regulariza; al quedar al día reconoce Q10 una sola vez', () => {
  const c = credito([
    { id: 'P1', fecha: '2026-05-05', orden: 1, tipo: 'PAGO', cuota: 1 },
    ...[2, 3, 4].map(n => ({ id: `P${n}`, fecha: '2026-05-12', orden: n, tipo: 'PAGO' as const, cuota: n })),
    { id: 'R', fecha: '2026-05-13', orden: 9, tipo: 'REGULARIZACION' },
  ]);
  const r = proyectarDevengo(c, '2026-05-14');
  expect(r.filter(m => m.concepto === 'REGULARIZACION').map(m => [m.fechaContable, m.importe.formato()])).toEqual([['2026-05-12', '10.00']]);
  expect(resumirDevengo(r).saldoSuspenso.formato()).toBe('0.00');
  expect(r.find(m => m.fechaContable === '2026-05-13')?.concepto).toBe('DEVENGO');
});
it('cancelación incluye su día y detiene los posteriores; el suspenso no regularizado se retira sin ingreso', () => {
  const r = proyectarDevengo(credito([{ id: 'C', fecha: '2026-05-10', orden: 1, tipo: 'CANCELACION' }]), '2026-06-01');
  expect(r.some(m => m.fechaContable > '2026-05-10')).toBe(false);
  expect(r.filter(m => m.concepto === 'RETIRO_SUSPENSO').map(m => m.importe.formato())).toEqual(['8.00']);
  expect(r.some(m => m.concepto === 'REGULARIZACION')).toBe(false);
  const c = credito([{ id: 'C', fecha: '2026-01-16', orden: 1, tipo: 'CANCELACION' }]);
  expect(resumirDevengo(proyectarDevengo(c, '2026-03-01')).generado.formato()).toBe('15.00');
});
it('baja al día 121 precede al cobro y retira Q30 de suspenso sin reconocerlo', () => {
  const c = credito([{ id: 'P', fecha: '2026-06-02', orden: 1, tipo: 'PAGO', cuota: 1 }]);
  const r = proyectarDevengo(c, '2026-07-01');
  expect(r.filter(m => m.concepto === 'RETIRO_SUSPENSO').map(m => [m.fechaContable, m.importe.formato()])).toEqual([['2026-06-02', '30.00']]);
  expect(r.some(m => m.fechaContable > '2026-06-02')).toBe(false);
  expect(r.some(m => m.concepto === 'REGULARIZACION')).toBe(false);
});
it('pago de interés ya devengado no añade otro ingreso', () => {
  const c = credito([{ id: 'P', fecha: '2026-02-01', orden: 1, tipo: 'PAGO', cuota: 1 }]);
  expect(resumirDevengo(proyectarDevengo(c, '2026-02-01')).ingresoReconocido.formato()).toBe('31.00');
});
it('valida fechas, moneda, importes, plan y política sin contratos externos', () => {
  for (const c of [cuota('2026-02-30', '2026-03-01', '1'), cuota('2026-01-02', '2026-01-01', '1'), cuota('2026-01-01', '2026-02-01', '-1'),
    { ...cuota('2026-01-01', '2026-02-01', '1'), interes: Dinero.de('1', 'USD') }]) expect(() => acumuladoCuota(c, '2026-01-15')).toThrow();
  expect(() => devengoEntreCortes(cuota('2026-01-01', '2026-02-01', '1'), '2026-01-20', '2026-01-10')).toThrow();
  expect(() => proyectarDevengo({ ...credito(), politica: { ...politica, version: '' } }, '2026-02-01')).toThrow();
});
