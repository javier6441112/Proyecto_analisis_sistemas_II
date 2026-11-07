import { Decimal } from 'decimal.js';
import { Dinero } from './dinero.js';
import { type CreditoCartera } from './cartera.js';
import { clasificarTramo } from './politica-mora/clasificacion-tramo.js';

function validarFecha(valor: string): void {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) throw new Error('Fecha inválida');
  const instante = new Date(`${valor}T00:00:00Z`);
  if (!Number.isFinite(instante.getTime()) || instante.toISOString().slice(0, 10) !== valor) {
    throw new Error('Fecha inválida');
  }
}

export interface PoliticaProvisiones {
  readonly version: string;
  readonly vigenteDesde: string;
  readonly vigenteHasta?: string;
  readonly institucion: string;
  readonly autor: string;
  readonly motivo: string;
  readonly porcentajes: Readonly<Record<'AL_DIA' | 'MORA_1' | 'MORA_2' | 'MORA_3' | 'VENCIDO', string>>;
  readonly minimoReestructurado: string;
}

/** Invariantes de negocio, también para llamadas directas sin validación externa. */
export function validarPoliticaProvisiones(p: PoliticaProvisiones): void {
  for (const texto of [p.version, p.institucion, p.autor, p.motivo]) {
    if (typeof texto !== 'string' || !texto.trim()) throw new Error('Metadatos vacíos o inválidos');
  }
  validarFecha(p.vigenteDesde);
  if (p.vigenteHasta !== undefined) {
    validarFecha(p.vigenteHasta);
    if (p.vigenteHasta < p.vigenteDesde) throw new Error('Vigencia invertida');
  }
  for (const valor of [p.porcentajes?.AL_DIA, p.porcentajes?.MORA_1, p.porcentajes?.MORA_2,
    p.porcentajes?.MORA_3, p.porcentajes?.VENCIDO, p.minimoReestructurado]) {
    if (typeof valor !== 'string' || !/^\d+(\.\d+)?$/.test(valor) || new Decimal(valor).gt(100)) {
      throw new Error('Porcentaje inválido: debe estar entre 0 y 100');
    }
  }
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
  validarPoliticaProvisiones(politica);
  const p = politica;
  validarFecha(fechaCorte);
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
    const excluido = c.estado === 'CANCELADO' || c.estado === 'INCOBRABLE';
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
