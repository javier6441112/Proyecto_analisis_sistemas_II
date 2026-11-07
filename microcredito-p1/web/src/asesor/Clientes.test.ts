import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdaptadorNucleo } from '../../../src/persistencia/adaptador-nucleo.js';
import { construirServidor } from '../../../src/api/servidor.js';
import { api, ErrorApi, type TCliente } from '../api';
import { AltaCliente } from './Clientes';

// Inspecciona los controles y ejecuta sus callbacks reales sin instalar un DOM.
const estado = vi.hoisted(() => ({ valores: [] as unknown[], indice: 0 }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (inicial: unknown) => {
    const i = estado.indice++;
    if (!(i in estado.valores)) estado.valores[i] = inicial;
    return [estado.valores[i], (valor: unknown) => {
      estado.valores[i] = typeof valor === 'function' ? valor(estado.valores[i]) : valor;
    }];
  },
}));
vi.mock('../sesion', async (original) => ({
  ...await original<typeof import('../sesion')>(),
  useSesion: () => ({ usuario: 'Byron Chacón', idAsesor: 'AS-01', fecha: '2026-10-31', perfil: 'asesor' }),
}));

const F = '2026-10-31';
const asesor = { 'x-perfil': 'asesor', 'x-usuario': 'Byron Chacón' };
let directorio: string;
let adaptador: AdaptadorNucleo;
let app: FastifyInstance;
const registrado = vi.fn<(cliente: TCliente) => void>();
const demo = { 'codigo-cliente': 'CL-9001', nombre: 'Gerencia Demostración Gálvez', dpi: 'DPI-FICT-009001', municipio: 'Guatemala' };

beforeAll(async () => {
  directorio = mkdtempSync(join(tmpdir(), 'cv-op3-ui-'));
  const dbDir = join(directorio, 'db');
  cpSync(process.env.CV_DB_DIR ?? resolve('.cv-db'), dbDir, { recursive: true });
  adaptador = await AdaptadorNucleo.abrir({ dbDir });
  app = await construirServidor({ adaptador });
}, 60_000);
afterAll(async () => {
  await app?.close();
  await adaptador?.cerrar();
  if (directorio) rmSync(directorio, { recursive: true, force: true });
});
beforeEach(() => {
  estado.valores = []; estado.indice = 0;
  vi.restoreAllMocks(); registrado.mockClear();
  vi.spyOn(api, 'clientes').mockImplementation(async () => (await app.inject({ method: 'GET', url: '/api/clientes' })).json());
  vi.spyOn(api, 'registrarCliente').mockImplementation(async (body) => {
    const r = await app.inject({ method: 'POST', url: '/api/clientes', payload: body, headers: asesor });
    if (r.statusCode !== 201) throw new ErrorApi(r.statusCode, r.json());
    return r.json();
  });
});

type Elemento = ReactElement<Record<string, unknown>>;
function formulario() {
  estado.indice = 0;
  return AltaCliente({ volver: () => undefined, registrado });
}
function buscar(elemento: Elemento, predicado: (e: Elemento) => boolean): Elemento | undefined {
  if (predicado(elemento)) return elemento;
  const hijos = [elemento.props.children].flat(Infinity);
  for (const hijo of hijos) {
    if (hijo && typeof hijo === 'object' && 'props' in hijo) {
      const encontrado = buscar(hijo as Elemento, predicado);
      if (encontrado) return encontrado;
    }
  }
  return undefined;
}
function llenar(datos: Record<string, string>) {
  for (const [id, value] of Object.entries(datos)) {
    const input = buscar(formulario(), (e) => e.type === 'input' && e.props.id === id)!;
    (input.props.onChange as (e: unknown) => void)({ target: { value } });
  }
}
async function enviar() {
  const form = buscar(formulario(), (e) => e.type === 'form')!;
  (form.props.onSubmit as (e: unknown) => void)({ preventDefault: () => undefined });
  await vi.waitFor(() => expect(estado.valores[6]).toBe(false));
}

it('acepta OP3 desde los controles del alta y completa solicitud, aprobación y desembolso en una base temporal', async () => {
  const html = renderToStaticMarkup(formulario());
  expect(html).toContain('codigo-cliente');
  expect(html).toContain('DPI-FICT-009001');
  const inputDpi = buscar(formulario(), (e) => e.type === 'input' && e.props.id === 'dpi')!;
  expect(inputDpi.props.inputMode).not.toBe('numeric');
  llenar(demo);
  await enviar();
  expect(registrado).toHaveBeenCalledWith(expect.objectContaining({
    idCliente: 'CL-9001', nombreCompleto: demo.nombre, dpi: demo.dpi, municipio: demo.municipio, fechaAlta: F,
  }));
  expect(api.clientes).not.toHaveBeenCalled();
  const solicitud = await app.inject({ method: 'POST', url: '/api/solicitudes', headers: asesor,
    payload: { idCliente: 'CL-9001', idAsesor: 'AS-01', capital: '10000.00', plazoMeses: 12, tnaBps: 3600, fecha: F } });
  expect(solicitud.statusCode).toBe(201);
  const { solicitud: sol, plan } = solicitud.json();
  expect(sol).toMatchObject({ idCliente: 'CL-9001', idAsesor: 'AS-01', plazoMeses: 12, tnaBps: 3600 });
  expect(plan.cuotas).toHaveLength(12);
  expect(plan.cuotas[0].pago.valor).toBe('1004.62');
  expect(plan.cuotas[11].saldoFinal.valor).toBe('0.00');
  const prematuro = await app.inject({ method: 'POST', url: `/api/solicitudes/${sol.idSolicitud}/desembolso`, headers: asesor, payload: { idCredito: 'CV-2026-9001', fecha: F } });
  expect(prematuro.statusCode).toBe(409);
  const aprobacion = await app.inject({ method: 'POST', url: `/api/solicitudes/${sol.idSolicitud}/resolucion`,
    headers: { 'x-perfil': 'gerencia', 'x-usuario': 'Elena Morales' }, payload: { decision: 'APROBADA', motivo: 'Demostración OP3', fecha: F } });
  expect(aprobacion.statusCode).toBe(200);
  const desembolso = await app.inject({ method: 'POST', url: `/api/solicitudes/${sol.idSolicitud}/desembolso`, headers: asesor, payload: { idCredito: 'CV-2026-9001', fecha: F } });
  expect(desembolso.statusCode).toBe(201);
  expect(desembolso.json()).toMatchObject({ idCredito: 'CV-2026-9001', nombreCliente: demo.nombre, capitalOriginal: { valor: '10000.00' }, cuotasTotales: 12, fechaDesembolso: F, estado: 'VIGENTE' });
});

it.each([
  { 'codigo-cliente': 'CL-90' }, { 'codigo-cliente': 'XX-9001' },
  { nombre: '' }, { nombre: 'AB' }, { municipio: '' },
  { dpi: '' }, { dpi: '123456789012' }, { dpi: '12345678901234' }, { dpi: '123456789012X' },
  { dpi: 'DPI-FICT-9001' }, { dpi: 'DPI-FICT-0090010' }, { dpi: 'DPI-FICT-00900X' },
  { dpi: 'DPI-FICT-009 001' }, { dpi: 'DPI-OTRO-009001' }, { tel: '1'.repeat(21) },
])('rechaza datos inválidos sin llamar al servidor: %j', async (invalido) => {
  llenar({ ...demo, ...invalido } as Record<string, string>);
  await enviar();
  expect(api.registrarCliente).not.toHaveBeenCalled();
  expect(registrado).not.toHaveBeenCalled();
  expect(Object.keys(estado.valores[5] as object).length).toBeGreaterThan(0);
});

it('conserva el DPI normal con espacios y la asignación automática del código', async () => {
  const existentes = await adaptador.listarClientes();
  llenar({ ...demo, 'codigo-cliente': '', nombre: 'Cliente habitual', dpi: '2598 11234 0101' });
  await enviar();
  expect(api.clientes).toHaveBeenCalledTimes(1);
  const cliente = registrado.mock.calls[0][0];
  expect(cliente.dpi).toBe('2598112340101');
  expect(cliente.idCliente).toMatch(/^CL-\d{4}$/);
  expect(existentes.some((c) => c.idCliente === cliente.idCliente)).toBe(false);
});

it.each([
  { 'codigo-cliente': 'CL-9001', dpi: '1111111111111' },
  { 'codigo-cliente': 'CL-9003', dpi: 'DPI-FICT-009001' },
])('el servidor rechaza código o DPI duplicados y el formulario muestra el error: %j', async (duplicado) => {
  const antes = (await adaptador.listarClientes()).length;
  llenar({ ...demo, ...duplicado });
  await enviar();
  expect(api.registrarCliente).toHaveBeenCalledTimes(1);
  expect(registrado).not.toHaveBeenCalled();
  expect(estado.valores[7]).toMatch(/ya existe/i);
  expect(renderToStaticMarkup(formulario())).toContain(estado.valores[7] as string);
  expect((await adaptador.listarClientes()).length).toBe(antes);
});
