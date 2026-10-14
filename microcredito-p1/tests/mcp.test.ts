/**
 * E6 · El servidor MCP devuelve lo mismo que el núcleo y rechaza lo que debe rechazar.
 * Se prueba por el protocolo real (cliente MCP en memoria y por HTTP) sobre una copia de .cv-db.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { AdaptadorNucleo } from '../src/persistencia/adaptador-nucleo.js';
import { ServicioOperaciones } from '../src/persistencia/servicio-operaciones.js';
import { ServicioAprobaciones } from '../src/mcp/aprobaciones.js';
import { conectarClienteLocal, type ClienteMcpLocal } from '../src/mcp/cliente-local.js';
import { HERRAMIENTAS_PARA_EL_MODELO } from '../src/mcp/servidor-mcp.js';
import { registrarMcpHttp } from '../src/mcp/http.js';
import { construirServidor } from '../src/api/servidor.js';
import { registrarRutasPropuestas } from '../src/api/rutas-propuestas.js';

const F = '2026-10-31';
const ORIGEN_DB = process.env.CV_DB_DIR ?? resolve(process.cwd(), '.cv-db');
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let dir: string;
let adaptador: AdaptadorNucleo;
let aprobaciones: ServicioAprobaciones;
let mcp: ClienteMcpLocal;
let app: FastifyInstance;
const textos: string[] = [];

async function llamar(nombre: string, args: Record<string, unknown>): Promise<{ error: boolean; datos: Json }> {
  const r: CallToolResult = await mcp.llamar(nombre, args);
  const texto = r.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
  textos.push(texto);
  return { error: Boolean(r.isError), datos: (r.structuredContent ?? { texto }) as Json };
}

beforeAll(async () => {
  if (!existsSync(ORIGEN_DB)) throw new Error(`No existe ${ORIGEN_DB}. Ejecute "npm run cargar:datos" antes de "npm test".`);
  dir = join(mkdtempSync(join(tmpdir(), 'cv-mcp-')), 'db');
  cpSync(ORIGEN_DB, dir, { recursive: true });
  adaptador = await AdaptadorNucleo.abrir({ dbDir: dir });
  const servicio = new ServicioOperaciones(adaptador);
  aprobaciones = new ServicioAprobaciones();
  const dep = { adaptador, servicio, aprobaciones };
  mcp = await conectarClienteLocal(dep);
  app = await construirServidor({
    adaptador, servicio,
    registrar: (i) => { registrarMcpHttp(i, dep); registrarRutasPropuestas(i, aprobaciones, mcp); },
  });
}, 60_000);

afterAll(async () => {
  await app?.close();
  await mcp?.cerrar();
  await adaptador?.cerrar();
  if (dir) rmSync(resolve(dir, '..'), { recursive: true, force: true });
});

describe('Catálogo de herramientas y menor privilegio', () => {
  it('expone las capacidades de la sección 6.3; solo registrar_pago escribe', async () => {
    const { tools } = await mcp.cliente.listTools();
    const nombres = tools.map((t) => t.name);
    for (const n of ['consultar_credito', 'calcular_deuda_cuota', 'explicar_mora', 'listar_creditos_mora', 'ver_proximos_vencimientos', 'consultar_cartera', 'consultar_cierre', 'proponer_pago', 'registrar_pago']) {
      expect(nombres).toContain(n);
    }
    const escriben = tools.filter((t) => t.annotations?.readOnlyHint !== true).map((t) => t.name);
    expect(escriben).toEqual(['registrar_pago']);
    expect(HERRAMIENTAS_PARA_EL_MODELO).not.toContain('registrar_pago');
  });

  it('toda herramienta con cifras exige fecha de corte o periodo', async () => {
    const { tools } = await mcp.cliente.listTools();
    for (const t of tools.filter((x) => !['registrar_pago', 'buscar_politicas'].includes(x.name))) {
      const requeridos = (t.inputSchema.required ?? []) as string[];
      expect(requeridos.some((r) => ['fechaCorte', 'fechaPago', 'periodo'].includes(r)), t.name).toBe(true);
    }
  });
});

describe('Las herramientas devuelven lo mismo que el núcleo', () => {
  it('consultar_cartera = resumirCarteraTotal', async () => {
    const { datos } = await llamar('consultar_cartera', { fechaCorte: F });
    const n = await adaptador.resumirCarteraTotal(F);
    expect(datos.carteraActiva).toBe(n.resumen.carteraActiva.formato());
    expect(datos.carteraEnRiesgo).toBe(n.resumen.saldoEnRiesgo.formato());
    expect(datos.carteraEnMora).toBe(n.carteraEnMora.formato());
    expect(datos.incobrableDelMes).toBe('2333.48');
    expect(datos.riesgoPorTramo).toHaveLength(5);
  });

  it('consultar_credito y explicar_mora de CV-2026-0030 (G-5)', async () => {
    const c = await llamar('consultar_credito', { idCredito: 'CV-2026-0030', fechaCorte: F });
    expect(c.datos).toMatchObject({ estado: 'EN_MORA', diasAtraso: 65, tramo: 'MORA_3', saldoCapital: '686.16', cuotasPagadas: 2, cliente: 'Fernando Óscar Ramírez Coy' });
    const m = await llamar('explicar_mora', { idCredito: 'CV-2026-0030', numeroCuota: 3, fechaCorte: F });
    expect(m.datos).toMatchObject({ capitalEnMora: '164.02', diasAtraso: 65, interesMoratorio: '7.11', politicaMora: 'POL-2024-01' });
  });

  it('explicar_mora tramo por tramo de CV-2026-0410 al 2027-01-24 (G-7)', async () => {
    const { datos } = await llamar('explicar_mora', { idCredito: 'CV-2026-0410', numeroCuota: 2, fechaCorte: '2027-01-24' });
    expect(datos.tramos.map((t: Json) => [t.tramo, t.dias, t.tasaNominalAnual, t.importeSinRedondear]))
      .toEqual([['MORA_1', 30, '18.00 %', '10.8864'], ['MORA_2', 15, '24.00 %', '7.2576']]);
    expect(datos).toMatchObject({ interesMoratorio: '18.14', gastoGestion: '25.00', totalExigibleCuota: '1047.76' });
  });

  it('listar_creditos_mora, vencimientos y cierre coinciden con el adaptador', async () => {
    const l = await llamar('listar_creditos_mora', { fechaCorte: F, tramo: 'MORA_3' });
    expect(l.datos.creditos.map((c: Json) => [c.idCredito, c.diasAtraso, c.saldoCapital])).toEqual([['CV-2026-0035', 70, '1268.10'], ['CV-2026-0030', 65, '686.16']]);
    for (const dias of [7, 30]) {
      const v = await llamar('ver_proximos_vencimientos', { fechaCorte: F, dias });
      const n = await adaptador.verProximosVencimientos(F, dias);
      expect([v.datos.totalCuotas, v.datos.montoTotal]).toEqual([n.totalCuotas, n.montoTotal.formato()]);
    }
    const c = await llamar('consultar_cierre', { periodo: '2026-10' });
    const n = await adaptador.consultarCierre('2026-10');
    expect(c.datos.recuperaciones.total).toBe(n.recuperaciones.total.formato());
    expect(c.datos.desembolsos.monto).toBe(n.desembolsos.monto.formato());
  });
});

describe('Errores con convención uniforme', () => {
  it('crédito inexistente, fecha inválida, cuota ya pagada', async () => {
    expect((await llamar('consultar_credito', { idCredito: 'CV-2026-9999', fechaCorte: F })).datos.error.codigo).toBe('CREDITO_INEXISTENTE');
    expect((await llamar('consultar_cartera', { fechaCorte: '2026-02-30' })).datos.error.codigo).toBe('FECHA_INVALIDA');
    expect((await llamar('explicar_mora', { idCredito: 'CV-2026-0030', numeroCuota: 1, fechaCorte: F })).datos.error.codigo).toBe('CUOTA_YA_PAGADA');
    const formatoMalo = await mcp.llamar('consultar_cartera', { fechaCorte: '31/10/2026' });
    expect(formatoMalo.isError).toBe(true);
  });

  it('OP-5 y OP-6: proponer_pago rechaza monto no exacto e incobrable', async () => {
    const op5 = await llamar('proponer_pago', { idCredito: 'CV-2026-0061', monto: '500.00', fechaPago: F });
    expect(op5.error).toBe(true);
    expect(op5.datos.error).toMatchObject({ codigo: 'MONTO_NO_EXACTO', montoExigido: '370.85' });
    const op6 = await llamar('proponer_pago', { idCredito: 'CV-2026-0015', monto: '296.58', fechaPago: F });
    expect(op6.datos.error.codigo).toBe('CREDITO_INCOBRABLE');
  });
});

describe('Aprobación humana para registrar un pago', () => {
  let propuestaId: string;

  it('proponer_pago no escribe nada', async () => {
    const { datos } = await llamar('proponer_pago', { idCredito: 'CV-2026-0043', monto: '561.87', fechaPago: F, canal: 'campo' });
    expect(datos.estado).toBe('PENDIENTE_DE_APROBACION_HUMANA');
    expect(datos.aplicacion).toEqual({ gastos: '0.00', interesMoratorio: '17.22', interesCorriente: '75.00', capital: '469.65' });
    propuestaId = datos.propuestaId;
    expect((await adaptador.obtenerDetalleCredito('CV-2026-0043', F)).cuotasPagadas).toBe(0);
  });

  it('registrar_pago sin token, o con un token inventado, no escribe', async () => {
    expect((await llamar('registrar_pago', { propuestaId })).datos.error.codigo).toBe('APROBACION_REQUERIDA');
    expect((await llamar('registrar_pago', { propuestaId, tokenAprobacion: 'ab'.repeat(32) })).datos.error.codigo).toBe('APROBACION_REQUERIDA');
    expect((await adaptador.obtenerDetalleCredito('CV-2026-0043', F)).cuotasPagadas).toBe(0);
  });

  it('el clic «Aprobar» de la interfaz registra el pago una sola vez', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/propuestas/${propuestaId}/aprobacion`, headers: { 'x-usuario': 'Elena Morales' } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ resultado: 'APLICADO', aprobadoPor: 'Elena Morales', credito: { saldoCapital: '2530.35', cuotasPagadas: 1 } });
    const otraVez = await app.inject({ method: 'POST', url: `/api/propuestas/${propuestaId}/aprobacion`, headers: { 'x-usuario': 'Elena Morales' } });
    expect(otraVez.statusCode).toBe(409);
    expect((await adaptador.obtenerDetalleCredito('CV-2026-0043', F)).cuotasPagadas).toBe(1);
  });

  it('rechazar con propuestaId no registra ningún pago y bloquea su aprobación', async () => {
    const antes = await adaptador.obtenerDetalleCredito('CV-2026-0061', F);
    const { datos } = await llamar('proponer_pago', { idCredito: antes.idCredito, fechaPago: F });
    const rechazo = await app.inject({ method: 'POST', url: `/api/propuestas/${datos.propuestaId}/rechazo`, headers: { 'x-usuario': 'Elena Morales' } });
    expect(rechazo.statusCode).toBe(200);
    expect(rechazo.json()).toMatchObject({ id: datos.propuestaId, estado: 'RECHAZADA' });
    const aprobacion = await app.inject({ method: 'POST', url: `/api/propuestas/${datos.propuestaId}/aprobacion`, headers: { 'x-usuario': 'Elena Morales' } });
    expect(aprobacion.statusCode).toBe(409);
    const despues = await adaptador.obtenerDetalleCredito(antes.idCredito, F);
    expect(despues.cuotasPagadas).toBe(antes.cuotasPagadas);
    expect(despues.saldoCapital.formato()).toBe(antes.saldoCapital.formato());
  });
});

describe('Privacidad y transporte', () => {
  it('ninguna respuesta de herramienta contiene DPI ni teléfono', () => {
    expect(textos.length).toBeGreaterThan(10);
    for (const t of textos) expect(t).not.toMatch(/DPI-FICT|\b5555-\d{4}\b/);
  });

  it('el servidor también responde por Streamable HTTP en /mcp', async () => {
    const url = await app.listen({ port: 0, host: '127.0.0.1' });
    const cliente = new Client({ name: 'prueba-http', version: '1.0.0' });
    await cliente.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));
    const r = (await cliente.callTool({ name: 'consultar_credito', arguments: { idCredito: 'CV-2026-0015', fechaCorte: F } })) as CallToolResult;
    expect((r.structuredContent as Json).estado).toBe('INCOBRABLE');
    await cliente.close();
  }, 30_000);
});
