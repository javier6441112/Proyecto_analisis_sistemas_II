/**
 * POST JSON a Ollama con `node:http`. Se evita `fetch` porque su límite fijo de 300 s
 * para recibir cabeceras corta la primera respuesta mientras el modelo se carga en
 * máquinas sin tarjeta de video.
 */
import { request } from 'node:http';

export function postJson<T>(url: string, cuerpo: unknown, limiteMs = Number(process.env.CV_LLM_LIMITE_MS ?? 900_000)): Promise<T> {
  return new Promise<T>((resolver, rechazar) => {
    const datos = Buffer.from(JSON.stringify(cuerpo));
    const req = request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': datos.length } }, (res) => {
      const trozos: Buffer[] = [];
      res.on('data', (t: Buffer) => trozos.push(t));
      res.on('end', () => {
        const texto = Buffer.concat(trozos).toString('utf8');
        if ((res.statusCode ?? 500) >= 400) return rechazar(new Error(`Ollama respondió ${res.statusCode}: ${texto}`));
        try {
          resolver(JSON.parse(texto) as T);
        } catch {
          rechazar(new Error('Respuesta de Ollama no es JSON válido'));
        }
      });
    });
    req.setTimeout(limiteMs, () => req.destroy(new Error(`Ollama no respondió en ${Math.round(limiteMs / 1000)} s`)));
    req.on('error', (e: NodeJS.ErrnoException) => {
      rechazar(e.code === 'ECONNREFUSED' ? new Error(`No se pudo conectar con Ollama en ${new URL(url).origin}. ¿Está corriendo "ollama serve"?`) : e);
    });
    req.end(datos);
  });
}
