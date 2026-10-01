import {createHash} from 'node:crypto';
import {closeSync,constants,fsyncSync,fstatSync,lstatSync,openSync,readFileSync,writeSync} from 'node:fs';
import {resolve} from 'node:path';
import type {ClarificationSnapshot,ClarificationStorage} from './service.js';

const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const HASH=/^[a-f0-9]{64}$/;
const genesis='0'.repeat(64);
function validate(state:ClarificationSnapshot){
  if(!state||!Array.isArray(state.heldHashes)||!state.heldHashes.every(h=>typeof h==='string'&&HASH.test(h))||!Array.isArray(state.contexts))throw Error('Clarification storage integrity: invalid snapshot');
  for(const entry of state.contexts){
    if(!Array.isArray(entry)||entry.length!==2||typeof entry[0]!=='string'||!HASH.test(entry[0]))throw Error('Clarification storage integrity: invalid context');
    const run=entry[1];
    if(!run||run.status!=='NEEDS_CLARIFICATION'||typeof run.runId!=='string'||run.clarification?.contextHash!==entry[0]||!HASH.test(run.candidateHash)||!Array.isArray(run.clarification.requests)||!run.clarification.requests.length)throw Error('Clarification storage integrity: invalid held result');
  }
}

/** Single-writer local journal. Protect its directory with OS permissions and backups. */
export class ClarificationStore implements ClarificationStorage {
  private path:string;
  private raw='';
  private sequence=0;
  private head=genesis;
  private failed=false;
  private state:ClarificationSnapshot={heldHashes:[],contexts:[]};
  static initialize(path:string){
    const body={sequence:1,previousHash:genesis,state:{heldHashes:[],contexts:[]}};
    const bytes=Buffer.from(JSON.stringify({...body,hash:digest(JSON.stringify(body))})+'\n');
    const fd=openSync(resolve(path),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);
    try{let offset=0;while(offset<bytes.length)offset+=writeSync(fd,bytes,offset,bytes.length-offset);fsyncSync(fd);}finally{closeSync(fd);}
  }
  constructor(path:string){
    this.path=resolve(path);this.raw=this.read();
    if(!this.raw||!this.raw.endsWith('\n'))throw Error('Clarification storage integrity: incomplete journal');
    for(const line of this.raw.slice(0,-1).split('\n')){
      let record;try{record=JSON.parse(line);}catch{throw Error('Clarification storage integrity: invalid JSON');}
      if(!record||typeof record!=='object')throw Error('Clarification storage integrity: invalid record');
      const {hash,...body}=record;
      if(body.sequence!==this.sequence+1||body.previousHash!==this.head||hash!==digest(JSON.stringify(body)))throw Error('Clarification storage integrity: broken chain');
      validate(body.state);this.state=body.state;this.sequence++;this.head=hash;
    }
  }
  private read(){
    if(!lstatSync(this.path).isFile())throw Error('Clarification storage integrity: path must be a regular file');
    const fd=openSync(this.path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
    try{if(!fstatSync(fd).isFile())throw Error('Clarification storage integrity: not a regular file');return readFileSync(fd,'utf8');}finally{closeSync(fd);}
  }
  assertHealthy(){
    if(this.failed)throw Error('Clarification storage integrity failure; restart after recovery');
    try{if(this.read()!==this.raw)throw Error('Clarification storage integrity: file changed outside this instance');}catch(error){this.failed=true;throw error;}
  }
  load(){this.assertHealthy();return structuredClone(this.state);}
  save(state:ClarificationSnapshot){
    this.assertHealthy();validate(state);
    const body={sequence:this.sequence+1,previousHash:this.head,state};
    const hash=digest(JSON.stringify(body)),line=JSON.stringify({...body,hash})+'\n',bytes=Buffer.from(line);
    try{
      const fd=openSync(this.path,constants.O_WRONLY|constants.O_APPEND|(constants.O_NOFOLLOW??0));
      try{
        if(!fstatSync(fd).isFile()||fstatSync(fd).size!==Buffer.byteLength(this.raw))throw Error('Clarification storage integrity: changed before write');
        let offset=0;while(offset<bytes.length)offset+=writeSync(fd,bytes,offset,bytes.length-offset);fsyncSync(fd);
      }finally{closeSync(fd);}
      this.raw+=line;this.sequence++;this.head=hash;this.state=structuredClone(state);
    }catch(error){this.failed=true;throw error;}
  }
}
