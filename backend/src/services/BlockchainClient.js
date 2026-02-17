import { ethers } from 'ethers';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const tokenArtifact = require('../abi/MyToken.json');

const DEFAULT_RPC_URL = 'http://localhost:8545';

export default class BlockchainClient {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(process.env.RPC_URL || DEFAULT_RPC_URL);
    this.contractAddress = process.env.CONTRACT_ADDRESS;

    this.contract = new ethers.Contract(
      this.contractAddress,
      tokenArtifact.abi,
      this.provider
    );

    console.log(`BlockchainClient initialized for contract: ${this.contractAddress}`);
  }

  async getBalance(address) {
    try {
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
}
