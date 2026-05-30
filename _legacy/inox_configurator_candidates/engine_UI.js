// engine_UI.js – dvofazni UX s CUSTOM vrijednostima prema rules_SDPO
// ==============================================================

let ACTIVE_MODEL = null;
let ACTIVE_MODEL_CODE = null;
let ACTIVE_RULESET = null;

// mapiranje Model -> ModelCode
const MODEL_TO_CODE = {
  "Sudoperi_Otvoreni": "SDPO"
  // primjer: "Stolovi_Otvoreni": "STOLO"
};

// INIT (FAZA 1)
window.addEventListener("DOMContentLoaded", initEngineUI);

function initEngineUI() {
  const startSelect = document.getElementById("start-model");
  const modelParam = CONFIG_INOX_V6.parameters.find(p => p.name === "Model");

  if (modelParam?.values) {
    modelParam.values.forEach(v => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      startSelect.appendChild(opt);
    });
  }

  document.getElementById("start-button")
    .addEventListener("click", onChooseModel);

  document.getElementById("validate-button")
    .addEventListener("click", onSimulate);
}

// =============================================================
// FAZA 1 → FAZA 2 (odabir modela)
// =============================================================
function onChooseModel() {
  const modelName = document.getElementById("start-model").value;
ACTIVE_MODEL = modelName;

// AUTOMATSKA LINKED MAPA preko schema v7
const modelParam = SCHEMA_V6_MAP["Model"];
const modelCodeParam = SCHEMA_V6_MAP["ModelCode"];

let code = null;

if (modelParam && modelCodeParam && modelParam.linked === "ModelCode") {
    const idx = modelParam.values.indexOf(modelName);
    if (idx >= 0) {
        code = modelCodeParam.values[idx];
    }
}

ACTIVE_MODEL_CODE = code;

if (!ACTIVE_MODEL_CODE) {
    alert("Za odabrani model nije definiran ModelCode.");
    return;
}


  const rules = MODEL_RULES[ACTIVE_MODEL_CODE];
  if (!rules) {
    alert("Odabrani model još nije implementiran u konfiguratoru.");
    return;
  }

  ACTIVE_RULESET = rules;

  document.getElementById("model-select-section").style.display = "none";
  document.getElementById("config-section").style.display = "block";

  const info = document.getElementById("active-model-info");
  info.textContent = `Aktivni model: ${ACTIVE_MODEL} (kod ${ACTIVE_MODEL_CODE})`;

  buildConfiguratorUI();
}

// =============================================================
// FAZA 2 – dinamičko kreiranje UI (dropdown + CUSTOM input)
// =============================================================
function buildConfiguratorUI() {
  const container = document.getElementById("param-container");
  container.innerHTML = "";

  const visible = ACTIVE_RULESET.visibleParams || [];

  visible.forEach(name => {
    const def = CONFIG_INOX_V6.parameters.find(p => p.name === name);
    if (!def) return;

    const AV = ACTIVE_RULESET.allowedValues?.[name];

    const div = document.createElement("div");
    div.className = "param-field";

    const label = document.createElement("label");
    label.textContent = name;
    div.appendChild(label);

    //----------------------------------------------------------
    // CASE 1: discrete + custom → dropdown + hidden number box
    //----------------------------------------------------------
    if (AV && AV.discrete && AV.custom) {
      const select = document.createElement("select");
      select.id = "field-" + name;

      // diskretne vrijednosti
      AV.discrete.forEach(v => {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = v;
        select.appendChild(opt);
      });

      // dodatna CUSTOM opcija
      const optC = document.createElement("option");
      optC.value = "CUSTOM";
      optC.textContent = "CUSTOM";
      select.appendChild(optC);

      div.appendChild(select);

      // hidden number field
      const customInput = document.createElement("input");
      customInput.type = "number";
      customInput.style.display = "none";
      customInput.id = "custom-" + name;
      customInput.min = AV.custom.min;
      customInput.max = AV.custom.max;
      customInput.step = AV.custom.step;
      customInput.value = AV.custom.min;

      div.appendChild(customInput);

      // event listener za uklj/iskl CUSTOM polja
      select.addEventListener("change", () => {
        if (select.value === "CUSTOM") {
          customInput.style.display = "inline-block";
        } else {
          customInput.style.display = "none";
        }
      });

      container.appendChild(div);
      return;
    }

    //----------------------------------------------------------
    // CASE 2: samo discrete → dropdown
    //----------------------------------------------------------
    if (AV && AV.discrete) {
      const select = document.createElement("select");
      select.id = "field-" + name;

      AV.discrete.forEach(v => {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = v;
        select.appendChild(opt);
      });

      div.appendChild(select);
      container.appendChild(div);
      return;
    }

    //----------------------------------------------------------
    // CASE 3: samo custom → number input
    //----------------------------------------------------------
    if (AV && AV.custom) {
      const input = document.createElement("input");
      input.type = "number";
      input.id = "field-" + name;
      input.min = AV.custom.min;
      input.max = AV.custom.max;
      input.step = AV.custom.step;
      input.value = AV.custom.min;

      div.appendChild(input);
      container.appendChild(div);
      return;
    }

    //----------------------------------------------------------
    // CASE 4: fallback – enum iz schemedef.values
    //----------------------------------------------------------
    let input;
    if (def.values) {
      input = document.createElement("select");
      def.values.forEach(v => {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = v;
        input.appendChild(opt);
      });
    } else {
      input = document.createElement("input");
      input.type = def.type === "number" ? "number" : "text";
    }
    input.id = "field-" + name;

    div.appendChild(input);
    container.appendChild(div);
  });

  // automatski upiši Model i ModelCode
  const fM = document.getElementById("field-Model");
  if (fM) fM.value = ACTIVE_MODEL;

  const fC = document.getElementById("field-ModelCode");
  if (fC) fC.value = ACTIVE_MODEL_CODE;
}

// =============================================================
// VALIDACIJA + SIMULACIJA
// =============================================================
function onSimulate() {
  const statusEl = document.getElementById("result-status");
  const errorsEl = document.getElementById("result-errors");
  const outputEl = document.getElementById("result-output");

  statusEl.textContent = "";
  errorsEl.textContent = "";
  outputEl.textContent = "";

  if (!ACTIVE_RULESET) {
    statusEl.textContent = "Status: N/A";
    errorsEl.textContent = "Greška: model nije aktiviran.";
    return;
  }

  const params = {};
  const visible = ACTIVE_RULESET.visibleParams;

  visible.forEach(name => {
    const sel = document.getElementById("field-" + name);
    const custom = document.getElementById("custom-" + name);

    if (sel && sel.value === "CUSTOM" && custom) {
      params[name] = custom.value;
    } else if (sel) {
      params[name] = sel.value;
    }
  });

  params.Model = ACTIVE_MODEL;
  params.ModelCode = ACTIVE_MODEL_CODE;

  const schemaErrors = validateAgainstSchema(params, ACTIVE_RULESET);
  const errors = [...schemaErrors];

  if (ACTIVE_RULESET.applyRules) {
    ACTIVE_RULESET.applyRules(params, errors);
  }

  if (errors.length > 0) {
    statusEl.textContent = "Status: ERROR";
    errorsEl.innerHTML = "<ul>" + errors.map(e => `<li>${e}</li>`).join("") + "</ul>";
  } else {
    statusEl.textContent = "Status: OK";
    errorsEl.textContent = "Nema grešaka – konfiguracija valjana.";
  }

  outputEl.innerHTML = "<pre>" + JSON.stringify({
    productCode: ACTIVE_MODEL_CODE,
    parameters: params,
    errors
  }, null, 2) + "</pre>";
}

// =============================================================
// SCHEMA VALIDATION (STRICT za vidljive parametre)
// =============================================================
function validateAgainstSchema(params, ruleset) {
  const errors = [];
  const visible = ruleset.visibleParams || [];

  CONFIG_INOX_V6.parameters.forEach(def => {
    if (!visible.includes(def.name)) return;

    const val = params[def.name];

    if (def.required && (val === "" || val === undefined)) {
      errors.push(`[SCHEMA] "${def.name}" je obavezno.`);
      return;
    }

    if (val === "" || val === undefined) return;

    if (def.type === "integer" || def.type === "number") {
      const n = Number(val);
      if (isNaN(n)) {
        errors.push(`[SCHEMA] "${def.name}" mora biti broj.`);
        return;
      }
      if (def.min !== undefined && n < def.min)
        errors.push(`[SCHEMA] "${def.name}" = ${n} < minimalno ${def.min}`);
      if (def.max !== undefined && n > def.max)
        errors.push(`[SCHEMA] "${def.name}" = ${n} > maksimalno ${def.max}`);
    }

    if (def.values) {
      const allowed = def.values.map(String);
      if (!allowed.includes(String(val))) {
        errors.push(`[SCHEMA] "${def.name}" = "${val}" nije među dopuštenima: ${allowed.join(", ")}`);
      }
    }
  });

  return errors;
}
