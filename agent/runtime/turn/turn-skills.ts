/**
 * The skills of a turn: listed to the model from memory; a skill's files reach the sandbox only
 * when the model loads that skill.
 *
 * Exports:
 * - `prepareTurnSkills`: the turn's skill list, recorded for the session. It never opens the sandbox,
 *   so a plain message does not wake it.
 * - `createTurnSkillLoader`: `load_skill` behind a tool context. It reads the skill's current
 *   definition and, for a skill that has files, writes its package into the sandbox skill root as an
 *   exact copy before returning the instructions.
 * - `tidySkillRoot`: the first sandbox use of a root turn's step removes every skill directory the
 *   turn does not grant, whatever put it there.
 * - `createStepSkillAccess`: the sandbox and the loader one step's tool contexts share.
 * - `TurnSkillLoader`, `SKILL_DIRECTORY_FOR_MODEL`.
 *
 * A delegated child shares its parent's sandbox: it writes the packages it loads and removes nothing.
 * Contains code adapted from eve 0.40.0 (Apache-2.0); see THIRD_PARTY_NOTICES.md.
 */
import type { Pool } from "pg";

import { saveAnnouncedSkills } from "../history/history-repository.js";
import type { RuntimeSandboxSession } from "../sandbox/types.js";
import type { AnnouncedSkill, LoadedSkill, SkillDefinition } from "../skills/definition.js";
import { toSkillPackage } from "../skills/packages.js";

/** Where a loaded skill's files live, as the model writes the path; bash and file tools expand `$HOME`. */
export const SKILL_DIRECTORY_FOR_MODEL = "$HOME/.agents/skills";

export interface TurnSkillLoader {
  load(name: string): Promise<LoadedSkill>;
}

export async function prepareTurnSkills(input: {
  readonly database: Pick<Pool, "query">;
  readonly definitions: Readonly<Record<string, SkillDefinition>>;
  readonly sessionId: string;
}): Promise<AnnouncedSkill[]> {
  const skills = Object.entries(input.definitions).map(([name, skill]) => ({ description: skill.description, name }));
  await saveAnnouncedSkills(input.database, { sessionId: input.sessionId, skills });
  return skills;
}

function noSuchSkill(name: string, granted: readonly string[]): Error {
  const available = [...new Set(granted)].sort();
  const hint = available.length > 0 ? ` Available skills: ${available.join(", ")}.` : "";
  return new Error(`No skill named "${name}".${hint}`);
}

export function createTurnSkillLoader(input: {
  /** The skill names listed to the model in this turn. */
  readonly granted: readonly string[];
  /** The turn's skill definitions as they are now; read once per loader. */
  readonly resolveDefinitions: () => Promise<Readonly<Record<string, SkillDefinition>>>;
  readonly sandbox: () => Promise<RuntimeSandboxSession>;
  /** A root turn tidies the skill root while writing; a delegated child only adds. */
  readonly tidy: boolean;
}): TurnSkillLoader {
  let definitions: Promise<Readonly<Record<string, SkillDefinition>>> | undefined;
  return {
    async load(name) {
      if (!input.granted.includes(name)) throw noSuchSkill(name, input.granted);
      definitions ??= input.resolveDefinitions();
      // A skill the owner withdrew after the turn listed it is no longer loadable.
      const skill = (await definitions)[name];
      if (skill === undefined) throw noSuchSkill(name, input.granted);
      const paths = Object.keys(skill.files ?? {}).sort();
      if (paths.length === 0) return { files: null, markdown: skill.markdown };
      const sandbox = await input.sandbox();
      await sandbox.syncSkills([toSkillPackage(name, skill)], input.tidy ? input.granted : null);
      return { files: { directory: `${SKILL_DIRECTORY_FOR_MODEL}/${name}`, paths }, markdown: skill.markdown };
    },
  };
}

export async function tidySkillRoot(sandbox: RuntimeSandboxSession, granted: readonly string[]): Promise<void> {
  await sandbox.syncSkills([], granted);
}

/**
 * The sandbox and the skill loader one step's tools share. The sandbox opens on first use; a root
 * turn tidies the skill root right then.
 */
export function createStepSkillAccess(input: {
  readonly granted: readonly string[];
  readonly openSandbox: () => Promise<RuntimeSandboxSession>;
  readonly resolveDefinitions: () => Promise<Readonly<Record<string, SkillDefinition>>>;
  /** A delegated child shares its parent's sandbox, so only a root turn removes what it does not grant. */
  readonly root: boolean;
}): { readonly getSandbox: () => Promise<RuntimeSandboxSession>; readonly loadSkill: (name: string) => Promise<LoadedSkill> } {
  let sandbox: Promise<RuntimeSandboxSession> | undefined;
  const getSandbox = () => (sandbox ??= input.openSandbox().then(async (opened) => {
    if (input.root) await tidySkillRoot(opened, input.granted);
    return opened;
  }));
  const loader = createTurnSkillLoader({
    granted: input.granted, resolveDefinitions: input.resolveDefinitions, sandbox: getSandbox, tidy: input.root,
  });
  return { getSandbox, loadSkill: (name) => loader.load(name) };
}
