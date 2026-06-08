#!/usr/bin/env node
/**
 * Tests for brazil-lista-suja-fetch.mjs (and the merger helpers).
 *
 * Uses node:test (built into Node 18+) — no extra deps. Runs against the
 * checked-in fixture at scripts/fixtures/brazil-lista-suja/sample.json.
 * NO network calls.
 *
 * Locally:
 *   node --test scripts/brazil-lista-suja-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  normalizePtName,
  normalizeCnpj,
  normalizeDate,
  stripHtml,
  parseCsv,
  shapeRow,
  dedupeRows,
} from "./brazil-lista-suja-fetch.mjs";

import {
  mergeSnapshot,
  matchEmployerToIndex,
  matchSupplyChainHint,
  nameVariants,
  SUPPLY_CHAIN_HINTS,
} from "./brazil-lista-suja-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/brazil-lista-suja/sample.json");

// ─────────────────────────── normalizers ────────────────────────────

test("normalizePtName strips Portuguese accents", () => {
  assert.equal(normalizePtName("Açúcar São João"), "acucar sao joao");
  // "Indústria" is in the suffix stripper, so it disappears entirely.
  assert.equal(normalizePtName("Indústria"), "");
  // "Fazenda" is also in the suffix stripper.
  assert.equal(normalizePtName("Fazenda Boa Vista"), "boa vista");
});

test("normalizePtName drops Brazilian corporate suffixes", () => {
  assert.equal(normalizePtName("Marfrig Ltda"), "marfrig");
  assert.equal(normalizePtName("Cargill S.A."), "cargill");
  assert.equal(normalizePtName("JBS S/A"), "jbs");
  assert.equal(normalizePtName("Bunge Cia."), "bunge");
});

test("normalizeCnpj keeps only the 14-digit core", () => {
  assert.equal(normalizeCnpj("12.345.678/0001-90"), "12345678000190");
  assert.equal(normalizeCnpj("12345678000190"), "12345678000190");
  assert.equal(normalizeCnpj("123"), "");
  assert.equal(normalizeCnpj(null), "");
});

test("normalizeDate handles BR DD/MM/YYYY and ISO", () => {
  assert.equal(normalizeDate("15/10/2025"), "2025-10-15");
  assert.equal(normalizeDate("2025-10-15"), "2025-10-15");
  assert.equal(normalizeDate("garbage"), "");
  assert.equal(normalizeDate(""), "");
});

test("stripHtml decodes accented entities", () => {
  assert.equal(stripHtml("<b>A&ccedil;a&iacute;</b>"), "Açaí");
  assert.equal(stripHtml("S&atilde;o&nbsp;Paulo"), "São Paulo");
});

// ─────────────────────────── CSV parser ─────────────────────────────

test("parseCsv handles semicolon-separated UTF-8 with quoted fields", () => {
  const csv = [
    "Empregador;CNPJ;Município;UF;Data de inclusão;Atividade econômica",
    'Fazenda Boa Vista;12.345.678/0001-90;Açailândia;MA;15/10/2025;"Pecuária bovina, com alojamento degradante"',
    "Cafeeira Serra Ltda;23.456.789/0001-80;Patrocínio;MG;15/10/2025;Cultivo de café",
  ].join("\n");
  const rows = parseCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]["empregador"], "Fazenda Boa Vista");
  assert.equal(rows[0]["uf"], "MA");
  assert.match(rows[0]["atividade econômica"], /alojamento degradante/);
});

test("shapeRow maps PT-BR column names to canonical shape", () => {
  const row = {
    "Empregador": "Marfrig Ltda",
    "CNPJ": "45.678.901/0001-60",
    "Município": "Várzea Grande",
    "UF": "MT",
    "Data de inclusão": "04/04/2025",
    "Atividade econômica": "Abate de bovinos",
    "Trabalhadores envolvidos": "33",
  };
  const shaped = shapeRow(row);
  assert.equal(shaped.employerName, "Marfrig Ltda");
  assert.equal(shaped.cnpj, "45678901000160");
  assert.equal(shaped.municipality, "Várzea Grande");
  assert.equal(shaped.state, "MT");
  assert.equal(shaped.addedDate, "2025-04-04");
  assert.equal(shaped.workersFreed, 33);
});

test("shapeRow returns null when employer is missing", () => {
  assert.equal(shapeRow({ "cnpj": "12345" }), null);
});

// ─────────────────────────── dedupe ─────────────────────────────────

test("dedupeRows collapses duplicates by CNPJ", () => {
  const rows = [
    { employerName: "JBS A", cnpj: "12345678000190", municipality: "X", state: "SP" },
    { employerName: "JBS A (variant)", cnpj: "12345678000190", municipality: "X", state: "SP", addedDate: "2025-10-15" },
    { employerName: "Marfrig", cnpj: "99999999000199", municipality: "Y", state: "MT" },
  ];
  const d = dedupeRows(rows);
  assert.equal(d.length, 2);
  // The row with more populated fields should win.
  const jbs = d.find((r) => r.cnpj === "12345678000190");
  assert.equal(jbs.addedDate, "2025-10-15");
});

test("dedupeRows falls back to name+municipality when CNPJ absent", () => {
  const rows = [
    { employerName: "Fazenda Boa Vista", cnpj: "", municipality: "Açailândia", state: "MA" },
    { employerName: "FAZENDA BOA VISTA", cnpj: "", municipality: "Açailândia", state: "MA" },
    { employerName: "Fazenda Boa Vista", cnpj: "", municipality: "Outro", state: "PA" },
  ];
  const d = dedupeRows(rows);
  assert.equal(d.length, 2);
});

// ─────────────────────────── fixture round-trip ─────────────────────

test("fixture is parseable + has 10 rows", async () => {
  const snap = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
  assert.equal(snap.rowCount, 10);
  assert.equal(snap.rows.length, 10);
  assert.ok(snap._license.includes("LAI 12527/2011"));
  for (const r of snap.rows) {
    assert.ok(r.employerName);
    assert.match(r.addedDate, /^\d{4}-\d{2}-\d{2}$/);
  }
});

// ─────────────────────────── merger ─────────────────────────────────

test("nameVariants produces a useful candidate list", () => {
  const v = nameVariants("Frigorífico JBS Cuiabá Indústria de Carnes Ltda");
  // Stripped form (without the leading "frigorifico") should start with jbs.
  assert.ok(v.some((x) => x.startsWith("jbs ")), `expected a 'jbs …' variant, got ${JSON.stringify(v)}`);
  // The 2-word window of the stripped form should be "jbs cuiaba".
  assert.ok(v.includes("jbs cuiaba"), `expected 'jbs cuiaba', got ${JSON.stringify(v)}`);
});

test("matchSupplyChainHint finds JBS / Marfrig / Cargill / Suzano / Bunge / Tyson", async () => {
  const snap = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
  const buckets = {};
  for (const r of snap.rows) {
    const b = matchSupplyChainHint(r.employerName);
    if (b) buckets[b] = (buckets[b] || 0) + 1;
  }
  assert.ok(buckets["jbs-n-v"] >= 1, "JBS bucket hit");
  assert.ok(buckets["marfrig-global-foods-s-a"] >= 1, "Marfrig bucket hit");
  assert.ok(buckets["cargill"] >= 1, "Cargill bucket hit");
  assert.ok(buckets["suzano-s-a"] >= 1, "Suzano bucket hit");
  assert.ok(buckets["bunge-global-sa"] >= 1, "Bunge bucket hit");
  assert.ok(buckets["tyson-foods"] >= 1, "Tyson bucket hit");
});

test("mergeSnapshot routes Cargill directly to cargill slug", async () => {
  const snap = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
  // Synthetic minimal index containing only the parent slugs we want
  // to confirm get matched directly.
  const index = [
    { slug: "cargill", name: "Cargill" },
    { slug: "tyson-foods", name: "Tyson Foods" },
  ];
  const parentMap = {};
  const { augment, stats } = mergeSnapshot(snap, { index, parentMap });
  // "Cargill Agrícola do Mato Grosso S.A." should normalize to start
  // with "cargill" which the variants logic will reduce to "cargill".
  assert.ok(augment["cargill"], "cargill slug should appear in augment");
  assert.equal(augment["cargill"].forcedLaborListings.length, 1);
  assert.ok(stats.directMatches >= 1);
});

test("mergeSnapshot counts supply-chain hints separately from matches", async () => {
  const snap = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
  // Empty index — so every JBS/Marfrig/Suzano/Bunge/Tyson row falls
  // through to the supply-chain-hint bucket.
  const { augment, stats } = mergeSnapshot(snap, { index: [], parentMap: {} });
  assert.equal(Object.keys(augment).length, 0);
  // 10 fixture rows: 2 are non-branded (carvoaria, usina, fazenda) and
  // wouldn't be expected to hit a SC hint OR match. The remaining 7-8
  // should land in supply-chain buckets.
  assert.ok(stats.supplyChainMatches >= 5, `expected ≥5 SC hits, got ${stats.supplyChainMatches}`);
});

test("SUPPLY_CHAIN_HINTS includes orphan buckets for unmatched parents", () => {
  // BRF / Vale / ADM / Louis Dreyfus aren't in the TruNorth index yet.
  // They're tracked as "_orphan:..." keys so the merge log surfaces
  // potential supply-chain exposure honestly.
  assert.ok(SUPPLY_CHAIN_HINTS["_orphan:brf"]);
  assert.ok(SUPPLY_CHAIN_HINTS["_orphan:vale"]);
});
