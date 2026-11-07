import type { TCierre } from '../api';
import { Q } from '../formato';

/** Presentación de valores del servidor; no calcula devengo ni reconocimiento. */
export function DevengoCierre({ devengo }: { devengo: TCierre['devengo'] }) {
  return <section className="bg-white rounded-2xl border border-slate-200 p-5 text-sm">
    <h2 className="font-bold">Devengo de interés corriente</h2>
    {!devengo || devengo.estado === 'NO_DISPONIBLE' ? <p>{devengo?.motivo ?? 'Devengo no disponible en esta versión del cierre histórico'}</p> : <>
      <p>Período {devengo.desde} a {devengo.hasta}. Importes por competencia, separados de intereses cobrados en recuperaciones.</p>
      <dl>{([
        ['Interés corriente generado durante el período', devengo.periodo.generado],
        ['Ingreso reconocido durante el período', devengo.periodo.ingresoReconocido],
        ['Interés enviado a suspenso', devengo.periodo.enviadoSuspenso],
        ['Suspenso reconocido por regularización', devengo.periodo.suspensoRegularizado],
        ['Suspenso retirado sin ingreso', devengo.periodo.suspensoRetirado],
        ['Saldo final en suspenso', devengo.saldoFinalSuspenso],
      ] as const).map(([label, importe]) => <div className="flex justify-between gap-3 py-1" key={label}><dt>{label}</dt><dd className="font-mono font-bold">{Q(importe)}</dd></div>)}</dl>
      <details className="mt-2"><summary>Apertura e historia anterior al período</summary>
        <p>Generado anterior: {Q(devengo.apertura.generado)} · Ingreso reconocido anterior: {Q(devengo.apertura.ingresoReconocido)} · Suspenso al inicio: {Q(devengo.apertura.saldoSuspenso)}</p>
        <p>{devengo.aperturaRegistro?.motivo} · Cierre de apertura {devengo.aperturaRegistro?.cierreId} · Fecha {devengo.aperturaRegistro?.fecha}</p>
        <p>La apertura anterior no se atribuye al ingreso del período actual.</p>
      </details>
      <p className="text-xs mt-2">Políticas: {[...new Set(devengo.politicas.map(p => p.politica.version))].join(', ') || 'Sin créditos al corte'}</p>
      <details className="mt-2"><summary>Movimientos del período ({devengo.movimientos.length})</summary>
        <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr>
          <th>Crédito / cuota</th><th>Intervalo (inicio excluido)</th><th>Concepto</th><th>Importe</th><th>Cierre</th><th>Política</th>
        </tr></thead><tbody>{devengo.movimientos.map(m => <tr key={m.id}>
          <td>{m.creditoId} / {m.cuota}</td><td>{m.desde} a {m.hasta}</td><td>{m.concepto}</td><td>{Q(m.importe)}</td><td>{m.cierreId}</td><td>{m.versionPolitica}</td>
        </tr>)}</tbody></table></div>
      </details>
    </>}
  </section>;
}
