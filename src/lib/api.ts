import axios, { AxiosInstance } from 'axios';

// In Cloudflare Pages the frontend and API are on the same origin — use relative URLs.
// VITE_API_URL can override for local dev (e.g. http://localhost:8788).
const API_BASE_URL = import.meta.env.VITE_API_URL || '';

class ApiService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add auth token to requests
    this.client.interceptors.request.use((config) => {
      const token = localStorage.getItem('auth_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    // Handle 401 responses
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          localStorage.removeItem('auth_token');
          localStorage.removeItem('user');
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }
    );
  }

  // Auth endpoints
  async login(email: string, password: string) {
    const { data } = await this.client.post('/api/auth/login', { email, password });
    return data;
  }

  async register(email: string, password: string, fullName: string) {
    const { data } = await this.client.post('/api/auth/register', { email, password, fullName });
    return data;
  }

  // Bot endpoints
  async getBots() {
    const { data } = await this.client.get('/api/bots');
    return data.bots || [];
  }

  async createBot(botData: {
    name: string;
    strategy: string;
    symbol: string;
    exchange: string;
    riskLevel?: string;
    maxPositionSize?: number;
  }) {
    const { data } = await this.client.post('/api/bots', botData);
    return data;
  }

  async updateBot(botId: string, updates: any) {
    const { data } = await this.client.put(`/api/bots/${botId}`, updates);
    return data;
  }

  async deleteBot(botId: string) {
    const { data } = await this.client.delete(`/api/bots/${botId}`);
    return data;
  }

  async startBot(botId: string) {
    const { data } = await this.client.post(`/api/bots/${botId}/start`);
    return data;
  }

  async stopBot(botId: string) {
    const { data } = await this.client.post(`/api/bots/${botId}/stop`);
    return data;
  }

  // Trade endpoints
  async getTrades(limit = 100) {
    const { data } = await this.client.get(`/api/trades?limit=${limit}`);
    return data.trades || [];
  }

  async getActiveTrades() {
    const { data } = await this.client.get('/api/trades?status=open');
    return data.trades || [];
  }

  // Portfolio endpoints
  async getPortfolio() {
    const { data } = await this.client.get('/api/portfolio');
    return data;
  }

  // Market data endpoints
  async getMarketData(symbols: string[]) {
    const { data } = await this.client.get(`/api/market?symbols=${symbols.join(',')}`);
    return data.marketData || [];
  }

  // Analytics endpoints
  async getAnalytics() {
    const { data } = await this.client.get('/api/analytics');
    return data;
  }

  // Health check
  async healthCheck() {
    const { data } = await this.client.get('/api/health');
    return data;
  }

  // Generic methods for components that need arbitrary endpoints
  async get(path: string) {
    return this.client.get(path);
  }

  async post(path: string, body?: unknown) {
    return this.client.post(path, body);
  }
}

export const api = new ApiService();
export default api;
