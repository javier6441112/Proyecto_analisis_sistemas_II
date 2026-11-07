/**
 * Expone el servidor MCP por Streamable HTTP en `/mcp`, dentro del proceso de la API
 * (una sola instancia de PGlite). Modo sin sesión: cada petición crea un servidor ligero
 * que comparte el adaptador, el servicio y las aprobaciones.
 *
 * Permite conectar herramientas externas (p. ej. MCP Inspector) mientras la app corre.
 * Solo escucha en 127.0.0.1.
 */
import type { FastifyInstance } from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { crearServidorMcp, type DependenciasMcp } from './servidor-mcp.js';

export function registrarMcpHttp(app: FastifyInstance, dep: DependenciasMcp): void {
  app.all('/mcp', async (req, reply) => {
    const servidor = crearServidorMcp(dep);
    const transporte = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on('close', () => {
      void transporte.close();
      void servidor.close();
    });
    await servidor.connect(transporte);
    await transporte.handleRequest(req.raw, reply.raw, req.body);
  });
}
