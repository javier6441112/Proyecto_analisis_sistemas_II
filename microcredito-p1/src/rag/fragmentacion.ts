/**
 * Fragmentación del corpus (E4).
 *
 * Estrategia: un fragmento por sección Markdown (`##`), más un fragmento de introducción
 * (título `#` y primer párrafo). Los documentos son cortos y cada sección trata una sola
 * regla, así que la sección es la unidad natural de cita: «POL-2024-01 · Regla de
 * cálculo». Cada fragmento lleva en su texto el doc_id, el título y la vigencia, para
 * que el embedding y el modelo sepan a qué créditos aplica.
 */
export interface DocumentoCorpus {
  docId: string;
  nombreArchivo: string;
  contenido: string;
}

export interface Fragmento {
  id: string;
  docId: string;
  titulo: string;
  vigencia: string;
  seccion: string;
  contenido: string;
  /** Texto que se embebe: encabezado con metadatos + sección. */
  textoEmbebido: string;
  /** false para borradores sin aprobar: se pueden leer, pero no son fuente normativa. */
  normativo: boolean;
}

export function leerFrontMatter(contenido: string): { metadatos: Record<string, string>; cuerpo: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(contenido);
  if (!m) return { metadatos: {}, cuerpo: contenido };
  const metadatos: Record<string, string> = {};
  for (const linea of m[1].split(/\r?\n/)) {
    const kv = /^([a-z_]+):\s*(.*)$/i.exec(linea.trim());
    if (kv) metadatos[kv[1]] = kv[2].trim();
  }
  return { metadatos, cuerpo: m[2] };
}

export function esNormativo(vigencia: string): boolean {
  return !/borrador|sin aprobar/i.test(vigencia);
}

export function fragmentar(doc: DocumentoCorpus): Fragmento[] {
  const { metadatos, cuerpo } = leerFrontMatter(doc.contenido);
  const docId = metadatos.doc_id ?? doc.docId;
  const titulo = metadatos.titulo ?? docId;
  const vigencia = metadatos.vigencia ?? 'sin vigencia declarada';
  const normativo = esNormativo(vigencia);

  const lineas = cuerpo.replace(/\r\n/g, '\n').split('\n');
  const secciones: Array<{ seccion: string; lineas: string[] }> = [{ seccion: 'Introducción', lineas: [] }];
  for (const linea of lineas) {
    const h2 = /^##\s+(.+)$/.exec(linea);
    if (h2) secciones.push({ seccion: h2[1].trim(), lineas: [] });
    else if (!/^#\s+/.test(linea)) secciones[secciones.length - 1].lineas.push(linea);
  }

  return secciones
    .map((s) => ({ ...s, texto: s.lineas.join('\n').trim() }))
    .filter((s) => s.texto.length > 0)
    .map((s, i) => ({
      id: `${docId}#${String(i + 1).padStart(2, '0')}`,
      docId,
      titulo,
      vigencia,
      seccion: s.seccion,
      contenido: s.texto,
      textoEmbebido: `${docId} · ${titulo}\nVigencia: ${vigencia}\nSección: ${s.seccion}\n\n${s.texto}`,
      normativo,
    }));
}
