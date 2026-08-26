/**
 * `agent docs`: surface the canonical AGENTS.md (agent spec 正本) to stdout or
 * a target path. The CLI never installs skills.
 */

import { writeFileSync } from "node:fs";
import { agentsDocContent, agentsDocPath } from "../core/agent-docs.js";

export interface AgentDocsResult {
  source: string;
  target?: string;
  bytes: number;
}

export function agentDocsCommand(options: { out?: string }): AgentDocsResult {
  const source = agentsDocPath();
  const content = agentsDocContent();
  if (options.out) {
    writeFileSync(options.out, content, "utf8");
    return { source, target: options.out, bytes: Buffer.byteLength(content, "utf8") };
  }

  return { source, bytes: Buffer.byteLength(content, "utf8") };
}
