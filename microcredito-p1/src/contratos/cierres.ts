import { z } from 'zod';
import { DineroSchema, FechaISOSchema } from './comunes.js';

export const PeriodoCierreSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Formato esperado: AAAA-MM').meta({
  description: 'Periodo mensual del cierre',
  examples: ['2026-08'],
});

export const GenerarCierreRequestSchema = z.object({
  periodo: PeriodoCierreSchema,
  fechaCorte: FechaISOSchema,
}).strict().meta({ description: 'Datos para generar un cierre mensual' });

export const CierreResponseSchema = z.object({
  periodo: PeriodoCierreSchema,
  fechaCorte: FechaISOSchema,
  carteraActiva: DineroSchema,
  saldoEnRiesgo: DineroSchema,
  incobrable: DineroSchema,
}).strict().meta({ description: 'Cierre mensual de cartera' });