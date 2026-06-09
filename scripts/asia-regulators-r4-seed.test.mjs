#!/usr/bin/env node
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SAMR_CHINA, MIIT_CHINA, NDRC_CHINA, HK_SFC, TAIWAN_FTC,
  KFTC_R4, ISRAEL_COMP, OJK_INDONESIA,
} from "./asia-regulators-r4-seed.mjs";

test("SAMR covers the CNY 18.23B Alibaba antitrust fine", () => {
  assert.ok(SAMR_CHINA["alibaba-group"]);
  assert.ok(SAMR_CHINA["alibaba-group"].total_fines_cny >= 18_000_000_000);
});

test("SAMR covers Didi $1.2B cybersecurity penalty", () => {
  assert.ok(SAMR_CHINA["didi-global"]);
  assert.ok(SAMR_CHINA["didi-global"].total_fines_cny >= 8_000_000_000);
});

test("NDRC covers Qualcomm $975M 2015 fine", () => {
  assert.ok(NDRC_CHINA["qualcomm"]);
  assert.ok(NDRC_CHINA["qualcomm"].total_fines_cny >= 6_000_000_000);
});

test("HK SFC covers Goldman 1MDB $350M settlement", () => {
  assert.ok(HK_SFC["goldman-sachs"]);
  assert.ok(HK_SFC["goldman-sachs"].total_fines_hkd >= 2_000_000_000);
});

test("Taiwan FTC covers Qualcomm baseband case", () => {
  assert.ok(TAIWAN_FTC["qualcomm"]);
});

test("KFTC r4 covers Coupang ranking-manipulation fine", () => {
  assert.ok(KFTC_R4["coupang"]);
  assert.ok(KFTC_R4["coupang"].total_fines_krw >= 100_000_000_000);
});

test("MIIT app-rectification covers ByteDance + Tencent + Baidu", () => {
  assert.ok(MIIT_CHINA["bytedance"]);
  assert.ok(MIIT_CHINA["tencent-music-entertainment"]);
  assert.ok(MIIT_CHINA["baidu"]);
});

test("Israel Competition covers Google market study", () => {
  assert.ok(ISRAEL_COMP["google-alphabet"]);
});

test("OJK Indonesia covers Pertamina pricing oversight", () => {
  assert.ok(OJK_INDONESIA["pertamina"]);
});
