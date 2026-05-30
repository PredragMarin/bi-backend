// rules_STOLO.js
// Pravila za model STOLO (Stolovi_Otvoreni) – izvedeno iz SDPO bez korita

const RULES_STOLO = {
  modelCode: "STOLO",

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
    "PolicaTehnologija"
  ],

  requiredParams: [
    "Model",
    "ModelCode",
    "Duljina",
    "Sirina",
    "Visina",
    "PlocaAlzatina",
    "PlocaVodeniRub",
    "DebljinaPloce",
    "Dno",
    "PolicaTehnologija"
  ],

  // Dimenzijske vrijednosti – specifične allowed values
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

    if (params.ModelCode !== "STOLO") return;

    // -------------------------
    // 1) ALLOWED VALUES
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
            errors.push(`[STOLO] ${name} = ${val} izvan raspona ${min}–${max}.`);
            return;
          }
          if ((val - min) % step !== 0) {
            errors.push(`[STOLO] ${name} = ${val} nije u koraku ${step} od ${min}.`);
            return;
          }
        }
      } else {
        errors.push(`[STOLO] ${name} mora biti broj.`);
      }
    };

    checkAllowed("Duljina", params.Duljina);
    checkAllowed("Sirina", params.Sirina);
    checkAllowed("Visina", params.Visina);

    // -------------------------
    // 2) ERGONOMSKA VISINA
    // -------------------------
    const vis = Number(params.Visina);
    if (!isNaN(vis)) {
      if (vis < 850 || vis > 950 || (vis - 850) % 50 !== 0) {
        errors.push(
          `[STOLO] Visina ${vis} nije u standardnom rasponu 850–950 (korak 50).`
        );
      }
    }

    // -------------------------
    // 3) AUTOMATSKI BROJ NOGU
    // -------------------------
    const L = Number(params.Duljina);
    // BROJ NOGU — auto logika
let nb = Number(params.NogaBroj);

// Ako nije postavljeno ili nije 4 ili 6 → auto izračun
if (isNaN(nb) || ![4, 6].includes(nb)) {
  params.NogaBroj = (L <= 2000 ? "4" : "6");
} else {
  // Ako je korisnik odabrao 4 ali Duljina > 2000 → prisilno 6
  if (nb === 4 && L > 2000) {
    params.NogaBroj = "6";
  }
  // Ako je korisnik odabrao 6 ali Duljina ≤ 2000 → prisilno 4
  if (nb === 6 && L <= 2000) {
    params.NogaBroj = "4";
  }
}


    // -------------------------
    // 4) DNO + POLICA LOGIKA → PolicaTehnologija = NP
    // -------------------------
    if (params.Dno === "Bez_D" && params.Polica === "Bez_P") {
      params.PolicaTehnologija = "NP";
    }

    // -------------------------
    // 5) FEASIBILITY: visina prostora po polici
    // -------------------------
    const V = Number(params.Visina);
    const NV = Number(params.NogaVisina);
    const DP = Number(params.DebljinaPloce);
    const P = Number(params.Polica) || 0;

    let DnoDeb = 0;
    if (params.Dno !== "Bez_D") {
      DnoDeb = Number(params.Dno) || 0;
    }

    // Svi potrebni brojevi postoje?
    if (!isNaN(V) && !isNaN(NV) && !isNaN(DP)) {

      const usable = V - NV - DnoDeb - (P * 30) - DP; // mm
      const hPoPolici = usable / (P + 1);

      if (hPoPolici < 300) {
        errors.push(
          `[FEAS] Visina prostora iznad police je samo ${Math.round(hPoPolici)} mm. ` +
          `Povećajte Visinu ili smanjite broj polica.`
        );
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

MODEL_RULES["STOLO"] = RULES_STOLO;
