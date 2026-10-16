import { z } from 'zod';
import { DineroSchema } from './comunes.js';
export const PoliticaDevengoSchema = z.object({ version: z.string().min(1), vigenteDesde: z.iso.date(), vigenteHasta: z.iso.date().optional(),
  autor: z.string().min(1), motivo: z.string().min(1), convencion: z.literal('CONTRACTUAL_DIAS_REALES'),
  suspensionDesdeDias: z.literal(91), bajaDesdeDias: z.literal(121),
}).strict();

const Flujos = z.object({ generado: DineroSchema, ingresoReconocido: DineroSchema, enviadoSuspenso: DineroSchema,
  suspensoRegularizado: DineroSchema, suspensoRetirado: DineroSchema,
}).strict();
export const DevengoCierreSchema = z.discriminatedUnion('estado', [
  z.object({ estado: z.literal('DISPONIBLE'), desde: z.iso.date(), hasta: z.iso.date(), huellaFuentes: z.string(),
    apertura: Flujos.extend({ saldoSuspenso: DineroSchema }), periodo: Flujos, saldoFinalSuspenso: DineroSchema,
    politicas: z.array(z.object({ creditoId: z.string(), politica: PoliticaDevengoSchema }).strict()),
    aperturaRegistro: z.object({ fecha: z.iso.date(), cierreId: z.string(), motivo: z.string() }).strict().optional(),
    movimientosNuevos: z.array(z.string()),
    movimientos: z.array(z.object({ id: z.string(), creditoId: z.string(), cuota: z.number().int().positive(),
      desde: z.iso.date(), hasta: z.iso.date(), fechaContable: z.iso.date(),
      concepto: z.enum(['DEVENGO', 'SUSPENSO', 'REGULARIZACION', 'RETIRO_SUSPENSO']), importe: DineroSchema,
      versionPolitica: z.string(), politica: PoliticaDevengoSchema, cierreId: z.string(), origen: z.enum(['APERTURA', 'PERIODO']), usuario: z.string(),
    }).strict()),
  }).strict(),
  z.object({ estado: z.literal('NO_DISPONIBLE'), motivo: z.string() }).strict(),
]).meta({ description: 'Devengo contractual por competencia. Apertura histórica separada de los flujos del período y de intereses cobrados.' });
