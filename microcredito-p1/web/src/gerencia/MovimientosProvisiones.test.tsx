import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContabilizacionProvisionesSchema } from '../../../src/contratos/provisiones';
import { MovimientosProvisiones } from './MovimientosProvisiones';
import { Q } from '../formato';

const parametros = JSON.parse(readFileSync(resolve('configuracion/provisiones/credito-vecino-v1.json'), 'utf8'));
const dinero = (valor: string) => ({ valor, moneda: 'GTQ' });
it.each([['50.00', '100.00', '150.00', 'CONSTITUCION'], ['-30.00', '150.00', '120.00', 'REDUCCION']])(
  'muestra la variación %s y sus referencias sin calcular importes', (variacion, anterior, final, concepto) => {
    const c = ContabilizacionProvisionesSchema.parse({
      apertura: { id: 'INICIAL', fechaContable: '2026-01-31', cierreId: '2026-01', usuario: 'Gerente', motivo: 'Conciliado', origen: 'CIERRE_HISTORICO' },
      saldoAnterior: dinero(anterior), variacion: dinero(variacion), saldoFinal: dinero(final),
      movimientos: [{ id: 'CIERRE:2026-02:C1', creditoId: 'C1', periodo: '2026-02', cierreId: '2026-02', fechaContable: '2026-02-28',
        importe: dinero(variacion), concepto, versionPolitica: parametros.version, parametros, usuario: 'Gerente' }],
    });
    const html = renderToStaticMarkup(<MovimientosProvisiones contabilizacion={c} />);
    expect(html).toContain(Q(c.variacion)); expect(html).toContain(Q(c.saldoAnterior)); expect(html).toContain(Q(c.saldoFinal));
    expect(html).toContain('CIERRE:2026-02:C1'); expect(html).toContain(concepto); expect(html).toContain(parametros.version);
  });
it('distingue la falta de contabilización del formato histórico', () => {
  expect(renderToStaticMarkup(<MovimientosProvisiones contabilizacion={undefined} />)).toContain('Sin movimientos de provisiones asociados en esta versión');
});
