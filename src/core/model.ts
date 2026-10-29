export type Harness = 'standard' | 'githubCopilot' | 'mixed' | 'unknown';

export type ComponentCategory =
  | 'skill'
  | 'tool'
  | 'knowledge'
  | 'topic'
  | 'action'
  | 'childAgent'
  | 'variable'
  | 'workflow'
  | 'connection'
  | 'other';

export interface Component {
  category: ComponentCategory;
  /** YAML `kind` (for example McpTool, ConnectedAgentTool, AdaptiveDialog, TaskDialog). */
  kind?: string;
  name: string;
  file: string;
  description?: string;
  /** True when the orchestrator selects this component by its description (description-first routing). */
  routable: boolean;
  schemaName?: string;
  /** McpTool / connector operation allowlist when present. */
  allowedTools?: string[];
  toolPermissionMode?: string;
  /** ConnectedAgentTool target schema name. */
  targetAgentSchema?: string;
  historyType?: string;
  /** Hash of SKILL.md body (skills only), used for duplicate detection. */
  contentHash?: string;
  /** Description from SKILL.md front matter (skills only). */
  skillMdDescription?: string;
  skillMdFile?: string;
  /** Dialog schema names referenced by BeginDialog nodes (standard topics only). */
  dialogRefs?: string[];
}

export interface SyncMetadata {
  agentId?: string;
  environmentId?: string;
  environmentDisplayName?: string;
  dataverseEndpoint?: string;
}

export interface AgentModel {
  name: string;
  schemaName?: string;
  root: string;
  harness: Harness;
  harnessEvidence: string[];
  /** False for standard agents on classic (non-generative) orchestration, where instructions are not used. */
  generative: boolean;
  settingsFile?: string;
  agentFile?: string;
  instructions: string;
  sync: SyncMetadata;
  components: Component[];
}

export interface ParseError {
  file: string;
  message: string;
  line?: number;
}

export interface WorkspaceModel {
  agents: AgentModel[];
  parseErrors: ParseError[];
}

export type Severity = 'error' | 'warning' | 'info';

export interface Finding {
  ruleId: string;
  severity: Severity;
  message: string;
  file: string;
  /** 0-based line. */
  line: number;
  agent?: string;
}

export interface RuleInfo {
  id: string;
  title: string;
  severity: Severity;
  harness: Harness[] | 'any';
  rationale: string;
}
