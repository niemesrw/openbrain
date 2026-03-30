# Design System: Remix of OpenBrain
**Project ID:** `5269867641035129681`
**Theme Name:** The Synaptic Interface
**Creative North Star:** "The Cognitive Ether"

---

## 1. Visual Theme & Atmosphere

The Synaptic Interface rejects the boxed-in feeling of traditional app UI. It is designed to feel less like software and more like an extension of thought — a dark, limitless digital canvas where information floats in layered depth rather than inside rigid containers.

The mood is **Dense, Atmospheric, and Editorial**: heavy on darkness, precise in typography, with electric cyan (`#00e3fd`) used sparingly as a bioluminescent accent that draws the eye like a signal firing across a neural network. There are no dividing lines — sections emerge from tonal shifts in background. The experience is intentionally "expensive" in its use of whitespace, treating breathing room as intelligence.

---

## 2. Color Palette & Roles

### Surfaces (The Obsidian Stack)
| Token | Hex | Role |
|-------|-----|------|
| `surface` / `background` | `#0e0e0e` | Base canvas — the void |
| `surface-container-lowest` | `#000000` | Deep backdrop for maximum accent contrast |
| `surface-container-low` | `#131313` | Secondary section backgrounds, card hover state |
| `surface-container` | `#1a1a1a` | Primary interactive containers, message bubbles |
| `surface-container-high` | `#20201f` | Elevated containers, hovered ghost buttons |
| `surface-container-highest` | `#262626` | Floating elements, command palettes, modals |
| `surface-bright` | `#2c2c2c` | Active/selected states |
| `surface-variant` | `#262626` | Glassmorphism base (at 60% opacity) |

### Brand Colors
| Token | Hex | Role |
|-------|-----|------|
| `primary` | `#9aa8ff` | Primary actions, active nav items, gradient start |
| `primary-container` | `#8c9bf3` | Gradient end for primary CTAs |
| `primary-dim` | `#8998f0` | Pressed/dimmed primary state |
| `on-primary` | `#122479` | Text on primary-colored surfaces |
| `secondary` | `#00e3fd` | Neural glow accent — the "spark of insight." Used for active states, glows, and bottom-line search indicators |
| `secondary-dim` | `#00d4ec` | Slightly muted secondary for active neural nodes |
| `secondary-container` | `#006875` | Tag/chip background |
| `on-secondary-container` | `#e8fbff` | Text on tag chips |
| `tertiary` | `#a68cff` | Soft violet accent for supporting highlights |
| `tertiary-container` | `#7c4dff` | Vibrant tertiary for special badges |

### Text
| Token | Hex | Role |
|-------|-----|------|
| `on-surface` | `#ffffff` | Primary text — never pure #fff for body, use sparingly |
| `on-surface-variant` | `#adaaaa` | Secondary text, metadata, captions — warm mid-grey |
| `outline` | `#767575` | Divider-substitute when absolutely needed |
| `outline-variant` | `#484847` | Ghost borders at 15% opacity only |

### Feedback
| Token | Hex | Role |
|-------|-----|------|
| `error` | `#ff6e84` | Error states |
| `error-container` | `#a70138` | Error backgrounds |

---

## 3. Typography Rules

Three fonts form a strict hierarchy — each with a defined personality:

### Headlines & Display — Space Grotesk
- Used for screen titles, section headers, large data values
- Weight: **Bold (700)** for display, **SemiBold (600)** for section headers
- Tracking: tight (`-0.02em`) — gives a precision-engineered, editorial feel
- Never use for body copy — it loses legibility at small sizes

### Body & Titles — Inter
- The invisible workhorse. Used for all body text, thought content, form inputs, list items
- Weight: Regular (400) for body, Medium (500) for labels and titles
- Size: 0.875rem (14px) for dense data results; 1rem (16px) for readable body
- Line height: 1.5 for comfortable reading

### Metadata & Labels — Manrope
- Used for timestamps, type badges, vector IDs, technical secondary info
- Weight: Medium (500)
- Size: 0.75rem (12px)
- Slightly wider feel than Inter — adds a modern "tech" character to small text

---

## 4. Component Styling

### Buttons
- **Primary CTA:** Gradient fill from `primary` (#9aa8ff) to `primary-container` (#8c9bf3) at 135°. Corner radius 6px (0.375rem). No border. White text (Space Grotesk, SemiBold).
- **Secondary / "Neural" Button:** Ghost style — transparent background, `outline-variant` (#484847) border at 20% opacity. On hover: background shifts to `surface-container-high`. Text in `primary`.
- **Tertiary / Text Button:** Text-only in `primary`. No container, no border.
- **Destructive:** `error` (#ff6e84) text on transparent or `error-container` background.

### Cards & Containers
- **No 1px borders** — define card edges via background tonal shift (e.g. `surface-container` on `surface-container-low`)
- Corner radius: 6px (0.375rem) standard; 8px (0.5rem) for larger floating panels
- Hover state: background shifts one step up the Obsidian Stack
- **Ghost Border fallback** (accessibility only): `outline-variant` (#484847) at 15% opacity

### Input Fields / Search Bar
- Background: `surface-container-low` (#131313). No border ring.
- Active state: bottom-only accent line using `secondary` (#00e3fd) glow gradient
- Placeholder text: `on-surface-variant` (#adaaaa)
- Input text: `on-surface` (#ffffff), Inter, title-weight — makes user's input feel significant
- Corner radius: 6px

### Type/Tag Chips
- Background: `secondary-container` (#006875)
- Text: `on-secondary-container` (#e8fbff), Manrope, 12px
- Shape: Pill / fully rounded (`border-radius: 9999px`)
- No border

### Tab Bar / Bottom Navigation
- Background: `surface-container` (#1a1a1a) with glassmorphism (`backdrop-filter: blur(24px)`)
- Active icon: `secondary` (#00e3fd) or `primary` (#9aa8ff)
- Inactive icon + label: `on-surface-variant` (#adaaaa)
- Labels: Manrope, 10–11px

### List Rows / Thought Cards
- **No dividers between rows** — separate with 1rem vertical whitespace only
- Background: transparent on `surface`; shifts to `surface-container-low` on hover
- Type icon: colored per thought type (use `primary` / `secondary` / `tertiary` family)
- Body text: Inter, 14px, `on-surface` (#ffffff), 4-line clamp
- Metadata: Manrope, 12px, `on-surface-variant` (#adaaaa)

---

## 5. Elevation & Depth

Traditional drop shadows are **forbidden**. Depth is achieved through tonal layering:

- **Floating elements** (modals, command palettes): `surface-container-highest` (#262626) fill + ambient shadow: `box-shadow: 0 0 32px 0 rgba(154, 168, 255, 0.08)` (primary-tinted, 8% opacity)
- **Glassmorphism panels** (navbars, overlays): `rgba(26, 26, 26, 0.6)` + `backdrop-filter: blur(24px)`
- **Neural glow** (active thoughts, selected nodes): `box-shadow: 0 0 20px rgba(0, 227, 253, 0.15)` — the `secondary` (#00e3fd) bioluminescent pulse

---

## 6. Layout Principles

- **Grid:** 8pt base grid. All spacing in multiples of 8px (or 4px for tight sub-elements).
- **Section breathing room:** 48px (spacing-12) to 64px (spacing-16) between major sections — "wasteful" space signals intelligence.
- **Tight grouping:** 4px (spacing-1) within a data cluster (e.g. icon + label).
- **Content padding:** 16–24px horizontal page margins on mobile.
- **Asymmetry:** In dashboards and feeds, offset text groups intentionally — avoids the "template" look.
- **Min height:** `max(884px, 100dvh)` — ensures the canvas always fills the viewport.

---

## 7. SwiftUI & iOS Implementation Notes

For applying this design to the iOS/macOS SwiftUI app:

### Colors
Define all tokens as `Color` extensions or a `ColorTheme` struct:
```swift
// Surfaces
static let surface = Color(hex: "#0e0e0e")
static let surfaceContainerLow = Color(hex: "#131313")
static let surfaceContainer = Color(hex: "#1a1a1a")
static let surfaceContainerHigh = Color(hex: "#20201f")
static let surfaceContainerHighest = Color(hex: "#262626")

// Brand
static let primary = Color(hex: "#9aa8ff")
static let primaryContainer = Color(hex: "#8c9bf3")
static let secondary = Color(hex: "#00e3fd")       // Neural glow accent
static let secondaryContainer = Color(hex: "#006875")
static let tertiary = Color(hex: "#a68cff")

// Text
static let onSurface = Color(hex: "#ffffff")
static let onSurfaceVariant = Color(hex: "#adaaaa")
```

### Fonts
Space Grotesk and Manrope must be added as custom fonts. Inter is available as a system font on Apple platforms (San Francisco is acceptable substitute if custom fonts aren't bundled).

### No Dividers
Replace `Divider()` calls with `Spacer().frame(height: 1)` backed by background color shifts. Use `.listRowBackground(Color.surfaceContainerLow)` and `.listStyle(.plain)` to eliminate default list chrome.

### Glassmorphism
Use `.background(.ultraThinMaterial)` with a custom tint overlay for the tab bar and floating panels.

### Neural Glow
Achieved in SwiftUI with:
```swift
.shadow(color: Color(hex: "#00e3fd").opacity(0.15), radius: 10, x: 0, y: 0)
```

---

## 8. Do's and Don'ts

### Do
- Use `surface-container-low` background shifts to separate sections — never lines
- Use `secondary` (#00e3fd) sparingly as a "live wire" accent only for active/selected states
- Apply glassmorphism to navbars and overlays so the dark canvas shows through
- Give data generous breathing room — spacing is a signal of quality
- Use tight tracking (-0.02em) on Space Grotesk headlines

### Don't
- Don't use `#ffffff` for body text — use `on-surface-variant` (#adaaaa) for secondary content
- Don't add 1px borders between list items or sections
- Don't use sharp corners — minimum 6px radius everywhere
- Don't use opaque drop shadows — use glow or tonal lift instead
- Don't use colorful backgrounds — keep surfaces in the Obsidian Stack; let accents do the work
