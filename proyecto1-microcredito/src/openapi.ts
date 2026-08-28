import { z } from 'zod';
import {
  CarteraEnRiesgoResponseSchema,
} from './contratos/cartera.js';
import {
  PagoRegistradoSchema,
  RegistrarPagoRequestSchema,
} from './contratos/pagos.js';
import {
  CreditoIdSchema,
  IdempotencyKeySchema,
  ProblemDetailsSchema,
} from './contratos/comunes.js';

function adaptarSchemaOpenAPI30(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(adaptarSchemaOpenAPI30);
  if (valor === null || typeof valor !== 'object') return valor;

  const entrada = valor as Record<string, unknown>;
  const resultado: Record<string, unknown> = {};
  for (const [clave, contenido] of Object.entries(entrada)) {
    if (clave === '$schema' || clave === 'examples' || clave === 'const') continue;
    resultado[clave] = adaptarSchemaOpenAPI30(contenido);
  }

  if ('const' in entrada) resultado.enum = [entrada.const];

  const ramas = resultado.anyOf;
  if (Array.isArray(ramas)) {
    const ramaNula = ramas.find(
      (rama) => rama !== null && typeof rama === 'object' && (rama as Record<string, unknown>).type === 'null',
    );
    if (ramaNula) {
      const ramasNoNulas = ramas.filter((rama) => rama !== ramaNula);
      if (ramasNoNulas.length === 1 && ramasNoNulas[0] !== null && typeof ramasNoNulas[0] === 'object') {
        Object.assign(resultado, ramasNoNulas[0], { nullable: true });
        delete resultado.anyOf;
      } else {
        resultado.anyOf = ramasNoNulas;
        resultado.nullable = true;
      }
    }
  }

  if (resultado.type === 'null') {
    delete resultado.type;
    resultado.nullable = true;
  }
  return resultado;
}

function convertirAOpenAPI(schema: z.ZodType, io: 'input' | 'output' = 'output'): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, { target: 'draft-2020-12', io });
  return adaptarSchemaOpenAPI30(jsonSchema) as Record<string, unknown>;
}

const referenciaPago = {
  pagoId: 'PG-2026-000731',
  creditoId: 'C-004',
  recibidoEn: '2026-08-22T09:15:00-06:00',
  montoRecibido: { valor: '1011.88', moneda: 'GTQ' },
  aplicacion: {
    gastos: { valor: '0.00', moneda: 'GTQ' },
    interesMoratorio: { valor: '7.26', moneda: 'GTQ' },
    interesCorriente: { valor: '278.86', moneda: 'GTQ' },
    capital: { valor: '725.76', moneda: 'GTQ' },
    excedente: { valor: '0.00', moneda: 'GTQ' },
  },
  destinoExcedente: null,
  saldoCapitalDespues: { valor: '8569.62', moneda: 'GTQ' },
  estadoCredito: 'vigente',
  tramoMora: 'ninguno',
  diasAtraso: 0,
  reproducido: false,
};

const problemResponse = (
  status: number,
  title: string,
  detail: string,
  errores?: Array<{ campo: string; mensaje: string }>,
) => ({
  description: detail,
  content: {
    'application/problem+json': {
      schema: { $ref: '#/components/schemas/ProblemDetails' },
      example: {
        type: `https://api.creditovecino.gt/problems/${status}`,
        title,
        status,
        detail,
        instance: '/v1/creditos/C-004/pagos',
        traceId: 'tr-20260822-000731',
        ...(errores ? { errores } : {}),
      },
    },
  },
});

export const documentoOpenAPI = {
  openapi: '3.0.3',
  info: {
    title: 'SGMC - API de Credito Vecino, S. A.',
    version: '1.0.0',
    description: 'Contrato generado desde esquemas Zod. El contrato y la validacion comparten una unica fuente de verdad.',
  },
  servers: [{ url: 'https://api.creditovecino.gt/v1', description: 'Produccion ficticia' }],
  tags: [
    { name: 'Cartera y cobros', description: 'Registro de pagos y saldos' },
    { name: 'Cierres e indicadores', description: 'Cartera en riesgo y cierres' },
  ],
  paths: {
    '/creditos/{creditoId}/pagos': {
      post: {
        tags: ['Cartera y cobros'],
        operationId: 'registrarPago',
        summary: 'Registra un pago sobre un credito',
        description: 'Aplica gastos, interes moratorio, interes corriente y capital, en ese orden. La fecha del pago la envia el cliente.',
        parameters: [
          { name: 'creditoId', in: 'path', required: true, schema: { $ref: '#/components/schemas/CreditoId' } },
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: true,
            description: 'Si se repite con el mismo cuerpo, devuelve la respuesta original sin cobrar de nuevo.',
            schema: { $ref: '#/components/schemas/IdempotencyKey' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RegistrarPagoRequest' },
              examples: {
                pagoExacto: {
                  summary: 'Pago exacto de la cuota 2',
                  value: { monto: { valor: '1011.88', moneda: 'GTQ' }, fechaPago: '2026-08-22', medio: 'agente_bancario', referencia: 'BOL-88213' },
                },
                pagoParcial: {
                  summary: 'Pago parcial',
                  value: { monto: { valor: '500.00', moneda: 'GTQ' }, fechaPago: '2026-08-22', medio: 'efectivo' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Respuesta original de un pago ya registrado; no se cobra nuevamente.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/PagoRegistrado' }, examples: { reproducido: { value: { ...referenciaPago, reproducido: true } } } } },
          },
          '201': {
            description: 'Pago registrado por primera vez.',
            headers: { Location: { schema: { type: 'string' }, description: 'URI del pago creado' } },
            content: { 'application/json': { schema: { $ref: '#/components/schemas/PagoRegistrado' }, examples: { nuevo: { value: referenciaPago } } } },
          },
          '404': problemResponse(404, 'Credito no encontrado', 'No existe un credito con el identificador C-004.'),
          '409': problemResponse(409, 'Conflicto de idempotencia', 'La clave de idempotencia fue reutilizada con otro contenido.'),
          '422': problemResponse(422, 'Credito no admite pagos', 'El credito no admite pagos en su estado actual.'),
          '429': problemResponse(429, 'Limite de solicitudes excedido', 'Se excedio el limite de solicitudes. Intente nuevamente mas tarde.'),
          '500': problemResponse(500, 'Error interno del servidor', 'Ocurrio un error no previsto al procesar la solicitud.'),
        },
      },
    },
    '/cartera-riesgo': {
      get: {
        tags: ['Cierres e indicadores'],
        operationId: 'consultarCarteraEnRiesgo',
        summary: 'Consulta cartera en riesgo a una fecha de corte',
        description: 'La fecha de corte es obligatoria y los reestructurados siempre se incluyen en el indicador oficial.',
        parameters: [
          { name: 'fechaCorte', in: 'query', required: true, schema: { type: 'string', format: 'date', example: '2026-08-22' } },
          { name: 'incluirReestructurados', in: 'query', required: false, schema: { type: 'boolean', enum: [true], default: true } },
        ],
        responses: {
          '200': {
            description: 'Indicador calculado.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CarteraEnRiesgoResponse' },
                examples: {
                  referencia: {
                    value: {
                      fechaCorte: '2026-08-22',
                      carteraActiva: { valor: '800000.00', moneda: 'GTQ' },
                      saldoEnRiesgo: { valor: '56000.00', moneda: 'GTQ' },
                      porcentajeEnRiesgo: 0.07,
                      dadoPorIncobrableEnElPeriodo: { valor: '15000.00', moneda: 'GTQ' },
                      porTramo: [],
                      reestructuradosAlDia: { creditos: 1, saldoCapital: { valor: '6000.00', moneda: 'GTQ' } },
                    },
                  },
                },
              },
            },
          },
          '400': problemResponse(400, 'Parametros de consulta invalidos', 'Revise los parametros enviados en la consulta.', [
            { campo: 'fechaCorte', mensaje: 'El campo es obligatorio y debe tener formato AAAA-MM-DD.' },
          ]),
          '422': problemResponse(422, 'Fecha de corte fuera de rango', 'La fecha de corte esta fuera del rango permitido.'),
        },
      },
    },
  },
  components: {
    schemas: {
      ProblemDetails: convertirAOpenAPI(ProblemDetailsSchema),
      CreditoId: convertirAOpenAPI(CreditoIdSchema),
      IdempotencyKey: convertirAOpenAPI(IdempotencyKeySchema),
      RegistrarPagoRequest: convertirAOpenAPI(RegistrarPagoRequestSchema, 'input'),
      PagoRegistrado: convertirAOpenAPI(PagoRegistradoSchema),
      CarteraEnRiesgoResponse: convertirAOpenAPI(CarteraEnRiesgoResponseSchema),
    },
  },
};
