import { afterAll, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { ContextoPoliticas, AdaptadorNucleo, type ParametrosPoliticas } from '../src/persistencia/adaptador-nucleo.js';
import { abrirBaseDatos } from '../src/persistencia/base-datos.js';
import { cargarCanonico } from '../src/persistencia/carga-canonica.js';
import { Dinero } from '../src/dominio/dinero.js';
import { PoliticaPlana } from '../src/dominio/politica-mora/politica-plana.js';
import { PoliticaEscalonada } from '../src/dominio/politica-mora/politica-escalonada.js';
import { gastoGestionCobro } from '../src/dominio/politica-mora/gasto-gestion-cobro.js';
const dir = mkdtempSync(join(tmpdir(), 'cv-parametros-'));
const archivo = join(dir, 'politicas.json');
const original: ParametrosPoliticas = JSON.parse(readFileSync(resolve('datos/datos-proyecto-final/politicas.json'), 'utf8'));
function cargar(cambiar: (p: ParametrosPoliticas) => void = () => {}) {
  const p = structuredClone(original); cambiar(p);
  writeFileSync(archivo, JSON.stringify(p));
  return new ContextoPoliticas(JSON.parse(readFileSync(archivo, 'utf8')));
}
afterAll(() => rmSync(dir, { recursive: true, force: true }));
it('conserva resultados canónicos en los límites y después del día 120', () => {
  const c = cargar();
  for (const [fecha, estrategia] of [['2026-09-30', new PoliticaPlana()], ['2026-10-01', new PoliticaEscalonada()]] as const) {
    for (const dias of [0, 1, 30, 31, 60, 61, 90, 91, 120, 121, 180]) {
      expect(c.politicaParaOtorgamiento(fecha).calcular(Dinero.de('1000'), dias)).toEqual(estrategia.calcular(Dinero.de('1000'), dias));
    }
  }
});
it('utiliza tasas, tramos y gastos del archivo temporal', () => {
  const c = cargar(p => { p.politicas_mora['POL-2024-01'].tna_bps = 3600; p.politicas_mora['POL-2026-10'].tramos![0].bps = 3600; p.gasto_gestion_cobro.monto_centavos = 3000; p.gasto_gestion_cobro.dia_generacion = 40; });
  expect(c.politicaParaOtorgamiento('2026-09-30').calcular(Dinero.de('1000'), 30).formato()).toBe('30.00');
  expect(c.politicaParaOtorgamiento('2026-10-01').calcular(Dinero.de('1000'), 30).formato()).toBe('30.00');
  expect(gastoGestionCobro(Dinero.de('1000'), 39, 'POL-2026-10', c.parametros.gasto_gestion_cobro).formato()).toBe('0.00');
  expect(gastoGestionCobro(Dinero.de('1000'), 40, 'POL-2026-10', c.parametros.gasto_gestion_cobro).formato()).toBe('30.00');
});
it('selecciona por vigencia configurada y conserva metadatos', () => {
  const c = cargar(p => { p.politicas_mora['POL-2024-01'].vigencia_otorgamiento.hasta = '2026-10-14'; p.politicas_mora['POL-2026-10'].vigencia_otorgamiento.desde = '2026-10-15'; });
  expect(c.politicaParaOtorgamiento('2026-10-14').id).toBe('POL-2024-01');
  expect(c.politicaParaOtorgamiento('2026-10-15')).toMatchObject({ id: 'POL-2026-10', vigenteDesde: '2026-10-15', autor: original.politicas_mora['POL-2026-10'].autor });
  expect(() => c.politicaParaOtorgamiento('2026-02-30')).toThrow(/fecha/);
});
it('rechaza parámetros inválidos con mensajes claros', () => {
  expect(() => cargar(p => { p.politicas_mora['POL-2024-01'].tna_bps = -1; })).toThrow(/tasa/);
  expect(() => cargar(p => { p.politicas_mora['POL-2026-10'].tramos![1].ini = 29; })).toThrow(/tramos/);
  expect(() => cargar(p => { p.gasto_gestion_cobro.monto_centavos = -1; })).toThrow(/gasto/);
  expect(() => cargar(p => { p.politicas_mora['POL-2026-10'].vigencia_otorgamiento.desde = '2026-09-30'; })).toThrow(/superpuestas/);
});
it('conserva parámetros históricos del cierre al reabrir con configuración diferente', async () => {
  const dbDir = join(dir, 'db');
  const db = await abrirBaseDatos(dbDir);
  await cargarCanonico(db, resolve('datos/datos-proyecto-final')); await db.close();
  let a = await AdaptadorNucleo.abrir({ dbDir });
  try {
    const cierre = await a.ejecutarCierre('2026-10', 'Prueba');
    const nuevos = cargar(p => { p.version = '2.0'; p.politicas_mora['POL-2024-01'].tna_bps = 3600; }).parametros;
    await a.db.query('UPDATE parametros_politicas SET contenido=$1::jsonb', [JSON.stringify(nuevos)]);
    await a.cerrar(); a = await AdaptadorNucleo.abrir({ dbDir });
    expect(a.politicas.parametros.version).toBe('2.0');
    expect(await a.consultarCierre('2026-10')).toEqual(cierre);
    expect(await a.ejecutarCierre('2026-10', 'Otro')).toEqual(cierre);
  } finally { await a.cerrar(); }
}, 60000);
