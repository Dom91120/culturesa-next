// Générateur Markdown → Word des deux guides CultuRésa (`pnpm gen:docs:word`).
// Sans argument : régénère docs/Guide-utilisation.docx et
// docs/Guide-administration-CultuResa.docx depuis leurs sources Markdown.
// Usage unitaire : node scripts/gen-guide-docx.cjs <guide.md> <sortie.docx> "<Titre>" "<Sous-titre>"
// Couvre exactement les constructions présentes dans ces fichiers : titres #..####,
// paragraphes (gras / code / liens / italique), listes - et 1., citations >, tableaux,
// blocs ``` , images ![..](img/..) + légende *Figure…*, séparateurs ---.
const fs = require("node:fs");
const path = require("node:path");
const {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  PageBreak,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TableOfContents,
  TextRun,
  WidthType,
} = require("docx");

const { filtrerGuideUsager } = require("./guide-usager-filter.cjs");

// Sans argument : les trois guides, avec leurs couvertures respectives. Le 5e champ
// (optionnel) est un filtre appliqué au markdown — la déclinaison USAGER est extraite
// de la même source que le guide complet.
const PRESETS = [
  [
    "docs/Guide-utilisation.md",
    "docs/Guide-utilisation.docx",
    "Guide d'utilisation",
    "Usagers, gestionnaires et administrateurs",
  ],
  [
    "docs/Guide-utilisation.md",
    "docs/Guide-usager.docx",
    "Guide de l'usager",
    "Réserver et suivre vos activités",
    filtrerGuideUsager,
  ],
  [
    "docs/Guide-administration.md",
    "docs/Guide-administration-CultuResa.docx",
    "Guide d'administration",
    "Installation serveur, base de données et sauvegarde",
  ],
];
const jobs = process.argv[2] ? [process.argv.slice(2)] : PRESETS;

async function generate([mdPath, outPath, coverTitle, coverSubtitle, filtre]) {
  const mdDir = path.dirname(path.resolve(mdPath));
  let md = fs.readFileSync(mdPath, "utf8");
  md = md.replace(/<!--[\s\S]*?-->/g, ""); // commentaires HTML (en-tête source unique)
  if (filtre) md = filtre(md);

// ── Inline : **gras**, `code`, [texte](url), *italique* ────────────────────────────
function inlineRuns(text, base = {}) {
  const runs = [];
  const re = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))|(\*([^*]+)\*)/g;
  let last = 0;
  let m = re.exec(text);
  while (m) {
    if (m.index > last) runs.push(new TextRun({ text: text.slice(last, m.index), ...base }));
    if (m[1]) runs.push(new TextRun({ text: m[2], bold: true, ...base }));
    else if (m[3]) runs.push(new TextRun({ text: m[4], font: "Consolas", ...base }));
    else if (m[5]) runs.push(new TextRun({ text: m[6], ...base })); // lien → texte seul
    else if (m[8]) runs.push(new TextRun({ text: m[9], italics: true, ...base }));
    last = m.index + m[0].length;
    m = re.exec(text);
  }
  if (last < text.length) runs.push(new TextRun({ text: text.slice(last), ...base }));
  return runs;
}

// Dimensions d'un PNG (IHDR : octets 16-23).
function pngSize(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

const children = [];
const P_SPACING = { after: 160 };

function para(text, opts = {}) {
  children.push(new Paragraph({ children: inlineRuns(text, opts.base ?? {}), spacing: P_SPACING, ...opts.p }));
}

// ── Couverture + sommaire ───────────────────────────────────────────────────────────
children.push(
  new Paragraph({ spacing: { before: 2400 } }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "CultuRésa", bold: true, size: 88, color: "1a7a4a" })],
    spacing: { after: 300 },
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "Réservation d'activités culturelles", size: 30, color: "666666" })],
    spacing: { after: 1400 },
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: coverTitle, bold: true, size: 56 })],
    spacing: { after: 300 },
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: coverSubtitle, size: 26, color: "666666" })],
    spacing: { after: 1400 },
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "Août 2026", size: 24, color: "888888" })],
  }),
  new Paragraph({ children: [new PageBreak()] }),
  new Paragraph({ children: [new TextRun({ text: "Sommaire", bold: true, size: 32 })], spacing: { after: 240 } }),
  new TableOfContents("Sommaire", { hyperlink: true, headingStyleRange: "1-2" }),
  new Paragraph({ children: [new PageBreak()] }),
);

// ── Corps ────────────────────────────────────────────────────────────────────────────
const lines = md.split(/\r?\n/);
let i = 0;
let firstH1 = true;
while (i < lines.length) {
  const line = lines[i];

  if (/^\s*$/.test(line) || /^---+\s*$/.test(line)) { i += 1; continue; }

  // Blocs de code ```
  if (/^```/.test(line)) {
    i += 1;
    const code = [];
    while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i += 1; }
    i += 1; // ``` fermant
    for (const [j, c] of code.entries()) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: c === "" ? " " : c, font: "Consolas", size: 18 })],
          shading: { type: ShadingType.CLEAR, fill: "F2F2F0" },
          spacing: { after: j === code.length - 1 ? 200 : 0 },
          indent: { left: 240 },
        }),
      );
    }
    continue;
  }

  // Titres
  const h = /^(#{1,4})\s+(.*)$/.exec(line);
  if (h) {
    const depth = h[1].length;
    const text = h[2].trim();
    if (depth === 1) {
      // Le H1 du markdown est déjà porté par la couverture — on le saute.
      if (firstH1) { firstH1 = false; i += 1; continue; }
    }
    const levels = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3];
    children.push(
      new Paragraph({
        heading: levels[depth - 1] ?? HeadingLevel.HEADING_3,
        children: inlineRuns(text),
        spacing: { before: depth <= 2 ? 360 : 240, after: 160 },
      }),
    );
    i += 1;
    continue;
  }

  // Tableaux
  if (/^\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
    const headers = line.split("|").slice(1, -1).map((s) => s.trim());
    i += 2;
    const rows = [];
    while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) {
      rows.push(lines[i].split("|").slice(1, -1).map((s) => s.trim()));
      i += 1;
    }
    // Largeur utile A4 marges 1" ; 1re colonne plus étroite (libellés courts), le
    // reste réparti — les largeurs des colonnes doivent sommer à celle du tableau.
    const totalDXA = 9360;
    const first = Math.floor(totalDXA * (headers.length > 1 ? 0.3 : 1));
    const rest = headers.length > 1 ? Math.floor((totalDXA - first) / (headers.length - 1)) : 0;
    const widths = headers.map((_, k) =>
      k === 0 ? first : k === headers.length - 1 ? totalDXA - first - rest * (headers.length - 2) : rest,
    );
    const mkCell = (text, header, k) =>
      new TableCell({
        width: { size: widths[k], type: WidthType.DXA },
        shading: header ? { type: ShadingType.CLEAR, fill: "E8F2EC" } : undefined,
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new Paragraph({ children: inlineRuns(text, header ? { bold: true } : {}) })],
      });
    children.push(
      new Table({
        columnWidths: widths,
        width: { size: totalDXA, type: WidthType.DXA },
        rows: [
          new TableRow({ tableHeader: true, children: headers.map((hd, k) => mkCell(hd, true, k)) }),
          ...rows.map((r) => new TableRow({ children: r.map((c, k) => mkCell(c, false, k)) })),
        ],
      }),
      new Paragraph({ spacing: { after: 160 } }),
    );
    continue;
  }

  // Images ![alt](img/x.png) — légende *Figure…* sur la ou les lignes suivantes.
  const img = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(line);
  if (img) {
    const file = path.resolve(mdDir, decodeURI(img[2]));
    if (fs.existsSync(file)) {
      const { w, h: ih } = pngSize(file);
      const maxW = 540;
      const scale = Math.min(1, maxW / w);
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new ImageRun({
              type: "png",
              data: fs.readFileSync(file),
              transformation: { width: Math.round(w * scale), height: Math.round(ih * scale) },
            }),
          ],
          spacing: { before: 120, after: 60 },
        }),
      );
    }
    i += 1;
    continue;
  }

  // Légende de figure (*Figure X — …*)
  if (/^\*Figure /.test(line.trim())) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: line.trim().replace(/^\*|\*$/g, ""), italics: true, size: 18, color: "666666" })],
        spacing: { after: 240 },
      }),
    );
    i += 1;
    continue;
  }

  // Citations >
  if (/^>\s?/.test(line)) {
    const quote = [];
    while (i < lines.length && /^>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^>\s?/, "")); i += 1; }
    children.push(
      new Paragraph({
        children: inlineRuns(quote.join(" ").replace(/\s+/g, " ").trim()),
        border: { left: { style: BorderStyle.SINGLE, size: 18, color: "1a7a4a", space: 8 } },
        shading: { type: ShadingType.CLEAR, fill: "F4F8F5" },
        indent: { left: 240 },
        spacing: { after: 200 },
      }),
    );
    continue;
  }

  // Listes à puces / numérotées (lignes de continuation indentées re-collées).
  const bullet = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
  if (bullet) {
    const ordered = /\d+\./.test(bullet[2]);
    let text = bullet[3];
    i += 1;
    while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s/.test(lines[i])) {
      text += ` ${lines[i].trim()}`;
      i += 1;
    }
    children.push(
      new Paragraph({
        children: inlineRuns(text),
        numbering: { reference: ordered ? "num-list" : "bullet-list", level: 0 },
        spacing: { after: 80 },
      }),
    );
    continue;
  }

  // Paragraphe : lignes contiguës re-collées.
  let text = line.trim();
  i += 1;
  while (
    i < lines.length &&
    lines[i].trim() !== "" &&
    !/^(#{1,4}\s|>|```|!\[|\||---|\s*([-*]|\d+\.)\s|\*Figure )/.test(lines[i])
  ) {
    text += ` ${lines[i].trim()}`;
    i += 1;
  }
  para(text);
}

const doc = new Document({
  creator: "CultuRésa",
  title: coverTitle,
  styles: {
    default: {
      document: { run: { font: "Calibri", size: 21 }, paragraph: { spacing: { line: 276 } } },
      heading1: { run: { size: 32, bold: true, color: "1a7a4a" } },
      heading2: { run: { size: 26, bold: true, color: "222222" } },
      heading3: { run: { size: 23, bold: true, color: "444444" } },
    },
  },
  numbering: {
    config: [
      {
        reference: "bullet-list",
        levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", style: { paragraph: { indent: { left: 480, hanging: 240 } } } }],
      },
      {
        reference: "num-list",
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", style: { paragraph: { indent: { left: 480, hanging: 240 } } } }],
      },
    ],
  },
  features: { updateFields: true },
  sections: [{ children }],
});

  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buf);
  console.log(`OK ${outPath} (${Math.round(buf.length / 1024)} Ko)`);
}

(async () => {
  for (const job of jobs) await generate(job);
})();
