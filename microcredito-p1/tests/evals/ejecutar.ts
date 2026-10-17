/**
 * `npm run evals` — corre CASOS contra el modelo real (Ollama) sobre una copia de .cv-db y
 * deja el informe en tests/evals/resultados.md. Requiere Ollama con qwen3.5:9b y bge-m3.
 */
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AdaptadorNucleo } from '../../src/persistencia/adaptador-nucleo.js';
import { ServicioOperaciones } from '../../src/persistencia/servicio-operaciones.js';
import { ServicioAprobaciones } from '../../src/mcp/aprobaciones.js';
import { conectarClienteLocal } from '../../src/mcp/cliente-local.js';
import { EmbebedorOllama } from '../../src/rag/embeddings.js';
import { BuscadorCorpus, ingestarCorpus } from '../../src/rag/buscador.js';
import { ModeloOllama } from '../../src/chat/modelo.js';
import { OrquestadorChat } from '../../src/chat/orquestador.js';
import { CASOS } from './casos.js';

const origen = resolve(process.env.CV_DB_DIR ?? '.cv-db');
const dir = join(mkdtempSync(join(tmpdir(), 'cv-evals-')), 'db');
cpSync(origen, dir, { recursive: true });
const adaptador = await AdaptadorNucleo.abrir({ dbDir: dir });
const embebedor = new EmbebedorOllama();
const yaIngerido = await adaptador.db.query<{ n: number }>('SELECT count(*)::int AS n FROM fragmentos_rag WHERE modelo_embedding = $1', [embebedor.modelo]);
if (yaIngerido.rows[0].n === 0) await ingestarCorpus(adaptador.db, embebedor);
const mcp = await conectarClienteLocal({ adaptador, servicio: new ServicioOperaciones(adaptador), aprobaciones: new ServicioAprobaciones(), buscador: new BuscadorCorpus(adaptador.db, embebedor) });
const modelo = new ModeloOllama();
const chat = new OrquestadorChat(mcp, modelo);
const filtro = process.argv.slice(2);
const sesiones = new Map<string, string>();
const filas: string[] = [];
let aprobados = 0;
const casos = CASOS.filter((c) => filtro.length === 0 || filtro.includes(c.id));

for (const caso of casos) {
  const t0 = Date.now();
  let errores: string[];
  let respuesta = '';
  try {
    const sesionId = caso.sesion ? sesiones.get(caso.sesion) : undefined;
    const r = await chat.preguntar({ mensaje: caso.pregunta, fechaOperacion: '2026-10-31', ...(sesionId ? { sesionId } : {}) });
    if (caso.sesion) sesiones.set(caso.sesion, r.sesionId);
    respuesta = r.respuesta;
    errores = await caso.verificar(r, adaptador);
  } catch (e) {
    errores = [`excepción: ${(e as Error).message}`];
  }
  const s = ((Date.now() - t0) / 1000).toFixed(0);
  if (errores.length === 0) aprobados++;
  console.log(`${errores.length === 0 ? '✔' : '✘'} ${caso.id} (${s} s) ${errores.join('; ')}`);
  filas.push(`| ${caso.id} | ${errores.length === 0 ? 'Aprobado' : 'Fallido'} | ${s} s | ${errores.join('; ').replace(/\|/g, '/') || '—'} | ${respuesta.replace(/\n+/g, ' ').replace(/\|/g, '/').slice(0, 220)} |`);
}

const informe = [
  `# Evals del asistente`,
  ``,
  `Modelo: \`${modelo.nombre}\` · Embeddings: \`${embebedor.modelo}\` · Fecha de operación: 2026-10-31 · Aprobados: **${aprobados}/${casos.length}**`,
  ``,
  `| Caso | Resultado | Tiempo | Detalle | Respuesta (extracto) |`,
  `|---|---|---|---|---|`,
  ...filas,
].join('\n');
writeFileSync(resolve(filtro.length === 0 ? 'tests/evals/resultados.md' : 'tests/evals/resultados-parcial.md'), informe + '\n');
console.log(`\nAprobados ${aprobados}/${casos.length}. Informe: tests/evals/resultados.md`);
await mcp.cerrar();
await adaptador.cerrar();
rmSync(resolve(dir, '..'), { recursive: true, force: true });
process.exitCode = aprobados === casos.length ? 0 : 1;
