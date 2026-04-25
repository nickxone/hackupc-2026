const binding = require('#binding')

module.exports = exports = class MachOSegmentCommand {
  constructor(name) {
    this._name = name

    this._handle = binding.machOSegmentCommandCreate(this._name)
  }

  get maxProtection() {
    return binding.machOSegmentCommandGetMaxProtection(this._handle)
  }

  set maxProtection(value) {
    binding.machOSegmentCommandSetMaxProtection(this._handle, value)
  }

  get initialProtection() {
    return binding.machOSegmentCommandGetInitialProtection(this._handle)
  }

  set initialProtection(value) {
    binding.machOSegmentCommandSetInitialProtection(this._handle, value)
  }

  addSection(section) {
    binding.machOSegmentCommandAddSection(this._handle, section._handle)
  }

  [Symbol.for('bare.inspect')]() {
    return {
      __proto__: { constructor: MachOSegmentCommand },

      name: this._name
    }
  }
}

exports.VM_PROTECTIONS = {
  READ: binding.MACHO_SEGMENT_COMMAND_VM_PROTECTIONS_READ,
  WRITE: binding.MACHO_SEGMENT_COMMAND_VM_PROTECTIONS_WRITE,
  EXECUTE: binding.MACHO_SEGMENT_COMMAND_VM_PROTECTIONS_EXECUTE
}
