import { z } from 'zod';
import {
  CreditoIdSchema,
  DineroPositivoSchema,
  DineroSchema,
  FechaISOSchema,
  InstanteISOSchema,
} from './comunes.js';

export const MedioDePagoSchema = z.enum([
  'efectivo',
  'transferencia',
  'agente_bancario',
  'boleta_banco',
]).meta({ description: 'Medio institucional de recepción del pago' });

export const RegistrarPagoRequestSchema = z.object({
  monto: DineroPositivoSchema,
  fechaPago: FechaISOSchema,
  medio: MedioDePagoSchema,
  referencia: z.string().max(40, 'La referencia no puede superar los 40 caracteres').optional(),
}).strict().meta({ description: 'Datos para registrar un pago mayor que cero' });

export const AplicacionDelPagoSchema = z.object({
  gastos: DineroSchema,
  interesMoratorio: DineroSchema,
  interesCorriente: DineroSchema,
  capital: DineroSchema,
  excedente: DineroSchema,
}).strict().meta({ description: 'Desglose según la prelación de pagos' });

export const DestinoExcedenteSchema = z.enum([
  'amortizacion_capital',
  'cuotas_futuras',
]).meta({ description: 'Destino del excedente a favor del cliente' });

export const TramoMoraSchema = z.enum([
  'ninguno',
  'mora_1',
  'mora_2',
  'mora_3',
  'vencido',
]).meta({ description: 'Clasificación derivada de los días de atraso, no estado del crédito' });

export const EstadoCreditoSchema = z.enum([
  'solicitado',
  'aprobado',
  'desembolsado',
  'vigente',
  'en_mora',
  'reestructurado',
  'rechazado',
  'anulado',
  'cancelado',
  'incobrable',
]).meta({ description: 'Estado del ciclo de vida completo del crédito' });

export const EstadoCreditoDespuesDePagoSchema = z.enum([
  'vigente',
  'en_mora',
  'reestructurado',
  'cancelado',
]);

export const PagoRegistradoSchema = z.object({
  pagoId: z.string().meta({ examples: ['PG-2026-000731'] }),
  creditoId: CreditoIdSchema,
  recibidoEn: InstanteISOSchema,
  montoRecibido: DineroPositivoSchema,
  aplicacion: AplicacionDelPagoSchema,
  destinoExcedente: DestinoExcedenteSchema.nullable(),
  saldoCapitalDespues: DineroSchema,
  estadoCredito: EstadoCreditoDespuesDePagoSchema,
  tramoMora: TramoMoraSchema,
  diasAtraso: z.number().int().nonnegative(),
  reproducido: z.boolean(),
}).strict().meta({ description: 'Resultado de registrar y aplicar un pago' });
