import type { ConditionId } from "../../../src/shared/tabletop.js";

/** A small picture per condition for chips and map tokens. */
export const CONDITION_ICON: Record<ConditionId, string> = {
  blinded: "🙈", charmed: "💞", deafened: "🔇", frightened: "😱", grappled: "✊", incapacitated: "💫", invisible: "👻",
  paralyzed: "⚡", petrified: "🗿", poisoned: "🤢", prone: "🛌", restrained: "⛓️", stunned: "😵", unconscious: "💤", concentration: "🔮",
};
