import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { endOfMonth, format, parseISO } from 'date-fns';
import { Decimal } from 'decimal.js';
import { Dinero } from '../src/dominio/dinero.js';
import { resumirCartera } from '../src/dominio/cartera.js';
import { proyectarDevengo, resumirDevengo, type CreditoDevengo, type PoliticaDevengo } from '../src/dominio/devengo.js';
import { abrirBaseDatos } from '../src/persistencia/base-datos.js';
import type { Cierre, ConexionSql } from '../src/persistencia/adaptador-nucleo.js';
import { asegurarCierres, guardarCierre, leerCierre } from '../src/persistencia/cierres-persistidos.js';
import { asegurarMovimientosProvisiones, abrirDesdeHistorico, guardarCierreConMovimientos } from '../src/persistencia/movimientos-provisiones.js';
import { asegurarDevengo, prepararDevengo, leerMovimientosDevengo } from '../src/persistencia/devengo-persistido.js';
import { Cierre as ContratoCierre } from '../src/contratos/api.js';
import { aJson } from '../src/api/serializacion.js';

const dir = mkdtempSync(join(tmpdir(), 'cv-devengo-'));
const politica: PoliticaDevengo = JSON.parse(readFileSync(resolve('configuracion/devengo/credito-vecino-v1.json'), 'utf8'));
const parametros = JSON.parse(readFileSync(resolve('datos/datos-proyecto-final/politicas.json'), 'utf8'));
const pReserva = JSON.parse(readFileSync(resolve('configuracion/provisiones/credito-vecino-v1.json'), 'utf8'));
let db: ConexionSql;
const fuentes: CreditoDevengo[] = [{ id: 'C1', desembolso: '2026-01-01', politica, eventos: [], cuotas: [
  { numero: 1, inicio: '2026-01-01', vencimiento: '2026-02-01', interes: Dinero.de('31') },
  { numero: 2, inicio: '2026-02-01', vencimiento: '2026-03-01', interes: Dinero.de('28') },
] }];
function cierre(periodo: string): Cierre {
  const mensual = periodo.length === 7;
  const desde = mensual ? `${periodo}-01` : periodo;
  const hasta = mensual ? format(endOfMonth(parseISO(desde)), 'yyyy-MM-dd') : desde;
  return { estado: 'EJECUTADO', ejecutadoPor: 'Gerente', tipo: mensual ? 'MENSUAL' : 'DIARIO', periodo, desde, hasta, fechaCorte: hasta,
    politicasUtilizadas: { parametros, huellaParametros: '0'.repeat(64), mora: [] },
    desembolsos: { cantidad: 0, monto: Dinero.cero(), creditos: [] },
    recuperaciones: { pagos: 0, gastos: Dinero.cero(), interesMoratorio: Dinero.cero(), interesCorriente: Dinero.cero(), capital: Dinero.cero(), total: Dinero.cero() },
    recuperacionesIncobrables: { pagos: 0, monto: Dinero.cero() }, incobrablesDelPeriodo: { creditos: [], monto: Dinero.cero() },
    cartera: { fechaCorte: hasta, resumen: resumirCartera([]), carteraEnMora: Dinero.cero(), porcentajeMora: new Decimal(0), porTramo: [],
      reestructuradosAlDia: { creditos: 0, saldo: Dinero.cero() }, conteos: { desembolsados: 0, activos: 0, enMora: 0, enRiesgo: 0, cancelados: 0, incobrables: 0 }, incobrablesDelMes: [], incobrableDelMes: Dinero.cero() },
    provisiones: { estado: 'DISPONIBLE', parametros: pReserva, version: pReserva.version, fechaCorte: hasta, total: Dinero.cero(), detalles: [] },
  };
}
async function nueva(nombre: string) {
  const r = await abrirBaseDatos(join(dir, nombre)) as unknown as ConexionSql;
  await asegurarCierres(r); await asegurarMovimientosProvisiones(r); await asegurarDevengo(r);
  return r;
}
beforeAll(async () => { db = await nueva('principal'); }, 60000);
afterAll(async () => { await db?.close(); rmSync(dir, { recursive: true, force: true }); });

it('vista previa diaria: Q13 de apertura y Q1 del día, sin escribir', async () => {
  const p = await prepararDevengo(db, cierre('2026-01-15'), fuentes, 'VISTA_PREVIA');
  expect(p.apertura.generado.formato()).toBe('13.00');
  expect(p.periodo.generado.formato()).toBe('1.00');
  expect(p.periodo.ingresoReconocido.formato()).toBe('1.00');
  expect((await db.query('SELECT * FROM movimientos_devengo')).rows).toHaveLength(0);
  expect((await db.query('SELECT * FROM aperturas_devengo')).rows).toHaveLength(0);
});
it('diario + mensual completan 30 días únicos en enero, sin doble ingreso ni filas duplicadas', async () => {
  const diario = await guardarCierreConMovimientos(db, cierre('2026-01-15'), fuentes);
  expect(diario.devengo?.estado === 'DISPONIBLE' && diario.devengo.periodo.generado.formato()).toBe('1.00');
  const cierres = await Promise.all([1, 2, 3].map(() => guardarCierreConMovimientos(db, cierre('2026-01'), fuentes)));
  for (const c of cierres) expect(c).toEqual(cierres[0]);
  const d = cierres[0].devengo;
  if (d?.estado !== 'DISPONIBLE') throw new Error('Falta devengo');
  expect(d.periodo.generado.formato()).toBe('30.00');
  expect(d.periodo.ingresoReconocido.formato()).toBe('30.00');
  expect(d.movimientosNuevos).toHaveLength(16);
  expect(d.movimientos.find(m => m.fechaContable === '2026-01-15')?.cierreId).toBe('2026-01-15');
  expect((await leerMovimientosDevengo(db, '2026-01-31'))).toHaveLength(30);
  expect(resumirDevengo(await leerMovimientosDevengo(db, '2026-01-31')).ingresoReconocido.formato()).toBe('30.00');
  const mismoCorte = await guardarCierreConMovimientos(db, cierre('2026-01-31'), fuentes);
  expect(mismoCorte.devengo?.estado === 'DISPONIBLE' && mismoCorte.devengo.movimientosNuevos).toEqual([]);
  expect(ContratoCierre.safeParse(aJson(mismoCorte)).success).toBe(true);
});
it('rollback revierte cierre, provisiones y devengo si falla un movimiento', async () => {
  await db.query(`CREATE FUNCTION fallo_devengo() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'Fallo de devengo'; END; $$ LANGUAGE plpgsql`);
  await db.query('CREATE TRIGGER fallo BEFORE INSERT ON movimientos_devengo FOR EACH ROW EXECUTE FUNCTION fallo_devengo()');
  const c = cierre('2026-02');
  if (c.provisiones?.estado !== 'DISPONIBLE') throw new Error('Falta reserva');
  c.provisiones.total = Dinero.de('1');
  c.provisiones.detalles = [{ id: 'C1', tramo: 'AL_DIA', excluido: false, base: Dinero.de('100'), porcentaje: new Decimal(1), provision: Dinero.de('1') }];
  await expect(guardarCierreConMovimientos(db, c, fuentes)).rejects.toThrow(/Fallo de devengo/);
  expect(await leerCierre(db, '2026-02')).toBeNull();
  expect((await db.query('SELECT * FROM movimientos_provisiones')).rows).toHaveLength(0);
  expect((await leerMovimientosDevengo(db, '2026-02-28'))).toHaveLength(30);
  await db.query('DROP TRIGGER fallo ON movimientos_devengo');
});
it('febrero reconoce Q28, conserva Q30 como apertura; reiniciar o cambiar la política actual no cambia lo asignado', async () => {
  const c = await guardarCierreConMovimientos(db, cierre('2026-02'), fuentes);
  if (c.devengo?.estado !== 'DISPONIBLE') throw new Error('Falta devengo');
  expect(c.devengo.apertura.ingresoReconocido.formato()).toBe('30.00');
  expect(c.devengo.periodo.ingresoReconocido.formato()).toBe('28.00');
  await db.close(); db = await abrirBaseDatos(join(dir, 'principal')) as unknown as ConexionSql;
  expect(await guardarCierreConMovimientos(db, cierre('2026-02'), [])).toEqual(c);
  const cambiadas = fuentes.map(f => ({ ...f, politica: { ...f.politica, version: 'NUEVA' } }));
  const marzo = await guardarCierreConMovimientos(db, cierre('2026-03-01'), cambiadas);
  expect(marzo.devengo?.estado === 'DISPONIBLE' && marzo.devengo.politicas[0].politica.version).toBe(politica.version);
  expect(resumirDevengo(await leerMovimientosDevengo(db, '2026-03-01')).generado.formato()).toBe('59.00');
});
it('detecta pagos retroactivos aunque no cambien todavía los importes, y rechaza un corte nuevo fuera de orden', async () => {
  const retro = fuentes.map(f => ({ ...f, eventos: [{ id: 'P', fecha: '2026-01-10', orden: 1, tipo: 'PAGO' as const, cuota: 1 }] }));
  await expect(guardarCierreConMovimientos(db, cierre('2026-03-02'), retro)).rejects.toThrow(/retroactivas/);
  await expect(guardarCierreConMovimientos(db, cierre('2026-01-20'), fuentes)).rejects.toThrow(/fuera de orden/);
  expect(await leerCierre(db, '2026-03-02')).toBeNull();
  await expect(db.query('DELETE FROM movimientos_devengo')).rejects.toThrow(/inmutable/);
});
it('un cierre histórico permanece no disponible; la primera ejecución reconstruye apertura sin llevar todo a enero', async () => {
  const historica = await nueva('historica');
  try {
    const viejo = cierre('2025-12');
    await guardarCierre(historica, viejo);
    const antes = (await historica.query('SELECT * FROM cierres_ejecutados')).rows;
    expect((await leerCierre(historica, '2025-12'))?.devengo?.estado).toBe('NO_DISPONIBLE');
    await abrirDesdeHistorico(historica, '2025-12', 'Gerente', 'Apertura explícita de la reserva antigua');
    const entradas: CreditoDevengo[] = [{ ...fuentes[0], desembolso: '2025-12-01', cuotas: [
      { numero: 1, inicio: '2025-12-01', vencimiento: '2026-01-01', interes: Dinero.de('31') },
      { numero: 2, inicio: '2026-01-01', vencimiento: '2026-02-01', interes: Dinero.de('31') },
    ] }];
    const nuevo = await guardarCierreConMovimientos(historica, cierre('2026-01'), entradas);
    if (nuevo.devengo?.estado !== 'DISPONIBLE') throw new Error('Falta devengo');
    expect(nuevo.devengo.apertura.generado.formato()).toBe('30.00');
    expect(nuevo.devengo.periodo.generado.formato()).toBe('31.00');
    expect((await historica.query("SELECT * FROM cierres_ejecutados WHERE periodo='2025-12'")).rows).toEqual(antes);
    const mov = await leerMovimientosDevengo(historica, '2026-01-31');
    expect(mov.filter(m => m.origen === 'APERTURA')).toHaveLength(30);
    expect((await leerCierre(historica, '2025-12'))?.devengo?.estado).toBe('NO_DISPONIBLE');
  } finally { await historica.close(); }
}, 60000);
it('los movimientos persistidos coinciden con el núcleo', async () => {
  const esperados = proyectarDevengo(fuentes[0], '2026-03-01');
  const guardados = await leerMovimientosDevengo(db, '2026-03-01');
  expect(guardados.map(m => [m.id, m.importe.formato(), m.concepto])).toEqual(esperados.map(m => [m.id, m.importe.formato(), m.concepto]));
});

it('suspenso de apertura Q9, regularización Q10 y mensual consolidado sin segundo reconocimiento', async () => {
  const registro = await nueva('suspenso');
  try {
    const fechas = ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01'];
    const entrada: CreditoDevengo = { id: 'S1', desembolso: fechas[0], politica,
      cuotas: ['31', '28', '31', '30', '31', '30'].map((interes, i) => ({ numero: i + 1, inicio: fechas[i], vencimiento: fechas[i + 1], interes: Dinero.de(interes) })),
      eventos: [1, 2, 3, 4].map(n => ({ id: `P${n}`, fecha: '2026-05-12', orden: n, tipo: 'PAGO', cuota: n })),
    };
    await registro.query(`CREATE FUNCTION fallo_inicial() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'Fallo inicial'; END; $$ LANGUAGE plpgsql`);
    await registro.query('CREATE TRIGGER fallo BEFORE INSERT ON movimientos_devengo FOR EACH ROW EXECUTE FUNCTION fallo_inicial()');
    await expect(guardarCierreConMovimientos(registro, cierre('2026-05-11'), [entrada])).rejects.toThrow(/Fallo inicial/);
    expect((await registro.query('SELECT * FROM aperturas_devengo')).rows).toHaveLength(0);
    expect(await leerCierre(registro, '2026-05-11')).toBeNull();
    await registro.query('DROP TRIGGER fallo ON movimientos_devengo');
    await guardarCierreConMovimientos(registro, cierre('2026-05-11'), [entrada]);
    const regularizado = await guardarCierreConMovimientos(registro, cierre('2026-05-12'), [entrada]);
    if (regularizado.devengo?.estado !== 'DISPONIBLE') throw new Error('Falta devengo');
    expect(regularizado.devengo.apertura.saldoSuspenso.formato()).toBe('9.00');
    expect(regularizado.devengo.periodo.enviadoSuspenso.formato()).toBe('1.00');
    expect(regularizado.devengo.periodo.suspensoRegularizado.formato()).toBe('10.00');
    expect(regularizado.devengo.periodo.ingresoReconocido.formato()).toBe('10.00');
    expect(regularizado.devengo.saldoFinalSuspenso.formato()).toBe('0.00');
    const mensual = await guardarCierreConMovimientos(registro, cierre('2026-05'), [entrada]);
    if (mensual.devengo?.estado !== 'DISPONIBLE') throw new Error('Falta mensual');
    expect(mensual.devengo.periodo.generado.formato()).toBe('31.00');
    expect(mensual.devengo.periodo.ingresoReconocido.formato()).toBe('31.00');
    expect(mensual.devengo.periodo.suspensoRegularizado.formato()).toBe('10.00');
    expect((await leerMovimientosDevengo(registro, '2026-05-31')).filter(m => m.concepto === 'REGULARIZACION')).toHaveLength(1);
  } finally { await registro.close(); }
}, 60000);
