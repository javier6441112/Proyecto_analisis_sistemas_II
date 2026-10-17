/**
 * Login empresarial (usuarios con rol y clave) y exportación de la base a PostgreSQL.
 * Corre sobre una COPIA temporal de `.cv-db`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';

import { AdaptadorNucleo, type ConexionSql } from '../src/persistencia/adaptador-nucleo.js';
import { abrirBaseDatos } from '../src/persistencia/base-datos.js';
import { construirServidor } from '../src/api/servidor.js';
import { ServicioSesiones } from '../src/api/autenticacion.js';
import { CLAVE_INICIAL_ASESOR, CLAVE_INICIAL_GERENTE, autenticar, hashClave, verificarClave } from '../src/persistencia/usuarios.js';
import { contarFilas, generarSqlPostgres } from '../src/persistencia/exportar-postgres.js';
import * as C from '../src/contratos/api.js';

const ORIGEN_DB = process.env.CV_DB_DIR ?? resolve(process.cwd(), '.cv-db');

let dir: string;
let adaptador: AdaptadorNucleo;
let app: FastifyInstance;

beforeAll(async () => {
  if (!existsSync(ORIGEN_DB)) throw new Error(`No existe ${ORIGEN_DB}. Ejecute "npm run cargar:datos" antes de "npm test".`);
  dir = join(mkdtempSync(join(tmpdir(), 'cv-usuarios-')), 'db');
  cpSync(ORIGEN_DB, dir, { recursive: true });
  adaptador = await AdaptadorNucleo.abrir({ dbDir: dir });
  app = await construirServidor({ adaptador, sesiones: await ServicioSesiones.crear(adaptador.db) });
}, 60_000);

afterAll(async () => {
  await app?.close();
  await adaptador?.cerrar();
  if (dir) rmSync(resolve(dir, '..'), { recursive: true, force: true });
});

async function iniciar(usuario: string, clave: string) {
  const r = await app.inject({ method: 'POST', url: '/api/sesion', payload: { usuario, clave } });
  return { status: r.statusCode, body: r.json() as Record<string, unknown> };
}

describe('Usuarios', () => {
  it('la clave se guarda con hash scrypt y sal propia', async () => {
    const a = await hashClave('secreta123');
    const b = await hashClave('secreta123');
    expect(a).not.toBe(b);
    expect(a).not.toContain('secreta123');
    expect(await verificarClave('secreta123', a)).toBe(true);
    expect(await verificarClave('otra-clave', a)).toBe(false);
    expect(await verificarClave('secreta123', 'texto-plano')).toBe(false);
  });

  it('se siembran los asesores canónicos y los gerentes, cada uno con su rol', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/usuarios' });
    const usuarios = C.UsuarioSistema.array().parse(r.json());
    expect(usuarios.filter((u) => u.rol === 'gerente').map((u) => u.usuario).sort()).toEqual(['emorales', 'gerente']);
    const asesores = usuarios.filter((u) => u.rol === 'asesor');
    expect(asesores.length).toBe(6);
    expect(asesores.every((u) => u.idAsesor && u.usuario === u.idAsesor.toLowerCase())).toBe(true);
    expect(JSON.stringify(r.json())).not.toContain('scrypt');
  });

  it('autenticar distingue usuario inexistente, clave errónea y clave correcta', async () => {
    expect(await autenticar(adaptador.db, 'nadie', 'x')).toBeNull();
    expect(await autenticar(adaptador.db, 'as-01', 'incorrecta')).toBeNull();
    expect((await autenticar(adaptador.db, 'AS-01', CLAVE_INICIAL_ASESOR))?.idAsesor).toBe('AS-01');
  });
});

describe('API con inicio de sesión', () => {
  it('sin token las rutas /api responden 401; salud y usuarios son públicas', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/creditos?fechaCorte=2026-10-31' });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toMatchObject({ codigo: 'NO_AUTENTICADO' });
    expect((await app.inject({ method: 'GET', url: '/api/salud' })).statusCode).toBe(200);
  });

  it('clave incorrecta: 401; clave correcta: token y perfil según el rol', async () => {
    expect((await iniciar('emorales', 'mala')).status).toBe(401);
    const g = await iniciar('emorales', CLAVE_INICIAL_GERENTE);
    expect(g.status).toBe(201);
    expect(C.SesionIniciada.parse(g.body)).toMatchObject({ perfil: 'gerencia', usuario: 'Elena Morales', cuenta: 'emorales' });
    const a = await iniciar('as-02', CLAVE_INICIAL_ASESOR);
    expect(a.body).toMatchObject({ perfil: 'asesor', idAsesor: 'AS-02', usuario: 'Wendy Lucrecia Ajú' });
  });

  it('el perfil sale del token: un asesor no puede hacerse pasar por gerencia con X-Perfil', async () => {
    const { body } = await iniciar('as-01', CLAVE_INICIAL_ASESOR);
    const r = await app.inject({
      method: 'POST', url: '/api/cierres/2026-10/ejecucion',
      headers: { authorization: `Bearer ${String(body.token)}`, 'x-perfil': 'gerencia', 'x-usuario': 'Elena Morales' },
    });
    expect(r.statusCode).toBe(403);
    const lectura = await app.inject({ method: 'GET', url: '/api/creditos?fechaCorte=2026-10-31', headers: { authorization: `Bearer ${String(body.token)}` } });
    expect(lectura.statusCode).toBe(200);
  });

  it('cerrar sesión invalida el token', async () => {
    const { body } = await iniciar('gerente', CLAVE_INICIAL_GERENTE);
    const auth = { authorization: `Bearer ${String(body.token)}` };
    expect((await app.inject({ method: 'GET', url: '/api/sesion', headers: auth })).json()).toMatchObject({ perfil: 'gerencia' });
    expect((await app.inject({ method: 'DELETE', url: '/api/sesion', headers: auth })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/sesion', headers: auth })).statusCode).toBe(401);
  });

  it('bloquea el usuario tras 5 intentos fallidos', async () => {
    const reloj = { t: 0 };
    const sesiones = await ServicioSesiones.crear(adaptador.db, () => reloj.t);
    for (let i = 0; i < 5; i++) await expect(sesiones.iniciar('as-03', 'mala')).rejects.toThrow('incorrectos');
    await expect(sesiones.iniciar('as-03', CLAVE_INICIAL_ASESOR)).rejects.toThrow('Demasiados intentos');
    reloj.t += 61_000;
    expect((await sesiones.iniciar('as-03', CLAVE_INICIAL_ASESOR)).operador.idAsesor).toBe('AS-03');
  });
});

describe('Exportación a PostgreSQL', () => {
  it('el script recrea todas las tablas con los mismos datos en un PostgreSQL limpio', async () => {
    const sql = await generarSqlPostgres(adaptador.db, { esquema: 'microcredito' });
    expect(sql).toContain('CREATE SCHEMA "microcredito"');
    expect(sql).toContain('FOREIGN KEY');

    const destino = await abrirBaseDatos('memory://');
    try {
      await destino.exec(sql);
      const origen = await contarFilas(adaptador.db, 'public');
      const copia = await contarFilas(destino as unknown as ConexionSql, 'microcredito');
      expect(copia).toEqual(origen);
      expect(copia.usuarios).toBe(8);
      expect(copia.creditos).toBeGreaterThan(0);

      // Las claves foráneas y la inmutabilidad viajan con el esquema.
      await expect(destino.query(`INSERT INTO microcredito.creditos (id_credito, id_cliente, id_asesor, fecha, capital_centavos, plazo_meses, tna_bps, reestructurado)
        VALUES ('CV-9999-9999', 'CL-NOEXISTE', 'AS-01', '2026-10-31', 100000, 12, 3600, false)`)).rejects.toThrow(/foreign key/i);
      const fks = await destino.query<{ n: number }>(`SELECT count(*)::int AS n FROM information_schema.table_constraints
        WHERE table_schema = 'microcredito' AND constraint_type = 'FOREIGN KEY'`);
      expect(fks.rows[0]!.n).toBeGreaterThanOrEqual(8);
      const triggers = await destino.query<{ n: number }>(`SELECT count(*)::int AS n FROM information_schema.triggers WHERE trigger_schema = 'microcredito'`);
      expect(triggers.rows[0]!.n).toBeGreaterThan(0);

      // Reejecutar el script es idempotente: reemplaza el esquema completo.
      await destino.exec(sql);
      expect(await contarFilas(destino as unknown as ConexionSql, 'microcredito')).toEqual(origen);
    } finally {
      await destino.close();
    }
  }, 120_000);

  it('--sin-rag omite los embeddings y la extensión pgvector', async () => {
    const sql = await generarSqlPostgres(adaptador.db, { sinRag: true });
    expect(sql).not.toContain('fragmentos_rag');
    expect(sql).not.toContain('CREATE EXTENSION');
  });
});
