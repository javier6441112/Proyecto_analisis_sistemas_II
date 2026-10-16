import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Dinero } from '../src/dominio/dinero.js';
import { calcularProvisiones, validarPoliticaProvisiones, type CreditoProvision } from '../src/dominio/provisiones.js';

const politica = validarPoliticaProvisiones(JSON.parse(readFileSync(
  new URL('../configuracion/provisiones/credito-vecino-v1.json', import.meta.url), 'utf8')));
const credito = (c: Partial<CreditoProvision> = {}): CreditoProvision => ({
  id: 'C1', estado: 'VIGENTE', saldoCapital: Dinero.de('123.45'), diasAtraso: 0, dadoDeBaja: false, ...c,
});
const calcular = (c: CreditoProvision[]) => calcularProvisiones(politica, '2026-10-15', c);

// Resultados literales: 123.45 × tasa / 100, redondeados manualmente.
it.each([
  [0, 'AL_DIA', '1', '1.23'], [1, 'MORA_1', '5', '6.17'], [30, 'MORA_1', '5', '6.17'],
  [31, 'MORA_2', '20', '24.69'], [60, 'MORA_2', '20', '24.69'],
  [61, 'MORA_3', '50', '61.73'], [90, 'MORA_3', '50', '61.73'],
  [91, 'VENCIDO', '100', '123.45'], [120, 'VENCIDO', '100', '123.45'],
  [121, 'INCOBRABLE', '100', '123.45'],
])('reserva al día %i', (diasAtraso, tramo, porcentaje, importe) => {
  const r = calcular([credito({ diasAtraso: Number(diasAtraso) })]);
  expect(r.detalles[0].tramo).toBe(tramo);
  expect(r.detalles[0].base.formato()).toBe('123.45');
  expect(r.detalles[0].porcentaje.toString()).toBe(porcentaje);
  expect(r.total.formato()).toBe(importe);
  expect(r.version).toBe('CV-PROV-1.0');
  expect(r.fechaCorte).toBe('2026-10-15');
});

it.each([[0, '24.69'], [1, '24.69'], [31, '24.69'], [61, '61.73'], [91, '123.45'], [121, '123.45']])(
  'aplica el máximo para reestructurado con %i días', (diasAtraso, esperado) => {
    expect(calcular([credito({ estado: 'REESTRUCTURADO', diasAtraso })]).total.formato()).toBe(esperado);
  });

it('excluye cancelados y bajas pero conserva el incobrable activo', () => {
  const r = calcular([
    credito({ id: 'cancelado', estado: 'CANCELADO' }),
    credito({ id: 'baja', estado: 'INCOBRABLE', dadoDeBaja: true, diasAtraso: 180 }),
    credito({ id: 'activo', estado: 'INCOBRABLE', diasAtraso: 180 }),
  ]);
  expect(r.detalles.map(d => [d.excluido, d.base.formato(), d.porcentaje.toString(), d.provision.formato()]))
    .toEqual([[true, '0.00', '0', '0.00'], [true, '0.00', '0', '0.00'], [false, '123.45', '100', '123.45']]);
  expect(r.total.formato()).toBe('123.45');
});

it('redondea medio hacia arriba por crédito antes de sumar', () => {
  const r = calcular(['a', 'b', 'c'].map(id => credito({ id, saldoCapital: Dinero.de('0.50') })));
  expect(r.detalles.map(d => d.provision.formato())).toEqual(['0.01', '0.01', '0.01']);
  expect(r.total.formato()).toBe('0.03'); // Redondear 0.015 globalmente daría 0.02.
  expect(calcular([]).total.formato()).toBe('0.00');
});

it('recibe configuración alternativa y respeta ambas fechas inclusivas', () => {
  const p = { ...politica, version: 'alternativa', vigenteHasta: '2026-10-15',
    porcentajes: { ...politica.porcentajes, AL_DIA: '2.5' }, minimoReestructurado: '30' };
  for (const corte of [p.vigenteDesde, p.vigenteHasta]) {
    const r = calcularProvisiones(p, corte, [credito(), credito({ id: 'R', estado: 'REESTRUCTURADO' })]);
    expect(r.detalles.map(d => d.provision.formato())).toEqual(['3.09', '37.04']);
    expect(r.total.formato()).toBe('40.13');
    expect(r.version).toBe('alternativa');
  }
  expect(() => calcularProvisiones(p, '2026-10-16', [])).toThrow(/vigente/);
  expect(() => calcularProvisiones(p, '2025-12-31', [])).toThrow(/vigente/);
});

it.each(['-1', '100.01', 'NaN', 'Infinity', '', '1e2'])('rechaza porcentaje %s', tasa => {
  expect(() => validarPoliticaProvisiones({ ...politica, porcentajes: { ...politica.porcentajes, MORA_1: tasa } })).toThrow();
  expect(() => validarPoliticaProvisiones({ ...politica, minimoReestructurado: tasa })).toThrow();
});

it('rechaza configuración incompleta, metadatos vacíos y fechas inválidas', () => {
  for (const cambio of [{ version: '' }, { autor: '' }, { institucion: '' }, { motivo: '' },
    { vigenteDesde: '2026-02-30' }, { vigenteHasta: '2025-01-01' }, { porcentajes: {} }]) {
    expect(() => validarPoliticaProvisiones({ ...politica, ...cambio })).toThrow();
  }
  expect(() => calcularProvisiones(politica, '2026-02-30', [])).toThrow();
});

it('rechaza datos al corte inválidos incluso si se excluirían', () => {
  for (const c of [credito({ saldoCapital: Dinero.de('-1') }), credito({ diasAtraso: -1 }),
    credito({ diasAtraso: 0.5 }), credito({ diasAtraso: NaN }), credito({ dadoDeBaja: true }),
    credito({ id: '' }), credito({ estado: 'OTRO' as CreditoProvision['estado'] })]) {
    expect(() => calcular([c])).toThrow();
  }
  expect(() => calcular([credito(), credito()])).toThrow(/duplicado/);
  expect(() => calcular([credito(), credito({ id: 'USD', saldoCapital: Dinero.de('1', 'USD') })])).toThrow(/monedas/);
  expect(() => calcular([credito({ estado: 'CANCELADO', diasAtraso: -1 })])).toThrow();
});
