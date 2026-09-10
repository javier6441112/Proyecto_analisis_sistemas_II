import { PoliticaEscalonada } from './politica-escalonada.js';
import { PoliticaPlana } from './politica-plana.js';
import type { PoliticaMora } from './politica-mora.js';

const POLITICAS_VERSIONADAS: readonly PoliticaMora[] = [
  new PoliticaPlana(),
  new PoliticaEscalonada('POL-2026-10'),
];

export function resolverPoliticaMoraPorFecha(fechaOtorgamiento: string): PoliticaMora {
  const fecha = new Date(fechaOtorgamiento);
  if (Number.isNaN(fecha.getTime())) {
    throw new Error('La fecha de otorgamiento debe ser válida');
  }
  const corte = new Date('2026-10-01T00:00:00.000Z');
  return fecha >= corte ? POLITICAS_VERSIONADAS[1] : POLITICAS_VERSIONADAS[0];
}
