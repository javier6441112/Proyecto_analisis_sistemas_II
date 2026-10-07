import { Decimal } from 'decimal.js';
import { Dinero } from './dinero.js';
import { clasificarTramo } from './politica-mora/clasificacion-tramo.js';

export type EstadoCredito = 'VIGENTE' | 'EN_MORA' | 'REESTRUCTURADO' | 'INCOBRABLE' | 'CANCELADO';

export interface CreditoCartera {
  id: string;
  saldoCapital: Dinero;
  diasAtraso: number;
  estado: EstadoCredito;
}

export interface DetalleTramoCartera {
  tramo: ReturnType<typeof clasificarTramo>;
  saldo: Dinero;
  creditos: number;
}

export interface ResumenCartera {
  carteraActiva: Dinero;
  saldoEnRiesgo: Dinero;
  porcentajeRiesgo: Decimal;
  incobrable: Dinero;
  riesgoPorTramo: DetalleRiesgoCartera[];
}

export type TramoRiesgoCartera = 'MORA_1' | 'MORA_2' | 'MORA_3' | 'VENCIDO' | 'REESTRUCTURADO_AL_DIA';

export interface DetalleRiesgoCartera {
  readonly tramo: TramoRiesgoCartera;
  readonly saldo: Dinero;
  readonly porcentajeCarteraActiva: Decimal;
}

export interface ResumenCarteraPorTramo {
  carteraEnMora: Dinero;
  carteraEnRiesgo: Dinero;
  porTramo: DetalleTramoCartera[];
}

export function esCarteraEnRiesgo(credito: CreditoCartera): boolean {
  return credito.estado === 'REESTRUCTURADO' || credito.diasAtraso > 30;
}

export function resumirCarteraPorTramo(creditos: readonly CreditoCartera[]): ResumenCarteraPorTramo {
  const moneda = creditos[0]?.saldoCapital.moneda ?? 'GTQ';
  const mapa = new Map<string, DetalleTramoCartera>();

  for (const credito of creditos) {
    if (credito.saldoCapital.valor.isNegative()) throw new Error('El saldo de capital no puede ser negativo');
    const tramo = clasificarTramo(credito.diasAtraso);
    const actual = mapa.get(tramo) ?? { tramo, saldo: Dinero.cero(moneda), creditos: 0 };
    actual.saldo = actual.saldo.sumar(credito.saldoCapital);
    actual.creditos += 1;
    mapa.set(tramo, actual);
  }

  const porTramo = Array.from(mapa.values()).sort((a, b) => a.tramo.localeCompare(b.tramo));
  const carteraEnMora = creditos
    .filter((credito) => credito.diasAtraso >= 1 && credito.estado !== 'CANCELADO' && credito.estado !== 'INCOBRABLE')
    .reduce((total, credito) => total.sumar(credito.saldoCapital), Dinero.cero(moneda));
  const carteraEnRiesgo = creditos
    .filter((credito) => esCarteraEnRiesgo(credito) && credito.estado !== 'CANCELADO' && credito.estado !== 'INCOBRABLE')
    .reduce((total, credito) => total.sumar(credito.saldoCapital), Dinero.cero(moneda));

  return { carteraEnMora, carteraEnRiesgo, porTramo };
}

export function resumirCartera(creditos: readonly CreditoCartera[]): ResumenCartera {
  for (const credito of creditos) {
    if (credito.saldoCapital.valor.isNegative()) throw new Error('El saldo de capital no puede ser negativo');
  }
  const moneda = creditos[0]?.saldoCapital.moneda ?? 'GTQ';
  const activos = creditos.filter((credito) => credito.estado !== 'INCOBRABLE' && credito.estado !== 'CANCELADO');
  const carteraActiva = activos.reduce((total, credito) => total.sumar(credito.saldoCapital), Dinero.cero(moneda));
  const saldoEnRiesgo = activos
    .filter(esCarteraEnRiesgo)
    .reduce((total, credito) => total.sumar(credito.saldoCapital), Dinero.cero(moneda));
  const saldosPorTramo = new Map<TramoRiesgoCartera, Dinero>([
    ['MORA_1', Dinero.cero(moneda)],
    ['MORA_2', Dinero.cero(moneda)],
    ['MORA_3', Dinero.cero(moneda)],
    ['VENCIDO', Dinero.cero(moneda)],
    ['REESTRUCTURADO_AL_DIA', Dinero.cero(moneda)],
  ]);
  for (const credito of activos.filter(esCarteraEnRiesgo)) {
    let tramo: TramoRiesgoCartera;
    if (credito.estado === 'REESTRUCTURADO' && credito.diasAtraso === 0) {
      tramo = 'REESTRUCTURADO_AL_DIA';
    } else if (credito.diasAtraso <= 30) {
      tramo = 'MORA_1';
    } else {
      const clasificacion = clasificarTramo(credito.diasAtraso);
      tramo = clasificacion === 'MORA_2' || clasificacion === 'MORA_3' || clasificacion === 'VENCIDO'
        ? clasificacion
        : 'VENCIDO';
    }
    saldosPorTramo.set(tramo, (saldosPorTramo.get(tramo) ?? Dinero.cero(moneda)).sumar(credito.saldoCapital));
  }
  const riesgoPorTramo = Array.from(saldosPorTramo, ([tramo, saldo]) => ({
    tramo,
    saldo,
    porcentajeCarteraActiva: carteraActiva.esCero() ? new Decimal(0) : saldo.valor.div(carteraActiva.valor),
  }));
  const incobrable = creditos
    .filter((credito) => credito.estado === 'INCOBRABLE')
    .reduce((total, credito) => total.sumar(credito.saldoCapital), Dinero.cero(moneda));
  const porcentajeRiesgo = carteraActiva.esCero()
    ? new Decimal(0)
    : saldoEnRiesgo.valor.div(carteraActiva.valor);
  return { carteraActiva, saldoEnRiesgo, porcentajeRiesgo, incobrable, riesgoPorTramo };
}
