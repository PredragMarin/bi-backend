// rules_SDPO.js
// Pravila za model SDPO (Sudoperi_Otvoreni) – MEX vlasništvo

const RULES_SDPO = {
  modelCode: "SDPO",

  visibleParams: [
    "Model",
    "ModelCode",
    "Duljina",
    "Sirina",
    "Visina",
    "NogaVisina",
    "NogaBroj",
    "DebljinaPloce",
    "Korito1",
    "Korito2",
    "OrijentacijaK1",
    "OrijentacijaK2",
    "SlavinaK1",
    "SlavinaK2",
    "OffsetK1",
    "OffsetK2",
    "SkacaPrednja",
    "SkacaLijeva",
    "SkacaDesna",
    "Dno",
    "PolicaTehnologija"
  ],

  requiredParams: [
    "Model",
    "ModelCode",
    "Duljina",
    "Sirina",
    "Visina",
    "Korito1",
    "OrijentacijaK1",
    "SlavinaK1",
    "OffsetK1",
    "SkacaPrednja",
    "SkacaLijeva",
    "SkacaDesna",
    "Dno",
    "PolicaTehnologija"
  ],

  allowedValues: {
    Duljina: {
      discrete: [
        500, 600, 700, 800, 900, 1000, 1100, 1200, 1300,
        1400, 1500, 1600, 1700, 1800, 1900, 2000, 2100,
        2200, 2300, 2400, 2500, 2600, 2700, 2800, 2900, 3000
      ],
      custom: { min: 500, max: 3000, step: 10 }
    },
    Sirina: {
      discrete: [600, 700],
      custom: { min: 500, max: 800, step: 10 }
    },
    Visina: {
      discrete: [850, 900, 950],
      custom: { min: 700, max: 1000, step: 10 }
    }
  },

  applyRules(params, errors) {

    if (params.ModelCode !== "SDPO") return;

    // -------------------------
    // 1) DEFAULTI
    // -------------------------
    if (!params.Korito1) params.Korito1 = "250x250x200";
    if (!params.Korito2) params.Korito2 = "BezK2";
    if (!params.OffsetK1) params.OffsetK1 = "0";
    if (!params.OffsetK2) params.OffsetK2 = "0";

    // -------------------------
    // 2) K2 LOGIKA
    // -------------------------
    if (params.Korito2 === "BezK2") {
      params.OrijentacijaK2 = "NP";
      params.SlavinaK2 = "NP";
      params.OffsetK2 = "0";
    }

    // -------------------------
    // 3) ALLOWED VALUES
    // -------------------------
    const checkAllowed = (name, raw) => {
      const rule = this.allowedValues[name];
      if (!rule) return;

      const val = Number(raw);

      if (!isNaN(val)) {
        if (rule.discrete.includes(val)) return;

        if (rule.custom) {
          const { min, max, step } = rule.custom;
          if (val < min || val > max) {
            errors.push(`[SDPO] ${name} = ${val} izvan custom raspona ${min}–${max}.`);
            return;
          }
          if ((val - min) % step !== 0) {
            errors.push(`[SDPO] ${name} = ${val} nije u koraku ${step} od ${min}.`);
            return;
          }
        }
      } else {
        errors.push(`[SDPO] ${name} mora biti broj.`);
      }
    };

    checkAllowed("Duljina", params.Duljina);
    checkAllowed("Sirina", params.Sirina);
    checkAllowed("Visina", params.Visina);

    // -------------------------
    // 4) ERGONOMSKA VISINA
    // -------------------------
    const vis = Number(params.Visina);
    if (!isNaN(vis)) {
      if (vis < 850 || vis > 950 || (vis - 850) % 50 !== 0) {
        errors.push(`[SDPO] Visina ${vis} nije u standardnom rasponu 850–950 (korak 50).`);
      }
    }

    // -------------------------
    // 5) FEASIBILITY (K1+K2+OFFSET)
    // -------------------------
    const parseKoritoLength = k => {
      if (!k || String(k).includes("Bez")) return 0;
      return Number(String(k).split("x")[0]) || 0;
    };

    const L = Number(params.Duljina);
    const k1 = parseKoritoLength(params.Korito1);
    const k2 = parseKoritoLength(params.Korito2);
    const hasK2 = params.Korito2 !== "BezK2";

    const baseHeadroom = hasK2 ? 240 : 200;
    const offset = Number(params.OffsetK1) || 0;

    const needed = k1 + (hasK2 ? k2 : 0) + baseHeadroom + 2 * offset;

    if (L < needed) {
      errors.push(`[FEAS] Duljina premala. Potrebno: ${needed} mm, dano: ${L} mm.`);
    }

    // -------------------------
    // 6) AUTOMATSKI BROJ NOGU
    // -------------------------
    if (!params.NogaBroj) {
      params.NogaBroj = (L <= 2000 ? "4" : "6");
    }

    // -------------------------
    // 7) DNO → NP ZA POLICA TEHNOLOGIJA
    // -------------------------
    if (params.Dno === "Bez_D") {
      params.PolicaTehnologija = "NP";
    }
  }
};


// --------------------------------------------------
// GLOBALNA MAPA MODEL-RULES – sigurno dodavanje
// --------------------------------------------------
if (typeof MODEL_RULES === "undefined") {
    var MODEL_RULES = {};
}

MODEL_RULES["SDPO"] = RULES_SDPO;
