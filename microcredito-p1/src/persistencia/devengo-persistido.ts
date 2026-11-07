import { createHash } from 'node:crypto';
import { Dinero } from '../dominio/dinero.js';
import { proyectarDevengo, resumirDevengo, diaDevengo, fechaDevengo, type CreditoDevengo, type MovimientoDevengo, type PoliticaDevengo, type SaldosDevengo } from '../dominio/devengo.js';
import { aJson } from '../api/serializacion.js';
import { ErrorNegocio, type ConexionSql, type Cierre } from './adaptador-nucleo.js';

type Sql = Pick<ConexionSql, 'query'>;
export interface MovimientoDevengoGuardado extends MovimientoDevengo { cierreId: string; origen: 'APERTURA' | 'PERIODO'; politica: PoliticaDevengo; usuario: string }
export interface DevengoCierre {
  estado: 'DISPONIBLE'; desde: string; hasta: string; huellaFuentes: string;
  politicas: Array<{ creditoId: string; politica: PoliticaDevengo }>;
  apertura: SaldosDevengo; periodo: Omit<SaldosDevengo, 'saldoSuspenso'>;
  saldoFinalSuspenso: Dinero; movimientos: MovimientoDevengoGuardado[];
  movimientosNuevos: string[]; aperturaRegistro?: { fecha: string; cierreId: string; motivo: string };
}
export type ResultadoDevengoCierre = DevengoCierre | { estado: 'NO_DISPONIBLE'; motivo: string };
interface Corte { fecha: string; huella: string; asignaciones: Array<{ creditoId: string; politica: PoliticaDevengo }> }
function ordenar(dato: unknown): unknown {
  if (Array.isArray(dato)) return dato.map(ordenar);
  if (dato && typeof dato === 'object') return Object.fromEntries(Object.entries(dato).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, ordenar(v)]));
  return dato;
}
const huella = (dato: unknown) => createHash('sha256').update(JSON.stringify(ordenar(aJson(dato)))).digest('hex');
const cache = new Map<string, MovimientoDevengo[]>();
function proyeccion(c: CreditoDevengo, hasta: string): MovimientoDevengo[] {
  const clave = huella({ c, hasta });
  let r = cache.get(clave);
  if (!r) {
    r = proyectarDevengo(c, hasta);
    if (cache.size >= 300) cache.delete(cache.keys().next().value!);
    cache.set(clave, r);
  }
  return r;
}
function fuentesHasta(creditos: CreditoDevengo[], hasta: string) {
  return creditos.filter(c => c.desembolso <= hasta).map(c => ({ ...c, eventos: c.eventos.filter(e => e.fecha <= hasta) })).sort((a, b) => a.id.localeCompare(b.id));
}
export async function asegurarDevengo(db: Sql): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS aperturas_devengo (
    id TEXT PRIMARY KEY CHECK(id='INICIAL'), fecha DATE NOT NULL, cierre_id TEXT NOT NULL REFERENCES cierres_ejecutados(periodo) DEFERRABLE INITIALLY DEFERRED,
    usuario TEXT NOT NULL, motivo TEXT NOT NULL, huella_fuentes TEXT NOT NULL
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS movimientos_devengo (
    id TEXT PRIMARY KEY, credito_id TEXT NOT NULL, cuota INTEGER NOT NULL CHECK(cuota>0), desde DATE NOT NULL, hasta DATE NOT NULL,
    fecha_contable DATE NOT NULL, concepto TEXT NOT NULL CHECK(concepto IN ('DEVENGO','SUSPENSO','REGULARIZACION','RETIRO_SUSPENSO')),
    importe NUMERIC(18,2) NOT NULL CHECK(importe>0), version_politica TEXT NOT NULL, politica JSONB NOT NULL,
    cierre_id TEXT NOT NULL REFERENCES cierres_ejecutados(periodo) DEFERRABLE INITIALLY DEFERRED,
    origen TEXT NOT NULL CHECK(origen IN ('APERTURA','PERIODO')), usuario TEXT NOT NULL,
    UNIQUE(credito_id,cuota,fecha_contable,concepto), CHECK(desde<=hasta AND hasta=fecha_contable)
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS cortes_devengo (
    fecha DATE PRIMARY KEY, huella TEXT NOT NULL, asignaciones JSONB NOT NULL,
    cierre_id TEXT NOT NULL REFERENCES cierres_ejecutados(periodo) DEFERRABLE INITIALLY DEFERRED
  )`);
  await db.query('CREATE INDEX IF NOT EXISTS devengo_fecha ON movimientos_devengo(fecha_contable)');
  await db.query(`CREATE OR REPLACE FUNCTION devengo_inmutable() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'Registro de devengo inmutable'; END; $$ LANGUAGE plpgsql`);
  for (const tabla of ['aperturas_devengo', 'movimientos_devengo', 'cortes_devengo']) {
    await db.query(`DROP TRIGGER IF EXISTS inmutable ON ${tabla}`);
    await db.query(`CREATE TRIGGER inmutable BEFORE UPDATE OR DELETE ON ${tabla} FOR EACH ROW EXECUTE FUNCTION devengo_inmutable()`);
  }
}
export async function leerMovimientosDevengo(db: Sql, hasta: string): Promise<MovimientoDevengoGuardado[]> {
  const r = await db.query<Omit<MovimientoDevengoGuardado, 'importe'> & { importe: string }>(`SELECT id, credito_id AS "creditoId", cuota,
    desde::text, hasta::text, fecha_contable::text AS "fechaContable", concepto, importe::text, version_politica AS "versionPolitica",
    politica, cierre_id AS "cierreId", origen, usuario FROM movimientos_devengo WHERE fecha_contable <= $1 ORDER BY fecha_contable,id`, [hasta]);
  return r.rows.map(m => ({ ...m, importe: Dinero.de(m.importe) }));
}

/** También se usa dentro de la transacción de cierre; nunca escribe durante la vista previa. */
export async function prepararDevengo(db: Sql, cierre: Pick<Cierre, 'desde' | 'hasta' | 'periodo'>, fuentes: CreditoDevengo[], usuario: string): Promise<DevengoCierre> {
  const ultimo = (await db.query<Corte>(`SELECT fecha::text, huella, asignaciones FROM cortes_devengo ORDER BY fecha DESC LIMIT 1`)).rows[0];
  if (ultimo && cierre.hasta < ultimo.fecha) throw new ErrorNegocio('TRANSICION_INVALIDA', 'Devengo fuera de orden: no se permiten nuevos cierres anteriores al último corte contabilizado');
  const asignaciones = new Map((ultimo?.asignaciones ?? []).map(a => [a.creditoId, a.politica]));
  const creditos = fuentes.map(c => ({ ...c, politica: asignaciones.get(c.id) ?? c.politica }));
  if (ultimo && huella(fuentesHasta(creditos, ultimo.fecha)) !== ultimo.huella) {
    throw new ErrorNegocio('TRANSICION_INVALIDA', 'Operaciones retroactivas o plan modificado: se requiere conciliación de devengo; no se sobrescriben cierres');
  }
  const proyectados = creditos.flatMap(c => proyeccion(c, cierre.hasta)).sort((a, b) => a.fechaContable.localeCompare(b.fechaContable) || a.id.localeCompare(b.id));
  const existentes = await leerMovimientosDevengo(db, cierre.hasta);
  const porId = new Map(existentes.map(m => [m.id, m]));
  const esperados = new Set(proyectados.map(m => m.id));
  if (existentes.some(m => !esperados.has(m.id))) throw new ErrorNegocio('TRANSICION_INVALIDA', 'La historia del devengo cambió: requiere conciliación');
  const nuevas: MovimientoDevengoGuardado[] = [];
  const politicaPorId = new Map(creditos.map(c => [c.id, c.politica]));
  const todos = proyectados.map(m => {
    const previo = porId.get(m.id);
    if (previo) {
      if (!previo.importe.valor.eq(m.importe.valor) || previo.desde !== m.desde || previo.versionPolitica !== m.versionPolitica) throw new ErrorNegocio('TRANSICION_INVALIDA', 'Movimiento histórico de devengo inconsistente');
      return previo;
    }
    if (ultimo && m.fechaContable <= ultimo.fecha) throw new ErrorNegocio('TRANSICION_INVALIDA', 'Intervalo histórico no conciliado de devengo');
    const nuevo: MovimientoDevengoGuardado = { ...m, cierreId: cierre.periodo, origen: m.fechaContable < cierre.desde ? 'APERTURA' : 'PERIODO', politica: politicaPorId.get(m.creditoId)!, usuario };
    nuevas.push(nuevo); return nuevo;
  });
  const apertura = resumirDevengo(todos.filter(m => m.fechaContable < cierre.desde));
  const delPeriodo = todos.filter(m => m.fechaContable >= cierre.desde);
  const { saldoSuspenso: variacionSuspenso, ...periodo } = resumirDevengo(delPeriodo);
  const registro = (await db.query<{ fecha: string; cierreId: string; motivo: string }>(`SELECT fecha::text, cierre_id AS "cierreId", motivo FROM aperturas_devengo WHERE id='INICIAL'`)).rows[0];
  return { estado: 'DISPONIBLE', desde: cierre.desde, hasta: cierre.hasta, apertura, periodo,
    saldoFinalSuspenso: apertura.saldoSuspenso.sumar(variacionSuspenso), movimientos: delPeriodo,
    movimientosNuevos: nuevas.map(m => m.id), huellaFuentes: huella(fuentesHasta(creditos, cierre.hasta)),
    politicas: creditos.map(c => ({ creditoId: c.id, politica: c.politica })),
    aperturaRegistro: registro ?? { fecha: fechaDevengo(diaDevengo(cierre.desde) - 1), cierreId: cierre.periodo,
      motivo: 'Apertura reconstruida desde planes y eventos completos; importes anteriores al período separados de su ingreso' },
  };
}

export async function persistirDevengo(db: Sql, cierre: Cierre, fuentes: CreditoDevengo[], usuario: string): Promise<void> {
  if (cierre.devengo?.estado !== 'DISPONIBLE') throw new ErrorNegocio('DATOS_INVALIDOS', 'No hay devengo conciliado para ejecutar el cierre');
  const d = cierre.devengo;
  await db.query(`INSERT INTO aperturas_devengo (id,fecha,cierre_id,usuario,motivo,huella_fuentes) VALUES ('INICIAL',$1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    [d.aperturaRegistro!.fecha, d.aperturaRegistro!.cierreId, usuario, d.aperturaRegistro!.motivo, d.huellaFuentes]);
  // Incluye intervalos históricos de apertura, sin atribuirlos a los flujos del período actual.
  const asignaciones = new Map(d.politicas.map(a => [a.creditoId, a.politica]));
  const nuevos = new Set(d.movimientosNuevos);
  const filas: Array<Record<string, unknown>> = [];
  for (const c of fuentes) for (const m of proyeccion({ ...c, politica: asignaciones.get(c.id)! }, cierre.hasta)) {
    if (!nuevos.has(m.id)) continue;
    filas.push({ id: m.id, credito_id: m.creditoId, cuota: m.cuota, desde: m.desde, hasta: m.hasta,
      fecha_contable: m.fechaContable, concepto: m.concepto, importe: m.importe.formato(), version_politica: m.versionPolitica,
      politica: asignaciones.get(c.id), cierre_id: cierre.periodo, origen: m.fechaContable < cierre.desde ? 'APERTURA' : 'PERIODO', usuario });
  }
  for (let i = 0; i < filas.length; i += 500) {
    await db.query(`INSERT INTO movimientos_devengo SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
      id text,credito_id text,cuota integer,desde date,hasta date,fecha_contable date,concepto text,
      importe numeric,version_politica text,politica jsonb,cierre_id text,origen text,usuario text)`, [JSON.stringify(filas.slice(i, i + 500))]);
  }
  await db.query(`INSERT INTO cortes_devengo (fecha,huella,asignaciones,cierre_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
    [cierre.hasta, d.huellaFuentes, JSON.stringify(d.politicas), cierre.periodo]);
}
