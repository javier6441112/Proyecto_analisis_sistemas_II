/**
 * Inicio de sesión con usuario y clave (tabla `usuarios`).
 *
 * - `POST /api/sesion` verifica la clave y entrega un token opaco (32 bytes aleatorios) que la
 *   interfaz envía como `Authorization: Bearer <token>`.
 * - Con autenticación activa, el perfil y el usuario de auditoría salen SOLO del token: las
 *   cabeceras `X-Perfil` / `X-Usuario` se ignoran, así nadie puede declararse gerente.
 * - Sin `ServicioSesiones` (pruebas de integración) se conserva el modo de cabeceras.
 *
 * Los tokens viven en memoria: al reiniciar la API todos deben volver a iniciar sesión.
 */
import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { ConexionSql } from '../persistencia/adaptador-nucleo.js';
import { asegurarUsuarios, autenticar, listarUsuarios, type Usuario } from '../persistencia/usuarios.js';
import { InicioSesionBody, Perfil } from '../contratos/api.js';
import { aJson } from './serializacion.js';

export interface Operador {
  perfil: z.infer<typeof Perfil>;
  usuario: string;
  /** Nombre de inicio de sesión (solo con autenticación). */
  cuenta?: string;
  idAsesor?: string;
}

interface Sesion extends Operador { expira: number }

const DURACION_MS = 12 * 60 * 60 * 1000;
const INTENTOS_MAXIMOS = 5;
const BLOQUEO_MS = 60 * 1000;

const NO_AUTENTICADO = (detalle: string) => Object.assign(new Error(detalle), { statusCode: 401 });

export class ServicioSesiones {
  private readonly sesiones = new Map<string, Sesion>();
  private readonly fallos = new Map<string, { n: number; hasta: number }>();

  private constructor(private readonly db: ConexionSql, private readonly reloj: () => number) {}

  static async crear(db: ConexionSql, reloj: () => number = Date.now): Promise<ServicioSesiones> {
    await asegurarUsuarios(db);
    return new ServicioSesiones(db, reloj);
  }

  usuarios(): Promise<Usuario[]> {
    return listarUsuarios(this.db);
  }

  async iniciar(cuenta: string, clave: string): Promise<{ token: string; operador: Operador }> {
    const clavefallo = cuenta.trim().toLowerCase();
    const f = this.fallos.get(clavefallo);
    if (f && f.n >= INTENTOS_MAXIMOS && f.hasta > this.reloj()) {
      throw NO_AUTENTICADO('Demasiados intentos fallidos. Espere un minuto e intente de nuevo.');
    }
    const u = await autenticar(this.db, cuenta, clave);
    if (!u) {
      const n = (f && f.hasta > this.reloj() ? f.n : 0) + 1;
      this.fallos.set(clavefallo, { n, hasta: this.reloj() + BLOQUEO_MS });
      throw NO_AUTENTICADO('Usuario o clave incorrectos');
    }
    this.fallos.delete(clavefallo);
    const operador: Operador = {
      perfil: u.rol === 'gerente' ? 'gerencia' : 'asesor',
      usuario: u.nombreCompleto,
      cuenta: u.usuario,
      ...(u.idAsesor ? { idAsesor: u.idAsesor } : {}),
    };
    const token = randomBytes(32).toString('hex');
    this.sesiones.set(token, { ...operador, expira: this.reloj() + DURACION_MS });
    return { token, operador };
  }

  resolver(token: string): Operador | null {
    const s = this.sesiones.get(token);
    if (!s) return null;
    if (s.expira <= this.reloj()) {
      this.sesiones.delete(token);
      return null;
    }
    const { expira: _e, ...operador } = s;
    return operador;
  }

  cerrar(token: string): void {
    this.sesiones.delete(token);
  }
}

// ---------------------------------------------------------------------------
// Identidad de cada petición
// ---------------------------------------------------------------------------

const operadores = new WeakMap<FastifyRequest, Operador>();
const conAutenticacion = new WeakSet<FastifyInstance>();

/**
 * Operador de la petición: el del token si hay autenticación; si no, el de las cabeceras
 * (`perfil` queda indefinido si `X-Perfil` falta o no es válido).
 */
export function operadorDe(req: FastifyRequest): (Omit<Operador, 'perfil'> & { perfil?: Operador['perfil'] }) | null {
  const o = operadores.get(req);
  if (o) return o;
  if (conAutenticacion.has(req.server)) return null;
  const perfil = Perfil.safeParse(req.headers['x-perfil']);
  const usuario = String(req.headers['x-usuario'] ?? '').trim();
  if (!usuario) return null;
  return { usuario, ...(perfil.success ? { perfil: perfil.data } : {}) };
}

const tokenDe = (req: FastifyRequest): string | null => {
  const m = /^Bearer\s+([a-f0-9]{64})$/i.exec(String(req.headers.authorization ?? ''));
  return m ? m[1]!.toLowerCase() : null;
};

/** Rutas `/api` que no exigen sesión: salud y el propio inicio de sesión. */
const PUBLICAS = new Set(['GET /api/salud', 'GET /api/usuarios', 'POST /api/sesion']);

export function registrarAutenticacion(app: FastifyInstance, sesiones: ServicioSesiones): void {
  conAutenticacion.add(app);

  app.addHook('onRequest', async (req) => {
    const ruta = req.url.split('?')[0]!;
    if (!ruta.startsWith('/api/') || PUBLICAS.has(`${req.method} ${ruta}`)) return;
    const token = tokenDe(req);
    const operador = token ? sesiones.resolver(token) : null;
    if (!operador) throw NO_AUTENTICADO('Inicie sesión para continuar');
    operadores.set(req, operador);
  });

  app.get('/api/usuarios', async (_req, reply) => reply.send(aJson(await sesiones.usuarios())));

  app.post('/api/sesion', async (req, reply) => {
    const b = InicioSesionBody.parse(req.body);
    const { token, operador } = await sesiones.iniciar(b.usuario, b.clave);
    return reply.status(201).send(aJson({ token, ...operador }));
  });

  app.get('/api/sesion', async (req, reply) => reply.send(aJson(operadores.get(req))));

  app.delete('/api/sesion', async (req, reply) => {
    const token = tokenDe(req);
    if (token) sesiones.cerrar(token);
    return reply.status(204).send();
  });
}
