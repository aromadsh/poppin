import type { Input } from "./planner";

const normalize = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim();
const regions: Record<string, string> = { 서울특별시: "서울", 부산광역시: "부산", 대구광역시: "대구", 인천광역시: "인천", 광주광역시: "광주", 대전광역시: "대전", 울산광역시: "울산", 세종특별자치시: "세종", 경기도: "경기", 제주특별자치도: "제주" };

/** Discovery hints only: never use these lossy tokens as proof of an address match. */
export function buildSearchPlan(input: Input) {
  const years = [...new Set([input.dateFrom.slice(0, 4), input.dateTo.slice(0, 4)])];
  return input.places.map((place, index) => {
    const name = normalize(place.name), address = normalize(place.address);
    const tokens = address.replace(/[(),]/g, " ").split(/\s+/).filter(Boolean);
    const regionHints = tokens.filter(token => regions[token] || /(?:특별시|광역시|자치시|자치도|도|시|군|구|동|읍|면|리)$/.test(token) || /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)$/.test(token)).map(token => regions[token] ?? token);
    const venueHints = tokens.filter(token => !regionHints.includes(regions[token] ?? token)
      && !/(?:대로|로|길)(?:\d+(?:번길)?)?$/.test(token)
      && !/^\d+(?:-\d+)?(?:번지|층|호|F|B)?$/i.test(token)
      && !/^(?:지하\d*층?|B\d+|\d+F)$/i.test(token));
    const region = regionHints.join(" "), venue = venueHints.join(" ");
    const query = (...parts: string[]) => parts.filter(Boolean).join(" ");
    return {
      index, originalName: place.name, originalAddress: place.address, regionHints, venueHints,
      stages: [
        { stage: "discover_by_name", queries: years.map(year => query(name, /팝업|popup/i.test(name) ? "" : "팝업", year)) },
        { stage: "narrow_by_area_or_venue", queries: [...new Set(years.flatMap(year => [query(name, region, year), ...(venue ? [query(name, venue, year)] : [])]))] },
        { stage: "verify_address", queries: [query(name, address)] },
      ],
    };
  });
}
