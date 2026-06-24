import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ABI_PATH = path.join(__dirname, '../abi/MyToken.json');
const DEFAULT_RPC_URL = process.env.RPC_URL || 'http://hardhat:8545';
const DEFAULT_ETH_FUNDING_AMOUNT = '0.005';
const DEFAULT_TOKEN_PROVISION_AMOUNT = '100';
const BLOCKCHAIN_CONFIG_ERROR = 'Blockchain client is not configured: missing ABI/Contract Address';
const ENABLE_TRANSFER_EVENT_LOGS = process.env.ENABLE_TRANSFER_EVENT_LOGS === 'true';
const WAIT_FOR_TX_TIMEOUT_MS = 60_000;

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

 
  // Serialize admin-signer faucet operations on this instance.
  //
  // The dev faucet funds each new wallet by sending an ETH transfer and a token
  // mint from a single shared admin account (account 0). When two wallet
  // creations run close together, both flows fetch the same pending nonce, so
  // one account's transaction is dropped and its waitForTransaction hangs until
  // the timeout — leaving the funding row stuck and then marked FAILED.
  //
  // Chaining every faucet run through this queue guarantees one funding
  // completes (and consumes its nonce) before the next begins, removing the
  // contention. This is dev/test funding infrastructure only: the production
  // frontend-signed transfer flow never uses the admin signer, so it is
  // unaffected by this serialization.
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

  async fundAccount(toAddress, amountEth = DEFAULT_ETH_FUNDING_AMOUNT, tokenAmount = DEFAULT_TOKEN_PROVISION_AMOUNT) {
    this.ensureConfigured();
    return this._runExclusiveFaucet(() =>
      this._fundAccountUnlocked(toAddress, amountEth, tokenAmount)
    );
  }

  async _fundAccountUnlocked(toAddress, amountEth, tokenAmount) {
    try {
      const accounts = await this.provider.listAccounts();
      if (!accounts || accounts.length === 0) {
        const error = new Error('No accounts available on provider for faucet');
        error.status = 502;
        throw error;
      }
      const adminSigner = await this._getAdminSigner();

      console.log(`⛽ Funding ${toAddress} with ${amountEth} ETH...`);
      const ethTx = await adminSigner.sendTransaction({
        to: toAddress,
        value: ethers.parseEther(String(amountEth))
      });

      await this.waitForTransaction(ethTx.hash);
      console.log(`✅ ETH funding confirmed for ${toAddress}`);

      const mintAmount = ethers.parseUnits(String(tokenAmount), 18);
      const mintTx = await this.contract.connect(adminSigner).mint(toAddress, mintAmount);

      await this.waitForTransaction(mintTx.hash);
      console.log(`✅ Minted ${ethers.formatUnits(mintAmount, 18)} TNX for ${toAddress}`);
      return mintTx.hash;
    } catch (err) {
      console.error('❌ Faucet failed:', err.message);
      const error = new Error('Faucet funding failed');
      error.status = 502;
      error.txHash = err?.txHash || null;
      throw error;
    }
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

  // expose admin signer for tests and internal use
  async _getAdminSigner() {
    this.ensureConfigured();
    const accounts = await this.provider.listAccounts();
    if (!accounts || accounts.length === 0) {
      const error = new Error('No accounts available on provider for admin actions');
      error.status = 502;
      throw error;
    }
    return this.provider.getSigner(0);
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
}
