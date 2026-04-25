const binding = require('#binding')
const MachOBinary = require('./binary')

module.exports = class MachOFatBinary {
  constructor(input, opts = {}) {
    if (typeof input === 'object' && input !== null && !Buffer.isBuffer(input)) {
      opts = input
      input = null
    }

    const { handle = binding.machOFatBinaryParse(input) } = opts

    this._binaries = []
    this._handle = handle

    for (let i = 0, n = binding.machOFatBinaryGetSize(this._handle); i < n; i++) {
      this._binaries.push(
        new MachOBinary({ handle: binding.machOFatBinaryGetAt(this, this._handle, i) })
      )
    }
  }

  get size() {
    return this._binaries.length
  }

  at(i) {
    return this._binaries[i]
  }

  static merge(binaries) {
    return new MachOFatBinary({
      handle: binding.machOFatBinaryMerge(binaries.map((binary) => binary._handle))
    })
  }

  toDisk(path) {
    binding.machOFatBinaryWrite(this._handle, path)
  }

  toBuffer() {
    return Buffer.from(binding.machOFatBinaryGetRaw(this._handle))
  }

  [Symbol.iterator]() {
    return this._binaries[Symbol.iterator]()
  }

  [Symbol.for('bare.inspect')]() {
    return {
      __proto__: { constructor: MachOFatBinary },

      binaries: this._binaries
    }
  }
}
