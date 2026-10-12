/**
 * Punto de entrada: `npm run api`.
 * Un solo proceso abre `.cv-db` (PGlite no admite varios procesos sobre la misma base):
 * API REST, servidor MCP (/mcp y cliente en memoria para el chat), RAG, chat y aprobaciones.
 * Requiere Ollama local con qwen2.5:7b y bge-m3 (ver README).
 */
import { AdaptadorNucleo } from '../persistencia/adaptador-nucleo.js';
import { ServicioOperaciones } from '../persistencia/servicio-operaciones.js';
import { ServicioAprobaciones } from '../mcp/aprobaciones.js';
import { conectarClienteLocal } from '../mcp/cliente-local.js';
import { registrarMcpHttp } from '../mcp/http.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import { construirServidor } from './servidor.js';
import { registrarRutasPropuestas } from './rutas-propuestas.js';
import { EmbebedorOllama } from '../rag/embeddings.js';
import { BuscadorCorpus } from '../rag/buscador.js';
import { ModeloOllama } from '../chat/modelo.js';
import { OrquestadorChat } from '../chat/orquestador.js';
import { registrarRutasChat } from '../chat/rutas.js';

const puerto = Number(process.env.PORT ?? 3000);
const adaptador = await AdaptadorNucleo.abrir();
const servicio = new ServicioOperaciones(adaptador);
const aprobaciones = new ServicioAprobaciones();
const buscador = new BuscadorCorpus(adaptador.db, new EmbebedorOllama());
const dependencias = { adaptador, servicio, aprobaciones, buscador };
const mcp = await conectarClienteLocal(dependencias);
const modelo = new ModeloOllama();
const chat = new OrquestadorChat(mcp, modelo);
modelo.precalentar().then(
  () => console.log(`Modelo ${modelo.nombre} cargado en Ollama.`),
  (e: Error) => console.warn(`Aviso: ${e.message}. El chat no responderá hasta que Ollama esté disponible.`),
);

const app = await construirServidor({
  adaptador,
  servicio,
  logger: true,
  registrar: (instancia) => {
    registrarMcpHttp(instancia, dependencias);
    registrarRutasPropuestas(instancia, aprobaciones, mcp);
    registrarRutasChat(instancia, chat);
    // La interfaz React compilada (npm run web:build) se sirve desde el mismo proceso.
    const web = resolve(process.cwd(), 'web/dist');
    if (existsSync(web)) void instancia.register(fastifyStatic, { root: web, prefix: '/' });
  },
});

const cerrar = async (): Promise<void> => {
  await app.close();
  await mcp.cerrar();
  await adaptador.cerrar();
  process.exit(0);
};
process.on('SIGINT', () => void cerrar());
process.on('SIGTERM', () => void cerrar());

await app.listen({ port: puerto, host: '127.0.0.1' });
