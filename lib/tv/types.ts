// Schemas mirror iptv-org's public JSON at https://iptv-org.github.io/api/.
// Fields are typed loosely — iptv-org has been known to add new keys without
// notice, and we only need a subset for browsing/playback.

export type TvChannel = {
  id: string;
  name: string;
  alt_names?: string[];
  network?: string | null;
  owners?: string[];
  country: string;
  subdivision?: string | null;
  city?: string | null;
  broadcast_area?: string[];
  languages?: string[];
  categories: string[];
  launched?: string | null;
  closed?: string | null;
  replaced_by?: string | null;
  website?: string | null;
  logo?: string | null;
};

export type TvStream = {
  channel: string | null;
  feed?: string | null;
  title?: string;
  url: string;
  referrer?: string | null;
  user_agent?: string | null;
  quality?: string | null;
};

export type TvCategory = {
  id: string;
  name: string;
};

export type TvCountry = {
  code: string;
  name: string;
  languages?: string[];
  flag?: string;
};

export type TvLanguage = {
  code: string;
  name: string;
};

export type TvLogo = {
  channel: string;
  feed?: string | null;
  tags?: string[];
  width?: number;
  height?: number;
  format?: string;
  url: string;
};

export type TvDataset = {
  channels: TvChannel[];
  streams: TvStream[];
  categories: TvCategory[];
  countries: TvCountry[];
  languages: TvLanguage[];
  logos: TvLogo[];
};
