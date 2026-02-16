/**
 * News Sentiment Analyzer
 * Analyzes news sentiment to inform trading decisions
 */

export interface NewsArticle {
  title: string;
  source: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  score: number; // -1 to 1
  relevance: number; // 0 to 1
  timestamp: Date;
  symbols: string[];
}

export interface SentimentAnalysis {
  symbol: string;
  overallSentiment: 'bullish' | 'bearish' | 'neutral';
  sentimentScore: number; // -100 to 100
  newsCount: number;
  topHeadlines: NewsArticle[];
  recommendation: 'buy' | 'sell' | 'hold';
}

class NewsSentimentAnalyzer {
  private readonly POSITIVE_KEYWORDS = [
    'surge', 'rally', 'bullish', 'growth', 'gains', 'soar', 'breakthrough',
    'adoption', 'partnership', 'upgrade', 'success', 'milestone', 'record',
    'innovation', 'expansion', 'profit', 'optimistic', 'boost', 'strong'
  ];

  private readonly NEGATIVE_KEYWORDS = [
    'crash', 'plunge', 'bearish', 'decline', 'drop', 'fall', 'concern',
    'risk', 'warning', 'loss', 'scandal', 'hack', 'failure', 'weak',
    'downgrade', 'sell-off', 'crisis', 'recession', 'collapse', 'fear'
  ];

  /**
   * Analyze sentiment of text
   */
  private analyzeSentiment(text: string): { sentiment: NewsArticle['sentiment']; score: number } {
    const lowerText = text.toLowerCase();
    let score = 0;

    // Count positive keywords
    this.POSITIVE_KEYWORDS.forEach(keyword => {
      const matches = (lowerText.match(new RegExp(keyword, 'g')) || []).length;
      score += matches * 0.3;
    });

    // Count negative keywords
    this.NEGATIVE_KEYWORDS.forEach(keyword => {
      const matches = (lowerText.match(new RegExp(keyword, 'g')) || []).length;
      score -= matches * 0.3;
    });

    // Normalize score to -1 to 1
    score = Math.max(-1, Math.min(1, score / 3));

    let sentiment: NewsArticle['sentiment'];
    if (score > 0.2) sentiment = 'positive';
    else if (score < -0.2) sentiment = 'negative';
    else sentiment = 'neutral';

    return { sentiment, score };
  }

  /**
   * Generate mock news headlines (in production, fetch from news APIs)
   */
  private generateMockNews(symbol: string): NewsArticle[] {
    const newsTemplates = [
      {
        title: `${symbol} sees strong institutional interest as adoption grows`,
        sentiment: 'positive' as const,
        source: 'CryptoNews'
      },
      {
        title: `Market analysis: ${symbol} shows bullish signals ahead`,
        sentiment: 'positive' as const,
        source: 'TradingView'
      },
      {
        title: `${symbol} consolidates after recent gains, analysts remain optimistic`,
        sentiment: 'neutral' as const,
        source: 'Bloomberg'
      },
      {
        title: `Technical indicators suggest ${symbol} may face resistance`,
        sentiment: 'negative' as const,
        source: 'MarketWatch'
      },
      {
        title: `Major partnership announced for ${symbol} ecosystem`,
        sentiment: 'positive' as const,
        source: 'Reuters'
      },
      {
        title: `${symbol} trading volume surges to record highs`,
        sentiment: 'positive' as const,
        source: 'CoinDesk'
      },
      {
        title: `Regulatory concerns weigh on ${symbol} outlook`,
        sentiment: 'negative' as const,
        source: 'Financial Times'
      },
      {
        title: `Analysts upgrade ${symbol} price targets citing fundamentals`,
        sentiment: 'positive' as const,
        source: 'Forbes'
      }
    ];

    // Randomly select 3-5 news articles
    const count = Math.floor(Math.random() * 3) + 3;
    const selectedNews: NewsArticle[] = [];

    for (let i = 0; i < count; i++) {
      const template = newsTemplates[Math.floor(Math.random() * newsTemplates.length)];
      const analysis = this.analyzeSentiment(template.title);

      selectedNews.push({
        title: template.title,
        source: template.source,
        sentiment: analysis.sentiment,
        score: analysis.score,
        relevance: Math.random() * 0.5 + 0.5, // 0.5 to 1
        timestamp: new Date(Date.now() - Math.random() * 24 * 60 * 60 * 1000), // Last 24 hours
        symbols: [symbol]
      });
    }

    return selectedNews.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Analyze news sentiment for a specific symbol
   */
  async analyzeSymbol(symbol: string): Promise<SentimentAnalysis> {
    // In production, fetch real news from APIs like:
    // - NewsAPI
    // - Alpha Vantage News
    // - CryptoCompare News
    // - Twitter/X API for social sentiment

    const news = this.generateMockNews(symbol);

    // Calculate overall sentiment score
    let totalScore = 0;
    let weightedScore = 0;

    news.forEach(article => {
      totalScore += article.score;
      weightedScore += article.score * article.relevance;
    });

    // Convert to -100 to 100 scale
    const sentimentScore = (weightedScore / news.length) * 100;

    // Determine overall sentiment
    let overallSentiment: SentimentAnalysis['overallSentiment'];
    if (sentimentScore > 20) overallSentiment = 'bullish';
    else if (sentimentScore < -20) overallSentiment = 'bearish';
    else overallSentiment = 'neutral';

    // Determine recommendation
    let recommendation: SentimentAnalysis['recommendation'];
    if (sentimentScore > 30) recommendation = 'buy';
    else if (sentimentScore < -30) recommendation = 'sell';
    else recommendation = 'hold';

    return {
      symbol,
      overallSentiment,
      sentimentScore,
      newsCount: news.length,
      topHeadlines: news.slice(0, 3),
      recommendation
    };
  }

  /**
   * Get market-wide sentiment
   */
  async getMarketSentiment(symbols: string[]): Promise<Map<string, SentimentAnalysis>> {
    const sentimentMap = new Map<string, SentimentAnalysis>();

    for (const symbol of symbols) {
      const analysis = await this.analyzeSymbol(symbol);
      sentimentMap.set(symbol, analysis);
    }

    return sentimentMap;
  }

  /**
   * Find symbols with most positive news sentiment
   */
  async findBullishNews(symbols: string[], minScore: number = 30): Promise<SentimentAnalysis[]> {
    const analyses: SentimentAnalysis[] = [];

    for (const symbol of symbols) {
      const analysis = await this.analyzeSymbol(symbol);
      if (analysis.sentimentScore >= minScore) {
        analyses.push(analysis);
      }
    }

    return analyses.sort((a, b) => b.sentimentScore - a.sentimentScore);
  }
}

export const newsSentiment = new NewsSentimentAnalyzer();
export default newsSentiment;
