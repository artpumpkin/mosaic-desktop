// Audius chart dimensions — the music analogue of podcasts/charts.ts. The
// trending endpoints accept a `genre` (exact display name) and a `time` window,
// which together give the Music tab its different charts.

export type AudiusGenre = { id: string; name: string };
export type AudiusTimeRange = { id: string; name: string };

// Top-level Audius genres (exact strings the trending API expects).
export const AUDIUS_GENRES: AudiusGenre[] = [
  { id: "Electronic", name: "Electronic" },
  { id: "Hip-Hop/Rap", name: "Hip-Hop/Rap" },
  { id: "Pop", name: "Pop" },
  { id: "Rock", name: "Rock" },
  { id: "Alternative", name: "Alternative" },
  { id: "R&B/Soul", name: "R&B/Soul" },
  { id: "Metal", name: "Metal" },
  { id: "Punk", name: "Punk" },
  { id: "Folk", name: "Folk" },
  { id: "Jazz", name: "Jazz" },
  { id: "Ambient", name: "Ambient" },
  { id: "Classical", name: "Classical" },
  { id: "Country", name: "Country" },
  { id: "Reggae", name: "Reggae" },
  { id: "Blues", name: "Blues" },
  { id: "Funk", name: "Funk" },
  { id: "Latin", name: "Latin" },
  { id: "World", name: "World" },
  { id: "Experimental", name: "Experimental" },
  { id: "Lo-Fi", name: "Lo-Fi" },
  { id: "Hyperpop", name: "Hyperpop" },
  { id: "Dancehall", name: "Dancehall" },
  { id: "Soundtrack", name: "Soundtrack" },
  { id: "Acoustic", name: "Acoustic" },
];

// Trending time windows.
export const AUDIUS_TIME_RANGES: AudiusTimeRange[] = [
  { id: "week", name: "This Week" },
  { id: "month", name: "This Month" },
  { id: "year", name: "This Year" },
  { id: "allTime", name: "All Time" },
];

// Curated genres surfaced as home rails (besides overall Trending).
export const HOME_GENRE_IDS = ["Electronic", "Hip-Hop/Rap", "Pop", "Rock"];
