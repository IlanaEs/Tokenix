import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ABI_PATH = path.join(__dirname, '../abi/MyToken.json');
const DEFAULT_RPC_URL = process.env.RPC_URL || 'http://hardhat:8545';
const BLOCKCHAIN_CONFIG_ERROR = 'Blockchain client is not configured: missing ABI/Contract Address';

export default class BlockchainClient {
  constructor() {
    this.provider = null;
    this.contract = null;
    this.contractAddress = null;
    this.isListening = false;
    this._ready = false;
    this._readyPromise = this._initializeWithRetry();
  }

  async _initializeWithRetry(maxAttempts = 10, delayMs = 2000) {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        // Hardhat can come up a few seconds after the backend, so we retry
        // until the RPC is actually reachable instead of failing once at boot.
        await this._initialize();
        this._ready = true;
        return;
      } catch (err) {
        console.warn(`⚠️ BlockchainClient init attempt ${attempt}/${maxAttempts} failed: ${err.message}`);
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    console.error('❌ BlockchainClient failed to initialize after all attempts');
  }

  async _initialize() {
    if (!fs.existsSync(ABI_PATH)) {
      throw new Error(`ABI file not found at ${ABI_PATH}`);
    }

    const tokenJson = JSON.parse(fs.readFileSync(ABI_PATH, 'utf8'));
    const abi = tokenJson.abi;
    this.contractAddress = tokenJson.address || process.env.CONTRACT_ADDRESS;

    if (!this.contractAddress || !abi) {
      throw new Error('Missing address or ABI in JSON');
    }

    this.provider = new ethers.JsonRpcProvider(DEFAULT_RPC_URL);
    // Constructing the provider is lazy in ethers v6; getNetwork forces a
    // real RPC round-trip so we don't mark the client ready too early.
    await this.provider.getNetwork();

    this.contract = new ethers.Contract(this.contractAddress, abi, this.provider);
    console.log(`✅ BlockchainClient connected to: ${this.contractAddress}`);

    this.setupEventListeners();
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
    return this._ready && this.contract !== null;
  }

  ensureConfigured() {
    if (!this.isConfigured()) {
      const error = new Error(BLOCKCHAIN_CONFIG_ERROR);
      error.status = 503;
      throw error;
    }
  }

  async waitReady(timeoutMs = 15000) {
    const start = Date.now();

    while (!this._ready) {
      if (Date.now() - start > timeoutMs) {
        const error = new Error('BlockchainClient not ready in time');
        error.status = 503;
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    await this._readyPromise;
  }

  async getBalance(address) {
    await this.waitReady();
    this.ensureConfigured();

    if (!ethers.isAddress(address)) {
      const error = new Error('Invalid wallet address');
      error.status = 400;
      throw error;
    }

    try {
      const balanceRaw = await this.contract.balanceOf(address);
      return ethers.formatUnits(balanceRaw, 18);
    } catch (err) {
      console.error('❌ getBalance failed:', err.message);
      const error = new Error('Failed to fetch balance from blockchain');
      error.status = 502;
      throw error;
    }
  }

  async getContractName() {
    await this.waitReady();
    this.ensureConfigured();

    try {
      return await this.contract.name();
    } catch (err) {
      console.error('❌ getContractName failed:', err.message);
      const error = new Error('Failed to fetch contract name');
      error.status = 502;
      throw error;
    }
  }

  async fundAccount(toAddress, amountEth = '0.005') {
    await this.waitReady();
    this.ensureConfigured();

    if (!ethers.isAddress(toAddress)) {
      const error = new Error('Invalid wallet address');
      error.status = 400;
      throw error;
    }

    try {
      const accounts = await this.provider.listAccounts();
      if (!accounts || accounts.length === 0) {
        const error = new Error('No accounts available on provider for faucet');
        error.status = 502;
        throw error;
      }

      let adminSigner;
      if (typeof accounts[0] === 'string') {
        adminSigner = this.provider.getSigner(accounts[0]);
      } else if (accounts[0] && typeof accounts[0].sendTransaction === 'function') {
        adminSigner = accounts[0];
      } else {
        adminSigner = this.provider.getSigner(0);
      }

      console.log(`⛽ Funding ${toAddress} with ${amountEth} ETH...`);
      const tx = await adminSigner.sendTransaction({
        to: toAddress,
        value: ethers.parseEther(String(amountEth)),
      });

      await this.waitForTransaction(tx.hash);
      console.log(`✅ Funding confirmed for ${toAddress}`);
      return tx.hash;
    } catch (err) {
      console.error('❌ Faucet failed:', err.message);
      const error = new Error('Faucet funding failed');
      error.status = 502;
      throw error;
    }
  }

  async transfer({ fromAddress, toAddress, amount }) {
    await this.waitReady();
    this.ensureConfigured();

    if (!ethers.isAddress(fromAddress) || !ethers.isAddress(toAddress)) {
      const error = new Error('Invalid wallet address');
      error.status = 400;
      throw error;
    }

    try {
      const signer = await this.provider.getSigner(fromAddress);
      const contractWithSigner = this.contract.connect(signer);
      const value = ethers.parseUnits(String(amount), 18);

      const txResponse = await contractWithSigner.transfer(toAddress, value);
      const receipt = await this.waitForTransaction(txResponse.hash);

      if (receipt.status === 0) throw new Error('Transaction reverted on-chain');

      return txResponse.hash;
    } catch (err) {
      console.error('❌ Blockchain Transfer Error:', err.message);
      const error = new Error(err.message || 'Transfer failed');
      error.status = err.status || 502;
      throw error;
    }
  }

  async _getAdminSigner() {
    await this.waitReady();
    this.ensureConfigured();

    const accounts = await this.provider.listAccounts();
    if (!accounts || accounts.length === 0) {
      const error = new Error('No accounts available on provider for admin actions');
      error.status = 502;
      throw error;
    }
    if (typeof accounts[0] === 'string') return this.provider.getSigner(accounts[0]);
    if (accounts[0] && typeof accounts[0].sendTransaction === 'function') return accounts[0];
    return this.provider.getSigner(0);
  }

  async waitForTransaction(txHash, confirmations = 1) {
    await this.waitReady();

    try {
      const receipt = await this.provider.waitForTransaction(txHash, confirmations);
      if (!receipt) throw new Error('Receipt not found');
      return receipt;
    } catch (err) {
      const error = new Error('Transaction confirmation timeout or error');
      error.status = 502;
      throw error;
    }
  }
}
