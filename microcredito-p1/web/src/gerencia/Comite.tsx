import { useState, type ReactNode } from 'react';
import { EncabezadoPagina } from '../App';
import { api, mensajeDeError, type TSolicitud } from '../api';
import { ETIQUETA_ESTADO, Q, colorEstado, fecha, tasaAnual, tasaMensual } from '../formato';
import { useSesion } from '../sesion';
import { Alert, Badge, ConCarga, DISPLAY, Exito, FOCO, Ico, useCarga } from '../ui';
import Desembolso from '../asesor/Desembolso';
import { PlanAmortizacion, VistaCredito } from '../asesor/Creditos';

const FILTROS = [
  ['Pendientes', 'SOLICITADA'],
  ['Aprobadas', 'APROBADA'],
  ['Rechazadas', 'RECHAZADA'],
  ['Desembolsadas', 'DESEMBOLSADA'],
  ['Todas', ''],
] as const;

type Panel = { v: 'detalle' } | { v: 'resuelta'; sol: TSolicitud } | { v: 'desembolso' } | { v: 'credito'; id: string };

export default function Comite() {
  const [filtro, setFiltro] = useState<string>('SOLICITADA');
  const [elegida, setElegida] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>({ v: 'detalle' });
  const carga = useCarga(() => api.solicitudes(), []);

  const abrir = (id: string | null) => { setElegida(id); setPanel({ v: 'detalle' }); };
  const sol = carga.datos?.find((x) => x.idSolicitud === elegida);

  let detalle: ReactNode = <div className="h-full min-h-40 flex items-center justify-center text-slate-600 text-sm">Selecciona una solicitud para ver el detalle.</div>;
  if (elegida && panel.v === 'desembolso') {
    detalle = (
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden h-[min(780px,80vh)] flex flex-col">
        <Desembolso idSolicitud={elegida} volver={() => setPanel({ v: 'detalle' })} alInicio={() => { abrir(null); carga.recargar(); }}
          verCredito={(id) => { setPanel({ v: 'credito', id }); carga.recargar(); }} />
      </div>
    );
  } else if (panel.v === 'credito') {
    detalle = (
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden h-[min(780px,80vh)] flex flex-col">
        <VistaCredito id={panel.id} volver={() => abrir(null)} />
      </div>
    );
  } else if (panel.v === 'resuelta') {
    const r = panel.sol;
    const aprobada = r.estado === 'APROBADA';
    detalle = (
      <div className="bg-white rounded-2xl border border-slate-200 p-6 flex flex-col items-center gap-4 text-center">
        <Exito titulo={`Solicitud ${aprobada ? 'aprobada' : 'rechazada'}`}>
          <p className="text-slate-500 text-sm">{r.idSolicitud} · {r.nombreCliente}</p>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <Badge label={ETIQUETA_ESTADO[r.estado]!} color={colorEstado(r.estado)} />
            <span className="text-xs text-slate-600 font-mono">{fecha(r.resolucion?.fecha)} · {r.resolucion?.usuario}</span>
          </div>
          <p className="text-xs text-slate-500 italic">«{r.resolucion?.motivo}»</p>
        </Exito>
        {aprobada && (
          <button onClick={() => setPanel({ v: 'desembolso' })} className={`w-full max-w-xs bg-[#0f172a] text-white rounded-xl py-3.5 text-sm font-bold ${FOCO}`} style={DISPLAY}>
            Continuar al desembolso →
          </button>
        )}
        <button onClick={() => abrir(null)} className={`border border-slate-200 bg-white rounded-xl px-6 py-3 text-sm font-semibold text-slate-600 ${FOCO}`}>Volver a la bandeja</button>
      </div>
    );
  } else if (sol) {
    detalle = <DetalleSolicitud sol={sol} resuelta={(r) => { setPanel({ v: 'resuelta', sol: r }); carga.recargar(); }}
      desembolsar={() => setPanel({ v: 'desembolso' })} verCredito={(id) => setPanel({ v: 'credito', id })} />;
  }

  return (
    <div className="p-4 md:p-8 flex flex-col gap-6 max-w-7xl">
      <EncabezadoPagina titulo="Bandeja del comité" sub="Evaluación de solicitudes de crédito" />
      <div className="flex flex-col lg:flex-row gap-4">
        <div className={`lg:w-80 shrink-0 flex flex-col gap-3 ${elegida ? 'hidden lg:flex' : ''}`}>
          <div className="flex gap-2 flex-wrap" role="group" aria-label="Filtrar solicitudes">
            {FILTROS.map(([l, e]) => (
              <button key={l} onClick={() => { setFiltro(e); abrir(null); }} aria-pressed={filtro === e}
                className={`px-3 py-2 rounded-lg text-xs font-medium border ${FOCO} ${filtro === e ? 'bg-[#0f172a] text-white border-[#0f172a]' : 'bg-white text-slate-600 border-slate-200'}`}>
                {l}
              </button>
            ))}
          </div>
          <ConCarga carga={carga}>
            {(todas) => {
              const lista = todas.filter((x) => !filtro || x.estado === filtro).reverse();
              if (lista.length === 0) return <p className="text-sm text-slate-500 text-center py-6">Sin solicitudes en este filtro.</p>;
              return (
                <div className="flex flex-col gap-2">
                  {lista.map((x) => (
                    <button key={x.idSolicitud} onClick={() => abrir(x.idSolicitud)}
                      className={`text-left bg-white border rounded-2xl p-4 transition-all ${FOCO} ${elegida === x.idSolicitud ? 'border-[#0f172a]' : 'border-slate-200'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <Badge label={ETIQUETA_ESTADO[x.estado]!} color={colorEstado(x.estado)} />
                        <span className="text-[11px] font-mono text-slate-600">{x.idSolicitud}</span>
                      </div>
                      <p className="text-sm font-semibold text-[#0f172a]">{x.nombreCliente}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{Q(x.capital)} · {x.plazoMeses} meses · {fecha(x.fecha)}</p>
                    </button>
                  ))}
                </div>
              );
            }}
          </ConCarga>
        </div>
        <div className={`flex-1 min-w-0 ${elegida ? '' : 'hidden lg:block'}`}>
          {elegida && (
            <button onClick={() => abrir(null)} className={`lg:hidden mb-3 flex items-center gap-1 text-sm text-slate-600 ${FOCO}`}>{Ico.chevLeft()} Volver a la bandeja</button>
          )}
          {detalle}
        </div>
      </div>
    </div>
  );
}

function DetalleSolicitud({ sol, resuelta, desembolsar, verCredito }: {
  sol: TSolicitud; resuelta: (s: TSolicitud) => void; desembolsar: () => void; verCredito: (id: string) => void;
}) {
  const s = useSesion();
  const [modal, setModal] = useState<'APROBADA' | 'RECHAZADA' | null>(null);
  const [verPlan, setVerPlan] = useState(false);
  const datos = useCarga(async () => {
    const [plan, clientes, asesores] = await Promise.all([
      api.simularPlan({ capital: sol.capital.valor, plazoMeses: sol.plazoMeses, tnaBps: sol.tnaBps, fechaDesembolso: s.fecha }),
      api.clientes(sol.idCliente),
      api.asesores(),
    ]);
    return { plan, cliente: clientes.find((c) => c.idCliente === sol.idCliente), asesor: asesores.find((a) => a.idAsesor === sol.idAsesor) };
  }, [sol.idSolicitud, s.fecha]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xl font-bold text-[#0f172a]" style={DISPLAY}>{sol.nombreCliente}</p>
          <p className="text-slate-600 text-xs font-mono mt-0.5">{sol.idCliente}{datos.datos?.cliente ? ` · DPI ${datos.datos.cliente.dpi}` : ''} · {sol.idSolicitud}</p>
        </div>
        <Badge label={ETIQUETA_ESTADO[sol.estado]!} color={colorEstado(sol.estado)} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {([
          ['Código solicitud', sol.idSolicitud],
          ['Monto solicitado', Q(sol.capital)],
          ['Plazo', `${sol.plazoMeses} meses`],
          ['Tasa', `${tasaMensual(sol.tnaBps)} mensual · ${tasaAnual(sol.tnaBps)} nominal anual`],
          ['Cuota estimada', datos.datos ? Q(datos.datos.plan.cuotas[0]!.pago) : '…'],
          ['Fecha de solicitud', fecha(sol.fecha)],
          ['Municipio', datos.datos?.cliente?.municipio ?? '…'],
          ['Asesor responsable', datos.datos?.asesor ? `${datos.datos.asesor.nombreCompleto} (${sol.idAsesor})` : sol.idAsesor],
        ] as const).map(([k, v]) => (
          <div key={k} className="bg-slate-50 rounded-xl p-3">
            <p className="text-xs text-slate-600">{k}</p>
            <p className="text-sm font-semibold text-[#0f172a] mt-0.5">{v}</p>
          </div>
        ))}
      </div>
      {sol.resolucion && (
        <Alert type={sol.resolucion.decision === 'APROBADA' ? 'success' : 'error'}>
          {sol.resolucion.decision === 'APROBADA' ? 'Aprobada' : 'Rechazada'} el {fecha(sol.resolucion.fecha)} por {sol.resolucion.usuario}: «{sol.resolucion.motivo}»
        </Alert>
      )}
      <div className="bg-slate-50 rounded-xl p-3">
        <div className="flex items-center justify-between gap-2 mb-1">
          <p className="text-xs text-slate-600">Plan de amortización (si se desembolsa el {fecha(s.fecha)})</p>
          {datos.datos && <button onClick={() => setVerPlan((v) => !v)} className={`text-xs font-semibold text-teal-700 underline ${FOCO}`}>{verPlan ? 'Ocultar' : 'Ver completo'}</button>}
        </div>
        {datos.error !== undefined && <p className="text-xs text-red-600">{mensajeDeError(datos.error)}</p>}
        {datos.datos && !verPlan && (
          <div className="text-xs font-mono text-slate-600 flex flex-col gap-0.5">
            {datos.datos.plan.cuotas.slice(0, 3).map((c) => (
              <p key={c.numero}>Cuota {c.numero}: {Q(c.pago)} — Capital {Q(c.amortizacion)} — Interés {Q(c.interes)} — Saldo {Q(c.saldoFinal)}</p>
            ))}
            <p>… y {datos.datos.plan.cuotas.length - 3} cuotas más. Total de intereses {Q(datos.datos.plan.totalIntereses)}.</p>
          </div>
        )}
        {datos.datos && verPlan && <div className="mt-2"><PlanAmortizacion cuotas={datos.datos.plan.cuotas} /></div>}
      </div>

      {sol.estado === 'SOLICITADA' && (
        <div className="flex gap-3">
          <button onClick={() => setModal('RECHAZADA')} className={`flex-1 border border-red-200 bg-red-50 text-red-600 rounded-xl py-3.5 font-semibold text-sm ${FOCO}`}>Rechazar solicitud</button>
          <button onClick={() => setModal('APROBADA')} className={`flex-1 bg-[#0f172a] text-white rounded-xl py-3.5 font-bold text-sm ${FOCO}`} style={DISPLAY}>Aprobar solicitud</button>
        </div>
      )}
      {sol.estado === 'APROBADA' && (
        <button onClick={desembolsar} className={`w-full bg-[#0f172a] text-white rounded-xl py-3.5 font-bold text-sm ${FOCO}`} style={DISPLAY}>Continuar al desembolso →</button>
      )}
      {sol.estado === 'DESEMBOLSADA' && sol.idCredito && (
        <button onClick={() => verCredito(sol.idCredito!)} className={`w-full border border-slate-200 rounded-xl py-3.5 font-semibold text-sm text-[#0f172a] ${FOCO}`}>Ver crédito {sol.idCredito}</button>
      )}
      {modal && <ModalDecision sol={sol} decision={modal} cerrar={() => setModal(null)} resuelta={resuelta} />}
    </div>
  );
}

function ModalDecision({ sol, decision, cerrar, resuelta }: { sol: TSolicitud; decision: 'APROBADA' | 'RECHAZADA'; cerrar: () => void; resuelta: (s: TSolicitud) => void }) {
  const s = useSesion();
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const aprobar = decision === 'APROBADA';

  const confirmar = async () => {
    if (motivo.trim().length < 3) return setError('El motivo es obligatorio para registrar la decisión (mínimo 3 caracteres).');
    setEnviando(true);
    setError('');
    try {
      resuelta(await api.resolverSolicitud(sol.idSolicitud, { decision, motivo: motivo.trim(), fecha: s.fecha }));
    } catch (err) {
      setError(mensajeDeError(err));
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="titulo-decision">
      <div className="bg-white rounded-t-3xl sm:rounded-2xl p-6 w-full max-w-md flex flex-col gap-4 shadow-2xl">
        <p id="titulo-decision" className="font-bold text-lg text-[#0f172a]" style={DISPLAY}>{aprobar ? 'Aprobar' : 'Rechazar'} solicitud — {sol.idSolicitud}</p>
        <p className="text-sm text-slate-500">{sol.nombreCliente} · {Q(sol.capital)} · {sol.plazoMeses} meses</p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="motivo" className="text-xs font-semibold text-slate-600">Motivo de la decisión <span className="text-red-500">*</span></label>
          <textarea id="motivo" rows={3} value={motivo} maxLength={300} autoFocus
            onChange={(e) => { setMotivo(e.target.value); setError(''); }}
            placeholder="Describe el motivo de forma clara y objetiva…"
            className={`w-full border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 resize-none ${error ? 'border-red-400 bg-red-50' : 'border-slate-200'}`} />
          {error && <p className="text-xs text-red-600 flex items-center gap-1" role="alert">{Ico.alert()} {error}</p>}
          <p className="text-[11px] text-slate-500">Se registra a nombre de {s.usuario} con fecha {fecha(s.fecha)}.</p>
        </div>
        <div className="flex gap-3">
          <button onClick={cerrar} className={`flex-1 border border-slate-200 bg-white rounded-xl py-3 text-sm font-semibold text-slate-600 ${FOCO}`}>Cancelar</button>
          <button onClick={() => void confirmar()} disabled={enviando}
            className={`flex-1 text-white rounded-xl py-3 text-sm font-bold disabled:opacity-50 ${FOCO} ${aprobar ? 'bg-[#0f172a]' : 'bg-red-600'}`} style={DISPLAY}>
            {enviando ? 'Registrando…' : `Confirmar ${aprobar ? 'aprobación' : 'rechazo'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
