/**
 * Integración PGlite (.cv-db) → núcleo financiero.
 *
 * Requiere la base cargada con `npm run cargar:datos`. Las pruebas trabajan sobre una
 * COPIA temporal de `CV_DB_DIR` (o `./.cv-db`), de modo que nunca modifican la base real
 * ni chocan con otras pruebas que la abran.
 *
 * Las cifras esperadas se derivan del enunciado y del corpus normativo:
 *  - POL-2024-01: moratorio = capital en mora × (0.24 ÷ 360) × días, redondeo único.
 *  - POL-2026-10: tramos recorridos 18/24/30/36 %, redondeo único; ejemplo Q18.14.
 *  - POL-COBRO-01: total exigible M-5 = 25.00 + 18.14 + 278.86 + 725.76 = Q1,047.76.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  AdaptadorNucleo,
  ContextoPoliticas,
  ErrorIntegridadCartera,
  deduplicarPagos,
  type DetalleCredito,
  type ParametrosPoliticas,
} from '../src/persistencia/adaptador-nucleo.js';

const CORTE = '2026-10-31';
const ORIGEN_DB = process.env.CV_DB_DIR ?? resolve(process.cwd(), '.cv-db');

/** Serializa Dinero/Decimal a texto para comparar resultados completos. */
function huella(valor: unknown): string {
  return JSON.stringify(valor, (_clave, v: unknown) => {
    if (v && typeof v === 'object' && 'formato' in v && typeof (v as { formato: unknown }).formato === 'function') {
      return (v as { formato(): string }).formato();
    }
    if (v && typeof v === 'object' && v.constructor?.name === 'Decimal') return String(v);
    return v;
  });
}

let copiaDb: string;
let adaptador: AdaptadorNucleo;

beforeAll(async () => {
  if (!existsSync(ORIGEN_DB)) {
    throw new Error(`No existe ${ORIGEN_DB}. Ejecute "npm run cargar:datos" antes de "npm test".`);
  }
  copiaDb = join(mkdtempSync(join(tmpdir(), 'cv-db-prueba-')), 'db');
  cpSync(ORIGEN_DB, copiaDb, { recursive: true });
  adaptador = await AdaptadorNucleo.abrir({ dbDir: copiaDb });
}, 60_000);

afterAll(async () => {
  await adaptador?.cerrar();
  if (copiaDb) rmSync(resolve(copiaDb, '..'), { recursive: true, force: true });
});

describe('Idempotencia de la carga canónica', () => {
  it('consume solo los 226 pagos únicos e ignora IDEM-000068 e IDEM-000127', async () => {
    const auditoria = await adaptador.auditarPagos();
    expect(auditoria.unicos).toBe(226);
    expect(auditoria.registros - auditoria.unicos).toBe(auditoria.ignorados.length);
    if (auditoria.registros === 228) {
      expect([...auditoria.ignorados].sort()).toEqual(['IDEM-000068', 'IDEM-000127']);
    }
  });

  it('la repetición no se aplica dos veces: CV-2026-0007 y CV-2026-0014 no duplican cuotas', async () => {
    const c07 = await adaptador.obtenerDetalleCredito('CV-2026-0007', CORTE);
    const c14 = await adaptador.obtenerDetalleCredito('CV-2026-0014', CORTE);
    expect(c07.pagos.filter((p) => p.claveIdempotencia === 'IDEM-000068')).toHaveLength(1);
    expect(c14.pagos.filter((p) => p.claveIdempotencia === 'IDEM-000127')).toHaveLength(1);
    expect(c07.cuotasPagadas).toBe(6);
    expect(c07.estado).toBe('CANCELADO');
    expect(c07.saldoCapital.formato()).toBe('0.00');
  });

  it('deduplicarPagos conserva la primera aparición de cada clave', () => {
    const base = { idCredito: 'CV-X', fecha: '2026-01-01', montoCentavos: '100', canal: 'campo', origen: 'CARGA_CANONICA' as const };
    const { unicos, ignorados } = deduplicarPagos([
      { ...base, claveIdempotencia: 'K1', orden: 0 },
      { ...base, claveIdempotencia: 'K2', orden: 1 },
      { ...base, claveIdempotencia: 'K1', orden: 2 },
    ]);
    expect(unicos.map((p) => p.orden)).toEqual([0, 1]);
    expect(ignorados.map((p) => p.orden)).toEqual([2]);
  });
});

describe('OP-1 · CV-2026-0043 al 31/10/2026 (POL-2024-01)', () => {
  let detalle: DetalleCredito;

  beforeAll(async () => {
    detalle = await adaptador.obtenerDetalleCredito('CV-2026-0043', CORTE);
  });

  it('saldo Q3,000.00 sin cuotas pagadas y política plana', () => {
    expect(detalle.fechaDesembolso).toBe('2026-08-06');
    expect(detalle.capitalOriginal.formato()).toBe('3000.00');
    expect(detalle.saldoCapital.formato()).toBe('3000.00');
    expect(detalle.cuotasPagadas).toBe(0);
    expect(detalle.politicaMora).toBe('POL-2024-01');
    expect(detalle.estado).toBe('EN_MORA');
  });

  it('cuota 1 en Mora 2 con 55 días de atraso y gasto Q0.00', () => {
    const cuota1 = detalle.cuotasVencidas[0];
    expect(cuota1.numero).toBe(1);
    expect(cuota1.fechaVencimiento).toBe('2026-09-06');
    expect(cuota1.diasAtraso).toBe(55);
    expect(cuota1.tramo).toBe('MORA_2');
    expect(cuota1.gastoGestion.formato()).toBe('0.00');
    // 469.65 × (0.24 ÷ 360) × 55 = 17.2205 → Q17.22
    expect(cuota1.capital.formato()).toBe('469.65');
    expect(cuota1.interesCorriente.formato()).toBe('75.00');
    expect(cuota1.interesMoratorio.formato()).toBe('17.22');
    expect(cuota1.total.formato()).toBe('561.87');
    expect(detalle.diasAtraso).toBe(55);
    expect(detalle.tramo).toBe('MORA_2');
  });

  it('la cuota 2 también está vencida (25 días, Mora 1) y la 3 es la próxima', () => {
    expect(detalle.cuotasVencidas.map((c) => [c.numero, c.diasAtraso, c.tramo])).toEqual([
      [1, 55, 'MORA_2'],
      [2, 25, 'MORA_1'],
    ]);
    expect(detalle.proximaCuota?.numero).toBe(3);
    expect(detalle.proximaCuota?.fechaVencimiento).toBe('2026-11-06');
  });

  it('simula el pago exacto con prelación gastos → moratorio → corriente → capital, sin escribir', async () => {
    const simulacion = await adaptador.simularLiquidacionPago({ idCredito: 'CV-2026-0043', monto: '561.87', fechaPago: CORTE });
    expect(simulacion.resultado).toBe('ACEPTABLE');
    if (simulacion.resultado !== 'ACEPTABLE') return;
    const { aplicado, remanente, cuotaSaldada } = simulacion.aplicacion;
    expect([aplicado.gastos, aplicado.interesMoratorio, aplicado.interesCorriente, aplicado.capital].map((d) => d.formato()))
      .toEqual(['0.00', '17.22', '75.00', '469.65']);
    expect(remanente.formato()).toBe('0.00');
    expect(cuotaSaldada).toBe(true);
    expect(simulacion.saldoCapitalResultante.formato()).toBe('2530.35');

    const despues = await adaptador.obtenerDetalleCredito('CV-2026-0043', CORTE);
    expect(despues.saldoCapital.formato()).toBe('3000.00');
    expect(despues.cuotasPagadas).toBe(0);
  });
});

describe('OP-6 · CV-2026-0015 incobrable (>120 días)', () => {
  it('se clasifica incobrable con fecha de baja del día 121', async () => {
    const detalle = await adaptador.obtenerDetalleCredito('CV-2026-0015', CORTE);
    expect(detalle.cuotasPagadas).toBe(2);
    expect(detalle.cuotasVencidas[0].fechaVencimiento).toBe('2026-06-23');
    expect(detalle.diasAtraso).toBe(130);
    expect(detalle.diasAtraso).toBeGreaterThan(120);
    expect(detalle.estado).toBe('INCOBRABLE');
    expect(detalle.tramo).toBe('INCOBRABLE');
    expect(detalle.fechaIncobrable).toBe('2026-10-22');
    // No devenga más allá del día 120.
    expect(detalle.cuotasVencidas[0].diasDevengo).toBe(120);
  });

  it('rechaza cualquier intento de pago', async () => {
    for (const monto of ['500.00', '296.58']) {
      const r = await adaptador.simularLiquidacionPago({ idCredito: 'CV-2026-0015', monto, fechaPago: CORTE });
      expect(r.resultado).toBe('RECHAZADO');
      if (r.resultado === 'RECHAZADO') {
        expect(r.motivo).toBe('CREDITO_INCOBRABLE');
        expect(r.mensaje).toMatch(/incobrable/);
      }
    }
  });

  it('sale de la cartera activa y se reporta como incobrable del mes', async () => {
    const cartera = await adaptador.resumirCarteraTotal(CORTE);
    const detalles = await adaptador.listarDetallesCreditos(CORTE);
    const saldo0015 = detalles.find((d) => d.idCredito === 'CV-2026-0015')!.saldoCapital;
    const activa = detalles
      .filter((d) => d.estado !== 'INCOBRABLE' && d.estado !== 'CANCELADO')
      .reduce((t, d) => t.sumar(d.saldoCapital), saldo0015.restar(saldo0015));
    expect(cartera.resumen.carteraActiva.formato()).toBe(activa.formato());
    expect(cartera.incobrablesDelMes.map((c) => c.idCredito)).toContain('CV-2026-0015');
  });
});

describe('Validaciones de pago (OP-4, OP-5)', () => {
  it('OP-5 · rechaza Q500.00 en CV-2026-0061 e indica el monto exacto', async () => {
    const r = await adaptador.simularLiquidacionPago({ idCredito: 'CV-2026-0061', monto: '500.00', fechaPago: CORTE });
    expect(r.resultado).toBe('RECHAZADO');
    if (r.resultado !== 'RECHAZADO') return;
    expect(r.motivo).toBe('MONTO_NO_EXACTO');
    expect(r.cuota?.numero).toBe(1);
    expect(r.cuota?.diasAtraso).toBe(8);
    expect(r.montoExigido?.formato()).toBe('370.85');
  });

  it('OP-4 · una clave ya registrada responde DUPLICADO y no vuelve a aplicar', async () => {
    const r = await adaptador.simularLiquidacionPago({
      idCredito: 'CV-2026-0007', monto: '2215.17', fechaPago: CORTE, claveIdempotencia: 'IDEM-000068',
    });
    expect(r.resultado).toBe('DUPLICADO');
  });

  it('una clave reutilizada para otro pago se rechaza por conflicto', async () => {
    const r = await adaptador.simularLiquidacionPago({
      idCredito: 'CV-2026-0043', monto: '561.87', fechaPago: CORTE, claveIdempotencia: 'IDEM-000068',
    });
    expect(r.resultado).toBe('RECHAZADO');
    if (r.resultado === 'RECHAZADO') expect(r.motivo).toBe('CLAVE_EN_CONFLICTO');
  });

  it('rechaza montos no positivos', async () => {
    const r = await adaptador.simularLiquidacionPago({ idCredito: 'CV-2026-0043', monto: '0.00', fechaPago: CORTE });
    expect(r.resultado).toBe('RECHAZADO');
    if (r.resultado === 'RECHAZADO') expect(r.motivo).toBe('MONTO_INVALIDO');
  });
});

describe('POL-2026-10 · tramos recorridos y gasto de gestión (CV-2026-0410)', () => {
  it('G-7 / M-5 · cuota 2 al 2027-01-24: 30 días al 18 % + 15 al 24 % = Q18.14; total Q1,047.76', async () => {
    const detalle = await adaptador.obtenerDetalleCredito('CV-2026-0410', '2027-01-24');
    expect(detalle.politicaMora).toBe('POL-2026-10');
    const cuota2 = detalle.cuotasVencidas.find((c) => c.numero === 2)!;
    expect(cuota2.diasAtraso).toBe(45);
    expect(cuota2.tramosRecorridos).toEqual([
      { tramo: 'MORA_1', desdeDia: 1, hastaDia: 30, dias: 30, tasaAnualBps: 1800, montoSinRedondear: '10.8864' },
      { tramo: 'MORA_2', desdeDia: 31, hastaDia: 45, dias: 15, tasaAnualBps: 2400, montoSinRedondear: '7.2576' },
    ]);
    expect(cuota2.capital.formato()).toBe('725.76');
    expect(cuota2.interesCorriente.formato()).toBe('278.86');
    expect(cuota2.interesMoratorio.formato()).toBe('18.14');
    expect(cuota2.gastoGestion.formato()).toBe('25.00');
    expect(cuota2.total.formato()).toBe('1047.76');
  });

  it('el gasto de Q25.00 nace el día 31, no existe en el 30 y no se repite después', async () => {
    const gastoCuota1 = async (corte: string) =>
      (await adaptador.obtenerDetalleCredito('CV-2026-0410', corte)).cuotasVencidas[0].gastoGestion.formato();
    expect(await gastoCuota1('2026-12-10')).toBe('0.00'); // 30 días
    expect(await gastoCuota1('2026-12-11')).toBe('25.00'); // 31 días
    expect(await gastoCuota1('2027-01-09')).toBe('25.00'); // 60 días: sigue siendo uno solo
    expect(await gastoCuota1('2027-02-09')).toBe('25.00'); // 91 días: Vencido, sin segundo cargo
  });

  it('los créditos POL-2024-01 nunca generan gasto de gestión', async () => {
    const detalles = await adaptador.listarDetallesCreditos(CORTE);
    const planos = detalles.filter((d) => d.politicaMora === 'POL-2024-01');
    expect(planos.length).toBeGreaterThan(0);
    for (const d of planos) for (const c of d.cuotasVencidas) expect(c.gastoGestion.formato()).toBe('0.00');
  });
});

describe('Determinismo', () => {
  it('consultas sucesivas devuelven exactamente el mismo resultado', async () => {
    const a = huella(await adaptador.resumirCarteraTotal(CORTE));
    const b = huella(await adaptador.resumirCarteraTotal(CORTE));
    expect(b).toBe(a);
    const d1 = huella(await adaptador.obtenerDetalleCredito('CV-2026-0030', CORTE));
    const d2 = huella(await adaptador.obtenerDetalleCredito('CV-2026-0030', CORTE));
    expect(d2).toBe(d1);
  });

  it('una segunda instancia del adaptador sobre la misma base coincide', async () => {
    const primera = huella(await adaptador.resumirCarteraTotal(CORTE));
    await adaptador.cerrar();
    adaptador = await AdaptadorNucleo.abrir({ dbDir: copiaDb });
    expect(huella(await adaptador.resumirCarteraTotal(CORTE))).toBe(primera);
  }, 30_000);

  it('la cartera es coherente: activa = suma por tramo; riesgo y mora ≤ activa', async () => {
    const c = await adaptador.resumirCarteraTotal(CORTE);
    const sumaTramos = c.porTramo.reduce((t, x) => t.sumar(x.saldo), c.carteraEnMora.restar(c.carteraEnMora));
    expect(sumaTramos.formato()).toBe(c.resumen.carteraActiva.formato());
    expect(c.resumen.saldoEnRiesgo.mayorQue(c.resumen.carteraActiva)).toBe(false);
    expect(c.carteraEnMora.mayorQue(c.resumen.carteraActiva)).toBe(false);
    expect(c.conteos.desembolsados).toBe(75);
  });
});

describe('Fecha de corte estricta', () => {
  it('excluye pagos posteriores al corte e incluye los del mismo día', async () => {
    // IDEM-000009 de CV-2026-0001 ocurrió el 2026-10-23.
    const antes = await adaptador.obtenerDetalleCredito('CV-2026-0001', '2026-10-22');
    const mismoDia = await adaptador.obtenerDetalleCredito('CV-2026-0001', '2026-10-23');
    expect(antes.pagos.map((p) => p.claveIdempotencia)).not.toContain('IDEM-000009');
    expect(mismoDia.pagos.map((p) => p.claveIdempotencia)).toContain('IDEM-000009');
    expect(mismoDia.cuotasPagadas).toBe(antes.cuotasPagadas + 1);
    expect(antes.saldoCapital.mayorQue(mismoDia.saldoCapital)).toBe(true);
    for (const p of antes.pagos) expect(p.fecha <= '2026-10-22').toBe(true);
  });

  it('excluye desembolsos posteriores al corte', async () => {
    const julio = await adaptador.listarDetallesCreditos('2026-07-31');
    expect(julio).toHaveLength(41);
    expect(julio.every((d) => d.fechaDesembolso <= '2026-07-31')).toBe(true);
    expect(julio.map((d) => d.idCredito)).not.toContain('CV-2026-0043');
    await expect(adaptador.obtenerDetalleCredito('CV-2026-0410', '2026-10-09')).rejects.toThrow(/no existía/);

    const carteraJulio = await adaptador.resumirCarteraTotal('2026-07-31');
    const carteraOctubre = await adaptador.resumirCarteraTotal(CORTE);
    expect(carteraJulio.conteos.desembolsados).toBe(41);
    expect(carteraJulio.resumen.carteraActiva.formato()).not.toBe(carteraOctubre.resumen.carteraActiva.formato());
  });

  it('un corte anterior no ve el incobrable que ocurre después', async () => {
    const antes = await adaptador.obtenerDetalleCredito('CV-2026-0015', '2026-10-21');
    expect(antes.diasAtraso).toBe(120);
    expect(antes.estado).toBe('EN_MORA');
    expect(antes.tramo).toBe('VENCIDO');
  });

  it('rechaza fechas mal formadas o inexistentes', async () => {
    await expect(adaptador.resumirCarteraTotal('31/10/2026')).rejects.toThrow(/AAAA-MM-DD/);
    await expect(adaptador.obtenerDetalleCredito('CV-2026-0043', '2026-02-30')).rejects.toThrow(/válida/);
  });
});

describe('Parámetros de política contrastados con el núcleo', () => {
  const clonar = (): ParametrosPoliticas => JSON.parse(JSON.stringify(adaptador.politicas.parametros)) as ParametrosPoliticas;

  it('acepta los parámetros cargados', () => {
    expect(() => new ContextoPoliticas(clonar())).not.toThrow();
  });

  it('detiene el cálculo si la tasa plana publicada no coincide con el núcleo', () => {
    const p = clonar();
    p.politicas_mora['POL-2024-01'].tna_bps = 2500;
    expect(() => new ContextoPoliticas(p)).toThrow(ErrorIntegridadCartera);
  });

  it('detiene el cálculo si el gasto de gestión publicado no coincide con el núcleo', () => {
    const p = clonar();
    p.gasto_gestion_cobro.monto_centavos = 3000;
    expect(() => new ContextoPoliticas(p)).toThrow(ErrorIntegridadCartera);
  });
});
