import { describe, expect, it } from 'vitest';
import { Credito } from '../src/dominio/credito.js';
import { Dinero } from '../src/dominio/dinero.js';

describe('ciclo de vida de credito', () => {
  const creditoDesembolsado = (): Credito => {
    const credito = Credito.solicitado('C-004', Dinero.de('10000.00'));
    credito.aprobar();
    credito.desembolsar();
    return credito;
  };

  it('transita Mora 2 a Mora 1 y luego a vigente al pagar lo vencido', () => {
    const credito = creditoDesembolsado();

    credito.actualizarMora(45, Dinero.de('1000.00'));
    expect(credito.estado).toBe('MORA_2');

    const pagoParcial = credito.registrarPago(Dinero.de('500.00'), 10, Dinero.de('500.00'));
    expect(pagoParcial.tipo).toBe('APLICACION');
    expect(credito.estado).toBe('MORA_1');
    expect(credito.diasAtraso).toBe(10);

    const pagoFinal = credito.registrarPago(Dinero.de('500.00'), 0, Dinero.cero());
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
    credito.marcarIncobrable();

    expect(credito.estado).toBe('INCOBRABLE');
    expect(() => credito.desembolsar()).toThrow(/Transicion invalida/);

    const recuperacion = credito.registrarPago(Dinero.de('200.00'), 0, Dinero.cero());
    expect(recuperacion).toMatchObject({ tipo: 'RECUPERACION', creditoId: 'C-004' });
    expect(recuperacion.monto.formato()).toBe('200.00');
    expect(credito.estado).toBe('INCOBRABLE');
  });
});