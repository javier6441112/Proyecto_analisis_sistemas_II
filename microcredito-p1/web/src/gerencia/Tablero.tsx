import { useState, type ReactNode } from 'react';
import { EncabezadoPagina } from '../App';
import { api } from '../api';
import { ETIQUETA_TRAMO, Q, colorTramo, fecha, fechaLarga } from '../formato';
import { useSesion } from '../sesion';
import { Alert, Badge, ConCarga, DISPLAY, FOCO, Ico, Seccion, useCarga } from '../ui';
import { VistaCredito } from '../asesor/Creditos';

interface FilaTramo { idCredito: string; nombreCliente: string; diasAtraso: number; saldoCapital: { valor: string; moneda: 'GTQ' }; tramo: string }

export default function Tablero({ irComite, irCierres, irAsistente }: { irComite: () => void; irCierres: () => void; irAsistente: () => void }) {
  const s = useSesion();
  const [tramo, setTramo] = useState<string | null>(null);
  const [credito, setCredito] = useState<string | null>(null);

  const carga = useCarga(async () => {
    const [cartera, cierreMes, vencimientos, solicitudes] = await Promise.all([
      api.cartera(s.fecha),
      api.cierre(s.fecha.slice(0, 7)),
      api.vencimientos(s.fecha, 30),
      api.solicitudes(),
    ]);
    return { cartera, cierreMes, vencimientos, pendientes: solicitudes.filter((x) => x.estado === 'SOLICITADA').length };
  }, [s.fecha]);

  return (
    <div className="p-4 md:p-8 flex flex-col gap-6 max-w-7xl">
      <EncabezadoPagina titulo="Tablero gerencial" sub={`Cartera al ${fechaLarga(s.fecha)}`} />
      <ConCarga carga={carga}>
        {({ cartera: c, cierreMes, vencimientos, pendientes }) => {
          const riesgo = c.resumen.riesgoPorTramo;
          return (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Kpi valor={Q(c.resumen.carteraActiva)} titulo="Cartera activa total" sub={`${c.conteos.activos} créditos activos de ${c.conteos.desembolsados} desembolsados`} />
                <Kpi valor={Q(c.carteraEnMora)} titulo="Cartera en mora" sub={`${c.porcentajes.mora} · ${c.conteos.enMora} créditos con 1+ día de atraso`} tono="rojo"
                  nota="Cartera en mora: saldo de todos los créditos con uno o más días de atraso." />
                <Kpi valor={Q(c.resumen.saldoEnRiesgo)} titulo="Cartera en riesgo" sub={`${c.porcentajes.riesgo} · más de 30 días + reestructurados`} tono="ambar"
                  nota="Cartera en riesgo: más de 30 días de atraso más los reestructurados, aunque estén al día." />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Kpi chico valor={Q(cierreMes.desembolsos.monto)} titulo={`Desembolsos (${fecha(cierreMes.periodo)})`} sub={`${cierreMes.desembolsos.cantidad} créditos`} />
                <Kpi chico valor={Q(cierreMes.recuperaciones.total)} titulo={`Recuperaciones (${fecha(cierreMes.periodo)})`} sub={`${cierreMes.recuperaciones.pagos} pagos · capital ${Q(cierreMes.recuperaciones.capital)}`} />
                <Kpi chico valor={Q(c.incobrableDelMes)} titulo="Declarado incobrable en el mes" sub={`Acumulado incobrable: ${Q(c.resumen.incobrable)}`}
                  nota={c.incobrablesDelMes.length > 0
                    ? `${c.incobrablesDelMes.map((x) => `${x.idCredito} (${fecha(x.fechaIncobrable)})`).join(', ')}. Al pasar a incobrable salen de la cartera en riesgo sin que ocurra un pago; el monto sigue visible aquí.`
                    : undefined} />
              </div>

              <Seccion titulo={`Desglose de cartera en riesgo · Total ${Q(c.resumen.saldoEnRiesgo)} — ${c.porcentajes.riesgo}`}>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  {riesgo.map((t) => {
                    const activo = tramo === t.tramo;
                    return (
                      <button key={t.tramo} onClick={() => { setTramo(activo ? null : t.tramo); setCredito(null); }} aria-pressed={activo}
                        className={`rounded-2xl border p-4 text-left transition-all ${FOCO} ${activo ? 'border-[#0f172a] bg-[#0f172a]' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                        <p className={`text-xs font-semibold mb-1 ${activo ? 'text-teal-300' : 'text-slate-500'}`}>{ETIQUETA_TRAMO[t.tramo]}</p>
                        <p className={`text-lg font-bold ${activo ? 'text-white' : 'text-[#0f172a]'}`} style={DISPLAY}>{Q(t.saldo)}</p>
                        <p className={`text-[11px] font-mono mt-0.5 ${activo ? 'text-slate-300' : 'text-slate-600'}`}>{c.porcentajes.riesgoPorTramo[t.tramo] ?? '—'}</p>
                      </button>
                    );
                  })}
                </div>
              </Seccion>

              {tramo && <CreditosDelTramo tramo={tramo} abrir={setCredito} />}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white rounded-2xl border border-slate-200 p-5">
                  <p className="font-bold text-[#0f172a] mb-3" style={DISPLAY}>Distribución por días de atraso</p>
                  <div className="flex flex-col divide-y divide-slate-100">
                    {c.porTramo.map((t) => (
                      <div key={t.tramo} className="flex items-center justify-between py-2.5 gap-2">
                        <span className="flex items-center gap-2"><Badge label={ETIQUETA_TRAMO[t.tramo]!} color={colorTramo(t.tramo)} /><span className="text-xs text-slate-500">{t.creditos} créditos</span></span>
                        <span className="font-mono text-sm font-semibold">{Q(t.saldo)}</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between py-2.5 gap-2">
                      <span className="flex items-center gap-2"><Badge label="Reestructurado al día" color="blue" /><span className="text-xs text-slate-500">{c.reestructuradosAlDia.creditos} créditos</span></span>
                      <span className="font-mono text-sm font-semibold">{Q(c.reestructuradosAlDia.saldo)}</span>
                    </div>
                  </div>
                </div>
                <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col gap-3">
                  <p className="font-bold text-[#0f172a]" style={DISPLAY}>Próximos 30 días</p>
                  <p className="text-sm text-slate-600">
                    Vencen <strong className="text-[#0f172a]">{vencimientos.totalCuotas} cuotas</strong> por <strong className="text-[#0f172a]">{Q(vencimientos.montoTotal)}</strong> entre el {fecha(vencimientos.desde)} y el {fecha(vencimientos.hasta)}.
                  </p>
                  <div className="flex flex-col divide-y divide-slate-100 max-h-56 overflow-auto">
                    {vencimientos.cuotas.slice(0, 12).map((v) => (
                      <button key={`${v.idCredito}-${v.numeroCuota}`} onClick={() => setCredito(v.idCredito)} className={`flex justify-between gap-2 py-2 text-left text-xs ${FOCO}`}>
                        <span className="min-w-0 truncate"><span className="font-mono text-slate-500">{fecha(v.fechaVencimiento)}</span> · {v.nombreCliente}</span>
                        <span className="font-mono font-semibold shrink-0">{Q(v.monto)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Atajo icono={Ico.clipboard('#5eead4')} titulo="Bandeja del comité" sub={`${pendientes} solicitudes pendientes`} onClick={irComite} />
                <Atajo icono={Ico.calendar('#5eead4')} titulo="Cierres contables" sub="Diario y mensual" onClick={irCierres} />
                <Atajo icono={Ico.chat('#5eead4')} titulo="Asistente gerencial" sub="Preguntas sobre cartera, mora y vencimientos" onClick={irAsistente} />
              </div>
            </>
          );
        }}
      </ConCarga>

      {credito && (
        <div className="fixed inset-0 bg-black/40 flex justify-end z-50" role="dialog" aria-modal="true" aria-label={`Crédito ${credito}`} onClick={() => setCredito(null)}>
          <div className="bg-white w-full max-w-[430px] h-full shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            <VistaCredito id={credito} volver={() => setCredito(null)} />
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ valor, titulo, sub, nota, tono, chico }: { valor: string; titulo: string; sub: string; nota?: string; tono?: 'rojo' | 'ambar'; chico?: boolean }) {
  const fondo = tono === 'rojo' ? 'bg-red-50 border-red-100' : tono === 'ambar' ? 'bg-amber-50 border-amber-100' : 'bg-white border-slate-200';
  const color = tono === 'rojo' ? 'text-red-700' : tono === 'ambar' ? 'text-amber-700' : 'text-[#0f172a]';
  return (
    <div className={`${fondo} rounded-2xl border p-5`}>
      <p className={`${chico ? 'text-2xl font-bold' : 'text-3xl font-extrabold'} ${color}`} style={DISPLAY}>{valor}</p>
      <p className="text-sm font-semibold text-[#0f172a] mt-1">{titulo}</p>
      <p className="text-xs text-slate-500 mt-0.5">{sub}</p>
      {nota && <p className={`text-[11px] mt-2 pt-2 leading-relaxed ${tono ? 'border-t border-slate-200 text-slate-600 italic' : 'text-amber-700 bg-amber-50 rounded-lg px-2 py-1.5'}`}>{nota}</p>}
    </div>
  );
}

function Atajo({ icono, titulo, sub, onClick }: { icono: ReactNode; titulo: string; sub: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-4 px-4 py-4 text-left bg-white rounded-2xl border border-slate-200 hover:border-slate-300 ${FOCO}`}>
      <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#0f172a] shrink-0">{icono}</span>
      <span className="flex-1"><span className="block text-sm font-semibold text-slate-800">{titulo}</span><span className="block text-xs text-slate-600 mt-0.5">{sub}</span></span>
      <span className="text-slate-300">{Ico.chevRight()}</span>
    </button>
  );
}

function CreditosDelTramo({ tramo, abrir }: { tramo: string; abrir: (id: string) => void }) {
  const s = useSesion();
  const carga = useCarga<FilaTramo[]>(async () => {
    if (tramo === 'REESTRUCTURADO_AL_DIA') {
      const { creditos } = await api.creditos(s.fecha);
      return creditos.filter((c) => c.estado === 'REESTRUCTURADO' && c.diasAtraso <= 30);
    }
    return (await api.carteraMora(s.fecha, tramo)).creditos;
  }, [tramo, s.fecha]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <h3 className="font-bold text-[#0f172a] mb-3" style={DISPLAY}>{ETIQUETA_TRAMO[tramo]} — créditos</h3>
      <ConCarga carga={carga}>
        {(filas) => filas.length === 0 ? (
          <Alert type="success">Sin saldo en {ETIQUETA_TRAMO[tramo]}: ningún crédito está en este tramo al {fecha(s.fecha)}.</Alert>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className="text-[11px] text-slate-600 font-mono uppercase tracking-wide border-b border-slate-100">
                  {['Crédito', 'Cliente', 'Atraso', 'Saldo de capital', ''].map((h) => <th key={h} className="text-left pb-2 pr-4 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.idCredito} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                    <td className="py-3 pr-4 font-mono text-xs text-slate-500">{f.idCredito}</td>
                    <td className="py-3 pr-4 font-semibold text-[#0f172a]">{f.nombreCliente}</td>
                    <td className="py-3 pr-4"><Badge label={f.diasAtraso > 0 ? `${f.diasAtraso} días` : 'Al día'} color={f.diasAtraso > 90 ? 'red' : f.diasAtraso > 30 ? 'amber' : 'green'} /></td>
                    <td className="py-3 pr-4 font-mono font-bold text-[#0f172a]">{Q(f.saldoCapital)}</td>
                    <td className="py-3 text-right">
                      <button onClick={() => abrir(f.idCredito)} className={`text-xs font-semibold text-teal-700 underline ${FOCO}`}>Ver crédito</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ConCarga>
    </div>
  );
}
