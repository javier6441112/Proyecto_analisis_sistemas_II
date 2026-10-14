/**
 * Contrato de la API REST real (`src/api/servidor.ts`, rutas `/api/...`).
 *
 * Fuente única de verdad: el servidor valida las peticiones con estos mismos esquemas,
 * `src/openapi.ts` los publica como OpenAPI 3.1 y `tests/contrato-api.test.ts` comprueba que
 * las respuestas reales cumplen los esquemas de respuesta. La interfaz React importa los tipos.
 *
 * Los esquemas con `id` se publican como componentes reutilizables (`#/components/schemas/<id>`).
 */
import { z } from 'zod';
import { DineroSchema } from './comunes.js';

const CANALES = ['agencia', 'campo', 'transferencia'] as const;

// ---------------------------------------------------------------------------
// Tipos base
// ---------------------------------------------------------------------------

export const Fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato AAAA-MM-DD')
  .meta({ description: 'Fecha calendario AAAA-MM-DD', examples: ['2026-10-31'] });
export const Monto = z.string().regex(/^\d{1,13}(\.\d{1,2})?$/, 'Monto con hasta dos decimales, como texto')
  .meta({ description: 'Monto en quetzales como texto, con hasta dos decimales', examples: ['1004.62'] });
export const Perfil = z.enum(['asesor', 'gerencia']);
export const Canal = z.enum(CANALES).meta({ id: 'Canal', description: 'Canal de recepción del pago' });

export const Dinero = DineroSchema.meta({ id: 'Dinero' });

export const EstadoCredito = z.enum(['VIGENTE', 'EN_MORA', 'REESTRUCTURADO', 'INCOBRABLE', 'CANCELADO'])
  .meta({ id: 'EstadoCredito', description: 'Estado operativo del crédito' });
export const TramoMora = z.enum(['AL_DIA', 'MORA_1', 'MORA_2', 'MORA_3', 'VENCIDO', 'INCOBRABLE'])
  .meta({ id: 'TramoMora', description: 'Clasificación derivada de los días de atraso' });
export const TramoConsultable = z.enum(['MORA_1', 'MORA_2', 'MORA_3', 'VENCIDO', 'INCOBRABLE']);
export const TramoRiesgo = z.enum(['MORA_1', 'MORA_2', 'MORA_3', 'VENCIDO', 'REESTRUCTURADO_AL_DIA'])
  .meta({ id: 'TramoRiesgo', description: 'Tramo que compone la cartera en riesgo' });
export const EstadoSolicitud = z.enum(['SOLICITADA', 'APROBADA', 'RECHAZADA', 'DESEMBOLSADA'])
  .meta({ id: 'EstadoSolicitud' });

/** Proporción exacta serializada como texto (p. ej. "0.1193127471…"). */
const Proporcion = z.string().regex(/^-?\d+(\.\d+)?(e-?\d+)?$/i).meta({ description: 'Proporción decimal exacta, como texto' });

// ---------------------------------------------------------------------------
// Peticiones (las valida `servidor.ts`)
// ---------------------------------------------------------------------------

export const ConCorte = z.object({ fechaCorte: Fecha });
export const BusquedaQuery = z.object({ q: z.string().optional() });
export const CreditosQuery = ConCorte.extend({ q: z.string().optional(), idAsesor: z.string().optional() });
export const CarteraMoraQuery = ConCorte.extend({ tramo: TramoConsultable.optional() });
export const VencimientosQuery = ConCorte.extend({ dias: z.coerce.number().int().min(1).max(366) });
export const PeriodoCierre = z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, 'Periodo AAAA-MM o AAAA-MM-DD');

export const AltaClienteBody = z.object({
  idCliente: z.string().regex(/^CL-\d{4}$/),
  nombreCompleto: z.string().trim().min(3).max(150),
  dpi: z.string().trim().min(5).max(30),
  telefono: z.string().trim().max(20).optional(),
  municipio: z.string().trim().min(2).max(100),
  fechaAlta: Fecha,
}).strict().meta({ id: 'AltaClienteBody', description: 'Alta de un cliente' });

export const SolicitudBody = z.object({
  idSolicitud: z.string().regex(/^SOL-\d{4,8}$/).optional(),
  idCliente: z.string().regex(/^CL-\d{4}$/),
  idAsesor: z.string().regex(/^AS-\d{2}$/),
  capital: Monto,
  plazoMeses: z.number().int().min(3).max(24),
  tnaBps: z.number().int().min(1).max(9999),
  fecha: Fecha,
}).strict().meta({ id: 'SolicitudBody', description: 'Nueva solicitud de crédito (capital Q1,000–Q25,000)' });

export const PlanBody = z.object({
  capital: Monto,
  plazoMeses: z.number().int().min(3).max(24),
  tnaBps: z.number().int().min(1).max(9999),
  fechaDesembolso: Fecha,
}).strict().meta({ id: 'PlanBody', description: 'Parámetros para simular un plan de amortización' });

export const ResolucionBody = z.object({
  decision: z.enum(['APROBADA', 'RECHAZADA']),
  motivo: z.string().trim().min(3).max(300),
  fecha: Fecha,
}).strict().meta({ id: 'ResolucionBody', description: 'Decisión del comité sobre una solicitud' });

export const DesembolsoBody = z.object({
  idCredito: z.string().regex(/^CV-\d{4}-\d{4}$/),
  fecha: Fecha,
}).strict().meta({ id: 'DesembolsoBody', description: 'Desembolso de una solicitud aprobada' });

export const SimulacionPagoBody = z.object({
  idCredito: z.string().min(1),
  fechaPago: Fecha,
  monto: Monto.optional(),
  claveIdempotencia: z.string().min(1).max(64).optional(),
}).strict().meta({ id: 'SimulacionPagoBody', description: 'Sin monto devuelve lo exigible; con monto simula la liquidación' });

export const PagoBody = z.object({
  monto: Monto,
  fechaPago: Fecha,
  canal: Canal,
  aprobacion: z.object({ aprobado: z.boolean(), aprobadoPor: z.string().trim().min(1) }).strict().optional(),
}).strict().meta({ id: 'PagoBody', description: 'Registro de un pago; exige aprobación humana explícita' });

export const PreguntaChatBody = z.object({
  sesionId: z.string().uuid().optional(),
  mensaje: z.string().trim().min(1).max(2000),
  fechaOperacion: Fecha,
}).strict().meta({ id: 'PreguntaChatBody', description: 'Pregunta al asistente gerencial' });

// ---------------------------------------------------------------------------
// Respuestas
// ---------------------------------------------------------------------------

export const Problema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  detail: z.string(),
  codigo: z.string().meta({ description: 'Código de negocio estable (p. ej. MONTO_NO_EXACTO)' }),
  errores: z.array(z.object({ campo: z.string(), mensaje: z.string() }).strict()).optional(),
  montoExigido: z.string().optional(),
  numeroCuota: z.number().int().optional(),
}).catchall(z.unknown()).meta({ id: 'Problema', description: 'Error uniforme RFC 9457 con la extensión `codigo`' });

export const Asesor = z.object({ idAsesor: z.string(), nombreCompleto: z.string() }).strict().meta({ id: 'Asesor' });

export const Politicas = z.object({
  moneda: z.string(),
  base_conteo: z.string(),
  politicas_mora: z.record(z.string(), z.object({
    tipo: z.enum(['plana', 'escalonada']),
    tna_bps: z.number().int().optional(),
    vigencia_otorgamiento: z.object({ desde: z.string().optional(), hasta: z.string().optional() }),
    tramos: z.array(z.object({ id: z.string(), ini: z.number(), fin: z.number(), bps: z.number() })).optional(),
  }).catchall(z.unknown())),
  gasto_gestion_cobro: z.object({ monto_centavos: z.number(), dia_generacion: z.number(), aplica_a_politicas: z.array(z.string()) }).catchall(z.unknown()),
  regla_incobrable_dias: z.number(),
  regla_riesgo_dias: z.number(),
}).catchall(z.unknown()).meta({ id: 'Politicas', description: 'Parámetros de política (politicas.json)' });

export const Cliente = z.object({
  idCliente: z.string(),
  nombreCompleto: z.string(),
  dpi: z.string(),
  telefono: z.string(),
  municipio: z.string(),
  fechaAlta: Fecha,
  origen: z.enum(['CARGA_CANONICA', 'INTERFAZ']),
}).strict().meta({ id: 'Cliente' });

const ProximaCuota = z.object({ numero: z.number().int(), fechaVencimiento: Fecha, monto: Dinero }).strict();

export const CreditoResumen = z.object({
  idCredito: z.string(),
  idCliente: z.string(),
  nombreCliente: z.string(),
  idAsesor: z.string(),
  fechaDesembolso: Fecha,
  capitalOriginal: Dinero,
  saldoCapital: Dinero,
  estado: EstadoCredito,
  diasAtraso: z.number().int(),
  tramo: TramoMora,
  politicaMora: z.string(),
  proximaCuota: ProximaCuota.optional(),
}).strict().meta({ id: 'CreditoResumen' });

export const ListadoCreditos = z.object({ fechaCorte: Fecha, creditos: z.array(CreditoResumen) }).strict()
  .meta({ id: 'ListadoCreditos' });

export const TramoRecorrido = z.object({
  tramo: z.union([TramoMora, z.literal('PLANA')]),
  desdeDia: z.number().int(),
  hastaDia: z.number().int(),
  dias: z.number().int(),
  tasaAnualBps: z.number().int(),
  montoSinRedondear: z.string(),
}).strict().meta({ id: 'TramoRecorrido' });

export const CuotaExigible = z.object({
  numero: z.number().int(),
  fechaVencimiento: Fecha,
  diasAtraso: z.number().int(),
  tramo: TramoMora,
  diasDevengo: z.number().int(),
  tramosRecorridos: z.array(TramoRecorrido),
  capital: Dinero,
  interesCorriente: Dinero,
  interesMoratorio: Dinero,
  gastoGestion: Dinero,
  total: Dinero,
}).strict().meta({ id: 'CuotaExigible', description: 'Cuota vencida con su desglose exigible' });

export const Adeudo = z.object({
  gastos: Dinero,
  interesMoratorio: Dinero,
  interesCorriente: Dinero,
  capital: Dinero,
}).strict().meta({ id: 'Adeudo', description: 'Desglose en orden de prelación' });

export const PagoAplicado = z.object({
  claveIdempotencia: z.string(),
  fecha: Fecha,
  monto: Dinero,
  canal: z.string(),
  origen: z.enum(['CARGA_CANONICA', 'INTERFAZ']),
  tipo: z.enum(['APLICACION', 'RECUPERACION']),
  numeroCuota: z.number().int().optional(),
  diasAtrasoAlPago: z.number().int().optional(),
  aplicado: Adeudo.optional(),
  saldoCapitalDespues: Dinero.optional(),
}).strict().meta({ id: 'PagoAplicado' });

export const DetalleCredito = z.object({
  idCredito: z.string(),
  idCliente: z.string(),
  nombreCliente: z.string(),
  idAsesor: z.string(),
  fechaDesembolso: Fecha,
  fechaCorte: Fecha,
  politicaMora: z.string(),
  tnaBps: z.number().int(),
  plazoMeses: z.number().int(),
  reestructurado: z.boolean(),
  capitalOriginal: Dinero,
  saldoCapital: Dinero,
  estado: EstadoCredito,
  enMora: z.boolean(),
  diasAtraso: z.number().int(),
  tramo: TramoMora,
  cuotasTotales: z.number().int(),
  cuotasPagadas: z.number().int(),
  cuotasVencidas: z.array(CuotaExigible),
  cuotasPendientes: z.array(z.object({
    numero: z.number().int(), fechaVencimiento: Fecha, capital: Dinero, interes: Dinero, monto: Dinero,
  }).strict()),
  totalVencidoExigible: Dinero,
  proximaCuota: ProximaCuota.optional(),
  fechaIncobrable: Fecha.optional(),
  pagos: z.array(PagoAplicado),
}).strict().meta({ id: 'DetalleCredito' });

const CuotaPlan = z.object({
  numero: z.number().int(),
  fechaVencimiento: Fecha,
  saldoInicial: Dinero,
  pago: Dinero,
  interes: Dinero,
  amortizacion: Dinero,
  saldoFinal: Dinero,
}).strict();

const CamposPlan = {
  capital: Dinero,
  plazoMeses: z.number().int(),
  tnaBps: z.number().int(),
  tasaMensual: Proporcion,
  tasaEfectivaAnual: Proporcion,
  fechaDesembolso: Fecha,
  politicaMora: z.string(),
  totalIntereses: Dinero,
  totalPagado: Dinero,
};

export const PlanSimulado = z.object({ ...CamposPlan, cuotas: z.array(CuotaPlan) }).strict()
  .meta({ id: 'PlanSimulado', description: 'Plan de amortización con sistema francés' });

export const PlanCredito = z.object({
  idCredito: z.string(),
  fechaCorte: Fecha,
  estadoCredito: EstadoCredito,
  ...CamposPlan,
  cuotas: z.array(CuotaPlan.extend({
    estado: z.enum(['PAGADA', 'VENCIDA', 'PENDIENTE']),
    fechaPago: Fecha.optional(),
  })),
}).strict().meta({ id: 'PlanCredito', description: 'Plan del crédito con el estado de cada cuota a la fecha de corte' });

export const ExplicacionMora = z.object({
  idCredito: z.string(),
  fechaCorte: Fecha,
  politicaMora: z.string(),
  cuota: CuotaExigible,
  totalSinRedondear: z.string(),
}).strict().meta({ id: 'ExplicacionMora', description: 'Desglose del interés moratorio por tramo recorrido' });

const ResumenCartera = z.object({
  carteraActiva: Dinero,
  saldoEnRiesgo: Dinero,
  porcentajeRiesgo: Proporcion,
  incobrable: Dinero,
  riesgoPorTramo: z.array(z.object({ tramo: TramoRiesgo, saldo: Dinero, porcentajeCarteraActiva: Proporcion }).strict()),
}).strict();

const CamposCartera = {
  fechaCorte: Fecha,
  resumen: ResumenCartera,
  carteraEnMora: Dinero,
  porcentajeMora: Proporcion,
  porTramo: z.array(z.object({ tramo: TramoMora, saldo: Dinero, creditos: z.number().int() }).strict()),
  reestructuradosAlDia: z.object({ creditos: z.number().int(), saldo: Dinero }).strict(),
  conteos: z.object({
    desembolsados: z.number().int(),
    activos: z.number().int(),
    enMora: z.number().int(),
    enRiesgo: z.number().int(),
    cancelados: z.number().int(),
    incobrables: z.number().int(),
  }).strict(),
  incobrablesDelMes: z.array(z.object({
    idCredito: z.string(), nombreCliente: z.string(), fechaIncobrable: Fecha, saldoCapital: Dinero,
  }).strict()),
  incobrableDelMes: Dinero,
};

export const CarteraConsolidada = z.object(CamposCartera).strict()
  .meta({ id: 'CarteraConsolidada', description: 'Cartera activa, en mora y en riesgo a una fecha de corte' });

export const CarteraTablero = z.object({
  ...CamposCartera,
  porcentajes: z.object({
    mora: z.string(),
    riesgo: z.string(),
    riesgoPorTramo: z.record(z.string(), z.string()),
  }).strict().meta({ description: 'Porcentajes ya formateados por el servidor (p. ej. "11.93 %")' }),
}).strict().meta({ id: 'CarteraTablero', description: 'Cartera consolidada con porcentajes listos para mostrar' });

export const ListadoMora = z.object({
  fechaCorte: Fecha,
  tramo: z.union([TramoMora, z.literal('TODOS')]),
  creditos: z.array(z.object({
    idCredito: z.string(),
    idCliente: z.string(),
    nombreCliente: z.string(),
    idAsesor: z.string(),
    estado: EstadoCredito,
    diasAtraso: z.number().int(),
    tramo: TramoMora,
    cuotasVencidas: z.number().int(),
    saldoCapital: Dinero,
    totalVencidoExigible: Dinero,
  }).strict()),
  totalCreditos: z.number().int(),
  saldoCapitalTotal: Dinero,
}).strict().meta({ id: 'ListadoMora' });

export const Vencimientos = z.object({
  fechaCorte: Fecha,
  dias: z.number().int(),
  desde: Fecha,
  hasta: Fecha,
  cuotas: z.array(z.object({
    idCredito: z.string(), nombreCliente: z.string(), numeroCuota: z.number().int(), fechaVencimiento: Fecha, monto: Dinero,
  }).strict()),
  totalCuotas: z.number().int(),
  montoTotal: Dinero,
}).strict().meta({ id: 'Vencimientos' });

const Recuperaciones = z.object({
  pagos: z.number().int(),
  gastos: Dinero,
  interesMoratorio: Dinero,
  interesCorriente: Dinero,
  capital: Dinero,
  total: Dinero,
}).strict();

export const Cierre = z.object({
  tipo: z.enum(['DIARIO', 'MENSUAL']),
  periodo: z.string(),
  desde: Fecha,
  hasta: Fecha,
  desembolsos: z.object({
    cantidad: z.number().int(),
    monto: Dinero,
    creditos: z.array(z.object({ idCredito: z.string(), nombreCliente: z.string(), fecha: Fecha, capital: Dinero }).strict()),
  }).strict(),
  recuperaciones: Recuperaciones,
  recuperacionesIncobrables: z.object({ pagos: z.number().int(), monto: Dinero }).strict(),
  incobrablesDelPeriodo: z.object({
    creditos: z.array(z.object({ idCredito: z.string(), fechaIncobrable: Fecha, saldoCapital: Dinero }).strict()),
    monto: Dinero,
  }).strict(),
  cartera: CarteraConsolidada,
}).strict().meta({ id: 'Cierre', description: 'Cierre diario o mensual; consultarlo de nuevo devuelve las mismas cifras' });

export const Solicitud = z.object({
  idSolicitud: z.string(),
  idCliente: z.string(),
  nombreCliente: z.string(),
  idAsesor: z.string(),
  capital: Dinero,
  plazoMeses: z.number().int(),
  tnaBps: z.number().int(),
  fecha: Fecha,
  estado: EstadoSolicitud,
  resolucion: z.object({
    decision: z.enum(['APROBADA', 'RECHAZADA']), motivo: z.string(), fecha: Fecha, usuario: z.string(),
  }).strict().optional(),
  idCredito: z.string().optional(),
}).strict().meta({ id: 'Solicitud' });

export const SolicitudCreada = z.object({ solicitud: Solicitud, plan: PlanSimulado }).strict()
  .meta({ id: 'SolicitudCreada' });

const AplicacionPago = z.object({ aplicado: Adeudo, remanente: Dinero, cuotaSaldada: z.boolean() }).strict();

const MotivoRechazo = z.enum(['CREDITO_INCOBRABLE', 'CREDITO_CANCELADO', 'MONTO_NO_EXACTO', 'MONTO_INVALIDO', 'CLAVE_EN_CONFLICTO', 'FECHA_ANTERIOR_A_ULTIMO_PAGO']);

export const SimulacionPago = z.union([
  z.object({
    credito: DetalleCredito,
    permitePago: z.boolean(),
    motivo: MotivoRechazo.optional(),
    mensaje: z.string().optional(),
    cuota: CuotaExigible.optional(),
  }).strict()
    .meta({ description: 'Lo exigible (petición sin monto)' }),
  z.object({
    resultado: z.literal('ACEPTABLE'),
    idCredito: z.string(),
    fechaPago: Fecha,
    cuota: CuotaExigible,
    aplicacion: AplicacionPago,
    saldoCapitalResultante: Dinero,
  }).strict(),
  z.object({ resultado: z.literal('DUPLICADO'), idCredito: z.string(), claveIdempotencia: z.string(), pagoOriginal: PagoAplicado }).strict(),
  z.object({
    resultado: z.literal('RECHAZADO'),
    idCredito: z.string(),
    motivo: MotivoRechazo,
    mensaje: z.string(),
    montoExigido: Dinero.optional(),
    cuota: CuotaExigible.optional(),
  }).strict(),
]).meta({ id: 'SimulacionPago' });

export const PagoAplicadoRespuesta = z.object({
  resultado: z.literal('APLICADO'),
  claveIdempotencia: z.string(),
  cuota: CuotaExigible,
  aplicacion: AplicacionPago,
  credito: DetalleCredito,
}).strict().meta({ id: 'PagoAplicadoRespuesta', description: 'Pago aplicado por primera vez (201)' });

export const PagoDuplicadoRespuesta = z.object({
  resultado: z.literal('DUPLICADO'),
  claveIdempotencia: z.string(),
  pagoOriginal: PagoAplicado,
  credito: DetalleCredito,
}).strict().meta({ id: 'PagoDuplicadoRespuesta', description: 'Misma Idempotency-Key: devuelve el pago original sin cobrar de nuevo (200)' });

/** Salida estructurada de proponer_pago (distinta de la propuesta interna REST). */
export const PropuestaPagoChat = z.object({
  propuestaId: z.string().min(1),
  estado: z.literal('PENDIENTE_DE_APROBACION_HUMANA'),
  idCredito: z.string(),
  fechaPago: Fecha,
  cuota: z.object({
    numero: z.number(), fechaVencimiento: Fecha, diasAtraso: z.number(), tramo: z.string(),
    gastos: Monto, interesMoratorio: Monto, interesCorriente: Monto, capital: Monto, totalExigible: Monto,
  }),
  aplicacion: z.object({ gastos: Monto, interesMoratorio: Monto, interesCorriente: Monto, capital: Monto }),
  saldoCapitalResultante: Monto,
  instruccionParaElUsuario: z.string(),
  moneda: z.literal('GTQ'),
});
export type TPropuestaPagoChat = z.infer<typeof PropuestaPagoChat>;

export const RespuestaChat = z.object({
  sesionId: z.string(),
  respuesta: z.string(),
  tarjetas: z.array(z.object({
    herramienta: z.string(),
    argumentos: z.record(z.string(), z.unknown()),
    datos: z.record(z.string(), z.unknown()),
    error: z.boolean(),
  })),
  propuestas: z.array(PropuestaPagoChat),
  citas: z.array(z.object({ docId: z.string(), titulo: z.string(), vigencia: z.string() })),
  alertasSeguridad: z.array(z.string()),
  control: z.record(z.string(), z.unknown()),
}).meta({ id: 'RespuestaChat', description: 'Respuesta del asistente gerencial con tarjetas de datos y citas' });

export const Propuesta = z.object({
  id: z.string(),
  idCredito: z.string(),
  monto: Dinero,
  fechaPago: Fecha,
  canal: Canal,
  cuota: CuotaExigible,
  aplicacion: AplicacionPago,
  saldoCapitalResultante: Dinero,
  estado: z.enum(['PENDIENTE', 'APROBADA', 'RECHAZADA', 'EJECUTADA']),
  aprobadoPor: z.string().optional(),
}).strict().meta({ id: 'Propuesta', description: 'Propuesta de pago del chat pendiente de aprobación humana' });

// ---------------------------------------------------------------------------
// Tipos inferidos (los consume la interfaz React)
// ---------------------------------------------------------------------------

export type TDinero = z.infer<typeof Dinero>;
export type TTramoMora = z.infer<typeof TramoMora>;
export type TEstadoCredito = z.infer<typeof EstadoCredito>;
export type TCanal = z.infer<typeof Canal>;
export type TProblema = z.infer<typeof Problema>;
export type TAsesor = z.infer<typeof Asesor>;
export type TCliente = z.infer<typeof Cliente>;
export type TCreditoResumen = z.infer<typeof CreditoResumen>;
export type TListadoCreditos = z.infer<typeof ListadoCreditos>;
export type TCuotaExigible = z.infer<typeof CuotaExigible>;
export type TDetalleCredito = z.infer<typeof DetalleCredito>;
export type TPlanSimulado = z.infer<typeof PlanSimulado>;
export type TPlanCredito = z.infer<typeof PlanCredito>;
export type TExplicacionMora = z.infer<typeof ExplicacionMora>;
export type TCarteraTablero = z.infer<typeof CarteraTablero>;
export type TListadoMora = z.infer<typeof ListadoMora>;
export type TVencimientos = z.infer<typeof Vencimientos>;
export type TCierre = z.infer<typeof Cierre>;
export type TSolicitud = z.infer<typeof Solicitud>;
export type TSolicitudCreada = z.infer<typeof SolicitudCreada>;
export type TSimulacionPago = z.infer<typeof SimulacionPago>;
export type TPagoAplicadoRespuesta = z.infer<typeof PagoAplicadoRespuesta>;
export type TPagoDuplicadoRespuesta = z.infer<typeof PagoDuplicadoRespuesta>;
export type TRespuestaChat = z.infer<typeof RespuestaChat>;
export type TPropuesta = z.infer<typeof Propuesta>;
export type TAltaClienteBody = z.input<typeof AltaClienteBody>;
export type TSolicitudBody = z.input<typeof SolicitudBody>;
export type TPlanBody = z.input<typeof PlanBody>;
export type TResolucionBody = z.input<typeof ResolucionBody>;
export type TDesembolsoBody = z.input<typeof DesembolsoBody>;
export type TPagoBody = z.input<typeof PagoBody>;
