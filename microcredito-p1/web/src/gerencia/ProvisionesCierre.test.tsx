import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { abrirBaseDatos } from '../../../src/persistencia/base-datos';
import { cargarCanonico } from '../../../src/persistencia/carga-canonica';
import { AdaptadorNucleo } from '../../../src/persistencia/adaptador-nucleo';
import { construirServidor } from '../../../src/api/servidor';
import { Cierre } from '../../../src/contratos/api';
import { ProvisionesCierre } from './ProvisionesCierre';
import { DevengoCierre } from './DevengoCierre';
import { Q } from '../formato';

it('presenta total, versión y cada importe de la API de una base temporal sin calcularlos en pantalla', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cv-pantalla-provisiones-'));
  const db = await abrirBaseDatos(join(dir, 'db'));
  try { await cargarCanonico(db, resolve('datos/datos-proyecto-final')); } finally { await db.close(); }
  const a = await AdaptadorNucleo.abrir({ dbDir: join(dir, 'db') });
  const app = await construirServidor({ adaptador: a });
  try {
    const respuesta = await app.inject({ method: 'GET', url: '/api/cierres/2026-10' });
    expect(respuesta.statusCode).toBe(200);
    const respuestaCierre = Cierre.parse(respuesta.json());
    const d = respuestaCierre.devengo;
    if (d?.estado !== 'DISPONIBLE') throw new Error('Falta devengo mensual');
    const htmlDevengo = renderToStaticMarkup(<DevengoCierre devengo={d} />);
    for (const importe of [d.periodo.generado, d.periodo.ingresoReconocido, d.periodo.enviadoSuspenso,
      d.periodo.suspensoRegularizado, d.saldoFinalSuspenso, d.apertura.ingresoReconocido]) expect(htmlDevengo).toContain(Q(importe));
    expect(htmlDevengo).toContain('separados de intereses cobrados');
    const p = respuestaCierre.provisiones;
    expect(p?.estado).toBe('DISPONIBLE');
    if (p?.estado !== 'DISPONIBLE') throw new Error('Falta provisión mensual');
    const html = renderToStaticMarkup(<ProvisionesCierre provisiones={p} />);
    expect(html).toContain(Q(p.total));
    expect(html).toContain(p.version);
    expect(html).toContain('separado de recuperaciones, intereses cobrados y cartera bruta');
    for (const d of p.detalles) {
      expect(html).toContain(d.id);
      expect(html).toContain(Q(d.base));
      expect(html).toContain(Q(d.provision));
      expect(html).toContain(`${d.porcentaje} %`);
    }
  } finally { await app.close(); await a.cerrar(); rmSync(dir, { recursive: true, force: true }); }
}, 60000);

it('los formatos históricos sin provisiones muestran no disponible, sin inventar un importe', () => {
  for (const p of [undefined, { estado: 'NO_DISPONIBLE' as const, motivo: 'No disponible en esta versión histórica' }]) {
    const html = renderToStaticMarkup(<ProvisionesCierre provisiones={p} />);
    expect(html.toLowerCase()).toContain('disponible');
    expect(html).not.toContain('Q0.00');
    expect(html).not.toContain('Reserva de capital:');
  }
});
