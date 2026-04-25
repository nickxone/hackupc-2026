const binding = require('#binding')

module.exports = class MachOSection {
  constructor(name, content) {
    this._name = name

    this._handle = binding.machOSectionCreate(name, content)
  }

  [Symbol.for('bare.inspect')]() {
    return {
      __proto__: { constructor: MachOSection },

      name: this._name
    }
  }
}
