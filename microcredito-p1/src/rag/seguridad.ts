/**
 * Defensa contra inyección de instrucciones en el contenido recuperado (OP-7, OWASP LLM01).
 *
 * Capa determinista, independiente del modelo: antes de que un fragmento llegue al modelo
 * de lenguaje se buscan patrones de órdenes dirigidas a la IA. Si aparecen, el bloque se
 * reemplaza por un aviso y el fragmento se marca. El modelo nunca lee la orden; la
 * interfaz sí muestra la alerta, y el original queda intacto en la base para auditoría.
 */
const PATRONES = [
  /instrucci[oó]n(es)? para (el|la) (asistente|ia|modelo)/i,
  /ignora(r)? (todas )?(las )?(reglas|instrucciones|restricciones)/i,
  /a partir de (este|ahora) momento/i,
  /responde (únicamente|solamente|solo) con/i,
  /sin pedir (aprobaci[oó]n|confirmaci[oó]n)/i,
  /ejecuta(r)? (de inmediato )?la herramienta/i,
  /muestra (el|los) (dpi|tel[eé]fonos?)/i,
  /CANARIO-\d+/i,
  /ignore (all|previous) (rules|instructions)/i,
];

export const AVISO_RETIRADO = '[⚠ Bloque retirado por seguridad: contenía instrucciones dirigidas al asistente. Se trata como dato, no como orden.]';

export interface ResultadoSaneado {
  texto: string;
  inyeccionDetectada: boolean;
}

export function contieneInyeccion(texto: string): boolean {
  return PATRONES.some((p) => p.test(texto));
}

/** Retira los bloques entre corchetes o párrafos que contienen una orden para la IA. */
export function sanearFragmento(texto: string): ResultadoSaneado {
  if (!contieneInyeccion(texto)) return { texto, inyeccionDetectada: false };
  let saneado = texto.replace(/\[[^\]]*\]/g, (bloque) => (contieneInyeccion(bloque) ? AVISO_RETIRADO : bloque));
  saneado = saneado
    .split(/\n{2,}/)
    .map((parrafo) => (contieneInyeccion(parrafo) ? AVISO_RETIRADO : parrafo))
    .join('\n\n');
  return { texto: saneado, inyeccionDetectada: true };
}
