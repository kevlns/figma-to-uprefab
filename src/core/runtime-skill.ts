// Copyright © 2026 Vant <sl_kevln@163.com>
/** 运行规范只取本工具清单声明的 skill；开发 AGENTS 不参与执行。 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
export function runtimeSkillPath(): string {
 let dir=dirname(fileURLToPath(import.meta.url));
 for(let depth=0;depth<6;depth++) {
  const pkg=join(dir,"package.json");
  if(existsSync(pkg)&&JSON.parse(readFileSync(pkg,"utf8")).name==="@kevlns/figma-to-uprefab") {
   const manifest=JSON.parse(readFileSync(join(dir,"v-cli.plugin.json"),"utf8"));
   const entry=manifest.skills?.find((s:{id:string})=>s.id==="figma");
   if(!entry || !/^skills\/[a-z0-9-]+\/SKILL\.md$/.test(entry.path)) throw new Error("DOC_SKILL_MISSING: no declared runtime skill");
   const file=realpathSync(resolve(dir,entry.path)), delta=relative(realpathSync(dir),file);
   if(isAbsolute(delta)||delta.startsWith("..")) throw new Error("DOC_SKILL_PATH: entry outside package");
   return file;
  }
  dir=dirname(dir);
 }
 throw new Error("DOC_SKILL_MISSING: runtime skill package not found");
}
export function runtimeSkillContent(): string {return readFileSync(runtimeSkillPath(),"utf8");}
