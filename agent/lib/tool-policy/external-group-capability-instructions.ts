/**
 * External-group capability instructions.
 *
 * Export:
 * - `externalGroupCapabilityInstructions`: binds the turn to the tools sent with its request and the
 *   skills of its Available skills section.
 * - `ExternalGroupCapabilityInstructionOptions`: whether the application core (delegation) is issued.
 *
 * The exact surface is the tool set of the request itself: the runtime sends only the descriptors
 * this group may execute, and the skills section lists only its granted skills. Listing them again
 * here cost about 4,800 characters in every request of a fully granted group.
 */
export interface ExternalGroupCapabilityInstructionOptions {
  includeApplicationCore: boolean;
}

export function externalGroupCapabilityInstructions(options: ExternalGroupCapabilityInstructionOptions): string {
  return [
    "<external_group_capabilities>",
    "# Возможности текущей внешней группы",
    "",
    "В этом ходе тебе доступны только те инструменты, которые переданы в этом запросе, и только скиллы из раздела Available skills. Не вызывай, не предлагай и не утверждай, что можешь использовать что-то сверх них. Ограничения, записанные в описании и схеме инструмента, тоже часть разрешения: например, разрешённое действие не разрешает соседние.",
    ...(options.includeApplicationCore
      ? ["", "Основной агент может делегировать сложную часть подзадачей; дочерний агент получает те же границы данных и разрешения, но не делегирует повторно и не сохраняет долговременную память."]
      : []),
    "",
    "Разрешённый скилл не предоставляет чужую авторизацию. Если ему нужно внешнее подключение, которого здесь нет, сообщи об этом; личные и семейные подключения в группу не передаются.",
    "</external_group_capabilities>",
  ].join("\n");
}
