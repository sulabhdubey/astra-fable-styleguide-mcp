export interface StyleMcpClientOptions { endpoint:string; fetchImpl?:typeof fetch; }
export class StyleConstitutionClient{
 private f:typeof fetch; constructor(private options:StyleMcpClientOptions){this.f=options.fetchImpl??fetch;}
 async health():Promise<unknown>{const base=new URL(this.options.endpoint);const url=new URL('/health',base);const r=await this.f(url);if(!r.ok)throw new Error(`Health failed: ${r.status}`);return r.json();}
 endpoint():string{return this.options.endpoint;}
}
