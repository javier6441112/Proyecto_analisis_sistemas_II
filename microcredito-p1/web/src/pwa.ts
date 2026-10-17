/**
 * PWA: registro del service worker (solo en la compilación de producción), aviso de instalación
 * y estado de conexión. El service worker nunca guarda respuestas de /api (ver public/sw.js).
 */
import { useSyncExternalStore } from 'react';

interface EventoInstalacion extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let aviso: EventoInstalacion | null = null;
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach((o) => o());
const suscribir = (o: () => void) => { oyentes.add(o); return () => { oyentes.delete(o); }; };

export function registrarPwa(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // se muestra el botón propio «Instalar aplicación»
    aviso = e as EventoInstalacion;
    avisar();
  });
  window.addEventListener('appinstalled', () => { aviso = null; avisar(); });
  window.addEventListener('online', avisar);
  window.addEventListener('offline', avisar);
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((e: unknown) => console.warn('No se pudo registrar el service worker', e));
    });
  }
}

/** Abre el diálogo de instalación del navegador (si lo ofreció). */
export async function instalar(): Promise<void> {
  const e = aviso;
  if (!e) return;
  await e.prompt();
  await e.userChoice;
  aviso = null;
  avisar();
}

/** `true` cuando el navegador ofrece instalar la aplicación. */
export function usePuedeInstalar(): boolean {
  return useSyncExternalStore(suscribir, () => aviso !== null, () => false);
}

export function useEnLinea(): boolean {
  return useSyncExternalStore(suscribir, () => navigator.onLine, () => true);
}
