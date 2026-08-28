import { Dinero } from './dinero.js';
import { clasificarMora, type TramoMora } from './calculadora-mora.js';
import { aplicarExcedente, aplicarPago, type Adeudo, type DestinoExcedente } from './prelacion-pago.js';
import type { PoliticaCredito } from './politica-credito.js';

export type EstadoCredito =
  | 'SOLICITADO'
  | 'APROBADO'
  | 'DESEMBOLSADO'
  | 'VIGENTE'
  | 'EN_MORA'
  | 'REESTRUCTURADO'
  | 'CANCELADO'
  | 'RECHAZADO'
  | 'ANULADO'
  | 'INCOBRABLE';

export interface RegistroTransicionCredito {
  fecha: Date;
  usuario: string;
  motivo: string;
  estadoAnterior: EstadoCredito;
  estadoNuevo: EstadoCredito;
}

export interface ContextoTransicionCredito {
  fecha: Date;
  usuario: string;
  motivo: string;
}

export interface RecuperacionCredito {
  tipo: 'RECUPERACION';
  monto: Dinero;
  creditoId: string;
}

export interface AplicacionPagoCredito {
  tipo: 'APLICACION';
  monto: Dinero;
  creditoId: string;
  estado: EstadoCredito;
  aplicado: Adeudo;
  excedente?: { destino: DestinoExcedente; montoAplicado: Dinero; saldoExcedente: Dinero };
}

export type ResultadoPago = AplicacionPagoCredito | RecuperacionCredito;

type Accion = (credito: Credito, contexto: ContextoTransicionCredito) => void;

interface EstadoCreditoState {
  readonly nombre: EstadoCredito;
  aprobar: Accion;
  rechazar: Accion;
  anular: Accion;
  desembolsar: Accion;
  activar: Accion;
  actualizarMora: (credito: Credito, dias: number, saldo: Dinero, contexto: ContextoTransicionCredito) => void;
  registrarPago: (credito: Credito, monto: Dinero, dias: number, saldo: Dinero, adeudo: Adeudo, destino: DestinoExcedente, contexto: ContextoTransicionCredito) => ResultadoPago;
  reestructurar: Accion;
  regularizar: Accion;
  cancelar: Accion;
  declararIncobrable: Accion;
}

abstract class EstadoBase implements EstadoCreditoState {
  abstract readonly nombre: EstadoCredito;

  aprobar(_credito: Credito, _contexto: ContextoTransicionCredito): void { this.invalida('aprobar'); }
  rechazar(_credito: Credito, _contexto: ContextoTransicionCredito): void { this.invalida('rechazar'); }
  anular(_credito: Credito, _contexto: ContextoTransicionCredito): void { this.invalida('anular'); }
  desembolsar(_credito: Credito, _contexto: ContextoTransicionCredito): void { this.invalida('desembolsar'); }
  activar(_credito: Credito, _contexto: ContextoTransicionCredito): void { this.invalida('activar'); }
  actualizarMora(_credito: Credito, _dias: number, _saldo: Dinero, _contexto: ContextoTransicionCredito): void { this.invalida('actualizarMora'); }
  registrarPago(_credito: Credito, _monto: Dinero, _dias: number, _saldo: Dinero, _adeudo: Adeudo, _destino: DestinoExcedente, _contexto: ContextoTransicionCredito): ResultadoPago { throw new Error(`Pago rechazado: el credito esta ${this.nombre}`); }
  reestructurar(_credito: Credito, _contexto: ContextoTransicionCredito): void { this.invalida('reestructurar'); }
  regularizar(_credito: Credito, _contexto: ContextoTransicionCredito): void { this.invalida('regularizar'); }
  cancelar(_credito: Credito, _contexto: ContextoTransicionCredito): void { this.invalida('cancelar'); }
  declararIncobrable(_credito: Credito, _contexto: ContextoTransicionCredito): void { this.invalida('declararIncobrable'); }

  private invalida(accion: string): never {
    throw new Error(`Transicion invalida desde ${this.nombre}: ${accion}`);
  }
}

class EstadoSolicitado extends EstadoBase {
  readonly nombre = 'SOLICITADO' as const;

  aprobar(credito: Credito, contexto: ContextoTransicionCredito): void { credito.cambiarEstado(new EstadoAprobado(), contexto); }
  rechazar(credito: Credito, contexto: ContextoTransicionCredito): void { credito.cambiarEstado(new EstadoRechazado(), contexto); }
}

class EstadoAprobado extends EstadoBase {
  readonly nombre = 'APROBADO' as const;

  desembolsar(credito: Credito, contexto: ContextoTransicionCredito): void { credito.cambiarEstado(new EstadoDesembolsado(), contexto); }
  anular(credito: Credito, contexto: ContextoTransicionCredito): void { credito.cambiarEstado(new EstadoAnulado(), contexto); }
}

class EstadoDesembolsado extends EstadoBase {
  readonly nombre = 'DESEMBOLSADO' as const;

  activar(credito: Credito, contexto: ContextoTransicionCredito): void { credito.cambiarEstado(new EstadoVigente(), contexto); }
}

class EstadoRechazado extends EstadoBase { readonly nombre = 'RECHAZADO' as const; }
class EstadoAnulado extends EstadoBase { readonly nombre = 'ANULADO' as const; }
class EstadoCancelado extends EstadoBase { readonly nombre = 'CANCELADO' as const; }

class EstadoIncobrable extends EstadoBase {
  readonly nombre = 'INCOBRABLE' as const;

  registrarPago(credito: Credito, monto: Dinero, _dias: number, _saldo: Dinero, _adeudo: Adeudo, _destino: DestinoExcedente, contexto: ContextoTransicionCredito): RecuperacionCredito {
    credito.validarContexto(contexto);
    if (monto.moneda !== credito.capital.moneda) throw new Error('La recuperacion debe usar la moneda del credito');
    return { tipo: 'RECUPERACION', monto, creditoId: credito.id };
  }
}

abstract class EstadoActivo extends EstadoBase {
  actualizarMora(credito: Credito, dias: number, saldo: Dinero, contexto: ContextoTransicionCredito): void {
    credito.actualizarSaldos(dias, saldo);
    if (dias > 120) {
      credito.cambiarEstado(new EstadoIncobrable(), contexto);
      return;
    }
    if (dias === 0) credito.cambiarEstado(new EstadoVigente(), contexto);
    else credito.cambiarEstado(new EstadoEnMora(), contexto);
  }

  registrarPago(
    credito: Credito,
    monto: Dinero,
    dias: number,
    saldo: Dinero,
    adeudo: Adeudo,
    destino: DestinoExcedente,
    contexto: ContextoTransicionCredito,
  ): AplicacionPagoCredito {
    credito.validarPago(monto, dias, saldo);
    const resultadoAplicacion = aplicarPago(monto, adeudo);
    credito.actualizarSaldoCapital(resultadoAplicacion.aplicado.capital);
    credito.actualizarSaldos(dias, saldo);
    const excedente = resultadoAplicacion.remanente.esCero() ? undefined : aplicarExcedente(resultadoAplicacion.remanente, credito.saldoCapital, destino);
    if (excedente) credito.actualizarSaldoCapital(excedente.montoAplicado);
    if (credito.saldoCapital.esCero()) credito.cambiarEstado(new EstadoCancelado(), contexto);
    else if (dias === 0 && resultadoAplicacion.cuotaSaldada) {
      credito.reactivarInteresCorriente();
      credito.cambiarEstado(new EstadoVigente(), contexto);
    }
    else credito.cambiarEstado(new EstadoEnMora(), contexto);
    return { tipo: 'APLICACION', monto, creditoId: credito.id, estado: credito.estado, aplicado: resultadoAplicacion.aplicado, ...(excedente ? { excedente } : {}) };
  }

  declararIncobrable(credito: Credito, contexto: ContextoTransicionCredito): void {
    credito.validarIncobrable();
    credito.cambiarEstado(new EstadoIncobrable(), contexto);
  }
}

class EstadoVigente extends EstadoActivo { readonly nombre = 'VIGENTE' as const; }
class EstadoEnMora extends EstadoActivo {
  readonly nombre = 'EN_MORA' as const;

  reestructurar(credito: Credito, contexto: ContextoTransicionCredito): void {
    credito.cambiarEstado(new EstadoReestructurado(), contexto);
  }
}

class EstadoReestructurado extends EstadoActivo {
  readonly nombre = 'REESTRUCTURADO' as const;

  actualizarMora(credito: Credito, dias: number, saldo: Dinero, contexto: ContextoTransicionCredito): void {
    super.actualizarMora(credito, dias, saldo, contexto);
    credito.marcarReestructurado();
  }

  registrarPago(
    credito: Credito,
    monto: Dinero,
    dias: number,
    saldo: Dinero,
    adeudo: Adeudo,
    destino: DestinoExcedente,
    contexto: ContextoTransicionCredito,
  ): AplicacionPagoCredito {
    const resultado = super.registrarPago(credito, monto, dias, saldo, adeudo, destino, contexto);
    credito.marcarReestructurado();
    return resultado;
  }

  regularizar(credito: Credito, contexto: ContextoTransicionCredito): void {
    credito.marcarReestructurado();
    credito.reactivarInteresCorriente();
    credito.cambiarEstado(new EstadoVigente(), contexto);
  }
}

export class Credito {
  private estadoActual: EstadoCreditoState = new EstadoSolicitado();
  private _diasAtraso = 0;
  private _saldoVencido: Dinero;
  private _saldoCapital: Dinero;
  private _interesCorrienteSuspendido = false;
  private readonly transiciones: RegistroTransicionCredito[] = [];
  private reestructuradoHistorico = false;

  private constructor(public readonly id: string, public readonly capital: Dinero, public readonly politica: PoliticaCredito) {
    this._saldoVencido = Dinero.cero(capital.moneda);
    this._saldoCapital = capital;
  }

  static solicitado(id: string, capital: Dinero, politica: PoliticaCredito): Credito {
    if (!id) throw new Error('El credito debe tener identificador');
    if (capital.esCero() || capital.valor.isNegative()) throw new Error('El capital debe ser positivo');
    return new Credito(id, capital, politica);
  }

  get estado(): EstadoCredito { return this.estadoActual.nombre; }
  get diasAtraso(): number { return this._diasAtraso; }
  get saldoVencido(): Dinero { return this._saldoVencido; }
  get saldoCapital(): Dinero { return this._saldoCapital; }
  get interesCorrienteSuspendido(): boolean { return this._interesCorrienteSuspendido; }
  get tramoMora(): TramoMora { return Credito.tramoParaDias(this._diasAtraso); }
  get fueReestructurado(): boolean { return this.reestructuradoHistorico; }
  get historial(): readonly RegistroTransicionCredito[] { return this.transiciones.map((item) => ({ ...item, fecha: new Date(item.fecha.getTime()) })); }

  aprobar(contexto: ContextoTransicionCredito): void { this.estadoActual.aprobar(this, contexto); }
  rechazar(contexto: ContextoTransicionCredito): void { this.estadoActual.rechazar(this, contexto); }
  anular(contexto: ContextoTransicionCredito): void { this.estadoActual.anular(this, contexto); }
  desembolsar(contexto: ContextoTransicionCredito): void { this.estadoActual.desembolsar(this, contexto); }
  activar(contexto: ContextoTransicionCredito): void { this.estadoActual.activar(this, contexto); }

  actualizarMora(dias: number, saldo: Dinero, contexto: ContextoTransicionCredito): void {
    this.validarDatosDeMora(dias, saldo);
    this.estadoActual.actualizarMora(this, dias, saldo, contexto);
  }

  registrarPago(monto: Dinero, dias: number, saldo: Dinero, adeudo: Adeudo, contexto: ContextoTransicionCredito, destino: DestinoExcedente = 'amortizacion_capital'): ResultadoPago {
    if (monto.esCero() || monto.valor.isNegative()) throw new Error('El pago debe ser positivo');
    return this.estadoActual.registrarPago(this, monto, dias, saldo, adeudo, destino, contexto);
  }

  reestructurar(contexto: ContextoTransicionCredito): void { this.estadoActual.reestructurar(this, contexto); }
  regularizar(contexto: ContextoTransicionCredito): void { this.estadoActual.regularizar(this, contexto); }
  cancelar(contexto: ContextoTransicionCredito): void { this.estadoActual.cancelar(this, contexto); }
  declararIncobrable(contexto: ContextoTransicionCredito): void { this.estadoActual.declararIncobrable(this, contexto); }

  cambiarEstado(estado: EstadoCreditoState, contexto: ContextoTransicionCredito): void {
    this.validarContexto(contexto);
    const anterior = this.estado;
    this.estadoActual = estado;
    this.transiciones.push({ ...contexto, fecha: new Date(contexto.fecha.getTime()), estadoAnterior: anterior, estadoNuevo: estado.nombre });
  }

  actualizarSaldos(dias: number, saldo: Dinero): void {
    this._diasAtraso = dias;
    this._saldoVencido = saldo;
    if (dias > 90) this._interesCorrienteSuspendido = true;
  }
  actualizarSaldoCapital(capitalAplicado: Dinero): void {
    this._saldoCapital = this._saldoCapital.restar(capitalAplicado);
  }
  marcarReestructurado(): void { this.reestructuradoHistorico = true; }
  reactivarInteresCorriente(): void { this._interesCorrienteSuspendido = false; }

  validarPago(monto: Dinero, dias: number, saldo: Dinero): void {
    this.validarDatosDeMora(dias, saldo);
    if (monto.moneda !== this.capital.moneda) throw new Error('El pago debe usar la moneda del credito');
  }

  validarContexto(contexto: ContextoTransicionCredito): void {
    if (!(contexto.fecha instanceof Date) || Number.isNaN(contexto.fecha.getTime())) throw new Error('La fecha de transicion debe ser valida');
    if (!contexto.usuario || !contexto.motivo) throw new Error('La transicion requiere usuario y motivo');
  }

  validarIncobrable(): void {
    if (this.estado !== 'EN_MORA' || this._diasAtraso <= 120) throw new Error('Solo un credito en mora con mas de 120 dias puede ser incobrable');
  }

  static tramoParaDias(dias: number): TramoMora { return clasificarMora(dias); }

  private validarDatosDeMora(dias: number, saldo: Dinero): void {
    if (!Number.isInteger(dias) || dias < 0) throw new Error('Los dias de atraso deben ser enteros no negativos');
    if (saldo.moneda !== this.capital.moneda) throw new Error('El saldo vencido debe usar la moneda del credito');
    if (saldo.valor.isNegative()) throw new Error('El saldo vencido no puede ser negativo');
  }
}
