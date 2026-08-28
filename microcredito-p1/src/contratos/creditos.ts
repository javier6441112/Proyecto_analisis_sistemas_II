import { z } from 'zod';
import { ClienteIdSchema } from './clientes.js';
import { DineroPositivoSchema, FechaISOSchema } from './comunes.js';
import { SolicitudCreditoIdSchema } from './solicitudes.js';

export const CreditoContratoIdSchema = z.string().regex(/^C-\d{3,8}$/, 'Formato esperado: C-004').meta({
  description: 'Identificador del credito',
  examples: ['C-004'],
});

export const EstadoCreditoContratoSchema = z.enum([
  'aprobado',
  'desembolsado',
  'vigente',
  'en_mora',
  'reestructurado',
  'cancelado',
  'incobrable',
]).meta({ description: 'Estado operativo del credito' });

export const DesembolsarCreditoRequestSchema = z.object({
  solicitudId: SolicitudCreditoIdSchema,
  clienteId: ClienteIdSchema,
  capital: DineroPositivoSchema,
  fechaDesembolso: FechaISOSchema,
}).strict().meta({ description: 'Datos para desembolsar un credito aprobado' });

export const CreditoResponseSchema = z.object({
  id: CreditoContratoIdSchema,
  solicitudId: SolicitudCreditoIdSchema,
  clienteId: ClienteIdSchema,
  capital: DineroPositivoSchema,
  estado: EstadoCreditoContratoSchema,
  diasAtraso: z.number().int().nonnegative(),
  desembolsadoEn: FechaISOSchema,
}).strict().meta({ description: 'Credito desembolsado' });