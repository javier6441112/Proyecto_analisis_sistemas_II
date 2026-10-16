/**
 * Adaptador PGlite → núcleo financiero.
 *
 * Responsabilidad: leer los hechos persistidos (carga canónica + bitácora de operaciones)
 * y entregárselos a las funciones puras de `src/dominio/`. Este archivo NO contiene
 * fórmulas financieras: cuotas, moratorio, desglose por tramo, gasto de gestión,
 * prelación y cartera salen del núcleo (`generarPlanFrances`, `PoliticaMora.calcular`,
 * `PoliticaMora.desglosar`, `gastoGestionCobro`, `aplicarPago`, `resumirCartera`,
 * `resumirCarteraPorTramo`). Aquí solo se filtra, ordena, agrupa y suma lo que el núcleo
 * ya calculó.
 *
 * Reglas de diseño:
 *  - Toda consulta recibe la fecha de corte (AAAA-MM-DD). No se usa `new Date()` ni el
 *    reloj del sistema (puerto Reloj del P1): el resultado depende de la base y la fecha.
 *  - La cartera se reconstruye reproduciendo los pagos en orden cronológico. La
 *    idempotencia se aplica aquí: la primera aparición de cada clave se consume y las
 *    repeticiones se ignoran (226 únicos de 228 registros del paquete canónico).
 *  - Los parámetros de política son datos (`parametros_politicas`). Al abrir se
 *    validan y construyen las estrategias del núcleo con las tasas y vigencias publicadas.
 *  - La carga canónica no se modifica nunca. Lo que entra por la interfaz se guarda en
 *    `bitacora_operaciones` (ver `bitacora-operaciones.ts`) y se fusiona al leer.
 */
import { addDays, addMonths, endOfMonth, format, isValid, parseISO } from 'date-fns';
import { Decimal } from 'decimal.js';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { abrirBaseDatos } from './base-datos.js';
import { asegurarCierres, leerCierre } from './cierres-persistidos.js';
import { asegurarMovimientosProvisiones, abrirDesdeHistorico, guardarCierreConMovimientos,
  consultarRegistroProvisiones, type ContabilizacionProvisiones } from './movimientos-provisiones.js';
import { cargarPoliticaProvisiones } from '../configuracion/provisiones.js';
import { cargarPoliticasDevengo, politicaDevengoPara } from '../configuracion/devengo.js';
import type { CreditoDevengo } from '../dominio/devengo.js';
import { prepararDevengo, asegurarDevengo, type ResultadoDevengoCierre } from './devengo-persistido.js';
import { calcularProvisiones, type PoliticaProvisiones } from '../dominio/provisiones.js';

import { Dinero } from '../dominio/dinero.js';
import { calcularDiasAtraso } from '../dominio/calculadora-mora.js';
import { calcularTasaEfectivaAnual, generarPlanFrances, type Cuota } from '../dominio/plan-amortizacion.js';
import { aplicarPago, type Adeudo, type AplicacionPago } from '../dominio/prelacion-pago.js';
import {
  resumirCartera,
  resumirCarteraPorTramo,
  type CreditoCartera,
  type EstadoCredito,
  type ResumenCartera,
  type ResumenCarteraPorTramo,
} from '../dominio/cartera.js';
import { crearCatalogoMora, seleccionarPoliticaMora } from '../dominio/politica-mora/catalogo-politicas.js';
import { clasificarTramo } from '../dominio/politica-mora/clasificacion-tramo.js';
import { gastoGestionCobro } from '../dominio/politica-mora/gasto-gestion-cobro.js';
import { PoliticaEscalonada } from '../dominio/politica-mora/politica-escalonada.js';
import type { PoliticaMora, TramoMora } from '../dominio/politica-mora/politica-mora.js';
import {
  asegurarBitacora,
  leerBitacora,
  type EventoBitacora,
} from './bitacora-operaciones.js';

// ---------------------------------------------------------------------------
// Errores con convención uniforme (E3: crédito inexistente, cuota ya pagada,
// crédito incobrable, monto no exacto, fecha inválida…)
// ---------------------------------------------------------------------------

export type CodigoError =
  | 'FECHA_INVALIDA'
  | 'CREDITO_INEXISTENTE'
  | 'CREDITO_NO_DESEMBOLSADO_A_LA_FECHA'
  | 'CUOTA_INEXISTENTE'
  | 'CUOTA_YA_PAGADA'
  | 'CUOTA_NO_VENCIDA'
  | 'CREDITO_INCOBRABLE'
  | 'CREDITO_CANCELADO'
  | 'MONTO_NO_EXACTO'
  | 'MONTO_INVALIDO'
  | 'CLAVE_EN_CONFLICTO'
  | 'FECHA_ANTERIOR_A_ULTIMO_PAGO'
  | 'APROBACION_REQUERIDA'
  | 'DATOS_INVALIDOS'
  | 'ENTIDAD_DUPLICADA'
  | 'ENTIDAD_INEXISTENTE'
  | 'TRANSICION_INVALIDA';

export class ErrorNegocio extends Error {
  constructor(readonly codigo: CodigoError, mensaje: string, readonly detalle?: Record<string, unknown>) {
    super(mensaje);
    this.name = 'ErrorNegocio';
  }
}

export class ErrorIntegridadCartera extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorIntegridadCartera';
  }
}

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

/** Lo mínimo que el adaptador necesita de una conexión (PGlite o un doble de prueba). */
export interface ConexionSql {
  transaction?<T>(fn: (tx: Pick<ConexionSql, 'query'>) => Promise<T>): Promise<T>;
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec?(sql: string): Promise<unknown>;
  close(): Promise<void>;
}

/** Forma de `politicas.json` tal como la publica el paquete canónico. */
export interface ParametrosPoliticas {
  version?: string;
  moneda: string;
  base_conteo: string;
  politicas_mora: Record<string, {
    nombre?: string; version?: string; autor?: string; motivo?: string;
    tipo: 'plana' | 'escalonada';
    tna_bps?: number;
    vigencia_otorgamiento: { desde?: string; hasta?: string };
    tramos?: Array<{ id: string; ini: number; fin: number; bps: number }>;
  }>;
  gasto_gestion_cobro: { monto_centavos: number; dia_generacion: number; aplica_a_politicas: string[] };
  regla_incobrable_dias: number;
  regla_riesgo_dias: number;
}

export interface TramoRecorrido {
  tramo: TramoMora | 'PLANA';
  desdeDia: number;
  hastaDia: number;
  dias: number;
  tasaAnualBps: number;
  /** capital × tasa diaria × días, sin redondear (lo entrega `PoliticaMora.desglosar`). */
  montoSinRedondear: string;
}

export interface CuotaExigible {
  numero: number;
  fechaVencimiento: string;
  diasAtraso: number;
  tramo: TramoMora;
  /** Días que devengan moratorio (tope en la regla de incobrable). */
  diasDevengo: number;
  tramosRecorridos: TramoRecorrido[];
  capital: Dinero;
  interesCorriente: Dinero;
  interesMoratorio: Dinero;
  gastoGestion: Dinero;
  total: Dinero;
}

export interface CuotaProgramadaPendiente {
  numero: number;
  fechaVencimiento: string;
  capital: Dinero;
  interes: Dinero;
  monto: Dinero;
}

export interface PagoAplicado {
  claveIdempotencia: string;
  fecha: string;
  monto: Dinero;
  canal: string;
  origen: 'CARGA_CANONICA' | 'INTERFAZ';
  tipo: 'APLICACION' | 'RECUPERACION';
  numeroCuota?: number;
  diasAtrasoAlPago?: number;
  aplicado?: Adeudo;
  saldoCapitalDespues?: Dinero;
}

export interface DetalleCredito {
  idCredito: string;
  idCliente: string;
  nombreCliente: string;
  idAsesor: string;
  fechaDesembolso: string;
  fechaCorte: string;
  politicaMora: string;
  tnaBps: number;
  plazoMeses: number;
  reestructurado: boolean;
  capitalOriginal: Dinero;
  saldoCapital: Dinero;
  estado: EstadoCredito;
  enMora: boolean;
  diasAtraso: number;
  tramo: TramoMora;
  cuotasTotales: number;
  cuotasPagadas: number;
  cuotasVencidas: CuotaExigible[];
  cuotasPendientes: CuotaProgramadaPendiente[];
  totalVencidoExigible: Dinero;
  proximaCuota?: { numero: number; fechaVencimiento: string; monto: Dinero };
  /** Fecha en que el crédito cruzó la regla de incobrable (día 121), si ocurrió. */
  fechaIncobrable?: string;
  pagos: PagoAplicado[];
}

export interface CarteraConsolidada {
  fechaCorte: string;
  resumen: ResumenCartera;
  carteraEnMora: Dinero;
  porcentajeMora: Decimal;
  porTramo: ResumenCarteraPorTramo['porTramo'];
  reestructuradosAlDia: { creditos: number; saldo: Dinero };
  conteos: { desembolsados: number; activos: number; enMora: number; enRiesgo: number; cancelados: number; incobrables: number };
  /** Créditos que cruzaron a incobrable dentro del mes de la fecha de corte. */
  incobrablesDelMes: Array<{ idCredito: string; nombreCliente: string; fechaIncobrable: string; saldoCapital: Dinero }>;
  incobrableDelMes: Dinero;
}

export interface CreditoEnMora {
  idCredito: string;
  idCliente: string;
  nombreCliente: string;
  idAsesor: string;
  estado: EstadoCredito;
  diasAtraso: number;
  tramo: TramoMora;
  cuotasVencidas: number;
  saldoCapital: Dinero;
  totalVencidoExigible: Dinero;
}

export interface ListadoMora {
  fechaCorte: string;
  tramo: TramoMora | 'TODOS';
  creditos: CreditoEnMora[];
  totalCreditos: number;
  saldoCapitalTotal: Dinero;
}

export interface Vencimientos {
  fechaCorte: string;
  dias: number;
  desde: string;
  hasta: string;
  cuotas: Array<{ idCredito: string; nombreCliente: string; numeroCuota: number; fechaVencimiento: string; monto: Dinero }>;
  totalCuotas: number;
  montoTotal: Dinero;
}

export interface RecuperacionesPorConcepto {
  pagos: number;
  gastos: Dinero;
  interesMoratorio: Dinero;
  interesCorriente: Dinero;
  capital: Dinero;
  total: Dinero;
}

export interface Cierre {
  devengo?: ResultadoDevengoCierre;
  contabilizacionProvisiones?: ContabilizacionProvisiones;
  provisiones?: ProvisionesCierre;
  estado: 'PREVIA' | 'EJECUTADO';
  fechaCorte: string;
  ejecutadoPor?: string;
  politicasUtilizadas: {
    versionParametros?: string;
    huellaParametros: string;
    parametros: ParametrosPoliticas;
    mora: Array<{ id: string; vigenteDesde: string; huellaDefinicion: string }>;
  };
  tipo: 'DIARIO' | 'MENSUAL';
  periodo: string;
  desde: string;
  hasta: string;
  desembolsos: { cantidad: number; monto: Dinero; creditos: Array<{ idCredito: string; nombreCliente: string; fecha: string; capital: Dinero }> };
  recuperaciones: RecuperacionesPorConcepto;
  recuperacionesIncobrables: { pagos: number; monto: Dinero };
  incobrablesDelPeriodo: { creditos: Array<{ idCredito: string; fechaIncobrable: string; saldoCapital: Dinero }>; monto: Dinero };
  cartera: CarteraConsolidada;
}

export type ProvisionesCierre = {
  estado: 'DISPONIBLE';
  parametros: PoliticaProvisiones;
} & ReturnType<typeof calcularProvisiones> | {
  estado: 'NO_DISPONIBLE';
  motivo: string;
};

export interface ExplicacionMora {
  idCredito: string;
  fechaCorte: string;
  politicaMora: string;
  cuota: CuotaExigible;
  /** Total del desglose antes del único redondeo final. */
  totalSinRedondear: string;
}

export interface PlanSimulado {
  capital: Dinero;
  plazoMeses: number;
  tnaBps: number;
  tasaMensual: string;
  tasaEfectivaAnual: string;
  fechaDesembolso: string;
  politicaMora: string;
  cuotas: Array<{ numero: number; fechaVencimiento: string; saldoInicial: Dinero; pago: Dinero; interes: Dinero; amortizacion: Dinero; saldoFinal: Dinero }>;
  totalIntereses: Dinero;
  totalPagado: Dinero;
}

export interface SolicitudPago {
  idCredito: string;
  monto: Dinero | string;
  fechaPago: string;
  claveIdempotencia?: string;
}

export type MotivoRechazo =
  | 'CREDITO_INCOBRABLE'
  | 'CREDITO_CANCELADO'
  | 'MONTO_NO_EXACTO'
  | 'MONTO_INVALIDO'
  | 'CLAVE_EN_CONFLICTO'
  | 'FECHA_ANTERIOR_A_ULTIMO_PAGO';

export type ResultadoSimulacionPago =
  | {
      resultado: 'ACEPTABLE';
      idCredito: string;
      fechaPago: string;
      cuota: CuotaExigible;
      aplicacion: AplicacionPago;
      saldoCapitalResultante: Dinero;
    }
  | { resultado: 'DUPLICADO'; idCredito: string; claveIdempotencia: string; pagoOriginal: PagoAplicado }
  | {
      resultado: 'RECHAZADO';
      idCredito: string;
      motivo: MotivoRechazo;
      mensaje: string;
      montoExigido?: Dinero;
      cuota?: CuotaExigible;
    };

export interface ClienteRegistro {
  idCliente: string;
  nombreCompleto: string;
  dpi: string;
  telefono: string;
  municipio: string;
  fechaAlta: string;
  origen: 'CARGA_CANONICA' | 'INTERFAZ';
}

export interface AsesorRegistro {
  idAsesor: string;
  nombreCompleto: string;
}

// ---------------------------------------------------------------------------
// Utilidades de borde (formato, no cálculo financiero)
// ---------------------------------------------------------------------------

const FORMATO_FECHA = 'yyyy-MM-dd';

export function validarFecha(fecha: string, campo = 'fechaCorte'): string {
  if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new ErrorNegocio('FECHA_INVALIDA', `${campo} debe tener formato AAAA-MM-DD: ${String(fecha)}`, { campo });
  }
  const fechaParseada = parseISO(fecha);
  if (!isValid(fechaParseada) || format(fechaParseada, FORMATO_FECHA) !== fecha) {
    throw new ErrorNegocio('FECHA_INVALIDA', `${campo} no es una fecha de calendario válida: ${fecha}`, { campo });
  }
  return fecha;
}

export function centavosADinero(valor: unknown): Dinero {
  const texto = typeof valor === 'bigint' ? valor.toString() : String(valor);
  const centavos = new Decimal(texto);
  if (!centavos.isInteger()) throw new ErrorIntegridadCartera(`Importe en centavos no entero: ${texto}`);
  return Dinero.de(centavos.div(100));
}

export function dineroACentavos(d: Dinero): string {
  return d.valor.times(100).toFixed(0);
}

function aDinero(valor: Dinero | string): Dinero {
  if (valor instanceof Dinero) return valor;
  if (!/^-?\d+(\.\d{1,2})?$/.test(String(valor).trim())) {
    throw new ErrorNegocio('MONTO_INVALIDO', `Monto inválido: ${String(valor)}. Use un decimal con hasta dos decimales.`);
  }
  return Dinero.de(String(valor).trim());
}

function aBooleano(valor: unknown): boolean {
  return valor === true || valor === 't' || valor === 'true' || valor === 1;
}

function vencimiento(fechaDesembolso: string, numeroCuota: number): string {
  return format(addMonths(parseISO(fechaDesembolso), numeroCuota), FORMATO_FECHA);
}

function iguales(a: Dinero, b: Dinero): boolean {
  return a.valor.equals(b.valor) && a.moneda === b.moneda;
}

function sumar(valores: Dinero[]): Dinero {
  return valores.reduce((t, v) => t.sumar(v), Dinero.cero());
}

function tasaMensualDe(tnaBps: number): Decimal {
  return new Decimal(tnaBps).div(10000).div(12);
}

// ---------------------------------------------------------------------------
// Políticas: estrategias del núcleo construidas con los parámetros cargados
// ---------------------------------------------------------------------------


/** Configuración cargada: construye estrategias y selecciona por fecha explícita. */
export class ContextoPoliticas {
  readonly parametros: ParametrosPoliticas;
  private readonly catalogo: PoliticaMora[];

  constructor(parametros: ParametrosPoliticas) {
    this.parametros = structuredClone(parametros);
    try {
      if (parametros.base_conteo !== 'Actual/360' || parametros.moneda !== 'GTQ') throw new Error('Base de conteo o moneda no soportada');
      if (parametros.regla_incobrable_dias !== 120) throw new Error('La regla incobrable debe conservar el límite de 120 días');
      if (!Number.isSafeInteger(parametros.regla_riesgo_dias) || parametros.regla_riesgo_dias < 0 || parametros.regla_riesgo_dias > 120) throw new Error('Regla de riesgo inválida');
      this.catalogo = crearCatalogoMora(this.parametros.politicas_mora);
      const g = parametros.gasto_gestion_cobro;
      if (!g || !Number.isSafeInteger(g.monto_centavos) || g.monto_centavos < 0 || !Number.isSafeInteger(g.dia_generacion) || g.dia_generacion < 1 || g.dia_generacion > 120 || !Array.isArray(g.aplica_a_politicas) || g.aplica_a_politicas.some(id => !parametros.politicas_mora[id])) throw new Error('Parámetros de gasto de gestión inválidos');
    } catch (error) {
      throw new ErrorIntegridadCartera('Configuración de políticas inválida: ' + (error as Error).message);
    }
  }

  get diasIncobrable(): number { return this.parametros.regla_incobrable_dias; }

  politicaParaOtorgamiento(fecha: string): PoliticaMora {
    try { return seleccionarPoliticaMora(fecha, this.catalogo, this.parametros.politicas_mora); }
    catch (error) { throw new ErrorIntegridadCartera((error as Error).message); }
  }

  /** Desglose por tramo recorrido: `PoliticaMora.desglosar` del núcleo (CP-04.3). */
  desglosar(politica: PoliticaMora, capital: Dinero, diasAtraso: number): {
    tramos: TramoRecorrido[]; totalSinRedondear: Decimal; total: Dinero; diasEfectivos: number;
  } {
    const desglose = politica.desglosar(capital, diasAtraso);
    const configuracion = politica instanceof PoliticaEscalonada ? politica.tramos : [];
    const tramos = desglose.tramos.map((t) => {
      const desde = configuracion.find((c) => c.nombre === t.tramo)?.desde ?? 1;
      return {
        tramo: t.tramo as TramoRecorrido['tramo'],
        desdeDia: desde,
        hastaDia: desde + t.dias - 1,
        dias: t.dias,
        tasaAnualBps: t.tasaNominalAnual.times(10000).toNumber(),
        montoSinRedondear: t.importeSinRedondear.toString(),
      };
    });
    return { tramos, totalSinRedondear: desglose.totalSinRedondear, total: desglose.totalMoratorio, diasEfectivos: desglose.diasEfectivos };
  }

}

// ---------------------------------------------------------------------------
// Reconstrucción pura de un crédito (sin E/S)
// ---------------------------------------------------------------------------

export interface CreditoFuente {
  idCredito: string;
  idCliente: string;
  idAsesor: string;
  fechaDesembolso: string;
  capitalCentavos: string;
  plazoMeses: number;
  tnaBps: number;
  reestructurado: boolean;
}

export interface PagoFuente {
  claveIdempotencia: string;
  idCredito: string;
  fecha: string;
  montoCentavos: string;
  canal: string;
  orden: number;
  origen: 'CARGA_CANONICA' | 'INTERFAZ';
}

interface CuotaProgramada {
  cuota: Cuota;
  fechaVencimiento: string;
}

function exigibleDeCuota(
  programada: CuotaProgramada,
  fecha: string,
  politica: PoliticaMora,
  contexto: ContextoPoliticas,
): CuotaExigible & { totalSinRedondear: Decimal } {
  const { cuota, fechaVencimiento } = programada;
  const diasAtraso = calcularDiasAtraso(fechaVencimiento, fecha);
  // El núcleo devenga hasta el día 120 (regla de incobrable) y redondea una sola vez.
  const { tramos, totalSinRedondear, total: interesMoratorio, diasEfectivos } = contexto.desglosar(politica, cuota.amortizacion, diasAtraso);
  const diasDevengo = diasEfectivos;
  // Gasto de gestión: el núcleo usa el monto, día y políticas configurados. Se
  // cobra una vez por cuota (una cuota se salda completa con un solo pago).
  const gastoGestion = gastoGestionCobro(cuota.amortizacion, diasAtraso, politica.id, contexto.parametros.gasto_gestion_cobro);
  return {
    numero: cuota.numero,
    fechaVencimiento,
    diasAtraso,
    tramo: clasificarTramo(diasAtraso),
    diasDevengo,
    tramosRecorridos: tramos,
    capital: cuota.amortizacion,
    interesCorriente: cuota.interes,
    interesMoratorio,
    gastoGestion,
    total: gastoGestion.sumar(interesMoratorio).sumar(cuota.interes).sumar(cuota.amortizacion),
    totalSinRedondear,
  };
}

function sinTotalCrudo(c: CuotaExigible & { totalSinRedondear?: Decimal }): CuotaExigible {
  const { totalSinRedondear: _ignorado, ...resto } = c;
  void _ignorado;
  return resto;
}

function adeudoDe(c: CuotaExigible): Adeudo {
  return { gastos: c.gastoGestion, interesMoratorio: c.interesMoratorio, interesCorriente: c.interesCorriente, capital: c.capital };
}

function planDe(fuente: CreditoFuente): CuotaProgramada[] {
  const plan = generarPlanFrances(centavosADinero(fuente.capitalCentavos), tasaMensualDe(fuente.tnaBps), fuente.plazoMeses);
  return plan.cuotas.map((cuota) => ({ cuota, fechaVencimiento: vencimiento(fuente.fechaDesembolso, cuota.numero) }));
}

/**
 * Reproduce los pagos (ya deduplicados) de un crédito hasta `fechaCorte` y devuelve su
 * estado. Cada pago salda la cuota pendiente más antigua aplicando la prelación del
 * núcleo; un pago que no la salda exactamente rompe la integridad y se reporta.
 */
export function reconstruirCredito(
  fuente: CreditoFuente,
  pagosDelCredito: readonly PagoFuente[],
  fechaCorte: string,
  contexto: ContextoPoliticas,
  nombreCliente = '',
): DetalleCredito {
  validarFecha(fechaCorte);
  if (fuente.fechaDesembolso > fechaCorte) {
    throw new ErrorNegocio(
      'CREDITO_NO_DESEMBOLSADO_A_LA_FECHA',
      `El crédito ${fuente.idCredito} no existía al ${fechaCorte} (desembolso ${fuente.fechaDesembolso})`,
    );
  }
  const capital = centavosADinero(fuente.capitalCentavos);
  const programadas = planDe(fuente);
  const politica = contexto.politicaParaOtorgamiento(fuente.fechaDesembolso);
  const umbral = contexto.diasIncobrable;

  let siguiente = 0;
  let saldo = capital;
  const pagos: PagoAplicado[] = [];
  const esIncobrableAl = (fecha: string): boolean =>
    siguiente < programadas.length && calcularDiasAtraso(programadas[siguiente].fechaVencimiento, fecha) > umbral;

  const ordenados = pagosDelCredito
    .filter((p) => p.fecha <= fechaCorte)
    .slice()
    .sort((a, b) => (a.fecha === b.fecha ? a.orden - b.orden : a.fecha < b.fecha ? -1 : 1));

  for (const pago of ordenados) {
    const monto = centavosADinero(pago.montoCentavos);
    const base = { claveIdempotencia: pago.claveIdempotencia, fecha: pago.fecha, monto, canal: pago.canal, origen: pago.origen };
    if (esIncobrableAl(pago.fecha)) {
      // Crédito dado de baja: lo cobrado se registra aparte y no reactiva el crédito.
      pagos.push({ ...base, tipo: 'RECUPERACION' });
      continue;
    }
    if (siguiente >= programadas.length) {
      throw new ErrorIntegridadCartera(`Pago ${pago.claveIdempotencia} sobre ${fuente.idCredito} ya cancelado`);
    }
    const exigible = exigibleDeCuota(programadas[siguiente], pago.fecha, politica, contexto);
    const aplicacion = aplicarPago(monto, adeudoDe(exigible));
    if (!aplicacion.cuotaSaldada || !aplicacion.remanente.esCero()) {
      throw new ErrorIntegridadCartera(
        `Pago ${pago.claveIdempotencia} de ${fuente.idCredito} (${monto.formato()}) no coincide con el exigible de la cuota ${exigible.numero} al ${pago.fecha} (${exigible.total.formato()})`,
      );
    }
    saldo = saldo.restar(aplicacion.aplicado.capital);
    pagos.push({
      ...base,
      tipo: 'APLICACION',
      numeroCuota: exigible.numero,
      diasAtrasoAlPago: exigible.diasAtraso,
      aplicado: aplicacion.aplicado,
      saldoCapitalDespues: saldo,
    });
    siguiente += 1;
  }

  const pendientes = programadas.slice(siguiente);
  const cuotasVencidas = pendientes
    .filter((p) => p.fechaVencimiento < fechaCorte)
    .map((p) => sinTotalCrudo(exigibleDeCuota(p, fechaCorte, politica, contexto)));
  const cuotasPendientes = pendientes
    .filter((p) => p.fechaVencimiento >= fechaCorte)
    .map((p) => ({ numero: p.cuota.numero, fechaVencimiento: p.fechaVencimiento, capital: p.cuota.amortizacion, interes: p.cuota.interes, monto: p.cuota.pago }));
  const diasAtraso = cuotasVencidas[0]?.diasAtraso ?? 0;
  const noVencida = cuotasPendientes[0];
  // Día 121 de atraso de la cuota más antigua: fecha de baja contable.
  const fechaIncobrable = cuotasVencidas[0] && diasAtraso > umbral
    ? format(addDays(parseISO(cuotasVencidas[0].fechaVencimiento), umbral + 1), FORMATO_FECHA)
    : undefined;

  let estado: EstadoCredito;
  if (saldo.esCero()) estado = 'CANCELADO';
  else if (diasAtraso > umbral) estado = 'INCOBRABLE';
  else if (fuente.reestructurado) estado = 'REESTRUCTURADO';
  else if (diasAtraso >= 1) estado = 'EN_MORA';
  else estado = 'VIGENTE';

  return {
    idCredito: fuente.idCredito,
    idCliente: fuente.idCliente,
    nombreCliente,
    idAsesor: fuente.idAsesor,
    fechaDesembolso: fuente.fechaDesembolso,
    fechaCorte,
    politicaMora: politica.id,
    tnaBps: fuente.tnaBps,
    plazoMeses: fuente.plazoMeses,
    reestructurado: fuente.reestructurado,
    capitalOriginal: capital,
    saldoCapital: saldo,
    estado,
    enMora: diasAtraso >= 1 && estado !== 'CANCELADO',
    diasAtraso,
    tramo: clasificarTramo(diasAtraso),
    cuotasTotales: programadas.length,
    cuotasPagadas: siguiente,
    cuotasVencidas,
    cuotasPendientes,
    totalVencidoExigible: sumar(cuotasVencidas.map((c) => c.total)),
    ...(noVencida ? { proximaCuota: { numero: noVencida.numero, fechaVencimiento: noVencida.fechaVencimiento, monto: noVencida.monto } } : {}),
    ...(fechaIncobrable ? { fechaIncobrable } : {}),
    pagos,
  };
}

/** Primera aparición de cada clave gana; las repeticiones se reportan, no se aplican. */
export function deduplicarPagos(pagos: readonly PagoFuente[]): { unicos: PagoFuente[]; ignorados: PagoFuente[] } {
  const vistos = new Set<string>();
  const unicos: PagoFuente[] = [];
  const ignorados: PagoFuente[] = [];
  for (const pago of [...pagos].sort((a, b) => a.orden - b.orden)) {
    if (vistos.has(pago.claveIdempotencia)) ignorados.push(pago);
    else {
      vistos.add(pago.claveIdempotencia);
      unicos.push(pago);
    }
  }
  return { unicos, ignorados };
}

/** Plan francés de una solicitud, antes de existir el crédito (OP-3). */
export function simularPlan(
  capital: Dinero,
  plazoMeses: number,
  tnaBps: number,
  fechaDesembolso: string,
  contexto: ContextoPoliticas,
): PlanSimulado {
  validarFecha(fechaDesembolso, 'fechaDesembolso');
  const tasaMensual = tasaMensualDe(tnaBps);
  const plan = generarPlanFrances(capital, tasaMensual, plazoMeses);
  const cuotas = plan.cuotas.map((c) => ({
    numero: c.numero,
    fechaVencimiento: vencimiento(fechaDesembolso, c.numero),
    saldoInicial: c.saldoInicial,
    pago: c.pago,
    interes: c.interes,
    amortizacion: c.amortizacion,
    saldoFinal: c.saldoFinal,
  }));
  return {
    capital,
    plazoMeses,
    tnaBps,
    tasaMensual: tasaMensual.toString(),
    tasaEfectivaAnual: calcularTasaEfectivaAnual(tasaMensual).toDecimalPlaces(6).toString(),
    fechaDesembolso,
    politicaMora: contexto.politicaParaOtorgamiento(fechaDesembolso).id,
    cuotas,
    totalIntereses: sumar(cuotas.map((c) => c.interes)),
    totalPagado: sumar(cuotas.map((c) => c.pago)),
  };
}

// ---------------------------------------------------------------------------
// Lectura de PGlite
// ---------------------------------------------------------------------------

/**
 * Nombres de columna aceptados. El esquema E2 se detecta al abrir (information_schema),
 * así el adaptador no depende de un nombre exacto de columna de fecha u orden.
 */
const COLUMNAS = {
  creditos: { fecha: ['fecha_desembolso', 'fecha_otorgamiento', 'fecha'] },
  pagos: {
    fecha: ['fecha_pago', 'fecha'],
    orden: ['seq', 'seq_evento', 'secuencia', 'id_registro', 'id_pago', 'id'],
  },
  clientes: { nombre: ['nombre_completo', 'nombre'], fechaAlta: ['fecha_alta', 'fecha'] },
  asesores: { nombre: ['nombre_completo', 'nombre'] },
} as const;

interface EsquemaDetectado {
  creditosFecha: string;
  pagosFecha: string;
  pagosOrden?: string;
  clientesNombre?: string;
  clientesFechaAlta?: string;
  clientesColumnas: Set<string>;
  asesoresNombre?: string;
}

function ident(nombre: string): string {
  return `"${nombre.replace(/"/g, '""')}"`;
}

async function columnasDe(db: ConexionSql, tabla: string, requerida = true): Promise<Set<string>> {
  const r = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1`,
    [tabla],
  );
  if (r.rows.length === 0 && requerida) throw new Error(`La tabla ${tabla} no existe. Ejecute primero: npm run cargar:datos`);
  return new Set(r.rows.map((f) => f.column_name));
}

function elegir(disponibles: Set<string>, candidatos: readonly string[], tabla: string, requerido: true): string;
function elegir(disponibles: Set<string>, candidatos: readonly string[], tabla: string, requerido: false): string | undefined;
function elegir(disponibles: Set<string>, candidatos: readonly string[], tabla: string, requerido: boolean): string | undefined {
  const hallado = candidatos.find((c) => disponibles.has(c));
  if (!hallado && requerido) throw new Error(`No se encontró en ${tabla} ninguna de las columnas: ${candidatos.join(', ')}`);
  return hallado;
}

async function detectarEsquema(db: ConexionSql): Promise<EsquemaDetectado> {
  const cCreditos = await columnasDe(db, 'creditos');
  const cPagos = await columnasDe(db, 'pagos');
  const cClientes = await columnasDe(db, 'clientes', false);
  const cAsesores = await columnasDe(db, 'asesores', false);
  for (const col of ['id_credito', 'id_cliente', 'id_asesor', 'capital_centavos', 'plazo_meses', 'tna_bps', 'reestructurado']) {
    if (!cCreditos.has(col)) throw new Error(`Falta la columna creditos.${col}`);
  }
  for (const col of ['clave_idempotencia', 'id_credito', 'monto_centavos']) {
    if (!cPagos.has(col)) throw new Error(`Falta la columna pagos.${col}`);
  }
  const opcional = <K extends string>(clave: K, valor: string | undefined): Partial<Record<K, string>> =>
    (valor ? { [clave]: valor } : {}) as Partial<Record<K, string>>;
  return {
    creditosFecha: elegir(cCreditos, COLUMNAS.creditos.fecha, 'creditos', true),
    pagosFecha: elegir(cPagos, COLUMNAS.pagos.fecha, 'pagos', true),
    ...opcional('pagosOrden', elegir(cPagos, COLUMNAS.pagos.orden, 'pagos', false)),
    ...opcional('clientesNombre', elegir(cClientes, COLUMNAS.clientes.nombre, 'clientes', false)),
    ...opcional('clientesFechaAlta', elegir(cClientes, COLUMNAS.clientes.fechaAlta, 'clientes', false)),
    clientesColumnas: cClientes,
    ...opcional('asesoresNombre', elegir(cAsesores, COLUMNAS.asesores.nombre, 'asesores', false)),
  };
}

function comoObjeto(valor: unknown): Record<string, unknown> | undefined {
  if (valor && typeof valor === 'object' && !(valor instanceof Date)) return valor as Record<string, unknown>;
  if (typeof valor === 'string' && /^\s*[{[]/.test(valor)) {
    try {
      return JSON.parse(valor) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Lee `parametros_politicas`. Acepta el documento completo en una columna JSON o filas
 * clave/valor (`politicas_mora`, `gasto_gestion_cobro`, ...). Si la tabla no los trae,
 * recurre a `CV_DATA_DIR/politicas.json` (mismo archivo cuya carga registró E2).
 */
async function leerParametros(db: ConexionSql, dataDir?: string): Promise<ParametrosPoliticas> {
  let filas: Record<string, unknown>[] = [];
  try {
    filas = (await db.query<Record<string, unknown>>('SELECT * FROM parametros_politicas')).rows;
  } catch {
    filas = [];
  }
  for (const fila of filas) {
    for (const valor of Object.values(fila)) {
      const obj = comoObjeto(valor);
      if (obj && 'politicas_mora' in obj) return obj as unknown as ParametrosPoliticas;
    }
  }
  const armado: Record<string, unknown> = {};
  for (const fila of filas) {
    const valores = Object.values(fila);
    const clave = valores.find((v): v is string => typeof v === 'string' && !/^\s*[{[]/.test(v));
    const valor = valores.find((v) => v !== clave);
    if (clave) armado[clave] = comoObjeto(valor) ?? (typeof valor === 'string' && /^\d+$/.test(valor) ? Number(valor) : valor);
  }
  if (armado.politicas_mora && armado.gasto_gestion_cobro) {
    if (typeof armado.base_conteo !== 'string') armado.base_conteo = 'Actual/360';
    return armado as unknown as ParametrosPoliticas;
  }
  const dir = dataDir ?? process.env.CV_DATA_DIR;
  const ruta = dir ? resolve(dir, 'politicas.json') : undefined;
  if (ruta && existsSync(ruta)) return JSON.parse(readFileSync(ruta, 'utf-8')) as ParametrosPoliticas;
  throw new Error('No se encontraron parámetros de política en parametros_politicas ni en CV_DATA_DIR/politicas.json');
}

interface FilaCredito {
  id_credito: string;
  id_cliente: string;
  id_asesor: string;
  fecha: string;
  capital_centavos: unknown;
  plazo_meses: unknown;
  tna_bps: unknown;
  reestructurado: unknown;
}

interface FilaPago {
  clave_idempotencia: string;
  id_credito: string;
  fecha: string;
  monto_centavos: unknown;
  canal: string | null;
}

/** Abre `.cv-db` con la misma función del cargador E2 (PGlite + pgvector). */
export async function abrirBaseLocal(dbDir?: string): Promise<ConexionSql> {
  const ruta = resolve(dbDir ?? process.env.CV_DB_DIR ?? '.cv-db');
  if (!existsSync(ruta)) throw new Error(`No existe la base local en ${ruta}. Ejecute primero: npm run cargar:datos`);
  return (await abrirBaseDatos(ruta)) as unknown as ConexionSql;
}

/** Instantánea de todos los hechos (canónicos + bitácora), leída en una sola pasada. */
interface Hechos {
  creditos: CreditoFuente[];
  pagos: PagoFuente[];
  clientes: Map<string, ClienteRegistro>;
  bitacora: EventoBitacora[];
}

// ---------------------------------------------------------------------------
// Adaptador
// ---------------------------------------------------------------------------

export class AdaptadorNucleo {
  private cola: Promise<unknown> = Promise.resolve();

  private constructor(
    readonly db: ConexionSql,
    private readonly esquema: EsquemaDetectado,
    readonly politicas: ContextoPoliticas,
    private readonly provisionesDir?: string,
    private readonly devengoDir?: string,
  ) {}

  static async abrir(opciones: { dbDir?: string; dataDir?: string; provisionesDir?: string; devengoDir?: string } = {}): Promise<AdaptadorNucleo> {
    const db = await abrirBaseLocal(opciones.dbDir);
    try {
      return await AdaptadorNucleo.desdeConexion(db, opciones.dataDir, opciones.provisionesDir, opciones.devengoDir);
    } catch (error) {
      await db.close();
      throw error;
    }
  }

  static async desdeConexion(db: ConexionSql, dataDir?: string, provisionesDir?: string, devengoDir?: string): Promise<AdaptadorNucleo> {
    const esquema = await detectarEsquema(db);
    const politicas = new ContextoPoliticas(await leerParametros(db, dataDir));
    await asegurarBitacora(db);
    await asegurarCierres(db);
    await asegurarMovimientosProvisiones(db);
    await asegurarDevengo(db);
    return new AdaptadorNucleo(db, esquema, politicas, provisionesDir, devengoDir);
  }

  async cerrar(): Promise<void> {
    await this.cola.catch(() => undefined);
    await this.db.close();
  }

  /**
   * Ejecuta `fn` en exclusión mutua dentro de este proceso. Las escrituras validan y
   * escriben sin que otra operación se intercale (PGlite admite un solo proceso).
   */
  exclusivo<T>(fn: () => Promise<T>): Promise<T> {
    const resultado = this.cola.then(fn, fn);
    this.cola = resultado.catch(() => undefined);
    return resultado;
  }

  // ---------------- Lectura de hechos ----------------

  private async hechos(): Promise<Hechos> {
    const bitacora = await leerBitacora(this.db);
    const creditos = await this.leerCreditosCanonicos();
    const pagosCanonicos = await this.leerPagosCanonicos();
    const clientes = await this.leerClientes(bitacora);

    for (const e of bitacora) {
      if (e.tipo === 'DESEMBOLSO') {
        const d = e.datos;
        creditos.push({
          idCredito: String(d.id_credito),
          idCliente: String(d.id_cliente),
          idAsesor: String(d.id_asesor),
          fechaDesembolso: String(d.fecha),
          capitalCentavos: String(d.capital_centavos),
          plazoMeses: Number(d.plazo_meses),
          tnaBps: Number(d.tna_bps),
          reestructurado: aBooleano(d.reestructurado),
        });
      }
    }
    let orden = pagosCanonicos.length;
    const pagosInterfaz: PagoFuente[] = bitacora
      .filter((e) => e.tipo === 'PAGO')
      .map((e) => ({
        claveIdempotencia: String(e.datos.clave_idempotencia),
        idCredito: String(e.datos.id_credito),
        fecha: String(e.datos.fecha),
        montoCentavos: String(e.datos.monto_centavos),
        canal: String(e.datos.canal ?? ''),
        orden: orden++,
        origen: 'INTERFAZ' as const,
      }));
    return { creditos, pagos: [...pagosCanonicos, ...pagosInterfaz], clientes, bitacora };
  }

  async leerEventosBitacora(): Promise<EventoBitacora[]> {
    return leerBitacora(this.db);
  }

  async listarClientes(): Promise<ClienteRegistro[]> {
    const bitacora = await leerBitacora(this.db);
    return [...(await this.leerClientes(bitacora)).values()];
  }

  async listarAsesores(): Promise<AsesorRegistro[]> {
    if (!this.esquema.asesoresNombre) return [];
    const r = await this.db.query<{ id_asesor: string; nombre: string }>(
      `SELECT id_asesor, ${ident(this.esquema.asesoresNombre)} AS nombre FROM asesores ORDER BY id_asesor`,
    );
    return r.rows.map((f) => ({ idAsesor: f.id_asesor, nombreCompleto: f.nombre }));
  }

  /** Conteo de idempotencia: registros persistidos, únicos aplicables y repeticiones. */
  async auditarPagos(): Promise<{ registros: number; unicos: number; ignorados: string[]; registradosPorInterfaz: number }> {
    const { pagos } = await this.hechos();
    const { unicos, ignorados } = deduplicarPagos(pagos);
    return {
      registros: pagos.length,
      unicos: unicos.length,
      ignorados: ignorados.map((p) => p.claveIdempotencia),
      registradosPorInterfaz: pagos.filter((p) => p.origen === 'INTERFAZ').length,
    };
  }

  /** Busca una clave de idempotencia en toda la historia (canónica e interfaz). */
  async buscarPagoPorClave(clave: string): Promise<PagoFuente | undefined> {
    const { pagos } = await this.hechos();
    return deduplicarPagos(pagos).unicos.find((p) => p.claveIdempotencia === clave);
  }

  async existeCredito(idCredito: string): Promise<boolean> {
    return (await this.hechos()).creditos.some((c) => c.idCredito === idCredito);
  }

  // ---------------- Consultas sobre el núcleo ----------------

  async obtenerDetalleCredito(idCredito: string, fechaCorte: string): Promise<DetalleCredito> {
    validarFecha(fechaCorte);
    const h = await this.hechos();
    const fuente = h.creditos.find((c) => c.idCredito === idCredito);
    if (!fuente) throw new ErrorNegocio('CREDITO_INEXISTENTE', `Crédito no encontrado: ${idCredito}`, { idCredito });
    const { unicos } = deduplicarPagos(h.pagos);
    return reconstruirCredito(
      fuente,
      unicos.filter((p) => p.idCredito === idCredito),
      fechaCorte,
      this.politicas,
      h.clientes.get(fuente.idCliente)?.nombreCompleto ?? '',
    );
  }

  /** Todos los créditos desembolsados hasta la fecha de corte, reconstruidos a esa fecha. */
  async listarDetallesCreditos(fechaCorte: string): Promise<DetalleCredito[]> {
    validarFecha(fechaCorte);
    const h = await this.hechos();
    const { unicos } = deduplicarPagos(h.pagos);
    const porCredito = new Map<string, PagoFuente[]>();
    for (const pago of unicos) {
      const lista = porCredito.get(pago.idCredito) ?? [];
      lista.push(pago);
      porCredito.set(pago.idCredito, lista);
    }
    return h.creditos
      .filter((c) => c.fechaDesembolso <= fechaCorte)
      .sort((a, b) => (a.fechaDesembolso === b.fechaDesembolso ? a.idCredito.localeCompare(b.idCredito) : a.fechaDesembolso < b.fechaDesembolso ? -1 : 1))
      .map((c) => reconstruirCredito(c, porCredito.get(c.idCredito) ?? [], fechaCorte, this.politicas, h.clientes.get(c.idCliente)?.nombreCompleto ?? ''));
  }

  async resumirCarteraTotal(fechaCorte: string): Promise<CarteraConsolidada> {
    return this.consolidar(await this.listarDetallesCreditos(fechaCorte), fechaCorte);
  }

  private consolidar(detalles: DetalleCredito[], fechaCorte: string): CarteraConsolidada {
    const cartera: CreditoCartera[] = detalles.map((d) => ({
      id: d.idCredito,
      saldoCapital: d.saldoCapital,
      diasAtraso: d.diasAtraso,
      estado: d.estado,
    }));
    const activos = cartera.filter((c) => c.estado !== 'CANCELADO' && c.estado !== 'INCOBRABLE');
    const resumen = resumirCartera(cartera);
    const porTramo = resumirCarteraPorTramo(activos);
    const mes = fechaCorte.slice(0, 7);
    const incobrablesDelMes = detalles
      .filter((d) => d.estado === 'INCOBRABLE' && d.fechaIncobrable?.slice(0, 7) === mes)
      .map((d) => ({ idCredito: d.idCredito, nombreCliente: d.nombreCliente, fechaIncobrable: d.fechaIncobrable as string, saldoCapital: d.saldoCapital }));
    const reestructuradosAlDia = activos.filter((c) => c.estado === 'REESTRUCTURADO' && c.diasAtraso === 0);
    return {
      fechaCorte,
      resumen,
      carteraEnMora: porTramo.carteraEnMora,
      porcentajeMora: resumen.carteraActiva.esCero() ? new Decimal(0) : porTramo.carteraEnMora.valor.div(resumen.carteraActiva.valor),
      porTramo: porTramo.porTramo,
      reestructuradosAlDia: { creditos: reestructuradosAlDia.length, saldo: sumar(reestructuradosAlDia.map((c) => c.saldoCapital)) },
      conteos: {
        desembolsados: cartera.length,
        activos: activos.length,
        enMora: activos.filter((c) => c.diasAtraso >= 1).length,
        enRiesgo: activos.filter((c) => c.estado === 'REESTRUCTURADO' || c.diasAtraso > this.politicas.parametros.regla_riesgo_dias).length,
        cancelados: cartera.filter((c) => c.estado === 'CANCELADO').length,
        incobrables: cartera.filter((c) => c.estado === 'INCOBRABLE').length,
      },
      incobrablesDelMes,
      incobrableDelMes: sumar(incobrablesDelMes.map((c) => c.saldoCapital)),
    };
  }

  /** G-4 · créditos activos con atraso, filtrables por tramo, de mayor a menor atraso. */
  async listarCreditosEnMora(fechaCorte: string, tramo?: TramoMora): Promise<ListadoMora> {
    const detalles = await this.listarDetallesCreditos(fechaCorte);
    const creditos = detalles
      .filter((d) => d.diasAtraso >= 1 && d.estado !== 'CANCELADO')
      .filter((d) => (tramo ? d.tramo === tramo : d.estado !== 'INCOBRABLE'))
      .sort((a, b) => b.diasAtraso - a.diasAtraso || a.idCredito.localeCompare(b.idCredito))
      .map((d) => ({
        idCredito: d.idCredito,
        idCliente: d.idCliente,
        nombreCliente: d.nombreCliente,
        idAsesor: d.idAsesor,
        estado: d.estado,
        diasAtraso: d.diasAtraso,
        tramo: d.tramo,
        cuotasVencidas: d.cuotasVencidas.length,
        saldoCapital: d.saldoCapital,
        totalVencidoExigible: d.totalVencidoExigible,
      }));
    return {
      fechaCorte,
      tramo: tramo ?? 'TODOS',
      creditos,
      totalCreditos: creditos.length,
      saldoCapitalTotal: sumar(creditos.map((c) => c.saldoCapital)),
    };
  }

  /**
   * G-6 · cuotas programadas que vencen en (fechaCorte, fechaCorte + dias]. Monto = cuota
   * del plan (aún no hay atraso). Excluye créditos cancelados e incobrables.
   */
  async verProximosVencimientos(fechaCorte: string, dias: number): Promise<Vencimientos> {
    if (!Number.isInteger(dias) || dias < 1 || dias > 366) {
      throw new ErrorNegocio('DATOS_INVALIDOS', 'La ventana de días debe ser un entero entre 1 y 366');
    }
    const desde = format(addDays(parseISO(validarFecha(fechaCorte)), 1), FORMATO_FECHA);
    const hasta = format(addDays(parseISO(fechaCorte), dias), FORMATO_FECHA);
    const detalles = await this.listarDetallesCreditos(fechaCorte);
    const cuotas = detalles
      .filter((d) => d.estado !== 'CANCELADO' && d.estado !== 'INCOBRABLE')
      .flatMap((d) => d.cuotasPendientes
        .filter((c) => c.fechaVencimiento >= desde && c.fechaVencimiento <= hasta)
        .map((c) => ({ idCredito: d.idCredito, nombreCliente: d.nombreCliente, numeroCuota: c.numero, fechaVencimiento: c.fechaVencimiento, monto: c.monto })))
      .sort((a, b) => (a.fechaVencimiento === b.fechaVencimiento ? a.idCredito.localeCompare(b.idCredito) : a.fechaVencimiento < b.fechaVencimiento ? -1 : 1));
    return { fechaCorte, dias, desde, hasta, cuotas, totalCuotas: cuotas.length, montoTotal: sumar(cuotas.map((c) => c.monto)) };
  }

  /**
   * G-2 / G-3 · cierre diario (AAAA-MM-DD) o mensual (AAAA-MM). La fecha de corte del
   * cierre es el último día del periodo. Devuelve la instantánea ejecutada si existe;
   * de lo contrario calcula una vista previa sin persistirla. Las recuperaciones se
   * desglosan con la misma prelación con que el núcleo aplicó cada pago.
   */
  async consultarCierre(periodo: string): Promise<Cierre> {
    const guardado = await leerCierre(this.db, periodo);
    return guardado ?? this.calcularCierre(periodo);
  }

  /** Una ejecución por período; usa la misma exclusión mutua que las operaciones financieras. */
  async ejecutarCierre(periodo: string, usuario: string): Promise<Cierre> {
    if (!usuario.trim()) throw new ErrorNegocio('DATOS_INVALIDOS', 'El cierre requiere un usuario');
    return this.exclusivo(async () => {
      const guardado = await leerCierre(this.db, periodo);
      if (guardado) return guardado;
      const cierre = await this.calcularCierre(periodo);
      const fuentes = this.fuentesDevengo(await this.listarDetallesCreditos(cierre.hasta));
      return guardarCierreConMovimientos(this.db, { ...cierre, estado: 'EJECUTADO', ejecutadoPor: usuario.trim() }, fuentes);
    });
  }

  async abrirProvisionesDesdeHistorico(periodo: string, usuario: string, motivo: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) throw new ErrorNegocio('DATOS_INVALIDOS', 'La apertura requiere un período mensual');
    return this.exclusivo(() => abrirDesdeHistorico(this.db, periodo, usuario, motivo));
  }

  async consultarRegistroProvisiones(fechaCorte: string) {
    return consultarRegistroProvisiones(this.db, validarFecha(fechaCorte));
  }

  private fuentesDevengo(detalles: DetalleCredito[]): CreditoDevengo[] {
    const politicas = cargarPoliticasDevengo(this.devengoDir);
    return detalles.map(d => {
      const plan = generarPlanFrances(d.capitalOriginal, tasaMensualDe(d.tnaBps), d.plazoMeses);
      return { id: d.idCredito, desembolso: d.fechaDesembolso, politica: politicaDevengoPara(d.fechaDesembolso, politicas),
        cuotas: plan.cuotas.map((q, i) => ({ numero: q.numero, inicio: i ? vencimiento(d.fechaDesembolso, i) : d.fechaDesembolso,
          vencimiento: vencimiento(d.fechaDesembolso, q.numero), interes: q.interes })),
        eventos: d.pagos.filter(p => p.tipo === 'APLICACION').map((p, orden) => ({
          id: p.claveIdempotencia, fecha: p.fecha, orden, tipo: 'PAGO' as const, cuota: p.numeroCuota!,
        })),
      };
    });
  }

  private async calcularCierre(periodo: string): Promise<Cierre> {
    let tipo: Cierre['tipo'];
    let desde: string;
    let hasta: string;
    if (/^\d{4}-\d{2}$/.test(periodo)) {
      tipo = 'MENSUAL';
      desde = validarFecha(`${periodo}-01`, 'periodo');
      hasta = format(endOfMonth(parseISO(desde)), FORMATO_FECHA);
    } else {
      tipo = 'DIARIO';
      desde = validarFecha(periodo, 'periodo');
      hasta = desde;
    }
    const detalles = await this.listarDetallesCreditos(hasta);
    const enRango = (f: string): boolean => f >= desde && f <= hasta;

    const desembolsados = detalles.filter((d) => enRango(d.fechaDesembolso));
    const pagos = detalles.flatMap((d) => d.pagos).filter((p) => enRango(p.fecha));
    const aplicados = pagos.filter((p) => p.tipo === 'APLICACION' && p.aplicado);
    const recuperacionesIncobrables = pagos.filter((p) => p.tipo === 'RECUPERACION');
    const concepto = (k: keyof Adeudo): Dinero => sumar(aplicados.map((p) => (p.aplicado as Adeudo)[k]));
    const recuperaciones: RecuperacionesPorConcepto = {
      pagos: aplicados.length,
      gastos: concepto('gastos'),
      interesMoratorio: concepto('interesMoratorio'),
      interesCorriente: concepto('interesCorriente'),
      capital: concepto('capital'),
      total: sumar(aplicados.map((p) => p.monto)),
    };
    const incobrables = detalles.filter((d) => d.fechaIncobrable && enRango(d.fechaIncobrable));
    const parametros = structuredClone(this.politicas.parametros);
    const huella = (valor: unknown): string => createHash('sha256').update(JSON.stringify(valor)).digest('hex');
    const idsMora = [...new Set(detalles.map((d) => d.politicaMora))].sort();
    let devengo: ResultadoDevengoCierre;
    try { devengo = await prepararDevengo(this.db, { desde, hasta, periodo }, this.fuentesDevengo(detalles), 'VISTA_PREVIA'); }
    catch (error) { devengo = { estado: 'NO_DISPONIBLE', motivo: error instanceof Error ? error.message : String(error) }; }
    let provisiones: ProvisionesCierre = { estado: 'NO_DISPONIBLE', motivo: 'Provisiones disponibles únicamente en el cierre mensual' };
    if (tipo === 'MENSUAL') {
      try {
        const politica = cargarPoliticaProvisiones(hasta, this.provisionesDir);
        provisiones = { estado: 'DISPONIBLE', parametros: politica,
          ...calcularProvisiones(politica, hasta, detalles.map(d => ({
            id: d.idCredito, saldoCapital: d.saldoCapital, estado: d.estado,
            diasAtraso: d.diasAtraso, dadoDeBaja: d.estado === 'INCOBRABLE',
          }))),
        };
      } catch (error) {
        throw new ErrorNegocio('DATOS_INVALIDOS', `Política de provisiones: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return {
      devengo,
      provisiones,
      estado: 'PREVIA',
      fechaCorte: hasta,
      politicasUtilizadas: {
        ...(parametros.version ? { versionParametros: parametros.version } : {}),
        huellaParametros: huella(parametros),
        parametros,
        mora: idsMora.map((id) => ({ id,
          vigenteDesde: this.politicas.politicaParaOtorgamiento(detalles.find((d) => d.politicaMora === id)!.fechaDesembolso).vigenteDesde,
          huellaDefinicion: huella(parametros.politicas_mora[id]),
        })),
      },
      tipo,
      periodo,
      desde,
      hasta,
      desembolsos: {
        cantidad: desembolsados.length,
        monto: sumar(desembolsados.map((d) => d.capitalOriginal)),
        creditos: desembolsados.map((d) => ({ idCredito: d.idCredito, nombreCliente: d.nombreCliente, fecha: d.fechaDesembolso, capital: d.capitalOriginal })),
      },
      recuperaciones,
      recuperacionesIncobrables: { pagos: recuperacionesIncobrables.length, monto: sumar(recuperacionesIncobrables.map((p) => p.monto)) },
      incobrablesDelPeriodo: {
        creditos: incobrables.map((d) => ({ idCredito: d.idCredito, fechaIncobrable: d.fechaIncobrable as string, saldoCapital: d.saldoCapital })),
        monto: sumar(incobrables.map((d) => d.saldoCapital)),
      },
      cartera: this.consolidar(detalles, hasta),
    };
  }

  /** G-5 / G-7 · capital en mora y desglose por tramo recorrido de una cuota. */
  async explicarMora(idCredito: string, numeroCuota: number, fechaCorte: string): Promise<ExplicacionMora> {
    const h = await this.hechos();
    const fuente = h.creditos.find((c) => c.idCredito === idCredito);
    const detalle = await this.obtenerDetalleCredito(idCredito, fechaCorte);
    if (!fuente || !Number.isInteger(numeroCuota) || numeroCuota < 1 || numeroCuota > detalle.cuotasTotales) {
      throw new ErrorNegocio('CUOTA_INEXISTENTE', `${idCredito} no tiene cuota ${numeroCuota} (plazo ${detalle.cuotasTotales})`);
    }
    if (numeroCuota <= detalle.cuotasPagadas) {
      const pago = detalle.pagos.find((p) => p.numeroCuota === numeroCuota);
      throw new ErrorNegocio('CUOTA_YA_PAGADA', `La cuota ${numeroCuota} de ${idCredito} ya fue pagada${pago ? ` el ${pago.fecha}` : ''}`, {
        ...(pago ? { fechaPago: pago.fecha, monto: pago.monto.formato() } : {}),
      });
    }
    const programada = planDe(fuente)[numeroCuota - 1];
    if (programada.fechaVencimiento >= fechaCorte) {
      throw new ErrorNegocio('CUOTA_NO_VENCIDA', `La cuota ${numeroCuota} de ${idCredito} vence el ${programada.fechaVencimiento}; al ${fechaCorte} no tiene mora`);
    }
    const exigible = exigibleDeCuota(programada, fechaCorte, this.politicas.politicaParaOtorgamiento(fuente.fechaDesembolso), this.politicas);
    return {
      idCredito,
      fechaCorte,
      politicaMora: detalle.politicaMora,
      cuota: sinTotalCrudo(exigible),
      totalSinRedondear: exigible.totalSinRedondear.toString(),
    };
  }

  simularPlan(capital: Dinero | string, plazoMeses: number, tnaBps: number, fechaDesembolso: string): PlanSimulado {
    return simularPlan(aDinero(capital), plazoMeses, tnaBps, fechaDesembolso, this.politicas);
  }

  /**
   * Valida un pago propuesto contra la cuota pendiente más antigua SIN escribir en la base.
   * El registro real (con aprobación humana) lo hace `ServicioOperaciones.registrarPago`.
   */
  async simularLiquidacionPago(solicitud: SolicitudPago): Promise<ResultadoSimulacionPago> {
    const { idCredito } = solicitud;
    const fechaPago = validarFecha(solicitud.fechaPago, 'fechaPago');
    const monto = aDinero(solicitud.monto);

    if (solicitud.claveIdempotencia) {
      const previo = await this.buscarPagoPorClave(solicitud.claveIdempotencia);
      if (previo) {
        const montoPrevio = centavosADinero(previo.montoCentavos);
        if (previo.idCredito === idCredito && iguales(montoPrevio, monto)) {
          const detallePrevio = await this.obtenerDetalleCredito(idCredito, previo.fecha);
          const original = detallePrevio.pagos.find((p) => p.claveIdempotencia === previo.claveIdempotencia);
          if (!original) throw new ErrorIntegridadCartera(`No se encontró la aplicación original de ${previo.claveIdempotencia}`);
          return { resultado: 'DUPLICADO', idCredito, claveIdempotencia: previo.claveIdempotencia, pagoOriginal: original };
        }
        return {
          resultado: 'RECHAZADO',
          idCredito,
          motivo: 'CLAVE_EN_CONFLICTO',
          mensaje: `La clave ${previo.claveIdempotencia} ya se usó para otro pago (${previo.idCredito}, Q${montoPrevio.formato()})`,
        };
      }
    }

    const detalle = await this.obtenerDetalleCredito(idCredito, fechaPago);
    if (detalle.estado === 'INCOBRABLE') {
      return {
        resultado: 'RECHAZADO',
        idCredito,
        motivo: 'CREDITO_INCOBRABLE',
        mensaje: `${idCredito} es incobrable desde ${detalle.fechaIncobrable} (${detalle.diasAtraso} días de atraso): salió de cartera activa y su cobro es externo`,
      };
    }
    if (detalle.estado === 'CANCELADO') {
      return { resultado: 'RECHAZADO', idCredito, motivo: 'CREDITO_CANCELADO', mensaje: `${idCredito} no tiene saldo pendiente: todas sus cuotas están pagadas` };
    }
    const ultimo = detalle.pagos.at(-1);
    if (ultimo && ultimo.fecha > fechaPago) {
      return {
        resultado: 'RECHAZADO',
        idCredito,
        motivo: 'FECHA_ANTERIOR_A_ULTIMO_PAGO',
        mensaje: `No se puede registrar un pago al ${fechaPago}: ${idCredito} ya tiene un pago el ${ultimo.fecha}`,
      };
    }

    const cuota = detalle.cuotasVencidas[0] ?? (await this.cuotaSiguiente(detalle, fechaPago));
    if (monto.esCero() || monto.valor.isNegative()) {
      return { resultado: 'RECHAZADO', idCredito, motivo: 'MONTO_INVALIDO', mensaje: 'El monto debe ser positivo', montoExigido: cuota.total, cuota };
    }
    if (!iguales(monto, cuota.total)) {
      return {
        resultado: 'RECHAZADO',
        idCredito,
        motivo: 'MONTO_NO_EXACTO',
        mensaje: `El pago debe saldar exactamente la cuota ${cuota.numero}: Q${cuota.total.formato()} (recibido Q${monto.formato()})`,
        montoExigido: cuota.total,
        cuota,
      };
    }
    const aplicacion = aplicarPago(monto, adeudoDe(cuota));
    return {
      resultado: 'ACEPTABLE',
      idCredito,
      fechaPago,
      cuota,
      aplicacion,
      saldoCapitalResultante: detalle.saldoCapital.restar(aplicacion.aplicado.capital),
    };
  }

  /**
   * Cuota que se cobraría hoy (la vencida más antigua o, si está al día, la siguiente) con
   * su desglose por prelación. Es lo que la pantalla de Registro de pago muestra antes de
   * pedir el monto y la aprobación.
   */
  async consultarExigible(idCredito: string, fechaPago: string): Promise<{
    credito: DetalleCredito;
    permitePago: boolean;
    motivo?: MotivoRechazo;
    mensaje?: string;
    cuota?: CuotaExigible;
  }> {
    const credito = await this.obtenerDetalleCredito(idCredito, validarFecha(fechaPago, 'fechaPago'));
    if (credito.estado === 'INCOBRABLE') {
      return { credito, permitePago: false, motivo: 'CREDITO_INCOBRABLE', mensaje: `${idCredito} es incobrable desde ${credito.fechaIncobrable}; no admite pagos regulares` };
    }
    if (credito.estado === 'CANCELADO') {
      return { credito, permitePago: false, motivo: 'CREDITO_CANCELADO', mensaje: `${idCredito} no tiene saldo pendiente` };
    }
    const cuota = credito.cuotasVencidas[0] ?? (await this.cuotaSiguiente(credito, fechaPago));
    return { credito, permitePago: true, cuota };
  }

  private async cuotaSiguiente(detalle: DetalleCredito, fechaPago: string): Promise<CuotaExigible> {
    const h = await this.hechos();
    const fuente = h.creditos.find((c) => c.idCredito === detalle.idCredito);
    const programada = fuente ? planDe(fuente)[detalle.cuotasPagadas] : undefined;
    if (!fuente || !programada) throw new ErrorIntegridadCartera(`${detalle.idCredito} no tiene cuota ${detalle.cuotasPagadas + 1}`);
    return sinTotalCrudo(exigibleDeCuota(programada, fechaPago, this.politicas.politicaParaOtorgamiento(fuente.fechaDesembolso), this.politicas));
  }

  // ---------------- SQL de la carga canónica ----------------

  private async leerCreditosCanonicos(): Promise<CreditoFuente[]> {
    const fecha = ident(this.esquema.creditosFecha);
    const r = await this.db.query<FilaCredito>(
      `SELECT id_credito, id_cliente, id_asesor, ${fecha}::text AS fecha, capital_centavos::text AS capital_centavos,
              plazo_meses, tna_bps, reestructurado
         FROM creditos
        ORDER BY ${fecha}, id_credito`,
    );
    return r.rows.map((f) => ({
      idCredito: f.id_credito,
      idCliente: f.id_cliente,
      idAsesor: f.id_asesor,
      fechaDesembolso: validarFecha(f.fecha, `creditos.fecha (${f.id_credito})`),
      capitalCentavos: String(f.capital_centavos),
      plazoMeses: Number(f.plazo_meses),
      tnaBps: Number(f.tna_bps),
      reestructurado: aBooleano(f.reestructurado),
    }));
  }

  private async leerPagosCanonicos(): Promise<PagoFuente[]> {
    const fecha = ident(this.esquema.pagosFecha);
    const orden = this.esquema.pagosOrden ? ident(this.esquema.pagosOrden) : 'ctid';
    // Sin columna de orden se usa el orden físico de inserción (ctid), que en una carga
    // transaccional sigue el `seq` de la bitácora canónica.
    const r = await this.db.query<FilaPago>(
      `SELECT clave_idempotencia, id_credito, ${fecha}::text AS fecha, monto_centavos::text AS monto_centavos, canal
         FROM pagos
        ORDER BY ${orden}`,
    );
    return r.rows.map((f, i) => ({
      claveIdempotencia: f.clave_idempotencia,
      idCredito: f.id_credito,
      fecha: validarFecha(f.fecha, `pagos.fecha (${f.clave_idempotencia})`),
      montoCentavos: String(f.monto_centavos),
      canal: f.canal ?? '',
      orden: i,
      origen: 'CARGA_CANONICA' as const,
    }));
  }

  private async leerClientes(bitacora: EventoBitacora[]): Promise<Map<string, ClienteRegistro>> {
    const mapa = new Map<string, ClienteRegistro>();
    const cols = this.esquema.clientesColumnas;
    if (cols.has('id_cliente') && this.esquema.clientesNombre) {
      const texto = (col: string): string => (cols.has(col) ? `${ident(col)}::text` : `''`);
      const r = await this.db.query<{ id_cliente: string; nombre: string; dpi: string; telefono: string; municipio: string; fecha_alta: string }>(
        `SELECT id_cliente, ${ident(this.esquema.clientesNombre)} AS nombre, ${texto('dpi')} AS dpi, ${texto('telefono')} AS telefono,
                ${texto('municipio')} AS municipio, ${this.esquema.clientesFechaAlta ? `${ident(this.esquema.clientesFechaAlta)}::text` : `''`} AS fecha_alta
           FROM clientes ORDER BY id_cliente`,
      );
      for (const f of r.rows) {
        mapa.set(f.id_cliente, {
          idCliente: f.id_cliente,
          nombreCompleto: f.nombre,
          dpi: f.dpi ?? '',
          telefono: f.telefono ?? '',
          municipio: f.municipio ?? '',
          fechaAlta: f.fecha_alta ?? '',
          origen: 'CARGA_CANONICA',
        });
      }
    }
    for (const e of bitacora) {
      if (e.tipo !== 'CLIENTE') continue;
      const d = e.datos;
      mapa.set(String(d.id_cliente), {
        idCliente: String(d.id_cliente),
        nombreCompleto: String(d.nombre_completo),
        dpi: String(d.dpi),
        telefono: String(d.telefono ?? ''),
        municipio: String(d.municipio),
        fechaAlta: String(d.fecha_alta),
        origen: 'INTERFAZ',
      });
    }
    return mapa;
  }
}
