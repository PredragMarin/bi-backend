"use strict";

const DEFAULT_PRODUCT_CODE = "PPV";
const DEFAULT_TECHNOLOGY_PROFILE = "OPS_S4P4";
const DEFAULT_KIT_VERSION = "PPV_OPS_S4P4_v0";

function mapKitCodeToProductProfile(kitCode) {
  const normalized = String(kitCode || "").trim().toUpperCase();
  if (normalized !== DEFAULT_TECHNOLOGY_PROFILE) {
    throw new Error(`Unsupported DBR kit_code in v0: ${kitCode}`);
  }

  return {
    productCode: DEFAULT_PRODUCT_CODE,
    technologyProfile: DEFAULT_TECHNOLOGY_PROFILE
  };
}

function createSyntheticGosoftDnId(base, index) {
  const numericBase = Number(base);
  if (!Number.isSafeInteger(numericBase) || numericBase <= 0) {
    throw new Error("syntheticBase must be a positive safe integer.");
  }
  return numericBase + Number(index);
}

function mapSifradnRecordToProductionOrder(record, context = {}) {
  const { productCode, technologyProfile } = mapKitCodeToProductProfile(record.kitCode);
  const hasRealGosoftDnId = Number.isInteger(Number(record.gosoftDnId)) && Number(record.gosoftDnId) > 0;
  const gosoftDnId = hasRealGosoftDnId
    ? Number(record.gosoftDnId)
    : createSyntheticGosoftDnId(context.syntheticBase, record.index + 1);

  return {
    sourceIndex: record.index,
    sifradn: record.sifradn,
    gosoftDnId,
    gosoftDnKey: `DBR-SIFRADN-${record.sifradn}`,
    status: "frozen",
    productCode,
    technologyProfile,
    kitVersion: context.kitVersion || DEFAULT_KIT_VERSION,
    quantity: record.quantity,
    parameterSnapshot: {
      source: "dbr_sifradn_import_v0",
      sifradn: record.sifradn,
      kit_code: record.kitCode,
      quantity: record.quantity,
      parameters: record.parameters,
      syntheticGosoftDnId: !hasRealGosoftDnId,
      dbrBulkImportFrozenPayload: true
    }
  };
}

function mapFetchedDbrOrderToProductionOrder(item, context = {}) {
  if (!item || !item.row) {
    throw new Error("Fetched DBR item must include an ERP row.");
  }
  if (!item.functionalPayload || !item.functionalPayload.configuratorData) {
    throw new Error(`Fetched DBR item ${item.sifradn} must include parsed functional payload.`);
  }

  const gosoftDnId = Number(item.row.dnid);
  if (!Number.isInteger(gosoftDnId) || gosoftDnId <= 0) {
    throw new Error(`Fetched DBR item ${item.sifradn} is missing a valid ERP DNID.`);
  }

  return {
    sourceIndex: context.sourceIndex || 0,
    sifradn: item.sifradn,
    gosoftDnId,
    gosoftDnKey: `DBR-SIFRADN-${item.sifradn}`,
    status: "frozen",
    productCode: DEFAULT_PRODUCT_CODE,
    technologyProfile: DEFAULT_TECHNOLOGY_PROFILE,
    kitVersion: context.kitVersion || DEFAULT_KIT_VERSION,
    quantity: Number(item.row.kolicina),
    parameterSnapshot: {
      source: "dbr_sifradn_import_v0",
      source_system: "ERP (Gosoft SAP ASE)",
      sifradn: item.sifradn,
      kit_code: DEFAULT_TECHNOLOGY_PROFILE,
      quantity: Number(item.row.kolicina),
      gosoft: {
        dnid: gosoftDnId,
        nalogid: item.row.nalogid,
        nalog: item.row.nalog,
        sifraid: item.row.sifraid,
        admctr: item.row.admctr,
        status: item.row.status,
        status_sifra: item.row.status_sifra
      },
      configPreview: item.configPreview,
      functionalPayload: item.functionalPayload,
      parameters: item.functionalPayload.configuratorData,
      syntheticGosoftDnId: false,
      dbrBulkImportFrozenPayload: true
    }
  };
}

function mapSifradnRecordsToProductionOrders(records, context = {}) {
  return records.map((record) => mapSifradnRecordToProductionOrder(record, context));
}

function mapFetchedDbrOrdersToProductionOrders(items, context = {}) {
  return items.map((item, index) => mapFetchedDbrOrderToProductionOrder(item, {
    ...context,
    sourceIndex: index
  }));
}

module.exports = {
  DEFAULT_PRODUCT_CODE,
  DEFAULT_TECHNOLOGY_PROFILE,
  DEFAULT_KIT_VERSION,
  mapKitCodeToProductProfile,
  mapSifradnRecordToProductionOrder,
  mapSifradnRecordsToProductionOrders,
  mapFetchedDbrOrderToProductionOrder,
  mapFetchedDbrOrdersToProductionOrders
};
