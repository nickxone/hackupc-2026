const binding = require('#binding')

module.exports = exports = class MachOLoadCommand {
  constructor(opts = {}) {
    const { handle } = opts

    this._handle = handle
  }

  get data() {
    return Buffer.from(binding.machOLoadCommandGetData(this._handle).buffer)
  }

  set data(value) {
    binding.machOLoadCommandSetData(this._handle, value)
  }

  [Symbol.for('bare.inspect')]() {
    return {
      __proto__: { constructor: MachOLoadCommand },

      data: this.data
    }
  }
}

exports.TYPE = {
  ID_DYLIB: binding.MACHO_LOAD_COMMAND_TYPE_ID_DYLIB,
  RPATH: binding.MACHO_LOAD_COMMAND_TYPE_RPATH
}
