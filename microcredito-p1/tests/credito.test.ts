import { describe, expect, it } from 'vitest';
import { Credito } from '../src/dominio/credito.js';
import { Dinero } from '../src/dominio/dinero.js';

describe('ciclo de vida de credito', () => {
  const creditoDesembolsado = (): Credito => {
    const credito = Credito.solicitado('C-004', Dinero.de('10000.00'));
    credito.aprobar();
    credito.desembolsar();
    credito.activar();
    return credito;
  };

  it('transita Mora 2 a Mora 1 y luego a vigente al pagar lo vencido', () => {
    const credito = creditoDesembolsado();

    credito.actualizarMora(45, Dinero.de('1000.00'));
    expect(credito.estado).toBe('EN_MORA');
    expect(credito.tramoMora).toBe('MORA_2');

    const pagoParcial = credito.registrarPago(Dinero.de('500.00'), 10, Dinero.de('500.00'), Dinero.de('9000.00'));
    expect(pagoParcial.tipo).toBe('APLICACION');
    expect(credito.estado).toBe('EN_MORA');
    expect(credito.tramoMora).toBe('MORA_1');
    expect(credito.diasAtraso).toBe(10);

    const pagoFinal = credito.registrarPago(Dinero.de('500.00'), 0, Dinero.cero(), Dinero.de('9000.00'));
    expect(pagoFinal.tipo).toBe('APLICACION');
    expect(credito.estado).toBe('VIGENTE');
    expect(credito.saldoVencido.esCero()).toBe(true);
  });

  it('rechaza pagos para creditos solicitados y rechazados', () => {
    const solicitado = Credito.solicitado('C-005', Dinero.de('5000.00'));
    expect(() => solicitado.registrarPago(Dinero.de('100.00'), 0, Dinero.cero())).toThrow(/Pago rechazado/);

    solicitado.rechazar();
    expect(() => solicitado.aprobar()).toThrow(/Transicion invalida/);
    expect(() => solicitado.registrarPago(Dinero.de('100.00'), 0, Dinero.cero())).toThrow(/Pago rechazado/);
  });

  it('mantiene incobrable como estado irreversible y separa la recuperacion', () => {
    const credito = creditoDesembolsado();
    expect(() => credito.declararIncobrable()).toThrow(/mas de 120 dias/);
    credito.actualizarMora(121, Dinero.de('1000.00'));

    expect(credito.estado).toBe('INCOBRABLE');
    expect(() => credito.desembolsar()).toThrow(/Transicion invalida/);

    const recuperacion = credito.registrarPago(Dinero.de('200.00'), 0, Dinero.cero());
    expect(recuperacion).toMatchObject({ tipo: 'RECUPERACION', creditoId: 'C-004' });
    expect(recuperacion.monto.formato()).toBe('200.00');
    expect(credito.estado).toBe('INCOBRABLE');
  });

  it('pasa por desembolsado, registra historial y conserva marca de reestructuracion', () => {
    const credito = Credito.solicitado('C-006', Dinero.de('5000.00'));
    credito.aprobar('comite', 'Politica cumplida');
    credito.desembolsar('tesoreria', 'Capital entregado');
    expect(credito.estado).toBe('DESEMBOLSADO');
    credito.activar('sistema', 'Credito habilitado');
    credito.actualizarMora(45, Dinero.de('300.00'));
    credito.reestructurar('comite', 'Nuevas condiciones');
    credito.regularizar('sistema', 'Regularizacion cumplida');

    expect(credito.estado).toBe('VIGENTE');
    expect(credito.fueReestructurado).toBe(true);
    expect(credito.historial).toEqual(expect.arrayContaining([
      expect.objectContaining({ usuarioOProceso: 'comite', motivo: 'Nuevas condiciones', estadoAnterior: 'EN_MORA', estadoNuevo: 'REESTRUCTURADO' }),
      expect.objectContaining({ estadoAnterior: 'REESTRUCTURADO', estadoNuevo: 'VIGENTE' }),
    ]));
  });

  it('cancela al agotar el capital e impide operar estados terminales', () => {
    const credito = creditoDesembolsado();
    credito.registrarPago(Dinero.de('10000.00'), 0, Dinero.cero(), Dinero.cero());
    expect(credito.estado).toBe('CANCELADO');
    expect(() => credito.actualizarMora(1, Dinero.de('1.00'))).toThrow(/Transicion invalida/);

    const anulado = Credito.solicitado('C-007', Dinero.de('1000.00'));
    anulado.aprobar();
    anulado.anular();
    expect(() => anulado.registrarPago(Dinero.de('10.00'), 0, Dinero.cero())).toThrow(/Pago rechazado/);
  });
});