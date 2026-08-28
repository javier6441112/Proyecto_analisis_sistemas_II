import { writeFileSync } from 'node:fs';
import { stringify } from 'yaml';
import { documentoOpenAPI } from './openapi.js';

writeFileSync('docs/api/openapi.json', JSON.stringify(documentoOpenAPI, null, 2), 'utf8');
writeFileSync('docs/api/openapi.yaml', stringify(documentoOpenAPI), 'utf8');
console.log('Archivos docs/api/openapi.json y docs/api/openapi.yaml generados.');
