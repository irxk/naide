import { register } from 'node:module';

register('naider/loader', import.meta.url);
await import('./discord-bot.naide');
