import { useState, type ReactNode } from 'react';
import type { Ir } from '../App';
import { api, type TCreditoResumen, type TDetalleCredito, type TPlanCredito, type TPlanSimulado } from '../api';
import {
  ETIQUETA_CANAL, ETIQUETA_ESTADO, ETIQUETA_TRAMO, Q, colorEstado, colorTramo, fecha, fechaLarga, recortar, tasaAnual, tasaMensual,
} from '../formato';
import { useSesion } from '../sesion';
import {
  Accion, Alert, Badge, BtnPrimary, BtnSecondary, Buscador, Cabecera, ConCarga, DISPLAY, FOCO, Filas, Ico, Pantalla, Seccion,
  TopBar, useCarga, useDiferido,
} from '../ui';

// ── Plan de amortización (lo reutilizan la solicitud, el crédito y el comité) ─
type CuotaPlan = TPlanSimulado['cuotas'][number] & { estado?: TPlanCredito['cuotas'][number]['estado']; fechaPago?: string };

export function PlanAmortizacion({ cuotas }: { cuotas: CuotaPlan[] }) {
  const estilo = (c: CuotaPlan, ultima: boolean) => {
    if (c.estado === 'PAGADA') return { caja: 'bg-emerald-50 border-emerald-200', num: 'bg-emerald-500 text-white' };
    if (c.estado === 'VENCIDA') return { caja: 'bg-red-50 border-red-200', num: 'bg-red-500 text-white' };
    if (!c.estado && ultima) return { caja: 'bg-emerald-50 border-emerald-200', num: 'bg-emerald-500 text-white' };
    return { caja: 'bg-white border-slate-100', num: 'bg-slate-100 text-slate-600' };
  };
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-3 px-4">
        <span className="w-7 shrink-0" />
        <span className="flex-1 text-[10px] font-semibold text-slate-600 uppercase tracking-wide">Cuota · Interés</span>
        <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-wide text-right">Capital · Saldo</span>
      </div>
      {cuotas.map((c, i) => {
        const e = estilo(c, i === cuotas.length - 1);
        return (
          <div key={c.numero} className={`rounded-2xl border px-4 py-3 flex items-center gap-3 ${e.caja}`}>
            <span className={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${e.num}`}>{c.numero}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-[#0f172a]">{Q(c.pago)}</p>
              <p className="text-[11px] text-slate-600 mt-0.5">Interés <span className="font-medium">{Q(c.interes)}</span></p>
              <p className="text-[10px] text-slate-500 mt-0.5">
                {fecha(c.fechaVencimiento)}
                {c.estado === 'PAGADA' && ` · pagada ${fecha(c.fechaPago)}`}
                {c.estado === 'VENCIDA' && ' · vencida'}
              </p>
            </div>
            <div className="w-px h-8 bg-slate-200 shrink-0" />
            <div className="text-right min-w-[92px]">
              <p className="text-sm font-semibold text-teal-700">{Q(c.amortizacion)}</p>
              <p className="text-[11px] text-slate-600 mt-0.5">Saldo <span className="font-medium">{Q(c.saldoFinal)}</span></p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Pestaña Créditos del asesor ──────────────────────────────────────────
export default function Creditos({ ir, idInicial }: { ir: Ir; idInicial?: string }) {
  const [id, setId] = useState(idInicial ?? '');
  if (id) return <VistaCredito id={id} volver={() => setId('')} pagar={(x) => ir({ tab: 'pagos', idCredito: x })} />;
  return <MisCreditos abrir={setId} />;
}

type Filtro = 'activos' | 'atraso' | 'cerrados' | 'todos';

function MisCreditos({ abrir }: { abrir: (id: string) => void }) {
  const s = useSesion();
  const [filtro, setFiltro] = useState<Filtro>('activos');
  const [texto, setTexto] = useState('');
  const busqueda = useDiferido(texto.trim());
  const carga = useCarga(() => api.creditos(s.fecha, { idAsesor: s.idAsesor, q: busqueda || undefined }), [s.fecha, s.idAsesor, busqueda]);

  const cerrado = (c: TCreditoResumen) => c.estado === 'CANCELADO' || c.estado === 'INCOBRABLE';
  const pasa: Record<Filtro, (c: TCreditoResumen) => boolean> = {
    activos: (c) => !cerrado(c),
    atraso: (c) => !cerrado(c) && c.diasAtraso > 0,
    cerrados: cerrado,
    todos: () => true,
  };

  return (
    <Pantalla barra={<TopBar title="Mis créditos" />}>
      <p className="text-xs text-slate-600">Créditos desembolsados asignados a {s.usuario} al {fecha(s.fecha)}.</p>
      <Buscador id="buscar-credito" value={texto} onChange={setTexto} placeholder="Cliente, código de crédito o de cliente" />
      <div className="flex gap-2 flex-wrap" role="group" aria-label="Filtrar créditos">
        {([['activos', 'Activos'], ['atraso', 'Con atraso'], ['cerrados', 'Cerrados'], ['todos', 'Todos']] as const).map(([f, l]) => (
          <button key={f} onClick={() => setFiltro(f)} aria-pressed={filtro === f}
            className={`px-3 py-2 rounded-xl text-xs font-semibold border min-h-[36px] ${FOCO} ${filtro === f ? 'bg-[#0f172a] text-white border-[#0f172a]' : 'bg-white text-slate-600 border-slate-200'}`}>
            {l}
          </button>
        ))}
      </div>
      <ConCarga carga={carga}>
        {({ creditos }) => {
          const lista = creditos.filter(pasa[filtro]).sort((a, b) => b.diasAtraso - a.diasAtraso);
          if (lista.length === 0) return <p className="text-sm text-slate-500 text-center py-6">Sin créditos en este filtro.</p>;
          return (
            <div className="flex flex-col gap-3">
              {lista.map((c) => <TarjetaCredito key={c.idCredito} c={c} onClick={() => abrir(c.idCredito)} />)}
            </div>
          );
        }}
      </ConCarga>
    </Pantalla>
  );
}

export function TarjetaCredito({ c, onClick }: { c: TCreditoResumen; onClick: () => void }) {
  const etiqueta = c.diasAtraso > 0 && c.estado !== 'CANCELADO' ? ETIQUETA_TRAMO[c.tramo]! : ETIQUETA_ESTADO[c.estado]!;
  const color = c.diasAtraso > 0 && c.estado !== 'CANCELADO' ? colorTramo(c.tramo) : colorEstado(c.estado);
  return (
    <button onClick={onClick} className={`w-full bg-white rounded-2xl border border-slate-100 p-4 text-left shadow-sm ${FOCO}`}>
      <div className="flex items-start justify-between mb-2 gap-2">
        <Badge label={etiqueta} color={color} />
        {c.diasAtraso > 0 && <span className="flex items-center gap-1 text-[10px] text-red-600 font-medium">{Ico.alert()}{c.diasAtraso} d de atraso</span>}
      </div>
      <p className="font-bold text-[#0f172a] text-sm">{c.nombreCliente}</p>
      <p className="text-slate-600 text-[11px] font-mono mb-2">{c.idCredito} · {c.idCliente}</p>
      <div className="flex justify-between text-xs text-slate-500 gap-2">
        <span>Saldo: <span className="font-semibold text-[#0f172a]">{Q(c.saldoCapital)}</span></span>
        {c.proximaCuota && <span>Cuota {c.proximaCuota.numero}: {Q(c.proximaCuota.monto)}</span>}
      </div>
    </button>
  );
}

// ── Vista de un crédito: detalle → plan → mora (reutilizada por gerencia) ─
type SubVista = { v: 'detalle' } | { v: 'plan' } | { v: 'mora'; cuota: number };

export function VistaCredito({ id, volver, pagar }: { id: string; volver: () => void; pagar?: (id: string) => void }) {
  const [sub, setSub] = useState<SubVista>({ v: 'detalle' });
  if (sub.v === 'plan') return <PlanCreditoPantalla id={id} volver={() => setSub({ v: 'detalle' })} />;
  if (sub.v === 'mora') return <MoraPantalla id={id} cuota={sub.cuota} volver={() => setSub({ v: 'detalle' })} pagar={pagar} />;
  return <DetalleCredito id={id} volver={volver} pagar={pagar} verPlan={() => setSub({ v: 'plan' })} verMora={(n) => setSub({ v: 'mora', cuota: n })} />;
}

function tarjetaPorEstado(d: TDetalleCredito): string {
  if (d.estado === 'INCOBRABLE' || d.diasAtraso > 0) return 'bg-red-500/20 border border-red-400/30';
  if (d.estado === 'REESTRUCTURADO') return 'bg-blue-500/20 border border-blue-400/30';
  return 'bg-white/10';
}

function DetalleCredito({ id, volver, pagar, verPlan, verMora }: {
  id: string; volver: () => void; pagar?: (id: string) => void; verPlan: () => void; verMora: (n: number) => void;
}) {
  const s = useSesion();
  const carga = useCarga(() => api.credito(id, s.fecha), [id, s.fecha]);
  const [verPagos, setVerPagos] = useState(false);

  return (
    <ConCarga carga={carga}>
      {(d) => {
        const enMora = d.diasAtraso > 0 && d.estado !== 'CANCELADO';
        const cobrable = d.estado !== 'CANCELADO' && d.estado !== 'INCOBRABLE';
        const avance = d.cuotasTotales ? Math.round((d.cuotasPagadas / d.cuotasTotales) * 100) : 0;
        return (
          <Pantalla barra={<>
            <TopBar title="Detalle del crédito" onBack={volver} />
            <Cabecera>
              <div className={`rounded-2xl p-4 ${tarjetaPorEstado(d)}`}>
                <div className="flex items-start justify-between mb-3 gap-2">
                  <div className="min-w-0">
                    <p className="text-white font-bold" style={DISPLAY}>{d.nombreCliente}</p>
                    <p className="text-slate-400 text-xs font-mono">{d.idCredito}</p>
                  </div>
                  <Badge label={enMora ? ETIQUETA_TRAMO[d.tramo]! : ETIQUETA_ESTADO[d.estado]!} color={enMora ? colorTramo(d.tramo) : colorEstado(d.estado)} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><p className="text-slate-400 text-[10px]">Saldo de capital</p><p className="text-white font-bold text-xl" style={DISPLAY}>{Q(d.saldoCapital)}</p></div>
                  {enMora
                    ? <div><p className="text-slate-400 text-[10px]">Vencido exigible</p><p className="text-red-300 font-bold text-xl" style={DISPLAY}>{Q(d.totalVencidoExigible)}</p></div>
                    : <div><p className="text-slate-400 text-[10px]">Próxima cuota</p><p className="text-teal-400 font-bold text-xl" style={DISPLAY}>{Q(d.proximaCuota?.monto)}</p></div>}
                </div>
                <div className="mt-3 h-1.5 bg-white/20 rounded-full overflow-hidden" role="progressbar" aria-valuenow={avance} aria-valuemin={0} aria-valuemax={100} aria-label="Cuotas pagadas">
                  <div className="h-full bg-teal-400 rounded-full" style={{ width: `${avance}%` }} />
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-slate-400">{d.cuotasPagadas} de {d.cuotasTotales} cuotas pagadas</span>
                  <span className="text-[10px] text-teal-400">{avance} %</span>
                </div>
              </div>
            </Cabecera>
          </>}>
            {enMora && <Alert type="error">Lleva <strong>{d.diasAtraso} días de atraso</strong>. Se encuentra en <strong>{ETIQUETA_TRAMO[d.tramo]}</strong> con {d.cuotasVencidas.length} {d.cuotasVencidas.length === 1 ? 'cuota vencida' : 'cuotas vencidas'}.</Alert>}
            {!enMora && d.estado === 'CANCELADO' && <Alert type="success">Crédito cancelado: no tiene saldo pendiente.</Alert>}
            {d.estado === 'INCOBRABLE' && <Alert type="error">Declarado incobrable{d.fechaIncobrable ? ` el ${fecha(d.fechaIncobrable)}` : ''}. Su saldo sigue visible en la cartera incobrable.</Alert>}
            {!enMora && cobrable && d.proximaCuota && <Alert type="success">El siguiente pago es el <strong>{fechaLarga(d.proximaCuota.fechaVencimiento)}</strong> por {Q(d.proximaCuota.monto)}.</Alert>}
            {d.reestructurado && <Alert type="info">Crédito reestructurado: cuenta en la cartera en riesgo aunque esté al día.</Alert>}

            <Filas filas={[
              ['Cliente', `${d.nombreCliente} (${d.idCliente})`],
              ['Estado', ETIQUETA_ESTADO[d.estado]],
              ['Días de atraso', `${d.diasAtraso} días`],
              ['Tramo de mora', ETIQUETA_TRAMO[d.tramo]],
              ['Capital original', Q(d.capitalOriginal)],
              ['Plazo · tasa', `${d.plazoMeses} meses · ${tasaMensual(d.tnaBps)} mensual (${tasaAnual(d.tnaBps)} anual)`],
              ['Desembolso', fecha(d.fechaDesembolso)],
              ['Política de mora', d.politicaMora],
              ['Asesor', d.idAsesor],
            ]} />

            {d.cuotasVencidas.length > 0 && (
              <Seccion titulo="Cuotas vencidas">
                <div className="flex flex-col gap-2">
                  {d.cuotasVencidas.map((c) => (
                    <button key={c.numero} onClick={() => verMora(c.numero)}
                      className={`w-full bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-left flex items-center gap-3 ${FOCO}`}>
                      <span className="w-7 h-7 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center shrink-0">{c.numero}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-red-800">{Q(c.total)} · {c.diasAtraso} días · {ETIQUETA_TRAMO[c.tramo]}</span>
                        <span className="block text-xs text-red-700">Venció {fecha(c.fechaVencimiento)} · mora {Q(c.interesMoratorio)} · ver cálculo</span>
                      </span>
                      <span className="text-red-400">{Ico.chevRight()}</span>
                    </button>
                  ))}
                </div>
              </Seccion>
            )}

            <div className="flex flex-col gap-2">
              <Accion icon={Ico.barChart('#0f172a')} label="Ver plan de amortización" onClick={verPlan} />
              <Accion icon={Ico.clipboard('#0f172a')} label={verPagos ? 'Ocultar movimientos' : 'Consultar movimientos'} sub={`${d.pagos.length} pagos aplicados`} onClick={() => setVerPagos((v) => !v)} />
              {verPagos && <Movimientos d={d} />}
              {d.cuotasVencidas[0] && <Accion tono="peligro" icon={Ico.alert('#dc2626')} label="Ver cómo se calculó la mora" onClick={() => verMora(d.cuotasVencidas[0]!.numero)} />}
              {pagar && cobrable && <BtnPrimary label="Registrar pago" onClick={() => pagar(d.idCredito)} />}
              <BtnSecondary label="Regresar" onClick={volver} />
            </div>
          </Pantalla>
        );
      }}
    </ConCarga>
  );
}

function Movimientos({ d }: { d: TDetalleCredito }) {
  if (d.pagos.length === 0) return <p className="text-sm text-slate-500 text-center py-3">Sin pagos registrados.</p>;
  return (
    <div className="bg-white rounded-2xl border border-slate-100 divide-y divide-slate-100">
      {[...d.pagos].reverse().map((p) => (
        <div key={p.claveIdempotencia} className="px-4 py-3">
          <div className="flex justify-between gap-2">
            <span className="text-sm font-semibold text-[#0f172a]">{fecha(p.fecha)} · {p.numeroCuota ? `cuota ${p.numeroCuota}` : p.tipo.toLowerCase()}</span>
            <span className="font-mono text-sm font-bold text-[#0f172a]">{Q(p.monto)}</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {ETIQUETA_CANAL[p.canal] ?? p.canal}{p.diasAtrasoAlPago ? ` · ${p.diasAtrasoAlPago} días de atraso` : ''}
            {p.saldoCapitalDespues && ` · saldo ${Q(p.saldoCapitalDespues)}`}
          </p>
          {p.aplicado && (
            <p className="text-[11px] text-slate-500 font-mono mt-0.5">
              G {Q(p.aplicado.gastos)} · M {Q(p.aplicado.interesMoratorio)} · I {Q(p.aplicado.interesCorriente)} · K {Q(p.aplicado.capital)}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function PlanCreditoPantalla({ id, volver }: { id: string; volver: () => void }) {
  const s = useSesion();
  const carga = useCarga(() => api.planCredito(id, s.fecha), [id, s.fecha]);
  return (
    <ConCarga carga={carga}>
      {(p) => {
        const pagadas = p.cuotas.filter((c) => c.estado === 'PAGADA').length;
        const vencidas = p.cuotas.filter((c) => c.estado === 'VENCIDA').length;
        return (
          <Pantalla barra={<>
            <TopBar title="Plan de amortización" onBack={volver} />
            <Cabecera>
              <p className="text-white text-sm font-semibold" style={DISPLAY}>{p.idCredito} · {Q(p.capital)}</p>
              <p className="text-slate-400 text-xs mt-0.5">{tasaAnual(p.tnaBps)} anual · {tasaMensual(p.tnaBps)} mensual · {p.plazoMeses} meses · Sistema francés</p>
            </Cabecera>
          </>}>
            <div className="flex gap-2 flex-wrap text-[11px]">
              <Badge label={`${pagadas} pagadas`} color="green" />
              {vencidas > 0 && <Badge label={`${vencidas} vencidas`} color="red" />}
              <Badge label={`${p.cuotas.length - pagadas - vencidas} pendientes`} color="gray" />
            </div>
            <PlanAmortizacion cuotas={p.cuotas} />
            <Filas filas={[['Total de intereses', Q(p.totalIntereses)], ['Total a pagar', Q(p.totalPagado)]]} />
            <BtnSecondary label="Regresar" onClick={volver} />
          </Pantalla>
        );
      }}
    </ConCarga>
  );
}

function MoraPantalla({ id, cuota, volver, pagar }: { id: string; cuota: number; volver: () => void; pagar?: (id: string) => void }) {
  const s = useSesion();
  const carga = useCarga(async () => {
    const [m, d] = await Promise.all([api.mora(id, cuota, s.fecha), api.credito(id, s.fecha)]);
    return { m, d };
  }, [id, cuota, s.fecha]);
  const [abierto, setAbierto] = useState(false);

  return (
    <ConCarga carga={carga}>
      {({ m, d }) => {
        const c = m.cuota;
        const tramos = c.tramosRecorridos;
        const plana = tramos.length === 1 && tramos[0]!.tramo === 'PLANA';
        const pct = (bps: number) => `${(bps / 100).toLocaleString('es-GT', { maximumFractionDigits: 2 })} %`;
        let explicacion: ReactNode;
        if (plana) {
          explicacion = `La política ${m.politicaMora} aplica una tasa plana de ${pct(tramos[0]!.tasaAnualBps)} anual durante los ${c.diasDevengo} días de atraso. El redondeo se realiza una sola vez al final.`;
        } else if (tramos.length > 1) {
          explicacion = `${tramos.map((t) => `los días ${t.desdeDia}–${t.hastaDia} con la tasa de ${ETIQUETA_TRAMO[t.tramo]} (${pct(t.tasaAnualBps)})`).join(', ')}. Cada grupo de días se calcula con la tasa que le corresponde; los primeros días no se recalculan con la tasa más alta. El redondeo se realiza una sola vez al obtener el total.`;
          explicacion = `Se calcularon ${explicacion}`;
        } else {
          explicacion = `Los ${c.diasDevengo} días se calcularon con la tasa de ${ETIQUETA_TRAMO[tramos[0]?.tramo ?? c.tramo]}. El redondeo se realiza una sola vez al final.`;
        }
        return (
          <Pantalla barra={<>
            <TopBar title="Detalle de la mora" onBack={volver} />
            <Cabecera>
              <div className="bg-red-500/20 border border-red-400/30 rounded-xl p-3">
                <p className="text-red-300 text-xs font-semibold uppercase tracking-wide">{d.nombreCliente} · {m.idCredito} · {ETIQUETA_TRAMO[c.tramo]}</p>
                <p className="text-white font-bold text-lg mt-0.5" style={DISPLAY}>Cuota {c.numero}: {c.diasAtraso} días de atraso</p>
                <p className="text-slate-400 text-xs mt-0.5">Venció {fecha(c.fechaVencimiento)} · capital en mora {Q(c.capital)} · base Actual/360</p>
              </div>
            </Cabecera>
          </>}>
            <div className="bg-white rounded-2xl border border-slate-100 p-4 flex items-end justify-between">
              <div>
                <p className="text-3xl font-extrabold text-red-600" style={DISPLAY}>{Q(c.interesMoratorio)}</p>
                <p className="text-xs text-slate-600 mt-0.5">Total interés moratorio</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-[#0f172a]">{Q(c.capital)}</p>
                <p className="text-xs text-slate-600">Capital en mora</p>
              </div>
            </div>
            {c.diasDevengo < c.diasAtraso && (
              <Alert type="warning">El moratorio devenga {c.diasDevengo} de los {c.diasAtraso} días: se detiene en la regla de incobrable.</Alert>
            )}
            <Alert type="info">{explicacion}</Alert>

            <Seccion titulo="Tramos recorridos">
              <div className="flex flex-col gap-2">
                {tramos.map((t) => (
                  <div key={`${t.tramo}-${t.desdeDia}`} className="bg-white rounded-xl border border-slate-100 px-4 py-3 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-[#0f172a]">{ETIQUETA_TRAMO[t.tramo]}</p>
                      <p className="text-xs text-slate-600">Días {t.desdeDia}–{t.hastaDia} · {pct(t.tasaAnualBps)} anual</p>
                    </div>
                    <p className="font-mono font-bold text-red-600 text-sm" title={t.montoSinRedondear}>Q{recortar(t.montoSinRedondear)}</p>
                  </div>
                ))}
                <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 flex justify-between">
                  <span className="text-xs text-slate-500">Total sin redondear</span>
                  <span className="font-mono text-sm font-semibold text-slate-700" title={m.totalSinRedondear}>Q{recortar(m.totalSinRedondear)}</span>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex justify-between">
                  <span className="text-xs font-bold text-red-700">Total final redondeado</span>
                  <span className="font-mono text-sm font-bold text-red-700">{Q(c.interesMoratorio)}</span>
                </div>
              </div>
            </Seccion>

            <button onClick={() => setAbierto((a) => !a)} aria-expanded={abierto}
              className={`flex items-center justify-between px-4 py-3 bg-slate-100 rounded-xl text-sm font-medium text-slate-600 ${FOCO}`}>
              <span>Ver cálculo técnico detallado</span>
              <span className={`transition-transform ${abierto ? 'rotate-90' : ''}`}>{Ico.chevRight()}</span>
            </button>
            {abierto && (
              <div className="bg-white border border-slate-200 rounded-xl p-4 text-xs font-mono text-slate-600 flex flex-col gap-1 leading-relaxed overflow-x-auto">
                <p>Capital en mora: {Q(c.capital)} · Base: Actual/360</p>
                {tramos.map((t) => (
                  <p key={t.desdeDia} className="whitespace-nowrap">
                    {ETIQUETA_TRAMO[t.tramo]} (días {t.desdeDia}–{t.hastaDia}): {Q(c.capital)} × {pct(t.tasaAnualBps)}/360 × {t.dias} = Q{recortar(t.montoSinRedondear)}
                  </p>
                ))}
                <p className="pt-1 border-t border-slate-100">Suma: Q{recortar(m.totalSinRedondear)}</p>
                <p className="font-bold text-[#0f172a]">Redondeado una sola vez: {Q(c.interesMoratorio)}</p>
              </div>
            )}

            <Seccion titulo={`Exigible de la cuota ${c.numero} (prelación)`}>
              <Filas filas={[
                ['1° Gastos de gestión', Q(c.gastoGestion)],
                ['2° Interés moratorio', Q(c.interesMoratorio)],
                ['3° Interés corriente', Q(c.interesCorriente)],
                ['4° Capital', Q(c.capital)],
                ['Total', <span className="text-teal-700">{Q(c.total)}</span>],
              ]} />
            </Seccion>
            {pagar && <BtnPrimary label="Registrar pago" onClick={() => pagar(m.idCredito)} />}
          </Pantalla>
        );
      }}
    </ConCarga>
  );
}
