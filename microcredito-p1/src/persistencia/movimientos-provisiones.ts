import { Dinero } from '../dominio/dinero.js';
import { variacionesProvisiones, type SaldoProvision } from '../dominio/movimientos-provisiones.js';
import type { PoliticaProvisiones } from '../dominio/provisiones.js';
import { ErrorNegocio, type Cierre, type ConexionSql } from './adaptador-nucleo.js';
import { guardarCierre, leerCierre } from './cierres-persistidos.js';

type Sql = Pick<ConexionSql, 'query'>;
export interface MovimientoProvision {
  id: string; creditoId: string; periodo: string; cierreId: string; fechaContable: string;
  importe: Dinero; concepto: 'APERTURA' | 'CONSTITUCION' | 'REDUCCION';
  versionPolitica: string; parametros: PoliticaProvisiones; usuario: string;
}
export interface AperturaProvision {
  id: string; fechaContable: string; cierreId: string; usuario: string; motivo: string;
  origen: 'CERO_SIN_HISTORICOS' | 'CIERRE_HISTORICO';
}
export interface ContabilizacionProvisiones {
  apertura: AperturaProvision; saldoAnterior: Dinero; variacion: Dinero; saldoFinal: Dinero;
  movimientos: MovimientoProvision[];
}

export async function asegurarMovimientosProvisiones(db: Sql): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS aperturas_provisiones (
    id TEXT PRIMARY KEY CHECK (id='INICIAL'), fecha_contable DATE NOT NULL,
    cierre_id TEXT NOT NULL REFERENCES cierres_ejecutados(periodo) DEFERRABLE INITIALLY DEFERRED,
    usuario TEXT NOT NULL, motivo TEXT NOT NULL,
    origen TEXT NOT NULL CHECK (origen IN ('CERO_SIN_HISTORICOS','CIERRE_HISTORICO'))
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS movimientos_provisiones (
    id TEXT PRIMARY KEY, credito_id TEXT NOT NULL, periodo TEXT NOT NULL,
    cierre_id TEXT NOT NULL REFERENCES cierres_ejecutados(periodo), fecha_contable DATE NOT NULL,
    importe NUMERIC(18,2) NOT NULL CHECK (importe <> 0),
    concepto TEXT NOT NULL CHECK (concepto IN ('APERTURA','CONSTITUCION','REDUCCION')),
    version_politica TEXT NOT NULL, parametros JSONB NOT NULL, usuario TEXT NOT NULL,
    apertura_id TEXT NOT NULL REFERENCES aperturas_provisiones(id),
    UNIQUE(cierre_id,credito_id,concepto),
    CHECK ((concepto IN ('APERTURA','CONSTITUCION') AND importe > 0) OR (concepto='REDUCCION' AND importe < 0))
  )`);
  await db.query(`CREATE OR REPLACE FUNCTION impedir_cambio_provisiones() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'El registro de provisiones es acumulativo e inmutable'; END;
  $$ LANGUAGE plpgsql`);
  for (const tabla of ['aperturas_provisiones', 'movimientos_provisiones']) {
    await db.query(`DROP TRIGGER IF EXISTS inmutable ON ${tabla}`);
    await db.query(`CREATE TRIGGER inmutable BEFORE UPDATE OR DELETE ON ${tabla}
      FOR EACH ROW EXECUTE FUNCTION impedir_cambio_provisiones()`);
  }
}

export async function leerApertura(db: Sql): Promise<AperturaProvision | null> {
  const r = await db.query<AperturaProvision>(`SELECT id, fecha_contable::text AS "fechaContable",
    cierre_id AS "cierreId", usuario, motivo, origen FROM aperturas_provisiones WHERE id='INICIAL'`);
  return r.rows[0] ?? null;
}

export async function reconstruirSaldosProvisiones(db: Sql, fechaCorte: string): Promise<SaldoProvision[]> {
  const r = await db.query<{ creditoId: string; saldo: string }>(`SELECT credito_id AS "creditoId", sum(importe)::text AS saldo
    FROM movimientos_provisiones WHERE fecha_contable <= $1 GROUP BY credito_id ORDER BY credito_id`, [fechaCorte]);
  return r.rows.map(s => ({ creditoId: s.creditoId, saldo: Dinero.de(s.saldo) }));
}

async function leerRegistroProvisiones(db: Sql, fechaCorte: string) {
  const apertura = await leerApertura(db);
  if (!apertura || fechaCorte < apertura.fechaContable) {
    return { estado: 'NO_DISPONIBLE' as const, fechaCorte, motivo: 'Sin apertura de provisiones a este corte' };
  }
  const saldos = await reconstruirSaldosProvisiones(db, fechaCorte);
  const filas = await db.query<Omit<MovimientoProvision, 'importe'> & { importe: string }>(`SELECT id,
    credito_id AS "creditoId", periodo, cierre_id AS "cierreId", fecha_contable::text AS "fechaContable",
    importe::text, concepto, version_politica AS "versionPolitica", parametros, usuario
    FROM movimientos_provisiones WHERE fecha_contable <= $1 ORDER BY fecha_contable,id`, [fechaCorte]);
  return { estado: 'DISPONIBLE' as const, fechaCorte, apertura, saldos,
    total: saldos.reduce((t, s) => t.sumar(s.saldo), Dinero.cero()),
    movimientos: filas.rows.map(m => ({ ...m, importe: Dinero.de(m.importe) })),
  };
}

export async function consultarRegistroProvisiones(db: ConexionSql, fechaCorte: string) {
  if (!db.transaction) throw new Error('La consulta del registro requiere transacciones nativas');
  return db.transaction(tx => leerRegistroProvisiones(tx, fechaCorte));
}

async function ultimoMensual(db: Sql): Promise<string | undefined> {
  const r = await db.query<{ periodo: string }>(`SELECT periodo FROM cierres_ejecutados
    WHERE resultado->>'tipo'='MENSUAL' ORDER BY fecha_corte DESC LIMIT 1`);
  return r.rows[0]?.periodo;
}

async function insertarApertura(db: Sql, apertura: AperturaProvision): Promise<void> {
  await db.query(`INSERT INTO aperturas_provisiones VALUES ($1,$2,$3,$4,$5,$6)`,
    [apertura.id, apertura.fechaContable, apertura.cierreId, apertura.usuario, apertura.motivo, apertura.origen]);
}

async function insertarMovimiento(db: Sql, m: MovimientoProvision): Promise<void> {
  await db.query(`INSERT INTO movimientos_provisiones
    (id,credito_id,periodo,cierre_id,fecha_contable,importe,concepto,version_politica,parametros,usuario,apertura_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'INICIAL')`,
  [m.id, m.creditoId, m.periodo, m.cierreId, m.fechaContable, m.importe.formato(), m.concepto,
    m.versionPolitica, JSON.stringify(m.parametros), m.usuario]);
}

/** Usa una transacción nativa: la cola del motor no permite observar escrituras parciales. */
async function atomico<T>(db: ConexionSql, fn: (tx: Sql) => Promise<T>): Promise<T> {
  if (!db.transaction) throw new Error('La contabilización requiere transacciones nativas');
  return db.transaction(async tx => {
    await tx.query('LOCK TABLE cierres_ejecutados, aperturas_provisiones, movimientos_provisiones IN EXCLUSIVE MODE');
    return fn(tx);
  });
}

/** Apertura explícita desde la última instantánea mensual, sin cambiar ese cierre histórico. */
export async function abrirDesdeHistorico(db: ConexionSql, periodo: string, usuario: string, motivo: string): Promise<AperturaProvision> {
  if (!usuario.trim() || !motivo.trim()) throw new ErrorNegocio('DATOS_INVALIDOS', 'La apertura requiere usuario y motivo');
  return atomico(db, async tx => {
    const existente = await leerApertura(tx);
    if (existente) {
      if (existente.cierreId === periodo && existente.origen === 'CIERRE_HISTORICO' && existente.usuario === usuario.trim() && existente.motivo === motivo.trim()) return existente;
      throw new ErrorNegocio('TRANSICION_INVALIDA', 'Ya existe una apertura de provisiones; no se puede sustituir');
    }
    if (await ultimoMensual(tx) !== periodo) throw new ErrorNegocio('TRANSICION_INVALIDA', 'La apertura debe referenciar el último cierre mensual definitivo');
    const c = await leerCierre(tx, periodo);
    if (!c || c.provisiones?.estado !== 'DISPONIBLE') {
      throw new ErrorNegocio('TRANSICION_INVALIDA', 'El cierre histórico no tiene detalle de provisiones: requiere conciliación documental antes de abrir este registro');
    }
    const p = c.provisiones;
    const apertura: AperturaProvision = { id: 'INICIAL', fechaContable: c.fechaCorte, cierreId: periodo,
      usuario: usuario.trim(), motivo: motivo.trim(), origen: 'CIERRE_HISTORICO' };
    const saldos = p.detalles.map(d => ({ creditoId: d.id, saldo: d.provision }));
    // Verifica identificadores, importes y total de la instantánea, sin recalcular su política.
    variacionesProvisiones([], saldos);
    const total = saldos.reduce((t, s) => t.sumar(s.saldo), Dinero.cero());
    if (!total.valor.eq(p.total.valor)) throw new ErrorNegocio('DATOS_INVALIDOS', 'El detalle histórico no coincide con el total de provisiones');
    await insertarApertura(tx, apertura);
    for (const s of saldos.filter(s => !s.saldo.esCero())) {
      await insertarMovimiento(tx, { id: `APERTURA:${periodo}:${s.creditoId}`, creditoId: s.creditoId, periodo,
        cierreId: periodo, fechaContable: c.fechaCorte, importe: s.saldo, concepto: 'APERTURA',
        versionPolitica: p.version, parametros: p.parametros, usuario: apertura.usuario });
    }
    return apertura;
  });
}

export async function guardarCierreConMovimientos(db: ConexionSql, cierre: Cierre): Promise<Cierre> {
  return atomico(db, async tx => {
    const existente = await leerCierre(tx, cierre.periodo);
    if (existente) return existente;
    if (cierre.estado !== 'EJECUTADO' || !cierre.ejecutadoPor?.trim()) {
      throw new ErrorNegocio('DATOS_INVALIDOS', 'Solo un cierre definitivo con usuario puede registrar movimientos');
    }
    if (cierre.tipo !== 'MENSUAL') return guardarCierre(tx, cierre);
    if (cierre.provisiones?.estado !== 'DISPONIBLE') throw new ErrorNegocio('DATOS_INVALIDOS', 'Faltan provisiones del cierre mensual');
    const ultimo = await ultimoMensual(tx);
    if (ultimo && cierre.periodo <= ultimo) throw new ErrorNegocio('TRANSICION_INVALIDA', 'Corte fuera de orden: ya existe un cierre mensual igual o posterior');
    let apertura = await leerApertura(tx);
    if (!apertura) {
      if (ultimo) throw new ErrorNegocio('TRANSICION_INVALIDA', 'Se requiere apertura explícita desde el último cierre histórico antes de contabilizar provisiones');
      apertura = { id: 'INICIAL', fechaContable: cierre.fechaCorte, cierreId: cierre.periodo,
        usuario: cierre.ejecutadoPor!, motivo: 'Primera ejecución mensual sin cierres históricos: saldo inicial cero', origen: 'CERO_SIN_HISTORICOS' };
      await insertarApertura(tx, apertura);
    } else if (cierre.fechaCorte <= apertura.fechaContable) {
      throw new ErrorNegocio('TRANSICION_INVALIDA', 'El corte debe ser posterior a la apertura de provisiones');
    }
    const anteriores = await reconstruirSaldosProvisiones(tx, cierre.fechaCorte);
    const p = cierre.provisiones;
    const movimientos: MovimientoProvision[] = variacionesProvisiones(anteriores,
      p.detalles.map(d => ({ creditoId: d.id, saldo: d.provision }))).map(v => ({
      id: `CIERRE:${cierre.periodo}:${v.creditoId}`, creditoId: v.creditoId, periodo: cierre.periodo,
      cierreId: cierre.periodo, fechaContable: cierre.fechaCorte, importe: v.variacion,
      concepto: v.variacion.valor.isPositive() ? 'CONSTITUCION' : 'REDUCCION', versionPolitica: p.version,
      parametros: p.parametros, usuario: cierre.ejecutadoPor!,
    }));
    const saldoAnterior = anteriores.reduce((t, s) => t.sumar(s.saldo), Dinero.cero());
    const variacion = movimientos.reduce((t, m) => t.sumar(m.importe), Dinero.cero());
    if (!saldoAnterior.sumar(variacion).valor.eq(p.total.valor)) throw new ErrorNegocio('DATOS_INVALIDOS', 'Provisiones objetivo inconsistentes');
    const resultado = await guardarCierre(tx, { ...cierre, contabilizacionProvisiones: {
      apertura, saldoAnterior, variacion, saldoFinal: p.total, movimientos,
    } });
    for (const m of movimientos) await insertarMovimiento(tx, m);
    return resultado;
  });
}
