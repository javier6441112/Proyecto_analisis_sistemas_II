import { z } from 'zod';

export const ClienteIdSchema = z.string().regex(/^CLI-\d{3,8}$/, 'Formato esperado: CLI-001').meta({
  description: 'Identificador del cliente',
  examples: ['CLI-001'],
});

export const RegistrarClienteRequestSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio').max(120),
  identificacion: z.string().trim().min(1, 'La identificacion es obligatoria').max(30),
}).strict().meta({ description: 'Datos para registrar un cliente' });

export const ClienteResponseSchema = z.object({
  id: ClienteIdSchema,
  nombre: z.string(),
  identificacion: z.string(),
}).strict().meta({ description: 'Cliente registrado en el sistema' });