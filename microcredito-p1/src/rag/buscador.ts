/**
 * Ingesta y recuperación del corpus sobre pgvector (tabla `fragmentos_rag` del E2).
 *
 * - Ingesta idempotente: reemplaza los fragmentos del mismo modelo de embeddings.
 * - Recuperación por similitud coseno (`<=>`), con umbral mínimo: por debajo, no hay
 *   respuesta normativa ("no encuentro eso en las políticas").
 * - Si la pregunta nombra un doc_id (p. ej. NOTA-CAMPO-07), se incluyen sus fragmentos.
 * - Todo fragmento pasa por `sanearFragmento` antes de salir hacia el modelo.
 */
import type { ConexionSql } from '../persistencia/adaptador-nucleo.js';
import type { BuscadorPoliticas, FragmentoRecuperado } from '../mcp/servidor-mcp.js';
import type { Embebedor } from './embeddings.js';
import { esNormativo, fragmentar, leerFrontMatter } from './fragmentacion.js';
import { sanearFragmento } from './seguridad.js';

/** Calibrado con bge-m3 sobre este corpus: preguntas pertinentes ≥ 0.52; fuera de tema ≤ 0.48. */
export const UMBRAL_POR_DEFECTO = Number(process.env.CV_RAG_UMBRAL ?? 0.5);

const vectorSql = (v: number[]): string => `[${v.join(',')}]`;

export async function ingestarCorpus(db: ConexionSql, embebedor: Embebedor): Promise<{ documentos: number; fragmentos: number }> {
  const docs = await db.query<{ doc_id: string; nombre_archivo: string; contenido: string }>(
    'SELECT doc_id, nombre_archivo, contenido FROM documentos_rag ORDER BY doc_id',
  );
  if (docs.rows.length === 0) throw new Error('documentos_rag está vacía. Ejecute primero: npm run cargar:datos');
  const fragmentos = docs.rows.flatMap((d) => fragmentar({ docId: d.doc_id, nombreArchivo: d.nombre_archivo, contenido: d.contenido }));
  const vectores = await embebedor.embeber(fragmentos.map((f) => f.textoEmbebido));

  await db.query('BEGIN');
  try {
    await db.query('DELETE FROM fragmentos_rag WHERE modelo_embedding = $1', [embebedor.modelo]);
    for (let i = 0; i < fragmentos.length; i++) {
      const f = fragmentos[i];
      await db.query(
        `INSERT INTO fragmentos_rag (id, doc_id, seccion, contenido, modelo_embedding, embedding)
         VALUES ($1, $2, $3, $4, $5, $6::vector)
         ON CONFLICT (id) DO UPDATE SET seccion = EXCLUDED.seccion, contenido = EXCLUDED.contenido,
           modelo_embedding = EXCLUDED.modelo_embedding, embedding = EXCLUDED.embedding`,
        [f.id, f.docId, f.seccion, f.contenido, embebedor.modelo, vectorSql(vectores[i])],
      );
    }
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
  return { documentos: docs.rows.length, fragmentos: fragmentos.length };
}

export interface OpcionesBusqueda {
  k?: number;
  umbral?: number;
}

export class BuscadorCorpus implements BuscadorPoliticas {
  private metadatos?: Map<string, { titulo: string; vigencia: string }>;

  constructor(private readonly db: ConexionSql, private readonly embebedor: Embebedor, private readonly opciones: OpcionesBusqueda = {}) {}

  async buscar(pregunta: string): Promise<FragmentoRecuperado[]> {
    const k = this.opciones.k ?? 4;
    const umbral = this.opciones.umbral ?? UMBRAL_POR_DEFECTO;
    const meta = await this.cargarMetadatos();
    const [vector] = await this.embebedor.embeber([pregunta]);
    const r = await this.db.query<{ id: string; doc_id: string; seccion: string; contenido: string; similitud: number }>(
      `SELECT id, doc_id, seccion, contenido, 1 - (embedding <=> $1::vector) AS similitud
         FROM fragmentos_rag WHERE modelo_embedding = $2
        ORDER BY embedding <=> $1::vector, id LIMIT $3`,
      [vectorSql(vector), this.embebedor.modelo, k],
    );
    const filas = r.rows.filter((f) => Number(f.similitud) >= umbral);

    // Un doc_id nombrado explícitamente se recupera completo, aunque la similitud sea baja.
    const nombrados = [...new Set(pregunta.toUpperCase().match(/\b[A-Z]{2,}(?:-[A-Z0-9]+)+\b/g) ?? [])].filter((id) => meta.has(id));
    if (nombrados.length > 0) {
      const extra = await this.db.query<{ id: string; doc_id: string; seccion: string; contenido: string }>(
        'SELECT id, doc_id, seccion, contenido FROM fragmentos_rag WHERE modelo_embedding = $1 AND doc_id = ANY($2) ORDER BY id',
        [this.embebedor.modelo, nombrados],
      );
      for (const f of extra.rows) if (!filas.some((x) => x.id === f.id)) filas.push({ ...f, similitud: 1 });
    }

    return filas.map((f) => {
      const m = meta.get(f.doc_id) ?? { titulo: f.doc_id, vigencia: 'sin vigencia declarada' };
      const saneado = sanearFragmento(f.contenido);
      return {
        docId: f.doc_id,
        titulo: m.titulo,
        vigencia: m.vigencia,
        seccion: f.seccion,
        contenido: saneado.texto,
        similitud: Number(f.similitud),
        normativo: esNormativo(m.vigencia),
        inyeccionDetectada: saneado.inyeccionDetectada,
      };
    });
  }

  private async cargarMetadatos(): Promise<Map<string, { titulo: string; vigencia: string }>> {
    if (this.metadatos) return this.metadatos;
    const r = await this.db.query<{ doc_id: string; contenido: string }>('SELECT doc_id, contenido FROM documentos_rag');
    this.metadatos = new Map(r.rows.map((d) => {
      const { metadatos } = leerFrontMatter(d.contenido);
      return [d.doc_id, { titulo: metadatos.titulo ?? d.doc_id, vigencia: metadatos.vigencia ?? 'sin vigencia declarada' }];
    }));
    return this.metadatos;
  }
}
