/**
 * Solo formato de presentación. La interfaz no hace aritmética con dinero: los importes llegan
 * del servidor como texto ("1004.62") y aquí únicamente se les agrega separador de miles.
 */
import type { TDinero } from './api';

/** "1004.62" → "Q1,004.62" (sin pasar por number, para no perder precisión). */
export function Q(d: TDinero | string | undefined | null): string {
  if (d === undefined || d === null) return '—';
  const valor = typeof d === 'string' ? d : d.valor;
  const negativo = valor.startsWith('-');
  const [entero = '0', decimales = '00'] = (negativo ? valor.slice(1) : valor).split('.');
  const conMiles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negativo ? '-' : ''}Q${conMiles}.${decimales.padEnd(2, '0')}`;
}

/** Monto escrito por el usuario → texto con dos decimales ("1000" → "1000.00"), o null si no es válido. */
export function normalizarMonto(texto: string): string | null {
  const t = texto.trim().replace(/,/g, '');
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(t)) return null;
  const [entero, dec = ''] = t.split('.');
  return `${String(Number(entero))}.${dec.padEnd(2, '0')}`;
}

/** Tasa en puntos básicos → "36 %". */
export const tasaAnual = (bps: number): string => `${(bps / 100).toLocaleString('es-GT', { maximumFractionDigits: 2 })} %`;
/** Tasa mensual nominal (TNA / 12) en puntos básicos → "3 %". */
export const tasaMensual = (bps: number): string => `${(bps / 1200).toLocaleString('es-GT', { maximumFractionDigits: 2 })} %`;

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "2026-10-31" → "31 oct 2026"; "2026-10" → "oct 2026". */
export function fecha(iso: string | undefined): string {
  if (!iso) return '—';
  const [a, m, d] = iso.split('-');
  const mes = MESES[Number(m) - 1] ?? m;
  return d ? `${Number(d)} ${mes} ${a}` : `${mes} ${a}`;
}

/** "2026-10-31" → "31 de octubre de 2026". */
export function fechaLarga(iso: string): string {
  const [a, m, d] = iso.split('-');
  return d ? `${Number(d)} de ${MESES_LARGOS[Number(m) - 1]} de ${a}` : `${MESES_LARGOS[Number(m) - 1]} de ${a}`;
}

export const ETIQUETA_TRAMO: Record<string, string> = {
  AL_DIA: 'Al día',
  MORA_1: 'Mora 1',
  MORA_2: 'Mora 2',
  MORA_3: 'Mora 3',
  VENCIDO: 'Vencido',
  INCOBRABLE: 'Incobrable',
  PLANA: 'Tasa plana',
  REESTRUCTURADO_AL_DIA: 'Reestructurado al día',
};

export const ETIQUETA_ESTADO: Record<string, string> = {
  VIGENTE: 'Vigente',
  EN_MORA: 'En mora',
  REESTRUCTURADO: 'Reestructurado',
  INCOBRABLE: 'Incobrable',
  CANCELADO: 'Cancelado',
  SOLICITADA: 'Pendiente',
  APROBADA: 'Aprobada',
  RECHAZADA: 'Rechazada',
  DESEMBOLSADA: 'Desembolsada',
};

export const ETIQUETA_CANAL: Record<string, string> = { agencia: 'Agencia', campo: 'Cobro en campo', transferencia: 'Transferencia' };

export type ColorInsignia = 'green' | 'red' | 'amber' | 'blue' | 'gray';

export function colorTramo(tramo: string): ColorInsignia {
  if (tramo === 'AL_DIA') return 'green';
  if (tramo === 'MORA_1' || tramo === 'MORA_2' || tramo === 'MORA_3') return 'amber';
  if (tramo === 'REESTRUCTURADO_AL_DIA') return 'blue';
  return 'red';
}

export function colorEstado(estado: string): ColorInsignia {
  switch (estado) {
    case 'VIGENTE': case 'APROBADA': case 'DESEMBOLSADA': return 'green';
    case 'EN_MORA': case 'INCOBRABLE': case 'RECHAZADA': return 'red';
    case 'REESTRUCTURADO': return 'blue';
    case 'SOLICITADA': return 'amber';
    default: return 'gray';
  }
}

/** "16.548513333" → "16.5485" (recorta para mostrar; el valor exacto va en el title). */
export const recortar = (exacto: string, decimales = 4): string => {
  const [e, d = ''] = exacto.split('.');
  return d ? `${e}.${d.slice(0, decimales)}` : e!;
};

/** Siguiente código con el formato del patrón (CL-0061, CV-2026-0076…) a partir de los existentes. */
export function siguienteCodigo(prefijo: string, existentes: string[], ancho = 4): string {
  const max = existentes
    .filter((x) => x.startsWith(prefijo))
    .map((x) => Number(x.slice(prefijo.length)))
    .filter((n) => Number.isInteger(n))
    .reduce((a, b) => Math.max(a, b), 0);
  return `${prefijo}${String(max + 1).padStart(ancho, '0')}`;
}
