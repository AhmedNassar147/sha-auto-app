import {
  ENABLED_LETTER_LAYOUT_NAMES,
  LETTER_LAYOUT_TYPES,
} from "./constants.mjs";
import randomArrayItem from "./randomArrayItem.mjs";

/** Paused explicit choices fall back to ELEGANT; unset choices stay random. */
export default function chooseEnabledLetterLayout(preferred) {
  if (!preferred) return randomArrayItem(ENABLED_LETTER_LAYOUT_NAMES);
  return ENABLED_LETTER_LAYOUT_NAMES.includes(preferred)
    ? preferred
    : LETTER_LAYOUT_TYPES.CLINICAL;
}
