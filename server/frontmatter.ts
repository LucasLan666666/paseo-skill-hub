export interface SkillDoc {
  name?: string;
  description?: string;
  /** Markdown after the frontmatter block. */
  body: string;
}

const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Reads `name` and `description` from SKILL.md frontmatter; enough YAML for skill headers. */
export function parseSkillDoc(text: string): SkillDoc {
  const source = text.replace(/^\uFEFF/, "");
  const match = FRONTMATTER.exec(source);
  if (!match) return { body: source, description: firstParagraph(source) };
  const meta = parseFields(match[1]);
  const body = source.slice(match[0].length);
  return {
    name: meta.name || undefined,
    description: meta.description || firstParagraph(body),
    body,
  };
}

function parseFields(block: string): Record<string, string> {
  const lines = block.split(/\r?\n/);
  const fields: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const field = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(lines[i]);
    if (!field) continue;
    let value = field[2].trim();
    const continues = () => i + 1 < lines.length && /^[ \t]+\S|^[ \t]*$/.test(lines[i + 1]);
    if (/^[|>][+-]?\d*$/.test(value)) {
      const parts: string[] = [];
      while (continues()) parts.push(lines[++i].trim());
      value = parts.join(value.startsWith(">") ? " " : "\n").trim();
    } else if (/^".*"$/.test(value)) {
      value = value.slice(1, -1).replace(/\\(["\\])/g, "$1").replace(/\\n/g, "\n");
    } else if (/^'.*'$/.test(value)) {
      value = value.slice(1, -1).replace(/''/g, "'");
    } else {
      while (i + 1 < lines.length && /^[ \t]+\S/.test(lines[i + 1])) value += ` ${lines[++i].trim()}`;
    }
    fields[field[1]] = value;
  }
  return fields;
}

function firstParagraph(body: string): string {
  let fenced = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("```")) fenced = !fenced;
    if (fenced || !line || line.startsWith("#") || line.startsWith("```")) continue;
    return line.length > 300 ? `${line.slice(0, 297)}...` : line;
  }
  return "";
}
