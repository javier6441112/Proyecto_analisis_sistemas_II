import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdaptadorNucleo } from '../../../src/persistencia/adaptador-nucleo.js';
import { construirServidor } from '../../../src/api/servidor.js';
import { api, fijarOperador, type TPagoAplicadoRespuesta } from '../api';
import { RegistrarPago } from './Pagos';
import { ConCarga } from '../ui';

// Ejecuta los controles reales con estado controlado; las peticiones HTTP llegan a una API real aislada.
const estado = vi.hoisted(() => ({ valores: [] as unknown[], indice: 0, exigible: undefined as unknown, usuario: 'Byron Chacón' }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (inicial: unknown) => {
    const i = estado.indice++;
    if (!(i in estado.valores)) estado.valores[i] = inicial;
    return [estado.valores[i], (valor: unknown) => { estado.valores[i] = typeof valor === 'function' ? valor(estado.valores[i]) : valor; }];
  },
}));
vi.mock('../sesion', async (original) => ({
  ...await original<typeof import('../sesion')>(),
  useSesion: () => ({ usuario: estado.usuario, idAsesor: 'AS-01', fecha: '2026-10-31', perfil: 'asesor' }),
}));
vi.mock('../ui', async (original) => ({
  ...await original<typeof import('../ui')>(),
  useCarga: () => ({ datos: estado.exigible, cargando: false, recargar: () => undefined }),
}));

const F = '2026-10-31';
const ID = 'CV-2026-0043';
let directorio: string;
let adaptador: AdaptadorNucleo;
let app: FastifyInstance;
beforeAll(async () => {
  directorio = mkdtempSync(join(tmpdir(), 'cv-op4-ui-'));
  const dbDir = join(directorio, 'db');
  cpSync(process.env.CV_DB_DIR ?? resolve('.cv-db'), dbDir, { recursive: true });
  adaptador = await AdaptadorNucleo.abrir({ dbDir });
  app = await construirServidor({ adaptador });
}, 60_000);
afterAll(async () => {
  await app?.close(); await adaptador?.cerrar();
  if (directorio) rmSync(directorio, { recursive: true, force: true });
});
beforeEach(() => {
  estado.valores = []; estado.indice = 0; estado.usuario = 'Byron Chacón';
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  fijarOperador({ perfil: 'asesor', usuario: estado.usuario });
  vi.stubGlobal('fetch', async (url: string, opciones: RequestInit) => {
    const r = await app.inject({ method: opciones.method as 'POST', url,
      headers: opciones.headers as Record<string, string>, payload: opciones.body as string });
    return new Response(r.body, { status: r.statusCode, headers: { 'Content-Type': 'application/json' } });
  });
});
afterAll(() => { vi.unstubAllGlobals(); fijarOperador(null); });

type Elemento = ReactElement<Record<string, unknown>>;
function pantalla(id = ID): Elemento {
  estado.indice = 0;
  const e = RegistrarPago({ id, volver: () => undefined, ir: () => undefined }) as Elemento;
  if (e.type === ConCarga) return (e.props.children as (datos: unknown) => Elemento)(estado.exigible);
  // Comprobante conserva los callbacks que se pasan desde RegistrarPago.
  return typeof e.type === 'function' ? (e.type as (props: unknown) => Elemento)(e.props) : e;
}
function buscar(e: Elemento, predicado: (elemento: Elemento) => boolean): Elemento | undefined {
  if (predicado(e)) return e;
  for (const hijo of [e.props.children].flat(Infinity)) {
    if (hijo && typeof hijo === 'object' && 'props' in hijo) {
      const encontrado = buscar(hijo as Elemento, predicado);
      if (encontrado) return encontrado;
    }
  }
  return undefined;
}
function clic(label: string, id = ID) {
  const boton = buscar(pantalla(id), (e) => e.props.label === label)!;
  expect(boton).toBeDefined();
  (boton.props.onClick as () => void)();
}
async function preparar(id = ID) {
  estado.exigible = await api.exigible(id, F);
  const input = buscar(pantalla(id), (e) => e.type === 'input' && e.props.id === 'monto-recibido')!;
  const monto = (estado.exigible as { cuota: { total: { valor: string } } }).cuota.total.valor;
  (input.props.onChange as (e: unknown) => void)({ target: { value: monto } });
  const form = buscar(pantalla(id), (e) => e.type === 'form')!;
  (form.props.onSubmit as (e: unknown) => void)({ preventDefault: () => undefined });
  await vi.waitFor(() => expect(estado.valores[3]).toBe('revision'));
  const checkbox = buscar(pantalla(id), (e) => e.type === 'input' && e.props.type === 'checkbox')!;
  (checkbox.props.onChange as (e: unknown) => void)({ target: { checked: true } });
}
async function quieto() { await vi.waitFor(() => expect(estado.valores[8]).toBe(false)); }

it('OP4 reenvía cuerpo y clave originales desde el comprobante sin simular ni generar otra clave', async () => {
  const registrar = vi.spyOn(api, 'registrarPago');
  const simular = vi.spyOn(api, 'simularPago');
  const uuid = vi.spyOn(crypto, 'randomUUID');
  const antes = await adaptador.auditarPagos();
  await preparar();
  clic('Confirmar pago');
  await quieto();
  const aplicado = estado.valores[9] as TPagoAplicadoRespuesta;
  expect(aplicado.resultado).toBe('APLICADO');
  const solicitudOriginal = structuredClone(registrar.mock.calls[0]);
  expect(solicitudOriginal).toEqual([ID, { monto: '561.87', fechaPago: F, canal: 'campo', aprobacion: { aprobado: true, aprobadoPor: 'Byron Chacón' } }, aplicado.claveIdempotencia]);
  const saldo = aplicado.credito.saldoCapital;
  const pagos = await adaptador.auditarPagos();
  const eventos = await adaptador.leerEventosBitacora();
  expect(pagos.registradosPorInterfaz).toBe(antes.registradosPorInterfaz + 1);
  // La consulta de la siguiente cuota y un cambio de operador no alteran la solicitud guardada.
  estado.exigible = await api.exigible(ID, F);
  estado.usuario = 'Otro operador';
  estado.valores[1] = '999.99';
  const html = renderToStaticMarkup(pantalla());
  expect(html).toContain('Reenviar el mismo pago');
  clic('Reenviar el mismo pago');
  expect(buscar(pantalla(), (e) => e.props.label === 'Reenviando…')?.props.disabled).toBe(true);
  await quieto();
  expect(registrar.mock.calls[1]).toEqual(solicitudOriginal);
  expect(uuid).toHaveBeenCalledTimes(1);
  expect(simular).toHaveBeenCalledTimes(1);
  expect(estado.valores[9]).toMatchObject({ resultado: 'DUPLICADO', claveIdempotencia: aplicado.claveIdempotencia,
    pagoOriginal: { monto: { valor: '561.87' }, fecha: F, canal: 'campo' }, credito: { saldoCapital: saldo } });
  expect(renderToStaticMarkup(pantalla())).toContain('DUPLICADO');
  expect(renderToStaticMarkup(pantalla())).toContain('No se realizó un segundo cobro');
  expect(await adaptador.auditarPagos()).toEqual(pagos);
  expect(await adaptador.leerEventosBitacora()).toEqual(eventos);
});

it('muestra errores de reenvío, conserva el comprobante y permite reintentar con la misma solicitud', async () => {
  // Nueva pantalla y nueva revisión: una operación nueva conserva su flujo habitual.
  const registrar = vi.spyOn(api, 'registrarPago');
  const anteriores = (await adaptador.leerEventosBitacora()).filter((e) => e.tipo === 'PAGO').map((e) => e.datos.clave_idempotencia);
  await preparar();
  clic('Confirmar pago'); await quieto();
  expect((estado.valores[9] as TPagoAplicadoRespuesta).resultado).toBe('APLICADO');
  const original = structuredClone(registrar.mock.calls[0]);
  expect(anteriores).not.toContain(original[2]);
  registrar.mockRejectedValueOnce(new Error('Sin conexión al reenviar'));
  clic('Reenviar el mismo pago'); await quieto();
  expect(renderToStaticMarkup(pantalla())).toContain('Sin conexión al reenviar');
  expect(renderToStaticMarkup(pantalla())).toContain('APLICADO');
  clic('Reenviar el mismo pago'); await quieto();
  expect(registrar.mock.calls[1]).toEqual(original);
  expect(registrar.mock.calls[2]).toEqual(original);
  expect((estado.valores[9] as { resultado: string }).resultado).toBe('DUPLICADO');
});
