import { BSON } from 'bson';
import { Types } from 'mongoose';

// Schema IDs and decoded SQL IDs must use the same constructor. Duplicate BSON
// package versions otherwise make equal IDs fail the query evaluator's checks.
export const ObjectId = Types.ObjectId;

function runtimeValue(value) {
  if (value?._bsontype === 'ObjectId') return new ObjectId(value.toHexString());
  if (value?._bsontype === 'BSONRegExp') return new RegExp(value.pattern, value.options);
  if (Array.isArray(value)) return value.map(runtimeValue);
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, runtimeValue(item)]));
  }
  return value;
}

export function parseStoredValue(value) {
  return runtimeValue(BSON.EJSON.parse(typeof value === 'string' ? value : JSON.stringify(value), { relaxed: true }));
}
