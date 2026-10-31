---
name: PopPin
description: Login-free popup planner that finds the right day, time, and order to visit, and shows its sources.
colors:
  violet: "#7252ca"
  violet-deep: "#5e3cb5"
  violet-focus: "#a78ae9"
  lavender-wash: "#eee8fa"
  lavender-panel: "#f0ecf8"
  paper: "#faf9f5"
  stone-card: "#f0ede6"
  ink: "#27262b"
  muted: "#6b6872"
  quiet: "#776e80"
  line: "#e6e3dc"
  field-line: "#e5e0e8"
  field-bg: "#fdfcfb"
  white: "#ffffff"
  error-bg: "#fff2ec"
  error-ink: "#994c2d"
  verified-bg: "#e9f2e6"
  verified-ink: "#637f55"
typography:
  display:
    fontFamily: "Geist, 'Pretendard Variable', Pretendard, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif"
    fontSize: "48px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-2px"
  headline:
    fontFamily: "Geist, 'Pretendard Variable', Pretendard, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif"
    fontSize: "36px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-1.5px"
  title:
    fontFamily: "Geist, 'Pretendard Variable', Pretendard, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: "28px"
  body:
    fontFamily: "Geist, 'Pretendard Variable', Pretendard, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist, 'Pretendard Variable', Pretendard, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: "16px"
    letterSpacing: "1.5px"
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  2xl: "48px"
  3xl: "64px"
  section: "96px"
components:
  button-primary:
    backgroundColor: "{colors.violet}"
    textColor: "{colors.white}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "56px"
  button-primary-hover:
    backgroundColor: "{colors.violet-deep}"
  button-secondary:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "48px"
  button-secondary-hover:
    backgroundColor: "{colors.lavender-wash}"
  nav-cta:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.white}"
    rounded: "{rounded.pill}"
    padding: "8px 12px"
  input:
    backgroundColor: "{colors.field-bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "12px"
  pill-chip:
    backgroundColor: "#f5f0fb"
    textColor: "#655c74"
    rounded: "{rounded.pill}"
    padding: "8px 12px"
  card:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.xl}"
    padding: "32px"
  summary-card:
    backgroundColor: "{colors.violet}"
    textColor: "{colors.white}"
    rounded: "{rounded.xl}"
    padding: "32px"
---

# Design System: PopPin

## Overview

**Creative North Star: "The Weekend Itinerary Card"**

PopPin looks like a day plan someone made for a friend: a warm off-white page, one violet accent that marks every pin and step, and soft rounded cards that sit slightly askew as if set down on a table. The tone is light and inviting at the top of the page, then turns calm and documentary where evidence appears. Decoration is small and specific: a tilted product card, a floating tag, a rotated stamp, numbered steps.

Density is comfortable. Sections breathe at 96px, cards pad at 32px, and type stays in one family (Geist with Pretendard for Korean). Violet carries meaning, never mood: it marks pins, numbers, actions, and confirmed state. Muted violet-greys carry everything secondary.

Honesty is visual too. Unknowns get their own calm states (dashed borders, soft lavender panels, plain sentences) instead of disappearing or being styled as errors.

**Key Characteristics:**
- Warm paper ground with white and stone cards.
- A single violet accent with lavender tints for washes and panels.
- One sans family, semibold headings with tight negative tracking.
- Soft radii from 8px to 24px, pills for chips and nav.
- Shadows are rare, diffuse, and violet-tinted.
- Small playful rotations on showcase pieces only.

## Colors

One saturated violet over warm neutrals, with lavender tints doing the quiet work.

### Primary
- **Pin Violet** (violet): Primary buttons, map pins, step numbers, timeline dots, active tabs, icon strokes, the brand mark. Also the fill of the summary card and final call-to-action band.
- **Pressed Violet** (violet-deep): Primary button hover.
- **Focus Lilac** (violet-focus): The 3px focus outline on every interactive element.

### Secondary
- **Lavender Wash** (lavender-wash): Secondary-button hover, number chips, round icon backs, selected day option.
- **Lavender Panel** (lavender-panel): The planner aside and other "how we think" side panels. Deeper lavender variants (#eee8f6, #e8e0f5) back the proof section and the honesty note.

### Neutral
- **Weekend Paper** (paper): Page background.
- **Stone Card** (stone-card): Hero product frame and how-it-works cards, a warmer step down from paper.
- **Ink** (ink): Headings and body text, and the dark nav call-to-action.
- **Muted** (muted): Section descriptions and secondary paragraphs.
- **Quiet** (quiet): Hints, disclosures, footnotes, and meta lines.
- **Hairline** (line): Card borders, dividers, the value strip rules.
- **Field Line / Field Ground** (field-line, field-bg): Form inputs.

### Status
- **Error** (error-bg, error-ink): Analysis failure messages only.
- **Verified** (verified-bg, verified-ink): The "행사 정보 확인" badge. Unverified states use a warm sand badge (#f4eee7 on #9a7f63), never red.

### Named Rules
**The One Accent Rule.** Violet is the only saturated hue on the page. Status colors are muted and appear only on badges and alerts.

**The Meaning Not Mood Rule.** Violet marks something the visitor can act on or a confirmed step. Do not use it as a decorative background wash.

## Typography

**Display Font:** Geist (Korean glyphs from Pretendard Variable, then Apple SD Gothic Neo and Malgun Gothic)
**Body Font:** Geist (same stack)

**Character:** One geometric sans throughout. Hierarchy comes from size, weight 600, and tight negative tracking on headings, while Korean glyphs fall back to Pretendard, with keep-all word breaking.

### Hierarchy
- **Display** (600, 48px, 1.25, -2px; 60px/1.15 at 1440px and up, 36px under 1050px): The hero headline only.
- **Headline** (600, 36px, 1.35, -1.5px; 30px on mobile): Section h2s.
- **Title** (600, 18px, 28px): Card and form-part headings, with an inline violet icon.
- **Body** (400, 16px, 1.5): Default text. Descriptions use 14px/24px in muted grey.
- **Label** (600, 12px, 16px, 1.5px, uppercase English): Eyebrow taglines above headings, in violet or muted grey.

### Named Rules
**The English Eyebrow Rule.** English appears only as short uppercase eyebrows and stamps. Everything a visitor must read to act is Korean.

## Layout

Content sits in a 1200px max container with 48px side gutters (32px under 1050px, 20px under 760px). Sections stack vertically with 96px rhythm (64px on mobile). Two-column grids carry the hero (1:1), planner (1.1:0.9), and schedule (1.3:0.7), collapsing to one column under 760px. The how-it-works cards run three across and stack on mobile. The header is a floating pill bar that becomes a full-screen menu on mobile. Spacing steps are 4, 8, 12, 16, 24, 32, 48, 64, 96.

## Elevation & Depth

Mostly flat, with depth from tonal layering: paper, then stone or white cards, then lavender panels. Shadows appear only on showcase pieces and the active state.

### Shadow Vocabulary
- **Product lift** (`box-shadow: 0 24px 64px #3b304311`): The tilted hero product card.
- **Floating tag** (`box-shadow: 0 8px 32px #33234413`): Small floating labels over the product card.
- **Call-to-action glow** (`box-shadow: 0 8px 24px #7252ca20`): The hero primary button.
- **Active tab** (`box-shadow: 0 2px 8px #31284208`): The selected result tab.

### Named Rules
**The Flat Workspace Rule.** The planner form, results, and evidence cards stay flat with hairline borders. Lift belongs to the showcase, not the tool.

## Shapes

Soft and friendly. Inputs and small tags use 8px, buttons 12px, inner panels 16px, and cards 24px. Chips, the header, and the nav button are full pills. Number markers and icon backs are circles. Showcase elements rotate slightly: the product card +1deg, the floating tag -5deg, the stamp +8deg. Dashed borders signal "add" or "unconfirmed" paths.

## Components

### Buttons
- **Shape:** Gently rounded (12px).
- **Primary:** Violet with white semibold text, 48px minimum height, 56px for hero and submit. Icon trails the label.
- **Hover / Focus:** Primary darkens to Pressed Violet and lifts 2px. Every button scales to 0.98 on press. Focus shows a 3px Focus Lilac outline offset 4px.
- **Secondary:** White with a hairline border and ink text at 14px. Hover fills with Lavender Wash.
- **Light:** White with violet text, used only on the violet call-to-action band.

### Chips
- **Pill:** Full-pill, pale lavender ground, lavender border, 12px muted-violet text, often with a small violet dot.
- **Tags:** 8px-radius soft grey-lilac chips for stay and wait facts on the timeline.
- **Status badge:** 8px radius, warm sand by default, soft green when verified.

### Cards / Containers
- **Corner Style:** 24px (16px on mobile).
- **Background:** White for tool cards, Stone Card for explanatory cards, Lavender Panel for side context.
- **Shadow Strategy:** None; see Elevation.
- **Border:** 1px hairline on white cards.
- **Internal Padding:** 32px desktop, 24px/16px mobile.

### Inputs / Fields
- **Style:** Near-white ground, 1px lilac-grey border, 8px radius, 12px padding, 14px text.
- **Hover:** Border shifts to a soft violet (#baabd5).
- **Labels:** 14px medium, with a small grey "필수" or "선택" marker.

### Navigation
- Floating pill header, translucent white with blur, hairline border. Links are 14px grey, violet on hover, ink and semibold when current. The ink pill call-to-action sits at the right and turns violet on hover. Mobile replaces links with a full-screen paper overlay and staggered 24px links.

### Itinerary Timeline (signature)
A dashed lilac vertical rule with violet numbered circles. Each stop shows arrival and departure time in violet, the place name at 20px, address in grey, then fact chips. Travel estimates sit below in small grey type.

### Evidence States (signature)
Missing data gets its own calm block: a lavender panel or dashed area, a muted icon, a short heading, and one plain sentence explaining why nothing is shown.

## Do's and Don'ts

### Do:
- **Do** keep violet (#7252ca) as the only saturated hue, used for actions, pins, numbers, and confirmed state.
- **Do** use the paper, stone, white, and lavender layers for depth before reaching for a shadow.
- **Do** pair every number or prediction with a label saying whether it is observed, estimated, or unknown.
- **Do** keep showcase rotations small (1 to 8 degrees) and limited to the hero and tagline stamp.
- **Do** honor reduced motion: reveals and rotations switch off under prefers-reduced-motion.

### Don't:
- **Don't** introduce a second accent hue or a new font family without a redesign decision.
- **Don't** style unknowns as errors. Red-orange is reserved for analysis failure.
- **Don't** add shadows or tilt to the planner form, results, or evidence cards.
- **Don't** put actionable instructions in English.
