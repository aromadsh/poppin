/** Stable IDs for recommendation features; display genre remains free Korean text. */
export const TAXONOMY_VERSION = 1 as const;
export const CATEGORIES = {
  beauty: "뷰티", fashion: "패션", food: "음식·음료", culture_education: "문화·교육",
  entertainment: "엔터테인먼트", lifestyle: "라이프스타일", unclassified: "미분류",
} as const;
export const SUBCATEGORIES = {
  skincare: { category: "beauty", label: "스킨케어" }, makeup: { category: "beauty", label: "메이크업" }, fragrance: { category: "beauty", label: "향수" },
  clothing: { category: "fashion", label: "의류" }, bags: { category: "fashion", label: "가방" }, accessories: { category: "fashion", label: "액세서리" },
  pizza: { category: "food", label: "피자" }, dessert: { category: "food", label: "디저트" }, beverages: { category: "food", label: "음료" },
  media_education: { category: "culture_education", label: "미디어 교육" }, art: { category: "culture_education", label: "미술" }, books: { category: "culture_education", label: "도서" }, music: { category: "culture_education", label: "음악" },
  games: { category: "entertainment", label: "게임" }, characters: { category: "entertainment", label: "캐릭터" },
  home: { category: "lifestyle", label: "홈·리빙" }, stationery: { category: "lifestyle", label: "문구" }, tech: { category: "lifestyle", label: "테크" },
} as const;
export const EXPERIENCE_TAGS = {
  escape_room: "방탈출", puzzle: "퍼즐", hands_on: "참여형", product_trial: "제품 체험",
  exhibition: "전시", shopping: "쇼핑", tasting: "시식·시음", photo_zone: "포토존", workshop: "워크숍", performance: "공연",
} as const;
export type CategoryId = keyof typeof CATEGORIES;
export type SubcategoryId = keyof typeof SUBCATEGORIES | "unclassified";
export type ExperienceTag = keyof typeof EXPERIENCE_TAGS;
export type EventClassification = {
  version: typeof TAXONOMY_VERSION; category: CategoryId; subcategory: SubcategoryId;
  experienceTags: ExperienceTag[]; sourceUrls: string[];
};
export function unclassifiedEvent(): EventClassification {
  return { version: TAXONOMY_VERSION, category: "unclassified", subcategory: "unclassified", experienceTags: [], sourceUrls: [] };
}
const owns = <T extends object>(values: T, id: unknown): id is keyof T => typeof id === "string" && Object.prototype.hasOwnProperty.call(values, id);

/** Only the caller's verified search sources may support classification; no text keyword guessing. */
export function normalizeClassification(raw: unknown, resolveSource: (url: unknown) => string | null): EventClassification {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return unclassifiedEvent();
  const item = raw as Record<string, unknown>;
  if (item.version !== TAXONOMY_VERSION) return unclassifiedEvent();
  const sourceUrls = [...new Set((Array.isArray(item.sourceUrls) ? item.sourceUrls.slice(0, 6) : []).flatMap(url => {
    const resolved = resolveSource(url); return resolved ? [resolved] : [];
  }))];
  if (!sourceUrls.length) return unclassifiedEvent();
  const category = owns(CATEGORIES, item.category) ? item.category : "unclassified";
  const subcategory = owns(SUBCATEGORIES, item.subcategory) && SUBCATEGORIES[item.subcategory].category === category ? item.subcategory : "unclassified";
  const experienceTags = [...new Set((Array.isArray(item.experienceTags) ? item.experienceTags : []).filter(id => owns(EXPERIENCE_TAGS, id)))].slice(0, 5) as ExperienceTag[];
  return { version: TAXONOMY_VERSION, category, subcategory, experienceTags, sourceUrls };
}
export const classificationJsonSchema = {
  type: "object", additionalProperties: false,
  required: ["version", "category", "subcategory", "experienceTags", "sourceUrls"],
  properties: {
    version: { type: "integer", enum: [TAXONOMY_VERSION] },
    category: { type: "string", enum: Object.keys(CATEGORIES) },
    subcategory: { type: "string", enum: ["unclassified", ...Object.keys(SUBCATEGORIES)] },
    experienceTags: { type: "array", maxItems: 5, items: { type: "string", enum: Object.keys(EXPERIENCE_TAGS) } },
    sourceUrls: { type: "array", maxItems: 6, items: { type: "string" } },
  },
};
export const classificationInstructions = `Preserve the detailed Korean genre/summary independently. classification is a separate recommendation feature, not an admission or scheduling rule. Use only the fixed taxonomy IDs below, version=1. Select one main topic category and an optional child belonging to that category; do not select a child from another parent. Unknown topic or subtype must be unclassified. experienceTags are independent multi-label experience formats (up to five); a beauty popup may also be escape_room. Choose only features explicitly supported by relevant sources for this exact event; never guess from brand reputation, user preferences, input genre, or an unrelated branch. sourceUrls must be actual returned search URLs supporting the selected features. If no supported features, use unclassified/unclassified, empty tags and empty URLs. No reservation, wait time, stay duration or availability tags. Taxonomy: ${JSON.stringify({ categories: CATEGORIES, subcategories: SUBCATEGORIES, experienceTags: EXPERIENCE_TAGS })}`;
