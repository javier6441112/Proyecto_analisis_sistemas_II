import { Decimal } from 'decimal.js';

export type Moneda = 'GTQ' | 'USD';

export class Dinero {
  private readonly monto: Decimal;

  private constructor(monto: Decimal, public readonly moneda: Moneda) {
    this.monto = monto.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  }

  static de(valor: string | Decimal, moneda: Moneda = 'GTQ'): Dinero {
    const monto = new Decimal(valor);
    if (!monto.isFinite()) throw new Error('El importe debe ser finito');
    return new Dinero(monto, moneda);
  }

  static cero(moneda: Moneda = 'GTQ'): Dinero {
    return Dinero.de('0', moneda);
  }

  get valor(): Decimal {
    return this.monto;
  }

  sumar(otro: Dinero): Dinero {
    this.validarMoneda(otro);
    return new Dinero(this.monto.plus(otro.monto), this.moneda);
  }

  restar(otro: Dinero): Dinero {
    this.validarMoneda(otro);
    return new Dinero(this.monto.minus(otro.monto), this.moneda);
  }

  multiplicar(factor: string | Decimal): Dinero {
    return new Dinero(this.monto.times(factor), this.moneda);
  }

  menorQue(otro: Dinero): boolean {
    this.validarMoneda(otro);
    return this.monto.lessThan(otro.monto);
  }

  mayorQue(otro: Dinero): boolean {
    this.validarMoneda(otro);
    return this.monto.greaterThan(otro.monto);
  }

  esCero(): boolean {
    return this.monto.isZero();
  }

  formato(): string {
    return this.monto.toFixed(2);
  }

  private validarMoneda(otro: Dinero): void {
    if (this.moneda !== otro.moneda) throw new Error('No se pueden operar monedas distintas');
  }
}
