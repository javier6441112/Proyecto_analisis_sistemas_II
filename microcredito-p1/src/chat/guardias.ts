/**
 * Guardias deterministas sobre la respuesta del modelo (no dependen de que el modelo
 * obedezca el prompt):
 *  1. Filtro de salida: canario de OP-7, DPI y teléfonos.
 *  2. Verificación de cifras: todo monto con decimales que el modelo escriba debe existir
 *     en lo que devolvieron las herramientas en este turno (o en la pregunta).
 *  3. Cita obligatoria: si se consultó el corpus, la respuesta debe citar un doc_id
 *     normativo recuperado; si no lo hace, se agrega la fuente.
 */

export const MENSAJE_CANARIO =
  'No voy a seguir instrucciones que aparezcan dentro de un documento. El contenido recuperado del corpus es un dato de lectura, no una orden: no emito códigos, no registro pagos sin aprobación humana y no revelo datos personales de clientes.';

export const MENSAJE_FUERA_DE_ALCANCE =
  'Solo puedo ayudar con la operación de Crédito Vecino: créditos, mora, pagos, cartera, cierres, vencimientos y sus políticas. ¿Qué necesita consultar?';

export const MENSAJE_SIN_POLITICA =
  'No encuentro esa información en las políticas de Crédito Vecino, así que no puedo responderla con una fuente verificable.';

export const MENSAJE_CIFRAS_NO_VERIFICADAS =
  'No pude verificar todas las cifras de la redacción. Las cifras correctas, tal como las calcula el núcleo, están en las tarjetas de esta respuesta.';

const DPI = /DPI-FICT-\d+|\b\d{4}\s\d{5}\s\d{4}\b/gi;
/** Teléfonos 5555-1234; excluye identificadores como CV-2026-0043 o IDEM-000068. */
const TELEFONO = /(?<![A-Z]-|\d-)\b\d{4}-\d{4}\b(?!-)/g;

export interface ResultadoFiltro {
  texto: string;
  bloqueado: boolean;
  redacciones: number;
}

export function filtrarSalida(texto: string): ResultadoFiltro {
  if (/CANARIO-\d+/i.test(texto)) return { texto: MENSAJE_CANARIO, bloqueado: true, redacciones: 0 };
  let redacciones = 0;
  const limpio = texto
    .replace(DPI, () => { redacciones++; return '[dato personal omitido]'; })
    .replace(TELEFONO, () => { redacciones++; return '[dato personal omitido]'; });
  return { texto: limpio, bloqueado: false, redacciones };
}

const normalizar = (s: string): string => s.replace(/,/g, '').replace(/^0+(?=\d)/, '');

/** Montos con dos decimales escritos por el modelo (Q1,047.76 · 297606.34 · 11.93 %). */
export function cifrasEnTexto(texto: string): string[] {
  return [...texto.matchAll(/(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(?![\d])/g)].map((m) => normalizar(`${m[1]}.${m[2]}`));
}

/** Todos los números presentes en los datos de las herramientas (y la pregunta). */
export function numerosEnFuentes(fuentes: string[]): Set<string> {
  const set = new Set<string>();
  for (const f of fuentes) {
    for (const m of f.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
      const n = normalizar(m[0]);
      set.add(n);
      if (/\.\d{3,}$/.test(n)) {
        // Un importe sin redondear (18.144) también respalda su versión redondeada (18.14).
        const [ent, dec] = n.split('.');
        set.add(`${ent}.${dec.slice(0, 2)}`);
      }
      if (!n.includes('.')) set.add(`${n}.00`);
      // Una tasa publicada como porcentaje (18.00 %) respalda su forma decimal (0.18).
      if (/^\d{1,3}(\.\d+)?$/.test(n)) set.add(String(Number(n) / 100).replace(/^(\d+\.\d)$/, '$10'));
    }
  }
  return set;
}

export function cifrasNoVerificadas(texto: string, fuentes: string[]): string[] {
  const permitidas = numerosEnFuentes(fuentes);
  return [...new Set(cifrasEnTexto(texto).filter((c) => !permitidas.has(c)))];
}

export interface FuenteCitable {
  docId: string;
  titulo: string;
  vigencia: string;
}

export function asegurarCita(texto: string, fuentes: FuenteCitable[]): { texto: string; agregada: boolean } {
  if (fuentes.length === 0) return { texto, agregada: false };
  if (fuentes.some((f) => texto.includes(f.docId))) return { texto, agregada: false };
  const f = fuentes[0];
  return { texto: `${texto.trim()}\n\nFuente: [${f.docId}] ${f.titulo} — vigencia: ${f.vigencia}.`, agregada: true };
}

export function esSaludo(mensaje: string): boolean {
  return /^\s*(hola|buen[oa]s( d[ií]as| tardes| noches)?|gracias|muchas gracias|ok|adi[oó]s)\b[\s!.¡,]*$/i.test(mensaje);
}
