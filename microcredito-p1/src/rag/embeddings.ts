/**
 * Proveedores de embeddings. En producción: `bge-m3` servido por Ollama en la misma
 * máquina (offline). En pruebas: un embebedor determinista que no requiere Ollama.
 */
import { createHash } from 'node:crypto';
import { postJson } from './http-local.js';

export interface Embebedor {
  readonly modelo: string;
  embeber(textos: string[]): Promise<number[][]>;
}

export function urlOllama(): string {
  return (process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
}

export class EmbebedorOllama implements Embebedor {
  constructor(readonly modelo = process.env.CV_EMBEDDINGS ?? 'bge-m3', private readonly url = urlOllama()) {}

  async embeber(textos: string[]): Promise<number[][]> {
    const cuerpo = await postJson<{ embeddings?: number[][] }>(`${this.url}/api/embed`, { model: this.modelo, input: textos, keep_alive: '30m' });
    if (!cuerpo.embeddings || cuerpo.embeddings.length !== textos.length) throw new Error('Ollama no devolvió los embeddings esperados');
    return cuerpo.embeddings;
  }
}

/**
 * Embebedor determinista para pruebas: bolsa de palabras con hashing a 256 dimensiones,
 * normalizada. No tiene calidad semántica real, pero es reproducible y sin red.
 */
export class EmbebedorDePrueba implements Embebedor {
  readonly modelo = 'prueba-hash-256';

  async embeber(textos: string[]): Promise<number[][]> {
    return textos.map((t) => {
      const v = new Array<number>(256).fill(0);
      const palabras = t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9-]{3,}/g) ?? [];
      for (const p of palabras) v[createHash('md5').update(p).digest()[0]] += 1;
      const norma = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
      return v.map((x) => x / norma);
    });
  }
}
