# Kiln

Kiln is a small ceramics studio that sells its own tableware and runs evening throwing classes. The brand is calm, tactile and exact: it talks like the person at the wheel, not like a shop.

## Content fundamentals

- Write in the first person plural ("we fire on Thursdays"), to one reader ("your mug").
- Sentence case everywhere, labels included; the `label` style uppercases with letter spacing, so type it in sentence case.
- Name the clay, the glaze and the firing: "Stoneware, celadon glaze, fired to cone 6", not "premium quality".
- No exclamation marks, no emoji, no urgency ("only 2 left").
- Numbers as figures: "2 hours", "12 cm".

## Visual foundations

- **Color.** Pages sit on `bone`; cards and notices on `bone-raised` with a 1px `rule` border. Text is `ink`, secondary text `ink-muted`. `clay` is the brand and the one action colour: at most one clay button per view. Text on a clay fill is `on-clay`, never white in dark. `glaze` is the second hue, for status and calm confirmations. Every text pair named in a token's usage holds 4.5:1 in both themes.
- **Type.** Headings in `display` and `title` (the serif); everything else in `body`, `small` and `label` (the sans). One `display` per page.
- **Spacing.** A 4px base, `space-1` to `space-8`. Cards pad `space-4`; sections sit `space-8` apart.
- **Shape.** Corners are small and quiet: `radius-md` for buttons and cards, `radius-sm` for tags and inputs. `radius-pill` is for status dots only.
- **Depth.** Borders, not shadows. `shadow-raised` is for menus and popovers.
- **Focus.** Every interactive element shows a 2px solid `focus` ring at a 2px offset.
- **Imagery.** The work in daylight on bone-coloured paper; no props, no stock shots of hands at the wheel.

## Iconography

- The mark (`assets/Marks/kiln-mark.svg`) is a single ink, drawn in `clay`; set it on `bone` or `bone-raised`.
- No icon font. Where an icon is needed, use a 1.5px stroke outline at 20px, in `ink`.

## Using the components

`components/bundle.js` defines `window.Kiln` with plain DOM functions (no React): `Kiln.Button`, `Kiln.Tag` and `Kiln.Notice` each return an element to append. Load `tokens.css` and `components/bundle.css` first.
