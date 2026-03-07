Generate one mobile web game idea based on the provided base-game context and ideation directive.

Requirements:

- Follow the provided ideation directive exactly:
  - Starter ideation directive: create one creative, single-sentence arcade-style game concept.
  - Non-starter ideation directive: create one off-the-wall, single-sentence improvement grounded in current game context.
- Ground the idea in the selected base game context.
- Return exactly one idea in a single concise sentence and no more than 30 words total.
- The game must be a 2D web game rendered in a WebGL canvas.
- The game is played on a phone and only touch interactions are available.
- Describe 2-4 concrete game entity types and the specific mechanics each one drives.
- Include a concrete game aesthetic (art direction, vibe, and setting) instead of generic visual language.
- Be explicit about player inputs and what each input does in moment-to-moment play.
- Bias toward established genres, while allowing a small chance of a more outlandish genre mashup.
- Do not suggest endless runners.
- Assume all generated game builds must start from the `games/starter` game template (see `games/starter/README.md`).
- Return only the final idea text.
