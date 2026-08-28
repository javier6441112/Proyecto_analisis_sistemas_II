import { Dinero } from './dinero.js';

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

export type TramoMora = 'AL_DIA' | 'MORA_1' | 'MORA_2' | 'MORA_3' | 'VENCIDO';

export interface RegistroTransicionCredito {
  fecha: Date;
  usuarioOProceso: string;
  motivo: string;
  estadoAnterior: EstadoCredito;
  estadoNuevo: EstadoCredito;
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
}

export type ResultadoPago = AplicacionPagoCredito | RecuperacionCredito;

type Accion = (credito: Credito, usuario: string, motivo: string) => void;

interface EstadoCreditoState {
  readonly nombre: EstadoCredito;
  aprobar: Accion;
  rechazar: Accion;
  anular: Accion;
  desembolsar: Accion;
  activar: Accion;
  actualizarMora: (credito: Credito, dias: number, saldo: Dinero, usuario: string, motivo: string) => void;
  registrarPago: (credito: Credito, monto: Dinero, dias: number, saldo: Dinero, capital: Dinero, usuario: string, motivo: string) => ResultadoPago;
  reestructurar: Accion;
  regularizar: Accion;
  cancelar: Accion;
  declararIncobrable: Accion;
}

abstract class EstadoBase implements EstadoCreditoState {
  abstract readonly nombre: EstadoCredito;

  aprobar(_credito: Credito, _usuario: string, _motivo: string): void { this.invalida('aprobar'); }
  rechazar(_credito: Credito, _usuario: string, _motivo: string): void { this.invalida('rechazar'); }
  anular(_credito: Credito, _usuario: string, _motivo: string): void { this.invalida('anular'); }
  desembolsar(_credito: Credito, _usuario: string, _motivo: string): void { this.invalida('desembolsar'); }
  activar(_credito: Credito, _usuario: string, _motivo: string): void { this.invalida('activar'); }
  actualizarMora(_credito: Credito, _dias: number, _saldo: Dinero, _usuario: string, _motivo: string): void { this.invalida('actualizarMora'); }
  registrarPago(_credito: Credito, _monto: Dinero, _dias: number, _saldo: Dinero, _capital: Dinero, _usuario: string, _motivo: string): ResultadoPago { throw new Error(`Pago rechazado: el credito esta ${this.nombre}`); }
  reestructurar(_credito: Credito, _usuario: string, _motivo: string): void { this.invalida('reestructurar'); }
  regularizar(_credito: Credito, _usuario: string, _motivo: string): void { this.invalida('regularizar'); }
  cancelar(_credito: Credito, _usuario: string, _motivo: string): void { this.invalida('cancelar'); }
  declararIncobrable(_credito: Credito, _usuario: string, _motivo: string): void { this.invalida('declararIncobrable'); }

  private invalida(accion: string): never {
    throw new Error(`Transicion invalida desde ${this.nombre}: ${accion}`);
  }
}

class EstadoSolicitado extends EstadoBase {
  readonly nombre = 'SOLICITADO' as const;

  aprobar(credito: Credito, usuario: string, motivo: string): void { credito.cambiarEstado(new EstadoAprobado(), usuario, motivo); }
  rechazar(credito: Credito, usuario: string, motivo: string): void { credito.cambiarEstado(new EstadoRechazado(), usuario, motivo); }
}

class EstadoAprobado extends EstadoBase {
  readonly nombre = 'APROBADO' as const;

  desembolsar(credito: Credito, usuario: string, motivo: string): void { credito.cambiarEstado(new EstadoDesembolsado(), usuario, motivo); }
  anular(credito: Credito, usuario: string, motivo: string): void { credito.cambiarEstado(new EstadoAnulado(), usuario, motivo); }
}

class EstadoDesembolsado extends EstadoBase {
  readonly nombre = 'DESEMBOLSADO' as const;

  activar(credito: Credito, usuario: string, motivo: string): void { credito.cambiarEstado(new EstadoVigente(), usuario, motivo); }
}

class EstadoRechazado extends EstadoBase { readonly nombre = 'RECHAZADO' as const; }
class EstadoAnulado extends EstadoBase { readonly nombre = 'ANULADO' as const; }
class EstadoCancelado extends EstadoBase { readonly nombre = 'CANCELADO' as const; }

class EstadoIncobrable extends EstadoBase {
  readonly nombre = 'INCOBRABLE' as const;

  registrarPago(credito: Credito, monto: Dinero): RecuperacionCredito {
    return { tipo: 'RECUPERACION', monto, creditoId: credito.id };
  }
}

abstract class EstadoActivo extends EstadoBase {
  actualizarMora(credito: Credito, dias: number, saldo: Dinero, usuario: string, motivo: string): void {
    credito.actualizarSaldos(dias, saldo);
    if (dias > 120) {
      credito.cambiarEstado(new EstadoIncobrable(), usuario, motivo);
      return;
    }
    credito.cambiarEstado(new EstadoEnMora(), usuario, motivo);
  }

  registrarPago(
    credito: Credito,
    monto: Dinero,
    dias: number,
    saldo: Dinero,
    capital: Dinero,
    usuario: string,
    motivo: string,
  ): AplicacionPagoCredito {
    credito.validarPago(monto, dias, saldo, capital);
    credito.actualizarSaldos(dias, saldo);
    if (capital.esCero()) credito.cambiarEstado(new EstadoCancelado(), usuario, motivo);
    else if (dias === 0) credito.cambiarEstado(new EstadoVigente(), usuario, motivo);
    else credito.cambiarEstado(new EstadoEnMora(), usuario, motivo);
    return { tipo: 'APLICACION', monto, creditoId: credito.id, estado: credito.estado };
  }

  reestructurar(credito: Credito, usuario: string, motivo: string): void {
    credito.cambiarEstado(new EstadoReestructurado(), usuario, motivo);
  }

  declararIncobrable(credito: Credito, usuario: string, motivo: string): void {
    credito.validarIncobrable();
    credito.cambiarEstado(new EstadoIncobrable(), usuario, motivo);
  }
}

class EstadoVigente extends EstadoActivo { readonly nombre = 'VIGENTE' as const; }
class EstadoEnMora extends EstadoActivo { readonly nombre = 'EN_MORA' as const; }

class EstadoReestructurado extends EstadoActivo {
  readonly nombre = 'REESTRUCTURADO' as const;

  regularizar(credito: Credito, usuario: string, motivo: string): void {
    credito.marcarReestructurado();
    credito.cambiarEstado(new EstadoVigente(), usuario, motivo);
  }
}

export class Credito {
  private estadoActual: EstadoCreditoState = new EstadoSolicitado();
  private _diasAtraso = 0;
  private _saldoVencido: Dinero;
  private readonly transiciones: RegistroTransicionCredito[] = [];
  private reestructuradoHistorico = false;

  private constructor(public readonly id: string, public readonly capital: Dinero) {
    this._saldoVencido = Dinero.cero(capital.moneda);
  }

  static solicitado(id: string, capital: Dinero): Credito {
    if (!id) throw new Error('El credito debe tener identificador');
    if (capital.esCero() || capital.valor.isNegative()) throw new Error('El capital debe ser positivo');
    return new Credito(id, capital);
  }

  get estado(): EstadoCredito { return this.estadoActual.nombre; }
  get diasAtraso(): number { return this._diasAtraso; }
  get saldoVencido(): Dinero { return this._saldoVencido; }
  get tramoMora(): TramoMora { return Credito.tramoParaDias(this._diasAtraso); }
  get fueReestructurado(): boolean { return this.reestructuradoHistorico; }
  get historial(): readonly RegistroTransicionCredito[] { return this.transiciones.map((item) => ({ ...item, fecha: new Date(item.fecha) })); }

  aprobar(usuario = 'sistema', motivo = 'Comite aprobo la solicitud'): void { this.estadoActual.aprobar(this, usuario, motivo); }
  rechazar(usuario = 'sistema', motivo = 'Comite rechazo la solicitud'): void { this.estadoActual.rechazar(this, usuario, motivo); }
  anular(usuario = 'sistema', motivo = 'Aprobacion expirada o cliente desiste'): void { this.estadoActual.anular(this, usuario, motivo); }
  desembolsar(usuario = 'sistema', motivo = 'Capital entregado'): void { this.estadoActual.desembolsar(this, usuario, motivo); }
  activar(usuario = 'sistema', motivo = 'Credito activado despues del desembolso'): void { this.estadoActual.activar(this, usuario, motivo); }

  actualizarMora(dias: number, saldo: Dinero, usuario = 'sistema', motivo = 'Actualizacion de atraso'): void {
    this.validarDatosDeMora(dias, saldo);
    this.estadoActual.actualizarMora(this, dias, saldo, usuario, motivo);
  }

  registrarPago(monto: Dinero, dias: number, saldo: Dinero, capital = this.capital, usuario = 'sistema', motivo = 'Pago recibido'): ResultadoPago {
    if (monto.esCero() || monto.valor.isNegative()) throw new Error('El pago debe ser positivo');
    return this.estadoActual.registrarPago(this, monto, dias, saldo, capital, usuario, motivo);
  }

  reestructurar(usuario = 'comite', motivo = 'Nuevas condiciones autorizadas'): void { this.estadoActual.reestructurar(this, usuario, motivo); }
  regularizar(usuario = 'sistema', motivo = 'Politica de regularizacion cumplida'): void { this.estadoActual.regularizar(this, usuario, motivo); }
  cancelar(usuario = 'sistema', motivo = 'Saldo de capital agotado'): void { this.estadoActual.cancelar(this, usuario, motivo); }
  declararIncobrable(usuario = 'sistema', motivo = 'Supera 120 dias sin arreglo'): void { this.estadoActual.declararIncobrable(this, usuario, motivo); }

  cambiarEstado(estado: EstadoCreditoState, usuario: string, motivo: string): void {
    const anterior = this.estado;
    this.estadoActual = estado;
    this.transiciones.push({ fecha: new Date(), usuarioOProceso: usuario, motivo, estadoAnterior: anterior, estadoNuevo: estado.nombre });
  }

  actualizarSaldos(dias: number, saldo: Dinero): void { this._diasAtraso = dias; this._saldoVencido = saldo; }
  marcarReestructurado(): void { this.reestructuradoHistorico = true; }

  validarPago(monto: Dinero, dias: number, saldo: Dinero, capital: Dinero): void {
    this.validarDatosDeMora(dias, saldo);
    if (monto.moneda !== this.capital.moneda || capital.moneda !== this.capital.moneda) throw new Error('El pago debe usar la moneda del credito');
    if (capital.valor.isNegative()) throw new Error('El saldo de capital no puede ser negativo');
  }

  validarIncobrable(): void {
    if (this.estado !== 'EN_MORA' || this._diasAtraso <= 120) throw new Error('Solo un credito en mora con mas de 120 dias puede ser incobrable');
  }

  static tramoParaDias(dias: number): TramoMora {
    if (dias === 0) return 'AL_DIA';
    if (dias <= 30) return 'MORA_1';
    if (dias <= 60) return 'MORA_2';
    if (dias <= 90) return 'MORA_3';
    return 'VENCIDO';
  }

  private validarDatosDeMora(dias: number, saldo: Dinero): void {
    if (!Number.isInteger(dias) || dias < 0) throw new Error('Los dias de atraso deben ser enteros no negativos');
    if (saldo.moneda !== this.capital.moneda) throw new Error('El saldo vencido debe usar la moneda del credito');
    if (saldo.valor.isNegative()) throw new Error('El saldo vencido no puede ser negativo');
  }
}
