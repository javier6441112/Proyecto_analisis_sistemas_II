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

const DineroConSigno = z.object({ valor: z.string().regex(/^-?\d{1,16}\.\d{2}$/), moneda: z.literal('GTQ') }).strict();
export const AperturaProvisionSchema = z.object({
  id: z.literal('INICIAL'), fechaContable: z.iso.date(), cierreId: z.string(), usuario: z.string().min(1),
  motivo: z.string().min(1), origen: z.enum(['CERO_SIN_HISTORICOS', 'CIERRE_HISTORICO']),
}).strict();
export const MovimientoProvisionSchema = z.object({
  id: z.string(), creditoId: z.string(), periodo: z.string(), cierreId: z.string(), fechaContable: z.iso.date(),
  importe: DineroConSigno, concepto: z.enum(['APERTURA', 'CONSTITUCION', 'REDUCCION']),
  versionPolitica: z.string(), parametros: politicaProvisionesSchema, usuario: z.string(),
}).strict();
export const ContabilizacionProvisionesSchema = z.object({
  apertura: AperturaProvisionSchema, saldoAnterior: DineroSchema, variacion: DineroConSigno,
  saldoFinal: DineroSchema, movimientos: z.array(MovimientoProvisionSchema),
}).strict();
export const AperturaProvisionesBodySchema = z.object({
  periodoCierre: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), motivo: z.string().trim().min(1).max(1000),
}).strict();
export const RegistroProvisionesSchema = z.discriminatedUnion('estado', [
  z.object({ estado: z.literal('DISPONIBLE'), fechaCorte: z.iso.date(), apertura: AperturaProvisionSchema,
    total: DineroSchema, saldos: z.array(z.object({ creditoId: z.string(), saldo: DineroSchema }).strict()),
    movimientos: z.array(MovimientoProvisionSchema),
  }).strict(),
  z.object({ estado: z.literal('NO_DISPONIBLE'), fechaCorte: z.iso.date(), motivo: z.string() }).strict(),
]);
