const binding = require('#binding')

module.exports = exports = class ELFSymbol {
  constructor(name, opts = {}) {
    if (typeof name === 'object' && name !== null) {
      opts = name
      name = null
    }

    const { handle = binding.elfSymbolCreate(name) } = opts

    this._handle = handle
  }

  get type() {
    return binding.elfSymbolGetType(this._handle)
  }

  set type(value) {
    binding.elfSymbolSetType(this._handle, value)
  }

  get name() {
    return binding.elfSymbolGetName(this._handle)
  }

  set name(value) {
    binding.elfSymbolSetName(this._handle, value)
  }

  get value() {
    return binding.elfSymbolGetValue(this._handle)
  }

  set value(value) {
    binding.elfSymbolSetValue(this._handle, value)
  }

  get binding() {
    return binding.elfSymbolGetBinding(this._handle)
  }

  set binding(value) {
    binding.elfSymbolSetBinding(this._handle, value)
  }

  get sectionIndex() {
    return binding.elfSymbolGetSectionIndex(this._handle)
  }

  set sectionIndex(value) {
    binding.elfSymbolSetSectionIndex(this._handle, value)
  }

  [Symbol.for('bare.inspect')]() {
    return {
      __proto__: { constructor: ELFSymbol },

      name: this.name,
      value: this.value,
      binding: this.binding,
      sectionIndex: this.sectionIndex
    }
  }
}

exports.TYPE = {
  OBJECT: binding.ELF_SYMBOL_TYPE_OBJECT,
  FUNC: binding.ELF_SYMBOL_TYPE_FUNC,
  SECTION: binding.ELF_SYMBOL_TYPE_SECTION,
  FILE: binding.ELF_SYMBOL_TYPE_FILE,
  COMMON: binding.ELF_SYMBOL_TYPE_COMMON,
  TLS: binding.ELF_SYMBOL_TYPE_TLS
}

exports.BINDING = {
  LOCAL: binding.ELF_SYMBOL_BINDING_LOCAL,
  GLOBAL: binding.ELF_SYMBOL_BINDING_GLOBAL,
  WEAK: binding.ELF_SYMBOL_BINDING_WEAK
}
