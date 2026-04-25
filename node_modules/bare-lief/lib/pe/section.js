const binding = require('#binding')

module.exports = exports = class PESection {
  constructor(name, opts = {}) {
    if (typeof name === 'object' && name !== null) {
      opts = name
      name = null
    }

    const { handle = binding.peSectionCreate(name) } = opts

    this._handle = handle
  }

  get characteristics() {
    return binding.peSectionGetCharacteristics(this._handle)
  }

  set characteristics(value) {
    binding.peSectionSetCharacteristics(this._handle, value)
  }

  get content() {
    return Buffer.from(binding.peSectionGetContent(this._handle))
  }

  set content(value) {
    binding.peSectionSetContent(this._handle, value)
  }

  get size() {
    return binding.peSectionGetSize(this._handle)
  }

  set size(value) {
    binding.peSectionSetSize(this._handle, value)
  }

  [Symbol.for('bare.inspect')]() {
    return {
      __proto__: { constructor: PESection },

      characteristics: this.characteristics,
      content: this.content,
      size: this.size
    }
  }
}

exports.CHARACTERISTICS = {
  CNT_CODE: binding.PE_SECTION_CHARACTERISTICS_CNT_CODE,
  CNT_INITIALIZED_DATA: binding.PE_SECTION_CHARACTERISTICS_CNT_INITIALIZED_DATA,
  CNT_UNINITIALIZED_DATA: binding.PE_SECTION_CHARACTERISTICS_CNT_UNINITIALIZED_DATA,
  MEM_SHARED: binding.PE_SECTION_CHARACTERISTICS_MEM_SHARED,
  MEM_EXECUTE: binding.PE_SECTION_CHARACTERISTICS_MEM_EXECUTE,
  MEM_READ: binding.PE_SECTION_CHARACTERISTICS_MEM_READ,
  MEM_WRITE: binding.PE_SECTION_CHARACTERISTICS_MEM_WRITE
}
