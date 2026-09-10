import { Dinero } from '../dinero.js';

const MONTO_GASTO = Dinero.de('25.00');

export function debeGenerarGastoGestion(diasAtraso: number): boolean {
  return Number.isInteger(diasAtraso) && diasAtraso === 31;
}

export function gastoGestionCobro(capitalEnMora: Dinero, diasAtraso: number): Dinero {
  if (capitalEnMora.valor.isNegative()) throw new Error('El capital en mora no puede ser negativo');
  if (!Number.isInteger(diasAtraso) || diasAtraso < 0) throw new Error('Los días de atraso deben ser enteros no negativos');
  return debeGenerarGastoGestion(diasAtraso) ? MONTO_GASTO : Dinero.cero(capitalEnMora.moneda);
}

export class GastoGestionCobroService {
  private readonly fechasRegistradas = new Set<string>();

  generarSiCorresponde(capitalEnMora: Dinero, diasAtraso: number, clave: string): Dinero {
    if (capitalEnMora.valor.isNegative()) throw new Error('El capital en mora no puede ser negativo');
    if (!Number.isInteger(diasAtraso) || diasAtraso < 0) throw new Error('Los días de atraso deben ser enteros no negativos');
    if (!debeGenerarGastoGestion(diasAtraso) || this.fechasRegistradas.has(clave)) {
      return Dinero.cero(capitalEnMora.moneda);
    }
    this.fechasRegistradas.add(clave);
    return MONTO_GASTO;
  }
}
