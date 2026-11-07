import { Decimal } from 'decimal.js';
import { PoliticaEscalonada } from './politica-escalonada.js';
import { PoliticaPlana } from './politica-plana.js';
import type { PoliticaMora } from './politica-mora.js';

const POLITICAS_VERSIONADAS: readonly PoliticaMora[] = [
  new PoliticaPlana(),
  new PoliticaEscalonada('POL-2026-10'),
];

export function resolverPoliticaMoraPorFecha(fechaOtorgamiento: string): PoliticaMora {
  const fecha = new Date(fechaOtorgamiento);
  if (Number.isNaN(fecha.getTime())) {
    throw new Error('La fecha de otorgamiento debe ser válida');
  }
  const corte = new Date('2026-10-01T00:00:00.000Z');
  return fecha >= corte ? POLITICAS_VERSIONADAS[1] : POLITICAS_VERSIONADAS[0];
}


export interface DefinicionMora {
  tipo: 'plana' | 'escalonada';
  nombre?: string; version?: string; autor?: string; motivo?: string;
  tna_bps?: number;
  vigencia_otorgamiento: { desde?: string; hasta?: string };
  tramos?: Array<{ id: string; ini: number; fin: number; bps: number }>;
}

export function validarFechaPolitica(fecha: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !Number.isFinite(Date.parse(fecha)) || new Date(fecha).toISOString().slice(0, 10) !== fecha) {
    throw new Error('La fecha de otorgamiento o vigencia debe ser válida (AAAA-MM-DD)');
  }
}

/** Construye estrategias del núcleo; no contiene fórmulas financieras. */
export function crearCatalogoMora(definiciones: Record<string, DefinicionMora>): PoliticaMora[] {
  const nombres = ['mora_1', 'mora_2', 'mora_3', 'vencido'];
  const etiquetas = ['MORA_1', 'MORA_2', 'MORA_3', 'VENCIDO'] as const;
  const tasa = (bps: number | undefined) => {
    if (!Number.isSafeInteger(bps) || bps! < 0) throw new Error('La tasa en bps debe ser un entero no negativo');
    return new Decimal(bps!).div(10000);
  };
  if (!definiciones || typeof definiciones !== 'object' || Array.isArray(definiciones)) throw new Error('Falta el catálogo de políticas');
  const entradas = Object.entries(definiciones);
  if (!entradas.length) throw new Error('El catálogo de políticas está vacío');
  for (const [id, d] of entradas) {
    if (!d || !d.vigencia_otorgamiento) throw new Error(id + ': falta vigencia');
    const { desde, hasta } = d.vigencia_otorgamiento;
    if (desde !== undefined) validarFechaPolitica(desde);
    if (hasta !== undefined) validarFechaPolitica(hasta);
    if (desde && hasta && desde > hasta) throw new Error(id + ': vigencia invertida');
    for (const [otroId, otra] of entradas) {
      if (!otra?.vigencia_otorgamiento) throw new Error(otroId + ': falta vigencia');
      if (id < otroId && (desde ?? '') <= (otra.vigencia_otorgamiento.hasta ?? '9999-12-31') && (otra.vigencia_otorgamiento.desde ?? '') <= (hasta ?? '9999-12-31')) throw new Error('Vigencias superpuestas: ' + id + ', ' + otroId);
    }
  }
  return entradas.map(([id, d]) => {
    let estrategia: PoliticaMora;
    if (d.tipo === 'plana') estrategia = new PoliticaPlana(tasa(d.tna_bps));
    else if (d.tipo === 'escalonada') {
      let siguiente = 1;
      if (!d.tramos?.length) throw new Error(id + ': faltan tramos');
      const vistos = new Set<string>();
      const tramos = d.tramos.map(t => {
        const indice = nombres.indexOf(t.id);
        if (indice < 0 || vistos.has(t.id) || !Number.isSafeInteger(t.ini) || !Number.isSafeInteger(t.fin) || t.ini !== siguiente || t.fin < t.ini || t.fin > 120) throw new Error(id + ': tramos inválidos, deben ser únicos, contiguos y cubrir 1..120');
        siguiente = t.fin + 1; vistos.add(t.id);
        return { nombre: etiquetas[indice], desde: t.ini, hasta: t.fin, tasaNominalAnual: tasa(t.bps) };
      });
      if (siguiente !== 121) throw new Error(id + ': los tramos deben cubrir 1..120');
      estrategia = new PoliticaEscalonada(id, tramos);
    } else throw new Error(id + ': tipo de política no soportado');
    Object.assign(estrategia, { id, nombre: d.nombre ?? estrategia.nombre, vigenteDesde: d.vigencia_otorgamiento.desde ?? estrategia.vigenteDesde, vigencia_otorgamiento: { ...d.vigencia_otorgamiento }, version: d.version, autor: d.autor, motivo: d.motivo });
    return estrategia;
  });
}

export function seleccionarPoliticaMora(fecha: string, catalogo: readonly PoliticaMora[], definiciones: Record<string, DefinicionMora>): PoliticaMora {
  validarFechaPolitica(fecha);
  const seleccion = catalogo.filter(p => {
    const v = definiciones[p.id].vigencia_otorgamiento;
    return (!v.desde || fecha >= v.desde) && (!v.hasta || fecha <= v.hasta);
  });
  if (seleccion.length !== 1) throw new Error('No existe una única política vigente para el otorgamiento del ' + fecha);
  return seleccion[0];
}
