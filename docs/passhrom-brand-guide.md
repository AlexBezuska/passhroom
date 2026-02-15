# Passhrom Brand Guide (Essential)

## 1) Brand snapshot
- **Product:** Passhrom — shared passwordless auth (email + magic link)
- **Vibe:** tiny mushroom guardian with a key (safe, friendly, slightly magical)
- **Visual motif:** mushroom + key + soft “glow” sparkles (used sparingly)

---

## 2) Voice & tone
**Default:** clear, calm, lightly whimsical.

**Rules**
- Use plain language first, then small whimsy (one line max).
- Never blame the user (no “you did something wrong”).
- Security copy is direct and specific (no jokes in errors).

**Microcopy patterns**
- Success: “Link sent. Check your inbox.”
- Help: “Didn’t get it? Resend in 30 seconds.”
- Security: “This link expires in 10 minutes.”

---

## 3) Logo & mark
**Primary mark:** tiny pixel art purple mushroom folk character holding a key.

**Clear space**
- Keep **1× cap-height** of clear space around the mark.

**Minimum size**
- Icon: **24px** (UI), **16px** only for dense tables/toolbars.
- Wordmark: **120px** wide minimum for readability.

**Don’t**
- Don’t stretch or skew.
- Don’t add outlines/shadows outside the icon style.
- Don’t place on busy backgrounds without a solid backing shape.

---

## 4) Color palette (core)
Use **these 6** for UI. Everything else is illustration-only.

| Token | Name | Hex | Primary use |
|---|---|---:|---|
| `--inkcap-midnight` | Inkcap Midnight | `#2D0D3C` | text, nav, outlines |
| `--potioncap-purple` | Potioncap Purple | `#7D3998` | primary brand, buttons, links |
| `--spore-mauve` | Bruised Spore Mauve | `#916686` | secondary, subtle fills |
| `--moonmilk-cream` | Moonmilk Cream | `#FEF9E3` | page background |
| `--biscuit-mycelium` | Biscuit Mycelium | `#CBBEA9` | borders, dividers |
| `--keyglow-gold` | Keyglow Gold | `#F9D34D` | accent / highlights (rare) |

**Usage rules**
- Default text: `Inkcap Midnight` on `Moonmilk Cream`.
- Primary CTA: `Potioncap Purple` background + `Moonmilk Cream` text.
- Accent (`Keyglow Gold`) is **<5%** of UI area (badges, small highlights).

**CSS tokens**
```css
:root{
  --inkcap-midnight:#2D0D3C;
  --potioncap-purple:#7D3998;
  --spore-mauve:#916686;
  --moonmilk-cream:#FEF9E3;
  --biscuit-mycelium:#CBBEA9;
  --keyglow-gold:#F9D34D;

  --bg:var(--moonmilk-cream);
  --text:var(--inkcap-midnight);
  --primary:var(--potioncap-purple);
  --primary-2:var(--spore-mauve);
  --border:var(--biscuit-mycelium);
  --accent:var(--keyglow-gold);
}
```

---

## 5) Typography
- **UI font (recommended):** Inter (or system UI fallback)
- **Display/brand (optional):** Fredoka (for headings/marketing only)

**Rules**
- Body: 16px minimum, 1.5 line-height.
- Headings: sentence case; avoid all-caps for readability.
- Numbers/tokens: use tabular numbers if available.

---

## 6) UI basics
**Buttons**
- Primary: purple fill, cream text, 8–12px radius.
- Secondary: cream fill, purple text, biscuit border.

**Inputs**
- 1px border `Biscuit Mycelium`
- Focus ring: `Potioncap Purple` (2px) + subtle outer glow if desired.

**States**
- Error: use **Inkcap Midnight + plain copy** (no jokes). If you add red later, keep it muted and accessible.
- Disabled: reduce contrast by ~40% and remove glow/accent.

---

## 7) Illustration & icons
- **Icon style:** pixel-friendly, crisp silhouettes, minimal dithering.
- **Sparkles/glow:** allowed for hero art, not for core UI chrome.
- **Backgrounds:** keep flat or very subtle gradients; avoid heavy texture behind text.

**Optional illustration-only colors (not for UI tokens)**
- Fairy Dust Lavender `#DDACCC`
- Cheeky Pixie Pink `#F3BCCB`
- Will-o’-Wisp Mint `#00F8E0`
- Spritegrass Green `#00D028`

---

## 8) Accessibility (must)
- Maintain readable contrast (especially purple-on-cream).
- Focus indicators are required for keyboard users.
- Icons must have text labels or accessible names (aria-label/title).
- Error messages: state what happened + what to do next.

---

## 9) Quick do / don’t
**Do**
- Use the mushroom+key as the recognizable anchor.
- Keep screens calm: lots of whitespace, simple hierarchy.
- Keep security flows predictable and consistent.

**Don’t**
- Don’t use more than **one** accent moment per screen.
- Don’t add novelty copy to error/security states.
- Don’t introduce new colors without updating this guide.
