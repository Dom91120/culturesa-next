// AUTO-GÉNÉRÉ depuis test/public/js/app.js (ancienne version PHP) — ne pas éditer à la main.
// Régénérer : node scripts/extract-legacy-icons.cjs

export type IconCategory = { label: string; icons: string[] };

export const ICON_CATEGORIES: IconCategory[] = [
  {
    label: "Sport & Mouvement",
    icons: [
      "🏃",
      "🏋️",
      "🤸",
      "🚴",
      "⛹️",
      "🧘",
      "💃",
      "🕺",
      "🏊",
      "🤽",
      "⚽",
      "🏀",
      "🎾",
      "🏸",
      "🎿",
      "🏄",
      "🤾",
      "🏐",
    ],
  },
  {
    label: "Musique",
    icons: ["🎵", "🎶", "🎼", "🎸", "🎹", "🎺", "🎻", "🥁", "🎤", "🎙️", "🎧", "🪗", "🪘", "🪕"],
  },
  {
    label: "Arts & Création",
    icons: ["🎨", "🖌️", "✏️", "🖊️", "🖼️", "🗿", "🏺", "✂️", "📐", "🧵", "🪡", "🧶", "🖶"],
  },
  { label: "Scène & Spectacle", icons: ["🎭", "🎬", "🎪", "🎠", "🤹", "🎟️", "🎞️"] },
  { label: "Cuisine", icons: ["🍳", "👨‍🍳", "🥐", "🍰", "🧁", "🫕", "🥘", "🍽️", "🧑‍🍳"] },
  { label: "Photo & Vidéo", icons: ["📷", "📸", "🤳", "🎥", "🎞️", "📹"] },
  { label: "Numérique", icons: ["💻", "🖥️", "⌨️", "🖱️", "🤖", "⚙️", "📱"] },
  { label: "Langues & Lecture", icons: ["📖", "📚", "📕", "🔖", "🌍", "🗣️", "✍️", "📝"] },
  { label: "Nature & Jardin", icons: ["🌱", "🌻", "🪴", "🌿", "🌳", "🍃", "♻️", "🌸", "🌺", "🦋"] },
  { label: "Culture & Patrimoine", icons: ["🏛️", "🗺️", "🎫", "🔭", "🏺", "⛪", "🏰", "🗽"] },
  { label: "Sciences & Atelier", icons: ["🔬", "🧪", "⚗️", "🔧", "🛠️", "🧰", "💡", "🧲", "🔩"] },
  {
    label: "Enfance",
    icons: [
      "🧸",
      "🪀",
      "🪁",
      "🎠",
      "🎡",
      "🎢",
      "🎪",
      "🎈",
      "🎉",
      "🪄",
      "🧩",
      "🎮",
      "🪆",
      "🏰",
      "🌈",
      "🧁",
      "🍭",
      "🦄",
      "🐣",
      "🐥",
    ],
  },
  {
    label: "Bâtiments",
    icons: [
      "🏛️",
      "🏰",
      "🏯",
      "⛪",
      "🕌",
      "🕍",
      "🛕",
      "🏗️",
      "🏢",
      "🏬",
      "🏪",
      "🏫",
      "🏩",
      "🏥",
      "🏦",
      "🏨",
      "🏤",
      "🏣",
      "🏟️",
      "🗼",
      "🗽",
      "🗿",
      "⛩️",
      "🏠",
      "🏡",
      "🏚️",
    ],
  },
  {
    label: "Divers",
    icons: [
      "📌",
      "🎯",
      "⭐",
      "🔷",
      "🏷️",
      "📋",
      "🎗️",
      "🧩",
      "🔑",
      "🌈",
      "🎁",
      "🏆",
      "🥇",
      "❤️",
      "✨",
      "🔔",
    ],
  },
];

// Icône d'un service : l'icône configurée si présente, sinon un fallback
// déterministe dérivé du libellé (repris à l'identique de l'ancien svcIcon).
export function legacyServiceIcon(
  label: string,
  id: string,
  configuredIcon: string | null,
): string {
  if (configuredIcon) return configuredIcon;
  const l = (label || "").toLowerCase();
  const h = (id || label || "").split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const pick = (arr: string[]) => arr[h % arr.length];
  if (/natation|piscine|aqua/.test(l)) return pick(["🏊", "🌊", "🤽"]);
  if (/foot|football|soccer/.test(l)) return pick(["⚽", "🥅", "👟"]);
  if (/basket/.test(l)) return pick(["🏀", "🏟️"]);
  if (/tennis|badminton|ping/.test(l)) return pick(["🎾", "🏸"]);
  if (/yoga|méditat|relaxat/.test(l)) return pick(["🧘", "☮️", "🌸"]);
  if (/danse|ballet|hip.?hop/.test(l)) return pick(["💃", "🕺", "🩰"]);
  if (/gym|fitness|muscul|sport/.test(l)) return pick(["🏃", "🏋️", "🤸", "🚴", "⛹️"]);
  if (/guitare/.test(l)) return pick(["🎸", "🎶"]);
  if (/piano/.test(l)) return pick(["🎹", "🎼"]);
  if (/chant|chorale|choeur/.test(l)) return pick(["🎤", "🎶", "🎙️"]);
  if (/orchestre|instrument/.test(l)) return pick(["🎺", "🎻", "🥁"]);
  if (/musique/.test(l)) return pick(["🎵", "🎶", "🎼", "🎸", "🎹"]);
  if (/aquarelle/.test(l)) return pick(["🖌️", "🎨"]);
  if (/sculpture|poterie|céramique/.test(l)) return pick(["🗿", "🏺", "🖶"]);
  if (/dessin|illustration/.test(l)) return pick(["✏️", "🖊️", "📐"]);
  if (/peinture|art|créat/.test(l)) return pick(["🎨", "🖼️", "🖌️", "✏️"]);
  if (/cirque|jonglage|acrobat/.test(l)) return pick(["🎪", "🤹", "🎠"]);
  if (/théâtre|comédie|scène|spectacle/.test(l)) return pick(["🎭", "🎬", "🎟️"]);
  if (/patisserie|boulangerie/.test(l)) return pick(["🥐", "🍰", "🧁"]);
  if (/cuisine|gastro|culinaire/.test(l)) return pick(["🍳", "👨‍🍳", "🫕", "🥘"]);
  if (/photo/.test(l)) return pick(["📷", "📸", "🤳"]);
  if (/vidéo|cinéma|film/.test(l)) return pick(["🎥", "🎞️", "🎬"]);
  if (/robot/.test(l)) return pick(["🤖", "⚙️"]);
  if (/informatique|code|numérique|digital/.test(l)) return pick(["💻", "🖥️", "⌨️", "🖱️"]);
  if (/anglais/.test(l)) return pick(["🇬🇧", "📚"]);
  if (/espagnol/.test(l)) return pick(["🇪🇸", "📚"]);
  if (/allemand/.test(l)) return pick(["🇩🇪", "📚"]);
  if (/langue|français/.test(l)) return pick(["🌍", "🗣️", "📖"]);
  if (/conte|lecture/.test(l)) return pick(["📖", "📕", "🔖"]);
  if (/ludo|médiat|mediath|biblioth|livre/.test(l)) return pick(["📚", "📖", "🏫"]);
  if (/jardin|plante/.test(l)) return pick(["🌱", "🌻", "🪴", "🌿"]);
  if (/nature|environnement|écolog/.test(l)) return pick(["🌳", "♻️", "🌍", "🍃"]);
  if (/musée|museum/.test(l)) return pick(["🏛️", "🏺", "🗿"]);
  if (/visite|guidée/.test(l)) return pick(["🗺️", "🎫", "🔭"]);
  if (/atelier/.test(l)) return pick(["🔧", "🛠️", "⚗️", "🧪", "🔬"]);
  return pick(["📌", "🎯", "⭐", "🔷", "🏷️", "📋", "🎗️", "💡", "🧩", "🔑"]);
}
