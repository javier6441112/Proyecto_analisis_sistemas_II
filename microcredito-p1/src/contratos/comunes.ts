import { z } from 'zod';

export const ValorMonetarioSchema = z
  .string()
  .regex(/^\d{1,13}\.\d{2}$/, 'Debe ser una cadena decimal no negativa con 2 decimales exactos')
  .meta({ description: 'Importe no negativo con exactamente dos decimales', examples: ['1004.62'] });

export const ValorMonetarioPositivoSchema = ValorMonetarioSchema
  .refine((valor) => BigInt(valor.replace('.', '')) > 0n, 'El monto debe ser mayor que cero')
  .meta({ description: 'Importe mayor que cero con exactamente dos decimales', examples: ['1011.88'] });

export const DineroSchema = z
  .object({
    valor: ValorMonetarioSchema,
    moneda: z.literal('GTQ'),
  })
  .strict()
  .meta({ description: 'Importe en quetzales expresado como texto para evitar punto flotante' });

export const DineroPositivoSchema = z
  .object({
    valor: ValorMonetarioPositivoSchema,
    moneda: z.literal('GTQ'),
  })
  .strict()
  .meta({ description: 'Importe positivo en quetzales expresado como texto' });

export const ErrorDetalleSchema = z.object({
  campo: z.string(),
  mensaje: z.string(),
}).strict();

export const ProblemDetailsSchema = z.object({
  type: z.string().url(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  traceId: z.string().optional(),
  errores: z.array(ErrorDetalleSchema).optional(),
}).strict().meta({ description: 'Cuerpo uniforme de error conforme a RFC 9457' });

export const FechaISOSchema = z.iso.date().meta({
  description: 'Fecha calendario en formato AAAA-MM-DD',
  examples: ['2026-08-22'],
});

export const InstanteISOSchema = z.iso.datetime({ offset: true }).meta({
  description: 'Fecha y hora ISO 8601 con zona horaria',
  examples: ['2026-08-22T09:15:00-06:00'],
});

export const CreditoIdSchema = z.string().regex(/^C-\d{3,8}$/, 'Formato esperado: C-004').meta({
  description: 'Identificador del crédito',
  examples: ['C-004'],
});

export const IdempotencyKeySchema = z.string().uuid().meta({
  description: 'Clave UUID para evitar registrar dos veces el mismo pago',
  examples: ['5b0b9e2e-8a1f-4a5c-9c1e-0d6d1a1f9b3a'],
});
