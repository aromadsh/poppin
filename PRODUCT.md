# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People in Korea planning a day out to one or more popup stores: fans, trend-followers, and anyone who saw a popup on social media and wants to go. They are usually on a phone, have no account with PopPin, and want to know which day, which time, and in what order to visit up to three places without reading every review themselves.

## Product Purpose

PopPin is a login-free popup planner. Given up to three popups (name, genre, address, stay length) and a visit window (up to 14 days, a daily time range), it searches the public web for event information and reviews, then computes a visit date, time slot, and route order. Success means the visitor leaves with a plan they can actually follow, and knows exactly which parts of it rest on evidence and which do not.

## Positioning

PopPin shows its work. Every recommendation links to the public source it came from, separates same-day observations from statistical estimates from unknowns, and refuses to predict when evidence is thin. A planner that fills gaps with plausible numbers cannot truthfully make this claim.

## Operating Context

- Visitors type a popup's exact name and address, pick dates and hours, and optionally describe preferences in free text.
- Analysis runs one AI web-search request on demand (often 30 to 80 seconds). There is no background monitoring, alerting, or account history.
- Results have three tabs: visit schedule, crowd evidence, and search sources. Map links open Naver Map.
- Times are Korea Standard Time. Travel between places is walking only, estimated from coordinates.

## Capabilities and Constraints

- Up to 3 places and 14 days per request. Request limits apply per IP and globally.
- Only events confirmed as running, with confirmed hours, and with reservation-free entry enter the confirmed schedule. Ended events, unconfirmed dates, venue mismatches, and missing results are each labelled distinctly.
- Wait handling order: same-day observation, then a forecast from past observations, then an unconfirmed 30-minute buffer. The 30-minute buffer is never presented as a prediction.
- Forecasts require at least 2 days and 3 observations in the matching window. Below that, no chart and no queue-onset time are shown.
- Walking estimate is straight-line distance ×1.3 at 4 km/h. Real roads and transit are not modelled.
- Place names and preferences are sent to OpenAI for analysis, and the form discloses this.

## Brand Commitments

- Name: PopPin, with the purple "pp" mark and the trailing purple period in the wordmark.
- Copy is Korean-first. Short English eyebrow taglines (for example "LESS WAITING. MORE POPPING.") are part of the voice.
- Voice is warm and plain-spoken, and honest about uncertainty: "모르는 건 모른다고."
- The current visual identity is the brand to preserve (see DESIGN.md).

## Evidence on Hand

- Real product logic and regression tests in `lib/` and `tests/`.
- The hero map and itinerary are labelled as an example, not a real event, and must stay labelled.
- No testimonials, user counts, accuracy metrics, press, or partner logos exist. Future work must not invent them.

## Product Principles

1. Never fabricate evidence. A gap is shown as a gap, with its reason.
2. Separate observation, estimate, and unknown everywhere a number appears.
3. Zero friction to start: no login, sensible defaults, one form.
4. The plan must be followable on a phone, on the street, on the day.
5. Every claim stays one tap away from its source.

## Accessibility & Inclusion

Korean-language users on mobile are the primary audience. The incumbent site already honors reduced-motion preferences, visible focus rings, a skip link, and ARIA tabs and live regions. Keep those intact.
