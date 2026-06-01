# TruNorth email signature mockups

Four signature styles for Aron Rosenfield. All PNGs are 600px wide and render crisply in Gmail, Outlook, and Apple Mail on both desktop and mobile.

## The four styles

| File | Style | Best for |
|---|---|---|
| `signature-1.png` | **Minimal horizontal** — black-on-white, vertical divider, contact info on a single line below | Daily use. Most universal, looks clean in every client. Safe default if unsure. |
| `signature-2.png` | **Brand dark card** — dark `#0f0f0f` background, white name + brand-purple accent line, contact in violet/light-purple | Investor / partnership outreach, press, BD intros. Makes you memorable in a crowded inbox. |
| `signature-3.png` | **Pill / badge** — info on the right with each contact rendered as a rounded purple pill (`email` / `web`) | Founder-y, indie-startup feel. Good for warm intros, community / Indie Hackers / Twitter DMs that get forwarded. |
| `signature-4.png` | **Tall card** — logo centered top, violet divider, contact rows with glyphs, location line | Newsletter sign-offs, longer-form / personal essays, sales pitches where you want extra real-estate. |

## How to install (Gmail)

1. Upload the chosen PNG to a public host (or embed inline via Gmail's signature editor — drag-and-drop the file).
2. Settings → See all settings → General → Signature → Create new.
3. Click the insert-image icon, upload the PNG, set size to "Original" (600px).
4. Save changes. Test by composing a draft to yourself.

## How to install (Apple Mail)

1. Mail → Settings → Signatures → `+` to add a new signature.
2. Drag the PNG into the signature pane.
3. Uncheck "Always match my default message font" so the image stays at native size.

## How to install (Outlook desktop / web)

1. File → Options → Mail → Signatures (desktop) or Settings → Mail → Compose and reply (web).
2. Insert image, choose the PNG.
3. Save.

## Notes

- Email is `Aron@trunorth.com`. To regenerate (e.g. if the address changes again), update the `EMAIL` constant in `/tmp/gen_signatures.py` and run `python3 /tmp/gen_signatures.py`.
- Logo is sourced from `public/apple-touch-icon.png` and downscaled to 80px.
- Source script: `/tmp/gen_signatures.py` (can be moved into the repo if you want it version-controlled).
