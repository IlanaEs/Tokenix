import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ABI_PATH = path.join(__dirname, '../abi/MyToken.json');
const FAUCET_ABI_PATH = path.join(__dirname, '../abi/GuardedFaucet.json');
const DEPLOYMENT_EPOCH_PATH = path.join(__dirname, '../abi/DeploymentEpoch.json');
const DEFAULT_RPC_URL = process.env.RPC_URL || 'http://hardhat:8545';
const DEFAULT_ETH_FUNDING_AMOUNT = '0.005';
const DEFAULT_TOKEN_PROVISION_AMOUNT = '100';
const BLOCKCHAIN_CONFIG_ERROR = 'Blockchain client is not configured: missing ABI/Contract Address';
const ENABLE_TRANSFER_EVENT_LOGS = process.env.ENABLE_TRANSFER_EVENT_LOGS === 'true';
const WAIT_FOR_TX_TIMEOUT_MS = 60_000;
const DEFAULT_CONFIRMATION_TARGET = Number(process.env.TX_CONFIRMATIONS_REQUIRED || '1');
function getConfiguredChainEpochId() {
  if (process.env.CHAIN_EPOCH_ID) {
    return process.env.CHAIN_EPOCH_ID;
  }

  try {
    if (fs.existsSync(DEPLOYMENT_EPOCH_PATH)) {
      const epoch = JSON.parse(fs.readFileSync(DEPLOYMENT_EPOCH_PATH, 'utf8'));
      if (epoch?.chainEpochId) {
        return String(epoch.chainEpochId);
      }
    }
  } catch {
    // Fall through to the safe local default.
  }

  return 'local-dev-default';
}

const DEFAULT_CHAIN_EPOCH_ID = getConfiguredChainEpochId();
const DEFAULT_FAUCET_SIGNER_PRIVATE_KEY = process.env.FAUCET_SIGNER_PRIVATE_KEY || '';

function assertValidTxHash(txHash) {
  if (!ethers.isHexString(txHash, 32)) {
    const error = new Error('Invalid txHash');
    error.status = 400;
    throw error;
  }
}

export default class BlockchainClient {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(DEFAULT_RPC_URL);
    this.contract = null;
    this.contractAddress = null;
    this.faucetContract = null;
    this.faucetAddress = null;
    this.isListening = false;
    // Serializes dev faucet operations that send transactions from the shared
    // admin account (account 0). See _runExclusiveFaucet / fundAccount.
    this._faucetQueue = Promise.resolve();

    this._initialize();
  }

  _initialize() {
    try {
      if (!fs.existsSync(ABI_PATH)) {
        console.warn('⚠️ BlockchainClient: ABI file not found at', ABI_PATH);
        return;
      }

      const tokenJson = JSON.parse(fs.readFileSync(ABI_PATH, 'utf8'));
      const abi = tokenJson.abi;
      this.contractAddress = tokenJson.address || process.env.CONTRACT_ADDRESS;

      if (!this.contractAddress || !abi) {
        console.warn('⚠️ BlockchainClient: Missing address or ABI in JSON');
        return;
      }

      this.contract = new ethers.Contract(this.contractAddress, abi, this.provider);
      console.log(`✅ BlockchainClient connected to: ${this.contractAddress}`);

      if (fs.existsSync(FAUCET_ABI_PATH)) {
        const faucetJson = JSON.parse(fs.readFileSync(FAUCET_ABI_PATH, 'utf8'));
        const faucetAbi = faucetJson.abi;
        this.faucetAddress = faucetJson.address || process.env.FAUCET_CONTRACT_ADDRESS || null;
        if (this.faucetAddress && faucetAbi) {
          this.faucetContract = new ethers.Contract(this.faucetAddress, faucetAbi, this.provider);
          console.log(`✅ GuardedFaucet connected to: ${this.faucetAddress}`);
        }
      }

      if (ENABLE_TRANSFER_EVENT_LOGS) {
        this.setupEventListeners();
      }
    } catch (err) {
      console.error('❌ Failed to initialize BlockchainClient:', err.message);
    }
  }

  _ensureInitialized() {
    if (!this.contract) {
      this._initialize();
    }
  }

  setupEventListeners() {
    if (this.isListening || !this.contract) return;

    console.log('📡 Starting Event Listeners for Transfer events...');
    this.contract.on('Transfer', (from, to, value, event) => {
      const txHash = event?.log?.transactionHash || event?.transactionHash;
      console.log(`⛓️ New Transfer on-chain: ${txHash} (${ethers.formatUnits(value, 18)} tokens)`);
    });
    this.isListening = true;
  }

  isConfigured() {
    this._ensureInitialized();
    return this.contract !== null;
  }

  ensureConfigured() {
    this._ensureInitialized();
    if (!this.contract) {
      const error = new Error(BLOCKCHAIN_CONFIG_ERROR);
      error.status = 502;
      throw error;
    }
  }

  ensureFaucetConfigured() {
    this.ensureConfigured();
    if (!this.faucetContract) {
      const error = new Error('Guarded faucet is not configured');
      error.status = 502;
      error.code = 'FAUCET_NOT_CONFIGURED';
      throw error;
    }
  }

  async getContractName() {
    this.ensureConfigured();

    try {
      return await this.contract.name();
    } catch (err) {
      console.error('❌ getContractName failed:', err.message);
      const error = new Error('Failed to fetch contract name from blockchain');
      error.status = 502;
      throw error;
    }
  }

  async getContractInfo() {
    const contractName = await this.getContractName();

    return {
      contractAddress: this.contractAddress,
      faucetAddress: this.faucetAddress,
      contractName,
    };
  }


  async getBalance(address) {
    this.ensureConfigured();
    try {
      const balanceRaw = await this.contract.balanceOf(address);
      return ethers.formatUnits(balanceRaw, 18);
    } catch (err) {
      const error = new Error('Failed to fetch balance from blockchain');
      error.status = 502;
      throw error;
    }
  }

  async getTokenBalanceRaw(address) {
    this.ensureConfigured();
    try {
      const balanceRaw = await this.contract.balanceOf(address);
      const decimals = await this.contract.decimals();
      return {
        raw: balanceRaw.toString(),
        decimals: Number(decimals),
        display: ethers.formatUnits(balanceRaw, decimals),
      };
    } catch (err) {
      const error = new Error('Failed to fetch token balance from blockchain');
      error.status = 502;
      error.code = 'BLOCKCHAIN_UNAVAILABLE';
      throw error;
    }
  }

  async getNativeBalanceRaw(address) {
    try {
      const balanceRaw = await this.provider.getBalance(address);
      return {
        raw: balanceRaw.toString(),
        decimals: 18,
        display: ethers.formatEther(balanceRaw),
      };
    } catch (err) {
      const error = new Error('Failed to fetch native balance from blockchain');
      error.status = 502;
      error.code = 'BLOCKCHAIN_UNAVAILABLE';
      throw error;
    }
  }

  async getChainId() {
    const network = await this.provider.getNetwork();
    return Number(network.chainId);
  }

  getConfirmationTarget() {
    return Number.isInteger(DEFAULT_CONFIRMATION_TARGET) && DEFAULT_CONFIRMATION_TARGET > 0
      ? DEFAULT_CONFIRMATION_TARGET
      : 1;
  }

  getChainEpochId() {
    return DEFAULT_CHAIN_EPOCH_ID;
  }

  getFaucetSignerWallet() {
    if (!DEFAULT_FAUCET_SIGNER_PRIVATE_KEY) {
      const error = new Error('Faucet signer private key is not configured');
      error.code = 'FAUCET_SIGNER_UNAVAILABLE';
      error.status = 503;
      throw error;
    }

    return new ethers.Wallet(DEFAULT_FAUCET_SIGNER_PRIVATE_KEY, this.provider);
  }

  async computeFaucetRequestId(walletAddress) {
    this.ensureFaucetConfigured();
    return this.faucetContract.computeRequestId(walletAddress);
  }

  async buildSignedGasFundingTransaction({ toAddress, nonce, amountEth = DEFAULT_ETH_FUNDING_AMOUNT }) {
    const signer = this.getFaucetSignerWallet();
    const network = await this.provider.getNetwork();
    const feeData = await this.provider.getFeeData();
    const transaction = {
      type: 2,
      chainId: Number(network.chainId),
      nonce,
      to: toAddress,
      value: ethers.parseEther(String(amountEth)),
      gasLimit: 21_000n,
      maxFeePerGas: feeData.maxFeePerGas || feeData.gasPrice || ethers.parseUnits('2', 'gwei'),
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits('1', 'gwei'),
    };

    const rawTransaction = await signer.signTransaction(transaction);
    return {
      rawTransaction,
      txHash: ethers.keccak256(rawTransaction),
      signerAddress: await signer.getAddress(),
      chainId: Number(network.chainId),
      gasLimit: transaction.gasLimit.toString(),
      maxFeePerGas: transaction.maxFeePerGas.toString(),
      maxPriorityFeePerGas: transaction.maxPriorityFeePerGas.toString(),
    };
  }

  async buildSignedTokenFundingTransaction({ walletAddress, requestId, nonce, tokenAmount = DEFAULT_TOKEN_PROVISION_AMOUNT }) {
    this.ensureFaucetConfigured();
    const signer = this.getFaucetSignerWallet();
    const network = await this.provider.getNetwork();
    const feeData = await this.provider.getFeeData();
    const amount = ethers.parseUnits(String(tokenAmount), 18);
    const data = this.faucetContract.interface.encodeFunctionData('claim', [
      walletAddress,
      requestId,
      amount,
    ]);
    const gasLimit = await this.provider.estimateGas({
      from: await signer.getAddress(),
      to: this.faucetAddress,
      data,
    });
    const transaction = {
      type: 2,
      chainId: Number(network.chainId),
      nonce,
      to: this.faucetAddress,
      data,
      value: 0n,
      gasLimit: gasLimit + (gasLimit / 5n),
      maxFeePerGas: feeData.maxFeePerGas || feeData.gasPrice || ethers.parseUnits('2', 'gwei'),
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits('1', 'gwei'),
    };

    const rawTransaction = await signer.signTransaction(transaction);
    return {
      rawTransaction,
      txHash: ethers.keccak256(rawTransaction),
      signerAddress: await signer.getAddress(),
      chainId: Number(network.chainId),
      gasLimit: transaction.gasLimit.toString(),
      maxFeePerGas: transaction.maxFeePerGas.toString(),
      maxPriorityFeePerGas: transaction.maxPriorityFeePerGas.toString(),
      amountRaw: amount.toString(),
    };
  }

  async broadcastSignedTransaction(rawTransaction) {
    try {
      return await this.provider.broadcastTransaction(rawTransaction);
    } catch (err) {
      const message = String(err?.shortMessage || err?.message || '').toLowerCase();
      if (message.includes('already known') || message.includes('known transaction')) {
        return null;
      }
      const error = new Error('Transaction broadcast failed');
      error.status = 502;
      error.code = 'BROADCAST_FAILED';
      throw error;
    }
  }

 
  // Serialize admin-signer faucet operations on this instance.
  //
  // Legacy/test-only: the original dev faucet funded each new wallet with an ETH
  // transfer and a direct token mint from a single shared admin account
  // (account 0), so concurrent wallet creations could contend on that account's
  // nonce. Chaining every run through this queue guarantees one completes (and
  // consumes its nonce) before the next begins. The direct-mint path is now
  // disabled (see _fundAccountUnlocked); this serialization is retained only to
  // keep the faucet-concurrency unit tests meaningful.
  _runExclusiveFaucet(operation) {
    const result = this._faucetQueue.then(operation, operation);
    // Keep the queue alive regardless of this run's outcome so a single failed
    // funding does not poison subsequent faucet operations.
    this._faucetQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  // DEPRECATED dev faucet path. Token ownership is transferred to the
  // GuardedFaucet at deploy time, so the admin account (account 0) can no longer
  // mint directly — a direct token.mint() reverts with OwnableUnauthorizedAccount.
  // Wallet funding now runs through the wallet funding worker, which mints via the
  // faucet's owner-gated claim() (see walletFundingWorker.js /
  // buildSignedTokenFundingTransaction). Do not wire this back into wallet creation.
  async fundAccount(toAddress, amountEth = DEFAULT_ETH_FUNDING_AMOUNT, tokenAmount = DEFAULT_TOKEN_PROVISION_AMOUNT) {
    this.ensureConfigured();
    return this._runExclusiveFaucet(() =>
      this._fundAccountUnlocked(toAddress, amountEth, tokenAmount)
    );
  }

  async _fundAccountUnlocked() {
    // Intentionally disabled: a direct token.mint() from the admin account
    // reverts now that the GuardedFaucet owns the token. Fund wallets through the
    // wallet funding worker (GuardedFaucet.claim()) rather than resurrecting this
    // direct-mint path.
    const error = new Error(
      'Direct admin-mint faucet funding is disabled: the token is owned by the ' +
      'GuardedFaucet. Fund wallets through the wallet funding worker (GuardedFaucet.claim()).'
    );
    error.status = 501;
    error.code = 'FAUCET_DIRECT_MINT_DISABLED';
    throw error;
  }

  async getTransaction(txHash) {
    this.ensureConfigured();
    assertValidTxHash(txHash);
    return this.provider.getTransaction(txHash);
  }

  async getTransactionReceipt(txHash) {
    this.ensureConfigured();
    assertValidTxHash(txHash);
    return this.provider.getTransactionReceipt(txHash);
  }

  async transferWithHardhatImpersonation({ fromAddress, toAddress, amount }) {
    this.ensureConfigured();
    const normalizedFrom = fromAddress.toLowerCase();

    try {
      await this.provider.send('hardhat_impersonateAccount', [normalizedFrom]);

      const signer = new ethers.JsonRpcSigner(this.provider, normalizedFrom);
      const contractWithSigner = this.contract.connect(signer);
      const value = ethers.parseUnits(String(amount), 18);

      const txResponse = await contractWithSigner.transfer(toAddress, value);

      await this.provider.send('hardhat_stopImpersonatingAccount', [normalizedFrom]);

      return txResponse.hash;
    } catch (err) {
      try {
        await this.provider.send('hardhat_stopImpersonatingAccount', [normalizedFrom]);
      } catch (stopErr) {
        // Hardhat may already have stopped impersonating after a failed call.
      }

      console.error('❌ Blockchain Transfer Error:', err.message);
      const error = new Error(err.message || 'Transfer failed');
      error.status = err.status || 502;
      error.txHash = err?.txHash || null;
      throw error;
    }
  }

  async waitForTransaction(txHash, confirmations = 1) {
    try {
      const receipt = await this.provider.waitForTransaction(
        txHash,
        confirmations,
        WAIT_FOR_TX_TIMEOUT_MS
      );
      if (!receipt) throw new Error('Receipt not found');
      return receipt;
    } catch (err) {
      const error = new Error('Transaction confirmation timeout or error');
      error.status = 502;
      throw error;
    }
  }

  async getConfirmations(txHash) {
    const receipt = await this.getTransactionReceipt(txHash);
    if (!receipt) {
      return { receipt: null, confirmations: 0 };
    }

    const currentBlock = await this.provider.getBlockNumber();
    const confirmations = Math.max(0, currentBlock - Number(receipt.blockNumber) + 1);
    return { receipt, confirmations };
  }

  validateFaucetClaimReceipt({ receipt, walletAddress, requestId, amountRaw }) {
    this.ensureFaucetConfigured();
    if (!receipt || Number(receipt.status) !== 1) {
      const error = new Error('Token funding transaction failed');
      error.code = 'TOKEN_FUNDING_REVERTED';
      throw error;
    }

    const matchingLog = receipt.logs.find((log) => {
      try {
        if (ethers.getAddress(log.address) !== ethers.getAddress(this.faucetAddress)) {
          return false;
        }
        const parsed = this.faucetContract.interface.parseLog(log);
        return (
          parsed?.name === 'FaucetClaimed' &&
          parsed.args.requestId === requestId &&
          ethers.getAddress(parsed.args.wallet) === ethers.getAddress(walletAddress) &&
          parsed.args.amount === BigInt(amountRaw)
        );
      } catch {
        return false;
      }
    });

    if (!matchingLog) {
      const error = new Error('Expected faucet claim event not found');
      error.code = 'TOKEN_TRANSFER_EVENT_MISSING';
      throw error;
    }

    return true;
  }
}
