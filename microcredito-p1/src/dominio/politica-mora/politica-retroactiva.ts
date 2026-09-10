import { Dinero } from '../dinero.js';
import { PoliticaPlana } from './politica-plana.js';
import type { PoliticaMora } from './politica-mora.js';

export class PoliticaRetroactiva extends PoliticaPlana implements PoliticaMora {
  readonly id = 'POL-RETRO';
  readonly nombre = 'Retroactiva';
  readonly vigenteDesde = '2024-01-01';

  override calcular(capitalEnMora: Dinero, diasAtraso: number): Dinero {
    return super.calcular(capitalEnMora, diasAtraso);
  }
}
