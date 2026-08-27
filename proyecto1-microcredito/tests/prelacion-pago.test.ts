import { describe, expect, it } from 'vitest';
import { Dinero } from '../src/dominio/dinero.js';
import { aplicarPago, type Adeudo } from '../src/dominio/prelacion-pago.js';

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

  it('deja el excedente a favor del cliente', () => {
    const resultado = aplicarPago(Dinero.de('3000'), adeudo);
    expect(resultado.cuotaSaldada).toBe(true);
    expect(resultado.remanente.formato()).toBe('1988.12');
  });
});
