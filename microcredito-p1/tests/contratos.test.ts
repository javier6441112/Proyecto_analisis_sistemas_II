import { describe, expect, it } from 'vitest';
import { ClienteResponseSchema, RegistrarClienteRequestSchema } from '../src/contratos/clientes.js';
import { CarteraEnRiesgoQuerySchema, CarteraEnRiesgoResponseSchema } from '../src/contratos/cartera.js';
import { CreditoResponseSchema, DesembolsarCreditoRequestSchema } from '../src/contratos/creditos.js';
import { CierreResponseSchema, GenerarCierreRequestSchema } from '../src/contratos/cierres.js';
import { PagoRegistradoSchema, RegistrarPagoRequestSchema } from '../src/contratos/pagos.js';
import { SolicitarCreditoRequestSchema, SolicitudCreditoResponseSchema } from '../src/contratos/solicitudes.js';
import { documentoOpenAPI } from '../src/openapi.js';

const pagoValido = {
  monto: { valor: '1011.88', moneda: 'GTQ' },
  fechaPago: '2026-08-22',
  medio: 'agente_bancario',
  referencia: 'BOL-88213',
};

describe('contratos Zod del SGMC', () => {
  it('acepta un cliente valido y rechaza datos incompletos', () => {
    expect(RegistrarClienteRequestSchema.safeParse({ nombre: 'Ana Lopez', identificacion: 'DPI-1234567890101' }).success).toBe(true);
    expect(RegistrarClienteRequestSchema.safeParse({ nombre: '', identificacion: 'DPI-123' }).success).toBe(false);
    expect(ClienteResponseSchema.safeParse({ id: 'CLI-001', nombre: 'Ana Lopez', identificacion: 'DPI-1234567890101' }).success).toBe(true);
  });

  it('acepta una solicitud de credito valida y rechaza cuotas invalidas', () => {
    expect(SolicitarCreditoRequestSchema.safeParse({ clienteId: 'CLI-001', montoSolicitado: { valor: '10000.00', moneda: 'GTQ' }, numeroCuotas: 12 }).success).toBe(true);
    expect(SolicitarCreditoRequestSchema.safeParse({ clienteId: 'CLI-001', montoSolicitado: { valor: '1000.00', moneda: 'GTQ' }, numeroCuotas: 3 }).success).toBe(true);
    expect(SolicitarCreditoRequestSchema.safeParse({ clienteId: 'CLI-001', montoSolicitado: { valor: '25000.00', moneda: 'GTQ' }, numeroCuotas: 24 }).success).toBe(true);
    expect(SolicitarCreditoRequestSchema.safeParse({ clienteId: 'CLI-001', montoSolicitado: { valor: '10000.00', moneda: 'GTQ' }, numeroCuotas: 2 }).success).toBe(false);
    expect(SolicitarCreditoRequestSchema.safeParse({ clienteId: 'CLI-001', montoSolicitado: { valor: '10000.00', moneda: 'GTQ' }, numeroCuotas: 25 }).success).toBe(false);
    expect(SolicitarCreditoRequestSchema.safeParse({ clienteId: 'CLI-001', montoSolicitado: { valor: '999.99', moneda: 'GTQ' }, numeroCuotas: 12 }).success).toBe(false);
    expect(SolicitarCreditoRequestSchema.safeParse({ clienteId: 'CLI-001', montoSolicitado: { valor: '25000.01', moneda: 'GTQ' }, numeroCuotas: 12 }).success).toBe(false);
    expect(SolicitudCreditoResponseSchema.safeParse({ id: 'SOL-001', clienteId: 'CLI-001', montoSolicitado: { valor: '10000.00', moneda: 'GTQ' }, numeroCuotas: 12, estado: 'solicitada', solicitadaEn: '2026-08-27' }).success).toBe(true);
  });

  it('acepta un desembolso valido y rechaza atrasos negativos', () => {
    expect(DesembolsarCreditoRequestSchema.safeParse({ solicitudId: 'SOL-001', clienteId: 'CLI-001', capital: { valor: '10000.00', moneda: 'GTQ' }, fechaDesembolso: '2026-08-27' }).success).toBe(true);
    expect(CreditoResponseSchema.safeParse({ id: 'C-004', solicitudId: 'SOL-001', clienteId: 'CLI-001', capital: { valor: '10000.00', moneda: 'GTQ' }, estado: 'vigente', diasAtraso: 0, desembolsadoEn: '2026-08-27' }).success).toBe(true);
    expect(CreditoResponseSchema.safeParse({ id: 'C-004', solicitudId: 'SOL-001', clienteId: 'CLI-001', capital: { valor: '10000.00', moneda: 'GTQ' }, estado: 'vigente', diasAtraso: -1, desembolsadoEn: '2026-08-27' }).success).toBe(false);
  });

  it('acepta un cierre mensual valido y rechaza periodos incorrectos', () => {
    expect(GenerarCierreRequestSchema.safeParse({ periodo: '2026-08', fechaCorte: '2026-08-22' }).success).toBe(true);
    expect(GenerarCierreRequestSchema.safeParse({ periodo: '2026-13', fechaCorte: '2026-08-22' }).success).toBe(false);
    expect(CierreResponseSchema.safeParse({ periodo: '2026-08', fechaCorte: '2026-08-22', carteraActiva: { valor: '800000.00', moneda: 'GTQ' }, saldoEnRiesgo: { valor: '56000.00', moneda: 'GTQ' }, incobrable: { valor: '15000.00', moneda: 'GTQ' } }).success).toBe(true);
    const respuestasCierre = documentoOpenAPI.paths['/cierres'].post.responses;
    expect(respuestasCierre['201'].description).toBe('Cierre mensual generado.');
    expect(respuestasCierre['200'].description).toBe('Cierre mensual existente reproducido sin duplicarlo.');
    expect('409' in respuestasCierre).toBe(false);
  });

  it('acepta un pago valido y rechaza importes no positivos', () => {
    expect(RegistrarPagoRequestSchema.safeParse(pagoValido).success).toBe(true);
    expect(RegistrarPagoRequestSchema.safeParse({ ...pagoValido, monto: { valor: '0.00', moneda: 'GTQ' } }).success).toBe(false);
    expect(RegistrarPagoRequestSchema.safeParse({ ...pagoValido, monto: { valor: 1011.88, moneda: 'GTQ' } }).success).toBe(false);
  });

  it('exige fecha de corte e incluye reestructurados por defecto', () => {
    const resultado = CarteraEnRiesgoQuerySchema.safeParse({ fechaCorte: '2026-08-22' });
    expect(resultado.success).toBe(true);
    expect(resultado.success && resultado.data.incluirReestructurados).toBe(true);
    expect(CarteraEnRiesgoQuerySchema.safeParse({ fechaCorte: '2026-08-22', incluirReestructurados: false }).success).toBe(false);
  });

  it('acepta la respuesta con desglose de pago y cartera', () => {
    expect(PagoRegistradoSchema.safeParse({
      pagoId: 'PG-2026-000731',
      creditoId: 'C-004',
      recibidoEn: '2026-08-22T09:15:00-06:00',
      montoRecibido: { valor: '1011.88', moneda: 'GTQ' },
      aplicacion: {
        gastos: { valor: '0.00', moneda: 'GTQ' },
        interesMoratorio: { valor: '7.26', moneda: 'GTQ' },
        interesCorriente: { valor: '278.86', moneda: 'GTQ' },
        capital: { valor: '725.76', moneda: 'GTQ' },
        excedente: { valor: '0.00', moneda: 'GTQ' },
      },
      destinoExcedente: null,
      saldoCapitalDespues: { valor: '8569.62', moneda: 'GTQ' },
      estadoCredito: 'vigente',
      tramoMora: 'ninguno',
      diasAtraso: 0,
      reproducido: false,
    }).success).toBe(true);
    expect(CarteraEnRiesgoResponseSchema.safeParse({
      fechaCorte: '2026-08-22',
      carteraActiva: { valor: '800000.00', moneda: 'GTQ' },
      saldoEnRiesgo: { valor: '56000.00', moneda: 'GTQ' },
      porcentajeEnRiesgo: 0.07,
      dadoPorIncobrableEnElPeriodo: { valor: '15000.00', moneda: 'GTQ' },
      porTramo: [],
      reestructuradosAlDia: { creditos: 1, saldoCapital: { valor: '6000.00', moneda: 'GTQ' } },
    }).success).toBe(true);
  });
});
