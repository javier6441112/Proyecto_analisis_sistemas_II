/**
 * Conversación del asistente gerencial, fuera del ciclo de vida de la pantalla.
 *
 * El menú gerencial desmonta la pestaña al navegar; si el historial viviera en `useState` se
 * perdería al ir a Tablero y volver. Aquí vive en un almacén de módulo, respaldado en
 * `sessionStorage` (sobrevive a recargas, se borra al cerrar sesión), y una respuesta que llega
 * mientras se está en otra pantalla se agrega igual al historial.
 */
import { useSyncExternalStore } from 'react';
import { api, mensajeDeError, type TRespuestaChat } from '../api';

export type Mensaje =
  | { de: 'persona'; texto: string }
  | { de: 'asistente'; r: TRespuestaChat }
  | { de: 'error'; texto: string };

export type Decision = 'aprobada' | 'rechazada';

export interface EstadoConversacion {
  mensajes: Mensaje[];
  sesionId?: string;
  pensando: boolean;
  /** Texto escrito y aún no enviado. */
  borrador: string;
  /** Decisión humana tomada sobre cada propuesta de pago (por `propuestaId`). */
  decisiones: Record<string, Decision>;
}

const VACIO: EstadoConversacion = { mensajes: [], pensando: false, borrador: '', decisiones: {} };
const PREFIJO = 'cv-chat:';

let cuenta: string | null = null;
let estado: EstadoConversacion = VACIO;
/** Cambia al abrir otra cuenta o empezar de nuevo: descarta respuestas de una conversación anterior. */
let generacion = 0;
const oyentes = new Set<() => void>();

function leer(c: string): EstadoConversacion {
  try {
    const t = sessionStorage.getItem(PREFIJO + c);
    // Una petición en curso no sobrevive a la recarga: nunca se restaura «pensando».
    return t ? { ...VACIO, ...(JSON.parse(t) as Partial<EstadoConversacion>), pensando: false } : VACIO;
  } catch {
    return VACIO;
  }
}

function fijar(cambio: Partial<EstadoConversacion>): void {
  estado = { ...estado, ...cambio };
  if (cuenta) {
    try { sessionStorage.setItem(PREFIJO + cuenta, JSON.stringify(estado)); } catch { /* sin almacenamiento */ }
  }
  oyentes.forEach((o) => o());
}

export const conversacion = {
  /** Carga la conversación guardada de la cuenta (no hace nada si ya es la activa). */
  abrir(c: string): void {
    if (cuenta === c) return;
    cuenta = c;
    generacion++;
    estado = leer(c);
    oyentes.forEach((o) => o());
  },

  suscribir(oyente: () => void): () => void {
    oyentes.add(oyente);
    return () => { oyentes.delete(oyente); };
  },

  instantanea: (): EstadoConversacion => estado,

  escribir(texto: string): void {
    fijar({ borrador: texto });
  },

  async enviar(pregunta: string, fechaOperacion: string): Promise<void> {
    const t = pregunta.trim();
    if (!t || estado.pensando) return;
    const mia = generacion;
    fijar({ borrador: '', pensando: true, mensajes: [...estado.mensajes, { de: 'persona', texto: t }] });
    try {
      const r = await api.chat(t, fechaOperacion, estado.sesionId);
      if (mia === generacion) fijar({ sesionId: r.sesionId, mensajes: [...estado.mensajes, { de: 'asistente', r }] });
    } catch (err) {
      if (mia === generacion) fijar({ mensajes: [...estado.mensajes, { de: 'error', texto: mensajeDeError(err) }] });
    } finally {
      if (mia === generacion) fijar({ pensando: false });
    }
  },

  decision: (propuestaId: string): Decision | undefined => estado.decisiones[propuestaId],

  decidir(propuestaId: string, d: Decision): void {
    fijar({ decisiones: { ...estado.decisiones, [propuestaId]: d } });
  },

  /** «Nueva conversación»: el servidor olvida el historial y se empieza en blanco. */
  nueva(): void {
    if (estado.sesionId) api.olvidarChat(estado.sesionId).catch(() => undefined);
    generacion++;
    fijar({ ...VACIO, borrador: estado.borrador });
  },

  /** Al cerrar sesión: borra la conversación del navegador y del servidor. */
  descartar(): void {
    if (estado.sesionId) api.olvidarChat(estado.sesionId).catch(() => undefined);
    if (cuenta) {
      try { sessionStorage.removeItem(PREFIJO + cuenta); } catch { /* sin almacenamiento */ }
    }
    cuenta = null;
    generacion++;
    estado = VACIO;
    oyentes.forEach((o) => o());
  },
};

export function useConversacion(): EstadoConversacion {
  return useSyncExternalStore(conversacion.suscribir, conversacion.instantanea, conversacion.instantanea);
}
