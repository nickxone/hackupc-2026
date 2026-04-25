const binding = require('#binding')
const MachOLoadCommand = require('./load-command')

module.exports = class MachORPathCommand extends MachOLoadCommand {
  constructor(path, opts = {}) {
    if (typeof path === 'object' && path !== null) {
      opts = path
      path = null
    }

    const { handle = binding.machORPathCommandCreate(path) } = opts

    super({ handle })
  }
}
