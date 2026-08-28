import { z } from 'zod';
import { DineroSchema, FechaISOSchema } from './comunes.js';
import { TramoMoraSchema } from './pagos.js';

export const IncluirReestructuradosSchema = z.literal(true).default(true).meta({
  description: 'El indicador oficial siempre incluye créditos reestructurados al día',
});

export const CarteraEnRiesgoQuerySchema = z.object({
  fechaCorte: FechaISOSchema,
  incluirReestructurados: IncluirReestructuradosSchema,
}).strict().meta({ description: 'Parámetros para calcular cartera en riesgo' });

export const DetalleTramoCarteraSchema = z.object({
  tramo: TramoMoraSchema,
  creditos: z.number().int().nonnegative(),
  saldoCapital: DineroSchema,
}).strict();

export const ReestructuradosAlDiaSchema = z.object({
  creditos: z.number().int().nonnegative(),
  saldoCapital: DineroSchema,
}).strict();

export const CarteraEnRiesgoResponseSchema = z.object({
  fechaCorte: FechaISOSchema,
  carteraActiva: DineroSchema,
  saldoEnRiesgo: DineroSchema,
  porcentajeEnRiesgo: z.number().min(0).max(1),
  dadoPorIncobrableEnElPeriodo: DineroSchema,
  porTramo: z.array(DetalleTramoCarteraSchema),
  reestructuradosAlDia: ReestructuradosAlDiaSchema,
}).strict().meta({ description: 'Indicador de cartera en riesgo y baja contable del periodo' });
