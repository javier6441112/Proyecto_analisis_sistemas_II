import { z } from 'zod';
import * as C from './contratos/api.js';

/**
 * Documento OpenAPI 3.1 de la API REST real (`src/api/servidor.ts`).
 *
 * Los componentes salen de los esquemas Zod de `src/contratos/api.ts` (los mismos que valida el
 * servidor); `tests/contrato-api.test.ts` comprueba que las respuestas reales los cumplen.
 */

type Esquema = Record<string, unknown>;

/** Componentes: todo esquema con `id` registrado por `src/contratos/api.ts`. */
function componentes(): Record<string, Esquema> {
  const { schemas } = z.toJSONSchema(z.globalRegistry, {
    target: 'draft-2020-12',
    io: 'input',
    uri: (id) => `#/components/schemas/${id}`,
  });
  return Object.fromEntries(Object.entries(schemas).map(([id, esquema]) => {
    const { $schema: _s, $id: _i, ...resto } = esquema as Esquema;
    return [id, resto];
  }));
}

const ref = (id: string): Esquema => ({ $ref: `#/components/schemas/${id}` });
const jsonDe = (z_: z.ZodType): Esquema => {
  const { $schema: _s, ...resto } = z.toJSONSchema(z_, { target: 'draft-2020-12', io: 'input' }) as Esquema;
  return resto;
};

const ok = (descripcion: string, esquema: Esquema, ejemplo?: unknown) => ({
  description: descripcion,
  content: { 'application/json': { schema: esquema, ...(ejemplo === undefined ? {} : { example: ejemplo }) } },
});

const problema = (descripcion: string, codigo: string, status: number, detalle: string) => ({
  description: descripcion,
  content: {
    'application/problem+json': {
      schema: ref('Problema'),
      example: {
        type: `https://creditovecino.local/problemas/${codigo.toLowerCase().replace(/_/g, '-')}`,
        title: descripcion,
        status,
        detail: detalle,
        codigo,
      },
    },
  },
});

const ERROR_400 = problema('Datos inválidos', 'DATOS_INVALIDOS', 400, 'La solicitud no cumple el esquema');
const ERROR_404 = problema('Registro inexistente', 'ENTIDAD_INEXISTENTE', 404, 'No existe el registro solicitado');
const ERROR_409 = problema('Conflicto de estado', 'TRANSICION_INVALIDA', 409, 'La operación no es válida en el estado actual');

const cuerpo = (id: string, ejemplo: unknown) => ({
  required: true,
  content: { 'application/json': { schema: ref(id), example: ejemplo } },
});

/** Parámetros de consulta a partir de un `z.object` (fuente única: el mismo esquema que valida el servidor). */
function consulta(esquema: z.ZodObject): Esquema[] {
  return Object.entries(esquema.shape).map(([nombre, campo]) => ({
    name: nombre,
    in: 'query',
    required: !(campo as z.ZodType).safeParse(undefined).success,
    schema: jsonDe(campo as z.ZodType),
  }));
}

const ruta = (nombre: string, esquema: z.ZodType, descripcion: string): Esquema => ({
  name: nombre, in: 'path', required: true, description: descripcion, schema: jsonDe(esquema),
});

const P_ID_CREDITO = ruta('idCredito', z.string(), 'Identificador del crédito (CV-AAAA-NNNN)');
const P_ID_SOLICITUD = ruta('idSolicitud', z.string(), 'Identificador de la solicitud (SOL-NNNN)');

const OPERADOR: Esquema[] = [
  { name: 'X-Perfil', in: 'header', required: true, schema: jsonDe(C.Perfil), description: 'Perfil de quien opera' },
  { name: 'X-Usuario', in: 'header', required: true, schema: { type: 'string', minLength: 1 }, description: 'Nombre de quien opera (auditoría)' },
];

const F = '2026-10-31';

export const documentoOpenAPI = {
  openapi: '3.1.0',
  info: {
    title: 'SGMC - API de Crédito Vecino, S. A.',
    version: '2.0.0',
    description: [
      'API REST del Sistema de Gestión de Microcrédito. Contrato generado desde los esquemas Zod de',
      '`src/contratos/api.ts`, que también valida el servidor: el contrato y la validación comparten una única fuente de verdad.',
      '',
      '- Toda lectura exige `fechaCorte` explícita; la API nunca lee el reloj.',
      '- El dinero viaja como texto (`{ valor: "1004.62", moneda: "GTQ" }`), nunca como número.',
      '- Las operaciones exigen las cabeceras `X-Perfil` (asesor | gerencia) y `X-Usuario`.',
      '- Registrar un pago exige `Idempotency-Key` y aprobación humana explícita.',
    ].join('\n'),
  },
  servers: [{ url: 'http://127.0.0.1:3000', description: 'Servidor local (npm run api)' }],
  tags: [
    { name: 'Catálogos', description: 'Asesores, políticas y clientes' },
    { name: 'Créditos', description: 'Consulta de créditos, planes y mora' },
    { name: 'Originación', description: 'Solicitudes, comité y desembolso' },
    { name: 'Cobros', description: 'Simulación y registro de pagos' },
    { name: 'Gerencia', description: 'Cartera, vencimientos y cierres' },
    { name: 'Asistente', description: 'Chat gerencial y aprobación de propuestas' },
  ],
  paths: {
    '/api/salud': {
      get: {
        tags: ['Catálogos'], operationId: 'salud', summary: 'Estado del servicio y auditoría de pagos',
        responses: { '200': ok('Servicio disponible.', { type: 'object', properties: { estado: { const: 'ok' }, pagos: {} }, required: ['estado'] }) },
      },
    },
    '/api/asesores': {
      get: {
        tags: ['Catálogos'], operationId: 'listarAsesores', summary: 'Lista los asesores de crédito',
        responses: { '200': ok('Asesores.', { type: 'array', items: ref('Asesor') }, [{ idAsesor: 'AS-01', nombreCompleto: 'Byron Estuardo Cifuentes' }]) },
      },
    },
    '/api/politicas': {
      get: {
        tags: ['Catálogos'], operationId: 'consultarPoliticas', summary: 'Parámetros de política de mora vigentes',
        responses: { '200': ok('Parámetros de política.', ref('Politicas')) },
      },
    },
    '/api/clientes': {
      get: {
        tags: ['Catálogos'], operationId: 'buscarClientes', summary: 'Busca clientes por código, nombre o DPI',
        parameters: consulta(C.BusquedaQuery),
        responses: { '200': ok('Clientes que coinciden.', { type: 'array', items: ref('Cliente') }) },
      },
      post: {
        tags: ['Catálogos'], operationId: 'registrarCliente', summary: 'Registra un cliente',
        parameters: OPERADOR,
        requestBody: cuerpo('AltaClienteBody', { idCliente: 'CL-0101', nombreCompleto: 'Ana López Pérez', dpi: '2598112340101', telefono: '5555-4787', municipio: 'Cobán', fechaAlta: F }),
        responses: {
          '201': ok('Cliente registrado.', ref('Cliente')),
          '400': ERROR_400,
          '409': problema('Registro duplicado', 'ENTIDAD_DUPLICADA', 409, 'Ya existe un cliente con ese código o DPI'),
        },
      },
    },
    '/api/creditos': {
      get: {
        tags: ['Créditos'], operationId: 'listarCreditos', summary: 'Lista los créditos a una fecha de corte',
        parameters: consulta(C.CreditosQuery),
        responses: { '200': ok('Créditos con saldo, estado y próxima cuota.', ref('ListadoCreditos')), '400': ERROR_400 },
      },
    },
    '/api/creditos/{idCredito}': {
      get: {
        tags: ['Créditos'], operationId: 'consultarCredito', summary: 'Detalle de un crédito a una fecha de corte',
        parameters: [P_ID_CREDITO, ...consulta(C.ConCorte)],
        responses: {
          '200': ok('Detalle con cuotas vencidas, pendientes y pagos aplicados.', ref('DetalleCredito')),
          '400': ERROR_400,
          '404': problema('Crédito inexistente', 'CREDITO_INEXISTENTE', 404, 'No existe el crédito CV-2026-9999'),
        },
      },
    },
    '/api/creditos/{idCredito}/plan': {
      get: {
        tags: ['Créditos'], operationId: 'consultarPlanCredito', summary: 'Plan de amortización con el estado de cada cuota',
        parameters: [P_ID_CREDITO, ...consulta(C.ConCorte)],
        responses: { '200': ok('Plan del crédito.', ref('PlanCredito')), '400': ERROR_400, '404': ERROR_404 },
      },
    },
    '/api/creditos/{idCredito}/cuotas/{numero}/mora': {
      get: {
        tags: ['Créditos'], operationId: 'explicarMora', summary: 'Desglose del interés moratorio de una cuota por tramo recorrido',
        parameters: [P_ID_CREDITO, ruta('numero', z.number().int().min(1), 'Número de cuota'), ...consulta(C.ConCorte)],
        responses: {
          '200': ok('Tramos recorridos y total redondeado una sola vez.', ref('ExplicacionMora')),
          '400': ERROR_400,
          '404': ERROR_404,
          '409': problema('Cuota no vencida', 'CUOTA_NO_VENCIDA', 409, 'La cuota aún no está vencida a la fecha de corte'),
        },
      },
    },
    '/api/simulaciones/plan': {
      post: {
        tags: ['Originación'], operationId: 'simularPlan', summary: 'Simula un plan de amortización (sistema francés)',
        requestBody: cuerpo('PlanBody', { capital: '10000.00', plazoMeses: 12, tnaBps: 3600, fechaDesembolso: F }),
        responses: { '200': ok('Plan simulado.', ref('PlanSimulado')), '400': ERROR_400 },
      },
    },
    '/api/solicitudes': {
      get: {
        tags: ['Originación'], operationId: 'listarSolicitudes', summary: 'Bandeja de solicitudes de crédito',
        responses: { '200': ok('Solicitudes.', { type: 'array', items: ref('Solicitud') }) },
      },
      post: {
        tags: ['Originación'], operationId: 'crearSolicitud', summary: 'Registra una solicitud de crédito y devuelve su plan',
        parameters: OPERADOR,
        requestBody: cuerpo('SolicitudBody', { idCliente: 'CL-0001', idAsesor: 'AS-01', capital: '10000.00', plazoMeses: 12, tnaBps: 3600, fecha: F }),
        responses: { '201': ok('Solicitud registrada.', ref('SolicitudCreada')), '400': ERROR_400, '404': ERROR_404, '409': ERROR_409 },
      },
    },
    '/api/solicitudes/{idSolicitud}/resolucion': {
      post: {
        tags: ['Originación'], operationId: 'resolverSolicitud', summary: 'Aprueba o rechaza una solicitud (solo gerencia)',
        parameters: [P_ID_SOLICITUD, ...OPERADOR],
        requestBody: cuerpo('ResolucionBody', { decision: 'APROBADA', motivo: 'Cumple la política de crédito', fecha: F }),
        responses: {
          '200': ok('Solicitud resuelta.', ref('Solicitud')),
          '400': ERROR_400,
          '403': problema('No autorizado', 'NO_AUTORIZADO', 403, 'Solo el perfil gerencia puede resolver solicitudes'),
          '404': ERROR_404,
          '409': ERROR_409,
        },
      },
    },
    '/api/solicitudes/{idSolicitud}/desembolso': {
      post: {
        tags: ['Originación'], operationId: 'desembolsar', summary: 'Desembolsa una solicitud aprobada y crea el crédito',
        parameters: [P_ID_SOLICITUD, ...OPERADOR],
        requestBody: cuerpo('DesembolsoBody', { idCredito: 'CV-2026-0076', fecha: F }),
        responses: { '201': ok('Crédito creado con su plan.', ref('DetalleCredito')), '400': ERROR_400, '404': ERROR_404, '409': ERROR_409 },
      },
    },
    '/api/pagos/simulacion': {
      post: {
        tags: ['Cobros'], operationId: 'simularPago', summary: 'Consulta lo exigible o simula la liquidación de un pago',
        description: 'Sin `monto` devuelve el crédito y la cuota exigible. Con `monto` devuelve ACEPTABLE, DUPLICADO o RECHAZADO sin escribir nada.',
        requestBody: cuerpo('SimulacionPagoBody', { idCredito: 'CV-2026-0043', fechaPago: F }),
        responses: { '200': ok('Resultado de la simulación.', ref('SimulacionPago')), '400': ERROR_400, '404': ERROR_404 },
      },
    },
    '/api/creditos/{idCredito}/pagos': {
      post: {
        tags: ['Cobros'], operationId: 'registrarPago', summary: 'Registra un pago sobre la cuota vencida más antigua',
        description: 'Aplica gastos, interés moratorio, interés corriente y capital, en ese orden. El monto debe saldar exactamente la cuota exigible.',
        parameters: [
          P_ID_CREDITO,
          ...OPERADOR,
          {
            name: 'Idempotency-Key', in: 'header', required: true,
            description: 'Si se repite, devuelve el pago original sin cobrar de nuevo.',
            schema: { type: 'string', minLength: 1, maxLength: 64 },
          },
        ],
        requestBody: cuerpo('PagoBody', { monto: '1114.54', fechaPago: F, canal: 'agencia', aprobacion: { aprobado: true, aprobadoPor: 'Elena Morales' } }),
        responses: {
          '201': ok('Pago aplicado por primera vez.', ref('PagoAplicadoRespuesta')),
          '200': ok('Pago ya registrado con esa clave; no se cobra de nuevo.', ref('PagoDuplicadoRespuesta')),
          '400': ERROR_400,
          '404': problema('Crédito inexistente', 'CREDITO_INEXISTENTE', 404, 'No existe el crédito CV-2026-9999'),
          '409': problema('Clave de idempotencia en conflicto', 'CLAVE_EN_CONFLICTO', 409, 'La clave ya se usó con otro contenido'),
          '422': problema('Monto no exacto', 'MONTO_NO_EXACTO', 422, 'El pago debe saldar exactamente la cuota 4: Q301.46 (recibido Q500.00)'),
          '428': problema('Aprobación humana requerida', 'APROBACION_REQUERIDA', 428, 'Registrar un pago exige la aprobación explícita de una persona.'),
        },
      },
    },
    '/api/cartera': {
      get: {
        tags: ['Gerencia'], operationId: 'consultarCartera', summary: 'Tablero: cartera activa, en mora y en riesgo',
        parameters: consulta(C.ConCorte),
        responses: { '200': ok('Cartera consolidada con porcentajes formateados.', ref('CarteraTablero')), '400': ERROR_400 },
      },
    },
    '/api/cartera/mora': {
      get: {
        tags: ['Gerencia'], operationId: 'listarCreditosEnMora', summary: 'Créditos en mora, opcionalmente de un tramo',
        parameters: consulta(C.CarteraMoraQuery),
        responses: { '200': ok('Créditos del tramo.', ref('ListadoMora')), '400': ERROR_400 },
      },
    },
    '/api/vencimientos': {
      get: {
        tags: ['Gerencia'], operationId: 'verProximosVencimientos', summary: 'Cuotas que vencen en los próximos días',
        parameters: consulta(C.VencimientosQuery),
        responses: { '200': ok('Próximos vencimientos.', ref('Vencimientos')), '400': ERROR_400 },
      },
    },
    '/api/cierres/{periodo}': {
      get: {
        tags: ['Gerencia'], operationId: 'consultarCierre', summary: 'Cierre diario (AAAA-MM-DD) o mensual (AAAA-MM)',
        description: 'No ejecuta el cierre: devuelve una PREVIA calculada o el EJECUTADO guardado, sin recalcular sus cifras.',
        parameters: [ruta('periodo', C.PeriodoCierre, 'AAAA-MM o AAAA-MM-DD')],
        responses: { '200': ok('Cierre del periodo.', ref('Cierre')), '400': ERROR_400 },
      },
    },
    '/api/cierres/{periodo}/ejecucion': {
      post: {
        tags: ['Gerencia'], operationId: 'ejecutarCierre', summary: 'Ejecutar y guardar el cierre definitivo del periodo',
        description: 'Solo gerencia. Idempotente por periodo: devuelve el resultado guardado si ya existe, sin recalcular ni generar movimientos. El corte sigue siendo el último día del periodo.',
        parameters: [ruta('periodo', C.PeriodoCierre, 'AAAA-MM o AAAA-MM-DD'), ...OPERADOR],
        responses: { '200': ok('Cierre ejecutado o previamente guardado.', ref('Cierre')), '400': ERROR_400,
          '403': problema('Perfil no autorizado', 'DATOS_INVALIDOS', 403, 'Solo el perfil gerencia puede ejecutar cierres') },
      },
    },
    '/api/chat': {
      post: {
        tags: ['Asistente'], operationId: 'preguntarAsistente', summary: 'Pregunta al asistente gerencial',
        requestBody: cuerpo('PreguntaChatBody', { mensaje: '¿Cuál es la cartera en riesgo?', fechaOperacion: F }),
        responses: { '200': ok('Respuesta con tarjetas de datos del núcleo y citas.', ref('RespuestaChat')), '400': ERROR_400 },
      },
    },
    '/api/chat/{sesionId}': {
      delete: {
        tags: ['Asistente'], operationId: 'olvidarSesion', summary: 'Olvida el historial de una sesión de chat',
        parameters: [ruta('sesionId', z.string(), 'Identificador de la sesión')],
        responses: { '204': { description: 'Sesión olvidada.' } },
      },
    },
    '/api/propuestas/{id}': {
      get: {
        tags: ['Asistente'], operationId: 'consultarPropuesta', summary: 'Consulta una propuesta de pago del chat',
        parameters: [ruta('id', z.string(), 'Identificador de la propuesta')],
        responses: { '200': ok('Propuesta.', ref('Propuesta')), '404': ERROR_404 },
      },
    },
    '/api/propuestas/{id}/aprobacion': {
      post: {
        tags: ['Asistente'], operationId: 'aprobarPropuesta', summary: 'Aprobación humana: registra el pago propuesto',
        parameters: [ruta('id', z.string(), 'Identificador de la propuesta'), OPERADOR[1]!],
        responses: { '201': ok('Pago registrado.', { type: 'object' }), '404': ERROR_404, '409': ERROR_409 },
      },
    },
    '/api/propuestas/{id}/rechazo': {
      post: {
        tags: ['Asistente'], operationId: 'rechazarPropuesta', summary: 'Rechaza una propuesta de pago',
        parameters: [ruta('id', z.string(), 'Identificador de la propuesta'), OPERADOR[1]!],
        responses: { '200': ok('Propuesta rechazada.', ref('Propuesta')), '404': ERROR_404 },
      },
    },
  },
  components: { schemas: componentes() },
};
