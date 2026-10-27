import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const bridgePath = fileURLToPath(new URL('../native/build/Release/native_bridge.node', import.meta.url));
const supportedPlatform = process.platform === 'win32' && process.arch === 'x64';
const bridgeExists = supportedPlatform && existsSync(bridgePath);

export const nativeMachineCodeAvailable = bridgeExists;

const bridge = bridgeExists ? createRequire(import.meta.url)(bridgePath) : null;
export const nativeArraySumMachineCodeAvailable =
  typeof bridge?.invokeArraySum === 'function';
const nativeArrayNumericData = new WeakMap();
const INTRINSIC_FLOAT64_ARRAY = Float64Array;
const INTRINSIC_NUMBER_IS_SAFE_INTEGER = Number.isSafeInteger;
const INTRINSIC_OBJECT_IS = Object.is;

export function compileNativeMachineCode(code) {
  if (!bridge) throw new Error('The Windows x64 native bridge is not available.');
  return bridge.compile(code);
}

export function invokeNativeMachineCode(handle, stepLimit, args) {
  if (!bridge) throw new Error('The Windows x64 native bridge is not available.');
  return bridge.invoke(handle, stepLimit, ...args);
}

export function invokeNativeArraySumMachineCode(handle, values) {
  if (!nativeArraySumMachineCodeAvailable) {
    throw new Error('The native bridge does not support typed-array machine-code execution.');
  }
  const numericData = nativeArrayNumericData.get(values);
  if (!numericData?.valid || numericData.values.length !== values.length) {
    throw new TypeError('Native array summation requires a guarded numeric VM array.');
  }
  return bridge.invokeArraySum(handle, numericData.values);
}

export function hasNativeNumericArrayData(values) {
  const numericData = nativeArrayNumericData.get(values);
  return Boolean(numericData?.valid && numericData.values.length === values.length);
}

export function getNativeNumericArrayData(values) {
  const numericData = nativeArrayNumericData.get(values);
  if (!numericData?.valid || numericData.values.length !== values.length) {
    throw new TypeError('Native array summation requires a guarded numeric VM array.');
  }
  return numericData.values;
}

export function getNativeNumericArrayExactIntegerSum(values) {
  const numericData = nativeArrayNumericData.get(values);
  if (!numericData?.valid || numericData.values.length !== values.length) {
    throw new TypeError('Native array summation requires a guarded numeric VM array.');
  }
  return numericData.exactIntegerSum;
}

export function createNativeNumericArray(values, cacheExactIntegerSum = false) {
  const numericValues = new INTRINSIC_FLOAT64_ARRAY(values.length);
  let exactIntegerSum = cacheExactIntegerSum ? 0 : null;
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    numericValues[index] = value;
    if (exactIntegerSum === null) continue;
    if (!INTRINSIC_NUMBER_IS_SAFE_INTEGER(value) || INTRINSIC_OBJECT_IS(value, -0)) {
      exactIntegerSum = null;
      continue;
    }
    exactIntegerSum += value;
    if (!INTRINSIC_NUMBER_IS_SAFE_INTEGER(exactIntegerSum)) exactIntegerSum = null;
  }
  const numericData = {
    exactIntegerSum,
    values: numericValues,
    valid: true,
  };
  const proxy = new Proxy(values, {
    set(target, property, value, receiver) {
      numericData.valid = false;
      return Reflect.set(target, property, value, receiver);
    },
    defineProperty(target, property, descriptor) {
      numericData.valid = false;
      return Reflect.defineProperty(target, property, descriptor);
    },
    deleteProperty(target, property) {
      numericData.valid = false;
      return Reflect.deleteProperty(target, property);
    },
  });
  nativeArrayNumericData.set(proxy, numericData);
  return proxy;
}
