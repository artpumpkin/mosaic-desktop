// Discovery filters for the browse screen. Sort options are mapped per
// connector; genres use MangaDex's stable tag UUIDs (the built-in primary
// source). Connectors that don't understand a genre simply ignore it.

export type BrowseSort = "popular" | "latest" | "rating" | "newest";

export const SORT_OPTIONS: { id: BrowseSort; label: string }[] = [
  { id: "popular", label: "Popular" },
  { id: "latest", label: "Latest" },
  { id: "rating", label: "Top rated" },
  { id: "newest", label: "New" },
];

// MangaDex tag UUIDs (stable). label → id.
export const MANGADEX_GENRES: { label: string; id: string }[] = [
  { label: "Action", id: "391b0423-d847-456f-aff0-8b0cfc03066b" },
  { label: "Adventure", id: "87cc87cd-a395-47af-b27a-93258283bbc6" },
  { label: "Comedy", id: "4d32cc48-9f00-4cca-9b5a-a839f0764984" },
  { label: "Drama", id: "b9af3a63-f058-46de-a9a0-e0c13906197a" },
  { label: "Fantasy", id: "cdc58593-87dd-415e-bbc0-2ec27bf404cc" },
  { label: "Horror", id: "cdad7e68-1419-41dd-bdce-27753074a640" },
  { label: "Isekai", id: "ace04997-f6bd-436e-b261-779182193d3d" },
  { label: "Mystery", id: "07251805-a27e-4d59-b488-f0bfbec15168" },
  { label: "Psychological", id: "3b60b75c-a2d7-4860-ab56-05f391bb889c" },
  { label: "Romance", id: "423e2eae-a7a2-4a8b-ac03-a8351462d71d" },
  { label: "Sci-Fi", id: "256c8bd9-4904-4360-bf4f-508a76d67183" },
  { label: "Slice of Life", id: "e5301a23-ebd9-49dd-a0cb-2add944c7fe9" },
  { label: "Sports", id: "69964a64-2f90-4d33-beeb-f3ed2875eb4c" },
  { label: "Supernatural", id: "eabc5b4c-6aff-42f3-b657-3e90cbd00b75" },
];
