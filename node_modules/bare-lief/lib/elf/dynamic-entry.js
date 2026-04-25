const binding = require('#binding')

class ELFDynamicEntry {
  constructor(opts = {}) {
    const { handle } = opts

    this._handle = handle
  }

  [Symbol.for('bare.inspect')]() {
    return {
      __proto__: { constructor: ELFDynamicEntry }
    }
  }
}

module.exports = exports = ELFDynamicEntry

exports.TAG = {
  NEEDED: binding.ELF_DYNAMIC_ENTRY_TAG_NEEDED,
  SONAME: binding.ELF_DYNAMIC_ENTRY_TAG_SONAME,
  RUNPATH: binding.ELF_DYNAMIC_ENTRY_TAG_RUNPATH
}

exports.SharedObject = class ELFDynamicSharedObject extends ELFDynamicEntry {
  constructor(name, opts = {}) {
    if (typeof name === 'object' && name !== null) {
      opts = name
      name = null
    }

    const { handle = binding.elfDynamicSharedObjectCreate(name) } = opts

    super({ handle })
  }

  get name() {
    return binding.elfDynamicSharedObjectGetName(this._handle)
  }

  set name(value) {
    binding.elfDynamicSharedObjectSetName(this._handle, value)
  }

  [Symbol.for('bare.inspect')]() {
    return {
      __proto__: { constructor: ELFDynamicSharedObject },

      name: this.name
    }
  }
}

exports.Library = class ELFDynamicEntryLibrary extends ELFDynamicEntry {
  constructor(name, opts = {}) {
    if (typeof name === 'object' && name !== null) {
      opts = name
      name = null
    }

    const { handle = binding.elfDynamicEntryLibraryCreate(name) } = opts

    super({ handle })
  }

  get name() {
    return binding.elfDynamicEntryLibraryGetName(this._handle)
  }

  set name(value) {
    binding.elfDynamicEntryLibrarySetName(this._handle, value)
  }

  [Symbol.for('bare.inspect')]() {
    return {
      __proto__: { constructor: ELFDynamicEntryLibrary },

      name: this.name
    }
  }
}

exports.RunPath = class ELFDynamicEntryRunPath extends ELFDynamicEntry {
  constructor(path, opts = {}) {
    if (typeof path === 'object' && path !== null) {
      opts = path
      path = null
    }

    const { handle = binding.elfDynamicEntryRunPathCreate(path) } = opts

    super({ handle })
  }

  get runpath() {
    return binding.elfDynamicEntryRunPathGetRunPath(this._handle)
  }

  set runpath(value) {
    binding.elfDynamicEntryRunPathSetRunPath(this._handle, value)
  }

  [Symbol.for('bare.inspect')]() {
    return {
      __proto__: { constructor: ELFDynamicEntryRunPath },

      runpath: this.runpath
    }
  }
}
