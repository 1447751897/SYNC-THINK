/**
 * Pure parser for docs/development/14-external-gateway-handtest.md checkboxes.
 * Soft assist only: never writes the doc, never closes M1, never includes secrets.
 */

export type HandtestDocSectionId = "pre" | "A" | "B" | "C" | "D" | "other";

export interface HandtestDocBox {
  /** 0-based order among task boxes only. */
  index: number;
  section: HandtestDocSectionId;
  sectionTitle: string;
  label: string;
  checked: boolean;
  /** 1-based source line number when available. */
  line: number;
}

export interface HandtestDocParseResult {
  checked: number;
  total: number;
  boxes: HandtestDocBox[];
  /** Always false — parsing is not evidence of M1 close. */
  claimsM1Closed: false;
  claimsDocAuthoritative: true;
}

export interface HandtestDocItemMapEntry {
  itemId: string;
  label: string;
  section: string;
  docChecked: boolean | null;
  docLabel: string | null;
  docIndex: number | null;
}

const SECTION_RULES: Array<{
  id: HandtestDocSectionId;
  re: RegExp;
  title: string;
}> = [
  { id: "pre", re: /^##\s*前置/, title: "前置" },
  { id: "A", re: /^##\s*A[.．、\s]/i, title: "A. Providers" },
  { id: "B", re: /^##\s*B[.．、\s]/i, title: "B. 多模型对话" },
  { id: "C", re: /^##\s*C[.．、\s]/i, title: "C. Fallback" },
  { id: "D", re: /^##\s*D[.．、\s]/i, title: "D. 安全与恢复" },
];

function detectSection(line: string): { id: HandtestDocSectionId; title: string } | null {
  const t = line.trim();
  for (const r of SECTION_RULES) {
    if (r.re.test(t)) return { id: r.id, title: r.title };
  }
  if (/^##\s+/.test(t)) {
    // E. 记录 etc. — not part of the 18 task boxes typically
    return { id: "other", title: t.replace(/^##\s+/, "").slice(0, 40) };
  }
  return null;
}

/**
 * Count and list `- [ ]` / `- [x]` task boxes with section context.
 */
export function parseHandtestDocMarkdown(md: string): HandtestDocParseResult {
  const text = String(md || "").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
  let section: HandtestDocSectionId = "other";
  let sectionTitle = "";
  const boxes: HandtestDocBox[] = [];
  let checked = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const sec = detectSection(line);
    if (sec) {
      section = sec.id;
      sectionTitle = sec.title;
      continue;
    }
    const m = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
    if (!m) continue;
    // Skip boxes under "other" sections that are not pre/A-D? Keep all task boxes
    // but still record section so UI can show.
    const isChecked = m[1] === "x" || m[1] === "X";
    if (isChecked) checked += 1;
    const label = String(m[2] || "")
      .replace(/\s+$/, "")
      .replace(/\*\*/g, "")
      .trim();
    boxes.push({
      index: boxes.length,
      section,
      sectionTitle,
      label,
      checked: isChecked,
      line: i + 1,
    });
  }

  return {
    checked,
    total: boxes.length,
    boxes,
    claimsM1Closed: false,
    claimsDocAuthoritative: true,
  };
}

/**
 * Map document boxes onto canonical handtest item ids by order within
 * the known 18-item catalog (when totals match). If totals differ, map by
 * sequential index only for overlapping prefix and leave the rest null.
 */
export function mapHandtestDocBoxesToItems(
  boxes: readonly HandtestDocBox[],
  itemIds: readonly { id: string; label: string; section: string }[],
): HandtestDocItemMapEntry[] {
  const list = Array.isArray(boxes) ? boxes : [];
  const defs = Array.isArray(itemIds) ? itemIds : [];
  return defs.map((def, i) => {
    const box = list[i];
    if (!box) {
      return {
        itemId: def.id,
        label: def.label,
        section: def.section,
        docChecked: null,
        docLabel: null,
        docIndex: null,
      };
    }
    return {
      itemId: def.id,
      label: def.label,
      section: def.section,
      docChecked: Boolean(box.checked),
      docLabel: box.label,
      docIndex: box.index,
    };
  });
}

/** True when text does not look like it contains API key material. */
export function handtestDocParseLooksSecretFree(text: string): boolean {
  if (!text) return true;
  if (/\bsk-[A-Za-z0-9_\-]{16,}\b/.test(text)) return false;
  if (/\bBearer\s+[A-Za-z0-9_\-\.]{20,}/i.test(text)) return false;
  if (/api[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9_\-]{12,}/i.test(text)) return false;
  return true;
}
