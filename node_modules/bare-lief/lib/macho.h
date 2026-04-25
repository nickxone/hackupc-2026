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
#include <LIEF/MachO.hpp>

#include "handle.h"

using namespace LIEF;

static std::shared_ptr<bare_lief_handle_t<MachO::FatBinary>>
bare_lief_macho_fat_binary_parse(
  js_env_t *,
  js_receiver_t,
  std::span<uint8_t> buffer
) {
  auto stream = std::make_unique<LIEF::SpanStream>(buffer.data(), buffer.size());

  return std::make_shared<bare_lief_handle_t<MachO::FatBinary>>(
    MachO::Parser::parse(std::move(stream)).release()
  );
}

static void
bare_lief_macho_fat_binary_write(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<MachO::FatBinary>> binary,
  std::string path
) {
  binary->handle->write(path);
}

static std::shared_ptr<bare_lief_handle_t<MachO::FatBinary>>
bare_lief_macho_fat_binary_merge(
  js_env_t *,
  js_receiver_t,
  std::vector<std::shared_ptr<bare_lief_handle_t<MachO::FatBinary>>> binaries
) {
  auto copy = std::vector<std::unique_ptr<MachO::Binary>>();

  copy.reserve(binaries.size());

  for (const auto &binary : binaries) {
    while (auto next = binary->handle->pop_back()) {
      copy.push_back(std::move(next));
    }
  }

  auto handle = new MachO::FatBinary(std::move(copy));

  return std::make_shared<bare_lief_handle_t<MachO::FatBinary>>(handle);
}

static js_arraybuffer_t
bare_lief_macho_fat_binary_get_raw(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<MachO::FatBinary>> binary
) {
  int err;

  auto buffer = binary->handle->raw();

  js_arraybuffer_t result;
  err = js_create_arraybuffer(env, buffer, result);
  assert(err == 0);

  return result;
}

static int64_t
bare_lief_marcho_fat_binary_get_size(
  js_env_t *,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<MachO::FatBinary>> binary
) {
  return binary->handle->size();
}

static std::optional<std::shared_ptr<bare_lief_handle_t<MachO::Binary>>>
bare_lief_macho_fat_binary_get_at(
  js_env_t *env,
  js_receiver_t,
  js_object_t self,
  std::shared_ptr<bare_lief_handle_t<MachO::FatBinary>> binary,
  int64_t i
) {
  int err;

  auto handle = binary->handle->at(i);

  if (handle == nullptr) return std::nullopt;

  js_persistent_t<js_object_t> owner;
  err = js_create_reference(env, self, owner);
  assert(err == 0);

  return std::make_shared<bare_lief_handle_t<MachO::Binary>>(handle, std::move(owner));
}

static void
bare_lief_macho_binary_add_segment_command(
  js_env_t *,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<MachO::Binary>> binary,
  std::shared_ptr<bare_lief_handle_t<MachO::SegmentCommand>> command
) {
  binary->handle->add(*command->handle);
}

static std::optional<std::shared_ptr<bare_lief_handle_t<MachO::LoadCommand>>>
bare_lief_macho_binary_get_load_command(
  js_env_t *env,
  js_receiver_t,
  js_object_t self,
  std::shared_ptr<bare_lief_handle_t<MachO::Binary>> binary,
  int64_t type
) {
  int err;

  auto handle = binary->handle->get(MachO::LoadCommand::TYPE(type));

  if (handle == nullptr) return std::nullopt;

  js_persistent_t<js_object_t> owner;
  err = js_create_reference(env, self, owner);
  assert(err == 0);

  return std::make_shared<bare_lief_handle_t<MachO::LoadCommand>>(handle, std::move(owner));
}

static bool
bare_lief_macho_binary_has_load_command(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<MachO::Binary>> binary,
  int64_t type
) {
  return binary->handle->has(MachO::LoadCommand::TYPE(type));
}

static bool
bare_lief_macho_binary_remove_load_command(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<MachO::Binary>> binary,
  std::shared_ptr<bare_lief_handle_t<MachO::LoadCommand>> command
) {
  return binary->handle->remove(*command->handle);
}

static bool
bare_lief_macho_binary_remove_all_load_commands(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<MachO::Binary>> binary,
  int64_t type
) {
  return binary->handle->remove(MachO::LoadCommand::TYPE(type));
}

static void
bare_lief_macho_binary_add_dylib_command(
  js_env_t *,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<MachO::Binary>> binary,
  std::shared_ptr<bare_lief_handle_t<MachO::DylibCommand>> command
) {
  binary->handle->add(*command->handle);
}

static std::optional<std::shared_ptr<bare_lief_handle_t<MachO::DylibCommand>>>
bare_lief_macho_binary_find_library(
  js_env_t *env,
  js_receiver_t,
  js_object_t self,
  std::shared_ptr<bare_lief_handle_t<MachO::Binary>> binary,
  std::string name
) {
  int err;

  auto handle = binary->handle->find_library(name);

  if (handle == nullptr) return std::nullopt;

  js_persistent_t<js_object_t> owner;
  err = js_create_reference(env, self, owner);
  assert(err == 0);

  return std::make_shared<bare_lief_handle_t<MachO::DylibCommand>>(handle, std::move(owner));
}

static void
bare_lief_macho_binary_add_library(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<MachO::Binary>> binary,
  std::string name
) {
  binary->handle->add_library(name);
}

static std::shared_ptr<bare_lief_handle_t<MachO::Section>>
bare_lief_macho_section_create(
  js_env_t *,
  js_receiver_t,
  std::string name,
  std::span<uint8_t> buffer
) {
  auto handle = new MachO::Section(name, std::vector(buffer.begin(), buffer.end()));

  return std::make_shared<bare_lief_handle_t<MachO::Section>>(handle);
}

static std::shared_ptr<bare_lief_handle_t<MachO::SegmentCommand>>
bare_lief_macho_segment_command_create(
  js_env_t *,
  js_receiver_t,
  std::string name
) {
  auto handle = new MachO::SegmentCommand(name);

  return std::make_shared<bare_lief_handle_t<MachO::SegmentCommand>>(handle);
}

static uint32_t
bare_lief_macho_segment_command_get_max_protection(
  js_env_t *,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<MachO::SegmentCommand>> command
) {
  return command->handle->max_protection();
}

static void
bare_lief_macho_segment_command_set_max_protection(
  js_env_t *,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<MachO::SegmentCommand>> command,
  uint32_t protection
) {
  command->handle->max_protection(protection);
}

static uint32_t
bare_lief_macho_segment_command_get_initial_protection(
  js_env_t *,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<MachO::SegmentCommand>> command
) {
  return command->handle->init_protection();
}

static void
bare_lief_macho_segment_command_set_initial_protection(
  js_env_t *,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<MachO::SegmentCommand>> command,
  uint32_t protection
) {
  command->handle->init_protection(protection);
}

static void
bare_lief_macho_segment_command_add_section(
  js_env_t *,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<MachO::SegmentCommand>> command,
  std::shared_ptr<bare_lief_handle_t<MachO::Section>> section
) {
  command->handle->add_section(*section->handle);
}

static std::span<const uint8_t>
bare_lief_macho_load_command_get_data(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<MachO::LoadCommand>> command
) {
  return command->handle->data();
}

static void
bare_lief_macho_load_command_set_data(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<MachO::LoadCommand>> command,
  std::span<uint8_t> data
) {
  command->handle->data(std::vector(data.begin(), data.end()));
}

static std::shared_ptr<bare_lief_handle_t<MachO::DylibCommand>>
bare_lief_macho_dylib_command_create_id(
  js_env_t *,
  js_receiver_t,
  std::string name,
  uint32_t timestamp,
  uint32_t current_version,
  uint32_t compat_version
) {
  auto handle = new MachO::DylibCommand(MachO::DylibCommand::id_dylib(name, timestamp, current_version, compat_version));

  return std::make_shared<bare_lief_handle_t<MachO::DylibCommand>>(handle);
}

static std::string
bare_lief_macho_dylib_command_get_name(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<MachO::DylibCommand>> command
) {
  return command->handle->name();
}

static void
bare_lief_macho_dylib_command_set_name(
  js_env_t *env,
  js_receiver_t,
  std::shared_ptr<bare_lief_handle_t<MachO::DylibCommand>> command,
  std::string name
) {
  command->handle->name(name);
}

static std::shared_ptr<bare_lief_handle_t<MachO::RPathCommand>>
bare_lief_macho_rpath_command_create(
  js_env_t *,
  js_receiver_t,
  std::string path
) {
  auto handle = new MachO::RPathCommand(path);

  return std::make_shared<bare_lief_handle_t<MachO::RPathCommand>>(handle);
}
