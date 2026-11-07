/**
 * Cliente MCP en memoria: el chat (y las pruebas) hablan con el servidor MCP por el
 * protocolo real, sin red y sin abrir otra instancia de la base.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { crearServidorMcp, type DependenciasMcp } from './servidor-mcp.js';

export interface ClienteMcpLocal {
  cliente: Client;
  llamar(nombre: string, argumentos: Record<string, unknown>): Promise<CallToolResult>;
  cerrar(): Promise<void>;
}

export async function conectarClienteLocal(dep: DependenciasMcp): Promise<ClienteMcpLocal> {
  const servidor = crearServidorMcp(dep);
  const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
  const cliente = new Client({ name: 'chat-gerencial', version: '1.0.0' });
  await Promise.all([servidor.connect(ladoServidor), cliente.connect(ladoCliente)]);
  return {
    cliente,
    llamar: async (nombre, argumentos) =>
      // Sin GPU, cargar bge-m3 o el modelo de chat puede tardar más que el límite de 60 s del SDK.
      (await cliente.callTool({ name: nombre, arguments: argumentos }, undefined, { timeout: Number(process.env.CV_MCP_LIMITE_MS ?? 900_000) })) as CallToolResult,
    cerrar: async () => {
      await cliente.close();
      await servidor.close();
    },
  };
}
