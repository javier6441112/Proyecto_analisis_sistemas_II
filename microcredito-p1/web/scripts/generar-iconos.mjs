// Genera los iconos de la PWA (web/public/icons) a partir del logo de capas de la interfaz
// (Ico.logo en src/ui.tsx), sin dependencias: rasteriza con funciones de distancia y escribe PNG con zlib.
//   node web/scripts/generar-iconos.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const SALIDA = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const TEAL = [45, 212, 191];   // teal-400
const NAVY = [15, 23, 42];     // #0f172a

// Logo en una caja de 24×24 (mismos trazos que Ico.logo), grosor 2.2 con extremos redondeados.
const TRAZOS = [
  [[12, 2], [2, 7], [12, 12], [22, 7], [12, 2]],
  [[2, 17], [12, 22], [22, 17]],
  [[2, 12], [12, 17], [22, 12]],
];
const SEGMENTOS = TRAZOS.flatMap((t) => t.slice(1).map((p, i) => [t[i], p]));

function distanciaSegmento(px, py, [[ax, ay], [bx, by]]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Distancia con signo a un rectángulo redondeado centrado (negativa dentro). */
function sdRectRedondeado(px, py, mitad, radio) {
  const qx = Math.abs(px) - mitad + radio, qy = Math.abs(py) - mitad + radio;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radio;
}

const cobertura = (d) => Math.max(0, Math.min(1, 0.5 - d)); // antialias de 1 px

/**
 * @param tam lado en px · @param escalaLogo fracción del lado que ocupa la caja de 24 del logo
 * @param radio radio de las esquinas del fondo como fracción del lado (0 = a sangre)
 */
function icono(tam, escalaLogo, radio) {
  const px = Buffer.alloc(tam * tam * 4);
  const unidad = (tam * escalaLogo) / 24;          // px por unidad del logo
  const origen = (tam - 24 * unidad) / 2;
  const medio = 1.1 * unidad;                       // medio grosor del trazo
  for (let y = 0; y < tam; y++) {
    for (let x = 0; x < tam; x++) {
      const cx = x + 0.5 - tam / 2, cy = y + 0.5 - tam / 2;
      const fondo = radio === 0 ? 1 : cobertura(sdRectRedondeado(cx, cy, tam / 2, radio * tam));
      const lx = (x + 0.5 - origen) / unidad, ly = (y + 0.5 - origen) / unidad;
      let d = Infinity;
      for (const s of SEGMENTOS) d = Math.min(d, distanciaSegmento(lx, ly, s));
      const trazo = cobertura(d * unidad - medio);
      const i = (y * tam + x) * 4;
      for (let c = 0; c < 3; c++) px[i + c] = Math.round(TEAL[c] * (1 - trazo) + NAVY[c] * trazo);
      px[i + 3] = Math.round(255 * fondo);
    }
  }
  return png(tam, px);
}

// ---- PNG mínimo (RGBA 8 bits) ----
const TABLA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = TABLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function bloque(tipo, datos) {
  const largo = Buffer.alloc(4); largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}
function png(tam, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(tam, 0); ihdr.writeUInt32BE(tam, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bits, RGBA
  const filas = Buffer.alloc((tam * 4 + 1) * tam);
  for (let y = 0; y < tam; y++) rgba.copy(filas, y * (tam * 4 + 1) + 1, y * tam * 4, (y + 1) * tam * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloque('IHDR', ihdr), bloque('IDAT', deflateSync(filas, { level: 9 })), bloque('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(SALIDA, { recursive: true });
const archivos = {
  'icon-192.png': icono(192, 0.62, 0.22),
  'icon-512.png': icono(512, 0.62, 0.22),
  // Maskable: fondo a sangre y logo dentro de la zona segura (círculo del 80 %).
  'icon-maskable-512.png': icono(512, 0.5, 0),
  'apple-touch-icon.png': icono(180, 0.58, 0),
  'favicon-32.png': icono(32, 0.7, 0.22),
};
for (const [nombre, datos] of Object.entries(archivos)) {
  writeFileSync(join(SALIDA, nombre), datos);
  console.log(`${nombre}: ${datos.length} bytes`);
}
