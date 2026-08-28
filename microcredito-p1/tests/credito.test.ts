import { describe, expect, it } from 'vitest';
import { Credito, type ContextoTransicionCredito } from '../src/dominio/credito.js';
import { Dinero } from '../src/dominio/dinero.js';
import type { Adeudo } from '../src/dominio/prelacion-pago.js';

describe('ciclo de vida de credito', () => {
  const contexto = (fecha: string, usuario: string, motivo: string): ContextoTransicionCredito => ({ fecha: new Date(fecha), usuario, motivo });
  const fechaPrueba = contexto('2026-08-28T10:00:00-06:00', 'sistema', 'Transicion de prueba');
  const adeudo = (capital: string): Adeudo => ({ gastos: Dinero.cero(), interesMoratorio: Dinero.de('7.26'), interesCorriente: Dinero.de('278.86'), capital: Dinero.de(capital) });
  const adeudoSinIntereses = (capital: string): Adeudo => ({ gastos: Dinero.cero(), interesMoratorio: Dinero.cero(), interesCorriente: Dinero.cero(), capital: Dinero.de(capital) });

  const creditoDesembolsado = (): Credito => {
    const credito = Credito.solicitado('C-004', Dinero.de('10000.00'));
    credito.aprobar(contexto('2026-08-25T10:00:00-06:00', 'comite', 'Cumple politica'));
    credito.desembolsar(contexto('2026-08-26T10:00:00-06:00', 'tesoreria', 'Capital entregado'));
    credito.activar(contexto('2026-08-26T10:01:00-06:00', 'sistema', 'Credito habilitado'));
    return credito;
  };

  it('transita Mora 2 a Mora 1 y luego a vigente al pagar lo vencido', () => {
    const credito = creditoDesembolsado();

    credito.actualizarMora(45, Dinero.de('1000.00'), fechaPrueba);
    expect(credito.estado).toBe('EN_MORA');
    expect(credito.tramoMora).toBe('MORA_2');

    const pagoParcial = credito.registrarPago(Dinero.de('500.00'), 10, Dinero.de('500.00'), adeudo('10000.00'), fechaPrueba);
    expect(pagoParcial.tipo).toBe('APLICACION');
    expect(pagoParcial.tipo === 'APLICACION' && pagoParcial.aplicado.interesMoratorio.formato()).toBe('7.26');
    expect(pagoParcial.tipo === 'APLICACION' && pagoParcial.aplicado.interesCorriente.formato()).toBe('278.86');
    expect(pagoParcial.tipo === 'APLICACION' && pagoParcial.aplicado.capital.formato()).toBe('213.88');
    expect(credito.estado).toBe('EN_MORA');
    expect(credito.tramoMora).toBe('MORA_1');
    expect(credito.diasAtraso).toBe(10);

    const pagoFinal = credito.registrarPago(Dinero.de('500.00'), 0, Dinero.cero(), adeudo('9786.12'), fechaPrueba);
    expect(pagoFinal.tipo).toBe('APLICACION');
    expect(credito.estado).toBe('VIGENTE');
    expect(credito.saldoVencido.esCero()).toBe(true);
    expect(credito.saldoCapital.formato()).toBe('9572.24');
  });

  it('calcula el saldo de capital internamente y no acepta saldos falsificados', () => {
    const credito = creditoDesembolsado();

    credito.registrarPago(Dinero.de('1.00'), 0, Dinero.cero(), adeudoSinIntereses('10000.00'), fechaPrueba);

    expect(credito.saldoCapital.formato()).toBe('9999.00');
    expect(credito.estado).toBe('VIGENTE');
  });

  it('regresa a vigente cuando actualizarMora recibe cero dias', () => {
    const credito = creditoDesembolsado();
    credito.actualizarMora(10, Dinero.de('100.00'), fechaPrueba);
    credito.actualizarMora(0, Dinero.cero(), fechaPrueba);

    expect(credito.estado).toBe('VIGENTE');
    expect(credito.tramoMora).toBe('AL_DIA');
  });

  it('solo permite reestructurar un credito en mora', () => {
    const vigente = creditoDesembolsado();
    expect(() => vigente.reestructurar(fechaPrueba)).toThrow(/Transicion invalida/);

    vigente.actualizarMora(31, Dinero.de('100.00'), fechaPrueba);
    vigente.reestructurar(fechaPrueba);
    expect(vigente.estado).toBe('REESTRUCTURADO');
  });

  it('rechaza pagos para creditos solicitados y rechazados', () => {
    const solicitado = Credito.solicitado('C-005', Dinero.de('5000.00'));
    expect(() => solicitado.registrarPago(Dinero.de('100.00'), 0, Dinero.cero(), adeudo('5000.00'), fechaPrueba)).toThrow(/Pago rechazado/);

    solicitado.rechazar(fechaPrueba);
    expect(() => solicitado.aprobar(fechaPrueba)).toThrow(/Transicion invalida/);
    expect(() => solicitado.registrarPago(Dinero.de('100.00'), 0, Dinero.cero(), adeudo('5000.00'), fechaPrueba)).toThrow(/Pago rechazado/);
  });

  it('mantiene incobrable como estado irreversible y separa la recuperacion', () => {
    const credito = creditoDesembolsado();
    credito.actualizarMora(121, Dinero.de('1000.00'), fechaPrueba);

    expect(credito.estado).toBe('INCOBRABLE');
    expect(credito.tramoMora).toBe('VENCIDO');
    expect(() => credito.desembolsar(fechaPrueba)).toThrow(/Transicion invalida/);

    const recuperacion = credito.registrarPago(Dinero.de('200.00'), 0, Dinero.cero(), adeudo('10000.00'), fechaPrueba);
    expect(recuperacion).toMatchObject({ tipo: 'RECUPERACION', creditoId: 'C-004' });
    expect(recuperacion.monto.formato()).toBe('200.00');
    expect(credito.estado).toBe('INCOBRABLE');
  });

  it('rechaza recuperaciones en una moneda distinta al credito', () => {
    const credito = creditoDesembolsado();
    credito.actualizarMora(121, Dinero.de('100.00'), fechaPrueba);
    expect(() => credito.registrarPago(Dinero.de('10.00', 'USD'), 0, Dinero.cero(), adeudoSinIntereses('10000.00'), fechaPrueba)).toThrow(/moneda/);
  });

  it('pasa por desembolsado, registra historial y conserva marca de reestructuracion', () => {
    const credito = Credito.solicitado('C-006', Dinero.de('5000.00'));
    credito.aprobar(contexto('2026-08-25T10:00:00-06:00', 'comite', 'Politica cumplida'));
    credito.desembolsar(contexto('2026-08-26T10:00:00-06:00', 'tesoreria', 'Capital entregado'));
    expect(credito.estado).toBe('DESEMBOLSADO');
    credito.activar(contexto('2026-08-26T10:01:00-06:00', 'sistema', 'Credito habilitado'));
    credito.actualizarMora(45, Dinero.de('300.00'), contexto('2026-08-27T10:00:00-06:00', 'sistema', 'Atraso detectado'));
    credito.reestructurar(contexto('2026-08-27T11:00:00-06:00', 'comite', 'Nuevas condiciones'));
    credito.regularizar(contexto('2026-08-28T10:00:00-06:00', 'sistema', 'Regularizacion cumplida'));

    expect(credito.estado).toBe('VIGENTE');
    expect(credito.fueReestructurado).toBe(true);
    expect(credito.historial).toEqual(expect.arrayContaining([
      expect.objectContaining({ usuario: 'comite', motivo: 'Nuevas condiciones', estadoAnterior: 'EN_MORA', estadoNuevo: 'REESTRUCTURADO' }),
      expect.objectContaining({ estadoAnterior: 'REESTRUCTURADO', estadoNuevo: 'VIGENTE' }),
    ]));
    expect(credito.historial.at(-1)?.fecha.toISOString()).toBe('2026-08-28T16:00:00.000Z');
  });

  it('conserva la marca al salir de reestructurado mediante un pago', () => {
    const credito = creditoDesembolsado();
    credito.actualizarMora(10, Dinero.de('100.00'), fechaPrueba);
    credito.reestructurar(fechaPrueba);
    credito.registrarPago(Dinero.de('100.00'), 0, Dinero.cero(), adeudo('5000.00'), fechaPrueba);

    expect(credito.estado).toBe('VIGENTE');
    expect(credito.fueReestructurado).toBe(true);
  });

  it('cancela al agotar el capital e impide operar estados terminales', () => {
    const credito = creditoDesembolsado();
    credito.registrarPago(Dinero.de('10000.00'), 0, Dinero.cero(), { gastos: Dinero.cero(), interesMoratorio: Dinero.cero(), interesCorriente: Dinero.cero(), capital: Dinero.de('9900.00') }, fechaPrueba);
    expect(credito.estado).toBe('CANCELADO');
    expect(() => credito.actualizarMora(1, Dinero.de('1.00'), fechaPrueba)).toThrow(/Transicion invalida/);

    const anulado = Credito.solicitado('C-007', Dinero.de('1000.00'));
    anulado.aprobar(fechaPrueba);
    anulado.anular(fechaPrueba);
    expect(() => anulado.registrarPago(Dinero.de('10.00'), 0, Dinero.cero(), adeudo('1000.00'), fechaPrueba)).toThrow(/Pago rechazado/);
  });

  it('suspende intereses corrientes sobre 90 dias y los reactiva al regularizar', () => {
    const credito = creditoDesembolsado();
    credito.actualizarMora(91, Dinero.de('100.00'), fechaPrueba);
    expect(credito.interesCorrienteSuspendido).toBe(true);
    credito.reestructurar(fechaPrueba);
    credito.regularizar(fechaPrueba);
    expect(credito.interesCorrienteSuspendido).toBe(false);
  });
});