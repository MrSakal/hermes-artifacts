# Doc artifacts

A document people read, edit and export to Word (.docx), PDF, Markdown or HTML: reports, plans, memos,
specs, briefs. Editing shows the Markdown beside a live preview.

## Files (`artifact_publish type=doc files={...}`)

- `doc.md`: the document in Markdown. Its first `# Heading` is its title.
- Images it names by relative path (`![Site plan](img/site.png)`), as files of the artifact.

Supported:
- headings, paragraphs, horizontal rules;
- **bold**, *italic*, ~~strike~~, `code`, links, images;
- ordered, bullet and task lists, nested by indenting;
- block quotes and fenced code;
- GFM tables, with alignment.

Raw HTML shows as text.

## Writing

Lead with the point and keep one idea per paragraph. Headings say what the section concludes. Use
tables for comparisons and lists only for parallel items. Write in the user's language.

## Changing it

The user may have edited it, so `artifact_read` first. Then republish with the same `id` and
`files={"doc.md": ...}`, passing the whole text.
