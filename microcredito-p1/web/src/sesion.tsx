import { createContext, useContext } from 'react';

/** La API nunca lee el reloj: toda la interfaz opera a una fecha explícita (cartera canónica al 31 oct 2026). */
export const FECHA_INICIAL = '2026-10-31';
/** Tasa nominal anual de la política de crédito vigente (36 %). */
export const TNA_BPS = 3600;
export const LIMITES = { capitalMin: 1000, capitalMax: 25000, plazoMin: 3, plazoMax: 24 } as const;

export interface Sesion {
  perfil: 'asesor' | 'gerencia';
  usuario: string;
  idAsesor?: string;
  fecha: string;
  cambiarFecha: (f: string) => void;
  salir: () => void;
}

export const ContextoSesion = createContext<Sesion | null>(null);

export function useSesion(): Sesion {
  const s = useContext(ContextoSesion);
  if (!s) throw new Error('useSesion fuera de ContextoSesion');
  return s;
}
