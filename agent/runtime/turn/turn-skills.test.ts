/**
 * The skills of a turn without a sandbox until a skill with files is loaded.
 *
 * Constructs covered:
 * - `createTurnSkillLoader`: instructions-only skills never open the sandbox; a skill with files is
 *   written alone, with the turn's skill list as the keep list for a root turn and none for a child;
 *   a skill not granted, or withdrawn since the turn listed it, is refused by name.
 * - `tidySkillRoot`: an empty package list with the granted names.
 */
import { describe, expect, it, vi } from "vitest";

import type { RuntimeSandboxSession } from "../sandbox/types.js";
import type { SkillDefinition } from "../skills/definition.js";
import { createTurnSkillLoader, tidySkillRoot } from "./turn-skills.js";

const DEFINITIONS: Record<string, SkillDefinition> = {
  digest: { description: "Сводки", markdown: "Пиши коротко." },
  pdf: { description: "PDF", files: { "forms.md": "Формы", "scripts/fill.py": "print()" }, markdown: "Заполняй формы." },
};

function fakeSandbox() {
  const syncSkills = vi.fn<RuntimeSandboxSession["syncSkills"]>(async () => undefined);
  return { sandbox: { syncSkills } as unknown as RuntimeSandboxSession, syncSkills };
}

function loader(options: { granted?: string[]; tidy?: boolean; definitions?: Record<string, SkillDefinition> } = {}) {
  const { sandbox, syncSkills } = fakeSandbox();
  const open = vi.fn(async () => sandbox);
  const resolveDefinitions = vi.fn(async () => options.definitions ?? DEFINITIONS);
  const skills = createTurnSkillLoader({
    granted: options.granted ?? ["digest", "pdf"],
    resolveDefinitions,
    sandbox: open,
    tidy: options.tidy ?? true,
  });
  return { open, resolveDefinitions, skills, syncSkills };
}

describe("turn skill loader", () => {
  it("returns an instructions-only skill without opening the sandbox", async () => {
    const { open, skills } = loader();

    await expect(skills.load("digest")).resolves.toEqual({ files: null, markdown: "Пиши коротко." });
    expect(open).not.toHaveBeenCalled();
  });

  it("writes only the loaded skill's package and keeps exactly the turn's skills in a root turn", async () => {
    const { skills, syncSkills } = loader();

    await expect(skills.load("pdf")).resolves.toEqual({
      files: { directory: "$HOME/.agents/skills/pdf", paths: ["forms.md", "scripts/fill.py"] },
      markdown: "Заполняй формы.",
    });
    expect(syncSkills).toHaveBeenCalledOnce();
    const [packages, keep] = syncSkills.mock.calls[0]!;
    expect(packages.map((pkg) => [pkg.name, pkg.files.map((file) => file.relativePath)]))
      .toEqual([["pdf", ["SKILL.md", "forms.md", "scripts/fill.py"]]]);
    expect(keep).toEqual(["digest", "pdf"]);
  });

  it("only adds the package in a delegated child, which shares its parent's sandbox", async () => {
    const { skills, syncSkills } = loader({ tidy: false });

    await skills.load("pdf");
    expect(syncSkills.mock.calls[0]![1]).toBeNull();
  });

  it("refuses a skill the turn does not list and names the listed ones", async () => {
    const { resolveDefinitions, skills } = loader();

    await expect(skills.load("secret")).rejects.toThrow('No skill named "secret". Available skills: digest, pdf.');
    expect(resolveDefinitions).not.toHaveBeenCalled();
  });

  it("refuses a listed skill withdrawn after the turn listed it", async () => {
    const { skills, syncSkills } = loader({ definitions: { digest: DEFINITIONS.digest! } });

    await expect(skills.load("pdf")).rejects.toThrow('No skill named "pdf".');
    expect(syncSkills).not.toHaveBeenCalled();
  });

  it("reads the definitions once per loader", async () => {
    const { resolveDefinitions, skills } = loader();

    await skills.load("digest");
    await skills.load("pdf");
    expect(resolveDefinitions).toHaveBeenCalledOnce();
  });
});

describe("skill root tidying", () => {
  it("sends no package and the granted names as the keep list", async () => {
    const { sandbox, syncSkills } = fakeSandbox();

    await tidySkillRoot(sandbox, ["pdf"]);
    expect(syncSkills).toHaveBeenCalledWith([], ["pdf"]);
  });
});
