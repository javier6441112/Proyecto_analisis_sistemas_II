import { describe, expect, it } from 'vitest';
import { ModeloOllama, sinRazonamiento } from '../src/chat/modelo.js';

describe('Modelo de chat (Qwen 3.5)', () => {
  it('usa qwen3.5:9b por defecto', () => {
    expect(new ModeloOllama().nombre).toBe(process.env.CV_LLM_MODELO ?? 'qwen3.5:9b');
  });

  it('quita el razonamiento <think> si llega en el texto', () => {
    expect(sinRazonamiento('<think>calculo interno</think>\nLa cartera en riesgo es 11.93 %.')).toBe('La cartera en riesgo es 11.93 %.');
    expect(sinRazonamiento('razonamiento sin apertura</think>Respuesta')).toBe('Respuesta');
    expect(sinRazonamiento('Respuesta directa')).toBe('Respuesta directa');
  });
});
