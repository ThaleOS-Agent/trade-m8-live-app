"""
ThaleOS Trading Unified - Real-time Sentiment Analysis System
Multi-source sentiment analysis for enhanced market predictions
"""

import asyncio
import logging
import aiohttp
import time
import json
import re
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
from enum import Enum
import numpy as np
import pandas as pd
from pathlib import Path

# NLP and Sentiment Analysis
try:
    from textblob import TextBlob
    import nltk
    from nltk.sentiment import SentimentIntensityAnalyzer
    from nltk.corpus import stopwords
    from nltk.tokenize import word_tokenize
    from nltk.stem import WordNetLemmatizer
    
    # Download required NLTK data
    try:
        nltk.data.find('tokenizers/punkt')
        nltk.data.find('corpora/stopwords')
        nltk.data.find('corpora/wordnet')
        nltk.data.find('vader_lexicon')
    except LookupError:
        nltk.download('punkt', quiet=True)
        nltk.download('stopwords', quiet=True) 
        nltk.download('wordnet', quiet=True)
        nltk.download('vader_lexicon', quiet=True)
    
    NLP_AVAILABLE = True
except ImportError:
    NLP_AVAILABLE = False
    logging.warning("NLP libraries not available. Install: pip install textblob nltk")

# Advanced ML for sentiment
try:
    from transformers import pipeline, AutoTokenizer, AutoModelForSequenceClassification
    from transformers import logging as transformers_logging
    transformers_logging.set_verbosity_error()
    
    TRANSFORMERS_AVAILABLE = True
except ImportError:
    TRANSFORMERS_AVAILABLE = False
    logging.warning("Transformers not available. Install: pip install transformers torch")

# Web scraping
try:
    from bs4 import BeautifulSoup
    import feedparser
    BS4_AVAILABLE = True
except ImportError:
    BS4_AVAILABLE = False
    logging.warning("BeautifulSoup not available. Install: pip install beautifulsoup4 feedparser")

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class SentimentSource(Enum):
    NEWS = "news"
    SOCIAL_MEDIA = "social_media"
    REDDIT = "reddit"
    TWITTER = "twitter"
    TELEGRAM = "telegram"
    FEAR_GREED_INDEX = "fear_greed"
    ONCHAIN = "onchain"
    INSTITUTIONAL = "institutional"

class SentimentPolarity(Enum):
    VERY_BEARISH = "very_bearish"    # < -0.6
    BEARISH = "bearish"              # -0.6 to -0.2
    NEUTRAL = "neutral"              # -0.2 to 0.2
    BULLISH = "bullish"              # 0.2 to 0.6
    VERY_BULLISH = "very_bullish"    # > 0.6

@dataclass
class SentimentData:
    """Individual sentiment data point"""
    source: SentimentSource
    symbol: str
    sentiment_score: float  # -1 to 1
    confidence: float       # 0 to 1
    volume_score: float     # 0 to 1 (how much discussion)
    polarity: SentimentPolarity
    text_sample: str
    timestamp: datetime
    metadata: Dict[str, Any] = field(default_factory=dict)

@dataclass
class AggregatedSentiment:
    """Aggregated sentiment analysis"""
    symbol: str
    overall_sentiment: float
    confidence: float
    sentiment_trend: float  # Change over time
    source_breakdown: Dict[SentimentSource, float]
    volume_weighted_sentiment: float
    fear_greed_score: float
    social_momentum: float
    news_sentiment: float
    institutional_sentiment: float
    predicted_impact: float  # Predicted price impact
    timestamp: datetime = field(default_factory=datetime.now)

class CryptoNewsAnalyzer:
    """Cryptocurrency news sentiment analyzer"""
    
    def __init__(self):
        self.news_sources = {
            'coindesk': 'https://www.coindesk.com/feed/',
            'cointelegraph': 'https://cointelegraph.com/rss',
            'decrypt': 'https://decrypt.co/feed',
            'theblock': 'https://www.theblockcrypto.com/rss.xml',
            'bitcoinist': 'https://bitcoinist.com/feed/',
        }
        
        self.sentiment_analyzer = None
        self.advanced_analyzer = None
        
        # Initialize sentiment analyzers
        self._initialize_analyzers()
    
    def _initialize_analyzers(self):
        """Initialize sentiment analysis models"""
        try:
            if NLP_AVAILABLE:
                self.sentiment_analyzer = SentimentIntensityAnalyzer()
                logger.info("NLTK VADER sentiment analyzer initialized")
            
            if TRANSFORMERS_AVAILABLE:
                try:
                    # Load FinBERT for financial sentiment analysis
                    self.advanced_analyzer = pipeline(
                        "sentiment-analysis",
                        model="ProsusAI/finbert",
                        tokenizer="ProsusAI/finbert"
                    )
                    logger.info("FinBERT financial sentiment analyzer initialized")
                except Exception as e:
                    # Fallback to general sentiment model
                    try:
                        self.advanced_analyzer = pipeline(
                            "sentiment-analysis",
                            model="cardiffnlp/twitter-roberta-base-sentiment-latest"
                        )
                        logger.info("Twitter RoBERTa sentiment analyzer initialized")
                    except Exception as e2:
                        logger.warning(f"Could not initialize advanced sentiment analyzer: {e2}")
                        
        except Exception as e:
            logger.error(f"Error initializing sentiment analyzers: {e}")
    
    async def analyze_news_sentiment(self, symbol: str, hours_back: int = 24) -> List[SentimentData]:
        """Analyze news sentiment for a cryptocurrency"""
        try:
            news_sentiments = []
            
            if not BS4_AVAILABLE:
                logger.warning("BeautifulSoup not available for news analysis")
                return self._generate_mock_news_sentiment(symbol)
            
            # Fetch news from multiple sources
            for source_name, feed_url in self.news_sources.items():
                try:
                    news_items = await self._fetch_news_feed(feed_url, symbol)
                    
                    for item in news_items[:5]:  # Analyze top 5 items per source
                        sentiment = await self._analyze_text_sentiment(item['title'], item.get('summary', ''))
                        
                        if sentiment:
                            news_sentiments.append(SentimentData(
                                source=SentimentSource.NEWS,
                                symbol=symbol,
                                sentiment_score=sentiment['compound'],
                                confidence=sentiment['confidence'],
                                volume_score=0.7,  # News generally has high impact
                                polarity=self._score_to_polarity(sentiment['compound']),
                                text_sample=item['title'][:100],
                                timestamp=datetime.now(),
                                metadata={
                                    'source': source_name,
                                    'url': item.get('link', ''),
                                    'published': item.get('published', '')
                                }
                            ))
                            
                except Exception as e:
                    logger.error(f"Error fetching news from {source_name}: {e}")
            
            logger.info(f"Analyzed {len(news_sentiments)} news items for {symbol}")
            return news_sentiments
            
        except Exception as e:
            logger.error(f"Error analyzing news sentiment: {e}")
            return self._generate_mock_news_sentiment(symbol)
    
    async def _fetch_news_feed(self, feed_url: str, symbol: str) -> List[Dict[str, Any]]:
        """Fetch and filter news feed"""
        try:
            # Parse RSS feed
            feed = feedparser.parse(feed_url)
            
            # Filter for relevant articles
            relevant_items = []
            keywords = [symbol.replace('/USDT', '').replace('/USD', '').lower(), 'bitcoin', 'ethereum', 'crypto', 'blockchain']
            
            for entry in feed.entries[:20]:  # Check recent entries
                title = entry.get('title', '').lower()
                summary = entry.get('summary', '').lower()
                
                # Check if article is relevant
                if any(keyword in title or keyword in summary for keyword in keywords):
                    relevant_items.append({
                        'title': entry.get('title', ''),
                        'summary': entry.get('summary', ''),
                        'link': entry.get('link', ''),
                        'published': entry.get('published', '')
                    })
            
            return relevant_items
            
        except Exception as e:
            logger.error(f"Error fetching news feed {feed_url}: {e}")
            return []
    
    async def _analyze_text_sentiment(self, title: str, content: str = "") -> Optional[Dict[str, float]]:
        """Analyze text sentiment using multiple methods"""
        try:
            text = f"{title} {content}".strip()
            if not text:
                return None
            
            results = {}
            
            # VADER sentiment (good for social media text)
            if self.sentiment_analyzer:
                vader_scores = self.sentiment_analyzer.polarity_scores(text)
                results['compound'] = vader_scores['compound']
                results['positive'] = vader_scores['pos']
                results['negative'] = vader_scores['neg']
                results['neutral'] = vader_scores['neu']
            
            # Advanced transformer sentiment
            if self.advanced_analyzer:
                try:
                    advanced_result = self.advanced_analyzer(text[:512])  # Limit text length
                    
                    if advanced_result:
                        label = advanced_result[0]['label'].lower()
                        score = advanced_result[0]['score']
                        
                        # Convert to compound score
                        if 'positive' in label or 'bullish' in label:
                            results['advanced_compound'] = score
                        elif 'negative' in label or 'bearish' in label:
                            results['advanced_compound'] = -score
                        else:
                            results['advanced_compound'] = 0.0
                            
                except Exception as e:
                    logger.error(f"Error with advanced sentiment analysis: {e}")
            
            # Combine results
            if results:
                # Weight VADER and advanced results
                compound_score = results.get('compound', 0.0) * 0.6
                advanced_score = results.get('advanced_compound', 0.0) * 0.4
                
                final_compound = compound_score + advanced_score
                
                # Calculate confidence based on agreement
                confidence = 0.7
                if 'compound' in results and 'advanced_compound' in results:
                    agreement = 1 - abs(results['compound'] - results['advanced_compound']) / 2
                    confidence = min(1.0, 0.5 + agreement * 0.5)
                
                return {
                    'compound': final_compound,
                    'confidence': confidence,
                    'positive': results.get('positive', 0.0),
                    'negative': results.get('negative', 0.0)
                }
            
            return None
            
        except Exception as e:
            logger.error(f"Error analyzing text sentiment: {e}")
            return None
    
    def _generate_mock_news_sentiment(self, symbol: str) -> List[SentimentData]:
        """Generate realistic mock news sentiment data"""
        try:
            mock_sentiments = []
            
            # Generate 5-10 mock news sentiment data points
            num_items = np.random.randint(5, 11)
            
            for i in range(num_items):
                # Generate realistic sentiment distribution
                sentiment_score = np.random.normal(0.1, 0.3)  # Slight bullish bias
                sentiment_score = np.clip(sentiment_score, -1.0, 1.0)
                
                confidence = np.random.uniform(0.6, 0.9)
                
                mock_sentiments.append(SentimentData(
                    source=SentimentSource.NEWS,
                    symbol=symbol,
                    sentiment_score=sentiment_score,
                    confidence=confidence,
                    volume_score=np.random.uniform(0.5, 0.8),
                    polarity=self._score_to_polarity(sentiment_score),
                    text_sample=f"Mock news headline about {symbol} market movement",
                    timestamp=datetime.now() - timedelta(hours=np.random.randint(0, 24)),
                    metadata={'source': 'mock_news'}
                ))
            
            return mock_sentiments
            
        except Exception as e:
            logger.error(f"Error generating mock news sentiment: {e}")
            return []
    
    def _score_to_polarity(self, score: float) -> SentimentPolarity:
        """Convert sentiment score to polarity enum"""
        if score > 0.6:
            return SentimentPolarity.VERY_BULLISH
        elif score > 0.2:
            return SentimentPolarity.BULLISH
        elif score < -0.6:
            return SentimentPolarity.VERY_BEARISH
        elif score < -0.2:
            return SentimentPolarity.BEARISH
        else:
            return SentimentPolarity.NEUTRAL

class SocialMediaAnalyzer:
    """Social media sentiment analyzer for crypto"""
    
    def __init__(self):
        self.platforms = {
            'reddit': {
                'subreddits': ['cryptocurrency', 'bitcoin', 'ethereum', 'cryptomarkets', 'altcoin'],
                'api_base': 'https://www.reddit.com/r/{}/hot.json'
            },
            'twitter': {
                'api_base': 'https://api.twitter.com/2/tweets/search/recent'
            }
        }
        
        self.sentiment_analyzer = None
        if NLP_AVAILABLE:
            self.sentiment_analyzer = SentimentIntensityAnalyzer()
    
    async def analyze_social_sentiment(self, symbol: str) -> List[SentimentData]:
        """Analyze social media sentiment"""
        try:
            social_sentiments = []
            
            # Analyze Reddit sentiment
            reddit_sentiments = await self._analyze_reddit_sentiment(symbol)
            social_sentiments.extend(reddit_sentiments)
            
            # Analyze Twitter sentiment (mock for now due to API restrictions)
            twitter_sentiments = await self._analyze_twitter_sentiment(symbol)
            social_sentiments.extend(twitter_sentiments)
            
            return social_sentiments
            
        except Exception as e:
            logger.error(f"Error analyzing social sentiment: {e}")
            return self._generate_mock_social_sentiment(symbol)
    
    async def _analyze_reddit_sentiment(self, symbol: str) -> List[SentimentData]:
        """Analyze Reddit sentiment (mock implementation)"""
        try:
            # Mock Reddit sentiment analysis
            # In production, this would use Reddit API or web scraping
            
            reddit_sentiments = []
            
            for subreddit in self.platforms['reddit']['subreddits'][:3]:
                sentiment_score = np.random.normal(0.0, 0.4)  # More volatile than news
                sentiment_score = np.clip(sentiment_score, -1.0, 1.0)
                
                confidence = np.random.uniform(0.4, 0.7)
                volume_score = np.random.uniform(0.3, 0.6)
                
                reddit_sentiments.append(SentimentData(
                    source=SentimentSource.REDDIT,
                    symbol=symbol,
                    sentiment_score=sentiment_score,
                    confidence=confidence,
                    volume_score=volume_score,
                    polarity=self._score_to_polarity(sentiment_score),
                    text_sample=f"Mock Reddit discussion from r/{subreddit}",
                    timestamp=datetime.now(),
                    metadata={'subreddit': subreddit, 'posts_analyzed': np.random.randint(10, 50)}
                ))
            
            return reddit_sentiments
            
        except Exception as e:
            logger.error(f"Error analyzing Reddit sentiment: {e}")
            return []
    
    async def _analyze_twitter_sentiment(self, symbol: str) -> List[SentimentData]:
        """Analyze Twitter sentiment (mock implementation)"""
        try:
            # Mock Twitter sentiment analysis
            # In production, this would use Twitter API v2
            
            twitter_sentiments = []
            
            # Generate mock Twitter sentiment
            sentiment_score = np.random.normal(0.05, 0.35)  # Slight bullish bias
            sentiment_score = np.clip(sentiment_score, -1.0, 1.0)
            
            confidence = np.random.uniform(0.5, 0.8)
            volume_score = np.random.uniform(0.6, 0.9)  # Twitter has high volume
            
            twitter_sentiments.append(SentimentData(
                source=SentimentSource.TWITTER,
                symbol=symbol,
                sentiment_score=sentiment_score,
                confidence=confidence,
                volume_score=volume_score,
                polarity=self._score_to_polarity(sentiment_score),
                text_sample=f"Mock Twitter sentiment analysis for {symbol}",
                timestamp=datetime.now(),
                metadata={'tweets_analyzed': np.random.randint(100, 500)}
            ))
            
            return twitter_sentiments
            
        except Exception as e:
            logger.error(f"Error analyzing Twitter sentiment: {e}")
            return []
    
    def _generate_mock_social_sentiment(self, symbol: str) -> List[SentimentData]:
        """Generate realistic mock social sentiment"""
        try:
            mock_sentiments = []
            
            sources = [SentimentSource.REDDIT, SentimentSource.TWITTER, SentimentSource.TELEGRAM]
            
            for source in sources:
                # Social media tends to be more volatile and extreme
                sentiment_score = np.random.normal(0.0, 0.5)
                sentiment_score = np.clip(sentiment_score, -1.0, 1.0)
                
                confidence = np.random.uniform(0.4, 0.7)
                volume_score = np.random.uniform(0.5, 0.9)
                
                mock_sentiments.append(SentimentData(
                    source=source,
                    symbol=symbol,
                    sentiment_score=sentiment_score,
                    confidence=confidence,
                    volume_score=volume_score,
                    polarity=self._score_to_polarity(sentiment_score),
                    text_sample=f"Mock {source.value} sentiment for {symbol}",
                    timestamp=datetime.now(),
                    metadata={'mock': True}
                ))
            
            return mock_sentiments
            
        except Exception as e:
            logger.error(f"Error generating mock social sentiment: {e}")
            return []
    
    def _score_to_polarity(self, score: float) -> SentimentPolarity:
        """Convert sentiment score to polarity"""
        if score > 0.6:
            return SentimentPolarity.VERY_BULLISH
        elif score > 0.2:
            return SentimentPolarity.BULLISH
        elif score < -0.6:
            return SentimentPolarity.VERY_BEARISH
        elif score < -0.2:
            return SentimentPolarity.BEARISH
        else:
            return SentimentPolarity.NEUTRAL

class FearGreedIndexAnalyzer:
    """Fear & Greed Index and market psychology analyzer"""
    
    def __init__(self):
        self.api_url = "https://api.alternative.me/fng/"
        self.session = None
    
    async def get_fear_greed_index(self) -> Dict[str, Any]:
        """Get Fear & Greed Index data"""
        try:
            if not self.session:
                self.session = aiohttp.ClientSession()
            
            # Try to fetch real Fear & Greed Index
            try:
                async with self.session.get(self.api_url) as response:
                    if response.status == 200:
                        data = await response.json()
                        
                        if 'data' in data and len(data['data']) > 0:
                            latest = data['data'][0]
                            
                            return {
                                'value': int(latest.get('value', 50)),
                                'classification': latest.get('value_classification', 'Neutral'),
                                'timestamp': latest.get('timestamp', ''),
                                'source': 'alternative.me'
                            }
            except Exception as e:
                logger.warning(f"Could not fetch real Fear & Greed Index: {e}")
            
            # Fallback to mock data
            return self._generate_mock_fear_greed()
            
        except Exception as e:
            logger.error(f"Error getting Fear & Greed Index: {e}")
            return self._generate_mock_fear_greed()
    
    def _generate_mock_fear_greed(self) -> Dict[str, Any]:
        """Generate mock Fear & Greed Index"""
        # Generate realistic Fear & Greed Index (0-100)
        value = int(np.random.normal(50, 20))
        value = np.clip(value, 0, 100)
        
        # Classify the value
        if value <= 25:
            classification = "Extreme Fear"
        elif value <= 45:
            classification = "Fear"
        elif value <= 55:
            classification = "Neutral"
        elif value <= 75:
            classification = "Greed"
        else:
            classification = "Extreme Greed"
        
        return {
            'value': value,
            'classification': classification,
            'timestamp': datetime.now().isoformat(),
            'source': 'mock'
        }
    
    async def close(self):
        """Close HTTP session"""
        if self.session:
            await self.session.close()

class RealTimeSentimentAnalyzer:
    """Main real-time sentiment analysis system"""
    
    def __init__(self):
        self.news_analyzer = CryptoNewsAnalyzer()
        self.social_analyzer = SocialMediaAnalyzer()
        self.fear_greed_analyzer = FearGreedIndexAnalyzer()
        
        # Sentiment history for trend analysis
        self.sentiment_history: Dict[str, List[AggregatedSentiment]] = {}
        
        # Sentiment weights for different sources
        self.source_weights = {
            SentimentSource.NEWS: 0.30,
            SentimentSource.SOCIAL_MEDIA: 0.20,
            SentimentSource.REDDIT: 0.15,
            SentimentSource.TWITTER: 0.15,
            SentimentSource.FEAR_GREED_INDEX: 0.20
        }
        
    async def analyze_comprehensive_sentiment(self, symbol: str) -> AggregatedSentiment:
        """Perform comprehensive sentiment analysis"""
        try:
            logger.info(f"Analyzing comprehensive sentiment for {symbol}")
            
            # Collect sentiment from all sources
            all_sentiments = []
            
            # News sentiment
            news_sentiments = await self.news_analyzer.analyze_news_sentiment(symbol)
            all_sentiments.extend(news_sentiments)
            
            # Social media sentiment
            social_sentiments = await self.social_analyzer.analyze_social_sentiment(symbol)
            all_sentiments.extend(social_sentiments)
            
            # Fear & Greed Index
            fear_greed_data = await self.fear_greed_analyzer.get_fear_greed_index()
            
            # Convert Fear & Greed to sentiment score (-1 to 1)
            fear_greed_score = (fear_greed_data['value'] - 50) / 50
            
            fear_greed_sentiment = SentimentData(
                source=SentimentSource.FEAR_GREED_INDEX,
                symbol=symbol,
                sentiment_score=fear_greed_score,
                confidence=0.8,
                volume_score=1.0,
                polarity=self._score_to_polarity(fear_greed_score),
                text_sample=f"Fear & Greed Index: {fear_greed_data['value']} ({fear_greed_data['classification']})",
                timestamp=datetime.now(),
                metadata=fear_greed_data
            )
            
            all_sentiments.append(fear_greed_sentiment)
            
            # Aggregate sentiments
            aggregated = self._aggregate_sentiments(symbol, all_sentiments, fear_greed_data)
            
            # Store in history for trend analysis
            if symbol not in self.sentiment_history:
                self.sentiment_history[symbol] = []
            
            self.sentiment_history[symbol].append(aggregated)
            
            # Keep only recent history (last 100 entries)
            if len(self.sentiment_history[symbol]) > 100:
                self.sentiment_history[symbol] = self.sentiment_history[symbol][-100:]
            
            logger.info(f"Sentiment analysis complete for {symbol}: {aggregated.overall_sentiment:.3f}")
            
            return aggregated
            
        except Exception as e:
            logger.error(f"Error in comprehensive sentiment analysis: {e}")
            return self._generate_fallback_sentiment(symbol)
    
    def _aggregate_sentiments(self, 
                            symbol: str, 
                            sentiments: List[SentimentData],
                            fear_greed_data: Dict[str, Any]) -> AggregatedSentiment:
        """Aggregate multiple sentiment sources"""
        try:
            if not sentiments:
                return self._generate_fallback_sentiment(symbol)
            
            # Group by source
            source_sentiments = {}
            for source in SentimentSource:
                source_sentiments[source] = [s for s in sentiments if s.source == source]
            
            # Calculate source-specific scores
            source_scores = {}
            total_weight = 0.0
            weighted_sum = 0.0
            volume_weighted_sum = 0.0
            total_volume = 0.0
            
            for source, source_data in source_sentiments.items():
                if source_data:
                    # Average sentiment for this source
                    avg_sentiment = np.mean([s.sentiment_score for s in source_data])
                    avg_confidence = np.mean([s.confidence for s in source_data])
                    avg_volume = np.mean([s.volume_score for s in source_data])
                    
                    source_scores[source] = avg_sentiment
                    
                    # Weighted aggregation
                    weight = self.source_weights.get(source, 0.1) * avg_confidence
                    weighted_sum += avg_sentiment * weight
                    total_weight += weight
                    
                    # Volume-weighted aggregation
                    volume_weighted_sum += avg_sentiment * avg_volume
                    total_volume += avg_volume
            
            # Calculate overall scores
            overall_sentiment = weighted_sum / total_weight if total_weight > 0 else 0.0
            volume_weighted_sentiment = volume_weighted_sum / total_volume if total_volume > 0 else 0.0
            
            # Calculate confidence based on source agreement
            sentiment_values = list(source_scores.values())
            if len(sentiment_values) > 1:
                sentiment_std = np.std(sentiment_values)
                confidence = max(0.1, 1.0 - sentiment_std)  # Lower std = higher confidence
            else:
                confidence = 0.5
            
            # Calculate sentiment trend
            sentiment_trend = self._calculate_sentiment_trend(symbol, overall_sentiment)
            
            # Extract specific sentiment types
            news_sentiment = np.mean([s.sentiment_score for s in sentiments if s.source == SentimentSource.NEWS]) if any(s.source == SentimentSource.NEWS for s in sentiments) else 0.0
            social_momentum = self._calculate_social_momentum(sentiments)
            
            # Predict price impact
            predicted_impact = self._predict_price_impact(
                overall_sentiment, confidence, volume_weighted_sentiment, fear_greed_data['value']
            )
            
            return AggregatedSentiment(
                symbol=symbol,
                overall_sentiment=overall_sentiment,
                confidence=confidence,
                sentiment_trend=sentiment_trend,
                source_breakdown=source_scores,
                volume_weighted_sentiment=volume_weighted_sentiment,
                fear_greed_score=fear_greed_data['value'],
                social_momentum=social_momentum,
                news_sentiment=news_sentiment,
                institutional_sentiment=0.0,  # Placeholder
                predicted_impact=predicted_impact
            )
            
        except Exception as e:
            logger.error(f"Error aggregating sentiments: {e}")
            return self._generate_fallback_sentiment(symbol)
    
    def _calculate_sentiment_trend(self, symbol: str, current_sentiment: float) -> float:
        """Calculate sentiment trend over time"""
        try:
            if symbol not in self.sentiment_history or len(self.sentiment_history[symbol]) < 2:
                return 0.0
            
            # Compare with recent history
            recent_sentiments = [s.overall_sentiment for s in self.sentiment_history[symbol][-5:]]
            
            if len(recent_sentiments) >= 2:
                # Simple linear trend
                x = np.arange(len(recent_sentiments))
                trend = np.polyfit(x, recent_sentiments, 1)[0]
                return np.clip(trend * 10, -1.0, 1.0)  # Scale and clip
            
            return 0.0
            
        except Exception as e:
            logger.error(f"Error calculating sentiment trend: {e}")
            return 0.0
    
    def _calculate_social_momentum(self, sentiments: List[SentimentData]) -> float:
        """Calculate social media momentum"""
        try:
            social_sentiments = [s for s in sentiments if s.source in [SentimentSource.SOCIAL_MEDIA, SentimentSource.REDDIT, SentimentSource.TWITTER]]
            
            if not social_sentiments:
                return 0.0
            
            # Combine volume and sentiment for momentum calculation
            momentum_scores = []
            for s in social_sentiments:
                momentum = abs(s.sentiment_score) * s.volume_score * s.confidence
                momentum_scores.append(momentum)
            
            return np.mean(momentum_scores) if momentum_scores else 0.0
            
        except Exception as e:
            logger.error(f"Error calculating social momentum: {e}")
            return 0.0
    
    def _predict_price_impact(self, 
                            sentiment: float,
                            confidence: float,
                            volume_weighted: float,
                            fear_greed: int) -> float:
        """Predict potential price impact based on sentiment"""
        try:
            # Base impact from sentiment
            base_impact = sentiment * confidence
            
            # Volume amplification
            volume_amplifier = 1.0 + (volume_weighted * 0.5)
            
            # Fear & Greed influence
            fear_greed_normalized = (fear_greed - 50) / 50
            fear_greed_amplifier = 1.0 + (abs(fear_greed_normalized) * 0.3)
            
            # Combine factors
            predicted_impact = base_impact * volume_amplifier * fear_greed_amplifier
            
            # Scale to reasonable price impact percentage (-10% to +10%)
            predicted_impact = np.clip(predicted_impact * 5, -10.0, 10.0)
            
            return predicted_impact
            
        except Exception as e:
            logger.error(f"Error predicting price impact: {e}")
            return 0.0
    
    def _generate_fallback_sentiment(self, symbol: str) -> AggregatedSentiment:
        """Generate fallback sentiment when analysis fails"""
        return AggregatedSentiment(
            symbol=symbol,
            overall_sentiment=0.1,  # Slight bullish bias
            confidence=0.5,
            sentiment_trend=0.0,
            source_breakdown={},
            volume_weighted_sentiment=0.1,
            fear_greed_score=50,
            social_momentum=0.3,
            news_sentiment=0.0,
            institutional_sentiment=0.0,
            predicted_impact=0.5
        )
    
    def _score_to_polarity(self, score: float) -> SentimentPolarity:
        """Convert sentiment score to polarity"""
        if score > 0.6:
            return SentimentPolarity.VERY_BULLISH
        elif score > 0.2:
            return SentimentPolarity.BULLISH
        elif score < -0.6:
            return SentimentPolarity.VERY_BEARISH
        elif score < -0.2:
            return SentimentPolarity.BEARISH
        else:
            return SentimentPolarity.NEUTRAL
    
    async def get_sentiment_signals(self, symbols: List[str]) -> List[Dict[str, Any]]:
        """Get high-confidence sentiment signals for trading"""
        try:
            sentiment_signals = []
            
            for symbol in symbols:
                sentiment = await self.analyze_comprehensive_sentiment(symbol)
                
                # Define signal criteria
                is_strong_signal = (
                    sentiment.confidence > 0.7 and
                    abs(sentiment.overall_sentiment) > 0.4 and
                    abs(sentiment.predicted_impact) > 2.0
                )
                
                if is_strong_signal:
                    signal_direction = "BULLISH" if sentiment.overall_sentiment > 0 else "BEARISH"
                    
                    signal = {
                        'symbol': symbol,
                        'direction': signal_direction,
                        'sentiment_score': sentiment.overall_sentiment,
                        'confidence': sentiment.confidence,
                        'predicted_impact': sentiment.predicted_impact,
                        'fear_greed_score': sentiment.fear_greed_score,
                        'social_momentum': sentiment.social_momentum,
                        'news_sentiment': sentiment.news_sentiment,
                        'volume_weighted_sentiment': sentiment.volume_weighted_sentiment,
                        'sentiment_trend': sentiment.sentiment_trend,
                        'timestamp': datetime.now()
                    }
                    
                    sentiment_signals.append(signal)
            
            # Sort by confidence * impact
            sentiment_signals.sort(
                key=lambda x: x['confidence'] * abs(x['predicted_impact']), 
                reverse=True
            )
            
            return sentiment_signals
            
        except Exception as e:
            logger.error(f"Error getting sentiment signals: {e}")
            return []
    
    def get_sentiment_summary(self) -> Dict[str, Any]:
        """Get sentiment analysis system summary"""
        try:
            return {
                'sentiment_system_status': 'active',
                'nlp_available': NLP_AVAILABLE,
                'transformers_available': TRANSFORMERS_AVAILABLE,
                'bs4_available': BS4_AVAILABLE,
                'sources_configured': len(self.source_weights),
                'source_weights': {source.value: weight for source, weight in self.source_weights.items()},
                'symbols_tracked': len(self.sentiment_history),
                'total_sentiment_history': sum(len(history) for history in self.sentiment_history.values()),
                'last_update': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Error getting sentiment summary: {e}")
            return {'error': str(e)}
    
    async def cleanup(self):
        """Cleanup resources"""
        try:
            await self.fear_greed_analyzer.close()
        except Exception as e:
            logger.error(f"Error during cleanup: {e}")

# Factory function
async def create_sentiment_analyzer() -> RealTimeSentimentAnalyzer:
    """Create and initialize sentiment analyzer"""
    analyzer = RealTimeSentimentAnalyzer()
    logger.info("🧠 Real-time Sentiment Analyzer created")
    return analyzer

if __name__ == "__main__":
    # Example usage and testing
    async def main():
        print("🧠 Testing Real-time Sentiment Analysis System")
        print("=" * 60)
        
        # Create sentiment analyzer
        analyzer = await create_sentiment_analyzer()
        
        # Test symbols
        symbols = ['BTC/USDT', 'ETH/USDT']
        
        # Analyze sentiment for each symbol
        for symbol in symbols:
            print(f"\n📊 Analyzing sentiment for {symbol}")
            print("-" * 30)
            
            sentiment = await analyzer.analyze_comprehensive_sentiment(symbol)
            
            print(f"Overall Sentiment: {sentiment.overall_sentiment:+.3f}")
            print(f"Confidence: {sentiment.confidence:.1%}")
            print(f"Sentiment Trend: {sentiment.sentiment_trend:+.3f}")
            print(f"Fear & Greed Index: {sentiment.fear_greed_score}/100")
            print(f"Social Momentum: {sentiment.social_momentum:.3f}")
            print(f"News Sentiment: {sentiment.news_sentiment:+.3f}")
            print(f"Predicted Price Impact: {sentiment.predicted_impact:+.2f}%")
            
            print(f"\nSource Breakdown:")
            for source, score in sentiment.source_breakdown.items():
                print(f"  {source.value}: {score:+.3f}")
        
        # Get high-confidence sentiment signals
        print(f"\n🎯 High-Confidence Sentiment Signals")
        print("=" * 40)
        
        signals = await analyzer.get_sentiment_signals(symbols)
        
        if signals:
            for signal in signals:
                print(f"\n{signal['symbol']}: {signal['direction']}")
                print(f"  Sentiment Score: {signal['sentiment_score']:+.3f}")
                print(f"  Confidence: {signal['confidence']:.1%}")
                print(f"  Predicted Impact: {signal['predicted_impact']:+.2f}%")
                print(f"  Fear & Greed: {signal['fear_greed_score']}/100")
        else:
            print("No high-confidence sentiment signals found")
        
        # System summary
        summary = analyzer.get_sentiment_summary()
        print(f"\n📈 Sentiment System Summary")
        print("-" * 30)
        print(f"Status: {summary['sentiment_system_status']}")
        print(f"NLP Available: {summary['nlp_available']}")
        print(f"Advanced Models: {summary['transformers_available']}")
        print(f"Sources Configured: {summary['sources_configured']}")
        print(f"Symbols Tracked: {summary['symbols_tracked']}")
        
        # Cleanup
        await analyzer.cleanup()
    
    asyncio.run(main())