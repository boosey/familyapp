/**
 * Shared fake content for /dev/prototypes/* — not wired to the DB.
 * Production pages under /dev return 404 when NODE_ENV=production.
 */

export const PROTO_FAMILY = "Boudreaux";

export const PROTO_STORIES = [
  {
    id: "kitchen-radio",
    title: "The kitchen radio that never turned off",
    narrator: "Eleanor",
    year: "1968",
    place: "New Orleans",
    duration: "4:12",
    recorded: "JUN 2026",
    excerpt:
      "Mama kept WWOZ going from the minute the coffee percolated until the last light went out. Even when nobody was talking, the house had a voice.",
    body: [
      "Mama kept WWOZ going from the minute the coffee percolated until the last light went out. Even when nobody was talking, the house had a voice.",
      "I'd come home from school and find her at the sink, humming along to something old, soap up to her elbows. She'd nod at me like the music had already said hello.",
      "Years later I still can't cook without a radio somewhere. Silence in a kitchen feels like the family's gone out for a walk.",
    ],
    tone: "warm" as const,
  },
  {
    id: "first-car",
    title: "Daddy's first car, and the dent we never fixed",
    narrator: "Sofia",
    year: "1984",
    place: "Metairie",
    duration: "6:40",
    recorded: "MAY 2026",
    excerpt:
      "It was a blue Buick with a passenger door that stuck when it rained. He said the dent was a reminder not to rush love — or parking.",
    body: [
      "It was a blue Buick with a passenger door that stuck when it rained. He said the dent was a reminder not to rush love — or parking.",
      "We took that car to every Sunday dinner for years. The seat fabric smelled like peppermints and motor oil.",
      "When they finally sold it, he kept the key on a nail in the garage. Still there.",
    ],
    tone: "cool" as const,
  },
  {
    id: "porch-storm",
    title: "Waiting out the storm on Grandmère's porch",
    narrator: "Marcus",
    year: "1992",
    place: "Lafayette",
    duration: "3:28",
    recorded: "APR 2026",
    excerpt:
      "The sky went green and she handed us sweet tea like it was armor. We counted the seconds between lightning and thunder.",
    body: [
      "The sky went green and she handed us sweet tea like it was armor. We counted the seconds between lightning and thunder.",
      "She told the same story every storm: the year the pecan tree split, and how the family ate pie for a week from the fallen nuts.",
      "I still count when it rains hard. Habit, or prayer — I'm not sure which.",
    ],
    tone: "deep" as const,
  },
] as const;

export type ProtoStory = (typeof PROTO_STORIES)[number];

export function getProtoStory(id: string): ProtoStory | undefined {
  return PROTO_STORIES.find((s) => s.id === id);
}

export const PROTO_TABS = [
  { key: "stories", label: "Stories" },
  { key: "album", label: "Album" },
  { key: "family", label: "Family" },
] as const;
