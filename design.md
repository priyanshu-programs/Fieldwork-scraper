# Fieldwork design rules

Fieldwork is an app screen, not a marketing page: task controls and a source ledger come first.

**Look.** Warm near-black surfaces, pale ink and the Outfit font with a system fallback. Gold is reserved for active navigation, primary actions and hairline borders; success is green. Medium-weight headings, 14px radii, translucent gold-tinted panels and a soft amber glow. Colours and spacing come from the role tokens in `tokens.css`, with a fixed type scale. Tables are flat. No decorative backgrounds, stock images, marketing metrics or sidebar.

**Structure.** Two destinations: Collect and History. Date and time labels say IST. Loading, empty, error and full states must all work.

**Access.** Forms and fetched content keep visible focus and readable borders, and Markdown is rendered safely. Layouts must work at desktop width and at 375px on a phone.

**Motion.** Motion only gives feedback about state, and every animation respects reduced-motion settings.

**Data.** Show real data only. Never simulate an operation that did not happen.
