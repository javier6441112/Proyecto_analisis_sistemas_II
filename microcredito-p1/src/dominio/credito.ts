import { Decimal } from 'decimal.js';
import { Dinero } from './dinero.js';
import { clasificarMora, type TramoMora } from './calculadora-mora.js';
import { aplicarExcedente, aplicarPago, type Adeudo, type DestinoExcedente } from './prelacion-pago.js';
import type { PoliticaCredito } from './politica-credito.js';
import { resolverPoliticaMoraPorFecha } from './politica-mora/catalogo-politicas.js';
import type { PoliticaMora } from './politica-mora/politica-mora.js';
import type { DesgloseMora } from './politica-mora/politica-mora.js';
import { GastoGestionCobroService } from './politica-mora/gasto-gestion-cobro.js';

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

export interface ResultadoAdeudoCuota {
  readonly adeudo: Adeudo;
  readonly desgloseMora: DesgloseMora;
  readonly gastoGenerado: Dinero;
  readonly devengoInteresCorriente: ResultadoDevengoInteresCorriente;
}

export interface ResultadoDevengoInteresCorriente {
  readonly reconocido: Dinero;
  readonly suspendido: Dinero;
  readonly duplicado: boolean;
}

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
  regularizar: (credito: Credito, contexto: ContextoTransicionCredito) => Dinero;
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
  regularizar(_credito: Credito, _contexto: ContextoTransicionCredito): Dinero { this.invalida('regularizar'); }
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
    if (dias === 0) {
      credito.reactivarInteresCorriente();
      credito.cambiarEstado(new EstadoVigente(), contexto);
    }
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
    credito.validarPago(monto, dias, saldo, adeudo);
    const resultadoAplicacion = aplicarPago(monto, adeudo);
    if (dias === 0 && !resultadoAplicacion.cuotaSaldada) throw new Error('Un pago parcial no puede dejar el credito con cero dias de atraso');
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

  cancelar(credito: Credito, contexto: ContextoTransicionCredito): void {
    if (!credito.saldoCapital.esCero() || !credito.saldoVencido.esCero()) {
      throw new Error('Un credito en mora solo puede cancelarse con saldo cero y cuota vencida saldada');
    }
    credito.cambiarEstado(new EstadoCancelado(), contexto);
  }

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

  regularizar(credito: Credito, contexto: ContextoTransicionCredito): Dinero {
    credito.validarContexto(contexto);
    credito.marcarReestructurado();
    const reconocido = credito.reactivarInteresCorriente();
    credito.cambiarEstado(new EstadoVigente(), contexto);
    return reconocido;
  }
}

export class Credito {
  private estadoActual: EstadoCreditoState = new EstadoSolicitado();
  private _diasAtraso = 0;
  private _saldoVencido: Dinero;
  private _saldoCapital: Dinero;
  private _interesCorrienteSuspendido = false;
  private _interesCorrienteReconocido = new Decimal(0);
  private _interesEnSuspenso = new Decimal(0);
  private readonly transiciones: RegistroTransicionCredito[] = [];
  private reestructuradoHistorico = false;
  private readonly politicaMora: PoliticaMora;
  private readonly gastosGestion = new GastoGestionCobroService();
  private readonly devengosInteresPorPeriodo = new Map<string, { reconocido: Decimal; suspendido: Decimal }>();

  private constructor(public readonly id: string, public readonly capital: Dinero, public readonly politica: PoliticaCredito) {
    this._saldoVencido = Dinero.cero(capital.moneda);
    this._saldoCapital = capital;
    this.politicaMora = resolverPoliticaMoraPorFecha(this.politica.vigenteDesde);
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
  get interesCorrienteReconocido(): Dinero { return Dinero.de(this._interesCorrienteReconocido, this.capital.moneda); }
  get interesEnSuspenso(): Dinero { return Dinero.de(this._interesEnSuspenso, this.capital.moneda); }
  get tramoMora(): TramoMora { return Credito.tramoParaDias(this._diasAtraso); }
  get fueReestructurado(): boolean { return this.reestructuradoHistorico; }
  get politicaActualMora(): PoliticaMora { return this.politicaMora; }
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

  registrarPago(monto: Dinero, dias: number, saldo: Dinero, adeudo: Adeudo, contexto: ContextoTransicionCredito, destino: DestinoExcedente = 'amortizacion_capital', cuotaNumero?: number): ResultadoPago {
    if (monto.esCero() || monto.valor.isNegative()) throw new Error('El pago debe ser positivo');
    if (cuotaNumero !== undefined && (!Number.isInteger(cuotaNumero) || cuotaNumero < 1)) throw new Error('El numero de cuota debe ser entero positivo');
    const resultado = this.estadoActual.registrarPago(this, monto, dias, saldo, adeudo, destino, contexto);
    if (cuotaNumero !== undefined && resultado.tipo === 'APLICACION') {
      this.gastosGestion.registrarPago(this.id, String(cuotaNumero), resultado.aplicado.gastos);
    }
    return resultado;
  }

  reestructurar(contexto: ContextoTransicionCredito): void { this.estadoActual.reestructurar(this, contexto); }
  regularizar(contexto: ContextoTransicionCredito): Dinero { return this.estadoActual.regularizar(this, contexto); }
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
    const saldoResultante = this._saldoCapital.restar(capitalAplicado);
    if (saldoResultante.valor.isNegative()) throw new Error('El saldo de capital no puede ser negativo');
    this._saldoCapital = saldoResultante;
  }
  calcularInteresMoratorio(capitalEnMora: Dinero, diasAtraso: number): Dinero {
    return this.politicaActualMora.calcular(capitalEnMora, diasAtraso);
  }
  desglosarInteresMoratorio(capitalEnMora: Dinero, diasAtraso: number): DesgloseMora {
    return this.politicaActualMora.desglosar(capitalEnMora, diasAtraso);
  }
  calcularAdeudoCuota(cuotaNumero: number, capitalEnMora: Dinero, interesCorriente: Dinero | Decimal | string, diasAtraso: number, periodoId: string): ResultadoAdeudoCuota {
    if (!Number.isInteger(cuotaNumero) || cuotaNumero < 1) throw new Error('El numero de cuota debe ser entero positivo');
    if (!periodoId) throw new Error('El devengo de interes requiere identificador estable de periodo o corte');
    if (capitalEnMora.moneda !== this.capital.moneda) throw new Error('Los importes del adeudo deben usar la moneda del credito');
    if (capitalEnMora.valor.isNegative()) throw new Error('Los importes del adeudo no pueden ser negativos');
    const desgloseMora = this.desglosarInteresMoratorio(capitalEnMora, diasAtraso);
    const devengo = this.registrarDevengoInteresCorriente(periodoId, interesCorriente);
    const gasto = this.gastosGestion.generarSiCorresponde(
      this.id,
      String(cuotaNumero),
      this.politicaMora.id,
      diasAtraso,
      this.capital.moneda,
    );
    return {
      adeudo: {
        gastos: gasto.saldoPendiente,
        interesMoratorio: desgloseMora.totalMoratorio,
        interesCorriente: devengo.reconocido,
        capital: capitalEnMora,
      },
      desgloseMora,
      gastoGenerado: gasto.generado,
      devengoInteresCorriente: devengo,
    };
  }
  marcarReestructurado(): void { this.reestructuradoHistorico = true; }
  registrarDevengoInteresCorriente(periodoId: string, importe: Dinero | Decimal | string): ResultadoDevengoInteresCorriente {
    if (!periodoId) throw new Error('El devengo de interes requiere identificador estable de periodo o corte');
    if (importe instanceof Dinero && importe.moneda !== this.capital.moneda) throw new Error('El interes corriente debe usar la moneda del credito');
    const importeDecimal = importe instanceof Dinero ? importe.valor : new Decimal(importe);
    if (!importeDecimal.isFinite() || importeDecimal.isNegative()) throw new Error('El interes corriente debe ser finito y no negativo');
    const previo = this.devengosInteresPorPeriodo.get(periodoId);
    if (previo) return {
      reconocido: Dinero.de(previo.reconocido, this.capital.moneda),
      suspendido: Dinero.de(previo.suspendido, this.capital.moneda),
      duplicado: true,
    };

    const reconocido = this._interesCorrienteSuspendido ? new Decimal(0) : importeDecimal;
    const suspendido = this._interesCorrienteSuspendido ? importeDecimal : new Decimal(0);
    this._interesCorrienteReconocido = this._interesCorrienteReconocido.plus(reconocido);
    this._interesEnSuspenso = this._interesEnSuspenso.plus(suspendido);
    this.devengosInteresPorPeriodo.set(periodoId, { reconocido, suspendido });
    const resultado = { reconocido, suspendido, duplicado: false };
    return {
      reconocido: Dinero.de(resultado.reconocido, this.capital.moneda),
      suspendido: Dinero.de(resultado.suspendido, this.capital.moneda),
      duplicado: resultado.duplicado,
    };
  }

  reactivarInteresCorriente(): Dinero {
    this._interesCorrienteSuspendido = false;
    const transferido = this._interesEnSuspenso;
    this._interesCorrienteReconocido = this._interesCorrienteReconocido.plus(transferido);
    this._interesEnSuspenso = new Decimal(0);
    return Dinero.de(transferido, this.capital.moneda);
  }

  validarPago(monto: Dinero, dias: number, saldo: Dinero, adeudo: Adeudo): void {
    this.validarDatosDeMora(dias, saldo);
    if (monto.moneda !== this.capital.moneda) throw new Error('El pago debe usar la moneda del credito');
    if (adeudo.capital.mayorQue(this._saldoCapital)) throw new Error('El capital adeudado no puede superar el saldo del credito');
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
    if (dias === 0 && !saldo.esCero()) throw new Error('Un credito al dia no puede tener saldo vencido');
    if (dias > 0 && saldo.esCero()) throw new Error('Un credito en mora debe tener saldo vencido');
  }
}
