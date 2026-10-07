import { Dinero } from '../dinero.js';

const MONTO_GASTO = Dinero.de('25.00');
const POLITICA_CON_GASTO = 'POL-2026-10';

export function debeGenerarGastoGestion(diasAtraso: number): boolean {
  return Number.isInteger(diasAtraso) && diasAtraso >= 31;
}

export function gastoGestionCobro(capitalEnMora: Dinero, diasAtraso: number, politicaId = POLITICA_CON_GASTO): Dinero {
  if (capitalEnMora.valor.isNegative()) throw new Error('El capital en mora no puede ser negativo');
  if (!Number.isInteger(diasAtraso) || diasAtraso < 0) throw new Error('Los días de atraso deben ser enteros no negativos');
  return politicaId === POLITICA_CON_GASTO && debeGenerarGastoGestion(diasAtraso)
    ? Dinero.de(MONTO_GASTO.valor, capitalEnMora.moneda)
    : Dinero.cero(capitalEnMora.moneda);
}

export class GastoGestionCobroService {
  private readonly cargosPorCuota = new Map<string, { generado: Dinero; pendiente: Dinero }>();

  generarSiCorresponde(
    creditoId: string,
    cuotaId: string,
    politicaId: string,
    diasAtraso: number,
    moneda: Dinero['moneda'] = 'GTQ',
  ): { generado: Dinero; saldoPendiente: Dinero } {
    if (!creditoId || !cuotaId) throw new Error('El gasto requiere identificadores estables de credito y cuota');
    if (!Number.isInteger(diasAtraso) || diasAtraso < 0) throw new Error('Los días de atraso deben ser enteros no negativos');
    const clave = `${creditoId}:${cuotaId}`;
    const existente = this.cargosPorCuota.get(clave);
    if (existente) return { generado: Dinero.cero(moneda), saldoPendiente: existente.pendiente };
    if (politicaId !== POLITICA_CON_GASTO || !debeGenerarGastoGestion(diasAtraso)) {
      return { generado: Dinero.cero(moneda), saldoPendiente: Dinero.cero(moneda) };
    }
    const cargo = Dinero.de(MONTO_GASTO.valor, moneda);
    this.cargosPorCuota.set(clave, { generado: cargo, pendiente: cargo });
    return { generado: cargo, saldoPendiente: cargo };
  }

  registrarPago(creditoId: string, cuotaId: string, monto: Dinero): Dinero {
    if (monto.valor.isNegative()) throw new Error('El pago del gasto no puede ser negativo');
    const clave = `${creditoId}:${cuotaId}`;
    const cargo = this.cargosPorCuota.get(clave);
    if (!cargo) return Dinero.cero(monto.moneda);
    if (cargo.pendiente.moneda !== monto.moneda) throw new Error('El pago del gasto debe usar su moneda');
    const aplicado = monto.menorQue(cargo.pendiente) ? monto : cargo.pendiente;
    cargo.pendiente = cargo.pendiente.restar(aplicado);
    return aplicado;
  }

  obtenerSaldoPendiente(creditoId: string, cuotaId: string, moneda: Dinero['moneda'] = 'GTQ'): Dinero {
    return this.cargosPorCuota.get(`${creditoId}:${cuotaId}`)?.pendiente ?? Dinero.cero(moneda);
  }
}
