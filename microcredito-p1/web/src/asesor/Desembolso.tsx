import { useState } from 'react';
import { api, mensajeDeError, type TDetalleCredito } from '../api';
import { Q, fecha, siguienteCodigo, tasaAnual, tasaMensual } from '../formato';
import { useSesion } from '../sesion';
import { Alert, BtnPrimary, BtnSecondary, ConCarga, Exito, Field, Filas, Ico, Pantalla, TopBar, inputCls, useCarga } from '../ui';

/**
 * Confirmar desembolso de una solicitud aprobada (lo usan el asesor y la gerencia tras el comité).
 * Las cifras del plan las calcula el servidor (/api/simulaciones/plan) a la fecha de operación.
 */
export default function Desembolso({ idSolicitud, volver, verCredito, alInicio }: {
  idSolicitud: string;
  volver: () => void;
  verCredito: (idCredito: string) => void;
  alInicio: () => void;
}) {
  const s = useSesion();
  const [idCredito, setIdCredito] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [falla, setFalla] = useState('');
  const [creado, setCreado] = useState<TDetalleCredito | null>(null);

  const carga = useCarga(async () => {
    const [solicitudes, creditos] = await Promise.all([api.solicitudes(), api.creditos(s.fecha)]);
    const sol = solicitudes.find((x) => x.idSolicitud === idSolicitud);
    if (!sol) throw new Error(`No existe la solicitud ${idSolicitud}`);
    const plan = await api.simularPlan({ capital: sol.capital.valor, plazoMeses: sol.plazoMeses, tnaBps: sol.tnaBps, fechaDesembolso: s.fecha });
    const usados = [...creditos.creditos.map((c) => c.idCredito), ...solicitudes.flatMap((x) => (x.idCredito ? [x.idCredito] : []))];
    const sugerido = siguienteCodigo(`CV-${s.fecha.slice(0, 4)}-`, usados);
    setIdCredito((actual) => actual || sugerido);
    return { sol, plan };
  }, [idSolicitud, s.fecha]);

  if (creado) {
    return (
      <Pantalla barra={<TopBar title="Desembolso completado" />}>
        <Exito titulo="Desembolso realizado">
          <p className="text-slate-500 text-sm">Código del crédito</p>
          <p className="text-2xl font-mono font-bold text-teal-600">{creado.idCredito}</p>
          <p className="text-slate-600 text-xs">{creado.nombreCliente} · {Q(creado.capitalOriginal)} · {fecha(creado.fechaDesembolso)}</p>
        </Exito>
        <Alert type="success">Se creó el crédito con su plan de {creado.cuotasTotales} cuotas. Primera cuota: {Q(creado.proximaCuota?.monto)} el {fecha(creado.proximaCuota?.fechaVencimiento)}.</Alert>
        <BtnPrimary label="Ver crédito" onClick={() => verCredito(creado.idCredito)} />
        <BtnSecondary label="Volver al inicio" onClick={alInicio} />
      </Pantalla>
    );
  }

  const confirmar = async () => {
    if (!/^CV-\d{4}-\d{4}$/.test(idCredito)) return setFalla('El código del crédito debe tener el formato CV-AAAA-NNNN.');
    setEnviando(true);
    setFalla('');
    try {
      setCreado(await api.desembolsar(idSolicitud, { idCredito, fecha: s.fecha }));
    } catch (err) {
      setFalla(mensajeDeError(err));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Pantalla barra={<TopBar title="Confirmar desembolso" onBack={volver} />}>
      <ConCarga carga={carga}>
        {({ sol, plan }) => {
          const primera = plan.cuotas[0]!;
          const ultima = plan.cuotas[plan.cuotas.length - 1]!;
          return (
            <>
              {sol.estado !== 'APROBADA' && (
                <Alert type="error">La solicitud {sol.idSolicitud} está {sol.estado.toLowerCase()}; solo se desembolsan solicitudes aprobadas.</Alert>
              )}
              <Filas filas={[
                ['Cliente', sol.nombreCliente],
                ['Código de solicitud', <span className="font-mono">{sol.idSolicitud}</span>],
                ['Monto aprobado', Q(sol.capital)],
                ['Plazo', `${sol.plazoMeses} meses`],
                ['Tasa', `${tasaMensual(sol.tnaBps)} mensual · ${tasaAnual(sol.tnaBps)} nominal anual`],
                ['Cuota mensual', Q(primera.pago)],
                ultima.pago.valor !== primera.pago.valor && ['Cuota final', Q(ultima.pago)],
                ['Fecha de desembolso', fecha(s.fecha)],
                ['Primer vencimiento', fecha(primera.fechaVencimiento)],
                ['Cantidad de cuotas', String(plan.cuotas.length)],
                ['Política de mora', plan.politicaMora],
              ]} />
              <Field id="id-credito" label="Código del crédito a crear" hint="Siguiente correlativo libre. El servidor rechaza códigos repetidos.">
                <input id="id-credito" className={`${inputCls} font-mono`} value={idCredito} onChange={(e) => setIdCredito(e.target.value.toUpperCase())} />
              </Field>
              <Alert type="warning">
                <span className="flex items-start gap-1.5">{Ico.alert('#b45309')} Al confirmar se creará el crédito y su plan de amortización. Esta operación no se puede deshacer.</span>
              </Alert>
              {falla && <Alert type="error">{falla}</Alert>}
              <div className="flex gap-3">
                <BtnSecondary label="Cancelar" onClick={volver} />
                <BtnPrimary label="Confirmar desembolso" onClick={() => void confirmar()} busy={enviando} disabled={sol.estado !== 'APROBADA'} />
              </div>
            </>
          );
        }}
      </ConCarga>
    </Pantalla>
  );
}
