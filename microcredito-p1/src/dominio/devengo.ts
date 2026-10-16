import { Dinero } from './dinero.js';
import { Decimal } from 'decimal.js';

export interface PoliticaDevengo {
  version: string; vigenteDesde: string; vigenteHasta?: string; autor: string; motivo: string;
  convencion: 'CONTRACTUAL_DIAS_REALES'; suspensionDesdeDias: 91; bajaDesdeDias: 121;
}
export function diaDevengo(fecha: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error('Fecha inválida');
  const t = new Date(`${fecha}T00:00:00Z`);
  if (!Number.isFinite(t.getTime()) || t.toISOString().slice(0, 10) !== fecha) throw new Error('Fecha inválida');
  return t.getTime() / 86400000;
}
export const fechaDevengo = (dia: number): string => new Date(dia * 86400000).toISOString().slice(0, 10);
export function validarPoliticaDevengo(p: PoliticaDevengo): void {
  if (!p.version?.trim() || !p.autor?.trim() || !p.motivo?.trim() || p.convencion !== 'CONTRACTUAL_DIAS_REALES'
    || p.suspensionDesdeDias !== 91 || p.bajaDesdeDias !== 121) throw new Error('Política de devengo inválida');
  diaDevengo(p.vigenteDesde);
  if (p.vigenteHasta && diaDevengo(p.vigenteHasta) < diaDevengo(p.vigenteDesde)) throw new Error('Vigencia invertida');
}
export interface CuotaDevengo { numero: number; inicio: string; vencimiento: string; interes: Dinero }
export interface EventoDevengo {
  id: string; fecha: string; orden: number; tipo: 'PAGO' | 'REGULARIZACION' | 'CANCELACION' | 'BAJA'; cuota?: number;
}
export interface CreditoDevengo { id: string; desembolso: string; cuotas: CuotaDevengo[]; eventos: EventoDevengo[]; politica: PoliticaDevengo }
export type ConceptoDevengo = 'DEVENGO' | 'SUSPENSO' | 'REGULARIZACION' | 'RETIRO_SUSPENSO';
export interface MovimientoDevengo {
  id: string; creditoId: string; cuota: number; desde: string; hasta: string; fechaContable: string;
  concepto: ConceptoDevengo; importe: Dinero; versionPolitica: string;
}

/** Acumulado redondeado por cuota; las diferencias telescópicas conservan el total. */
export function acumuladoCuota(c: CuotaDevengo, corte: string): Dinero {
  const inicio = diaDevengo(c.inicio), fin = diaDevengo(c.vencimiento), dia = diaDevengo(corte);
  if (fin <= inicio || c.interes.valor.isNegative() || c.interes.moneda !== 'GTQ' || !Number.isInteger(c.numero) || c.numero < 1) throw new Error('Cuota de devengo inválida');
  const transcurridos = Math.max(0, Math.min(fin, dia) - inicio);
  return Dinero.de(c.interes.valor.times(new Decimal(transcurridos)).div(fin - inicio));
}
export function devengoEntreCortes(c: CuotaDevengo, desde: string, hasta: string): Dinero {
  if (diaDevengo(hasta) < diaDevengo(desde)) throw new Error('Intervalo invertido');
  return acumuladoCuota(c, hasta).restar(acumuladoCuota(c, desde));
}

/** Reproduce el plan y los eventos; no usa tasas moratorias, E/S ni reloj. */
export function proyectarDevengo(c: CreditoDevengo, hasta: string): MovimientoDevengo[] {
  validarPoliticaDevengo(c.politica);
  const inicio = diaDevengo(c.desembolso), fin = diaDevengo(hasta);
  if (!c.id.trim() || !c.cuotas.length || c.desembolso < c.politica.vigenteDesde || (c.politica.vigenteHasta && c.desembolso > c.politica.vigenteHasta)) throw new Error('Crédito o vigencia inválidos');
  c.cuotas.forEach((q, i) => {
    acumuladoCuota(q, hasta);
    if (q.numero !== i + 1 || q.inicio !== (i ? c.cuotas[i - 1].vencimiento : c.desembolso)) throw new Error('Plan discontinuo');
  });
  const eventos = new Map<number, EventoDevengo[]>();
  const ids = new Set<string>();
  for (const e of c.eventos) {
    const d = diaDevengo(e.fecha);
    if (!e.id.trim() || ids.has(e.id) || d < inicio || !Number.isSafeInteger(e.orden)
      || !['PAGO', 'REGULARIZACION', 'CANCELACION', 'BAJA'].includes(e.tipo)) throw new Error('Evento de devengo inválido');
    ids.add(e.id);
    if (e.tipo === 'PAGO' && (!Number.isInteger(e.cuota) || !c.cuotas.some(q => q.numero === e.cuota))) throw new Error('Cuota del pago inválida');
    eventos.set(d, [...(eventos.get(d) ?? []), e]);
  }
  const pagadas = new Set<number>();
  const suspenso = new Map<number, { saldo: Dinero; desde: string }>();
  const resultado: MovimientoDevengo[] = [];
  let inactivo = false, suspendido = false;
  const atraso = (d: number): number => {
    const pendiente = c.cuotas.find(q => !pagadas.has(q.numero));
    return pendiente ? Math.max(0, d - diaDevengo(pendiente.vencimiento)) : 0;
  };
  function mover(q: number, dia: number, concepto: ConceptoDevengo, importe: Dinero, desde: string) {
    if (importe.esCero()) return;
    const fecha = fechaDevengo(dia);
    resultado.push({ id: `${c.id}:${q}:${fecha}:${concepto}`, creditoId: c.id, cuota: q, desde,
      hasta: fecha, fechaContable: fecha, concepto, importe, versionPolitica: c.politica.version });
  }
  function vaciar(dia: number, concepto: 'REGULARIZACION' | 'RETIRO_SUSPENSO') {
    for (const [q, s] of suspenso) mover(q, dia, concepto, s.saldo, s.desde);
    suspenso.clear();
  }
  for (let dia = inicio; dia <= fin; dia++) {
    const hoy = (eventos.get(dia) ?? []).sort((a, b) => a.orden - b.orden || a.id.localeCompare(b.id));
    // La baja al día 121 precede los cobros, como en reconstruirCredito.
    if (!inactivo && (atraso(dia) >= c.politica.bajaDesdeDias || hoy.some(e => e.tipo === 'BAJA'))) {
      vaciar(dia, 'RETIRO_SUSPENSO'); inactivo = true;
    }
    if (inactivo) continue;
    if (atraso(dia) >= c.politica.suspensionDesdeDias) suspendido = true;
    if (dia > inicio) {
      const fecha = fechaDevengo(dia), anterior = fechaDevengo(dia - 1);
      const cuota = c.cuotas.find(q => q.inicio < fecha && q.vencimiento >= fecha);
      if (cuota) {
        const importe = devengoEntreCortes(cuota, anterior, fecha);
        mover(cuota.numero, dia, suspendido ? 'SUSPENSO' : 'DEVENGO', importe, anterior);
        if (suspendido && !importe.esCero()) {
          const previo = suspenso.get(cuota.numero);
          suspenso.set(cuota.numero, { saldo: (previo?.saldo ?? Dinero.cero()).sumar(importe), desde: previo?.desde ?? anterior });
        }
      }
    }
    for (const e of hoy.filter(e => e.tipo === 'PAGO')) {
      if (pagadas.has(e.cuota!)) throw new Error('Cuota pagada duplicada');
      if (c.cuotas.find(q => !pagadas.has(q.numero))?.numero !== e.cuota) throw new Error('Pago fuera de prelación');
      pagadas.add(e.cuota!);
    }
    if (hoy.some(e => e.tipo === 'REGULARIZACION') && atraso(dia) !== 0) throw new Error('Regularización sin saldar el atraso');
    if (suspendido && atraso(dia) === 0) { vaciar(dia, 'REGULARIZACION'); suspendido = false; }
    if (pagadas.size === c.cuotas.length || hoy.some(e => e.tipo === 'CANCELACION')) {
      vaciar(dia, 'RETIRO_SUSPENSO'); inactivo = true;
    }
  }
  return resultado;
}

export interface SaldosDevengo { generado: Dinero; ingresoReconocido: Dinero; enviadoSuspenso: Dinero; suspensoRegularizado: Dinero; suspensoRetirado: Dinero; saldoSuspenso: Dinero }
export function resumirDevengo(movimientos: readonly MovimientoDevengo[]): SaldosDevengo {
  const suma = (concepto: ConceptoDevengo) => movimientos.filter(m => m.concepto === concepto).reduce((t, m) => t.sumar(m.importe), Dinero.cero());
  const directo = suma('DEVENGO'), enviadoSuspenso = suma('SUSPENSO'), suspensoRegularizado = suma('REGULARIZACION'), suspensoRetirado = suma('RETIRO_SUSPENSO');
  return { generado: directo.sumar(enviadoSuspenso), ingresoReconocido: directo.sumar(suspensoRegularizado), enviadoSuspenso,
    suspensoRegularizado, suspensoRetirado, saldoSuspenso: enviadoSuspenso.restar(suspensoRegularizado).restar(suspensoRetirado) };
}
