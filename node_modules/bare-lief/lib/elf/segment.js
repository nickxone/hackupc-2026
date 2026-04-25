const binding = require('#binding')

module.exports = exports = class ELFSegment {
  constructor(opts = {}) {
    const { handle = binding.elfSegmentCreate() } = opts

    this._handle = handle
  }

  get type() {
    return binding.elfSegmentGetType(this._handle)
  }

  set type(value) {
    binding.elfSegmentSetType(this._handle, value)
  }

  get flags() {
    return binding.elfSegmentGetFlags(this._handle)
  }

  set flags(value) {
    binding.elfSegmentSetFlags(this._handle, value)
  }

  get alignment() {
    return binding.elfSegmentGetAlignment(this._handle)
  }

  set alignment(value) {
    binding.elfSegmentSetAlignment(this._handle, value)
  }

  get content() {
    return Buffer.from(binding.elfSegmentGetContent(this._handle))
  }

  set content(value) {
    binding.elfSegmentSetContent(this._handle, value)
  }

  get virtualSize() {
    return binding.elfSegmentGetVirtualSize(this._handle)
  }

  set virtualSize(value) {
    binding.elfSegmentSetVirtualSize(this._handle, value)
  }

  get physicalSize() {
    return binding.elfSegmentGetPhysicalSize(this._handle)
  }

  set physicalSize(value) {
    binding.elfSegmentSetPhysicalSize(this._handle, value)
  }

  get virtualAddress() {
    return binding.elfSegmentGetVirtualAddress(this._handle)
  }

  set virtualAddress(value) {
    binding.elfSegmentSetVirtualAddress(this._handle, value)
  }

  get physicalAddress() {
    return binding.elfSegmentGetPhysicalAddress(this._handle)
  }

  set physicalAddress(value) {
    binding.elfSegmentSetPhysicalAddress(this._handle, value)
  }

  [Symbol.for('bare.inspect')]() {
    return {
      __proto__: { constructor: ELFSegment },

      type: this.type,
      flags: this.flags
    }
  }
}

exports.TYPE = {
  LOAD: binding.ELF_SEGMENT_TYPE_LOAD
}

exports.FLAGS = {
  X: binding.ELF_SEGMENT_FLAGS_X,
  W: binding.ELF_SEGMENT_FLAGS_W,
  R: binding.ELF_SEGMENT_FLAGS_R
}
