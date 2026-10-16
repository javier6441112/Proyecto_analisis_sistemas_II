import { z } from 'zod';
import { DineroSchema } from './comunes.js';
import { validarPoliticaProvisiones, type PoliticaProvisiones } from '../dominio/provisiones.js';

/** Forma del archivo externo; las invariantes financieras pertenecen al dominio. */
export const politicaProvisionesSchema = z.object({
  version: z.string(),
  vigenteDesde: z.string(),
  vigenteHasta: z.string().optional(),
  institucion: z.string(),
  autor: z.string(),
  motivo: z.string(),
  porcentajes: z.object({
    AL_DIA: z.string(), MORA_1: z.string(), MORA_2: z.string(),
    MORA_3: z.string(), VENCIDO: z.string(),
  }).strict(),
  minimoReestructurado: z.string(),
}).strict();

export function validarConfiguracionProvisiones(datos: unknown): PoliticaProvisiones {
  const politica = politicaProvisionesSchema.parse(datos);
  validarPoliticaProvisiones(politica);
  return politica;
}

export const ProvisionesCierreSchema = z.discriminatedUnion('estado', [
  z.object({
    estado: z.literal('DISPONIBLE'),
    fechaCorte: z.iso.date(),
    version: z.string().min(1),
    parametros: politicaProvisionesSchema,
    total: DineroSchema,
    detalles: z.array(z.object({
      id: z.string().min(1),
      tramo: z.enum(['AL_DIA', 'MORA_1', 'MORA_2', 'MORA_3', 'VENCIDO', 'INCOBRABLE']),
      excluido: z.boolean(), base: DineroSchema,
      porcentaje: z.string().regex(/^\d+(\.\d+)?$/),
      provision: DineroSchema,
    }).strict()),
  }).strict(),
  z.object({ estado: z.literal('NO_DISPONIBLE'), motivo: z.string().min(1) }).strict(),
]).meta({ description: 'Reserva de capital al corte, separada de cobros y cartera bruta. NO_DISPONIBLE nunca representa cero.' });
