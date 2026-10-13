// Carregado com `node --import ./railway/register.mjs`: faz `sdk` e `sdk/db` apontarem para o runtime do Railway.
import { register } from 'node:module';
register(new URL('./hooks.mjs', import.meta.url));
