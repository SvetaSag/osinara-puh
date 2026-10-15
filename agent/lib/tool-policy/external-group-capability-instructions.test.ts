/**
 * External-group capability instruction tests.
 *
 * Constructs covered:
 * - `externalGroupCapabilityInstructions`: binds the group to the tools sent with the request and the
 *   skills of the Available skills section, without listing either again.
 * - Delegation is described only when the application core is issued.
 */
import { describe, expect, it } from "vitest";

import { externalGroupCapabilityInstructions } from "./external-group-capability-instructions.js";

describe("externalGroupCapabilityInstructions", () => {
  it("binds the turn to the tools and skills it was given without listing them again", () => {
    // The tool definitions and the skills section already reach the model; a second list cost about
    // 4,800 characters in every request of a fully granted group.
    const markdown = externalGroupCapabilityInstructions({ includeApplicationCore: true });

    expect(markdown).toContain("<external_group_capabilities>");
    expect(markdown).toMatch(/только те инструменты, которые переданы в этом запросе/u);
    expect(markdown).toMatch(/Available skills/u);
    expect(markdown).toMatch(/не вызывай, не предлагай и не утверждай/iu);
    expect(markdown).not.toMatch(/`[a-z_]+`/u);
    expect(markdown).not.toMatch(/[—–«»]/u);
  });

  it("describes delegation only when the application core is issued", () => {
    expect(externalGroupCapabilityInstructions({ includeApplicationCore: true })).toContain("делегировать");
    expect(externalGroupCapabilityInstructions({ includeApplicationCore: false })).not.toContain("делегировать");
  });

  it("keeps a granted skill from carrying someone else's authorization", () => {
    expect(externalGroupCapabilityInstructions({ includeApplicationCore: false }))
      .toContain("Разрешённый скилл не предоставляет чужую авторизацию");
  });
});
