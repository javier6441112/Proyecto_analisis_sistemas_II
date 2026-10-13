import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { OrquestadorChat } from './orquestador.js';
import { PreguntaChatBody } from '../contratos/api.js';


export function registrarRutasChat(app: FastifyInstance, chat: OrquestadorChat): void {
  app.post('/api/chat', async (req, reply) => reply.send(await chat.preguntar(PreguntaChatBody.parse(req.body))));
  app.delete('/api/chat/:sesionId', async (req, reply) => {
    const { sesionId } = z.object({ sesionId: z.string() }).parse(req.params);
    chat.olvidar(sesionId);
    return reply.status(204).send();
  });
}
