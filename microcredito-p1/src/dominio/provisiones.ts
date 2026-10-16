import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { Dinero } from './dinero.js';
import { type CreditoCartera } from './cartera.js';
import { clasificarTramo } from './politica-mora/clasificacion-tramo.js';

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(valor => {
  const instante = new Date(`${valor}T00:00:00Z`);
  return Number.isFinite(instante.getTime()) && instante.toISOString().slice(0, 10) === valor;
}, 'Fecha inválida');
const porcentaje = z.string().regex(/^\d+(\.\d+)?$/).refine(v => new Decimal(v).lte(100), 'Porcentaje fuera de rango');
const esquemaPolitica = z.object({
  version: z.string().trim().min(1),
  vigenteDesde: fecha,
  vigenteHasta: fecha.optional(),
  institucion: z.string().trim().min(1),
  autor: z.string().trim().min(1),
  motivo: z.string().trim().min(1),
  porcentajes: z.object({ AL_DIA: porcentaje, MORA_1: porcentaje, MORA_2: porcentaje,
    MORA_3: porcentaje, VENCIDO: porcentaje }).strict(),
  minimoReestructurado: porcentaje,
}).strict().refine(p => !p.vigenteHasta || p.vigenteHasta >= p.vigenteDesde, 'Vigencia invertida');

export type PoliticaProvisiones = z.infer<typeof esquemaPolitica>;

/** Valida configuración externa sin leer archivos ni seleccionar por el reloj. */
export function validarPoliticaProvisiones(datos: unknown): PoliticaProvisiones {
  return esquemaPolitica.parse(datos);
}

export interface CreditoProvision extends CreditoCartera {
  readonly dadoDeBaja: boolean;
}

export interface DetalleProvision {
  readonly id: string;
  readonly tramo: ReturnType<typeof clasificarTramo>;
  readonly excluido: boolean;
  readonly base: Dinero;
  /** Unidades porcentuales: 20 significa 20 %. */
  readonly porcentaje: Decimal;
  readonly provision: Dinero;
}

/** Los saldos, estados y días de atraso recibidos deben corresponder a fechaCorte. */
export function calcularProvisiones(
  politica: PoliticaProvisiones,
  fechaCorte: string,
  creditos: readonly CreditoProvision[],
): { fechaCorte: string; version: string; detalles: DetalleProvision[]; total: Dinero } {
  const p = validarPoliticaProvisiones(politica);
  fecha.parse(fechaCorte);
  if (fechaCorte < p.vigenteDesde || (p.vigenteHasta && fechaCorte > p.vigenteHasta)) {
    throw new Error('La política no está vigente al corte');
  }
  const moneda = creditos[0]?.saldoCapital.moneda ?? 'GTQ';
  const ids = new Set<string>();
  let total = Dinero.cero(moneda);
  const detalles = creditos.map(c => {
    if (!c.id.trim() || ids.has(c.id)) throw new Error('Identificador vacío o duplicado');
    ids.add(c.id);
    if (!['VIGENTE', 'EN_MORA', 'REESTRUCTURADO', 'INCOBRABLE', 'CANCELADO'].includes(c.estado)) {
      throw new Error('Estado inválido');
    }
    if (typeof c.dadoDeBaja !== 'boolean' || (c.dadoDeBaja && c.estado !== 'INCOBRABLE')) {
      throw new Error('Baja inválida: solo corresponde a un incobrable');
    }
    if (c.saldoCapital.valor.isNegative()) throw new Error('Saldo de capital negativo');
    if (c.saldoCapital.moneda !== moneda) throw new Error('No se pueden operar monedas distintas');
    const tramo = clasificarTramo(c.diasAtraso);
    const excluido = c.estado === 'CANCELADO' || c.dadoDeBaja;
    const base = excluido ? Dinero.cero(moneda) : c.saldoCapital;
    const tasaTramo = new Decimal(p.porcentajes[tramo === 'INCOBRABLE' ? 'VENCIDO' : tramo]);
    const tasa = excluido ? new Decimal(0) : c.estado === 'REESTRUCTURADO'
      ? Decimal.max(tasaTramo, p.minimoReestructurado) : tasaTramo;
    const provision = base.multiplicar(tasa.div(100));
    total = total.sumar(provision);
    return { id: c.id, tramo, excluido, base, porcentaje: tasa, provision };
  });
  return { fechaCorte, version: p.version, detalles, total };
}
