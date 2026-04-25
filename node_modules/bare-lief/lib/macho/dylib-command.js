const binding = require('#binding')
const MachOLoadCommand = require('./load-command')

module.exports = class MachODylibCommand extends MachOLoadCommand {
  get name() {
    return binding.machODylibCommandGetName(this._handle)
  }

  set name(value) {
    binding.machODylibCommandSetName(this._handle, value)
  }

  static id(name, opts = {}) {
    const { timestamp = 0, currentVersion = 0, compatibilityVersion = 0 } = opts

    return new MachODylibCommand({
      handle: binding.machODylibCommandCreateID(
        name,
        timestamp,
        currentVersion,
        compatibilityVersion
      )
    })
  }
}
