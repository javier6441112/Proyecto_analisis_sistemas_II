/** Comprobación manual con Ollama real. Solo propone; no aprueba ni registra pagos. */
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AdaptadorNucleo } from '../../src/persistencia/adaptador-nucleo.js';
import { ServicioOperaciones } from '../../src/persistencia/servicio-operaciones.js';
import { ServicioAprobaciones } from '../../src/mcp/aprobaciones.js';
import { conectarClienteLocal, type ClienteMcpLocal } from '../../src/mcp/cliente-local.js';
import { EmbebedorOllama } from '../../src/rag/embeddings.js';
import { BuscadorCorpus, ingestarCorpus } from '../../src/rag/buscador.js';
import { ModeloOllama } from '../../src/chat/modelo.js';
import { OrquestadorChat } from '../../src/chat/orquestador.js';

const directorio = mkdtempSync(join(tmpdir(), 'cv-propuestas-ollama-'));
const dbDir = join(directorio, 'db');
let adaptador: AdaptadorNucleo | undefined;
let mcp: ClienteMcpLocal | undefined;
try {
  cpSync(resolve(process.env.CV_DB_DIR ?? '.cv-db'), dbDir, { recursive: true });
  adaptador = await AdaptadorNucleo.abrir({ dbDir });
  const embebedor = new EmbebedorOllama();
  const existentes = await adaptador.db.query<{ n: number }>('SELECT count(*)::int AS n FROM fragmentos_rag WHERE modelo_embedding=$1', [embebedor.modelo]);
  if (!existentes.rows[0].n) await ingestarCorpus(adaptador.db, embebedor);
  mcp = await conectarClienteLocal({ adaptador, servicio: new ServicioOperaciones(adaptador), aprobaciones: new ServicioAprobaciones(), buscador: new BuscadorCorpus(adaptador.db, embebedor) });
  const real = new ModeloOllama();
  const chat = new OrquestadorChat(mcp, {
    nombre: real.nombre,
    async conversar(mensajes, herramientas) {
      const r = await real.conversar(mensajes, herramientas);
      console.log(JSON.stringify({ modelo: real.nombre, llamadas: r.llamadas, texto: r.texto.slice(0, 240) }));
      return r;
    },
  });
  const antes = await adaptador.leerEventosBitacora();
  const fechaOperacion = '2026-10-31';
  const casos = [
    { idCredito: 'CV-2026-0043', mensaje: 'Genera una propuesta de pago para CV-2026-0043 al 2026-10-31.' },
    { idCredito: 'CV-2026-0043', mensaje: 'Propón el pago de Q561.87 para CV-2026-0043 al 2026-10-31.' },
    { idCredito: 'CV-2026-0035', mensaje: 'Prepara una propuesta para pagar la cuota de CV-2026-0035 al 2026-10-31.' },
  ];
  for (const caso of process.argv.includes('--primero') ? casos.slice(0, 1) : casos) {
    console.log(JSON.stringify({ caso: caso.mensaje }));
    const exigible = await adaptador.consultarExigible(caso.idCredito, fechaOperacion);
    const r = await chat.preguntar({ mensaje: caso.mensaje, fechaOperacion });
    console.log(JSON.stringify({ herramientas: r.control.herramientasUsadas, respuesta: r.respuesta, propuestas: r.propuestas }));
    assert.equal(r.propuestas.length, 1, 'Debe producir una propuesta válida');
    assert.deepEqual(r.control.herramientasUsadas, ['calcular_deuda_cuota', 'proponer_pago']);
    assert.equal(r.propuestas[0].cuota.totalExigible, exigible.cuota!.total.formato());
    assert.equal(r.propuestas[0].estado, 'PENDIENTE_DE_APROBACION_HUMANA');
    assert.equal(r.control.herramientasUsadas.includes('registrar_pago'), false);
  }
  assert.deepEqual(await adaptador.leerEventosBitacora(), antes, 'No debe registrar operaciones');
  console.log('OK: propuestas con el exigible del núcleo; bitácora intacta. Base temporal.');
} finally {
  await mcp?.cerrar();
  await adaptador?.cerrar();
  rmSync(directorio, { recursive: true, force: true });
}
