/**
 * Cliente del modelo de lenguaje local (Ollama, offline). Por defecto `qwen3.5:9b`.
 * Qwen 3.5 razona («thinking») por defecto: se desactiva (`think: false`) porque el
 * razonamiento consumiría el límite de tokens y multiplicaría el tiempo de respuesta en CPU;
 * las cifras no las calcula el modelo sino las herramientas del núcleo.
 * `CV_LLM_PENSAR=1` lo reactiva.
 */
import { urlOllama } from '../rag/embeddings.js';
import { postJson } from '../rag/http-local.js';

export interface LlamadaHerramienta {
  nombre: string;
  argumentos: Record<string, unknown>;
}

export interface MensajeChat {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
  tool_name?: string;
}

export interface DefinicionHerramienta {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface RespuestaModelo {
  texto: string;
  llamadas: LlamadaHerramienta[];
}

export interface ModeloLenguaje {
  readonly nombre: string;
  conversar(mensajes: MensajeChat[], herramientas: DefinicionHerramienta[]): Promise<RespuestaModelo>;
}

/**
 * Algunos modelos pequeños escriben la llamada como texto JSON en lugar de usar el campo
 * `tool_calls`. Se reconoce ese formato para no perder la intención.
 */
export function llamadasEnTexto(texto: string): LlamadaHerramienta[] {
  const limpio = texto.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  if (!/^[[{]\s*[[{]?\s*"name"/.test(limpio) && !/^\[\s*\{\s*"name"/.test(limpio) && !/^\{\s*"name"/.test(limpio)) return [];
  try {
    const valor = JSON.parse(limpio) as unknown;
    const lista = Array.isArray(valor) ? valor : [valor];
    return lista
      .filter((x): x is { name: string; arguments?: Record<string, unknown> } => typeof x === 'object' && x !== null && typeof (x as { name?: unknown }).name === 'string')
      .map((x) => ({ nombre: x.name, argumentos: x.arguments ?? {} }));
  } catch {
    return [];
  }
}

/** Quita los bloques `<think>…</think>` que algunos modelos dejan en la respuesta. */
export function sinRazonamiento(texto: string): string {
  return texto.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '').trim();
}

export class ModeloOllama implements ModeloLenguaje {
  constructor(
    readonly nombre = process.env.CV_LLM_MODELO ?? 'qwen3.5:9b',
    private readonly url = urlOllama(),
    private readonly contexto = Number(process.env.CV_LLM_CONTEXTO ?? 8192),
  ) {}

  async conversar(mensajes: MensajeChat[], herramientas: DefinicionHerramienta[]): Promise<RespuestaModelo> {
    const cuerpo = await postJson<{ message?: { content?: string; tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> | string } }> } }>(`${this.url}/api/chat`, {
      model: this.nombre,
      stream: false,
      keep_alive: '30m',
      think: process.env.CV_LLM_PENSAR === '1',
      options: { temperature: 0, num_ctx: this.contexto, num_predict: Number(process.env.CV_LLM_MAX_TOKENS ?? 600) },
      messages: mensajes,
      tools: herramientas,
    });
    // Por si una versión de Ollama sin soporte de `think` devuelve el razonamiento en el texto.
    const texto = sinRazonamiento(cuerpo.message?.content ?? '');
    const nativas = (cuerpo.message?.tool_calls ?? []).map((t) => ({
      nombre: t.function.name,
      argumentos: typeof t.function.arguments === 'string' ? (JSON.parse(t.function.arguments) as Record<string, unknown>) : t.function.arguments,
    }));
    return { texto, llamadas: nativas.length > 0 ? nativas : llamadasEnTexto(texto) };
  }

  /** Carga el modelo en memoria al arrancar para que la primera pregunta no espere la carga. */
  async precalentar(): Promise<void> {
    await postJson(`${this.url}/api/generate`, { model: this.nombre, prompt: '', keep_alive: '30m' });
  }
}
