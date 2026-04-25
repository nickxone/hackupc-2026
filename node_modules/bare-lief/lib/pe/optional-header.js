const binding = require('#binding')

module.exports = exports = class PEOptionalHeader {
  constructor(binary) {
    this._binary = binary
  }

  get subsystem() {
    return binding.peOptionalHeaderGetSubsystem(this._binary._handle)
  }

  set subsystem(value) {
    binding.peOptionalHeaderSetSubsystem(this._binary._handle, value)
  }

  [Symbol.for('bare.inspect')]() {
    return {
      __proto__: { constructor: PEOptionalHeader },

      subsystem: this.subsystem
    }
  }
}

exports.SUBSYSTEM = {
  WINDOWS_GUI: binding.PE_OPTIONAL_HEADER_SUBSYSTEM_WINDOWS_GUI,
  WINDOWS_CUI: binding.PE_OPTIONAL_HEADER_SUBSYSTEM_WINDOWS_CUI
}
