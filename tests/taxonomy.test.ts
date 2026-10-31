import test from "node:test";
import assert from "node:assert/strict";
import { normalizeClassification, unclassifiedEvent, classificationJsonSchema, SUBCATEGORIES } from "../lib/event-taxonomy";

const url = "https://example.com/event";
const supported = (value: unknown) => value === url ? url : null;
const claim = (extra: Record<string, unknown> = {}) => ({ version: 1, category: "beauty", subcategory: "skincare", experienceTags: ["product_trial"], sourceUrls: [url], ...extra });

test("고정 분류는 대소분류와 체험 방식을 독립적으로 보존한다", () => {
  assert.equal(normalizeClassification(claim(), supported).subcategory, "skincare");
  const hybrid = normalizeClassification(claim({ experienceTags: ["escape_room", "puzzle", "product_trial"] }), supported);
  assert.equal(hybrid.category, "beauty");
  assert.deepEqual(hybrid.experienceTags, ["escape_room", "puzzle", "product_trial"]);
  const education = normalizeClassification(claim({ category: "culture_education", subcategory: "media_education", experienceTags: ["escape_room", "puzzle", "hands_on"] }), supported);
  assert.equal(education.subcategory, "media_education");
});

test("다른 부모의 소분류·새 ID·운영 조건 태그를 임의로 채택하지 않는다", () => {
  const result = normalizeClassification(claim({ subcategory: "pizza", experienceTags: ["product_trial", "product_trial", "reservation_required", "wait_30", "unknown_tag"] }), supported);
  assert.equal(result.category, "beauty");
  assert.equal(result.subcategory, "unclassified");
  assert.deepEqual(result.experienceTags, ["product_trial"]);
  assert.equal(normalizeClassification(claim({ category: "new_category" }), supported).category, "unclassified");
  assert.equal(normalizeClassification(claim({ category: "__proto__", subcategory: "constructor" }), supported).subcategory, "unclassified");
});

test("출처 미확인·구버전·누락 분류는 장르 문자열로 추론하지 않고 미분류로 둔다", () => {
  for (const raw of [undefined, null, "뷰티 스킨케어", [], claim({ version: 2 }), claim({ sourceUrls: [] }), claim({ sourceUrls: ["https://invented.example/event"] })]) {
    assert.deepEqual(normalizeClassification(raw, supported), unclassifiedEvent());
  }
  assert.deepEqual(normalizeClassification(claim(), () => null), unclassifiedEvent());
});

test("응답 스키마는 버전과 고정 목록을 요구하고 소분류 부모가 실제 대분류에 속한다", () => {
  assert.equal(classificationJsonSchema.additionalProperties, false);
  assert.deepEqual(classificationJsonSchema.properties.version.enum, [1]);
  for (const child of Object.values(SUBCATEGORIES)) assert.ok(classificationJsonSchema.properties.category.enum.includes(child.category));
});
