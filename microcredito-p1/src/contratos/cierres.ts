import { z } from 'zod';
import { DineroSchema, FechaISOSchema } from './comunes.js';

export const PeriodoCierreSchema = z.union([
  z.iso.date(),
  z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Formato esperado: AAAA-MM'),
]).meta({
  description: 'Periodo del cierre diario (AAAA-MM-DD) o mensual (AAAA-MM)',
  examples: ['2026-08-22', '2026-08'],
});

export const GenerarCierreRequestSchema = z.object({
  periodo: PeriodoCierreSchema,
  fechaCorte: FechaISOSchema,
}).strict().meta({ description: 'Datos para generar un cierre diario o mensual' });

export const CierreResponseSchema = z.object({
  periodo: PeriodoCierreSchema,
  fechaCorte: FechaISOSchema,
  carteraActiva: DineroSchema,
  saldoEnRiesgo: DineroSchema,
  incobrable: DineroSchema,
}).strict().meta({ description: 'Cierre diario o mensual de cartera' });