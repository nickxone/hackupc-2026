#pragma once

#include <jstl.h>

template <typename T>
struct bare_lief_handle_t {
  T *handle;
  js_persistent_t<js_object_t> owner;

  bare_lief_handle_t(T *handle) : handle(handle), owner() {}

  bare_lief_handle_t(T *handle, js_persistent_t<js_object_t> &&owner) : handle(handle), owner(std::move(owner)) {}

  ~bare_lief_handle_t() {
    if (owner.empty()) delete handle;
  }
};
