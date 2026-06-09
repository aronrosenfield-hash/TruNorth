#!/usr/bin/env node
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BAFIN_R4, BFDI, AMF, AGCM, ACM_NL, AFM, DATATILSYNET_NO,
  FI_SE, IMY_SE, APD_BE, FINMA, WEKO, AEPD, FORBRUKERTILSYNET, CNMC,
} from "./euro-regulators-r4-seed.mjs";

test("BaFin r4 includes N26 + DWS greenwashing kernel", () => {
  assert.ok(BAFIN_R4["n26"], "Missing N26 entry");
  assert.ok(BAFIN_R4["n26"].total_fines_eur >= 9_000_000);
  assert.ok(BAFIN_R4["deutsche-bank-aktiengesellschaft"]);
});

test("AGCM Italy includes the €1.13B Amazon Marketplace case", () => {
  assert.ok(AGCM["amazon"]);
  assert.ok(AGCM["amazon"].total_fines_eur >= 1_000_000_000);
});

test("ACM Netherlands includes the €50M Apple dating-app case", () => {
  assert.ok(ACM_NL["apple"]);
  assert.equal(ACM_NL["apple"].total_fines_eur, 50_000_000);
});

test("AFM Netherlands includes the €775M ING AML settlement", () => {
  assert.ok(AFM["ing-groep-nv"]);
  assert.equal(AFM["ing-groep-nv"].total_fines_eur, 775_000_000);
});

test("Datatilsynet Norway covers Meta behavioural ban and Grindr", () => {
  assert.ok(DATATILSYNET_NO["meta-platforms"]);
  assert.ok(DATATILSYNET_NO["grindr"]);
});

test("Finansinspektionen Sweden has Swedbank Baltic AML", () => {
  assert.ok(FI_SE["swedbank-ab"]);
  assert.ok(FI_SE["swedbank-ab"].total_fines_eur >= 300_000_000);
});

test("IMY Sweden has Spotify access-rights case", () => {
  assert.ok(IMY_SE["spotify"]);
  assert.ok(IMY_SE["spotify"].total_fines_eur >= 5_000_000);
});

test("APD Belgium covers Google right-to-be-forgotten", () => {
  assert.ok(APD_BE["google-alphabet"]);
});

test("AEPD Spain covers OpenAI investigation + CaixaBank", () => {
  assert.ok(AEPD["openai"]);
  assert.ok(AEPD["caixabank"]);
});

test("CNMC Spain covers Google + Amazon proceedings", () => {
  assert.ok(CNMC["google-alphabet"]);
  assert.ok(CNMC["amazon"]);
});

test("BfDI Germany covers Deutsche Telekom 1&1 case", () => {
  assert.ok(BFDI["deutsche-telekom-ag"]);
  assert.ok(BFDI["deutsche-telekom-ag"].total_fines_eur >= 9_000_000);
});

test("AMF France covers Morgan Stanley sovereign-bond case", () => {
  assert.ok(AMF["morgan-stanley"]);
  assert.equal(AMF["morgan-stanley"].total_fines_eur, 20_000_000);
});

test("FINMA covers Credit Suisse Archegos/Greensill", () => {
  assert.ok(FINMA["credit-suisse-ag"]);
});

test("WEKO covers BMW Swiss-imports cartel", () => {
  assert.ok(WEKO["bmw-usa"]);
});

test("Forbrukertilsynet covers Amazon Prime + TikTok", () => {
  assert.ok(FORBRUKERTILSYNET["amazon"]);
  assert.ok(FORBRUKERTILSYNET["bytedance"]);
});
