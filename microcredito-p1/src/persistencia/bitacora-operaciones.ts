/**
 * Bitácora de operaciones de la interfaz (append-only).
 *
 * Decisión de diseño: la carga canónica (clientes, creditos, pagos) NO se modifica
 * después de cargarla (enunciado 5.2.3). Todo lo que ocurre por la interfaz se guarda
 * aquí como evento, con el mismo contrato de campos que `eventos.jsonl`, y el adaptador
 * lo fusiona al leer. Así:
 *  - la cartera sigue reconstruyéndose reproduciendo eventos, igual que la carga;
 *  - la idempotencia la garantiza la base (`clave` UNIQUE), no solo el código;
 *  - queda auditoría de quién operó y quién aprobó cada pago.
 *
 * La tabla no guarda la hora del reloj: la fecha de cada evento es la fecha de operación
 * que recibió la interfaz (puerto Reloj).
 */
import type { ConexionSql } from './adaptador-nucleo.js';

export type TipoEvento = 'CLIENTE' | 'SOLICITUD' | 'RESOLUCION' | 'DESEMBOLSO' | 'PAGO';

export interface EventoBitacora {
  seq: number;
  tipo: TipoEvento;
  clave: string;
  fecha: string;
  datos: Record<string, unknown>;
  usuario: string;
  aprobadoPor: string | null;
}

export const DDL_BITACORA = `
CREATE TABLE IF NOT EXISTS bitacora_operaciones (
  seq          SERIAL PRIMARY KEY,
  tipo         TEXT NOT NULL CHECK (tipo IN ('CLIENTE','SOLICITUD','RESOLUCION','DESEMBOLSO','PAGO')),
  clave        TEXT NOT NULL UNIQUE,
  fecha        DATE NOT NULL,
  datos        JSONB NOT NULL,
  usuario      TEXT NOT NULL,
  aprobado_por TEXT,
  CHECK (tipo <> 'PAGO' OR aprobado_por IS NOT NULL)
);`;

export async function asegurarBitacora(db: ConexionSql): Promise<void> {
  if (db.exec) await db.exec(DDL_BITACORA);
  else await db.query(DDL_BITACORA);
}

interface FilaBitacora {
  seq: number;
  tipo: TipoEvento;
  clave: string;
  fecha: string;
  datos: unknown;
  usuario: string;
  aprobado_por: string | null;
}

export async function leerBitacora(db: ConexionSql): Promise<EventoBitacora[]> {
  const r = await db.query<FilaBitacora>(
    `SELECT seq, tipo, clave, fecha::text AS fecha, datos, usuario, aprobado_por FROM bitacora_operaciones ORDER BY seq`,
  );
  return r.rows.map((f) => ({
    seq: Number(f.seq),
    tipo: f.tipo,
    clave: f.clave,
    fecha: f.fecha,
    datos: (typeof f.datos === 'string' ? JSON.parse(f.datos) : f.datos) as Record<string, unknown>,
    usuario: f.usuario,
    aprobadoPor: f.aprobado_por,
  }));
}

export class ClaveDuplicada extends Error {
  constructor(readonly clave: string) {
    super(`La clave ${clave} ya existe en la bitácora`);
    this.name = 'ClaveDuplicada';
  }
}

export async function agregarEvento(
  db: ConexionSql,
  evento: { tipo: TipoEvento; clave: string; fecha: string; datos: Record<string, unknown>; usuario: string; aprobadoPor?: string },
): Promise<number> {
  try {
    const r = await db.query<{ seq: number }>(
      `INSERT INTO bitacora_operaciones (tipo, clave, fecha, datos, usuario, aprobado_por)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING seq`,
      [evento.tipo, evento.clave, evento.fecha, JSON.stringify(evento.datos), evento.usuario, evento.aprobadoPor ?? null],
    );
    return Number(r.rows[0].seq);
  } catch (error) {
    if (/duplicate key|unique/i.test(String((error as Error).message))) throw new ClaveDuplicada(evento.clave);
    throw error;
  }
}
