import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

export interface StyleMcpClientOptions {
  endpoint: string;
  fetchImpl?: typeof fetch;
}

export type PublicStyleTool =
  | 'get_style_manifest'
  | 'get_design_tokens'
  | 'get_component_rules'
  | 'search_style_spec'
  | 'explain_style_decision'
  | 'validate_tokens'
  | 'check_style_compliance'
  | 'compare_spec_versions';

const PUBLIC_STYLE_TOOLS: ReadonlySet<string> = new Set<PublicStyleTool>([
  'get_style_manifest', 'get_design_tokens', 'get_component_rules', 'search_style_spec',
  'explain_style_decision', 'validate_tokens', 'check_style_compliance', 'compare_spec_versions',
]);

export interface StyleComplianceReport {
  /** Present on v0.2 servers; absent on the released v0.1 server. */
  status?: 'pass' | 'fail' | 'not_checked';
  compliant: boolean;
  truncated?: boolean;
  violations: Array<{ ruleId: string; message: string; match: string; line?: number; column?: number }>;
  warnings: string[];
  suggestedFixes: string[];
  checksPerformed?: string[];
  limitations?: string[];
}

export class StyleConstitutionClient {
  private readonly url: URL;
  private readonly fetchImpl: typeof fetch;
  private connection: Client | undefined;
  private transport: StreamableHTTPClientTransport | undefined;
  private connecting: Promise<void> | undefined;

  constructor(options: StyleMcpClientOptions) {
    this.url = new URL(options.endpoint);
    if (!['http:', 'https:'].includes(this.url.protocol)) throw new Error('MCP endpoint must use HTTP or HTTPS');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  endpoint(): string { return this.url.href; }

  async health(): Promise<unknown> {
    const response = await this.fetchImpl(new URL('/health', this.url));
    if (!response.ok) throw new Error(`Health failed: ${response.status}`);
    return response.json();
  }

  async connect(): Promise<void> {
    if (this.connection) return;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const client = new Client({ name: 'style-constitution-ts-client', version: '0.1.0' }, { versionNegotiation: { mode: 'auto' } });
      const transport = new StreamableHTTPClientTransport(this.url, { fetch: this.fetchImpl });
      try {
        await client.connect(transport);
        this.connection = client;
        this.transport = transport;
      } catch (error) {
        await client.close().catch(() => undefined);
        throw error;
      }
    })();
    try { await this.connecting; } finally { this.connecting = undefined; }
  }

  async close(): Promise<void> {
    if (this.connecting) await this.connecting.catch(() => undefined);
    const client = this.connection;
    const transport = this.transport;
    this.connection = undefined;
    this.transport = undefined;
    if (transport) await transport.terminateSession().catch(() => undefined);
    if (client) await client.close();
  }

  async listTools() {
    await this.connect();
    return this.connection!.listTools();
  }

  async callReadTool<T = unknown>(name: PublicStyleTool, args: Record<string, unknown> = {}): Promise<T> {
    if (!PUBLIC_STYLE_TOOLS.has(name)) throw new Error(`Tool ${name} is outside the public read API`);
    await this.connect();
    const result = await this.connection!.callTool({ name, arguments: args });
    const text = result.content.find(block => block.type === 'text');
    if (result.isError) throw new Error(text?.type === 'text' ? text.text : `${name} failed`);
    if (text?.type !== 'text') throw new Error(`${name} returned no JSON text`);
    try { return JSON.parse(text.text) as T; }
    catch { throw new Error(`${name} returned invalid JSON text`); }
  }

  getStyleManifest(): Promise<Record<string, unknown>> { return this.callReadTool('get_style_manifest'); }
  getDesignTokens(scope?: string): Promise<unknown> { return this.callReadTool('get_design_tokens', scope ? { scope } : {}); }
  getComponentRules(component: string): Promise<Record<string, unknown>> { return this.callReadTool('get_component_rules', { component }); }
  searchStyleSpec(query: string): Promise<unknown[]> { return this.callReadTool('search_style_spec', { query }); }
  explainStyleDecision(id: string): Promise<Record<string, unknown>> { return this.callReadTool('explain_style_decision', { id }); }
  validateTokens(): Promise<unknown> { return this.callReadTool('validate_tokens'); }
  checkStyleCompliance(input: string): Promise<StyleComplianceReport> { return this.callReadTool('check_style_compliance', { input }); }
  compareSpecVersions(fromVersion: string, toVersion: string): Promise<unknown> { return this.callReadTool('compare_spec_versions', { fromVersion, toVersion }); }
}
