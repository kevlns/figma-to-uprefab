/**
 * `agent docs`: surface the declared SKILL.md (agent spec 正本) to stdout or
 * a target path. The CLI never installs skills.
 */

import { writeFileSync } from "node:fs";
import { runtimeSkillContent, runtimeSkillPath } from "../core/runtime-skill.js";

export interface AgentDocsResult {
  source: string;
  target?: string;
  bytes: number;
}

export function agentDocsCommand(options: { out?: string }): AgentDocsResult {
  const source = runtimeSkillPath();
  const content = runtimeSkillContent();
  if (options.out) {
    writeFileSync(options.out, content, "utf8");
    return { source, target: options.out, bytes: Buffer.byteLength(content, "utf8") };
  }

  return { source, bytes: Buffer.byteLength(content, "utf8") };
}
