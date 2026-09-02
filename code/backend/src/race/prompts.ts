import type { PromptLength } from "../lobby/types";

/**
 * The prompt corpus.
 *
 * The text is chosen server-side and only revealed at `race:countdown`, so a
 * client cannot pre-type the passage before the race begins. Everything here
 * is plain ASCII with single spaces: the frontend compares characters
 * one-to-one, so smart quotes and non-breaking spaces would silently break
 * the cursor.
 */
const CORPUS: Record<PromptLength, readonly string[]> = {
  short: [
    "The keyboard is a strange instrument, quiet until you have something to say.",
    "Speed is what people notice first, but accuracy is what they remember.",
    "A race is only fair when everyone starts from the same word.",
    "Practice does not make perfect, it makes permanent, so practice carefully.",
    "Small habits compound quietly until one day they look like talent.",
  ],
  medium: [
    "Typing well is less about moving your fingers quickly and more about not stopping. The fastest typists are rarely the ones with the quickest hands; they are the ones who almost never pause to think about where a key is. Once the layout disappears from conscious thought, the words arrive at the speed you can imagine them.",
    "Every competitive skill eventually becomes a study of consistency. Anyone can produce one brilliant attempt, but a rating only respects the attempt you can repeat. This is why a single best score tells you almost nothing, while fifty ordinary scores tell you almost everything about a player.",
    "The strange thing about a race is how much of it happens before it starts. You settle your hands, you read the first few words, you decide that you are not going to look at the leaderboard until the end. Then the countdown finishes and none of your plans survive the first sentence.",
    "Software is written by people who are trying to remember what they meant last week. Names matter more than cleverness, and a boring solution that everyone understands will outlive a brilliant one that only its author can maintain. The best code reads like a explanation that happens to run.",
  ],
  long: [
    "There is a particular kind of concentration that only exists in the middle of a typing race. You are not really reading the passage, and you are not really thinking about the words either; you are somewhere in between, feeding characters forward while a small part of your mind watches the gap between you and the next player. When it goes well the whole thing feels like falling downhill. When it goes badly you become aware of individual keys again, and the moment you are aware of individual keys you have already lost half a second you will never get back. The trick, if there is one, is to keep moving through the mistakes rather than stopping to admire them, because the clock does not care how you feel about your accuracy.",
    "Measurement changes the thing it measures, which is why every skill with a number attached to it eventually grows a culture around that number. Chess has ratings, running has splits, and typing has words per minute, a unit that is not really a unit at all but a convention: five characters, counted as a word, regardless of what the characters spell. The convention survives because it is fair rather than because it is accurate. Two players typing different passages can still be compared, and comparison is the entire point. Once you accept that, the number stops being a description of you and becomes a description of a match, which is a much healthier thing to chase.",
  ],
};

export function pickPrompt(length: PromptLength): string {
  const options = CORPUS[length] ?? CORPUS.medium;
  const index = Math.floor(Math.random() * options.length);
  return options[index] ?? options[0]!;
}

/** Every prompt is normalised before it leaves the server. */
export function normalizePrompt(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}
