import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function rowToCombo(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    models: parseJson(row.models, []),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

let cachedCombos = null;
let cachedCombosTs = 0;
const COMBOS_CACHE_TTL_MS = 5000;

export function invalidateCombosCache() {
  cachedCombos = null;
  cachedCombosTs = 0;
}

export async function getCombos() {
  const now = Date.now();
  if (cachedCombos && (now - cachedCombosTs < COMBOS_CACHE_TTL_MS)) {
    return cachedCombos;
  }
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM combos ORDER BY createdAt ASC`);
  cachedCombos = rows.map(rowToCombo);
  cachedCombosTs = now;
  return cachedCombos;
}

export async function getComboById(id) {
  const combos = await getCombos();
  return combos.find(c => c.id === id) || null;
}

export async function getComboByName(name) {
  const combos = await getCombos();
  return combos.find(c => c.name === name) || null;
}

export async function createCombo(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const combo = {
    id: uuidv4(),
    name: data.name,
    kind: data.kind || null,
    models: data.models || [],
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
    [combo.id, combo.name, combo.kind, stringifyJson(combo.models), combo.createdAt, combo.updatedAt]
  );
  invalidateCombosCache();
  return combo;
}

export async function updateCombo(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToCombo(row), ...data, updatedAt: new Date().toISOString() };
    db.run(
      `UPDATE combos SET name = ?, kind = ?, models = ?, updatedAt = ? WHERE id = ?`,
      [merged.name, merged.kind, stringifyJson(merged.models || []), merged.updatedAt, id]
    );
    result = merged;
  });
  invalidateCombosCache();
  return result;
}

export async function deleteCombo(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM combos WHERE id = ?`, [id]);
  invalidateCombosCache();
  return (res?.changes ?? 0) > 0;
}
