import type { TCierre } from '../api';
import { Q } from '../formato';

export function MovimientosProvisiones({ contabilizacion }: { contabilizacion: TCierre['contabilizacionProvisiones'] }) {
  if (!contabilizacion) return <p className="text-sm">Sin movimientos de provisiones asociados en esta versión. La vista previa no contabiliza.</p>;
  return <section className="bg-white rounded-2xl border border-slate-200 p-5 text-sm">
    <h2 className="font-bold">Movimientos de provisiones del cierre</h2>
    <p>Saldo anterior {Q(contabilizacion.saldoAnterior)} · Variación {Q(contabilizacion.variacion)} · Saldo final {Q(contabilizacion.saldoFinal)}</p>
    <p>Apertura {contabilizacion.apertura.origen} · {contabilizacion.apertura.fechaContable} · {contabilizacion.apertura.usuario}</p>
    <p>{contabilizacion.apertura.motivo}</p>
    <details><summary>Movimientos ({contabilizacion.movimientos.length})</summary>
      {contabilizacion.movimientos.length === 0 && <p>Sin variación: no se registraron movimientos adicionales.</p>}
      <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr>
        <th>Movimiento</th><th>Crédito</th><th>Cierre</th><th>Fecha contable</th><th>Concepto</th><th>Importe con signo</th><th>Política</th>
      </tr></thead><tbody>{contabilizacion.movimientos.map(m => <tr key={m.id}>
        <td>{m.id}</td><td>{m.creditoId}</td><td>{m.cierreId}</td><td>{m.fechaContable}</td><td>{m.concepto}</td><td>{Q(m.importe)}</td><td>{m.versionPolitica}</td>
      </tr>)}</tbody></table></div>
    </details>
  </section>;
}
