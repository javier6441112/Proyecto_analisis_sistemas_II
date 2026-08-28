import { Decimal } from 'decimal.js';
import { Dinero } from './dinero.js';

export type EstadoCredito = 'VIGENTE' | 'EN_MORA' | 'REESTRUCTURADO' | 'INCOBRABLE' | 'CANCELADO';

export interface CreditoCartera {
  id: string;
  saldoCapital: Dinero;
  diasAtraso: number;
  estado: EstadoCredito;
}

export interface ResumenCartera {
  carteraActiva: Dinero;
  saldoEnRiesgo: Dinero;
  porcentajeRiesgo: Decimal;
  incobrable: Dinero;
}

export function esCarteraEnRiesgo(credito: CreditoCartera): boolean {
  return credito.estado === 'REESTRUCTURADO' || credito.diasAtraso > 30;
}

export function resumirCartera(creditos: readonly CreditoCartera[]): ResumenCartera {
  const moneda = creditos[0]?.saldoCapital.moneda ?? 'GTQ';
  const activos = creditos.filter((credito) => credito.estado !== 'INCOBRABLE' && credito.estado !== 'CANCELADO');
  const carteraActiva = activos.reduce((total, credito) => total.sumar(credito.saldoCapital), Dinero.cero(moneda));
  const saldoEnRiesgo = activos
    .filter(esCarteraEnRiesgo)
    .reduce((total, credito) => total.sumar(credito.saldoCapital), Dinero.cero(moneda));
  const incobrable = creditos
    .filter((credito) => credito.estado === 'INCOBRABLE')
    .reduce((total, credito) => total.sumar(credito.saldoCapital), Dinero.cero(moneda));
  const porcentajeRiesgo = carteraActiva.esCero()
    ? new Decimal(0)
    : saldoEnRiesgo.valor.div(carteraActiva.valor);
  return { carteraActiva, saldoEnRiesgo, porcentajeRiesgo, incobrable };
}
