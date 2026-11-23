export type FocusSlide = {
  id: string;
  title: string;
  description: string | null;
  categoryName: string | null;
  episodeCount: number;
  coverUrl: string | null;
  sortOrder: number;
  publishedAt?: string;
};

export type HomeStory = FocusSlide & {
  categoryId: string | null;
  tags: string[];
  tagIds: string[];
};

export type TaxonomyItem = {
  id: string;
  name: string;
};

export type PublicTaxonomy = {
  categories: TaxonomyItem[];
  tags: TaxonomyItem[];
};

export type PublishedEpisode = {
  id: string;
  number: number;
  title: string;
  isFree: boolean;
  priceCredits: number | null;
};

export type DramaActor = {
  name: string;
  roleName: string | null;
};

export type DramaDetail = FocusSlide & {
  tags: string[];
  actors: DramaActor[];
  totalEpisodeCount: number | null;
  episodes: PublishedEpisode[];
};
