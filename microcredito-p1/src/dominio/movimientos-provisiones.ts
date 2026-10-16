import { Dinero } from './dinero.js';

export interface SaldoProvision { creditoId: string; saldo: Dinero }
export interface VariacionProvision { creditoId: string; anterior: Dinero; objetivo: Dinero; variacion: Dinero }

/** Una reserva es un saldo: solo su variación se constituye o se reduce. */
export function variacionesProvisiones(anteriores: readonly SaldoProvision[], objetivos: readonly SaldoProvision[]): VariacionProvision[] {
  function mapa(saldos: readonly SaldoProvision[]): Map<string, Dinero> {
    const r = new Map<string, Dinero>();
    for (const s of saldos) {
      if (!s.creditoId.trim() || r.has(s.creditoId)) throw new Error('Crédito vacío o duplicado');
      if (s.saldo.valor.isNegative() || s.saldo.moneda !== 'GTQ') throw new Error('Saldo de provisión inválido');
      r.set(s.creditoId, s.saldo);
    }
    return r;
  }
  const antes = mapa(anteriores);
  const despues = mapa(objetivos);
  return [...new Set([...antes.keys(), ...despues.keys()])].sort().map(creditoId => {
    const anterior = antes.get(creditoId) ?? Dinero.cero();
    const objetivo = despues.get(creditoId) ?? Dinero.cero();
    return { creditoId, anterior, objetivo, variacion: objetivo.restar(anterior) };
  }).filter(v => !v.variacion.esCero());
}
