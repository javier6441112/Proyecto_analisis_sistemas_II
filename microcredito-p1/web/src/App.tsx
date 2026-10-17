import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, fijarToken, mensajeDeError, type TSesionIniciada } from './api';
import { ContextoSesion, FECHA_INICIAL, useSesion, type Sesion } from './sesion';
import { Alert, DISPLAY, FOCO, Ico, useCarga } from './ui';
import Inicio from './asesor/Inicio';
import Clientes from './asesor/Clientes';
import Solicitudes from './asesor/Solicitudes';
import Creditos from './asesor/Creditos';
import Pagos from './asesor/Pagos';
import Tablero from './gerencia/Tablero';
import Comite from './gerencia/Comite';
import Cierres from './gerencia/Cierres';
import Asistente from './gerencia/Asistente';
import { conversacion } from './gerencia/conversacion';
import { instalar, useEnLinea, usePuedeInstalar } from './pwa';

// ── Navegación ───────────────────────────────────────────────────────────
/** Destino al que una pantalla puede enviar a otra (con el registro ya seleccionado). */
export type Destino =
  | { tab: 'inicio' }
  | { tab: 'clientes'; idCliente?: string }
  | { tab: 'solicitudes'; idCliente?: string; desembolsar?: string }
  | { tab: 'creditos'; idCredito?: string }
  | { tab: 'pagos'; idCredito?: string };
export type Ir = (d: Destino) => void;

type TabGerencia = 'tablero' | 'comite' | 'cierres' | 'asistente';

/** Sesión devuelta por POST /api/sesion: el perfil y el nombre de auditoría los decide el servidor. */
type Credenciales = Required<Pick<TSesionIniciada, 'token' | 'perfil' | 'usuario' | 'cuenta'>> & { idAsesor?: string };

const CLAVE_SESION = 'cv-sesion';
function leerSesion(): Credenciales | null {
  try {
    const t = sessionStorage.getItem(CLAVE_SESION);
    const c = t ? (JSON.parse(t) as Partial<Credenciales>) : null;
    return c?.token && c.cuenta ? (c as Credenciales) : null; // una sesión guardada sin token no vale
  } catch {
    return null;
  }
}

export default function App() {
  const [cred, setCred] = useState<Credenciales | null>(leerSesion);
  const [fecha, setFecha] = useState(FECHA_INICIAL);
  const [aviso, setAviso] = useState('');

  const olvidar = () => { try { sessionStorage.removeItem(CLAVE_SESION); } catch { /* sin almacenamiento */ } setCred(null); };

  // El token viaja en Authorization; si la API lo rechaza (vencido o API reiniciada) se vuelve al inicio.
  fijarToken(cred?.token ?? null, () => {
    conversacion.descartar();
    olvidar();
    setAviso('Tu sesión expiró. Vuelve a iniciar sesión.');
  });
  if (cred?.perfil === 'gerencia') conversacion.abrir(cred.cuenta);

  const sesion = useMemo<Sesion | null>(() => cred && {
    perfil: cred.perfil,
    usuario: cred.usuario,
    cuenta: cred.cuenta,
    ...(cred.idAsesor ? { idAsesor: cred.idAsesor } : {}),
    fecha,
    cambiarFecha: (f: string) => { if (/^\d{4}-\d{2}-\d{2}$/.test(f)) setFecha(f); },
    salir: () => {
      conversacion.descartar();
      api.cerrarSesion().catch(() => undefined);
      olvidar();
    },
  }, [cred, fecha]);

  if (!sesion) {
    return <><SinConexion /><Login aviso={aviso} onEntrar={(c) => {
      try { sessionStorage.setItem(CLAVE_SESION, JSON.stringify(c)); } catch { /* sin almacenamiento */ }
      setAviso('');
      setCred(c);
    }} /></>;
  }
  return (
    <ContextoSesion.Provider value={sesion}>
      <SinConexion />
      {sesion.perfil === 'asesor' ? <ShellAsesor /> : <ShellGerencia />}
    </ContextoSesion.Provider>
  );
}

/** Aviso flotante cuando el dispositivo pierde la conexión (la PWA abre, pero los datos vienen de la API). */
function SinConexion() {
  if (useEnLinea()) return null;
  return (
    <div role="status" className="fixed top-[calc(env(safe-area-inset-top)+0.5rem)] left-1/2 -translate-x-1/2 z-50 bg-amber-100 border border-amber-300 text-amber-900 text-xs font-semibold rounded-full px-4 py-2 shadow">
      Sin conexión: las cifras se actualizarán al reconectar.
    </div>
  );
}

// ── Login ────────────────────────────────────────────────────────────────
function Login({ onEntrar, aviso }: { onEntrar: (c: Credenciales) => void; aviso: string }) {
  const [rol, setRol] = useState<'asesor' | 'gerente'>('asesor');
  const [cuenta, setCuenta] = useState('');
  const [clave, setClave] = useState('');
  const [verClave, setVerClave] = useState(false);
  const [error, setError] = useState('');
  const [entrando, setEntrando] = useState(false);
  const usuarios = useCarga(() => api.usuarios(), []);
  const delRol = usuarios.datos?.filter((u) => u.rol === rol) ?? [];
  const puedeInstalar = usePuedeInstalar();

  const entrar = async () => {
    if (!cuenta) return setError(rol === 'gerente' ? 'Selecciona tu usuario de gerencia.' : 'Selecciona tu usuario de asesor.');
    if (!clave) return setError('Escribe tu clave.');
    setEntrando(true);
    setError('');
    try {
      const r = await api.iniciarSesion(cuenta, clave);
      onEntrar({ token: r.token!, perfil: r.perfil, usuario: r.usuario, cuenta: r.cuenta ?? cuenta, ...(r.idAsesor ? { idAsesor: r.idAsesor } : {}) });
    } catch (err) {
      setClave('');
      setError(mensajeDeError(err));
    } finally {
      setEntrando(false);
    }
  };

  const campo = 'w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-400';

  return (
    <div className="min-h-full bg-[#0f172a] flex flex-col">
      <form className="flex-1 flex flex-col justify-center px-6 py-12 w-full max-w-md mx-auto" onSubmit={(e) => { e.preventDefault(); void entrar(); }}>
        <div className="w-12 h-12 rounded-2xl bg-teal-400 flex items-center justify-center mb-5">{Ico.logo()}</div>
        <h1 className="text-3xl font-extrabold text-white mb-1" style={DISPLAY}>Crédito Vecino</h1>
        <p className="text-slate-400 text-sm mb-8">Sistema de Gestión de Microcrédito</p>

        {aviso && <div className="mb-4"><Alert type="warning">{aviso}</Alert></div>}

        <fieldset className="mb-5">
          <legend className="text-xs font-semibold text-slate-400 mb-2">Ingresar como</legend>
          <div className="grid grid-cols-2 gap-2">
            {([['asesor', 'Asesor de crédito'], ['gerente', 'Gerencia']] as const).map(([r, l]) => (
              <button key={r} type="button" onClick={() => { setRol(r); setCuenta(''); setClave(''); setError(''); }} aria-pressed={rol === r}
                className={`py-3 rounded-xl text-sm font-semibold border ${rol === r ? 'bg-teal-400 text-[#0f172a] border-teal-400' : 'bg-white/5 text-slate-300 border-white/20'} ${FOCO}`}>
                {l}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-1.5 mb-4">
          <label htmlFor="cuenta" className="text-xs font-semibold text-slate-400">{rol === 'gerente' ? 'Usuario de gerencia' : 'Asesor'}</label>
          <select id="cuenta" value={cuenta} onChange={(e) => { setCuenta(e.target.value); setError(''); }} autoComplete="username"
            className={`${campo} [&>option]:text-[#0f172a]`}>
            <option value="">{usuarios.cargando ? 'Cargando usuarios…' : 'Seleccionar…'}</option>
            {delRol.map((u) => <option key={u.usuario} value={u.usuario}>{u.nombreCompleto} · {u.idAsesor ?? u.usuario}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="clave" className="text-xs font-semibold text-slate-400">Clave</label>
          <div className="relative">
            <input id="clave" type={verClave ? 'text' : 'password'} value={clave} onChange={(e) => { setClave(e.target.value); setError(''); }}
              autoComplete="current-password" className={`${campo} pr-20`} />
            <button type="button" onClick={() => setVerClave((v) => !v)} aria-pressed={verClave}
              className={`absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-slate-400 hover:text-white px-2 py-1 rounded-lg ${FOCO}`}>
              {verClave ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
          <p className="text-[11px] text-slate-500">
            {rol === 'gerente' ? 'Tu nombre queda registrado en la auditoría de cada aprobación y cierre.' : 'Tu nombre queda registrado en cada operación que realices.'}
          </p>
        </div>

        {error && <p className="text-xs text-red-400 mt-2 flex items-center gap-1" role="alert">{Ico.alert('#f87171')} {error}</p>}
        {usuarios.error !== undefined && (
          <div className="mt-3"><Alert type="error">No se pudo contactar la API. Inicie el servidor con <code>npm run api</code>.</Alert></div>
        )}

        <button type="submit" disabled={entrando} className={`w-full bg-teal-400 text-[#0f172a] font-bold py-4 rounded-xl text-sm mt-6 active:bg-teal-300 disabled:opacity-60 ${FOCO}`} style={DISPLAY}>
          {entrando ? 'Verificando…' : 'Iniciar sesión'}
        </button>
      </form>
      {puedeInstalar && (
        <button type="button" onClick={() => void instalar()} className={`mx-auto mb-3 text-xs font-semibold text-teal-300 border border-teal-400/40 rounded-full px-4 py-2 hover:bg-white/5 ${FOCO}`}>
          Instalar aplicación
        </button>
      )}
      <p className="text-[11px] text-slate-600 text-center pb-6">SGMC · Crédito Vecino, S. A. · 2026</p>
    </div>
  );
}

// ── Selector de fecha de operación ───────────────────────────────────────
export function FechaOperacion({ sesion, oscuro = true }: { sesion: Sesion; oscuro?: boolean }) {
  return (
    <label className={`flex items-center gap-2 text-[11px] ${oscuro ? 'text-slate-400' : 'text-slate-600'}`}>
      <span className="shrink-0">Fecha de operación</span>
      <input type="date" value={sesion.fecha} onChange={(e) => sesion.cambiarFecha(e.target.value)} aria-label="Fecha de operación"
        className={`rounded-lg px-2 py-1 text-xs font-semibold ${oscuro ? 'bg-white/10 text-white border border-white/20 [color-scheme:dark]' : 'bg-white border border-slate-200 text-[#0f172a]'} ${FOCO}`} />
    </label>
  );
}

// ── Asesor (móvil) ───────────────────────────────────────────────────────
function ShellAsesor() {
  const [destino, setDestino] = useState<Destino>({ tab: 'inicio' });
  const [clave, setClave] = useState(0); // remonta la pestaña al navegar con un destino nuevo
  const ir: Ir = (d) => { setDestino(d); setClave((k) => k + 1); };

  const tabs: Array<{ id: Destino['tab']; label: string; icon: (c: string) => ReactNode }> = [
    { id: 'inicio', label: 'Inicio', icon: Ico.home },
    { id: 'clientes', label: 'Clientes', icon: Ico.users },
    { id: 'solicitudes', label: 'Solicitudes', icon: Ico.filePlus },
    { id: 'creditos', label: 'Créditos', icon: Ico.creditCard },
    { id: 'pagos', label: 'Pagos', icon: Ico.dollar },
  ];

  return (
    <div className="h-full flex justify-center md:py-6">
      <div className="relative bg-white flex flex-col overflow-hidden w-full md:max-w-[430px] h-full md:rounded-[32px] md:shadow-2xl">
        <main className="flex-1 overflow-hidden flex flex-col min-h-0" key={clave}>
          {destino.tab === 'inicio' && <Inicio ir={ir} />}
          {destino.tab === 'clientes' && <Clientes ir={ir} idInicial={destino.idCliente} />}
          {destino.tab === 'solicitudes' && <Solicitudes ir={ir} idCliente={destino.idCliente} desembolsar={destino.desembolsar} />}
          {destino.tab === 'creditos' && <Creditos ir={ir} idInicial={destino.idCredito} />}
          {destino.tab === 'pagos' && <Pagos ir={ir} idInicial={destino.idCredito} />}
        </main>
        <nav className="flex items-center border-t border-slate-100 bg-white shrink-0" aria-label="Navegación principal">
          {tabs.map(({ id, label, icon }) => {
            const activo = destino.tab === id;
            return (
              <button key={id} onClick={() => ir({ tab: id } as Destino)} aria-current={activo ? 'page' : undefined}
                className={`flex-1 flex flex-col items-center py-2 gap-0.5 min-h-[56px] ${FOCO}`}>
                <span className="flex items-center justify-center w-10 h-10">{icon(activo ? '#0f172a' : '#94a3b8')}</span>
                <span className={`text-[10px] font-medium ${activo ? 'text-[#0f172a]' : 'text-slate-400'}`}>{label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

// ── Gerencia (escritorio con menú lateral; móvil con navegación inferior) ─
function ShellGerencia() {
  const [tab, setTab] = useState<TabGerencia>('tablero');
  const [clave, setClave] = useState(0);
  const ir = (t: TabGerencia) => { setTab(t); setClave((k) => k + 1); };
  const tabs: Array<{ id: TabGerencia; label: string; icon: (c: string) => ReactNode }> = [
    { id: 'tablero', label: 'Tablero', icon: Ico.barChart },
    { id: 'comite', label: 'Comité', icon: Ico.clipboard },
    { id: 'cierres', label: 'Cierres', icon: Ico.calendar },
    { id: 'asistente', label: 'Asistente', icon: Ico.chat },
  ];
  const sesion = useSesion();
  useEffect(() => { document.title = `Crédito Vecino · ${tabs.find((t) => t.id === tab)?.label}`; });

  return (
        <div className="h-full flex flex-col md:flex-row bg-[#f8fafc]">
          <aside className="hidden md:flex w-60 bg-[#0f172a] flex-col shrink-0 h-full">
            <div className="px-5 pt-8 pb-6">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-xl bg-teal-400 flex items-center justify-center">{Ico.logo(16)}</div>
                <span className="text-white font-bold text-sm" style={DISPLAY}>Crédito Vecino</span>
              </div>
              <p className="text-slate-500 text-[10px]">Vista gerencial</p>
            </div>
            <nav className="flex flex-col px-3 gap-1 flex-1" aria-label="Navegación gerencial">
              {tabs.map(({ id, label, icon }) => (
                <button key={id} onClick={() => ir(id)} aria-current={tab === id ? 'page' : undefined}
                  className={`flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium text-left w-full transition-colors ${FOCO} ${tab === id ? 'bg-white/15 text-white' : 'text-slate-400 hover:bg-white/10 hover:text-white'}`}>
                  {icon('currentColor')}{label}
                </button>
              ))}
            </nav>
            <div className="px-5 pb-5 flex flex-col gap-3">
              <FechaOperacion sesion={sesion} />
              <p className="text-[11px] text-slate-400 truncate">{sesion.usuario} · Gerencia</p>
              <button onClick={sesion.salir} className={`flex items-center gap-2 text-xs text-slate-400 hover:text-white ${FOCO}`}>{Ico.logout()} Cerrar sesión</button>
            </div>
          </aside>

          <header className="md:hidden bg-[#0f172a] px-4 pt-4 pb-3 flex items-center justify-between gap-2 shrink-0">
            <span className="text-white font-bold text-sm" style={DISPLAY}>Crédito Vecino · Gerencia</span>
            <button onClick={sesion.salir} aria-label="Cerrar sesión" className={`text-slate-400 p-2 ${FOCO}`}>{Ico.logout()}</button>
          </header>
          <div className="md:hidden bg-[#0f172a] px-4 pb-3 shrink-0"><FechaOperacion sesion={sesion} /></div>

          <main className="flex-1 overflow-auto min-h-0" key={clave}>
            {tab === 'tablero' && <Tablero irComite={() => ir('comite')} irCierres={() => ir('cierres')} irAsistente={() => ir('asistente')} />}
            {tab === 'comite' && <Comite />}
            {tab === 'cierres' && <Cierres />}
            {tab === 'asistente' && <Asistente />}
          </main>

          <nav className="md:hidden flex items-center border-t border-slate-100 bg-white shrink-0" aria-label="Navegación gerencial">
            {tabs.map(({ id, label, icon }) => (
              <button key={id} onClick={() => ir(id)} aria-current={tab === id ? 'page' : undefined}
                className={`flex-1 flex flex-col items-center py-2 gap-0.5 min-h-[56px] ${FOCO}`}>
                <span className="flex items-center justify-center w-10 h-10">{icon(tab === id ? '#0f172a' : '#94a3b8')}</span>
                <span className={`text-[10px] font-medium ${tab === id ? 'text-[#0f172a]' : 'text-slate-400'}`}>{label}</span>
              </button>
            ))}
          </nav>
        </div>
  );
}

/** Encabezado de página de escritorio (gerencia). */
export function EncabezadoPagina({ titulo, sub, children }: { titulo: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h2 className="text-2xl font-bold text-[#0f172a]" style={DISPLAY}>{titulo}</h2>
        {sub && <p className="text-slate-500 text-sm mt-0.5">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

