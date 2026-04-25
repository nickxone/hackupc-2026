#pragma once

#include <memory>
#include <optional>

#include <assert.h>
#include <bare.h>
#include <js.h>
#include <jstl.h>
#include <stddef.h>
#include <stdint.h>

#include <LIEF/BinaryStream/SpanStream.hpp>
#include <LIEF/ELF.hpp>

#include "handle.h"

using namespace LIEF;

static std::shared_ptr<bare_lief_handle_t<ELF::Binary>>
bare_lief_elf_binary_parse(
  js_env_t *,
  js_receiver_t,
  std::span<uint8_t> buffer
) {
  auto stream = std::make_unique<LIEF::SpanStream>(buffer.data(), buffer.size());

  return std::make_shared<bare_lief_handle_t<ELF::Binary>>(
    ELF::Parser::parse(std::move(stream)).release()
  );
}

static void
bare_lief_elf_binary_write(
  js_env_t *,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Binary>> binary,
  std::string path
) {
  binary->handle->write(path);
}

static js_arraybuffer_t
bare_lief_elf_binary_get_raw(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Binary>> binary
) {
  int err;

  auto buffer = binary->handle->raw();

  js_arraybuffer_t result;
  err = js_create_arraybuffer(env, buffer, result);
  assert(err == 0);

  return result;
}

static std::shared_ptr<bare_lief_handle_t<ELF::Segment>>
bare_lief_elf_binary_add_segment(
  js_env_t *env,
  js_receiver_t,
  js_object_t self,
  std::shared_ptr<bare_lief_handle_t<ELF::Binary>> binary,
  std::shared_ptr<bare_lief_handle_t<ELF::Segment>> segment,
  int64_t base
) {
  int err;

  auto handle = binary->handle->add(*segment->handle, base);

  js_persistent_t<js_object_t> owner;
  err = js_create_reference(env, self, owner);
  assert(err == 0);

  return std::make_shared<bare_lief_handle_t<ELF::Segment>>(handle, std::move(owner));
}

static std::optional<std::shared_ptr<bare_lief_handle_t<ELF::Section>>>
bare_lief_elf_binary_add_section(
  js_env_t *env,
  js_receiver_t,
  js_object_t self,
  std::shared_ptr<bare_lief_handle_t<ELF::Binary>> binary,
  std::shared_ptr<bare_lief_handle_t<ELF::Section>> section,
  bool loaded,
  int64_t position
) {
  int err;

  auto handle = binary->handle->add(*section->handle, loaded, ELF::Binary::SEC_INSERT_POS(position));

  if (handle == nullptr) return std::nullopt;

  js_persistent_t<js_object_t> owner;
  err = js_create_reference(env, self, owner);
  assert(err == 0);

  return std::make_shared<bare_lief_handle_t<ELF::Section>>(handle, std::move(owner));
}

static std::optional<std::shared_ptr<bare_lief_handle_t<ELF::Section>>>
bare_lief_elf_binary_get_section(
  js_env_t *env,
  js_receiver_t,
  js_object_t self,
  std::shared_ptr<bare_lief_handle_t<ELF::Binary>> binary,
  std::string name
) {
  int err;

  auto handle = binary->handle->get_section(name);

  if (handle == nullptr) return std::nullopt;

  js_persistent_t<js_object_t> owner;
  err = js_create_reference(env, self, owner);
  assert(err == 0);

  return std::make_shared<bare_lief_handle_t<ELF::Section>>(handle, std::move(owner));
}

static int64_t
bare_lief_elf_binary_get_section_index(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Binary>> binary,
  std::string name
) {
  return binary->handle->get_section_idx(name).value_or(-1);
}

static void
bare_lief_elf_binary_add_symtab_symbol(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Binary>> binary,
  std::shared_ptr<bare_lief_handle_t<ELF::Symbol>> symbol
) {
  binary->handle->add_symtab_symbol(*symbol->handle);
}

static std::optional<std::shared_ptr<bare_lief_handle_t<ELF::Symbol>>>
bare_lief_elf_binary_get_symtab_symbol(
  js_env_t *env,
  js_receiver_t,
  js_object_t self,
  std::shared_ptr<bare_lief_handle_t<ELF::Binary>> binary,
  std::string name
) {
  int err;

  auto handle = binary->handle->get_symtab_symbol(name);

  if (handle == nullptr) return std::nullopt;

  js_persistent_t<js_object_t> owner;
  err = js_create_reference(env, self, owner);
  assert(err == 0);

  return std::make_shared<bare_lief_handle_t<ELF::Symbol>>(handle, std::move(owner));
}

static void
bare_lief_elf_binary_add_dynamic_symbol(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Binary>> binary,
  std::shared_ptr<bare_lief_handle_t<ELF::Symbol>> symbol
) {
  binary->handle->add_dynamic_symbol(*symbol->handle);
}

static std::optional<std::shared_ptr<bare_lief_handle_t<ELF::Symbol>>>
bare_lief_elf_binary_get_dynamic_symbol(
  js_env_t *env,
  js_receiver_t,
  js_object_t self,
  std::shared_ptr<bare_lief_handle_t<ELF::Binary>> binary,
  std::string name
) {
  int err;

  auto handle = binary->handle->get_dynamic_symbol(name);

  if (handle == nullptr) return std::nullopt;

  js_persistent_t<js_object_t> owner;
  err = js_create_reference(env, self, owner);
  assert(err == 0);

  return std::make_shared<bare_lief_handle_t<ELF::Symbol>>(handle, std::move(owner));
}

static void
bare_lief_elf_binary_add_dynamic_entry(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Binary>> binary,
  std::shared_ptr<bare_lief_handle_t<ELF::DynamicEntry>> entry
) {
  binary->handle->add(*entry->handle);
}

static std::optional<std::shared_ptr<bare_lief_handle_t<ELF::DynamicEntry>>>
bare_lief_elf_binary_get_dynamic_entry(
  js_env_t *env,
  js_receiver_t,
  js_object_t self,
  std::shared_ptr<bare_lief_handle_t<ELF::Binary>> binary,
  int64_t tag
) {
  int err;

  auto handle = binary->handle->get(ELF::DynamicEntry::TAG(tag));

  if (handle == nullptr) return std::nullopt;

  js_persistent_t<js_object_t> owner;
  err = js_create_reference(env, self, owner);
  assert(err == 0);

  return std::make_shared<bare_lief_handle_t<ELF::DynamicEntry>>(handle, std::move(owner));
}

static bool
bare_lief_elf_binary_has_dynamic_entry(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Binary>> binary,
  int64_t tag
) {
  return binary->handle->has(ELF::DynamicEntry::TAG(tag));
}

static void
bare_lief_elf_binary_remove_dynamic_entry(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Binary>> binary,
  std::shared_ptr<bare_lief_handle_t<ELF::DynamicEntry>> entry
) {
  binary->handle->remove(*entry->handle);
}

static void
bare_lief_elf_binary_remove_all_dynamic_entries(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Binary>> binary,
  int64_t tag
) {
  binary->handle->remove(ELF::DynamicEntry::TAG(tag));
}

static void
bare_lief_elf_binary_add_library(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Binary>> binary,
  std::string name
) {
  binary->handle->add_library(name);
}

static std::optional<std::shared_ptr<bare_lief_handle_t<ELF::DynamicEntryLibrary>>>
bare_lief_elf_binary_get_library(
  js_env_t *env,
  js_receiver_t,
  js_object_t self,
  std::shared_ptr<bare_lief_handle_t<ELF::Binary>> binary,
  std::string name
) {
  int err;

  auto handle = binary->handle->get_library(name);

  if (handle == nullptr) return std::nullopt;

  js_persistent_t<js_object_t> owner;
  err = js_create_reference(env, self, owner);
  assert(err == 0);

  return std::make_shared<bare_lief_handle_t<ELF::DynamicEntryLibrary>>(handle, std::move(owner));
}

static bool
bare_lief_elf_binary_has_library(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Binary>> binary,
  std::string name
) {
  return binary->handle->has_library(name);
}

static void
bare_lief_elf_binary_remove_library(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Binary>> binary,
  std::string name
) {
  binary->handle->remove_library(name);
}

static std::shared_ptr<bare_lief_handle_t<ELF::Segment>>
bare_lief_elf_segment_create(
  js_env_t *env,
  js_receiver_t
) {
  auto handle = new ELF::Segment();

  return std::make_shared<bare_lief_handle_t<ELF::Segment>>(handle);
}

static int64_t
bare_lief_elf_segment_get_type(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Segment>> segment
) {
  return int64_t(segment->handle->type());
}

static void
bare_lief_elf_segment_set_type(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Segment>> segment,
  int64_t type
) {
  segment->handle->type(ELF::Segment::TYPE(type));
}

static int64_t
bare_lief_elf_segment_get_flags(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Segment>> segment
) {
  return int64_t(segment->handle->flags());
}

static void
bare_lief_elf_segment_set_flags(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Segment>> segment,
  int64_t flags
) {
  segment->handle->flags(ELF::Segment::FLAGS(flags));
}

static int64_t
bare_lief_elf_segment_get_alignment(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Segment>> segment
) {
  return segment->handle->alignment();
}

static void
bare_lief_elf_segment_set_alignment(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Segment>> segment,
  int64_t alignment
) {
  segment->handle->alignment(alignment);
}

static std::span<const uint8_t>
bare_lief_elf_segment_get_content(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Segment>> segment
) {
  return segment->handle->content();
}

static void
bare_lief_elf_segment_set_content(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Segment>> segment,
  std::span<uint8_t> content
) {
  segment->handle->content(std::vector(content.begin(), content.end()));
}

static int64_t
bare_lief_elf_segment_get_virtual_size(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Segment>> segment
) {
  return segment->handle->virtual_size();
}

static void
bare_lief_elf_segment_set_virtual_size(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Segment>> segment,
  int64_t size
) {
  segment->handle->virtual_size(size);
}

static int64_t
bare_lief_elf_segment_get_physical_size(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Segment>> segment
) {
  return segment->handle->physical_size();
}

static void
bare_lief_elf_segment_set_physical_size(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Segment>> segment,
  int64_t size
) {
  segment->handle->physical_size(size);
}

static int64_t
bare_lief_elf_segment_get_virtual_address(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Segment>> segment
) {
  return segment->handle->virtual_address();
}

static void
bare_lief_elf_segment_set_virtual_address(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Segment>> segment,
  int64_t address
) {
  segment->handle->virtual_address(address);
}

static int64_t
bare_lief_elf_segment_get_physical_address(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Segment>> segment
) {
  return segment->handle->physical_address();
}

static void
bare_lief_elf_segment_set_physical_address(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Segment>> segment,
  int64_t address
) {
  segment->handle->physical_address(address);
}

static std::shared_ptr<bare_lief_handle_t<ELF::Section>>
bare_lief_elf_section_create(
  js_env_t *env,
  js_receiver_t,
  std::string name
) {
  auto handle = new ELF::Section(name);

  return std::make_shared<bare_lief_handle_t<ELF::Section>>(handle);
}

static int64_t
bare_lief_elf_section_get_type(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Section>> section
) {
  return int64_t(section->handle->type());
}

static void
bare_lief_elf_section_set_type(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Section>> section,
  int64_t type
) {
  section->handle->type(ELF::Section::TYPE(type));
}

static int64_t
bare_lief_elf_section_get_flags(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Section>> section
) {
  return section->handle->flags();
}

static void
bare_lief_elf_section_set_flags(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Section>> section,
  int64_t flags
) {
  section->handle->flags(flags);
}

static int64_t
bare_lief_elf_section_get_alignment(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Section>> section
) {
  return section->handle->alignment();
}

static void
bare_lief_elf_section_set_alignment(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Section>> section,
  int64_t alignment
) {
  section->handle->alignment(alignment);
}

static std::span<const uint8_t>
bare_lief_elf_section_get_content(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Section>> section
) {
  return section->handle->content();
}

static void
bare_lief_elf_section_set_content(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Section>> section,
  std::span<uint8_t> content
) {
  section->handle->content(std::vector(content.begin(), content.end()));
}

static int64_t
bare_lief_elf_section_get_size(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Section>> section
) {
  return section->handle->size();
}

static void
bare_lief_elf_section_set_size(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Section>> section,
  int64_t size
) {
  section->handle->size(size);
}

static int64_t
bare_lief_elf_section_get_virtual_address(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Section>> section
) {
  return section->handle->virtual_address();
}

static void
bare_lief_elf_section_set_virtual_address(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Section>> section,
  int64_t address
) {
  section->handle->virtual_address(address);
}

static std::shared_ptr<bare_lief_handle_t<ELF::Symbol>>
bare_lief_elf_symbol_create(
  js_env_t *env,
  js_receiver_t,
  std::string name
) {
  auto handle = new ELF::Symbol(name);

  return std::make_shared<bare_lief_handle_t<ELF::Symbol>>(handle);
}

static int64_t
bare_lief_elf_symbol_get_type(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Symbol>> symbol
) {
  return int64_t(symbol->handle->type());
}

static void
bare_lief_elf_symbol_set_type(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Symbol>> symbol,
  int64_t type
) {
  symbol->handle->type(ELF::Symbol::TYPE(type));
}

static std::string
bare_lief_elf_symbol_get_name(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Symbol>> symbol
) {
  return symbol->handle->name();
}

static void
bare_lief_elf_symbol_set_name(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Symbol>> symbol,
  std::string name
) {
  symbol->handle->name(name);
}

static int64_t
bare_lief_elf_symbol_get_value(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Symbol>> symbol
) {
  return symbol->handle->value();
}

static void
bare_lief_elf_symbol_set_value(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Symbol>> symbol,
  int64_t value
) {
  symbol->handle->value(value);
}

static int64_t
bare_lief_elf_symbol_get_binding(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Symbol>> symbol
) {
  return int64_t(symbol->handle->binding());
}

static void
bare_lief_elf_symbol_set_binding(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Symbol>> symbol,
  int64_t binding
) {
  symbol->handle->binding(ELF::Symbol::BINDING(binding));
}

static int32_t
bare_lief_elf_symbol_get_section_index(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Symbol>> symbol
) {
  return symbol->handle->shndx();
}

static void
bare_lief_elf_symbol_set_section_index(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::Symbol>> symbol,
  int32_t index
) {
  symbol->handle->shndx(index);
}

static std::shared_ptr<bare_lief_handle_t<ELF::DynamicSharedObject>>
bare_lief_elf_dynamic_shared_object_create(
  js_env_t *env,
  js_receiver_t,
  std::string name
) {
  auto handle = new ELF::DynamicSharedObject(name);

  return std::make_shared<bare_lief_handle_t<ELF::DynamicSharedObject>>(handle);
}

static std::string
bare_lief_elf_dynamic_shared_object_get_name(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::DynamicSharedObject>> entry
) {
  return entry->handle->name();
}

static void
bare_lief_elf_dynamic_shared_object_set_name(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::DynamicSharedObject>> entry,
  std::string name
) {
  entry->handle->name(name);
}

static std::shared_ptr<bare_lief_handle_t<ELF::DynamicEntryLibrary>>
bare_lief_elf_dynamic_entry_library_create(
  js_env_t *env,
  js_receiver_t,
  std::string name
) {
  auto handle = new ELF::DynamicEntryLibrary(name);

  return std::make_shared<bare_lief_handle_t<ELF::DynamicEntryLibrary>>(handle);
}

static std::string
bare_lief_elf_dynamic_entry_library_get_name(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::DynamicEntryLibrary>> entry
) {
  return entry->handle->name();
}

static void
bare_lief_elf_dynamic_entry_library_set_name(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::DynamicEntryLibrary>> entry,
  std::string name
) {
  entry->handle->name(name);
}

static std::shared_ptr<bare_lief_handle_t<ELF::DynamicEntryRunPath>>
bare_lief_elf_dynamic_entry_run_path_create(
  js_env_t *env,
  js_receiver_t,
  std::string path
) {
  auto handle = new ELF::DynamicEntryRunPath(path);

  return std::make_shared<bare_lief_handle_t<ELF::DynamicEntryRunPath>>(handle);
}

static std::string
bare_lief_elf_dynamic_entry_run_path_get_run_path(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::DynamicEntryRunPath>> entry
) {
  return entry->handle->runpath();
}

static void
bare_lief_elf_dynamic_entry_run_path_set_run_path(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<ELF::DynamicEntryRunPath>> entry,
  std::string path
) {
  entry->handle->runpath(path);
}
