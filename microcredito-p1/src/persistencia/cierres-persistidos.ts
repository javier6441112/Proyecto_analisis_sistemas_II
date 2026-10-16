import { Decimal } from 'decimal.js';
import { Dinero } from '../dominio/dinero.js';
import type { Cierre, ConexionSql } from './adaptador-nucleo.js';

/** Migración aditiva: no altera la carga canónica ni la bitácora existente. */
export async function asegurarCierres(db: ConexionSql): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS cierres_ejecutados (
    periodo TEXT PRIMARY KEY,
    fecha_corte DATE NOT NULL,
    resultado JSONB NOT NULL
  )`);
}

/** Conserva los valores y sus tipos, sin convertir importes a number ni recalcularlos al leer. */
function codificar(valor: unknown): unknown {
  if (valor instanceof Dinero) return { $tipo: 'Dinero', valor: valor.formato(), moneda: valor.moneda };
  if (Decimal.isDecimal(valor)) return { $tipo: 'Decimal', valor: valor.toString() };
  if (Array.isArray(valor)) return valor.map(codificar);
  if (valor && typeof valor === 'object') return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, codificar(v)]));
  return valor;
}

function decodificar(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(decodificar);
  if (valor && typeof valor === 'object') {
    const v = valor as Record<string, unknown>;
    if (v.$tipo === 'Dinero' && typeof v.valor === 'string' && (v.moneda === 'GTQ' || v.moneda === 'USD')) return Dinero.de(v.valor, v.moneda);
    if (v.$tipo === 'Decimal' && typeof v.valor === 'string') return new Decimal(v.valor);
    return Object.fromEntries(Object.entries(v).map(([k, dato]) => [k, decodificar(dato)]));
  }
  return valor;
}

export async function leerCierre(db: ConexionSql, periodo: string): Promise<Cierre | null> {
  const r = await db.query<{ resultado: unknown }>('SELECT resultado FROM cierres_ejecutados WHERE periodo = $1', [periodo]);
  if (!r.rows[0]) return null;
  const resultado = r.rows[0].resultado;
  const cierre = decodificar(typeof resultado === 'string' ? JSON.parse(resultado) : resultado) as Cierre;
  // Compatibilidad de lectura: no se calcula ni se modifica el JSON histórico almacenado.
  return cierre.provisiones ? cierre : { ...cierre, provisiones: {
    estado: 'NO_DISPONIBLE', motivo: 'Provisiones no disponibles en esta versión del cierre histórico',
  } };
}

export async function guardarCierre(db: ConexionSql, cierre: Cierre): Promise<Cierre> {
  // Si otra ejecución ganó, se conserva su resultado, nunca se actualiza un cierre guardado.
  await db.query(`INSERT INTO cierres_ejecutados (periodo, fecha_corte, resultado)
    VALUES ($1, $2, $3) ON CONFLICT (periodo) DO NOTHING`,
  [cierre.periodo, cierre.fechaCorte, JSON.stringify(codificar(cierre))]);
  const guardado = await leerCierre(db, cierre.periodo);
  if (!guardado) throw new Error('No se pudo recuperar el cierre guardado');
  return guardado;
}
