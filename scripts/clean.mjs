import {rm} from 'node:fs/promises';for(const p of ['dist','generated','apps/docs/dist-portable'])await rm(p,{recursive:true,force:true});
