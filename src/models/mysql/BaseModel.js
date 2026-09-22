// src/models/mysql/BaseModel.js
import crypto from "crypto";
import { query, execute } from "../../config/mysql.js";

export function generateObjectId() {
  return crypto.randomBytes(12).toString("hex");
}

function parseJsonSafe(val) {
  if (val === null || val === undefined) return val;
  if (typeof val === "object") return val;
  try {
    return JSON.parse(val);
  } catch {
    return val;
  }
}

function stringifyJsonSafe(val) {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val === "string") {
    try {
      JSON.parse(val);
      return val;
    } catch {
      return JSON.stringify(val);
    }
  }
  try {
    return JSON.stringify(val);
  } catch {
    return null;
  }
}

const tableColumnsCache = new Map();

export async function getTableColumns(tableName) {
  if (!tableName) return null;
  if (tableColumnsCache.has(tableName)) {
    return tableColumnsCache.get(tableName);
  }
  try {
    const [rows] = await query(`SHOW COLUMNS FROM \`${tableName}\``);
    const cols = new Set((rows || []).map((r) => r.Field));
    tableColumnsCache.set(tableName, cols);
    return cols;
  } catch (err) {
    console.warn(`Could not get columns for ${tableName}:`, err.message);
    return null;
  }
}

/**
 * Builds a WHERE clause from a MongoDB-style filter object.
 */
function buildWhereClause(filter = {}, tableName = "") {
  if (!filter || Object.keys(filter).length === 0) {
    return { whereSql: "", params: [] };
  }

  const conditions = [];
  const params = [];

  for (const [rawKey, rawValue] of Object.entries(filter)) {
    if (rawKey === "$or" && Array.isArray(rawValue)) {
      const orClauses = [];
      for (const branch of rawValue) {
        const branchResult = buildWhereClause(branch, tableName);
        if (branchResult.whereSql) {
          orClauses.push(branchResult.whereSql.replace(/^WHERE\s+/, ""));
          params.push(...branchResult.params);
        }
      }
      if (orClauses.length > 0) {
        conditions.push(`(${orClauses.join(" OR ")})`);
      }
      continue;
    }

    if (rawKey === "$and" && Array.isArray(rawValue)) {
      const andClauses = [];
      for (const branch of rawValue) {
        const branchResult = buildWhereClause(branch, tableName);
        if (branchResult.whereSql) {
          andClauses.push(branchResult.whereSql.replace(/^WHERE\s+/, ""));
          params.push(...branchResult.params);
        }
      }
      if (andClauses.length > 0) {
        conditions.push(`(${andClauses.join(" AND ")})`);
      }
      continue;
    }

    let colSql = "";
    if (rawKey === "_id") {
      colSql = "`id`";
    } else if (rawKey.includes(".")) {
      const parts = rawKey.split(".");
      const mainCol = parts[0];
      const jsonPath = parts.slice(1).map((p) => (!isNaN(p) ? `[${p}]` : `.${p}`)).join("");
      colSql = `JSON_EXTRACT(\`${mainCol}\`, '$${jsonPath}')`;
    } else {
      colSql = `\`${rawKey}\``;
    }

    if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) && !(rawValue instanceof Date)) {
      // Operator object like { $ne: null }, { $in: [...] }, { $gt: ... }
      for (const [op, opVal] of Object.entries(rawValue)) {
        if (op === "$ne") {
          if (opVal === null) {
            conditions.push(`${colSql} IS NOT NULL`);
          } else {
            conditions.push(`(${colSql} != ? OR ${colSql} IS NULL)`);
            params.push(opVal);
          }
        } else if (op === "$in" && Array.isArray(opVal)) {
          if (opVal.length === 0) {
            conditions.push("1 = 0");
          } else {
            const nonNull = opVal.filter((v) => v !== null && v !== undefined);
            const hasNull = opVal.includes(null);
            const orParts = [];
            if (nonNull.length > 0) {
              const placeholders = nonNull.map(() => "?").join(", ");
              orParts.push(`${colSql} IN (${placeholders})`);
              params.push(...nonNull);
            }
            if (hasNull) {
              orParts.push(`${colSql} IS NULL`);
            }
            conditions.push(`(${orParts.join(" OR ")})`);
          }
        } else if (op === "$nin" && Array.isArray(opVal)) {
          const nonNull = opVal.filter((v) => v !== null && v !== undefined);
          const hasNull = opVal.includes(null);
          const andParts = [];
          if (nonNull.length > 0) {
            const placeholders = nonNull.map(() => "?").join(", ");
            andParts.push(`${colSql} NOT IN (${placeholders})`);
            params.push(...nonNull);
          }
          if (hasNull) {
            andParts.push(`${colSql} IS NOT NULL`);
          }
          if (andParts.length > 0) {
            conditions.push(`(${andParts.join(" AND ")})`);
          }
        } else if (op === "$gt") {
          conditions.push(`${colSql} > ?`);
          params.push(opVal instanceof Date ? opVal : opVal);
        } else if (op === "$gte") {
          conditions.push(`${colSql} >= ?`);
          params.push(opVal instanceof Date ? opVal : opVal);
        } else if (op === "$lt") {
          conditions.push(`${colSql} < ?`);
          params.push(opVal instanceof Date ? opVal : opVal);
        } else if (op === "$lte") {
          conditions.push(`${colSql} <= ?`);
          params.push(opVal instanceof Date ? opVal : opVal);
        } else if (op === "$exists") {
          conditions.push(opVal ? `${colSql} IS NOT NULL` : `${colSql} IS NULL`);
        } else if (op === "$regex") {
          conditions.push(`${colSql} REGEXP ?`);
          params.push(typeof opVal === "string" ? opVal : opVal.source);
        }
      }
    } else if (rawValue === null) {
      conditions.push(`${colSql} IS NULL`);
    } else if (rawValue === undefined) {
      // Ignore undefined query values
    } else {
      // Exact equality. For email, compare case-insensitively
      if (rawKey === "email") {
        conditions.push(`LOWER(${colSql}) = LOWER(?)`);
        params.push(String(rawValue));
      } else if (typeof rawValue === "boolean") {
        conditions.push(`${colSql} = ?`);
        params.push(rawValue ? 1 : 0);
      } else {
        conditions.push(`${colSql} = ?`);
        params.push(rawValue);
      }
    }
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return { whereSql, params };
}

/**
 * Thenable Query class allowing .sort(), .limit(), .skip(), .select(), .lean(), and await
 */
export class QueryPromise {
  constructor(model, filter = {}, single = false) {
    this.model = model;
    this.filter = filter;
    this.single = single;
    this._sort = null;
    this._limit = single ? 1 : null;
    this._skip = null;
    this._select = null;
    this._lean = false;
    this._populates = [];
  }

  populate(field, select) {
    if (typeof field === "string") {
      this._populates.push({ path: field, select });
    } else if (field && typeof field === "object") {
      this._populates.push({ path: field.path, select: field.select });
    }
    return this;
  }

  sort(arg) {
    if (typeof arg === "string") {
      const parts = arg.trim().split(/\s+/);
      const orders = parts.map((p) => {
        const col = p.startsWith("-") ? p.slice(1) : p;
        const mappedCol = col === "_id" ? "id" : col;
        return `\`${mappedCol}\` ${p.startsWith("-") ? "DESC" : "ASC"}`;
      });
      this._sort = orders.join(", ");
    } else if (arg && typeof arg === "object") {
      const orders = Object.entries(arg).map(([k, dir]) => {
        const mappedCol = k === "_id" ? "id" : k;
        return `\`${mappedCol}\` ${dir === -1 || dir === "desc" ? "DESC" : "ASC"}`;
      });
      this._sort = orders.join(", ");
    }
    return this;
  }

  limit(n) {
    this._limit = Number(n);
    return this;
  }

  skip(n) {
    this._skip = Number(n);
    return this;
  }

  select(fields) {
    this._select = fields;
    return this;
  }

  lean() {
    this._lean = true;
    return this;
  }

  async exec() {
    const { whereSql, params } = buildWhereClause(this.filter, this.model.tableName);
    let sql = `SELECT * FROM \`${this.model.tableName}\` ${whereSql}`;

    if (this._sort) {
      sql += ` ORDER BY ${this._sort}`;
    }
    if (this._limit !== null) {
      sql += ` LIMIT ${this._limit}`;
      if (this._skip !== null) {
        sql += ` OFFSET ${this._skip}`;
      }
    } else if (this._skip !== null) {
      sql += ` LIMIT 18446744073709551615 OFFSET ${this._skip}`;
    }

    const [rows] = await query(sql, params);

    const hydrateAndPopulate = async (r) => {
      const doc = this.model.hydrate(r);
      for (const pop of this._populates) {
        await doc.populate(pop.path, pop.select);
      }
      return this._lean ? doc.toObject() : doc;
    };

    if (this.single) {
      if (!rows || rows.length === 0) return null;
      return await hydrateAndPopulate(rows[0]);
    }

    const docs = [];
    for (const r of rows || []) {
      docs.push(await hydrateAndPopulate(r));
    }
    return docs;
  }

  then(resolve, reject) {
    return this.exec().then(resolve, reject);
  }

  catch(reject) {
    return this.exec().catch(reject);
  }

  finally(callback) {
    return this.exec().finally(callback);
  }
}

/**
 * Thenable Query class for findOneAndUpdate / findByIdAndUpdate
 * Supports .select(), .populate(), .lean(), and await
 */
export class FindAndUpdateQueryPromise {
  constructor(model, filter, update, options = { new: true }) {
    this.model = model;
    this.filter = filter;
    this.update = update;
    this.options = options || { new: true };
    this._select = null;
    this._populates = [];
    this._lean = false;
  }

  select(fields) {
    this._select = fields;
    return this;
  }

  populate(field, select) {
    if (typeof field === "string") {
      this._populates.push({ path: field, select });
    } else if (field && typeof field === "object") {
      this._populates.push({ path: field.path, select: field.select });
    }
    return this;
  }

  lean() {
    this._lean = true;
    return this;
  }

  async exec() {
    const isNew =
      this.options.new === true ||
      this.options.returnDocument === "after" ||
      this.options.returnOriginal === false;

    let beforeDoc = null;
    if (!isNew) {
      beforeDoc = await this.model.findOne(this.filter);
    }

    await this.model.updateOne(this.filter, this.update);

    let doc = null;
    if (!isNew) {
      doc = beforeDoc;
    } else {
      doc = await this.model.findOne(this.filter);
    }

    if (!doc) return null;

    for (const pop of this._populates) {
      await doc.populate(pop.path, pop.select);
    }

    if (this._select && typeof this._select === "string") {
      const parts = this._select.trim().split(/\s+/).filter(Boolean);
      const isExclusion = parts.length > 0 && parts.every((p) => p.startsWith("-"));
      if (isExclusion) {
        for (const p of parts) {
          delete doc[p.slice(1)];
        }
      }
    }

    return this._lean ? (doc.toObject ? doc.toObject() : doc) : doc;
  }

  then(resolve, reject) {
    return this.exec().then(resolve, reject);
  }

  catch(reject) {
    return this.exec().catch(reject);
  }

  finally(callback) {
    return this.exec().finally(callback);
  }
}


export class BaseModel {
  static tableName = "";
  static jsonFields = [];
  static booleanFields = [];

  constructor(data = {}) {
    Object.assign(this, data);
    if (!this.id && !this._id) {
      this.id = generateObjectId();
      this._id = this.id;
    } else {
      this.id = this.id || this._id;
      this._id = this.id;
    }
  }

  static hydrate(raw) {
    if (!raw) return null;
    const data = { ...raw };

    data._id = data.id;

    for (const jf of this.jsonFields) {
      if (data[jf] !== undefined) {
        data[jf] = parseJsonSafe(data[jf]);
      }
    }

    for (const bf of this.booleanFields) {
      if (data[bf] !== undefined && data[bf] !== null) {
        data[bf] = Boolean(data[bf]);
      }
    }

    return new this(data);
  }

  toObject() {
    const obj = { ...this };
    obj._id = this.id || this._id;
    return obj;
  }

  toJSON() {
    return this.toObject();
  }

  async populate(path, select) {
    if (!path) return this;
    const val = this[path];
    if (!val || typeof val === "object") return this;

    // By default, lookup referenced User from 'users' table
    try {
      const [rows] = await query("SELECT * FROM `users` WHERE `id` = ? LIMIT 1", [String(val)]);
      if (rows && rows.length > 0) {
        const rawUser = rows[0];
        rawUser._id = rawUser.id;
        delete rawUser.password;
        if (select && typeof select === "string") {
          const wantedFields = select.split(/\s+/).filter(Boolean);
          const filtered = { _id: rawUser.id, id: rawUser.id };
          for (const f of wantedFields) {
            if (f.startsWith("-")) {
              delete rawUser[f.slice(1)];
            } else {
              filtered[f] = rawUser[f];
            }
          }
          this[path] = wantedFields.some((f) => !f.startsWith("-")) ? filtered : rawUser;
        } else {
          this[path] = rawUser;
        }
      }
    } catch {
      // Fallback: leave as-is if lookup fails
    }
    return this;
  }

  static find(filter = {}) {
    return new QueryPromise(this, filter, false);
  }

  static findOne(filter = {}) {
    return new QueryPromise(this, filter, true);
  }

  static findById(id) {
    const idStr = id && typeof id === "object" && id.toString ? id.toString() : String(id);
    return new QueryPromise(this, { _id: idStr }, true);
  }

  static async countDocuments(filter = {}) {
    const { whereSql, params } = buildWhereClause(filter, this.tableName);
    const sql = `SELECT COUNT(*) AS count FROM \`${this.tableName}\` ${whereSql}`;
    const [rows] = await query(sql, params);
    return Number(rows[0]?.count || 0);
  }

  static async exists(filter = {}) {
    const doc = await this.findOne(filter);
    return doc ? { _id: doc._id || doc.id } : null;
  }

  static async distinct(field, filter = {}) {
    const col = field === "_id" ? "id" : field;
    const { whereSql, params } = buildWhereClause(filter, this.tableName);
    const sql = `SELECT DISTINCT \`${col}\` AS val FROM \`${this.tableName}\` ${whereSql}`;
    const [rows] = await query(sql, params);
    return (rows || []).map((r) => r.val).filter((v) => v !== null && v !== undefined);
  }

  static async aggregate(pipeline = []) {
    try {
      if (this.tableName === "messages" && pipeline.length > 0) {
        const match = pipeline.find((p) => p.$match)?.$match || {};
        const { whereSql, params } = buildWhereClause(match, this.tableName);
        const sql = `SELECT senderId AS _id, COUNT(DISTINCT chatId) AS patientConversationCount FROM \`${this.tableName}\` ${whereSql} GROUP BY senderId`;
        const [rows] = await query(sql, params);
        return rows || [];
      }
      return [];
    } catch (err) {
      console.warn(`⚠️ Aggregate fallback on ${this.tableName}:`, err.message);
      return [];
    }
  }

  static async create(docOrDocs) {
    if (Array.isArray(docOrDocs)) {
      const results = [];
      for (const d of docOrDocs) {
        results.push(await this.create(d));
      }
      return results;
    }

    const instance = new this(docOrDocs);
    await instance.save();
    return instance;
  }

  static async insertMany(docs) {
    return this.create(docs);
  }

  async save() {
    const record = { ...this };
    const id = record.id || record._id || generateObjectId();
    record.id = id;
    record._id = id;

    // Serialize JSON fields
    for (const jf of this.constructor.jsonFields) {
      if (record[jf] !== undefined) {
        record[jf] = stringifyJsonSafe(record[jf]);
      }
    }

    // Convert booleans
    for (const bf of this.constructor.booleanFields) {
      if (record[bf] !== undefined && record[bf] !== null) {
        record[bf] = record[bf] ? 1 : 0;
      }
    }

    const now = new Date();
    if (!record.createdAt) record.createdAt = now;
    record.updatedAt = now;

    // Convert numerical timestamps to Date for datetime columns
    for (const key of Object.keys(record)) {
      const v = record[key];
      if (
        typeof v === "number" &&
        v > 100000000000 &&
        (key.endsWith("At") || key.endsWith("Date") || key.endsWith("Time"))
      ) {
        record[key] = new Date(v);
      }
    }

    const knownCols = await getTableColumns(this.constructor.tableName);

    // Filter out undefined, functions, _id (stored as id), and non-existent columns
    const validKeys = Object.keys(record).filter(
      (k) =>
        k !== "_id" &&
        typeof record[k] !== "function" &&
        record[k] !== undefined &&
        (!knownCols || knownCols.has(k))
    );

    const cols = validKeys.map((k) => `\`${k}\``).join(", ");
    const placeholders = validKeys.map(() => "?").join(", ");
    const updates = validKeys.map((k) => `\`${k}\` = VALUES(\`${k}\`)`).join(", ");
    const values = validKeys.map((k) => record[k]);

    const sql = `INSERT INTO \`${this.constructor.tableName}\` (${cols}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updates}`;
    await execute(sql, values);

    this.id = id;
    this._id = id;
    return this;
  }

  static findByIdAndUpdate(id, update, options = { new: true }) {
    const idStr = id && typeof id === "object" && id.toString ? id.toString() : String(id);
    return this.findOneAndUpdate({ _id: idStr }, update, options);
  }

  static findOneAndUpdate(filter, update, options = { new: true }) {
    return new FindAndUpdateQueryPromise(this, filter, update, options);
  }

  static async updateOne(filter, update) {
    const { whereSql, params: whereParams } = buildWhereClause(filter, this.tableName);
    if (!whereSql) throw new Error("Refusing to update without a WHERE condition");

    const updateFields = {};
    if (update.$set) {
      Object.assign(updateFields, update.$set);
    }
    if (update.$unset) {
      for (const k of Object.keys(update.$unset)) {
        updateFields[k] = null;
      }
    }
    for (const [k, v] of Object.entries(update)) {
      if (!k.startsWith("$")) {
        updateFields[k] = v;
      }
    }

    // Check for dot-notation keys, $push, or $inc
    const dotKeys = Object.keys(updateFields).filter((k) => k.includes("."));
    let existing = null;
    if (dotKeys.length > 0 || update.$push || update.$inc) {
      existing = await this.findOne(filter);
    }

    // Handle dot-notation keys in updateFields (e.g. "locationData.current")
    if (dotKeys.length > 0) {
      if (existing) {
        for (const dottedKey of dotKeys) {
          const val = updateFields[dottedKey];
          delete updateFields[dottedKey];

          const parts = dottedKey.split(".");
          const rootCol = parts[0];
          if (!existing[rootCol] || typeof existing[rootCol] !== "object") {
            existing[rootCol] = {};
          }
          let target = existing[rootCol];
          for (let i = 1; i < parts.length - 1; i++) {
            const p = parts[i];
            if (!target[p] || typeof target[p] !== "object") {
              target[p] = {};
            }
            target = target[p];
          }
          target[parts[parts.length - 1]] = val;
          updateFields[rootCol] = existing[rootCol];
        }
      } else {
        for (const dottedKey of dotKeys) {
          delete updateFields[dottedKey];
        }
      }
    }

    // Handle $push (e.g. locationData.history)
    if (update.$push && existing) {
      for (const [fieldPath, pushVal] of Object.entries(update.$push)) {
        const parts = fieldPath.split(".");
        let target = existing;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!target[parts[i]]) target[parts[i]] = {};
          target = target[parts[i]];
        }
        const lastKey = parts[parts.length - 1];
        if (!Array.isArray(target[lastKey])) target[lastKey] = [];
        if (pushVal && pushVal.$each && Array.isArray(pushVal.$each)) {
          target[lastKey].push(...pushVal.$each);
          if (pushVal.$slice && typeof pushVal.$slice === "number") {
            target[lastKey] = target[lastKey].slice(pushVal.$slice);
          }
        } else {
          target[lastKey].push(pushVal);
        }
        updateFields[parts[0]] = existing[parts[0]];
      }
    }

    // Handle $inc
    if (update.$inc && existing) {
      for (const [k, incVal] of Object.entries(update.$inc)) {
        updateFields[k] = (Number(existing[k]) || 0) + Number(incVal);
      }
    }

    const knownCols = await getTableColumns(this.tableName);

    const setClauses = [];
    const setParams = [];

    updateFields.updatedAt = new Date();

    for (const [rawCol, rawVal] of Object.entries(updateFields)) {
      const col = rawCol === "_id" ? "id" : rawCol;
      if (knownCols && !knownCols.has(col)) {
        continue;
      }
      let val = rawVal;

      if (this.jsonFields.includes(col)) {
        val = stringifyJsonSafe(val);
      } else if (this.booleanFields.includes(col) && val !== null && val !== undefined) {
        val = val ? 1 : 0;
      } else if (
        typeof val === "number" &&
        val > 100000000000 &&
        (col.endsWith("At") || col.endsWith("Date") || col.endsWith("Time"))
      ) {
        val = new Date(val);
      }

      setClauses.push(`\`${col}\` = ?`);
      setParams.push(val);
    }

    if (setClauses.length === 0) return { acknowledged: true, modifiedCount: 0, matchedCount: 0 };

    const sql = `UPDATE \`${this.tableName}\` SET ${setClauses.join(", ")} ${whereSql} LIMIT 1`;
    const [result] = await execute(sql, [...setParams, ...whereParams]);
    const affected = Number(result?.affectedRows || 0);
    return { acknowledged: true, modifiedCount: affected, matchedCount: affected };
  }

  static async updateMany(filter, update) {
    const { whereSql, params: whereParams } = buildWhereClause(filter, this.tableName);
    if (!whereSql) throw new Error("Refusing to update without a WHERE condition");

    const updateFields = {};
    if (update.$set) Object.assign(updateFields, update.$set);
    if (update.$unset) {
      for (const k of Object.keys(update.$unset)) updateFields[k] = null;
    }
    for (const [k, v] of Object.entries(update)) {
      if (!k.startsWith("$")) updateFields[k] = v;
    }

    // Strip any dot keys to avoid SQL column syntax errors
    const dotKeys = Object.keys(updateFields).filter((k) => k.includes("."));
    if (dotKeys.length > 0) {
      for (const dk of dotKeys) delete updateFields[dk];
    }

    const knownCols = await getTableColumns(this.tableName);

    updateFields.updatedAt = new Date();

    const setClauses = [];
    const setParams = [];

    for (const [rawCol, rawVal] of Object.entries(updateFields)) {
      const col = rawCol === "_id" ? "id" : rawCol;
      if (knownCols && !knownCols.has(col)) {
        continue;
      }
      let val = rawVal;
      if (this.jsonFields.includes(col)) {
        val = stringifyJsonSafe(val);
      } else if (this.booleanFields.includes(col) && val !== null && val !== undefined) {
        val = val ? 1 : 0;
      } else if (
        typeof val === "number" &&
        val > 100000000000 &&
        (col.endsWith("At") || col.endsWith("Date") || col.endsWith("Time"))
      ) {
        val = new Date(val);
      }
      setClauses.push(`\`${col}\` = ?`);
      setParams.push(val);
    }

    if (setClauses.length === 0) return { acknowledged: true, modifiedCount: 0, matchedCount: 0 };

    const sql = `UPDATE \`${this.tableName}\` SET ${setClauses.join(", ")} ${whereSql}`;
    const [result] = await execute(sql, [...setParams, ...whereParams]);
    const affected = Number(result?.affectedRows || 0);
    return { acknowledged: true, modifiedCount: affected, matchedCount: affected };
  }

  static async deleteOne(filter) {
    const { whereSql, params } = buildWhereClause(filter, this.tableName);
    if (!whereSql) return { acknowledged: true, deletedCount: 0 };
    const sql = `DELETE FROM \`${this.tableName}\` ${whereSql} LIMIT 1`;
    const [result] = await execute(sql, params);
    const affected = Number(result?.affectedRows || 0);
    return { acknowledged: true, deletedCount: affected };
  }

  static async deleteMany(filter) {
    const { whereSql, params } = buildWhereClause(filter, this.tableName);
    if (!whereSql) return { acknowledged: true, deletedCount: 0 };
    const sql = `DELETE FROM \`${this.tableName}\` ${whereSql}`;
    const [result] = await execute(sql, params);
    const affected = Number(result?.affectedRows || 0);
    return { acknowledged: true, deletedCount: affected };
  }

  static async findByIdAndDelete(id) {
    const idStr = id && typeof id === "object" && id.toString ? id.toString() : String(id);
    const doc = await this.findById(idStr);
    await this.deleteOne({ _id: idStr });
    return doc;
  }

  static async findOneAndDelete(filter) {
    const doc = await this.findOne(filter);
    if (doc) {
      await this.deleteOne(filter);
    }
    return doc;
  }
}

export default BaseModel;
