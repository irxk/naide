#include <node_api.h>

#include <cstdint>
#include <cstring>
#include <cmath>
#include <new>

#if !defined(_WIN32) || !(defined(_M_X64) || defined(__x86_64__))
#error "NaideVM native bridge currently supports Windows x64 only."
#endif

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

namespace {

constexpr uint64_t kHandleMagic = UINT64_C(0x4E41494445564D31);
constexpr size_t kMaximumCodeSize = 1024 * 1024;
constexpr size_t kMaximumArguments = 4;

struct ExecutableCode {
  uint64_t magic;
  void* address;
};

void ThrowStatus(napi_env env, napi_status status, const char* operation) {
  if (status != napi_ok) {
    napi_throw_error(env, nullptr, operation);
  }
}

ExecutableCode* GetCodeHandle(napi_env env, napi_value value) {
  napi_valuetype type;
  napi_status status = napi_typeof(env, value, &type);
  if (status != napi_ok) {
    ThrowStatus(env, status, "Could not inspect native code handle.");
    return nullptr;
  }
  if (type != napi_external) {
    napi_throw_type_error(env, nullptr, "Expected a native code handle.");
    return nullptr;
  }

  void* data = nullptr;
  status = napi_get_value_external(env, value, &data);
  if (status != napi_ok) {
    ThrowStatus(env, status, "Could not read native code handle.");
    return nullptr;
  }

  auto* code = static_cast<ExecutableCode*>(data);
  if (code == nullptr || code->magic != kHandleMagic) {
    napi_throw_type_error(env, nullptr, "Invalid native code handle.");
    return nullptr;
  }
  return code;
}

void FinalizeCode(napi_env, void* data, void*) {
  auto* code = static_cast<ExecutableCode*>(data);
  if (code == nullptr) {
    return;
  }
  if (code->address != nullptr) {
    VirtualFree(code->address, 0, MEM_RELEASE);
  }
  code->magic = 0;
  delete code;
}

napi_value Compile(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_status status = napi_get_cb_info(env, info, &argc, nullptr, nullptr, nullptr);
  if (status != napi_ok) {
    ThrowStatus(env, status, "Could not read native compiler arguments.");
    return nullptr;
  }
  if (argc != 1) {
    napi_throw_type_error(env, nullptr, "compile expects one byte-array argument.");
    return nullptr;
  }

  napi_value args[1];
  argc = 1;
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (status != napi_ok) {
    ThrowStatus(env, status, "Could not read native compiler arguments.");
    return nullptr;
  }

  bool is_typed_array = false;
  status = napi_is_typedarray(env, args[0], &is_typed_array);
  if (status != napi_ok) {
    ThrowStatus(env, status, "Could not validate native machine code.");
    return nullptr;
  }
  if (!is_typed_array) {
    napi_throw_type_error(env, nullptr, "compile expects machine code as a Buffer or Uint8Array.");
    return nullptr;
  }

  napi_typedarray_type array_type;
  void* source = nullptr;
  size_t length = 0;
  status = napi_get_typedarray_info(env, args[0], &array_type, &length, &source, nullptr, nullptr);
  if (status != napi_ok) {
    ThrowStatus(env, status, "Could not read native machine code.");
    return nullptr;
  }
  if (array_type != napi_uint8_array) {
    napi_throw_type_error(env, nullptr, "Native machine code must use a byte array.");
    return nullptr;
  }
  if (length == 0 || length > kMaximumCodeSize) {
    napi_throw_range_error(env, nullptr, "Native machine code must be between 1 byte and 1 MiB.");
    return nullptr;
  }

  void* address = VirtualAlloc(nullptr, length, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
  if (address == nullptr) {
    napi_throw_error(env, nullptr, "Could not allocate memory for native machine code.");
    return nullptr;
  }
  std::memcpy(address, source, length);

  DWORD previous_protection = 0;
  if (!VirtualProtect(address, length, PAGE_EXECUTE_READ, &previous_protection)) {
    VirtualFree(address, 0, MEM_RELEASE);
    napi_throw_error(env, nullptr, "Could not make native machine code executable.");
    return nullptr;
  }
  if (!FlushInstructionCache(GetCurrentProcess(), address, length)) {
    VirtualFree(address, 0, MEM_RELEASE);
    napi_throw_error(env, nullptr, "Could not synchronize the native instruction cache.");
    return nullptr;
  }

  auto* code = new (std::nothrow) ExecutableCode{kHandleMagic, address};
  if (code == nullptr) {
    VirtualFree(address, 0, MEM_RELEASE);
    napi_throw_error(env, nullptr, "Could not allocate a native code handle.");
    return nullptr;
  }

  napi_value external = nullptr;
  status = napi_create_external(env, code, FinalizeCode, nullptr, &external);
  if (status != napi_ok) {
    FinalizeCode(env, code, nullptr);
    ThrowStatus(env, status, "Could not create a native code handle.");
    return nullptr;
  }
  return external;
}

double InvokeFunction(
    void* address,
    const double* values,
    uint64_t* step_count,
    uint64_t max_steps,
    uint32_t* current_line) {
  using Function = double (*)(double, double, double, double, uint64_t*, uint64_t, uint32_t*);
  return reinterpret_cast<Function>(address)(
      values[0], values[1], values[2], values[3], step_count, max_steps, current_line);
}

napi_value Invoke(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_status status = napi_get_cb_info(env, info, &argc, nullptr, nullptr, nullptr);
  if (status != napi_ok) {
    ThrowStatus(env, status, "Could not read native invocation arguments.");
    return nullptr;
  }
  if (argc < 2 || argc > kMaximumArguments + 2) {
    napi_throw_type_error(env, nullptr, "invoke expects a handle, a step limit, and at most four numbers.");
    return nullptr;
  }

  napi_value args[kMaximumArguments + 2];
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (status != napi_ok) {
    ThrowStatus(env, status, "Could not read native invocation arguments.");
    return nullptr;
  }

  ExecutableCode* code = GetCodeHandle(env, args[0]);
  if (code == nullptr) {
    return nullptr;
  }
  if (code->address == nullptr) {
    napi_throw_error(env, nullptr, "Native code handle has been released.");
    return nullptr;
  }

  napi_valuetype limit_type;
  status = napi_typeof(env, args[1], &limit_type);
  if (status != napi_ok) {
    ThrowStatus(env, status, "Could not inspect native step limit.");
    return nullptr;
  }
  if (limit_type != napi_number) {
    napi_throw_type_error(env, nullptr, "Native step limit must be a non-negative safe integer.");
    return nullptr;
  }
  double limit_value = 0;
  status = napi_get_value_double(env, args[1], &limit_value);
  if (status != napi_ok) {
    ThrowStatus(env, status, "Could not read native step limit.");
    return nullptr;
  }
  if (!std::isfinite(limit_value) || limit_value < 0
      || std::floor(limit_value) != limit_value || limit_value > 9007199254740991.0) {
    napi_throw_range_error(env, nullptr, "Native step limit must be a non-negative safe integer.");
    return nullptr;
  }

  const size_t value_count = argc - 2;
  double values[kMaximumArguments] = {};
  for (size_t i = 0; i < value_count; ++i) {
    napi_valuetype type;
    status = napi_typeof(env, args[i + 2], &type);
    if (status != napi_ok) {
      ThrowStatus(env, status, "Could not inspect native function argument.");
      return nullptr;
    }
    if (type != napi_number) {
      napi_throw_type_error(env, nullptr, "Native function arguments must be numbers.");
      return nullptr;
    }
    status = napi_get_value_double(env, args[i + 2], &values[i]);
    if (status != napi_ok) {
      ThrowStatus(env, status, "Could not read native function argument.");
      return nullptr;
    }
  }

  uint64_t step_count = 0;
  uint32_t current_line = 0;
  const double result = InvokeFunction(
      code->address,
      values,
      &step_count,
      static_cast<uint64_t>(limit_value),
      &current_line);

  napi_value output = nullptr;
  status = napi_create_object(env, &output);
  if (status != napi_ok) {
    ThrowStatus(env, status, "Could not create native invocation result.");
    return nullptr;
  }
  napi_value value = nullptr;
  status = napi_create_double(env, result, &value);
  if (status != napi_ok) {
    ThrowStatus(env, status, "Could not create native function value.");
    return nullptr;
  }
  status = napi_set_named_property(env, output, "value", value);
  if (status != napi_ok) {
    ThrowStatus(env, status, "Could not store native function value.");
    return nullptr;
  }
  napi_value steps = nullptr;
  status = napi_create_double(env, static_cast<double>(step_count), &steps);
  if (status != napi_ok) {
    ThrowStatus(env, status, "Could not create native step count.");
    return nullptr;
  }
  status = napi_set_named_property(env, output, "steps", steps);
  if (status != napi_ok) {
    ThrowStatus(env, status, "Could not store native step count.");
    return nullptr;
  }
  napi_value line = nullptr;
  status = napi_create_uint32(env, current_line, &line);
  if (status != napi_ok) {
    ThrowStatus(env, status, "Could not create native source line.");
    return nullptr;
  }
  status = napi_set_named_property(env, output, "line", line);
  if (status != napi_ok) {
    ThrowStatus(env, status, "Could not store native source line.");
    return nullptr;
  }
  return output;
}

napi_value InvokeArraySum(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_status status = napi_get_cb_info(env, info, &argc, nullptr, nullptr, nullptr);
  if (status != napi_ok) {
    ThrowStatus(env, status, "Could not read native array invocation arguments.");
    return nullptr;
  }
  if (argc != 2) {
    napi_throw_type_error(env, nullptr, "invokeArraySum expects a handle and a Float64Array.");
    return nullptr;
  }

  napi_value args[2];
  argc = 2;
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (status != napi_ok) {
    ThrowStatus(env, status, "Could not read native array invocation arguments.");
    return nullptr;
  }

  ExecutableCode* code = GetCodeHandle(env, args[0]);
  if (code == nullptr) return nullptr;
  if (code->address == nullptr) {
    napi_throw_error(env, nullptr, "Native code handle has been released.");
    return nullptr;
  }

  bool is_typed_array = false;
  status = napi_is_typedarray(env, args[1], &is_typed_array);
  if (status != napi_ok) {
    ThrowStatus(env, status, "Could not validate native numeric array.");
    return nullptr;
  }
  if (!is_typed_array) {
    napi_throw_type_error(env, nullptr, "Native array summation requires a Float64Array.");
    return nullptr;
  }

  napi_typedarray_type array_type;
  void* data = nullptr;
  size_t length = 0;
  status = napi_get_typedarray_info(
      env, args[1], &array_type, &length, &data, nullptr, nullptr);
  if (status != napi_ok) {
    ThrowStatus(env, status, "Could not read native numeric array.");
    return nullptr;
  }
  if (array_type != napi_float64_array) {
    napi_throw_type_error(env, nullptr, "Native array summation requires a Float64Array.");
    return nullptr;
  }

  using ArraySumFunction = double (*)(const double*, uint64_t);
  const double result = reinterpret_cast<ArraySumFunction>(code->address)(
      static_cast<const double*>(data), static_cast<uint64_t>(length));
  napi_value output = nullptr;
  status = napi_create_double(env, result, &output);
  if (status != napi_ok) {
    ThrowStatus(env, status, "Could not create native array result.");
    return nullptr;
  }
  return output;
}

napi_value Release(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  napi_status status = napi_get_cb_info(env, info, &argc, nullptr, nullptr, nullptr);
  if (status != napi_ok) {
    ThrowStatus(env, status, "Could not read native release arguments.");
    return nullptr;
  }
  if (argc != 1) {
    napi_throw_type_error(env, nullptr, "release expects one native code handle.");
    return nullptr;
  }

  napi_value args[1];
  argc = 1;
  status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (status != napi_ok) {
    ThrowStatus(env, status, "Could not read native release arguments.");
    return nullptr;
  }

  ExecutableCode* code = GetCodeHandle(env, args[0]);
  if (code == nullptr) {
    return nullptr;
  }
  if (code->address == nullptr) {
    napi_throw_error(env, nullptr, "Native code handle has already been released.");
    return nullptr;
  }
  if (!VirtualFree(code->address, 0, MEM_RELEASE)) {
    napi_throw_error(env, nullptr, "Could not release native code memory.");
    return nullptr;
  }
  code->address = nullptr;

  napi_value undefined_value = nullptr;
  status = napi_get_undefined(env, &undefined_value);
  if (status != napi_ok) {
    ThrowStatus(env, status, "Could not return from native code release.");
    return nullptr;
  }
  return undefined_value;
}

}  // namespace

NAPI_MODULE_INIT() {
  napi_property_descriptor properties[] = {
      {"compile", nullptr, Compile, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"invoke", nullptr, Invoke, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"invokeArraySum", nullptr, InvokeArraySum, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"release", nullptr, Release, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_status status = napi_define_properties(env, exports, 4, properties);
  if (status != napi_ok) {
    ThrowStatus(env, status, "Could not initialize the native bridge.");
    return nullptr;
  }
  return exports;
}
