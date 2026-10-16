import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Dinero } from '../src/dominio/dinero.js';
import { variacionesProvisiones } from '../src/dominio/movimientos-provisiones.js';
import { calcularProvisiones } from '../src/dominio/provisiones.js';
import { validarConfiguracionProvisiones } from '../src/contratos/provisiones.js';
import { abrirBaseDatos } from '../src/persistencia/base-datos.js';
import { cargarCanonico } from '../src/persistencia/carga-canonica.js';
import { AdaptadorNucleo, type Cierre, type ConexionSql } from '../src/persistencia/adaptador-nucleo.js';
import { asegurarCierres, guardarCierre, leerCierre } from '../src/persistencia/cierres-persistidos.js';
import { asegurarMovimientosProvisiones, abrirDesdeHistorico, guardarCierreConMovimientos,
  consultarRegistroProvisiones } from '../src/persistencia/movimientos-provisiones.js';
import { construirServidor } from '../src/api/servidor.js';
import { aJson } from '../src/api/serializacion.js';

const dir = mkdtempSync(join(tmpdir(), 'cv-movimientos-provisiones-'));
const politica = validarConfiguracionProvisiones(JSON.parse(readFileSync(resolve('configuracion/provisiones/credito-vecino-v1.json'), 'utf8')));
let base: Cierre;
let db: ConexionSql;
async function nueva(nombre: string) {
  const conexion = await abrirBaseDatos(join(dir, nombre)) as unknown as ConexionSql;
  await asegurarCierres(conexion); await asegurarMovimientosProvisiones(conexion);
  return conexion;
}
function cierre(mes: string, capital: string): Cierre {
  const fechaCorte = `${mes}-${mes === '2026-02' ? '28' : ['2026-04', '2026-06'].includes(mes) ? '30' : '31'}`;
  return { ...base, periodo: mes, desde: `${mes}-01`, hasta: fechaCorte, fechaCorte, estado: 'EJECUTADO', ejecutadoPor: 'Gerencia de prueba',
    provisiones: { estado: 'DISPONIBLE', parametros: politica,
      ...calcularProvisiones(politica, fechaCorte, [{ id: 'CV-2026-0001', saldoCapital: Dinero.de(capital),
        diasAtraso: 0, estado: 'VIGENTE', dadoDeBaja: false }]),
    },
  };
}
beforeAll(async () => {
  const fuente = await abrirBaseDatos(join(dir, 'fuente'));
  try { await cargarCanonico(fuente, resolve('datos/datos-proyecto-final')); } finally { await fuente.close(); }
  const a = await AdaptadorNucleo.abrir({ dbDir: join(dir, 'fuente') });
  try { base = await a.consultarCierre('2026-01'); } finally { await a.cerrar(); }
  db = await nueva('registro');
}, 60000);
afterAll(async () => { await db?.close(); rmSync(dir, { recursive: true, force: true }); });

it.each([['100', '150', '50.00'], ['150', '120', '-30.00'], ['120', '120', null]])(
  'variación independiente Q%s → Q%s', (anterior, objetivo, esperado) => {
    const r = variacionesProvisiones([{ creditoId: 'C', saldo: Dinero.de(anterior) }], [{ creditoId: 'C', saldo: Dinero.de(objetivo) }]);
    expect(r.map(m => m.variacion.formato())).toEqual(esperado === null ? [] : [esperado]);
  });

it('libera la reserva de un crédito ausente del objetivo y rechaza saldos inválidos', () => {
  expect(variacionesProvisiones([{ creditoId: 'C', saldo: Dinero.de('10') }], [])[0].variacion.formato()).toBe('-10.00');
  for (const entradas of [[{ creditoId: '', saldo: Dinero.de('1') }], [{ creditoId: 'C', saldo: Dinero.de('-1') }],
    [{ creditoId: 'C', saldo: Dinero.de('1', 'USD') }], [{ creditoId: 'C', saldo: Dinero.de('1') }, { creditoId: 'C', saldo: Dinero.de('2') }]]) {
    expect(() => variacionesProvisiones(entradas, [])).toThrow();
  }
});

it('registra 100 de inicio, +50, −30 y ningún movimiento por una reserva sin cambio', async () => {
  for (const [mes, capital, saldoAnterior, variacion, final, concepto] of [
    ['2026-01', '10000', '0.00', '100.00', '100.00', 'CONSTITUCION'],
    ['2026-02', '15000', '100.00', '50.00', '150.00', 'CONSTITUCION'],
    ['2026-03', '12000', '150.00', '-30.00', '120.00', 'REDUCCION'],
    ['2026-05', '12000', '120.00', '0.00', '120.00', null],
  ]) {
    const c = await guardarCierreConMovimientos(db, cierre(mes!, capital!));
    const cont = c.contabilizacionProvisiones!;
    expect([cont.saldoAnterior.formato(), cont.variacion.formato(), cont.saldoFinal.formato()]).toEqual([saldoAnterior, variacion, final]);
    expect(cont.movimientos.map(m => m.concepto)).toEqual(concepto ? [concepto] : []);
    for (const m of cont.movimientos) {
      expect(m.creditoId).toBe('CV-2026-0001'); expect(m.periodo).toBe(mes); expect(m.cierreId).toBe(mes);
      expect(m.fechaContable).toBe(c.fechaCorte); expect(m.versionPolitica).toBe(politica.version);
      expect(m.parametros).toEqual(politica); expect(m.importe.formato()).toBe(variacion);
    }
  }
  expect((await db.query('SELECT * FROM movimientos_provisiones')).rows).toHaveLength(3);
  const r = await consultarRegistroProvisiones(db, '2026-05-31');
  expect(r.estado === 'DISPONIBLE' && r.total.formato()).toBe('120.00');
  expect(r.estado === 'DISPONIBLE' && r.apertura.origen).toBe('CERO_SIN_HISTORICOS');
  const pasado = await consultarRegistroProvisiones(db, '2026-01-31');
  expect(pasado.estado === 'DISPONIBLE' && pasado.total.formato()).toBe('100.00');
});

it('reinicio, repetición y concurrencia no duplican y un corte anterior no consume movimientos futuros', async () => {
  const original = await leerCierre(db, '2026-03');
  await db.close(); db = await abrirBaseDatos(join(dir, 'registro')) as unknown as ConexionSql;
  expect(await guardarCierreConMovimientos(db, cierre('2026-03', '99999'))).toEqual(original);
  const simultaneos = await Promise.all(Array.from({ length: 5 }, () => guardarCierreConMovimientos(db, cierre('2026-07', '13000'))));
  for (const c of simultaneos) expect(c).toEqual(simultaneos[0]);
  expect(simultaneos[0].contabilizacionProvisiones?.variacion.formato()).toBe('10.00');
  expect((await db.query('SELECT * FROM movimientos_provisiones')).rows).toHaveLength(4);
  const antes = (await db.query('SELECT * FROM cierres_ejecutados ORDER BY periodo')).rows;
  const fueraDeOrden = cierre('2026-04', '50000');
  await expect(guardarCierreConMovimientos(db, fueraDeOrden)).rejects.toThrow(/fuera de orden/);
  expect((await db.query('SELECT * FROM cierres_ejecutados ORDER BY periodo')).rows).toEqual(antes);
  expect((await consultarRegistroProvisiones(db, '2025-12-31')).estado).toBe('NO_DISPONIBLE');
});

it('un fallo al insertar movimientos revierte también el cierre; el registro rechaza UPDATE y DELETE', async () => {
  await db.query(`CREATE FUNCTION fallo_provision() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'Fallo de prueba'; END; $$ LANGUAGE plpgsql`);
  await db.query(`CREATE TRIGGER fallo BEFORE INSERT ON movimientos_provisiones FOR EACH ROW EXECUTE FUNCTION fallo_provision()`);
  const movimientos = (await db.query('SELECT * FROM movimientos_provisiones ORDER BY id')).rows;
  await expect(guardarCierreConMovimientos(db, cierre('2026-08', '11000'))).rejects.toThrow(/Fallo de prueba/);
  expect(await leerCierre(db, '2026-08')).toBeNull();
  expect((await db.query('SELECT * FROM movimientos_provisiones ORDER BY id')).rows).toEqual(movimientos);
  await db.query('DROP TRIGGER fallo ON movimientos_provisiones');
  await expect(db.query('DELETE FROM movimientos_provisiones')).rejects.toThrow(/inmutable/);
  await expect(db.query("UPDATE movimientos_provisiones SET importe=1")).rejects.toThrow(/inmutable/);
  await expect(db.query("UPDATE aperturas_provisiones SET motivo='otro'")).rejects.toThrow(/inmutable/);
});

it('históricos requieren apertura explícita: importa Q100 sin gasto y el siguiente cierre registra solo +Q50', async () => {
  const historica = await nueva('historica');
  try {
    await guardarCierre(historica, cierre('2026-01', '10000'));
    const congelado = (await historica.query('SELECT * FROM cierres_ejecutados')).rows;
    await expect(guardarCierreConMovimientos(historica, cierre('2026-02', '15000'))).rejects.toThrow(/apertura explícita/);
    expect((await historica.query('SELECT * FROM movimientos_provisiones')).rows).toHaveLength(0);
    await expect(abrirDesdeHistorico(historica, '2025-12', 'Gerente', 'Conciliado')).rejects.toThrow(/último cierre/);
    const aperturas = await Promise.all([1, 2].map(() => abrirDesdeHistorico(historica, '2026-01', 'Gerente', 'Conciliación con cierre original')));
    expect(aperturas[1]).toEqual(aperturas[0]);
    expect((await historica.query('SELECT * FROM cierres_ejecutados')).rows).toEqual(congelado);
    const resultado = await guardarCierreConMovimientos(historica, cierre('2026-02', '15000'));
    expect(resultado.contabilizacionProvisiones?.saldoAnterior.formato()).toBe('100.00');
    expect(resultado.contabilizacionProvisiones?.variacion.formato()).toBe('50.00');
    expect((await historica.query<{ concepto: string; importe: string }>('SELECT concepto,importe::text FROM movimientos_provisiones ORDER BY fecha_contable')).rows)
      .toEqual([{ concepto: 'APERTURA', importe: '100.00' }, { concepto: 'CONSTITUCION', importe: '50.00' }]);
    await expect(abrirDesdeHistorico(historica, '2026-02', 'Gerente', 'Nueva apertura')).rejects.toThrow(/Ya existe/);
  } finally { await historica.close(); }
}, 60000);

it('un histórico sin detalle no se convierte en apertura de cero ni se recalcula', async () => {
  const historica = await nueva('sin-detalle');
  try {
    await guardarCierre(historica, { ...cierre('2026-01', '10000'), provisiones: undefined });
    await expect(abrirDesdeHistorico(historica, '2026-01', 'Gerente', 'Abrir')).rejects.toThrow(/conciliación documental/);
    expect((await historica.query('SELECT * FROM aperturas_provisiones')).rows).toHaveLength(0);
  } finally { await historica.close(); }
}, 60000);

it('API de apertura exige Gerencia y muestra el registro sin cambiar deuda ni pagos', async () => {
  const a = await AdaptadorNucleo.abrir({ dbDir: join(dir, 'fuente') });
  const app = await construirServidor({ adaptador: a });
  try {
    const antes = await a.obtenerDetalleCredito('CV-2026-0001', '2026-02-28');
    await guardarCierre(a.db, cierre('2026-01', '10000'));
    const asesor = await app.inject({ method: 'POST', url: '/api/provisiones/apertura', headers: { 'x-perfil': 'asesor', 'x-usuario': 'Asesor' }, payload: { periodoCierre: '2026-01', motivo: 'Conciliado' } });
    expect(asesor.statusCode).toBe(403);
    const r = await app.inject({ method: 'POST', url: '/api/provisiones/apertura', headers: { 'x-perfil': 'gerencia', 'x-usuario': 'Gerente' }, payload: { periodoCierre: '2026-01', motivo: 'Conciliado' } });
    expect(r.statusCode, r.body).toBe(200);
    const registro = await app.inject({ method: 'GET', url: '/api/provisiones?fechaCorte=2026-01-31' });
    expect(registro.statusCode).toBe(200);
    expect(registro.json().total.valor).toBe('100.00');
    const ejecucion = await app.inject({ method: 'POST', url: '/api/cierres/2026-02/ejecucion', headers: { 'x-perfil': 'gerencia', 'x-usuario': 'Gerente' } });
    expect(ejecucion.statusCode, ejecucion.body).toBe(200);
    expect(ejecucion.json().contabilizacionProvisiones.saldoAnterior.valor).toBe('100.00');
    expect(aJson(await a.obtenerDetalleCredito('CV-2026-0001', '2026-02-28'))).toEqual(aJson(antes));
  } finally { await app.close(); await a.cerrar(); }
}, 60000);
