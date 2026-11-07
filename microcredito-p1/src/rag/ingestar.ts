/**
 * `npm run rag:ingestar` — fragmenta los 7 documentos de documentos_rag, genera
 * embeddings con bge-m3 (Ollama local) y los guarda en fragmentos_rag. Idempotente.
 */
import { abrirBaseLocal } from '../persistencia/adaptador-nucleo.js';
import { EmbebedorOllama } from './embeddings.js';
import { ingestarCorpus } from './buscador.js';
import { contieneInyeccion } from './seguridad.js';

const db = await abrirBaseLocal();
try {
  const embebedor = new EmbebedorOllama();
  const r = await ingestarCorpus(db, embebedor);
  console.log(`\x1b[32mCorpus ingerido con ${embebedor.modelo}: ${r.documentos} documentos, ${r.fragmentos} fragmentos.\x1b[0m`);
  const docs = await db.query<{ doc_id: string; contenido: string }>('SELECT doc_id, contenido FROM documentos_rag');
  for (const d of docs.rows) {
    if (contieneInyeccion(d.contenido)) console.log(`\x1b[33m⚠ ${d.doc_id} contiene instrucciones dirigidas a la IA: se retirarán al recuperarlo.\x1b[0m`);
  }
} finally {
  await db.close();
}
