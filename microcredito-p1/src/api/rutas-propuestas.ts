/**
 * Aprobación humana visible en la interfaz (E3/E5). Solo estas rutas emiten el token que
 * `registrar_pago` exige; las invoca el botón «Aprobar» del chat, nunca el modelo.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ErrorNegocio } from '../persistencia/adaptador-nucleo.js';
import type { ServicioAprobaciones } from '../mcp/aprobaciones.js';
import type { ClienteMcpLocal } from '../mcp/cliente-local.js';
import { aJson } from './serializacion.js';
import { operadorDe } from './autenticacion.js';

export function registrarRutasPropuestas(app: FastifyInstance, aprobaciones: ServicioAprobaciones, mcp: ClienteMcpLocal): void {
  const usuarioDe = (req: FastifyRequest): string => {
    const usuario = operadorDe(req)?.usuario;
    if (!usuario) throw new ErrorNegocio('DATOS_INVALIDOS', 'La aprobación requiere la cabecera X-Usuario');
    return usuario;
  };

  app.get('/api/propuestas/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    return reply.send(aJson(aprobaciones.obtener(id)));
  });

  app.post('/api/propuestas/:id/aprobacion', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const usuario = usuarioDe(req);
    const { token } = aprobaciones.aprobar(id, usuario);
    const r = await mcp.llamar('registrar_pago', { propuestaId: id, tokenAprobacion: token, usuario });
    const cuerpo = r.structuredContent as Record<string, unknown>;
    if (r.isError) {
      const err = (cuerpo.error ?? {}) as { codigo?: string; mensaje?: string };
      throw new ErrorNegocio((err.codigo ?? 'DATOS_INVALIDOS') as never, err.mensaje ?? 'No se pudo registrar el pago');
    }
    return reply.status(201).send(cuerpo);
  });

  app.post('/api/propuestas/:id/rechazo', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    usuarioDe(req);
    return reply.send(aJson(aprobaciones.rechazar(id)));
  });
}
