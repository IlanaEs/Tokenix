import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ABI_PATH = path.join(__dirname, '../abi/MyToken.json');
const DEFAULT_RPC_URL = process.env.RPC_URL || 'http://hardhat:8545';
const BLOCKCHAIN_CONFIG_ERROR = 'Blockchain client is not configured: missing ABI/Contract Address';
const ENABLE_TRANSFER_EVENT_LOGS = process.env.ENABLE_TRANSFER_EVENT_LOGS === 'true';

export default class BlockchainClient {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(DEFAULT_RPC_URL);
    this.contract = null;
    this.contractAddress = null;
    this.isListening = false;

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

 
  async fundAccount(toAddress, amountEth = '0.005') {
    this.ensureConfigured();
    try {
      const accounts = await this.provider.listAccounts();
      if (!accounts || accounts.length === 0) {
        const error = new Error('No accounts available on provider for faucet');
        error.status = 502;
        throw error;
      }
      let adminSigner;
      // accounts may be strings (addresses) or Signer-like objects depending on provider
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
        value: ethers.parseEther(String(amountEth))
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
    this.ensureConfigured();
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

  // expose admin signer for tests and internal use
  async _getAdminSigner() {
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
