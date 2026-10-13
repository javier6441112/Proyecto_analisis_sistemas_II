import type { Ir } from '../App';
import { FechaOperacion } from '../App';
import { api } from '../api';
import { ETIQUETA_TRAMO, Q, fecha } from '../formato';
import { useSesion } from '../sesion';
import { Alert, Cargando, DISPLAY, ErrorCarga, FOCO, Ico, Seccion, useCarga } from '../ui';

export default function Inicio({ ir }: { ir: Ir }) {
  const s = useSesion();
  const carga = useCarga(async () => {
    const [creditos, cartera, vencimientos] = await Promise.all([
      api.creditos(s.fecha, { idAsesor: s.idAsesor }),
      api.cartera(s.fecha),
      api.vencimientos(s.fecha, 7),
    ]);
    return { creditos: creditos.creditos, cartera, vencimientos };
  }, [s.fecha, s.idAsesor]);

  const d = carga.datos;
  const activos = d?.creditos.filter((c) => c.estado !== 'CANCELADO' && c.estado !== 'INCOBRABLE') ?? [];
  const atrasados = activos.filter((c) => c.diasAtraso > 0).sort((a, b) => b.diasAtraso - a.diasAtraso);
  const misCreditos = new Set(activos.map((c) => c.idCredito));
  const misVencimientos = d?.vencimientos.cuotas.filter((v) => misCreditos.has(v.idCredito)) ?? [];
  const peor = atrasados[0];

  return (
    <div className="flex flex-col h-full bg-[#f8fafc] overflow-auto pb-4">
      <div className="bg-[#0f172a] px-5 pt-8 pb-6 shrink-0">
        <div className="flex items-start justify-between mb-3 gap-2">
          <div className="min-w-0">
            <p className="text-slate-400 text-xs mb-0.5">Hola,</p>
            <h2 className="text-white text-xl font-bold truncate" style={DISPLAY}>{s.usuario}</h2>
            <p className="text-slate-500 text-[11px] font-mono">{s.idAsesor}</p>
          </div>
          <button onClick={s.salir} className={`flex items-center gap-1.5 text-[11px] text-slate-300 px-3 py-1.5 rounded-full border border-white/20 shrink-0 ${FOCO}`}>
            {Ico.logout()} Salir
          </button>
        </div>
        <div className="mb-4"><FechaOperacion sesion={s} /></div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Mis créditos activos', v: d ? String(activos.length) : '…', sub: 'en cartera' },
            { label: 'Con atraso', v: d ? String(atrasados.length) : '…', sub: 'créditos' },
            { label: 'Riesgo institucional', v: d?.cartera.porcentajes.riesgo ?? '…', sub: d ? Q(d.cartera.resumen.saldoEnRiesgo) : '' },
          ].map((k) => (
            <div key={k.label} className="bg-white/10 rounded-xl p-3">
              <p className="text-white font-bold text-sm leading-tight" style={DISPLAY}>{k.v}</p>
              <p className="text-slate-400 text-[10px] leading-tight mt-0.5">{k.label}</p>
              <p className="text-teal-400 text-[10px] font-medium mt-0.5 truncate">{k.sub}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="px-5 pt-5 flex flex-col gap-4">
        <Seccion titulo="Acceso rápido">
          <div className="flex flex-col rounded-2xl border border-slate-200 bg-white overflow-hidden divide-y divide-slate-100 shadow-sm">
            {[
              { label: 'Clientes', sub: 'Búsqueda y alta', d: { tab: 'clientes' } as const, icon: Ico.userPlus('#5eead4') },
              { label: 'Nueva solicitud', sub: 'Solicitar crédito', d: { tab: 'solicitudes' } as const, icon: Ico.fileText('#5eead4') },
              { label: 'Mis créditos', sub: 'Detalle, plan y mora', d: { tab: 'creditos' } as const, icon: Ico.creditCard('#5eead4') },
              { label: 'Registrar pago', sub: 'Cobro en campo', d: { tab: 'pagos' } as const, icon: Ico.dollar('#5eead4') },
            ].map((a) => (
              <button key={a.label} onClick={() => ir(a.d)}
                className="flex items-center gap-4 px-4 py-3.5 text-left active:bg-slate-50 transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-teal-400 min-h-[60px]">
                <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#0f172a] shrink-0">{a.icon}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-slate-800">{a.label}</span>
                  <span className="block text-xs text-slate-600 mt-0.5">{a.sub}</span>
                </span>
                <span className="text-slate-300 shrink-0">{Ico.chevRight()}</span>
              </button>
            ))}
          </div>
        </Seccion>

        {carga.error !== undefined && !d && <ErrorCarga error={carga.error} reintentar={carga.recargar} />}
        {!d && carga.cargando && <Cargando />}

        {d && peor && (
          <Alert type="warning">
            <strong>{atrasados.length} {atrasados.length === 1 ? 'crédito' : 'créditos'} con atraso.</strong>{' '}
            {peor.nombreCliente} lleva {peor.diasAtraso} días ({ETIQUETA_TRAMO[peor.tramo]}).
            <button onClick={() => ir({ tab: 'creditos', idCredito: peor.idCredito })} className={`block mt-2 font-semibold underline text-left ${FOCO}`}>
              Ver crédito {peor.idCredito} →
            </button>
          </Alert>
        )}
        {d && !peor && <Alert type="success">Ninguno de tus créditos tiene atraso al {fecha(s.fecha)}.</Alert>}

        {d && (
          <Seccion titulo="Vencen en los próximos 7 días">
            {misVencimientos.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-4 bg-white rounded-2xl border border-slate-100">Sin cuotas por vencer.</p>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-100 divide-y divide-slate-100">
                {misVencimientos.map((v) => (
                  <button key={`${v.idCredito}-${v.numeroCuota}`} onClick={() => ir({ tab: 'creditos', idCredito: v.idCredito })}
                    className={`w-full flex items-center justify-between px-4 py-3 text-left ${FOCO}`}>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-[#0f172a] truncate">{v.nombreCliente}</span>
                      <span className="block text-xs text-slate-600 font-mono">{v.idCredito} · cuota {v.numeroCuota} · {fecha(v.fechaVencimiento)}</span>
                    </span>
                    <span className="font-mono text-sm font-semibold text-[#0f172a] shrink-0 ml-3">{Q(v.monto)}</span>
                  </button>
                ))}
              </div>
            )}
          </Seccion>
        )}
      </div>
    </div>
  );
}
