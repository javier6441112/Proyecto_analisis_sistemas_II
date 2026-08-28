import { z } from 'zod';
import {
  CarteraEnRiesgoResponseSchema,
} from './contratos/cartera.js';
import {
  ClienteResponseSchema,
  RegistrarClienteRequestSchema,
} from './contratos/clientes.js';
import {
  CierreResponseSchema,
  GenerarCierreRequestSchema,
} from './contratos/cierres.js';
import {
  CreditoResponseSchema,
  DesembolsarCreditoRequestSchema,
} from './contratos/creditos.js';
import {
  PagoRegistradoSchema,
  RegistrarPagoRequestSchema,
} from './contratos/pagos.js';
import {
  SolicitarCreditoRequestSchema,
  SolicitudCreditoResponseSchema,
} from './contratos/solicitudes.js';
import {
  CreditoIdSchema,
  IdempotencyKeySchema,
  ProblemDetailsSchema,
} from './contratos/comunes.js';

function convertirAOpenAPI(schema: z.ZodType, io: 'input' | 'output' = 'output'): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, { target: 'draft-2020-12', io });
  return jsonSchema as Record<string, unknown>;
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

const instanciaPago = (creditoId: string) => `/v1/creditos/${encodeURIComponent(creditoId)}/pagos`;

const problemResponse = (
  status: number,
  title: string,
  detail: string,
  instance: string,
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
        instance,
        traceId: 'tr-20260822-000731',
        ...(errores ? { errores } : {}),
      },
    },
  },
});

export const documentoOpenAPI = {
  openapi: '3.1.0',
  info: {
    title: 'SGMC - API de Credito Vecino, S. A.',
    version: '1.0.0',
    description: 'Contrato generado desde esquemas Zod. El contrato y la validacion comparten una unica fuente de verdad.',
  },
  servers: [{ url: 'https://api.creditovecino.gt/v1', description: 'Produccion ficticia' }],
  tags: [
    { name: 'Cartera y cobros', description: 'Registro de pagos y saldos' },
    { name: 'Cierres e indicadores', description: 'Cartera en riesgo y cierres' },
    { name: 'Clientes y originacion', description: 'Clientes, solicitudes y desembolsos' },
  ],
  paths: {
    '/clientes': {
      post: {
        tags: ['Clientes y originacion'],
        operationId: 'registrarCliente',
        summary: 'Registra un cliente',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RegistrarClienteRequest' },
              example: { nombre: 'Ana Lopez', identificacion: 'DPI-1234567890101' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Cliente registrado.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ClienteResponse' },
                example: { id: 'CLI-001', nombre: 'Ana Lopez', identificacion: 'DPI-1234567890101' },
              },
            },
          },
          '400': problemResponse(400, 'Datos de cliente invalidos', 'Revise los datos enviados para registrar el cliente.', '/v1/clientes'),
          '409': problemResponse(409, 'Cliente duplicado', 'La identificacion ya esta registrada.', '/v1/clientes'),
        },
      },
    },
    '/solicitudes-credito': {
      post: {
        tags: ['Clientes y originacion'],
        operationId: 'solicitarCredito',
        summary: 'Registra una solicitud de credito',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SolicitarCreditoRequest' },
              example: { clienteId: 'CLI-001', montoSolicitado: { valor: '10000.00', moneda: 'GTQ' }, numeroCuotas: 12 },
            },
          },
        },
        responses: {
          '201': {
            description: 'Solicitud de credito registrada.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SolicitudCreditoResponse' },
                example: { id: 'SOL-001', clienteId: 'CLI-001', montoSolicitado: { valor: '10000.00', moneda: 'GTQ' }, numeroCuotas: 12, estado: 'solicitada', solicitadaEn: '2026-08-27' },
              },
            },
          },
          '400': problemResponse(400, 'Solicitud invalida', 'Revise los datos enviados para solicitar el credito.', '/v1/solicitudes-credito'),
          '404': problemResponse(404, 'Cliente no encontrado', 'No existe un cliente con el identificador CLI-001.', '/v1/solicitudes-credito'),
        },
      },
    },
    '/creditos/{creditoId}/desembolso': {
      post: {
        tags: ['Clientes y originacion'],
        operationId: 'desembolsarCredito',
        summary: 'Desembolsa un credito aprobado',
        parameters: [
          { name: 'creditoId', in: 'path', required: true, schema: { $ref: '#/components/schemas/CreditoId' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/DesembolsarCreditoRequest' },
              example: { solicitudId: 'SOL-001', clienteId: 'CLI-001', capital: { valor: '10000.00', moneda: 'GTQ' }, fechaDesembolso: '2026-08-27' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Credito desembolsado.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreditoResponse' },
                example: { id: 'C-004', solicitudId: 'SOL-001', clienteId: 'CLI-001', capital: { valor: '10000.00', moneda: 'GTQ' }, estado: 'vigente', diasAtraso: 0, desembolsadoEn: '2026-08-27' },
              },
            },
          },
          '404': problemResponse(404, 'Solicitud no encontrada', 'No existe la solicitud SOL-001.', '/v1/creditos/C-004/desembolso'),
          '422': problemResponse(422, 'Credito no puede desembolsarse', 'La solicitud no esta aprobada.', '/v1/creditos/C-004/desembolso'),
        },
      },
    },
    '/cierres': {
      post: {
        tags: ['Cierres e indicadores'],
        operationId: 'generarCierre',
        summary: 'Genera un cierre diario o mensual',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/GenerarCierreRequest' },
              example: { periodo: '2026-08', fechaCorte: '2026-08-22' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Cierre mensual generado.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CierreResponse' },
                example: { periodo: '2026-08', fechaCorte: '2026-08-22', carteraActiva: { valor: '800000.00', moneda: 'GTQ' }, saldoEnRiesgo: { valor: '56000.00', moneda: 'GTQ' }, incobrable: { valor: '15000.00', moneda: 'GTQ' }, recuperaciones: [{ concepto: 'capital', monto: { valor: '12000.00', moneda: 'GTQ' } }], interesesDevengados: { valor: '24000.00', moneda: 'GTQ' }, porTramo: [{ tramo: 'MORA_2', cantidadCreditos: 3, saldoCapital: { valor: '56000.00', moneda: 'GTQ' } }], provisiones: { valor: '15000.00', moneda: 'GTQ' }, creditosActivos: 42, proximosVencimientos: [{ creditoId: 'C-004', fecha: '2026-08-31', monto: { valor: '1004.62', moneda: 'GTQ' } }], montoDeclaradoIncobrableEnElPeriodo: { valor: '8000.00', moneda: 'GTQ' } },
              },
            },
          },
          '200': {
            description: 'Cierre mensual existente reproducido sin duplicarlo.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CierreResponse' },
                example: { periodo: '2026-08', fechaCorte: '2026-08-22', carteraActiva: { valor: '800000.00', moneda: 'GTQ' }, saldoEnRiesgo: { valor: '56000.00', moneda: 'GTQ' }, incobrable: { valor: '15000.00', moneda: 'GTQ' }, recuperaciones: [{ concepto: 'capital', monto: { valor: '12000.00', moneda: 'GTQ' } }], interesesDevengados: { valor: '24000.00', moneda: 'GTQ' }, porTramo: [{ tramo: 'MORA_2', cantidadCreditos: 3, saldoCapital: { valor: '56000.00', moneda: 'GTQ' } }], provisiones: { valor: '15000.00', moneda: 'GTQ' }, creditosActivos: 42, proximosVencimientos: [{ creditoId: 'C-004', fecha: '2026-08-31', monto: { valor: '1004.62', moneda: 'GTQ' } }], montoDeclaradoIncobrableEnElPeriodo: { valor: '8000.00', moneda: 'GTQ' } },
              },
            },
          },
          '400': problemResponse(400, 'Parametros de cierre invalidos', 'Revise el periodo y la fecha de corte.', '/v1/cierres'),
        },
      },
    },
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
          '404': problemResponse(404, 'Credito no encontrado', 'No existe un credito con el identificador C-004.', instanciaPago('C-004')),
          '409': problemResponse(409, 'Conflicto de idempotencia', 'La clave de idempotencia fue reutilizada con otro contenido.', instanciaPago('C-004')),
          '422': problemResponse(422, 'Credito no admite pagos', 'El credito no admite pagos en su estado actual.', instanciaPago('C-004')),
          '429': problemResponse(429, 'Limite de solicitudes excedido', 'Se excedio el limite de solicitudes. Intente nuevamente mas tarde.', instanciaPago('C-004')),
          '500': problemResponse(500, 'Error interno del servidor', 'Ocurrio un error no previsto al procesar la solicitud.', instanciaPago('C-004')),
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
          '400': problemResponse(400, 'Parametros de consulta invalidos', 'Revise los parametros enviados en la consulta.', '/v1/cartera-riesgo?fechaCorte=2026-08-22', [
            { campo: 'fechaCorte', mensaje: 'El campo es obligatorio y debe tener formato AAAA-MM-DD.' },
          ]),
          '422': problemResponse(422, 'Fecha de corte fuera de rango', 'La fecha de corte esta fuera del rango permitido.', '/v1/cartera-riesgo?fechaCorte=2026-08-22'),
        },
      },
    },
  },
  components: {
    schemas: {
      ProblemDetails: convertirAOpenAPI(ProblemDetailsSchema),
      CreditoId: convertirAOpenAPI(CreditoIdSchema),
      IdempotencyKey: convertirAOpenAPI(IdempotencyKeySchema),
      RegistrarClienteRequest: convertirAOpenAPI(RegistrarClienteRequestSchema, 'input'),
      ClienteResponse: convertirAOpenAPI(ClienteResponseSchema),
      GenerarCierreRequest: convertirAOpenAPI(GenerarCierreRequestSchema, 'input'),
      CierreResponse: convertirAOpenAPI(CierreResponseSchema),
      DesembolsarCreditoRequest: convertirAOpenAPI(DesembolsarCreditoRequestSchema, 'input'),
      CreditoResponse: convertirAOpenAPI(CreditoResponseSchema),
      RegistrarPagoRequest: convertirAOpenAPI(RegistrarPagoRequestSchema, 'input'),
      PagoRegistrado: convertirAOpenAPI(PagoRegistradoSchema),
      SolicitarCreditoRequest: convertirAOpenAPI(SolicitarCreditoRequestSchema, 'input'),
      SolicitudCreditoResponse: convertirAOpenAPI(SolicitudCreditoResponseSchema),
      CarteraEnRiesgoResponse: convertirAOpenAPI(CarteraEnRiesgoResponseSchema),
    },
  },
};
