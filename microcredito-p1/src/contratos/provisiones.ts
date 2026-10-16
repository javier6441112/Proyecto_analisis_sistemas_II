import { z } from 'zod';
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
