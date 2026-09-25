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

  const creditoDesembolsado = (): Credito => {
    const credito = Credito.solicitado('C-004', Dinero.de('10000.00'), politica);
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

  it('CP-04.2: al superar los 90 dias se suspende el devengo del interes corriente y queda en suspenso', () => {
    const credito = creditoDesembolsado();

    credito.actualizarMora(90, Dinero.de('100.00'), fechaPrueba);
    expect(credito.estado).toBe('EN_MORA');
    expect(credito.interesCorrienteSuspendido).toBe(false);

    credito.actualizarMora(100, Dinero.de('200.00'), fechaPrueba);
    expect(credito.estado).toBe('EN_MORA');
    expect(credito.diasAtraso).toBe(100);
    expect(credito.interesCorrienteSuspendido).toBe(true);
  });
});
