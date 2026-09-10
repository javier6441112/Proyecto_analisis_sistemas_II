import { Decimal } from 'decimal.js';
import { type TramoMora } from './politica-mora.js';

export interface TramoConfiguracion {
  nombre: TramoMora;
  desde: number;
  hasta: number;
  tasaDiaria: Decimal;
}

export function validarDiasAtraso(diasAtraso: number): void {
  if (!Number.isInteger(diasAtraso) || diasAtraso < 0) {
    throw new Error('Los días de atraso deben ser enteros no negativos');
  }
}

export function clasificarTramo(diasAtraso: number): TramoMora {
  validarDiasAtraso(diasAtraso);
  if (diasAtraso === 0) return 'AL_DIA';
  if (diasAtraso <= 30) return 'MORA_1';
  if (diasAtraso <= 60) return 'MORA_2';
  if (diasAtraso <= 90) return 'MORA_3';
  if (diasAtraso <= 120) return 'VENCIDO';
  return 'INCOBRABLE';
}

export function diasEnTramo(diasAtraso: number, inicio: number, fin: number): number {
  if (diasAtraso <= 0) return 0;
  return Math.max(0, Math.min(diasAtraso, fin) - inicio + 1);
}
