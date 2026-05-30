// schema_inox_v6.js
// Master schema (strojnofriendly imena) – MEX vlasništvo

const CONFIG_INOX_V6 = {
  schema_id: "config_inox_v6",
  program_group: "INOX",
  description: "Konfiguracijska schema INOX programa, v6, strojnofriendly imena.",
  parameters: [

    {
      name: "Model",
      type: "enum",
      required: true,
      status: "classified",
      linked: "ModelCode",
      values: [
        "Sudoperi_Otvoreni",
        "Sudoperi_Zatvoreni",
        "Sudoperi_Specijalni",
        "Stolovi_Zatvoreni",
        "Stolovi_Otvoreni",
        "Stolovi_Specijalni",
        "Stolovi_Hladeni",
        "Stolovi_Grijani",
        "Stolovi_Ladice",
        "Ormari_Samostojeci",
        "Ormari_Viseci",
        "Sifon_Podni",
        "Police_Skladisne",
        "Police_Zidne",
        "Police_Stolne",
        "Nape",
        "Elementi_Samoposluzeni",
        "Elementi_Barski",
        "Kolica",
        "Komore",
        "Mostovi",
        "Ostali_Proizvodi",
        "Elementi_Poluproizvodi"
      ],
      notes: "Naziv (tip) proizvoda u INOX programu."
    },

    {
      name: "ModelCode",
      type: "enum",
      required: true,
      status: "classified",
      linked: "Model",
      values: [
        "SDPO",  // Sudoperi_Otvoreni
        "SDPZ",
        "SDPS",
        "STOLZ",
        "STOLO",
        "STOLS",
        "STOLH",
        "STOLG",
        "STLAD",
        "ORM",
        "ORMV",
        "SIF",
        "PSKL",
        "PZ",
        "PST",
        "NAP",
        "SELFS",
        "BAR",
        "KOL",
        "KOM",
        "MOST",
        "OST",
        "PPR"
      ],
      notes: "Kratki kod modela; koristi se za mapiranje u ERP/MW sustavu."
    },

    {
      name: "Duljina",
      required: true,
      type: "integer",
      min: 400,
      max: 3000,
      range: { min: 400, max: 3000, step: 100 },
      unit: "mm",
      status: "classified",
      allow_custom: true,
      notes: "Standardne duljine 400–3000 mm u koraku 100; CUSTOM omogućuje ručni unos."
    },

    {
      name: "Sirina",
      required: true,
      type: "integer",
      min: 300,
      max: 1400,
      range: { min: 300, max: 1400, step: 100 },
      values: [300,400,500,600,700,800,900,1000,1100,1200,1300,1400],
      unit: "mm",
      status: "classified",
      allow_custom: true,
      notes: "Standardne širine 300–1400 mm u koraku 100; CUSTOM omogućuje ručni unos."
    },

    {
      name: "Visina",
      required: true,
      type: "integer",
      min: 600,
      max: 2000,
      range: { min: 600, max: 2000, step: 50 },
      unit: "mm",
      status: "classified",
      allow_custom: true,
      notes: "CUSTOM omogućuje ručni unos."
    },

    {
      name: "NogaVisina",
      required: false,
      type: "integer",
      min: 100,
      max: 150,
      values: [100, 150],
      unit: "mm",
      status: "classified"
    },

    {
      name: "NogaBroj",
      required: false,
      type: "integer",
      min: 4,
      max: 6,
      values: [4, 6],
      unit: "pcs",
      status: "classified"
    },
    {
      name: "PlocaAlzatina",
      required: false,
      type: "enum",
      values: ["ALZ40Tanka", "ALZ100Debela","BezALZ"],
      status: "classified"
    }, 
    {
      name: "PlocaVodeniRub",
      required: false,
      type: "enum",
      values: ["Suho","Pjover" ],
      status: "classified"
    },

    {
      name: "DebljinaPloce",
      required: false,
      type: "integer",
      min: 40,
      max: 50,
      values: [40, 50],
      unit: "mm",
      status: "classified"
    },

    {
      name: "Korito1",
      required: false,
      type: "string",
      values: [
        "250x250x200",
        "340x340x200",
        "400x340x200",
        "340x400x200",
        "400x400x250",
        "500x400x250",
        "400x500x250",
        "500x400x300",
        "400x500x300",
        "500x500x250",
        "500x500x300",
        "600x500x300",
        "800x500x375"
      ],
      status: "classified"
    },

    {
      name: "Korito2",
      required: false,
      type: "string",
      values: [
        "BezK2",
        "250x250x200",
        "340x340x200",
        "400x340x200",
        "340x400x200",
        "400x400x250",
        "500x400x250",
        "400x500x250",
        "500x400x300",
        "400x500x300",
        "500x500x250",
        "500x500x300",
        "600x500x300",
        "800x500x375"
      ],
      status: "classified"
    },

    {
      name: "OrijentacijaK1",
      required: false,
      type: "enum",
      values: ["Lijevo", "Desno"],
      status: "classified"
    },

    {
      name: "OrijentacijaK2",
      required: false,
      type: "enum",
      values: ["NP","Lijevo", "Desno"],
      status: "classified"
    },

    {
      name: "SlavinaK1",
      required: false,
      type: "string",
      values: ["Bez_SK1", "Lijevo", "Centar", "Desno"],
      status: "classified"
    },

    {
      name: "SlavinaK2",
      required: false,
      type: "string",
      values: ["NP","Bez_SK2", "Lijevo", "Centar", "Desno"],
      status: "classified"
    },

    {
      name: "OffsetK1",
      required: false,
      type: "number",
      unit: "mm",
      default: 0,
      range: { min: -50, max: 50 },
      status: "classified"
    },

    {
      name: "OffsetK2",
      required: false,
      type: "number",
      unit: "mm",
      default: 0,
      range: { min: -50, max: 50 },
      status: "classified"
    },

    {
      name: "SkacaPrednja",
      required: false,
      type: "string",
      values: ["69", "270", "Custom"],
      status: "classified"
    },

    {
      name: "SkacaLijeva",
      required: false,
      type: "string",
      values: ["69", "270", "Custom"],
      status: "classified"
    },

    {
      name: "SkacaDesna",
      required: false,
      type: "string",
      values: ["69", "270", "Custom"],
      status: "classified"
    },

    {
      name: "Dno",
      required: false,
      type: "enum",
      values: ["Bez_D", "30", "40"],
      unit: "mm",
      status: "classified"
    },

    {
      name: "Polica",
      required: false,
      type: "string",
      values: ["Bez_P", "1", "2", "3", "4", "5"],
      unit: "pcs",
      status: "classified"
    },

    {
      name: "PolicaTehnologija",
      required: false,
      type: "enum",
      values: ["Vijak", "Zavar"],
      status: "classified"
    },

    {
      name: "Vrata",
      required: false,
      type: "enum",
      values: ["Vrata_1Krilna", "Vrata_2Krilna", "Vrata_Klizna","Bez_V"],
      status: "classified"
    },

    {
      name: "Ladice",
      required: false,
      type: "integer",
      min: 1,
      max: 4,
      range: { min: 1, max: 4, step: 1 },
      values: [1, 2, 3, 4],
      unit: "pcs",
      status: "classified"
    },

    {
      name: "Vodilica",
      required: false,
      type: "integer",
      min: 450,
      max: 600,
      range: { min: 450, max: 600, step: 50 },
      values: [450, 500, 550, 600],
      unit: "mm",
      status: "classified"
    },

    {
      name: "Grijac",
      required: false,
      type: "enum",
      values: ["Lijevo", "Desno", "Oba_G"],
      status: "classified"
    },

    {
      name: "Filter",
      required: false,
      type: "string",
      values: ["400x400", "400x500", "500x400", "500x500"],
      status: "classified"
    }

  ],
  schema_version: "v6",
  update_notes: "Imena i enum vrijednosti postfixirane u strojnofriendly oblik (bez razmaka)."
};

// lookup mapa name -> param
const SCHEMA_V6_MAP = {};
CONFIG_INOX_V6.parameters.forEach(p => {
  SCHEMA_V6_MAP[p.name] = p;
});

// =====================================================================
//  AUTO–GENERATED MODEL_TO_CODE MAPA IZ SHEME (bez mijenjanja enginea)
// =====================================================================

window.MODEL_TO_CODE = {};
(function buildModelToCode() {
  const modelParam = SCHEMA_V6_MAP["Model"];
  const codeParam  = SCHEMA_V6_MAP["ModelCode"];

  if (!modelParam || !codeParam) return;
  if (!Array.isArray(modelParam.values)) return;
  if (!Array.isArray(codeParam.values)) return;
  if (modelParam.values.length !== codeParam.values.length) {
    console.warn("UPOZORENJE: Model.values i ModelCode.values nemaju isti broj elemenata!");
  }

  modelParam.values.forEach((modelName, idx) => {
    window.MODEL_TO_CODE[modelName] = codeParam.values[idx];
  });
})();
