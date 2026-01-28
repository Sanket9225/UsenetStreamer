"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ValueSet = void 0;
/**
 * Value set for handling unique collections
 */
class ValueSet {
    constructor() {
        this.existMap = new Map();
        this._values = [];
    }
    append(v) {
        if (!this.existMap.has(v)) {
            this.existMap.set(v, true);
            this._values.push(v);
        }
        return this;
    }
    exists(v) {
        return this.existMap.has(v);
    }
    get values() {
        return this._values;
    }
}
exports.ValueSet = ValueSet;
