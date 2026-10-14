import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { AdaptadorNucleo } from '../src/persistencia/adaptador-nucleo.js';
import { construirServidor } from '../src/api/servidor.js';
import { Cierre, type TCierre } from '../src/contratos/api.js';
import { aJson } from '../src/api/serializacion.js';

const F = '2026-10-31';
const GERENCIA = { 'x-perfil': 'gerencia', 'x-usuario': 'Elena Morales' };
const ASESOR = { 'x-perfil': 'asesor', 'x-usuario': 'Byron Chacón' };
let directorio: string;
let dbDir: string;
let adaptador: AdaptadorNucleo;
let app: FastifyInstance;
let mensual: TCierre;
let diario: TCierre;

beforeAll(async () => {
  directorio = mkdtempSync(join(tmpdir(), 'cv-cierres-'));
  dbDir = join(directorio, 'db');
  cpSync(process.env.CV_DB_DIR ?? resolve('.cv-db'), dbDir, { recursive: true });
  adaptador = await AdaptadorNucleo.abrir({ dbDir });
  app = await construirServidor({ adaptador });
}, 60_000);
afterAll(async () => {
  await app?.close(); await adaptador?.cerrar();
  if (directorio) rmSync(directorio, { recursive: true, force: true });
});

async function cantidad() {
  return Number((await adaptador.db.query<{ cantidad: number }>('SELECT count(*) AS cantidad FROM cierres_ejecutados')).rows[0].cantidad);
}
async function consultar(periodo: string) {
  const r = await app.inject({ method: 'GET', url: `/api/cierres/${periodo}` });
  expect(r.statusCode).toBe(200);
  return Cierre.parse(r.json());
}
async function ejecutar(periodo: string, usuario = 'Elena Morales') {
  const r = await app.inject({ method: 'POST', url: `/api/cierres/${periodo}/ejecucion`, headers: { ...GERENCIA, 'x-usuario': usuario } });
  expect(r.statusCode).toBe(200);
  return Cierre.parse(r.json());
}
async function registrosFinancieros() {
  return {
    eventos: await adaptador.leerEventosBitacora(),
    pagos: await adaptador.auditarPagos(),
    pagosCanonicos: (await adaptador.db.query('SELECT * FROM pagos ORDER BY id')).rows,
    eventosCanonicos: (await adaptador.db.query('SELECT * FROM eventos_canonicos ORDER BY seq')).rows,
  };
}

describe('Cierres persistidos sobre una copia temporal', () => {
  it('GET consulta una vista previa sin ejecutar ni escribir registros', async () => {
    const registros = await registrosFinancieros();
    expect(await cantidad()).toBe(0);
    expect(await consultar('2026-10')).toMatchObject({ estado: 'PREVIA', periodo: '2026-10', fechaCorte: F });
    expect(await consultar(F)).toMatchObject({ estado: 'PREVIA', fechaCorte: F });
    expect(await cantidad()).toBe(0);
    expect(await registrosFinancieros()).toEqual(registros);
  });

  it('solo Gerencia puede ejecutar; rechaza períodos inválidos sin guardar nada', async () => {
    const asesor = await app.inject({ method: 'POST', url: '/api/cierres/2026-10/ejecucion', headers: ASESOR });
    expect(asesor.statusCode).toBe(403);
    const sinUsuario = await app.inject({ method: 'POST', url: '/api/cierres/2026-10/ejecucion', headers: { 'x-perfil': 'gerencia' } });
    expect(sinUsuario.statusCode).toBe(400);
    for (const periodo of ['2026-13', '2026-02-30', 'octubre']) {
      const r = await app.inject({ method: 'POST', url: `/api/cierres/${periodo}/ejecucion`, headers: GERENCIA });
      expect(r.statusCode).toBe(400);
    }
    expect(await cantidad()).toBe(0);
  });

  it('ejecutar guarda las cifras actuales, corte, operador y versiones reales de políticas', async () => {
    const registros = await registrosFinancieros();
    const previa = await consultar('2026-10');
    mensual = await ejecutar('2026-10');
    expect(mensual).toEqual({ ...previa, estado: 'EJECUTADO', ejecutadoPor: 'Elena Morales' });
    expect(mensual.politicasUtilizadas.versionParametros).toBe('1.0');
    expect(mensual.politicasUtilizadas.parametros).toEqual(adaptador.politicas.parametros);
    expect(mensual.politicasUtilizadas.huellaParametros).toBe(createHash('sha256').update(JSON.stringify(adaptador.politicas.parametros)).digest('hex'));
    expect(mensual.politicasUtilizadas.mora.map((p) => p.id)).toEqual(['POL-2024-01', 'POL-2026-10']);
    for (const politica of mensual.politicasUtilizadas.mora) {
      expect(politica.huellaDefinicion).toBe(createHash('sha256').update(JSON.stringify(adaptador.politicas.parametros.politicas_mora[politica.id])).digest('hex'));
    }
    expect(await cantidad()).toBe(1);
    expect(await registrosFinancieros()).toEqual(registros);
    expect(await consultar('2026-10')).toEqual(mensual);
  });

  it('las repeticiones y ejecuciones concurrentes devuelven el original sin duplicados ni efectos contables', async () => {
    const registros = await registrosFinancieros();
    const guardado = (await adaptador.db.query('SELECT * FROM cierres_ejecutados ORDER BY periodo')).rows;
    const calcular = vi.spyOn(adaptador, 'listarDetallesCreditos').mockRejectedValue(new Error('No debe recalcular'));
    try {
      const repetidos = await Promise.all([ejecutar('2026-10', 'Otro gerente'), ejecutar('2026-10'), consultar('2026-10')]);
      for (const r of repetidos) expect(r).toEqual(mensual);
      expect(calcular).not.toHaveBeenCalled();
    } finally { calcular.mockRestore(); }
    expect(await cantidad()).toBe(1);
    expect((await adaptador.db.query('SELECT * FROM cierres_ejecutados ORDER BY periodo')).rows).toEqual(guardado);
    expect(await registrosFinancieros()).toEqual(registros);
    const diarios = await Promise.all([ejecutar(F), ejecutar(F)]);
    diario = diarios[0];
    expect(diarios[1]).toEqual(diario);
    expect(await cantidad()).toBe(2);
  });

  it('las operaciones posteriores permitidas, incluso dentro del período, no modifican el cierre congelado', async () => {
    const guardarPago = async (fecha: string, clave: string) => {
      const exigible = await adaptador.consultarExigible('CV-2026-0043', fecha);
      expect(exigible.permitePago).toBe(true);
      const r = await app.inject({ method: 'POST', url: '/api/creditos/CV-2026-0043/pagos',
        headers: { ...ASESOR, 'idempotency-key': clave },
        payload: { monto: exigible.cuota!.total.formato(), fechaPago: fecha, canal: 'campo', aprobacion: { aprobado: true, aprobadoPor: ASESOR['x-usuario'] } } });
      expect(r.statusCode).toBe(201);
    };
    const antes = await registrosFinancieros();
    await guardarPago(F, 'cierre-posterior-mismo-periodo');
    const credito = await adaptador.obtenerDetalleCredito('CV-2026-0043', F);
    expect(credito.cuotasPagadas).toBe(1);
    expect((await consultar('2026-11-01')).cartera.resumen.carteraActiva).not.toEqual(mensual.cartera.resumen.carteraActiva);
    await guardarPago('2026-11-01', 'cierre-posterior-siguiente-periodo');
    expect(await consultar('2026-10')).toEqual(mensual);
    expect(await consultar(F)).toEqual(diario);
    expect(await ejecutar('2026-10')).toEqual(mensual);
    expect(await cantidad()).toBe(2);
    const despues = await registrosFinancieros();
    expect(despues.pagos.registradosPorInterfaz).toBe(antes.pagos.registradosPorInterfaz + 2);
    expect(despues.pagosCanonicos).toEqual(antes.pagosCanonicos);
    expect(despues.eventosCanonicos).toEqual(antes.eventosCanonicos);
  });

  it('reiniciar la conexión conserva el resultado y restaura Dinero y Decimal sin recalcular', async () => {
    await app.close(); await adaptador.cerrar();
    adaptador = await AdaptadorNucleo.abrir({ dbDir });
    app = await construirServidor({ adaptador });
    const calcular = vi.spyOn(adaptador, 'listarDetallesCreditos').mockRejectedValue(new Error('No debe recalcular'));
    try {
      expect(await consultar('2026-10')).toEqual(mensual);
      expect(await consultar(F)).toEqual(diario);
      expect(await ejecutar('2026-10')).toEqual(mensual);
      const interno = await adaptador.consultarCierre('2026-10');
      expect(interno.recuperaciones.total.formato()).toBe(mensual.recuperaciones.total.valor);
      expect(interno.cartera.resumen.porcentajeRiesgo.toString()).toBe(mensual.cartera.resumen.porcentajeRiesgo);
      expect(aJson(interno)).toEqual(mensual);
      expect(calcular).not.toHaveBeenCalled();
      expect(await cantidad()).toBe(2);
    } finally { calcular.mockRestore(); }
  }, 60_000);
});
