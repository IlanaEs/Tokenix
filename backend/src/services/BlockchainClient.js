import { ethers } from 'ethers';
import { createRequire } from 'module';
import { pool } from '../db.js';

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
    this.setupEventListeners();
  }

  async setupEventListeners() {
    if (this.isListening || !this.contract) return;

    try {
      console.log("🎧 Starting Event Listeners for Transfer events...");
      
      this.contract.on("Transfer", async (from, to, value, eventPayload) => {
        try {
          const txHash = eventPayload?.log?.transactionHash || eventPayload?.transactionHash;
          
          if (txHash) {
            console.log(`🔔 Transfer Confirmed: ${txHash}`);
            await pool.query(
              "UPDATE transactions SET status = 'CONFIRMED', confirmed_at = NOW() WHERE tx_hash = $1 AND status = 'PENDING'",
              [txHash]
            );
          }
        } catch (err) {
          console.error("Error processing Transfer event:", err);
        }
      });

      this.isListening = true;
    } catch (error) {
      console.error("Failed to setup event listeners:", error);
    }
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

    try {
      let signer;
      try {
        // Try getting signer (only works if node manages keys)
        signer = await this.provider.getSigner(fromAddress);
      } catch (e) {
        console.warn(`Signer for ${fromAddress} unavailable. Using Admin Account (Demo Faucet Mode).`);
        const accounts = await this.provider.listAccounts();
        signer = accounts[0];
      }

      const contractWithSigner = this.contract.connect(signer);
      const value = ethers.parseUnits(String(amount), 18);

      console.log(`Initiating transfer: ${amount} tokens to ${toAddress}`);
      const txResponse = await contractWithSigner.transfer(toAddress, value);
      
      // Wait for confirmation
      await txResponse.wait(1);
      
      return txResponse.hash;
    } catch (error) {
      console.error("Blockchain Transfer Error:", error);
      throw new Error(`Transfer failed: ${error.message}`);
    }
  }
}
