// rules_STOLZ.js
// Pravila za model STOLZ (Stolovi_Zatvoreni) – izvedeno iz STOLO + Vrata logika + police feasibility

const RULES_STOLZ = {
  modelCode: "STOLZ",

  visibleParams: [
    "Model",
    "ModelCode",
    "Duljina",
    "Sirina",
    "Visina",
    "NogaVisina",
    "NogaBroj",
    "PlocaAlzatina",
    "PlocaVodeniRub",
    "DebljinaPloce",
    "Dno",
    "Polica",
    "Vrata"
  ],

  requiredParams: [
    "Model",
    "ModelCode",
    "Duljina",
    "Sirina",
    "Visina",
    "NogaVisina",
    "NogaBroj",
    "PlocaAlzatina",
    "PlocaVodeniRub",
    "DebljinaPloce",
    "Dno",
    "Polica",
    "Vrata"
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

    if (params.ModelCode !== "STOLZ") return;

    // =====================================================================
    // 1) CHECK DISCRETE + CUSTOM DIMENSION VALUES
    // =====================================================================
    const checkAllowed = (name, raw) => {
      const rule = this.allowedValues[name];
      if (!rule) return;

      const val = Number(raw);

      if (!isNaN(val)) {

        if (rule.discrete.includes(val)) return;

        if (rule.custom) {
          const { min, max, step } = rule.custom;
          if (val < min || val > max) {
            errors.push(`[STOLZ] ${name} = ${val} izvan raspona ${min}–${max}.`);
            return;
          }
          if ((val - min) % step !== 0) {
            errors.push(`[STOLZ] ${name} = ${val} nije u koraku ${step} od ${min}.`);
            return;
          }
        }
      } else {
        errors.push(`[STOLZ] ${name} mora biti broj.`);
      }
    };

    checkAllowed("Duljina", params.Duljina);
    checkAllowed("Sirina", params.Sirina);
    checkAllowed("Visina", params.Visina);

    // =====================================================================
    // 2) ERGONOMSKA VISINA
    // =====================================================================
    const vis = Number(params.Visina);
    if (!isNaN(vis)) {
      if (vis < 850 || vis > 950 || (vis - 850) % 50 !== 0) {
        errors.push(
          `[STOLZ] Visina ${vis} nije u standardnom rasponu 850–950 (korak 50).`
        );
      }
    }

    // =====================================================================
    // 3) AUTOMATSKI BROJ NOGU
    // =====================================================================
    const L = Number(params.Duljina);
    if (!params.NogaBroj) {
      params.NogaBroj = (L <= 2000 ? "4" : "6");
    }

    // =====================================================================
    // 4) FEASIBILITY: VISINA PROSTORA PO POLICI
    // =====================================================================
    const V  = Number(params.Visina);
    const NV = Number(params.NogaVisina);
    const DP = Number(params.DebljinaPloce);
    const P  = Number(params.Polica) || 0;

    const FIX_TOP    = 50;  // mm
    const FIX_BOTTOM = 40;  // mm

    if (!isNaN(V) && !isNaN(NV) && !isNaN(DP)) {

      const usable = V - DP - FIX_TOP - FIX_BOTTOM - NV;

      const hPoPolici = usable / (P + 1);

      if (hPoPolici < 300) {
        errors.push(
          `[FEAS] Visina prostora po polici je samo ${Math.round(hPoPolici)} mm. ` +
          `Povećajte Visinu ili smanjite broj polica.`
        );
      }
    }

    // =====================================================================
    // 5) VRATA – detailed feasibility logic
    // =====================================================================
    const vrata = params.Vrata;
    const dulj = Number(params.Duljina);

    if (vrata === "Bez_V") return; // No checks

    // ---- 1 KRILNA ----
    if (vrata === "Vrata_1Krilna") {
      if (dulj > 700 && dulj <= 1200) {
        errors.push(`[VRATA] Duljina ${dulj} mm je prevelika za 1-krilna vrata. Preporuka: Vrata_2Krilna.`);
      }
      if (dulj > 1200) {
        errors.push(`[VRATA] Duljina ${dulj} mm nije dozvoljena za 1-krilna vrata. Preporuka: Vrata_Klizna.`);
      }
    }

    // ---- 2 KRILNA ----
    if (vrata === "Vrata_2Krilna") {
      if (dulj <= 700) {
        errors.push(`[VRATA] Duljina ${dulj} mm je premala za 2-krilna vrata. Preporuka: Vrata_1Krilna.`);
      }
      if (dulj > 1200) {
        errors.push(`[VRATA] Duljina ${dulj} mm je prevelika za 2-krilna vrata. Preporuka: Vrata_Klizna.`);
      }
    }

    // ---- KLIZNA ----
    if (vrata === "Vrata_Klizna") {
      if (dulj <= 1000) {
        errors.push(`[VRATA] Duljina ${dulj} mm je premala za klizna vrata. Odaberite Vrata_1Krilna ili Vrata_2Krilna.`);
      }
    }
  }
};


// --------------------------------------------------
// GLOBALNA MAPA MODEL-RULES – sigurno dodavanje
// --------------------------------------------------
if (typeof MODEL_RULES === "undefined") {
  var MODEL_RULES = {};
}

MODEL_RULES["STOLZ"] = RULES_STOLZ;
