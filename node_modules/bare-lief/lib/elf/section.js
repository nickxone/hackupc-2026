const binding = require('#binding')

module.exports = exports = class ELFSection {
  constructor(name, opts = {}) {
    if (typeof name === 'object' && name !== null) {
      opts = name
      name = null
    }

    const { handle = binding.elfSectionCreate(name) } = opts

    this._handle = handle
  }

  get type() {
    return binding.elfSectionGetType(this._handle)
  }

  set type(value) {
    binding.elfSectionSetType(this._handle, value)
  }

  get flags() {
    return binding.elfSectionGetFlags(this._handle)
  }

  set flags(value) {
    binding.elfSectionSetFlags(this._handle, value)
  }

  get alignment() {
    return binding.elfSectionGetAlignment(this._handle)
  }

  set alignment(value) {
    binding.elfSectionSetAlignment(this._handle, value)
  }

  get content() {
    return Buffer.from(binding.elfSectionGetContent(this._handle))
  }

  set content(value) {
    binding.elfSectionSetContent(this._handle, value)
  }

  get size() {
    return binding.elfSectionGetSize(this._handle)
  }

  set size(value) {
    binding.elfSectionSetSize(this._handle, value)
  }

  get virtualAddress() {
    return binding.elfSectionGetVirtualAddress(this._handle)
  }

  set virtualAddress(value) {
    binding.elfSectionSetVirtualAddress(this._handle, value)
  }

  [Symbol.for('bare.inspect')]() {
    return {
      __proto__: { constructor: ELFSection },

      type: this.type,
      flags: this.flags,
      alignment: this.alignment,
      content: this.content,
      size: this.size,
      virtualAddress: this.virtualAddress
    }
  }
}

exports.FLAGS = {
  WRITE: binding.ELF_SECTION_FLAGS_WRITE,
  ALLOC: binding.ELF_SECTION_FLAGS_ALLOC,
  EXECINSTR: binding.ELF_SECTION_FLAGS_EXECINSTR
}
