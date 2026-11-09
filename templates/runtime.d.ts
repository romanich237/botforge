export type ScenarioEvent = {
  type: string;
  text?: string;
  nodeId?: string | null;
  token?: string;
  placement?: string;
  buttons?: Array<{ label: string; action: string; url?: string | null; callback: string }>;
  tokens?: string[];
  links?: Record<string, Array<{ text: string; url: string }>>;
};
export class Session {
  constructor(project: unknown, key?: string);
  behavior: Record<string, any>;
  values: Record<string, string | number>;
  waiting: string | null;
  current: string | null;
  handle(event: { text?: string; callback?: string }, now?: number): ScenarioEvent[];
  tick(now?: number): ScenarioEvent[];
}
