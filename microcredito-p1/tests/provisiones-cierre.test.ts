import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { FastifyInstance } from 'fastify';
import { abrirBaseDatos } from '../src/persistencia/base-datos.js';
import { cargarCanonico } from '../src/persistencia/carga-canonica.js';
import { AdaptadorNucleo } from '../src/persistencia/adaptador-nucleo.js';
import { calcularProvisiones } from '../src/dominio/provisiones.js';
import { validarConfiguracionProvisiones } from '../src/contratos/provisiones.js';
import { cargarPoliticaProvisiones } from '../src/configuracion/provisiones.js';
import { Cierre, type TCierre } from '../src/contratos/api.js';
import { aJson } from '../src/api/serializacion.js';
import { construirServidor } from '../src/api/servidor.js';
import { conectarClienteLocal, type ClienteMcpLocal } from '../src/mcp/cliente-local.js';
import { ServicioOperaciones } from '../src/persistencia/servicio-operaciones.js';
import { ServicioAprobaciones } from '../src/mcp/aprobaciones.js';

const dir = mkdtempSync(join(tmpdir(), 'cv-provisiones-cierre-'));
const dbDir = join(dir, 'db');
// Los JSON del catálogo se ubican en la raíz temporal, separados de la base.
const archivo = join(dir, 'politica.json');
const original = validarConfiguracionProvisiones(JSON.parse(readFileSync(resolve('configuracion/provisiones/credito-vecino-v1.json'), 'utf8')));
let a: AdaptadorNucleo;
let app: FastifyInstance;
let mcp: ClienteMcpLocal;
let guardado: TCierre;
const headers = { 'x-perfil': 'gerencia', 'x-usuario': 'Prueba provisiones' };
function configurar() {
  writeFileSync(archivo, JSON.stringify({ ...original, version: 'OCTUBRE', vigenteDesde: '2026-10-01' }));
  writeFileSync(join(dir, 'anterior.json'), JSON.stringify({ ...original, version: 'ANTERIOR', vigenteHasta: '2026-09-30',
    porcentajes: { ...original.porcentajes, AL_DIA: '2' } }));
}
async function abrir() {
  a = await AdaptadorNucleo.abrir({ dbDir, provisionesDir: dir });
  app = await construirServidor({ adaptador: a });
  mcp = await conectarClienteLocal({ adaptador: a, servicio: new ServicioOperaciones(a), aprobaciones: new ServicioAprobaciones() });
}
async function cerrar() { await mcp?.cerrar(); await app?.close(); await a?.cerrar(); }
async function api(periodo: string, ejecutar = false) {
  const r = await app.inject({ method: ejecutar ? 'POST' : 'GET',
    url: `/api/cierres/${periodo}${ejecutar ? '/ejecucion' : ''}`, headers });
  expect(r.statusCode, r.body).toBe(200);
  return Cierre.parse(r.json());
}
async function consultaMcp(periodo: string) {
  const r = await mcp.llamar('consultar_cierre', { periodo });
  expect(r.isError).not.toBe(true);
  return r.structuredContent as Record<string, unknown>;
}
beforeAll(async () => {
  configurar();
  const db = await abrirBaseDatos(dbDir);
  try { await cargarCanonico(db, resolve('datos/datos-proyecto-final')); } finally { await db.close(); }
  await abrir();
}, 60000);
afterAll(async () => { await cerrar(); rmSync(dir, { recursive: true, force: true }); });

it('selecciona por corte explícito y rechaza huecos, solapamientos y configuración inválida', () => {
  expect(cargarPoliticaProvisiones('2026-09-30', dir).version).toBe('ANTERIOR');
  expect(cargarPoliticaProvisiones('2026-10-01', dir).version).toBe('OCTUBRE');
  expect(() => cargarPoliticaProvisiones('2025-12-31', dir)).toThrow(/No existe/);
  writeFileSync(archivo, JSON.stringify({ ...original, version: 'OTRA', vigenteDesde: '2026-09-30' }));
  expect(() => cargarPoliticaProvisiones('2026-10-31', dir)).toThrow(/ambiguas/);
  writeFileSync(archivo, JSON.stringify({ ...original, minimoReestructurado: '-1' }));
  expect(() => cargarPoliticaProvisiones('2026-10-31', dir)).toThrow(/Porcentaje/);
  configurar();
});

it('API y MCP coinciden con el cálculo puro de la fotografía mensual y excluyen cancelados e incobrables', async () => {
  for (const [periodo, corte, version] of [['2026-09', '2026-09-30', 'ANTERIOR'], ['2026-10', '2026-10-31', 'OCTUBRE']]) {
    const detalles = await a.listarDetallesCreditos(corte);
    expect(detalles.every(d => d.fechaDesembolso <= corte)).toBe(true);
    const politica = cargarPoliticaProvisiones(corte, dir);
    const puro = calcularProvisiones(politica, corte, detalles.map(d => ({
      id: d.idCredito, saldoCapital: d.saldoCapital, estado: d.estado, diasAtraso: d.diasAtraso, dadoDeBaja: d.estado === 'INCOBRABLE',
    })));
    const previa = await api(periodo);
    expect(previa.provisiones).toEqual(aJson({ estado: 'DISPONIBLE', parametros: politica, ...puro }));
    expect(previa.provisiones).toMatchObject({ version, fechaCorte: corte });
    expect((await consultaMcp(periodo)).provisiones).toEqual(previa.provisiones);
    for (const estado of ['CANCELADO', 'INCOBRABLE']) {
      const excluidos = detalles.filter(d => d.estado === estado);
      if (periodo === '2026-10') expect(excluidos.length).toBeGreaterThan(0);
      for (const d of excluidos) {
        const reserva = puro.detalles.find(r => r.id === d.idCredito)!;
        expect([reserva.base.formato(), reserva.porcentaje.toString(), reserva.provision.formato()]).toEqual(['0.00', '0', '0.00']);
      }
    }
  }
  expect((await a.db.query('SELECT * FROM cierres_ejecutados')).rows).toHaveLength(0);
});

it('errores de política impiden guardar un cierre nuevo', async () => {
  writeFileSync(archivo, JSON.stringify({ ...original, version: 'OCTUBRE', vigenteDesde: '2026-11-01' }));
  const r = await app.inject({ method: 'POST', url: '/api/cierres/2026-10/ejecucion', headers });
  expect(r.statusCode).toBe(400);
  expect((await a.db.query('SELECT * FROM cierres_ejecutados')).rows).toHaveLength(0);
  configurar();
});

it('guarda total, detalle y copia de política sin crear movimientos; repetir no duplica', async () => {
  const eventos = (await a.db.query('SELECT * FROM bitacora_operaciones')).rows;
  const previa = await api('2026-10');
  guardado = await api('2026-10', true);
  expect(guardado).toEqual({ ...previa, estado: 'EJECUTADO', ejecutadoPor: headers['x-usuario'] });
  expect(await api('2026-10', true)).toEqual(guardado);
  expect((await a.db.query('SELECT * FROM cierres_ejecutados')).rows).toHaveLength(1);
  expect((await a.db.query('SELECT * FROM bitacora_operaciones')).rows).toEqual(eventos);
});

it('reinicio y cambio de configuración conservan la instantánea y los parámetros originales', async () => {
  await cerrar();
  writeFileSync(archivo, JSON.stringify({ ...original, version: 'NUEVA', vigenteDesde: '2026-10-01',
    porcentajes: { ...original.porcentajes, AL_DIA: '99' } }));
  await abrir();
  expect((await api('2026-11')).provisiones).toMatchObject({ version: 'NUEVA' });
  // Incluso una configuración actual inválida no impide leer o repetir el cierre guardado.
  writeFileSync(archivo, '{}');
  const reconstruir = vi.spyOn(a, 'listarDetallesCreditos').mockRejectedValue(new Error('No recalcular'));
  try {
    expect(await api('2026-10')).toEqual(guardado);
    expect(await api('2026-10', true)).toEqual(guardado);
    expect((await consultaMcp('2026-10')).provisiones).toEqual(guardado.provisiones);
    expect(reconstruir).not.toHaveBeenCalled();
  } finally { reconstruir.mockRestore(); }
  expect((await a.db.query('SELECT * FROM cierres_ejecutados')).rows).toHaveLength(1);
});

it('un cierre anterior sin provisiones indica no disponible y conserva intacto su JSON', async () => {
  const filas = await a.db.query<{ resultado: Record<string, unknown> }>('SELECT resultado FROM cierres_ejecutados WHERE periodo=$1', ['2026-10']);
  const antiguo = { ...filas.rows[0].resultado, periodo: '2026-08', fechaCorte: '2026-08-31', desde: '2026-08-01', hasta: '2026-08-31' };
  delete (antiguo as Record<string, unknown>).provisiones;
  await a.db.query('INSERT INTO cierres_ejecutados VALUES ($1,$2,$3)', ['2026-08', '2026-08-31', JSON.stringify(antiguo)]);
  const antes = (await a.db.query('SELECT * FROM cierres_ejecutados WHERE periodo=$1', ['2026-08'])).rows;
  const reconstruir = vi.spyOn(a, 'listarDetallesCreditos').mockRejectedValue(new Error('No recalcular histórico'));
  try {
    const consulta = await api('2026-08');
    expect(consulta.provisiones).toEqual({ estado: 'NO_DISPONIBLE', motivo: 'Provisiones no disponibles en esta versión del cierre histórico' });
    expect(await api('2026-08', true)).toEqual(consulta);
    expect((await consultaMcp('2026-08')).provisiones).toEqual(consulta.provisiones);
    expect(reconstruir).not.toHaveBeenCalled();
  } finally { reconstruir.mockRestore(); }
  expect((await a.db.query('SELECT * FROM cierres_ejecutados WHERE periodo=$1', ['2026-08'])).rows).toEqual(antes);
});
