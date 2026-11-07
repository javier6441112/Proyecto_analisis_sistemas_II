/**
 * Exporta la base local (PGlite, `.cv-db`) a un script SQL estándar de PostgreSQL que puede
 * ejecutarse en cualquier servidor PostgreSQL 15+ (local, Docker o Amazon RDS).
 *
 * El esquema NO se escribe a mano: se lee del catálogo de la propia base (`pg_get_constraintdef`,
 * `pg_get_indexdef`, `pg_get_triggerdef`, `pg_get_functiondef`), así el script siempre coincide
 * con las tablas que crean la carga canónica, la bitácora, los cierres, el devengo, las
 * provisiones, el RAG y los usuarios.
 *
 * Orden del script (independiente de las dependencias entre tablas):
 *   1. esquema destino recreado desde cero (`DROP SCHEMA … CASCADE`, por defecto `microcredito`);
 *   2. tablas con columnas, PK, UNIQUE y CHECK;
 *   3. datos (INSERT con conversión explícita de tipo) y reinicio de secuencias;
 *   4. claves foráneas, índices, funciones y triggers (al final, para que los triggers de
 *      inmutabilidad no bloqueen la propia carga).
 */
import type { ConexionSql } from './adaptador-nucleo.js';

export interface OpcionesExportacion {
  /** Esquema destino en PostgreSQL (se borra y se recrea). */
  esquema?: string;
  /** Omite documentos_rag / fragmentos_rag y la extensión pgvector. */
  sinRag?: boolean;
  /** Filas por sentencia INSERT. */
  lote?: number;
}

const TABLAS_RAG = new Set(['documentos_rag', 'fragmentos_rag']);

const ident = (nombre: string): string => `"${nombre.replace(/"/g, '""')}"`;

interface Columna { nombre: string; tipo: string; noNulo: boolean; identidad: string; defecto: string | null }

export async function generarSqlPostgres(db: ConexionSql, opciones: OpcionesExportacion = {}): Promise<string> {
  const esquema = opciones.esquema ?? 'microcredito';
  if (!/^[a-z_][a-z0-9_]*$/.test(esquema)) throw new Error(`Nombre de esquema inválido: ${esquema}`);
  const lote = opciones.lote ?? 200;
  const q = ident(esquema);

  const tablas = (await db.query<{ oid: number; nombre: string }>(`
    SELECT c.oid::int AS oid, c.relname AS nombre FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
    ORDER BY c.relname`)).rows.filter((t) => !(opciones.sinRag && TABLAS_RAG.has(t.nombre)));

  const funciones = (await db.query<{ nombre: string; definicion: string }>(`
    SELECT p.proname AS nombre, pg_get_functiondef(p.oid) AS definicion
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
    ORDER BY p.proname`)).rows;

  // Referencias `public.<objeto propio>` en las definiciones → esquema destino.
  const propios = [...tablas.map((t) => t.nombre), ...funciones.map((f) => f.nombre)];
  const reubicar = (sql: string): string => propios.length === 0 ? sql
    : sql.replace(new RegExp(`\\bpublic\\.("?)(${propios.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'g'), `${q}.$1$2`);

  const usaVector = !opciones.sinRag && (await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_extension WHERE extname = 'vector'`)).rows[0]!.n > 0;

  const s: string[] = [];
  s.push(
    '-- Base de datos relacional de Crédito Vecino (SGMC) para PostgreSQL 15+ / Amazon RDS.',
    '-- Generado por `npm run db:exportar` a partir de la base local. No editar a mano.',
    `-- ATENCIÓN: borra y recrea el esquema ${esquema} completo.`,
    '',
    "SET client_encoding = 'UTF8';",
    'SET client_min_messages = warning;',
    'BEGIN;',
  );
  if (usaVector) s.push('CREATE EXTENSION IF NOT EXISTS vector;');
  s.push(`DROP SCHEMA IF EXISTS ${q} CASCADE;`, `CREATE SCHEMA ${q};`, `SET LOCAL search_path = ${q}, public;`, '');

  const posteriores: string[] = [];
  for (const t of tablas) {
    const columnas = (await db.query<Columna>(`
      SELECT a.attname AS nombre, format_type(a.atttypid, a.atttypmod) AS tipo, a.attnotnull AS "noNulo",
             a.attidentity::text AS identidad, pg_get_expr(d.adbin, d.adrelid) AS defecto
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`, [t.oid])).rows;
    const restricciones = (await db.query<{ nombre: string; tipo: string; definicion: string }>(`
      SELECT conname AS nombre, contype::text AS tipo, pg_get_constraintdef(oid) AS definicion
      FROM pg_constraint WHERE conrelid = $1 AND contype IN ('p','u','c','f')
      ORDER BY CASE contype WHEN 'p' THEN 0 WHEN 'u' THEN 1 WHEN 'c' THEN 2 ELSE 3 END, conname`, [t.oid])).rows;

    const secuenciales: string[] = [];
    const lineas = columnas.map((c) => {
      let tipo = c.tipo;
      let extra = '';
      if (c.identidad === 'a' || c.identidad === 'd') {
        extra = ` GENERATED ${c.identidad === 'a' ? 'ALWAYS' : 'BY DEFAULT'} AS IDENTITY`;
        secuenciales.push(c.nombre);
      } else if (c.defecto?.startsWith('nextval(')) {
        tipo = tipo === 'bigint' ? 'bigserial' : tipo === 'smallint' ? 'smallserial' : 'serial';
        secuenciales.push(c.nombre);
      } else if (c.defecto !== null) {
        extra = ` DEFAULT ${reubicar(c.defecto)}`;
      }
      return `  ${ident(c.nombre)} ${tipo}${extra}${c.noNulo ? ' NOT NULL' : ''}`;
    });
    for (const r of restricciones) {
      const linea = `CONSTRAINT ${ident(r.nombre)} ${reubicar(r.definicion)}`;
      if (r.tipo === 'f') posteriores.push(`ALTER TABLE ${q}.${ident(t.nombre)} ADD ${linea};`);
      else lineas.push(`  ${linea}`);
    }
    s.push(`CREATE TABLE ${q}.${ident(t.nombre)} (\n${lineas.join(',\n')}\n);`);

    // Datos: cada valor sale como literal SQL de PostgreSQL (quote_nullable) con su tipo explícito.
    const pk = (await db.query<{ nombre: string }>(`
      SELECT a.attname AS nombre FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = $1 AND i.indisprimary ORDER BY array_position(i.indkey::int2[], a.attnum)`, [t.oid])).rows.map((r) => r.nombre);
    const orden = (pk.length ? pk : columnas.map((c) => c.nombre)).map(ident).join(', ');
    const filas = (await db.query<{ v: string[] }>(
      `SELECT ARRAY[${columnas.map((c) => `quote_nullable(${ident(c.nombre)}::text)`).join(', ')}] AS v FROM public.${ident(t.nombre)} ORDER BY ${orden}`,
    )).rows;
    const nombres = columnas.map((c) => ident(c.nombre)).join(', ');
    const sobreescribir = columnas.some((c) => c.identidad === 'a') ? ' OVERRIDING SYSTEM VALUE' : '';
    for (let i = 0; i < filas.length; i += lote) {
      const valores = filas.slice(i, i + lote)
        .map((f) => `(${f.v.map((v, j) => v === 'NULL' ? 'NULL' : `${v}::${columnas[j]!.tipo}`).join(', ')})`);
      s.push(`INSERT INTO ${q}.${ident(t.nombre)} (${nombres})${sobreescribir} VALUES\n${valores.join(',\n')};`);
    }
    for (const c of secuenciales) {
      s.push(`SELECT setval(pg_get_serial_sequence('${esquema}.${t.nombre}', '${c}'), COALESCE(max(${ident(c)}), 1), max(${ident(c)}) IS NOT NULL) FROM ${q}.${ident(t.nombre)};`);
    }
    s.push(`-- ${t.nombre}: ${filas.length} filas`, '');

    const indices = (await db.query<{ definicion: string }>(`
      SELECT pg_get_indexdef(i.indexrelid) AS definicion FROM pg_index i
      WHERE i.indrelid = $1 AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid)
      ORDER BY i.indexrelid`, [t.oid])).rows;
    for (const ix of indices) posteriores.push(`${reubicar(ix.definicion)};`);
  }

  s.push('-- Claves foráneas e índices', ...posteriores, '');
  if (funciones.length) {
    s.push('-- Funciones', ...funciones.map((f) => `${reubicar(f.definicion).trim()};`), '');
  }
  const triggers = (await db.query<{ tabla: string; definicion: string }>(`
    SELECT c.relname AS tabla, pg_get_triggerdef(tg.oid) AS definicion FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT tg.tgisinternal ORDER BY c.relname, tg.tgname`)).rows
    .filter((tg) => tablas.some((t) => t.nombre === tg.tabla));
  if (triggers.length) s.push('-- Triggers (inmutabilidad de registros contables)', ...triggers.map((tg) => `${reubicar(tg.definicion)};`), '');

  s.push('COMMIT;', '');
  return s.join('\n');
}

/** Conteo de filas por tabla de un esquema (para verificar una exportación o una publicación). */
export async function contarFilas(db: ConexionSql, esquema: string): Promise<Record<string, number>> {
  const tablas = (await db.query<{ nombre: string }>(
    `SELECT table_name AS nombre FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name`, [esquema])).rows;
  const conteos: Record<string, number> = {};
  for (const t of tablas) {
    conteos[t.nombre] = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${ident(esquema)}.${ident(t.nombre)}`)).rows[0]!.n;
  }
  return conteos;
}
