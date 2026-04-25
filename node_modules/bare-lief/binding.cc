#include <assert.h>
#include <bare.h>
#include <js.h>
#include <jstl.h>
#include <stddef.h>
#include <stdint.h>

#include <LIEF/logging.hpp>

#include "lib/elf.h"
#include "lib/macho.h"
#include "lib/pe.h"

static js_value_t *
bare_lief_exports(js_env_t *env, js_value_t *exports) {
  int err;

  LIEF::logging::disable();

#define V(name, fn) \
  err = js_set_property<fn>(env, exports, name); \
  assert(err == 0);

  // Mach-O

  V("machOFatBinaryParse", bare_lief_macho_fat_binary_parse)
  V("machOFatBinaryWrite", bare_lief_macho_fat_binary_write)
  V("machOFatBinaryMerge", bare_lief_macho_fat_binary_merge)
  V("machOFatBinaryGetRaw", bare_lief_macho_fat_binary_get_raw)
  V("machOFatBinaryGetSize", bare_lief_marcho_fat_binary_get_size)
  V("machOFatBinaryGetAt", bare_lief_macho_fat_binary_get_at)

  V("machOBinaryAddSegmentCommand", bare_lief_macho_binary_add_segment_command)
  V("machOBinaryGetLoadCommand", bare_lief_macho_binary_get_load_command)
  V("machOBinaryHasLoadCommand", bare_lief_macho_binary_has_load_command)
  V("machOBinaryRemoveLoadCommand", bare_lief_macho_binary_remove_load_command)
  V("machOBinaryRemoveAllLoadCommands", bare_lief_macho_binary_remove_all_load_commands)
  V("machOBinaryAddDylibCommand", bare_lief_macho_binary_add_dylib_command)
  V("machOBinaryFindLibrary", bare_lief_macho_binary_find_library)
  V("machOBinaryAddLibrary", bare_lief_macho_binary_add_library)

  V("machOSectionCreate", bare_lief_macho_section_create)

  V("machOSegmentCommandCreate", bare_lief_macho_segment_command_create)
  V("machOSegmentCommandGetMaxProtection", bare_lief_macho_segment_command_get_max_protection)
  V("machOSegmentCommandSetMaxProtection", bare_lief_macho_segment_command_set_max_protection)
  V("machOSegmentCommandGetInitialProtection", bare_lief_macho_segment_command_get_initial_protection)
  V("machOSegmentCommandSetInitialProtection", bare_lief_macho_segment_command_set_initial_protection)
  V("machOSegmentCommandAddSection", bare_lief_macho_segment_command_add_section)

  V("machOLoadCommandGetData", bare_lief_macho_load_command_get_data)
  V("machOLoadCommandSetData", bare_lief_macho_load_command_set_data)

  V("machODylibCommandCreateID", bare_lief_macho_dylib_command_create_id)
  V("machODylibCommandGetName", bare_lief_macho_dylib_command_get_name)
  V("machODylibCommandSetName", bare_lief_macho_dylib_command_set_name)
  V("machORPathCommandCreate", bare_lief_macho_rpath_command_create)

  // ELF

  V("elfBinaryParse", bare_lief_elf_binary_parse)
  V("elfBinaryWrite", bare_lief_elf_binary_write)
  V("elfBinaryGetRaw", bare_lief_elf_binary_get_raw)
  V("elfBinaryAddSegment", bare_lief_elf_binary_add_segment)
  V("elfBinaryAddSection", bare_lief_elf_binary_add_section)
  V("elfBinaryGetSection", bare_lief_elf_binary_get_section)
  V("elfBinaryGetSectionIndex", bare_lief_elf_binary_get_section_index)
  V("elfBinaryAddSymtabSymbol", bare_lief_elf_binary_add_symtab_symbol)
  V("elfBinaryGetSymtabSymbol", bare_lief_elf_binary_get_symtab_symbol)
  V("elfBinaryAddDynamicSymbol", bare_lief_elf_binary_add_dynamic_symbol)
  V("elfBinaryGetDynamicSymbol", bare_lief_elf_binary_get_dynamic_symbol)
  V("elfBinaryAddDynamicEntry", bare_lief_elf_binary_add_dynamic_entry)
  V("elfBinaryGetDynamicEntry", bare_lief_elf_binary_get_dynamic_entry)
  V("elfBinaryHasDynamicEntry", bare_lief_elf_binary_has_dynamic_entry)
  V("elfBinaryRemoveDynamicEntry", bare_lief_elf_binary_remove_dynamic_entry)
  V("elfBinaryRemoveAllDynamicEntries", bare_lief_elf_binary_remove_all_dynamic_entries)
  V("elfBinaryAddLibrary", bare_lief_elf_binary_add_library)
  V("elfBinaryGetLibrary", bare_lief_elf_binary_get_library)
  V("elfBinaryHasLibrary", bare_lief_elf_binary_has_library)
  V("elfBinaryRemoveLibrary", bare_lief_elf_binary_remove_library)

  V("elfSegmentCreate", bare_lief_elf_segment_create)
  V("elfSegmentGetType", bare_lief_elf_segment_get_type)
  V("elfSegmentSetType", bare_lief_elf_segment_set_type)
  V("elfSegmentGetFlags", bare_lief_elf_segment_get_flags)
  V("elfSegmentSetFlags", bare_lief_elf_segment_set_flags)
  V("elfSegmentGetAlignment", bare_lief_elf_segment_get_alignment)
  V("elfSegmentSetAlignment", bare_lief_elf_segment_set_alignment)
  V("elfSegmentGetContent", bare_lief_elf_segment_get_content)
  V("elfSegmentSetContent", bare_lief_elf_segment_set_content)
  V("elfSegmentGetVirtualSize", bare_lief_elf_segment_get_virtual_size)
  V("elfSegmentSetVirtualSize", bare_lief_elf_segment_set_virtual_size)
  V("elfSegmentGetPhysicalSize", bare_lief_elf_segment_get_physical_size)
  V("elfSegmentSetPhysicalSize", bare_lief_elf_segment_set_physical_size)
  V("elfSegmentGetVirtualAddress", bare_lief_elf_segment_get_virtual_address)
  V("elfSegmentSetVirtualAddress", bare_lief_elf_segment_set_virtual_address)
  V("elfSegmentGetPhysicalAddress", bare_lief_elf_segment_get_physical_address)
  V("elfSegmentSetPhysicalAddress", bare_lief_elf_segment_set_physical_address)

  V("elfSectionCreate", bare_lief_elf_section_create)
  V("elfSectionGetType", bare_lief_elf_section_get_type)
  V("elfSectionSetType", bare_lief_elf_section_set_type)
  V("elfSectionGetFlags", bare_lief_elf_section_get_flags)
  V("elfSectionSetFlags", bare_lief_elf_section_set_flags)
  V("elfSectionGetAlignment", bare_lief_elf_section_get_alignment)
  V("elfSectionSetAlignment", bare_lief_elf_section_set_alignment)
  V("elfSectionGetContent", bare_lief_elf_section_get_content)
  V("elfSectionSetContent", bare_lief_elf_section_set_content)
  V("elfSectionGetSize", bare_lief_elf_section_get_size)
  V("elfSectionSetSize", bare_lief_elf_section_set_size)
  V("elfSectionGetVirtualAddress", bare_lief_elf_section_get_virtual_address)
  V("elfSectionSetVirtualAddress", bare_lief_elf_section_set_virtual_address)

  V("elfSymbolCreate", bare_lief_elf_symbol_create)
  V("elfSymbolGetType", bare_lief_elf_symbol_get_type)
  V("elfSymbolSetType", bare_lief_elf_symbol_set_type)
  V("elfSymbolGetName", bare_lief_elf_symbol_get_name)
  V("elfSymbolSetName", bare_lief_elf_symbol_set_name)
  V("elfSymbolGetValue", bare_lief_elf_symbol_get_value)
  V("elfSymbolSetValue", bare_lief_elf_symbol_set_value)
  V("elfSymbolGetBinding", bare_lief_elf_symbol_get_binding)
  V("elfSymbolSetBinding", bare_lief_elf_symbol_set_binding)
  V("elfSymbolGetSectionIndex", bare_lief_elf_symbol_get_section_index)
  V("elfSymbolSetSectionIndex", bare_lief_elf_symbol_set_section_index)

  V("elfDynamicSharedObjectCreate", bare_lief_elf_dynamic_shared_object_create)
  V("elfDynamicSharedObjectGetName", bare_lief_elf_dynamic_shared_object_get_name)
  V("elfDynamicSharedObjectSetName", bare_lief_elf_dynamic_shared_object_set_name)

  V("elfDynamicEntryLibraryCreate", bare_lief_elf_dynamic_entry_library_create)
  V("elfDynamicEntryLibraryGetName", bare_lief_elf_dynamic_entry_library_get_name)
  V("elfDynamicEntryLibrarySetName", bare_lief_elf_dynamic_entry_library_set_name)
  V("elfDynamicEntryRunPathCreate", bare_lief_elf_dynamic_entry_run_path_create)
  V("elfDynamicEntryRunPathGetRunPath", bare_lief_elf_dynamic_entry_run_path_get_run_path)
  V("elfDynamicEntryRunPathSetRunPath", bare_lief_elf_dynamic_entry_run_path_set_run_path)

  // PE

  V("peBinaryParse", bare_lief_pe_binary_parse)
  V("peBinaryWrite", bare_lief_pe_binary_write)
  V("peBinaryGetRaw", bare_lief_pe_binary_get_raw)
  V("peBinaryAddSection", bare_lief_pe_binary_add_section)
  V("peBinaryGetSection", bare_lief_pe_binary_get_section)

  V("peOptionalHeaderGetSubsystem", bare_lief_pe_optional_header_get_subsystem)
  V("peOptionalHeaderSetSubsystem", bare_lief_pe_optional_header_set_subsystem)

  V("peSectionCreate", bare_lief_pe_section_create)
  V("peSectionGetCharacteristics", bare_lief_pe_section_get_characteristics)
  V("peSectionSetCharacteristics", bare_lief_pe_section_set_characteristics)
  V("peSectionGetContent", bare_lief_pe_section_get_content)
  V("peSectionSetContent", bare_lief_pe_section_set_content)
  V("peSectionGetSize", bare_lief_pe_section_get_size)
  V("peSectionSetSize", bare_lief_pe_section_set_size)
#undef V

#define V(name, value) \
  err = js_set_property(env, exports, name, int64_t(value)); \
  assert(err == 0);

  // Mach-O

  V("MACHO_LOAD_COMMAND_TYPE_ID_DYLIB", MachO::LoadCommand::TYPE::ID_DYLIB)
  V("MACHO_LOAD_COMMAND_TYPE_RPATH", MachO::LoadCommand::TYPE::RPATH)

  V("MACHO_SEGMENT_COMMAND_VM_PROTECTIONS_READ", MachO::SegmentCommand::VM_PROTECTIONS::READ)
  V("MACHO_SEGMENT_COMMAND_VM_PROTECTIONS_WRITE", MachO::SegmentCommand::VM_PROTECTIONS::WRITE)
  V("MACHO_SEGMENT_COMMAND_VM_PROTECTIONS_EXECUTE", MachO::SegmentCommand::VM_PROTECTIONS::EXECUTE)

  // ELF

  V("ELF_BINARY_SEC_INSERT_POS_AUTO", ELF::Binary::SEC_INSERT_POS::AUTO)
  V("ELF_BINARY_SEC_INSERT_POS_POST_SEGMENT", ELF::Binary::SEC_INSERT_POS::POST_SEGMENT)
  V("ELF_BINARY_SEC_INSERT_POS_POST_SECTION", ELF::Binary::SEC_INSERT_POS::POST_SECTION)

  V("ELF_SEGMENT_TYPE_LOAD", ELF::Segment::TYPE::LOAD)

  V("ELF_SEGMENT_FLAGS_X", ELF::Segment::FLAGS::X)
  V("ELF_SEGMENT_FLAGS_W", ELF::Segment::FLAGS::W)
  V("ELF_SEGMENT_FLAGS_R", ELF::Segment::FLAGS::R)

  V("ELF_SECTION_FLAGS_WRITE", ELF::Section::FLAGS::WRITE)
  V("ELF_SECTION_FLAGS_ALLOC", ELF::Section::FLAGS::ALLOC)
  V("ELF_SECTION_FLAGS_EXECINSTR", ELF::Section::FLAGS::EXECINSTR)

  V("ELF_SYMBOL_TYPE_OBJECT", ELF::Symbol::TYPE::OBJECT)
  V("ELF_SYMBOL_TYPE_FUNC", ELF::Symbol::TYPE::FUNC)
  V("ELF_SYMBOL_TYPE_SECTION", ELF::Symbol::TYPE::SECTION)
  V("ELF_SYMBOL_TYPE_FILE", ELF::Symbol::TYPE::FILE)
  V("ELF_SYMBOL_TYPE_COMMON", ELF::Symbol::TYPE::COMMON)
  V("ELF_SYMBOL_TYPE_TLS", ELF::Symbol::TYPE::TLS)

  V("ELF_SYMBOL_BINDING_LOCAL", ELF::Symbol::BINDING::LOCAL)
  V("ELF_SYMBOL_BINDING_GLOBAL", ELF::Symbol::BINDING::GLOBAL)
  V("ELF_SYMBOL_BINDING_WEAK", ELF::Symbol::BINDING::WEAK)

  V("ELF_DYNAMIC_ENTRY_TAG_NEEDED", ELF::DynamicEntry::TAG::NEEDED)
  V("ELF_DYNAMIC_ENTRY_TAG_SONAME", ELF::DynamicEntry::TAG::SONAME)
  V("ELF_DYNAMIC_ENTRY_TAG_RUNPATH", ELF::DynamicEntry::TAG::RUNPATH)

  // PE

  V("PE_SECTION_CHARACTERISTICS_CNT_CODE", PE::Section::CHARACTERISTICS::CNT_CODE)
  V("PE_SECTION_CHARACTERISTICS_CNT_INITIALIZED_DATA", PE::Section::CHARACTERISTICS::CNT_INITIALIZED_DATA)
  V("PE_SECTION_CHARACTERISTICS_CNT_UNINITIALIZED_DATA", PE::Section::CHARACTERISTICS::CNT_UNINITIALIZED_DATA)
  V("PE_SECTION_CHARACTERISTICS_MEM_SHARED", PE::Section::CHARACTERISTICS::MEM_SHARED)
  V("PE_SECTION_CHARACTERISTICS_MEM_EXECUTE", PE::Section::CHARACTERISTICS::MEM_EXECUTE)
  V("PE_SECTION_CHARACTERISTICS_MEM_READ", PE::Section::CHARACTERISTICS::MEM_READ)
  V("PE_SECTION_CHARACTERISTICS_MEM_WRITE", PE::Section::CHARACTERISTICS::MEM_WRITE)

  V("PE_OPTIONAL_HEADER_SUBSYSTEM_WINDOWS_GUI", PE::OptionalHeader::SUBSYSTEM::WINDOWS_GUI)
  V("PE_OPTIONAL_HEADER_SUBSYSTEM_WINDOWS_CUI", PE::OptionalHeader::SUBSYSTEM::WINDOWS_CUI)
#undef V

  return exports;
}

BARE_MODULE(bare_lief, bare_lief_exports)
