#!/usr/bin/env node
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COFECE_R4, IFT_MEXICO, CNDC_ARGENTINA, FNE_CHILE, SIC_COLOMBIA, INDECOPI,
} from "./latam-regulators-r4-seed.mjs";

test("COFECE r4 covers Amazon + Walmex Mexico", () => {
  assert.ok(COFECE_R4["amazon"]);
  assert.ok(COFECE_R4["walmart"]);
});

test("IFT Mexico flags América Móvil preponderant-agent status", () => {
  assert.ok(IFT_MEXICO["america-movil-sab-de-cv"]);
  assert.ok(IFT_MEXICO["america-movil-sab-de-cv"].total_fines_mxn >= 6_000_000_000);
});

test("FNE Chile covers Walmart + Enel", () => {
  assert.ok(FNE_CHILE["walmart"]);
  assert.ok(FNE_CHILE["enel-chile-s-a"]);
});

test("SIC Colombia + INDECOPI Peru have at least 1 case each", () => {
  assert.ok(Object.keys(SIC_COLOMBIA).length >= 1);
  assert.ok(Object.keys(INDECOPI).length >= 1);
});

test("CNDC Argentina covers Google market study", () => {
  assert.ok(CNDC_ARGENTINA["google-alphabet"]);
});
