import { CATEGORIES, SUBCATEGORIES, EXPERIENCE_TAGS, type EventClassification } from "../lib/event-taxonomy";

/** Rendered only by the development QA view. */
export function ClassificationDetails({ classification }: { classification?: EventClassification }) {
  return <details className="classification-details"><summary>QA · 행사 분류</summary>
    <dl className="event-facts">
      <div><dt>대분류</dt><dd>{classification ? CATEGORIES[classification.category] : "미분류"}</dd></div>
      <div><dt>소분류</dt><dd>{classification && classification.subcategory !== "unclassified" ? SUBCATEGORIES[classification.subcategory].label : "미분류"}</dd></div>
      <div><dt>체험 방식</dt><dd>{classification?.experienceTags.map(id => EXPERIENCE_TAGS[id]).join(" · ") || "미분류"}</dd></div>
      <div><dt>분류 버전</dt><dd>{classification?.version ?? "미분류"}</dd></div>
    </dl>
  </details>;
}
