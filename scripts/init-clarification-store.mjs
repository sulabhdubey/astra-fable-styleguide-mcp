import {ClarificationStore} from '../dist/apps/mcp-server/src/clarification-store.js';
const path=process.argv[2];
if(!path||process.argv.length!==3)throw Error('Usage: node scripts/init-clarification-store.mjs <new-private-journal-path>');
ClarificationStore.initialize(path);
console.log('Initialized a new private clarification journal. Protect its directory and retain backups.');
