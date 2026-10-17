/**
 * Base relacional en PostgreSQL (local o Amazon RDS), con la API detenida:
 *
 *   npm run db:exportar                 → escribe db/postgres/microcredito.sql
 *   npm run db:publicar                 → exporta y ejecuta el script en CV_POSTGRES_URL
 *
 * Opciones: --sin-rag (omite fragmentos con embeddings y pgvector) · --esquema <nombre>
 *           --salida <archivo> (solo exportar)
 *
 * TLS en RDS: con CV_POSTGRES_CA=<ruta a global-bundle.pem> se verifica el certificado del
 * servidor; sin ella, un host remoto usa TLS sin verificar (válido para pruebas, no producción).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import pg from 'pg';
import { AdaptadorNucleo, type ConexionSql } from './adaptador-nucleo.js';
import { asegurarUsuarios } from './usuarios.js';
import { contarFilas, generarSqlPostgres } from './exportar-postgres.js';

function opcion(args: string[], nombre: string): string | undefined {
  const i = args.indexOf(nombre);
  return i >= 0 ? args[i + 1] : undefined;
}

async function exportar(args: string[]): Promise<{ sql: string; esquema: string }> {
  const esquema = opcion(args, '--esquema') ?? 'microcredito';
  // Abrir con el adaptador crea las tablas de bitácora, cierres, devengo y provisiones si aún no
  // existen: el script siempre lleva el esquema completo que usa la aplicación.
  const adaptador = await AdaptadorNucleo.abrir();
  try {
    await asegurarUsuarios(adaptador.db);
    const sql = await generarSqlPostgres(adaptador.db, { esquema, sinRag: args.includes('--sin-rag') });
    return { sql, esquema };
  } finally {
    await adaptador.cerrar();
  }
}

function configuracionTls(url: string): pg.ClientConfig['ssl'] {
  const host = new URL(url).hostname;
  if (['localhost', '127.0.0.1', '::1'].includes(host)) return undefined;
  if (process.env.CV_POSTGRES_CA) return { ca: readFileSync(resolve(process.env.CV_POSTGRES_CA), 'utf8') };
  console.warn('Aviso: TLS sin verificar el certificado. Defina CV_POSTGRES_CA con el bundle de RDS para verificarlo.');
  return { rejectUnauthorized: false };
}

async function main(): Promise<void> {
  const [comando, ...args] = process.argv.slice(2);
  if (comando === 'exportar') {
    const salida = resolve(opcion(args, '--salida') ?? 'db/postgres/microcredito.sql');
    const { sql } = await exportar(args);
    mkdirSync(dirname(salida), { recursive: true });
    writeFileSync(salida, sql, 'utf8');
    console.log(`Script PostgreSQL escrito en ${salida} (${(sql.length / 1024).toFixed(0)} KB).`);
    return;
  }
  if (comando === 'publicar') {
    const url = process.env.CV_POSTGRES_URL;
    if (!url) throw new Error('Defina CV_POSTGRES_URL, p. ej. postgres://usuario:clave@mi-base.xxxx.us-east-1.rds.amazonaws.com:5432/microcredito');
    const { sql, esquema } = await exportar(args);
    // Se quita el parámetro sslmode de la URL: el TLS se configura explícitamente arriba.
    const destino = new URL(url);
    destino.searchParams.delete('sslmode');
    const cliente = new pg.Client({ connectionString: destino.toString(), ssl: configuracionTls(url) });
    await cliente.connect();
    try {
      console.log(`Publicando en ${destino.hostname}/${destino.pathname.slice(1)} (esquema ${esquema})…`);
      await cliente.query(sql);
      const conexion: ConexionSql = {
        query: async <T>(texto: string, params?: unknown[]) => ({ rows: (await cliente.query(texto, params)).rows as T[] }),
        close: async () => undefined,
      };
      console.table(await contarFilas(conexion, esquema));
    } finally {
      await cliente.end();
    }
    return;
  }
  throw new Error('Uso: exportar | publicar  [--sin-rag] [--esquema nombre] [--salida archivo]');
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
