/**
 * Conformidad contrato ↔ implementación: cada respuesta real del servidor debe cumplir el
 * esquema de `src/contratos/api.ts` que publica `docs/api/openapi.yaml`. Corre sobre una COPIA
 * temporal de `.cv-db`; las pruebas dependen del orden (alta → solicitud → comité → desembolso → pago).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';

import { AdaptadorNucleo } from '../src/persistencia/adaptador-nucleo.js';
import { construirServidor } from '../src/api/servidor.js';
import * as C from '../src/contratos/api.js';

const F = '2026-10-31';
const ORIGEN_DB = process.env.CV_DB_DIR ?? resolve(process.cwd(), '.cv-db');
const ASESOR = { 'x-perfil': 'asesor', 'x-usuario': 'Byron Chacón' };
const GERENCIA = { 'x-perfil': 'gerencia', 'x-usuario': 'Elena Morales' };
const APROBACION = { aprobado: true, aprobadoPor: 'Elena Morales' };

let dir: string;
let adaptador: AdaptadorNucleo;
let app: FastifyInstance;

async function pedir(method: 'GET' | 'POST', url: string, payload?: object, headers?: Record<string, string>) {
  const r = await app.inject({ method, url, payload, headers });
  return { status: r.statusCode, body: r.json() as unknown };
}

/** Valida y devuelve el cuerpo tipado; si falla, muestra qué campo no cumple. */
function cumple<T extends z.ZodType>(esquema: T, cuerpo: unknown): z.infer<T> {
  const r = esquema.safeParse(cuerpo);
  if (!r.success) throw new Error(`La respuesta no cumple el contrato:\n${JSON.stringify(r.error.issues.slice(0, 5), null, 2)}`);
  return r.data;
}

beforeAll(async () => {
  if (!existsSync(ORIGEN_DB)) throw new Error(`No existe ${ORIGEN_DB}. Ejecute "npm run cargar:datos" antes de "npm test".`);
  dir = join(mkdtempSync(join(tmpdir(), 'cv-contrato-')), 'db');
  cpSync(ORIGEN_DB, dir, { recursive: true });
  adaptador = await AdaptadorNucleo.abrir({ dbDir: dir });
  app = await construirServidor({ adaptador });
}, 60_000);

afterAll(async () => {
  await app?.close();
  await adaptador?.cerrar();
  if (dir) rmSync(resolve(dir, '..'), { recursive: true, force: true });
});

describe('Contrato de la API: lecturas', () => {
  it('catálogos', async () => {
    cumple(C.Asesor.array(), (await pedir('GET', '/api/asesores')).body);
    cumple(C.Politicas, (await pedir('GET', '/api/politicas')).body);
    cumple(C.Cliente.array(), (await pedir('GET', '/api/clientes?q=CL-00')).body);
  });

  it('créditos: listado, detalle, plan y explicación de mora de todos los créditos', async () => {
    const listado = cumple(C.ListadoCreditos, (await pedir('GET', `/api/creditos?fechaCorte=${F}`)).body);
    expect(listado.creditos.length).toBeGreaterThan(0);
    for (const { idCredito } of listado.creditos) {
      const detalle = cumple(C.DetalleCredito, (await pedir('GET', `/api/creditos/${idCredito}?fechaCorte=${F}`)).body);
      cumple(C.PlanCredito, (await pedir('GET', `/api/creditos/${idCredito}/plan?fechaCorte=${F}`)).body);
      const vencida = detalle.cuotasVencidas[0];
      if (vencida) cumple(C.ExplicacionMora, (await pedir('GET', `/api/creditos/${idCredito}/cuotas/${vencida.numero}/mora?fechaCorte=${F}`)).body);
    }
  }, 120_000);

  it('gerencia: cartera, mora por tramo, vencimientos y cierres', async () => {
    cumple(C.CarteraTablero, (await pedir('GET', `/api/cartera?fechaCorte=${F}`)).body);
    cumple(C.ListadoMora, (await pedir('GET', `/api/cartera/mora?fechaCorte=${F}`)).body);
    for (const tramo of C.TramoConsultable.options) {
      cumple(C.ListadoMora, (await pedir('GET', `/api/cartera/mora?fechaCorte=${F}&tramo=${tramo}`)).body);
    }
    cumple(C.Vencimientos, (await pedir('GET', `/api/vencimientos?fechaCorte=${F}&dias=30`)).body);
    cumple(C.Cierre, (await pedir('GET', '/api/cierres/2026-10')).body);
    cumple(C.Cierre, (await pedir('GET', `/api/cierres/${F}`)).body);
  });

  it('errores con la convención uniforme', async () => {
    const r = await pedir('GET', '/api/cartera');
    expect(r.status).toBe(400);
    cumple(C.Problema, r.body);
    cumple(C.Problema, (await pedir('GET', `/api/creditos/CV-2026-9999?fechaCorte=${F}`)).body);
    cumple(C.Problema, (await pedir('GET', '/api/no-existe')).body);
  });
});

describe('Contrato de la API: operaciones', () => {
  let idCreditoMora = '';
  let exigido = '';

  it('simulaciones de plan y de pago', async () => {
    cumple(C.PlanSimulado, (await pedir('POST', '/api/simulaciones/plan', { capital: '10000.00', plazoMeses: 12, tnaBps: 3600, fechaDesembolso: F })).body);
    const mora = cumple(C.ListadoMora, (await pedir('GET', `/api/cartera/mora?fechaCorte=${F}&tramo=MORA_2`)).body);
    idCreditoMora = mora.creditos[0]!.idCredito;
    const exigible = cumple(C.SimulacionPago, (await pedir('POST', '/api/pagos/simulacion', { idCredito: idCreditoMora, fechaPago: F })).body);
    expect('credito' in exigible && exigible.cuota).toBeTruthy();
    if ('credito' in exigible && exigible.cuota) exigido = exigible.cuota.total.valor;
    cumple(C.SimulacionPago, (await pedir('POST', '/api/pagos/simulacion', { idCredito: idCreditoMora, fechaPago: F, monto: exigido })).body);
    cumple(C.SimulacionPago, (await pedir('POST', '/api/pagos/simulacion', { idCredito: idCreditoMora, fechaPago: F, monto: '1.00' })).body);

    // Lo exigible de créditos al día, cancelados e incobrables (con motivo y mensaje).
    const { creditos } = cumple(C.ListadoCreditos, (await pedir('GET', `/api/creditos?fechaCorte=${F}`)).body);
    for (const estado of ['VIGENTE', 'CANCELADO', 'INCOBRABLE'] as const) {
      const credito = creditos.find((c) => c.estado === estado);
      expect(credito, `hay un crédito ${estado}`).toBeDefined();
      const r = cumple(C.SimulacionPago, (await pedir('POST', '/api/pagos/simulacion', { idCredito: credito!.idCredito, fechaPago: F })).body);
      expect('permitePago' in r && r.permitePago).toBe(estado === 'VIGENTE');
    }
  });

  it('originación: alta, solicitud, comité y desembolso', async () => {
    const alta = await pedir('POST', '/api/clientes', { idCliente: 'CL-0901', nombreCompleto: 'Cliente Contrato', dpi: 'DPI-CONTRATO-01', municipio: 'Cobán', fechaAlta: F }, ASESOR);
    expect(alta.status).toBe(201);
    cumple(C.Cliente, alta.body);

    const creada = cumple(C.SolicitudCreada, (await pedir('POST', '/api/solicitudes', { idCliente: 'CL-0901', idAsesor: 'AS-01', capital: '10000.00', plazoMeses: 12, tnaBps: 3600, fecha: F }, ASESOR)).body);
    cumple(C.Solicitud.array(), (await pedir('GET', '/api/solicitudes')).body);

    const id = creada.solicitud.idSolicitud;
    const resuelta = cumple(C.Solicitud, (await pedir('POST', `/api/solicitudes/${id}/resolucion`, { decision: 'APROBADA', motivo: 'Cumple la política', fecha: F }, GERENCIA)).body);
    expect(resuelta.estado).toBe('APROBADA');

    const desembolso = await pedir('POST', `/api/solicitudes/${id}/desembolso`, { idCredito: 'CV-2026-0901', fecha: F }, ASESOR);
    expect(desembolso.status).toBe(201);
    cumple(C.DetalleCredito, desembolso.body);
  });

  it('pago: aprobación requerida, aplicado y duplicado', async () => {
    const cabeceras = { ...ASESOR, 'idempotency-key': 'contrato-k1' };
    const sinAprobacion = await pedir('POST', `/api/creditos/${idCreditoMora}/pagos`, { monto: exigido, fechaPago: F, canal: 'agencia' }, cabeceras);
    expect(sinAprobacion.status).toBe(428);
    cumple(C.Problema, sinAprobacion.body);

    const cuerpo = { monto: exigido, fechaPago: F, canal: 'agencia', aprobacion: APROBACION };
    const aplicado = await pedir('POST', `/api/creditos/${idCreditoMora}/pagos`, cuerpo, cabeceras);
    expect(aplicado.status).toBe(201);
    cumple(C.PagoAplicadoRespuesta, aplicado.body);

    const repetido = await pedir('POST', `/api/creditos/${idCreditoMora}/pagos`, cuerpo, cabeceras);
    expect(repetido.status).toBe(200);
    cumple(C.PagoDuplicadoRespuesta, repetido.body);
  });
});
