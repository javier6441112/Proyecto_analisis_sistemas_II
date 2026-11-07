/**
 * Convierte los objetos del núcleo a JSON sin perder precisión:
 *  - `Dinero` → `{ valor: "1047.76", moneda: "GTQ" }` (DineroSchema de src/contratos).
 *  - `Decimal` → texto ("0.1193127471…"); la interfaz decide cómo mostrarlo.
 * Nunca se convierte dinero a `number`.
 */
import { Decimal } from 'decimal.js';
import { Dinero } from '../dominio/dinero.js';

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export function aJson(valor: unknown): Json {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Dinero) return { valor: valor.formato(), moneda: valor.moneda };
  if (Decimal.isDecimal(valor)) return (valor as Decimal).toString();
  if (valor instanceof Date) throw new Error('No se serializan Date: las fechas viajan como AAAA-MM-DD');
  if (Array.isArray(valor)) return valor.map(aJson);
  if (typeof valor === 'object') {
    const salida: Record<string, Json> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      if (v !== undefined) salida[k] = aJson(v);
    }
    return salida;
  }
  if (typeof valor === 'bigint') return valor.toString();
  return valor as Json;
}
