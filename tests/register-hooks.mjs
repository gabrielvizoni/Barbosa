// Ponto de entrada passado via `node --import` (ver package.json): registra
// o hook de resolução de tests/module-hooks.mjs antes de qualquer teste
// carregar código de src/.
import { register } from 'node:module';

register('./module-hooks.mjs', import.meta.url);
