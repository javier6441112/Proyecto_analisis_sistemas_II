/**
 * Usuarios del sistema (login empresarial).
 *
 * Cada usuario tiene un rol: `asesor` (vinculado a un asesor de la cartera) o `gerente`.
 * La clave se guarda como hash scrypt con sal propia (`scrypt$<sal>$<hash>`); nunca en claro.
 *
 * Semilla: si la tabla está vacía se crea un usuario por cada asesor canónico (usuario = su
 * código, p. ej. `AS-01`) y los gerentes de `configuracion/usuarios/gerentes.json`. Las claves
 * iniciales salen de `CV_CLAVE_INICIAL_ASESOR` y `CV_CLAVE_INICIAL_GERENTE` (o los valores de
 * demostración documentados en el README) y deben cambiarse con `npm run usuarios -- clave`.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { ConexionSql } from './adaptador-nucleo.js';

const scrypt = promisify(scryptCb) as (clave: string, sal: Buffer, largo: number) => Promise<Buffer>;

export type Rol = 'asesor' | 'gerente';

export interface Usuario {
  usuario: string;
  nombreCompleto: string;
  rol: Rol;
  idAsesor: string | null;
}

export const CLAVE_INICIAL_ASESOR = 'asesor2026';
export const CLAVE_INICIAL_GERENTE = 'gerente2026';
export const CLAVE_MINIMA = 8;

export const DDL_USUARIOS = `
CREATE TABLE IF NOT EXISTS usuarios (
  usuario         TEXT PRIMARY KEY CHECK (usuario = lower(usuario) AND length(usuario) BETWEEN 3 AND 40),
  nombre_completo TEXT NOT NULL,
  rol             TEXT NOT NULL CHECK (rol IN ('asesor','gerente')),
  id_asesor       TEXT UNIQUE REFERENCES asesores(id_asesor),
  clave_hash      TEXT NOT NULL,
  activo          BOOLEAN NOT NULL DEFAULT true,
  CHECK ((rol = 'asesor') = (id_asesor IS NOT NULL))
);`;

/** Hash scrypt con sal aleatoria de 16 bytes. */
export async function hashClave(clave: string): Promise<string> {
  const sal = randomBytes(16);
  const hash = await scrypt(clave, sal, 32);
  return `scrypt$${sal.toString('base64')}$${hash.toString('base64')}`;
}

/** Compara en tiempo constante; un hash con formato desconocido nunca verifica. */
export async function verificarClave(clave: string, guardado: string): Promise<boolean> {
  const [algoritmo, sal, hash] = guardado.split('$');
  if (algoritmo !== 'scrypt' || !sal || !hash) return false;
  const esperado = Buffer.from(hash, 'base64');
  const calculado = await scrypt(clave, Buffer.from(sal, 'base64'), esperado.length);
  return timingSafeEqual(calculado, esperado);
}

interface FilaUsuario {
  usuario: string;
  nombre_completo: string;
  rol: Rol;
  id_asesor: string | null;
  clave_hash: string;
}

const aUsuario = (f: FilaUsuario): Usuario => ({ usuario: f.usuario, nombreCompleto: f.nombre_completo, rol: f.rol, idAsesor: f.id_asesor });

function leerGerentesIniciales(): Array<{ usuario: string; nombreCompleto: string }> {
  const ruta = resolve(process.env.CV_GERENTES ?? 'configuracion/usuarios/gerentes.json');
  if (!existsSync(ruta)) return [{ usuario: 'gerente', nombreCompleto: 'Gerencia General' }];
  return JSON.parse(readFileSync(ruta, 'utf8')) as Array<{ usuario: string; nombreCompleto: string }>;
}

/** Crea la tabla y, si está vacía, la siembra con los asesores canónicos y los gerentes iniciales. */
export async function asegurarUsuarios(db: ConexionSql): Promise<void> {
  if (db.exec) await db.exec(DDL_USUARIOS);
  else await db.query(DDL_USUARIOS);
  const { rows } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM usuarios');
  if ((rows[0]?.n ?? 0) > 0) return;

  const asesores = (await db.query<{ id_asesor: string; nombre_completo: string }>(
    'SELECT id_asesor, nombre_completo FROM asesores ORDER BY id_asesor',
  )).rows;
  const claveAsesor = await hashClave(process.env.CV_CLAVE_INICIAL_ASESOR ?? CLAVE_INICIAL_ASESOR);
  const claveGerente = await hashClave(process.env.CV_CLAVE_INICIAL_GERENTE ?? CLAVE_INICIAL_GERENTE);
  for (const a of asesores) {
    await db.query('INSERT INTO usuarios (usuario, nombre_completo, rol, id_asesor, clave_hash) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
      [a.id_asesor.toLowerCase(), a.nombre_completo, 'asesor', a.id_asesor, claveAsesor]);
  }
  for (const g of leerGerentesIniciales()) {
    await db.query('INSERT INTO usuarios (usuario, nombre_completo, rol, id_asesor, clave_hash) VALUES ($1,$2,$3,NULL,$4) ON CONFLICT DO NOTHING',
      [g.usuario.toLowerCase(), g.nombreCompleto, 'gerente', claveGerente]);
  }
}

/** Listado para la pantalla de inicio: sin hashes, solo usuarios activos. */
export async function listarUsuarios(db: ConexionSql): Promise<Usuario[]> {
  const r = await db.query<FilaUsuario>(
    `SELECT usuario, nombre_completo, rol, id_asesor, clave_hash FROM usuarios WHERE activo ORDER BY rol DESC, nombre_completo`,
  );
  return r.rows.map(aUsuario);
}

/** Devuelve el usuario si existe, está activo y la clave coincide; si no, `null`. */
export async function autenticar(db: ConexionSql, usuario: string, clave: string): Promise<Usuario | null> {
  const r = await db.query<FilaUsuario>(
    'SELECT usuario, nombre_completo, rol, id_asesor, clave_hash FROM usuarios WHERE usuario = $1 AND activo',
    [usuario.trim().toLowerCase()],
  );
  const fila = r.rows[0];
  if (!fila) {
    await hashClave(clave); // mismo costo que una clave errónea: no revela qué usuarios existen
    return null;
  }
  return (await verificarClave(clave, fila.clave_hash)) ? aUsuario(fila) : null;
}

export async function cambiarClave(db: ConexionSql, usuario: string, clave: string): Promise<boolean> {
  if (clave.length < CLAVE_MINIMA) throw new Error(`La clave debe tener al menos ${CLAVE_MINIMA} caracteres`);
  const r = await db.query<{ usuario: string }>('UPDATE usuarios SET clave_hash = $2 WHERE usuario = $1 RETURNING usuario',
    [usuario.trim().toLowerCase(), await hashClave(clave)]);
  return r.rows.length > 0;
}

export async function agregarUsuario(db: ConexionSql, u: Usuario, clave: string): Promise<void> {
  if (clave.length < CLAVE_MINIMA) throw new Error(`La clave debe tener al menos ${CLAVE_MINIMA} caracteres`);
  await db.query('INSERT INTO usuarios (usuario, nombre_completo, rol, id_asesor, clave_hash) VALUES ($1,$2,$3,$4,$5)',
    [u.usuario.trim().toLowerCase(), u.nombreCompleto, u.rol, u.idAsesor, await hashClave(clave)]);
}

export async function fijarActivo(db: ConexionSql, usuario: string, activo: boolean): Promise<boolean> {
  const r = await db.query<{ usuario: string }>('UPDATE usuarios SET activo = $2 WHERE usuario = $1 RETURNING usuario',
    [usuario.trim().toLowerCase(), activo]);
  return r.rows.length > 0;
}
