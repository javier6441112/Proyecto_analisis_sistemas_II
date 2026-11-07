import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { validarConfiguracionProvisiones } from '../contratos/provisiones.js';
import type { PoliticaProvisiones } from '../dominio/provisiones.js';

export const directorioProvisiones = fileURLToPath(new URL('../../configuracion/provisiones/', import.meta.url));

/** Carga externa en cada vista previa. Un cierre guardado nunca vuelve a leer esta configuración. */
export function cargarPoliticaProvisiones(fechaCorte: string, directorio = directorioProvisiones): PoliticaProvisiones {
  const politicas = readdirSync(directorio).filter(n => n.endsWith('.json')).sort()
    .map(n => validarConfiguracionProvisiones(JSON.parse(readFileSync(join(directorio, n), 'utf8'))));
  const versiones = new Set<string>();
  for (const p of politicas) {
    if (versiones.has(p.version)) throw new Error('Versión de provisiones duplicada');
    versiones.add(p.version);
  }
  const ordenadas = [...politicas].sort((a, b) => a.vigenteDesde.localeCompare(b.vigenteDesde));
  for (let i = 1; i < ordenadas.length; i++) {
    const anterior = ordenadas[i - 1];
    if (!anterior.vigenteHasta || anterior.vigenteHasta >= ordenadas[i].vigenteDesde) {
      throw new Error('Vigencias ambiguas de provisiones');
    }
  }
  const aplicables = politicas.filter(p => p.vigenteDesde <= fechaCorte && (!p.vigenteHasta || fechaCorte <= p.vigenteHasta));
  if (aplicables.length !== 1) throw new Error('No existe política de provisiones vigente al corte');
  return structuredClone(aplicables[0]);
}
