import { ethers } from 'ethers';

export interface WalletInfo {
  address: string;
  balance: string;
  chainId: number;
  network: string;
}

class Web3Service {
  private provider: ethers.BrowserProvider | null = null;
  private signer: ethers.JsonRpcSigner | null = null;

  async connect(): Promise<WalletInfo> {
    if (typeof window.ethereum === 'undefined') {
      throw new Error('MetaMask is not installed. Please install MetaMask to continue.');
    }

    try {
      // Request account access
      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts'
      });

      this.provider = new ethers.BrowserProvider(window.ethereum);
      this.signer = await this.provider.getSigner();

      const address = accounts[0];
      const balance = await this.provider.getBalance(address);
      const network = await this.provider.getNetwork();

      return {
        address,
        balance: ethers.formatEther(balance),
        chainId: Number(network.chainId),
        network: network.name,
      };
    } catch (error: any) {
      console.error('Failed to connect wallet:', error);
      throw new Error(error.message || 'Failed to connect wallet');
    }
  }

  async disconnect(): Promise<void> {
    this.provider = null;
    this.signer = null;
  }

  async getBalance(address?: string): Promise<string> {
    if (!this.provider) {
      throw new Error('Wallet not connected');
    }

    const addr = address || await this.signer?.getAddress();
    if (!addr) {
      throw new Error('No address available');
    }

    const balance = await this.provider.getBalance(addr);
    return ethers.formatEther(balance);
  }

  async signMessage(message: string): Promise<string> {
    if (!this.signer) {
      throw new Error('Wallet not connected');
    }

    return await this.signer.signMessage(message);
  }

  async switchNetwork(chainId: number): Promise<void> {
    if (typeof window.ethereum === 'undefined') {
      throw new Error('MetaMask is not installed');
    }

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${chainId.toString(16)}` }],
      });
    } catch (error: any) {
      // If network doesn't exist, add it
      if (error.code === 4902) {
        throw new Error('Network not found. Please add it manually.');
      }
      throw error;
    }
  }

  isConnected(): boolean {
    return this.provider !== null && this.signer !== null;
  }

  getProvider(): ethers.BrowserProvider | null {
    return this.provider;
  }

  getSigner(): ethers.JsonRpcSigner | null {
    return this.signer;
  }
}

// Add ethereum to window
declare global {
  interface Window {
    ethereum?: any;
  }
}

export const web3Service = new Web3Service();
export default web3Service;
