import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PoliticaDevengoSchema } from '../contratos/devengo.js';
import { validarPoliticaDevengo, type PoliticaDevengo } from '../dominio/devengo.js';

export function cargarPoliticasDevengo(dir = fileURLToPath(new URL('../../configuracion/devengo/', import.meta.url))): PoliticaDevengo[] {
  const politicas = readdirSync(dir).filter(n => n.endsWith('.json')).sort().map(n => PoliticaDevengoSchema.parse(JSON.parse(readFileSync(join(dir, n), 'utf8'))));
  const versiones = new Set<string>();
  for (const p of politicas) { validarPoliticaDevengo(p); if (versiones.has(p.version)) throw new Error('Versión de devengo duplicada'); versiones.add(p.version); }
  const ordenadas = [...politicas].sort((a, b) => a.vigenteDesde.localeCompare(b.vigenteDesde));
  for (let i = 1; i < ordenadas.length; i++) if (!ordenadas[i - 1].vigenteHasta || ordenadas[i - 1].vigenteHasta! >= ordenadas[i].vigenteDesde) throw new Error('Vigencias de devengo ambiguas');
  return politicas;
}
export function politicaDevengoPara(desembolso: string, politicas: readonly PoliticaDevengo[]): PoliticaDevengo {
  const r = politicas.filter(p => p.vigenteDesde <= desembolso && (!p.vigenteHasta || p.vigenteHasta >= desembolso));
  if (r.length !== 1) throw new Error('No existe política de devengo para el otorgamiento');
  return structuredClone(r[0]);
}
