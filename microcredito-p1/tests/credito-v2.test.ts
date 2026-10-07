import { describe, expect, it } from 'vitest';
import { Credito, type ContextoTransicionCredito } from '../src/dominio/credito.js';
import { Dinero } from '../src/dominio/dinero.js';
import type { Adeudo } from '../src/dominio/prelacion-pago.js';
import { crearPoliticaCredito } from '../src/dominio/politica-credito.js';

describe('ciclo de vida de credito - v2', () => {
  const contexto = (fecha: string, usuario: string, motivo: string): ContextoTransicionCredito => ({ fecha: new Date(fecha), usuario, motivo });
  const fechaPrueba = contexto('2026-08-28T10:00:00-06:00', 'sistema', 'Transicion de prueba');
  const politica = crearPoliticaCredito({
    id: 'POL-001',
    version: '1.0',
    vigenteDesde: '2026-08-01',
    autor: 'comite',
    tasaOrdinariaMensual: '0.03',
    tasaMoratoriaAnual: '0.24',
    baseDias: 360,
  });

  const adeudo = (capital: string): Adeudo => ({
    gastos: Dinero.cero(),
    interesMoratorio: Dinero.de('7.26'),
    interesCorriente: Dinero.de('278.86'),
    capital: Dinero.de(capital),
  });

  const creditoDesembolsado = (politicaCredito = politica): Credito => {
    const credito = Credito.solicitado('C-004', Dinero.de('10000.00'), politicaCredito);
    credito.aprobar(contexto('2026-08-25T10:00:00-06:00', 'comite', 'Cumple politica'));
    credito.desembolsar(contexto('2026-08-26T10:00:00-06:00', 'tesoreria', 'Capital entregado'));
    credito.activar(contexto('2026-08-26T10:01:00-06:00', 'sistema', 'Credito habilitado'));
    return credito;
  };

  it('CP-04.1: un credito en mora queda cancelado cuando se salda por completo', () => {
    const credito = creditoDesembolsado();
    credito.actualizarMora(45, Dinero.de('100.00'), fechaPrueba);
    expect(credito.estado).toBe('EN_MORA');

    const pagoTotal = credito.registrarPago(
      Dinero.de('10000.00'),
      0,
      Dinero.cero(),
      {
        gastos: Dinero.cero(),
        interesMoratorio: Dinero.cero(),
        interesCorriente: Dinero.cero(),
        capital: Dinero.de('10000.00'),
      },
      fechaPrueba,
    );

    expect(pagoTotal.tipo).toBe('APLICACION');
    expect(credito.estado).toBe('CANCELADO');
    expect(credito.saldoCapital.esCero()).toBe(true);
    expect(credito.saldoVencido.esCero()).toBe(true);
  });

  it('CP-03: sigue siendo imposible pagar un credito en estado solicitado', () => {
    const solicitado = Credito.solicitado('C-005', Dinero.de('5000.00'), politica);
    expect(solicitado.estado).toBe('SOLICITADO');
    expect(() => solicitado.registrarPago(Dinero.de('100.00'), 0, Dinero.cero(), adeudo('5000.00'), fechaPrueba)).toThrow(/Pago rechazado/);
  });

  it('CP-04.2: acumula el devengo no reconocido una vez y lo transfiere al regularizar', () => {
    const credito = creditoDesembolsado();

    credito.actualizarMora(90, Dinero.de('100.00'), fechaPrueba);
    expect(credito.estado).toBe('EN_MORA');
    expect(credito.interesCorrienteSuspendido).toBe(false);
    const corte90 = credito.calcularAdeudoCuota(1, Dinero.de('100.00'), Dinero.de('20.00'), 90, 'corte-90');
    expect(corte90.adeudo.interesCorriente.formato()).toBe('20.00');
    expect(credito.interesCorrienteReconocido.formato()).toBe('20.00');
    expect(credito.interesEnSuspenso.formato()).toBe('0.00');

    credito.actualizarMora(100, Dinero.de('200.00'), fechaPrueba);
    expect(credito.estado).toBe('EN_MORA');
    expect(credito.diasAtraso).toBe(100);
    expect(credito.interesCorrienteSuspendido).toBe(true);

    const corte100 = credito.calcularAdeudoCuota(1, Dinero.de('200.00'), Dinero.de('5.00'), 100, 'corte-100');
    expect(corte100.adeudo.interesCorriente.formato()).toBe('0.00');
    expect(corte100.devengoInteresCorriente.suspendido.formato()).toBe('5.00');
    expect(credito.interesCorrienteReconocido.formato()).toBe('20.00');
    expect(credito.interesEnSuspenso.formato()).toBe('5.00');

    const corte100Repetido = credito.calcularAdeudoCuota(1, Dinero.de('200.00'), Dinero.de('5.00'), 100, 'corte-100');
    expect(corte100Repetido.devengoInteresCorriente.duplicado).toBe(true);
    expect(credito.interesCorrienteReconocido.formato()).toBe('20.00');
    expect(credito.interesEnSuspenso.formato()).toBe('5.00');

    credito.reestructurar(contexto('2026-08-29T10:00:00-06:00', 'comite', 'Acuerdo de regularizacion'));
    const interesReconocidoAlRegularizar = credito.regularizar(contexto('2026-08-30T10:00:00-06:00', 'sistema', 'Credito regularizado'));
    expect(interesReconocidoAlRegularizar.formato()).toBe('5.00');
    expect(credito.interesCorrienteSuspendido).toBe(false);
    expect(credito.interesCorrienteReconocido.formato()).toBe('25.00');
    expect(credito.interesEnSuspenso.formato()).toBe('0.00');

    expect(credito.reactivarInteresCorriente().formato()).toBe('0.00');
    expect(credito.interesCorrienteReconocido.formato()).toBe('25.00');
  });

  it('CP-04.3 y M-5: el núcleo calcula el exigible, desglose moratorio y prelación para política escalonada', () => {
    const politicaEscalonada = crearPoliticaCredito({ ...politica, vigenteDesde: '2026-10-01' });
    const credito = creditoDesembolsado(politicaEscalonada);
    credito.actualizarMora(45, Dinero.de('725.76'), fechaPrueba);

    const resultado = credito.calcularAdeudoCuota(2, Dinero.de('725.76'), Dinero.de('278.86'), 45, 'M-5');
    const { adeudo } = resultado;
    const totalExigible = adeudo.gastos.sumar(adeudo.interesMoratorio).sumar(adeudo.interesCorriente).sumar(adeudo.capital);

    expect(resultado.gastoGenerado.formato()).toBe('25.00');
    expect(resultado.desgloseMora.totalMoratorio.formato()).toBe('18.14');
    expect(adeudo.gastos.formato()).toBe('25.00');
    expect(adeudo.interesMoratorio.formato()).toBe('18.14');
    expect(adeudo.interesCorriente.formato()).toBe('278.86');
    expect(adeudo.capital.formato()).toBe('725.76');
    expect(totalExigible.formato()).toBe('1047.76');

    const pago = credito.registrarPago(Dinero.de('330.00'), 45, Dinero.de('725.76'), adeudo, fechaPrueba, 'amortizacion_capital', 2);
    expect(pago.tipo).toBe('APLICACION');
    if (pago.tipo !== 'APLICACION') throw new Error('Se esperaba una aplicación de pago');
    expect(pago.aplicado.gastos.formato()).toBe('25.00');
    expect(pago.aplicado.interesMoratorio.formato()).toBe('18.14');
    expect(pago.aplicado.interesCorriente.formato()).toBe('278.86');
    expect(pago.aplicado.capital.formato()).toBe('8.00');

    const cierreRepetido = credito.calcularAdeudoCuota(2, Dinero.de('725.76'), Dinero.de('278.86'), 60, 'M-5-cierre-2');
    expect(cierreRepetido.gastoGenerado.formato()).toBe('0.00');
    expect(cierreRepetido.adeudo.gastos.formato()).toBe('0.00');
  });
});
