import { ethers } from 'ethers';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const tokenArtifact = require('../abi/MyToken.json');

const DEFAULT_RPC_URL = 'http://hardhat:8545';
const BLOCKCHAIN_CONFIG_ERROR = 'Blockchain client is not configured: set a valid CONTRACT_ADDRESS';

export default class BlockchainClient {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(process.env.RPC_URL || DEFAULT_RPC_URL);
    this.contractAddress = process.env.CONTRACT_ADDRESS;
    this.contract = null;

    if (!this.contractAddress) {
      console.warn('BlockchainClient disabled: missing CONTRACT_ADDRESS');
      return;
    }

    if (!ethers.isAddress(this.contractAddress)) {
      console.warn(`BlockchainClient disabled: invalid CONTRACT_ADDRESS (${this.contractAddress})`);
      return;
    }

    this.contract = new ethers.Contract(this.contractAddress, tokenArtifact.abi, this.provider);

    console.log(`BlockchainClient initialized for contract: ${this.contractAddress}`);
  }

  isConfigured() {
    return this.contract !== null;
  }

  ensureConfigured() {
    if (!this.isConfigured()) {
      const error = new Error(BLOCKCHAIN_CONFIG_ERROR);
      error.status = 503;
      error.statusCode = 503;
      throw error;
    }
  }

  async getBalance(address) {
    try {
      this.ensureConfigured();

      if (!ethers.isAddress(address)) {
        throw new Error('Invalid address format');
      }

      const balanceRaw = await this.contract.balanceOf(address);
      return ethers.formatUnits(balanceRaw, 18);
    } catch (error) {
      console.error(`Error getting balance for ${address}:`, error.message);
      throw error;
    }
  }

  async getTokenDetails() {
    try {
      this.ensureConfigured();

      const [name, symbol, supply] = await Promise.all([
        this.contract.name(),
        this.contract.symbol(),
        this.contract.totalSupply(),
      ]);

      return {
        name,
        symbol,
        totalSupply: ethers.formatUnits(supply, 18),
      };
    } catch (error) {
      console.error('Error fetching token details:', error);
      throw error;
    }
  }

  async getContractName() {
    this.ensureConfigured();
    return this.contract.name();
  }

  async transfer({ fromAddress, toAddress, amount }) {
    this.ensureConfigured();

    if (!ethers.isAddress(fromAddress) || !ethers.isAddress(toAddress)) {
      const error = new Error("Invalid wallet address");
      error.status = 400;
      throw error;
    }

    const amountNumber = Number(amount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      const error = new Error("Invalid amount");
      error.status = 400;
      throw error;
    }

    const signer = await this.provider.getSigner(fromAddress);
    const contractWithSigner = this.contract.connect(signer);
    const value = ethers.parseUnits(String(amount), 18);
    const txResponse = await contractWithSigner.transfer(toAddress, value);
    await txResponse.wait();
    return txResponse.hash;
  }
}
