import { z } from 'zod';
import { ClienteIdSchema } from './clientes.js';
import { DineroPositivoSchema, FechaISOSchema } from './comunes.js';

const MontoSolicitudCreditoSchema = DineroPositivoSchema.refine(
  ({ valor }) => {
    const montoEnCentavos = BigInt(valor.replace('.', ''));
    return montoEnCentavos >= 100000n && montoEnCentavos <= 2500000n;
  },
  'El monto solicitado debe estar entre Q1,000.00 y Q25,000.00',
).meta({ description: 'Monto solicitado entre Q1,000.00 y Q25,000.00', examples: ['1000.00', '25000.00'] });

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
  montoSolicitado: MontoSolicitudCreditoSchema,
  numeroCuotas: z.number().int().min(3).max(24),
}).strict().meta({ description: 'Datos para solicitar un credito' });

export const SolicitudCreditoResponseSchema = z.object({
  id: SolicitudCreditoIdSchema,
  clienteId: ClienteIdSchema,
  montoSolicitado: MontoSolicitudCreditoSchema,
  numeroCuotas: z.number().int().min(3).max(24),
  estado: EstadoSolicitudCreditoSchema,
  solicitadaEn: FechaISOSchema,
}).strict().meta({ description: 'Solicitud de credito registrada' });