import { describe, expect, it } from 'vitest';
import { Dinero } from '../src/dominio/dinero.js';
import { aplicarExcedente, aplicarPago, type Adeudo } from '../src/dominio/prelacion-pago.js';

const adeudo: Adeudo = {
  gastos: Dinero.de('0'),
  interesMoratorio: Dinero.de('7.26'),
  interesCorriente: Dinero.de('278.86'),
  capital: Dinero.de('725.76'),
};

describe('prelacion de pagos', () => {
  it('aplica un pago parcial en el orden exigido', () => {
    const resultado = aplicarPago(Dinero.de('500'), adeudo);
    expect(resultado.aplicado.interesMoratorio.formato()).toBe('7.26');
    expect(resultado.aplicado.interesCorriente.formato()).toBe('278.86');
    expect(resultado.aplicado.capital.formato()).toBe('213.88');
    expect(resultado.cuotaSaldada).toBe(false);
  });

  it('aplica exactamente una cuota de Q1,011.88', () => {
    const resultado = aplicarPago(Dinero.de('1011.88'), adeudo);
    expect(resultado.aplicado.interesMoratorio.formato()).toBe('7.26');
    expect(resultado.aplicado.interesCorriente.formato()).toBe('278.86');
    expect(resultado.aplicado.capital.formato()).toBe('725.76');
    expect(resultado.cuotaSaldada).toBe(true);
    expect(resultado.remanente.esCero()).toBe(true);
  });

  it('deja el excedente a favor del cliente', () => {
    const resultado = aplicarPago(Dinero.de('3000'), adeudo);
    expect(resultado.cuotaSaldada).toBe(true);
    expect(resultado.remanente.formato()).toBe('1988.12');
  });

  it('rechaza pagos y adeudos negativos', () => {
    expect(() => aplicarPago(Dinero.de('-1'), adeudo)).toThrow(/pago debe ser positivo/);
    expect(() => aplicarPago(Dinero.de('1'), { ...adeudo, capital: Dinero.de('-1') })).toThrow(/adeudo de capital/);
  });

  it('aplica el excedente al capital o lo reserva para cuotas futuras', () => {
    const capital = Dinero.de('1000.00');
    const alCapital = aplicarExcedente(Dinero.de('200.00'), capital, 'amortizacion_capital');
    expect(alCapital.montoAplicado.formato()).toBe('200.00');
    expect(alCapital.saldoExcedente.esCero()).toBe(true);
    const futuras = aplicarExcedente(Dinero.de('200.00'), capital, 'cuotas_futuras');
    expect(futuras.montoAplicado.esCero()).toBe(true);
    expect(futuras.saldoExcedente.formato()).toBe('200.00');
  });
});
