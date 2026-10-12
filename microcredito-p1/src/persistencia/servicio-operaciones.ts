/**
 * Operaciones que cambian el estado del sistema (Bloque 2 del video: OP-1 a OP-6).
 *
 * - Toda escritura pasa por aquí y queda en `bitacora_operaciones`.
 * - El ciclo de la solicitud usa la máquina de estados `Credito` del núcleo
 *   (SOLICITADO → APROBADO → DESEMBOLSADO): una transición inválida la rechaza el núcleo.
 * - Registrar un pago exige aprobación humana explícita y una clave de idempotencia; la
 *   validación (monto exacto, incobrable, clave repetida) es la misma simulación del
 *   adaptador, ejecutada en exclusión mutua justo antes de escribir.
 */
import { Decimal } from 'decimal.js';
import { parseISO } from 'date-fns';

import { Credito } from '../dominio/credito.js';
import { crearPoliticaCredito } from '../dominio/politica-credito.js';
import { Dinero } from '../dominio/dinero.js';
import {
  AdaptadorNucleo,
  ErrorNegocio,
  dineroACentavos,
  validarFecha,
  type CuotaExigible,
  type DetalleCredito,
  type PagoAplicado,
  type PlanSimulado,
  type ClienteRegistro,
} from './adaptador-nucleo.js';
import type { AplicacionPago } from '../dominio/prelacion-pago.js';
import { agregarEvento, ClaveDuplicada, type EventoBitacora } from './bitacora-operaciones.js';

export const CANALES = ['agencia', 'campo', 'transferencia'] as const;
export type Canal = (typeof CANALES)[number];

export interface AltaCliente {
  idCliente: string;
  nombreCompleto: string;
  dpi: string;
  telefono?: string;
  municipio: string;
  fechaAlta: string;
}

export interface NuevaSolicitud {
  idSolicitud?: string;
  idCliente: string;
  idAsesor: string;
  capital: string;
  plazoMeses: number;
  tnaBps: number;
  fecha: string;
}

export type EstadoSolicitud = 'SOLICITADA' | 'APROBADA' | 'RECHAZADA' | 'DESEMBOLSADA';

export interface Solicitud {
  idSolicitud: string;
  idCliente: string;
  nombreCliente: string;
  idAsesor: string;
  capital: Dinero;
  plazoMeses: number;
  tnaBps: number;
  fecha: string;
  estado: EstadoSolicitud;
  resolucion?: { decision: 'APROBADA' | 'RECHAZADA'; motivo: string; fecha: string; usuario: string };
  idCredito?: string;
}

export interface PagoRegistro {
  idCredito: string;
  monto: string;
  fechaPago: string;
  claveIdempotencia: string;
  canal: Canal;
  usuario: string;
  /** Aprobación humana explícita: sin ella no se escribe nada. */
  aprobacion?: { aprobado: boolean; aprobadoPor: string };
}

export type ResultadoRegistroPago =
  | { resultado: 'APLICADO'; claveIdempotencia: string; cuota: CuotaExigible; aplicacion: AplicacionPago; credito: DetalleCredito }
  | { resultado: 'DUPLICADO'; claveIdempotencia: string; pagoOriginal: PagoAplicado; credito: DetalleCredito };

const LIMITES = { capitalMin: new Decimal('1000'), capitalMax: new Decimal('25000'), plazoMin: 3, plazoMax: 24 };

function requerido(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || valor.trim() === '') throw new ErrorNegocio('DATOS_INVALIDOS', `${campo} es obligatorio`, { campo });
  return valor.trim();
}

export class ServicioOperaciones {
  constructor(private readonly adaptador: AdaptadorNucleo) {}

  // ---------------- Clientes ----------------

  async registrarCliente(alta: AltaCliente, usuario: string): Promise<ClienteRegistro> {
    return this.adaptador.exclusivo(async () => {
      const idCliente = requerido(alta.idCliente, 'idCliente');
      if (!/^CL-\d{4}$/.test(idCliente)) throw new ErrorNegocio('DATOS_INVALIDOS', 'idCliente debe tener formato CL-0000', { campo: 'idCliente' });
      const nombreCompleto = requerido(alta.nombreCompleto, 'nombreCompleto');
      const dpi = requerido(alta.dpi, 'dpi');
      const municipio = requerido(alta.municipio, 'municipio');
      const fechaAlta = validarFecha(alta.fechaAlta, 'fechaAlta');
      const clientes = await this.adaptador.listarClientes();
      if (clientes.some((c) => c.idCliente === idCliente)) throw new ErrorNegocio('ENTIDAD_DUPLICADA', `El cliente ${idCliente} ya existe`);
      if (clientes.some((c) => c.dpi === dpi)) throw new ErrorNegocio('ENTIDAD_DUPLICADA', `Ya existe un cliente con el DPI indicado`);
      await this.escribir({
        tipo: 'CLIENTE',
        clave: `CLIENTE:${idCliente}`,
        fecha: fechaAlta,
        usuario: requerido(usuario, 'usuario'),
        datos: { id_cliente: idCliente, nombre_completo: nombreCompleto, dpi, telefono: alta.telefono?.trim() ?? '', municipio, fecha_alta: fechaAlta },
      });
      return { idCliente, nombreCompleto, dpi, telefono: alta.telefono?.trim() ?? '', municipio, fechaAlta, origen: 'INTERFAZ' };
    });
  }

  // ---------------- Solicitudes: originación (OP-3) ----------------

  async listarSolicitudes(): Promise<Solicitud[]> {
    const eventos = await this.adaptador.leerEventosBitacora();
    const clientes = new Map((await this.adaptador.listarClientes()).map((c) => [c.idCliente, c.nombreCompleto]));
    return this.proyectarSolicitudes(eventos, clientes);
  }

  async obtenerSolicitud(idSolicitud: string): Promise<Solicitud> {
    const s = (await this.listarSolicitudes()).find((x) => x.idSolicitud === idSolicitud);
    if (!s) throw new ErrorNegocio('ENTIDAD_INEXISTENTE', `Solicitud no encontrada: ${idSolicitud}`);
    return s;
  }

  async crearSolicitud(nueva: NuevaSolicitud, usuario: string): Promise<{ solicitud: Solicitud; plan: PlanSimulado }> {
    return this.adaptador.exclusivo(async () => {
      const fecha = validarFecha(nueva.fecha, 'fecha');
      const capital = this.validarCapital(nueva.capital);
      if (!Number.isInteger(nueva.plazoMeses) || nueva.plazoMeses < LIMITES.plazoMin || nueva.plazoMeses > LIMITES.plazoMax) {
        throw new ErrorNegocio('DATOS_INVALIDOS', 'El plazo debe ser de 3 a 24 meses (MAN-PRODUCTO-01)', { campo: 'plazoMeses' });
      }
      if (!Number.isInteger(nueva.tnaBps) || nueva.tnaBps < 1 || nueva.tnaBps > 9999) {
        throw new ErrorNegocio('DATOS_INVALIDOS', 'La tasa nominal anual debe expresarse en puntos básicos (1 a 9999)', { campo: 'tnaBps' });
      }
      const cliente = (await this.adaptador.listarClientes()).find((c) => c.idCliente === nueva.idCliente);
      if (!cliente) throw new ErrorNegocio('ENTIDAD_INEXISTENTE', `Cliente no encontrado: ${nueva.idCliente}`, { campo: 'idCliente' });
      if (cliente.fechaAlta && cliente.fechaAlta > fecha) {
        throw new ErrorNegocio('DATOS_INVALIDOS', `El cliente fue dado de alta el ${cliente.fechaAlta}, después de la solicitud`);
      }
      const asesores = await this.adaptador.listarAsesores();
      if (asesores.length > 0 && !asesores.some((a) => a.idAsesor === nueva.idAsesor)) {
        throw new ErrorNegocio('ENTIDAD_INEXISTENTE', `Asesor no encontrado: ${nueva.idAsesor}`, { campo: 'idAsesor' });
      }
      const existentes = await this.listarSolicitudes();
      const idSolicitud = nueva.idSolicitud?.trim() || `SOL-${String(existentes.length + 1).padStart(4, '0')}`;
      if (!/^SOL-\d{4,8}$/.test(idSolicitud)) throw new ErrorNegocio('DATOS_INVALIDOS', 'idSolicitud debe tener formato SOL-0001');
      if (existentes.some((s) => s.idSolicitud === idSolicitud)) throw new ErrorNegocio('ENTIDAD_DUPLICADA', `La solicitud ${idSolicitud} ya existe`);

      // El núcleo valida el alta de la solicitud (capital positivo, identificador).
      this.creditoDelNucleo(idSolicitud, capital, nueva.tnaBps, fecha);
      const plan = this.adaptador.simularPlan(capital, nueva.plazoMeses, nueva.tnaBps, fecha);

      await this.escribir({
        tipo: 'SOLICITUD',
        clave: `SOLICITUD:${idSolicitud}`,
        fecha,
        usuario: requerido(usuario, 'usuario'),
        datos: {
          id_solicitud: idSolicitud,
          id_cliente: nueva.idCliente,
          id_asesor: nueva.idAsesor,
          capital_centavos: Number(dineroACentavos(capital)),
          plazo_meses: nueva.plazoMeses,
          tna_bps: nueva.tnaBps,
          fecha,
        },
      });
      return { solicitud: await this.obtenerSolicitud(idSolicitud), plan };
    });
  }

  async resolverSolicitud(
    idSolicitud: string,
    resolucion: { decision: 'APROBADA' | 'RECHAZADA'; motivo: string; fecha: string },
    usuario: string,
  ): Promise<Solicitud> {
    return this.adaptador.exclusivo(async () => {
      const fecha = validarFecha(resolucion.fecha, 'fecha');
      const s = await this.obtenerSolicitud(idSolicitud);
      if (fecha < s.fecha) throw new ErrorNegocio('DATOS_INVALIDOS', 'La resolución no puede ser anterior a la solicitud');
      const credito = this.creditoDelNucleo(s.idSolicitud, s.capital, s.tnaBps, s.fecha);
      this.reproducir(credito, s);
      const contexto = { fecha: parseISO(fecha), usuario: requerido(usuario, 'usuario'), motivo: requerido(resolucion.motivo, 'motivo') };
      this.transicion(() => (resolucion.decision === 'APROBADA' ? credito.aprobar(contexto) : credito.rechazar(contexto)));
      await this.escribir({
        tipo: 'RESOLUCION',
        clave: `RESOLUCION:${idSolicitud}`,
        fecha,
        usuario,
        datos: { id_solicitud: idSolicitud, decision: resolucion.decision, motivo: resolucion.motivo, fecha },
      });
      return this.obtenerSolicitud(idSolicitud);
    });
  }

  async desembolsar(idSolicitud: string, datos: { idCredito: string; fecha: string }, usuario: string): Promise<DetalleCredito> {
    return this.adaptador.exclusivo(async () => {
      const fecha = validarFecha(datos.fecha, 'fecha');
      const idCredito = requerido(datos.idCredito, 'idCredito');
      if (!/^CV-\d{4}-\d{4}$/.test(idCredito)) throw new ErrorNegocio('DATOS_INVALIDOS', 'idCredito debe tener formato CV-2026-0000');
      if (await this.adaptador.existeCredito(idCredito)) throw new ErrorNegocio('ENTIDAD_DUPLICADA', `El crédito ${idCredito} ya existe`);
      const s = await this.obtenerSolicitud(idSolicitud);
      if (s.resolucion && fecha < s.resolucion.fecha) throw new ErrorNegocio('DATOS_INVALIDOS', 'El desembolso no puede ser anterior a la aprobación');
      const credito = this.creditoDelNucleo(s.idSolicitud, s.capital, s.tnaBps, s.fecha);
      this.reproducir(credito, s);
      this.transicion(() => credito.desembolsar({ fecha: parseISO(fecha), usuario: requerido(usuario, 'usuario'), motivo: 'Desembolso' }));
      await this.escribir({
        tipo: 'DESEMBOLSO',
        clave: `DESEMBOLSO:${idCredito}`,
        fecha,
        usuario,
        datos: {
          id_credito: idCredito,
          id_solicitud: idSolicitud,
          id_cliente: s.idCliente,
          id_asesor: s.idAsesor,
          fecha,
          capital_centavos: Number(dineroACentavos(s.capital)),
          plazo_meses: s.plazoMeses,
          tna_bps: s.tnaBps,
          reestructurado: false,
        },
      });
      return this.adaptador.obtenerDetalleCredito(idCredito, fecha);
    });
  }

  // ---------------- Pagos (OP-1, OP-2, OP-4, OP-5, OP-6) ----------------

  async registrarPago(pago: PagoRegistro): Promise<ResultadoRegistroPago> {
    return this.adaptador.exclusivo(async () => {
      const clave = requerido(pago.claveIdempotencia, 'claveIdempotencia');
      if (clave.length > 64) throw new ErrorNegocio('DATOS_INVALIDOS', 'La clave de idempotencia no puede superar 64 caracteres');
      if (!CANALES.includes(pago.canal)) throw new ErrorNegocio('DATOS_INVALIDOS', `Canal inválido: ${pago.canal}`, { campo: 'canal' });
      const usuario = requerido(pago.usuario, 'usuario');

      const simulacion = await this.adaptador.simularLiquidacionPago({
        idCredito: pago.idCredito,
        monto: pago.monto,
        fechaPago: pago.fechaPago,
        claveIdempotencia: clave,
      });

      if (simulacion.resultado === 'DUPLICADO') {
        return {
          resultado: 'DUPLICADO',
          claveIdempotencia: clave,
          pagoOriginal: simulacion.pagoOriginal,
          credito: await this.adaptador.obtenerDetalleCredito(pago.idCredito, pago.fechaPago),
        };
      }
      if (simulacion.resultado === 'RECHAZADO') {
        throw new ErrorNegocio(simulacion.motivo, simulacion.mensaje, {
          ...(simulacion.montoExigido ? { montoExigido: simulacion.montoExigido.formato() } : {}),
          ...(simulacion.cuota ? { numeroCuota: simulacion.cuota.numero } : {}),
        });
      }
      if (!pago.aprobacion?.aprobado || !pago.aprobacion.aprobadoPor?.trim()) {
        throw new ErrorNegocio('APROBACION_REQUERIDA', 'Registrar un pago exige la aprobación explícita de una persona. Revise el desglose y confirme.', {
          montoExigido: simulacion.cuota.total.formato(),
          numeroCuota: simulacion.cuota.numero,
        });
      }

      await this.escribir({
        tipo: 'PAGO',
        clave: `PAGO:${clave}`,
        fecha: simulacion.fechaPago,
        usuario,
        aprobadoPor: pago.aprobacion.aprobadoPor.trim(),
        datos: {
          clave_idempotencia: clave,
          id_credito: pago.idCredito,
          fecha: simulacion.fechaPago,
          monto_centavos: Number(dineroACentavos(simulacion.cuota.total)),
          canal: pago.canal,
        },
      });
      return {
        resultado: 'APLICADO',
        claveIdempotencia: clave,
        cuota: simulacion.cuota,
        aplicacion: simulacion.aplicacion,
        credito: await this.adaptador.obtenerDetalleCredito(pago.idCredito, simulacion.fechaPago),
      };
    });
  }

  // ---------------- Internos ----------------

  private async escribir(evento: Parameters<typeof agregarEvento>[1]): Promise<void> {
    try {
      await agregarEvento(this.adaptador.db, evento);
    } catch (error) {
      if (error instanceof ClaveDuplicada) throw new ErrorNegocio('ENTIDAD_DUPLICADA', error.message);
      throw error;
    }
  }

  private validarCapital(valor: string): Dinero {
    if (typeof valor !== 'string' || !/^\d+(\.\d{1,2})?$/.test(valor.trim())) {
      throw new ErrorNegocio('DATOS_INVALIDOS', 'El capital debe ser un monto con hasta dos decimales', { campo: 'capital' });
    }
    const capital = Dinero.de(valor.trim());
    if (capital.valor.lessThan(LIMITES.capitalMin) || capital.valor.greaterThan(LIMITES.capitalMax)) {
      throw new ErrorNegocio('DATOS_INVALIDOS', 'El capital debe estar entre Q1,000.00 y Q25,000.00 (MAN-PRODUCTO-01)', { campo: 'capital' });
    }
    return capital;
  }

  private creditoDelNucleo(id: string, capital: Dinero, tnaBps: number, fecha: string): Credito {
    const politica = crearPoliticaCredito({
      id: 'PRODUCTO-MICROCREDITO',
      version: '1',
      vigenteDesde: fecha,
      autor: 'Comité de Crédito',
      tasaOrdinariaMensual: new Decimal(tnaBps).div(10000).div(12),
      tasaMoratoriaAnual: '0.24',
      baseDias: 360,
    });
    return Credito.solicitado(id, capital, politica);
  }

  /** Lleva la máquina de estados del núcleo al estado actual de la solicitud. */
  private reproducir(credito: Credito, s: Solicitud): void {
    if (!s.resolucion) return;
    const contexto = { fecha: parseISO(s.resolucion.fecha), usuario: s.resolucion.usuario, motivo: s.resolucion.motivo };
    if (s.resolucion.decision === 'APROBADA') credito.aprobar(contexto);
    else credito.rechazar(contexto);
    if (s.estado === 'DESEMBOLSADA') credito.desembolsar({ ...contexto, motivo: 'Desembolso' });
  }

  private transicion(fn: () => void): void {
    try {
      fn();
    } catch (error) {
      throw new ErrorNegocio('TRANSICION_INVALIDA', (error as Error).message);
    }
  }

  private proyectarSolicitudes(eventos: EventoBitacora[], clientes: Map<string, string>): Solicitud[] {
    const mapa = new Map<string, Solicitud>();
    for (const e of eventos) {
      const d = e.datos;
      if (e.tipo === 'SOLICITUD') {
        mapa.set(String(d.id_solicitud), {
          idSolicitud: String(d.id_solicitud),
          idCliente: String(d.id_cliente),
          nombreCliente: clientes.get(String(d.id_cliente)) ?? '',
          idAsesor: String(d.id_asesor),
          capital: Dinero.de(new Decimal(String(d.capital_centavos)).div(100)),
          plazoMeses: Number(d.plazo_meses),
          tnaBps: Number(d.tna_bps),
          fecha: String(d.fecha),
          estado: 'SOLICITADA',
        });
      } else if (e.tipo === 'RESOLUCION') {
        const s = mapa.get(String(d.id_solicitud));
        if (s) {
          const decision = d.decision === 'APROBADA' ? 'APROBADA' : 'RECHAZADA';
          s.estado = decision;
          s.resolucion = { decision, motivo: String(d.motivo), fecha: String(d.fecha), usuario: e.usuario };
        }
      } else if (e.tipo === 'DESEMBOLSO' && d.id_solicitud) {
        const s = mapa.get(String(d.id_solicitud));
        if (s) {
          s.estado = 'DESEMBOLSADA';
          s.idCredito = String(d.id_credito);
        }
      }
    }
    return [...mapa.values()];
  }
}
