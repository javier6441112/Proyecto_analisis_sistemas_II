import { z } from 'zod';
import { ClienteIdSchema } from './clientes.js';
import { DineroPositivoSchema, FechaISOSchema } from './comunes.js';

export const SolicitudCreditoIdSchema = z.string().regex(/^SOL-\d{3,8}$/, 'Formato esperado: SOL-001').meta({
  description: 'Identificador de la solicitud de credito',
  examples: ['SOL-001'],
});

export const EstadoSolicitudCreditoSchema = z.enum([
  'solicitada',
  'aprobada',
  'rechazada',
]).meta({ description: 'Estado de la solicitud de credito' });

export const SolicitarCreditoRequestSchema = z.object({
  clienteId: ClienteIdSchema,
  montoSolicitado: DineroPositivoSchema,
  numeroCuotas: z.number().int().min(1).max(360),
}).strict().meta({ description: 'Datos para solicitar un credito' });

export const SolicitudCreditoResponseSchema = z.object({
  id: SolicitudCreditoIdSchema,
  clienteId: ClienteIdSchema,
  montoSolicitado: DineroPositivoSchema,
  numeroCuotas: z.number().int().min(1).max(360),
  estado: EstadoSolicitudCreditoSchema,
  solicitadaEn: FechaISOSchema,
}).strict().meta({ description: 'Solicitud de credito registrada' });