/** Componentes visuales del prototipo de Figma (colores, tipografía y formas originales). */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { mensajeDeError } from './api';
import type { ColorInsignia } from './formato';

export const FOCO = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-400';
export const DISPLAY = { fontFamily: 'Outfit, Inter, sans-serif' } as const;
export const inputCls = 'w-full border border-slate-200 rounded-xl px-4 py-3 text-sm text-[#0f172a] bg-white focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-500';

// ── Iconos ───────────────────────────────────────────────────────────────
const svg = (size: number, stroke: string, children: ReactNode, sw = 1.8) => (
  <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
export const Ico = {
  chevRight: (s = 'currentColor') => svg(16, s, <polyline points="9 18 15 12 9 6" />, 2),
  chevLeft: (s = 'currentColor') => svg(18, s, <polyline points="15 18 9 12 15 6" />, 2),
  check: (size = 28) => svg(size, '#16a34a', <polyline points="20 6 9 17 4 12" />, 2.5),
  search: (s = 'currentColor') => svg(18, s, <><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>, 2),
  user: (s = 'currentColor') => svg(20, s, <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>),
  users: (s = 'currentColor') => svg(22, s, <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>),
  userPlus: (s = 'currentColor') => svg(20, s, <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" /></>),
  home: (s = 'currentColor') => svg(22, s, <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></>),
  fileText: (s = 'currentColor') => svg(20, s, <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></>),
  filePlus: (s = 'currentColor') => svg(22, s, <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" /></>),
  creditCard: (s = 'currentColor') => svg(20, s, <><rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><line x1="1" y1="10" x2="23" y2="10" /></>),
  dollar: (s = 'currentColor') => svg(20, s, <><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>),
  alert: (s = '#dc2626') => svg(16, s, <><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><circle cx="12" cy="17" r="1" fill={s} /></>, 2),
  barChart: (s = 'currentColor') => svg(20, s, <><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /><line x1="2" y1="20" x2="22" y2="20" /></>),
  clipboard: (s = 'currentColor') => svg(20, s, <><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" ry="1" /><line x1="9" y1="12" x2="15" y2="12" /><line x1="9" y1="16" x2="13" y2="16" /></>),
  calendar: (s = 'currentColor') => svg(20, s, <><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>),
  chat: (s = 'currentColor') => svg(20, s, <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />),
  logout: (s = 'currentColor') => svg(16, s, <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></>, 2),
  logo: (size = 24) => svg(size, '#0f172a', <><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></>, 2.2),
};

// ── Átomos ───────────────────────────────────────────────────────────────
export function Badge({ label, color }: { label: string; color: ColorInsignia }) {
  const map: Record<ColorInsignia, string> = {
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    gray: 'bg-slate-100 text-slate-600 border-slate-200',
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap ${map[color]}`}>{label}</span>;
}

export function Field({ id, label, hint, error, children }: { id: string; label: ReactNode; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-slate-600">{label}</label>
      {children}
      {hint && !error && <p className="text-[11px] text-slate-600">{hint}</p>}
      {error && <p className="text-[11px] text-red-600 flex items-center gap-1" role="alert">{Ico.alert()} {error}</p>}
    </div>
  );
}

export function Alert({ type, children }: { type: 'info' | 'warning' | 'error' | 'success'; children: ReactNode }) {
  const m = {
    info: 'bg-blue-50 border-blue-200 text-blue-800',
    warning: 'bg-amber-50 border-amber-200 text-amber-800',
    error: 'bg-red-50 border-red-200 text-red-700',
    success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  };
  return <div className={`border rounded-xl p-3 text-xs leading-relaxed ${m[type]}`} role={type === 'error' ? 'alert' : undefined}>{children}</div>;
}

export function TopBar({ title, onBack, children }: { title: string; onBack?: () => void; children?: ReactNode }) {
  return (
    <div className="bg-[#0f172a] flex items-center gap-3 px-4 pt-6 pb-4 shrink-0">
      {onBack && (
        <button onClick={onBack} aria-label="Regresar" className={`flex items-center justify-center w-10 h-10 rounded-full bg-white/10 text-white ${FOCO}`}>
          {Ico.chevLeft()}
        </button>
      )}
      <h1 className="text-white font-bold text-lg flex-1 leading-tight" style={DISPLAY}>{title}</h1>
      {children}
    </div>
  );
}

/** Encabezado oscuro bajo la TopBar (resumen del cliente/crédito en curso). */
export function Cabecera({ children }: { children: ReactNode }) {
  return <div className="bg-[#0f172a] px-5 pb-4 shrink-0">{children}</div>;
}

export function BtnPrimary({ label, onClick, danger, disabled, busy, type = 'button' }: { label: string; onClick?: () => void; danger?: boolean; disabled?: boolean; busy?: boolean; type?: 'button' | 'submit' }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled || busy}
      className={`w-full ${danger ? 'bg-red-600' : 'bg-[#0f172a]'} text-white rounded-xl py-4 text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed ${FOCO}`}
      style={DISPLAY}>
      {busy ? 'Procesando…' : label}
    </button>
  );
}

export function BtnSecondary({ label, onClick, danger, disabled }: { label: string; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`w-full rounded-xl py-4 text-sm font-semibold disabled:opacity-50 ${danger ? 'border border-red-200 bg-red-50 text-red-600' : 'border border-slate-200 bg-white text-slate-600'} ${FOCO}`}>
      {label}
    </button>
  );
}

/** Lista de pares clave/valor dentro de una tarjeta blanca. */
export function Filas({ filas, className = '' }: { filas: Array<[string, ReactNode] | false | null | undefined>; className?: string }) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-100 divide-y divide-slate-100 ${className}`}>
      {filas.filter((f): f is [string, ReactNode] => Boolean(f)).map(([k, v]) => (
        <div key={k} className="flex items-start justify-between gap-3 px-4 py-3.5">
          <span className="text-xs text-slate-600 shrink-0 pt-0.5">{k}</span>
          <span className="text-sm font-semibold text-[#0f172a] text-right">{v}</span>
        </div>
      ))}
    </div>
  );
}

export function Seccion({ titulo, children }: { titulo: ReactNode; children: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide mb-2">{titulo}</p>
      {children}
    </div>
  );
}

/** Botón de fila con icono, texto y chevron (acceso rápido / acciones). */
export function Accion({ icon, label, sub, onClick, tono = 'normal' }: { icon: ReactNode; label: string; sub?: string; onClick: () => void; tono?: 'normal' | 'peligro' | 'info' }) {
  const t = { normal: 'bg-white border-slate-100 text-[#0f172a]', peligro: 'bg-red-50 border-red-200 text-red-700', info: 'bg-blue-50 border-blue-200 text-blue-700' }[tono];
  return (
    <button onClick={onClick} className={`flex items-center gap-3 px-4 py-4 border rounded-2xl text-sm font-semibold text-left w-full ${t} ${FOCO}`}>
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block">{label}</span>
        {sub && <span className="block text-xs font-normal text-slate-600 mt-0.5">{sub}</span>}
      </span>
      <span className="opacity-50">{Ico.chevRight()}</span>
    </button>
  );
}

export function Buscador({ id, value, onChange, placeholder, autoFocus }: { id: string; value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-3 text-slate-400">{Ico.search()}</span>
      <input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} type="search"
        aria-label={placeholder}
        className="w-full border border-slate-200 rounded-xl pl-10 pr-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-400" />
    </div>
  );
}

export function Exito({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center gap-3 pt-2">
      <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">{Ico.check()}</div>
      <p className="font-bold text-xl text-[#0f172a]" style={DISPLAY}>{titulo}</p>
      {children}
    </div>
  );
}

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500" role="status" aria-live="polite">
      <span className="w-4 h-4 rounded-full border-2 border-slate-300 border-t-teal-500 animate-spin" aria-hidden="true" />
      {texto}
    </div>
  );
}

export function ErrorCarga({ error, reintentar }: { error: unknown; reintentar?: () => void }) {
  return (
    <Alert type="error">
      <p className="font-semibold">No se pudieron obtener los datos.</p>
      <p className="mt-0.5">{mensajeDeError(error)}</p>
      {reintentar && <button onClick={reintentar} className={`mt-2 underline font-semibold ${FOCO}`}>Reintentar</button>}
    </Alert>
  );
}

/** Contenedor de pantalla móvil: barra fija arriba y contenido desplazable. */
export function Pantalla({ barra, children, pie }: { barra: ReactNode; children: ReactNode; pie?: ReactNode }) {
  return (
    <div className="flex flex-col h-full bg-[#f8fafc] min-h-0">
      {barra}
      <div className="flex-1 overflow-auto px-5 pt-5 pb-6 flex flex-col gap-4 min-h-0">{children}</div>
      {pie}
    </div>
  );
}

// ── Datos asíncronos ─────────────────────────────────────────────────────
export interface Carga<T> {
  datos: T | undefined;
  error: unknown;
  cargando: boolean;
  recargar: () => void;
}

/** Ejecuta `fn` al montar y cada vez que cambian `deps`; descarta respuestas obsoletas. */
export function useCarga<T>(fn: () => Promise<T>, deps: unknown[]): Carga<T> {
  const [estado, setEstado] = useState<{ datos?: T; error?: unknown; cargando: boolean }>({ cargando: true });
  const [version, setVersion] = useState(0);
  const turno = useRef(0);
  useEffect(() => {
    const mio = ++turno.current;
    setEstado((e) => ({ datos: e.datos, cargando: true }));
    fn().then(
      (datos) => { if (mio === turno.current) setEstado({ datos, cargando: false }); },
      (error: unknown) => { if (mio === turno.current) setEstado({ error, cargando: false }); },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);
  const recargar = useCallback(() => setVersion((v) => v + 1), []);
  return { datos: estado.datos, error: estado.error, cargando: estado.cargando, recargar };
}

/** Valor con retraso (para no consultar el servidor en cada tecla). */
export function useDiferido<T>(valor: T, ms = 300): T {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setV(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return v;
}

/** Muestra los estados de carga/error y, cuando hay datos, el contenido. */
export function ConCarga<T>({ carga, children, texto }: { carga: Carga<T>; children: (datos: T) => ReactNode; texto?: string }) {
  if (carga.error && !carga.datos) return <ErrorCarga error={carga.error} reintentar={carga.recargar} />;
  if (!carga.datos) return <Cargando texto={texto} />;
  return <>{children(carga.datos)}</>;
}
