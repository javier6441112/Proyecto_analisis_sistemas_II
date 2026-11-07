import { beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Cierre, type TCierre } from '../../../src/contratos/api.js';
import { api } from '../api';
import Cierres from './Cierres';

const estado = vi.hoisted(() => ({ valores: [] as unknown[], indice: 0 }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (inicial: unknown) => {
    const i = estado.indice++;
    if (!(i in estado.valores)) estado.valores[i] = inicial;
    return [estado.valores[i], (valor: unknown) => { estado.valores[i] = valor; }];
  },
}));
vi.mock('../sesion', async (original) => ({
  ...await original<typeof import('../sesion')>(),
  useSesion: () => ({ usuario: 'Elena Morales', perfil: 'gerencia', fecha: '2026-10-31' }),
}));

// Respuesta de prueba para una cartera vacía, validada contra el contrato real.
// La persistencia con una base temporal se verifica en tests/cierres.test.ts.
const parametros = JSON.parse(readFileSync(resolve('datos/datos-proyecto-final/politicas.json'), 'utf8'));
const cero = { valor: '0.00', moneda: 'GTQ' };
const previa = Cierre.parse({
  estado: 'PREVIA', tipo: 'DIARIO', periodo: '2026-10-31', desde: '2026-10-31', hasta: '2026-10-31', fechaCorte: '2026-10-31',
  politicasUtilizadas: { parametros, versionParametros: parametros.version,
    huellaParametros: createHash('sha256').update(JSON.stringify(parametros)).digest('hex'), mora: [] },
  desembolsos: { cantidad: 0, monto: cero, creditos: [] },
  recuperaciones: { pagos: 0, gastos: cero, interesMoratorio: cero, interesCorriente: cero, capital: cero, total: cero },
  recuperacionesIncobrables: { pagos: 0, monto: cero }, incobrablesDelPeriodo: { creditos: [], monto: cero },
  cartera: {
    fechaCorte: '2026-10-31', resumen: { carteraActiva: cero, saldoEnRiesgo: cero, porcentajeRiesgo: '0', incobrable: cero, riesgoPorTramo: [] },
    carteraEnMora: cero, porcentajeMora: '0', porTramo: [], reestructuradosAlDia: { creditos: 0, saldo: cero },
    conteos: { desembolsados: 0, activos: 0, enMora: 0, enRiesgo: 0, cancelados: 0, incobrables: 0 },
    incobrablesDelMes: [], incobrableDelMes: cero,
  },
});
const ejecutado: TCierre = { ...previa, estado: 'EJECUTADO', ejecutadoPor: 'Elena Morales' };
beforeEach(() => {
  estado.valores = []; estado.indice = 0; vi.restoreAllMocks();
  vi.spyOn(api, 'cierre').mockResolvedValue(previa);
  vi.spyOn(api, 'ejecutarCierre').mockResolvedValue(ejecutado);
});

type Elemento = ReactElement<Record<string, unknown>>;
function pantalla(): Elemento { estado.indice = 0; return Cierres() as Elemento; }
function buscar(e: Elemento, etiqueta: string): Elemento | undefined {
  if (e.props.label === etiqueta) return e;
  for (const hijo of [e.props.children].flat(Infinity)) {
    if (hijo && typeof hijo === 'object' && 'props' in hijo) {
      const encontrado = buscar(hijo as Elemento, etiqueta);
      if (encontrado) return encontrado;
    }
  }
  return undefined;
}
async function clic(etiqueta: string) {
  const boton = buscar(pantalla(), etiqueta)!;
  expect(boton).toBeDefined();
  (boton.props.onClick as () => void)();
  await vi.waitFor(() => expect(estado.valores[4]).toBe(false));
}

it('consultar muestra PREVIA y no ejecuta el cierre', async () => {
  await clic('Consultar período');
  expect(api.cierre).toHaveBeenCalledWith('2026-10-31');
  expect(api.ejecutarCierre).not.toHaveBeenCalled();
  expect(renderToStaticMarkup(pantalla())).toContain('Vista previa');
  expect(buscar(pantalla(), 'Reejecutar comprobación')).toBeUndefined();
});

it('ejecutar es una acción separada y reejecutar llama al comando con el período original', async () => {
  await clic('Ejecutar cierre definitivo');
  expect(api.cierre).not.toHaveBeenCalled();
  expect(api.ejecutarCierre).toHaveBeenCalledWith('2026-10-31');
  const html = renderToStaticMarkup(pantalla());
  expect(html).toContain('Ejecutado');
  expect(html).toContain('Elena Morales');
  await clic('Reejecutar comprobación');
  expect(api.ejecutarCierre).toHaveBeenCalledTimes(2);
  expect(renderToStaticMarkup(pantalla())).toContain('Se devolvió el mismo cierre guardado');
});

it('consultar un cierre guardado lo muestra como ejecutado y los errores del comando son visibles', async () => {
  vi.mocked(api.cierre).mockResolvedValue(ejecutado);
  await clic('Consultar período');
  expect(renderToStaticMarkup(pantalla())).toContain('Ejecutado');
  vi.mocked(api.ejecutarCierre).mockRejectedValue(new Error('No se pudo guardar el cierre'));
  await clic('Reejecutar comprobación');
  expect(renderToStaticMarkup(pantalla())).toContain('No se pudo guardar el cierre');
  expect(estado.valores[2]).toEqual(ejecutado);
});
