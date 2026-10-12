import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { OrquestadorChat } from './orquestador.js';

const Pregunta = z.object({
  sesionId: z.string().uuid().optional(),
  mensaje: z.string().trim().min(1).max(2000),
  fechaOperacion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato AAAA-MM-DD'),
}).strict();

export function registrarRutasChat(app: FastifyInstance, chat: OrquestadorChat): void {
  app.post('/api/chat', async (req, reply) => reply.send(await chat.preguntar(Pregunta.parse(req.body))));
  app.delete('/api/chat/:sesionId', async (req, reply) => {
    const { sesionId } = z.object({ sesionId: z.string() }).parse(req.params);
    chat.olvidar(sesionId);
    return reply.status(204).send();
  });
}
