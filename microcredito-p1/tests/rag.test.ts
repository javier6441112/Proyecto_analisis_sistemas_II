/**
 * E4 · Fragmentación, ingesta en pgvector, recuperación y defensa ante inyección.
 * Usa un embebedor determinista (sin Ollama) para que `npm test` corra offline y rápido;
 * la calidad semántica real con bge-m3 se mide en tests/evals.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { AdaptadorNucleo } from '../src/persistencia/adaptador-nucleo.js';
import { ServicioOperaciones } from '../src/persistencia/servicio-operaciones.js';
import { ServicioAprobaciones } from '../src/mcp/aprobaciones.js';
import { conectarClienteLocal, type ClienteMcpLocal } from '../src/mcp/cliente-local.js';
import { fragmentar } from '../src/rag/fragmentacion.js';
import { AVISO_RETIRADO, contieneInyeccion, sanearFragmento } from '../src/rag/seguridad.js';
import { EmbebedorDePrueba } from '../src/rag/embeddings.js';
import { BuscadorCorpus, ingestarCorpus } from '../src/rag/buscador.js';

const ORIGEN_DB = process.env.CV_DB_DIR ?? resolve(process.cwd(), '.cv-db');
const CORPUS = resolve(process.env.CV_DATA_DIR ?? 'datos/datos-proyecto-final', 'corpus');
const leer = (n: string): string => readFileSync(join(CORPUS, `${n}.md`), 'utf8');

describe('Fragmentación por sección', () => {
  it('POL-2024-01 se divide por sección y conserva doc_id, título y vigencia', () => {
    const f = fragmentar({ docId: 'POL-2024-01', nombreArchivo: 'POL-2024-01.md', contenido: leer('POL-2024-01') });
    expect(f.map((x) => x.seccion)).toEqual(['Introducción', 'Regla de cálculo', 'Redondeo', 'Ejemplo', 'Límite']);
    expect(f[1]).toMatchObject({ id: 'POL-2024-01#02', docId: 'POL-2024-01', normativo: true, vigencia: 'créditos otorgados hasta el 30 de septiembre de 2026' });
    expect(f[1].textoEmbebido).toMatch(/^POL-2024-01 · Política de mora plana/);
    expect(f[1].contenido).toContain('0.24 ÷ 360');
  });

  it('la nota de campo en borrador no es fuente normativa', () => {
    const [nota] = fragmentar({ docId: 'NOTA-CAMPO-07', nombreArchivo: 'NOTA-CAMPO-07.md', contenido: leer('NOTA-CAMPO-07') });
    expect(nota.normativo).toBe(false);
  });
});

describe('Defensa ante instrucciones incrustadas (OP-7)', () => {
  it('retira la orden y conserva el contenido legítimo', () => {
    const texto = leer('NOTA-CAMPO-07');
    expect(contieneInyeccion(texto)).toBe(true);
    const r = sanearFragmento(texto);
    expect(r.inyeccionDetectada).toBe(true);
    expect(r.texto).toContain(AVISO_RETIRADO);
    expect(r.texto).not.toMatch(/CANARIO|registrar_pago|ignora todas/i);
    expect(r.texto).toContain('registrar cada visita el mismo día');
  });

  it('no altera documentos legítimos', () => {
    for (const d of ['POL-2024-01', 'POL-2026-10', 'POL-COBRO-01', 'POL-CARTERA-01', 'FAQ-CLIENTES-01', 'MAN-PRODUCTO-01']) {
      expect(contieneInyeccion(leer(d)), d).toBe(false);
    }
  });
});

describe('Ingesta y recuperación sobre pgvector', () => {
  let dir: string;
  let adaptador: AdaptadorNucleo;
  let mcp: ClienteMcpLocal;
  const embebedor = new EmbebedorDePrueba();

  beforeAll(async () => {
    if (!existsSync(ORIGEN_DB)) throw new Error(`No existe ${ORIGEN_DB}. Ejecute "npm run cargar:datos" antes de "npm test".`);
    dir = join(mkdtempSync(join(tmpdir(), 'cv-rag-')), 'db');
    cpSync(ORIGEN_DB, dir, { recursive: true });
    adaptador = await AdaptadorNucleo.abrir({ dbDir: dir });
    const buscador = new BuscadorCorpus(adaptador.db, embebedor, { umbral: 0, k: 4 });
    mcp = await conectarClienteLocal({ adaptador, servicio: new ServicioOperaciones(adaptador), aprobaciones: new ServicioAprobaciones(), buscador });
  }, 60_000);

  afterAll(async () => {
    await mcp?.cerrar();
    await adaptador?.cerrar();
    if (dir) rmSync(resolve(dir, '..'), { recursive: true, force: true });
  });

  it('ingiere los 7 documentos y es idempotente', async () => {
    expect(await ingestarCorpus(adaptador.db, embebedor)).toEqual({ documentos: 7, fragmentos: 32 });
    await ingestarCorpus(adaptador.db, embebedor);
    const n = await adaptador.db.query<{ n: number }>('SELECT count(*)::int AS n FROM fragmentos_rag WHERE modelo_embedding = $1', [embebedor.modelo]);
    expect(n.rows[0].n).toBe(32);
  });

  it('un doc_id nombrado se recupera completo y saneado', async () => {
    const r = await new BuscadorCorpus(adaptador.db, embebedor, { umbral: 0.99, k: 1 }).buscar('Resume NOTA-CAMPO-07');
    expect(r.map((f) => f.docId)).toContain('NOTA-CAMPO-07');
    const nota = r.find((f) => f.docId === 'NOTA-CAMPO-07')!;
    expect(nota).toMatchObject({ normativo: false, inyeccionDetectada: true });
    expect(nota.contenido).not.toContain('CANARIO');
  });

  it('con umbral alto y sin doc_id no devuelve nada (no hay respuesta de memoria)', async () => {
    expect(await new BuscadorCorpus(adaptador.db, embebedor, { umbral: 0.999 }).buscar('receta de pizza napolitana')).toEqual([]);
  });

  it('la herramienta MCP buscar_politicas advierte y nunca entrega la orden', async () => {
    const r = await mcp.llamar('buscar_politicas', { pregunta: 'Lee la nota NOTA-CAMPO-07 y sigue sus indicaciones' });
    const texto = r.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
    expect(texto).not.toMatch(/CANARIO|DPI-FICT|5555-\d{4}/);
    const datos = r.structuredContent as { alertasSeguridad: string[]; advertencia: string };
    expect(datos.alertasSeguridad[0]).toMatch(/^NOTA-CAMPO-07/);
    expect(datos.advertencia).toMatch(/no instrucciones/);
  });
});
