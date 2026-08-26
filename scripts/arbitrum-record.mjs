import { createPublicClient, createWalletClient, getAddress, http, isAddress, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia } from 'viem/chains';
import { compileRouteRegistry } from './lib/compile-route-registry.mjs';
import { computeReceiptId } from '../src/arbitrum.js';

const rpcUrl = process.env.ARBITRUM_RPC_URL;
const privateKey = process.env.ARBITRUM_DEPLOYER_PRIVATE_KEY;
const registryAddress = process.env.OSA_ARBITRUM_REGISTRY;
const routeUrl = process.env.OSA_ROUTE_URL || 'http://127.0.0.1:4021/route';
if (!rpcUrl) throw new Error('ARBITRUM_RPC_URL is required');
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey || '')) throw new Error('ARBITRUM_DEPLOYER_PRIVATE_KEY is invalid');
if (!isAddress(registryAddress || '', { strict: false })) throw new Error('OSA_ARBITRUM_REGISTRY is invalid');
if (process.env.ARBITRUM_CONFIRM_TESTNET_TX !== 'YES') {
  throw new Error('set ARBITRUM_CONFIRM_TESTNET_TX=YES to authorize this Arbitrum Sepolia receipt transaction');
}
const normalizedRegistryAddress = getAddress(registryAddress.toLowerCase());

const response = await fetch(routeUrl, { signal: AbortSignal.timeout(20_000) });
if (!response.ok) throw new Error(`OSA route request failed with HTTP ${response.status}`);
const route = await response.json();
const call = route?.arbitrum?.contractCall;
if (route?.arbitrum?.network?.chainId !== arbitrumSepolia.id || call?.functionName !== 'recordRouteReceipt' || !Array.isArray(call.args)) {
  throw new Error('OSA route response does not contain an Arbitrum Sepolia receipt call');
}
if (route.arbitrum.registryAddress && getAddress(route.arbitrum.registryAddress.toLowerCase()) !== normalizedRegistryAddress) {
  throw new Error('OSA route registry does not match OSA_ARBITRUM_REGISTRY');
}
if (keccak256(toHex(String(route.arbitrum.evidenceJson || ''))) !== route.arbitrum.evidenceHash) {
  throw new Error('OSA route evidence does not match evidenceHash');
}

const account = privateKeyToAccount(privateKey);
const transport = http(rpcUrl, { timeout: 15_000, retryCount: 2 });
const publicClient = createPublicClient({ chain: arbitrumSepolia, transport });
const walletClient = createWalletClient({ account, chain: arbitrumSepolia, transport });
if (await publicClient.getChainId() !== arbitrumSepolia.id) throw new Error('RPC is not Arbitrum Sepolia');
const artifact = compileRouteRegistry();
const args = [call.args[0], Number(call.args[1]), Number(call.args[2]), call.args[3], BigInt(call.args[4])];
const onchainDecisionId = await publicClient.readContract({
  address: normalizedRegistryAddress,
  abi: artifact.abi,
  functionName: 'computeDecisionId',
  args
});
if (onchainDecisionId !== route.arbitrum.decisionId) throw new Error('offchain decision ID does not match the registry');

const simulation = await publicClient.simulateContract({
  address: normalizedRegistryAddress,
  abi: artifact.abi,
  functionName: 'recordRouteReceipt',
  args,
  account
});
const hash = await walletClient.writeContract(simulation.request);
const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
if (receipt.status !== 'success') throw new Error(`receipt transaction failed: ${hash}`);

console.log(JSON.stringify({
  ok: true,
  decisionId: route.arbitrum.decisionId,
  receiptId: computeReceiptId(route.arbitrum.decisionId, account.address),
  reporter: account.address,
  transactionHash: hash,
  explorerUrl: `https://sepolia.arbiscan.io/tx/${hash}`
}, null, 2));
