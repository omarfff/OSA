import { compileRouteRegistry } from './lib/compile-route-registry.mjs';

const artifact = compileRouteRegistry();
console.log(JSON.stringify({
  ok: true,
  contract: 'OSARouteRegistry',
  compilerVersion: artifact.compilerVersion,
  bytecodeBytes: (artifact.bytecode.length - 2) / 2,
  functions: artifact.abi.filter((entry) => entry.type === 'function').map((entry) => entry.name).sort()
}, null, 2));
