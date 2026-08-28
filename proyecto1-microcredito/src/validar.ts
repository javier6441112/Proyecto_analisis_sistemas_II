import { readFileSync } from 'node:fs';
import { Validator } from '@seriousme/openapi-schema-validator';

async function main(): Promise<void> {
  const especificacion = readFileSync('docs/api/openapi.yaml', 'utf8');
  const validator = new Validator();
  const resultado = await validator.validate(especificacion);

  if (!resultado.valid) {
    console.error('Error al validar OpenAPI:', resultado.errors);
    process.exitCode = 1;
    return;
  }

  console.log(`OK - documento OpenAPI ${validator.version} valido`);
}

await main();
