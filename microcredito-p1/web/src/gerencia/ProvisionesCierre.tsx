import type { TCierre } from '../api';
import { Q, fecha } from '../formato';

/** Presenta exclusivamente los importes recibidos del servidor. */
export function ProvisionesCierre({ provisiones }: { provisiones: TCierre['provisiones'] }) {
  return <section className="bg-white rounded-2xl border border-slate-200 p-5">
    <h2 className="font-bold text-sm">Provisiones de cartera al corte</h2>
    {!provisiones || provisiones.estado === 'NO_DISPONIBLE' ?
      <p className="text-sm mt-2">{provisiones?.motivo ?? 'Provisiones no disponibles en esta versión del cierre histórico'}</p> : <>
        <p className="text-sm mt-2">Reserva de capital: <strong>{Q(provisiones.total)}</strong></p>
        <p className="text-xs mt-2">Corte {fecha(provisiones.fechaCorte)} · Política {provisiones.version} · Vigencia {provisiones.parametros.vigenteDesde} a {provisiones.parametros.vigenteHasta ?? 'abierta'}</p>
        <p className="text-xs mt-2">Concepto separado de recuperaciones, intereses cobrados y cartera bruta. No representa un movimiento contable.</p>
        <details className="mt-3">
          <summary>Detalle de provisiones por crédito ({provisiones.detalles.length})</summary>
          <div className="overflow-x-auto"><table className="w-full text-xs mt-2">
            <thead><tr><th>Crédito</th><th>Tramo</th><th>Base de capital</th><th>Porcentaje</th><th>Provisión</th></tr></thead>
            <tbody>{provisiones.detalles.map(d => <tr key={d.id}>
              <td>{d.id}{d.excluido ? ' (excluido)' : ''}</td><td>{d.tramo}</td><td>{Q(d.base)}</td>
              <td>{d.porcentaje} %</td><td>{Q(d.provision)}</td>
            </tr>)}</tbody>
          </table></div>
        </details>
      </>}
  </section>;
}
