// Phase 5.au — Values Fingerprint.
//
// Coined identity ("The Climate Pragmatist", "The Worker Advocate") derived
// from quiz weights. Lives in Account, appears on the share card, seeds the
// return-visit welcome line. Co-Star / 16Personalities anchor — drives
// organic shares (acquisition) AND retention with NO public comparison.
//
// The "axes" we score on are derived from the quiz outputs:
//   - climate   (environment weight + low-political-conservative skew)
//   - workers   (labor weight + unionSupport + pro-DEI lean)
//   - animals   (animalTesting dealbreaker + animal-weight)
//   - privacy   (privacy weight + execPay concern as a proxy for anti-corp)
//   - politics  (lean: left/right/mixed/neutral — used for the 4-letter code)
//
// Each archetype is mapped by which axis dominates. Ties pick the most
// distinctive one. Output:
//   {
//     id:          "climate-pragmatist",
//     name:        "The Climate Pragmatist",
//     codename:    "CPNL",        // 4-letter shareable code
//     blurb:       "1-sentence description",
//     primaryAxis: "climate",
//     axes: { climate: 5, workers: 3, animals: 2, privacy: 2 }, // 1-5
//   }

const ARCHETYPES = [
  {
    id: "climate-first",
    name: "The Climate-First Shopper",
    primaryAxis: "climate",
    blurb: "You'd skip a deal to skip a polluter. Environment is your top filter.",
  },
  {
    id: "climate-pragmatist",
    name: "The Climate Pragmatist",
    primaryAxis: "climate",
    blurb: "You weigh environment heavily, but you'll trade off where there's no clean option.",
  },
  {
    id: "worker-advocate",
    name: "The Worker Advocate",
    primaryAxis: "workers",
    blurb: "Wages, unions, and supply-chain dignity decide your purchases.",
  },
  {
    id: "quiet-boycotter",
    name: "The Quiet Boycotter",
    primaryAxis: "workers",
    blurb: "You don't post about it, but you quietly route around bad-actor brands.",
  },
  {
    id: "animal-defender",
    name: "The Animal Defender",
    primaryAxis: "animals",
    blurb: "Cruelty-free is a hard line for you. Bunny on the box, every time.",
  },
  {
    id: "privacy-hawk",
    name: "The Privacy Hawk",
    primaryAxis: "privacy",
    blurb: "Data breaches and surveillance practices are dealbreakers.",
  },
  {
    id: "balanced-skeptic",
    name: "The Balanced Skeptic",
    primaryAxis: "balanced",
    blurb: "You weigh every category. No single category dominates — you read the whole record.",
  },
  {
    id: "progressive-conscious",
    name: "The Progressive Consumer",
    primaryAxis: "politics-left",
    blurb: "Progressive politics drives your shopping — environment, labor, and DEI all rank high.",
  },
  {
    id: "conservative-conscious",
    name: "The Conservative Consumer",
    primaryAxis: "politics-right",
    blurb: "You prioritize American jobs, faith-friendly brands, and traditional values.",
  },
];

/** Derive an archetype from a quiz profile. */
export function computeFingerprint(profile) {
  if (!profile) return null;
  const w = profile.weights || {};

  // Normalize each axis 1-5
  const axes = {
    climate: clamp1to5(w.environment),
    workers: clamp1to5(Math.max(w.labor || 0, (profile.unionSupport === "pro" ? 5 : profile.unionSupport === "anti" ? 1 : 3))),
    animals: clamp1to5(profile.animalTesting === "dealbreaker" ? 5
                    : profile.animalTesting === "prefer_not" ? 4
                    : w.animals),
    privacy: clamp1to5(w.privacy),
  };

  // Find the dominant axis (max score)
  const sorted = Object.entries(axes).sort((a,b) => b[1] - a[1]);
  const top = sorted[0];
  const second = sorted[1];
  // If all axes are within 1 point of each other → balanced
  const spread = sorted[0][1] - sorted[3][1];
  const isBalanced = spread <= 1;

  // Pick archetype
  let arch;
  if (isBalanced) {
    arch = ARCHETYPES.find(a => a.id === "balanced-skeptic");
  } else if (profile.lean === "left" && top[1] >= 4) {
    arch = ARCHETYPES.find(a => a.id === "progressive-conscious");
  } else if (profile.lean === "right" && top[1] >= 4) {
    arch = ARCHETYPES.find(a => a.id === "conservative-conscious");
  } else if (top[0] === "climate") {
    // Pragmatist if second axis is also ≥4, climate-first otherwise
    arch = second[1] >= 4
      ? ARCHETYPES.find(a => a.id === "climate-pragmatist")
      : ARCHETYPES.find(a => a.id === "climate-first");
  } else if (top[0] === "workers") {
    arch = second[1] >= 4
      ? ARCHETYPES.find(a => a.id === "worker-advocate")
      : ARCHETYPES.find(a => a.id === "quiet-boycotter");
  } else if (top[0] === "animals") {
    arch = ARCHETYPES.find(a => a.id === "animal-defender");
  } else if (top[0] === "privacy") {
    arch = ARCHETYPES.find(a => a.id === "privacy-hawk");
  } else {
    arch = ARCHETYPES.find(a => a.id === "balanced-skeptic");
  }

  // 4-letter codename: first letter of each axis sorted high→low,
  // suffixed with political lean (L=left, R=right, M=mixed, N=neutral).
  const axisInitials = sorted.map(([k]) => k[0].toUpperCase()).join("");
  const leanSuffix = ({left:"L", right:"R", mixed:"M", neutral:"N"})[profile.lean] || "N";
  const codename = axisInitials.slice(0, 3) + leanSuffix;

  return {
    id: arch.id,
    name: arch.name,
    codename,
    blurb: arch.blurb,
    primaryAxis: arch.primaryAxis,
    axes,
  };
}

function clamp1to5(v) {
  const n = Number(v);
  if (!isFinite(n) || n < 1) return 1;
  if (n > 5) return 5;
  return Math.round(n);
}

/** Persist the fingerprint alongside the profile. */
export function persistFingerprint(fp) {
  try {
    if (fp) localStorage.setItem("tn_fingerprint", JSON.stringify(fp));
  } catch {}
}

/** Read a stored fingerprint, or null. */
export function getStoredFingerprint() {
  try {
    return JSON.parse(localStorage.getItem("tn_fingerprint") || "null");
  } catch { return null; }
}
