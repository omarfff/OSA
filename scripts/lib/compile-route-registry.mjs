import fs from 'node:fs';
import solc from 'solc';

const contractUrl = new URL('../../contracts/OSARouteRegistry.sol', import.meta.url);

export function routeRegistrySource() {
  return fs.readFileSync(contractUrl, 'utf8');
}

export function compileRouteRegistry() {
  const input = {
    language: 'Solidity',
    sources: {
      'OSARouteRegistry.sol': { content: routeRegistrySource() }
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'paris',
      outputSelection: {
        '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'metadata'] }
      }
    }
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter((entry) => entry.severity === 'error');
  if (errors.length) throw new Error(errors.map((entry) => entry.formattedMessage).join('\n'));
  const contract = output.contracts?.['OSARouteRegistry.sol']?.OSARouteRegistry;
  if (!contract?.evm?.bytecode?.object) throw new Error('OSARouteRegistry compilation produced no bytecode');
  return {
    compilerVersion: solc.version(),
    abi: contract.abi,
    bytecode: `0x${contract.evm.bytecode.object}`,
    deployedBytecode: `0x${contract.evm.deployedBytecode.object}`,
    metadata: JSON.parse(contract.metadata)
  };
}
