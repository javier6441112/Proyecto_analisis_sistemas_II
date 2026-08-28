import { z } from 'zod';
import { DineroSchema, FechaISOSchema } from './comunes.js';

const DesgloseTramoCierreSchema = z.object({
  tramo: z.enum(['AL_DIA', 'MORA_1', 'MORA_2', 'MORA_3', 'VENCIDO']),
  cantidadCreditos: z.number().int().nonnegative(),
  saldoCapital: DineroSchema,
}).strict();

const RecuperacionCierreSchema = z.object({
  concepto: z.string().min(1),
  monto: DineroSchema,
}).strict();

const ProximoVencimientoSchema = z.object({
  creditoId: z.string().min(1),
  fecha: FechaISOSchema,
  monto: DineroSchema,
}).strict();

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
  recuperaciones: z.array(RecuperacionCierreSchema),
  interesesDevengados: DineroSchema,
  porTramo: z.array(DesgloseTramoCierreSchema),
  provisiones: DineroSchema,
  creditosActivos: z.number().int().nonnegative(),
  proximosVencimientos: z.array(ProximoVencimientoSchema),
  montoDeclaradoIncobrableEnElPeriodo: DineroSchema,
}).strict().meta({ description: 'Cierre diario o mensual de cartera' });