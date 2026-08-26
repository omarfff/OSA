import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia } from 'viem/chains';
import { compileRouteRegistry } from './lib/compile-route-registry.mjs';

const rpcUrl = process.env.ARBITRUM_RPC_URL;
const privateKey = process.env.ARBITRUM_DEPLOYER_PRIVATE_KEY;
if (!rpcUrl) throw new Error('ARBITRUM_RPC_URL is required');
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey || '')) {
  throw new Error('ARBITRUM_DEPLOYER_PRIVATE_KEY must be a 32-byte hex private key');
}
if (process.env.ARBITRUM_CONFIRM_TESTNET_TX !== 'YES') {
  throw new Error('set ARBITRUM_CONFIRM_TESTNET_TX=YES to authorize this Arbitrum Sepolia deployment');
}

const account = privateKeyToAccount(privateKey);
const transport = http(rpcUrl, { timeout: 15_000, retryCount: 2 });
const publicClient = createPublicClient({ chain: arbitrumSepolia, transport });
const walletClient = createWalletClient({ account, chain: arbitrumSepolia, transport });
const chainId = await publicClient.getChainId();
if (chainId !== arbitrumSepolia.id) throw new Error(`RPC chain ${chainId} is not Arbitrum Sepolia (${arbitrumSepolia.id})`);
const balance = await publicClient.getBalance({ address: account.address });
if (balance === 0n) throw new Error(`deployer ${account.address} has no Arbitrum Sepolia ETH for gas`);

const artifact = compileRouteRegistry();
const hash = await walletClient.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode,
  account
});
const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
if (!receipt.contractAddress || receipt.status !== 'success') throw new Error(`deployment failed: ${hash}`);

console.log(JSON.stringify({
  ok: true,
  network: arbitrumSepolia.name,
  chainId,
  deployer: account.address,
  contractAddress: receipt.contractAddress,
  transactionHash: hash,
  explorerUrl: `https://sepolia.arbiscan.io/tx/${hash}`
}, null, 2));
