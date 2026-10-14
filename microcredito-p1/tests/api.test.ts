/**
 * API REST de punta a punta, en el orden del video (Bloque 2 y Bloque 3), sobre una COPIA
 * temporal de `.cv-db`. Las pruebas de este archivo dependen del orden: OP-4 reintenta
 * OP-1 y el cierre del 31 de octubre incluye lo operado antes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';

import { AdaptadorNucleo } from '../src/persistencia/adaptador-nucleo.js';
import { construirServidor } from '../src/api/servidor.js';

const F = '2026-10-31';
const ORIGEN_DB = process.env.CV_DB_DIR ?? resolve(process.cwd(), '.cv-db');
const ASESOR = { 'x-perfil': 'asesor', 'x-usuario': 'Byron Chacón' };
const GERENCIA = { 'x-perfil': 'gerencia', 'x-usuario': 'Elena Morales' };
const APROBACION = { aprobado: true, aprobadoPor: 'Elena Morales' };

type Cuerpo = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let dir: string;
let adaptador: AdaptadorNucleo;
let app: FastifyInstance;

async function get(url: string): Promise<{ status: number; body: Cuerpo }> {
  const r = await app.inject({ method: 'GET', url });
  return { status: r.statusCode, body: r.json() };
}
async function post(url: string, payload: unknown, headers: Record<string, string> = ASESOR): Promise<{ status: number; body: Cuerpo }> {
  const r = await app.inject({ method: 'POST', url, payload: payload as object, headers });
  return { status: r.statusCode, body: r.json() };
}

beforeAll(async () => {
  if (!existsSync(ORIGEN_DB)) throw new Error(`No existe ${ORIGEN_DB}. Ejecute "npm run cargar:datos" antes de "npm test".`);
  dir = join(mkdtempSync(join(tmpdir(), 'cv-api-')), 'db');
  cpSync(ORIGEN_DB, dir, { recursive: true });
  adaptador = await AdaptadorNucleo.abrir({ dbDir: dir });
  app = await construirServidor({ adaptador });
}, 60_000);

afterAll(async () => {
  await app?.close();
  await adaptador?.cerrar();
  if (dir) rmSync(resolve(dir, '..'), { recursive: true, force: true });
});

describe('Reglas transversales', () => {
  it('toda lectura exige fecha de corte explícita', async () => {
    const r = await get('/api/cartera');
    expect(r.status).toBe(400);
    expect(r.body.codigo).toBe('DATOS_INVALIDOS');
    const mala = await get('/api/cartera?fechaCorte=2026-02-30');
    expect(mala.status).toBe(400);
    expect(mala.body.codigo).toBe('FECHA_INVALIDA');
  });

  it('crédito inexistente responde 404 con convención uniforme', async () => {
    const r = await get(`/api/creditos/CV-2026-9999?fechaCorte=${F}`);
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ codigo: 'CREDITO_INEXISTENTE', status: 404 });
    expect(r.body.type).toMatch(/credito-inexistente$/);
  });

  it('el dinero viaja como texto con dos decimales, nunca como número', async () => {
    const r = await get(`/api/creditos/CV-2026-0043?fechaCorte=${F}`);
    expect(r.body.saldoCapital).toEqual({ valor: '3000.00', moneda: 'GTQ' });
  });
});

describe('Bloque 2 · operaciones por la interfaz', () => {
  it('OP-1 · muestra el desglose, exige aprobación humana y aplica el pago', async () => {
    const exigible = await post('/api/pagos/simulacion', { idCredito: 'CV-2026-0043', fechaPago: F });
    expect(exigible.status).toBe(200);
    expect(exigible.body.permitePago).toBe(true);
    expect(exigible.body.cuota).toMatchObject({
      numero: 1, diasAtraso: 55, tramo: 'MORA_2',
      gastoGestion: { valor: '0.00' }, interesMoratorio: { valor: '17.22' }, interesCorriente: { valor: '75.00' }, capital: { valor: '469.65' }, total: { valor: '561.87' },
    });

    const sinAprobar = await app.inject({
      method: 'POST', url: '/api/creditos/CV-2026-0043/pagos', headers: { ...ASESOR, 'idempotency-key': 'OP1-0043' },
      payload: { monto: '561.87', fechaPago: F, canal: 'campo' },
    });
    expect(sinAprobar.statusCode).toBe(428);
    expect(sinAprobar.json().codigo).toBe('APROBACION_REQUERIDA');
    expect((await get(`/api/creditos/CV-2026-0043?fechaCorte=${F}`)).body.cuotasPagadas).toBe(0);

    const r = await app.inject({
      method: 'POST', url: '/api/creditos/CV-2026-0043/pagos', headers: { ...ASESOR, 'idempotency-key': 'OP1-0043' },
      payload: { monto: '561.87', fechaPago: F, canal: 'campo', aprobacion: APROBACION },
    });
    expect(r.statusCode).toBe(201);
    const b = r.json();
    expect(b.resultado).toBe('APLICADO');
    expect(b.aplicacion.aplicado).toMatchObject({ gastos: { valor: '0.00' }, interesMoratorio: { valor: '17.22' }, interesCorriente: { valor: '75.00' }, capital: { valor: '469.65' } });
    expect(b.credito.saldoCapital.valor).toBe('2530.35');
    expect(b.credito.cuotasPagadas).toBe(1);
    expect(b.credito.diasAtraso).toBe(25);
    expect(b.credito.tramo).toBe('MORA_1');
  });

  it('OP-2 · detalle de la mora de CV-2026-0035 y pago de su cuota vencida', async () => {
    const mora = await get(`/api/creditos/CV-2026-0035/cuotas/2/mora?fechaCorte=${F}`);
    expect(mora.status).toBe(200);
    expect(mora.body.cuota).toMatchObject({ diasAtraso: 70, tramo: 'MORA_3', interesMoratorio: { valor: '11.15' }, total: { valor: '288.05' } });
    expect(mora.body.cuota.tramosRecorridos).toHaveLength(1);

    const r = await app.inject({
      method: 'POST', url: '/api/creditos/CV-2026-0035/pagos', headers: { ...ASESOR, 'idempotency-key': 'OP2-0035' },
      payload: { monto: '288.05', fechaPago: F, canal: 'campo', aprobacion: APROBACION },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().credito).toMatchObject({ cuotasPagadas: 2, diasAtraso: 39, tramo: 'MORA_2', saldoCapital: { valor: '1029.24' } });
  });

  it('OP-3 · alta de cliente, solicitud con plan simulado, aprobación y desembolso', async () => {
    const cliente = await post('/api/clientes', {
      idCliente: 'CL-9001', nombreCompleto: 'Gerencia Demostración Gálvez', dpi: 'DPI-FICT-009001', municipio: 'Guatemala', fechaAlta: F,
    });
    expect(cliente.status).toBe(201);
    const repetido = await post('/api/clientes', {
      idCliente: 'CL-9001', nombreCompleto: 'Gerencia Demostración Gálvez', dpi: 'DPI-FICT-009001', municipio: 'Guatemala', fechaAlta: F,
    });
    expect(repetido.status).toBe(409);

    const sol = await post('/api/solicitudes', { idCliente: 'CL-9001', idAsesor: 'AS-01', capital: '10000.00', plazoMeses: 12, tnaBps: 3600, fecha: F });
    expect(sol.status).toBe(201);
    const { idSolicitud } = sol.body.solicitud;
    expect(sol.body.solicitud.estado).toBe('SOLICITADA');
    // MAN-PRODUCTO-01: Q10,000 al 36 % en 12 cuotas → Q1,004.62 y la cuota 12 de Q1,004.63.
    expect(sol.body.plan.cuotas[0].pago.valor).toBe('1004.62');
    expect(sol.body.plan.cuotas[11].pago.valor).toBe('1004.63');
    expect(sol.body.plan.cuotas[11].saldoFinal.valor).toBe('0.00');
    expect(sol.body.plan.politicaMora).toBe('POL-2026-10');

    const prematuro = await post(`/api/solicitudes/${idSolicitud}/desembolso`, { idCredito: 'CV-2026-9001', fecha: F });
    expect(prematuro.status).toBe(409);
    expect(prematuro.body.codigo).toBe('TRANSICION_INVALIDA');

    const porAsesor = await post(`/api/solicitudes/${idSolicitud}/resolucion`, { decision: 'APROBADA', motivo: 'Comité de crédito', fecha: F });
    expect(porAsesor.status).toBe(403);
    const aprobada = await post(`/api/solicitudes/${idSolicitud}/resolucion`, { decision: 'APROBADA', motivo: 'Comité de crédito', fecha: F }, GERENCIA);
    expect(aprobada.status).toBe(200);
    expect(aprobada.body.estado).toBe('APROBADA');

    const des = await post(`/api/solicitudes/${idSolicitud}/desembolso`, { idCredito: 'CV-2026-9001', fecha: F });
    expect(des.status).toBe(201);
    expect(des.body).toMatchObject({ idCredito: 'CV-2026-9001', estado: 'VIGENTE', saldoCapital: { valor: '10000.00' }, politicaMora: 'POL-2026-10', nombreCliente: 'Gerencia Demostración Gálvez' });
  });

  it('OP-4 · reintentar OP-1 con la misma clave no vuelve a aplicar el pago', async () => {
    const antes = {
      credito: (await get('/api/creditos/CV-2026-0043?fechaCorte=' + F)).body,
      cierre: (await get('/api/cierres/' + F)).body,
      pagos: await adaptador.auditarPagos(),
      eventos: await adaptador.leerEventosBitacora(),
      canonicos: (await adaptador.db.query('SELECT * FROM eventos_canonicos ORDER BY seq')).rows,
      pagosCanonicos: (await adaptador.db.query('SELECT * FROM pagos ORDER BY id')).rows,
    };
    const r = await app.inject({
      method: 'POST', url: '/api/creditos/CV-2026-0043/pagos', headers: { ...ASESOR, 'idempotency-key': 'OP1-0043' },
      payload: { monto: '561.87', fechaPago: F, canal: 'campo', aprobacion: APROBACION },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().resultado).toBe('DUPLICADO');
    expect(r.json().credito.saldoCapital.valor).toBe('2530.35');
    expect(r.json().credito.cuotasPagadas).toBe(1);
    expect(r.json().credito).toEqual(antes.credito);
    expect((await get('/api/cierres/' + F)).body).toEqual(antes.cierre);
    expect(await adaptador.auditarPagos()).toEqual(antes.pagos);
    expect(await adaptador.leerEventosBitacora()).toEqual(antes.eventos);
    expect((await adaptador.db.query('SELECT * FROM eventos_canonicos ORDER BY seq')).rows).toEqual(antes.canonicos);
    expect((await adaptador.db.query('SELECT * FROM pagos ORDER BY id')).rows).toEqual(antes.pagosCanonicos);
  });

  it('OP-5 · Q500.00 a CV-2026-0061 se rechaza e indica el monto correcto', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/creditos/CV-2026-0061/pagos', headers: { ...ASESOR, 'idempotency-key': 'OP5-0061' },
      payload: { monto: '500.00', fechaPago: F, canal: 'campo', aprobacion: APROBACION },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ codigo: 'MONTO_NO_EXACTO', montoExigido: '370.85', numeroCuota: 1 });
  });

  it('OP-6 · CV-2026-0015 se rechaza por incobrable', async () => {
    const consulta = await post('/api/pagos/simulacion', { idCredito: 'CV-2026-0015', fechaPago: F });
    expect(consulta.body).toMatchObject({ permitePago: false, motivo: 'CREDITO_INCOBRABLE' });
    const r = await app.inject({
      method: 'POST', url: '/api/creditos/CV-2026-0015/pagos', headers: { ...ASESOR, 'idempotency-key': 'OP6-0015' },
      payload: { monto: '296.58', fechaPago: F, canal: 'campo', aprobacion: APROBACION },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().codigo).toBe('CREDITO_INCOBRABLE');
  });

  it('sin Idempotency-Key no se registra nada; una clave reutilizada para otro pago es conflicto', async () => {
    const sinClave = await post('/api/creditos/CV-2026-0061/pagos', { monto: '370.85', fechaPago: F, canal: 'campo', aprobacion: APROBACION });
    expect(sinClave.status).toBe(400);
    const conflicto = await app.inject({
      method: 'POST', url: '/api/creditos/CV-2026-0061/pagos', headers: { ...ASESOR, 'idempotency-key': 'OP1-0043' },
      payload: { monto: '370.85', fechaPago: F, canal: 'campo', aprobacion: APROBACION },
    });
    expect(conflicto.statusCode).toBe(409);
    expect(conflicto.json().codigo).toBe('CLAVE_EN_CONFLICTO');
  });
});

describe('Bloque 3 · consultas gerenciales (después de operar)', () => {
  it('G-1 · el tablero coincide con el núcleo consultado directamente', async () => {
    const api = await get(`/api/cartera?fechaCorte=${F}`);
    const directo = await adaptador.resumirCarteraTotal(F);
    expect(api.body.resumen.carteraActiva.valor).toBe(directo.resumen.carteraActiva.formato());
    expect(api.body.resumen.saldoEnRiesgo.valor).toBe(directo.resumen.saldoEnRiesgo.formato());
    expect(api.body.carteraEnMora.valor).toBe(directo.carteraEnMora.formato());
    expect(api.body.incobrableDelMes.valor).toBe('2333.48');
    expect(api.body.conteos.desembolsados).toBe(76);
  });

  it('G-3 · el cierre del 31 de octubre refleja OP-1, OP-2 y OP-3', async () => {
    const r = await get(`/api/cierres/${F}`);
    expect(r.body.tipo).toBe('DIARIO');
    expect(r.body.desembolsos).toMatchObject({ cantidad: 1, monto: { valor: '10000.00' } });
    expect(r.body.recuperaciones).toMatchObject({
      pagos: 2,
      gastos: { valor: '0.00' },
      interesMoratorio: { valor: '28.37' },
      interesCorriente: { valor: '113.04' },
      capital: { valor: '708.51' },
      total: { valor: '849.92' },
    });
  });

  it('G-2 · cierre mensual: la suma por concepto cuadra con el total cobrado', async () => {
    const r = await get('/api/cierres/2026-10');
    const rec = r.body.recuperaciones;
    const suma = ['gastos', 'interesMoratorio', 'interesCorriente', 'capital']
      .reduce((t, k) => t + Math.round(Number(rec[k].valor) * 100), 0);
    expect(suma).toBe(Math.round(Number(rec.total.valor) * 100));
    expect(r.body.desembolsos.cantidad).toBe(11);
  });

  it('G-4 · créditos en Mora 3 con días y saldo', async () => {
    const r = await get(`/api/cartera/mora?fechaCorte=${F}&tramo=MORA_3`);
    expect(r.body.creditos.map((c: Cuerpo) => [c.idCredito, c.diasAtraso, c.saldoCapital.valor])).toEqual([['CV-2026-0030', 65, '686.16']]);
  });

  it('G-5 · estado de CV-2026-0030 y mora de su cuota 3', async () => {
    const d = await get(`/api/creditos/CV-2026-0030?fechaCorte=${F}`);
    expect(d.body).toMatchObject({ estado: 'EN_MORA', diasAtraso: 65, tramo: 'MORA_3', cuotasPagadas: 2, saldoCapital: { valor: '686.16' } });
    const m = await get(`/api/creditos/CV-2026-0030/cuotas/3/mora?fechaCorte=${F}`);
    // POL-2024-01: 164.02 × (0.24 ÷ 360) × 65 = 7.1075… → Q7.11
    expect(m.body.cuota).toMatchObject({ capital: { valor: '164.02' }, interesMoratorio: { valor: '7.11' } });
    const pagada = await get(`/api/creditos/CV-2026-0030/cuotas/1/mora?fechaCorte=${F}`);
    expect(pagada.status).toBe(409);
    expect(pagada.body.codigo).toBe('CUOTA_YA_PAGADA');
  });

  it('G-6 · vencimientos: la ventana de 30 días contiene a la de 7', async () => {
    const v7 = await get(`/api/vencimientos?fechaCorte=${F}&dias=7`);
    const v30 = await get(`/api/vencimientos?fechaCorte=${F}&dias=30`);
    expect(v7.body).toMatchObject({ desde: '2026-11-01', hasta: '2026-11-07' });
    expect(v30.body.totalCuotas).toBeGreaterThanOrEqual(v7.body.totalCuotas);
    const suma = v7.body.cuotas.reduce((t: number, c: Cuerpo) => t + Math.round(Number(c.monto.valor) * 100), 0);
    expect(suma).toBe(Math.round(Number(v7.body.montoTotal.valor) * 100));
  });

  it('G-7 · CV-2026-0410 cuota 2 al 2027-01-24, tramo por tramo', async () => {
    const m = await get('/api/creditos/CV-2026-0410/cuotas/2/mora?fechaCorte=2027-01-24');
    expect(m.body.cuota.tramosRecorridos.map((t: Cuerpo) => [t.tramo, t.dias, t.tasaAnualBps, t.montoSinRedondear]))
      .toEqual([['MORA_1', 30, 1800, '10.8864'], ['MORA_2', 15, 2400, '7.2576']]);
    expect(m.body.totalSinRedondear).toBe('18.144');
    expect(m.body.cuota.interesMoratorio.valor).toBe('18.14');
    expect(m.body.cuota.total.valor).toBe('1047.76');
  });
});

describe('Persistencia de lo operado', () => {
  it('sobrevive a cerrar y reabrir la base, sin tocar la carga canónica', async () => {
    await app.close();
    await adaptador.cerrar();
    adaptador = await AdaptadorNucleo.abrir({ dbDir: dir });
    app = await construirServidor({ adaptador });
    const d = await get(`/api/creditos/CV-2026-0043?fechaCorte=${F}`);
    expect(d.body.saldoCapital.valor).toBe('2530.35');
    const auditoria = await adaptador.auditarPagos();
    expect(auditoria.registradosPorInterfaz).toBe(2);
    const canonicos = await adaptador.db.query<{ n: number }>('SELECT count(*)::int AS n FROM pagos');
    expect(canonicos.rows[0].n).toBe(auditoria.registros - auditoria.registradosPorInterfaz);
  }, 30_000);
});
