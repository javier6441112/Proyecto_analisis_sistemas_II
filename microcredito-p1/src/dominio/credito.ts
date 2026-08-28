import { Dinero } from './dinero.js';

export type EstadoCreditoNombre =
  | 'SOLICITADO'
  | 'APROBADO'
  | 'DESEMBOLSADO'
  | 'VIGENTE'
  | 'MORA_1'
  | 'MORA_2'
  | 'RECHAZADO'
  | 'INCOBRABLE';

export interface RecuperacionCredito {
  tipo: 'RECUPERACION';
  monto: Dinero;
  creditoId: string;
}

export interface AplicacionPagoCredito {
  tipo: 'APLICACION';
  monto: Dinero;
  creditoId: string;
  estado: EstadoCreditoNombre;
}

type ResultadoPago = AplicacionPagoCredito | RecuperacionCredito;

interface EstadoCredito {
  readonly nombre: EstadoCreditoNombre;
  aprobar(credito: Credito): void;
  desembolsar(credito: Credito): void;
  rechazar(credito: Credito): void;
  actualizarMora(credito: Credito, diasAtraso: number, saldoVencido: Dinero): void;
  registrarPago(credito: Credito, monto: Dinero, diasAtrasoRestantes: number, saldoVencidoRestante: Dinero): ResultadoPago;
  marcarIncobrable(credito: Credito): void;
}

abstract class EstadoCreditoBase implements EstadoCredito {
  abstract readonly nombre: EstadoCreditoNombre;

  aprobar(_credito: Credito): void {
    throw new Error(`Transicion invalida desde ${this.nombre}: aprobar`);
  }

  desembolsar(_credito: Credito): void {
    throw new Error(`Transicion invalida desde ${this.nombre}: desembolsar`);
  }

  rechazar(_credito: Credito): void {
    throw new Error(`Transicion invalida desde ${this.nombre}: rechazar`);
  }

  actualizarMora(_credito: Credito, _diasAtraso: number, _saldoVencido: Dinero): void {
    throw new Error(`Transicion invalida desde ${this.nombre}: actualizarMora`);
  }

  registrarPago(_credito: Credito, _monto: Dinero, _diasAtrasoRestantes: number, _saldoVencidoRestante: Dinero): ResultadoPago {
    throw new Error(`Pago rechazado: el credito esta ${this.nombre}`);
  }

  marcarIncobrable(_credito: Credito): void {
    throw new Error(`Transicion invalida desde ${this.nombre}: marcarIncobrable`);
  }
}

class EstadoSolicitado extends EstadoCreditoBase {
  readonly nombre = 'SOLICITADO' as const;

  aprobar(credito: Credito): void {
    credito.cambiarEstado(new EstadoAprobado());
  }

  rechazar(credito: Credito): void {
    credito.cambiarEstado(new EstadoRechazado());
  }
}

class EstadoAprobado extends EstadoCreditoBase {
  readonly nombre = 'APROBADO' as const;

  desembolsar(credito: Credito): void {
    credito.cambiarEstado(new EstadoVigente());
  }
}

class EstadoRechazado extends EstadoCreditoBase {
  readonly nombre = 'RECHAZADO' as const;
}

class EstadoIncobrable extends EstadoCreditoBase {
  readonly nombre = 'INCOBRABLE' as const;

  registrarPago(credito: Credito, monto: Dinero): RecuperacionCredito {
    return { tipo: 'RECUPERACION', monto, creditoId: credito.id };
  }
}

abstract class EstadoActivo extends EstadoCreditoBase {
  actualizarMora(credito: Credito, diasAtraso: number, saldoVencido: Dinero): void {
    credito.actualizarSaldos(diasAtraso, saldoVencido);
    credito.cambiarEstado(Credito.estadoParaDias(diasAtraso));
  }

  registrarPago(credito: Credito, monto: Dinero, diasAtrasoRestantes: number, saldoVencidoRestante: Dinero): AplicacionPagoCredito {
    credito.validarPago(monto, diasAtrasoRestantes, saldoVencidoRestante);
    credito.actualizarSaldos(diasAtrasoRestantes, saldoVencidoRestante);
    credito.cambiarEstado(Credito.estadoParaDias(diasAtrasoRestantes));
    return { tipo: 'APLICACION', monto, creditoId: credito.id, estado: credito.estado };
  }

  marcarIncobrable(credito: Credito): void {
    credito.cambiarEstado(new EstadoIncobrable());
  }
}

class EstadoVigente extends EstadoActivo {
  readonly nombre = 'VIGENTE' as const;
}

class EstadoMora1 extends EstadoActivo {
  readonly nombre = 'MORA_1' as const;
}

class EstadoMora2 extends EstadoActivo {
  readonly nombre = 'MORA_2' as const;
}

export class Credito {
  private estadoActual: EstadoCredito;
  private _diasAtraso = 0;
  private _saldoVencido: Dinero;

  private constructor(
    public readonly id: string,
    public readonly capital: Dinero,
  ) {
    this.estadoActual = new EstadoSolicitado();
    this._saldoVencido = Dinero.cero(capital.moneda);
  }

  static solicitado(id: string, capital: Dinero): Credito {
    if (!id) throw new Error('El credito debe tener identificador');
    if (capital.esCero() || capital.valor.isNegative()) throw new Error('El capital debe ser positivo');
    return new Credito(id, capital);
  }

  get estado(): EstadoCreditoNombre {
    return this.estadoActual.nombre;
  }

  get diasAtraso(): number {
    return this._diasAtraso;
  }

  get saldoVencido(): Dinero {
    return this._saldoVencido;
  }

  aprobar(): void {
    this.estadoActual.aprobar(this);
  }

  desembolsar(): void {
    this.estadoActual.desembolsar(this);
  }

  rechazar(): void {
    this.estadoActual.rechazar(this);
  }

  actualizarMora(diasAtraso: number, saldoVencido: Dinero): void {
    this.validarDatosDeMora(diasAtraso, saldoVencido);
    this.estadoActual.actualizarMora(this, diasAtraso, saldoVencido);
  }

  registrarPago(monto: Dinero, diasAtrasoRestantes: number, saldoVencidoRestante: Dinero): ResultadoPago {
    if (monto.esCero() || monto.valor.isNegative()) throw new Error('El pago debe ser positivo');
    return this.estadoActual.registrarPago(this, monto, diasAtrasoRestantes, saldoVencidoRestante);
  }

  marcarIncobrable(): void {
    this.estadoActual.marcarIncobrable(this);
  }

  cambiarEstado(estado: EstadoCredito): void {
    this.estadoActual = estado;
  }

  actualizarSaldos(diasAtraso: number, saldoVencido: Dinero): void {
    this._diasAtraso = diasAtraso;
    this._saldoVencido = saldoVencido;
  }

  validarPago(monto: Dinero, diasAtrasoRestantes: number, saldoVencidoRestante: Dinero): void {
    this.validarDatosDeMora(diasAtrasoRestantes, saldoVencidoRestante);
    if (monto.moneda !== this.capital.moneda) throw new Error('El pago debe usar la moneda del credito');
  }

  static estadoParaDias(diasAtraso: number): EstadoCredito {
    if (diasAtraso === 0) return new EstadoVigente();
    if (diasAtraso <= 30) return new EstadoMora1();
    return new EstadoMora2();
  }

  private validarDatosDeMora(diasAtraso: number, saldoVencido: Dinero): void {
    if (!Number.isInteger(diasAtraso) || diasAtraso < 0) throw new Error('Los dias de atraso deben ser enteros no negativos');
    if (saldoVencido.moneda !== this.capital.moneda) throw new Error('El saldo vencido debe usar la moneda del credito');
    if (saldoVencido.valor.isNegative()) throw new Error('El saldo vencido no puede ser negativo');
  }
}
